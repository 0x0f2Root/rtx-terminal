import type {
  CommandsFile,
  HistoryFile,
  Preferences,
  ProfilesFile,
  SavedCommand,
} from './config';

/**
 * The only surface the renderer has into the privileged side. Implemented by the preload script
 * over named IPC channels; every argument is validated again in the main process.
 */

/** Local shells and SSH sessions share one contract; the backend decides how they run. */
export type SessionKind = 'local' | 'ssh';

/** Who an SSH session is connected to. Never contains credentials. */
export type RemoteEndpoint = {
  hostId: string;
  host: string;
  port: number;
  username: string;
};

export type SessionInfo = {
  id: string;
  kind: SessionKind;
  shell: string;
  shellName: string;
  cwd: string;
  /** 0 for SSH sessions, which have no local process. */
  pid: number;
  remote?: RemoteEndpoint;
};

/**
 * Opens a saved SSH host. The host is referenced by id: the renderer cannot point a connection
 * at arbitrary addresses. Secrets typed by the user are passed once and never sent back.
 */
export type SshCreateRequest = {
  hostId: string;
  /** Correlates progress events and lets the renderer cancel this attempt. */
  requestId: string;
  password?: string;
  passphrase?: string;
  /** Save the password or passphrase in the OS keyring after a successful login. */
  saveSecret?: boolean;
};

export type SshConnectState = 'connecting' | 'authenticating' | 'connected';

export type SshErrorCode =
  | 'dns'
  | 'refused'
  | 'unreachable'
  | 'timeout'
  | 'auth'
  | 'agent'
  | 'key-file'
  | 'password-required'
  | 'passphrase-required'
  | 'passphrase-wrong'
  | 'host-key-rejected'
  | 'host-key-changed'
  | 'host-key-revoked'
  | 'cancelled'
  | 'network'
  | 'protocol'
  | 'host-missing';

/** Sent to the renderer when a host key needs an explicit decision. */
export type HostKeyPrompt = {
  promptId: string;
  requestId: string;
  hostLabel: string;
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  status: 'unknown' | 'changed';
  knownFingerprints: string[];
  /** Where the conflicting entry came from: the app's trust store or ~/.ssh/known_hosts. */
  source: 'app' | 'user' | null;
};

export type SecretState = {
  /** False when the OS keyring is unavailable; secrets are then never saved. */
  available: boolean;
  backend: string;
  saved: Record<string, ('password' | 'passphrase')[]>;
};

export type CreateSessionRequest = {
  cols: number;
  rows: number;
  /** Absolute path; must be a known shell or an executable file. Omit for the preferred shell. */
  shell?: string;
  /** Absolute path of an existing directory. Omit for the home directory. */
  cwd?: string;
  /** Present for SSH sessions; `shell` and `cwd` are then ignored. */
  ssh?: SshCreateRequest;
};

export type CreateSessionResult =
  | { ok: true; session: SessionInfo }
  | { ok: false; error: string; code?: SshErrorCode };

export type SessionExit = {
  exitCode: number;
  signal: number | null;
  /** Why an SSH session ended, in words safe to show. */
  reason?: string | null;
};

/** Live facts read from /proc for the status bar; null fields mean the value could not be read. */
export type SessionRuntimeInfo = {
  cwd: string | null;
  foregroundProcess: string | null;
};

export type ShellInfo = { path: string; name: string; isDefault: boolean };

/** Real version facts for the About dialog. */
export type AppInfo = {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
};

export type LoadedState = {
  preferences: Preferences;
  commands: CommandsFile;
  profiles: ProfilesFile;
  history: HistoryFile;
  /** Encoded image data from the app-managed wallpaper file, if it exists and is valid. */
  glassWallpaperDataUrl: string | null;
  /** Files that could not be read and were reset; their originals are kept beside them. */
  warnings: string[];
};

export type PickedWallpaper =
  | { status: 'cancelled' }
  | { status: 'selected'; wallpaperRef: string; dataUrl: string };

export type ImportResult =
  | {
      ok: true;
      commands: SavedCommand[];
      categories: CommandsFile['categories'];
    }
  | { ok: false; cancelled: boolean; error?: string };

export type ExportResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: boolean; error?: string };

export type Unsubscribe = () => void;

