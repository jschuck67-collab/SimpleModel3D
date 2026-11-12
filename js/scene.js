import * as THREE from 'three';

export function disposeHierarchy(node) {
    node.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
        }
    });
}

export function forceMaterialUpgrade(obj) {
    obj.traverse(child => {
        if (child.isMesh && child.material) {
            const oldMat = child.material;
            const matType = child.userData.materialType || 'matte';
            const op = child.userData.opacity !== undefined ? child.userData.opacity : (oldMat.opacity !== undefined ? oldMat.opacity : 1);
            const trueColor = child.userData.trueColor !== undefined
                ? new THREE.Color(child.userData.trueColor)
                : (oldMat.color || new THREE.Color(0xcccccc));

            child.userData.trueColor = trueColor.getHex();
            child.userData.opacity = op;
            child.userData.materialType = matType;

            child.material = new THREE.MeshPhysicalMaterial({
                color: trueColor,
                roughness: matType === 'metal' ? 0.35 : matType === 'glass' ? 0.15 : (oldMat.roughness !== undefined ? oldMat.roughness : 0.55),
                metalness: matType === 'metal' ? 0.70 : matType === 'glass' ? 0.05 : (oldMat.metalness !== undefined ? oldMat.metalness : 0.05),
                transmission: matType === 'glass' ? 0.85 : (oldMat.transmission || 0),
                ior: oldMat.ior || 1.45,
                thickness: matType === 'glass' ? 1.2 : (oldMat.thickness || 0),
                wireframe: oldMat.wireframe || false,
                side: THREE.DoubleSide,
                transparent: op < 1 || matType === 'glass' || oldMat.transparent || false,
                opacity: op
            });
            oldMat.dispose();
        }
    });
}

export function updateBuildPlate(type, buildPlate, scene) {
    let w = 256, d = 256, h = 256;
    if(type === 'ender3') { w = 220; d = 220; h = 250; }
    else if(type === 'prusa4') { w = 250; d = 210; h = 220; }
    else if(type === 'mini') { w = 180; d = 180; h = 180; }

    const isVisible = buildPlate.visible;
    scene.remove(buildPlate);
    buildPlate.geometry.dispose();
    buildPlate.material.dispose();

    const bpGeo = new THREE.BoxGeometry(w, d, h);
    const bpEdges = new THREE.EdgesGeometry(bpGeo);
    const newPlate = new THREE.LineSegments(bpEdges, new THREE.LineBasicMaterial({ color: 0x3498db, transparent: true, opacity: 0.5 }));
    newPlate.position.set(0, 0, h / 2);
    newPlate.visible = isVisible;
    scene.add(newPlate);
    return newPlate;
}
