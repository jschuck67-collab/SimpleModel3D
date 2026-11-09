import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { initScene } from './sceneSetup.js';
import { toDeg, toRad, formatVal, toDisplay, fromDisplay, generateRandomColor, getLocalSize } from './utils.js';
import { saveProject, exportSTL, exportGLB } from './io.js';
import { executeBoolean } from './booleanOps.js';
import { createBasicGeometry, createBevelGeometry, createTubeGeometry, loadTextGeometry } from './shapes.js';
import { disposeHierarchy, forceMaterialUpgrade, updateBuildPlate } from './scene.js';
import { snapToGrid, dropToFloor, setOrigin, alignObjects, performDropToSurface, resetTransform, applyTransform, centerAssemblyOnPlate, checkBuildVolume } from './tools.js';
import { togglePanel, closeTextModal, closeBevelModal, closeTubeModal, updateLighting } from './ui.js';
import { saveAutosave, clearAutosave } from './state.js';

let scene, camera, renderer, orbit, transform, rulerGroup;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let pointerDownPosition = new THREE.Vector2();
let objects = []; 
let selection = []; 
let selectionHelpers = [];
let undoStack = [];
let redoStack = [];
let clipboard = [];

let isMarquee = false;
let marqueeCandidate = false;
let marqueeStart = new THREE.Vector2();
let marqueeElem;

let perspCamera, orthoCamera, isOrtho = false;
let viewHelper, clock;
let isBuildPlate = false;
let buildPlate;
let currentPrinter = 'bambu';
// RULER VARS
let rulerActive = false;
let rulerPoints = [];
let dropSurfaceActive = false;
let isVertexSnapping = false;

let isWireframe = false;
let showDimensions = false;
let useRandomColors = false; 
let isLightMode = false;
let currentUnit = 'mm'; 
let isSnapping = false;

let currentSpace = 'world';
let keymapMode = 'cad'; // 'cad' or 'blender'
let inspectorEditCommitted = false;

window.createShape = createShape;
window.performBoolean = performBoolean;
window.toggleCutterMode = toggleCutterMode;
window.swapBooleanOrder = swapBooleanOrder;
window.mirrorSelected = mirrorSelected;
window.groupSelected = groupSelected;
window.alignObjects = (axis, type) => { if (selection.length < 2) return alert("Select at least 2 objects to align."); pushToUndo(); alignObjects(selection, axis, type); updateInspectorUI(selection[selection.length - 1]); document.getElementById('status-text').innerText = `Aligned ${axis.toUpperCase()} to ${type}`; };
window.performArray = performArray;
window.handleDrop = handleDrop;
window.ungroupSelected = ungroupSelected;
window.cloneSelected = cloneSelected;
window.redo = redo;
window.setView = setView;
window.updateBuildPlate = (val) => { currentPrinter = val; buildPlate = updateBuildPlate(val, buildPlate, scene); updateSelectionStatus(); };
window.updateObjectFromUI = updateObjectFromUI;
window.handleDropButton = handleDropButton;
window.toggleTheme = toggleTheme;
window.updateLighting = (val) => updateLighting(val, scene);
window.toggleDimensions = toggleDimensions;
window.exportSTL = () => exportSTL(objects.filter(o => o.visible));
window.exportSelectedSTL = () => { if (selection.length > 0) exportSTL(selection); else alert('Select objects to export!'); };
window.exportGLB = () => exportGLB(objects.filter(o => o.visible));
window.exportSelectedGLB = () => { if (selection.length > 0) exportGLB(selection); else alert('Select objects to export!'); };
window.importSTL = () => document.getElementById('stl-input').click();
window.handleSTLImport = handleSTLImport;
window.handleSVGImport = handleSVGImport;
window.saveProject = () => saveProject(objects);
window.loadProject = loadProject;
window.newScene = newScene;
window.undo = undo;
window.handleRulerButton = handleRulerButton;
window.closeBevelModal = closeBevelModal;
window.confirmBevelShape = confirmBevelShape;
window.closeTubeModal = closeTubeModal;
window.confirmTubeShape = confirmTubeShape;
window.closeTextModal = closeTextModal;
window.confirmTextShape = confirmTextShape;
window.setOrigin = (type) => { if (selection.length === 0) return; pushToUndo(); setOrigin(selection, type); refreshTransformAttachment(); updateInspectorUI(selection[selection.length - 1]); };
window.toggleCamera = toggleCamera;
window.snapToGrid = () => { if (selection.length === 0) return; pushToUndo(); snapToGrid(selection, currentUnit); updateInspectorUI(selection[selection.length - 1]); updateSelectionStatus(); };
window.toggleVertexSnap = toggleVertexSnap;
window.dropToFloor = () => { if (selection.length === 0) return; pushToUndo(); dropToFloor(selection); updateInspectorUI(selection[selection.length - 1]); updateSelectionStatus(); };
window.centerOnPlate = centerOnPlate;
window.resetSelectedTransform = resetSelectedTransform;
window.applySelectedTransform = applySelectedTransform;
window.toggleKeymap = toggleKeymap;
window.unhideAll = unhideAll;
window.toggleSpace = toggleSpace;
window.togglePanel = togglePanel;

init();

function init() {
    const setup = initScene();
    scene = setup.scene;
    camera = setup.camera;
    perspCamera = setup.camera;
    camera = perspCamera;
    
    const aspect = window.innerWidth / window.innerHeight;
    const d = 20;
    // Use massive negative/positive near and far planes so Ortho never clips objects!
    orthoCamera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, -10000, 10000);
    orthoCamera.up.set(0, 0, 1);
    orthoCamera.position.copy(camera.position);
    orthoCamera.lookAt(0, 0, 0);

    renderer = setup.renderer;
    orbit = setup.orbit;
    transform = setup.transform;
    rulerGroup = setup.rulerGroup;
    
    renderer.autoClear = false;
    clock = new THREE.Clock();

    const compassDiv = document.createElement('div');
    compassDiv.id = "compass-div";
    document.body.appendChild(compassDiv);

    viewHelper = new ViewHelper(camera, compassDiv);
    viewHelper.center = orbit.target;

    // Virtual Build Plate (256x256x256mm Bambu P1S volume)
    const bpGeo = new THREE.BoxGeometry(256, 256, 256);
    const bpEdges = new THREE.EdgesGeometry(bpGeo);
    buildPlate = new THREE.LineSegments(bpEdges, new THREE.LineBasicMaterial({ color: 0x3498db, transparent: true, opacity: 0.5 }));
    // Offset Z by half the height so it sits perfectly on the floor grid
    buildPlate.position.set(0, 0, 128);
    buildPlate.visible = false;
    scene.add(buildPlate);

    const viewLabel = document.createElement('div');
    viewLabel.id = "view-label";
    viewLabel.innerText = "User Perspective";
    viewLabel.title = "Click to toggle Perspective / Orthographic (5)";
    viewLabel.addEventListener('pointerdown', (e) => e.stopPropagation());
    viewLabel.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCamera();
    });
    document.body.appendChild(viewLabel);

    compassDiv.addEventListener('pointerdown', (e) => e.stopPropagation());
    compassDiv.addEventListener('pointerup', (e) => { e.stopPropagation(); viewHelper.handleClick(e); });

    transform.addEventListener('mouseDown', () => pushToUndo());
    transform.addEventListener('mouseUp', () => {
        if (selection.length > 0) {
            updateInspectorUI(selection[selection.length - 1]);
            updateSelectionStatus();
        }
    });
    transform.addEventListener('dragging-changed', (e) => orbit.enabled = !e.value);
    transform.addEventListener('change', () => { 
        // LIVE DRAG VERTEX SNAPPING 
        if (transform.dragging && transform.mode === 'translate' && isVertexSnapping && selection.length > 0) {
            raycaster.setFromCamera(mouse, camera);
            
            // Filter out currently selected or hidden objects so we don't snap to ourselves
            const targetObjects = objects.filter(o => {
                if (!o.visible) return false;
                let isSelected = false;
                o.traverseAncestors(p => { if (selection.includes(p)) isSelected = true; });
                return !selection.includes(o) && !isSelected;
            });
            
            const intersects = raycaster.intersectObjects(targetObjects, true);
            if (intersects.length > 0) {
                const intersect = intersects[0];
                let targetVert = intersect.point;
                
                // Mathematically locate the closest physical vertex to the mouse on the target object
                if(intersect.object.geometry && intersect.face) {
                    const pos = intersect.object.geometry.attributes.position;
                    const wMat = intersect.object.matrixWorld;
                    const a = new THREE.Vector3().fromBufferAttribute(pos, intersect.face.a).applyMatrix4(wMat);
                    const b = new THREE.Vector3().fromBufferAttribute(pos, intersect.face.b).applyMatrix4(wMat);
                    const c = new THREE.Vector3().fromBufferAttribute(pos, intersect.face.c).applyMatrix4(wMat);
                    const dA = intersect.point.distanceTo(a);
                    const dB = intersect.point.distanceTo(b);
                    const dC = intersect.point.distanceTo(c);
                    if (dA <= dB && dA <= dC) targetVert = a;
                    else if (dB <= dA && dB <= dC) targetVert = b;
                    else targetVert = c;
                }
                
                // Find the closest vertex on our currently moving object to align them perfectly
                const movingObj = selection[selection.length - 1];
                let sourceVert = movingObj.position.clone();
                let minDist = Infinity;
                
                movingObj.updateMatrixWorld(true);
                movingObj.traverse(child => {
                    if (child.isMesh && child.geometry) {
                        const pos = child.geometry.attributes.position;
                        const wMat = child.matrixWorld;
                        for (let i = 0; i < pos.count; i++) {
                            const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(wMat);
                            const dist = v.distanceTo(targetVert);
                            if (dist < minDist) {
                                minDist = dist;
                                sourceVert = v.clone();
                            }
                        }
                    }
                });
                
                // Magnetically snap the position only if we drag a corner within 5 units of the target!
                if (minDist < 5) {
                    const offset = targetVert.clone().sub(sourceVert);
                    selection.forEach(obj => {
                        if (!obj.userData.locked) {
                            obj.position.add(offset);
                            obj.updateMatrixWorld(true);
                        }
                    });
                }
            }
        }

        if (transform.dragging && selection.length > 0) {
            updateInspectorUI(selection[selection.length - 1]);
            updateSelectionStatus();
        }
    });

    marqueeElem = document.createElement('div');
    marqueeElem.className = 'marquee-box';
    document.body.appendChild(marqueeElem);

    // Prevent browser middle-click autoscroll cursor on canvas
    renderer.domElement.addEventListener('mousedown', (e) => {
        if (e.button === 1) e.preventDefault();
    });
    renderer.domElement.addEventListener('auxclick', (e) => {
        if (e.button === 1) e.preventDefault();
    });

    // Configure OrbitControls mouse buttons in capture phase before OrbitControls handles pointerdown
    // Note: In Three.js OrbitControls, THREE.MOUSE.ROTATE automatically switches to PAN when Shift is held!
    renderer.domElement.addEventListener('pointerdown', (e) => {
        if (e.button === 1) {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) orbit.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
            else orbit.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
        } else if (e.button === 0) {
            if (e.altKey) {
                // Blender "Emulate 3 Button Mouse" (Alt + LMB = Orbit, Shift + Alt + LMB = Pan, Ctrl + Alt + LMB = Zoom)
                if (e.ctrlKey || e.metaKey) orbit.mouseButtons.LEFT = THREE.MOUSE.DOLLY;
                else orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
            } else {
                orbit.mouseButtons.LEFT = null;
            }
        }
    }, true);

    window.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('#context-menu')) {
            closeContextMenu();
        }
        pointerDownPosition.set(e.clientX, e.clientY);
        if (e.button === 0 && !e.altKey && !transform.dragging && transform.axis === null && !rulerActive && !dropSurfaceActive && !e.target.closest('.panel') && !e.target.closest('#compass-div') && !e.target.closest('#context-menu')) {
            marqueeCandidate = true;
            marqueeStart.set(e.clientX, e.clientY);
            marqueeElem.style.left = e.clientX + 'px';
            marqueeElem.style.top = e.clientY + 'px';
            marqueeElem.style.width = '0px';
            marqueeElem.style.height = '0px';
        }
    });
    window.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.panel') || e.target.closest('.modal-overlay')) return;
        e.preventDefault();
        openContextMenu(e);
    });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('pointermove', (e) => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        document.body.style.cursor = (rulerActive || dropSurfaceActive) ? 'crosshair' : (transform.axis ? 'pointer' : 'default');
        if (marqueeCandidate && !isMarquee) {
            if (Math.hypot(e.clientX - marqueeStart.x, e.clientY - marqueeStart.y) > 4) {
                isMarquee = true;
                marqueeElem.style.display = 'block';
            }
        }
        if (isMarquee) {
            const currentX = e.clientX;
            const currentY = e.clientY;
            marqueeElem.style.left = Math.min(marqueeStart.x, currentX) + 'px';
            marqueeElem.style.top = Math.min(marqueeStart.y, currentY) + 'px';
            marqueeElem.style.width = Math.abs(currentX - marqueeStart.x) + 'px';
            marqueeElem.style.height = Math.abs(currentY - marqueeStart.y) + 'px';
        }
    });

    document.getElementById('tool-move').addEventListener('click', () => setToolMode('translate'));
    document.getElementById('tool-rotate').addEventListener('click', () => setToolMode('rotate'));
    document.getElementById('tool-scale').addEventListener('click', () => setToolMode('scale'));
    document.getElementById('delete-btn').addEventListener('click', deleteObject);
    document.getElementById('wire-toggle').addEventListener('click', toggleWireframe);
    document.getElementById('build-plate-toggle').addEventListener('click', toggleBuildPlate);
    document.getElementById('snap-toggle').addEventListener('click', toggleSnap);
    document.getElementById('snap-val').addEventListener('change', updateSnapValue);
    document.getElementById('unit-mm').addEventListener('click', () => setUnit('mm'));
    document.getElementById('unit-in').addEventListener('click', () => setUnit('in'));
    document.getElementById('rand-color-toggle').addEventListener('click', toggleRandomColors);

    const inspectorInputs = ['dimX', 'dimY', 'dimZ', 'scaleX', 'scaleY', 'scaleZ', 'posX', 'posY', 'posZ', 'rotX', 'rotY', 'rotZ', 'objColor', 'objOpacity', 'objMaterial'];
    inspectorInputs.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('focus', () => { inspectorEditCommitted = false; });
        el.addEventListener('pointerdown', () => { inspectorEditCommitted = false; });
        el.addEventListener('input', (e) => {
            if (!inspectorEditCommitted && selection.length > 0) {
                pushToUndo();
                inspectorEditCommitted = true;
            }
            updateObjectFromUI(e);
        });
        el.addEventListener('change', () => { inspectorEditCommitted = false; });
    });

    document.getElementById('objName').addEventListener('change', (e) => {
        if(selection.length > 0) {
            selection[selection.length - 1].name = e.target.value;
            updateOutliner();
            updateSelectionStatus();
        }
    });

    // --- AUTOSAVE / LOAD ON REFRESH ---
    window.addEventListener('beforeunload', () => {
        saveAutosave(objects, document.getElementById('project-name').value);
    });

    const savedData = localStorage.getItem('jscad_autosave');
    let loadedAutosave = false;
    if (savedData) {
        try {
            const data = JSON.parse(savedData);
            if (data.objects && data.objects.length > 0) {
                const loader = new THREE.ObjectLoader();
                data.objects.forEach(json => {
                    const o = loader.parse(json);
                    forceMaterialUpgrade(o);
                    scene.add(o);
                    objects.push(o);
                    updateObjectVisuals(o);
                });
                const projName = localStorage.getItem('jscad_project_name');
                if (projName) document.getElementById('project-name').value = projName;
                loadedAutosave = true;
                setTimeout(() => document.getElementById('status-text').innerText = "Autosave recovered!", 500);
            }
        } catch(e) { console.error('Error loading autosave:', e); }
    }

    if (!loadedAutosave) {
        addDefaultCube();
    }

    updateOutliner();
    animate();
}

