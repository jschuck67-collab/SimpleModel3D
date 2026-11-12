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

/**
 * Eliminates CSG T-junctions by splitting any triangle edge (u -> v) that has another
 * mesh vertex lying strictly on its interior segment. Ensures adjacent faces after
 * Boolean operations share all boundary vertices so pulling/extruding faces never leaves pinned mid-edge vertices.
 */
export function resolveTJunctions(geometry, mesh = null) {
    if (!geometry || !geometry.attributes.position) return geometry;
    geometry.clearGroups();
    if (geometry.index) {
        geometry = geometry.toNonIndexed();
        geometry.clearGroups();
    }
    const pos = geometry.attributes.position;
    const numVerts = pos.count;
    const numTris = Math.floor(numVerts / 3);
    if (numTris === 0) return geometry;

    const quant = 1000;
    const uniquePts = [];
    const keyToPt = new Map();
    const getCanonicalPt = (x, y, z) => {
        const k = `${Math.round(x * quant)},${Math.round(y * quant)},${Math.round(z * quant)}`;
        let pt = keyToPt.get(k);
        if (!pt) {
            pt = new THREE.Vector3(x, y, z);
            keyToPt.set(k, pt);
            uniquePts.push(pt);
        }
        return pt;
    };

    const tris = [];
    const hasGroups = mesh && Array.isArray(mesh.userData?.triGroupIds) && mesh.userData.triGroupIds.length === numTris;
    for (let t = 0; t < numTris; t++) {
        const i0 = t * 3, i1 = t * 3 + 1, i2 = t * 3 + 2;
        const a = getCanonicalPt(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
        const b = getCanonicalPt(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
        const c = getCanonicalPt(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
        if (a === b || b === c || c === a) continue;
        tris.push({
            a, b, c,
            group: hasGroups ? mesh.userData.triGroupIds[t] : -1
        });
    }

    const finalTris = [];
    const ab = new THREE.Vector3();
    const ap = new THREE.Vector3();
    const proj = new THREE.Vector3();
    const distTolSq = 1e-4; // 0.01mm perpendicular tolerance
    const endTol = 1e-3;    // 0.001mm endpoint margin

    const findSplitPointOnEdge = (u, v) => {
        ab.subVectors(v, u);
        const lenSq = ab.lengthSq();
        if (lenSq < 1e-5) return null;
        const len = Math.sqrt(lenSq);
        const sMargin = Math.min(0.05, endTol / len);

        const minX = Math.min(u.x, v.x) - endTol, maxX = Math.max(u.x, v.x) + endTol;
        const minY = Math.min(u.y, v.y) - endTol, maxY = Math.max(u.y, v.y) + endTol;
        const minZ = Math.min(u.z, v.z) - endTol, maxZ = Math.max(u.z, v.z) + endTol;

        let bestPt = null;
        let bestMidDist = Infinity;

        for (let i = 0; i < uniquePts.length; i++) {
            const p = uniquePts[i];
            if (p === u || p === v) continue;
            if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY || p.z < minZ || p.z > maxZ) continue;
            ap.subVectors(p, u);
            const s = ap.dot(ab) / lenSq;
            if (s <= sMargin || s >= 1 - sMargin) continue;
            proj.copy(u).addScaledVector(ab, s);
            if (proj.distanceToSquared(p) <= distTolSq) {
                const midDist = Math.abs(s - 0.5);
                if (midDist < bestMidDist) {
                    bestMidDist = midDist;
                    bestPt = p;
                }
            }
        }
        return bestPt;
    };

    let splitCount = 0;
    const maxSplits = 2000;
    while (tris.length > 0) {
        const tri = tris.pop();
        if (splitCount >= maxSplits) {
            finalTris.push(tri);
            continue;
        }
        const { a, b, c, group } = tri;
        const pAB = findSplitPointOnEdge(a, b);
        if (pAB) {
            splitCount++;
            tris.push({ a, b: pAB, c, group }, { a: pAB, b, c, group });
            continue;
        }
        const pBC = findSplitPointOnEdge(b, c);
        if (pBC) {
            splitCount++;
            tris.push({ a, b, c: pBC, group }, { a, b: pBC, c, group });
            continue;
        }
        const pCA = findSplitPointOnEdge(c, a);
        if (pCA) {
            splitCount++;
            tris.push({ a, b, c: pCA, group }, { a: pCA, b, c, group });
            continue;
        }
        finalTris.push(tri);
    }

    if (splitCount === 0) return geometry;

    const newPositions = new Float32Array(finalTris.length * 9);
    const newGroups = hasGroups ? new Array(finalTris.length) : null;
    for (let i = 0; i < finalTris.length; i++) {
        const t = finalTris[i];
        const base = i * 9;
        newPositions[base]     = t.a.x; newPositions[base + 1] = t.a.y; newPositions[base + 2] = t.a.z;
        newPositions[base + 3] = t.b.x; newPositions[base + 4] = t.b.y; newPositions[base + 5] = t.b.z;
        newPositions[base + 6] = t.c.x; newPositions[base + 7] = t.c.y; newPositions[base + 8] = t.c.z;
        if (hasGroups) newGroups[i] = t.group;
    }

    geometry.clearGroups();
    geometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    if (hasGroups && mesh) {
        mesh.userData.triGroupIds = newGroups;
    }
    return geometry;
}
