import { ShortcutKeys } from '@/components/shortcut-keys';
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '@/components/ui/menubar';
import type { SshHost } from '@/shared/config';
import { useAppData } from '@/state/app-data';
import { patchUi } from '@/state/ui';
import {
  activePane,
  activeTab,
  paneIds,
  useWorkspace,
} from '@/state/workspace';
import {
  connectHost,
  openHostFiles,
  openHostMonitor,
  openProfile,
  runAction,
  shortcutFor,
} from '../actions';

function MenuShortcut({ action }: { action: string }) {
  const accelerator = useAppData((s) =>
    shortcutFor(action, s.preferences.shortcuts),
  );
  return accelerator ? (
    <MenubarShortcut>
      <ShortcutKeys accelerator={accelerator} />
    </MenubarShortcut>
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
    <MenubarItem disabled={disabled} onClick={() => runAction(action)}>
      {children}
      <MenuShortcut action={action} />
    </MenubarItem>
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
    <MenubarMenu>
      <MenubarTrigger>{label}</MenubarTrigger>
      <MenubarContent className="w-64">{children}</MenubarContent>
    </MenubarMenu>
  );
}

/** A submenu listing saved hosts, sorted by name, that runs `open` on the chosen one. */
function HostsSubmenu({
  label,
  hosts,
  open,
}: {
  label: string;
  hosts: SshHost[];
  open: (host: SshHost) => void;
}) {
  return (
    <MenubarSub>
      <MenubarSubTrigger disabled={hosts.length === 0}>
        {label}
      </MenubarSubTrigger>
      <MenubarSubContent className="w-56">
        {hosts.map((host) => (
          <MenubarItem key={host.id} onClick={() => open(host)}>
            {host.name}
          </MenubarItem>
        ))}
      </MenubarSubContent>
    </MenubarSub>
  );
}

function openSettings(section: 'appearance' | 'keyboard' | 'shell') {
  patchUi({ settingsOpen: true, settingsSection: section });
}

/**
 * The desktop menu bar. A Base UI menubar: one menu opens at a time, Left and Right move between
 * menus, and hovering switches menus while one is open. Items that cannot act in the current
 * context are disabled rather than left clickable.
 */