// --- KEYMAP TOGGLE (CAD vs BLENDER) ---
function toggleKeymap() {
    keymapMode = keymapMode === 'cad' ? 'blender' : 'cad';
    const btn = document.getElementById('keymap-toggle');
    const moveBtn = document.getElementById('tool-move');
    if (keymapMode === 'blender') {
        btn.innerText = "Keymap: BLENDER (G/R/S)";
        btn.classList.add('active');
        moveBtn.innerText = "G";
        moveBtn.title = "Grab / Move (G)";
        document.getElementById('status-text').innerText = "Blender Keymap: G=Grab, R=Rot, S=Scale, Ctrl+G=Group";
    } else {
        btn.innerText = "Keymap: CAD (M/R/S)";
        btn.classList.remove('active');
        moveBtn.innerText = "M";
        moveBtn.title = "Move (M)";
        document.getElementById('status-text').innerText = "CAD Keymap: M=Move, R=Rot, S=Scale, G=Group";
    }
}

// --- RESET & APPLY TRANSFORMS & BUILD PLATE CENTER ---
function resetSelectedTransform(type) {
    if (selection.length === 0) return;
    pushToUndo();
    resetTransform(selection, type);
    updateInspectorUI(selection[selection.length - 1]);
    updateSelectionStatus();
    const label = type === 'pos' ? 'Position' : type === 'rot' ? 'Rotation' : 'Scale';
    document.getElementById('status-text').innerText = `Reset ${label}`;
}

function applySelectedTransform(type) {
    if (selection.length === 0) return;
    pushToUndo();
    applyTransform(selection, type);
    refreshSelectionHelpers();
    refreshTransformAttachment();
    updateInspectorUI(selection[selection.length - 1]);
    const labelMap = {
        loc: 'Location (Origin → 0,0,0)',
        rot: 'Rotation (0°)',
        scale: 'Scale (1.0)',
        rotscale: 'Rotation & Scale',
        all: 'All Transforms'
    };
    document.getElementById('status-text').innerText = `Applied ${labelMap[type] || type}`;
}

function selectAll() {
    deselectAll(true);
    objects.forEach(obj => {
        if (obj.visible && !obj.userData.locked) {
            selectObject(obj, true);
        }
    });
    updateOutliner();
    updateSelectionStatus();
}

function centerOnPlate() {
    const targets = selection.length > 0 ? selection : objects;
    if (targets.length === 0) return alert("Scene is empty!");
    pushToUndo();
    if (centerAssemblyOnPlate(targets)) {
        if (selection.length > 0) updateInspectorUI(selection[selection.length - 1]);
        updateSelectionStatus();
        document.getElementById('status-text').innerText = "Centered on build plate (Z=0)";
    }
}

// --- OUTLINER VISIBILITY & LOCK ---
function hideSelected() {
    if (selection.length === 0) return;
    selection.forEach(obj => { obj.visible = false; });
    deselectAll();
    document.getElementById('status-text').innerText = "Hidden selected (Alt+H to unhide)";
}

function unhideAll() {
    let count = 0;
    scene.traverse(obj => {
        if ((objects.includes(obj) || obj.parent?.isGroup) && !obj.visible) {
            obj.visible = true;
            count++;
        }
    });
    updateOutliner();
    updateSelectionStatus();
    if (count > 0) document.getElementById('status-text').innerText = `Unhid ${count} object(s)`;
}

function refreshTransformAttachment() {
    transform.detach();
    if (selection.length > 0 && !rulerActive && !dropSurfaceActive) {
        const last = selection[selection.length - 1];
        if (last.visible && !last.userData.locked) {
            transform.attach(last);
        }
    }
}

// --- BOOLEAN CUTTER MODE & ORDER HELPER ---
function getBooleanPair() {
    if (selection.length < 2) return null;
    let meshA = selection[0];
    let meshB = selection[1];
    // If meshA is marked as a Hole Cutter and meshB is not, automatically use meshB as Base and meshA as Cutter!
    if (meshA.userData.isCutter && !meshB.userData.isCutter) {
        meshA = selection[1];
        meshB = selection[0];
    }
    return { meshA, meshB };
}

function toggleCutterMode() {
    if (selection.length === 0) return alert("Select an object to toggle Hole Cutter preview.");
    pushToUndo();
    const targetState = !selection[selection.length - 1].userData.isCutter;
    selection.forEach(obj => {
        obj.userData.isCutter = targetState;
        updateObjectVisuals(obj);
    });
    refreshSelectionHelpers();
    updateInspectorUI(selection[selection.length - 1]);
    updateOutliner();
    updateSelectionStatus();
}

function swapBooleanOrder() {
    if (selection.length < 2) return alert("Select 2 objects (Shift+Click) to swap Base and Cutter order.");
    const first = selection[0];
    selection[0] = selection[1];
    selection[1] = first;
    // Also swap cutter flags if one of them was marked as a cutter
    if (selection[0].userData.isCutter !== selection[1].userData.isCutter) {
        const tmp = selection[0].userData.isCutter;
        selection[0].userData.isCutter = selection[1].userData.isCutter;
        selection[1].userData.isCutter = tmp;
        updateObjectVisuals(selection[0]);
        updateObjectVisuals(selection[1]);
    }
    refreshSelectionHelpers();
    refreshTransformAttachment();
    updateInspectorUI(selection[selection.length - 1]);
    updateOutliner();
    updateSelectionStatus();
}

function refreshSelectionHelpers() {
    selectionHelpers.forEach(h => {
        scene.remove(h.helper);
        if (h.helper.geometry) h.helper.geometry.dispose();
        if (h.helper.material) h.helper.material.dispose();
    });
    selectionHelpers = [];

    const pair = getBooleanPair();
    selection.forEach(obj => {
        let color = 0xffa500; // Default CAD Orange (Base)
        if (obj.userData.isCutter || (pair && obj === pair.meshB)) {
            color = 0xff4757; // Cutter Red
        } else if (pair && obj === pair.meshA) {
            color = 0x2ecc71; // Base Green when 2+ objects are selected
        }
        const helper = new THREE.BoxHelper(obj, color);
        scene.add(helper);
        selectionHelpers.push({ obj, helper });
    });

    const cutterBtn = document.getElementById('cutter-toggle');
    if (cutterBtn) {
        const isCutterActive = selection.length > 0 && !!selection[selection.length - 1].userData.isCutter;
        cutterBtn.classList.toggle('active', isCutterActive);
    }
}

function updateSelectionStatus() {
    if (rulerActive || dropSurfaceActive) return;
    const statusEl = document.getElementById('status-text');
    if (!statusEl) return;

    const { outOfBounds, floatWarning } = checkBuildVolume(objects, selection, currentPrinter, currentUnit);
    if (buildPlate) {
        buildPlate.material.color.setHex(outOfBounds ? 0xe74c3c : 0x3498db);
        buildPlate.material.opacity = outOfBounds ? 0.85 : 0.5;
    }

    if (selection.length >= 2) {
        const { meshA, meshB } = getBooleanPair();
        const nameA = meshA.name || "Obj 1";
        const nameB = meshB.name || "Obj 2";
        statusEl.innerText = `Base: ${nameA} | Cutter: ${nameB}`;
        return;
    }

    if (outOfBounds && isBuildPlate) {
        statusEl.innerText = "⚠️ Object outside build plate volume!";
        return;
    }

    if (floatWarning) {
        statusEl.innerText = floatWarning;
        return;
    }

    if (selection.length === 1) {
        const obj = selection[0];
        if (obj.userData.locked) {
            statusEl.innerText = `🔒 ${obj.name || 'Object'} (Locked)`;
        } else if (obj.userData.isCutter) {
            statusEl.innerText = `👻 Cutter: ${obj.name || 'Object'} (Shift+Click Base)`;
        } else {
            statusEl.innerText = `Selected: ${obj.name || 'Object'}`;
        }
    } else {
        statusEl.innerText = "Select objects...";
    }
}

