import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  ChevronRight,
  ChevronsUpDown,
  Columns2,
  Copy,
  Folder,
  FolderInput,
  FolderTree,
  Gauge,
  History,
  Info,
  Pencil,
  Play,
  Rows2,
  Plug,
  Plus,
  Search,
  Server,
  Settings,
  SquareTerminal,
  TextCursorInput,
  Trash2,
  Unplug,
} from 'lucide-react';
import { IconTile } from '@/components/reui/icon-tile';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import type { SavedCommand, SshHost } from '@/shared/config';
import appIcon from '../../../assets/icon.svg';
import { newId } from '@/lib/ids';
import { useAppData, updateCommands } from '@/state/app-data';
import { cn } from 'cn';
import { patchUi } from '@/state/ui';
import { activateTab, tabTitle, useWorkspace } from '@/state/workspace';
import {
  closeTab,
  copyText,
  insertCommand,
  newTab,
  connectHost,
  deleteHost,
  disconnectHost,
  duplicateHost,
  openHostFiles,
  openHostMonitor,
  runCommand,
} from '../actions';
import { hostStatus, hostTarget, matchesHost } from '../ssh/host-utils';
import { RAISED, raisedLook, TabLabel, TabShell } from './raised-tab';

/** Radio value for a command without a category in the "Move to category" menu. */
const UNCATEGORIZED = '__none';

function matches(
  query: string,
  ...fields: (string | null | undefined)[]
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((field) => field?.toLowerCase().includes(q));
}

