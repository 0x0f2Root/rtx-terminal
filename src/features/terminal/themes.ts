import type { ITheme } from '@xterm/xterm';
import { hexToRgb, luminance } from '@/lib/color';
import type { AppThemeId } from '@/shared/config';

export type TerminalTheme = { id: string; name: string; colors: ITheme };

/** Terminal palettes. The pane behind xterm uses `colors.background`, so each theme fills its pane. */
export const TERMINAL_THEMES: TerminalTheme[] = [
  {
    id: 'rtx-light',
    name: 'rtx Light',
    colors: {
      background: '#f5f5f4',
      foreground: '#292524',
      cursor: '#2563eb',
      cursorAccent: '#f5f5f4',
      selectionBackground: '#2563eb35',
      selectionInactiveBackground: '#2563eb20',
      black: '#292524',
      red: '#b42318',
      green: '#16794b',
      yellow: '#8a5b00',
      blue: '#245bb2',
      magenta: '#9340a5',
      cyan: '#087e8b',
      white: '#e7e5e4',
      brightBlack: '#78716c',
      brightRed: '#d92d20',
      brightGreen: '#16834f',
      brightYellow: '#a06a00',
      brightBlue: '#2563eb',
      brightMagenta: '#a14cb5',
      brightCyan: '#0b8794',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'rtx-dark',
    name: 'rtx Dark',
    colors: {
      background: '#0c0d10',
      foreground: '#d7dae0',
      cursor: '#6ea8ff',
      cursorAccent: '#0c0d10',
      selectionBackground: '#6ea8ff40',
      selectionInactiveBackground: '#6ea8ff24',
      black: '#1b1d23',
      red: '#f2777a',
      green: '#8fd18a',
      yellow: '#e6c07b',
      blue: '#6ea8ff',
      magenta: '#c49cf0',
      cyan: '#5fc9d6',
      white: '#c8ccd4',
      brightBlack: '#5c6370',
      brightRed: '#ff8f92',
      brightGreen: '#a8e3a3',
      brightYellow: '#f2d394',
      brightBlue: '#8cbcff',
      brightMagenta: '#d6b4ff',
      brightCyan: '#7fdbe6',
      brightWhite: '#f0f2f5',
    },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    colors: {
      background: '#151515',
      foreground: '#d4d4d4',
      cursor: '#e5e5e5',
      cursorAccent: '#151515',
      selectionBackground: '#ffffff30',
      black: '#262626',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#d7ba7d',
      blue: '#7aa2d6',
      magenta: '#b48ead',
      cyan: '#79b8b8',
      white: '#c4c4c4',
      brightBlack: '#6b6b6b',
      brightRed: '#f08a92',
      brightGreen: '#b0d898',
      brightYellow: '#e8cf9a',
      brightBlue: '#9bbbe6',
      brightMagenta: '#cba6c4',
      brightCyan: '#9ad0d0',
      brightWhite: '#f5f5f5',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    colors: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      cursorAccent: '#1a1b26',
      selectionBackground: '#33467c',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    colors: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      cursorAccent: '#2e3440',
      selectionBackground: '#434c5ecc',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    colors: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#93a1a1',
      cursorAccent: '#002b36',
      selectionBackground: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3',
    },
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    colors: {
      background: '#282828',
      foreground: '#ebdbb2',
      cursor: '#ebdbb2',
      cursorAccent: '#282828',
      selectionBackground: '#504945',
      black: '#282828',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2',
    },
  },
];

export function terminalTheme(id: string): TerminalTheme {
  return TERMINAL_THEMES.find((theme) => theme.id === id) ?? TERMINAL_THEMES[0];
}

/** Full Black enforces a black xterm surface while keeping a readable terminal palette. */
export function terminalColors(themeId: string, appTheme: AppThemeId): ITheme {
  const selected = terminalTheme(themeId).colors;
  if (appTheme === 'glass')
    return { ...selected, background: 'rgba(0, 0, 0, 0)' };
  if (appTheme !== 'full-black') return selected;

  const foreground = hexToRgb(selected.foreground ?? '');
  const contrastPalette =
    foreground && luminance(foreground) > 0.55
      ? selected
      : terminalTheme('rtx-dark').colors;

  return {
    ...contrastPalette,
    background: '#000000',
    cursorAccent: '#000000',
    black: '#2a2a2a',
    brightBlack: '#777777',
  };
}

/** Monospace families the app ships or that are common on Linux; any installed family can be typed. */
export const FONT_FAMILIES = [
  'JetBrains Mono Variable',
  'Geist Mono Variable',
  'JetBrainsMono Nerd Font',
  'FiraCode Nerd Font',
  'DejaVu Sans Mono',
  'Noto Sans Mono',
  'Ubuntu Mono',
  'Fira Code',
  'Hack',
  'monospace',
];