// --- RULER LOGIC (ADAPTIVE & PERSISTENT) ---
function handleRulerButton() {
    const btn = document.getElementById('tool-ruler');
    const hasMeasurement = rulerPoints.length > 0;

    if (rulerActive) {
        // If currently measuring -> Deactivate, but keep measurement if exists
        rulerActive = false;
        btn.classList.remove('active-ruler-mode');
        updateSelectionStatus();
        if (hasMeasurement) btn.classList.add('active-ruler-visible'); // Green
    } else {
        // If not active
        if (hasMeasurement) {
            // If measurement exists -> Clear it
            clearRuler();
            btn.classList.remove('active-ruler-visible');
            updateSelectionStatus();
        } else {
            // Start Measuring
            rulerActive = true;
            deselectAll();
            btn.classList.add('active-ruler-mode');
            document.getElementById('status-text').innerText = "Ruler Mode: Click start point";
        }
    }
}

function clearRuler() {
    rulerPoints = [];
    rulerGroup.children.forEach(c => disposeHierarchy(c));
    rulerGroup.clear();
    document.getElementById('ruler-label').style.display = 'none';
    document.getElementById('tool-ruler').classList.remove('active-ruler-mode', 'active-ruler-visible');
}

function handleRulerClick() {
    raycaster.setFromCamera(mouse, camera);
    const visibleObjects = objects.filter(o => o.visible);
    const intersects = raycaster.intersectObjects(visibleObjects, true);
    if (intersects.length > 0) {
        const intersect = intersects[0];
        const mesh = intersect.object;
        
        // SNAP TO VERTEX LOGIC
        let finalPoint = intersect.point;
        if(mesh.geometry && intersect.face) {
            const pos = mesh.geometry.attributes.position;
            const a = new THREE.Vector3().fromBufferAttribute(pos, intersect.face.a).applyMatrix4(mesh.matrixWorld);
            const b = new THREE.Vector3().fromBufferAttribute(pos, intersect.face.b).applyMatrix4(mesh.matrixWorld);
            const c = new THREE.Vector3().fromBufferAttribute(pos, intersect.face.c).applyMatrix4(mesh.matrixWorld);
            
            const distA = intersect.point.distanceTo(a);
            const distB = intersect.point.distanceTo(b);
            const distC = intersect.point.distanceTo(c);
            
            if(distA <= distB && distA <= distC) finalPoint = a;
            else if(distB <= distA && distB <= distC) finalPoint = b;
            else finalPoint = c;
        }

        // Adaptive Scale
        const box = new THREE.Box3().setFromObject(mesh);
        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);
        const markerScale = Math.max(0.05, sphere.radius * 0.03); 

        if (rulerPoints.length === 2) {
            // Starting a new measurement chain
            rulerPoints = [];
            rulerGroup.children.forEach(c => disposeHierarchy(c));
            rulerGroup.clear();
            document.getElementById('ruler-label').style.display = 'none';
        }

        rulerPoints.push(finalPoint);

        // Add Marker
        const markerGeo = new THREE.SphereGeometry(markerScale, 16, 16);
        const markerMat = new THREE.MeshBasicMaterial({ color: rulerPoints.length === 1 ? 0x00ff00 : 0xff0000, depthTest: false });
        const marker = new THREE.Mesh(markerGeo, markerMat);
        marker.position.copy(finalPoint);
        marker.renderOrder = 999;
        rulerGroup.add(marker);

        if (rulerPoints.length === 1) {
            document.getElementById('status-text').innerText = "Ruler: Click end point";
        } else if (rulerPoints.length === 2) {
            // Draw Line
            const points = rulerPoints;
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false, linewidth: 2 });
            const line = new THREE.Line(geometry, material);
            line.renderOrder = 998;
            rulerGroup.add(line);

            // Calc Distance
            const dist = rulerPoints[0].distanceTo(rulerPoints[1]);
            const displayDist = formatVal(dist, currentUnit) + (currentUnit === 'mm' ? ' mm' : ' in');
            document.getElementById('status-text').innerText = `Distance: ${displayDist}`;
            
            updateRulerLabel(); // Show label
        }
    }
}

function updateRulerLabel() {
    if (rulerPoints.length !== 2) return;
    const label = document.getElementById('ruler-label');
    const center = new THREE.Vector3().addVectors(rulerPoints[0], rulerPoints[1]).multiplyScalar(0.5);
    const dist = rulerPoints[0].distanceTo(rulerPoints[1]);
    
    label.innerText = formatVal(dist, currentUnit) + (currentUnit === 'mm' ? 'mm' : '"');
    
    // Project to screen
    center.project(camera);
    if (Math.abs(center.z) > 1) {
        label.style.display = 'none';
        return;
    }
    
    const x = (center.x * .5 + .5) * window.innerWidth;
    const y = (center.y * -.5 + .5) * window.innerHeight;
    
    label.style.display = 'block';
    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
}

// --- DROP TO SURFACE LOGIC ---
function handleDropButton() {
    if (dropSurfaceActive) {
        dropSurfaceActive = false;
        document.getElementById('tool-drop').classList.remove('active-tool');
        refreshTransformAttachment();
        updateSelectionStatus();
    } else {
        if (selection.length === 0) return alert("Select an object to drop first!");
        if (rulerActive) handleRulerButton(); // toggle ruler off
        
        transform.detach();
        dropSurfaceActive = true;
        document.getElementById('tool-drop').classList.add('active-tool');
        document.getElementById('status-text').innerText = "Face Snap: Click target surface";
    }
}

// --- FOCUS FEATURE ---
function frameObjectsList(targetList) {
    if (targetList.length === 0) return;
    const box = new THREE.Box3();
    targetList.forEach(obj => { if (obj.visible) box.expandByObject(obj); });
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const fov = (perspCamera.fov || 45) * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    if (perspCamera.aspect < 1) cameraZ = cameraZ / perspCamera.aspect;
    
    cameraZ *= 2.5; 

    const direction = new THREE.Vector3().subVectors(camera.position, orbit.target).normalize();
    if (direction.lengthSq() === 0) direction.set(1, -1, 1).normalize();
    const newPos = center.clone().add(direction.multiplyScalar(cameraZ));

    camera.position.copy(newPos);
    camera.lookAt(center);
    orbit.target.copy(center);
        
    if (isOrtho) {
        const h = maxDim * 2.5;
        const aspect = window.innerWidth / window.innerHeight;
        orthoCamera.left = -h * aspect / 2;
        orthoCamera.right = h * aspect / 2;
        orthoCamera.top = h / 2;
        orthoCamera.bottom = -h / 2;
        orthoCamera.zoom = 1;
        orthoCamera.updateProjectionMatrix();
    }
    orbit.update();
}

function frameSelected() {
    if (selection.length > 0) frameObjectsList(selection);
    else frameAll();
}

function frameAll() {
    frameObjectsList(objects.filter(o => o.visible));
}

// --- NEW SCENE LOGIC ---
function addDefaultCube() {
    const geo = createBasicGeometry('box');
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.2, transmission: 0, ior: 1.5, thickness: 0, wireframe: isWireframe, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    const size = getLocalSize(mesh);
    mesh.position.set(0, 0, size.z / 2);
    mesh.userData.trueColor = 0xcccccc;
    mesh.userData.opacity = 1;
    mesh.userData.materialType = 'matte';
    mesh.userData.randomColor = generateRandomColor();
    if (useRandomColors) mesh.material.color.setHex(mesh.userData.randomColor);
    mesh.name = "Cube 1";
    scene.add(mesh);
    objects.push(mesh);
    selectObject(mesh, false);
}

function newScene() {
    if(confirm("Start new scene? All unsaved work will be lost.")) {
        objects.forEach(o => { if (o.parent) o.parent.remove(o); disposeHierarchy(o); });
        objects = [];
        undoStack.flat().forEach(o => disposeHierarchy(o));
        redoStack.flat().forEach(o => disposeHierarchy(o));
        undoStack = [];
        redoStack = [];
        deselectAll();
        clearRuler();
        if(rulerActive) handleRulerButton();
        if(isOrtho) toggleCamera();
        camera.position.set(25, -25, 25);
        orbit.target.set(0, 0, 0);
        camera.lookAt(0, 0, 0);
        orbit.update();
        document.getElementById('project-name').value = "UNTITLED_PROJECT";
        clearAutosave();
        addDefaultCube();
        document.getElementById('status-text').innerText = "New Scene Created";
    }
}

function deepCloneObject(obj, preserveUUID = false) {
    const c = obj.clone();
    if (preserveUUID) c.uuid = obj.uuid;
    c.traverse(child => {
        if (child.isMesh) {
            if (child.geometry) child.geometry = child.geometry.clone();
            if (child.material) child.material = child.material.clone();
        }
    });
    return c;
}

// --- UNDO ENGINE ---
function captureState() {
    return objects.map(o => deepCloneObject(o, true));
}

function pushToUndo() {
    undoStack.push(captureState());
    if (undoStack.length > 20) {
        const dropped = undoStack.shift();
        dropped.forEach(o => disposeHierarchy(o));
    }
    redoStack.flat().forEach(o => disposeHierarchy(o));
    redoStack = [];
}

function undo() {
    if (undoStack.length === 0) return;
    const selectedUUIDs = selection.map(o => o.uuid);
    
    redoStack.push(captureState());
    const stateData = undoStack.pop();
    objects.forEach(o => { if (o.parent) o.parent.remove(o); disposeHierarchy(o); });
    objects = [];
    stateData.forEach(o => {
        scene.add(o);
        objects.push(o);
        updateObjectVisuals(o);
    });
    deselectAll();
    
    const objectsToReselect = [];
    scene.traverse(o => { if (selectedUUIDs.includes(o.uuid) && (objects.includes(o) || o.parent?.isGroup)) objectsToReselect.push(o); });
    objectsToReselect.forEach(o => selectObject(o, true));
    
    document.getElementById('status-text').innerText = "Undo performed";
}

function redo() {
    if (redoStack.length === 0) return;
    const selectedUUIDs = selection.map(o => o.uuid);
    
    undoStack.push(captureState());
    const stateData = redoStack.pop();
    objects.forEach(o => { if (o.parent) o.parent.remove(o); disposeHierarchy(o); });
    objects = [];
    stateData.forEach(o => {
        scene.add(o);
        objects.push(o);
        updateObjectVisuals(o);
    });
    deselectAll();
    
    const objectsToReselect = [];
    scene.traverse(o => { if (selectedUUIDs.includes(o.uuid) && (objects.includes(o) || o.parent?.isGroup)) objectsToReselect.push(o); });
    objectsToReselect.forEach(o => selectObject(o, true));
    
    document.getElementById('status-text').innerText = "Redo performed";
}

function toggleRandomColors() {
    useRandomColors = !useRandomColors;
    const btn = document.getElementById('rand-color-toggle');
    const picker = document.getElementById('objColor');
    btn.innerText = `Random Colors: ${useRandomColors ? 'ON' : 'OFF'}`;
    btn.classList.toggle('active');
    if(useRandomColors) picker.classList.add('disabled'); else picker.classList.remove('disabled');
    objects.forEach(obj => updateObjectVisuals(obj));
}

