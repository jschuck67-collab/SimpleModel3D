import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { executeBoolean } from './booleanOps.js';
import { getLocalSize } from './utils.js';

/**
 * Automatically subdivides low-poly meshes (like a 12-triangle Cube, Wedge, or Pyramid)
 * so Twist, Bend, and Taper deform smoothly without requiring manual Edit-Mode subdivision.
 */
export function subdivideGeometryForDeform(geometry, minTriangles = 384) {
    let geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    let pos = geo.attributes.position;
    let passes = 0;

    while ((pos.count / 3) < minTriangles && passes < 3) {
        const triCount = pos.count / 3;
        const newPositions = new Float32Array(triCount * 4 * 9);
        let offset = 0;

        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        const vC = new THREE.Vector3();
        const mAB = new THREE.Vector3();
        const mBC = new THREE.Vector3();
        const mCA = new THREE.Vector3();

        const pushTri = (p1, p2, p3) => {
            newPositions[offset++] = p1.x; newPositions[offset++] = p1.y; newPositions[offset++] = p1.z;
            newPositions[offset++] = p2.x; newPositions[offset++] = p2.y; newPositions[offset++] = p2.z;
            newPositions[offset++] = p3.x; newPositions[offset++] = p3.y; newPositions[offset++] = p3.z;
        };

        for (let i = 0; i < pos.count; i += 3) {
            vA.fromBufferAttribute(pos, i);
            vB.fromBufferAttribute(pos, i + 1);
            vC.fromBufferAttribute(pos, i + 2);

            mAB.addVectors(vA, vB).multiplyScalar(0.5);
            mBC.addVectors(vB, vC).multiplyScalar(0.5);
            mCA.addVectors(vC, vA).multiplyScalar(0.5);

            pushTri(vA, mAB, mCA);
            pushTri(mAB, vB, mBC);
            pushTri(mCA, mBC, vC);
            pushTri(mAB, mBC, mCA);
        }

        const nextGeo = new THREE.BufferGeometry();
        nextGeo.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
        geo.dispose();
        geo = nextGeo;
        pos = geo.attributes.position;
        passes++;
    }

    geo = mergeVertices(geo, 1e-5);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
}

/**
 * Bakes local scale into a mesh's geometry so deformations operate in true physical proportions.
 */
function bakeScaleIntoMesh(mesh) {
    if (!mesh.isMesh || !mesh.geometry) return;
    if (Math.abs(mesh.scale.x - 1) < 1e-4 && Math.abs(mesh.scale.y - 1) < 1e-4 && Math.abs(mesh.scale.z - 1) < 1e-4) {
        mesh.geometry = mesh.geometry.clone();
        return;
    }
    const wasNeg = (mesh.scale.x * mesh.scale.y * mesh.scale.z) < 0;
    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.scale(mesh.scale.x, mesh.scale.y, mesh.scale.z);
    if (wasNeg && mesh.geometry.index) {
        const idx = mesh.geometry.index;
        for (let i = 0; i < idx.count; i += 3) {
            const tmp = idx.getX(i + 1);
            idx.setX(i + 1, idx.getX(i + 2));
            idx.setX(i + 2, tmp);
        }
        idx.needsUpdate = true;
    }
    mesh.scale.set(1, 1, 1);
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
}

/**
 * 1. TAPER / FLARE (Pinch or flare top relative to bottom base along X and/or Y)
 */
export function applyTaper(mesh, topScaleX = 0.5, topScaleY = 0.5) {
    if (!mesh.isMesh || !mesh.geometry) return;
    bakeScaleIntoMesh(mesh);
    mesh.geometry = subdivideGeometryForDeform(mesh.geometry, 192);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    const height = box.max.z - box.min.z;
    if (height < 1e-4) return;

    const cx = (box.min.x + box.max.x) * 0.5;
    const cy = (box.min.y + box.max.y) * 0.5;
    const pos = mesh.geometry.attributes.position;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const t = (z - box.min.z) / height; // 0 at bottom, 1 at top
        const sx = 1 + (topScaleX - 1) * t;
        const sy = 1 + (topScaleY - 1) * t;
        pos.setXYZ(i, cx + (x - cx) * sx, cy + (y - cy) * sy, z);
    }

    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
}

/**
 * 2. SHEAR / SLANT (Leans the top along X and/or Y while keeping the bottom base anchored)
 */
