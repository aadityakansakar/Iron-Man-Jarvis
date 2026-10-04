/**
 * gestures.js
 * Recognizes hand gestures from MediaPipe landmarks.
 * Emits gesture events via a simple callback system.
 *
 * Landmark reference (MediaPipe):
 *   0=WRIST  1-4=THUMB(CMC,MCP,IP,TIP)  5-8=INDEX(MCP,PIP,DIP,TIP)
 *   9-12=MIDDLE  13-16=RING  17-20=PINKY
 */

window.GestureDetector = class GestureDetector {
    constructor() {
        // Current detected gesture name
        this.currentGesture = 'NONE';
        this.prevGesture = 'NONE';

        // Smoothed cursor position (screen pixels)
        this.cursorX = 0;
        this.cursorY = 0;

        // Gesture history for swipe detection
        this.wristHistory = [];          // [{x, y, time}] normalized coords
        this.MAX_HISTORY = 20;
        this.SWIPE_VELOCITY = 0.018;     // min velocity for swipe (normalized units/ms)
        this.SWIPE_WINDOW_MS = 350;      // time window for swipe detection

        // Pinch state
        this.isPinching = false;
        this.pinchStartPos = null;       // screen coords when pinch started
        this.PINCH_THRESHOLD = 0.07;     // normalized distance = pinch
        this.PINCH_RELEASE = 0.10;       // hysteresis: release threshold

        // Palm rotation (Euler angles from palm normal)
        this.palmRotation = { rx: 0, ry: 0 };

        // Gesture event callbacks: { gestureName: [callbacks] }
        this._listeners = {};

        // Debounce timers
        this._gestureDebounce = {};
        this.GESTURE_COOLDOWN_MS = 600;

        // Cursor smoothing
        this.CURSOR_ALPHA = 0.35; // lower = smoother but more lag
    }

    /**
     * Subscribe to a gesture event.
     * @param {string} gesture  e.g. 'PINCH', 'SWIPE_LEFT', 'OPEN_PALM', 'FIST', 'POINT', 'TWO_FINGERS'
     * @param {function} cb
     */
    on(gesture, cb) {
        if (!this._listeners[gesture]) this._listeners[gesture] = [];
        this._listeners[gesture].push(cb);
    }

    /**
     * Emit a gesture event (with debouncing)
     */
    _emit(gesture, data) {
        const now = Date.now();
        if (this._gestureDebounce[gesture] && now - this._gestureDebounce[gesture] < this.GESTURE_COOLDOWN_MS) return;
        this._gestureDebounce[gesture] = now;
        const listeners = this._listeners[gesture] || [];
        listeners.forEach(cb => cb(data));
    }

    /**
     * Main update — call every frame with current landmarks.
     * @param {Array|null} landmarks - array of 21 {x,y,z} normalized coords, or null
     * @param {number} screenW
     * @param {number} screenH
     */
    update(landmarks, screenW, screenH) {
        if (!landmarks) {
            this.currentGesture = 'NONE';
            return;
        }

        // ── Update cursor from index fingertip (landmark 8) ──
        const rawCursorX = (1 - landmarks[8].x) * screenW;
        const rawCursorY = landmarks[8].y * screenH;
        this.cursorX = this.CURSOR_ALPHA * rawCursorX + (1 - this.CURSOR_ALPHA) * this.cursorX;
        this.cursorY = this.CURSOR_ALPHA * rawCursorY + (1 - this.CURSOR_ALPHA) * this.cursorY;

        // ── Track wrist for swipe detection ──
        const now = Date.now();
        this.wristHistory.push({ x: landmarks[0].x, y: landmarks[0].y, time: now });
        if (this.wristHistory.length > this.MAX_HISTORY) this.wristHistory.shift();

        // ── Finger extension detection ──
        const ext = this._getFingerExtension(landmarks);

        // ── Pinch detection ──
        const pinchDist = this._dist(landmarks[4], landmarks[8]);
        const wasPinching = this.isPinching;

        if (!this.isPinching && pinchDist < this.PINCH_THRESHOLD) {
            this.isPinching = true;
            this.pinchStartPos = { x: this.cursorX, y: this.cursorY };
            this._emit('PINCH_START', { x: this.cursorX, y: this.cursorY });
        } else if (this.isPinching && pinchDist > this.PINCH_RELEASE) {
            this.isPinching = false;
            this._emit('PINCH_END', { x: this.cursorX, y: this.cursorY });
        }

        // ── Classify current gesture ──
        const newGesture = this._classify(landmarks, ext, pinchDist);

        // ── Swipe detection ──
        this._detectSwipe();

        // ── Emit on gesture change ──
        if (newGesture !== this.prevGesture) {
            this._emit(newGesture, { x: this.cursorX, y: this.cursorY });
            this.prevGesture = newGesture;
        }

        this.currentGesture = newGesture;

        // ── Palm rotation ──
        this._computePalmRotation(landmarks);
    }

    /**
     * Get which fingers are extended (true/false).
     * Returns { thumb, index, middle, ring, pinky }
     */
    _getFingerExtension(lms) {
        // For index-pinky: tip y < pip y means extended (y increases downward)
        // For thumb: tip x vs mcp x (accounting for mirroring handled by x flip)
        return {
            thumb:  this._dist(lms[4], lms[2]) > this._dist(lms[3], lms[2]) * 0.8,
            index:  lms[8].y < lms[6].y,
            middle: lms[12].y < lms[10].y,
            ring:   lms[16].y < lms[14].y,
            pinky:  lms[20].y < lms[18].y,
        };
    }

    /**
     * Classify gesture from landmark data
     */
    _classify(lms, ext, pinchDist) {
        const { thumb, index, middle, ring, pinky } = ext;
        const allCurled = !index && !middle && !ring && !pinky;
        const allExtended = index && middle && ring && pinky;

        // FIST: all fingers curled
        if (allCurled && !thumb) return 'FIST';

        // OPEN PALM: all extended
        if (allExtended && thumb) return 'OPEN_PALM';

        // PINCH (ongoing): check distance
        if (pinchDist < this.PINCH_THRESHOLD) return 'PINCH';

        // POINT: only index extended
        if (index && !middle && !ring && !pinky) return 'POINT';

        // TWO_FINGERS: index + middle extended, others curled
        if (index && middle && !ring && !pinky) return 'TWO_FINGERS';

        // THREE_FINGERS
        if (index && middle && ring && !pinky) return 'THREE_FINGERS';

        return 'NONE';
    }

    /**
     * Detect swipe gestures from wrist velocity
     */
    _detectSwipe() {
        if (this.wristHistory.length < 5) return;

        const now = Date.now();
        // Take points within the swipe window
        const recentPoints = this.wristHistory.filter(p => now - p.time < this.SWIPE_WINDOW_MS);
        if (recentPoints.length < 4) return;

        const first = recentPoints[0];
        const last = recentPoints[recentPoints.length - 1];
        const dt = last.time - first.time;
        if (dt < 50) return;

        const dx = last.x - first.x;
        const dy = last.y - first.y;
        const vx = dx / dt;
        const vy = dy / dt;

        const THRESH = this.SWIPE_VELOCITY;

        if (Math.abs(vx) > THRESH && Math.abs(vx) > Math.abs(vy) * 1.5) {
            if (vx < 0) {
                // x decreases → hand moving LEFT in normalized space (mirrored = right on screen)
                this._emit('SWIPE_RIGHT', {});
            } else {
                this._emit('SWIPE_LEFT', {});
            }
            // Clear history after swipe to prevent double-fire
            this.wristHistory = [];
        } else if (Math.abs(vy) > THRESH && Math.abs(vy) > Math.abs(vx) * 1.5) {
            if (vy < 0) {
                this._emit('SWIPE_UP', {});
            } else {
                this._emit('SWIPE_DOWN', {});
            }
            this.wristHistory = [];
        }
    }

    /**
     * Compute palm normal orientation for 3D object rotation.
     * Uses wrist (0), index MCP (5), pinky MCP (17) to form palm plane.
     */
    _computePalmRotation(lms) {
        const wrist = lms[0];
        const indexMCP = lms[5];
        const pinkyMCP = lms[17];
        const middleTip = lms[12];

        // Approximate palm forward tilt from wrist-to-middle-tip delta
        const tiltX = (middleTip.y - wrist.y);  // -1..1 range roughly
        const tiltY = (middleTip.x - wrist.x);

        // Smooth rotation values
        const alpha = 0.2;
        this.palmRotation.rx = alpha * tiltX * Math.PI + (1 - alpha) * this.palmRotation.rx;
        this.palmRotation.ry = alpha * tiltY * Math.PI + (1 - alpha) * this.palmRotation.ry;
    }

    /**
     * Euclidean distance between two normalized landmarks
     */
    _dist(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = (a.z || 0) - (b.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Get current cursor position
     */
    getCursorPos() {
        return { x: this.cursorX, y: this.cursorY };
    }

    /**
     * Get palm rotation (for 3D object)
     */
    getPalmRotation() {
        return this.palmRotation;
    }
};
