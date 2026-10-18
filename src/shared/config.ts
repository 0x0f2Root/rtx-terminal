/**
 * Persisted data shapes and their validators. Shared by the main process (which owns the files)
 * and the renderer (which only sees validated values). Every loader tolerates missing or partial
 * data: invalid fields fall back to defaults, invalid list entries are dropped.
 */

export const CONFIG_VERSION = 1;

export type CursorStyle = 'block' | 'bar' | 'underline';
export type HistoryMode = 'off' | 'memory' | 'persist';
export const APP_THEME_IDS = [
  'gray-dark',
  'full-black',
  'light',
  'glass',
] as const;
export type AppThemeId = (typeof APP_THEME_IDS)[number];
export type GlassTint = 'black' | 'neutral' | 'warm';

export type GlassPreferences = {
  /** Opaque generated reference to a PNG, JPG, or WebP in the app data folder. */
  wallpaperRef: string | null;
  blur: number;
  /** Percent of the underlying image visible through glass surfaces. */
  transparency: number;
  tint: GlassTint;
  dimming: number;
};

export type TerminalPreferences = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  themeId: string;
  scrollback: number;
  /** Absolute path of the shell to start; null uses the login shell from the system. */
  defaultShell: string | null;
  /** Used to size a new PTY before its pane has been measured. */
  defaultCols: number;
  defaultRows: number;
  /** GPU rendering through WebGL; falls back to the DOM renderer when unavailable. */
  gpuAcceleration: boolean;
  copyOnSelect: boolean;
};

export type Preferences = {
  version: number;
  terminal: TerminalPreferences;
  ui: { sidebarOpen: boolean; theme: AppThemeId };
  glass: GlassPreferences;
  /** Overrides for the shortcut registry, keyed by action id. null disables the shortcut. */
  shortcuts: Record<string, string | null>;
  history: { mode: HistoryMode; maxEntries: number };
};

export type CommandCategory = { id: string; name: string };