function updateObjectVisuals(obj) {
    const isCutter = !!obj.userData.isCutter;
    obj.traverse(child => {
        if (child.isMesh) {
            if (isCutter || child.userData.isCutter) {
                child.material.color.setHex(0xff3344);
                child.material.opacity = 0.35;
                child.material.transparent = true;
                child.material.wireframe = false;
                child.material.needsUpdate = true;
                return;
            }
            if (useRandomColors) {
                if (!child.userData.randomColor) child.userData.randomColor = generateRandomColor();
                child.material.color.setHex(child.userData.randomColor);
            } else {
                const trueColor = child.userData.trueColor !== undefined ? child.userData.trueColor : 0xcccccc;
                child.material.color.setHex(trueColor);
            }
            const op = child.userData.opacity !== undefined ? child.userData.opacity : 1;
            const matType = child.userData.materialType || 'matte';
            child.material.opacity = op;
            child.material.transparent = (op < 1 || matType === 'glass');
            child.material.wireframe = isWireframe;
            child.material.needsUpdate = true;
        }
    });
}

function mirrorSelected(axis) {
    if (selection.length === 0) return;
    pushToUndo();
    const doCopy = document.getElementById('mirror-copy').checked;
    if (doCopy) {
        const newClones = [];
        selection.forEach(obj => { 
            const clone = deepCloneObject(obj, false);
            clone.name = (obj.name || "Object") + " Mirrored";
            clone.position[axis] *= -1;
            clone.scale[axis] *= -1; 
            clone.traverse(child => { if(child.isMesh) { child.userData.randomColor = generateRandomColor(); } });
            const parent = obj.parent || scene;
            parent.add(clone);
            if (parent === scene) objects.push(clone);
            newClones.push(clone);
        });
        deselectAll();
        newClones.forEach(c => selectObject(c, true));
    } else {
        selection.forEach(obj => {
            if (!obj.userData.locked) {
                obj.position[axis] *= -1;
                obj.scale[axis] *= -1;
            }
        });
    }
    objects.forEach(o => updateObjectVisuals(o));
    if(selection.length > 0) updateInspectorUI(selection[selection.length - 1]);
}

function handleSTLImport(e) {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        pushToUndo();
        const loader = new STLLoader();
        const geo = loader.parse(ev.target.result);
        geo.center();
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        if (!geo.attributes.normal) geo.computeVertexNormals();

        const mat = new THREE.MeshPhysicalMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.2, transmission: 0, ior: 1.5, thickness: 0, wireframe: isWireframe, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.trueColor = 0xcccccc;
        mesh.userData.opacity = 1;
        mesh.userData.materialType = 'matte';
        mesh.userData.randomColor = generateRandomColor();
        if (useRandomColors) mesh.material.color.setHex(mesh.userData.randomColor);
        mesh.name = file.name.replace(/\.stl$/i, '');
        
        // Auto-scale huge STL files down so they don't break the camera
        const size = getLocalSize(mesh);
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 50) mesh.scale.setScalar(20 / maxDim);
        
        const finalSize = getLocalSize(mesh);
        mesh.position.set(0, 0, finalSize.z / 2);

        scene.add(mesh); objects.push(mesh); selectObject(mesh, false);
        e.target.value = ''; // Reset input
    };
    reader.readAsArrayBuffer(file);
}

function handleSVGImport(e) {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        pushToUndo();
        const loader = new SVGLoader();
        const svgData = loader.parse(ev.target.result);
        const paths = svgData.paths;
        const group = new THREE.Group();
        const mat = new THREE.MeshPhysicalMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.2, transmission: 0, ior: 1.5, thickness: 0, wireframe: isWireframe, side: THREE.DoubleSide });

        for ( let i = 0; i < paths.length; i ++ ) {
            const path = paths[ i ];
            const shapes = SVGLoader.createShapes( path );
            for ( let j = 0; j < shapes.length; j ++ ) {
                const shape = shapes[ j ];
                const geo = new THREE.ExtrudeGeometry( shape, {
                    depth: 5, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.2, bevelThickness: 0.2
                });
                // Flip Y in geometry so SVG is right-side up in Z-up world with positive Z extrusion
                geo.rotateX(Math.PI);
                geo.computeBoundingBox();
                const shapeCenter = new THREE.Vector3();
                geo.boundingBox.getCenter(shapeCenter);
                geo.translate(-shapeCenter.x, -shapeCenter.y, -shapeCenter.z);
                geo.computeBoundingBox();
                geo.computeBoundingSphere();

                const mesh = new THREE.Mesh( geo, mat.clone() );
                mesh.position.copy(shapeCenter);
                mesh.userData.trueColor = 0xcccccc;
                mesh.userData.opacity = 1;
                mesh.userData.materialType = 'matte';
                mesh.userData.randomColor = generateRandomColor();
                if (useRandomColors) mesh.material.color.setHex(mesh.userData.randomColor);
                mesh.name = `${file.name.replace(/\.svg$/i, '')} Path ${group.children.length + 1}`;
                group.add( mesh );
            }
        }

        if (group.children.length === 0) {
            alert("No valid vector paths found in SVG.");
            undoStack.pop();
            e.target.value = '';
            return;
        }
        
        // Center the entire SVG group while keeping each child's relative offset intact
        const box = new THREE.Box3().setFromObject(group);
        const center = new THREE.Vector3();
        box.getCenter(center);
        group.children.forEach(c => {
            c.position.sub(center);
            c.position.multiplyScalar(0.2);
            c.scale.setScalar(0.2);
        });
        
        // If the SVG was just one solid path, extract it from the group for easier modeling
        if(group.children.length === 1) {
            const mesh = group.children[0];
            const meshSize = getLocalSize(mesh);
            mesh.position.set(0, 0, meshSize.z / 2);
            mesh.name = file.name.replace(/\.svg$/i, '');
            scene.add(mesh); objects.push(mesh); selectObject(mesh, false);
        } else {
            const groupSize = getLocalSize(group);
            group.position.set(0, 0, groupSize.z / 2);
            group.name = file.name.replace(/\.svg$/i, '');
            scene.add(group); 
            objects.push(group);
            selectObject(group, false);
        }
        e.target.value = '';
    };
    reader.readAsText(file);
}

function createShape(type) {
    if(!type) return;
    if(type === 'bevelModal') {
        document.getElementById('bevel-modal').classList.remove('hidden');
        return;
    }
    if(type === 'tubeModal') {
        document.getElementById('tube-modal').classList.remove('hidden');
        return;
    }
    if (type === 'text') {
        document.getElementById('text-modal').classList.remove('hidden');
        return;
    }

    pushToUndo();
    const geo = createBasicGeometry(type);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.2, transmission: 0, ior: 1.5, thickness: 0, wireframe: isWireframe, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    const size = getLocalSize(mesh);
    mesh.position.set(0, 0, size.z / 2); 
    mesh.userData.trueColor = 0xcccccc;
    mesh.userData.opacity = 1;
    mesh.userData.materialType = 'matte';
    mesh.userData.randomColor = generateRandomColor();
    if (useRandomColors) mesh.material.color.setHex(mesh.userData.randomColor);
    const labelMap = {
        box: 'Cube', sphere: 'Sphere', dome: 'Dome', cylinder: 'Cylinder',
        cone: 'Cone', pyramid: 'Pyramid', wedge: 'Wedge', hexprism: 'Hex Prism',
        torus: 'Torus', knot: 'Knot', plane: 'Plane'
    };
    mesh.name = (labelMap[type] || (type.charAt(0).toUpperCase() + type.slice(1))) + " " + (objects.length + 1);
    scene.add(mesh); objects.push(mesh); selectObject(mesh, false);
}

function confirmTubeShape() {
    const outerR = parseFloat(document.getElementById('tube-outer').value) || 1.5;
    const innerR = parseFloat(document.getElementById('tube-inner').value) || 0.8;
    const height = parseFloat(document.getElementById('tube-height').value) || 2.0;
    const segments = parseInt(document.getElementById('tube-segments').value) || 32;

    if (innerR >= outerR) {
        return alert("Inner hole radius must be smaller than outer radius!");
    }

    closeTubeModal();
    pushToUndo();

    const geo = createTubeGeometry(outerR, innerR, height, segments);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.2, transmission: 0, ior: 1.5, thickness: 0, wireframe: isWireframe, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    const size = getLocalSize(mesh);
    mesh.position.set(0, 0, size.z / 2);
    mesh.userData.trueColor = 0xcccccc;
    mesh.userData.opacity = 1;
    mesh.userData.materialType = 'matte';
    mesh.userData.randomColor = generateRandomColor();
    if (useRandomColors) mesh.material.color.setHex(mesh.userData.randomColor);
    mesh.name = (segments === 6 ? "Hex Nut " : "Tube ") + (objects.length + 1);
    scene.add(mesh); objects.push(mesh); selectObject(mesh, false);
}

function confirmTextShape() {
    const userText = document.getElementById('text-input').value || "Text";
    const fontName = document.getElementById('text-font').value;
    const fontStyle = document.getElementById('text-style').value;
    const size = parseFloat(document.getElementById('text-size').value);
    const depth = parseFloat(document.getElementById('text-depth').value);

    closeTextModal();
    pushToUndo();

    // Let the user know the font is downloading
    const statusEl = document.getElementById('status-text');
    statusEl.innerText = "Downloading Font...";

    loadTextGeometry(userText, fontName, fontStyle, size, depth, 
    function(geo) {
        // Force bounding calculations so frustum culling and selection helpers work immediately
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        
        const mat = new THREE.MeshPhysicalMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.2, transmission: 0, ior: 1.5, thickness: 0, wireframe: isWireframe, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        const textSize = getLocalSize(mesh);
        mesh.position.set(0, 0, textSize.z / 2);
        mesh.userData.trueColor = 0xcccccc;
        mesh.userData.opacity = 1;
        mesh.userData.materialType = 'matte';
        mesh.userData.randomColor = generateRandomColor();
        if (useRandomColors) mesh.material.color.setHex(mesh.userData.randomColor);
        mesh.name = "Text: " + userText;
        scene.add(mesh); objects.push(mesh); selectObject(mesh, false);
        updateSelectionStatus();
    }, 
    function(error) {
        alert("Error loading font. Some styles (like Bold) might not be available for all fonts.");
        const popped = undoStack.pop(); // Revert undo push if font fetch fails
        if (popped) popped.forEach(o => disposeHierarchy(o));
        updateSelectionStatus();
    });
}

function confirmBevelShape() {
    const type = document.getElementById('bevel-type').value;
    const size = parseFloat(document.getElementById('bevel-size').value);
    const segments = parseInt(document.getElementById('bevel-segments').value);
    
    closeBevelModal();
    pushToUndo();
    
    const geo = createBevelGeometry(type, size, segments);
    let name = "Beveled " + (type === 'box' ? "Cube" : "Cylinder");
    
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.2, transmission: 0, ior: 1.5, thickness: 0, wireframe: isWireframe, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    
    mesh.position.set(0, 0, 1); 
    mesh.userData.trueColor = 0xcccccc;
    mesh.userData.opacity = 1;
    mesh.userData.materialType = 'matte';
    mesh.userData.randomColor = generateRandomColor();
    if (useRandomColors) mesh.material.color.setHex(mesh.userData.randomColor);
    mesh.name = name + " " + (objects.length + 1);
    scene.add(mesh); objects.push(mesh); selectObject(mesh, false);
}

