import * as THREE from 'three';
import { fromDisplay, formatVal, getLocalSize } from './utils.js';

export function snapToGrid(selection, currentUnit) {
    const displayVal = parseFloat(document.getElementById('snap-val').value) || 1;
    const snap = fromDisplay(displayVal, currentUnit);
    selection.forEach(obj => {
        if (obj.userData.locked) return;
        obj.position.x = Math.round(obj.position.x / snap) * snap;
        obj.position.y = Math.round(obj.position.y / snap) * snap;
        obj.position.z = Math.round(obj.position.z / snap) * snap;
    });
}

export function dropToFloor(selection) {
    selection.forEach(obj => {
        if (obj.userData.locked) return;
        const box = new THREE.Box3().setFromObject(obj);
        if (!box.isEmpty()) {
            obj.position.z -= box.min.z;
        }
    });
}

export function resetTransform(selection, type) {
    selection.forEach(obj => {
        if (obj.userData.locked) return;
        if (type === 'pos') {
            const size = getLocalSize(obj);
            obj.position.set(0, 0, size.z / 2);
        } else if (type === 'rot') {
            obj.rotation.set(0, 0, 0);
        } else if (type === 'scale') {
            obj.scale.set(1, 1, 1);
        }
    });
}

export function applyTransform(selection, type) {
    selection.forEach(obj => {
        if (obj.userData.locked) return;

        const doLoc = (type === 'loc' || type === 'all');
        const doRot = (type === 'rot' || type === 'rotscale' || type === 'all');
        const doScale = (type === 'scale' || type === 'rotscale' || type === 'all');

        obj.updateMatrix();
        const oldMatrix = obj.matrix.clone();

        const newPos = doLoc ? new THREE.Vector3(0, 0, 0) : obj.position.clone();
        const newQuat = doRot ? new THREE.Quaternion() : obj.quaternion.clone();
        const newScale = doScale ? new THREE.Vector3(1, 1, 1) : obj.scale.clone();

        const newMatrix = new THREE.Matrix4().compose(newPos, newQuat, newScale);
        const deltaMatrix = newMatrix.clone().invert().multiply(oldMatrix);

        if (obj.isGroup) {
            obj.children.forEach(child => {
                if (child.isMesh || child.isGroup) {
                    child.applyMatrix4(deltaMatrix);
                }
            });
            obj.position.copy(newPos);
            obj.quaternion.copy(newQuat);
            obj.scale.copy(newScale);
            obj.updateMatrixWorld(true);
            return;
        }

        if (!obj.geometry) return;

        const wasNegativeScale = (obj.scale.x * obj.scale.y * obj.scale.z) < 0;
        obj.geometry = obj.geometry.clone();
        obj.geometry.applyMatrix4(deltaMatrix);

        if (doScale && wasNegativeScale) {
            const index = obj.geometry.index;
            if (index) {
                for (let i = 0; i < index.count; i += 3) {
                    const tmp = index.getX(i + 1);
                    index.setX(i + 1, index.getX(i + 2));
                    index.setX(i + 2, tmp);
                }
                index.needsUpdate = true;
            } else {
                const pos = obj.geometry.attributes.position;
                if (pos) {
                    for (let i = 0; i < pos.count; i += 3) {
                        const x1 = pos.getX(i + 1), y1 = pos.getY(i + 1), z1 = pos.getZ(i + 1);
                        pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
                        pos.setXYZ(i + 2, x1, y1, z1);
                    }
                    pos.needsUpdate = true;
                }
            }
        }

        obj.geometry.computeVertexNormals();
        obj.geometry.computeBoundingBox();
        obj.geometry.computeBoundingSphere();

        obj.position.copy(newPos);
        obj.quaternion.copy(newQuat);
        obj.scale.copy(newScale);
        obj.updateMatrixWorld(true);
    });
}

export function centerAssemblyOnPlate(targetObjects) {
    const unlocked = targetObjects.filter(o => o.visible && !o.userData.locked);
    if (unlocked.length === 0) return false;
    const combinedBox = new THREE.Box3();
    unlocked.forEach(obj => combinedBox.expandByObject(obj));
    if (combinedBox.isEmpty()) return false;

    const center = new THREE.Vector3();
    combinedBox.getCenter(center);
    const offsetX = -center.x;
    const offsetY = -center.y;
    const offsetZ = -combinedBox.min.z;

    unlocked.forEach(obj => {
        obj.position.x += offsetX;
        obj.position.y += offsetY;
        obj.position.z += offsetZ;
    });
    return true;
}

export function getPrinterDimensions(type) {
    let w = 256, d = 256, h = 256;
    if (type === 'ender3') { w = 220; d = 220; h = 250; }
    else if (type === 'prusa4') { w = 250; d = 210; h = 220; }
    else if (type === 'mini') { w = 180; d = 180; h = 180; }
    return { w, d, h };
}

