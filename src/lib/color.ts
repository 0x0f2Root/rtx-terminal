/** Tab colors and the contrast math for raised, colored surfaces (after Obsidian UI's colorUtils). */

export type Rgb = { r: number; g: number; b: number };

export const TAB_COLORS = [
  { name: 'Red', value: '#e5484d' },
  { name: 'Orange', value: '#f76b15' },
  { name: 'Amber', value: '#ffb224' },
  { name: 'Green', value: '#30a46c' },
  { name: 'Teal', value: '#12a594' },
  { name: 'Blue', value: '#3e63dd' },
  { name: 'Violet', value: '#8e4ec6' },
  { name: 'Pink', value: '#d6409f' },
] as const;

const HEX = /^#([0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

export function hexToRgb(hex: string): Rgb | null {
  const match = HEX.exec(hex);
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function rgba({ r, g, b }: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** CSS variables a colored tab reads: fill, readable text, tinted border and glow. */
export function tabColorVars(hex: string): Record<string, string> | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return {
    '--tab-bg': hex,
    '--tab-fg': luminance(rgb) > 0.45 ? '#0b0b0c' : '#ffffff',
    '--tab-border': rgba(rgb, 0.5),
    '--tab-glow': rgba(rgb, 0.35),
    '--tab-tint': rgba(rgb, 0.2),
    '--tab-tint-border': rgba(rgb, 0.35),
  };
}