function performBoolean(op) {
    if (selection.length < 2) return alert("Select at least 2 meshes (Shift+Click) for Boolean operations.");
    const { meshA, meshB } = getBooleanPair();
    if (!meshA.isMesh || !meshB.isMesh) return alert("Boolean operations require meshes. Please ungroup any selected groups first.");
    if (meshA.userData.locked || meshB.userData.locked) return alert("Cannot perform Boolean on a locked object.");
    pushToUndo();
    try {
        const mesh = executeBoolean(meshA, meshB, op, isWireframe);
        mesh.userData.randomColor = generateRandomColor();
        mesh.userData.isCutter = false;
        updateObjectVisuals(mesh);
        deselectAll(true);
        if (meshA.parent) meshA.parent.remove(meshA);
        if (meshB.parent) meshB.parent.remove(meshB);
        disposeHierarchy(meshA);
        disposeHierarchy(meshB);
        objects = objects.filter(o => o !== meshA && o !== meshB);
        scene.add(mesh);
        objects.push(mesh);
        selectObject(mesh, false);
        document.getElementById('status-text').innerText = `${mesh.name} created`;
    } catch (err) {
        console.error("Boolean operation failed:", err);
        alert("Boolean operation failed on these geometries.");
    }
}

function selectObject(obj, multi) {
    if (!multi) deselectAll(true);
    if (!selection.includes(obj)) { 
        selection.push(obj); 
    }
    refreshSelectionHelpers();
    refreshTransformAttachment();
    updateInspectorUI(obj); 
    document.getElementById('inspector').classList.remove('hidden');
    updateOutliner();
    updateSelectionStatus();
}

function deselectAll(skipUpdate = false) { 
    selectionHelpers.forEach(h => {
        scene.remove(h.helper);
        if (h.helper.geometry) h.helper.geometry.dispose();
        if (h.helper.material) h.helper.material.dispose();
    });
    selectionHelpers = [];
    selection = []; 
    transform.detach(); 
    document.getElementById('inspector').classList.add('hidden');
    const cutterBtn = document.getElementById('cutter-toggle');
    if (cutterBtn) cutterBtn.classList.remove('active');
    if (!skipUpdate) {
        updateOutliner();
        updateSelectionStatus();
    }
}

function onPointerUp(event) { 
    marqueeCandidate = false;
    if (isMarquee) {
        isMarquee = false;
        marqueeElem.style.display = 'none';
        orbit.enabled = true;
        
        const minX = Math.min(marqueeStart.x, event.clientX);
        const maxX = Math.max(marqueeStart.x, event.clientX);
        const minY = Math.min(marqueeStart.y, event.clientY);
        const maxY = Math.max(marqueeStart.y, event.clientY);
        
        if (maxX - minX > 4 || maxY - minY > 4) {
            if (!event.shiftKey) deselectAll(true);
            objects.forEach(obj => {
                if (!obj.visible || obj.userData.locked) return;
                const box = new THREE.Box3().setFromObject(obj);
                if (box.isEmpty()) return;
                const center = box.getCenter(new THREE.Vector3());
                const pointsToCheck = [
                    center,
                    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
                    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
                    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
                    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
                    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
                    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
                    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
                    new THREE.Vector3(box.max.x, box.max.y, box.max.z)
                ];
                let inside = false;
                for (let c of pointsToCheck) {
                    c.project(camera);
                    const sx = (c.x * 0.5 + 0.5) * window.innerWidth;
                    const sy = -(c.y * 0.5 - 0.5) * window.innerHeight;
                    if (c.z < 1 && sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) { inside = true; break; }
                }
                if (inside) selectObject(obj, true);
            });
            updateOutliner();
            updateSelectionStatus();
            return;
        }
    }

    // Only select/deselect on Left Click (button 0) without Alt
    if (event.button !== 0 || event.altKey) return;

    // If the mouse moved more than 5 pixels, it was a drag, not a click.
    if (pointerDownPosition.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return; 

    if (transform.axis !== null || event.target.closest('.panel') || event.target.tagName === 'SELECT' || event.target.tagName === 'INPUT') return; 
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1; mouse.y = -(event.clientY / window.innerHeight) * 2 + 1; 
    
    // RULER LOGIC INTERCEPT
    if (rulerActive) {
        handleRulerClick();
        return;
    }

    if (dropSurfaceActive) {
        raycaster.setFromCamera(mouse, camera);
        
        // Don't raycast against currently selected or hidden objects
        const targetObjects = objects.filter(o => {
            if (!o.visible) return false;
            let isSelected = false;
            o.traverseAncestors(p => { if (selection.includes(p)) isSelected = true; });
            return !selection.includes(o) && !isSelected;
        });

        const intersects = raycaster.intersectObjects(targetObjects, true);
        if (intersects.length > 0 && intersects[0].face) {
            const intersect = intersects[0];
            pushToUndo();
            performDropToSurface(selection, intersect.point, intersect.face.normal, intersect.object);
            updateInspectorUI(selection[selection.length - 1]);
            handleDropButton(); // Turn tool off
            document.getElementById('status-text').innerText = "Snapped to face!";
        }
        return;
    }

    const selectableObjects = objects.filter(o => o.visible && !o.userData.locked);
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(selectableObjects, true); 
    if (intersects.length > 0) { 
        let target = intersects[0].object; 
        while(target.parent && target.parent !== scene && !objects.includes(target)) target = target.parent; 
        if (!target.userData.locked) {
            selectObject(target, event.shiftKey); 
        }
    } else if (!transform.dragging) deselectAll(); 
}

function setToolMode(m) { 
    // 1. Disable "Measuring Mode" (active clicking)
    rulerActive = false;
    dropSurfaceActive = false;
    const btn = document.getElementById('tool-ruler');
    btn.classList.remove('active-ruler-mode');
    document.getElementById('tool-drop').classList.remove('active-tool');
    
    // 2. But if a measurement EXISTS, allow button to show "Visible" state
    if (rulerPoints.length > 0) {
        btn.classList.add('active-ruler-visible');
    } else {
        btn.classList.remove('active-ruler-visible');
    }

    updateSelectionStatus();
    
    transform.setMode(m); 
    document.querySelectorAll('#tool-move, #tool-rotate, #tool-scale').forEach(b => b.classList.remove('active-tool')); 
    document.getElementById(`tool-${m==='translate'?'move':m}`).classList.add('active-tool'); 

    // Scale forces Local space to prevent 3D shearing. Update UI to reflect this!
    const spaceBtn = document.getElementById('space-toggle');
    if (m === 'scale') {
        spaceBtn.innerText = "Space: LOCAL";
        spaceBtn.style.opacity = "0.5";
        spaceBtn.style.pointerEvents = "none";
    } else {
        spaceBtn.innerText = `Space: ${currentSpace.toUpperCase()}`;
        spaceBtn.style.opacity = "1";
        spaceBtn.style.pointerEvents = "auto";
        if (currentSpace === 'local') spaceBtn.classList.add('active-tool');
        else spaceBtn.classList.remove('active-tool');
    }
}

function loadProject(e) {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            objects.forEach(o => { if (o.parent) o.parent.remove(o); disposeHierarchy(o); });
            objects = [];
            undoStack.flat().forEach(o => disposeHierarchy(o));
            redoStack.flat().forEach(o => disposeHierarchy(o));
            undoStack = [];
            redoStack = [];
            deselectAll(true);
            const loader = new THREE.ObjectLoader();
            data.objects.forEach(json => {
                const o = loader.parse(json);
                forceMaterialUpgrade(o);
                scene.add(o);
                objects.push(o);
                updateObjectVisuals(o);
            });
            document.getElementById('project-name').value = file.name.replace(/\.json$/i, '');
            updateOutliner();
            document.getElementById('status-text').innerText = "Project loaded!";
        } catch (err) {
            console.error("Failed to load project:", err);
            alert("Invalid project JSON file.");
        }
        e.target.value = '';
    };
    reader.readAsText(file);
}

function groupSelected() {
    if (selection.length < 2) return;
    pushToUndo();
    const box = new THREE.Box3();
    selection.forEach(obj => box.expandByObject(obj));
    const center = new THREE.Vector3();
    if (!box.isEmpty()) box.getCenter(center);

    const group = new THREE.Group();
    group.name = "Group " + (objects.length + 1);
    group.position.copy(center);
    scene.add(group);
    group.updateMatrixWorld(true);

    selection.forEach(obj => {
        objects = objects.filter(o => o !== obj);
        group.attach(obj);
    });
    objects.push(group);
    deselectAll(true);
    selectObject(group, false);
}

function ungroupSelected() {
    const groupsToUngroup = selection.filter(o => o.isGroup && !o.userData.locked);
    if (groupsToUngroup.length === 0) return;
    pushToUndo();
    const releasedChildren = [];
    groupsToUngroup.forEach(group => {
        const parent = group.parent || scene;
        [...group.children].forEach(child => {
            parent.attach(child);
            if (parent === scene) objects.push(child);
            releasedChildren.push(child);
        });
        parent.remove(group);
        objects = objects.filter(o => o !== group);
    });
    deselectAll(true);
    releasedChildren.forEach(c => selectObject(c, true));
    updateOutliner();
}

function cloneSelected() {
    if (selection.length === 0) return;
    pushToUndo();
    const clones = [];
    selection.forEach(obj => {
        const c = deepCloneObject(obj, false);
        c.name = (obj.name || "Object") + " Copy";
        c.userData.locked = false;
        c.position.x += 0.5;
        c.traverse(child => { if(child.isMesh) { child.userData.randomColor = generateRandomColor(); } });
        updateObjectVisuals(c);
        const parent = obj.parent || scene;
        parent.add(c);
        if (parent === scene) objects.push(c);
        clones.push(c);
    });
    deselectAll(true);
    clones.forEach(c => selectObject(c, true));
}

function toggleSnap() { isSnapping = !isSnapping; document.getElementById('snap-toggle').innerText = `Grid Snap: ${isSnapping?'ON':'OFF'}`; document.getElementById('snap-toggle').classList.toggle('active'); updateSnapValue(); }
function toggleVertexSnap() { isVertexSnapping = !isVertexSnapping; document.getElementById('vertex-snap-toggle').innerText = `Vertex Snap: ${isVertexSnapping ? 'ON' : 'OFF'}`; document.getElementById('vertex-snap-toggle').classList.toggle('active'); }
function updateSnapValue() { const displayVal = parseFloat(document.getElementById('snap-val').value); const v = fromDisplay(displayVal, currentUnit); transform.translationSnap = isSnapping?v:null; transform.rotationSnap = isSnapping?THREE.MathUtils.degToRad(15):null; transform.scaleSnap = isSnapping?0.1:null; }
function setUnit(u) { 
    currentUnit = u; 
    document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active-unit')); 
    document.getElementById(`unit-${u}`).classList.add('active-unit'); 
    if(selection.length > 0) updateInspectorUI(selection[selection.length-1]); 
    document.querySelectorAll('.unit-text').forEach(el=>el.innerText=u); 
    updateSnapValue(); 
    updateSelectionStatus();
    
    // Dynamic Grid Update
    const oldGrid = scene.getObjectByName('FloorGrid');
    if (oldGrid) { scene.remove(oldGrid); oldGrid.geometry.dispose(); oldGrid.material.dispose(); }
    const size = u === 'in' ? 254 : 256; // 10 inches or 256 mm
    const divisions = u === 'in' ? 10 : 256; // 1-inch squares or 1-mm squares
    const newGrid = new THREE.GridHelper(size, divisions, isLightMode ? 0x888888 : 0x444444, isLightMode ? 0xdddddd : 0x383838);
    newGrid.rotation.x = Math.PI / 2;
    newGrid.material.depthWrite = false;
    newGrid.renderOrder = -2;
    newGrid.name = 'FloorGrid';
    scene.add(newGrid);
}


