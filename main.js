const { app, BrowserWindow, BrowserView, ipcMain, Menu, screen } = require('electron');
const fs = require('fs');
const path = require('path');
let storePath;
let saved = [];
const instances = new Map();
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
function save() {
  saved = [...instances.values()].map(x => ({...x.config, x:x.win.getBounds().x, y:x.win.getBounds().y}));
  fs.writeFileSync(storePath, JSON.stringify(saved, null, 2));
}
function resizeContent(entry) {
  const [w,h] = entry.win.getContentSize();
  entry.view.setBounds({ x:0, y:0, width:w, height:h });
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
  instances.set(win.webContents.id, entry);
  resizeContent(entry);
  win.on('resize', () => resizeContent(entry));
  win.on('move', () => save());
  win.on('close', () => save());
  win.on('closed', () => { instances.delete(win.webContents.id); });
  view.webContents.setWindowOpenHandler(({url}) => {
    if (/^https?:\/\//i.test(url)) createWindow({...DEFAULT,url});
    return {action:'deny'};
  });
  view.webContents.loadURL(entry.config.url).catch(()=>{});
  save();
  return entry;
}
function showSettings(entry) {
  if (entry.win.isDestroyed()) return;
  entry.win.setBrowserView(null);
  entry.win.loadFile(path.join(__dirname,'shell.html'));
}
function showSite(entry) {
  entry.win.loadURL('about:blank');
  entry.win.setBrowserView(entry.view);
  resizeContent(entry);
}
app.whenReady().then(() => {
  storePath = path.join(app.getPath('userData'),'windows.json');
  try { saved = JSON.parse(fs.readFileSync(storePath,'utf8')); if (!Array.isArray(saved)) saved=[]; } catch { saved=[]; }
  app.on('before-quit', () => { if (instances.size) save(); });
  const menu = Menu.buildFromTemplate([{label:'File',submenu:[{label:'New Window',accelerator:'CommandOrControl+N',click:()=>createWindow()},{role:'close'},{role:'quit'}]},{label:'View',submenu:[{label:'Window Settings',accelerator:'CommandOrControl+,',click:(_,w)=>{const e=w&&instances.get(w.webContents.id);if(e)showSettings(e);}},{role:'reload'}]}]);
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

ipcMain.on('site-cmd-click', e => { for (const entry of instances.values()) if (entry.view.webContents === e.sender) {showSettings(entry); break;} });
