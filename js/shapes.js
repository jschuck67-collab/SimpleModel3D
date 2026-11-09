import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export function createBasicGeometry(type) {
    let geo;
    if (type === 'box') {
        geo = new THREE.BoxGeometry(2, 2, 2);
    } else if (type === 'sphere') {
        geo = new THREE.SphereGeometry(1, 32, 32);
        geo.rotateX(Math.PI / 2);
    } else if (type === 'dome') {
        // Closed manifold hemisphere using LatheGeometry from flat base to top pole
        const points = [];
        const radius = 1;
        const segs = 24;
        points.push(new THREE.Vector2(0, 0));
        points.push(new THREE.Vector2(radius, 0));
        for (let i = 1; i <= segs; i++) {
            const angle = (Math.PI / 2) * (i / segs);
            points.push(new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius));
        }
        geo = new THREE.LatheGeometry(points, 32);
        geo = mergeVertices(geo);
        geo.computeVertexNormals();
        geo.rotateX(Math.PI / 2);
        geo.center();
    } else if (type === 'cylinder') {
        geo = new THREE.CylinderGeometry(1, 1, 2, 32);
        geo.rotateX(Math.PI / 2);
    } else if (type === 'cone') {
        geo = new THREE.ConeGeometry(1, 2, 32);
        geo.rotateX(Math.PI / 2);
    } else if (type === 'pyramid') {
        geo = new THREE.ConeGeometry(Math.SQRT2, 2, 4);
        geo.rotateY(Math.PI / 4);
        geo.rotateX(Math.PI / 2);
    } else if (type === 'wedge') {
        const shape = new THREE.Shape();
        shape.moveTo(-1, -1);
        shape.lineTo(1, -1);
        shape.lineTo(-1, 1);
        shape.closePath();
        geo = new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false });
        geo.rotateX(Math.PI / 2);
        geo.center();
    } else if (type === 'hexprism') {
        geo = new THREE.CylinderGeometry(1, 1, 2, 6);
        geo.rotateX(Math.PI / 2);
    } else if (type === 'torus') {
        geo = new THREE.TorusGeometry(1, 0.4, 16, 48);
        geo.rotateX(Math.PI / 2);
    } else if (type === 'knot') {
        geo = new THREE.TorusKnotGeometry(0.8, 0.3, 100, 16);
    } else if (type === 'plane') {
        geo = new THREE.PlaneGeometry(5, 5);
    }
    if (geo) {
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
    }
    return geo;
}

export function createTubeGeometry(outerRadius, innerRadius, height, segments) {
    const outerR = Math.max(0.1, outerRadius);
    const innerR = Math.min(outerR - 0.05, Math.max(0.01, innerRadius));
    const segs = Math.max(3, Math.round(segments));

    const shape = new THREE.Shape();
    for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = Math.cos(a) * outerR;
        const y = Math.sin(a) * outerR;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }

    const hole = new THREE.Path();
    for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = Math.cos(a) * innerR;
        const y = Math.sin(a) * innerR;
        if (i === 0) hole.moveTo(x, y);
        else hole.lineTo(x, y);
    }
    shape.holes.push(hole);

    const geo = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.1, height),
        bevelEnabled: false,
        curveSegments: 1
    });
    geo.center();
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
}

export function createBevelGeometry(type, size, segments) {
    let geo;
    if (type === 'box') {
        geo = new RoundedBoxGeometry(2, 2, 2, segments, size);
    } else if (type === 'cylinder') {
        const points = [];
        const radius = 1;
        const halfHeight = 1;
        const actualSize = Math.min(size, Math.min(radius, halfHeight)); 

        // Build profile from bottom (-halfHeight) to top (+halfHeight) so LatheGeometry normals point outward
        points.push(new THREE.Vector2(0, -halfHeight));
        points.push(new THREE.Vector2(radius - actualSize, -halfHeight));

        for (let i = 1; i <= segments; i++) {
            const angle = -Math.PI / 2 + (Math.PI / 2) * (i / segments);
            points.push(new THREE.Vector2(
                (radius - actualSize) + Math.cos(angle) * actualSize,
                (-halfHeight + actualSize) + Math.sin(angle) * actualSize
            ));
        }
        for (let i = 0; i <= segments; i++) {
            const angle = (Math.PI / 2) * (i / segments);
            points.push(new THREE.Vector2(
                (radius - actualSize) + Math.cos(angle) * actualSize,
                (halfHeight - actualSize) + Math.sin(angle) * actualSize
            ));
        }
        points.push(new THREE.Vector2(0, halfHeight));
        
        geo = new THREE.LatheGeometry(points, 32);
        geo = mergeVertices(geo);
        geo.computeVertexNormals();
        geo.rotateX(Math.PI / 2);
    }
    if (geo) {
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
    }
    return geo;
}

export function loadTextGeometry(userText, fontName, fontStyle, size, depth, onSuccess, onError) {
    let fontPath = `${fontName}_${fontStyle}.typeface.json`;
    if (fontName.startsWith('droid_')) {
        fontPath = `droid/${fontPath}`;
    }
    const fontUrl = `https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/fonts/${fontPath}`;

    new FontLoader().load(fontUrl, function (font) {
        const textGeo = new TextGeometry(userText, {
            font: font, size: size, height: depth, curveSegments: 12,
            bevelEnabled: true, bevelThickness: size * 0.05, bevelSize: size * 0.02, bevelSegments: 3
        });
        textGeo.center();
        
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', textGeo.getAttribute('position'));
        geo.setAttribute('normal', textGeo.getAttribute('normal'));
        if (textGeo.getAttribute('uv')) geo.setAttribute('uv', textGeo.getAttribute('uv'));
        if (textGeo.getIndex()) geo.setIndex(textGeo.getIndex());
        onSuccess(geo);
    }, undefined, onError);
}
