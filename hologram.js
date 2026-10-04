/**
 * hologram.js
 * Manages the Three.js 3D holographic scene:
 * - Central rotating wireframe hologram
 * - Concentric animated rings
 * - Floating particles
 * - Digital grid
 * - Scanning beam
 * - Responds to palm rotation for 3D object control
 */

window.HologramScene = class HologramScene {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = null;
        this.time = 0;

        // Main holographic object group
        this.holoGroup = null;
        this.holoObj = null;         // central wireframe
        this.rings = [];             // TorusGeometry rings
        this.particles = null;       // Points system
        this.scanBeam = null;        // scanning plane
        this.gridHelper = null;

        // Interaction state
        this.isGrabbed = false;
        this.grabOffset = { x: 0, y: 0 };
        this.targetRotX = 0;
        this.targetRotY = 0;
        this.baseRotX = 0;
        this.baseRotY = 0;

        // Auto-rotation speed
        this.autoRotY = 0.004;
        this.autoRotX = 0.001;

        this.animFrame = null;
    }

    /**
     * Initialize Three.js scene
     */
    init() {
        const W = window.innerWidth;
        const H = window.innerHeight;

        // ── Renderer ──
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            alpha: true,             // transparent background
            antialias: true
        });
        this.renderer.setSize(W, H);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0); // transparent

        // ── Scene ──
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000c1a, 0.04);

        // ── Camera ──
        this.camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
        this.camera.position.set(0, 1.5, 7);
        this.camera.lookAt(0, 0, 0);

        // ── Clock ──
        this.clock = new THREE.Clock();

        // ── Lighting ──
        this._createLights();

        // ── Objects ──
        this._createGrid();
        this._createCentralHologram();
        this._createRings();
        this._createParticles();
        this._createScanBeam();
        this._createDataStreams();

        // ── Resize handler ──
        window.addEventListener('resize', () => this._onResize());

        console.log('[HologramScene] Initialized');
    }

    _createLights() {
        // Dim ambient
        const ambient = new THREE.AmbientLight(0x001133, 1.0);
        this.scene.add(ambient);

        // Cyan point light (main)
        const point1 = new THREE.PointLight(0x00d4ff, 1.5, 20);
        point1.position.set(0, 5, 2);
        this.scene.add(point1);
        this.light1 = point1;

        // Blue fill light
        const point2 = new THREE.PointLight(0x0044aa, 1.0, 15);
        point2.position.set(-4, 2, -4);
        this.scene.add(point2);

        // Subtle white rim
        const point3 = new THREE.PointLight(0xaaddff, 0.3, 10);
        point3.position.set(4, -2, 4);
        this.scene.add(point3);
    }

    _createGrid() {
        // Floor grid
        const gridGeo = new THREE.PlaneGeometry(40, 40, 40, 40);
        const gridMat = new THREE.MeshBasicMaterial({
            color: 0x002244,
            wireframe: true,
            transparent: true,
            opacity: 0.12
        });
        const grid = new THREE.Mesh(gridGeo, gridMat);
        grid.rotation.x = -Math.PI / 2;
        grid.position.y = -3.5;
        this.scene.add(grid);
        this.gridHelper = grid;

        // Circular grid overlay
        const circGeo = new THREE.CircleGeometry(8, 64);
        const circEdges = new THREE.EdgesGeometry(circGeo);
        const circMat = new THREE.LineBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.08 });
        const circLine = new THREE.LineSegments(circEdges, circMat);
        circLine.rotation.x = -Math.PI / 2;
        circLine.position.y = -3.5;
        this.scene.add(circLine);
    }

    _createCentralHologram() {
        this.holoGroup = new THREE.Group();
        this.scene.add(this.holoGroup);

        // ── Central icosahedron wireframe ──
        const icoGeo = new THREE.IcosahedronGeometry(1.3, 1);
        const icoEdges = new THREE.EdgesGeometry(icoGeo);
        const icoMat = new THREE.LineBasicMaterial({
            color: 0x00d4ff,
            transparent: true,
            opacity: 0.85
        });
        const ico = new THREE.LineSegments(icoEdges, icoMat);
        this.holoGroup.add(ico);
        this.holoObj = ico;

        // ── Inner octahedron (rotating opposite direction) ──
        const octGeo = new THREE.OctahedronGeometry(0.7, 0);
        const octEdges = new THREE.EdgesGeometry(octGeo);
        const octMat = new THREE.LineBasicMaterial({ color: 0x4499ff, transparent: true, opacity: 0.6 });
        const oct = new THREE.LineSegments(octEdges, octMat);
        oct.userData.innerRotSpeed = -0.012;
        this.holoGroup.add(oct);
        this.innerObj = oct;

        // ── Outer dodecahedron shell ──
        const dodGeo = new THREE.DodecahedronGeometry(1.9, 0);
        const dodEdges = new THREE.EdgesGeometry(dodGeo);
        const dodMat = new THREE.LineBasicMaterial({ color: 0x003366, transparent: true, opacity: 0.25 });
        const dod = new THREE.LineSegments(dodEdges, dodMat);
        dod.userData.outerRotSpeed = 0.005;
        this.holoGroup.add(dod);
        this.outerObj = dod;

        // ── Glowing core sphere ──
        const coreGeo = new THREE.SphereGeometry(0.25, 16, 16);
        const coreMat = new THREE.MeshBasicMaterial({
            color: 0x00d4ff,
            transparent: true,
            opacity: 0.7
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        this.holoGroup.add(core);
        this.coreObj = core;
    }

    _createRings() {
        const ringConfigs = [
            { radius: 2.6, tube: 0.012, color: 0x00d4ff, opacity: 0.6, rotX: 0.2,  rotZ: 0.1,  speed: 0.006 },
            { radius: 3.2, tube: 0.01,  color: 0x0088cc, opacity: 0.4, rotX: -0.5, rotZ: 0.3,  speed: -0.004 },
            { radius: 4.0, tube: 0.008, color: 0x0044aa, opacity: 0.25, rotX: 1.2, rotZ: -0.6, speed: 0.003 },
            { radius: 1.7, tube: 0.015, color: 0x00eeff, opacity: 0.45, rotX: 1.57, rotZ: 0,   speed: -0.008 },
        ];

        ringConfigs.forEach((cfg, i) => {
            const geo = new THREE.TorusGeometry(cfg.radius, cfg.tube, 8, 80);
            const mat = new THREE.MeshBasicMaterial({
                color: cfg.color,
                transparent: true,
                opacity: cfg.opacity
            });
            const ring = new THREE.Mesh(geo, mat);
            ring.rotation.x = cfg.rotX;
            ring.rotation.z = cfg.rotZ;
            ring.userData.rotSpeed = cfg.speed;
            ring.userData.baseRotX = cfg.rotX;
            this.scene.add(ring);
            this.rings.push(ring);
        });
    }

    _createParticles() {
        const count = 700;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const speeds = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            // Random spherical distribution
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = 3 + Math.random() * 12;

            positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            // Cyan-to-blue color variation
            const t = Math.random();
            colors[i * 3]     = t * 0.0 + (1 - t) * 0.0;       // R
            colors[i * 3 + 1] = t * 0.83 + (1 - t) * 0.27;     // G
            colors[i * 3 + 2] = t * 1.0 + (1 - t) * 0.67;      // B

            speeds[i] = 0.001 + Math.random() * 0.003;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));

        const mat = new THREE.PointsMaterial({
            size: 0.05,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            sizeAttenuation: true
        });

        this.particles = new THREE.Points(geo, mat);
        this.scene.add(this.particles);
        this.particleSpeeds = speeds;
    }

    _createScanBeam() {
        // Horizontal scanning plane that sweeps up and down
        const geo = new THREE.PlaneGeometry(20, 0.04);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x00d4ff,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide
        });
        const beam = new THREE.Mesh(geo, mat);
        beam.rotation.x = -Math.PI / 2;
        beam.position.y = -3;
        this.scanBeam = beam;
        this.scene.add(beam);
    }

    _createDataStreams() {
        // Vertical data stream lines
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const r = 5 + Math.random() * 2;

            const points = [];
            for (let j = 0; j < 20; j++) {
                points.push(new THREE.Vector3(
                    Math.cos(angle) * r,
                    -4 + j * 0.5,
                    Math.sin(angle) * r
                ));
            }

            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const mat = new THREE.LineBasicMaterial({
                color: 0x004466,
                transparent: true,
                opacity: 0.3
            });
            const line = new THREE.Line(geo, mat);
            line.userData.streamOffset = Math.random() * Math.PI * 2;
            line.userData.streamSpeed = 0.5 + Math.random() * 1.0;
            this.scene.add(line);
        }
    }

    /**
     * Update scene each frame.
     * @param {object} gestureData - { gesture, palmRotation, isPinching, cursorX, cursorY }
     */
    update(gestureData) {
        const dt = this.clock.getDelta();
        this.time += dt;

        const t = this.time;
        const { gesture, palmRotation, isPinching } = gestureData || {};

        // ── Animate main hologram group ──
        if (!this.isGrabbed) {
            this.holoGroup.rotation.y += this.autoRotY;
            this.holoGroup.rotation.x += this.autoRotX;
        }

        // Subtle hover bounce
        this.holoGroup.position.y = Math.sin(t * 0.8) * 0.12;

        // Inner object counter-rotation
        if (this.innerObj) {
            this.innerObj.rotation.y += this.innerObj.userData.innerRotSpeed;
            this.innerObj.rotation.x += 0.006;
        }

        // Outer shell slow rotation
        if (this.outerObj) {
            this.outerObj.rotation.y += this.outerObj.userData.outerRotSpeed;
        }

        // Pulse the core
        if (this.coreObj) {
            const pulse = 0.8 + 0.3 * Math.sin(t * 3.0);
            this.coreObj.scale.setScalar(pulse);
            this.coreObj.material.opacity = 0.5 + 0.3 * Math.sin(t * 3.0);
        }

        // ── Palm rotation drives hologram ──
        if (palmRotation && !isPinching) {
            // Smooth approach toward palm-driven rotation
            this.targetRotX = palmRotation.rx * 0.6;
            this.targetRotY = palmRotation.ry * 0.6;
            const alpha = 0.04;
            this.holoGroup.rotation.x += (this.targetRotX - this.holoGroup.rotation.x) * alpha;
            this.holoGroup.rotation.y += (this.targetRotY - this.holoGroup.rotation.y) * alpha + this.autoRotY;
        }

        // ── Animate rings ──
        this.rings.forEach((ring, i) => {
            ring.rotation.y += ring.userData.rotSpeed;
            ring.rotation.x = ring.userData.baseRotX + Math.sin(t * 0.4 + i) * 0.05;
            // Flicker opacity slightly
            ring.material.opacity = ring.material.opacity * 0.98 + (Math.random() * 0.05) * 0.02;
        });

        // ── Animate particles ──
        if (this.particles) {
            const posArr = this.particles.geometry.attributes.position.array;
            const count = posArr.length / 3;
            for (let i = 0; i < count; i++) {
                // Drift upward slowly, loop when too high
                posArr[i * 3 + 1] += this.particleSpeeds[i];
                if (posArr[i * 3 + 1] > 7) {
                    posArr[i * 3 + 1] = -7;
                }
            }
            this.particles.geometry.attributes.position.needsUpdate = true;
            this.particles.rotation.y += 0.0005;
        }

        // ── Animate scan beam ──
        if (this.scanBeam) {
            const beamY = -3.5 + ((t * 0.5) % 1) * 7;
            this.scanBeam.position.y = beamY;
            this.scanBeam.material.opacity = 0.08 + 0.12 * Math.sin(t * 2.0);
        }

        // ── Animate main light ──
        if (this.light1) {
            this.light1.position.x = Math.sin(t * 0.3) * 4;
            this.light1.position.z = Math.cos(t * 0.3) * 4;
            this.light1.intensity = 1.2 + 0.4 * Math.sin(t * 1.5);
        }

        // ── Camera subtle drift ──
        this.camera.position.x = Math.sin(t * 0.1) * 0.3;
        this.camera.position.y = 1.5 + Math.sin(t * 0.15) * 0.2;
        this.camera.lookAt(0, 0, 0);

        // ── Render ──
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Set hologram grabbed state (via pinch)
     */
    setGrabbed(grabbed) {
        this.isGrabbed = grabbed;
        if (grabbed) {
            this.autoRotY = 0;
        } else {
            this.autoRotY = 0.004;
        }
    }

    /**
     * Apply manual rotation when grabbed
     */
    applyManualRotation(dx, dy) {
        this.holoGroup.rotation.y += dx * 0.01;
        this.holoGroup.rotation.x += dy * 0.01;
    }

    /**
     * Flash the hologram (e.g. on activation)
     */
    flash() {
        let count = 0;
        const interval = setInterval(() => {
            if (this.holoObj) {
                this.holoObj.material.opacity = count % 2 === 0 ? 0.3 : 0.85;
            }
            count++;
            if (count > 6) {
                clearInterval(interval);
                if (this.holoObj) this.holoObj.material.opacity = 0.85;
            }
        }, 100);
    }

    _onResize() {
        const W = window.innerWidth;
        const H = window.innerHeight;
        this.camera.aspect = W / H;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(W, H);
    }

    destroy() {
        if (this.animFrame) cancelAnimationFrame(this.animFrame);
        this.renderer.dispose();
    }
};
