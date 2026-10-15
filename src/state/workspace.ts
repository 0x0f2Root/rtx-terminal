import type {
  RemoteEndpoint,
  SshConnectState,
  SshErrorCode,
} from '@/shared/api';
import { createStore, useStore } from '@/lib/create-store';
import { newId } from '@/lib/ids';

/**
 * Tabs and their split-pane trees. Each pane owns one terminal session for its whole life; tab
 * switches and splits only move panes around, they never restart a shell. Nothing here is
 * persisted: shells cannot be restored after the app exits.
 */

export type PaneStatus = 'starting' | 'running' | 'exited' | 'error';

/** What to start in a pane. Empty fields mean the preferred shell in the home directory. */
export type LaunchSpec = {
  shell?: string;
  cwd?: string;
  profileId?: string | null;
  label?: string;
  /** Open a saved SSH host instead of a local shell. */
  ssh?: { hostId: string };
  /**
   * What this pane shows. Omitted or 'terminal' is an interactive shell; 'files' is the remote
   * file manager and 'monitor' is the resource monitor, both over a saved SSH host.
   */
  view?: 'terminal' | 'files' | 'monitor';
};

export type PaneState = {
  id: string;
  launch: LaunchSpec;
  status: PaneStatus;
  sessionId: string | null;
  shell: string | null;
  shellName: string | null;
  pid: number | null;
  /** Title the shell set through an escape sequence, if any. */
  title: string | null;
  error: string | null;
  exitCode: number | null;
  /** Which xterm renderer is drawing the pane; WebGL falls back to DOM when the GPU context fails. */
  renderer: 'webgl' | 'dom' | null;
  /** The SSH endpoint this pane is (or was last) connected to; null for local shells. */
  remote: RemoteEndpoint | null;
  /** SSH connection progress while status is 'starting'. */
  connecting: SshConnectState | null;
  /** Why the session ended or failed, in words safe to show. */
  exitReason: string | null;
  errorCode: SshErrorCode | null;
};

export type Orientation = 'horizontal' | 'vertical';

export type PaneNode =
  | { kind: 'pane'; id: string }
  | {
      kind: 'split';
      id: string;
      orientation: Orientation;
      children: PaneNode[];
    };

export type Tab = {
  id: string;
  /** Set when the user renamed the tab; otherwise the title follows the active pane. */
  customTitle: string | null;
  /** A color the user picked for the tab (#rrggbb), or null for the default look. */
  color: string | null;
  root: PaneNode;
  activePaneId: string;
};

export type Workspace = {
  tabs: Tab[];
  activeTabId: string | null;
  panes: Record<string, PaneState>;
};

export const workspace = createStore<Workspace>({
  tabs: [],
  activeTabId: null,
  panes: {},
});

export function useWorkspace<S>(selector: (state: Workspace) => S): S {
  return useStore(workspace, selector);
}

// --- tree helpers -----------------------------------------------------------------

export function paneIds(node: PaneNode): string[] {
  return node.kind === 'pane' ? [node.id] : node.children.flatMap(paneIds);
}

function replaceNode(
  node: PaneNode,
  targetId: string,
  replacement: PaneNode,
): PaneNode {
  if (node.id === targetId) return replacement;
  if (node.kind === 'pane') return node;
  return {
    ...node,
    children: node.children.map((child) =>
      replaceNode(child, targetId, replacement),
    ),
  };
}

/** Removes a pane; a split left with one child collapses into that child. */
function removePane(node: PaneNode, paneId: string): PaneNode | null {
  if (node.kind === 'pane') return node.id === paneId ? null : node;
  const children = node.children
    .map((child) => removePane(child, paneId))
    .filter((child): child is PaneNode => child !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children };
}

function newPane(launch: LaunchSpec): PaneState {
  return {
    id: newId('pane'),
    launch,
    status: 'starting',
    sessionId: null,
    shell: null,
    shellName: null,
    pid: null,
    title: null,
    error: null,
    exitCode: null,
    renderer: null,
    remote: null,
    connecting: null,
    exitReason: null,
    errorCode: null,
  };
}

// --- selectors ----------------------------------------------------------------------

export function activeTab(state: Workspace = workspace.get()): Tab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

export function activePane(
  state: Workspace = workspace.get(),
): PaneState | null {
  const tab = activeTab(state);
  return tab ? (state.panes[tab.activePaneId] ?? null) : null;
}

export function tabForPane(
  paneId: string,
  state: Workspace = workspace.get(),
): Tab | null {
  return state.tabs.find((tab) => paneIds(tab.root).includes(paneId)) ?? null;
}

export function tabTitle(tab: Tab, state: Workspace = workspace.get()): string {
  if (tab.customTitle) return tab.customTitle;
  const pane = state.panes[tab.activePaneId];
  return pane?.title || pane?.launch.label || pane?.shellName || 'Terminal';
}

// --- actions ----------------------------------------------------------------------------

