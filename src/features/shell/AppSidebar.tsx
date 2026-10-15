import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  ChevronRight,
  Copy,
  FolderPlus,
  Pencil,
  Play,
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
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
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
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import type { SavedCommand, SessionProfile, SshHost } from '@/shared/config';
import appIcon from '../../../assets/icon.svg';
import { newId } from '@/lib/ids';
import { useAppData, updateCommands, updateProfiles } from '@/state/app-data';
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
  openProfile,
  runCommand,
} from '../actions';
import { hostStatus, hostTarget, matchesHost } from '../ssh/host-utils';
import { RAISED, raisedLook, TabLabel, TabShell } from './raised-tab';

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

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-1.5 text-xs text-muted-foreground">{children}</p>
  );
}

function ProfileItem({ profile }: { profile: SessionProfile }) {
  const groups = useAppData((s) => s.profiles.groups);
  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <SidebarMenuButton
              tooltip={profile.cwd ?? undefined}
              onClick={() => openProfile(profile)}
              aria-label={`Open ${profile.name}`}
            />
          }
        >
          <SquareTerminal />
          <span className="truncate">{profile.name}</span>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem onClick={() => openProfile(profile)}>
            Open in new tab
          </ContextMenuItem>
          <ContextMenuItem onClick={() => openProfile(profile, 'split-right')}>
            Open split right
          </ContextMenuItem>
          <ContextMenuItem onClick={() => openProfile(profile, 'split-down')}>
            Open split down
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() =>
              patchUi({ profileEditor: profile, profileEditorDefaults: null })
            }
          >
            <Pencil />
            Edit…
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Move to group</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {groups.map((group) => (
                <ContextMenuItem
                  key={group.id}
                  disabled={group.id === profile.groupId}
                  onClick={() =>
                    updateProfiles((p) => ({
                      ...p,
                      profiles: p.profiles.map((x) =>
                        x.id === profile.id ? { ...x, groupId: group.id } : x,
                      ),
                    }))
                  }
                >
                  {group.name}
                </ContextMenuItem>
              ))}
              <ContextMenuItem
                disabled={profile.groupId === null}
                onClick={() =>
                  updateProfiles((p) => ({
                    ...p,
                    profiles: p.profiles.map((x) =>
                      x.id === profile.id ? { ...x, groupId: null } : x,
                    ),
                  }))
                }
              >
                No group
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => {
              updateProfiles((p) => ({
                ...p,
                profiles: p.profiles.filter((x) => x.id !== profile.id),
              }));
              toast(`Deleted "${profile.name}".`, {
                action: {
                  label: 'Undo',
                  onClick: () =>
                    updateProfiles((p) => ({
                      ...p,
                      profiles: [...p.profiles, profile],
                    })),
                },
              });
            }}
          >
            <Trash2 />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </SidebarMenuItem>
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
                  icon={
                    <SquareTerminal className="relative size-4 shrink-0 opacity-80" />
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

function SessionGroups({ query }: { query: string }) {
  const { groups, profiles } = useAppData((s) => s.profiles);
  const ungrouped = profiles.filter(
    (p) => p.groupId === null && matches(query, p.name, p.cwd),
  );
  return (
    <>
      {groups.map((group) => {
        const items = profiles.filter(
          (p) =>
            p.groupId === group.id && matches(query, p.name, p.cwd, group.name),
        );
        return (
          <ContextMenu key={group.id}>
            <ContextMenuTrigger>
              <Section
                label={group.name}
                action={
                  <SidebarGroupAction
                    aria-label={`New session in ${group.name}`}
                    onClick={() =>
                      patchUi({
                        profileEditor: 'new',
                        profileEditorDefaults: { groupId: group.id },
                      })
                    }
                  >
                    <Plus />
                  </SidebarGroupAction>
                }
              >
                <SidebarMenu>
                  {items.length === 0 && (
                    <EmptyRow>
                      {query ? 'No matches.' : 'No sessions in this group.'}
                    </EmptyRow>
                  )}
                  {items.map((profile) => (
                    <ProfileItem key={profile.id} profile={profile} />
                  ))}
                </SidebarMenu>
              </Section>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-52">
              <ContextMenuItem
                onClick={() =>
                  patchUi({
                    profileEditor: 'new',
                    profileEditorDefaults: { groupId: group.id },
                  })
                }
              >
                <Plus />
                New session in group
              </ContextMenuItem>
              <ContextMenuItem onClick={() => patchUi({ groupEditor: group })}>
                <Pencil />
                Rename group
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() => {
                  updateProfiles((p) => ({
                    ...p,
                    groups: p.groups.filter((g) => g.id !== group.id),
                    profiles: p.profiles.map((x) =>
                      x.groupId === group.id ? { ...x, groupId: null } : x,
                    ),
                  }));
                  toast(
                    `Deleted group "${group.name}". Its sessions moved to Other.`,
                  );
                }}
              >
                <Trash2 />
                Delete group
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      {ungrouped.length > 0 && (
        <Section label="Other">
          <SidebarMenu>
            {ungrouped.map((profile) => (
              <ProfileItem key={profile.id} profile={profile} />
            ))}
          </SidebarMenu>
        </Section>
      )}
    </>
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
          <TextCursorInput />
          <span className="truncate">{command.name}</span>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem onClick={() => runCommand(command.command, 'saved')}>
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
          <ContextMenuSeparator />
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
            <ContextMenuSubTrigger>Move to category</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {categories.map((category) => (
                <ContextMenuItem
                  key={category.id}
                  disabled={category.id === command.categoryId}
                  onClick={() =>
                    updateCommands((c) => ({
                      ...c,
                      commands: c.commands.map((x) =>
                        x.id === command.id
                          ? {
                              ...x,
                              categoryId: category.id,
                              updatedAt: Date.now(),
                            }
                          : x,
                      ),
                    }))
                  }
                >
                  {category.name}
                </ContextMenuItem>
              ))}
              <ContextMenuItem
                disabled={command.categoryId === null}
                onClick={() =>
                  updateCommands((c) => ({
                    ...c,
                    commands: c.commands.map((x) =>
                      x.id === command.id
                        ? { ...x, categoryId: null, updatedAt: Date.now() }
                        : x,
                    ),
                  }))
                }
              >
                Uncategorized
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
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
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col">
          <p className="px-2 pt-2 pb-1 text-xs text-muted-foreground">
            {group.name}
          </p>
          <SidebarMenu>
            {group.items.map((command) => (
              <CommandItem key={command.id} command={command} />
            ))}
          </SidebarMenu>
        </div>
      ))}
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
          <Server />
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
        <ContextMenuContent className="w-56">
          <ContextMenuItem onClick={() => connectHost(host)}>
            <Plug />
            Connect in new tab
          </ContextMenuItem>
          <ContextMenuItem onClick={() => connectHost(host, 'split-right')}>
            Connect in split right
          </ContextMenuItem>
          <ContextMenuItem onClick={() => connectHost(host, 'split-down')}>
            Connect in split down
          </ContextMenuItem>
          <ContextMenuItem
            disabled={status !== 'connected'}
            onClick={() => disconnectHost(host.id)}
          >
            <Unplug />
            Disconnect
          </ContextMenuItem>
          <ContextMenuSeparator />
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
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => deleteHost(host)}
          >
            <Trash2 />
            Delete
          </ContextMenuItem>
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

export function AppSidebar() {
  const [query, setQuery] = useState('');
  // Existing Date.now() calls below run only inside user action handlers to stamp edits.
  return (
    <Sidebar collapsible="offcanvas" className="top-9 h-[calc(100svh-2.25rem)]">
      <SidebarHeader className="gap-3">
        <div className="flex items-center gap-2 px-1 pt-1">
          <img src={appIcon} alt="" aria-hidden className="size-7 shrink-0" />

          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold tracking-tight">
              rtx-terminal
            </span>
            <span className="text-xs text-muted-foreground">
              Local workspace
            </span>
          </div>
        </div>
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
        <SessionGroups query={query} />
        <SavedCommands query={query} />
        <SshConnections query={query} />
      </SidebarContent>
      <SidebarFooter className="flex-row gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 justify-start"
          onClick={() =>
            patchUi({ profileEditor: 'new', profileEditorDefaults: null })
          }
        >
          <Plus data-icon="inline-start" />
          New session
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New group"
          onClick={() => patchUi({ groupEditor: 'new' })}
        >
          <FolderPlus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Settings"
          onClick={() => patchUi({ settingsOpen: true })}
        >
          <Settings />
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