export interface RtxApi {
  terminal: {
    create(request: CreateSessionRequest): Promise<CreateSessionResult>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    /** Acknowledges output the renderer has finished parsing, for PTY flow control. */
    ack(sessionId: string, bytes: number): void;
    close(sessionId: string): Promise<void>;
    info(sessionId: string): Promise<SessionRuntimeInfo | null>;
    onData(listener: (sessionId: string, data: string) => void): Unsubscribe;
    onExit(
      listener: (sessionId: string, exit: SessionExit) => void,
    ): Unsubscribe;
  };
  system: {
    shells(): Promise<ShellInfo[]>;
    homeDir(): Promise<string>;
    openExternal(url: string): Promise<boolean>;
    readClipboard(): Promise<string>;
    writeClipboard(text: string): Promise<void>;
    /** Lets the user pick a directory with the native dialog; the path never comes from the page. */
    pickDirectory(): Promise<string | null>;
    appInfo(): Promise<AppInfo>;
    /** Toggles the window's full screen state and returns the new state. */
    toggleFullScreen(): Promise<boolean>;
    /** Quits the app; shells are ended first by the main process. */
    quit(): Promise<void>;
  };
  ssh: {
    /** Aborts a connection attempt that has not finished yet. */
    cancel(requestId: string): Promise<void>;
    answerHostKey(promptId: string, trust: boolean): Promise<void>;
    onProgress(
      listener: (requestId: string, state: SshConnectState) => void,
    ): Unsubscribe;
    onHostKeyPrompt(listener: (prompt: HostKeyPrompt) => void): Unsubscribe;
    secretState(): Promise<SecretState>;
    forgetSecrets(hostId: string): Promise<void>;
    /** Plain `Host` aliases from ~/.ssh/config, for the host editor. */
    configAliases(): Promise<string[]>;
    /** Lets the user pick a private key with the native dialog. */
    pickKeyFile(): Promise<string | null>;
  };
  store: {
    load(): Promise<LoadedState>;
    savePreferences(preferences: Preferences): Promise<Preferences>;
    pickGlassWallpaper(): Promise<PickedWallpaper>;
    discardGlassWallpaper(wallpaperRef: string): Promise<void>;
    saveCommands(commands: CommandsFile): Promise<CommandsFile>;
    saveProfiles(profiles: ProfilesFile): Promise<ProfilesFile>;
    saveHistory(history: HistoryFile): Promise<void>;
    clearHistory(): Promise<void>;
    exportCommands(commands: CommandsFile): Promise<ExportResult>;
    importCommands(): Promise<ImportResult>;
  };
}

export const IPC = {
  terminalCreate: 'terminal:create',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalAck: 'terminal:ack',
  terminalClose: 'terminal:close',
  terminalInfo: 'terminal:info',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  systemShells: 'system:shells',
  systemHomeDir: 'system:home-dir',
  systemOpenExternal: 'system:open-external',
  systemReadClipboard: 'system:read-clipboard',
  systemWriteClipboard: 'system:write-clipboard',
  systemPickDirectory: 'system:pick-directory',
  systemAppInfo: 'system:app-info',
  systemToggleFullScreen: 'system:toggle-full-screen',
  systemQuit: 'system:quit',
  sshCancel: 'ssh:cancel',
  sshAnswerHostKey: 'ssh:answer-host-key',
  sshProgress: 'ssh:progress',
  sshHostKeyPrompt: 'ssh:host-key-prompt',
  sshSecretState: 'ssh:secret-state',
  sshForgetSecrets: 'ssh:forget-secrets',
  sshConfigAliases: 'ssh:config-aliases',
  sshPickKeyFile: 'ssh:pick-key-file',
  storeLoad: 'store:load',
  storeSavePreferences: 'store:save-preferences',
  storePickGlassWallpaper: 'store:pick-glass-wallpaper',
  storeDiscardGlassWallpaper: 'store:discard-glass-wallpaper',
  storeSaveCommands: 'store:save-commands',
  storeSaveProfiles: 'store:save-profiles',
  storeSaveHistory: 'store:save-history',
  storeClearHistory: 'store:clear-history',
  storeExportCommands: 'store:export-commands',
  storeImportCommands: 'store:import-commands',
} as const;
