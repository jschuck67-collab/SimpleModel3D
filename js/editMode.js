import * as THREE from 'three';
import { formatVal } from './utils.js';

/**
 * CAD-Clean Edit Mode Engine (Bridging CAD Direct Modeling & Blender Edit Mode)
 * - Groups coplanar triangles (respecting Inset/Extrude face group IDs) into clean Logical Faces
 * - Extracts sharp Feature Edges & Inset Subdivision Edges (hiding internal triangle diagonals)
 * - Extracts true Corner Vertices
 * - Supports live 3D Gizmo Pull/Move in any direction, Rotate, Scale, Extrude (E), and Inset (I)
 */

let activeEditMesh = null;
let topology = null;
let subMode = 'face';      // 'vertex' | 'edge' | 'face'
let actionMode = 'move';   // 'move' | 'extrude' | 'inset'
let selectedFeature = null; // { type: 'face'|'edge'|'vertex', id: number }
let hoveredFeature = null;

// Visual overlay helpers inside scene
let overlayGroup = null;
let featureEdgeLines = null;
let cornerPointsMesh = null;
let selectionHighlightMesh = null;
let hoverHighlightMesh = null;

// Gizmo proxy object
let editProxy = null;
let dragState = null;

export function initEditMode(scene) {
    overlayGroup = new THREE.Group();
    overlayGroup.name = 'EditModeOverlay';
    overlayGroup.renderOrder = 900;
    scene.add(overlayGroup);

    editProxy = new THREE.Object3D();
    editProxy.name = 'EditModeGizmoProxy';
    scene.add(editProxy);
}

export function isEditModeActive() {
    return activeEditMesh !== null;
}

export function getEditMesh() {
    return activeEditMesh;
}

export function getEditProxy() {
    return editProxy;
}

export function getEditSubMode() {
    return subMode;
}

export function getEditActionMode() {
    return actionMode;
}

export function enterEditMode(mesh, transform, scene) {
    if (!mesh || !mesh.isMesh || !mesh.geometry) return false;
    activeEditMesh = mesh;

    // Bake scale into geometry so local edits match 1:1 physical units
    if (Math.abs(mesh.scale.x - 1) > 1e-4 || Math.abs(mesh.scale.y - 1) > 1e-4 || Math.abs(mesh.scale.z - 1) > 1e-4) {
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
        mesh.updateMatrixWorld(true);
    }

    // Ensure non-indexed geometry for crisp flat-shaded CAD face normals
    mesh.geometry.clearGroups();
    if (mesh.geometry.index) {
        mesh.geometry = mesh.geometry.toNonIndexed();
    } else {
        mesh.geometry = mesh.geometry.clone();
    }
    mesh.geometry.clearGroups();
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();

    rebuildEditTopology();
    selectedFeature = null;
    hoveredFeature = null;
    transform.detach();
    return true;
}

export function exitEditMode(transform) {
    activeEditMesh = null;
    topology = null;
    selectedFeature = null;
    hoveredFeature = null;
    dragState = null;
    clearOverlays();
    if (transform) transform.detach();
    hideDragBadge();
}

export function setEditSubMode(mode, transform) {
    subMode = mode; // 'vertex' | 'edge' | 'face'
    selectedFeature = null;
    hoveredFeature = null;
    if (transform) transform.detach();
    if (activeEditMesh) {
        rebuildBaseOverlays();
        updateSelectionHighlight();
    }
}

export function setEditActionMode(mode) {
    actionMode = mode; // 'move' | 'extrude' | 'inset'
}

export function rebuildEditTopology() {
    if (!activeEditMesh) return;
    topology = buildTopology(activeEditMesh.geometry, activeEditMesh);
    rebuildBaseOverlays();
    updateSelectionHighlight();
}

/**
 * Builds welded CAD topology (Logical Faces, Feature Edges, Corner Vertices) from non-indexed triangles.
 * Preserves per-triangle face group IDs (mesh.userData.triGroupIds) so coplanar Inset subdivisions remain distinct!
 */
