/**
 * Accelerators are strings such as "Ctrl+Shift+T": modifiers in the order Ctrl, Shift, Alt, Meta,
 * then one key named from KeyboardEvent.code so they work the same on every keyboard layout.
 */

const NAMED_CODES: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Equal: '=',
  Minus: '-',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Escape',
  Space: 'Space',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End',
  Delete: 'Delete',
  Backspace: 'Backspace',
};

function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return NAMED_CODES[code] ?? null;
}

export function eventToAccelerator(event: KeyboardEvent): string | null {
  const key = keyFromCode(event.code);
  if (!key) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  if (event.metaKey) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}

const KEY_LABELS: Record<string, string> = {
  Meta: 'Super',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Backspace: '⌫',
};

/** The keys of an accelerator as they should be printed, one label per key cap. */
export function acceleratorKeys(accelerator: string): string[] {
  return accelerator.split(/\+(?!$)/).map((part) => KEY_LABELS[part] ?? part);
}

/**
 * Why an accelerator is unsuitable as an app shortcut, or null when it is fine. Keys the shell
 * relies on must reach the terminal: plain keys, Shift+key and Ctrl+letter (control characters).
 */
export function shortcutConflict(accelerator: string): string | null {
  const parts = accelerator.split(/\+(?!$)/);
  const key = parts.at(-1) ?? '';
  const mods = new Set(parts.slice(0, -1));
  const isFunctionKey = /^F\d+$/.test(key);
  if (mods.size === 0 && !isFunctionKey)
    return 'A key without modifiers is typed into the terminal.';
  if (mods.size === 1 && mods.has('Shift') && !isFunctionKey)
    return 'Shift alone produces a typed character.';
  if (mods.size === 1 && mods.has('Ctrl') && /^[A-Z[\]\\]$/.test(key)) {
    return `Ctrl+${key} sends a control character the shell uses. Add Shift or Alt.`;
  }
  if (mods.size === 1 && mods.has('Alt') && /^[A-Z.]$/.test(key)) {
    return `Alt+${key} is a readline editing key. Add Ctrl or Shift.`;
  }
  return null;
}
