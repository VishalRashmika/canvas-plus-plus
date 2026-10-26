/**
 * Typography Scale & Token System (F-035).
 * Enforces consistent type scale across all UML diagrams and theme parity with Obsidian.
 */

export interface TextStyleToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: number | string;
  fontStyle?: "normal" | "italic";
  fontFamilyVar: string;
  className: string;
}

export const TypographyScale: Record<string, TextStyleToken> = {
  title: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: 600,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-node-title",
  },
  classTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: 700,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-class-title",
  },
  objectTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: 600,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-object-title",
  },
  stereotype: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: 500,
    fontStyle: "italic",
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-node-stereotype",
  },
  taggedValues: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: 400,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-node-tagged-values",
  },
  compartmentTitle: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: 600,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-compartment-title",
  },
  compartmentItem: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: 400,
    fontFamilyVar: "var(--font-monospace, monospace)",
    className: "umlcanvas-compartment-item",
  },
  edgeLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 500,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-edge-label",
  },
  multiplicity: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: 500,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-edge-multiplicity",
  },
  portLabel: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: 500,
    fontFamilyVar: "var(--font-monospace, monospace)",
    className: "umlcanvas-port-label",
  },
  groupTitle: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 600,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-group-title",
  },
  actorLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: 600,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-actor-label",
  },
  useCaseTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: 600,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-usecase-title",
  },
  noteText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: 400,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-note-text",
  },
};

import { DiagramNode } from "../../domain/entities/DiagramNode";
import { DiagramEdge } from "../../domain/entities/DiagramEdge";
import { Group } from "../../domain/entities/Group";

export interface FontStyleConfig {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  fontWeight?: string | number;
  fontStyle?: "normal" | "italic";
  fontFamily?: string;
}

export interface FontSizePreset {
  id: string;
  label: string;
  size: number;
}

export const FONT_SIZE_PRESETS: FontSizePreset[] = [
  { id: "small", label: "Small", size: 10 },
  { id: "normal", label: "Normal", size: 13 },
  { id: "medium", label: "Medium", size: 16 },
  { id: "large", label: "Large", size: 20 },
  { id: "xlarge", label: "Extra Large", size: 28 },
  { id: "huge", label: "Huge", size: 36 },
];

export const STANDARD_FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

export function getNextFontSize(currentSize: number, direction: 1 | -1): number {
  if (direction > 0) {
    const next = STANDARD_FONT_SIZES.find((s) => s > currentSize);
    return next ?? Math.min(72, currentSize + 2);
  } else {
    const prevs = STANDARD_FONT_SIZES.filter((s) => s < currentSize);
    return prevs.length > 0 ? prevs[prevs.length - 1] : Math.max(8, currentSize - 2);
  }
}

export interface FontFamilyPreset {
  id: string;
  label: string;
  fontFamily: string;
}

export const FONT_FAMILY_PRESETS: FontFamilyPreset[] = [
  { id: "sans", label: "Sans (Default)", fontFamily: "var(--font-text, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)" },
  { id: "mono", label: "Mono (Code)", fontFamily: "var(--font-monospace, monospace)" },
  { id: "handwritten", label: "Handwritten", fontFamily: "Virgil, 'Comic Sans MS', cursive, sans-serif" },
  { id: "serif", label: "Serif", fontFamily: "Georgia, 'Times New Roman', serif" },
];