function buildTopology(geometry, mesh) {
    const pos = geometry.attributes.position;
    const numVerts = pos.count;
    const numTris = Math.floor(numVerts / 3);

    // Check if valid per-triangle face group IDs already exist on this mesh
    let existingGroups = (mesh && Array.isArray(mesh.userData.triGroupIds) && mesh.userData.triGroupIds.length === numTris)
        ? mesh.userData.triGroupIds
        : null;

    // 1. Cluster coincident 3D vertices into Topological Vertices
    const topoVerts = [];
    const vertKeyMap = new Map();
    const attrToTopo = new Int32Array(numVerts);

    const quant = 1000; // 0.001mm welding tolerance
    for (let i = 0; i < numVerts; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const key = `${Math.round(x * quant)},${Math.round(y * quant)},${Math.round(z * quant)}`;
        let tvId = vertKeyMap.get(key);
        if (tvId === undefined) {
            tvId = topoVerts.length;
            vertKeyMap.set(key, tvId);
            topoVerts.push({
                id: tvId,
                position: new THREE.Vector3(x, y, z),
                attrIndices: [i]
            });
        } else {
            topoVerts[tvId].attrIndices.push(i);
        }
        attrToTopo[i] = tvId;
    }

    // 2. Build triangle list & normals
    const triVerts = new Array(numTris);
    const triNormals = new Array(numTris);
    const triAreas = new Float32Array(numTris);
    const edgeToTris = new Map();

    const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();

    for (let t = 0; t < numTris; t++) {
        const i0 = t * 3, i1 = t * 3 + 1, i2 = t * 3 + 2;
        const tv0 = attrToTopo[i0];
        const tv1 = attrToTopo[i1];
        const tv2 = attrToTopo[i2];
        triVerts[t] = [tv0, tv1, tv2];

        vA.copy(topoVerts[tv0].position);
        vB.copy(topoVerts[tv1].position);
        vC.copy(topoVerts[tv2].position);
        e1.subVectors(vB, vA);
        e2.subVectors(vC, vA);
        const cross = new THREE.Vector3().crossVectors(e1, e2);
        triAreas[t] = cross.length() * 0.5;
        triNormals[t] = cross.normalize();

        const pairs = [[tv0, tv1], [tv1, tv2], [tv2, tv0]];
        for (const [u, v] of pairs) {
            if (u === v) continue;
            const k = edgeKey(u, v);
            let list = edgeToTris.get(k);
            if (!list) {
                list = [];
                edgeToTris.set(k, list);
            }
            list.push(t);
        }
    }

    // 3. Flood-fill coplanar adjacent triangles into Logical Faces
    // If existingGroups is present, only merge triangles that also share the same group ID!
    const triToFace = new Int32Array(numTris).fill(-1);
    const logicalFaces = [];
    const COPLANAR_DOT = 0.992; // ~7 degrees tolerance for flat faces

    for (let t = 0; t < numTris; t++) {
        if (triToFace[t] !== -1) continue;
        const faceId = logicalFaces.length;
        const seedNormal = triNormals[t];
        const seedGroup = existingGroups ? existingGroups[t] : -1;
        const tris = [t];
        triToFace[t] = faceId;

        const queue = [t];
        while (queue.length > 0) {
            const curr = queue.pop();
            const [a, b, c] = triVerts[curr];
            const edges = [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)];
            for (const ek of edges) {
                const neighbors = edgeToTris.get(ek) || [];
                for (const nb of neighbors) {
                    if (triToFace[nb] !== -1) continue;
                    if (existingGroups && existingGroups[nb] !== seedGroup) continue;
                    if (triNormals[nb].dot(seedNormal) >= COPLANAR_DOT && triNormals[nb].dot(triNormals[curr]) >= COPLANAR_DOT) {
                        triToFace[nb] = faceId;
                        tris.push(nb);
                        queue.push(nb);
                    }
                }
            }
        }

        // Collect unique topological vertices & directed boundary edges for this logical face
        const vertSet = new Set();
        const directedEdgeCount = new Map();
        const avgNormal = new THREE.Vector3();

        for (const ti of tris) {
            const [v0, v1, v2] = triVerts[ti];
            vertSet.add(v0); vertSet.add(v1); vertSet.add(v2);
            avgNormal.addScaledVector(triNormals[ti], Math.max(1e-5, triAreas[ti]));

            const dirEdges = [[v0, v1], [v1, v2], [v2, v0]];
            for (const [u, v] of dirEdges) {
                if (u === v) continue;
                const revKey = `${v}->${u}`;
                if (directedEdgeCount.has(revKey)) {
                    // Internal shared edge within the same logical face cancels out!
                    directedEdgeCount.delete(revKey);
                } else {
                    directedEdgeCount.set(`${u}->${v}`, [u, v]);
                }
            }
        }

        avgNormal.normalize();
        const boundaryEdges = Array.from(directedEdgeCount.values());
        const topoVertIds = Array.from(vertSet);

        // Include any collinear T-junction topological vertex sitting along any boundary edge of this face when Pulling/Moving
        const moveVertSet = new Set(vertSet);
        const segVec = new THREE.Vector3();
        const ptVec = new THREE.Vector3();
        for (const [u, v] of boundaryEdges) {
            const pU = topoVerts[u].position;
            const pV = topoVerts[v].position;
            segVec.subVectors(pV, pU);
            const lenSq = segVec.lengthSq();
            if (lenSq < 1e-6) continue;
            for (let tvId = 0; tvId < topoVerts.length; tvId++) {
                if (moveVertSet.has(tvId)) continue;
                const pW = topoVerts[tvId].position;
                ptVec.subVectors(pW, pU);
                const s = ptVec.dot(segVec) / lenSq;
                if (s > 0.001 && s < 0.999) {
                    const distSq = pU.clone().addScaledVector(segVec, s).distanceToSquared(pW);
                    if (distSq < 1e-4) moveVertSet.add(tvId);
                }
            }
        }

        const center = new THREE.Vector3();
        topoVertIds.forEach(id => center.add(topoVerts[id].position));
        if (topoVertIds.length > 0) center.divideScalar(topoVertIds.length);

        logicalFaces.push({
            id: faceId,
            triangles: tris,
            topoVertIds,
            allMoveVertIds: Array.from(moveVertSet),
            boundaryEdges,
            normal: avgNormal,
            center
        });
    }

    // Save canonical triGroupIds on mesh.userData so future Inset/Extrude operations preserve face groups
    if (mesh) {
        mesh.userData.triGroupIds = Array.from(triToFace);
    }

    // 4. Extract Feature Edges (edges separating two different Logical Faces, including Inset rings!)
    const rawFeatureSegments = [];
    for (const [ek, tris] of edgeToTris.entries()) {
        const [uStr, vStr] = ek.split('_');
        const u = parseInt(uStr, 10), v = parseInt(vStr, 10);
        if (tris.length === 1) {
            const f0 = triToFace[tris[0]];
            rawFeatureSegments.push({ u, v, faces: [f0, -1] });
        } else if (tris.length >= 2) {
            const f0 = triToFace[tris[0]];
            const f1 = triToFace[tris[1]];
            if (f0 !== f1) {
                const pair = f0 < f1 ? [f0, f1] : [f1, f0];
                rawFeatureSegments.push({ u, v, faces: pair });
            }
        }
    }

    // Group collinear connected feature segments separating the same two faces into Logical Feature Edges
    const segUsed = new Uint8Array(rawFeatureSegments.length);
    const featureEdges = [];

    for (let i = 0; i < rawFeatureSegments.length; i++) {
        if (segUsed[i]) continue;
        segUsed[i] = 1;
        const seed = rawFeatureSegments[i];
        const segs = [[seed.u, seed.v]];
        const vertSet = new Set([seed.u, seed.v]);
        const seedDir = new THREE.Vector3().subVectors(topoVerts[seed.v].position, topoVerts[seed.u].position).normalize();

        let grown = true;
        while (grown) {
            grown = false;
            for (let j = 0; j < rawFeatureSegments.length; j++) {
                if (segUsed[j]) continue;
                const cand = rawFeatureSegments[j];
                if (cand.faces[0] !== seed.faces[0] || cand.faces[1] !== seed.faces[1]) continue;
                if (!vertSet.has(cand.u) && !vertSet.has(cand.v)) continue;
                const candDir = new THREE.Vector3().subVectors(topoVerts[cand.v].position, topoVerts[cand.u].position).normalize();
                if (Math.abs(candDir.dot(seedDir)) > 0.992) {
                    segUsed[j] = 1;
                    segs.push([cand.u, cand.v]);
                    vertSet.add(cand.u);
                    vertSet.add(cand.v);
                    grown = true;
                }
            }
        }

        const topoVertIds = Array.from(vertSet);
        const center = new THREE.Vector3();
        topoVertIds.forEach(id => center.add(topoVerts[id].position));
        center.divideScalar(topoVertIds.length);

        const normal = new THREE.Vector3();
        if (seed.faces[0] >= 0) normal.add(logicalFaces[seed.faces[0]].normal);
        if (seed.faces[1] >= 0) normal.add(logicalFaces[seed.faces[1]].normal);
        if (normal.lengthSq() < 1e-4) normal.set(0, 0, 1);
        else normal.normalize();

        featureEdges.push({
            id: featureEdges.length,
            segments: segs,
            topoVertIds,
            center,
            direction: seedDir,
            normal,
            faces: seed.faces
        });
    }

    // 5. Extract Corner Vertices (vertices where 2+ non-collinear feature edges meet)
    const vertEdgeDirs = new Map();
    const vertFaces = new Map();
    for (const fe of featureEdges) {
        for (const vid of fe.topoVertIds) {
            if (!vertEdgeDirs.has(vid)) vertEdgeDirs.set(vid, []);
            vertEdgeDirs.get(vid).push(fe.direction);
            if (!vertFaces.has(vid)) vertFaces.set(vid, new Set());
            if (fe.faces[0] >= 0) vertFaces.get(vid).add(fe.faces[0]);
            if (fe.faces[1] >= 0) vertFaces.get(vid).add(fe.faces[1]);
        }
    }

    const cornerVerts = [];
    for (const [vid, dirs] of vertEdgeDirs.entries()) {
        let isCorner = false;
        for (let a = 0; a < dirs.length && !isCorner; a++) {
            for (let b = a + 1; b < dirs.length; b++) {
                if (Math.abs(dirs[a].dot(dirs[b])) < 0.98) {
                    isCorner = true;
                    break;
                }
            }
        }
        if (isCorner) {
            const normal = new THREE.Vector3();
            const fSet = vertFaces.get(vid) || new Set();
            fSet.forEach(fid => normal.add(logicalFaces[fid].normal));
            if (normal.lengthSq() < 1e-4) normal.set(0, 0, 1);
            else normal.normalize();

            cornerVerts.push({
                id: cornerVerts.length,
                topoVertId: vid,
                position: topoVerts[vid].position.clone(),
                normal
            });
        }
    }

    if (cornerVerts.length === 0 && topoVerts.length > 0) {
        const step = Math.max(1, Math.floor(topoVerts.length / 64));
        for (let i = 0; i < topoVerts.length; i += step) {
            cornerVerts.push({
                id: cornerVerts.length,
                topoVertId: i,
                position: topoVerts[i].position.clone(),
                normal: topoVerts[i].position.clone().normalize()
            });
        }
    }

    return {
        topoVerts,
        triVerts,
        triToFace,
        logicalFaces,
        featureEdges,
        cornerVerts
    };
}

