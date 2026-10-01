import { Diagram } from "../../domain/entities/Diagram";
import { DiagramNode } from "../../domain/entities/DiagramNode";
import { DiagramRepository } from "../ports/DiagramRepository";
import { FileSystemPort } from "../ports/FileSystemPort";
import { Id } from "../../domain/types";

export interface ExportForRAGOptions {
  outputPath?: string;
  ragDir?: string;
}

/**
 * Use-case implementing F-084: RAG export use-case.
 * Serializes a diagram into a chunked, embedding-friendly markdown text bundle
 * designed for LLM context injection and RAG pipelines.
 */
export class ExportForRAG {
  constructor(
    private readonly repository?: DiagramRepository,
    private readonly fs?: FileSystemPort
  ) {}

  /**
   * Generates a chunked, structured markdown bundle for a diagram.
   */
  exportToString(diagram: Diagram): string {
    const lines: string[] = [];

    lines.push(`# Diagram: ${diagram.title || "Untitled Diagram"} (${diagram.diagramType})`);
    lines.push(`ID: ${diagram.id}`);
    lines.push(`SchemaVersion: ${diagram.schemaVersion}`);
    lines.push("");

    // Section: Nodes
    lines.push("## Nodes");
    lines.push("");

    if (diagram.nodes.length === 0) {
      lines.push("*(No nodes)*");
      lines.push("");
    } else {
      for (const node of diagram.nodes) {
        lines.push(this.formatNodeChunk(diagram, node));
        lines.push("");
      }
    }

    // Section: Groups
    if (diagram.groups.length > 0) {
      lines.push("## Groups");
      lines.push("");
      for (const group of diagram.groups) {
        const memberTitles = group.nodeIds.map((id) => this.getNodeTitle(diagram, id));
        lines.push(`- **${group.name || "Unnamed Group"}** (ID: ${group.id}):`);
        lines.push(`  Members: ${memberTitles.length > 0 ? memberTitles.join(", ") : "none"}`);
      }
      lines.push("");
    }

    // Section: Layers
    if (diagram.layers.length > 0) {
      lines.push("## Layers");
      lines.push("");
      for (const layer of diagram.layers) {
        const memberTitles = layer.nodeIds.map((id) => this.getNodeTitle(diagram, id));
        lines.push(`- **${layer.name || "Unnamed Layer"}** (Visible: ${layer.visible}, Locked: ${layer.locked}):`);
        lines.push(`  Members: ${memberTitles.length > 0 ? memberTitles.join(", ") : "none"}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Formats an individual node into an embedding-optimized chunk.
   */
  private formatNodeChunk(diagram: Diagram, node: DiagramNode): string {
    const title = this.getNodeTitle(diagram, node.id);
    const chunkLines: string[] = [];

    chunkLines.push(`### [Node: ${title} (${node.kind})]`);
    chunkLines.push(`ID: ${node.id}`);
    chunkLines.push(`Stereotype: ${node.stereotype ? `«${node.stereotype}»` : "none"}`);

    // Tagged values
    if (node.taggedValues && Object.keys(node.taggedValues).length > 0) {
      const tags = Object.entries(node.taggedValues)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      chunkLines.push(`TaggedValues: {${tags}}`);
    }

    // Compartments (e.g. Attributes, Methods for UML Classes)
    if (node.compartments && node.compartments.length > 0) {
      for (const comp of node.compartments) {
        const compTitle = comp.title || "Items";
        if (comp.items && comp.items.length > 0) {
          const itemsStr = comp.items
            .map((item) => `${item.visibility ? item.visibility + " " : ""}${item.text}`)
            .join(", ");
          chunkLines.push(`${compTitle}: ${itemsStr}`);
        }
      }
    }

    // Chip / Schematic specific interface ports
    if (node.kind === "schematic.chip" && node.ports && node.ports.length > 0) {
      chunkLines.push("Chip Ports:");
      for (const p of node.ports) {
        const dir = p.direction ? ` [${p.direction}]` : "";
        chunkLines.push(`  - ${p.name || p.id}${dir} (${p.side})`);
      }
      if (node.childDiagramId) {
        chunkLines.push(`NestedSchematic: childDiagramId=${node.childDiagramId}`);
      }
    }

    // Relationships (Edges)
    const relationships = this.getNodeRelationships(diagram, node);
    if (relationships.length > 0) {
      chunkLines.push("Relationships:");
      for (const rel of relationships) {
        chunkLines.push(`  - ${rel}`);
      }
    } else {
      chunkLines.push("Relationships: none");
    }

    // Custom metadata (if present)
    if (node.metadata && Object.keys(node.metadata).length > 0) {
      const metaEntries = Object.entries(node.metadata)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(", ");
      chunkLines.push(`Metadata: {${metaEntries}}`);
    }

    return chunkLines.join("\n");
  }

  private getNodeRelationships(diagram: Diagram, node: DiagramNode): string[] {
    const rels: string[] = [];

    for (const edge of diagram.edges) {
      if (edge.fromNodeId === node.id) {
        const targetTitle = this.getNodeTitle(diagram, edge.toNodeId);
        const kind = edge.kind.replace(/^uml\./, "");
        const mult = edge.multiplicityTarget ? ` (multiplicity ${edge.multiplicityTarget})` : "";
        const label = edge.labels && edge.labels[0]?.text ? ` labeled "${edge.labels[0].text}"` : "";
        rels.push(`${kind} -> ${targetTitle}${mult}${label}`);
      } else if (edge.toNodeId === node.id) {
        const sourceTitle = this.getNodeTitle(diagram, edge.fromNodeId);
        const kind = edge.kind.replace(/^uml\./, "");
        const mult = edge.multiplicitySource ? ` (multiplicity ${edge.multiplicitySource})` : "";
        const label = edge.labels && edge.labels[0]?.text ? ` labeled "${edge.labels[0].text}"` : "";
        rels.push(`${kind} <- ${sourceTitle}${mult}${label}`);
      }
    }

    return rels;
  }

  private getNodeTitle(diagram: Diagram, nodeId: Id): string {
    const node = diagram.nodes.find((n) => n.id === nodeId);
    if (!node) return nodeId;
    if (node.labels && node.labels.length > 0 && node.labels[0].text.trim().length > 0) {
      return node.labels[0].text.trim();
    }
    return node.id;
  }

  /**
   * Exports the diagram to a file on disk (defaulting to `.umlcanvas-rag/<diagramId>.rag.md`).
   */
  async exportToFile(
    diagramOrId: Diagram | Id,
    options?: ExportForRAGOptions
  ): Promise<{ path: string; content: string }> {
    let diagram: Diagram;
    if (typeof diagramOrId === "string") {
      if (!this.repository) {
        throw new Error("Repository required to load diagram by ID");
      }
      diagram = await this.repository.load(diagramOrId);
    } else {
      diagram = diagramOrId;
    }

    const content = this.exportToString(diagram);
    const ragDir = options?.ragDir ?? ".umlcanvas-rag";
    const defaultPath = `${ragDir}/${diagram.id}.rag.md`;
    const outputPath = options?.outputPath ?? defaultPath;

    if (this.fs) {
      await this.fs.writeText(outputPath, content);
    }

    return { path: outputPath, content };
  }
}