export function applyShear(mesh, slantX = 5, slantY = 0) {
    if (!mesh.isMesh || !mesh.geometry) return;
    bakeScaleIntoMesh(mesh);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    const height = box.max.z - box.min.z;
    if (height < 1e-4) return;

    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const t = (z - box.min.z) / height; // 0 at bottom, 1 at top
        pos.setXYZ(i, x + slantX * (t - 0.5), y + slantY * (t - 0.5), z);
    }

    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();

    // Offset object position so the bottom base remains stationary on the floor
    const localShift = new THREE.Vector3(slantX * 0.5, slantY * 0.5, 0).applyQuaternion(mesh.quaternion);
    mesh.position.add(localShift);
}

/**
 * 3. TWIST (Spiral twist around local Z, X, or Y axis from bottom to top)
 */
export function applyTwist(mesh, angleDeg = 90, axis = 'z') {
    if (!mesh.isMesh || !mesh.geometry) return;
    bakeScaleIntoMesh(mesh);
    mesh.geometry = subdivideGeometryForDeform(mesh.geometry, 512);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;

    const totalRad = THREE.MathUtils.degToRad(angleDeg);
    const pos = mesh.geometry.attributes.position;
    const center = new THREE.Vector3();
    box.getCenter(center);

    const span = axis === 'x' ? (box.max.x - box.min.x) : axis === 'y' ? (box.max.y - box.min.y) : (box.max.z - box.min.z);
    const minVal = axis === 'x' ? box.min.x : axis === 'y' ? box.min.y : box.min.z;
    if (span < 1e-4) return;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);

        const coord = axis === 'x' ? x : axis === 'y' ? y : z;
        const t = ((coord - minVal) / span) - 0.5;
        const theta = totalRad * t;
        const c = Math.cos(theta);
        const s = Math.sin(theta);

        if (axis === 'z') {
            const dx = x - center.x;
            const dy = y - center.y;
            pos.setXYZ(i, center.x + dx * c - dy * s, center.y + dx * s + dy * c, z);
        } else if (axis === 'x') {
            const dy = y - center.y;
            const dz = z - center.z;
            pos.setXYZ(i, x, center.y + dy * c - dz * s, center.z + dy * s + dz * c);
        } else {
            const dx = x - center.x;
            const dz = z - center.z;
            pos.setXYZ(i, center.x + dx * c - dz * s, y, center.z + dx * s + dz * c);
        }
    }

    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
}

/**
 * 4. BEND / ARC (Curves object along its X length into an arch in Z or horizontal curve in Y)
 */
export function applyBend(mesh, angleDeg = 90, direction = 'xy') {
    if (!mesh.isMesh || !mesh.geometry) return;
    if (Math.abs(angleDeg) < 0.5) return;
    bakeScaleIntoMesh(mesh);
    mesh.geometry = subdivideGeometryForDeform(mesh.geometry, 512);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;

    const width = box.max.x - box.min.x;
    if (width < 1e-4) return;

    const center = new THREE.Vector3();
    box.getCenter(center);

    const totalRad = THREE.MathUtils.degToRad(angleDeg);
    const radius = width / totalRad;
    const pos = mesh.geometry.attributes.position;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);

        const u = x - center.x;
        const alpha = u / radius;
        const sinA = Math.sin(alpha);
        const cosA = Math.cos(alpha);

        if (direction === 'xz') {
            // Arch Up/Down in XZ plane
            const r = radius - (z - center.z);
            pos.setXYZ(i, center.x + r * sinA, y, center.z + radius - r * cosA);
        } else {
            // Curve Front/Back in XY plane (ideal for 3D Text nameplates & curved walls)
            const r = radius - (y - center.y);
            pos.setXYZ(i, center.x + r * sinA, center.y + radius - r * cosA, z);
        }
    }

    pos.needsUpdate = true;
    mesh.geometry.computeBoundingBox();
    const newCenter = new THREE.Vector3();
    mesh.geometry.boundingBox.getCenter(newCenter);
    mesh.geometry.translate(-newCenter.x, -newCenter.y, -newCenter.z);
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
}

/**
 * 5. HOLLOW / SHELL (Carves out the inside of a shape with a specified wall thickness)
 */
