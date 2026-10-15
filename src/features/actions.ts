import { toast } from 'sonner';
import {
  DEFAULT_PREFERENCES,
  type SessionProfile,
  type SshHost,
} from '@/shared/config';
import { newId } from '@/lib/ids';
import { destructiveReason } from '@/lib/dangerous';
import { appData, updatePreferences, updateProfiles } from '@/state/app-data';
import { patchSearch, patchUi, ui, type PalettePage } from '@/state/ui';
import {
  activePane,
  activeTab,
  cyclePane,
  cycleTab,
  openTab,
  paneIds,
  removePaneFromLayout,
  splitPane,
  workspace,
  type LaunchSpec,
  type Orientation,
} from '@/state/workspace';
import { refreshSecretState } from './ssh/ssh-prompts';
import { disposeController, getController } from './terminal/registry';

/**
 * Every user-facing action, in one table. The command palette lists them, the shortcut registry
 * binds keys to them, and menus call them by id, so behaviour is identical everywhere.
 */

export type ActionGroup =
  | 'Terminal'
  | 'Panes'
  | 'Tabs'
  | 'Commands'
  | 'View'
  | 'App';

/** "terminal" actions act on the focused terminal and stay out of text fields. */
export type ActionScope = 'global' | 'terminal';

export type ActionDef = {
  id: string;
  title: string;
  group: ActionGroup;
  scope: ActionScope;
  defaultShortcut: string | null;
  keywords?: string[];
  run: () => void;
};

// --- terminal and pane operations --------------------------------------------------------

export function activeController() {
  const pane = activePane();
  return pane ? getController(pane.id) : undefined;
}

/** The working directory of the active pane's shell, read live from /proc. */
async function activeCwd(): Promise<string | undefined> {
  const pane = activePane();
  if (!pane?.sessionId) return undefined;
  const info = await window.rtx.terminal.info(pane.sessionId).catch(() => null);
  return info?.cwd ?? undefined;
}

export function newTab(launch: LaunchSpec = {}): void {
  openTab(launch);
}

export async function newTabHere(): Promise<void> {
  const cwd = await activeCwd();
  const pane = activePane();
  openTab({
    ...(cwd ? { cwd } : {}),
    ...(pane?.shell ? { shell: pane.shell } : {}),
  });
}

/** Splits the active pane; the new shell starts in the same directory as the current one. */
export async function splitActive(orientation: Orientation): Promise<void> {
  const pane = activePane();
  if (!pane) {
    openTab();
    return;
  }
  const cwd = await activeCwd();
  splitPane(pane.id, orientation, {
    ...(cwd ? { cwd } : {}),
    ...(pane.shell ? { shell: pane.shell } : {}),
  });
}

export function closePane(paneId: string): void {
  if (ui.get().search.paneId === paneId)
    patchSearch({ open: false, paneId: null });
  disposeController(paneId);
  removePaneFromLayout(paneId);
}

export function closeTab(tabId: string): void {
  const tab = workspace.get().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  for (const paneId of paneIds(tab.root)) closePane(paneId);
}

export function closeActivePane(): void {
  const pane = activePane();
  if (pane) closePane(pane.id);
}

// --- SSH ----------------------------------------------------------------------------------

/** Opens a saved SSH host in a new tab or next to the active pane. */
export function connectHost(
  host: SshHost,
  where: 'tab' | 'split-right' | 'split-down' = 'tab',
): void {
  const launch: LaunchSpec = { ssh: { hostId: host.id }, label: host.name };
  const pane = activePane();
  if (where === 'tab' || !pane) openTab(launch);
  else
    splitPane(
      pane.id,
      where === 'split-right' ? 'horizontal' : 'vertical',
      launch,
    );
}

/** Opens the remote file manager for a saved SSH host in a new tab or next to the active pane. */
export function openHostFiles(
  host: SshHost,
  where: 'tab' | 'split-right' | 'split-down' = 'tab',
): void {
  const launch: LaunchSpec = {
    ssh: { hostId: host.id },
    label: host.name,
    view: 'files',
  };
  const pane = activePane();
  if (where === 'tab' || !pane) openTab(launch);
  else
    splitPane(
      pane.id,
      where === 'split-right' ? 'horizontal' : 'vertical',
      launch,
    );
}

/** Opens the resource monitor for a saved SSH host in a new tab or next to the active pane. */
export function openHostMonitor(
  host: SshHost,
  where: 'tab' | 'split-right' | 'split-down' = 'tab',
): void {
  const launch: LaunchSpec = {
    ssh: { hostId: host.id },
    label: host.name,
    view: 'monitor',
  };
  const pane = activePane();
  if (where === 'tab' || !pane) openTab(launch);
  else
    splitPane(
      pane.id,
      where === 'split-right' ? 'horizontal' : 'vertical',
      launch,
    );
}

