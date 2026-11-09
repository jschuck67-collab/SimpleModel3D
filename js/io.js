import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export function saveProject(objects) {
    const name = document.getElementById('project-name').value || "project";
    const data = { objects: objects.map(o => o.toJSON()) };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    link.download = `${name}.json`; 
    link.click();
}

function prepareExportClone(obj) {
    obj.updateMatrixWorld(true);
    const clone = obj.clone();
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    clone.updateMatrix();
    clone.applyMatrix4(obj.matrixWorld);
    clone.traverse(child => {
        if (child.isMesh && child.material) {
            child.material = child.material.clone();
            child.material.wireframe = false;
            if (child.userData.trueColor !== undefined) {
                child.material.color.setHex(child.userData.trueColor);
            }
        }
    });
    return clone;
}

export function exportGLB(objects) {
    const name = document.getElementById('project-name').value || "model";
    const exporter = new GLTFExporter();
    const exportScene = new THREE.Scene();
    objects.forEach(obj => {
        exportScene.add(prepareExportClone(obj));
    });
    exporter.parse(exportScene, function(glb) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([glb], { type: 'application/octet-stream' }));
        link.download = `${name}.glb`;
        link.click();
    }, function(err) { console.error(err); }, { binary: true });
}

export function exportSTL(objects) { 
    const name = document.getElementById('project-name').value || "model";
    const exporter = new STLExporter(); 
    const exportScene = new THREE.Scene(); 
    objects.forEach(obj => { 
        exportScene.add(prepareExportClone(obj)); 
    }); 
    const res = exporter.parse(exportScene); 
    const link = document.createElement('a'); 
    link.href = URL.createObjectURL(new Blob([res], { type: 'text/plain' })); 
    link.download = `${name}.stl`; 
    link.click(); 
}