export function applyHollow(mesh, wallThickness, openMode = 'top', isWireframe = false) {
    if (!mesh.isMesh || !mesh.geometry) return null;
    const size = getLocalSize(mesh);
    const t = Math.max(0.1, wallThickness);

    if (t * 2 >= size.x || t * 2 >= size.y) {
        alert("Wall thickness is too large for this object's width/depth!");
        return null;
    }
    if ((openMode === 'top' || openMode === 'bottom') && t >= size.z) {
        alert("Wall thickness is larger than the object's height!");
        return null;
    }

    const cutter = mesh.clone();
    cutter.geometry = mesh.geometry.clone();

    const ratioX = (size.x - 2 * t) / size.x;
    const ratioY = (size.y - 2 * t) / size.y;
    let ratioZ = 1;
    let localOffsetZ = 0;

    if (openMode === 'top') {
        const cutH = size.z - t + 1.0;
        ratioZ = cutH / size.z;
        localOffsetZ = (t + 1.0) * 0.5;
    } else if (openMode === 'bottom') {
        const cutH = size.z - t + 1.0;
        ratioZ = cutH / size.z;
        localOffsetZ = -(t + 1.0) * 0.5;
    } else if (openMode === 'through') {
        const cutH = size.z + 2.0;
        ratioZ = cutH / size.z;
        localOffsetZ = 0;
    } else {
        // Closed hollow shell
        if (t * 2 >= size.z) {
            alert("Wall thickness is too large for this object's height!");
            return null;
        }
        ratioZ = (size.z - 2 * t) / size.z;
        localOffsetZ = 0;
    }

    cutter.scale.set(mesh.scale.x * ratioX, mesh.scale.y * ratioY, mesh.scale.z * ratioZ);
    const worldShift = new THREE.Vector3(0, 0, localOffsetZ).applyQuaternion(mesh.quaternion);
    cutter.position.copy(mesh.position).add(worldShift);
    cutter.updateMatrixWorld(true);

    const resMesh = executeBoolean(mesh, cutter, 'subtract', isWireframe);
    resMesh.name = (mesh.name || 'Object') + ' (Hollow)';
    cutter.geometry.dispose();
    return resMesh;
}

/**
 * 6. SOLID PLANE CUT / SLICE (Cuts an object cleanly with a watertight capped CSG plane)
 */
export function applyPlaneCut(mesh, planeType = 'z', keepMode = 'pos', isWireframe = false) {
    if (!mesh.isMesh || !mesh.geometry) return [];
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return [];

    const center = new THREE.Vector3();
    box.getCenter(center);

    const big = 4000;
    const cutterGeo = new THREE.BoxGeometry(big, big, big);
    const cutterMat = new THREE.MeshBasicMaterial();
    const cutter = new THREE.Mesh(cutterGeo, cutterMat);

    // Position cutter so it covers the negative half of the chosen plane
    if (planeType === 'x') {
        cutter.position.set(center.x - big / 2, center.y, center.z);
    } else if (planeType === 'y') {
        cutter.position.set(center.x, center.y - big / 2, center.z);
    } else if (planeType === 'floor') {
        cutter.position.set(center.x, center.y, -big / 2);
    } else {
        // 'z' center
        cutter.position.set(center.x, center.y, center.z - big / 2);
    }
    cutter.updateMatrixWorld(true);

    const results = [];
    const baseName = mesh.name || 'Object';

    if (keepMode === 'pos' || keepMode === 'split') {
        // Subtract negative half -> keeps positive (Top / Right / Back) half
        const posHalf = executeBoolean(mesh, cutter, 'subtract', isWireframe);
        posHalf.name = keepMode === 'split' ? `${baseName} (Part A)` : `${baseName} (Sliced)`;
        results.push(posHalf);
    }

    if (keepMode === 'neg' || keepMode === 'split') {
        // Intersect with negative half -> keeps negative (Bottom / Left / Front) half
        const negHalf = executeBoolean(mesh, cutter, 'intersect', isWireframe);
        negHalf.name = keepMode === 'split' ? `${baseName} (Part B)` : `${baseName} (Sliced)`;
        results.push(negHalf);
    }

    cutterGeo.dispose();
    cutterMat.dispose();
    return results;
}

/**
 * 7. FACE EXTRUDE & INSET (Push out a stepped boss or carve a recessed pocket on any face)
 */