export function openTab(launch: LaunchSpec = {}): string {
  const pane = newPane(launch);
  const tab: Tab = {
    id: newId('tab'),
    customTitle: null,
    color: null,
    root: { kind: 'pane', id: pane.id },
    activePaneId: pane.id,
  };
  workspace.set((state) => ({
    tabs: [...state.tabs, tab],
    activeTabId: tab.id,
    panes: { ...state.panes, [pane.id]: pane },
  }));
  return pane.id;
}

/** Splits `paneId`; "horizontal" places the new pane to the right, "vertical" below. */
export function splitPane(
  paneId: string,
  orientation: Orientation,
  launch: LaunchSpec = {},
): string | null {
  const tab = tabForPane(paneId);
  if (!tab) return null;
  const pane = newPane(launch);
  const split: PaneNode = {
    kind: 'split',
    id: newId('split'),
    orientation,
    children: [
      { kind: 'pane', id: paneId },
      { kind: 'pane', id: pane.id },
    ],
  };
  workspace.set((state) => ({
    ...state,
    activeTabId: tab.id,
    tabs: state.tabs.map((t) =>
      t.id === tab.id
        ? {
            ...t,
            root: replaceNode(t.root, paneId, split),
            activePaneId: pane.id,
          }
        : t,
    ),
    panes: { ...state.panes, [pane.id]: pane },
  }));
  return pane.id;
}

/** Drops a pane from the layout. The caller disposes its terminal and session. */
export function removePaneFromLayout(paneId: string): void {
  workspace.set((state) => {
    const tab = tabForPane(paneId, state);
    const panes = { ...state.panes };
    delete panes[paneId];
    if (!tab) return { ...state, panes };
    const root = removePane(tab.root, paneId);
    if (!root) {
      const index = state.tabs.findIndex((t) => t.id === tab.id);
      const tabs = state.tabs.filter((t) => t.id !== tab.id);
      const neighbour = tabs[Math.min(index, tabs.length - 1)] ?? null;
      return {
        tabs,
        panes,
        activeTabId:
          state.activeTabId === tab.id
            ? (neighbour?.id ?? null)
            : state.activeTabId,
      };
    }
    const remaining = paneIds(root);
    const order = paneIds(tab.root);
    // Focus moves to the pane that sat before the closed one, like most tiling terminals.
    const closedIndex = order.indexOf(paneId);
    const nextActive =
      tab.activePaneId === paneId
        ? (remaining[Math.max(0, closedIndex - 1)] ?? remaining[0])
        : tab.activePaneId;
    return {
      ...state,
      panes,
      tabs: state.tabs.map((t) =>
        t.id === tab.id ? { ...t, root, activePaneId: nextActive } : t,
      ),
    };
  });
}

export function updatePane(paneId: string, patch: Partial<PaneState>): void {
  workspace.set((state) => {
    const pane = state.panes[paneId];
    if (!pane) return state;
    return {
      ...state,
      panes: { ...state.panes, [paneId]: { ...pane, ...patch } },
    };
  });
}

export function focusPane(paneId: string): void {
  workspace.set((state) => {
    const tab = tabForPane(paneId, state);
    if (!tab || (state.activeTabId === tab.id && tab.activePaneId === paneId))
      return state;
    return {
      ...state,
      activeTabId: tab.id,
      tabs: state.tabs.map((t) =>
        t.id === tab.id ? { ...t, activePaneId: paneId } : t,
      ),
    };
  });
}

export function cyclePane(step: 1 | -1): void {
  const tab = activeTab();
  if (!tab) return;
  const order = paneIds(tab.root);
  if (order.length < 2) return;
  const index = order.indexOf(tab.activePaneId);
  focusPane(order[(index + step + order.length) % order.length]);
}

export function activateTab(tabId: string): void {
  workspace.set((state) =>
    state.activeTabId === tabId || !state.tabs.some((t) => t.id === tabId)
      ? state
      : { ...state, activeTabId: tabId },
  );
}

export function cycleTab(step: 1 | -1): void {
  const { tabs, activeTabId } = workspace.get();
  if (tabs.length < 2) return;
  const index = tabs.findIndex((t) => t.id === activeTabId);
  activateTab(tabs[(index + step + tabs.length) % tabs.length].id);
}

export function setTabColor(tabId: string, color: string | null): void {
  const value =
    color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
  workspace.set((state) => ({
    ...state,
    tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, color: value } : t)),
  }));
}

export function renameTab(tabId: string, title: string | null): void {
  const value = title?.trim() ? title.trim().slice(0, 80) : null;
  workspace.set((state) => ({
    ...state,
    tabs: state.tabs.map((t) =>
      t.id === tabId ? { ...t, customTitle: value } : t,
    ),
  }));
}

export function moveTab(tabId: string, toIndex: number): void {
  workspace.set((state) => {
    const from = state.tabs.findIndex((t) => t.id === tabId);
    if (from < 0) return state;
    const tabs = [...state.tabs];
    const [tab] = tabs.splice(from, 1);
    tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
    return { ...state, tabs };
  });
}

// Development only: this module holds live terminals, which hot replacement cannot carry over.
// Reload the page instead; the main process ends the old sessions when the page navigates.
if (import.meta.hot) import.meta.hot.dispose(() => window.location.reload());
