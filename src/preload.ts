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
import type { MonitorEvent, TransferProgress } from './shared/remote';

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
    pickFiles: () => ipcRenderer.invoke(IPC.systemPickFiles),
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
  files: {
    open: (request) => ipcRenderer.invoke(IPC.filesOpen, request),
    close: (connectionId) => ipcRenderer.invoke(IPC.filesClose, connectionId),
    home: (connectionId) => ipcRenderer.invoke(IPC.filesHome, connectionId),
    list: (connectionId, path) =>
      ipcRenderer.invoke(IPC.filesList, connectionId, path),
    stat: (connectionId, path) =>
      ipcRenderer.invoke(IPC.filesStat, connectionId, path),
    mkdir: (connectionId, parent, name) =>
      ipcRenderer.invoke(IPC.filesMkdir, connectionId, parent, name),
    rename: (connectionId, from, to) =>
      ipcRenderer.invoke(IPC.filesRename, connectionId, from, to),
    remove: (connectionId, path, kind, recursive) =>
      ipcRenderer.invoke(IPC.filesRemove, connectionId, path, kind, recursive),
    transfer: (request) => ipcRenderer.invoke(IPC.filesTransfer, request),
    cancelTransfer: (connectionId, transferId) =>
      ipcRenderer.send(IPC.filesCancelTransfer, connectionId, transferId),
    retryTransfer: (connectionId, transferId) =>
      ipcRenderer.send(IPC.filesRetryTransfer, connectionId, transferId),
    onTransfer: (listener) =>
      subscribe<[TransferProgress]>(IPC.filesTransferProgress, listener),
    onClosed: (listener) =>
      subscribe<[string, string | null]>(IPC.filesClosed, listener),
  },
  monitor: {
    start: (request) => ipcRenderer.invoke(IPC.monitorStart, request),
    stop: (connectionId) => ipcRenderer.invoke(IPC.monitorStop, connectionId),
    setInterval: (connectionId, intervalMs) =>
      ipcRenderer.send(IPC.monitorSetInterval, connectionId, intervalMs),
    setActive: (connectionId, active) =>
      ipcRenderer.send(IPC.monitorSetActive, connectionId, active),
    onEvent: (listener) =>
      subscribe<[MonitorEvent]>(IPC.monitorEvent, listener),
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
