import { appData } from '@/state/app-data';
import { TerminalController, type SessionSink } from './terminal-controller';

/**
 * Terminal controllers by pane, and the routing from PTY sessions to them. This is the only
 * place that subscribes to terminal output, so a pane never misses data while React re-renders.
 */
const controllers = new Map<string, TerminalController>();
const bySession = new Map<string, TerminalController>();

const sink: SessionSink = {
  bind: (sessionId, controller) => bySession.set(sessionId, controller),
  unbind: (sessionId) => bySession.delete(sessionId),
};

let installed = false;

export function installTerminalRouting(): () => void {
  if (installed) return () => undefined;
  installed = true;
  const offData = window.rtx.terminal.onData((sessionId, data) => {
    const controller = bySession.get(sessionId);
    if (controller) controller.receive(data);
    // Output for a pane that is gone still counts toward flow control.
    else window.rtx.terminal.ack(sessionId, data.length);
  });
  const offExit = window.rtx.terminal.onExit((sessionId, exit) =>
    bySession.get(sessionId)?.handleExit(exit),
  );
  // SSH progress is keyed by the attempt's request id, which only one pane holds at a time.
  const offProgress = window.rtx.ssh.onProgress((requestId, state) => {
    for (const controller of controllers.values()) {
      if (controller.pendingRequest === requestId)
        controller.onSshProgress(state);
    }
  });
  let applied = appData.get().preferences.terminal;
  let appliedAppTheme = appData.get().preferences.ui.theme;
  const offPrefs = appData.subscribe(() => {
    const preferences = appData.get().preferences;
    const next = preferences.terminal;
    const nextAppTheme = preferences.ui.theme;
    if (next === applied && nextAppTheme === appliedAppTheme) return;
    applied = next;
    appliedAppTheme = nextAppTheme;
    for (const controller of controllers.values())
      controller.applyPreferences(next, nextAppTheme);
  });
  return () => {
    offData();
    offExit();
    offProgress();
    offPrefs();
    installed = false;
  };
}

export function getController(paneId: string): TerminalController | undefined {
  return controllers.get(paneId);
}

export function ensureController(paneId: string): TerminalController {
  let controller = controllers.get(paneId);
  if (!controller) {
    controller = new TerminalController(paneId, sink);
    controllers.set(paneId, controller);
  }
  return controller;
}

/** Ends the pane's session and frees its terminal. */
export function disposeController(paneId: string): void {
  controllers.get(paneId)?.dispose();
  controllers.delete(paneId);
}

// Development only: this module holds live terminals, which hot replacement cannot carry over.
// Reload the page instead; the main process ends the old sessions when the page navigates.
if (import.meta.hot) import.meta.hot.dispose(() => window.location.reload());
