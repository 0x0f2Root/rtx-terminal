import { eventToAccelerator } from '@/lib/accelerator';
import { appData } from '@/state/app-data';
import { isOverlayOpen } from '@/state/ui';
import { ACTIONS, ACTIONS_BY_ID, insertCommand, shortcutFor } from './actions';

/**
 * The single keyboard listener for app shortcuts. It runs in the capture phase on window, so a
 * matched shortcut never reaches xterm (and therefore never reaches the shell). Unmatched keys
 * pass through untouched.
 */

type Binding = { kind: 'action'; id: string } | { kind: 'command'; id: string };

let cache: {
  shortcuts: unknown;
  commands: unknown;
  map: Map<string, Binding>;
} | null = null;

export function bindingMap(): Map<string, Binding> {
  const { preferences, commands } = appData.get();
  if (
    cache &&
    cache.shortcuts === preferences.shortcuts &&
    cache.commands === commands.commands
  )
    return cache.map;
  const map = new Map<string, Binding>();
  for (const action of ACTIONS) {
    const accelerator = shortcutFor(action.id, preferences.shortcuts);
    if (accelerator) map.set(accelerator, { kind: 'action', id: action.id });
  }
  // App actions win over saved-command shortcuts when both use the same keys.
  for (const command of commands.commands) {
    if (command.shortcut && !map.has(command.shortcut))
      map.set(command.shortcut, { kind: 'command', id: command.id });
  }
  cache = {
    shortcuts: preferences.shortcuts,
    commands: commands.commands,
    map,
  };
  return map;
}

/** Which action or command already uses `accelerator`, other than `exceptId`. */
export function bindingOwner(
  accelerator: string,
  exceptId?: string,
): string | null {
  const binding = bindingMap().get(accelerator);
  if (!binding || binding.id === exceptId) return null;
  if (binding.kind === 'action')
    return ACTIONS_BY_ID.get(binding.id)?.title ?? binding.id;
  return (
    appData.get().commands.commands.find((c) => c.id === binding.id)?.name ??
    'a saved command'
  );
}

let suspended = 0;

/** Lets a shortcut recorder receive raw key presses. Returns the function that resumes. */
export function suspendShortcuts(): () => void {
  suspended++;
  return () => {
    suspended = Math.max(0, suspended - 1);
  };
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.classList.contains('xterm-helper-textarea')) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export function installShortcuts(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (suspended > 0 || event.isComposing) return;
    const accelerator = eventToAccelerator(event);
    if (!accelerator) return;
    const binding = bindingMap().get(accelerator);
    if (!binding) return;

    const inTextField = isTextField(event.target);
    if (binding.kind === 'action') {
      const action = ACTIONS_BY_ID.get(binding.id);
      if (!action) return;
      // Terminal actions (copy, paste, find) must not hijack a text field or act behind a dialog.
      if (action.scope === 'terminal' && (inTextField || isOverlayOpen()))
        return;
      event.preventDefault();
      event.stopPropagation();
      // Holding a key repeats only harmless navigation, never opening tabs or panes.
      if (
        event.repeat &&
        !['tab.next', 'tab.previous', 'pane.next', 'pane.previous'].includes(
          action.id,
        )
      )
        return;
      action.run();
      return;
    }
    if (inTextField || isOverlayOpen()) return;
    const command = appData
      .get()
      .commands.commands.find((c) => c.id === binding.id);
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    // Saved-command shortcuts insert without running, so a keystroke can never execute anything.
    insertCommand(command.command);
  };
  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}