function clearOverlays() {
    if (!overlayGroup) return;
    while (overlayGroup.children.length > 0) {
        const c = overlayGroup.children[0];
        overlayGroup.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
    }
    featureEdgeLines = null;
    cornerPointsMesh = null;
    selectionHighlightMesh = null;
    hoverHighlightMesh = null;
}

function syncOverlayTransform() {
    if (!overlayGroup || !activeEditMesh) return;
    activeEditMesh.updateMatrixWorld(true);
    overlayGroup.position.copy(activeEditMesh.position);
    overlayGroup.quaternion.copy(activeEditMesh.quaternion);
    overlayGroup.scale.copy(activeEditMesh.scale);
    overlayGroup.updateMatrixWorld(true);
}

function rebuildBaseOverlays() {
    clearOverlays();
    if (!activeEditMesh || !topology) return;
    syncOverlayTransform();

    // 1. Always show clean CAD Feature Edges (including Inset subdivision edges, no internal triangle lines!)
    const linePts = [];
    for (const fe of topology.featureEdges) {
        for (const [u, v] of fe.segments) {
            linePts.push(topology.topoVerts[u].position.clone());
            linePts.push(topology.topoVerts[v].position.clone());
        }
    }
    if (linePts.length > 0) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
        const lineMat = new THREE.LineBasicMaterial({
            color: subMode === 'edge' ? 0x5da5f5 : 0x151515,
            transparent: true,
            opacity: subMode === 'edge' ? 0.95 : 0.75,
            depthTest: true
        });
        featureEdgeLines = new THREE.LineSegments(lineGeo, lineMat);
        featureEdgeLines.renderOrder = 901;
        overlayGroup.add(featureEdgeLines);
    }

    // 2. In Vertex Mode, display crisp CAD corner handles
    if (subMode === 'vertex' && topology.cornerVerts.length > 0) {
        const pts = topology.cornerVerts.map(cv => cv.position);
        const ptGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const ptMat = new THREE.PointsMaterial({
            color: 0x5da5f5,
            size: 8,
            sizeAttenuation: false,
            depthTest: false
        });
        cornerPointsMesh = new THREE.Points(ptGeo, ptMat);
        cornerPointsMesh.renderOrder = 905;
        overlayGroup.add(cornerPointsMesh);
    }
}

