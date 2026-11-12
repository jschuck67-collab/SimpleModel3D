import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x303030);
    
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(25, -25, 25);
    camera.up.set(0, 0, 1);
    
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    
    // Balanced studio environment for realistic PBR metal reflections and glass refraction
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    document.body.appendChild(renderer.domElement);
    
    // Clean, high-intensity ambient & hemisphere light so shadows are never dark
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    ambientLight.name = 'AmbientLight';
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xb0b8c5, 0.75);
    hemiLight.position.set(0, 0, 1);
    hemiLight.name = 'WorldHemiLight';
    scene.add(hemiLight);

    // Subtle 360-degree fill group for crisp CAD face contrast (no harsh single hotspot)
    const worldFillGroup = new THREE.Group();
    worldFillGroup.name = 'WorldFillGroup';

    const fill1 = new THREE.DirectionalLight(0xffffff, 0.45);
    fill1.position.set(100, -120, 150);
    worldFillGroup.add(fill1);

    const fill2 = new THREE.DirectionalLight(0xffffff, 0.35);
    fill2.position.set(-100, 120, 100);
    worldFillGroup.add(fill2);

    const fill3 = new THREE.DirectionalLight(0xffffff, 0.25);
    fill3.position.set(120, 100, -80);
    worldFillGroup.add(fill3);

    scene.add(worldFillGroup);

    // Single Directional Sun (used when toggled to Sun Shadow mode)
    const sun = new THREE.DirectionalLight(0xffffff, 0);
    sun.position.set(100, -100, 200);
    sun.name = 'SunLight';
    scene.add(sun);

    scene.userData.lightingMode = 'world'; // 'world' (360° CAD World) | 'sun' (Directional Sun)
    scene.userData.lightIntensity = 1.0;

    const grid = new THREE.GridHelper(256, 256, 0x444444, 0x383838);
    grid.rotation.x = Math.PI / 2;
    grid.material.depthWrite = false;
    grid.renderOrder = -2;
    grid.name = 'FloorGrid';
    scene.add(grid);

    const axisGroup = new THREE.Group();
    axisGroup.name = 'AxisGroup';

    const makeAxisLine = (p1, p2, colorHex, name) => {
        const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const mat = new THREE.LineBasicMaterial({ color: colorHex, depthWrite: false });
        const line = new THREE.Line(geo, mat);
        line.renderOrder = -1;
        line.name = name;
        return line;
    };

    axisGroup.add(makeAxisLine(new THREE.Vector3(-128, 0, 0), new THREE.Vector3(128, 0, 0), 0xff3344, 'AxisX'));
    axisGroup.add(makeAxisLine(new THREE.Vector3(0, -128, 0), new THREE.Vector3(0, 128, 0), 0x22cc44, 'AxisY'));
    const axisZ = makeAxisLine(new THREE.Vector3(0, 0, -128), new THREE.Vector3(0, 0, 128), 0x3388ff, 'AxisZ');
    axisZ.visible = false;
    axisGroup.add(axisZ);
    scene.add(axisGroup);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = false;
    orbit.zoomSpeed = 1.6;
    // Blender Viewport Navigation: Middle Mouse = Rotate (Shift+MMB = Pan, Scroll = Zoom), Right Click = Context Menu
    orbit.mouseButtons = {
        LEFT: null,
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: null
    };

    const transform = new TransformControls(camera, renderer.domElement);
    scene.add(transform);

    const rulerGroup = new THREE.Group();
    scene.add(rulerGroup);

    return { scene, camera, renderer, orbit, transform, rulerGroup };
}
