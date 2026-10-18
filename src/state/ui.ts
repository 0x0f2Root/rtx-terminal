import type { SessionRuntimeInfo } from '@/shared/api';
import type { SavedCommand, SshHost } from '@/shared/config';
import { createStore, useStore } from '@/lib/create-store';

/** Transient interface state: which overlay is open and what it is editing. Never persisted. */

export type SettingsSection =
  | 'themes'
  | 'appearance'
  | 'shell'
  | 'keyboard'
  | 'history';

export type PalettePage =
  | 'root'
  | 'themes'
  | 'commands'
  | 'tabs'
  | 'history'
  | 'hosts';

export type SearchState = {
  open: boolean;
  paneId: string | null;
  query: string;
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
  resultIndex: number;
  resultCount: number;
};

export type UiState = {
  palette: { open: boolean; page: PalettePage };
  search: SearchState;
  settingsOpen: boolean;
  /** The section Settings shows when it opens. */
  settingsSection: SettingsSection;
  aboutOpen: boolean;
  commandsOpen: boolean;
  historyOpen: boolean;
  /** null: closed; 'new': creating; a command: editing it. */
  commandEditor: SavedCommand | 'new' | null;
  commandEditorDefaults: Partial<SavedCommand> | null;
  /** null: closed; 'new': creating; a host: editing it. */
  hostEditor: SshHost | 'new' | null;
  hostEditorDefaults: Partial<SshHost> | null;
  hostsOpen: boolean;
  renameTabId: string | null;
  /** A command waiting for the user to confirm it may run. */
  pendingRun: {
    command: string;
    paneId: string;
    reason: string;
    source: 'saved' | 'history';
  } | null;
  runtime: { paneId: string | null; info: SessionRuntimeInfo | null };
};

export const ui = createStore<UiState>({
  palette: { open: false, page: 'root' },
  search: {
    open: false,
    paneId: null,
    query: '',
    caseSensitive: false,
    regex: false,
    wholeWord: false,
    resultIndex: -1,
    resultCount: 0,
  },
  settingsOpen: false,
  settingsSection: 'appearance',
  aboutOpen: false,
  commandsOpen: false,
  historyOpen: false,
  commandEditor: null,
  commandEditorDefaults: null,
  hostEditor: null,
  hostEditorDefaults: null,
  hostsOpen: false,
  renameTabId: null,
  pendingRun: null,
  runtime: { paneId: null, info: null },
});

export function useUi<S>(selector: (state: UiState) => S): S {
  return useStore(ui, selector);
}

export function patchUi(
  patch: Partial<UiState> | ((state: UiState) => Partial<UiState>),
): void {
  ui.set((state) => ({
    ...state,
    ...(typeof patch === 'function' ? patch(state) : patch),
  }));
}

export function patchSearch(patch: Partial<SearchState>): void {
  ui.set((state) => ({ ...state, search: { ...state.search, ...patch } }));
}

/** True while any modal surface is open, so the terminal does not steal focus back. */
export function isOverlayOpen(state: UiState = ui.get()): boolean {
  return (
    state.palette.open ||
    state.settingsOpen ||
    state.aboutOpen ||
    state.commandsOpen ||
    state.historyOpen ||
    state.commandEditor !== null ||
    state.hostEditor !== null ||
    state.hostsOpen ||
    state.renameTabId !== null ||
    state.pendingRun !== null
  );
}
