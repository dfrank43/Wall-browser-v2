const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('browserSettings', {
  get: () => ipcRenderer.invoke('get-settings'),
  save: config => ipcRenderer.invoke('save-settings', config),
  cancel: () => ipcRenderer.invoke('cancel-settings')
});