export function getNodeFontStyle(node: DiagramNode): FontStyleConfig {
  const nodeStyle = node.style;
  const labelStyle = node.labels && node.labels[0]?.style;

  const fontSize = nodeStyle?.fontSize ?? labelStyle?.fontSize;

  let bold: boolean | undefined = undefined;
  if (nodeStyle?.bold !== undefined) {
    bold = nodeStyle.bold;
  } else if (labelStyle?.bold !== undefined) {
    bold = labelStyle.bold;
  } else if (nodeStyle?.fontWeight !== undefined) {
    bold = nodeStyle.fontWeight === "bold" || nodeStyle.fontWeight === 700;
  } else if (labelStyle?.fontWeight !== undefined) {
    bold = labelStyle.fontWeight === "bold" || labelStyle.fontWeight === 700;
  }

  let italic: boolean | undefined = undefined;
  if (nodeStyle?.italic !== undefined) {
    italic = nodeStyle.italic;
  } else if (labelStyle?.italic !== undefined) {
    italic = labelStyle.italic;
  } else if (nodeStyle?.fontStyle !== undefined) {
    italic = nodeStyle.fontStyle === "italic";
  } else if (labelStyle?.fontStyle !== undefined) {
    italic = labelStyle.fontStyle === "italic";
  }

  const fontWeight =
    bold !== undefined
      ? bold
        ? "bold"
        : "normal"
      : nodeStyle?.fontWeight ?? labelStyle?.fontWeight;

  const fontStyle =
    italic !== undefined
      ? italic
        ? "italic"
        : "normal"
      : nodeStyle?.fontStyle ?? labelStyle?.fontStyle;

  const fontFamily = nodeStyle?.fontFamily ?? labelStyle?.fontFamily;

  return { fontSize, bold, italic, fontWeight, fontStyle, fontFamily };
}

export function getEdgeFontStyle(edge: DiagramEdge): FontStyleConfig {
  const edgeStyle = edge.style;
  const labelStyle = edge.labels && edge.labels[0]?.style;

  const fontSize = edgeStyle?.fontSize ?? labelStyle?.fontSize;

  let bold: boolean | undefined = undefined;
  if (edgeStyle?.bold !== undefined) {
    bold = edgeStyle.bold;
  } else if (labelStyle?.bold !== undefined) {
    bold = labelStyle.bold;
  } else if (edgeStyle?.fontWeight !== undefined) {
    bold = edgeStyle.fontWeight === "bold" || edgeStyle.fontWeight === 700;
  } else if (labelStyle?.fontWeight !== undefined) {
    bold = labelStyle.fontWeight === "bold" || labelStyle.fontWeight === 700;
  }

  let italic: boolean | undefined = undefined;
  if (edgeStyle?.italic !== undefined) {
    italic = edgeStyle.italic;
  } else if (labelStyle?.italic !== undefined) {
    italic = labelStyle.italic;
  } else if (edgeStyle?.fontStyle !== undefined) {
    italic = edgeStyle.fontStyle === "italic";
  } else if (labelStyle?.fontStyle !== undefined) {
    italic = labelStyle.fontStyle === "italic";
  }

  const fontWeight =
    bold !== undefined
      ? bold
        ? "bold"
        : "normal"
      : edgeStyle?.fontWeight ?? labelStyle?.fontWeight;

  const fontStyle =
    italic !== undefined
      ? italic
        ? "italic"
        : "normal"
      : edgeStyle?.fontStyle ?? labelStyle?.fontStyle;

  const fontFamily = edgeStyle?.fontFamily ?? labelStyle?.fontFamily;

  return { fontSize, bold, italic, fontWeight, fontStyle, fontFamily };
}

export function getGroupFontStyle(group: Group): FontStyleConfig {
  const g = group as any;
  const groupStyle = g.style;

  const fontSize = g.fontSize ?? groupStyle?.fontSize;

  let bold: boolean | undefined = undefined;
  if (g.bold !== undefined) {
    bold = g.bold;
  } else if (groupStyle?.bold !== undefined) {
    bold = groupStyle.bold;
  } else if (g.fontWeight !== undefined) {
    bold = g.fontWeight === "bold" || g.fontWeight === 700;
  } else if (groupStyle?.fontWeight !== undefined) {
    bold = groupStyle.fontWeight === "bold" || groupStyle.fontWeight === 700;
  }

  let italic: boolean | undefined = undefined;
  if (g.italic !== undefined) {
    italic = g.italic;
  } else if (groupStyle?.italic !== undefined) {
    italic = groupStyle.italic;
  } else if (g.fontStyle !== undefined) {
    italic = g.fontStyle === "italic";
  } else if (groupStyle?.fontStyle !== undefined) {
    italic = groupStyle.fontStyle === "italic";
  }

  const fontWeight =
    bold !== undefined
      ? bold
        ? "bold"
        : "normal"
      : g.fontWeight ?? groupStyle?.fontWeight;

  const fontStyle =
    italic !== undefined
      ? italic
        ? "italic"
        : "normal"
      : g.fontStyle ?? groupStyle?.fontStyle;

  const fontFamily = g.fontFamily ?? groupStyle?.fontFamily;

  return { fontSize, bold, italic, fontWeight, fontStyle, fontFamily };
}

