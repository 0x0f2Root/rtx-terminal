import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  Check,
  ChevronLeft,
  History,
  Palette,
  Play,
  Server,
  SquareTerminal,
  TextCursorInput,
} from 'lucide-react';
import { ShortcutKeys } from '@/components/shortcut-keys';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { Kbd } from '@/components/ui/kbd';
import { appData, updatePreferences, useAppData } from '@/state/app-data';
import { patchUi, useUi, type PalettePage } from '@/state/ui';
import { activateTab, tabTitle, useWorkspace } from '@/state/workspace';
import {
  ACTIONS,
  connectHost,
  insertCommand,
  runCommand,
  shortcutFor,
  type ActionGroup,
} from '../actions';
import { TERMINAL_THEMES } from '../terminal/themes';

const GROUP_ORDER: ActionGroup[] = [
  'Terminal',
  'Panes',
  'Tabs',
  'Commands',
  'View',
  'App',
];

const PAGE_TITLES: Record<PalettePage, string> = {
  root: 'Type a command or search',
  themes: 'Choose a terminal theme',
  commands: 'Run a saved command',
  tabs: 'Switch to a terminal',
  history: 'Search command history',
  hosts: 'Connect to an SSH host',
};

function close() {
  patchUi({ palette: { open: false, page: 'root' } });
}

/** Lets an item react to Shift+Enter (the secondary action) as well as Enter. */
function useSecondary() {
  const [selected, setSelected] = useState('');
  const secondary = new Map<string, () => void>();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && event.shiftKey && secondary.has(selected)) {
      event.preventDefault();
      secondary.get(selected)?.();
    }
  };
  return { selected, setSelected, secondary, onKeyDown };
}

