import { useRef, type ReactNode } from 'react';
import { IconTile } from '@/components/reui/icon-tile';
import {
  Columns2,
  CopyX,
  FolderTree,
  Gauge,
  Globe,
  Palette,
  Pencil,
  Pipette,
  Rows2,
  X,
} from 'lucide-react';
import { cn } from 'cn';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { TAB_COLORS, tabColorVars } from '@/lib/color';
import { patchUi } from '@/state/ui';
import {
  activateTab,
  paneIds,
  setTabColor,
  tabTitle,
  useWorkspace,
  workspace,
  type Tab,
} from '@/state/workspace';
import { closeTab, splitActive } from '../actions';
import { MenuShortcut } from '../menu-shortcut';

/** Radio value for an uncolored tab; a custom color has no preset to select. */
const NO_COLOR = 'none';

/**
 * Raised tab material after Obsidian UI's raised button: a solid fill, a 1px light top edge with a
 * soft white-to-transparent sheen (the ::before layer), a hairline border and a drop shadow. The
 * header tabs and the sidebar's open-terminal rows share it; each adds its own size and padding.
 */
export const RAISED =
  'glass-material relative inline-flex items-center gap-1.5 rounded-lg border text-sm font-medium whitespace-nowrap outline-none select-none transition-[color,background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border-t before:bg-gradient-to-b before:to-transparent';

const LOOK = {
  active:
    'border-border bg-(--tab-active-bg) text-foreground shadow-md shadow-foreground/10 before:border-(--tab-edge) before:from-(--tab-sheen)',
  idle: 'border-border/50 bg-(--tab-idle-bg) text-muted-foreground shadow-sm shadow-foreground/5 before:border-border before:from-(--tab-sheen) hover:bg-muted hover:text-foreground',
  coloredActive:
    'border-(--tab-border) bg-(--tab-bg) text-(--tab-fg) shadow-[0_4px_10px_-2px_var(--tab-glow)] before:border-(--tab-edge) before:from-(--tab-sheen)',
  coloredIdle:
    'border-(--tab-tint-border) bg-(--tab-tint) text-foreground/80 shadow-sm shadow-foreground/10 before:border-border before:from-(--tab-sheen) hover:text-foreground',
};

/** The active tab carries the full effect; inactive tabs are the same material, quieter. */
export function raisedLook(tab: Tab, active: boolean): string {
  if (tab.color) return active ? LOOK.coloredActive : LOOK.coloredIdle;
  return active ? LOOK.active : LOOK.idle;
}

/** Status dot, live title and pane count, shared by every place a tab is shown. */
export function TabLabel({
  tab,
  icon,
  tiled = false,
}: {
  tab: Tab;
  icon?: ReactNode;
  /** Puts the kind icon on an icon tile, as the sidebar rows do; the header strip is too short. */
  tiled?: boolean;
}) {
  const title = useWorkspace((s) => tabTitle(tab, s));
  const status = useWorkspace((s) => s.panes[tab.activePaneId]?.status);
  const remote = useWorkspace((s) => !!s.panes[tab.activePaneId]?.launch.ssh);
  const view = useWorkspace((s) => s.panes[tab.activePaneId]?.launch.view);
  const paneCount = paneIds(tab.root).length;
  // A remote view's icon says what the tab is: the title alone is the host's name for all three.
  const kind =
    view === 'files'
      ? { Icon: FolderTree, label: 'Remote files' }
      : view === 'monitor'
        ? { Icon: Gauge, label: 'Resource monitor' }
        : remote
          ? { Icon: Globe, label: 'SSH session' }
          : null;
  return (
    <>
      {kind && tiled ? (
        <IconTile
          variant="elevated"
          size="xs"
          role="img"
          aria-label={kind.label}
        >
          <kind.Icon aria-hidden />
        </IconTile>
      ) : kind ? (
        <kind.Icon
          className="relative size-3.5 shrink-0 opacity-70"
          aria-label={kind.label}
        />
      ) : (
        icon
      )}
      {remote && status === 'starting' && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-warning"
          aria-label="Connecting"
        />
      )}
      {status === 'error' && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-destructive"
          aria-label="Error"
        />
      )}
      {status === 'exited' && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-current opacity-50"
          aria-label="Exited"
        />
      )}
      <span className="relative truncate">{title}</span>
      {paneCount > 1 && (
        <span className="relative text-xs tabular-nums opacity-70">
          {paneCount}
        </span>
      )}
    </>
  );
}

