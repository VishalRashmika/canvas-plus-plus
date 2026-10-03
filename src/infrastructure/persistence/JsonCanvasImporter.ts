import { Diagram, createDiagram } from "../../domain/entities/Diagram";
import { createDiagramNode } from "../../domain/entities/DiagramNode";
import { createDiagramEdge } from "../../domain/entities/DiagramEdge";
import { createGroup } from "../../domain/entities/Group";
import { Compartment } from "../../domain/entities/Compartment";
import { Side, Visibility } from "../../domain/types";

export interface PlainCanvasNode {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
}

export interface PlainCanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: Side;
  fromEnd?: string;
  toNode: string;
  toSide?: Side;
  toEnd?: string;
  color?: string;
  label?: string;
}

export interface PlainCanvasData {
  nodes?: PlainCanvasNode[];
  edges?: PlainCanvasEdge[];
}

export class JsonCanvasImporter {
  /**
   * Imports a plain Obsidian .canvas (JSON Canvas) string into a UML Diagram entity (F-023).
   */
  importCanvas(
    jsonString: string,
    options?: { diagramId?: string; title?: string; targetType?: string }
  ): Diagram {
    let data: PlainCanvasData;
    try {
      data = JSON.parse(jsonString) as PlainCanvasData;
    } catch {
      throw new Error("Failed to parse .canvas file: invalid JSON format");
    }

    if (!data || typeof data !== "object") {
      throw new Error("Invalid .canvas file: expected top-level object");
    }

    const rawNodes = Array.isArray(data.nodes) ? data.nodes : [];
    const rawEdges = Array.isArray(data.edges) ? data.edges : [];

    const diagramId =
      options?.diagramId ?? `imported-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const title = options?.title ?? "Imported Canvas";
    const diagramType = options?.targetType ?? "uml.class";

    const diagram = createDiagram({
      id: diagramId,
      diagramType,
      title,
    });

    const standardNodes: PlainCanvasNode[] = [];
    const groupNodes: PlainCanvasNode[] = [];

    for (const n of rawNodes) {
      if (n.type === "group") {
        groupNodes.push(n);
      } else {
        standardNodes.push(n);
      }
    }

    // Convert standard nodes
    for (const rawNode of standardNodes) {
      const parsed = this.parseNodeContent(rawNode);
      const node = createDiagramNode({
        id: rawNode.id,
        kind: parsed.kind,
        position: { x: rawNode.x, y: rawNode.y },
        size: { width: rawNode.width, height: rawNode.height },
        labels: [
          {
            id: `label-${rawNode.id}`,
            text: parsed.title,
            anchor: "node",
            position: { x: 0, y: 0 },
          },
        ],
        compartments: parsed.compartments,
        stereotype: parsed.stereotype,
        style: rawNode.color ? { color: rawNode.color } : undefined,
        metadata: parsed.filePath ? { filePath: parsed.filePath } : undefined,
        customData: parsed.filePath ? { filePath: parsed.filePath } : undefined,
      });

      diagram.nodes.push(node);
    }

    // Convert groups: in JSON Canvas, groups contain nodes bounded inside them
    for (const g of groupNodes) {
      const containedNodeIds: string[] = [];
      const gX = g.x;
      const gY = g.y;
      const gW = g.width;
      const gH = g.height;

      for (const node of diagram.nodes) {
        // Node center falls within group
        const cx = node.position.x + node.size.width / 2;
        const cy = node.position.y + node.size.height / 2;
        if (cx >= gX && cx <= gX + gW && cy >= gY && cy <= gY + gH) {
          containedNodeIds.push(node.id);
        }
      }

      diagram.groups.push(
        createGroup({
          id: g.id,
          name: g.label ?? "Group",
          nodeIds: containedNodeIds,
          color: g.color,
          position: { x: g.x, y: g.y },
          size: { width: g.width, height: g.height },
        })
      );
    }

    // Convert edges
    for (const e of rawEdges) {
      const labels = e.label
        ? [
            {
              id: `label-${e.id}`,
              text: e.label,
              anchor: "edge" as const,
              position: { x: 0, y: -10 },
            },
          ]
        : [];

      const edge = createDiagramEdge({
        id: e.id,
        kind: "uml.association",
        fromNodeId: e.fromNode,
        toNodeId: e.toNode,
        fromSide: e.fromSide,
        toSide: e.toSide,
        routing: "orthogonal",
        labels,
        style: e.color ? { color: e.color } : undefined,
      });

      diagram.edges.push(edge);
    }

    return diagram;
  }

  private parseNodeContent(raw: PlainCanvasNode): {
    title: string;
    kind: string;
    stereotype?: string;
    compartments?: Compartment[];
    filePath?: string;
  } {
    if (raw.type === "file") {
      const fileName = raw.file ? raw.file.replace(/\.[^/.]+$/, "").split("/").pop() ?? "Note" : "Note";
      return {
        title: fileName,
        kind: "obsidian.note",
        filePath: raw.file,
      };
    }

    if (raw.type === "link") {
      return {
        title: raw.url ?? "Link",
        kind: "generic.rectangle",
      };
    }

    const text = raw.text ?? "";
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      return { title: "Untitled", kind: "generic.rectangle" };
    }

    // Check first line for title / stereotype / markdown header
    let lineIdx = 0;
    let rawTitle = lines[0];
    let stereotype: string | undefined;

    // Extract stereotype if present, e.g. «interface» or <<interface>>
    const stereoMatch = rawTitle.match(/^[«<]{1,2}([^»>]+)[»>]{1,2}\s*(.*)$/);
    if (stereoMatch) {
      stereotype = stereoMatch[1].trim();
      const restOfLine = stereoMatch[2].trim();
      if (restOfLine) {
        rawTitle = restOfLine;
        lineIdx = 1;
      } else if (lines.length > 1) {
        rawTitle = lines[1];
        lineIdx = 2;
      } else {
        rawTitle = "Untitled";
        lineIdx = 1;
      }
    } else {
      lineIdx = 1;
    }

    const title = rawTitle.replace(/^#+\s*/, "");

    // Check if remaining lines are UML compartment items (+, -, #, ~)
    const attributeItems: { visibility: Visibility; text: string }[] = [];
    const methodItems: { visibility: Visibility; text: string }[] = [];

    const visibilityMarkers = new Set<string>(["+", "-", "#", "~"]);

    for (let i = lineIdx; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("---") || line.startsWith("***")) {
        continue;
      }
      const firstChar = line[0];
      if (visibilityMarkers.has(firstChar)) {
        const vis = firstChar as Visibility;
        const itemText = line.substring(1).trim();
        if (itemText.includes("(") && itemText.includes(")")) {
          methodItems.push({ visibility: vis, text: itemText });
        } else {
          attributeItems.push({ visibility: vis, text: itemText });
        }
      }
    }

    const compartments: Compartment[] = [];
    if (attributeItems.length > 0) {
      compartments.push({ title: "attributes", items: attributeItems });
    }
    if (methodItems.length > 0) {
      compartments.push({ title: "methods", items: methodItems });
    }

    const isClassLike = compartments.length > 0 || Boolean(stereotype);
    return {
      title: title || "Untitled",
      kind: isClassLike ? "uml.class" : "generic.rectangle",
      stereotype,
      compartments: compartments.length > 0 ? compartments : undefined,
    };
  }
}

export const defaultJsonCanvasImporter = new JsonCanvasImporter();
