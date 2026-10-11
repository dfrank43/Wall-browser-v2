const { app, BrowserWindow, BrowserView, ipcMain, Menu, screen } = require('electron');
const fs = require('fs');
const path = require('path');
let storePath;
let saved = [];
const instances = new Map();
let quitting = false;
let saveTimer = null;
let lastLayout = [];
const dragStates = new Map();
const DEFAULT = { url: 'https://example.com', width: 900, ratio: '16:9' };
function parseRatio(r) {
  const m = String(r).match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
  if (!m || +m[1] <= 0 || +m[2] <= 0) throw new Error('Ratio must be like 16:9 or 4:3');
  return +m[1] / +m[2];
}
function normalizeUrl(raw) {
  const input = String(raw || '').trim();
  if (!input) throw new Error('URL is required');
  const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
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
  if (quitting || !storePath) return;
  lastLayout = snapshot();
  try { fs.writeFileSync(storePath, JSON.stringify(lastLayout, null, 2)); }
  catch (err) { console.error('Could not save window layout:', err); }
}
function scheduleSave() {
  if (quitting) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 200);
}
function resizeContent(entry) {
  if (entry.win.isDestroyed() || entry.view.webContents.isDestroyed()) return;
  const [w,h] = entry.win.getContentSize();
  if (!entry.win.isDestroyed() && !entry.view.webContents.isDestroyed()) entry.view.setBounds({ x:0, y:0, width:w, height:h });
}
function createWindow(config = DEFAULT) {
  const ratio = parseRatio(config.ratio || '16:9');
  const width = Math.max(200, Math.min(5000, Math.round(Number(config.width) || 900)));
  const height = Math.round(width / ratio);
  const win = new BrowserWindow({
    width, height, x: Number.isFinite(config.x) ? config.x : undefined,
    y: Number.isFinite(config.y) ? config.y : undefined,
    frame:false, titleBarStyle:'hidden', backgroundColor:'#111111',
    webPreferences: { preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false }
  });
  const view = new BrowserView({webPreferences:{nodeIntegration:false, contextIsolation:true, sandbox:false, preload:path.join(__dirname,'site-preload.js')}});
  win.setBrowserView(view);
  const entry = {win, view, config:{url:normalizeUrl(config.url || DEFAULT.url),width,ratio:config.ratio || '16:9'}};
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
    if (!quitting) scheduleSave();
  });
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.meta && input.shift && input.key.toLowerCase() === 's') {
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
function showSettings(entry) {
  if (entry.win.isDestroyed()) return;
  if (!entry.view.webContents.isDestroyed()) entry.win.setBrowserView(null);
  entry.win.loadFile(path.join(__dirname,'shell.html'));
}
function showSite(entry) {
  if (entry.win.isDestroyed() || entry.view.webContents.isDestroyed()) return;
  entry.win.loadURL('about:blank').catch(err => console.error('Could not show site:', err));
  entry.win.setBrowserView(entry.view);
  resizeContent(entry);
}
app.whenReady().then(() => {
  storePath = path.join(app.getPath('userData'),'windows.json');
  try { saved = JSON.parse(fs.readFileSync(storePath,'utf8')); if (!Array.isArray(saved)) saved=[]; } catch { saved=[]; }
  app.on('before-quit', () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    save();
    quitting = true;
  });
  const menu = Menu.buildFromTemplate([{label:'File',submenu:[{label:'New Window',accelerator:'CommandOrControl+N',click:()=>createWindow()},{role:'close'},{role:'quit'}]},{label:'View',submenu:[{label:'Window Settings',accelerator:'CommandOrControl+Shift+S',click:(_,w)=>{const target=w || BrowserWindow.getFocusedWindow();const e=target && !target.isDestroyed() && instances.get(target.webContents.id);if(e)showSettings(e);}},{role:'reload'}]}]);
  Menu.setApplicationMenu(menu);
  (saved.length ? saved : [DEFAULT]).forEach(c => {try{createWindow(c)}catch{createWindow(DEFAULT)}});
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()});
});
ipcMain.handle('get-settings', e => instances.get(e.sender.id)?.config);
ipcMain.handle('save-settings', async (e, config) => {
  const entry = instances.get(e.sender.id);
  if (!entry) throw new Error('Window not found');
  const ratio = parseRatio(config.ratio);
  const width = Math.round(Number(config.width));
  if (!Number.isFinite(width) || width < 200 || width > 5000) throw new Error('Width must be 200–5000 pixels');
  const url = normalizeUrl(config.url);
  entry.config = {url,ratio:config.ratio,width};
  entry.win.setContentSize(width,Math.round(width/ratio));
  await entry.view.webContents.loadURL(url);
  showSite(entry);
  save();
  return true;
});
ipcMain.handle('cancel-settings', e => {const entry=instances.get(e.sender.id);if(entry)showSite(entry)});

ipcMain.on('wall-pointer', (event, action) => {
  const entry = [...instances.values()].find(item => item.view.webContents === event.sender);
  if (!entry || entry.win.isDestroyed()) return;
  const key = entry.id;
  const point = screen.getCursorScreenPoint();
  if (action === 'down') {
    dragStates.set(key, { start: point, bounds: entry.win.getBounds(), moved: false });
    return;
  }
  const drag = dragStates.get(key);
  if (!drag) return;
  const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
  if (action === 'move' && drag.moved) {
    entry.win.setPosition(drag.bounds.x + dx, drag.bounds.y + dy);
  } else if (action === 'up') {
    dragStates.delete(key);
    if (!drag.moved) showSettings(entry);
    else save();
  }
});