function deleteObject() { 
    const deletable = selection.filter(o => !o.userData.locked);
    if(deletable.length === 0) return;
    pushToUndo(); 
    deletable.forEach(obj => {
        if (obj.parent) obj.parent.remove(obj);
        disposeHierarchy(obj);
        objects = objects.filter(o => o !== obj);
    }); 
    deselectAll(); 
}

function toggleTheme() {
    isLightMode = !isLightMode;
    document.getElementById('theme-toggle').innerText = `Theme: ${isLightMode ? 'LIGHT' : 'DARK'}`;
    document.getElementById('theme-toggle').classList.toggle('active');
    scene.background.setHex(isLightMode ? 0xeeeeee : 0x303030);
    
    // Instantly redraw the grid in a lighter color
    const oldGrid = scene.getObjectByName('FloorGrid');
    if (oldGrid) { scene.remove(oldGrid); oldGrid.geometry.dispose(); oldGrid.material.dispose(); }
    const size = currentUnit === 'in' ? 254 : 256; 
    const divisions = currentUnit === 'in' ? 10 : 256;
    const newGrid = new THREE.GridHelper(size, divisions, isLightMode ? 0x888888 : 0x444444, isLightMode ? 0xdddddd : 0x383838);
    newGrid.rotation.x = Math.PI / 2;
    newGrid.material.depthWrite = false;
    newGrid.renderOrder = -2;
    newGrid.name = 'FloorGrid';
    scene.add(newGrid);
}

function toggleDimensions() { showDimensions = !showDimensions; document.getElementById('dim-toggle').innerText = `Dimensions: ${showDimensions ? 'ON' : 'OFF'}`; document.getElementById('dim-toggle').classList.toggle('active'); }

function toggleWireframe() { isWireframe = !isWireframe; document.getElementById('wire-toggle').classList.toggle('active'); objects.forEach(obj => updateObjectVisuals(obj)); }

function toggleBuildPlate() { 
    isBuildPlate = !isBuildPlate; 
    buildPlate.visible = isBuildPlate; 
    document.getElementById('build-plate-toggle').innerText = `Build Plate: ${isBuildPlate ? 'ON' : 'OFF'}`; 
    document.getElementById('build-plate-toggle').classList.toggle('active'); 
    updateSelectionStatus();
}


function updateOutliner() {
    const list = document.getElementById('outliner-list');
    if (!list) return;
    list.innerHTML = '';
    
    list.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); };
    list.ondrop = (e) => { e.stopPropagation(); handleDrop(e, 'root'); };

    if (objects.length === 0) {
        list.innerHTML = '<div class="status-msg" style="margin:0; padding:10px;">Scene is empty</div>';
        return;
    }

    function buildTree(parentArray, container, indent) {
        parentArray.forEach((obj, index) => {
            const item = document.createElement('div');
            let cls = 'outliner-item';
            if (selection.includes(obj)) cls += ' active';
            if (!obj.visible) cls += ' is-hidden';
            if (obj.userData.isCutter) cls += ' is-cutter';
            item.className = cls;
            item.draggable = !obj.userData.locked;
            item.style.paddingLeft = `${indent}px`;
            
            item.ondragstart = (e) => { e.dataTransfer.setData('text/plain', obj.uuid); e.stopPropagation(); };
            item.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); item.classList.add('drag-over'); };
            item.ondragleave = (e) => { e.preventDefault(); e.stopPropagation(); item.classList.remove('drag-over'); };
            item.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); item.classList.remove('drag-over'); handleDrop(e, obj); };
            item.onclick = (e) => { e.stopPropagation(); selectObject(obj, e.shiftKey); };

            const leftDiv = document.createElement('div');
            leftDiv.className = 'outliner-left';

            if (obj.isGroup) {
                const toggle = document.createElement('span');
                toggle.innerText = obj.userData.outlinerCollapsed ? "▶ " : "▼ ";
                toggle.style.cursor = "pointer";
                toggle.style.pointerEvents = "auto";
                toggle.style.display = "inline-block";
                toggle.style.width = "15px";
                toggle.style.fontSize = "0.6rem";
                toggle.onclick = (e) => {
                    e.stopPropagation();
                    obj.userData.outlinerCollapsed = !obj.userData.outlinerCollapsed;
                    updateOutliner();
                };
                leftDiv.appendChild(toggle);
            } else {
                const spacer = document.createElement('span');
                spacer.style.display = "inline-block";
                spacer.style.width = "15px";
                leftDiv.appendChild(spacer);
            }

            const text = document.createElement('span');
            const icon = obj.isGroup ? "📁 " : (obj.userData.isCutter ? "👻 " : "🧊 ");
            text.innerText = icon + (obj.name || `Object ${index + 1}`);
            text.style.pointerEvents = "none";
            leftDiv.appendChild(text);
            item.appendChild(leftDiv);

            // Right-side Visibility (Eye) and Lock icons
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'outliner-actions';

            const lockBtn = document.createElement('button');
            lockBtn.className = 'outliner-icon-btn' + (obj.userData.locked ? ' is-active' : '');
            lockBtn.innerText = obj.userData.locked ? '🔒' : '🔓';
            lockBtn.title = obj.userData.locked ? 'Unlock Object' : 'Lock Object';
            lockBtn.onclick = (e) => {
                e.stopPropagation();
                obj.userData.locked = !obj.userData.locked;
                refreshTransformAttachment();
                updateOutliner();
                updateSelectionStatus();
            };
            actionsDiv.appendChild(lockBtn);

            const eyeBtn = document.createElement('button');
            eyeBtn.className = 'outliner-icon-btn' + (!obj.visible ? ' is-active' : '');
            eyeBtn.innerText = obj.visible ? '👁' : '◡';
            eyeBtn.title = obj.visible ? 'Hide Object (H)' : 'Show Object';
            eyeBtn.onclick = (e) => {
                e.stopPropagation();
                obj.visible = !obj.visible;
                if (!obj.visible && selection.includes(obj)) {
                    selection = selection.filter(s => s !== obj);
                    refreshSelectionHelpers();
                    refreshTransformAttachment();
                    if (selection.length === 0) document.getElementById('inspector').classList.add('hidden');
                }
                updateOutliner();
                updateSelectionStatus();
            };
            actionsDiv.appendChild(eyeBtn);

            item.appendChild(actionsDiv);
            container.appendChild(item);

            if (obj.isGroup && obj.children.length > 0) {
                if (!obj.userData.outlinerCollapsed) {
                    buildTree(obj.children.filter(c => c.isMesh || c.isGroup), container, indent + 15);
                }
            }
        });
    }
    buildTree(objects, list, 10);
}

function handleDrop(e, target) {
    const draggedUUID = e.dataTransfer.getData('text/plain');
    if (!draggedUUID) return;
    
    let draggedObj = null;
    scene.traverse(c => { if(c.uuid === draggedUUID) draggedObj = c; });
    if (!draggedObj || draggedObj.userData.locked) return;

    if (target !== 'root') {
        let isChild = false;
        target.traverseAncestors(p => { if (p === draggedObj) isChild = true; });
        if (isChild || target === draggedObj) return;
    }

    pushToUndo();
    objects = objects.filter(o => o !== draggedObj);

    if (target === 'root') {
        scene.attach(draggedObj);
        objects.push(draggedObj);
    } else if (target.isGroup) {
        target.attach(draggedObj);
        target.userData.outlinerCollapsed = false; // Auto-expand when dropped into
    } else {
        target.parent.attach(draggedObj);
        if (target.parent.isGroup) target.parent.userData.outlinerCollapsed = false;
        if (target.parent === scene) objects.push(draggedObj);
    }
    updateOutliner();
}

function performArray() {
    if (selection.length === 0) return alert("Select an object to array.");
    const type = document.getElementById('array-type').value;
    const count = parseInt(document.getElementById('array-count').value);
    if (count < 2) return;

    pushToUndo();
    const target = selection[selection.length - 1];
    const newClones = [];

    const box = new THREE.Box3().setFromObject(target);
    const size = new THREE.Vector3();
    box.getSize(size);

    const dx = type === 'linear' ? (parseFloat(document.getElementById('array-dx').value) || 0) * size.x : 0;
    const dy = type === 'linear' ? (parseFloat(document.getElementById('array-dy').value) || 0) * size.y : 0;
    const dz = type === 'linear' ? (parseFloat(document.getElementById('array-dz').value) || 0) * size.z : 0;

    const axisStr = type === 'radial' ? document.getElementById('array-axis').value : 'z';
    const totalRad = type === 'radial' ? THREE.MathUtils.degToRad(parseFloat(document.getElementById('array-angle').value) || 360) : 0;
    let axisVec = new THREE.Vector3(axisStr === 'x' ? 1 : 0, axisStr === 'y' ? 1 : 0, axisStr === 'z' ? 1 : 0);

    for (let i = 1; i < count; i++) {
        const clone = deepCloneObject(target, false);
        clone.name = (target.name || "Object") + " Array " + i;
        clone.traverse(child => { if(child.isMesh) { child.userData.randomColor = generateRandomColor(); } });
        
        if (type === 'linear') {
            clone.position.add(new THREE.Vector3(dx * i, dy * i, dz * i));
        } else if (type === 'radial') {
            const stepRad = totalRad * (i / count);
            clone.position.applyAxisAngle(axisVec, stepRad);
            clone.rotateOnWorldAxis(axisVec, stepRad);
        }

        updateObjectVisuals(clone);
        const parent = target.parent || scene;
        if (parent === scene) objects.push(clone);
        parent.add(clone);
        newClones.push(clone);
    }

    document.getElementById('array-modal').classList.add('hidden');
    deselectAll(true);
    newClones.push(target);
    newClones.forEach(c => selectObject(c, true));
    updateOutliner();
    document.getElementById('status-text').innerText = "Array created";
}

function updateInspectorUI(obj) {
    const safeSet = (id, val) => {
        const el = document.getElementById(id);
        if (el && document.activeElement !== el) {
            el.value = typeof val === 'number' ? val.toFixed(2) : val;
        }
    };
    
    // Get accurate unrotated local size
    const size = getLocalSize(obj);
    
    safeSet('objName', obj.name || "Object");
    safeSet('dimX', formatVal(size.x, currentUnit));
    safeSet('dimY', formatVal(size.y, currentUnit));
    safeSet('dimZ', formatVal(size.z, currentUnit));
    safeSet('scaleX', obj.scale.x);
    safeSet('scaleY', obj.scale.y);
    safeSet('scaleZ', obj.scale.z);
    
    safeSet('posX', toDisplay(obj.position.x, currentUnit));
    safeSet('posY', toDisplay(obj.position.y, currentUnit));
    safeSet('posZ', toDisplay(obj.position.z, currentUnit));
    safeSet('rotX', toDeg(obj.rotation.x));
    safeSet('rotY', toDeg(obj.rotation.y));
    safeSet('rotZ', toDeg(obj.rotation.z));
    
    let colorHex = "#cccccc"; let opVal = 1; let matType = "matte";
    obj.traverse(c => {
        if(c.isMesh) {
            const sc = c.userData.trueColor !== undefined ? c.userData.trueColor : 0xcccccc;
            colorHex = "#" + new THREE.Color(sc).getHexString();
            opVal = c.userData.opacity !== undefined ? c.userData.opacity : 1;
            matType = c.userData.materialType || "matte";
        }
    });
    document.getElementById('objColor').value = colorHex;
    document.getElementById('objOpacity').value = opVal;
    document.getElementById('opacity-val').innerText = Math.round(opVal * 100);
    const matSelect = document.getElementById('objMaterial');
    if (matSelect) matSelect.value = matType;
}

