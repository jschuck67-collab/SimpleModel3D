export function togglePanel(id) { 
    document.getElementById(id).classList.toggle('minimized'); 
}

export function closeTextModal() { 
    document.getElementById('text-modal').classList.add('hidden'); 
}

export function closeBevelModal() { 
    document.getElementById('bevel-modal').classList.add('hidden'); 
}

export function closeTubeModal() {
    document.getElementById('tube-modal').classList.add('hidden');
}

export function updateLighting(val, scene) {
    const intensity = val !== undefined && val !== null
        ? parseFloat(val)
        : (scene.userData.lightIntensity !== undefined ? scene.userData.lightIntensity : 1.0);
    scene.userData.lightIntensity = intensity;

    const labelEl = document.getElementById('light-val');
    if (labelEl) labelEl.innerText = Math.round(intensity * 100);

    const mode = scene.userData.lightingMode || 'world';
    const ambient = scene.getObjectByName('AmbientLight');
    const hemi = scene.getObjectByName('WorldHemiLight');
    const fillGroup = scene.getObjectByName('WorldFillGroup');
    const sun = scene.getObjectByName('SunLight');

    if (mode === 'world') {
        if (ambient) ambient.intensity = 0.85 * intensity;
        if (hemi) hemi.intensity = 0.75 * intensity;
        if (fillGroup) {
            fillGroup.visible = true;
            if (fillGroup.children[0]) fillGroup.children[0].intensity = 0.45 * intensity;
            if (fillGroup.children[1]) fillGroup.children[1].intensity = 0.35 * intensity;
            if (fillGroup.children[2]) fillGroup.children[2].intensity = 0.25 * intensity;
        }
        if (sun) sun.intensity = 0;
    } else {
        if (ambient) ambient.intensity = 0.70 * intensity;
        if (hemi) hemi.intensity = 0.35 * intensity;
        if (fillGroup) fillGroup.visible = false;
        if (sun) sun.intensity = 1.10 * intensity;
    }

    if ('environmentIntensity' in scene) {
        scene.environmentIntensity = intensity;
    }
}

export function toggleLightingMode(scene) {
    const current = scene.userData.lightingMode || 'world';
    const next = current === 'world' ? 'sun' : 'world';
    scene.userData.lightingMode = next;
    updateLighting(scene.userData.lightIntensity, scene);

    const btn = document.getElementById('light-mode-toggle');
    if (btn) {
        btn.innerText = next === 'world' ? 'Lighting: CAD World' : 'Lighting: Sun Shadow';
        btn.classList.toggle('active', next === 'world');
    }
    const statusEl = document.getElementById('status-text');
    if (statusEl) {
        statusEl.innerText = next === 'world'
            ? '360° CAD World Lighting enabled (all sides lit)'
            : 'Directional Sun Lighting enabled';
    }
}