export function applyFaceExtrude(mesh, faceDirOrHit, distance, insetMargin = 0, profile = 'match', isWireframe = false) {
    if (!mesh.isMesh || !mesh.geometry || Math.abs(distance) < 0.01) return null;

    const size = getLocalSize(mesh);
    mesh.updateMatrixWorld(true);

    let localNormal = new THREE.Vector3(0, 0, 1);
    let localFaceCenter = new THREE.Vector3(0, 0, size.z / 2);
    let faceW = size.x;
    let faceH = size.y;
    let faceBasisU = new THREE.Vector3(1, 0, 0);
    let faceBasisV = new THREE.Vector3(0, 1, 0);

    if (typeof faceDirOrHit === 'string') {
        if (faceDirOrHit === 'top') {
            localNormal.set(0, 0, 1); localFaceCenter.set(0, 0, size.z / 2);
            faceW = size.x; faceH = size.y;
            faceBasisU.set(1, 0, 0); faceBasisV.set(0, 1, 0);
        } else if (faceDirOrHit === 'bottom') {
            localNormal.set(0, 0, -1); localFaceCenter.set(0, 0, -size.z / 2);
            faceW = size.x; faceH = size.y;
            faceBasisU.set(1, 0, 0); faceBasisV.set(0, -1, 0);
        } else if (faceDirOrHit === 'front') {
            localNormal.set(0, -1, 0); localFaceCenter.set(0, -size.y / 2, 0);
            faceW = size.x; faceH = size.z;
            faceBasisU.set(1, 0, 0); faceBasisV.set(0, 0, 1);
        } else if (faceDirOrHit === 'back') {
            localNormal.set(0, 1, 0); localFaceCenter.set(0, size.y / 2, 0);
            faceW = size.x; faceH = size.z;
            faceBasisU.set(-1, 0, 0); faceBasisV.set(0, 0, 1);
        } else if (faceDirOrHit === 'right') {
            localNormal.set(1, 0, 0); localFaceCenter.set(size.x / 2, 0, 0);
            faceW = size.y; faceH = size.z;
            faceBasisU.set(0, 1, 0); faceBasisV.set(0, 0, 1);
        } else if (faceDirOrHit === 'left') {
            localNormal.set(-1, 0, 0); localFaceCenter.set(-size.x / 2, 0, 0);
            faceW = size.y; faceH = size.z;
            faceBasisU.set(0, -1, 0); faceBasisV.set(0, 0, 1);
        }
    } else if (faceDirOrHit && faceDirOrHit.normal && faceDirOrHit.point) {
        // Clicked arbitrary face in 3D viewport!
        // Snap normal to closest cardinal local axis if within 10 deg, otherwise use exact clicked face normal & point
        const invQuat = mesh.quaternion.clone().invert();
        const nLocal = faceDirOrHit.normal.clone().transformDirection(mesh.matrixWorld).applyQuaternion(invQuat).normalize();

        if (Math.abs(nLocal.z) > 0.98) {
            return applyFaceExtrude(mesh, nLocal.z > 0 ? 'top' : 'bottom', distance, insetMargin, profile, isWireframe);
        } else if (Math.abs(nLocal.y) > 0.98) {
            return applyFaceExtrude(mesh, nLocal.y > 0 ? 'back' : 'front', distance, insetMargin, profile, isWireframe);
        } else if (Math.abs(nLocal.x) > 0.98) {
            return applyFaceExtrude(mesh, nLocal.x > 0 ? 'right' : 'left', distance, insetMargin, profile, isWireframe);
        }

        // Angled face (e.g. Wedge ramp face)
        localNormal.copy(nLocal);
        localFaceCenter = faceDirOrHit.point.clone().sub(mesh.position).applyQuaternion(invQuat);
        const upRef = Math.abs(localNormal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        faceBasisU.crossVectors(upRef, localNormal).normalize();
        faceBasisV.crossVectors(localNormal, faceBasisU).normalize();
        faceW = Math.min(size.x, size.y) * 0.6;
        faceH = Math.min(size.y, size.z) * 0.6;
    }

    const margin = Math.max(0, insetMargin);
    const extW = Math.max(0.2, faceW - 2 * margin);
    const extH = Math.max(0.2, faceH - 2 * margin);
    const absDist = Math.abs(distance);
    const overlap = 0.25; // slight overlap into face for clean manifold CSG union/subtraction
    const totalDepth = absDist + overlap;

    let toolGeo;
    if (profile === 'circle') {
        const radius = Math.min(extW, extH) * 0.5;
        toolGeo = new THREE.CylinderGeometry(radius, radius, totalDepth, 32);
        toolGeo.rotateX(Math.PI / 2); // Align cylinder along Z
    } else {
        toolGeo = new THREE.BoxGeometry(extW, extH, totalDepth);
    }

    // Orient toolGeo from +Z to localNormal
    const rotMat = new THREE.Matrix4().makeBasis(faceBasisU, faceBasisV, localNormal);
    const toolQuat = new THREE.Quaternion().setFromRotationMatrix(rotMat);

    const isPositive = distance > 0;
    const normalOffset = isPositive ? (absDist - overlap) * 0.5 : -(absDist - overlap) * 0.5;
    const localToolPos = localFaceCenter.clone().addScaledVector(localNormal, normalOffset);

    const toolMesh = new THREE.Mesh(toolGeo, mesh.material.clone());
    toolMesh.quaternion.copy(mesh.quaternion).multiply(toolQuat);
    const worldOffset = localToolPos.applyQuaternion(mesh.quaternion);
    toolMesh.position.copy(mesh.position).add(worldOffset);
    toolMesh.updateMatrixWorld(true);

    const op = isPositive ? 'union' : 'subtract';
    const resultMesh = executeBoolean(mesh, toolMesh, op, isWireframe);
    resultMesh.name = mesh.name || 'Extruded Object';
    toolGeo.dispose();
    return resultMesh;
}

/**
 * 8. EDGE BEVEL / 45° CHAMFER MODIFIER (Applies rounded fillet or 45-degree chamfer to selected object)
 */
export function applyEdgeBevel(mesh, bevelWidth = 1.5, style = 'fillet', shapeMode = 'box') {
    if (!mesh.isMesh || !mesh.geometry) return;
    const size = getLocalSize(mesh);
    const w = size.x, d = size.y, h = size.z;
    const segs = style === 'chamfer' ? 1 : 5;
    const maxAllowed = Math.min(w, d, h) * 0.45;
    const actualBevel = Math.max(0.05, Math.min(bevelWidth, maxAllowed));

    let newGeo;
    if (shapeMode === 'cylinder') {
        const rx = w * 0.5;
        const ry = d * 0.5;
        const halfH = h * 0.5;
        const b = Math.min(actualBevel, Math.min(rx, halfH) * 0.9);
        const points = [];

        points.push(new THREE.Vector2(0, -halfH));
        points.push(new THREE.Vector2(1 - b / rx, -halfH));

        if (segs === 1) {
            // Crisp 45-degree Chamfer
            points.push(new THREE.Vector2(1, -halfH + b));
            points.push(new THREE.Vector2(1, halfH - b));
        } else {
            for (let i = 1; i <= segs; i++) {
                const angle = -Math.PI / 2 + (Math.PI / 2) * (i / segs);
                points.push(new THREE.Vector2(
                    (1 - b / rx) + Math.cos(angle) * (b / rx),
                    (-halfH + b) + Math.sin(angle) * b
                ));
            }
            for (let i = 0; i <= segs; i++) {
                const angle = (Math.PI / 2) * (i / segs);
                points.push(new THREE.Vector2(
                    (1 - b / rx) + Math.cos(angle) * (b / rx),
                    (halfH - b) + Math.sin(angle) * b
                ));
            }
        }
        points.push(new THREE.Vector2(1 - b / rx, halfH));
        points.push(new THREE.Vector2(0, halfH));

        newGeo = new THREE.LatheGeometry(points, 36);
        newGeo = mergeVertices(newGeo);
        newGeo.rotateX(Math.PI / 2);
        newGeo.scale(rx, ry, 1);
        newGeo.computeVertexNormals();
    } else {
        // Box / Rectangular Prism at exact physical W, D, H dimensions
        newGeo = new RoundedBoxGeometry(w, d, h, segs, actualBevel);
        if (segs === 1) {
            if (newGeo.index) newGeo = newGeo.toNonIndexed();
            newGeo.computeVertexNormals();
        }
    }

    newGeo.computeBoundingBox();
    newGeo.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = newGeo;
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrixWorld(true);
}