function activeSshPane() {
  const pane = activePane();
  return pane?.launch.ssh ? pane : null;
}

export function disconnectActive(): void {
  const pane = activeSshPane();
  if (pane?.status === 'running') getController(pane.id)?.disconnect();
}

/** Opens a new transport and remote shell in the same pane; the old shell is not restored. */
export function reconnectActive(): void {
  const pane = activeSshPane();
  if (pane && (pane.status === 'exited' || pane.status === 'error'))
    getController(pane.id)?.restart();
}

/** Every open pane connected to `hostId`. */
export function panesForHost(hostId: string) {
  return Object.values(workspace.get().panes).filter(
    (pane) => pane.launch.ssh?.hostId === hostId,
  );
}

export function disconnectHost(hostId: string): void {
  for (const pane of panesForHost(hostId))
    if (pane.status === 'running') getController(pane.id)?.disconnect();
}

export function duplicateHost(host: SshHost): void {
  updateProfiles((p) => ({
    ...p,
    hosts: [
      ...p.hosts,
      { ...host, id: newId('host'), name: `${host.name} copy` },
    ],
  }));
}

/** Removes a saved host and any password or passphrase saved for it in the keyring. */
export function deleteHost(host: SshHost): void {
  updateProfiles((p) => ({
    ...p,
    hosts: p.hosts.filter((h) => h.id !== host.id),
  }));
  void window.rtx.ssh.forgetSecrets(host.id).then(() => refreshSecretState());
  toast(`Deleted "${host.name}".`, {
    description: 'Any saved password or passphrase for it was removed.',
    action: {
      label: 'Undo',
      onClick: () =>
        updateProfiles((p) => ({ ...p, hosts: [...p.hosts, host] })),
    },
  });
}

export function openProfile(
  profile: SessionProfile,
  where: 'tab' | 'split-right' | 'split-down' = 'tab',
): void {
  const launch: LaunchSpec = {
    profileId: profile.id,
    label: profile.name,
    ...(profile.shell ? { shell: profile.shell } : {}),
    ...(profile.cwd ? { cwd: profile.cwd } : {}),
  };
  const pane = activePane();
  if (where === 'tab' || !pane) openTab(launch);
  else
    splitPane(
      pane.id,
      where === 'split-right' ? 'horizontal' : 'vertical',
      launch,
    );
}

export function openSearch(): void {
  const pane = activePane();
  if (!pane) return;
  const selection = getController(pane.id)?.selection().trim();
  patchSearch({
    open: true,
    paneId: pane.id,
    resultIndex: -1,
    resultCount: 0,
    ...(selection && !selection.includes('\n') ? { query: selection } : {}),
  });
}

export function copySelection(): void {
  const controller = activeController();
  if (controller && !controller.copySelection())
    toast('Nothing selected to copy.');
}

export function pasteClipboard(): void {
  void activeController()?.pasteClipboard();
}

export function clearTerminal(): void {
  activeController()?.clear();
}

/**
 * Runs `command` in `paneId` (the active pane by default). Commands that look destructive wait
 * for the user to confirm; inserting never needs confirmation because nothing runs.
 */
export function runCommand(
  command: string,
  source: 'saved' | 'history',
  paneId?: string,
): void {
  const target = paneId ?? activePane()?.id;
  if (!target) {
    toast.error('Open a terminal first.');
    return;
  }
  const controller = getController(target);
  if (!controller?.session) {
    toast.error('That terminal is not running.');
    return;
  }
  const reason = destructiveReason(command);
  if (reason) {
    patchUi({ pendingRun: { command, paneId: target, reason, source } });
    return;
  }
  controller.run(command);
}

export function confirmPendingRun(): void {
  const pending = ui.get().pendingRun;
  patchUi({ pendingRun: null });
  if (!pending) return;
  if (!getController(pending.paneId)?.run(pending.command))
    toast.error('That terminal is no longer running.');
}

export function insertCommand(command: string, paneId?: string): void {
  const target = paneId ?? activePane()?.id;
  const controller = target ? getController(target) : undefined;
  if (!controller?.insert(command))
    toast.error('Open a running terminal first.');
}

export function copyText(text: string): void {
  void window.rtx.system
    .writeClipboard(text)
    .then(() => toast.success('Copied to clipboard.'));
}

function changeFontSize(delta: number | null): void {
  updatePreferences((p) => ({
    ...p,
    terminal: {
      ...p.terminal,
      fontSize:
        delta === null
          ? DEFAULT_PREFERENCES.terminal.fontSize
          : Math.min(32, Math.max(8, p.terminal.fontSize + delta)),
    },
  }));
}

export function toggleSidebar(): void {
  updatePreferences((p) => ({
    ...p,
    ui: { ...p.ui, sidebarOpen: !p.ui.sidebarOpen },
  }));
}