export function applyFontToSvgElement(
  el: SVGElement,
  style?: FontStyleConfig | null
): void {
  if (!el || !style) return;

  if (style.fontSize !== undefined) {
    el.setAttribute("font-size", String(style.fontSize));
    if ((el as any).style) {
      if (typeof (el as any).style.setProperty === "function") {
        (el as any).style.setProperty("font-size", `${style.fontSize}px`, "important");
      }
      (el as any).style.fontSize = `${style.fontSize}px`;
    }
  }

  if (style.fontFamily !== undefined) {
    el.setAttribute("font-family", style.fontFamily);
    if ((el as any).style) {
      if (typeof (el as any).style.setProperty === "function") {
        (el as any).style.setProperty("font-family", style.fontFamily, "important");
      }
      (el as any).style.fontFamily = style.fontFamily;
    }
  }

  if (style.bold === true) {
    el.setAttribute("font-weight", "bold");
    if ((el as any).style) {
      if (typeof (el as any).style.setProperty === "function") {
        (el as any).style.setProperty("font-weight", "bold", "important");
      }
      (el as any).style.fontWeight = "bold";
    }
    el.classList.add("umlcanvas-bold");
    el.classList.remove("umlcanvas-not-bold");
  } else if (style.bold === false) {
    el.setAttribute("font-weight", "normal");
    if ((el as any).style) {
      if (typeof (el as any).style.setProperty === "function") {
        (el as any).style.setProperty("font-weight", "normal", "important");
      }
      (el as any).style.fontWeight = "normal";
    }
    el.classList.add("umlcanvas-not-bold");
    el.classList.remove("umlcanvas-bold");
  } else if (style.fontWeight !== undefined) {
    el.setAttribute("font-weight", String(style.fontWeight));
    if ((el as any).style) {
      if (typeof (el as any).style.setProperty === "function") {
        (el as any).style.setProperty("font-weight", String(style.fontWeight), "important");
      }
      (el as any).style.fontWeight = String(style.fontWeight);
    }
  }

  if (style.italic === true) {
    el.setAttribute("font-style", "italic");
    if ((el as any).style) {
      if (typeof (el as any).style.setProperty === "function") {
        (el as any).style.setProperty("font-style", "italic", "important");
      }
      (el as any).style.fontStyle = "italic";
    }
    el.classList.add("umlcanvas-italic");
    el.classList.remove("umlcanvas-not-italic");
  } else if (style.italic === false) {
    el.setAttribute("font-style", "normal");
    if ((el as any).style) {
      if (typeof (el as any).style.setProperty === "function") {
        (el as any).style.setProperty("font-style", "normal", "important");
      }
      (el as any).style.fontStyle = "normal";
    }
    el.classList.add("umlcanvas-not-italic");
    el.classList.remove("umlcanvas-italic");
  } else if (style.fontStyle !== undefined) {
    el.setAttribute("font-style", style.fontStyle);
    if ((el as any).style) {
      if (typeof (el as any).style.setProperty === "function") {
        (el as any).style.setProperty("font-style", style.fontStyle, "important");
      }
      (el as any).style.fontStyle = style.fontStyle;
    }
  }
}

export const TYPOGRAPHY = TypographyScale;