export function CommandPalette() {
  const { open, page } = useUi((s) => s.palette);
  const [search, setSearch] = useState('');
  const shortcuts = useAppData((s) => s.preferences.shortcuts);
  const themeId = useAppData((s) => s.preferences.terminal.themeId);
  const commands = useAppData((s) => s.commands);
  const history = useAppData((s) => s.history.entries);
  const tabs = useWorkspace((s) => s.tabs);
  const hosts = useAppData((s) => s.profiles.hosts);
  const titles = useWorkspace((s) =>
    s.tabs.map((t) => tabTitle(t, s)).join('\u0000'),
  ).split('\u0000');
  const { setSelected, selected, secondary, onKeyDown } = useSecondary();

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        actions: ACTIONS.filter(
          (a) => a.group === group && a.id !== 'palette.open',
        ),
      })),
    [],
  );

  const goTo = (next: PalettePage) => {
    setSearch('');
    patchUi({ palette: { open: true, page: next } });
  };

  const categoryName = (id: string | null) =>
    commands.categories.find((c) => c.id === id)?.name ?? null;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        setSearch('');
      }}
      title="Command palette"
      description={PAGE_TITLES[page]}
      className="sm:max-w-xl"
    >
      <Command
        value={selected}
        onValueChange={setSelected}
        onKeyDown={onKeyDown}
      >
        <CommandInput
          value={search}
          onValueChange={setSearch}
          placeholder={PAGE_TITLES[page]}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !search && page !== 'root') {
              event.preventDefault();
              goTo('root');
            }
          }}
        />
        <CommandList className="max-h-96">
          <CommandEmpty>No results.</CommandEmpty>

          {page !== 'root' && (
            <CommandGroup>
              <CommandItem value="__back" onSelect={() => goTo('root')}>
                <ChevronLeft />
                Back to all actions
                <CommandShortcut>
                  <Kbd>⌫</Kbd>
                </CommandShortcut>
              </CommandItem>
            </CommandGroup>
          )}

          {page === 'root' &&
            grouped.map(({ group, actions }) => (
              <CommandGroup key={group} heading={group}>
                {actions.map((action) => (
                  <CommandItem
                    key={action.id}
                    value={action.title}
                    keywords={action.keywords}
                    onSelect={() => {
                      if (action.id === 'theme.change') return goTo('themes');
                      if (action.id === 'commands.picker')
                        return goTo('commands');
                      if (action.id === 'tab.switch') return goTo('tabs');
                      if (action.id === 'ssh.connect') return goTo('hosts');
                      close();
                      // Let the dialog release focus before the action moves it (into a terminal or dialog).
                      requestAnimationFrame(() => action.run());
                    }}
                  >
                    {action.title}
                    <CommandShortcut>
                      <ShortcutKeys
                        accelerator={shortcutFor(action.id, shortcuts)}
                      />
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}

          {page === 'root' && (
            <CommandGroup heading="History">
              <CommandItem
                value="Search command history…"
                onSelect={() => goTo('history')}
              >
                <History />
                Search command history…
              </CommandItem>
            </CommandGroup>
          )}

          {page === 'themes' && (
            <CommandGroup heading="Terminal themes">
              {TERMINAL_THEMES.map((theme) => (
                <CommandItem
                  key={theme.id}
                  value={theme.name}
                  onSelect={() => {
                    updatePreferences((p) => ({
                      ...p,
                      terminal: { ...p.terminal, themeId: theme.id },
                    }));
                    close();
                  }}
                >
                  <Palette />
                  <span className="flex items-center gap-1">
                    {[
                      theme.colors.background,
                      theme.colors.red,
                      theme.colors.green,
                      theme.colors.blue,
                      theme.colors.foreground,
                    ].map((color) => (
                      <span
                        key={color}
                        className="size-2.5 rounded-full border"
                        style={{ background: color }}
                      />
                    ))}
                  </span>
                  {theme.name}
                  {theme.id === themeId && <Check className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {page === 'commands' && (
            <CommandGroup heading="Saved commands · Enter runs, Shift+Enter inserts">
              {commands.commands.map((command) => {
                const value = `cmd ${command.id}`;
                secondary.set(value, () => {
                  close();
                  requestAnimationFrame(() => insertCommand(command.command));
                });
                return (
                  <CommandItem
                    key={command.id}
                    value={value}
                    keywords={[
                      command.name,
                      command.command,
                      command.description,
                      ...command.tags,
                      categoryName(command.categoryId) ?? '',
                    ]}
                    onSelect={() => {
                      close();
                      requestAnimationFrame(() =>
                        runCommand(command.command, 'saved'),
                      );
                    }}
                  >
                    <Play />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate">{command.name}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {command.command}
                      </span>
                    </div>
                    {categoryName(command.categoryId) && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {categoryName(command.categoryId)}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {page === 'hosts' && (
            <CommandGroup heading="SSH hosts · Enter opens a tab, Shift+Enter splits right">
              {hosts.length === 0 && (
                <CommandItem
                  value="New SSH connection…"
                  onSelect={() => {
                    close();
                    patchUi({ hostEditor: 'new', hostEditorDefaults: null });
                  }}
                >
                  <Server />
                  New SSH connection…
                </CommandItem>
              )}
              {hosts.map((host) => {
                const value = `host ${host.id}`;
                secondary.set(value, () => {
                  close();
                  requestAnimationFrame(() => connectHost(host, 'split-right'));
                });
                return (
                  <CommandItem
                    key={host.id}
                    value={value}
                    keywords={[
                      host.name,
                      host.host,
                      host.username,
                      host.configAlias ?? '',
                      host.group ?? '',
                      ...host.tags,
                    ]}
                    onSelect={() => {
                      close();
                      requestAnimationFrame(() => connectHost(host));
                    }}
                  >
                    <Server />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate">{host.name}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {host.username || '…'}@{host.host || host.configAlias}
                        {host.port !== 22 ? `:${host.port}` : ''}
                      </span>
                    </div>
                    {host.group && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {host.group}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {page === 'tabs' && (
            <CommandGroup heading="Open terminals">
              {tabs.map((tab, index) => (
                <CommandItem
                  key={tab.id}
                  value={`tab ${tab.id}`}
                  keywords={[titles[index] ?? '']}
                  onSelect={() => {
                    activateTab(tab.id);
                    close();
                  }}
                >
                  <SquareTerminal />
                  {titles[index]}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {page === 'history' && (
            <CommandGroup heading="Recorded by rtx-terminal · Enter inserts, Shift+Enter runs">
              {[...history].reverse().map((entry) => {
                const value = `hist ${entry.id}`;
                secondary.set(value, () => {
                  close();
                  requestAnimationFrame(() =>
                    runCommand(entry.command, 'history'),
                  );
                });
                return (
                  <CommandItem
                    key={entry.id}
                    value={value}
                    keywords={[entry.command]}
                    onSelect={() => {
                      close();
                      requestAnimationFrame(() => insertCommand(entry.command));
                    }}
                  >
                    <TextCursorInput />
                    <span className="truncate font-mono text-xs">
                      {entry.command}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                      {new Date(entry.timestamp).toLocaleString(undefined, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
        {(page === 'commands' || page === 'history') && selected && (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {appData.get().preferences.history.mode === 'off' &&
            page === 'history'
              ? 'History is turned off in Settings.'
              : page === 'commands'
                ? 'Enter runs in the active terminal. Shift+Enter types it without running.'
                : 'Enter types the command without running it. Shift+Enter runs it.'}
          </p>
        )}
      </Command>
    </CommandDialog>
  );
}
