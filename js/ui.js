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

    const ambient = scene.getObjectByName('AmbientLight');
    const hemi = scene.getObjectByName('WorldHemiLight');
    const headlamp = scene.getObjectByName('CameraHeadlamp');

    if (ambient) ambient.intensity = 0.70 * intensity;
    if (hemi) hemi.intensity = 0.60 * intensity;
    if (headlamp) headlamp.intensity = 0.50 * intensity;

    if ('environmentIntensity' in scene) {
        scene.environmentIntensity = intensity;
    }
}
