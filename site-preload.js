const { ipcRenderer } = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('click', event => {
    if (!event.metaKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send('site-cmd-click');
  }, true);
});
