import { IconTile } from '@/components/reui/icon-tile';
import { useEffect, useLayoutEffect } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CommandEditorDialog } from '@/features/commands/CommandEditorDialog';
import { CommandsDialog } from '@/features/commands/CommandsDialog';
import { ConfirmRunDialog } from '@/features/commands/ConfirmRunDialog';
import { HistoryDialog } from '@/features/history/HistoryDialog';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { CredentialDialog } from '@/features/ssh/CredentialDialog';
import { HostEditorDialog } from '@/features/ssh/HostEditorDialog';
import { HostKeyDialog } from '@/features/ssh/HostKeyDialog';
import { HostsDialog } from '@/features/ssh/HostsDialog';
import { installSshListeners } from '@/features/ssh/ssh-prompts';
import { AboutDialog } from '@/features/shell/AboutDialog';
import { AppMenuBar } from '@/features/shell/AppMenuBar';
import { installShortcuts } from '@/features/shortcuts';
import { AppHeader } from '@/features/shell/AppHeader';
import { AppSidebar } from '@/features/shell/AppSidebar';
import { RenameTabDialog } from '@/features/shell/RenameTabDialog';
import { StatusBar } from '@/features/shell/StatusBar';
import { installTerminalRouting } from '@/features/terminal/registry';
import { Workspace } from '@/features/workspace/Workspace';
import {
  appData,
  loadAppData,
  updatePreferences,
  useAppData,
} from '@/state/app-data';
import { openTab, workspace } from '@/state/workspace';

let started = false;

/** Loads persisted state once, then opens the first terminal. Safe under StrictMode's double effects. */
async function startApp(): Promise<void> {
  if (started) return;
  started = true;
  await loadAppData();
  if (appData.get().status === 'ready' && workspace.get().tabs.length === 0)
    openTab();
}

function MainRegion() {
  const status = useAppData((s) => s.status);
  const error = useAppData((s) => s.error);
  if (status === 'loading') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 bg-workspace text-sm text-muted-foreground">
        <Spinner />
        Loading settings
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-workspace">
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <IconTile variant="elevated" size="lg" aria-hidden="true">
                <TriangleAlert />
              </IconTile>
            </EmptyMedia>
            <EmptyTitle>Settings could not be loaded</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              type="button"
              onClick={() => {
                started = false;
                void startApp();
              }}
            >
              <RotateCw data-icon="inline-start" />
              Retry
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }
  return <Workspace />;
}

function App() {
  const sidebarOpen = useAppData((s) => s.preferences.ui.sidebarOpen);
  const appTheme = useAppData((s) => s.preferences.ui.theme);
  const glass = useAppData((s) => s.preferences.glass);
  const glassWallpaperUrl = useAppData((s) => s.glassWallpaperUrl);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.appTheme = appTheme;
    root.classList.toggle('dark', appTheme !== 'light');
    if (appTheme !== 'glass') return;

    const tintChannels = {
      black: ['0.11', '0', '0'],
      neutral: ['0.2', '0', '0'],
      warm: ['0.24', '0.022', '38'],
    }[glass.tint];
    root.style.setProperty('--glass-blur', `${glass.blur}px`);
    root.style.setProperty(
      '--glass-panel-opacity',
      String(1 - glass.transparency / 100),
    );
    root.style.setProperty(
      '--glass-image-dimming',
      String(glass.dimming / 100),
    );
    root.style.setProperty('--glass-tint-lightness', tintChannels[0]);
    root.style.setProperty('--glass-tint-chroma', tintChannels[1]);
    root.style.setProperty('--glass-tint-hue', tintChannels[2]);
    if (glassWallpaperUrl) {
      root.style.setProperty(
        '--glass-wallpaper',
        `url("${glassWallpaperUrl}")`,
      );
    } else {
      root.style.removeProperty('--glass-wallpaper');
    }
  }, [appTheme, glass, glassWallpaperUrl]);

  useEffect(() => {
    const stopRouting = installTerminalRouting();
    const stopShortcuts = installShortcuts();
    const stopSsh = installSshListeners();
    void startApp();
    return () => {
      stopRouting();
      stopShortcuts();
      stopSsh();
    };
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-svh min-h-0 flex-col">
        <AppMenuBar />
        <SidebarProvider
          open={sidebarOpen}
          onOpenChange={(open) =>
            updatePreferences((p) => ({
              ...p,
              ui: { ...p.ui, sidebarOpen: open },
            }))
          }
          className="min-h-0 flex-1"
        >
          <AppSidebar />
          {/* The tab bar and status bar share the sidebar colour in the dark themes, so the
              inset card gets the hairline the primitive gives its floating variant. */}
          <SidebarInset className="flex min-h-0 min-w-0 flex-col overflow-hidden md:peer-data-[variant=inset]:ring-1 md:peer-data-[variant=inset]:ring-sidebar-border">
            <AppHeader />
            <MainRegion />
            <StatusBar />
          </SidebarInset>
        </SidebarProvider>
      </div>
      <CommandPalette />
      <CommandsDialog />
      <CommandEditorDialog />
      <ConfirmRunDialog />
      <HistoryDialog />
      <SettingsDialog />
      <AboutDialog />
      <RenameTabDialog />
      <HostsDialog />
      <HostEditorDialog />
      <CredentialDialog />
      <HostKeyDialog />
      <Toaster
        theme={appTheme === 'light' ? 'light' : 'dark'}
        position="bottom-right"
      />
    </TooltipProvider>
  );
}

export default App;
