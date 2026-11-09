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
    
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    document.body.appendChild(renderer.domElement);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    ambientLight.name = 'AmbientLight';
    scene.add(ambientLight);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(100, -100, 200);
    sun.name = 'SunLight';
    scene.add(sun);

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