export type SavedCommand = {
  id: string;
  name: string;
  description: string;
  command: string;
  categoryId: string | null;
  tags: string[];
  /** Accelerator such as "Ctrl+Alt+1" that inserts the command into the active terminal. */
  shortcut: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CommandsFile = {
  version: number;
  categories: CommandCategory[];
  commands: SavedCommand[];
};

export type SshAuthMethod = 'agent' | 'key' | 'password';

/**
 * A saved SSH host. It holds no secrets: passwords and key passphrases live in the OS keyring
 * (see src/main/ssh/secrets.ts) and private keys are referenced by path, read only to connect.
 */
export type SshHost = {
  id: string;
  name: string;
  /** Hostname or IP address. May be empty when `configAlias` supplies it. */
  host: string;
  port: number;
  /** May be empty when `configAlias` supplies it. */
  username: string;
  auth: SshAuthMethod;
  /** Private key file for `key` auth: absolute or starting with `~/`. */
  keyPath: string | null;
  /** A `Host` alias in ~/.ssh/config whose HostName, User, Port and IdentityFile fill blanks. */
  configAlias: string | null;
  group: string | null;
  tags: string[];
  notes: string;
  /** Seconds to wait for the connection and authentication to finish. */
  connectTimeout: number;
  /** Seconds between keepalive probes; 0 turns them off. */
  keepAlive: number;
};

export type ProfilesFile = {
  version: number;
  hosts: SshHost[];
};

export type HistoryEntry = {
  id: string;
  command: string;
  timestamp: number;
  cwd: string | null;
  shell: string | null;
  /** How the command reached the terminal: typed by the user, or sent by the app. */
  source: 'typed' | 'app';
};

export type HistoryFile = { version: number; entries: HistoryEntry[] };

export const LIMITS = {
  name: 120,
  description: 2000,
  command: 20000,
  tag: 40,
  tags: 20,
  path: 4096,
  commands: 5000,
  categories: 200,
  historyMax: 10000,
  hosts: 500,
  notes: 4000,
} as const;

export const DEFAULT_PREFERENCES: Preferences = {
  version: CONFIG_VERSION,
  terminal: {
    fontFamily: 'JetBrains Mono Variable',
    fontSize: 13,
    lineHeight: 1.2,
    cursorStyle: 'block',
    cursorBlink: true,
    themeId: 'rtx-dark',
    scrollback: 10000,
    defaultShell: null,
    defaultCols: 100,
    defaultRows: 30,
    gpuAcceleration: true,
    copyOnSelect: false,
  },
  ui: { sidebarOpen: true, theme: 'gray-dark' },
  glass: {
    wallpaperRef: null,
    blur: 14,
    transparency: 38,
    tint: 'warm',
    dimming: 10,
  },
  shortcuts: {},
  history: { mode: 'memory', maxEntries: 1000 },
};

export const DEFAULT_COMMANDS: CommandsFile = {
  version: CONFIG_VERSION,
  categories: [
    { id: 'cat-system', name: 'System' },
    { id: 'cat-git', name: 'Git' },
  ],
  commands: [
    {
      id: 'cmd-disk',
      name: 'Disk usage',
      description: 'Human-readable usage for mounted filesystems.',
      command: 'df -h',
      categoryId: 'cat-system',
      tags: ['disk'],
      shortcut: null,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: 'cmd-git-status',
      name: 'Git status',
      description: 'Short status with the current branch.',
      command: 'git status -sb',
      categoryId: 'cat-git',
      tags: ['git'],
      shortcut: null,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
};

export const DEFAULT_PROFILES: ProfilesFile = {
  version: CONFIG_VERSION,
  hosts: [],
};

export const EMPTY_HISTORY: HistoryFile = {
  version: CONFIG_VERSION,
  entries: [],
};

// --- primitive guards -------------------------------------------------------

type Unknown = Record<string, unknown>;

export function isRecord(value: unknown): value is Unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number, fallback: string): string {
  return typeof value === 'string' && value.length <= max ? value : fallback;
}

function nullableStr(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    ? value
    : null;
}

function num(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

const WALLPAPER_REF_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g|webp)$/i;

export function isValidWallpaperRef(value: unknown): value is string {
  return typeof value === 'string' && WALLPAPER_REF_PATTERN.test(value);
}

function list<T>(
  value: unknown,
  max: number,
  parse: (item: unknown) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value.slice(0, max)) {
    const parsed = parse(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) =>
    seen.has(item.id) ? false : (seen.add(item.id), true),
  );
}

/** Accelerators are "Mod+Mod+Key": a printable key or a named key, after up to four modifiers. */
const ACCELERATOR_PATTERN =
  /^((Ctrl|Shift|Alt|Meta)\+){0,4}([A-Z0-9[\]\\;',./`=-]|F([1-9]|1[0-2])|Tab|Enter|Escape|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|Home|End|Delete|Backspace)$/;

export function isValidAccelerator(value: unknown): value is string {
  return typeof value === 'string' && ACCELERATOR_PATTERN.test(value);
}

// --- domain validators ------------------------------------------------------

export function parsePreferences(raw: unknown): Preferences {
  const d = DEFAULT_PREFERENCES;
  const r = isRecord(raw) ? raw : {};
  const t = isRecord(r.terminal) ? r.terminal : {};
  const ui = isRecord(r.ui) ? r.ui : {};
  const glass = isRecord(r.glass) ? r.glass : {};
  const h = isRecord(r.history) ? r.history : {};
  const shortcuts: Record<string, string | null> = {};
  if (isRecord(r.shortcuts)) {
    for (const [key, value] of Object.entries(r.shortcuts).slice(0, 200)) {
      if (!/^[a-z][a-zA-Z0-9.-]{0,63}$/.test(key)) continue;
      if (value === null || isValidAccelerator(value)) shortcuts[key] = value;
    }
  }
  return {
    version: CONFIG_VERSION,
    terminal: {
      fontFamily:
        str(t.fontFamily, 200, d.terminal.fontFamily).trim() ||
        d.terminal.fontFamily,
      fontSize: num(t.fontSize, 8, 32, d.terminal.fontSize),
      lineHeight: num(t.lineHeight, 1, 2, d.terminal.lineHeight),
      cursorStyle: oneOf(
        t.cursorStyle,
        ['block', 'bar', 'underline'] as const,
        d.terminal.cursorStyle,
      ),
      cursorBlink: bool(t.cursorBlink, d.terminal.cursorBlink),
      themeId: str(t.themeId, 64, d.terminal.themeId),
      scrollback: num(t.scrollback, 0, 100000, d.terminal.scrollback),
      defaultShell: nullableStr(t.defaultShell, LIMITS.path),
      defaultCols: Math.round(
        num(t.defaultCols, 20, 500, d.terminal.defaultCols),
      ),
      defaultRows: Math.round(
        num(t.defaultRows, 5, 200, d.terminal.defaultRows),
      ),
      gpuAcceleration: bool(t.gpuAcceleration, d.terminal.gpuAcceleration),
      copyOnSelect: bool(t.copyOnSelect, d.terminal.copyOnSelect),
    },
    ui: {
      sidebarOpen: bool(ui.sidebarOpen, d.ui.sidebarOpen),
      theme: oneOf(ui.theme, APP_THEME_IDS, d.ui.theme),
    },
    glass: {
      wallpaperRef: isValidWallpaperRef(glass.wallpaperRef)
        ? glass.wallpaperRef
        : null,
      blur: num(glass.blur, 0, 28, d.glass.blur),
      transparency: num(glass.transparency, 20, 55, d.glass.transparency),
      tint: oneOf(
        glass.tint,
        ['black', 'neutral', 'warm'] as const,
        d.glass.tint,
      ),
      dimming: num(glass.dimming, 0, 45, d.glass.dimming),
    },
    shortcuts,
    history: {
      mode: oneOf(
        h.mode,
        ['off', 'memory', 'persist'] as const,
        d.history.mode,
      ),
      maxEntries: Math.round(
        num(h.maxEntries, 10, LIMITS.historyMax, d.history.maxEntries),
      ),
    },
  };
}

function parseCategory(item: unknown): CommandCategory | null {
  if (!isRecord(item) || !isValidId(item.id)) return null;
  const name = str(item.name, LIMITS.name, '').trim();
  return name ? { id: item.id, name } : null;
}

export function parseSavedCommand(item: unknown): SavedCommand | null {
  if (!isRecord(item) || !isValidId(item.id)) return null;
  const name = str(item.name, LIMITS.name, '').trim();
  const command = str(item.command, LIMITS.command, '');
  if (!name || !command.trim()) return null;
  return {
    id: item.id,
    name,
    description: str(item.description, LIMITS.description, ''),
    command,
    categoryId: isValidId(item.categoryId) ? item.categoryId : null,
    tags: list(item.tags, LIMITS.tags, (tag) => {
      const value = str(tag, LIMITS.tag, '').trim();
      return value || null;
    }),
    shortcut: isValidAccelerator(item.shortcut) ? item.shortcut : null,
    createdAt: num(item.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: num(item.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

export function parseCommandsFile(raw: unknown): CommandsFile {
  if (!isRecord(raw)) return structuredClone(DEFAULT_COMMANDS);
  const categories = uniqueById(
    list(raw.categories, LIMITS.categories, parseCategory),
  );
  const categoryIds = new Set(categories.map((c) => c.id));
  const commands = uniqueById(
    list(raw.commands, LIMITS.commands, parseSavedCommand),
  ).map((c) =>
    c.categoryId && !categoryIds.has(c.categoryId)
      ? { ...c, categoryId: null }
      : c,
  );
  return { version: CONFIG_VERSION, categories, commands };
}

// --- SSH hosts ------------------------------------------------------------------

/** Hostnames, IPv4 and IPv6 literals. No spaces, quotes or a leading dash. */
const SSH_HOSTNAME = /^(?!-)[A-Za-z0-9._:%-]{1,253}$/;
const SSH_USERNAME = /^(?!-)[A-Za-z0-9._@+\\-]{1,64}$/;
const SSH_CONFIG_ALIAS = /^(?!-)[A-Za-z0-9._@+-]{1,128}$/;

export type SshHostDraft = Omit<SshHost, 'id'>;
export type SshHostErrors = Partial<Record<keyof SshHostDraft, string>>;

/** Field-level validation shared by the host editor and the main process. */
export function validateSshHost(host: SshHostDraft): SshHostErrors {
  const errors: SshHostErrors = {};
  const viaConfig = Boolean(host.configAlias);
  if (!host.name.trim()) errors.name = 'Give the host a name.';
  else if (host.name.length > LIMITS.name)
    errors.name = 'The name is too long.';
  if (host.configAlias && !SSH_CONFIG_ALIAS.test(host.configAlias))
    errors.configAlias =
      'Use the alias exactly as written after "Host" in ~/.ssh/config.';
  if (!host.host && !viaConfig) errors.host = 'Enter a hostname or IP address.';
  else if (host.host && !SSH_HOSTNAME.test(host.host))
    errors.host =
      'Use a hostname or IP address without spaces or a leading dash.';
  if (!Number.isInteger(host.port) || host.port < 1 || host.port > 65535)
    errors.port = 'Use a port between 1 and 65535.';
  if (!host.username && !viaConfig)
    errors.username = 'Enter the user to log in as.';
  else if (host.username && !SSH_USERNAME.test(host.username))
    errors.username = 'Use letters, digits, dots, dashes, underscores or @.';
  if (host.auth === 'key' && !host.keyPath && !viaConfig)
    errors.keyPath = 'Choose the private key file.';
  if (
    host.keyPath &&
    (host.keyPath.length > LIMITS.path ||
      host.keyPath.includes('\0') ||
      !(host.keyPath.startsWith('/') || host.keyPath.startsWith('~/')))
  )
    errors.keyPath = 'Use an absolute path or one starting with ~/.';
  if (host.notes.length > LIMITS.notes)
    errors.notes = 'The notes are too long.';
  if (host.connectTimeout < 5 || host.connectTimeout > 120)
    errors.connectTimeout = 'Use between 5 and 120 seconds.';
  if (host.keepAlive < 0 || host.keepAlive > 300)
    errors.keepAlive = 'Use between 0 and 300 seconds.';
  return errors;
}

export function parseSshHost(item: unknown): SshHost | null {
  if (!isRecord(item) || !isValidId(item.id)) return null;
  const host: SshHost = {
    id: item.id,
    name: str(item.name, LIMITS.name, '').trim(),
    host: str(item.host, 253, '').trim(),
    port: Math.round(num(item.port, 1, 65535, 22)),
    username: str(item.username, 64, '').trim(),
    auth: oneOf(item.auth, ['agent', 'key', 'password'] as const, 'agent'),
    keyPath: nullableStr(item.keyPath, LIMITS.path),
    configAlias: nullableStr(item.configAlias, 128),
    group: nullableStr(
      typeof item.group === 'string' ? item.group.trim() : null,
      LIMITS.name,
    ),
    tags: list(item.tags, LIMITS.tags, (tag) => {
      const value = str(tag, LIMITS.tag, '').trim();
      return value || null;
    }),
    notes: str(item.notes, LIMITS.notes, ''),
    connectTimeout: Math.round(num(item.connectTimeout, 5, 120, 20)),
    keepAlive: Math.round(num(item.keepAlive, 0, 300, 15)),
  };
  return Object.keys(validateSshHost(host)).length === 0 ? host : null;
}

export function parseProfilesFile(raw: unknown): ProfilesFile {
  if (!isRecord(raw)) return structuredClone(DEFAULT_PROFILES);
  return {
    version: CONFIG_VERSION,
    hosts: uniqueById(list(raw.hosts, LIMITS.hosts, parseSshHost)),
  };
}

function parseHistoryEntry(item: unknown): HistoryEntry | null {
  if (!isRecord(item) || !isValidId(item.id)) return null;
  const command = str(item.command, LIMITS.command, '');
  if (!command.trim()) return null;
  return {
    id: item.id,
    command,
    timestamp: num(item.timestamp, 0, Number.MAX_SAFE_INTEGER, 0),
    cwd: nullableStr(item.cwd, LIMITS.path),
    shell: nullableStr(item.shell, LIMITS.path),
    source: oneOf(item.source, ['typed', 'app'] as const, 'typed'),
  };
}

export function parseHistoryFile(raw: unknown): HistoryFile {
  if (!isRecord(raw)) return structuredClone(EMPTY_HISTORY);
  return {
    version: CONFIG_VERSION,
    entries: uniqueById(
      list(raw.entries, LIMITS.historyMax, parseHistoryEntry),
    ),
  };
}