function buildFeatureHighlightObject(feature, isHover = false) {
    if (!feature || !topology || !activeEditMesh) return null;
    const color = isHover ? 0x66ccff : 0xff9f1a;

    if (feature.type === 'face') {
        const face = topology.logicalFaces[feature.id];
        if (!face) return null;
        const group = new THREE.Group();

        const posAttr = activeEditMesh.geometry.attributes.position;
        const triVerts = new Float32Array(face.triangles.length * 9);
        let offset = 0;
        const nOffset = face.normal.clone().multiplyScalar(0.015);
        for (const ti of face.triangles) {
            for (let k = 0; k < 3; k++) {
                const vi = ti * 3 + k;
                triVerts[offset++] = posAttr.getX(vi) + nOffset.x;
                triVerts[offset++] = posAttr.getY(vi) + nOffset.y;
                triVerts[offset++] = posAttr.getZ(vi) + nOffset.z;
            }
        }
        const fillGeo = new THREE.BufferGeometry();
        fillGeo.setAttribute('position', new THREE.BufferAttribute(triVerts, 3));
        const fillMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: isHover ? 0.28 : 0.45,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: false
        });
        const fillMesh = new THREE.Mesh(fillGeo, fillMat);
        fillMesh.renderOrder = 902;
        group.add(fillMesh);

        const borderPts = [];
        for (const [u, v] of face.boundaryEdges) {
            borderPts.push(topology.topoVerts[u].position.clone().add(nOffset));
            borderPts.push(topology.topoVerts[v].position.clone().add(nOffset));
        }
        if (borderPts.length > 0) {
            const bGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
            const bMat = new THREE.LineBasicMaterial({ color, depthTest: false });
            const bLines = new THREE.LineSegments(bGeo, bMat);
            bLines.renderOrder = 903;
            group.add(bLines);
        }
        return group;
    } else if (feature.type === 'edge') {
        const edge = topology.featureEdges[feature.id];
        if (!edge) return null;
        const pts = [];
        for (const [u, v] of edge.segments) {
            pts.push(topology.topoVerts[u].position.clone());
            pts.push(topology.topoVerts[v].position.clone());
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 3 });
        const lines = new THREE.LineSegments(geo, mat);
        lines.renderOrder = 904;
        return lines;
    } else if (feature.type === 'vertex') {
        const cv = topology.cornerVerts[feature.id];
        if (!cv) return null;
        const tv = topology.topoVerts[cv.topoVertId];
        const geo = new THREE.BufferGeometry().setFromPoints([tv.position.clone()]);
        const mat = new THREE.PointsMaterial({
            color,
            size: isHover ? 11 : 13,
            sizeAttenuation: false,
            depthTest: false
        });
        const pt = new THREE.Points(geo, mat);
        pt.renderOrder = 906;
        return pt;
    }
    return null;
}

function disposeObject(obj) {
    if (!obj) return;
    obj.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
    });
}

function updateSelectionHighlight() {
    if (!overlayGroup) return;
    if (selectionHighlightMesh) {
        overlayGroup.remove(selectionHighlightMesh);
        disposeObject(selectionHighlightMesh);
        selectionHighlightMesh = null;
    }
    if (selectedFeature) {
        selectionHighlightMesh = buildFeatureHighlightObject(selectedFeature, false);
        if (selectionHighlightMesh) overlayGroup.add(selectionHighlightMesh);
    }
}

function updateHoverHighlight() {
    if (!overlayGroup) return;
    if (hoverHighlightMesh) {
        overlayGroup.remove(hoverHighlightMesh);
        disposeObject(hoverHighlightMesh);
        hoverHighlightMesh = null;
    }
    if (hoveredFeature && (!selectedFeature || hoveredFeature.type !== selectedFeature.type || hoveredFeature.id !== selectedFeature.id)) {
        hoverHighlightMesh = buildFeatureHighlightObject(hoveredFeature, true);
        if (hoverHighlightMesh) overlayGroup.add(hoverHighlightMesh);
    }
}

export function pickEditFeature(raycaster, mouse, camera) {
    if (!activeEditMesh || !topology) return null;
    activeEditMesh.updateMatrixWorld(true);

    if (subMode === 'face') {
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObject(activeEditMesh, false);
        if (hits.length > 0 && hits[0].faceIndex !== undefined) {
            const fid = topology.triToFace[hits[0].faceIndex];
            if (fid !== undefined && fid >= 0) {
                return { type: 'face', id: fid };
            }
        }
        return null;
    }

    if (subMode === 'vertex') {
        let bestId = -1;
        let bestDistPx = 18;
        const mousePx = new THREE.Vector2(
            (mouse.x * 0.5 + 0.5) * window.innerWidth,
            (-mouse.y * 0.5 + 0.5) * window.innerHeight
        );
        const proj = new THREE.Vector3();

        for (const cv of topology.cornerVerts) {
            const tv = topology.topoVerts[cv.topoVertId];
            proj.copy(tv.position).applyMatrix4(activeEditMesh.matrixWorld).project(camera);
            if (proj.z > 1) continue;
            const sx = (proj.x * 0.5 + 0.5) * window.innerWidth;
            const sy = (-proj.y * 0.5 + 0.5) * window.innerHeight;
            const d = Math.hypot(sx - mousePx.x, sy - mousePx.y);
            if (d < bestDistPx) {
                bestDistPx = d;
                bestId = cv.id;
            }
        }
        return bestId >= 0 ? { type: 'vertex', id: bestId } : null;
    }

    if (subMode === 'edge') {
        let bestId = -1;
        let bestDistPx = 14;
        const mousePx = new THREE.Vector2(
            (mouse.x * 0.5 + 0.5) * window.innerWidth,
            (-mouse.y * 0.5 + 0.5) * window.innerHeight
        );
        const pA = new THREE.Vector3();
        const pB = new THREE.Vector3();
        const a2 = new THREE.Vector2();
        const b2 = new THREE.Vector2();

        for (const fe of topology.featureEdges) {
            for (const [u, v] of fe.segments) {
                pA.copy(topology.topoVerts[u].position).applyMatrix4(activeEditMesh.matrixWorld).project(camera);
                pB.copy(topology.topoVerts[v].position).applyMatrix4(activeEditMesh.matrixWorld).project(camera);
                if (pA.z > 1 && pB.z > 1) continue;
                a2.set((pA.x * 0.5 + 0.5) * window.innerWidth, (-pA.y * 0.5 + 0.5) * window.innerHeight);
                b2.set((pB.x * 0.5 + 0.5) * window.innerWidth, (-pB.y * 0.5 + 0.5) * window.innerHeight);
                const d = distToSegment2D(mousePx, a2, b2);
                if (d < bestDistPx) {
                    bestDistPx = d;
                    bestId = fe.id;
                }
            }
        }
        return bestId >= 0 ? { type: 'edge', id: bestId } : null;
    }

    return null;
}

