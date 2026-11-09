import * as THREE from 'three';

export const toDeg = (rad) => rad * (180 / Math.PI);
export const toRad = (deg) => deg * (Math.PI / 180);

export function formatVal(v, currentUnit = 'mm') { 
    return (currentUnit === 'in' ? v / 25.4 : v).toFixed(currentUnit === 'in' ? 2 : 1); 
}

export function toDisplay(v, currentUnit = 'mm') { 
    return currentUnit === 'in' ? v / 25.4 : v; 
}

export function fromDisplay(v, currentUnit = 'mm') { 
    return currentUnit === 'in' ? v * 25.4 : v; 
}

export function generateRandomColor() { 
    return new THREE.Color().setHSL((Math.random() + 0.618) % 1, 0.7, 0.5).getHex(); 
}

export function getLocalSize(obj) {
    if (obj.isMesh && obj.geometry) {
        if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
        const size = new THREE.Vector3();
        obj.geometry.boundingBox.getSize(size);
        size.x *= Math.abs(obj.scale.x);
        size.y *= Math.abs(obj.scale.y);
        size.z *= Math.abs(obj.scale.z);
        return size;
    }
    const savedPos = obj.position.clone();
    const savedQuat = obj.quaternion.clone();
    obj.position.set(0, 0, 0);
    obj.quaternion.identity();
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    obj.position.copy(savedPos);
    obj.quaternion.copy(savedQuat);
    obj.updateMatrixWorld(true);
    return size;
}
