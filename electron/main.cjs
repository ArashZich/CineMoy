// Windows desktop app: runs the CineMoy server in-process and shows the UI in a window.
// The server also listens on the LAN, so a TV on the same Wi-Fi can use this PC as its engine.
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let win;

async function boot() {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'index.js')).href);
  let port;
  try {
    ({ port } = await startServer({ port: Number(process.env.PORT) || 7070 }));
  } catch {
    ({ port } = await startServer({ port: 0 })); // 7070 busy → pick a free port
  }

  win = new BrowserWindow({
    width: 1400, height: 860, minWidth: 900, minHeight: 560,
    backgroundColor: '#110c1b', autoHideMenuBar: true, title: 'CineMoy',
    icon: path.join(__dirname, '..', 'web', 'icon-512.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(`http://localhost:${port}/`);
  // External links (Torrentio configure page, SubDL) open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(boot);
app.on('window-all-closed', () => app.quit());
