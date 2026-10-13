// Windows desktop app: runs the CineMoy server in-process and shows the UI in a window.
// By default the server only answers this PC. "Share with my network" (Settings) makes it listen
// on the LAN too, so a TV or phone on the same Wi-Fi can use this PC as its engine.
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let win, port;

const configFile = () => path.join(app.getPath('userData'), 'desktop.json');
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; }
}
function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));
}

const lanAddresses = () => Object.values(os.networkInterfaces()).flat()
  .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);

ipcMain.handle('cm:info', () => ({
  lanSharing: !!readConfig().lanSharing,
  addresses: lanAddresses().map(ip => `http://${ip}:${port}`),
  portable: !!process.env.PORTABLE_EXECUTABLE_FILE, // set by electron-builder's portable launcher
  platform: process.platform, // win32 | darwin | linux
  arch: process.arch,         // x64 | arm64
  appImage: !!process.env.APPIMAGE,
}));

// The listen address is fixed at startup, so changing it restarts the app.
ipcMain.handle('cm:setLanSharing', (e, on) => {
  writeConfig({ ...readConfig(), lanSharing: !!on });
  app.relaunch();
  app.exit(0);
});

async function boot() {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'index.js')).href);
  const host = readConfig().lanSharing ? '0.0.0.0' : '127.0.0.1';
  try {
    ({ port } = await startServer({ port: Number(process.env.PORT) || 7070, host }));
  } catch {
    ({ port } = await startServer({ port: 0, host })); // 7070 busy → pick a free port
  }

  win = new BrowserWindow({
    width: 1400, height: 860, minWidth: 900, minHeight: 560,
    backgroundColor: '#110c1b', autoHideMenuBar: true, title: 'CineMoy',
    icon: path.join(__dirname, '..', 'web', 'icon-512.png'),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.loadURL(`http://localhost:${port}/`);
  // External links (Torrentio configure page, SubDL, update downloads) open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(boot);
app.on('window-all-closed', () => app.quit());
