import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ShortcutKeys } from '@/components/shortcut-keys';
import { useAppData } from '@/state/app-data';
import { patchUi } from '@/state/ui';
import {
  activePane,
  activeTab,
  paneIds,
  useWorkspace,
} from '@/state/workspace';
import { connectHost, openProfile, runAction, shortcutFor } from '../actions';

function MenuShortcut({ action }: { action: string }) {
  const accelerator = useAppData((s) =>
    shortcutFor(action, s.preferences.shortcuts),
  );
  return accelerator ? (
    <DropdownMenuShortcut>
      <ShortcutKeys accelerator={accelerator} />
    </DropdownMenuShortcut>
  ) : null;
}

function ActionItem({
  action,
  disabled = false,
  children,
}: {
  action: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem disabled={disabled} onClick={() => runAction(action)}>
      {children}
      <MenuShortcut action={action} />
    </DropdownMenuItem>
  );
}

function MenuGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${label} menu`}
          />
        }
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function openSettings(section: 'appearance' | 'keyboard' | 'shell') {
  patchUi({ settingsOpen: true, settingsSection: section });
}

export function AppMenuBar() {
  const profiles = useAppData((s) => s.profiles.profiles);
  const pane = useWorkspace((s) => activePane(s));
  const paneCount = useWorkspace((s) => {
    const tab = activeTab(s);
    return tab ? paneIds(tab.root).length : 0;
  });
  const hasTerminal = !!pane;
  const canStop = pane?.status === 'running';
  const hosts = useAppData((s) => s.profiles.hosts);
  const remote = pane?.launch.ssh ? pane.status : null;

  return (
    <nav
      aria-label="Application menu"
      className="flex h-9 shrink-0 items-center overflow-x-auto border-b bg-chrome px-1 [scrollbar-width:none]"
    >
      <div className="flex min-w-max items-center gap-0.5">
        <MenuGroup label="File">
          <ActionItem action="terminal.new">New Terminal</ActionItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>New Session</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {profiles.map((profile) => (
                <DropdownMenuItem
                  key={profile.id}
                  onClick={() => openProfile(profile)}
                >
                  {profile.name}
                </DropdownMenuItem>
              ))}
              {profiles.length > 0 && <DropdownMenuSeparator />}
              <ActionItem action="session.newProfile">
                New Saved Session…
              </ActionItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <ActionItem action="tab.close" disabled={!hasTerminal}>
            Close Terminal
          </ActionItem>
          <DropdownMenuSeparator />
          <ActionItem action="app.quit">Quit</ActionItem>
        </MenuGroup>

        <MenuGroup label="Edit">
          <ActionItem action="terminal.copy" disabled={!hasTerminal}>
            Copy
          </ActionItem>
          <ActionItem action="terminal.paste" disabled={!hasTerminal}>
            Paste
          </ActionItem>
          <DropdownMenuSeparator />
          <ActionItem action="terminal.selectAll" disabled={!hasTerminal}>
            Select All
          </ActionItem>
          <DropdownMenuSeparator />
          <ActionItem action="terminal.search" disabled={!hasTerminal}>
            Find in Terminal
          </ActionItem>
        </MenuGroup>

        <MenuGroup label="Selection">
          <ActionItem action="terminal.selectAll" disabled={!hasTerminal}>
            Select All
          </ActionItem>
          <ActionItem action="terminal.clearSelection" disabled={!hasTerminal}>
            Clear Selection
          </ActionItem>
          <ActionItem action="terminal.copy" disabled={!hasTerminal}>
            Copy Selection
          </ActionItem>
        </MenuGroup>

        <MenuGroup label="View">
          <ActionItem action="view.sidebar">Toggle Sidebar</ActionItem>
          <DropdownMenuSeparator />
          <ActionItem action="view.fontIncrease">Zoom In</ActionItem>
          <ActionItem action="view.fontDecrease">Zoom Out</ActionItem>
          <ActionItem action="view.fontReset">Reset Zoom</ActionItem>
          <DropdownMenuSeparator />
          <ActionItem action="view.fullScreen">Toggle Full Screen</ActionItem>
        </MenuGroup>

        <MenuGroup label="Go">
          <ActionItem action="tab.switch">Switch Terminal</ActionItem>
          <ActionItem action="tab.next">Next Terminal</ActionItem>
          <ActionItem action="tab.previous">Previous Terminal</ActionItem>
          <DropdownMenuSeparator />
          <ActionItem action="pane.next" disabled={paneCount < 2}>
            Focus Next Pane
          </ActionItem>
          <ActionItem action="pane.previous" disabled={paneCount < 2}>
            Focus Previous Pane
          </ActionItem>
          <DropdownMenuSeparator />
          <ActionItem action="history.open">Open Command History</ActionItem>
          <ActionItem action="commands.manage">Open Saved Commands</ActionItem>
        </MenuGroup>

        <MenuGroup label="Run">
          <ActionItem action="commands.picker">Run Saved Command</ActionItem>
          <ActionItem action="terminal.interrupt" disabled={!canStop}>
            Stop Current Process
          </ActionItem>
        </MenuGroup>

        <MenuGroup label="Terminal">
          <ActionItem action="terminal.new">New Terminal</ActionItem>
          <DropdownMenuSeparator />
          <ActionItem action="pane.splitRight">
            Split Terminal Horizontally
          </ActionItem>
          <ActionItem action="pane.splitDown">
            Split Terminal Vertically
          </ActionItem>
          <DropdownMenuSeparator />
          <ActionItem action="pane.close" disabled={!hasTerminal}>
            Close Active Terminal
          </ActionItem>
          <ActionItem action="terminal.clear" disabled={!hasTerminal}>
            Clear Terminal
          </ActionItem>
          <ActionItem action="terminal.reset" disabled={!hasTerminal}>
            Reset Terminal
          </ActionItem>
          <DropdownMenuSeparator />
          <ActionItem action="terminal.search" disabled={!hasTerminal}>
            Find in Terminal
          </ActionItem>
          <DropdownMenuItem onClick={() => openSettings('appearance')}>
            Open Terminal Settings
          </DropdownMenuItem>
        </MenuGroup>

        <MenuGroup label="SSH">
          <ActionItem action="ssh.connect">Connect to Host…</ActionItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={hosts.length === 0}>
              Saved Hosts
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {[...hosts]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((host) => (
                  <DropdownMenuItem
                    key={host.id}
                    onClick={() => connectHost(host)}
                  >
                    {host.name}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <ActionItem action="ssh.newHost">New SSH Connection…</ActionItem>
          <ActionItem action="ssh.manage">Manage Hosts…</ActionItem>
          <DropdownMenuSeparator />
          <ActionItem action="ssh.disconnect" disabled={remote !== 'running'}>
            Disconnect Active Session
          </ActionItem>
          <ActionItem
            action="ssh.reconnect"
            disabled={remote !== 'exited' && remote !== 'error'}
          >
            Reconnect Active Session
          </ActionItem>
        </MenuGroup>

        <MenuGroup label="Settings">
          <ActionItem action="app.settings">Open Settings</ActionItem>
          <DropdownMenuItem onClick={() => openSettings('appearance')}>
            Terminal Appearance
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openSettings('keyboard')}>
            Keyboard Shortcuts
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openSettings('shell')}>
            Configure Default Shell
          </DropdownMenuItem>
          <ActionItem action="commands.manage">
            Manage Saved Commands
          </ActionItem>
        </MenuGroup>

        <MenuGroup label="Help">
          <DropdownMenuItem onClick={() => openSettings('keyboard')}>
            Keyboard Shortcuts
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <ActionItem action="app.about">About rtx-terminal</ActionItem>
        </MenuGroup>
      </div>
    </nav>
  );
}
