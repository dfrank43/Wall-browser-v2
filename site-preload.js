const { ipcRenderer } = require('electron');
// Command-click/drag on macOS; Ctrl-click/drag on Windows.
// Coordinates are obtained by the main process, never trusted from page scripts.
{ 
  const modifierPressed = event => process.platform === 'darwin' ? event.metaKey : event.ctrlKey;
  let active = false;
  window.addEventListener('mousedown', event => {
    if (!modifierPressed(event) || event.button !== 0) return;
    active = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send('wall-pointer', 'down');
  }, true);
  window.addEventListener('mousemove', event => {
    if (!active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send('wall-pointer', {kind:'move', override:event.altKey});
  }, true);
  window.addEventListener('mouseup', event => {
    if (!active) return;
    active = false;
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send('wall-pointer', 'up');
  }, true);
  window.addEventListener('click', event => {
    if (modifierPressed(event)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('blur', () => { if (active) { active = false; ipcRenderer.send('wall-pointer', 'up'); } });
}
