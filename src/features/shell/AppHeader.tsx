import {
  ChevronDown,
  Columns2,
  Command as CommandIcon,
  Ellipsis,
  FolderOpen,
  History,
  PanelLeft,
  Plus,
  Rows2,
  Search,
  Settings,
  SquareTerminal,
} from 'lucide-react';
import { ShortcutKeys } from '@/components/shortcut-keys';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAppData } from '@/state/app-data';
import { patchUi } from '@/state/ui';
import { TerminalTabs } from './TerminalTabs';
import {
  newTab,
  newTabHere,
  openPalette,
  openProfile,
  openSearch,
  runAction,
  shortcutFor,
  splitActive,
} from '../actions';

function useShortcut(action: string) {
  return useAppData((s) => shortcutFor(action, s.preferences.shortcuts));
}

function NewTabMenu() {
  const shells = useAppData((s) => s.shells);
  const profiles = useAppData((s) => s.profiles.profiles);
  const newShortcut = useShortcut('terminal.new');
  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New terminal tab"
              onClick={() => newTab()}
            />
          }
        >
          <Plus />
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-2">
          New terminal tab <ShortcutKeys accelerator={newShortcut} />
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="More ways to open a terminal"
            />
          }
        >
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-60">
          <DropdownMenuItem onClick={() => void newTabHere()}>
            <FolderOpen />
            New tab in current directory
          </DropdownMenuItem>
          {shells.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Shells</DropdownMenuLabel>
                {shells.map((shell) => (
                  <DropdownMenuItem
                    key={shell.path}
                    onClick={() => newTab({ shell: shell.path })}
                  >
                    <SquareTerminal />
                    {shell.name}
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {shell.path}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}
          {profiles.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Saved sessions</DropdownMenuLabel>
                {profiles.map((profile) => (
                  <DropdownMenuItem
                    key={profile.id}
                    onClick={() => openProfile(profile)}
                  >
                    <SquareTerminal />
                    <span className="truncate">{profile.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MenuShortcut({ action }: { action: string }) {
  const accelerator = useShortcut(action);
  return accelerator ? (
    <DropdownMenuShortcut>
      <ShortcutKeys accelerator={accelerator} />
    </DropdownMenuShortcut>
  ) : null;
}

function ActionsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="More actions" />
        }
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => void splitActive('horizontal')}>
            <Columns2 />
            Split right
            <MenuShortcut action="pane.splitRight" />
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void splitActive('vertical')}>
            <Rows2 />
            Split down
            <MenuShortcut action="pane.splitDown" />
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openSearch}>
            <Search />
            Find in terminal
            <MenuShortcut action="terminal.search" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => patchUi({ commandsOpen: true })}>
            <SquareTerminal />
            Saved commands
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => patchUi({ historyOpen: true })}>
            <History />
            Command history
            <MenuShortcut action="history.open" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => runAction('view.sidebar')}>
            <PanelLeft />
            Toggle sidebar
            <MenuShortcut action="view.sidebar" />
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => patchUi({ settingsOpen: true })}>
            <Settings />
            Settings
            <MenuShortcut action="app.settings" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppHeader() {
  const paletteShortcut = useShortcut('palette.open');
  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b bg-chrome px-2">
      <SidebarTrigger />
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <TerminalTabs />
        <NewTabMenu />
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => openPalette()}
        aria-label="Open command palette"
      >
        <CommandIcon data-icon="inline-start" />
        <span className="hidden lg:inline">Commands</span>
        <ShortcutKeys
          accelerator={paletteShortcut}
          className="hidden md:inline-flex"
        />
      </Button>
      <ActionsMenu />
    </header>
  );
}
