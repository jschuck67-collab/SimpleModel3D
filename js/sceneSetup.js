import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

/**
 * Generates an ultra-smooth, uniform 360-degree diffuse studio gradient texture.
 * Completely eliminates pinpoint specular hot-spots / flashlight glares while giving
 * Glass and Metal rich, bright PBR reflections and refractions from all viewing angles.
 */
function createStudioDiffuseEnvironment(renderer) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Smooth top-to-bottom soft daylight gradient
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0.0, '#ffffff'); // Zenith
    grad.addColorStop(0.35, '#eef2f7');
    grad.addColorStop(0.5, '#dfe5ed'); // Horizon
    grad.addColorStop(0.7, '#c8d0da');
    grad.addColorStop(1.0, '#a6b0be'); // Ground
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const envRenderTarget = pmremGenerator.fromEquirectangular(texture);
    texture.dispose();
    pmremGenerator.dispose();
    return envRenderTarget.texture;
}

export function initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x303030);
    
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(25, -25, 25);
    camera.up.set(0, 0, 1);
    
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    
    // Assign uniform studio environment map
    scene.environment = createStudioDiffuseEnvironment(renderer);
    document.body.appendChild(renderer.domElement);
    
    // Clean, perfectly balanced 360-degree CAD World Lights
    // 1. Omnidirectional ambient baseline
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.70);
    ambientLight.name = 'AmbientLight';
    scene.add(ambientLight);

    // 2. Hemisphere light for clean Z-up top vs bottom plane differentiation
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x8a929e, 0.60);
    hemiLight.position.set(0, 0, 1);
    hemiLight.name = 'WorldHemiLight';
    scene.add(hemiLight);

    // 3. Balanced camera headlamp: follows user's camera viewpoint so whatever face
    // you look at is always cleanly and pleasantly illuminated without harsh hotspots.
    const headlamp = new THREE.DirectionalLight(0xffffff, 0.50);
    headlamp.name = 'CameraHeadlamp';
    headlamp.position.set(0, 0, 1);
    camera.add(headlamp);
    scene.add(camera);

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
