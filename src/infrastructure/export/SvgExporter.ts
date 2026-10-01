import { Diagram } from "../../domain/entities/Diagram";
import { DiagramNode } from "../../domain/entities/DiagramNode";
import { DiagramEdge } from "../../domain/entities/DiagramEdge";
import { defaultEdgeStyleRegistry } from "../../presentation/renderer/EdgeStyleRegistry";
import { defaultRoutingService } from "../../domain/services/RoutingService";
import { resolveCanvasColorHex, resolveCanvasBgColor } from "../../domain/value-objects/CanvasColor";

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
      (isDark ? "#1e1e1e" : "#ffffff");
    const textColor = isDark ? "#dcddde" : "#2e3338";
    const strokeColor = isDark ? "#5c6370" : "#8a919e";
    const nodeBg = isDark ? "#282c34" : "#f8f9fa";
    const accentColor = isDark ? "#7b68ee" : "#5c4cdb";

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

    svg += `    <marker id="uml-marker-open-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${strokeColor}" stroke-width="1.5" />\n`;
    svg += `    </marker>\n`;

    svg += `    <marker id="uml-marker-triangle-hollow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 0 1 L 10 5 L 0 9 Z" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
    svg += `    </marker>\n`;

    svg += `    <marker id="uml-marker-diamond-hollow" viewBox="0 0 12 10" refX="0" refY="5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 0 5 L 6 1 L 12 5 L 6 9 Z" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
    svg += `    </marker>\n`;

    svg += `    <marker id="uml-marker-diamond-filled" viewBox="0 0 12 10" refX="0" refY="5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 0 5 L 6 1 L 12 5 L 6 9 Z" fill="${strokeColor}" stroke="${strokeColor}" />\n`;
    svg += `    </marker>\n`;

    svg += `    <marker id="uml-marker-timing-stop" viewBox="0 0 2 10" refX="1" refY="5" markerWidth="3" markerHeight="10" orient="auto-start-reverse">\n`;
    svg += `      <line x1="1" y1="0" x2="1" y2="10" stroke="${strokeColor}" stroke-width="2" />\n`;
    svg += `    </marker>\n`;
    svg += `    <marker id="uml-marker-triangle-filled" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">\n`;
    svg += `      <path d="M 0 1 L 10 5 L 0 9 Z" fill="${strokeColor}" stroke="${strokeColor}" />\n`;
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
      coloredMarkerDefs.push(`    <marker id="umlcanvas-arrow-end--color-${key}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n      <path d="M 0 1 L 10 5 L 0 9 z" fill="${edgeCol}" stroke="${edgeCol}" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-open-arrow--color-${key}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n      <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${edgeCol}" stroke-width="1.5" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-triangle-hollow--color-${key}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">\n      <path d="M 0 1 L 10 5 L 0 9 Z" fill="${nodeBg}" stroke="${edgeCol}" stroke-width="1.5" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-diamond-hollow--color-${key}" viewBox="0 0 12 10" refX="0" refY="5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">\n      <path d="M 0 5 L 6 1 L 12 5 L 6 9 Z" fill="${nodeBg}" stroke="${edgeCol}" stroke-width="1.5" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-diamond-filled--color-${key}" viewBox="0 0 12 10" refX="0" refY="5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">\n      <path d="M 0 5 L 6 1 L 12 5 L 6 9 Z" fill="${edgeCol}" stroke="${edgeCol}" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-timing-stop--color-${key}" viewBox="0 0 2 10" refX="1" refY="5" markerWidth="3" markerHeight="10" orient="auto-start-reverse">\n      <line x1="1" y1="0" x2="1" y2="10" stroke="${edgeCol}" stroke-width="2" />\n    </marker>`);
      coloredMarkerDefs.push(`    <marker id="uml-marker-triangle-filled--color-${key}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">\n      <path d="M 0 1 L 10 5 L 0 9 Z" fill="${edgeCol}" stroke="${edgeCol}" />\n    </marker>`);
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

      svg += `  <g class="umlcanvas-group"${group.color ? ` data-color="${group.color}"` : ""}>\n`;
      svg += `    <rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="6" ry="6" class="group-body" stroke="${groupStroke}" fill="${groupFill}" />\n`;
      if (group.name) {
        svg += `    <text x="${gx + 10}" y="${gy + 18}" class="group-title" fill="${groupStroke}">${escapeXml(group.name)}</text>\n`;
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
          const canvas = document.createElement("canvas");
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
          reject(err);
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
    const dash = styleDef.strokeDasharray ? ` stroke-dasharray="${styleDef.strokeDasharray}"` : "";

    const finalStrokeColor =
      resolveCanvasColorHex(edge.style?.color, theme) ??
      edge.style?.strokeColor ??
      strokeColor;

    const hasColor = edge.style?.color || edge.style?.strokeColor;
    const colorKey = hasColor
      ? (edge.style?.color ?? edge.style?.strokeColor)!.replace(/[^a-zA-Z0-9_-]/g, "_")
      : undefined;

    const markerEndId = styleDef.markerEndId
      ? colorKey
        ? `${styleDef.markerEndId}--color-${colorKey}`
        : styleDef.markerEndId
      : undefined;

    const markerStartId = styleDef.markerStartId
      ? colorKey
        ? `${styleDef.markerStartId}--color-${colorKey}`
        : styleDef.markerStartId
      : undefined;

    const markerEnd = markerEndId ? ` marker-end="url(#${markerEndId})"` : "";
    const markerStart = markerStartId ? ` marker-start="url(#${markerStartId})"` : "";

    let out = `  <g class="umlcanvas-edge"${edge.style?.color ? ` data-color="${edge.style.color}"` : ""}>\n`;
    out += `    <path d="${pathData}" class="edge-path" stroke="${finalStrokeColor}" stroke-width="${strokeW}"${dash}${markerStart}${markerEnd} />\n`;

    // Multiplicity source
    if (edge.multiplicitySource && points.length >= 2) {
      const sp = points[0];
      out += `    <text x="${sp.x + 8}" y="${sp.y - 6}" class="edge-label" font-size="10">${escapeXml(edge.multiplicitySource)}</text>\n`;
    }

    // Multiplicity target
    if (edge.multiplicityTarget && points.length >= 2) {
      const ep = points[points.length - 1];
      out += `    <text x="${ep.x + 8}" y="${ep.y - 6}" class="edge-label" font-size="10">${escapeXml(edge.multiplicityTarget)}</text>\n`;
    }

    // Edge label (midpoint)
    if (edge.labels && edge.labels.length > 0 && points.length >= 2) {
      const midIdx = Math.floor(points.length / 2);
      const midPoint = points[midIdx];
      const labelText = edge.labels.map((l) => l.text).join(", ");
      out += `    <text x="${midPoint.x}" y="${midPoint.y - 8}" text-anchor="middle" class="edge-label">${escapeXml(labelText)}</text>\n`;
    }

    out += `  </g>\n`;
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

    let out = `  <g class="umlcanvas-node"${node.style?.color ? ` data-color="${node.style.color}"` : ""} transform="translate(${x}, ${y})">\n`;

    switch (node.kind) {
      case "uml.usecase": {
        const rx = w / 2;
        const ry = h / 2;
        out += `    <ellipse cx="${rx}" cy="${ry}" rx="${rx}" ry="${ry}" class="node-body"${bodyAttrs} />\n`;
        out += `    <text x="${rx}" y="${ry + 4}" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
        break;
      }

      case "uml.actor": {
        const cx = w / 2;
        out += `    <circle cx="${cx}" cy="14" r="10" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <line x1="${cx}" y1="24" x2="${cx}" y2="46" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <line x1="${cx - 18}" y1="32" x2="${cx + 18}" y2="32" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <line x1="${cx}" y1="46" x2="${cx - 14}" y2="68" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <line x1="${cx}" y1="46" x2="${cx + 14}" y2="68" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <text x="${cx}" y="${h - 4}" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
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
        out += `    <text x="${w / 2}" y="24" text-anchor="middle" class="node-st">«${escapeXml(node.stereotype || "component")}»</text>\n`;
        out += `    <text x="${w / 2}" y="48" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
        break;
      }

      case "uml.lollipop": {
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(cx, cy) - 2;
        out += `    <circle cx="${cx}" cy="${cy}" r="${r}" class="node-body" stroke-width="2" />\n`;
        out += `    <text x="${cx}" y="${h + 14}" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
        break;
      }

      case "uml.socket": {
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(cx, cy) - 2;
        out += `    <path d="M ${cx},${cy - r} A ${r},${r} 0 0,0 ${cx},${cy + r}" fill="none" stroke="${strokeColor}" stroke-width="2" />\n`;
        out += `    <text x="${cx}" y="${h + 14}" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
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
        out += `    <text x="${(w - d) / 2}" y="${d + 20}" text-anchor="middle" class="node-st">«${escapeXml(st)}»</text>\n`;
        out += `    <text x="${(w - d) / 2}" y="${d + 42}" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
        break;
      }

      case "uml.artifact": {
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="2" class="node-body" />\n`;
        const docX = w - 24;
        const docY = 8;
        out += `    <path d="M ${docX},${docY} L ${docX + 10},${docY} L ${docX + 16},${docY + 6} L ${docX + 16},${docY + 20} L ${docX},${docY + 20} Z" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1" />\n`;
        out += `    <path d="M ${docX + 10},${docY} L ${docX + 10},${docY + 6} L ${docX + 16},${docY + 6}" fill="none" stroke="${strokeColor}" stroke-width="1" />\n`;
        out += `    <text x="${w / 2}" y="24" text-anchor="middle" class="node-st">«${escapeXml(node.stereotype || "artifact")}»</text>\n`;
        out += `    <text x="${w / 2}" y="46" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
        break;
      }

      case "timing.lane": {
        const headerW = 110;
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="2" class="node-body" />\n`;
        out += `    <line x1="${headerW}" y1="0" x2="${headerW}" y2="${h}" class="comp-divider" />\n`;
        out += `    <text x="${headerW / 2}" y="${h / 2 + 4}" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
        out += `    <line x1="${headerW}" y1="${h * 0.33}" x2="${w}" y2="${h * 0.33}" stroke="${strokeColor}" stroke-dasharray="4 4" stroke-width="1" />\n`;
        out += `    <line x1="${headerW}" y1="${h * 0.67}" x2="${w}" y2="${h * 0.67}" stroke="${strokeColor}" stroke-dasharray="4 4" stroke-width="1" />\n`;
        break;
      }

      case "timing.stateSegment": {
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="3" class="node-body" fill="rgba(120, 100, 255, 0.2)" />\n`;
        out += `    <text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
        break;
      }

      case "schematic.chip": {
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="4" class="node-body" stroke-width="2" />\n`;
        out += `    <path d="M ${w / 2 - 8},0 A 8,8 0 0,0 ${w / 2 + 8},0" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;

        for (const port of node.ports) {
          const portLabel = port.dataType ? `${port.name} [${port.dataType}]` : port.name;
          if (port.side === "left") {
            const py = Math.round(h * port.offset);
            out += `    <line x1="-6" y1="${py}" x2="0" y2="${py}" stroke="${strokeColor}" stroke-width="2" />\n`;
            out += `    <text x="6" y="${py + 3.5}" class="comp-item" font-size="9">▶ ${escapeXml(portLabel)}</text>\n`;
          } else if (port.side === "right") {
            const py = Math.round(h * port.offset);
            out += `    <line x1="${w}" y1="${py}" x2="${w + 6}" y2="${py}" stroke="${strokeColor}" stroke-width="2" />\n`;
            out += `    <text x="${w - 6}" y="${py + 3.5}" text-anchor="end" class="comp-item" font-size="9">${escapeXml(portLabel)} ▶</text>\n`;
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
        out += `    <text x="${w / 2}" y="${tabH + 24}" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
        break;
      }

      case "uml.compositeClassifier": {
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="8" class="node-body" />\n`;
        out += `    <line x1="0" y1="34" x2="${w}" y2="34" class="comp-divider" />\n`;
        out += `    <text x="${w / 2}" y="22" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
        break;
      }

      case "uml.part": {
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="2" class="node-body" />\n`;
        out += `    <text x="${w / 2}" y="${h / 2 + 5}" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
        break;
      }

      case "interaction.frame": {
        const tabW = Math.min(80, w * 0.4);
        const tabH = 22;
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="2" class="node-body" />\n`;
        out += `    <path d="M 0,0 L ${tabW},0 L ${tabW + 8},${tabH / 2} L ${tabW},${tabH} L 0,${tabH} Z" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
        out += `    <text x="${tabW / 2}" y="15" text-anchor="middle" font-size="10" font-weight="bold" fill="${strokeColor}">sd</text>\n`;
        out += `    <text x="${tabW + 16}" y="16" class="node-title">${escapeXml(title)}</text>\n`;
        if (node.childDiagramId) {
          out += `    <rect x="${w - 22}" y="6" width="16" height="16" rx="3" fill="${nodeBg}" stroke="${accentColor}" stroke-width="1" />\n`;
          out += `    <text x="${w - 14}" y="18" text-anchor="middle" fill="${accentColor}" font-size="11">⤢</text>\n`;
        }
        break;
      }

      case "interaction.occurrence": {
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="4" class="node-body" />\n`;
        out += `    <text x="8" y="18" class="node-st">ref</text>\n`;
        out += `    <text x="${w / 2}" y="${h / 2 + 5}" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
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
        out += `    <text x="${cx}" y="10" text-anchor="middle" class="node-title" font-size="10">${escapeXml(title || "VCC")}</text>\n`;
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

      default: {
        // Standard class or generic rectangle with compartments
        out += `    <rect x="0" y="0" width="${w}" height="${h}" rx="2" class="node-body"${bodyAttrs} />\n`;
        let curY = 18;
        if (node.stereotype) {
          out += `    <text x="${w / 2}" y="${curY}" text-anchor="middle" class="node-st">«${escapeXml(node.stereotype)}»</text>\n`;
          curY += 16;
        }
        out += `    <text x="${w / 2}" y="${curY}" text-anchor="middle" class="node-title">${escapeXml(title)}</text>\n`;
        curY += 8;

        if (node.compartments && node.compartments.length > 0) {
          for (const comp of node.compartments) {
            out += `    <line x1="0" y1="${curY}" x2="${w}" y2="${curY}" class="comp-divider" />\n`;
            curY += 14;
            for (const item of comp.items) {
              const vis = item.visibility ? `${item.visibility} ` : "";
              out += `    <text x="8" y="${curY}" class="comp-item">${escapeXml(vis + item.text)}</text>\n`;
              curY += 14;
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
