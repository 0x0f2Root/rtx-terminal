import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { LoadedState, PickedWallpaper } from '../shared/api';
import {
  CONFIG_VERSION,
  isRecord,
  isValidWallpaperRef,
  parseCommandsFile,
  parseHistoryFile,
  parsePreferences,
  parseProfilesFile,
  type CommandsFile,
  type HistoryFile,
  type Preferences,
  type ProfilesFile,
  type SshHost,
} from '../shared/config';

const FILES = {
  preferences: 'preferences.json',
  commands: 'commands.json',
  profiles: 'sessions.json',
  history: 'history.json',
} as const;

const WALLPAPER_DIRECTORY = 'glass-wallpapers';
const MAX_WALLPAPER_BYTES = 12 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function wallpaperFormat(
  filePath: string,
): 'png' | 'jpg' | 'jpeg' | 'webp' | null {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return extension === 'png' ||
    extension === 'jpg' ||
    extension === 'jpeg' ||
    extension === 'webp'
    ? extension
    : null;
}

function hasImageSignature(
  buffer: Buffer,
  format: 'png' | 'jpg' | 'jpeg' | 'webp',
): boolean {
  if (format === 'png') return buffer.subarray(0, 8).equals(PNG_SIGNATURE);
  if (format === 'jpg' || format === 'jpeg')
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

function wallpaperMime(format: 'png' | 'jpg' | 'jpeg' | 'webp'): string {
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg';
  return `image/${format}`;
}

type FileKey = keyof typeof FILES;

/**
 * JSON files in the app's config directory (~/.config/rtx-terminal on Linux). Reads validate and
 * repair; unreadable files are moved aside, never overwritten in place. Writes are atomic.
 */
export class Store {
  private readonly queues = new Map<FileKey, Promise<void>>();
  private readonly pendingWallpapers = new Set<string>();
  private currentWallpaperRef: string | null = null;

  constructor(private readonly dir: string) {}

  async load(): Promise<LoadedState> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const warnings: string[] = [];
    let preferences = parsePreferences(
      await this.read('preferences', warnings),
    );
    let glassWallpaperDataUrl: string | null = null;
    if (preferences.glass.wallpaperRef) {
      try {
        glassWallpaperDataUrl = await this.readManagedWallpaper(
          preferences.glass.wallpaperRef,
        );
      } catch {
        const missingRef = preferences.glass.wallpaperRef;
        preferences = {
          ...preferences,
          glass: { ...preferences.glass, wallpaperRef: null },
        };
        warnings.push(
          'The Glass wallpaper is missing or invalid. The default background is in use.',
        );
        await this.write('preferences', preferences);
        await this.removeManagedWallpaper(missingRef).catch(() => undefined);
      }
    }
    this.currentWallpaperRef = preferences.glass.wallpaperRef;
    const commands = parseCommandsFile(await this.read('commands', warnings));
    const profiles = parseProfilesFile(await this.read('profiles', warnings));
    // History on disk is only honoured when the user chose to persist it.
    const history =
      preferences.history.mode === 'persist'
        ? parseHistoryFile(await this.read('history', warnings))
        : parseHistoryFile(null);
    return {
      preferences,
      commands,
      profiles,
      history,
      glassWallpaperDataUrl,
      warnings,
    };
  }

  async savePreferences(raw: unknown): Promise<Preferences> {
    const preferences = parsePreferences(raw);
    const nextWallpaperRef = preferences.glass.wallpaperRef;
    if (
      nextWallpaperRef &&
      nextWallpaperRef !== this.currentWallpaperRef &&
      !this.pendingWallpapers.has(nextWallpaperRef)
    ) {
      throw new Error('Choose the Glass wallpaper with the image picker.');
    }
    if (nextWallpaperRef) await this.readManagedWallpaper(nextWallpaperRef);
    await this.write('preferences', preferences);
    if (preferences.history.mode !== 'persist') await this.remove('history');
    const previousWallpaperRef = this.currentWallpaperRef;
    this.currentWallpaperRef = nextWallpaperRef;
    if (nextWallpaperRef) this.pendingWallpapers.delete(nextWallpaperRef);
    if (previousWallpaperRef && previousWallpaperRef !== nextWallpaperRef)
      await this.removeManagedWallpaper(previousWallpaperRef).catch(
        () => undefined,
      );
    return preferences;
  }

  async pickGlassWallpaper(sourcePath: string): Promise<PickedWallpaper> {
    const format = wallpaperFormat(sourcePath);
    if (!format) throw new Error('Choose a PNG, JPG, JPEG, or WebP image.');
    const stat = await fs.stat(sourcePath);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_WALLPAPER_BYTES)
      throw new Error('The image must be smaller than 12 MB.');
    const bytes = await fs.readFile(sourcePath);
    if (!hasImageSignature(bytes, format))
      throw new Error('The selected file is not a valid image of that type.');

    const wallpaperRef = `${randomUUID()}.${format}`;
    const directory = path.join(this.dir, WALLPAPER_DIRECTORY);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.managedWallpaperPath(wallpaperRef), bytes, {
      flag: 'wx',
      mode: 0o600,
    });
    this.pendingWallpapers.add(wallpaperRef);
    return {
      status: 'selected',
      wallpaperRef,
      dataUrl: `data:${wallpaperMime(format)};base64,${bytes.toString('base64')}`,
    };
  }

  async discardGlassWallpaper(wallpaperRef: string): Promise<void> {
    if (!this.pendingWallpapers.has(wallpaperRef)) return;
    this.pendingWallpapers.delete(wallpaperRef);
    await this.removeManagedWallpaper(wallpaperRef);
  }

  private managedWallpaperPath(wallpaperRef: string): string {
    if (!isValidWallpaperRef(wallpaperRef))
      throw new Error('Invalid Glass wallpaper reference.');
    return path.join(this.dir, WALLPAPER_DIRECTORY, wallpaperRef);
  }

  private async readManagedWallpaper(wallpaperRef: string): Promise<string> {
    const format = wallpaperFormat(wallpaperRef);
    if (!format || !isValidWallpaperRef(wallpaperRef))
      throw new Error('Invalid Glass wallpaper reference.');
    const filePath = this.managedWallpaperPath(wallpaperRef);
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_WALLPAPER_BYTES)
      throw new Error('The stored Glass wallpaper is invalid.');
    const bytes = await fs.readFile(filePath);
    if (!hasImageSignature(bytes, format))
      throw new Error('The stored Glass wallpaper is invalid.');
    return `data:${wallpaperMime(format)};base64,${bytes.toString('base64')}`;
  }

  private async removeManagedWallpaper(wallpaperRef: string): Promise<void> {
    if (!isValidWallpaperRef(wallpaperRef)) return;
    await fs.rm(this.managedWallpaperPath(wallpaperRef), { force: true });
  }

  async saveCommands(raw: unknown): Promise<CommandsFile> {
    const commands = parseCommandsFile(raw);
    await this.write('commands', commands);
    return commands;
  }

  /** A saved SSH host, read from disk so connections use what was saved, not what was sent. */
  async sshHost(id: string): Promise<SshHost | null> {
    const profiles = parseProfilesFile(await this.read('profiles', []));
    return profiles.hosts.find((host) => host.id === id) ?? null;
  }

  async saveProfiles(raw: unknown): Promise<ProfilesFile> {
    const profiles = parseProfilesFile(raw);
    await this.write('profiles', profiles);
    return profiles;
  }

  async saveHistory(
    raw: unknown,
    mode: Preferences['history']['mode'],
    maxEntries: number,
  ): Promise<void> {
    if (mode !== 'persist') return;
    const history: HistoryFile = parseHistoryFile(raw);
    history.entries = history.entries.slice(-maxEntries);
    await this.write('history', history);
  }

  async clearHistory(): Promise<void> {
    await this.remove('history');
  }

  /**
   * Returns the parsed JSON, or null when the file is missing. Corrupt files and files from a
   * newer version are renamed so the user's data is kept and the app starts with defaults.
   */
  private async read(key: FileKey, warnings: string[]): Promise<unknown> {
    const file = path.join(this.dir, FILES[key]);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      warnings.push(`${FILES[key]} could not be read and defaults are in use.`);
      return null;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      const aside = await this.moveAside(file, 'corrupt');
      warnings.push(
        `${FILES[key]} was not valid JSON. It was moved to ${path.basename(aside)} and defaults are in use.`,
      );
      return null;
    }
    if (
      isRecord(data) &&
      typeof data.version === 'number' &&
      data.version > CONFIG_VERSION
    ) {
      const aside = await this.moveAside(file, `v${data.version}`);
      warnings.push(
        `${FILES[key]} was written by a newer version. It was moved to ${path.basename(aside)}.`,
      );
      return null;
    }
    return data;
  }

  private async moveAside(file: string, label: string): Promise<string> {
    // File recovery runs in the main process; this timestamp is outside React rendering.
    const target = `${file}.${label}-${Date.now()}`;
    await fs.rename(file, target).catch(() => undefined);
    return target;
  }

  /** Writes are serialized per file and land atomically through a rename. */
  private write(key: FileKey, data: unknown): Promise<void> {
    const file = path.join(this.dir, FILES[key]);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(async () => {
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, {
        mode: 0o600,
      });
      await fs.rename(tmp, file);
    });
    this.queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  private remove(key: FileKey): Promise<void> {
    const file = path.join(this.dir, FILES[key]);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(() => fs.rm(file, { force: true }));
    this.queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }
}
