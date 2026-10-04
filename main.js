/**
 * main.js
 * Central application controller.
 * Orchestrates HandTracker, GestureDetector, HologramScene, and UIManager.
 * Manages the main animation loop, cursor trail, and loading screen.
 */

(function () {
    'use strict';

    // ── Globals ──────────────────────────────────────────────────
    let handTracker    = null;
    let gestureDetect  = null;
    let hologramScene  = null;
    let uiManager      = null;

    let overlayCanvas  = null;
    let overlayCtx     = null;

    // Cursor trail: stores last N positions for motion trail
    const TRAIL_LENGTH = 22;
    let cursorTrail    = [];

    // Loading state
    let loadingBar     = null;
    let loadingStatus  = null;
    let loadingPct     = 0;

    // Loading canvas (particle bg on loading screen)
    let loadingCanvas  = null;
    let loadingCanvasCtx = null;
    let loadingParticles = [];

    // Pinch panel drag state
    let pinnedPanel    = null;
    let wasPinching    = false;

    // Previous gesture for change detection
    let prevGesture    = 'NONE';

    // ── Entry point ───────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        loadingBar    = document.getElementById('loading-bar');
        loadingStatus = document.getElementById('loading-status');

        // Initialize loading screen particle background
        loadingCanvas = document.getElementById('loading-canvas');
        if (loadingCanvas) {
            loadingCanvas.width  = window.innerWidth;
            loadingCanvas.height = window.innerHeight;
            loadingCanvasCtx = loadingCanvas.getContext('2d');
            _initLoadingParticles();
            _animateLoadingParticles();
        }

        // Simulate loading progress
        _simulateLoading([
            [200,  'LOADING CORE MODULES...', 15],
            [600,  'INITIALIZING THREE.JS RENDERER...', 35],
            [1000, 'LOADING MEDIAPIPE HANDS...', 55],
            [1400, 'CALIBRATING GESTURE ENGINE...', 70],
            [1800, 'SETTING UP HOLOGRAPHIC HUD...', 85],
            [2200, 'SYSTEM READY — ALLOW CAMERA ACCESS', 100],
        ]);

        // Wire start button
        document.getElementById('start-btn').addEventListener('click', _startApp);
    });

    // ── Loading sequence ──────────────────────────────────────────
    function _simulateLoading(steps) {
        steps.forEach(([delay, text, pct]) => {
            setTimeout(() => {
                if (loadingStatus) loadingStatus.textContent = text;
                if (loadingBar) loadingBar.style.width = pct + '%';
            }, delay);
        });
    }

    function _initLoadingParticles() {
        for (let i = 0; i < 80; i++) {
            loadingParticles.push({
                x: Math.random() * loadingCanvas.width,
                y: Math.random() * loadingCanvas.height,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                r: Math.random() * 1.5 + 0.5,
                alpha: Math.random() * 0.5 + 0.1,
            });
        }
    }

    function _animateLoadingParticles() {
        if (!loadingCanvasCtx) return;
        const ctx = loadingCanvasCtx;
        const W = loadingCanvas.width, H = loadingCanvas.height;

        ctx.clearRect(0, 0, W, H);

        // Draw subtle grid
        ctx.strokeStyle = 'rgba(0,100,180,0.06)';
        ctx.lineWidth = 0.5;
        for (let x = 0; x < W; x += 50) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = 0; y < H; y += 50) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }

        // Particles
        loadingParticles.forEach(p => {
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
            if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0,180,255,${p.alpha})`;
            ctx.fill();
        });

        // Connect nearby particles
        loadingParticles.forEach((a, i) => {
            loadingParticles.slice(i + 1).forEach(b => {
                const dx = a.x - b.x, dy = a.y - b.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 100) {
                    ctx.strokeStyle = `rgba(0,150,255,${0.05 * (1 - dist / 100)})`;
                    ctx.lineWidth = 0.5;
                    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                }
            });
        });

        const screen = document.getElementById('loading-screen');
        if (screen && !screen.classList.contains('fade-out')) {
            requestAnimationFrame(_animateLoadingParticles);
        }
    }

    // ── App initialization ────────────────────────────────────────
    async function _startApp() {
        const startBtn = document.getElementById('start-btn');
        startBtn.disabled = true;
        startBtn.textContent = 'INITIALIZING...';

        // Transition loading → app
        const loadingScreen = document.getElementById('loading-screen');
        const appEl = document.getElementById('app');

        // 1. Show app (hidden)
        appEl.classList.remove('hidden');

        // 2. Initialize overlay canvas
        overlayCanvas = document.getElementById('overlay-canvas');
        overlayCanvas.width  = window.innerWidth;
        overlayCanvas.height = window.innerHeight;
        overlayCtx = overlayCanvas.getContext('2d');

        // 3. Init Three.js hologram
        hologramScene = new HologramScene(document.getElementById('three-canvas'));
        hologramScene.init();

        // 4. Init UI manager
        uiManager = new UIManager();
        uiManager.init();

        // 5. Init gesture detector
        gestureDetect = new GestureDetector();
        _wireGestureEvents();

        // 6. Init hand tracker
        handTracker = new HandTracker();
        try {
            if (loadingStatus) loadingStatus.textContent = 'REQUESTING CAMERA ACCESS...';
            await handTracker.init(
                document.getElementById('webcam'),
                () => {
                    _showNotif('HAND TRACKING ONLINE');
                    setTimeout(() => _showNotif('SYSTEM READY'), 600);
                    setTimeout(() => _showNotif('SHOW OPEN PALM TO ACTIVATE'), 1400);
                }
            );

            handTracker.onResultsCallback = (landmarks, confidence, handedness) => {
                const W = overlayCanvas.width;
                const H = overlayCanvas.height;

                // Update gestures
                if (gestureDetect) {
                    gestureDetect.update(landmarks, W, H);
                }
            };
        } catch (err) {
            _showNotif('CAMERA ERROR: ' + err.message.toUpperCase());
            console.error(err);
        }

        // 7. Fade out loading screen
        loadingScreen.classList.add('fade-out');
        setTimeout(() => { loadingScreen.style.display = 'none'; }, 900);

        // 8. Start main loop
        _showNotif('INITIALIZING HAND TRACKING...');
        _mainLoop();
    }

    // ── Gesture event wiring ──────────────────────────────────────
    function _wireGestureEvents() {
        gestureDetect.on('OPEN_PALM', () => {
            uiManager.activateInterface();
            hologramScene.flash();
            _showNotif('INTERFACE ACTIVE');
        });

        gestureDetect.on('FIST', () => {
            if (uiManager.interfaceActive) {
                uiManager.deactivateInterface();
                _showNotif('INTERFACE STANDBY');
            }
        });

        gestureDetect.on('SWIPE_LEFT', () => {
            uiManager.switchPanel(1);
        });

        gestureDetect.on('SWIPE_RIGHT', () => {
            uiManager.switchPanel(-1);
        });

        gestureDetect.on('SWIPE_UP', () => {
            // Show next panel
            uiManager.switchPanel(1);
            _showNotif('MENU OPEN');
        });

        gestureDetect.on('SWIPE_DOWN', () => {
            uiManager.closePanel(uiManager.currentPanel);
            _showNotif('PANEL CLOSED');
        });

        gestureDetect.on('TWO_FINGERS', () => {
            _showNotif('MODE CHANGED');
        });

        gestureDetect.on('PINCH_START', (pos) => {
            // Check if cursor is over a panel → start drag
            const panelName = uiManager.getPanelAtPosition(pos.x, pos.y);
            if (panelName) {
                pinnedPanel = panelName;
                uiManager.startPanelDrag(panelName, pos.x, pos.y);
                _showNotif('PANEL GRABBED');
            } else {
                // Grab hologram
                hologramScene.setGrabbed(true);
                _showNotif('OBJECT SELECTED');
            }
        });

        gestureDetect.on('PINCH_END', () => {
            if (pinnedPanel) {
                uiManager.endPanelDrag();
                pinnedPanel = null;
                _showNotif('PANEL RELEASED');
            } else {
                hologramScene.setGrabbed(false);
            }
        });
    }

    // ── Main animation loop ───────────────────────────────────────
    let prevTime = performance.now();
    let prevCursorX = 0, prevCursorY = 0;

    function _mainLoop() {
        requestAnimationFrame(_mainLoop);

        const now = performance.now();
        const dt = now - prevTime;
        prevTime = now;

        const W = overlayCanvas.width;
        const H = overlayCanvas.height;

        // ── Gesture data ──
        const landmarks   = handTracker ? handTracker.landmarks : null;
        const isTracking   = handTracker ? handTracker.isTracking : false;
        const confidence   = handTracker ? handTracker.confidence : 0;
        const gesture      = gestureDetect ? gestureDetect.currentGesture : 'NONE';
        const isPinching   = gestureDetect ? gestureDetect.isPinching : false;
        const palmRotation = gestureDetect ? gestureDetect.getPalmRotation() : { rx: 0, ry: 0 };
        const cursorPos    = gestureDetect ? gestureDetect.getCursorPos() : { x: 0, y: 0 };

        // ── Clear 2D overlay ──
        overlayCtx.clearRect(0, 0, W, H);

        // ── Hand skeleton overlay ──
        if (isTracking && handTracker) {
            handTracker.drawHandOverlay(overlayCtx, W, H);
        }

        // ── Cursor trail ──
        if (isTracking) {
            cursorTrail.push({ x: cursorPos.x, y: cursorPos.y, t: Date.now() });
            if (cursorTrail.length > TRAIL_LENGTH) cursorTrail.shift();
            _drawCursorTrail(overlayCtx);
        } else {
            cursorTrail = [];
        }

        // ── Panel drag update ──
        if (isPinching && pinnedPanel) {
            uiManager.updatePanelDrag(cursorPos.x, cursorPos.y);
        }

        // ── Hologram rotation when grabbed ──
        if (hologramScene.isGrabbed && isTracking) {
            const dx = cursorPos.x - prevCursorX;
            const dy = cursorPos.y - prevCursorY;
            hologramScene.applyManualRotation(dx, dy);
        }
        prevCursorX = cursorPos.x;
        prevCursorY = cursorPos.y;

        // ── Update hologram ──
        hologramScene.update({ gesture, palmRotation, isPinching, cursorX: cursorPos.x, cursorY: cursorPos.y });

        // ── UI cursor ──
        uiManager.updateCursor(
            isTracking ? cursorPos.x : null,
            isTracking ? cursorPos.y : null,
            gesture,
            isPinching
        );

        // ── HUD data update ──
        uiManager.updateHUD({
            gesture,
            isTracking,
            confidence,
            cursorX: cursorPos.x,
            cursorY: cursorPos.y,
        });

        // ── Camera feed miniature ──
        if (handTracker && handTracker.videoElement) {
            uiManager.drawCameraFeed(handTracker.videoElement);
        }

        // ── Gesture change notification ──
        if (gesture !== prevGesture && gesture !== 'NONE') {
            _showNotif('GESTURE: ' + gesture.replace('_', ' '));
            prevGesture = gesture;
        }
        if (gesture === 'NONE') prevGesture = 'NONE';

        // ── Resize overlay canvas if window changed ──
        if (overlayCanvas.width !== window.innerWidth || overlayCanvas.height !== window.innerHeight) {
            overlayCanvas.width  = window.innerWidth;
            overlayCanvas.height = window.innerHeight;
        }
    }

    // ── Cursor trail rendering ────────────────────────────────────
    function _drawCursorTrail(ctx) {
        if (cursorTrail.length < 2) return;

        const now = Date.now();
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let i = 1; i < cursorTrail.length; i++) {
            const a = cursorTrail[i - 1];
            const b = cursorTrail[i];
            const age = (i / cursorTrail.length);         // 0=oldest, 1=newest
            const alpha = age * age * 0.7;                 // quadratic fade
            const width = age * 3.5;

            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(0, 230, 255, ${alpha})`;
            ctx.lineWidth = width;
            ctx.shadowBlur = age * 8;
            ctx.shadowColor = 'rgba(0,212,255,0.6)';
            ctx.stroke();
        }
        ctx.restore();
    }

    // ── Notification helper ───────────────────────────────────────
    function _showNotif(text) {
        if (uiManager) uiManager.notify(text);
    }

    // ── Window resize ─────────────────────────────────────────────
    window.addEventListener('resize', () => {
        if (overlayCanvas) {
            overlayCanvas.width  = window.innerWidth;
            overlayCanvas.height = window.innerHeight;
        }
        if (loadingCanvas) {
            loadingCanvas.width  = window.innerWidth;
            loadingCanvas.height = window.innerHeight;
        }
    });

})();
