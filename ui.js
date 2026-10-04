/**
 * ui.js
 * Manages:
 * - Holographic panel visibility & switching
 * - Panel drag-and-drop via pinch gesture
 * - JARVIS-style notifications
 * - HUD data updates (fake sensor data with smooth fluctuation)
 * - Canvas-based analytics, map, and network visualizations
 * - Camera feed miniature
 */

window.UIManager = class UIManager {
    constructor() {
        this.panels = {};            // id → element
        this.panelOrder = ['system', 'camera', 'analytics', 'map', 'files', 'network', 'control'];
        this.currentPanelIndex = 0;
        this.currentPanel = 'system';

        // Panel dragging
        this.draggedPanel = null;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.prevCursorX = 0;
        this.prevCursorY = 0;
        this.isDragging = false;

        // Fake system metrics (for HUD animation)
        this.metrics = {
            cpuA: 72, cpuB: 45, mem: 63, gpu: 88, net: 31
        };

        // Analytics data history
        this.analyticsData = {
            track: Array(60).fill(0),
            gesture: Array(60).fill(0),
            load:    Array(60).fill(50)
        };

        // Map state
        this.mapAngle = 0;
        this.mapPings = [];

        // Network chart state
        this.netData = { up: Array(40).fill(0), down: Array(40).fill(0) };

        // Notification queue
        this.notifQueue = [];
        this.notifActive = 0;

        // DOM refs
        this.notifContainer = null;
        this.cursor = null;
        this.guideEl = null;

        // Canvases
        this.camCanvas = null;
        this.analyticsCanvas = null;
        this.mapCanvas = null;
        this.netCanvas = null;

        // FPS tracking
        this.frameCount = 0;
        this.fpsLastTime = performance.now();
        this.currentFPS = 60;

        // Flag: is interface active (after open palm)
        this.interfaceActive = false;
    }

    init() {
        // Collect panel elements
        document.querySelectorAll('.holo-panel').forEach(el => {
            this.panels[el.dataset.panel] = el;
        });

        // Cursor
        this.cursor = document.getElementById('holo-cursor');
        this.notifContainer = document.getElementById('notifications-container');
        this.guideEl = document.getElementById('gesture-guide');

        // Nav dot click (mouse fallback)
        document.querySelectorAll('.nav-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                this.showPanel(dot.dataset.panel);
            });
        });

        // Guide close button
        const guideClose = document.getElementById('guide-close');
        if (guideClose) guideClose.addEventListener('click', () => this.hideGuide());

        // Panel close buttons
        document.querySelectorAll('.ph-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const panel = e.target.closest('.holo-panel');
                if (panel) this.closePanel(panel.dataset.panel);
            });
        });

        // Canvas refs
        this.camCanvas      = document.getElementById('camera-feed-canvas');
        this.analyticsCanvas = document.getElementById('analytics-canvas');
        this.mapCanvas      = document.getElementById('map-canvas');
        this.netCanvas      = document.getElementById('network-canvas');

        // Start canvas animations
        this._startCanvasAnimations();

        // Initial state: show first panel
        this.showPanel('system');

        // Show gesture guide after 2s
        setTimeout(() => this._showGuide(), 2000);

        console.log('[UIManager] Initialized');
    }

    /**
     * Show a panel by name, hide others
     */
    showPanel(name) {
        Object.values(this.panels).forEach(p => {
            p.classList.remove('visible');
        });

        const panel = this.panels[name];
        if (panel) {
            panel.classList.add('visible');
            this.currentPanel = name;
            this.currentPanelIndex = this.panelOrder.indexOf(name);
        }

        // Update nav dots
        document.querySelectorAll('.nav-dot').forEach(d => {
            d.classList.toggle('active', d.dataset.panel === name);
        });
    }

    /**
     * Close a specific panel
     */
    closePanel(name) {
        const panel = this.panels[name];
        if (panel) panel.classList.remove('visible');
        this.notify('PANEL CLOSED');
    }

    /**
     * Switch to next/previous panel
     */
    switchPanel(direction) {
        const len = this.panelOrder.length;
        this.currentPanelIndex = (this.currentPanelIndex + direction + len) % len;
        const name = this.panelOrder[this.currentPanelIndex];
        this.showPanel(name);
        this.notify('PANEL: ' + name.toUpperCase());
    }

    /**
     * Activate interface (open palm)
     */
    activateInterface() {
        this.interfaceActive = true;
        this.showPanel(this.panelOrder[this.currentPanelIndex]);
        this.notify('INTERFACE ACTIVE');
    }

    /**
     * Deactivate (fist)
     */
    deactivateInterface() {
        this.interfaceActive = false;
        Object.values(this.panels).forEach(p => p.classList.remove('visible'));
        this.notify('INTERFACE STANDBY');
    }

    /**
     * Show cursor at given screen position
     */
    updateCursor(x, y, gesture, isPinching) {
        if (!this.cursor) return;

        if (x === null) {
            this.cursor.classList.remove('visible');
            return;
        }

        this.cursor.classList.add('visible');
        this.cursor.style.left = x + 'px';
        this.cursor.style.top  = y + 'px';

        this.cursor.classList.toggle('pinching', isPinching);
    }

    /**
     * Start a panel drag (called on PINCH_START near panel)
     */
    startPanelDrag(panelName, cursorX, cursorY) {
        const panel = this.panels[panelName];
        if (!panel) return;

        const rect = panel.getBoundingClientRect();
        this.draggedPanel = panel;
        this.dragOffsetX = cursorX - rect.left;
        this.dragOffsetY = cursorY - rect.top;
        this.prevCursorX = cursorX;
        this.prevCursorY = cursorY;
        this.isDragging = true;
        panel.classList.add('grabbed');
        panel.style.transition = 'none';
    }

    /**
     * Update drag position
     */
    updatePanelDrag(cursorX, cursorY) {
        if (!this.draggedPanel || !this.isDragging) return;

        const x = cursorX - this.dragOffsetX;
        const y = cursorY - this.dragOffsetY;

        // Clamp to viewport
        const w = this.draggedPanel.offsetWidth;
        const h = this.draggedPanel.offsetHeight;
        const clampedX = Math.max(0, Math.min(window.innerWidth - w, x));
        const clampedY = Math.max(0, Math.min(window.innerHeight - h, y));

        this.draggedPanel.style.left = clampedX + 'px';
        this.draggedPanel.style.top  = clampedY + 'px';
        this.draggedPanel.style.right  = 'auto';
        this.draggedPanel.style.bottom = 'auto';

        this.prevCursorX = cursorX;
        this.prevCursorY = cursorY;
    }

    /**
     * End panel drag
     */
    endPanelDrag() {
        if (this.draggedPanel) {
            this.draggedPanel.classList.remove('grabbed');
            this.draggedPanel.style.transition = '';
        }
        this.draggedPanel = null;
        this.isDragging = false;
    }

    /**
     * Find which panel the cursor is hovering over (for pinch grab)
     * @returns {string|null} panel name
     */
    getPanelAtPosition(x, y) {
        const names = Object.keys(this.panels);
        for (const name of names) {
            const panel = this.panels[name];
            if (!panel.classList.contains('visible')) continue;
            const rect = panel.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return name;
            }
        }
        return null;
    }

    /**
     * Show a JARVIS notification
     */
    notify(text) {
        const el = document.createElement('div');
        el.className = 'notification';
        el.textContent = text;
        this.notifContainer.appendChild(el);
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2800);
    }

    /**
     * Update the HUD data displays
     */
    updateHUD(data) {
        // FPS
        this.frameCount++;
        const now = performance.now();
        if (now - this.fpsLastTime >= 1000) {
            this.currentFPS = Math.round(this.frameCount * 1000 / (now - this.fpsLastTime));
            this.frameCount = 0;
            this.fpsLastTime = now;
        }
        const fpsEl = document.getElementById('fps-display');
        if (fpsEl) fpsEl.textContent = this.currentFPS;

        // Gesture
        const gestEl = document.getElementById('gesture-display');
        if (gestEl && data.gesture) gestEl.textContent = data.gesture;

        // Tracking status
        const trackEl = document.getElementById('tracking-status');
        if (trackEl) trackEl.textContent = data.isTracking ? 'ACTIVE' : 'SCANNING';

        // Confidence
        const confEl = document.getElementById('confidence-display');
        if (confEl) confEl.textContent = data.confidence ? Math.round(data.confidence * 100) + '%' : '--%';

        // Landmarks
        const lmEl = document.getElementById('landmark-count');
        if (lmEl) lmEl.textContent = data.isTracking ? '21/21' : '0/21';

        // Cursor position
        const cxEl = document.getElementById('cursor-x');
        const cyEl = document.getElementById('cursor-y');
        if (cxEl && data.cursorX !== undefined) cxEl.textContent = Math.round(data.cursorX);
        if (cyEl && data.cursorY !== undefined) cyEl.textContent = Math.round(data.cursorY);

        // Time
        const now2 = new Date();
        const timeEl = document.getElementById('time-display');
        const dateEl = document.getElementById('date-display');
        if (timeEl) timeEl.textContent = now2.toTimeString().slice(0,8);
        if (dateEl) dateEl.textContent = now2.toLocaleDateString();

        // Metrics fluctuation (fake system data)
        this._fluctuateMetrics(data.isTracking);

        // Camera panel stats
        const lmPanel = document.getElementById('lm-count-panel');
        if (lmPanel) lmPanel.textContent = data.isTracking ? '21/21' : '0/21';
        const confPanel = document.getElementById('conf-panel');
        if (confPanel) confPanel.textContent = data.confidence ? data.confidence.toFixed(2) : '0.00';

        // Analytics data
        this.analyticsData.track.push(data.isTracking ? 80 + Math.random() * 20 : Math.random() * 20);
        this.analyticsData.track.shift();
        this.analyticsData.gesture.push(data.gesture !== 'NONE' ? 60 + Math.random() * 40 : Math.random() * 20);
        this.analyticsData.gesture.shift();
        this.analyticsData.load.push(40 + Math.sin(Date.now() * 0.001) * 20 + Math.random() * 15);
        this.analyticsData.load.shift();

        // Network data
        this.netData.up.push(20 + Math.sin(Date.now() * 0.002) * 15 + Math.random() * 20);
        this.netData.up.shift();
        this.netData.down.push(40 + Math.cos(Date.now() * 0.0015) * 20 + Math.random() * 25);
        this.netData.down.shift();
    }

    _fluctuateMetrics(isTracking) {
        const walk = (val, min, max, step) => {
            const v = val + (Math.random() - 0.5) * step;
            return Math.max(min, Math.min(max, v));
        };

        this.metrics.cpuA = walk(this.metrics.cpuA, 20, 95, 3);
        this.metrics.cpuB = walk(this.metrics.cpuB, 15, 90, 4);
        this.metrics.mem  = walk(this.metrics.mem,  40, 85, 2);
        this.metrics.gpu  = walk(this.metrics.gpu, isTracking ? 60 : 30, 98, 3);
        this.metrics.net  = walk(this.metrics.net,  5, 70, 5);

        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.style.width = val + '%';
        };
        const setTxt = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = Math.round(val) + '%';
        };

        set('pf-cpuA', this.metrics.cpuA); setTxt('pv-cpuA', this.metrics.cpuA);
        set('pf-cpuB', this.metrics.cpuB); setTxt('pv-cpuB', this.metrics.cpuB);
        set('pf-mem',  this.metrics.mem);  setTxt('pv-mem',  this.metrics.mem);
        set('pf-gpu',  this.metrics.gpu);  setTxt('pv-gpu',  this.metrics.gpu);
        set('pf-net',  this.metrics.net);  setTxt('pv-net',  this.metrics.net);

        // Corner HUD bars
        set('cpu-bar', this.metrics.cpuA);  setTxt('cpu-val', this.metrics.cpuA);
        set('mem-bar', this.metrics.mem);   setTxt('mem-val', this.metrics.mem);
        set('gpu-bar', this.metrics.gpu);   setTxt('gpu-val', this.metrics.gpu);
        set('net-bar', this.metrics.net);   setTxt('net-val', this.metrics.net);
    }

    _startCanvasAnimations() {
        const drawAll = () => {
            this._drawAnalytics();
            this._drawMap();
            this._drawNetwork();
            requestAnimationFrame(drawAll);
        };
        requestAnimationFrame(drawAll);
    }

    /**
     * Draw camera feed miniature onto cam-canvas (mirrors webcam)
     */
    drawCameraFeed(videoEl) {
        if (!this.camCanvas || !videoEl || videoEl.readyState < 2) return;
        const ctx = this.camCanvas.getContext('2d');
        const w = this.camCanvas.width;
        const h = this.camCanvas.height;

        ctx.save();
        ctx.scale(-1, 1); // mirror
        ctx.drawImage(videoEl, -w, 0, w, h);
        ctx.restore();

        // Overlay grid
        ctx.strokeStyle = 'rgba(0,212,255,0.12)';
        ctx.lineWidth = 0.5;
        for (let x = 0; x < w; x += 30) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += 30) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // Corner brackets
        const bSize = 12;
        ctx.strokeStyle = 'rgba(0,212,255,0.7)';
        ctx.lineWidth = 1.5;
        [[0,0],[w,0],[0,h],[w,h]].forEach(([cx, cy]) => {
            const sx = cx === 0 ? 1 : -1;
            const sy = cy === 0 ? 1 : -1;
            ctx.beginPath();
            ctx.moveTo(cx + sx * bSize, cy);
            ctx.lineTo(cx, cy);
            ctx.lineTo(cx, cy + sy * bSize);
            ctx.stroke();
        });
    }

    _drawAnalytics() {
        const canvas = this.analyticsCanvas;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;

        ctx.fillStyle = 'rgba(0,6,18,0.95)';
        ctx.fillRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = 'rgba(0,100,150,0.15)';
        ctx.lineWidth = 0.5;
        for (let y = 0; y <= 4; y++) {
            const gy = (y / 4) * h;
            ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
        }

        const drawLine = (data, color, lineW = 1.5) => {
            const step = w / (data.length - 1);
            ctx.beginPath();
            data.forEach((v, i) => {
                const x = i * step;
                const y = h - (v / 100) * h;
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.strokeStyle = color;
            ctx.lineWidth = lineW;
            ctx.shadowBlur = 6;
            ctx.shadowColor = color;
            ctx.stroke();
            ctx.shadowBlur = 0;
        };

        drawLine(this.analyticsData.load,    'rgba(100,150,255,0.6)');
        drawLine(this.analyticsData.gesture,  'rgba(0,150,255,0.7)');
        drawLine(this.analyticsData.track,    'rgba(0,212,255,0.9)', 2);

        // Current value label
        ctx.font = '9px "Share Tech Mono"';
        ctx.fillStyle = 'rgba(0,212,255,0.7)';
        ctx.fillText('TRACK: ' + Math.round(this.analyticsData.track[59]) + '%', 6, 14);
    }

    _drawMap() {
        const canvas = this.mapCanvas;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        const cx = w / 2, cy = h / 2;

        ctx.fillStyle = 'rgba(0,6,18,0.95)';
        ctx.fillRect(0, 0, w, h);

        // Radar circles
        for (let r = 1; r <= 5; r++) {
            ctx.beginPath();
            ctx.arc(cx, cy, (r / 5) * (Math.min(w, h) / 2 - 8), 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0,180,255,${0.08 + (5 - r) * 0.02})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }

        // Radar cross
        ctx.strokeStyle = 'rgba(0,150,200,0.15)';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();

        // Rotating sweep
        this.mapAngle = (this.mapAngle + 0.018) % (Math.PI * 2);
        const sweepLen = Math.min(w, h) / 2 - 8;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.mapAngle);

        // Sweep cone (fan shape)
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, sweepLen, -0.2, 0.2);
        ctx.closePath();
        const fanGrad = ctx.createLinearGradient(0, 0, sweepLen, 0);
        fanGrad.addColorStop(0, 'rgba(0,212,255,0.0)');
        fanGrad.addColorStop(0.7, 'rgba(0,212,255,0.08)');
        fanGrad.addColorStop(1, 'rgba(0,212,255,0.25)');
        ctx.fillStyle = fanGrad;
        ctx.fill();

        // Sweep line
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(sweepLen, 0);
        ctx.strokeStyle = 'rgba(0,212,255,0.85)';
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 6;
        ctx.shadowColor = 'rgba(0,212,255,0.8)';
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();

        // Random ping dots
        if (Math.random() < 0.02) {
            const angle = Math.random() * Math.PI * 2;
            const dist = (0.2 + Math.random() * 0.75) * sweepLen;
            this.mapPings.push({
                x: cx + Math.cos(angle) * dist,
                y: cy + Math.sin(angle) * dist,
                life: 1.0
            });
        }

        this.mapPings = this.mapPings.filter(p => p.life > 0);
        this.mapPings.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0,255,200,${p.life})`;
            ctx.shadowBlur = 8;
            ctx.shadowColor = 'rgba(0,255,200,0.8)';
            ctx.fill();
            ctx.shadowBlur = 0;
            p.life -= 0.012;
        });

        // Center dot
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,212,255,0.9)';
        ctx.shadowBlur = 12;
        ctx.shadowColor = 'rgba(0,212,255,1)';
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    _drawNetwork() {
        const canvas = this.netCanvas;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;

        ctx.fillStyle = 'rgba(0,6,18,0.95)';
        ctx.fillRect(0, 0, w, h);

        // Grid
        ctx.strokeStyle = 'rgba(0,100,150,0.12)';
        ctx.lineWidth = 0.5;
        for (let y = 0; y <= 3; y++) {
            const gy = (y / 3) * h;
            ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
        }

        const drawBar = (data, color, yOffset, barH) => {
            const step = w / data.length;
            data.forEach((v, i) => {
                const bh = (v / 100) * barH;
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.7;
                ctx.fillRect(i * step, yOffset - bh, step - 1, bh);
                ctx.globalAlpha = 1;
            });
        };

        // Draw upload bars (top half)
        drawBar(this.netData.up,   'rgba(0,212,255,0.5)',  h / 2,     h / 2 - 4);
        drawBar(this.netData.down, 'rgba(0,100,255,0.4)',  h,         h / 2 - 4);

        // Labels
        ctx.font = '8px "Share Tech Mono"';
        ctx.fillStyle = 'rgba(0,212,255,0.6)';
        ctx.fillText('↑ UPLOAD', 4, 12);
        ctx.fillStyle = 'rgba(0,100,255,0.8)';
        ctx.fillText('↓ DOWNLOAD', 4, h / 2 + 12);

        // Divider line
        ctx.strokeStyle = 'rgba(0,200,255,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    }

    _showGuide() {
        if (this.guideEl) this.guideEl.classList.remove('hidden-guide');
    }

    hideGuide() {
        if (this.guideEl) this.guideEl.classList.add('hidden-guide');
    }
};
