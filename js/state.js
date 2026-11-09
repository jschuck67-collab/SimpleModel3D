export function saveAutosave(objects, projectName) {
    if (objects.length > 0) {
        const data = { objects: objects.map(o => o.toJSON()) };
        localStorage.setItem('jscad_autosave', JSON.stringify(data));
        localStorage.setItem('jscad_project_name', projectName);
    } else {
        localStorage.removeItem('jscad_autosave');
        localStorage.removeItem('jscad_project_name');
    }
}

export function clearAutosave() {
    localStorage.removeItem('jscad_autosave');
    localStorage.removeItem('jscad_project_name');
}