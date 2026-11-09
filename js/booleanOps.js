import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg';

const csgEvaluator = new Evaluator();
csgEvaluator.attributes = ['position', 'normal'];

function createPreparedBrush(mesh) {
    mesh.updateMatrixWorld(true);
    let geo = mesh.geometry.clone();
    if (!geo.attributes.normal) {
        geo.computeVertexNormals();
    }
    // Bake world transform into brush geometry so parent groups and negative mirror scales work cleanly
    geo.applyMatrix4(mesh.matrixWorld);
    if (mesh.matrixWorld.determinant() < 0) {
        // Flip winding order when mirrored on an odd number of axes
        if (geo.index) {
            const index = geo.index.array;
            for (let i = 0; i < index.length; i += 3) {
                const tmp = index[i + 1];
                index[i + 1] = index[i + 2];
                index[i + 2] = tmp;
            }
            geo.index.needsUpdate = true;
        } else {
            const pos = geo.attributes.position.array;
            for (let i = 0; i < pos.length; i += 9) {
                for (let k = 0; k < 3; k++) {
                    const tmp = pos[i + 3 + k];
                    pos[i + 3 + k] = pos[i + 6 + k];
                    pos[i + 6 + k] = tmp;
                }
            }
            geo.attributes.position.needsUpdate = true;
        }
        geo.computeVertexNormals();
    }
    const brush = new Brush(geo, mesh.material);
    brush.updateMatrixWorld();
    return brush;
}

export function executeBoolean(meshA, meshB, op, isWireframe) {
    const brushA = createPreparedBrush(meshA);
    const brushB = createPreparedBrush(meshB);
    
    const res = csgEvaluator.evaluate(brushA, brushB, op === 'subtract' ? SUBTRACTION : op === 'union' ? ADDITION : INTERSECTION);
    
    // Center the resulting geometry so its pivot is at its bounding box center
    res.geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    if (res.geometry.boundingBox && !res.geometry.boundingBox.isEmpty()) {
        res.geometry.boundingBox.getCenter(center);
        res.geometry.translate(-center.x, -center.y, -center.z);
        res.geometry.computeBoundingBox();
        res.geometry.computeBoundingSphere();
    }

    const trueColor = meshA.userData.trueColor !== undefined ? meshA.userData.trueColor : 0xcccccc;
    const opacity = meshA.userData.opacity !== undefined ? meshA.userData.opacity : 1;
    const matType = meshA.userData.materialType || 'matte';

    const mat = new THREE.MeshPhysicalMaterial({
        color: trueColor,
        roughness: matType === 'metal' ? 0.2 : matType === 'glass' ? 0.05 : 0.4,
        metalness: matType === 'metal' ? 0.8 : matType === 'glass' ? 0.1 : 0.2,
        transmission: matType === 'glass' ? 0.9 : 0,
        ior: 1.5,
        thickness: matType === 'glass' ? 2.0 : 0,
        transparent: opacity < 1 || matType === 'glass',
        opacity: opacity,
        wireframe: isWireframe,
        side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(res.geometry, mat);
    mesh.userData.trueColor = trueColor;
    mesh.userData.opacity = opacity;
    mesh.userData.materialType = matType;
    mesh.position.copy(center);
    mesh.name = op.charAt(0).toUpperCase() + op.slice(1) + " Result";
    
    brushA.geometry.dispose();
    brushB.geometry.dispose();
    return mesh;
}
