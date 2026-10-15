// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type HostKeyPrompt,
  type RtxApi,
  type SessionExit,
  type SshConnectState,
} from './shared/api';

/**
 * The renderer gets this object and nothing else: named operations over fixed channels. It never
 * receives ipcRenderer, the event object, or any Node API.
 */
function subscribe<Args extends unknown[]>(
  channel: string,
  listener: (...args: Args) => void,
) {
  const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) =>
    listener(...(args as Args));
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: RtxApi = {
  terminal: {
    create: (request) => ipcRenderer.invoke(IPC.terminalCreate, request),
    write: (sessionId, data) =>
      ipcRenderer.send(IPC.terminalWrite, sessionId, data),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.send(IPC.terminalResize, sessionId, cols, rows),
    ack: (sessionId, bytes) =>
      ipcRenderer.send(IPC.terminalAck, sessionId, bytes),
    close: (sessionId) => ipcRenderer.invoke(IPC.terminalClose, sessionId),
    info: (sessionId) => ipcRenderer.invoke(IPC.terminalInfo, sessionId),
    onData: (listener) =>
      subscribe<[string, string]>(IPC.terminalData, listener),
    onExit: (listener) =>
      subscribe<[string, SessionExit]>(IPC.terminalExit, listener),
  },
  system: {
    shells: () => ipcRenderer.invoke(IPC.systemShells),
    homeDir: () => ipcRenderer.invoke(IPC.systemHomeDir),
    openExternal: (url) => ipcRenderer.invoke(IPC.systemOpenExternal, url),
    readClipboard: () => ipcRenderer.invoke(IPC.systemReadClipboard),
    writeClipboard: (text) =>
      ipcRenderer.invoke(IPC.systemWriteClipboard, text),
    pickDirectory: () => ipcRenderer.invoke(IPC.systemPickDirectory),
    appInfo: () => ipcRenderer.invoke(IPC.systemAppInfo),
    toggleFullScreen: () => ipcRenderer.invoke(IPC.systemToggleFullScreen),
    quit: () => ipcRenderer.invoke(IPC.systemQuit),
  },
  ssh: {
    cancel: (requestId) => ipcRenderer.invoke(IPC.sshCancel, requestId),
    answerHostKey: (promptId, trust) =>
      ipcRenderer.invoke(IPC.sshAnswerHostKey, promptId, trust),
    onProgress: (listener) =>
      subscribe<[string, SshConnectState]>(IPC.sshProgress, listener),
    onHostKeyPrompt: (listener) =>
      subscribe<[HostKeyPrompt]>(IPC.sshHostKeyPrompt, listener),
    secretState: () => ipcRenderer.invoke(IPC.sshSecretState),
    forgetSecrets: (hostId) => ipcRenderer.invoke(IPC.sshForgetSecrets, hostId),
    configAliases: () => ipcRenderer.invoke(IPC.sshConfigAliases),
    pickKeyFile: () => ipcRenderer.invoke(IPC.sshPickKeyFile),
  },
  store: {
    load: () => ipcRenderer.invoke(IPC.storeLoad),
    savePreferences: (preferences) =>
      ipcRenderer.invoke(IPC.storeSavePreferences, preferences),
    pickGlassWallpaper: () => ipcRenderer.invoke(IPC.storePickGlassWallpaper),
    discardGlassWallpaper: (wallpaperRef) =>
      ipcRenderer.invoke(IPC.storeDiscardGlassWallpaper, wallpaperRef),
    saveCommands: (commands) =>
      ipcRenderer.invoke(IPC.storeSaveCommands, commands),
    saveProfiles: (profiles) =>
      ipcRenderer.invoke(IPC.storeSaveProfiles, profiles),
    saveHistory: (history) => ipcRenderer.invoke(IPC.storeSaveHistory, history),
    clearHistory: () => ipcRenderer.invoke(IPC.storeClearHistory),
    exportCommands: (commands) =>
      ipcRenderer.invoke(IPC.storeExportCommands, commands),
    importCommands: () => ipcRenderer.invoke(IPC.storeImportCommands),
  },
};

contextBridge.exposeInMainWorld('rtx', api);
