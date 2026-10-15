import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ClipboardPaste,
  Columns2,
  Copy,
  Eraser,
  History,
  RotateCw,
  Rows2,
  Search,
  SquareTerminal,
  TextSelect,
  Unplug,
  X,
} from 'lucide-react';
import { Badge } from '@/components/reui/badge';
import { ShortcutKeys } from '@/components/shortcut-keys';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { appData, useAppData } from '@/state/app-data';
import { isOverlayOpen, patchSearch, patchUi, useUi } from '@/state/ui';
import { focusPane, paneIds, useWorkspace } from '@/state/workspace';
import {
  closePane,
  insertCommand,
  openPalette,
  openSearch,
  runCommand,
  shortcutFor,
  splitActive,
} from '../actions';
import { SshPaneStatus } from '../ssh/SshPaneStatus';
import { ensureController, getController } from './registry';
import { TerminalSearch } from './TerminalSearch';
import { terminalColors } from './themes';

function MenuShortcut({ action }: { action: string }) {
  const accelerator = useAppData((s) =>
    shortcutFor(action, s.preferences.shortcuts),
  );
  return accelerator ? (
    <ContextMenuShortcut>
      <ShortcutKeys accelerator={accelerator} />
    </ContextMenuShortcut>
  ) : null;
}

