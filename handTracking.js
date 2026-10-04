/**
 * handTracking.js
 * Handles MediaPipe Hands initialization, webcam capture,
 * and exposing hand landmark data to the rest of the app.
 */

window.HandTracker = class HandTracker {
    constructor() {
        this.landmarks = null;         // Current frame normalized landmarks [0-1]
        this.worldLandmarks = null;    // 3D world landmarks (meters)
        this.handedness = null;        // 'Left' | 'Right'
        this.confidence = 0;
        this.isTracking = false;
        this.videoElement = null;
        this.mpHands = null;
        this.mpCamera = null;
        this.onResultsCallback = null;

        // Smoothing buffer for landmarks
        this.smoothedLandmarks = null;
        this.SMOOTH_ALPHA = 0.6; // EMA smoothing factor (higher = more responsive, less smooth)
    }

    /**
     * Initialize MediaPipe Hands and attach to video element.
     * @param {HTMLVideoElement} videoEl
     * @param {function} onReady - Called when camera is ready
     */
    async init(videoEl, onReady) {
        this.videoElement = videoEl;

        // Create MediaPipe Hands instance
        this.mpHands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`;
            }
        });

        this.mpHands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,           // 0=lite, 1=full
            minDetectionConfidence: 0.65,
            minTrackingConfidence: 0.55
        });

        this.mpHands.onResults((results) => this._onResults(results));

        // Request webcam
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' },
                audio: false
            });
        } catch (err) {
            console.error('[HandTracker] Camera error:', err);
            throw new Error('Camera access denied or not available');
        }

        videoEl.srcObject = stream;
        await new Promise(resolve => { videoEl.onloadedmetadata = () => resolve(); });
        await videoEl.play();

        // Use MediaPipe Camera utility for frame processing
        this.mpCamera = new Camera(videoEl, {
            onFrame: async () => {
                if (this.mpHands) {
                    await this.mpHands.send({ image: videoEl });
                }
            },
            width: 640,
            height: 480
        });

        this.mpCamera.start().then(() => {
            console.log('[HandTracker] Camera started');
            if (onReady) onReady();
        });
    }

    /**
     * Internal MediaPipe results handler
     */
    _onResults(results) {
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const rawLandmarks = results.multiHandLandmarks[0];
            const rawWorld = results.multiHandWorldLandmarks ? results.multiHandWorldLandmarks[0] : null;
            const hand = results.multiHandedness ? results.multiHandedness[0] : null;

            this.confidence = hand ? hand.score : 1.0;
            this.handedness = hand ? hand.label : 'Right';
            this.worldLandmarks = rawWorld || null;

            // Apply exponential moving average smoothing
            if (!this.smoothedLandmarks) {
                // First frame — initialize with raw values
                this.smoothedLandmarks = rawLandmarks.map(lm => ({ x: lm.x, y: lm.y, z: lm.z }));
            } else {
                const alpha = this.SMOOTH_ALPHA;
                this.smoothedLandmarks = rawLandmarks.map((lm, i) => ({
                    x: alpha * lm.x + (1 - alpha) * this.smoothedLandmarks[i].x,
                    y: alpha * lm.y + (1 - alpha) * this.smoothedLandmarks[i].y,
                    z: alpha * lm.z + (1 - alpha) * this.smoothedLandmarks[i].z,
                }));
            }

            this.landmarks = this.smoothedLandmarks;
            this.isTracking = true;
        } else {
            // No hand detected — gradually fade smoothed landmarks
            this.landmarks = null;
            this.isTracking = false;
            this.confidence = 0;
            // Don't reset smoothedLandmarks to avoid jump when hand reappears
        }

        // Fire callback
        if (this.onResultsCallback) {
            this.onResultsCallback(this.landmarks, this.confidence, this.handedness);
        }
    }

    /**
     * Convert normalized landmark to screen pixel coordinates.
     * Note: x is flipped because we mirror the video.
     * @param {object} lm - { x, y, z } normalized [0..1]
     * @param {number} screenW
     * @param {number} screenH
     * @returns {{ x, y }}
     */
    landmarkToScreen(lm, screenW, screenH) {
        return {
            x: (1 - lm.x) * screenW,  // mirror x
            y: lm.y * screenH
        };
    }

    /**
     * Get the index fingertip position in screen coords.
     * Landmark index 8 = index fingertip.
     */
    getIndexTipScreen(screenW, screenH) {
        if (!this.landmarks) return null;
        return this.landmarkToScreen(this.landmarks[8], screenW, screenH);
    }

    /**
     * Draw the hand skeleton overlay on a 2D canvas.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} w - canvas width
     * @param {number} h - canvas height
     */
    drawHandOverlay(ctx, w, h) {
        if (!this.landmarks) return;

        const lms = this.landmarks;
        const toS = (lm) => this.landmarkToScreen(lm, w, h);

        // Connections: [start, end] landmark index pairs
        const CONNECTIONS = [
            // Wrist to palm
            [0, 1], [0, 5], [0, 9], [0, 13], [0, 17],
            // Thumb
            [1, 2], [2, 3], [3, 4],
            // Index
            [5, 6], [6, 7], [7, 8],
            // Middle
            [9, 10], [10, 11], [11, 12],
            // Ring
            [13, 14], [14, 15], [15, 16],
            // Pinky
            [17, 18], [18, 19], [19, 20],
            // Palm knuckles
            [5, 9], [9, 13], [13, 17]
        ];

        ctx.save();

        // Draw bones
        CONNECTIONS.forEach(([a, b]) => {
            const pA = toS(lms[a]);
            const pB = toS(lms[b]);

            ctx.beginPath();
            ctx.moveTo(pA.x, pA.y);
            ctx.lineTo(pB.x, pB.y);
            ctx.strokeStyle = 'rgba(0, 200, 255, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });

        // Draw joints (small circles)
        lms.forEach((lm, i) => {
            const p = toS(lm);
            const isTip = [4, 8, 12, 16, 20].includes(i);
            const isWrist = i === 0;

            ctx.beginPath();
            ctx.arc(p.x, p.y, isTip ? 5 : isWrist ? 6 : 3, 0, Math.PI * 2);

            if (isTip) {
                // Fingertip glow
                ctx.fillStyle = 'rgba(0, 230, 255, 0.9)';
                ctx.shadowBlur = 12;
                ctx.shadowColor = 'rgba(0, 212, 255, 1)';
            } else if (isWrist) {
                ctx.fillStyle = 'rgba(0, 100, 255, 0.7)';
                ctx.shadowBlur = 8;
                ctx.shadowColor = 'rgba(0, 100, 255, 1)';
            } else {
                ctx.fillStyle = 'rgba(0, 180, 255, 0.55)';
                ctx.shadowBlur = 0;
            }
            ctx.fill();
            ctx.shadowBlur = 0;
        });

        // Highlight index tip (landmark 8) with larger glow ring
        const indexTip = toS(lms[8]);
        ctx.beginPath();
        ctx.arc(indexTip.x, indexTip.y, 10, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 230, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
    }

    /**
     * Stop camera and MediaPipe
     */
    destroy() {
        if (this.mpCamera) this.mpCamera.stop();
        if (this.videoElement && this.videoElement.srcObject) {
            this.videoElement.srcObject.getTracks().forEach(t => t.stop());
        }
    }
};