export function checkBuildVolume(objects, selection, printerType, currentUnit) {
    const { w, d, h } = getPrinterDimensions(printerType);
    const halfW = w / 2;
    const halfD = d / 2;

    let outOfBounds = false;
    objects.forEach(obj => {
        if (!obj.visible) return;
        const box = new THREE.Box3().setFromObject(obj);
        if (box.isEmpty()) return;
        if (box.min.x < -halfW - 0.01 || box.max.x > halfW + 0.01 ||
            box.min.y < -halfD - 0.01 || box.max.y > halfD + 0.01 ||
            box.min.z < -0.05 || box.max.z > h + 0.01) {
            outOfBounds = true;
        }
    });

    let floatWarning = null;
    if (selection.length > 0) {
        const last = selection[selection.length - 1];
        const box = new THREE.Box3().setFromObject(last);
        if (!box.isEmpty()) {
            const unitStr = currentUnit === 'mm' ? 'mm' : 'in';
            if (box.min.z > 0.05) {
                floatWarning = `⚠️ Floating (+${formatVal(box.min.z, currentUnit)}${unitStr} above bed)`;
            } else if (box.min.z < -0.05) {
                floatWarning = `⚠️ Below bed (${formatVal(box.min.z, currentUnit)}${unitStr})`;
            }
        }
    }

    return { outOfBounds, floatWarning };
}

export function setOrigin(selection, type) {
    selection.forEach(obj => {
        if (obj.userData.locked) return;
        if (obj.isGroup) {
            const box = new THREE.Box3().setFromObject(obj);
            if (box.isEmpty()) return;
            const center = new THREE.Vector3();
            box.getCenter(center);
            if (type === 'base') center.z = box.min.z;
            
            const parent = obj.parent;
            const children = [...obj.children];
            if (parent) {
                children.forEach(c => parent.attach(c));
                obj.position.copy(center);
                obj.updateMatrixWorld(true);
                children.forEach(c => obj.attach(c));
            }
            return;
        }
        if (!obj.geometry) return;
        
        obj.geometry = obj.geometry.clone();
        obj.geometry.computeBoundingBox();
        const localCenter = new THREE.Vector3();
        obj.geometry.boundingBox.getCenter(localCenter);
        if (type === 'base') localCenter.z = obj.geometry.boundingBox.min.z;
        
        obj.geometry.translate(-localCenter.x, -localCenter.y, -localCenter.z);
        obj.geometry.computeBoundingBox();
        obj.geometry.computeBoundingSphere();
        const deltaWorld = localCenter.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(obj.quaternion).scale(obj.scale));
        obj.position.add(deltaWorld);
    });
}

export function alignObjects(selection, axis, type) {
    const keyObject = selection[selection.length - 1];
    const keyBox = new THREE.Box3().setFromObject(keyObject);
    let targetVal = 0;
    
    if (type === 'min') targetVal = keyBox.min[axis];
    else if (type === 'max') targetVal = keyBox.max[axis];
    else targetVal = (keyBox.min[axis] + keyBox.max[axis]) / 2;

    selection.forEach(obj => {
        if (obj === keyObject || obj.userData.locked) return;
        const objBox = new THREE.Box3().setFromObject(obj);
        let objCenter = (objBox.min[axis] + objBox.max[axis]) / 2;
        
        let offset = 0;
        if (type === 'min') offset = targetVal - objBox.min[axis];
        else if (type === 'max') offset = targetVal - objBox.max[axis];
        else offset = targetVal - objCenter;

        obj.position[axis] += offset;
    });
}

export function performDropToSurface(selection, point, localNormal, targetMesh) {
    const worldNormal = localNormal.clone().transformDirection(targetMesh.matrixWorld).normalize();
    selection.forEach(obj => {
        if (obj.userData.locked) return;
        const currentZ = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion).normalize();
        const alignQuat = new THREE.Quaternion().setFromUnitVectors(currentZ, worldNormal);
        obj.quaternion.premultiply(alignQuat);
        obj.position.copy(point);
        obj.updateMatrixWorld(true);
        
        let minProj = Infinity;
        obj.traverse(child => {
            if (child.isMesh && child.geometry) {
                const pos = child.geometry.attributes.position;
                const wMat = child.matrixWorld;
                for (let i = 0; i < pos.count; i++) {
                    const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(wMat);
                    const offsetV = v.clone().sub(point);
                    const proj = offsetV.dot(worldNormal);
                    if (proj < minProj) minProj = proj;
                }
            }
        });
        
        if (minProj !== Infinity) obj.position.add(worldNormal.clone().multiplyScalar(-minProj));
    });
}