/**
 * Wraps a tab's clickable element with its close button, color picker and right-click menu.
 * The color variables are set here so the tab and its close button read the same color.
 */
export function TabShell({
  tab,
  active,
  className,
  children,
}: {
  tab: Tab;
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  const title = useWorkspace((s) => tabTitle(tab, s));
  const colorInput = useRef<HTMLInputElement>(null);
  const vars = tab.color ? tabColorVars(tab.color) : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn('group/tab relative flex items-center', className)}
        style={vars ?? undefined}
      >
        {children}
        <button
          type="button"
          aria-label={`Close ${title}`}
          className={cn(
            'absolute right-1.5 flex size-5 items-center justify-center rounded-md opacity-0 transition-[opacity,background-color] hover:bg-foreground/10 focus-visible:opacity-100 focus-visible:outline-none group-hover/tab:opacity-70 hover:opacity-100! [&_svg]:size-3.5',
            active && 'opacity-70',
            vars && active ? 'text-(--tab-fg)' : 'text-foreground',
          )}
          onClick={() => closeTab(tab.id)}
        >
          <X />
        </button>
        <input
          ref={colorInput}
          type="color"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          defaultValue={tab.color ?? '#3e63dd'}
          onChange={(event) => setTabColor(tab.id, event.target.value)}
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuGroup>
          <ContextMenuLabel className="truncate">{title}</ContextMenuLabel>
          <ContextMenuItem onClick={() => patchUi({ renameTabId: tab.id })}>
            <Pencil />
            Rename tab
            <MenuShortcut action="tab.rename" />
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Palette />
              Tab color
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              <ContextMenuRadioGroup
                value={tab.color ?? NO_COLOR}
                onValueChange={(value: string) =>
                  setTabColor(tab.id, value === NO_COLOR ? null : value)
                }
              >
                {TAB_COLORS.map((color) => (
                  <ContextMenuRadioItem key={color.value} value={color.value}>
                    <span
                      className="size-3 shrink-0 rounded-full border border-border"
                      style={{ background: color.value }}
                    />
                    {color.name}
                  </ContextMenuRadioItem>
                ))}
                <ContextMenuRadioItem value={NO_COLOR}>
                  <X />
                  No color
                </ContextMenuRadioItem>
              </ContextMenuRadioGroup>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => {
                  // Let the menu close before the native color picker takes focus.
                  requestAnimationFrame(() => colorInput.current?.click());
                }}
              >
                <Pipette />
                Custom color…
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuLabel>Layout</ContextMenuLabel>
          <ContextMenuItem
            onClick={() => {
              activateTab(tab.id);
              void splitActive('horizontal');
            }}
          >
            <Columns2 />
            Split right
            <MenuShortcut action="pane.splitRight" />
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              activateTab(tab.id);
              void splitActive('vertical');
            }}
          >
            <Rows2 />
            Split down
            <MenuShortcut action="pane.splitDown" />
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem
            disabled={workspace.get().tabs.length < 2}
            onClick={() => {
              for (const other of workspace.get().tabs)
                if (other.id !== tab.id) closeTab(other.id);
            }}
          >
            <CopyX />
            Close other tabs
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onClick={() => closeTab(tab.id)}
          >
            <X />
            Close tab
            <MenuShortcut action="tab.close" />
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
