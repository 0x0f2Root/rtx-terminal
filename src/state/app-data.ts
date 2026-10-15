import { toast } from 'sonner';
import type { ShellInfo } from '@/shared/api';
import {
  DEFAULT_COMMANDS,
  DEFAULT_PREFERENCES,
  DEFAULT_PROFILES,
  EMPTY_HISTORY,
  type CommandsFile,
  type HistoryEntry,
  type HistoryFile,
  type Preferences,
  type ProfilesFile,
} from '@/shared/config';
import { createStore, useStore } from '@/lib/create-store';
import { newId } from '@/lib/ids';

/**
 * Everything the app persists, mirrored in the renderer. Updates apply immediately and are written
 * through the preload API; the main process validates and owns the files.
 */
export type AppData = {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  preferences: Preferences;
  glassWallpaperUrl: string | null;
  commands: CommandsFile;
  profiles: ProfilesFile;
  history: HistoryFile;
  shells: ShellInfo[];
  homeDir: string;
};

export const appData = createStore<AppData>({
  status: 'loading',
  error: null,
  preferences: DEFAULT_PREFERENCES,
  glassWallpaperUrl: null,
  commands: DEFAULT_COMMANDS,
  profiles: DEFAULT_PROFILES,
  history: EMPTY_HISTORY,
  shells: [],
  homeDir: '',
});

export function useAppData<S>(selector: (state: AppData) => S): S {
  return useStore(appData, selector);
}

export async function createGlassWallpaperUrl(
  dataUrl: string,
): Promise<string | null> {
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return null;

  let binary: string;
  try {
    binary = atob(match[2]);
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const wallpaperUrl = URL.createObjectURL(
    new Blob([bytes], { type: `image/${match[1]}` }),
  );
  const valid = await new Promise<boolean>((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve(
        image.naturalWidth > 0 &&
          image.naturalHeight > 0 &&
          image.naturalWidth * image.naturalHeight <= 80_000_000,
      );
    image.onerror = () => resolve(false);
    image.src = wallpaperUrl;
  });
  if (!valid) {
    URL.revokeObjectURL(wallpaperUrl);
    return null;
  }
  return wallpaperUrl;
}

export async function loadAppData(): Promise<void> {
  appData.set((state) => ({ ...state, status: 'loading', error: null }));
  try {
    const [loaded, shells, homeDir] = await Promise.all([
      window.rtx.store.load(),
      window.rtx.system.shells(),
      window.rtx.system.homeDir(),
    ]);
    let preferences = loaded.preferences;
    const wallpaperDataUrl = loaded.glassWallpaperDataUrl;
    let glassWallpaperUrl = wallpaperDataUrl
      ? await createGlassWallpaperUrl(wallpaperDataUrl)
      : null;
    if (wallpaperDataUrl && !glassWallpaperUrl) {
      preferences = {
        ...preferences,
        glass: { ...preferences.glass, wallpaperRef: null },
      };
      loaded.warnings.push(
        'The Glass wallpaper could not be decoded. The default background is in use.',
      );
      await window.rtx.store.savePreferences(preferences);
    }
    appData.set({
      status: 'ready',
      error: null,
      preferences,
      glassWallpaperUrl,
      commands: loaded.commands,
      profiles: loaded.profiles,
      history: loaded.history,
      shells,
      homeDir,
    });
    for (const warning of loaded.warnings) toast.warning(warning);
  } catch (error) {
    appData.set((state) => ({
      ...state,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export function setGlassWallpaperUrl(url: string | null): void {
  const previousUrl = appData.get().glassWallpaperUrl;
  if (previousUrl && previousUrl !== url) URL.revokeObjectURL(previousUrl);
  appData.set((state) => ({ ...state, glassWallpaperUrl: url }));
}

function reportSaveError(what: string) {
  return (error: unknown) => {
    toast.error(`Could not save ${what}`, {
      description: error instanceof Error ? error.message : String(error),
    });
  };
}

export function updatePreferences(
  update: (preferences: Preferences) => Preferences,
): void {
  const next = update(appData.get().preferences);
  appData.set((state) => ({ ...state, preferences: next }));
  window.rtx.store
    .savePreferences(next)
    .then((saved) => {
      // The main process may have corrected invalid values; adopt what was actually stored.
      if (JSON.stringify(saved) !== JSON.stringify(appData.get().preferences)) {
        appData.set((state) => ({ ...state, preferences: saved }));
      }
      if (saved.history.mode === 'off')
        appData.set((state) => ({ ...state, history: EMPTY_HISTORY }));
      else if (saved.history.mode === 'persist') scheduleHistorySave();
    })
    .catch(reportSaveError('preferences'));
}

export function updateCommands(
  update: (commands: CommandsFile) => CommandsFile,
): void {
  const next = update(appData.get().commands);
  appData.set((state) => ({ ...state, commands: next }));
  window.rtx.store.saveCommands(next).catch(reportSaveError('saved commands'));
}

/** Resolves true once the change is on disk (the main process reads SSH hosts from there). */
export function updateProfiles(
  update: (profiles: ProfilesFile) => ProfilesFile,
): Promise<boolean> {
  const next = update(appData.get().profiles);
  appData.set((state) => ({ ...state, profiles: next }));
  return window.rtx.store.saveProfiles(next).then(
    () => true,
    (error: unknown) => {
      reportSaveError('sessions')(error);
      return false;
    },
  );
}

// --- history ------------------------------------------------------------------

let historyTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleHistorySave(): void {
  if (historyTimer) clearTimeout(historyTimer);
  historyTimer = setTimeout(() => {
    historyTimer = null;
    const { preferences, history } = appData.get();
    if (preferences.history.mode !== 'persist') return;
    window.rtx.store
      .saveHistory(history)
      .catch(reportSaveError('command history'));
  }, 1000);
}

/** Records a command the app observed. Nothing is kept when history is off. */
export function recordHistory(
  entry: Omit<HistoryEntry, 'id' | 'timestamp'>,
): void {
  const { preferences } = appData.get();
  if (preferences.history.mode === 'off') return;
  const command = entry.command.trim();
  if (!command) return;
  appData.set((state) => {
    const entries = state.history.entries;
    // Repeating the previous command moves it to the end instead of adding a duplicate.
    const last = entries.at(-1);
    const base =
      last && last.command === command ? entries.slice(0, -1) : entries;
    const next = [
      ...base,
      // Event-time stamp for a command; this helper runs from terminal input, never render.
      { ...entry, command, id: newId('h'), timestamp: Date.now() },
    ];
    return {
      ...state,
      history: {
        ...state.history,
        entries: next.slice(-state.preferences.history.maxEntries),
      },
    };
  });
  if (preferences.history.mode === 'persist') scheduleHistorySave();
}

export function removeHistoryEntry(id: string): void {
  appData.set((state) => ({
    ...state,
    history: {
      ...state.history,
      entries: state.history.entries.filter((e) => e.id !== id),
    },
  }));
  if (appData.get().preferences.history.mode === 'persist')
    scheduleHistorySave();
}

export function clearHistory(): void {
  appData.set((state) => ({ ...state, history: EMPTY_HISTORY }));
  window.rtx.store.clearHistory().catch(reportSaveError('command history'));
}

// Development only: this module holds live terminals, which hot replacement cannot carry over.
// Reload the page instead; the main process ends the old sessions when the page navigates.
if (import.meta.hot) import.meta.hot.dispose(() => window.location.reload());
