import { DiagramNode } from "../entities/DiagramNode";
import { Size } from "../value-objects/Rect";

/**
 * Pure calculation of required node dimensions to comfortably fit its text,
 * stereotypes, tagged values, and compartments (F-036).
 */
export function calculateNodeFitSize(node: DiagramNode): Size {
  const kind = node.kind;

  if (kind === "uml.actor") {
    const labelText = node.labels[0]?.text ?? "";
    const textWidth = Math.ceil(labelText.length * 8 + 24);
    return {
      width: Math.max(60, textWidth),
      height: 90,
    };
  }

  if (kind === "uml.usecase") {
    const labelText = node.labels[0]?.text ?? "";
    const lines = labelText.split("\n");
    const maxLineChars = lines.reduce((max, l) => Math.max(max, l.length), 0);
    // Ellipses require wider padding to prevent text intersecting rounded borders
    const textWidth = Math.ceil(maxLineChars * 8.5);
    const textHeight = Math.ceil(lines.length * 20);

    const neededWidth = Math.max(130, Math.ceil(textWidth * 1.35 + 30));
    const neededHeight = Math.max(65, Math.ceil(textHeight + 36));

    return {
      width: neededWidth,
      height: neededHeight,
    };
  }

  if (kind === "uml.systemBoundary") {
    // System boundaries are containers, retain existing or default large size
    return {
      width: Math.max(node.size.width, 300),
      height: Math.max(node.size.height, 200),
    };
  }

  if (kind === "generic.stickyNote") {
    const titleText = node.labels[0]?.text ?? "";
    const lines = titleText.split("\n");
    const maxChars = lines.reduce((m, l) => Math.max(m, l.length), 0);
    const contentW = Math.max(140, maxChars * 8.5 + 32);
    const contentH = Math.max(100, 32 + lines.length * 20 + 16);
    return {
      width: Math.max(node.size.width, contentW),
      height: Math.max(node.size.height, contentH),
    };
  }

  if (kind === "generic.image") {
    const titleText = node.labels[0]?.text ?? "";
    const minW = Math.max(160, titleText.length * 8.5 + 32);
    return {
      width: Math.max(node.size.width, minW),
      height: node.size.height,
    };
  }

  if (kind === "obsidian.note") {
    const content =
      (node.customData?.content as string) ||
      (node.customData?.snippet as string) ||
      "";
    const headerH = 32;
    const padding = 28;
    if (!content) {
      return {
        width: Math.max(node.size.width, 340),
        height: Math.max(node.size.height, 240),
      };
    }
    const clean = content.replace(/^---[\s\S]*?---\r?\n?/, "").trim();
    const lines = clean.split(/\r?\n/);
    const maxChars = lines.reduce((m, l) => Math.max(m, l.trim().length), 0);
    const contentW = Math.max(340, Math.min(650, maxChars * 8 + 48));
    const contentH = Math.max(160, Math.min(950, headerH + padding + estimateMarkdownContentHeight(clean, contentW)));
    return {
      width: contentW,
      height: contentH,
    };
  }

  // Box shapes: uml.class, uml.object, generic.rectangle, generic.note
  const titleText = node.labels[0]?.text ?? "";
  const titleLines = titleText.split("\n");
  const maxTitleChars = titleLines.reduce((m, l) => Math.max(m, l.length), 0);
  let maxContentWidth = maxTitleChars * 8.5;

  if (node.stereotype) {
    const stereoWidth = (node.stereotype.length + 4) * 7.5;
    maxContentWidth = Math.max(maxContentWidth, stereoWidth);
  }

  if (node.taggedValues) {
    const taggedStr = Object.entries(node.taggedValues)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    maxContentWidth = Math.max(maxContentWidth, (taggedStr.length + 2) * 6.5);
  }

  // Calculate header section height
  const hasStereo = Boolean(node.stereotype);
  const hasTagged = Boolean(node.taggedValues && Object.keys(node.taggedValues).length > 0);
  let totalHeight = 16 + titleLines.length * 18;
  if (hasStereo) totalHeight += 16;
  if (hasTagged) totalHeight += 14;

  // Compartments
  if (node.compartments && node.compartments.length > 0) {
    for (const comp of node.compartments) {
      totalHeight += 8; // compartment divider
      if (comp.title) {
        totalHeight += 16;
        maxContentWidth = Math.max(maxContentWidth, comp.title.length * 7.5);
      }
      for (const item of comp.items) {
        totalHeight += 18;
        const itemChars = (item.visibility ? 2 : 0) + item.text.length;
        maxContentWidth = Math.max(maxContentWidth, itemChars * 7.5);
      }
    }
    totalHeight += 10; // bottom padding
  } else {
    totalHeight += 16; // bottom padding
  }

  const minWidth = kind === "uml.class" ? 140 : kind === "uml.object" ? 130 : 120;
  const minHeight = kind === "uml.class" ? 80 : kind === "uml.object" ? 70 : 60;

  return {
    width: Math.max(minWidth, Math.ceil(maxContentWidth + 32)),
    height: Math.max(minHeight, Math.ceil(totalHeight)),
  };
}

/**
 * Estimates rendered height of markdown text content for scalable note embedding.
 */
export function estimateMarkdownContentHeight(markdown: string, cardWidth = 340): number {
  const clean = markdown.replace(/^---[\s\S]*?---\r?\n?/, "").trim();
  if (!clean) return 40;
  const lines = clean.split(/\r?\n/);
  let totalH = 20; // padding
  const effectiveWidth = Math.max(100, cardWidth - 28);
  const charsPerLine = Math.max(15, Math.floor(effectiveWidth / 7.5));

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      totalH += 8;
      continue;
    }
    if (trimmed.startsWith("#")) {
      const headingText = trimmed.replace(/^#+\s*/, "");
      const wraps = Math.max(1, Math.ceil((headingText.length * 1.3) / charsPerLine));
      totalH += wraps * 26 + 8;
    } else if (trimmed.startsWith("```")) {
      totalH += 22;
    } else if (trimmed.startsWith("-") || trimmed.startsWith("*") || trimmed.startsWith("+")) {
      const itemText = trimmed.replace(/^[-*+]\s*/, "");
      const wraps = Math.max(1, Math.ceil(itemText.length / charsPerLine));
      totalH += wraps * 20 + 4;
    } else if (trimmed.startsWith(">")) {
      const quoteText = trimmed.replace(/^>\s*/, "");
      const wraps = Math.max(1, Math.ceil(quoteText.length / charsPerLine));
      totalH += wraps * 20 + 6;
    } else if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      totalH += 16;
    } else {
      const wraps = Math.max(1, Math.ceil(trimmed.length / charsPerLine));
      totalH += wraps * 20 + 4;
    }
  }
  return Math.max(40, totalH);
}