/** A sidebar group whose label collapses it. */
function Section({
  label,
  action,
  children,
  defaultOpen = true,
}: {
  label: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/section">
      <SidebarGroup>
        <SidebarGroupLabel render={<CollapsibleTrigger />} className="gap-1">
          <ChevronRight className="transition-transform group-data-open/section:rotate-90" />
          {label}
        </SidebarGroupLabel>
        {action}
        <CollapsibleContent>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

/** A row's leading icon on a raised tile (ReUI icon-tile, elevated), the app's one icon style. */
function RowIcon({ children }: { children: ReactNode }) {
  return (
    <IconTile variant="elevated" size="xs" aria-hidden="true">
      {children}
    </IconTile>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-1.5 text-xs text-muted-foreground">{children}</p>
  );
}

function OpenTerminals({ query }: { query: string }) {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const titles = useWorkspace((s) =>
    s.tabs.map((t) => tabTitle(t, s)).join('\u0000'),
  );
  const titleList = titles.split('\u0000');
  const visible = tabs
    .map((tab, i) => ({ tab, title: titleList[i] }))
    .filter(({ title }) => matches(query, title));
  return (
    <Section
      label="Open terminals"
      action={
        <SidebarGroupAction aria-label="New terminal" onClick={() => newTab()}>
          <Plus />
        </SidebarGroupAction>
      }
    >
      <SidebarMenu className="gap-1.5 px-0.5 py-1">
        {visible.length === 0 && (
          <EmptyRow>
            {tabs.length === 0 ? 'No terminals open.' : 'No matches.'}
          </EmptyRow>
        )}
        {visible.map(({ tab }) => (
          <SidebarMenuItem key={tab.id}>
            <TabShell
              tab={tab}
              active={tab.id === activeTabId}
              className="w-full"
            >
              <button
                type="button"
                aria-current={tab.id === activeTabId ? 'page' : undefined}
                className={cn(
                  RAISED,
                  'h-8 w-full justify-start pr-8 pl-2.5',
                  raisedLook(tab, tab.id === activeTabId),
                )}
                onClick={() => activateTab(tab.id)}
                onAuxClick={(event) => {
                  if (event.button === 1) closeTab(tab.id);
                }}
                onDoubleClick={() => patchUi({ renameTabId: tab.id })}
              >
                <TabLabel
                  tab={tab}
                  tiled
                  icon={
                    <RowIcon>
                      <SquareTerminal />
                    </RowIcon>
                  }
                />
              </button>
            </TabShell>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </Section>
  );
}

function CommandItem({ command }: { command: SavedCommand }) {
  const categories = useAppData((s) => s.commands.categories);
  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <SidebarMenuButton
              tooltip={command.command}
              onClick={() => insertCommand(command.command)}
              aria-label={`Insert ${command.name}`}
            />
          }
        >
          <RowIcon>
            <TextCursorInput />
          </RowIcon>
          <span className="truncate">{command.name}</span>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          <ContextMenuGroup>
            <ContextMenuLabel className="truncate">
              {command.name}
            </ContextMenuLabel>
            <ContextMenuItem
              onClick={() => runCommand(command.command, 'saved')}
            >
              <Play />
              Run in active terminal
            </ContextMenuItem>
            <ContextMenuItem onClick={() => insertCommand(command.command)}>
              <TextCursorInput />
              Insert without running
            </ContextMenuItem>
            <ContextMenuItem onClick={() => copyText(command.command)}>
              <Copy />
              Copy command
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem
              onClick={() =>
                patchUi({ commandEditor: command, commandEditorDefaults: null })
              }
            >
              <Pencil />
              Edit…
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() =>
                updateCommands((c) => ({
                  ...c,
                  commands: [
                    ...c.commands,
                    {
                      ...command,
                      id: newId('cmd'),
                      name: `${command.name} copy`,
                      shortcut: null,
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    },
                  ],
                }))
              }
            >
              <Copy />
              Duplicate
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderInput />
                Move to category
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-52">
                <ContextMenuRadioGroup
                  value={command.categoryId ?? UNCATEGORIZED}
                  onValueChange={(value: string) =>
                    updateCommands((c) => ({
                      ...c,
                      commands: c.commands.map((x) =>
                        x.id === command.id
                          ? {
                              ...x,
                              categoryId:
                                value === UNCATEGORIZED ? null : value,
                              updatedAt: Date.now(),
                            }
                          : x,
                      ),
                    }))
                  }
                >
                  {categories.map((category) => (
                    <ContextMenuRadioItem key={category.id} value={category.id}>
                      <span className="truncate">{category.name}</span>
                    </ContextMenuRadioItem>
                  ))}
                  <ContextMenuRadioItem value={UNCATEGORIZED}>
                    Uncategorized
                  </ContextMenuRadioItem>
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem
              variant="destructive"
              onClick={() => {
                updateCommands((c) => ({
                  ...c,
                  commands: c.commands.filter((x) => x.id !== command.id),
                }));
                toast(`Deleted "${command.name}".`, {
                  action: {
                    label: 'Undo',
                    onClick: () =>
                      updateCommands((c) => ({
                        ...c,
                        commands: [...c.commands, command],
                      })),
                  },
                });
              }}
            >
              <Trash2 />
              Delete
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
      <SidebarMenuAction
        showOnHover
        aria-label={`Run ${command.name}`}
        onClick={() => runCommand(command.command, 'saved')}
      >
        <Play />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}

function SavedCommands({ query }: { query: string }) {
  const { categories, commands } = useAppData((s) => s.commands);
  const groups = useMemo(() => {
    const visible = commands.filter((c) =>
      matches(query, c.name, c.command, c.description, ...c.tags),
    );
    const byCategory = categories
      .map((category) => ({
        id: category.id,
        name: category.name,
        items: visible.filter((c) => c.categoryId === category.id),
      }))
      .filter((group) => group.items.length > 0);
    const rest = visible.filter(
      (c) =>
        !c.categoryId || !categories.some((cat) => cat.id === c.categoryId),
    );
    if (rest.length > 0)
      byCategory.push({ id: 'none', name: 'Uncategorized', items: rest });
    return byCategory;
  }, [categories, commands, query]);

  return (
    <Section
      label="Saved commands"
      action={
        <SidebarGroupAction
          aria-label="New saved command"
          onClick={() =>
            patchUi({ commandEditor: 'new', commandEditorDefaults: null })
          }
        >
          <Plus />
        </SidebarGroupAction>
      }
    >
      {groups.length === 0 && (
        <EmptyRow>
          {commands.length === 0
            ? 'Save a command to reuse it in any terminal.'
            : 'No matches.'}
        </EmptyRow>
      )}
      <SidebarMenu>
        {groups.map((group) => (
          // Remounts when a filter starts or clears, so matches open and the full list folds away.
          <Collapsible
            key={`${group.id}:${query ? 'filtered' : 'all'}`}
            defaultOpen={Boolean(query) || groups.length === 1}
            render={<SidebarMenuItem />}
          >
            <CollapsibleTrigger render={<SidebarMenuButton />}>
              <RowIcon>
                <Folder />
              </RowIcon>
              <span className="truncate">{group.name}</span>
            </CollapsibleTrigger>
            <SidebarMenuBadge>{group.items.length}</SidebarMenuBadge>
            <CollapsibleContent>
              <SidebarMenuSub>
                {group.items.map((command) => (
                  <CommandItem key={command.id} command={command} />
                ))}
              </SidebarMenuSub>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </SidebarMenu>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            className="text-muted-foreground"
            onClick={() => patchUi({ commandsOpen: true })}
          >
            Manage commands…
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </Section>
  );
}

function HostItem({ host }: { host: SshHost }) {
  const status = useWorkspace((s) => hostStatus(s, host.id));
  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <SidebarMenuButton
              tooltip={hostTarget(host)}
              onClick={() => connectHost(host)}
              aria-label={`Connect to ${host.name}`}
            />
          }
        >
          <RowIcon>
            <Server />
          </RowIcon>
          <span className="truncate">{host.name}</span>
          {status && (
            <span
              className={cn(
                'ml-auto size-2 shrink-0 rounded-full',
                status === 'connected' ? 'bg-success' : 'bg-warning',
              )}
              role="img"
              aria-label={status === 'connected' ? 'Connected' : 'Connecting'}
            />
          )}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          <ContextMenuGroup>
            <ContextMenuLabel className="truncate">
              {host.name}
            </ContextMenuLabel>
            <ContextMenuItem onClick={() => connectHost(host)}>
              <Plug />
              Connect in new tab
            </ContextMenuItem>
            <ContextMenuItem onClick={() => connectHost(host, 'split-right')}>
              <Columns2 />
              Connect in split right
            </ContextMenuItem>
            <ContextMenuItem onClick={() => connectHost(host, 'split-down')}>
              <Rows2 />
              Connect in split down
            </ContextMenuItem>
            <ContextMenuItem
              disabled={status !== 'connected'}
              onClick={() => disconnectHost(host.id)}
            >
              <Unplug />
              Disconnect
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuLabel>Tools</ContextMenuLabel>
            <ContextMenuItem onClick={() => openHostFiles(host)}>
              <FolderTree />
              Remote files
            </ContextMenuItem>
            <ContextMenuItem onClick={() => openHostMonitor(host)}>
              <Gauge />
              Resource monitor
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem
              onClick={() =>
                patchUi({ hostEditor: host, hostEditorDefaults: null })
              }
            >
              <Pencil />
              Edit…
            </ContextMenuItem>
            <ContextMenuItem onClick={() => duplicateHost(host)}>
              <Copy />
              Duplicate
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem
              variant="destructive"
              onClick={() => deleteHost(host)}
            >
              <Trash2 />
              Delete
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    </SidebarMenuItem>
  );
}

function SshConnections({ query }: { query: string }) {
  const hosts = useAppData((s) => s.profiles.hosts);
  const groups = useMemo(() => {
    const byGroup = new Map<string, SshHost[]>();
    for (const host of hosts) {
      if (!matchesHost(host, query)) continue;
      const key = host.group ?? '';
      byGroup.set(key, [...(byGroup.get(key) ?? []), host]);
    }
    return [...byGroup.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([name, items]) => ({
        name,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [hosts, query]);

  return (
    <Section
      label="SSH hosts"
      action={
        <SidebarGroupAction
          aria-label="New SSH connection"
          onClick={() =>
            patchUi({ hostEditor: 'new', hostEditorDefaults: null })
          }
        >
          <Plus />
        </SidebarGroupAction>
      }
    >
      {groups.length === 0 && (
        <EmptyRow>
          {hosts.length === 0
            ? 'Save a server to connect over SSH.'
            : 'No matches.'}
        </EmptyRow>
      )}
      {groups.map((group) => (
        <div key={group.name} className="flex flex-col">
          {(group.name || groups.length > 1) && (
            <p className="px-2 pt-2 pb-1 text-xs text-muted-foreground">
              {group.name || 'Ungrouped'}
            </p>
          )}
          <SidebarMenu>
            {group.items.map((host) => (
              <HostItem key={host.id} host={host} />
            ))}
          </SidebarMenu>
        </div>
      ))}
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            className="text-muted-foreground"
            onClick={() =>
              hosts.length === 0
                ? patchUi({ hostEditor: 'new', hostEditorDefaults: null })
                : patchUi({ hostsOpen: true })
            }
          >
            {hosts.length === 0 ? 'New SSH connection…' : 'Manage hosts…'}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </Section>
  );
}

/** The header row: the product mark, a live summary and the app's create and settings actions. */
function AppMenu() {
  const tabCount = useWorkspace((s) => s.tabs.length);
  const hostCount = useAppData((s) => s.profiles.hosts.length);
  const summary = `${tabCount} open · ${hostCount} SSH ${hostCount === 1 ? 'host' : 'hosts'}`;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
              />
            }
          >
            <img src={appIcon} alt="" aria-hidden className="size-8 shrink-0" />
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-semibold tracking-tight">
                RTX-Terminal
              </span>
              <span className="truncate text-xs text-sidebar-foreground/70 tabular-nums">
                {summary}
              </span>
            </span>
            <ChevronsUpDown className="ml-auto opacity-60" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Create</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => newTab()}>
                <SquareTerminal />
                New terminal
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  patchUi({ hostEditor: 'new', hostEditorDefaults: null })
                }
              >
                <Server />
                New SSH connection…
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => patchUi({ historyOpen: true })}>
                <History />
                Command history
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => patchUi({ settingsOpen: true })}>
                <Settings />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => patchUi({ aboutOpen: true })}>
                <Info />
                About RTX-Terminal
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar() {
  const [query, setQuery] = useState('');
  // Existing Date.now() calls below run only inside user action handlers to stamp edits.
  return (
    // `inset` paints the window in the sidebar colour and lifts the workspace out of it as a
    // rounded card. The container sits below the 36px menu bar instead of at the viewport top.
    <Sidebar
      variant="inset"
      collapsible="offcanvas"
      className="top-9 h-[calc(100svh-2.25rem)]"
    >
      <SidebarHeader className="gap-2">
        <AppMenu />
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <SidebarInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }}
            placeholder="Filter sessions, commands and hosts"
            aria-label="Filter sessions, commands and hosts"
            className="pl-7"
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <OpenTerminals query={query} />
        <SavedCommands query={query} />
        <SshConnections query={query} />
      </SidebarContent>
      <SidebarFooter className="gap-2">
        {/* SidebarSeparator's own mx-2 overshoots the footer padding; c-sidebar-1 zeroes it the same way. */}
        <SidebarSeparator className="mx-0" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => patchUi({ settingsOpen: true })}>
              <RowIcon>
                <Settings />
              </RowIcon>
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
