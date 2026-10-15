import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import { IPC, type ExportResult, type ImportResult } from '../shared/api';
import {
  CONFIG_VERSION,
  isRecord,
  parseCommandsFile,
  type Preferences,
} from '../shared/config';
import {
  createRequest,
  dimension,
  fail,
  hostId,
  IpcValidationError,
  promptId,
  requestId,
  sessionId,
} from './ipc-validation';
import { listShells } from './shells';
import type { SecretStore } from './ssh/secrets';
import { listSshConfigAliases } from './ssh/ssh-config';
import type { HostKeyPrompts } from './ssh/ssh-sessions';
import type { SessionManager } from './sessions/session-manager';
import type { Store } from './store';

const MAX_WRITE = 1024 * 1024;
const MAX_CLIPBOARD = 10 * 1024 * 1024;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const EXPORT_FORMAT = 'rtx-terminal.commands';

export type IpcContext = {
  sessions: SessionManager;
  store: Store;
  ssh: { prompts: HostKeyPrompts; secrets: SecretStore };
  /** True when the page in this frame is the app's own renderer. */
  isTrustedSender(sender: WebContents, frameUrl: string | undefined): boolean;
};

export function registerIpc(context: IpcContext): void {
  const { sessions, store } = context;
  let preferences: Preferences | null = null;

  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    event.senderFrame !== null &&
    event.senderFrame === event.sender.mainFrame &&
    context.isTrustedSender(event.sender, event.senderFrame.url);

  /** Request/response handlers reject untrusted senders and invalid arguments. */
  const handle = (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted sender.');
      return handler(event, ...args);
    });
  };

  /** Fire-and-forget channels drop invalid messages silently: there is no caller to report to. */
  const on = (
    channel: string,
    handler: (event: IpcMainEvent, ...args: unknown[]) => void,
  ) => {
    ipcMain.on(channel, (event, ...args) => {
      if (!trusted(event)) return;
      try {
        handler(event, ...args);
      } catch (error) {
        if (!(error instanceof IpcValidationError)) throw error;
      }
    });
  };

  // --- terminal sessions ----------------------------------------------------

  handle(IPC.terminalCreate, (event, request) =>
    sessions.create(
      event.sender,
      createRequest(request),
      preferences?.terminal.defaultShell ?? null,
    ),
  );

  on(IPC.terminalWrite, (event, id, data) => {
    if (typeof data !== 'string' || data.length > MAX_WRITE) return;
    sessions.write(event.sender, sessionId(id), data);
  });

  on(IPC.terminalResize, (event, id, cols, rows) => {
    sessions.resize(
      event.sender,
      sessionId(id),
      dimension(cols, 1000),
      dimension(rows, 500),
    );
  });

  on(IPC.terminalAck, (event, id, bytes) => {
    if (!Number.isInteger(bytes) || (bytes as number) < 0) return;
    sessions.ack(event.sender, sessionId(id), bytes as number);
  });

  handle(IPC.terminalClose, (event, id) =>
    sessions.close(event.sender, sessionId(id)),
  );
  handle(IPC.terminalInfo, (event, id) =>
    sessions.runtimeInfo(event.sender, sessionId(id)),
  );

  // --- SSH -------------------------------------------------------------------------

  handle(IPC.sshCancel, (event, id) =>
    sessions.cancel(event.sender, requestId(id)),
  );

  handle(IPC.sshAnswerHostKey, (event, id, trust) => {
    if (typeof trust !== 'boolean') fail('Invalid host key answer.');
    context.ssh.prompts.answer(event.sender.id, promptId(id), trust);
  });

  handle(IPC.sshSecretState, async () => ({
    ...context.ssh.secrets.status(),
    saved: await context.ssh.secrets.savedFor(),
  }));

  handle(IPC.sshForgetSecrets, (_event, id) =>
    context.ssh.secrets.forget(hostId(id)),
  );

  handle(IPC.sshConfigAliases, () => listSshConfigAliases());

  handle(IPC.sshPickKeyFile, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Choose a private key',
      defaultPath: path.join(os.homedir(), '.ssh'),
      properties: ['openFile' as const, 'showHiddenFiles' as const],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled || result.filePaths.length === 0
      ? null
      : result.filePaths[0];
  });

  // --- system -----------------------------------------------------------------

  handle(IPC.systemShells, () => listShells());
  handle(IPC.systemHomeDir, () => os.homedir());

  handle(IPC.systemOpenExternal, async (_event, url) => {
    if (typeof url !== 'string' || url.length > 4096) return false;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      return false;
    await shell.openExternal(parsed.toString());
    return true;
  });

  handle(IPC.systemReadClipboard, () => clipboard.readText());
  handle(IPC.systemWriteClipboard, (_event, text) => {
    if (typeof text !== 'string' || text.length > MAX_CLIPBOARD)
      fail('Invalid clipboard text.');
    clipboard.writeText(text);
  });

  handle(IPC.systemAppInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }));

  handle(IPC.systemToggleFullScreen, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    window.setFullScreen(!window.isFullScreen());
    return window.isFullScreen();
  });

  // app.quit() runs the before-quit handler, which ends every shell before the app exits.
  handle(IPC.systemQuit, () => {
    app.quit();
  });

  handle(IPC.systemPickDirectory, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      properties: ['openDirectory' as const],
      defaultPath: os.homedir(),
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled || result.filePaths.length === 0
      ? null
      : result.filePaths[0];
  });

  // --- persisted state ----------------------------------------------------------

  handle(IPC.storeLoad, async () => {
    const state = await store.load();
    preferences = state.preferences;
    return state;
  });

  handle(IPC.storeSavePreferences, async (_event, raw) => {
    preferences = await store.savePreferences(raw);
    return preferences;
  });

  handle(IPC.storePickGlassWallpaper, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Choose a Glass wallpaper',
      properties: ['openFile' as const],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp'],
        },
      ],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0)
      return { status: 'cancelled' as const };
    return store.pickGlassWallpaper(result.filePaths[0]);
  });

  handle(IPC.storeDiscardGlassWallpaper, async (_event, wallpaperRef) => {
    if (typeof wallpaperRef !== 'string' || wallpaperRef.length > 64)
      fail('Invalid Glass wallpaper reference.');
    await store.discardGlassWallpaper(wallpaperRef);
  });

  handle(IPC.storeSaveCommands, (_event, raw) => store.saveCommands(raw));
  handle(IPC.storeSaveProfiles, (_event, raw) => store.saveProfiles(raw));

  handle(IPC.storeSaveHistory, (_event, raw) => {
    if (!preferences) return;
    return store.saveHistory(
      raw,
      preferences.history.mode,
      preferences.history.maxEntries,
    );
  });

  handle(IPC.storeClearHistory, () => store.clearHistory());

  handle(IPC.storeExportCommands, async (event, raw): Promise<ExportResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Export saved commands',
      defaultPath: path.join(os.homedir(), 'rtx-commands.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath)
      return { ok: false, cancelled: true };
    const data = parseCommandsFile(raw);
    try {
      await fs.writeFile(
        result.filePath,
        `${JSON.stringify({ format: EXPORT_FORMAT, version: CONFIG_VERSION, categories: data.categories, commands: data.commands }, null, 2)}\n`,
        { mode: 0o600 },
      );
      return { ok: true, path: result.filePath };
    } catch (error) {
      return {
        ok: false,
        cancelled: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  handle(IPC.storeImportCommands, async (event): Promise<ImportResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Import saved commands',
      properties: ['openFile' as const],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0)
      return { ok: false, cancelled: true };
    try {
      const stat = await fs.stat(result.filePaths[0]);
      if (stat.size > MAX_IMPORT_BYTES)
        return {
          ok: false,
          cancelled: false,
          error: 'The file is larger than 5 MB.',
        };
      const data: unknown = JSON.parse(
        await fs.readFile(result.filePaths[0], 'utf8'),
      );
      if (
        !isRecord(data) ||
        (data.format !== undefined && data.format !== EXPORT_FORMAT)
      ) {
        return {
          ok: false,
          cancelled: false,
          error: 'This is not an rtx-terminal command collection.',
        };
      }
      const parsed = parseCommandsFile(data);
      if (parsed.commands.length === 0) {
        return {
          ok: false,
          cancelled: false,
          error: 'The file contains no valid commands.',
        };
      }
      return {
        ok: true,
        commands: parsed.commands,
        categories: parsed.categories,
      };
    } catch (error) {
      return {
        ok: false,
        cancelled: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