function distToSegment2D(p, v, w) {
    const l2 = v.distanceToSquared(w);
    if (l2 === 0) return p.distanceTo(v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = v.x + t * (w.x - v.x);
    const projY = v.y + t * (w.y - v.y);
    return Math.hypot(p.x - projX, p.y - projY);
}

export function updateEditHover(raycaster, mouse, camera) {
    if (!activeEditMesh || !topology || dragState) return;
    const hit = pickEditFeature(raycaster, mouse, camera);
    const changed = (!hoveredFeature && hit) || (hoveredFeature && !hit) ||
        (hoveredFeature && hit && (hoveredFeature.type !== hit.type || hoveredFeature.id !== hit.id));
    if (changed) {
        hoveredFeature = hit;
        updateHoverHighlight();
    }
}

export function selectEditFeature(feature, transform) {
    selectedFeature = feature;
    updateSelectionHighlight();
    updateHoverHighlight();

    if (!selectedFeature || !activeEditMesh || !topology) {
        if (transform) transform.detach();
        return null;
    }

    positionProxyOnSelectedFeature();
    if (transform) {
        transform.setSpace('local');
        transform.attach(editProxy);
    }
    return selectedFeature;
}

function positionProxyOnSelectedFeature() {
    if (!selectedFeature || !activeEditMesh || !topology) return;
    activeEditMesh.updateMatrixWorld(true);

    let localCenter = new THREE.Vector3();
    let localNormal = new THREE.Vector3(0, 0, 1);
    let localTangent = new THREE.Vector3(1, 0, 0);

    if (selectedFeature.type === 'face') {
        const face = topology.logicalFaces[selectedFeature.id];
        if (!face) return;
        localCenter.copy(face.center);
        localNormal.copy(face.normal);
        const refUp = Math.abs(localNormal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        localTangent.crossVectors(refUp, localNormal).normalize();
    } else if (selectedFeature.type === 'edge') {
        const edge = topology.featureEdges[selectedFeature.id];
        if (!edge) return;
        localCenter.copy(edge.center);
        localNormal.copy(edge.normal);
        localTangent.copy(edge.direction);
        localTangent.addScaledVector(localNormal, -localTangent.dot(localNormal)).normalize();
        if (localTangent.lengthSq() < 1e-4) localTangent.set(1, 0, 0);
    } else if (selectedFeature.type === 'vertex') {
        const cv = topology.cornerVerts[selectedFeature.id];
        if (!cv) return;
        localCenter.copy(topology.topoVerts[cv.topoVertId].position);
        localNormal.copy(cv.normal);
        const refUp = Math.abs(localNormal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        localTangent.crossVectors(refUp, localNormal).normalize();
    }

    const localBitangent = new THREE.Vector3().crossVectors(localNormal, localTangent).normalize();
    localTangent.crossVectors(localBitangent, localNormal).normalize();

    const localRotMat = new THREE.Matrix4().makeBasis(localTangent, localBitangent, localNormal);
    const localQuat = new THREE.Quaternion().setFromRotationMatrix(localRotMat);

    const worldPos = localCenter.clone().applyMatrix4(activeEditMesh.matrixWorld);
    const worldQuat = activeEditMesh.quaternion.clone().multiply(localQuat);

    editProxy.position.copy(worldPos);
    editProxy.quaternion.copy(worldQuat);
    editProxy.scale.set(1, 1, 1);
    editProxy.updateMatrixWorld(true);
}

/**
 * Duplicates a Logical Face's boundary and stitches new side-wall / inset-ring triangles.
 * Assigns distinct face group IDs to the inner cap and each surrounding side/inset quad
 * so coplanar Inset subdivisions stay separate and visible!
 */
function spawnExtrudeGeometryForFace(faceId, isInset = false) {
    const face = topology.logicalFaces[faceId];
    if (!face || !activeEditMesh) return null;

    const oldPosAttr = activeEditMesh.geometry.attributes.position;
    const oldCount = oldPosAttr.count;
    const oldTriCount = Math.floor(oldCount / 3);
    const numWallTris = face.boundaryEdges.length * 2;
    const newPositions = new Float32Array((oldCount + numWallTris * 3) * 3);

    newPositions.set(oldPosAttr.array, 0);

    // Prepare updated triangle group IDs so Inset frame quads & inner cap stay distinct even when coplanar!
    const oldGroups = Array.isArray(activeEditMesh.userData.triGroupIds) && activeEditMesh.userData.triGroupIds.length === oldTriCount
        ? activeEditMesh.userData.triGroupIds
        : Array.from(topology.triToFace);
    let nextGroupId = oldGroups.reduce((m, v) => Math.max(m, v), 0) + 1;
    const newGroups = oldGroups.slice();

    const capGroupId = nextGroupId++;
    for (const ti of face.triangles) {
        newGroups[ti] = capGroupId;
    }

    // For Inset, slightly shrink the initial cap inward by 0.2% so its vertices are distinct from the outer ring
    // while staying 100% coplanar with the face! For Extrude, offset by 0.002mm along normal.
    const displacedPosMap = new Map();
    if (isInset) {
        for (const tvId of face.topoVertIds) {
            const orig = topology.topoVerts[tvId].position;
            const toCenter = new THREE.Vector3().subVectors(orig, face.center).multiplyScalar(0.995).add(face.center);
            displacedPosMap.set(tvId, toCenter);
        }
    } else {
        const eps = face.normal.clone().multiplyScalar(0.002);
        for (const tvId of face.topoVertIds) {
            displacedPosMap.set(tvId, topology.topoVerts[tvId].position.clone().add(eps));
        }
    }

    for (const ti of face.triangles) {
        const [v0, v1, v2] = topology.triVerts[ti];
        const p0 = displacedPosMap.get(v0);
        const p1 = displacedPosMap.get(v1);
        const p2 = displacedPosMap.get(v2);
        const baseIdx = ti * 9;
        newPositions[baseIdx]     = p0.x; newPositions[baseIdx + 1] = p0.y; newPositions[baseIdx + 2] = p0.z;
        newPositions[baseIdx + 3] = p1.x; newPositions[baseIdx + 4] = p1.y; newPositions[baseIdx + 5] = p1.z;
        newPositions[baseIdx + 6] = p2.x; newPositions[baseIdx + 7] = p2.y; newPositions[baseIdx + 8] = p2.z;
    }

    // Group collinear boundary edges so each straight side of the inset/extrusion shares a clean quad group ID
    let writeOffset = oldCount * 3;
    const pushVert = (v) => {
        newPositions[writeOffset++] = v.x;
        newPositions[writeOffset++] = v.y;
        newPositions[writeOffset++] = v.z;
    };

    const dirGroups = [];
    for (const [u, v] of face.boundaryEdges) {
        const uOld = topology.topoVerts[u].position;
        const vOld = topology.topoVerts[v].position;
        const uNew = displacedPosMap.get(u);
        const vNew = displacedPosMap.get(v);

        const edgeDir = new THREE.Vector3().subVectors(vOld, uOld).normalize();
        let assignedGroup = -1;
        for (const dg of dirGroups) {
            if (dg.dir.dot(edgeDir) > 0.992 && (dg.verts.has(u) || dg.verts.has(v))) {
                assignedGroup = dg.groupId;
                dg.verts.add(u);
                dg.verts.add(v);
                break;
            }
        }
        if (assignedGroup === -1) {
            assignedGroup = nextGroupId++;
            dirGroups.push({ dir: edgeDir, groupId: assignedGroup, verts: new Set([u, v]) });
        }

        // Triangle 1: (uOld, vOld, vNew)
        pushVert(uOld); pushVert(vOld); pushVert(vNew);
        newGroups.push(assignedGroup);
        // Triangle 2: (uOld, vNew, uNew)
        pushVert(uOld); pushVert(vNew); pushVert(uNew);
        newGroups.push(assignedGroup);
    }

    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
    newGeo.computeVertexNormals();
    newGeo.computeBoundingBox();
    newGeo.computeBoundingSphere();

    activeEditMesh.geometry.dispose();
    activeEditMesh.geometry = newGeo;
    activeEditMesh.userData.triGroupIds = newGroups;
    topology = buildTopology(activeEditMesh.geometry, activeEditMesh);

    const firstTri = face.triangles[0];
    const newFaceId = topology.triToFace[firstTri];
    selectedFeature = { type: 'face', id: newFaceId };
    return topology.logicalFaces[newFaceId];
}

/**
 * Splits a sharp Feature Edge into a 45-degree Chamfer / Bevel Face and stitches side faces cleanly.
 * Returns bevel drag metadata so dragging the gizmo widens or narrows the bevel in real time.
 */
function spawnBevelGeometryForEdge(edgeId) {
    const edge = topology.featureEdges[edgeId];
    if (!edge || !activeEditMesh) return null;
    const [f0, f1] = edge.faces;
    if (f0 < 0 || f1 < 0) return null;

    const face0 = topology.logicalFaces[f0];
    const face1 = topology.logicalFaces[f1];
    if (!face0 || !face1) return null;

    const edgeVertSet = new Set(edge.topoVertIds);

    // Determine canonical edge direction along face0's boundary winding
    let dir0 = edge.direction.clone();
    for (const [a, b] of face0.boundaryEdges) {
        if (edgeVertSet.has(a) && edgeVertSet.has(b)) {
            dir0.subVectors(topology.topoVerts[b].position, topology.topoVerts[a].position).normalize();
            break;
        }
    }

    // In-plane unit vectors pointing inward into face0 and face1 perpendicular to the beveled edge
    const in0 = new THREE.Vector3().crossVectors(face0.normal, dir0).normalize();
    const in1 = new THREE.Vector3().crossVectors(dir0, face1.normal).normalize();

    let maxBevelDist = Infinity;
    const slideMap0 = new Map();
    const slideMap1 = new Map();
    const origPosMap = new Map();

    for (const w of edge.topoVertIds) {
        const wPos = topology.topoVerts[w].position.clone();
        origPosMap.set(w, wPos);

        let s0 = in0.clone();
        for (const [a, b] of face0.boundaryEdges) {
            const other = (a === w && !edgeVertSet.has(b)) ? b : ((b === w && !edgeVertSet.has(a)) ? a : -1);
            if (other >= 0) {
                const vec = new THREE.Vector3().subVectors(topology.topoVerts[other].position, wPos);
                const len = vec.length();
                if (len > 1e-4) {
                    const dir = vec.normalize();
                    const cos = Math.max(0.25, dir.dot(in0));
                    s0 = dir.multiplyScalar(1 / cos);
                    maxBevelDist = Math.min(maxBevelDist, len * cos * 0.85);
                }
                break;
            }
        }
        slideMap0.set(w, s0);

        let s1 = in1.clone();
        for (const [a, b] of face1.boundaryEdges) {
            const other = (a === w && !edgeVertSet.has(b)) ? b : ((b === w && !edgeVertSet.has(a)) ? a : -1);
            if (other >= 0) {
                const vec = new THREE.Vector3().subVectors(topology.topoVerts[other].position, wPos);
                const len = vec.length();
                if (len > 1e-4) {
                    const dir = vec.normalize();
                    const cos = Math.max(0.25, dir.dot(in1));
                    s1 = dir.multiplyScalar(1 / cos);
                    maxBevelDist = Math.min(maxBevelDist, len * cos * 0.85);
                }
                break;
            }
        }
        slideMap1.set(w, s1);
    }

    if (!isFinite(maxBevelDist) || maxBevelDist <= 0.05) maxBevelDist = 10;

    // Initial tiny offset (0.005mm) so w0 and w1 weld as distinct topological vertices
    const initEps = 0.005;
    const pos0Map = new Map();
    const pos1Map = new Map();
    for (const w of edge.topoVertIds) {
        const orig = origPosMap.get(w);
        pos0Map.set(w, orig.clone().addScaledVector(slideMap0.get(w), initEps));
        pos1Map.set(w, orig.clone().addScaledVector(slideMap1.get(w), initEps));
    }

    // Identify side-face corner stitch triangles along face1's boundary edges incident to edgeVertSet
    const stitchTris = [];
    const oldPosAttr = activeEditMesh.geometry.attributes.position;
    const oldCount = oldPosAttr.count;
    const oldTriCount = Math.floor(oldCount / 3);
    const oldGroups = Array.isArray(activeEditMesh.userData.triGroupIds) && activeEditMesh.userData.triGroupIds.length === oldTriCount
        ? activeEditMesh.userData.triGroupIds
        : Array.from(topology.triToFace);
    let nextGroupId = oldGroups.reduce((m, v) => Math.max(m, v), 0) + 1;

    const findSideGroupId = (w, a) => {
        for (let t = 0; t < oldTriCount; t++) {
            const tf = topology.triToFace[t];
            if (tf === f0 || tf === f1) continue;
            const tv = topology.triVerts[t];
            if (tv.includes(w) && tv.includes(a)) return oldGroups[t];
        }
        return nextGroupId++;
    };

    for (const [x, y] of face1.boundaryEdges) {
        if (edgeVertSet.has(x) && !edgeVertSet.has(y)) {
            const w = x, a = y;
            stitchTris.push({
                pA: pos0Map.get(w),
                pB: topology.topoVerts[a].position.clone(),
                pC: pos1Map.get(w),
                groupId: findSideGroupId(w, a)
            });
        } else if (!edgeVertSet.has(x) && edgeVertSet.has(y)) {
            const a = x, w = y;
            stitchTris.push({
                pA: pos0Map.get(w),
                pB: pos1Map.get(w),
                pC: topology.topoVerts[a].position.clone(),
                groupId: findSideGroupId(w, a)
            });
        }
    }

    const numBevelTris = edge.segments.length * 2;
    const totalNewTris = numBevelTris + stitchTris.length;
    const newPositions = new Float32Array((oldCount + totalNewTris * 3) * 3);
    newPositions.set(oldPosAttr.array, 0);
    const newGroups = oldGroups.slice();

    // Update existing triangles: triangles in face1 use pos1Map; all others use pos0Map
    for (let t = 0; t < oldTriCount; t++) {
        const isF1 = (topology.triToFace[t] === f1);
        const tv = topology.triVerts[t];
        for (let k = 0; k < 3; k++) {
            const vid = tv[k];
            if (edgeVertSet.has(vid)) {
                const p = isF1 ? pos1Map.get(vid) : pos0Map.get(vid);
                const idx = (t * 3 + k) * 3;
                newPositions[idx]     = p.x;
                newPositions[idx + 1] = p.y;
                newPositions[idx + 2] = p.z;
            }
        }
    }

    let writeOffset = oldCount * 3;
    const pushVert = (v) => {
        newPositions[writeOffset++] = v.x;
        newPositions[writeOffset++] = v.y;
        newPositions[writeOffset++] = v.z;
    };

    const bevelGroupId = nextGroupId++;
    const firstBevelTriIdx = oldTriCount;

    for (const [segU, segV] of edge.segments) {
        const segVec = new THREE.Vector3().subVectors(
            topology.topoVerts[segV].position,
            topology.topoVerts[segU].position
        );
        const [u, v] = segVec.dot(dir0) >= 0 ? [segU, segV] : [segV, segU];
        const u0 = pos0Map.get(u), u1 = pos1Map.get(u);
        const v0 = pos0Map.get(v), v1 = pos1Map.get(v);

        // Quad triangles for the new Bevel Face
        pushVert(u0); pushVert(u1); pushVert(v1);
        newGroups.push(bevelGroupId);

        pushVert(u0); pushVert(v1); pushVert(v0);
        newGroups.push(bevelGroupId);
    }

    // Append side-face corner stitch triangles
    for (const st of stitchTris) {
        pushVert(st.pA); pushVert(st.pB); pushVert(st.pC);
        newGroups.push(st.groupId);
    }

    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
    newGeo.computeVertexNormals();
    newGeo.computeBoundingBox();
    newGeo.computeBoundingSphere();

    activeEditMesh.geometry.dispose();
    activeEditMesh.geometry = newGeo;
    activeEditMesh.userData.triGroupIds = newGroups;
    topology = buildTopology(activeEditMesh.geometry, activeEditMesh);

    const findNearestTopoVert = (targetPos) => {
        let bestId = 0;
        let bestD = Infinity;
        for (const tv of topology.topoVerts) {
            const d = tv.position.distanceToSquared(targetPos);
            if (d < bestD) {
                bestD = d;
                bestId = tv.id;
            }
        }
        return bestId;
    };

    const bevelPairs = [];
    for (const w of edge.topoVertIds) {
        bevelPairs.push({
            tv0: findNearestTopoVert(pos0Map.get(w)),
            tv1: findNearestTopoVert(pos1Map.get(w)),
            originPos: origPosMap.get(w),
            slideVec0: slideMap0.get(w),
            slideVec1: slideMap1.get(w)
        });
    }

    const bevelFaceId = topology.triToFace[firstBevelTriIdx];
    selectedFeature = { type: 'face', id: bevelFaceId };
    return {
        bevelFaceId,
        bevelPairs,
        maxBevelDist
    };
}

export function beginEditGizmoDrag() {
    if (!activeEditMesh || !topology || !selectedFeature) return;

    const isInset = actionMode === 'inset' && selectedFeature.type === 'face';
    const isExtrude = actionMode === 'extrude' && selectedFeature.type === 'face';
    const isBevel = actionMode === 'bevel' && selectedFeature.type === 'edge';

    let bevelInfo = null;
    if (isBevel) {
        bevelInfo = spawnBevelGeometryForEdge(selectedFeature.id);
        rebuildBaseOverlays();
        updateSelectionHighlight();
    } else if (isInset || isExtrude) {
        spawnExtrudeGeometryForFace(selectedFeature.id, isInset);
        rebuildBaseOverlays();
        updateSelectionHighlight();
    }

    let targetTopoVertIds = [];
    if (selectedFeature.type === 'face') {
        const face = topology.logicalFaces[selectedFeature.id];
        if (face) {
            targetTopoVertIds = (isInset || isExtrude)
                ? [...face.topoVertIds]
                : [...(face.allMoveVertIds || face.topoVertIds)];
        }
    } else if (selectedFeature.type === 'edge') {
        const edge = topology.featureEdges[selectedFeature.id];
        if (edge) targetTopoVertIds = [...edge.topoVertIds];
    } else if (selectedFeature.type === 'vertex') {
        const cv = topology.cornerVerts[selectedFeature.id];
        if (cv) targetTopoVertIds = [cv.topoVertId];
    }

    activeEditMesh.updateMatrixWorld(true);
    editProxy.updateMatrixWorld(true);

    const startPositions = new Map();
    const faceCenter = new THREE.Vector3();
    for (const tvId of targetTopoVertIds) {
        const p = topology.topoVerts[tvId].position.clone();
        startPositions.set(tvId, p);
        faceCenter.add(p);
    }
    if (targetTopoVertIds.length > 0) faceCenter.divideScalar(targetTopoVertIds.length);

    let avgRadius = 0;
    startPositions.forEach(p => { avgRadius += p.distanceTo(faceCenter); });
    avgRadius = Math.max(0.5, avgRadius / (startPositions.size || 1));

    dragState = {
        targetTopoVertIds,
        startPositions,
        faceCenter,
        avgRadius,
        proxyStartMatrixWorld: editProxy.matrixWorld.clone(),
        proxyStartMatrixWorldInv: editProxy.matrixWorld.clone().invert(),
        proxyStartPos: editProxy.position.clone(),
        proxyStartQuatInv: editProxy.quaternion.clone().invert(),
        meshMatrixWorld: activeEditMesh.matrixWorld.clone(),
        meshMatrixWorldInv: activeEditMesh.matrixWorld.clone().invert(),
        wasInset: isInset,
        wasBevel: isBevel && bevelInfo !== null,
        bevelInfo
    };
}

export function updateEditGizmoDrag(camera, currentUnit) {
    if (!dragState || !activeEditMesh || !topology) return;

    editProxy.updateMatrixWorld(true);

    const deltaWorld = new THREE.Matrix4().multiplyMatrices(editProxy.matrixWorld, dragState.proxyStartMatrixWorldInv);
    const deltaLocal = new THREE.Matrix4()
        .multiplyMatrices(dragState.meshMatrixWorldInv, deltaWorld)
        .multiply(dragState.meshMatrixWorld);

    const localDragVec = editProxy.position.clone().sub(dragState.proxyStartPos).applyQuaternion(dragState.proxyStartQuatInv);
    const posAttr = activeEditMesh.geometry.attributes.position;
    const tempV = new THREE.Vector3();

    if (dragState.wasBevel && dragState.bevelInfo) {
        const dragMag = localDragVec.length();
        const bevelDist = Math.max(0.01, Math.min(dragState.bevelInfo.maxBevelDist, dragMag));

        for (const pair of dragState.bevelInfo.bevelPairs) {
            tempV.copy(pair.originPos).addScaledVector(pair.slideVec0, bevelDist);
            const tv0 = topology.topoVerts[pair.tv0];
            tv0.position.copy(tempV);
            for (const ai of tv0.attrIndices) {
                posAttr.setXYZ(ai, tempV.x, tempV.y, tempV.z);
            }

            tempV.copy(pair.originPos).addScaledVector(pair.slideVec1, bevelDist);
            const tv1 = topology.topoVerts[pair.tv1];
            tv1.position.copy(tempV);
            for (const ai of tv1.attrIndices) {
                posAttr.setXYZ(ai, tempV.x, tempV.y, tempV.z);
            }
        }
        showDragBadge(`Bevel: ${formatVal(bevelDist, currentUnit)} ${currentUnit}`, dragState.proxyStartPos, camera);
    } else if (dragState.wasInset) {
        // Any drag distance on X, Y, or Z smoothly insets the selected face toward its center!
        const dragMag = localDragVec.length();
        const insetDist = Math.min(dragState.avgRadius * 0.92, dragMag);
        const scaleFactor = Math.max(0.08, (dragState.avgRadius - insetDist) / dragState.avgRadius);

        for (const tvId of dragState.targetTopoVertIds) {
            const startP = dragState.startPositions.get(tvId);
            tempV.copy(startP).sub(dragState.faceCenter).multiplyScalar(scaleFactor).add(dragState.faceCenter);
            const tv = topology.topoVerts[tvId];
            tv.position.copy(tempV);
            for (const ai of tv.attrIndices) {
                posAttr.setXYZ(ai, tempV.x, tempV.y, tempV.z);
            }
        }
        showDragBadge(`Inset: ${formatVal(insetDist, currentUnit)} ${currentUnit}`, dragState.proxyStartPos, camera);
    } else {
        for (const tvId of dragState.targetTopoVertIds) {
            const startP = dragState.startPositions.get(tvId);
            tempV.copy(startP).applyMatrix4(deltaLocal);
            const tv = topology.topoVerts[tvId];
            tv.position.copy(tempV);
            for (const ai of tv.attrIndices) {
                posAttr.setXYZ(ai, tempV.x, tempV.y, tempV.z);
            }
        }

        const dist = editProxy.position.distanceTo(dragState.proxyStartPos);
        const sign = localDragVec.z >= -1e-3 ? '+' : '-';
        const modeLabel = actionMode === 'extrude' ? 'Extrude' : 'Pull';
        showDragBadge(`${modeLabel}: ${sign}${formatVal(dist, currentUnit)} ${currentUnit}`, editProxy.position, camera);
    }

    posAttr.needsUpdate = true;
    activeEditMesh.geometry.computeVertexNormals();
    activeEditMesh.geometry.computeBoundingBox();
    activeEditMesh.geometry.computeBoundingSphere();

    if (selectedFeature && selectedFeature.type === 'face') {
        const face = topology.logicalFaces[selectedFeature.id];
        if (face) {
            face.center.set(0, 0, 0);
            face.topoVertIds.forEach(id => face.center.add(topology.topoVerts[id].position));
            face.center.divideScalar(face.topoVertIds.length || 1);
        }
    }
    rebuildBaseOverlays();
    updateSelectionHighlight();
}

export function endEditGizmoDrag() {
    if (!dragState || !activeEditMesh) return null;
    const wasInset = dragState.wasInset;
    const wasBevel = dragState.wasBevel;
    dragState = null;
    hideDragBadge();
    rebuildEditTopology();

    if (wasBevel) {
        selectedFeature = null;
        updateSelectionHighlight();
        return 'bevel_complete';
    }

    positionProxyOnSelectedFeature();

    if (wasInset) {
        actionMode = 'extrude';
        return 'switched_to_extrude';
    }
    return null;
}

function showDragBadge(text, worldPos, camera) {
    const badge = document.getElementById('edit-drag-badge');
    if (!badge || !camera) return;
    const p = worldPos.clone().project(camera);
    const x = (p.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
    badge.style.display = 'block';
    badge.style.left = `${x + 24}px`;
    badge.style.top = `${y - 24}px`;
    badge.innerText = text;
}

function hideDragBadge() {
    const badge = document.getElementById('edit-drag-badge');
    if (badge) badge.style.display = 'none';
}