export function openPalette(page: PalettePage = 'root'): void {
  patchUi({ palette: { open: true, page } });
}

// --- the action table ------------------------------------------------------------------------

export const ACTIONS: ActionDef[] = [
  {
    id: 'palette.open',
    title: 'Command palette',
    group: 'App',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+P',
    run: () => openPalette(),
  },
  {
    id: 'terminal.new',
    title: 'New terminal tab',
    group: 'Tabs',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+T',
    keywords: ['open', 'shell'],
    run: () => newTab(),
  },
  {
    id: 'terminal.newHere',
    title: 'New tab in current directory',
    group: 'Tabs',
    scope: 'global',
    defaultShortcut: null,
    keywords: ['cwd'],
    run: () => void newTabHere(),
  },
  {
    id: 'pane.splitRight',
    title: 'Split pane right',
    group: 'Panes',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+D',
    keywords: ['vertical', 'side'],
    run: () => void splitActive('horizontal'),
  },
  {
    id: 'pane.splitDown',
    title: 'Split pane down',
    group: 'Panes',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+E',
    keywords: ['horizontal', 'below'],
    run: () => void splitActive('vertical'),
  },
  {
    id: 'pane.close',
    title: 'Close pane',
    group: 'Panes',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+W',
    keywords: ['terminal', 'exit'],
    run: closeActivePane,
  },
  {
    id: 'pane.next',
    title: 'Focus next pane',
    group: 'Panes',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+]',
    run: () => cyclePane(1),
  },
  {
    id: 'pane.previous',
    title: 'Focus previous pane',
    group: 'Panes',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+[',
    run: () => cyclePane(-1),
  },
  {
    id: 'pane.restart',
    title: 'Restart terminal',
    group: 'Panes',
    scope: 'global',
    defaultShortcut: null,
    keywords: ['respawn'],
    run: () => activeController()?.restart(),
  },
  {
    id: 'tab.next',
    title: 'Next tab',
    group: 'Tabs',
    scope: 'global',
    defaultShortcut: 'Ctrl+Tab',
    run: () => cycleTab(1),
  },
  {
    id: 'tab.previous',
    title: 'Previous tab',
    group: 'Tabs',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+Tab',
    run: () => cycleTab(-1),
  },
  {
    id: 'tab.switch',
    title: 'Switch terminal…',
    group: 'Tabs',
    scope: 'global',
    defaultShortcut: null,
    keywords: ['go to'],
    run: () => openPalette('tabs'),
  },
  {
    id: 'tab.rename',
    title: 'Rename tab',
    group: 'Tabs',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+R',
    run: () => {
      const tab = activeTab();
      if (tab) patchUi({ renameTabId: tab.id });
    },
  },
  {
    id: 'tab.close',
    title: 'Close tab',
    group: 'Tabs',
    scope: 'global',
    defaultShortcut: null,
    run: () => {
      const tab = activeTab();
      if (tab) closeTab(tab.id);
    },
  },
  {
    id: 'terminal.search',
    title: 'Find in terminal',
    group: 'Terminal',
    scope: 'terminal',
    defaultShortcut: 'Ctrl+Shift+F',
    keywords: ['search', 'output'],
    run: openSearch,
  },
  {
    id: 'terminal.copy',
    title: 'Copy selection',
    group: 'Terminal',
    scope: 'terminal',
    defaultShortcut: 'Ctrl+Shift+C',
    run: copySelection,
  },
  {
    id: 'terminal.clearSelection',
    title: 'Clear selection',
    group: 'Terminal',
    scope: 'terminal',
    defaultShortcut: null,
    run: () => activeController()?.clearSelection(),
  },
  {
    id: 'terminal.paste',
    title: 'Paste',
    group: 'Terminal',
    scope: 'terminal',
    defaultShortcut: 'Ctrl+Shift+V',
    run: pasteClipboard,
  },
  {
    id: 'terminal.selectAll',
    title: 'Select all output',
    group: 'Terminal',
    scope: 'terminal',
    defaultShortcut: 'Ctrl+Shift+A',
    run: () => activeController()?.selectAll(),
  },
  {
    id: 'terminal.clear',
    title: 'Clear terminal',
    group: 'Terminal',
    scope: 'terminal',
    defaultShortcut: 'Ctrl+Shift+K',
    keywords: ['reset', 'scrollback'],
    run: clearTerminal,
  },
  {
    id: 'terminal.reset',
    title: 'Reset terminal',
    group: 'Terminal',
    scope: 'terminal',
    defaultShortcut: null,
    run: () => activeController()?.reset(),
  },
  {
    id: 'terminal.interrupt',
    title: 'Stop current process',
    group: 'Terminal',
    scope: 'terminal',
    defaultShortcut: null,
    run: () => activeController()?.interrupt(),
  },
  {
    id: 'commands.picker',
    title: 'Run saved command…',
    group: 'Commands',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+S',
    keywords: ['snippet', 'execute'],
    run: () => openPalette('commands'),
  },
  {
    id: 'commands.manage',
    title: 'Manage saved commands',
    group: 'Commands',
    scope: 'global',
    defaultShortcut: null,
    keywords: ['snippets', 'edit'],
    run: () => patchUi({ commandsOpen: true }),
  },
  {
    id: 'commands.new',
    title: 'New saved command',
    group: 'Commands',
    scope: 'global',
    defaultShortcut: null,
    run: () => patchUi({ commandEditor: 'new', commandEditorDefaults: null }),
  },
  {
    id: 'history.open',
    title: 'Search command history',
    group: 'Commands',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+H',
    keywords: ['recent', 'previous'],
    run: () => patchUi({ historyOpen: true }),
  },
  {
    id: 'theme.change',
    title: 'Change terminal theme…',
    group: 'View',
    scope: 'global',
    defaultShortcut: null,
    keywords: ['colors', 'appearance'],
    run: () => openPalette('themes'),
  },
  {
    id: 'view.sidebar',
    title: 'Toggle sidebar',
    group: 'View',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+B',
    run: toggleSidebar,
  },
  {
    id: 'view.fontIncrease',
    title: 'Increase font size',
    group: 'View',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+=',
    keywords: ['zoom in'],
    run: () => changeFontSize(1),
  },
  {
    id: 'view.fontDecrease',
    title: 'Decrease font size',
    group: 'View',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+-',
    keywords: ['zoom out'],
    run: () => changeFontSize(-1),
  },
  {
    id: 'view.fontReset',
    title: 'Reset font size',
    group: 'View',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+0',
    keywords: ['zoom'],
    run: () => changeFontSize(null),
  },
  {
    id: 'view.fullScreen',
    title: 'Toggle full screen',
    group: 'View',
    scope: 'global',
    defaultShortcut: null,
    run: () => void window.rtx.system.toggleFullScreen(),
  },
  {
    id: 'ssh.connect',
    title: 'Connect to SSH host…',
    group: 'Terminal',
    scope: 'global',
    defaultShortcut: 'Ctrl+Shift+O',
    keywords: ['ssh', 'remote', 'server'],
    run: () => openPalette('hosts'),
  },
  {
    id: 'ssh.newHost',
    title: 'New SSH connection…',
    group: 'Terminal',
    scope: 'global',
    defaultShortcut: null,
    keywords: ['ssh', 'host', 'add'],
    run: () => patchUi({ hostEditor: 'new', hostEditorDefaults: null }),
  },
  {
    id: 'ssh.manage',
    title: 'Manage SSH hosts',
    group: 'Terminal',
    scope: 'global',
    defaultShortcut: null,
    keywords: ['ssh', 'hosts'],
    run: () => patchUi({ hostsOpen: true }),
  },
  {
    id: 'ssh.disconnect',
    title: 'Disconnect SSH session',
    group: 'Terminal',
    scope: 'global',
    defaultShortcut: null,
    keywords: ['ssh', 'close'],
    run: disconnectActive,
  },
  {
    id: 'ssh.reconnect',
    title: 'Reconnect SSH session',
    group: 'Terminal',
    scope: 'global',
    defaultShortcut: null,
    keywords: ['ssh', 'retry'],
    run: reconnectActive,
  },
  {
    id: 'app.settings',
    title: 'Settings',
    group: 'App',
    scope: 'global',
    defaultShortcut: 'Ctrl+,',
    keywords: ['preferences'],
    run: () => patchUi({ settingsOpen: true }),
  },
  {
    id: 'app.quit',
    title: 'Quit',
    group: 'App',
    scope: 'global',
    defaultShortcut: null,
    run: () => void window.rtx.system.quit(),
  },
  {
    id: 'app.about',
    title: 'About rtx-terminal',
    group: 'App',
    scope: 'global',
    defaultShortcut: null,
    run: () => patchUi({ aboutOpen: true }),
  },
  {
    id: 'session.newProfile',
    title: 'New saved session',
    group: 'App',
    scope: 'global',
    defaultShortcut: null,
    keywords: ['profile'],
    run: () => patchUi({ profileEditor: 'new', profileEditorDefaults: null }),
  },
];

export const ACTIONS_BY_ID = new Map(
  ACTIONS.map((action) => [action.id, action]),
);

export function runAction(id: string): void {
  ACTIONS_BY_ID.get(id)?.run();
}

/** The shortcut currently bound to an action: the user's override, or the default. */
export function shortcutFor(
  id: string,
  overrides = appData.get().preferences.shortcuts,
): string | null {
  if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id];
  return ACTIONS_BY_ID.get(id)?.defaultShortcut ?? null;
}