export function AppMenuBar() {
  const profiles = useAppData((s) => s.profiles.profiles);
  const hosts = useAppData((s) => s.profiles.hosts);
  const pane = useWorkspace((s) => activePane(s));
  const paneCount = useWorkspace((s) => {
    const tab = activeTab(s);
    return tab ? paneIds(tab.root).length : 0;
  });
  const hasTab = !!pane;
  // Terminal actions need a terminal: a remote file or monitor pane has no shell to act on.
  const isTerminal = !!pane && (pane.launch.view ?? 'terminal') === 'terminal';
  const canStop = isTerminal && pane?.status === 'running';
  const sshTerminal = isTerminal && pane?.launch.ssh ? pane.status : null;
  const activeHost = pane?.launch.ssh
    ? hosts.find((h) => h.id === pane.launch.ssh?.hostId)
    : undefined;
  const sortedHosts = [...hosts].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <nav
      aria-label="Application menu"
      className="flex h-9 shrink-0 items-center overflow-x-auto border-b bg-chrome px-1 [scrollbar-width:none]"
    >
      {/* The bar is the chrome strip itself, so the menubar drops only its outline. */}
      <Menubar className="min-w-max border-0">
        <MenuGroup label="File">
          <ActionItem action="terminal.new">New Terminal</ActionItem>
          <MenubarSub>
            <MenubarSubTrigger>New Session</MenubarSubTrigger>
            <MenubarSubContent className="w-56">
              {profiles.map((profile) => (
                <MenubarItem
                  key={profile.id}
                  onClick={() => openProfile(profile)}
                >
                  {profile.name}
                </MenubarItem>
              ))}
              {profiles.length > 0 && <MenubarSeparator />}
              <ActionItem action="session.newProfile">
                New Saved Session…
              </ActionItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <ActionItem action="tab.close" disabled={!hasTab}>
            Close Tab
          </ActionItem>
          <MenubarSeparator />
          <ActionItem action="app.quit">Quit</ActionItem>
        </MenuGroup>

        <MenuGroup label="Edit">
          <ActionItem action="terminal.copy" disabled={!isTerminal}>
            Copy
          </ActionItem>
          <ActionItem action="terminal.paste" disabled={!isTerminal}>
            Paste
          </ActionItem>
          <MenubarSeparator />
          <ActionItem action="terminal.selectAll" disabled={!isTerminal}>
            Select All
          </ActionItem>
          <MenubarSeparator />
          <ActionItem action="terminal.search" disabled={!isTerminal}>
            Find in Terminal
          </ActionItem>
        </MenuGroup>

        <MenuGroup label="Selection">
          <ActionItem action="terminal.selectAll" disabled={!isTerminal}>
            Select All
          </ActionItem>
          <ActionItem action="terminal.clearSelection" disabled={!isTerminal}>
            Clear Selection
          </ActionItem>
          <ActionItem action="terminal.copy" disabled={!isTerminal}>
            Copy Selection
          </ActionItem>
        </MenuGroup>

        <MenuGroup label="View">
          <ActionItem action="view.sidebar">Toggle Sidebar</ActionItem>
          <MenubarSeparator />
          <ActionItem action="view.fontIncrease">Zoom In</ActionItem>
          <ActionItem action="view.fontDecrease">Zoom Out</ActionItem>
          <ActionItem action="view.fontReset">Reset Zoom</ActionItem>
          <MenubarSeparator />
          <ActionItem action="view.fullScreen">Toggle Full Screen</ActionItem>
        </MenuGroup>

        <MenuGroup label="Go">
          <ActionItem action="tab.switch">Switch Tab</ActionItem>
          <ActionItem action="tab.next">Next Tab</ActionItem>
          <ActionItem action="tab.previous">Previous Tab</ActionItem>
          <MenubarSeparator />
          <ActionItem action="pane.next" disabled={paneCount < 2}>
            Focus Next Pane
          </ActionItem>
          <ActionItem action="pane.previous" disabled={paneCount < 2}>
            Focus Previous Pane
          </ActionItem>
          <MenubarSeparator />
          <ActionItem action="history.open">Open Command History</ActionItem>
          <ActionItem action="commands.manage">Open Saved Commands</ActionItem>
        </MenuGroup>

        <MenuGroup label="Run">
          <ActionItem action="commands.picker" disabled={!isTerminal}>
            Run Saved Command
          </ActionItem>
          <ActionItem action="terminal.interrupt" disabled={!canStop}>
            Stop Current Process
          </ActionItem>
        </MenuGroup>

        <MenuGroup label="Terminal">
          <ActionItem action="terminal.new">New Terminal</ActionItem>
          <MenubarSeparator />
          <ActionItem action="pane.splitRight">
            Split Terminal Horizontally
          </ActionItem>
          <ActionItem action="pane.splitDown">
            Split Terminal Vertically
          </ActionItem>
          <MenubarSeparator />
          <ActionItem action="pane.close" disabled={!hasTab}>
            Close Active Pane
          </ActionItem>
          <ActionItem action="terminal.clear" disabled={!isTerminal}>
            Clear Terminal
          </ActionItem>
          <ActionItem action="terminal.reset" disabled={!isTerminal}>
            Reset Terminal
          </ActionItem>
          <MenubarSeparator />
          <ActionItem action="terminal.search" disabled={!isTerminal}>
            Find in Terminal
          </ActionItem>
          <MenubarItem onClick={() => openSettings('appearance')}>
            Open Terminal Settings
          </MenubarItem>
        </MenuGroup>

        <MenuGroup label="SSH">
          <ActionItem action="ssh.connect">Connect to Host…</ActionItem>
          <HostsSubmenu
            label="Saved Hosts"
            hosts={sortedHosts}
            open={(host) => connectHost(host)}
          />
          <ActionItem action="ssh.newHost">New SSH Connection…</ActionItem>
          <ActionItem action="ssh.manage">Manage Hosts…</ActionItem>
          <MenubarSeparator />
          <MenubarItem
            disabled={!activeHost}
            onClick={() => activeHost && openHostFiles(activeHost)}
          >
            Remote Files on This Host
          </MenubarItem>
          <MenubarItem
            disabled={!activeHost}
            onClick={() => activeHost && openHostMonitor(activeHost)}
          >
            Resource Monitor for This Host
          </MenubarItem>
          <HostsSubmenu
            label="Remote Files on…"
            hosts={sortedHosts}
            open={(host) => openHostFiles(host)}
          />
          <HostsSubmenu
            label="Resource Monitor for…"
            hosts={sortedHosts}
            open={(host) => openHostMonitor(host)}
          />
          <MenubarSeparator />
          <ActionItem
            action="ssh.disconnect"
            disabled={sshTerminal !== 'running'}
          >
            Disconnect Active Session
          </ActionItem>
          <ActionItem
            action="ssh.reconnect"
            disabled={sshTerminal !== 'exited' && sshTerminal !== 'error'}
          >
            Reconnect Active Session
          </ActionItem>
        </MenuGroup>

        <MenuGroup label="Settings">
          <ActionItem action="app.settings">Open Settings</ActionItem>
          <MenubarItem onClick={() => openSettings('appearance')}>
            Terminal Appearance
          </MenubarItem>
          <MenubarItem onClick={() => openSettings('keyboard')}>
            Keyboard Shortcuts
          </MenubarItem>
          <MenubarItem onClick={() => openSettings('shell')}>
            Configure Default Shell
          </MenubarItem>
          <ActionItem action="commands.manage">
            Manage Saved Commands
          </ActionItem>
        </MenuGroup>

        <MenuGroup label="Help">
          <MenubarItem onClick={() => openSettings('keyboard')}>
            Keyboard Shortcuts
          </MenubarItem>
          <MenubarSeparator />
          <ActionItem action="app.about">About rtx-terminal</ActionItem>
        </MenuGroup>
      </Menubar>
    </nav>
  );
}