function updateObjectFromUI(e) {
    if(selection.length === 0) return;
    const obj = selection[selection.length - 1];
    if (obj.userData.locked) return;
    const targetId = e && e.target ? e.target.id : null;
    const getVal = (id) => parseFloat(document.getElementById(id).value) || 0;

    // 1. Handle Position & Rotation only when position/rotation inputs change
    if (targetId === 'posX' || targetId === 'posY' || targetId === 'posZ') {
        obj.position.set(
            fromDisplay(getVal('posX'), currentUnit),
            fromDisplay(getVal('posY'), currentUnit),
            fromDisplay(getVal('posZ'), currentUnit)
        );
    } else if (targetId === 'rotX' || targetId === 'rotY' || targetId === 'rotZ') {
        obj.rotation.set(
            toRad(getVal('rotX')),
            toRad(getVal('rotY')),
            toRad(getVal('rotZ'))
        );
    }

    // 2. Handle Resizing (Local Scale) via Dimensions (W/D/H) or Scale (X/Y/Z)
    if (targetId === 'dimX' || targetId === 'dimY' || targetId === 'dimZ') {
        const currentSize = getLocalSize(obj);
        if (targetId === 'dimX' && currentSize.x > 0) {
            const newW = Math.max(0.001, fromDisplay(parseFloat(document.getElementById('dimX').value) || 0.001, currentUnit));
            obj.scale.x *= (newW / currentSize.x);
        } else if (targetId === 'dimY' && currentSize.y > 0) {
            const newD = Math.max(0.001, fromDisplay(parseFloat(document.getElementById('dimY').value) || 0.001, currentUnit));
            obj.scale.y *= (newD / currentSize.y);
        } else if (targetId === 'dimZ' && currentSize.z > 0) {
            const newH = Math.max(0.001, fromDisplay(parseFloat(document.getElementById('dimZ').value) || 0.001, currentUnit));
            obj.scale.z *= (newH / currentSize.z);
        }
        refreshSelectionHelpers();
        updateInspectorUI(obj);
    } else if (targetId === 'scaleX' || targetId === 'scaleY' || targetId === 'scaleZ') {
        const sx = parseFloat(document.getElementById('scaleX').value);
        const sy = parseFloat(document.getElementById('scaleY').value);
        const sz = parseFloat(document.getElementById('scaleZ').value);
        if (targetId === 'scaleX' && !isNaN(sx) && Math.abs(sx) >= 0.001) obj.scale.x = sx;
        if (targetId === 'scaleY' && !isNaN(sy) && Math.abs(sy) >= 0.001) obj.scale.y = sy;
        if (targetId === 'scaleZ' && !isNaN(sz) && Math.abs(sz) >= 0.001) obj.scale.z = sz;
        refreshSelectionHelpers();
        updateInspectorUI(obj);
    }

    // 3. Handle Material / Visuals
    if (!targetId || targetId === 'objColor' || targetId === 'objOpacity' || targetId === 'objMaterial') {
        const pickedColor = document.getElementById('objColor').value;
        const pickedOpacity = parseFloat(document.getElementById('objOpacity').value);
        const pickedMat = document.getElementById('objMaterial') ? document.getElementById('objMaterial').value : 'matte';
        obj.traverse(c => { 
            if(c.isMesh) { 
                c.userData.trueColor = parseInt(pickedColor.replace("#","0x"), 16); 
                c.userData.opacity = pickedOpacity; 
                c.userData.materialType = pickedMat;
                if (pickedMat === 'metal') {
                    c.material.roughness = 0.2; c.material.metalness = 0.8; c.material.transmission = 0; c.material.thickness = 0;
                } else if (pickedMat === 'glass') {
                    c.material.roughness = 0.05; c.material.metalness = 0.1; c.material.transmission = 0.9; c.material.ior = 1.5; c.material.thickness = 2.0;
                } else { // matte
                    c.material.roughness = 0.4; c.material.metalness = 0.2; c.material.transmission = 0; c.material.thickness = 0;
                }
            } 
        });
        updateObjectVisuals(obj);
        document.getElementById('opacity-val').innerText = Math.round(pickedOpacity * 100);
    }
    updateSelectionStatus();
}

function copySelected() {
    if (selection.length === 0) return;
    clipboard = selection.map(obj => deepCloneObject(obj, false));
    document.getElementById('status-text').innerText = "Copied to clipboard";
}

function pasteCopied() {
    if (clipboard.length === 0) return;
    pushToUndo();
    const pasted = [];
    clipboard.forEach(obj => {
        const c = deepCloneObject(obj, false);
        c.name = (obj.name || "Object") + " Pasted";
        c.userData.locked = false;
        c.position.x += 0.5; c.position.y += 0.5;
        c.traverse(child => { if(child.isMesh) { child.userData.randomColor = generateRandomColor(); } });
        updateObjectVisuals(c);
        scene.add(c); objects.push(c); pasted.push(c);
    });
    deselectAll(true);
    pasted.forEach(c => selectObject(c, true));
    document.getElementById('status-text').innerText = "Pasted from clipboard";
}

function toggleCamera() {
    isOrtho = !isOrtho;
    const prevCam = camera;
    camera = isOrtho ? orthoCamera : perspCamera;
    
    if (isOrtho) {
        const dist = prevCam.position.distanceTo(orbit.target) || 50;
        const fov = perspCamera.fov * (Math.PI / 180);
        const h = 2 * dist * Math.tan(fov / 2);
        const aspect = window.innerWidth / window.innerHeight;
        
        camera.position.copy(prevCam.position);
        camera.up.copy(prevCam.up);
        camera.lookAt(orbit.target);
        orthoCamera.left = -h * aspect / 2;
        orthoCamera.right = h * aspect / 2;
        orthoCamera.top = h / 2;
        orthoCamera.bottom = -h / 2;
        orthoCamera.near = -500;
        orthoCamera.far = 2000;
        orthoCamera.zoom = 1;
        orthoCamera.updateProjectionMatrix();
    } else {
        const dist = prevCam.position.distanceTo(orbit.target) || 50;
        const newDist = dist / (prevCam.zoom || 1);
        const dir = prevCam.position.clone().sub(orbit.target).normalize();
        
        camera.position.copy(orbit.target).add(dir.multiplyScalar(newDist));
        camera.up.copy(prevCam.up);
        camera.lookAt(orbit.target);
        
        prevCam.zoom = 1;
        prevCam.updateProjectionMatrix();
        camera.updateProjectionMatrix();
    }

    orbit.object = camera;
    transform.camera = camera;
    viewHelper = new ViewHelper(camera, document.getElementById('compass-div') || renderer.domElement);
    viewHelper.center = orbit.target;
    orbit.update();
    updateViewportGridAndLabel();
    document.getElementById('status-text').innerText = isOrtho ? "Orthographic View" : "Perspective View";
}

function setView(view) {
    // Like Blender, snapping to a Front/Right/Top/Back/Left/Bottom view enters Orthographic mode automatically
    if (!isOrtho) {
        toggleCamera();
    }

    const tgt = orbit.target.clone();
    const dist = camera.position.distanceTo(tgt) || 50;
    
    camera.up.set(0, 0, 1); 

    if (view === 'front') camera.position.set(tgt.x, tgt.y - dist, tgt.z);
    else if (view === 'back') camera.position.set(tgt.x, tgt.y + dist, tgt.z);
    else if (view === 'right') camera.position.set(tgt.x + dist, tgt.y, tgt.z);
    else if (view === 'left') camera.position.set(tgt.x - dist, tgt.y, tgt.z);
    // Tiny 0.01% Y offset prevents OrbitControls gimbal lock at the Z pole while keeping 99.999999% vertical alignment
    else if (view === 'top') camera.position.set(tgt.x, tgt.y - (dist * 0.0001), tgt.z + dist);
    else if (view === 'bottom') camera.position.set(tgt.x, tgt.y + (dist * 0.0001), tgt.z - dist);

    camera.lookAt(tgt);
    camera.updateProjectionMatrix();
    orbit.update();
    updateViewportGridAndLabel();
}

function updateViewportGridAndLabel() {
    const camDir = new THREE.Vector3().subVectors(camera.position, orbit.target).normalize();
    let alignedView = null;
    if (Math.abs(camDir.y) > 0.998) alignedView = camDir.y < 0 ? 'Front' : 'Back';
    else if (Math.abs(camDir.x) > 0.998) alignedView = camDir.x > 0 ? 'Right' : 'Left';
    else if (Math.abs(camDir.z) > 0.998) alignedView = camDir.z > 0 ? 'Top' : 'Bottom';

    const viewLabel = document.getElementById('view-label');
    if (viewLabel) {
        const projName = isOrtho ? 'Orthographic' : 'Perspective';
        viewLabel.innerText = `${alignedView || 'User'} ${projName}`;
    }

    const grid = scene.getObjectByName('FloorGrid');
    const axisGroup = scene.getObjectByName('AxisGroup');
    if (!grid || !axisGroup) return;

    const axisX = axisGroup.getObjectByName('AxisX');
    const axisY = axisGroup.getObjectByName('AxisY');
    const axisZ = axisGroup.getObjectByName('AxisZ');

    // Blender-style background grid in aligned views:
    // Instead of a horizontal floor cutting through objects in Front/Right views,
    // rotate the grid to face the camera and push it behind the scene so objects sit cleanly in front of the grid.
    if (alignedView === 'Front' || alignedView === 'Back') {
        const backY = alignedView === 'Front' ? 128 : -128;
        grid.rotation.set(0, 0, 0); // XZ vertical plane
        grid.position.set(0, backY, 0);
        axisGroup.position.set(0, backY, 0);
        if (axisX) axisX.visible = true;
        if (axisY) axisY.visible = false;
        if (axisZ) axisZ.visible = true;
    } else if (alignedView === 'Right' || alignedView === 'Left') {
        const backX = alignedView === 'Right' ? -128 : 128;
        grid.rotation.set(0, 0, Math.PI / 2); // YZ vertical plane
        grid.position.set(backX, 0, 0);
        axisGroup.position.set(backX, 0, 0);
        if (axisX) axisX.visible = false;
        if (axisY) axisY.visible = true;
        if (axisZ) axisZ.visible = true;
    } else if ((alignedView === 'Top' || alignedView === 'Bottom') && isOrtho) {
        const backZ = alignedView === 'Top' ? -128 : 128;
        grid.rotation.set(Math.PI / 2, 0, 0); // XY horizontal plane behind objects
        grid.position.set(0, 0, backZ);
        axisGroup.position.set(0, 0, backZ);
        if (axisX) axisX.visible = true;
        if (axisY) axisY.visible = true;
        if (axisZ) axisZ.visible = false;
    } else {
        // Free 3D View (User Perspective or User Orthographic): grid rests on Z=0 floor
        grid.rotation.set(Math.PI / 2, 0, 0);
        grid.position.set(0, 0, 0);
        axisGroup.position.set(0, 0, 0);
        if (axisX) axisX.visible = true;
        if (axisY) axisY.visible = true;
        if (axisZ) axisZ.visible = false;
    }
}

function toggleSpace() {
    if (transform.mode === 'scale') return; // Scale must always remain in Local space
    currentSpace = currentSpace === 'world' ? 'local' : 'world';
    transform.setSpace(currentSpace);
    document.getElementById('space-toggle').innerText = `Space: ${currentSpace.toUpperCase()}`;
    document.getElementById('space-toggle').classList.toggle('active-tool', currentSpace === 'local');
}

function closeContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) menu.classList.add('hidden');
}

