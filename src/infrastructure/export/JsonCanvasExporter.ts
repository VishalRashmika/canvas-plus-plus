import { Diagram } from "../../domain/entities/Diagram";
import { DiagramNode } from "../../domain/entities/DiagramNode";
import { PlainCanvasData, PlainCanvasNode, PlainCanvasEdge } from "../persistence/JsonCanvasImporter";

export interface JsonCanvasExportOptions {
  includeStereotypes?: boolean;
  includeCompartments?: boolean;
  pretty?: boolean;
}

export class JsonCanvasExporter {
  /**
   * Exports a UML Diagram aggregate into native Obsidian .canvas (JSON Canvas) format (F-025).
   */
  exportCanvas(diagram: Diagram, options?: JsonCanvasExportOptions): string {
    const pretty = options?.pretty ?? true;
    const plainNodes: PlainCanvasNode[] = [];
    const plainEdges: PlainCanvasEdge[] = [];

    // 1. Convert Groups to group nodes
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

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const n of memberNodes) {
          minX = Math.min(minX, n.position.x);
          minY = Math.min(minY, n.position.y);
          maxX = Math.max(maxX, n.position.x + n.size.width);
          maxY = Math.max(maxY, n.position.y + n.size.height);
        }

        const padding = 16;
        gx = Math.round(minX - padding);
        gy = Math.round(minY - padding - 22);
        gw = Math.round(maxX - minX + padding * 2);
        gh = Math.round(maxY - minY + padding * 2 + 22);
      }

      plainNodes.push({
        id: group.id,
        type: "group",
        x: Math.round(gx),
        y: Math.round(gy),
        width: Math.round(gw),
        height: Math.round(gh),
        label: group.name,
        color: group.color,
      });
    }

    // 2. Convert DiagramNodes to text or file nodes
    for (const node of diagram.nodes) {
      const filePath =
        (node.metadata?.filePath as string) ||
        (node.customData?.filePath as string);

      if (node.kind === "obsidian.note" && filePath) {
        plainNodes.push({
          id: node.id,
          type: "file",
          file: filePath,
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
          width: Math.round(node.size.width),
          height: Math.round(node.size.height),
          color: node.style?.color,
        });
        continue;
      }

      const textContent = this.formatNodeMarkdown(node, options);
      plainNodes.push({
        id: node.id,
        type: "text",
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        width: Math.round(node.size.width),
        height: Math.round(node.size.height),
        text: textContent,
        color: node.style?.color,
      });
    }

    // 3. Convert DiagramEdges
    for (const edge of diagram.edges) {
      const edgeLabelParts: string[] = [];

      if (edge.multiplicitySource) {
        edgeLabelParts.push(`[${edge.multiplicitySource}]`);
      }
      if (edge.labels && edge.labels.length > 0) {
        edgeLabelParts.push(edge.labels.map((l) => l.text).join(", "));
      }
      if (edge.multiplicityTarget) {
        edgeLabelParts.push(`[${edge.multiplicityTarget}]`);
      }

      const label = edgeLabelParts.length > 0 ? edgeLabelParts.join(" ") : undefined;

      const plainEdge: PlainCanvasEdge = {
        id: edge.id,
        fromNode: edge.fromNodeId,
        fromSide: edge.fromSide ?? "right",
        toNode: edge.toNodeId,
        toSide: edge.toSide ?? "left",
        color: edge.style?.color,
      };

      if (label) {
        plainEdge.label = label;
      }

      // If it's a directed edge, indicate arrow on end
      if (
        edge.kind.includes("dependency") ||
        edge.kind.includes("generalization") ||
        edge.kind.includes("realization") ||
        edge.kind.includes("message") ||
        edge.kind.includes("controlFlow") ||
        edge.kind.includes("transition") ||
        edge.kind.includes("include") ||
        edge.kind.includes("extend") ||
        edge.kind.includes("delegation")
      ) {
        plainEdge.toEnd = "arrow";
      }

      plainEdges.push(plainEdge);
    }

    const data: PlainCanvasData = {
      nodes: plainNodes,
      edges: plainEdges,
    };

    return JSON.stringify(data, null, pretty ? 2 : undefined);
  }

  private formatNodeMarkdown(node: DiagramNode, options?: JsonCanvasExportOptions): string {
    const lines: string[] = [];
    const includeStereotypes = options?.includeStereotypes ?? true;
    const includeCompartments = options?.includeCompartments ?? true;

    // Stereotype
    if (includeStereotypes && node.stereotype) {
      lines.push(`«${node.stereotype}»`);
    }

    // Title
    const title = node.labels[0]?.text || node.id;
    lines.push(`### ${title}`);

    // Tagged values
    if (node.taggedValues && Object.keys(node.taggedValues).length > 0) {
      const tags = Object.entries(node.taggedValues)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      lines.push(`{${tags}}`);
    }

    // Compartments
    if (includeCompartments && node.compartments && node.compartments.length > 0) {
      for (const comp of node.compartments) {
        lines.push("---");
        for (const item of comp.items) {
          const vis = item.visibility ? `${item.visibility} ` : "";
          lines.push(`${vis}${item.text}`);
        }
      }
    }

    return lines.join("\n");
  }
}

export const defaultJsonCanvasExporter = new JsonCanvasExporter();
