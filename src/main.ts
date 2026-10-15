import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  Menu,
  safeStorage,
  session,
  type WebContents,
} from 'electron';
import started from 'electron-squirrel-startup';
import { registerIpc } from './main/ipc';
import { SessionManager } from './main/sessions/session-manager';
import { KnownHosts } from './main/ssh/known-hosts';
import { SecretStore } from './main/ssh/secrets';
import { lookupSshConfig } from './main/ssh/ssh-config';
import { HostKeyPrompts } from './main/ssh/ssh-sessions';
import { Store } from './main/store';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

app.setName('rtx-terminal');

const isDev = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL);
const rendererFile = path.join(
  __dirname,
  `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
);
const rendererFileUrl = pathToFileURL(rendererFile).toString();
const devOrigin = isDev
  ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
  : null;

const userData = app.getPath('userData');
const store = new Store(userData);
// The app's own trust store; ~/.ssh/known_hosts is consulted read-only and never modified.
const knownHosts = new KnownHosts(
  path.join(userData, 'known_hosts'),
  path.join(os.homedir(), '.ssh', 'known_hosts'),
);
const secrets = new SecretStore(
  path.join(userData, 'ssh-secrets.json'),
  safeStorage,
);
const hostKeyPrompts = new HostKeyPrompts();
const sessions = new SessionManager(app.getVersion(), {
  prompts: hostKeyPrompts,
  env: {
    getHost: (id) => store.sshHost(id),
    knownHosts,
    secrets,
    lookupConfig: (alias) => lookupSshConfig(alias),
    agentSocket: process.env.SSH_AUTH_SOCK,
  },
});
let mainWindow: BrowserWindow | null = null;
let quitting = false;

function isAppUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (devOrigin) {
    try {
      return new URL(url).origin === devOrigin;
    } catch {
      return false;
    }
  }
  return url.split('#')[0].split('?')[0] === rendererFileUrl;
}

/**
 * In development Vite serves the page and needs inline scripts and a websocket for HMR. The
 * packaged build gets a strict policy from a meta tag injected at build time.
 */
function installDevContentSecurityPolicy(): void {
  if (!devOrigin) return;
  const wsOrigin = devOrigin.replace(/^http/, 'ws');
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${devOrigin}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${devOrigin} ${wsOrigin}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

function lockDownContents(contents: WebContents): void {
  // The renderer never navigates and never opens windows; links go through the preload API.
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    show: false,
    title: 'rtx-terminal',
    backgroundColor: '#0c0d10',
    autoHideMenuBar: true,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(app.getAppPath(), 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev,
    },
  });

  // lockDownContents already ran for this window through 'web-contents-created'.
  window.once('ready-to-show', () => window.show());

  if (isDev) {
    // F12 opens DevTools in development only; the packaged app has DevTools disabled.
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        window.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') window.webContents.reload();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(rendererFile);
  }
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) =>
    lockDownContents(contents),
  );

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // No feature of the app needs camera, microphone, notifications or any other permission.
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    installDevContentSecurityPolicy();

    registerIpc({
      sessions,
      store,
      ssh: { prompts: hostKeyPrompts, secrets },
      isTrustedSender: (sender, frameUrl) =>
        mainWindow !== null &&
        sender.id === mainWindow.webContents.id &&
        isAppUrl(frameUrl),
    });

    mainWindow = createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0)
        mainWindow = createWindow();
    });
  });
}

// End every shell before quitting so no process outlives the app.
app.on('before-quit', (event) => {
  if (quitting || sessions.size === 0) return;
  event.preventDefault();
  quitting = true;
  void sessions.closeAll().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void sessions.closeAll(1000).finally(() => app.exit(0));
  });
}