function openContextMenu(e) {
    // In Blender, Right-Click cancels active modal tools first
    if (rulerActive) {
        handleRulerButton();
        return;
    }
    if (dropSurfaceActive) {
        handleDropButton();
        return;
    }

    // Raycast at right-click cursor to select an object under the cursor if not already selected
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    const selectableObjects = objects.filter(o => o.visible && !o.userData.locked);
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(selectableObjects, true);
    if (intersects.length > 0) {
        let target = intersects[0].object;
        while (target.parent && target.parent !== scene && !objects.includes(target)) target = target.parent;
        if (!target.userData.locked && !selection.includes(target)) {
            selectObject(target, e.shiftKey);
        }
    }

    const menu = document.getElementById('context-menu');
    if (!menu) return;
    menu.innerHTML = '';

    const addHeader = (title) => {
        const hdr = document.createElement('div');
        hdr.className = 'ctx-header';
        hdr.innerText = title;
        menu.appendChild(hdr);
    };

    const addDivider = () => {
        const div = document.createElement('div');
        div.className = 'ctx-divider';
        menu.appendChild(div);
    };

    const addItem = (label, shortcut, action, isDanger = false) => {
        const btn = document.createElement('button');
        btn.className = 'ctx-item' + (isDanger ? ' ctx-danger' : '');
        const spanLabel = document.createElement('span');
        spanLabel.innerText = label;
        btn.appendChild(spanLabel);
        if (shortcut) {
            const spanKey = document.createElement('span');
            spanKey.className = 'ctx-shortcut';
            spanKey.innerText = shortcut;
            btn.appendChild(spanKey);
        }
        btn.onclick = (ev) => {
            ev.stopPropagation();
            closeContextMenu();
            action();
        };
        menu.appendChild(btn);
    };

    if (selection.length > 0) {
        const last = selection[selection.length - 1];
        addHeader(selection.length > 1 ? `Object Context (${selection.length})` : `Object: ${last.name || 'Selected'}`);
        addItem('Duplicate / Clone', 'Shift+D', () => cloneSelected());
        addItem('Copy', 'Ctrl+C', () => copySelected());
        if (clipboard.length > 0) addItem('Paste', 'Ctrl+V', () => pasteCopied());
        addDivider();
        addItem(last.userData.isCutter ? 'Disable Hole Cutter 👻' : 'Make Hole Cutter 👻', '', () => toggleCutterMode());
        if (selection.length >= 2) {
            addItem('Boolean Subtract', '', () => performBoolean('subtract'));
            addItem('Boolean Union', '', () => performBoolean('union'));
            addItem('Swap Base / Cutter ⇄', '', () => swapBooleanOrder());
        }
        addDivider();
        addItem('Set Origin to Center', '', () => window.setOrigin('center'));
        addItem('Set Origin to Base', '', () => window.setOrigin('base'));
        addItem('Drop to Floor (Z=0)', '', () => window.dropToFloor());
        addItem('Snap to Grid', '', () => window.snapToGrid());
        addDivider();
        if (selection.length >= 2) addItem('Group Selected', 'Ctrl+G', () => groupSelected());
        if (selection.some(o => o.isGroup)) addItem('Ungroup', 'U', () => ungroupSelected());
        addItem('Apply Rotation & Scale', 'Ctrl+A', () => applySelectedTransform('rotscale'));
        addItem('Apply All Transforms', '', () => applySelectedTransform('all'));
        addItem('Reset Rotation', 'Alt+R', () => resetSelectedTransform('rot'));
        addItem('Reset Scale', 'Alt+S', () => resetSelectedTransform('scale'));
        addItem('Frame Selected', '.', () => frameSelected());
        addItem('Hide Selected', 'H', () => hideSelected());
        addDivider();
        addItem('Delete', 'X', () => deleteObject(), true);
    } else {
        addHeader('Scene Context Menu');
        addItem('+ Add Cube', '', () => createShape('box'));
        addItem('+ Add Cylinder', '', () => createShape('cylinder'));
        addItem('+ Add Sphere', '', () => createShape('sphere'));
        addItem('+ Add Tube / Nut...', '', () => createShape('tubeModal'));
        if (clipboard.length > 0) {
            addDivider();
            addItem('Paste', 'Ctrl+V', () => pasteCopied());
        }
        addDivider();
        addItem('Center Assembly on Plate', '', () => centerOnPlate());
        addItem('Frame All', 'Home', () => frameAll());
        addItem('Unhide All', 'Alt+H', () => unhideAll());
    }

    menu.classList.remove('hidden');
    const rect = menu.getBoundingClientRect();
    const x = Math.min(e.clientX, window.innerWidth - rect.width - 8);
    const y = Math.min(e.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
}

function openApplyMenu() {
    if (selection.length === 0) return;
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    menu.innerHTML = '';

    const hdr = document.createElement('div');
    hdr.className = 'ctx-header';
    hdr.innerText = 'Apply (Ctrl+A)';
    menu.appendChild(hdr);

    const addApplyItem = (label, hint, type) => {
        const btn = document.createElement('button');
        btn.className = 'ctx-item';
        const spanLabel = document.createElement('span');
        spanLabel.innerText = label;
        btn.appendChild(spanLabel);
        if (hint) {
            const spanKey = document.createElement('span');
            spanKey.className = 'ctx-shortcut';
            spanKey.innerText = hint;
            btn.appendChild(spanKey);
        }
        btn.onclick = (ev) => {
            ev.stopPropagation();
            closeContextMenu();
            applySelectedTransform(type);
        };
        menu.appendChild(btn);
    };

    addApplyItem('Location', 'Origin → 0,0,0', 'loc');
    addApplyItem('Rotation', 'Rot → 0°', 'rot');
    addApplyItem('Scale', 'Scale → 1.0', 'scale');
    const div = document.createElement('div');
    div.className = 'ctx-divider';
    menu.appendChild(div);
    addApplyItem('Rotation & Scale', '', 'rotscale');
    addApplyItem('All Transforms', 'Loc+Rot+Scale', 'all');

    menu.classList.remove('hidden');
    const rect = menu.getBoundingClientRect();
    const cursorX = ((mouse.x + 1) * 0.5) * window.innerWidth;
    const cursorY = ((-mouse.y + 1) * 0.5) * window.innerHeight;
    const x = Math.min(cursorX || window.innerWidth / 2, window.innerWidth - rect.width - 8);
    const y = Math.min(cursorY || window.innerHeight / 2, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
}

function onKeyDown(e) { 
    if (e.key === 'Escape') {
        closeContextMenu();
        if (rulerActive) handleRulerButton();
        if (dropSurfaceActive) handleDropButton();
        return;
    }
    if(['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return; 
    const key = e.key.toLowerCase();

    // Blender-style Reset Transforms (Alt + G / R / S), Deselect All (Alt + A), and Unhide All (Alt + H)
    if (e.altKey) {
        if (key === 'g') { e.preventDefault(); resetSelectedTransform('pos'); return; }
        if (key === 'r') { e.preventDefault(); resetSelectedTransform('rot'); return; }
        if (key === 's') { e.preventDefault(); resetSelectedTransform('scale'); return; }
        if (key === 'a') { e.preventDefault(); deselectAll(); return; }
        if (key === 'h') { e.preventDefault(); unhideAll(); return; }
    }

    if (e.ctrlKey || e.metaKey) {
        if (key === 'a') { e.preventDefault(); openApplyMenu(); return; }
        if (key === 'g') { e.preventDefault(); groupSelected(); return; }
        if (key === '1') { e.preventDefault(); setView('back'); return; }
        if (key === '3') { e.preventDefault(); setView('left'); return; }
        if (key === '7') { e.preventDefault(); setView('bottom'); return; }
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (key === 'a') { selectAll(); return; }
        if (key === 'm') setToolMode('translate'); 
        if (key === 'g') {
            if (keymapMode === 'blender') setToolMode('translate');
            else groupSelected();
        }
        if (key === 'r') setToolMode('rotate'); 
        if (key === 's') setToolMode('scale'); 
        if (key === 'q') handleRulerButton();
        if (key === 't') handleDropButton();
        if (key === 'h') hideSelected();
        if (key === '0' || key === '.') frameSelected();
        if (e.key === 'Home') { e.preventDefault(); frameAll(); }
        if (key === '5') toggleCamera(); 
        if (key === 'u') ungroupSelected(); 
        if (key === 'w') toggleSpace();
        if (key === '1') setView('front');
        if (key === '3') setView('right');
        if (key === '7') setView('top');
    }
    
    if(e.shiftKey && key === 'd') { e.preventDefault(); cloneSelected(); }
    if((e.ctrlKey||e.metaKey) && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if((e.ctrlKey||e.metaKey) && key === 'y') { e.preventDefault(); redo(); }
    if((e.ctrlKey||e.metaKey) && key === 'c') { e.preventDefault(); copySelected(); }
    if((e.ctrlKey||e.metaKey) && key === 'v') { e.preventDefault(); pasteCopied(); }
    if(e.key === 'Delete' || (!e.ctrlKey && !e.metaKey && key === 'x')) deleteObject(); 
}
function onWindowResize() { 
    const aspect = window.innerWidth / window.innerHeight;
    perspCamera.aspect = aspect; 
    perspCamera.updateProjectionMatrix(); 
    const h = orthoCamera.top - orthoCamera.bottom || 40;
    orthoCamera.left = -h * aspect / 2;
    orthoCamera.right = h * aspect / 2;
    orthoCamera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight); 
}

function updateDimensionLabels() {
    if (!showDimensions || selection.length === 0) {
        ['dim-x', 'dim-y', 'dim-z'].forEach(id => document.getElementById(id).style.display = 'none');
        return;
    }
    const obj = selection[selection.length - 1];
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;

    const size = new THREE.Vector3();
    box.getSize(size);
    
    const ptX = new THREE.Vector3(box.min.x + size.x / 2, box.min.y, box.max.z); // Width edge
    const ptY = new THREE.Vector3(box.max.x, box.min.y + size.y / 2, box.max.z); // Depth edge
    const ptZ = new THREE.Vector3(box.max.x, box.min.y, box.min.z + size.z / 2); // Height edge

    const updateLabel = (id, pt, val) => {
        const el = document.getElementById(id);
        pt.project(camera);
        if (Math.abs(pt.z) > 1) { el.style.display = 'none'; return; }
        const x = (pt.x * .5 + .5) * window.innerWidth;
        const y = (pt.y * -.5 + .5) * window.innerHeight;
        el.style.display = 'block';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.innerText = formatVal(val, currentUnit) + (currentUnit === 'mm' ? 'mm' : '"');
    };

    updateLabel('dim-x', ptX, size.x); updateLabel('dim-y', ptY, size.y); updateLabel('dim-z', ptZ, size.z);
}

function animate() { 
    requestAnimationFrame(animate); 
    
    const delta = clock.getDelta();
    if (viewHelper.animating) {
        viewHelper.update(delta);
    } else {
        orbit.update(); 
    }
    
    selectionHelpers.forEach(h => h.helper.update()); 
    
    renderer.clear();
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.render(scene, camera); 
    
    renderer.clearDepth();
    const compassEl = document.getElementById('compass-div');
    if (compassEl) {
        const rect = compassEl.getBoundingClientRect();
        const origSetViewport = renderer.setViewport.bind(renderer);
        renderer.setViewport = (x, y, w, h) => {
            if (w === 128 && h === 128) {
                origSetViewport(rect.left, window.innerHeight - rect.bottom, 128, 128);
            } else {
                origSetViewport(x, y, w, h);
            }
        };
        viewHelper.render(renderer);
        renderer.setViewport = origSetViewport;
    } else {
        viewHelper.render(renderer);
    }

    updateViewportGridAndLabel();
    updateDimensionLabels();
    if(rulerPoints.length===2) updateRulerLabel(); 
}
