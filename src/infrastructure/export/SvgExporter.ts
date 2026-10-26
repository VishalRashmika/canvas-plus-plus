import { Diagram } from "../../domain/entities/Diagram";
import { DiagramNode } from "../../domain/entities/DiagramNode";
import { DiagramEdge } from "../../domain/entities/DiagramEdge";
import { defaultEdgeStyleRegistry } from "../../presentation/renderer/EdgeStyleRegistry";
import { defaultRoutingService } from "../../domain/services/RoutingService";
import { resolveCanvasColorHex, resolveCanvasBgColor } from "../../domain/value-objects/CanvasColor";
import { wrapTextToLines } from "../../domain/services/TextMeasurement";
import {
  getNodeFontStyle,
  getEdgeFontStyle,
  getGroupFontStyle,
  FontStyleConfig,
} from "../../presentation/theme/Typography";

export interface SvgExportOptions {
  padding?: number;
  theme?: "light" | "dark";
  backgroundColor?: string;
  title?: string;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export class SvgExporter {
  private getFontAttributes(font: FontStyleConfig): string {
    const parts: string[] = [];
    const styleParts: string[] = [];

    if (font.fontSize !== undefined) {
      parts.push(`font-size="${font.fontSize}"`);
      styleParts.push(`font-size: ${font.fontSize}px`);
    }
    if (font.fontWeight !== undefined) {
      parts.push(`font-weight="${font.fontWeight}"`);
      styleParts.push(`font-weight: ${font.fontWeight}`);
    }
    if (font.fontStyle !== undefined) {
      parts.push(`font-style="${font.fontStyle}"`);
      styleParts.push(`font-style: ${font.fontStyle}`);
    }

    if (parts.length === 0) return "";
    return ` ${parts.join(" ")} style="${styleParts.join("; ")}"`;
  }

  private normalizeMarkerId(markerId?: string): string | undefined {
    if (!markerId || markerId === "none") return undefined;
    if (markerId.startsWith("uml-marker-")) return markerId;
    switch (markerId) {
      case "arrow-open":
      case "open-arrow":
        return "uml-marker-open-arrow";
      case "arrow-filled":
      case "arrow":
      case "arrow-head":
        return "uml-marker-arrow-head";
      case "triangle-hollow":
      case "triangle":
      case "hollow-triangle":
        return "uml-marker-triangle-hollow";
      case "triangle-filled":
      case "filled-triangle":
        return "uml-marker-triangle-filled";
      case "diamond-hollow":
      case "diamond":
      case "hollow-diamond":
        return "uml-marker-diamond-hollow";
      case "diamond-filled":
      case "filled-diamond":
        return "uml-marker-diamond-filled";
      case "circle-hollow":
      case "circle":
      case "hollow-circle":
        return "uml-marker-circle-hollow";
      case "circle-filled":
      case "filled-circle":
      case "dot":
        return "uml-marker-circle-filled";
      case "stop":
      case "timing-stop":
        return "uml-marker-timing-stop";
      default:
        return markerId;
    }
  }

  private resolveStrokeDasharray(
    edgeStyle?: DiagramEdge["style"],
    styleDef?: { strokeDasharray?: string }
  ): string | undefined {
    if (edgeStyle?.strokeDasharray !== undefined && edgeStyle.strokeDasharray !== "") {
      if (edgeStyle.strokeDasharray === "solid" || edgeStyle.strokeDasharray === "none") {
        return undefined;
      }
      return edgeStyle.strokeDasharray;
    }

    if (edgeStyle?.lineType !== undefined) {
      switch (edgeStyle.lineType) {
        case "solid":
          return undefined;
        case "dashed":
          return "6 4";
        case "dotted":
          return "2 3";
        case "dash-dot":
          return "8 3 2 3";
        case "long-dash":
          return "12 4";
      }
    }

    if (edgeStyle?.dashed !== undefined) {
      return edgeStyle.dashed ? "6 4" : undefined;
    }

    return styleDef?.strokeDasharray;
  }

  /**
   * Generates a completely standalone SVG string from a Diagram aggregate (F-024).
   * Includes exact viewBox bounding box, self-contained styles, markers, and shapes.
   */
  exportToSvg(diagram: Diagram, options?: SvgExportOptions): string {
    const padding = options?.padding ?? 40;
    const theme = options?.theme ?? "light";
    const bounds = this.calculateDiagramBounds(diagram);

    const minX = bounds.minX - padding;
    const minY = bounds.minY - padding;
    const width = Math.max(200, bounds.maxX - bounds.minX + padding * 2);
    const height = Math.max(150, bounds.maxY - bounds.minY + padding * 2);

    const isDark = theme === "dark";
    const bg =
      options?.backgroundColor ??
      (isDark ? "#1e1e1e" : "#f7f5f0");
    const textColor = isDark ? "#dcddde" : "#1a1d24";
    const strokeColor = isDark ? "#5c6370" : "#404654";
    const nodeBg = isDark ? "#282c34" : "#ffffff";
    const accentColor = isDark ? "#7b68ee" : "#5b4fe8";

    const diagramTitle = options?.title ?? diagram.title;
    let svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n`;
    svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">\n`;
    if (diagramTitle) {
      svg += `  <title>${escapeXml(diagramTitle)}</title>\n`;
    }

    // 1. Embedded Defs & Styles
    svg += `  <defs>\n`;
    svg += `    <style type="text/css">\n`;
    svg += `      svg { background-color: ${bg}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }\n`;
    svg += `      .node-body { fill: ${nodeBg}; stroke: ${strokeColor}; stroke-width: 1.5; }\n`;
    svg += `      .node-title { fill: ${textColor}; font-weight: 600; font-size: 13px; }\n`;
    svg += `      .node-st { fill: ${strokeColor}; font-style: italic; font-size: 11px; }\n`;
    svg += `      .comp-divider { stroke: ${strokeColor}; stroke-width: 1; }\n`;
    svg += `      .comp-item { fill: ${textColor}; font-size: 11px; font-family: monospace; }\n`;
    svg += `      .edge-path { fill: none; stroke: ${strokeColor}; stroke-width: 1.5; }\n`;
    svg += `      .edge-label { fill: ${textColor}; font-size: 11px; }\n`;
    svg += `      .group-body { fill: rgba(120, 120, 120, 0.05); stroke: ${strokeColor}; stroke-dasharray: 4 4; stroke-width: 1.5; }\n`;
    svg += `      .group-title { fill: ${textColor}; font-weight: 700; font-size: 12px; }\n`;
    svg += `    </style>\n`;

    // Markers
    svg += `    <marker id="uml-marker-arrow-filled" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="${strokeColor}" />\n`;
    svg += `    </marker>\n`;
    svg += `    <marker id="uml-marker-arrow-head" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="${strokeColor}" />\n`;
    svg += `    </marker>\n`;

    svg += `    <marker id="uml-marker-open-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${strokeColor}" stroke-width="1.5" />\n`;
    svg += `    </marker>\n`;

    svg += `    <marker id="uml-marker-triangle-hollow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 0 1 L 10 5 L 0 9 Z" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
    svg += `    </marker>\n`;

    svg += `    <marker id="uml-marker-diamond-hollow" viewBox="0 0 12 10" refX="12" refY="5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 0 5 L 6 1 L 12 5 L 6 9 Z" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
    svg += `    </marker>\n`;

    svg += `    <marker id="uml-marker-diamond-filled" viewBox="0 0 12 10" refX="12" refY="5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 0 5 L 6 1 L 12 5 L 6 9 Z" fill="${strokeColor}" stroke="${strokeColor}" />\n`;
    svg += `    </marker>\n`;

    svg += `    <marker id="uml-marker-timing-stop" viewBox="0 0 2 10" refX="1" refY="5" markerWidth="3" markerHeight="10" orient="auto-start-reverse">\n`;
    svg += `      <line x1="1" y1="0" x2="1" y2="10" stroke="${strokeColor}" stroke-width="2" />\n`;
    svg += `    </marker>\n`;
    svg += `    <marker id="uml-marker-triangle-filled" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 0 1 L 10 5 L 0 9 Z" fill="${strokeColor}" stroke="${strokeColor}" />\n`;
    svg += `    </marker>\n`;
    svg += `    <marker id="uml-marker-circle-hollow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 1 5 A 4 4 0 1 1 9 5 A 4 4 0 1 1 1 5 Z" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
    svg += `    </marker>\n`;
    svg += `    <marker id="uml-marker-circle-filled" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 1 5 A 4 4 0 1 1 9 5 A 4 4 0 1 1 1 5 Z" fill="${strokeColor}" stroke="${strokeColor}" />\n`;
    svg += `    </marker>\n`;

    // Dynamic colored markers for edges with custom or preset colors
    const coloredMarkerDefs: string[] = [];
    const usedColorKeys = new Set<string>();

    for (const edge of diagram.edges) {
      const edgeCol =
        resolveCanvasColorHex(edge.style?.color, theme) ??
        edge.style?.strokeColor;
      if (!edgeCol) continue;
      const key = (edge.style?.color ?? edgeCol).replace(/[^a-zA-Z0-9_-]/g, "_");
      if (usedColorKeys.has(key)) continue;
      usedColorKeys.add(key);

      coloredMarkerDefs.push(`    <marker id="uml-marker-arrow-filled--color-${key}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n      <path d="M 0 1 L 10 5 L 0 9 z" fill="${edgeCol}" stroke="${edgeCol}" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-arrow-head--color-${key}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n      <path d="M 0 1 L 10 5 L 0 9 z" fill="${edgeCol}" stroke="${edgeCol}" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="umlcanvas-arrow-end--color-${key}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n      <path d="M 0 1 L 10 5 L 0 9 z" fill="${edgeCol}" stroke="${edgeCol}" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-open-arrow--color-${key}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n      <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${edgeCol}" stroke-width="1.5" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-triangle-hollow--color-${key}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">\n      <path d="M 0 1 L 10 5 L 0 9 Z" fill="${nodeBg}" stroke="${edgeCol}" stroke-width="1.5" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-diamond-hollow--color-${key}" viewBox="0 0 12 10" refX="12" refY="5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">\n      <path d="M 0 5 L 6 1 L 12 5 L 6 9 Z" fill="${nodeBg}" stroke="${edgeCol}" stroke-width="1.5" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-diamond-filled--color-${key}" viewBox="0 0 12 10" refX="12" refY="5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">\n      <path d="M 0 5 L 6 1 L 12 5 L 6 9 Z" fill="${edgeCol}" stroke="${edgeCol}" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-timing-stop--color-${key}" viewBox="0 0 2 10" refX="1" refY="5" markerWidth="3" markerHeight="10" orient="auto-start-reverse">\n      <line x1="1" y1="0" x2="1" y2="10" stroke="${edgeCol}" stroke-width="2" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-triangle-filled--color-${key}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">\n      <path d="M 0 1 L 10 5 L 0 9 Z" fill="${edgeCol}" stroke="${edgeCol}" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-circle-hollow--color-${key}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">\n      <path d="M 1 5 A 4 4 0 1 1 9 5 A 4 4 0 1 1 1 5 Z" fill="${nodeBg}" stroke="${edgeCol}" stroke-width="1.5" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-circle-filled--color-${key}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">\n      <path d="M 1 5 A 4 4 0 1 1 9 5 A 4 4 0 1 1 1 5 Z" fill="${edgeCol}" stroke="${edgeCol}" />\n    </marker>`);
    }

    if (coloredMarkerDefs.length > 0) {
      svg += coloredMarkerDefs.join("\n") + "\n";
    }

    svg += `  </defs>\n`;

    // 2. Render Groups (Background)
    const nodeMap = new Map<string, DiagramNode>(
      diagram.nodes.map((n) => [n.id, n])
    );
    for (const group of diagram.groups) {
      let gx = group.position?.x;
      let gy = group.position?.y;
      let gw = group.size?.width;
      let gh = group.size?.height;

      const memberNodes = group.nodeIds
        .map((id) => nodeMap.get(id))
        .filter((n): n is DiagramNode => n !== undefined);

      if (gx === undefined || gy === undefined || gw === undefined || gh === undefined) {
        if (memberNodes.length === 0) continue;

        let gMinX = Infinity;
        let gMinY = Infinity;
        let gMaxX = -Infinity;
        let gMaxY = -Infinity;

        for (const n of memberNodes) {
          gMinX = Math.min(gMinX, n.position.x);
          gMinY = Math.min(gMinY, n.position.y);
          gMaxX = Math.max(gMaxX, n.position.x + n.size.width);
          gMaxY = Math.max(gMaxY, n.position.y + n.size.height);
        }

        const padding = 16;
        gx = Math.round(gMinX - padding);
        gy = Math.round(gMinY - padding - 22);
        gw = Math.round(gMaxX - gMinX + padding * 2);
        gh = Math.round(gMaxY - gMinY + padding * 2 + 22);
      }

      const groupStroke = resolveCanvasColorHex(group.color, theme) ?? strokeColor;
      const groupFill = group.color
        ? (resolveCanvasBgColor(group.color, isDark ? 0.15 : 0.06, theme) ?? "rgba(120, 120, 120, 0.05)")
        : "rgba(120, 120, 120, 0.05)";

      const groupFont = getGroupFontStyle(group);
      const groupFontAttrs = this.getFontAttributes(groupFont);

      svg += `  <g class="umlcanvas-group"${group.color ? ` data-color="${group.color}"` : ""}>\n`;
      svg += `    <rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="6" ry="6" class="group-body" stroke="${groupStroke}" fill="${groupFill}" />\n`;
      if (group.name) {
        svg += `    <text x="${gx + 10}" y="${gy + 18}" class="group-title" fill="${groupStroke}"${groupFontAttrs}>${escapeXml(group.name)}</text>\n`;
      }
      svg += `  </g>\n`;
    }

    // 3. Render Edges
    for (const edge of diagram.edges) {
      svg += this.renderEdgeSvg(edge, diagram, strokeColor, theme);
    }

    // 4. Render Nodes
    for (const node of diagram.nodes) {
      const nodeStroke = resolveCanvasColorHex(node.style?.color, theme) ?? node.style?.strokeColor ?? strokeColor;
      const nodeFill = node.style?.color
        ? (resolveCanvasBgColor(node.style.color, isDark ? 0.25 : 0.08, theme) ?? nodeBg)
        : (node.style?.fillColor ?? nodeBg);
      svg += this.renderNodeSvg(node, nodeStroke, nodeFill, accentColor);
    }

    svg += `</svg>\n`;
    return svg;
  }

  /**
   * Exports diagram to a PNG data URL or buffer (F-024).
   * In browser/Obsidian, uses canvas rasterization.
   * In headless/Node, falls back cleanly to an SVG data URL.
   */
  async exportToPng(diagram: Diagram, options?: SvgExportOptions): Promise<string> {
    const svgString = this.exportToSvg(diagram, options);

    if (typeof window !== "undefined" && typeof document !== "undefined") {
      return new Promise<string>((resolve, reject) => {
        const img = new Image();
        const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(svgBlob);

        img.onload = () => {
          const canvas = createEl("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            URL.revokeObjectURL(url);
            resolve(`data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`);
            return;
          }
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL("image/png"));
        };

        img.onerror = (err) => {
          URL.revokeObjectURL(url);
          reject(new Error(typeof err === "string" ? err : "Failed to load SVG for PNG conversion"));
        };

        img.src = url;
      });
    }

    // Headless / CLI / Test environment fallback
    return `data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`;
  }

