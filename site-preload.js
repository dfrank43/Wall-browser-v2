const { ipcRenderer } = require('electron');
// Command-click opens settings; Command-drag moves the containing window.
// Coordinates are obtained by the main process, never trusted from page scripts.
{ 
  let active = false;
  window.addEventListener('mousedown', event => {
    if (!event.metaKey || event.button !== 0) return;
    active = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send('wall-pointer', 'down');
  }, true);
  window.addEventListener('mousemove', event => {
    if (!active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send('wall-pointer', 'move');
  }, true);
  window.addEventListener('mouseup', event => {
    if (!active) return;
    active = false;
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send('wall-pointer', 'up');
  }, true);
  window.addEventListener('click', event => {
    if (event.metaKey) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('blur', () => { if (active) { active = false; ipcRenderer.send('wall-pointer', 'up'); } });
}
