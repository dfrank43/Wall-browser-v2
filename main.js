const { app, BrowserWindow, BrowserView, ipcMain, Menu, screen, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const {overlaps, moveNoOverlap, placeWithoutOverlap} = require('./collision');
// Allow synchronized HTML5 video/audio to start without a user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let storePath;
let presetPath;
let presets = {};
let presetManager = null;
let suppressLayoutSave = false;
let saved = [];
const instances = new Map();
let quitting = false;
let saveTimer = null;
let lastLayout = [];
const dragStates = new Map();
const settingsPopups = new Map();
const IS_MAC = process.platform === 'darwin';
const DEFAULT = { url: 'https://example.com', width: 900, ratio: '16:9', muted: false };
function parseRatio(r) {
  const m = String(r).match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
  if (!m || +m[1] <= 0 || +m[2] <= 0) throw new Error('Ratio must be like 16:9 or 4:3');
  return +m[1] / +m[2];
}
function normalizeUrl(raw) {
  const input = String(raw || '').trim();
  if (!input || input.toLowerCase() === 'about:blank') return 'about:blank'; // Blank imported screens must survive both URL normalization passes.
  const hasScheme = /^https?:\/\//i.test(input);
  const isLocal = /^(?:localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.local)(?::\d+)?(?:[/?#]|$)/i.test(input);
  const url = new URL(hasScheme ? input : `${isLocal ? 'http' : 'https'}://${input}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https URLs are supported');
  return url.href;
}
function snapshot() {
  return [...instances.values()].filter(entry => {
    try { return !entry.win.isDestroyed() && !entry.win.webContents.isDestroyed(); }
    catch { return false; }
  }).map(entry => {
    try { const {x,y} = entry.win.getBounds(); return {...entry.config,x,y}; }
    catch { return null; }
  }).filter(Boolean);
}
function save() {
  if (quitting || suppressLayoutSave || !storePath) return;
  lastLayout = snapshot();
  try { fs.writeFileSync(storePath, JSON.stringify(lastLayout, null, 2)); }
  catch (err) { console.error('Could not save window layout:', err); }
}
function scheduleSave() {
  if (quitting || suppressLayoutSave) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 200);
}
function resizeContent(entry) {
  if (entry.win.isDestroyed() || entry.view.webContents.isDestroyed()) return;
  const [w,h] = entry.win.getContentSize();
  if (!entry.win.isDestroyed() && !entry.view.webContents.isDestroyed()) entry.view.setBounds({ x:0, y:0, width:w, height:h });
}
function obstaclesFor(entry) {
  return [...instances.values()].filter(other => other !== entry && !other.win.isDestroyed()).map(other => other.win.getBounds());
}
function safeBounds(entry, bounds) {
  const others = obstaclesFor(entry);
  return placeWithoutOverlap(bounds, others, screen.getAllDisplays());
}
function createWindow(config = DEFAULT) {
  const ratio = parseRatio(config.ratio || '16:9');
  const width = Math.max(20, Math.min(5000, Math.round(Number(config.width) || 900)));
  const height = Math.round(width / ratio);
  const desired = {x:Number.isFinite(config.x)?config.x:100,y:Number.isFinite(config.y)?config.y:100,width,height};
  const others = [...instances.values()].filter(e=>!e.win.isDestroyed()).map(e=>e.win.getBounds());
  // Imported wall layouts may intentionally extend beyond the visible desktop.
  // Keep their exact geometry rather than rejecting all but the first window.
  const placement = config.preserveImportedPosition &&
    !others.some(b => overlaps(desired, b))
      ? desired
      : placeWithoutOverlap(desired, others, screen.getAllDisplays());
  if (!placement) { console.error('No free desktop area for another window'); return null; }
  const win = new BrowserWindow({
    width, height, minWidth:20, minHeight:20, x: placement.x, y: placement.y,
    frame:false, titleBarStyle:'hidden', roundedCorners:false, hasShadow:false,
    transparent:false, backgroundColor:'#111111',
    webPreferences: { preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false }
  });
  const view = new BrowserView({webPreferences:{nodeIntegration:false, contextIsolation:true, sandbox:false, preload:path.join(__dirname,'site-preload.js')}});
  win.setBrowserView(view);
  const entry = {win, view, config:{url:normalizeUrl(config.url === undefined ? DEFAULT.url : config.url),width,ratio:config.ratio || '16:9',muted:config.muted === true}};
  view.webContents.setAudioMuted(entry.config.muted);
  const windowId = win.webContents.id;
  entry.id = windowId;
  instances.set(windowId, entry);
  resizeContent(entry);
  win.on('resize', () => { if (!win.isDestroyed()) { resizeContent(entry); scheduleSave(); } });
  win.on('move', scheduleSave);
  win.on('close', () => { if (!quitting) { /* Keep layout until closed event. */ } });
  win.on('closed', () => {
    instances.delete(windowId);
    dragStates.delete(windowId);
    const popup = settingsPopups.get(windowId);
    settingsPopups.delete(windowId);
    if (popup && !popup.isDestroyed()) popup.close();
    if (!quitting) scheduleSave();
  });
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (IS_MAC ? input.meta : input.control) && input.shift && input.key.toLowerCase() === 'd') {
      event.preventDefault();
      toggleDebug(entry);
      return;
    }
    if (input.type === 'keyDown' && (IS_MAC ? input.meta : input.control) && input.shift && input.key.toLowerCase() === 's') {
      event.preventDefault();
      showSettings(entry);
    }
  });
  view.webContents.setWindowOpenHandler(({url}) => {
    if (/^https?:\/\//i.test(url)) createWindow({...DEFAULT,url});
    return {action:'deny'};
  });
  view.webContents.loadURL(entry.config.url).catch(err => console.error('Site load failed:', err.message));
  save();
  return entry;
}
// Toggle Chromium Developer Tools for the active video-wall window.
// Detached DevTools do not change the frameless window's dimensions.
function toggleDebug(entry) {
  if (!entry || entry.win.isDestroyed()) return;
  const contents = entry.win.getBrowserView() === entry.view
    ? entry.view.webContents
    : entry.win.webContents;
  if (contents.isDestroyed()) return;
  if (contents.isDevToolsOpened()) {
    contents.closeDevTools();
  } else {
    contents.openDevTools({mode: 'detach', activate: true});
  }
}
function activeEntry(browserWindow) {
  const target = browserWindow && !browserWindow.isDestroyed()
    ? browserWindow : BrowserWindow.getFocusedWindow();
  return target && !target.isDestroyed()
    ? instances.get(target.webContents.id) : null;
}
function showSettings(entry) {
  if (!entry || entry.win.isDestroyed()) return;
  const existing = settingsPopups.get(entry.id);
  if (existing && !existing.isDestroyed()) { existing.focus(); return; }
  const popup = new BrowserWindow({
    width: 460, height: 480, minWidth: 380, minHeight: 400,
    title: `Window Settings${entry.config.screenName ? ' — ' + entry.config.screenName : ''}`,
    parent: entry.win, modal: false, show: false,
    backgroundColor: '#17191e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  settingsPopups.set(entry.id, popup);
  popup.on('closed', () => {
    if (settingsPopups.get(entry.id) === popup) settingsPopups.delete(entry.id);
  });
  popup.loadFile(path.join(__dirname, 'shell.html'))
    .then(() => { if (!popup.isDestroyed()) popup.show(); })
    .catch(err => { console.error('Settings popup failed:', err); if (!popup.isDestroyed()) popup.close(); });
}
function settingsEntry(event) {
  for (const [id, popup] of settingsPopups) {
    if (!popup.isDestroyed() && popup.webContents === event.sender) {
      const entry = instances.get(id);
      if (entry && !entry.win.isDestroyed()) return {entry, popup};
    }
  }
  throw new Error('Settings window is no longer available');
}
function showSite(entry) {
  // Website remains visible behind the independent settings popup.
  if (entry && !entry.win.isDestroyed()) resizeContent(entry);
}

function writePresets() {
  const tmp = presetPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(presets, null, 2));
  fs.renameSync(tmp, presetPath);
}
function validPresetName(name) {
  const n = String(name || '').trim();
  if (!n || n.length > 80 || /[\x00-\x1f]/.test(n)) throw new Error('Enter a preset name (1–80 characters).');
  return n;
}
function presetNames() { return Object.keys(presets).sort((a,b)=>a.localeCompare(b)); }
function notifyPresetManager() {
  if (presetManager && !presetManager.isDestroyed()) presetManager.webContents.send('presets-changed');
}
function savePreset(name, overwrite = false) {
  name = validPresetName(name);
  if (Object.prototype.hasOwnProperty.call(presets,name) && !overwrite) throw new Error('Preset already exists. Choose Replace to overwrite it.');
  const windows = snapshot();
  if (!windows.length) throw new Error('There are no windows to save.');
  presets[name] = {windows, savedAt: new Date().toISOString()};
  writePresets();
  notifyPresetManager();
  return {name, count:windows.length};
}
function clearWindows() {
  // Do not let closed-event handlers overwrite the saved layout mid-transition.
  suppressLayoutSave = true;
  if (saveTimer) {clearTimeout(saveTimer); saveTimer=null;}
  for (const entry of [...instances.values()]) {
    if (!entry.win.isDestroyed()) entry.win.destroy();
  }
  instances.clear();
  dragStates.clear();
  for (const popup of settingsPopups.values()) if (!popup.isDestroyed()) popup.close();
  settingsPopups.clear();
  suppressLayoutSave = false;
  save();
  notifyPresetManager();
  return true;
}
function loadPreset(name) {
  if (!Object.prototype.hasOwnProperty.call(presets,name)) throw new Error('Preset not found.');
  const windows = presets[name].windows;
  if (!Array.isArray(windows)) throw new Error('Preset has invalid window data.');
  // Validate everything before clearing the current layout.
  const validated = windows.map(c => ({
    url:normalizeUrl(c.url), ratio:String(c.ratio),
    width:Number(c.width), muted:c.muted === true,
    x:Number(c.x), y:Number(c.y),
    preserveImportedPosition: presets[name].imported === true
  }));
  validated.forEach(c => {parseRatio(c.ratio); if(!Number.isFinite(c.width)||c.width<20||c.width>5000) throw new Error('Invalid preset width.');});
  clearWindows();
  suppressLayoutSave = true;
  let opened = 0;
  try {
    for (const c of validated) {
      try {
        if (createWindow(c)) opened++;
      } catch (error) {
        console.error('Could not create imported preset window:', error);
      }
    }
  } finally { suppressLayoutSave = false; save(); notifyPresetManager(); }
  return {opened, requested:validated.length};
}
// Import the Video Wall Sync JSON layout into a named browser-window preset.
// Percentages describe screen geometry; source URLs are intentionally not used.
function importWallJSON(data, scalePercent = 100) {
  const scale = Number(scalePercent);
  if (!Number.isFinite(scale) || scale < 25 || scale > 200) throw new Error("Layout scale must be between 25% and 200%.");
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a JSON object.');
  if (!Array.isArray(data.screens) || data.screens.length === 0 || data.screens.length > 40)
    throw new Error('JSON must have between 1 and 40 screens.');
  const name = validPresetName(data.name || 'Imported Wall');
  if (Object.prototype.hasOwnProperty.call(presets, name))
    throw new Error(`Preset "${name}" already exists. Rename it in the JSON or delete the old preset first.`);
  const area = screen.getPrimaryDisplay().workArea;
  // Scale percentage-based geometry into a desktop-sized 16:9 wall canvas.
  const wallW = Math.min(1200, Math.max(700, area.width - 50)) * scale / 100;
  const wallH = wallW * 9 / 16;
  const windows = data.screens.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`Screen ${i+1} is invalid.`);
    const [x,y,w,h] = ['x','y','w','h'].map(k => Number(item[k]));
    if (![x,y,w,h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 ||
        x + w > 100.0001 || y + h > 100.0001)
      throw new Error(`Screen ${i+1} has invalid percentage coordinates.`);
    const width = Math.round(wallW*w/100);
    const height = Math.round(wallH*h/100);
    if (width < 20 || height < 1) throw new Error(`Screen ${i+1} is too small at this scale (minimum 20px wide).`);
    const ratio = `${width}:${height}`;
    return {url:'',width,ratio,muted:i !== 0,
      x:Math.round(area.x+20+wallW*x/100),
      y:Math.round(area.y+20+wallH*y/100),
      screenId:String(item.id || `screen${i+1}`),screenName:String(item.name || `Screen ${i+1}`), preserveImportedPosition:true};
  });
  // Avoid accepting an overlapping source layout: the browser's no-overlap rule remains intact.
  for (let i=0;i<windows.length;i++) for(let j=0;j<i;j++) {
    const a=windows[i],b=windows[j];
    if(overlaps({x:a.x,y:a.y,width:a.width,height:Math.round(a.width/parseRatio(a.ratio))},
                {x:b.x,y:b.y,width:b.width,height:Math.round(b.width/parseRatio(b.ratio))}))
      throw new Error(`Screens ${j+1} and ${i+1} overlap. Correct the JSON layout before importing.`);
  }
  presets[name]={windows,savedAt:new Date().toISOString(),imported:true,scalePercent:scale};
  writePresets();notifyPresetManager();
  return {name,count:windows.length};
}
function openPresetManager() {
  if (presetManager && !presetManager.isDestroyed()) {presetManager.focus();return;}
  presetManager = new BrowserWindow({width:510,height:540,title:'Window Presets',backgroundColor:'#17191e',
    webPreferences:{preload:path.join(__dirname,'presets-preload.js'),contextIsolation:true,nodeIntegration:false}});
  presetManager.on('closed',()=>{presetManager=null;});
  presetManager.loadFile(path.join(__dirname,'presets.html'));
}

app.whenReady().then(() => {
  storePath = path.join(app.getPath('userData'),'windows.json');
  presetPath = path.join(app.getPath('userData'),'presets.json');
  try { const value=JSON.parse(fs.readFileSync(presetPath,'utf8')); presets=value && typeof value==='object' && !Array.isArray(value) ? value : {}; } catch {presets={};}
  try { saved = JSON.parse(fs.readFileSync(storePath,'utf8')); if (!Array.isArray(saved)) saved=[]; } catch { saved=[]; }
  app.on('before-quit', () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    save();
    quitting = true;
  });
  const menu = Menu.buildFromTemplate([{label:'File',submenu:[{label:'New Window',accelerator:'CommandOrControl+N',click:()=>createWindow()},{type:'separator'},{label:'Window Presets…',accelerator:'CommandOrControl+Shift+P',click:openPresetManager},{type:'separator'},{role:'close'},{label:'Quit',accelerator:'CommandOrControl+Q',click:()=>app.quit()}]},{label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'pasteAndMatchStyle'},{role:'delete'},{role:'selectAll'}]},{label:'View',submenu:[{label:'Window Settings',accelerator:'CommandOrControl+Shift+S',click:(_,w)=>{const target=w || BrowserWindow.getFocusedWindow();const e=target && !target.isDestroyed() && instances.get(target.webContents.id);if(e)showSettings(e);}},{label:'Mute/Unmute Active Window',accelerator:'CommandOrControl+Shift+M',click:(_,w)=>{const target=w || BrowserWindow.getFocusedWindow();const e=target && !target.isDestroyed() && instances.get(target.webContents.id);if(e && !e.view.webContents.isDestroyed()){e.config.muted=!e.config.muted;e.view.webContents.setAudioMuted(e.config.muted);scheduleSave();}}},{label:'Toggle Debug / Developer Tools',accelerator:'CommandOrControl+Shift+D',click:(_,w)=>toggleDebug(activeEntry(w))},{role:'reload'}]}]);
  Menu.setApplicationMenu(menu);
  (saved.length ? saved : [DEFAULT]).forEach(c => {try{createWindow(c)}catch(err){console.error('Unable to restore window:',err.message)}});
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()});
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
});
ipcMain.handle('get-settings', e => settingsEntry(e).entry.config);
ipcMain.handle('save-settings', async (e, config) => {
  const {entry, popup} = settingsEntry(e);
  const ratio = parseRatio(config.ratio);
  const width = Math.round(Number(config.width));
  if (!Number.isFinite(width) || width < 20 || width > 5000) throw new Error('Width must be 20–5000 pixels');
  const url = normalizeUrl(config.url);
  const proposed = {...entry.win.getBounds(), width, height:Math.round(width/ratio)};
  const target = safeBounds(entry, proposed);
  if (!target) throw new Error('Not enough free desktop space for this size. Reduce the width or move another window.');
  entry.config = {url,ratio:config.ratio,width,muted:config.muted === true};
  entry.view.webContents.setAudioMuted(entry.config.muted);
  entry.win.setBounds(target);
  // Attach the website view before navigation. Direct media URLs may
  // interrupt navigation and reject loadURL even when the player renders.
  showSite(entry);
  save();
  entry.view.webContents.loadURL(url).catch(err => {
    if (!entry.win.isDestroyed()) {
      console.error(`Navigation failed for ${url}:`, err);
    }
  });
  if (!popup.isDestroyed()) popup.close();
  return true;
});
ipcMain.handle('cancel-settings', e => { const {popup} = settingsEntry(e); if (!popup.isDestroyed()) popup.close(); });

ipcMain.on('wall-pointer', (event, action) => {
  const entry = [...instances.values()].find(item => item.view.webContents === event.sender);
  if (!entry || entry.win.isDestroyed()) return;
  const key = entry.id;
  const point = screen.getCursorScreenPoint();
  const kind = typeof action === 'string' ? action : action?.kind;
  const override = typeof action === 'object' && action?.override === true;
  if (kind === 'down') {
    dragStates.set(key, { start: point, bounds: entry.win.getBounds(), moved: false });
    return;
  }
  const drag = dragStates.get(key);
  if (!drag) return;
  const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
  if (kind === 'move' && drag.moved) {
    const current=entry.win.getBounds();
    const desired={...current,x:drag.bounds.x+dx,y:drag.bounds.y+dy};
    const next=override ? desired : moveNoOverlap(current,desired,obstaclesFor(entry));
    if(next.x!==current.x||next.y!==current.y)entry.win.setPosition(Math.round(next.x),Math.round(next.y));
  } else if (kind === 'up') {
    dragStates.delete(key);
    if (!drag.moved) showSettings(entry);
    else save();
  }
});

// Preset management is restricted to the dedicated local preset manager window.
function presetSender(event) {
  if (!presetManager || presetManager.isDestroyed() || event.sender !== presetManager.webContents)
    throw new Error('Unauthorized preset request');
}
ipcMain.handle('presets-list', event => {
  presetSender(event);
  return {names:presetNames().map(name=>({name,count:Array.isArray(presets[name]?.windows)?presets[name].windows.length:0,savedAt:presets[name]?.savedAt})),openCount:snapshot().length};
});
ipcMain.handle('presets-import-json', async (event, scalePercent) => {
  presetSender(event);
  const choice = await dialog.showOpenDialog(presetManager, {
    title:'Import Video Wall JSON', properties:['openFile'],
    filters:[{name:'JSON',extensions:['json']}]
  });
  if(choice.canceled || !choice.filePaths.length) return null;
  const file=choice.filePaths[0];
  if(fs.statSync(file).size > 1024*1024) throw new Error('JSON file is too large (1 MB maximum).');
  return importWallJSON(JSON.parse(fs.readFileSync(file,'utf8')), scalePercent);
});
ipcMain.handle('presets-save', (event,name,overwrite) => {presetSender(event);return savePreset(name,overwrite === true);});
ipcMain.handle('presets-load', (event,name) => {presetSender(event);return loadPreset(name);});
ipcMain.handle('presets-clear', event => {presetSender(event);return clearWindows();});
ipcMain.handle('presets-delete', (event,name) => {
  presetSender(event);
  if (!Object.prototype.hasOwnProperty.call(presets,name)) throw new Error('Preset not found.');
  delete presets[name]; writePresets(); notifyPresetManager(); return true;
});