  private calculateDiagramBounds(diagram: Diagram): BoundingBox {
    if (diagram.nodes.length === 0 && diagram.groups.length === 0) {
      return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of diagram.nodes) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + node.size.width);
      maxY = Math.max(maxY, node.position.y + node.size.height);
    }

    if (diagram.groups.length > 0) {
      // Add a margin to account for group padding around member nodes
      minX = minX !== Infinity ? minX - 16 : minX;
      minY = minY !== Infinity ? minY - 38 : minY;
      maxX = maxX !== -Infinity ? maxX + 16 : maxX;
      maxY = maxY !== -Infinity ? maxY + 16 : maxY;
    }

    for (const edge of diagram.edges) {
      if (edge.waypoints) {
        for (const pt of edge.waypoints) {
          minX = Math.min(minX, pt.x);
          minY = Math.min(minY, pt.y);
          maxX = Math.max(maxX, pt.x);
          maxY = Math.max(maxY, pt.y);
        }
      }
    }

    return { minX, minY, maxX, maxY };
  }

  private renderEdgeSvg(
    edge: DiagramEdge,
    diagram: Diagram,
    strokeColor: string,
    theme: "light" | "dark" = "light"
  ): string {
    const fromNode = diagram.nodes.find((n) => n.id === edge.fromNodeId);
    const toNode = diagram.nodes.find((n) => n.id === edge.toNodeId);

    if (!fromNode || !toNode) return "";

    const fromPort = fromNode.ports?.find((p) => p.id === edge.fromPortId);
    const toPort = toNode.ports?.find((p) => p.id === edge.toPortId);
    const fromSide = fromPort?.side ?? edge.fromSide;
    const toSide = toPort?.side ?? edge.toSide;

    const routingResult = defaultRoutingService.route(
      {
        id: fromNode.id,
        position: fromNode.position,
        size: fromNode.size,
        side: fromSide,
        portOffset: fromPort?.offset,
      },
      {
        id: toNode.id,
        position: toNode.position,
        size: toNode.size,
        side: toSide,
        portOffset: toPort?.offset,
      },
      {
        routing: edge.routing,
        manualWaypoints: edge.waypoints,
      }
    );

    const pathData = routingResult.svgPath;
    const points = routingResult.points;

    const styleDef = defaultEdgeStyleRegistry.get(edge.kind);
    const strokeW = edge.style?.strokeWidth ?? styleDef.strokeWidth ?? 2;
    const resolvedDash = this.resolveStrokeDasharray(edge.style, styleDef);
    const dash = resolvedDash ? ` stroke-dasharray="${resolvedDash}"` : "";

    const finalStrokeColor =
      resolveCanvasColorHex(edge.style?.color, theme) ??
      edge.style?.strokeColor ??
      strokeColor;

    const hasColor = edge.style?.color || edge.style?.strokeColor;
    const colorKey = hasColor
      ? (edge.style?.color ?? edge.style?.strokeColor)!.replace(/[^a-zA-Z0-9_-]/g, "_")
      : undefined;

    const rawMarkerEnd =
      edge.style?.markerEnd !== undefined
        ? edge.style.markerEnd === "none" || !edge.style.markerEnd
          ? undefined
          : this.normalizeMarkerId(edge.style.markerEnd)
        : styleDef.markerEndId;

    const rawMarkerStart =
      edge.style?.markerStart !== undefined
        ? edge.style.markerStart === "none" || !edge.style.markerStart
          ? undefined
          : this.normalizeMarkerId(edge.style.markerStart)
        : styleDef.markerStartId;

    const markerEndId = rawMarkerEnd
      ? colorKey
        ? `${rawMarkerEnd}--color-${colorKey}`
        : rawMarkerEnd
      : undefined;

    const markerStartId = rawMarkerStart
      ? colorKey
        ? `${rawMarkerStart}--color-${colorKey}`
        : rawMarkerStart
      : undefined;

    const markerEnd = markerEndId ? ` marker-end="url(#${markerEndId})"` : "";
    const markerStart = markerStartId ? ` marker-start="url(#${markerStartId})"` : "";

    let out = `  <g class="umlcanvas-edge"${edge.style?.color ? ` data-color="${edge.style.color}"` : ""}>\n`;
    out += `    <path d="${pathData}" class="edge-path" stroke="${finalStrokeColor}" stroke-width="${strokeW}"${dash}${markerStart}${markerEnd} />\n`;

    const edgeFont = getEdgeFontStyle(edge);
    const edgeFontAttrs = this.getFontAttributes(edgeFont);
    const multFontSize = edgeFont.fontSize ? Math.max(8, Math.round(edgeFont.fontSize * 0.85)) : 10;
    const multFontAttrs = this.getFontAttributes({ ...edgeFont, fontSize: multFontSize });

    // Multiplicity source
    if (edge.multiplicitySource && points.length >= 2) {
      const sp = points[0];
      out += `    <text x="${sp.x + 8}" y="${sp.y - 6}" class="edge-label"${multFontAttrs}>${escapeXml(edge.multiplicitySource)}</text>\n`;
    }

    // Multiplicity target
    if (edge.multiplicityTarget && points.length >= 2) {
      const ep = points[points.length - 1];
      out += `    <text x="${ep.x + 8}" y="${ep.y - 6}" class="edge-label"${multFontAttrs}>${escapeXml(edge.multiplicityTarget)}</text>\n`;
    }

    // Edge label (midpoint)
    if (edge.labels && edge.labels.length > 0 && points.length >= 2) {
      const midIdx = Math.floor(points.length / 2);
      const midPoint = points[midIdx];
      const labelText = edge.labels.map((l) => l.text).join(", ");
      out += `    <text x="${midPoint.x}" y="${midPoint.y - 8}" text-anchor="middle" class="edge-label"${edgeFontAttrs}>${escapeXml(labelText)}</text>\n`;
    }

    out += `  </g>\n`;
    return out;
  }

  private renderMultilineText(
    cx: number,
    cy: number,
    title: string,
    fontAttrs: string,
    textAnchor = "middle",
    className = "node-title",
    fontSize = 13
  ): string {
    const lines = (title ?? "").split(/\r?\n/);
    if (lines.length <= 1) {
      return `    <text x="${cx}" y="${cy}" text-anchor="${textAnchor}" class="${className}"${fontAttrs}>${escapeXml(title)}</text>\n`;
    }
    const lineHeight = Math.round(fontSize * 1.35);
    const startY = cy - ((lines.length - 1) * lineHeight) / 2;
    let out = `    <text x="${cx}" y="${cy}" text-anchor="${textAnchor}" class="${className}"${fontAttrs}>\n`;
    lines.forEach((lineText, idx) => {
      out += `      <tspan x="${cx}" y="${startY + idx * lineHeight}" text-anchor="${textAnchor}">${escapeXml(lineText || " ")}</tspan>\n`;
    });
    out += `    </text>\n`;
    return out;
  }

  private renderNodeSvg(
    node: DiagramNode,
    strokeColor: string,
    nodeBg: string,
    accentColor: string
  ): string {
    const x = Math.round(node.position.x);
    const y = Math.round(node.position.y);
    const w = Math.round(node.size.width);
    const h = Math.round(node.size.height);
    const title = node.labels[0]?.text || node.id;

    const hasCustomColor = Boolean(node.style?.color || node.style?.strokeColor || node.style?.fillColor);
    const bodyAttrs = hasCustomColor ? ` stroke="${strokeColor}" fill="${nodeBg}"` : "";
    const nodeFont = getNodeFontStyle(node);
    const fontAttrs = this.getFontAttributes(nodeFont);
    const baseFontSize = nodeFont.fontSize ?? 13;
    const stFontSize = nodeFont.fontSize ? Math.max(8, Math.round(nodeFont.fontSize * 0.77)) : undefined;
    const stFontAttrs = this.getFontAttributes({
      ...nodeFont,
      fontSize: stFontSize,
      fontStyle: nodeFont.fontStyle ?? "italic",
    });

    let out = `  <g class="umlcanvas-node"${node.style?.color ? ` data-color="${node.style.color}"` : ""} transform="translate(${x}, ${y})">\n`;

    switch (node.kind) {
      case "generic.circle": {
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(w, h) / 2;
        out += `    <circle cx="${cx}" cy="${cy}" r="${r}" class="node-body"${bodyAttrs} />\n`;
        if (title) {
          out += this.renderMultilineText(cx, cy + 4, title, fontAttrs, "middle", "node-title", baseFontSize);
        }
        break;
      }

      case "generic.ellipse": {
        const rx = w / 2;
        const ry = h / 2;
        out += `    <ellipse cx="${rx}" cy="${ry}" rx="${rx}" ry="${ry}" class="node-body"${bodyAttrs} />\n`;
        if (title) {
          out += this.renderMultilineText(rx, ry + 4, title, fontAttrs, "middle", "node-title", baseFontSize);
        }
        break;
      }

      case "generic.triangle": {
        out += `    <polygon points="${w / 2},0 ${w},${h} 0,${h}" class="node-body"${bodyAttrs} />\n`;
        if (title) {
          out += this.renderMultilineText(w / 2, (h * 2) / 3 + 4, title, fontAttrs, "middle", "node-title", baseFontSize);
        }
        break;
      }

      case "generic.diamond":
      case "activity.decision":
      case "state.choice": {
        out += `    <polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}" class="node-body"${bodyAttrs} />\n`;
        if (title) {
          out += this.renderMultilineText(w / 2, h / 2 + 4, title, fontAttrs, "middle", "node-title", baseFontSize);
        }
        break;
      }

      case "uml.usecase": {
        const rx = w / 2;
        const ry = h / 2;
        out += `    <ellipse cx="${rx}" cy="${ry}" rx="${rx}" ry="${ry}" class="node-body"${bodyAttrs} />\n`;
        out += this.renderMultilineText(rx, ry + 4, title, fontAttrs, "middle", "node-title", baseFontSize);
        break;
      }

      case "uml.actor": {
        const cx = w / 2;
        out += `    <circle cx="${cx}" cy="14" r="10" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <line x1="${cx}" y1="24" x2="${cx}" y2="46" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <line x1="${cx - 18}" y1="32" x2="${cx + 18}" y2="32" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <line x1="${cx}" y1="46" x2="${cx - 14}" y2="68" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <line x1="${cx}" y1="46" x2="${cx + 14}" y2="68" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += this.renderMultilineText(cx, h - 4, title, fontAttrs, "middle", "node-title", baseFontSize);
        break;
      }

      case "uml.component": {
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="2" class="node-body" />\n`;
        // Component glyph in top right
        const ix = w - 24;
        const iy = 8;
        out += `    <rect x="${ix}" y="${iy}" width="16" height="18" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1" />\n`;
        out += `    <rect x="${ix - 4}" y="${iy + 3}" width="7" height="4" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1" />\n`;
        out += `    <rect x="${ix - 4}" y="${iy + 11}" width="7" height="4" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1" />\n`;
        out += `    <text x="${w / 2}" y="24" text-anchor="middle" class="node-st"${stFontAttrs}>«${escapeXml(node.stereotype || "component")}»</text>\n`;
        out += this.renderMultilineText(w / 2, 48, title, fontAttrs, "middle", "node-title", baseFontSize);
        break;
      }

      case "uml.lollipop": {
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(cx, cy) - 2;
        out += `    <circle cx="${cx}" cy="${cy}" r="${r}" class="node-body" stroke-width="2" />\n`;
        out += this.renderMultilineText(cx, h + 14, title, fontAttrs, "middle", "node-title", baseFontSize);
        break;
      }

      case "uml.socket": {
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(cx, cy) - 2;
        out += `    <path d="M ${cx},${cy - r} A ${r},${r} 0 0,0 ${cx},${cy + r}" fill="none" stroke="${strokeColor}" stroke-width="2" />\n`;
        out += this.renderMultilineText(cx, h + 14, title, fontAttrs, "middle", "node-title", baseFontSize);
        break;
      }

      case "uml.node3d":
      case "uml.device":
      case "uml.executionEnvironment": {
        const d = 14;
        out += `    <polygon points="0,${d} ${d},0 ${w},0 ${w - d},${d}" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <polygon points="${w - d},${d} ${w},0 ${w},${h - d} ${w - d},${h}" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <rect x="0" y="${d}" width="${w - d}" height="${h - d}" class="node-body" />\n`;
        const st = node.stereotype || (node.kind === "uml.device" ? "device" : "node");
        out += `    <text x="${(w - d) / 2}" y="${d + 20}" text-anchor="middle" class="node-st"${stFontAttrs}>«${escapeXml(st)}»</text>\n`;
        out += this.renderMultilineText((w - d) / 2, d + 42, title, fontAttrs, "middle", "node-title", baseFontSize);
        break;
      }

      case "uml.artifact": {
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="2" class="node-body" />\n`;
        const docX = w - 24;
        const docY = 8;
        out += `    <path d="M ${docX},${docY} L ${docX + 10},${docY} L ${docX + 16},${docY + 6} L ${docX + 16},${docY + 20} L ${docX},${docY + 20} Z" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1" />\n`;
        out += `    <path d="M ${docX + 10},${docY} L ${docX + 10},${docY + 6} L ${docX + 16},${docY + 6}" fill="none" stroke="${strokeColor}" stroke-width="1" />\n`;
        out += `    <text x="${w / 2}" y="24" text-anchor="middle" class="node-st"${stFontAttrs}>«${escapeXml(node.stereotype || "artifact")}»</text>\n`;
        out += this.renderMultilineText(w / 2, 46, title, fontAttrs, "middle", "node-title", baseFontSize);
        break;
      }

      case "timing.lane": {
        const headerW = 110;
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="2" class="node-body" />\n`;
        out += `    <line x1="${headerW}" y1="0" x2="${headerW}" y2="${h}" class="comp-divider" />\n`;
        out += this.renderMultilineText(headerW / 2, h / 2 + 4, title, fontAttrs, "middle", "node-title", baseFontSize);
        out += `    <line x1="${headerW}" y1="${h * 0.33}" x2="${w}" y2="${h * 0.33}" stroke="${strokeColor}" stroke-dasharray="4 4" stroke-width="1" />\n`;
        out += `    <line x1="${headerW}" y1="${h * 0.67}" x2="${w}" y2="${h * 0.67}" stroke="${strokeColor}" stroke-dasharray="4 4" stroke-width="1" />\n`;
        break;
      }

      case "timing.stateSegment": {
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="3" class="node-body" fill="rgba(120, 100, 255, 0.2)" />\n`;
        out += this.renderMultilineText(w / 2, h / 2 + 4, title, fontAttrs, "middle", "node-title", baseFontSize);
        break;
      }

      case "schematic.chip": {
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="4" class="node-body" stroke-width="2" />\n`;
        out += `    <path d="M ${w / 2 - 8},0 A 8,8 0 0,0 ${w / 2 + 8},0" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += this.renderMultilineText(w / 2, h / 2 + 4, title, fontAttrs, "middle", "node-title", baseFontSize);

        const pinFontSize = nodeFont.fontSize ? Math.max(7, Math.round(nodeFont.fontSize * 0.7)) : 9;
        const pinFontAttrs = this.getFontAttributes({ ...nodeFont, fontSize: pinFontSize });

        for (const port of node.ports) {
          const portLabel = port.dataType ? `${port.name} [${port.dataType}]` : port.name;
          if (port.side === "left") {
            const py = Math.round(h * port.offset);
            out += `    <line x1="-6" y1="${py}" x2="0" y2="${py}" stroke="${strokeColor}" stroke-width="2" />\n`;
            out += `    <text x="6" y="${py + 3.5}" class="comp-item"${pinFontAttrs}>▶ ${escapeXml(portLabel)}</text>\n`;
          } else if (port.side === "right") {
            const py = Math.round(h * port.offset);
            out += `    <line x1="${w}" y1="${py}" x2="${w + 6}" y2="${py}" stroke="${strokeColor}" stroke-width="2" />\n`;
            out += `    <text x="${w - 6}" y="${py + 3.5}" text-anchor="end" class="comp-item"${pinFontAttrs}>${escapeXml(portLabel)} ▶</text>\n`;
          }
        }

        if (node.childDiagramId) {
          out += `    <rect x="${w - 22}" y="6" width="16" height="16" rx="3" fill="${nodeBg}" stroke="${accentColor}" stroke-width="1" />\n`;
          out += `    <text x="${w - 14}" y="18" text-anchor="middle" fill="${accentColor}" font-size="11">⤢</text>\n`;
        }
        break;
      }

      case "uml.package": {
        const tabW = Math.min(80, w * 0.45);
        const tabH = 22;
        out += `    <rect x="0" y="0" width="${tabW}" height="${tabH}" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <rect x="0" y="${tabH}" width="${w}" height="${h - tabH}" class="node-body" />\n`;
        out += `    <text x="${w / 2}" y="${tabH + 24}" text-anchor="middle" class="node-title"${fontAttrs}>${escapeXml(title)}</text>\n`;
        break;
      }

      case "uml.compositeClassifier": {
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="8" class="node-body" />\n`;
        out += `    <line x1="0" y1="34" x2="${w}" y2="34" class="comp-divider" />\n`;
        out += `    <text x="${w / 2}" y="22" text-anchor="middle" class="node-title"${fontAttrs}>${escapeXml(title)}</text>\n`;
        break;
      }

      case "uml.part": {
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="2" class="node-body" />\n`;
        out += `    <text x="${w / 2}" y="${h / 2 + 5}" text-anchor="middle" class="node-title"${fontAttrs}>${escapeXml(title)}</text>\n`;
        break;
      }

      case "interaction.frame": {
        const tabW = Math.min(80, w * 0.4);
        const tabH = 22;
        const tabFontSize = nodeFont.fontSize ? Math.max(8, Math.round(nodeFont.fontSize * 0.77)) : 10;
        const tabFontAttrs = this.getFontAttributes({ ...nodeFont, fontSize: tabFontSize, fontWeight: nodeFont.fontWeight ?? "bold" });
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="2" class="node-body" />\n`;
        out += `    <path d="M 0,0 L ${tabW},0 L ${tabW + 8},${tabH / 2} L ${tabW},${tabH} L 0,${tabH} Z" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <text x="${tabW / 2}" y="15" text-anchor="middle" fill="${strokeColor}"${tabFontAttrs}>sd</text>\n`;
        out += this.renderMultilineText(tabW + 16, 16, title, fontAttrs, "start", "node-title", baseFontSize);
        if (node.childDiagramId) {
          out += `    <rect x="${w - 22}" y="6" width="16" height="16" rx="3" fill="${nodeBg}" stroke="${accentColor}" stroke-width="1" />\n`;
          out += `    <text x="${w - 14}" y="18" text-anchor="middle" fill="${accentColor}" font-size="11">⤢</text>\n`;
        }
        break;
      }

      case "interaction.occurrence": {
        const refFontSize = nodeFont.fontSize ? Math.max(8, Math.round(nodeFont.fontSize * 0.77)) : undefined;
        const refFontAttrs = this.getFontAttributes({ ...nodeFont, fontSize: refFontSize });
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="4" class="node-body" />\n`;
        out += `    <text x="8" y="18" class="node-st"${refFontAttrs}>ref</text>\n`;
        out += this.renderMultilineText(w / 2, h / 2 + 5, title, fontAttrs, "middle", "node-title", baseFontSize);
        break;
      }

      case "schematic.junction": {
        const cx = w / 2;
        const cy = h / 2;
        out += `    <circle cx="${cx}" cy="${cy}" r="5" fill="${strokeColor}" />\n`;
        break;
      }

      case "schematic.ground": {
        const cx = w / 2;
        out += `    <line x1="${cx}" y1="0" x2="${cx}" y2="12" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <line x1="${cx - 12}" y1="12" x2="${cx + 12}" y2="12" stroke="${strokeColor}" stroke-width="2" />\n`;
        out += `    <line x1="${cx - 7}" y1="18" x2="${cx + 7}" y2="18" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <line x1="${cx - 3}" y1="24" x2="${cx + 3}" y2="24" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        break;
      }

      case "schematic.powerRail": {
        const cx = w / 2;
        out += `    <line x1="${cx}" y1="${h}" x2="${cx}" y2="16" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <line x1="${cx - 12}" y1="16" x2="${cx + 12}" y2="16" stroke="${strokeColor}" stroke-width="2" />\n`;
        out += `    <text x="${cx}" y="10" text-anchor="middle" class="node-title"${fontAttrs}>${escapeXml(title || "VCC")}</text>\n`;
        break;
      }

      case "schematic.busTap": {
        out += `    <path d="M 0,12 L 12,12 L 24,24" fill="none" stroke="${strokeColor}" stroke-width="2" />\n`;
        break;
      }

      case "generic.freehand": {
        const pathData = (node.customData?.pathData as string) || "";
        out += `    <path class="umlcanvas-freehand-path" d="${escapeXml(pathData)}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />\n`;
        break;
      }

      case "generic.stickyNote": {
        const stripH = 22;
        const stickyBg = nodeBg;
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="4" class="umlcanvas-sticky-body" fill="${stickyBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <path d="M 0 4 A 4 4 0 0 1 4 0 L ${w - 4} 0 A 4 4 0 0 1 ${w} 4 L ${w} ${stripH} L 0 ${stripH} Z" class="umlcanvas-sticky-strip" fill="rgba(0,0,0,0.06)" />\n`;
        const nodeFont = getNodeFontStyle(node);
        const fontSize = nodeFont.fontSize ?? 13;
        const boldMultiplier = nodeFont.bold ? 1.1 : 1.0;
        const charWidth = Math.max(5, fontSize * 0.58 * boldMultiplier);
        const availableW = Math.max(40, w - 24);
        const lines = wrapTextToLines(title || "", availableW, charWidth);
        const lineSpacing = Math.round(fontSize * 1.38);
        let textY = 26 + fontSize;
        for (const line of lines) {
          if (textY > h - 6) break;
          out += `    <text x="12" y="${textY}" class="umlcanvas-sticky-text" fill="${strokeColor}"${fontAttrs}>${escapeXml(line || " ")}</text>\n`;
          textY += lineSpacing;
        }
        break;
      }

      case "generic.image": {
        const pad = 10;
        const titleAreaH = 38;
        const imgW = Math.max(20, w - pad * 2);
        const imgH = Math.max(20, h - pad * 2 - titleAreaH);
        const src =
          (node.customData?.src as string) ||
          (node.metadata?.src as string) ||
          (node.customData?.filePath as string) ||
          (node.metadata?.filePath as string) ||
          "";
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="6" class="umlcanvas-photo-frame-body" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <rect x="${pad}" y="${pad}" width="${imgW}" height="${imgH}" rx="3" class="umlcanvas-photo-mat" fill="rgba(0,0,0,0.05)" stroke="${strokeColor}" stroke-width="1" />\n`;
        if (src) {
          out += `    <image x="${pad}" y="${pad}" width="${imgW}" height="${imgH}" preserveAspectRatio="xMidYMid slice" href="${escapeXml(src)}" />\n`;
        }
        if (title) {
          out += `    <text x="${w / 2}" y="${h - 14}" text-anchor="middle" class="umlcanvas-photo-frame-title" fill="${strokeColor}"${fontAttrs}>${escapeXml(title)}</text>\n`;
        }
        break;
      }

      case "obsidian.note": {
        const headerH = 32;
        const r = 8;
        const rawTitle = node.labels[0]?.text || (node.metadata?.filePath as string) || "Vault Note";
        const noteTitle = rawTitle.replace(/\.md$/, "");
        const content =
          (node.customData?.content as string) ||
          (node.customData?.snippet as string) ||
          "";

        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" class="node-body"${bodyAttrs} />\n`;
        out += `    <path d="M 0 ${r} A ${r} ${r} 0 0 1 ${r} 0 L ${w - r} 0 A ${r} ${r} 0 0 1 ${w} ${r} L ${w} ${headerH} L 0 ${headerH} Z" fill="rgba(128,128,128,0.06)" />\n`;
        out += `    <line x1="0" y1="${headerH}" x2="${w}" y2="${headerH}" stroke="${strokeColor}" stroke-width="1" />\n`;
        // Icon
        out += `    <g transform="translate(10, 8)">\n`;
        out += `      <path d="M9 2H3.5A1.5 1.5 0 0 0 2 3.5v11A1.5 1.5 0 0 0 3.5 16h7a1.5 1.5 0 0 0 1.5-1.5V5L9 2z" fill="none" stroke="${strokeColor}" stroke-width="1.2" stroke-linejoin="round" />\n`;
        out += `      <polyline points="8.5 2 8.5 5.5 12 5.5" fill="none" stroke="${strokeColor}" stroke-width="1.2" stroke-linejoin="round" />\n`;
        out += `    </g>\n`;
        // Title
        out += `    <text x="30" y="21" class="node-title"${fontAttrs}>${escapeXml(noteTitle)}</text>\n`;
        // Open icon
        out += `    <text x="${w - 20}" y="21" font-size="14" fill="${strokeColor}">↗</text>\n`;

        if (content) {
          const clean = content.replace(/^---[\s\S]*?---\r?\n?/, "").trim();
          const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
          const bodyH = Math.max(10, h - headerH - 16);
          const estH = Math.max(lines.length * 18, 40);
          const customScale = typeof node.customData?.scale === "number" ? node.customData.scale : undefined;
          const scaleMode = node.customData?.scaleMode ?? "fit";
          const scale = customScale !== undefined && scaleMode === "custom"
            ? customScale
            : Math.min(1.0, Math.max(0.15, bodyH / estH));
          const fontSize = Math.max(8, Math.round(12 * scale));
          const lineSpacing = Math.max(10, Math.round(18 * scale));

          out += `    <g transform="translate(12, ${headerH + 16})">\n`;
          let curY = 0;
          for (let i = 0; i < lines.length; i++) {
            if (curY > bodyH && scaleMode !== "fit") break;
            const line = lines[i].replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+/, "• ");
            out += `      <text x="0" y="${curY}" font-size="${fontSize}" fill="${strokeColor}">${escapeXml(line)}</text>\n`;
            curY += lineSpacing;
          }
          out += `    </g>\n`;
        }
        break;
      }

      default: {
        // Standard class or generic rectangle with compartments
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="2" class="node-body"${bodyAttrs} />\n`;
        let curY = 18;
        if (node.stereotype) {
          out += `    <text x="${w / 2}" y="${curY}" text-anchor="middle" class="node-st"${stFontAttrs}>«${escapeXml(node.stereotype)}»</text>\n`;
          curY += 16;
        }
        const titleLines = (title ?? "").split(/\r?\n/);
        const titleBlockHeight = Math.max(1, titleLines.length) * Math.round(baseFontSize * 1.35);
        const titleCenterY = titleLines.length > 1 ? curY + (titleBlockHeight - Math.round(baseFontSize * 1.35)) / 2 : curY;
        out += this.renderMultilineText(w / 2, titleCenterY, title, fontAttrs, "middle", "node-title", baseFontSize);
        curY += titleBlockHeight - 10;

        if (node.compartments && node.compartments.length > 0) {
          const compFontSize = nodeFont.fontSize ? Math.max(9, Math.round(nodeFont.fontSize * 0.85)) : undefined;
          const compFontAttrs = this.getFontAttributes({ ...nodeFont, fontSize: compFontSize });
          const compLineHeight = compFontSize ? Math.round(compFontSize * 1.5) : 14;

          for (const comp of node.compartments) {
            out += `    <line x1="0" y1="${curY}" x2="${w}" y2="${curY}" class="comp-divider" />\n`;
            curY += compLineHeight;
            for (const item of comp.items) {
              const vis = item.visibility ? `${item.visibility} ` : "";
              out += `    <text x="8" y="${curY}" class="comp-item"${compFontAttrs}>${escapeXml(vis + item.text)}</text>\n`;
              curY += compLineHeight;
            }
          }
        }
        break;
      }
    }

    out += `  </g>\n`;
    return out;
  }
}

export const defaultSvgExporter = new SvgExporter();
