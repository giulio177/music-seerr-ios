import { create } from 'zustand';

/** Accent presets shared with the web app (`ACCENT_PRESETS` in the backend's index.html). */
export const ACCENT_PRESETS: Record<string, { accent: string; accent2: string; soft: string }> = {
  pink: { accent: '#f94c84', accent2: '#b23afc', soft: '#f9a8d4' },
  violet: { accent: '#8b5cf6', accent2: '#4f46e5', soft: '#c4b5fd' },
  blue: { accent: '#3b82f6', accent2: '#06b6d4', soft: '#93c5fd' },
  teal: { accent: '#14b8a6', accent2: '#0ea5e9', soft: '#99f6e4' },
  green: { accent: '#22c55e', accent2: '#14b8a6', soft: '#86efac' },
  orange: { accent: '#f97316', accent2: '#ef4444', soft: '#fdba74' },
  gold: { accent: '#eab308', accent2: '#f97316', soft: '#fde68a' },
  red: { accent: '#ef4444', accent2: '#db2777', soft: '#fca5a5' },
};

export const colors = {
  bg: '#09090d',
  surface: 'rgba(20, 20, 28, 0.72)',
  glassBorder: 'rgba(255, 255, 255, 0.09)',
  glassFill: 'rgba(255, 255, 255, 0.045)',
  hairline: 'rgba(255, 255, 255, 0.08)',
  text: '#f5f5f7',
  textSecondary: '#a1a1aa',
  textTertiary: '#9d9da8',
  success: '#4ade80',
  warning: '#fbbf24',
  danger: '#f87171',
  info: '#7dd3fc',
};

export const radius = { card: 16, cover: 10, pill: 999 };

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** A custom `#rrggbb` accent gets a partner hue and a light tint, like the web app. */
function deriveAccent(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  return {
    accent: hex,
    accent2: rgbToHex(b * 0.6 + r * 0.4, r * 0.3 + g * 0.3, g * 0.4 + b * 0.8),
    soft: rgbToHex(r + (255 - r) * 0.55, g + (255 - g) * 0.55, b + (255 - b) * 0.55),
  };
}

export function resolveAccent(value?: string | null) {
  if (value && ACCENT_PRESETS[value]) return ACCENT_PRESETS[value];
  if (value && /^#[0-9a-fA-F]{6}$/.test(value)) return deriveAccent(value.toLowerCase());
  return ACCENT_PRESETS.pink;
}

export function withAlpha(hex: string, alpha: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type AccentState = ReturnType<typeof resolveAccent> & { setAccent: (value?: string | null) => void };

export const useAccent = create<AccentState>((set) => ({
  ...ACCENT_PRESETS.pink,
  setAccent: (value) => set(resolveAccent(value)),
}));
