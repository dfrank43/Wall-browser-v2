const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('wallPresets', {
 list:()=>ipcRenderer.invoke('presets-list'),
 save:(name,overwrite)=>ipcRenderer.invoke('presets-save',name,overwrite),
 load:name=>ipcRenderer.invoke('presets-load',name),
 clear:()=>ipcRenderer.invoke('presets-clear'),
 remove:name=>ipcRenderer.invoke('presets-delete',name),
 onChange:callback=>ipcRenderer.on('presets-changed',()=>callback())
});
