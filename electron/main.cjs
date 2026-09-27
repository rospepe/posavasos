// Envoltorio de escritorio (Electron) para la app de posavasos.
// Sirve la web compilada (dist/) mediante el protocolo app://, necesario para
// que funcionen el Web Worker, fetch() y WebAssembly (no funcionan con file://).

const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    // Evita salir de dist/ con rutas del tipo ../
    if (!file.startsWith(DIST + path.sep)) return new Response('Prohibido', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString());
    if (!res.ok) return res;
    const type = MIME[path.extname(file).toLowerCase()];
    const headers = { 'access-control-allow-origin': 'app://posavasos' };
    if (type) headers['content-type'] = type;
    return new Response(res.body, { status: 200, headers });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    title: 'Posavasos',
    backgroundColor: '#f4f1ec',
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  // Los enlaces externos se abren en el navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('app://posavasos/index.html');
}

app.setName('Posavasos');

app.whenReady().then(() => {
  registerAppProtocol();
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate(macMenu()));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function macMenu() {
  return [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'Visualización',
      submenu: [{ role: 'reload', label: 'Recargar' }, { role: 'togglefullscreen', label: 'Pantalla completa' }],
    },
    { role: 'windowMenu' },
  ];
}
