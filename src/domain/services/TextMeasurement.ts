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
