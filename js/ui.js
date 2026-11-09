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
    const intensity = parseFloat(val);
    document.getElementById('light-val').innerText = Math.round(intensity * 100);
    const ambient = scene.getObjectByName('AmbientLight');
    const sun = scene.getObjectByName('SunLight');
    if(ambient) ambient.intensity = 0.6 * intensity;
    if(sun) sun.intensity = 1.0 * intensity;
}