export function TerminalPane({
  paneId,
  tabActive,
}: {
  paneId: string;
  tabActive: boolean;
}) {
  const pane = useWorkspace((s) => s.panes[paneId]);
  const isActive = useWorkspace(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.activePaneId === paneId,
  );
  const isSplit = useWorkspace((s) => {
    const tab = s.tabs.find((t) => paneIds(t.root).includes(paneId));
    return tab ? tab.root.kind === 'split' : false;
  });
  const background = useAppData(
    (s) =>
      terminalColors(s.preferences.terminal.themeId, s.preferences.ui.theme)
        .background,
  );
  const searchOpen = useUi((s) => s.search.open && s.search.paneId === paneId);
  const commands = useAppData((s) => s.commands.commands);
  const recentHistory = useAppData((s) => s.history.entries);
  const shells = useAppData((s) => s.shells);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasSelection, setHasSelection] = useState(false);

  useLayoutEffect(() => {
    if (containerRef.current)
      ensureController(paneId).attach(containerRef.current);
  }, [paneId]);

  useEffect(() => {
    if (isActive && tabActive && !isOverlayOpen())
      getController(paneId)?.focus();
  }, [isActive, tabActive, paneId]);

  if (!pane) return null;

  const controller = () => getController(paneId);
  const remote = !!pane.launch.ssh;
  const systemShell = shells.find((s) => s.isDefault)?.path;
  const configuredShell = appData.get().preferences.terminal.defaultShell;
  const canUseSystemShell = Boolean(
    systemShell &&
    (pane.launch.shell || configuredShell) &&
    pane.launch.shell !== systemShell,
  );

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) {
          focusPane(paneId);
          setHasSelection(controller()?.hasSelection() ?? false);
        }
      }}
    >
      <ContextMenuTrigger
        className="relative h-full w-full overflow-hidden"
        style={{ background }}
        onMouseDown={() => focusPane(paneId)}
      >
        <div
          ref={containerRef}
          // `isolate` keeps xterm's z-indexed canvas layers below the pane overlays.
          className="absolute inset-0 isolate"
          onContextMenuCapture={(event) => {
            // Programs that track the mouse (htop, vim) get right clicks; Shift+right click opens the menu.
            const term = controller()?.term;
            if (
              term &&
              term.modes.mouseTrackingMode !== 'none' &&
              !event.shiftKey
            )
              event.stopPropagation();
          }}
        />

        {isSplit && (
          <div
            aria-hidden
            className={
              isActive
                ? 'pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-ring'
                : 'pointer-events-none absolute inset-0 bg-workspace/25'
            }
          />
        )}

        {!remote && pane.status === 'starting' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground animate-in fade-in-0 duration-200 delay-300 fill-mode-backwards">
            <Spinner />
            Starting shell
          </div>
        )}

        {!remote && pane.status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-workspace/90 p-6">
            <Empty className="max-w-md">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SquareTerminal />
                </EmptyMedia>
                <EmptyTitle>The shell could not start</EmptyTitle>
                <EmptyDescription>{pane.error}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="flex-row justify-center gap-2">
                <Button size="sm" onClick={() => controller()?.restart()}>
                  <RotateCw data-icon="inline-start" />
                  Retry
                </Button>
                {canUseSystemShell && systemShell && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      controller()?.restart({ shell: systemShell })
                    }
                  >
                    Use {systemShell.split('/').at(-1)}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => patchUi({ settingsOpen: true })}
                >
                  Settings
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => closePane(paneId)}
                >
                  Close
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        )}

        {!remote && pane.status === 'exited' && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t bg-chrome/95 px-3 py-2 animate-in fade-in-0 duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <Badge
                variant={
                  pane.exitCode === 0 ? 'success-light' : 'destructive-light'
                }
              >
                Exit {pane.exitCode ?? '?'}
              </Badge>
              <span className="truncate text-muted-foreground">
                The process has ended.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => controller()?.restart()}
              >
                <RotateCw data-icon="inline-start" />
                Restart
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => closePane(paneId)}
              >
                Close
              </Button>
            </div>
          </div>
        )}

        {remote && <SshPaneStatus pane={pane} />}

        {searchOpen && <TerminalSearch paneId={paneId} />}
      </ContextMenuTrigger>

      <ContextMenuContent className="w-60">
        <ContextMenuGroup>
          <ContextMenuItem
            disabled={!hasSelection}
            onClick={() => controller()?.copySelection()}
          >
            <Copy />
            Copy
            <MenuShortcut action="terminal.copy" />
          </ContextMenuItem>
          <ContextMenuItem
            disabled={pane.status !== 'running'}
            onClick={() => void controller()?.pasteClipboard()}
          >
            <ClipboardPaste />
            Paste
            <MenuShortcut action="terminal.paste" />
          </ContextMenuItem>
          <ContextMenuItem onClick={() => controller()?.selectAll()}>
            <TextSelect />
            Select all
            <MenuShortcut action="terminal.selectAll" />
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem
            onClick={() => {
              if (hasSelection) {
                const text = controller()?.selection().trim() ?? '';
                patchSearch({ query: text.includes('\n') ? '' : text });
              }
              openSearch();
            }}
          >
            <Search />
            {hasSelection ? 'Find selected text' : 'Find…'}
            <MenuShortcut action="terminal.search" />
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={pane.status !== 'running'}>
              <SquareTerminal />
              Saved commands
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-64">
              {commands.length === 0 && (
                <ContextMenuLabel>No saved commands yet</ContextMenuLabel>
              )}
              {commands.slice(0, 12).map((command) => (
                <ContextMenuItem
                  key={command.id}
                  onClick={() => runCommand(command.command, 'saved', paneId)}
                >
                  <span className="truncate">{command.name}</span>
                </ContextMenuItem>
              ))}
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => openPalette('commands')}>
                Open command picker…
                <MenuShortcut action="commands.picker" />
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() =>
                  patchUi({
                    commandEditor: 'new',
                    commandEditorDefaults: hasSelection
                      ? { command: controller()?.selection().trim() ?? '' }
                      : null,
                  })
                }
              >
                {hasSelection
                  ? 'Save selection as command…'
                  : 'New saved command…'}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={pane.status !== 'running'}>
              <History />
              Insert from history
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-72">
              {recentHistory.length === 0 && (
                <ContextMenuLabel>No commands recorded yet</ContextMenuLabel>
              )}
              {recentHistory
                .slice(-10)
                .reverse()
                .map((entry) => (
                  <ContextMenuItem
                    key={entry.id}
                    onClick={() => insertCommand(entry.command, paneId)}
                  >
                    <span className="truncate font-mono text-xs">
                      {entry.command}
                    </span>
                  </ContextMenuItem>
                ))}
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => patchUi({ historyOpen: true })}>
                Search history…
                <MenuShortcut action="history.open" />
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => void splitActive('horizontal')}>
            <Columns2 />
            Split right
            <MenuShortcut action="pane.splitRight" />
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void splitActive('vertical')}>
            <Rows2 />
            Split down
            <MenuShortcut action="pane.splitDown" />
          </ContextMenuItem>
          <ContextMenuItem onClick={() => controller()?.clear()}>
            <Eraser />
            Clear
            <MenuShortcut action="terminal.clear" />
          </ContextMenuItem>
          {remote && pane.status === 'running' && (
            <ContextMenuItem onClick={() => controller()?.disconnect()}>
              <Unplug />
              Disconnect
            </ContextMenuItem>
          )}
          {(pane.status === 'exited' || pane.status === 'error') && (
            <ContextMenuItem onClick={() => controller()?.restart()}>
              <RotateCw />
              {remote ? 'Reconnect' : 'Restart'}
            </ContextMenuItem>
          )}
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => closePane(paneId)}
        >
          <X />
          Close pane
          <MenuShortcut action="pane.close" />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
