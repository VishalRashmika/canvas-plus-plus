export type CanvasColorPresetId = "1" | "2" | "3" | "4" | "5" | "6";

export interface CanvasColorPreset {
  id: CanvasColorPresetId;
  label: string;
  hex: string;
  cssVar: string;
}

export const CANVAS_LIGHT_COLOR_PRESETS: Record<CanvasColorPresetId, string> = {
  "1": "#ff758f", // Light Coral Rose
  "2": "#ffa94d", // Light Peach Orange
  "3": "#ffd43b", // Light Butter Yellow
  "4": "#69db7c", // Light Mint Green
  "5": "#38d9a9", // Light Ocean Teal / Sky
  "6": "#b197fc", // Light Lavender Violet
};

export const CANVAS_DARK_COLOR_PRESETS: Record<CanvasColorPresetId, string> = {
  "1": "#ff859b", // Light Luminous Coral
  "2": "#ffb366", // Light Luminous Peach
  "3": "#ffe066", // Light Luminous Yellow
  "4": "#7ee787", // Light Luminous Mint
  "5": "#67e8f9", // Light Luminous Cyan
  "6": "#c4a5ff", // Light Luminous Lavender
};

/**
 * Obsidian Canvas 6 native color presets (1-6) plus custom hex strings.
 * Mapped to native Obsidian Canvas CSS variables: --canvas-color-1 through --canvas-color-6.
 */
export const CANVAS_COLOR_PRESETS: CanvasColorPreset[] = [
  { id: "1", label: "Red", hex: "#ff758f", cssVar: "var(--canvas-color-1, #ff758f)" },
  { id: "2", label: "Orange", hex: "#ffa94d", cssVar: "var(--canvas-color-2, #ffa94d)" },
  { id: "3", label: "Yellow", hex: "#ffd43b", cssVar: "var(--canvas-color-3, #ffd43b)" },
  { id: "4", label: "Green", hex: "#69db7c", cssVar: "var(--canvas-color-4, #69db7c)" },
  { id: "5", label: "Cyan", hex: "#38d9a9", cssVar: "var(--canvas-color-5, #38d9a9)" },
  { id: "6", label: "Purple", hex: "#b197fc", cssVar: "var(--canvas-color-6, #b197fc)" },
];

export function isCanvasColorPreset(color?: string): color is CanvasColorPresetId {
  return color === "1" || color === "2" || color === "3" || color === "4" || color === "5" || color === "6";
}

/**
 * Resolves a canvas color to a CSS-ready string (e.g. var(--canvas-color-1, #fb464c) or hex).
 */
export function resolveCanvasColor(color?: string): string | undefined {
  if (!color) return undefined;
  const preset = CANVAS_COLOR_PRESETS.find((p) => p.id === color);
  if (preset) return preset.cssVar;
  return color;
}

/**
 * Resolves a canvas color to a concrete hex string for SVG exports or canvas contexts.
 * Can adapt to light or dark theme if specified (defaults to dark preset fallback).
 */
export function resolveCanvasColorHex(color?: string, theme?: "light" | "dark"): string | undefined {
  if (!color) return undefined;
  if (isCanvasColorPreset(color)) {
    if (theme === "light") {
      return CANVAS_LIGHT_COLOR_PRESETS[color];
    }
    return CANVAS_DARK_COLOR_PRESETS[color];
  }
  return color;
}

/**
 * Resolves a translucent tinted background fill for shapes or group boxes.
 */
export function resolveCanvasBgColor(color?: string, opacity = 0.1, theme?: "light" | "dark"): string | undefined {
  const hex = resolveCanvasColorHex(color, theme);
  if (!hex) return undefined;

  // If hex is #rrggbb or #rgb, convert to rgba
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i) ||
    hex.match(/^#?([a-f\d])([a-f\d])([a-f\d])$/i);

  if (match) {
    const r = match[1].length === 1 ? parseInt(match[1] + match[1], 16) : parseInt(match[1], 16);
    const g = match[2].length === 1 ? parseInt(match[2] + match[2], 16) : parseInt(match[2], 16);
    const b = match[3].length === 1 ? parseInt(match[3] + match[3], 16) : parseInt(match[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  return hex;
}
