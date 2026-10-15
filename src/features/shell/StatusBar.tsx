import { useEffect, useState } from 'react';
import { Cpu, Folder, Gauge, Globe, SquareTerminal } from 'lucide-react';
import { ShortcutKeys } from '@/components/shortcut-keys';
import { useAppData } from '@/state/app-data';
import { patchUi, useUi } from '@/state/ui';
import { activeTab, paneIds, useWorkspace } from '@/state/workspace';
import { shortcutFor } from '../actions';
import { getController } from '../terminal/registry';

const POLL_MS = 2000;

const STATUS_LABEL = {
  starting: 'Starting',
  running: 'Running',
  exited: 'Exited',
  error: 'Failed to start',
} as const;

const REMOTE_LABEL = {
  starting: 'Connecting',
  running: 'Connected',
  exited: 'Disconnected',
  error: 'Connection failed',
} as const;

const STATUS_DOT = {
  starting: 'bg-warning',
  running: 'bg-success',
  exited: 'bg-muted-foreground',
  error: 'bg-destructive',
} as const;

function shortenHome(path: string, home: string): string {
  return home && (path === home || path.startsWith(`${home}/`))
    ? `~${path.slice(home.length)}`
    : path;
}

/** Facts about the focused pane. Everything shown is read from the live session or xterm. */
export function StatusBar() {
  const pane = useWorkspace((s) => {
    const tab = activeTab(s);
    return tab ? (s.panes[tab.activePaneId] ?? null) : null;
  });
  const position = useWorkspace((s) => {
    const tab = activeTab(s);
    if (!tab) return null;
    const ids = paneIds(tab.root);
    return `${ids.indexOf(tab.activePaneId) + 1}/${ids.length}`;
  });
  const runtime = useUi((s) =>
    s.runtime.paneId === pane?.id ? s.runtime.info : null,
  );
  const homeDir = useAppData((s) => s.homeDir);
  const paletteShortcut = useAppData((s) =>
    shortcutFor('palette.open', s.preferences.shortcuts),
  );
  const [size, setSize] = useState<{ cols: number; rows: number } | null>(null);

  const paneId = pane?.id ?? null;
  const sessionId = pane?.sessionId ?? null;

  // Polls /proc for the shell's directory and foreground program while the window is visible.
  useEffect(() => {
    if (!paneId || !sessionId) {
      patchUi({ runtime: { paneId, info: null } });
      return;
    }
    let cancelled = false;
    const poll = async () => {
      if (document.hidden) return;
      const info = await window.rtx.terminal.info(sessionId).catch(() => null);
      if (!cancelled) patchUi({ runtime: { paneId, info } });
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [paneId, sessionId]);

  useEffect(() => {
    const term = paneId ? getController(paneId)?.term : undefined;
    if (!term) {
      setSize(null);
      return;
    }
    setSize({ cols: term.cols, rows: term.rows });
    const subscription = term.onResize(({ cols, rows }) =>
      setSize({ cols, rows }),
    );
    return () => subscription.dispose();
  }, [paneId, sessionId]);

  const [paneIndex, paneCount] = position
    ? position.split('/').map(Number)
    : [0, 0];

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t bg-chrome px-3 text-xs text-muted-foreground">
      {pane ? (
        <>
          <span className="flex items-center gap-1.5">
            <span
              className={`size-1.5 rounded-full ${STATUS_DOT[pane.status]}`}
              aria-hidden
            />
            {pane.launch.ssh
              ? pane.status === 'starting' &&
                pane.connecting === 'authenticating'
                ? 'Signing in'
                : REMOTE_LABEL[pane.status]
              : STATUS_LABEL[pane.status]}
            {!pane.launch.ssh &&
              pane.status === 'exited' &&
              pane.exitCode !== null &&
              ` (${pane.exitCode})`}
          </span>
          {pane.remote && (
            <span
              className="flex min-w-0 items-center gap-1.5"
              title="SSH session"
            >
              <Globe className="size-3.5 shrink-0" />
              <span className="truncate">
                {pane.remote.username}@{pane.remote.host}
                {pane.remote.port !== 22 && `:${pane.remote.port}`}
              </span>
            </span>
          )}
          {!pane.launch.ssh && pane.shellName && (
            <span
              className="flex items-center gap-1.5"
              title={pane.shell ?? undefined}
            >
              <SquareTerminal className="size-3.5" />
              {pane.shellName}
              {pane.pid !== null && (
                <span className="tabular-nums">· {pane.pid}</span>
              )}
            </span>
          )}
          {runtime?.cwd && (
            <span
              className="flex min-w-0 items-center gap-1.5"
              title={runtime.cwd}
            >
              <Folder className="size-3.5 shrink-0" />
              <span className="truncate">
                {shortenHome(runtime.cwd, homeDir)}
              </span>
            </span>
          )}
          {runtime?.foregroundProcess &&
            runtime.foregroundProcess.split('/').at(-1) !== pane.shellName && (
              <span className="flex items-center gap-1.5">
                <Cpu className="size-3.5" />
                {runtime.foregroundProcess.split('/').at(-1)}
              </span>
            )}
        </>
      ) : (
        <span>No terminal open</span>
      )}
      <span className="ml-auto flex items-center gap-4">
        {paneCount > 1 && (
          <span className="tabular-nums">
            Pane {paneIndex} of {paneCount}
          </span>
        )}
        {size && pane?.status === 'running' && (
          <span className="tabular-nums">
            {size.cols}×{size.rows}
          </span>
        )}
        {pane?.renderer && (
          <span className="flex items-center gap-1.5" title="Terminal renderer">
            <Gauge className="size-3.5" />
            {pane.renderer === 'webgl' ? 'WebGL' : 'DOM'}
          </span>
        )}
        {paletteShortcut && (
          <span className="hidden items-center gap-1.5 md:flex">
            <ShortcutKeys accelerator={paletteShortcut} />
            Commands
          </span>
        )}
      </span>
    </footer>
  );
}
