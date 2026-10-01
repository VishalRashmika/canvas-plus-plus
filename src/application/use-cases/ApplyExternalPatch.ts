import { Id } from "../../domain/types";
import { Diagram, resolveEditPermission } from "../../domain/entities/Diagram";
import {
  DiagramPatch,
  PatchResult,
  PatchOperation,
} from "../ports/CliBridgePort";
import { DiagramRepository } from "../ports/DiagramRepository";
import { JsonCanvasSerializer } from "../../infrastructure/persistence/JsonCanvasSerializer";
import { computeSha256 } from "../../infrastructure/cli-bridge/HashUtils";

export interface ApplyPatchOptions {
  currentDiagram?: Diagram;
  rawContent?: string;
}

/**
 * Use-case implementing F-082 (edit permission scoping) and F-083 (conflict handling)
 * for incoming Antigravity CLI patches.
 */
export class ApplyExternalPatch {
  private serializer = new JsonCanvasSerializer();

  constructor(
    private readonly repository: DiagramRepository,
    private readonly hashFn: (content: string) => string = computeSha256
  ) {}

  async apply(
    patch: DiagramPatch,
    options?: ApplyPatchOptions
  ): Promise<PatchResult> {
    // 1. Resolve target diagram
    let diagram: Diagram;
    if (options?.currentDiagram) {
      diagram = JSON.parse(JSON.stringify(options.currentDiagram));
    } else {
      try {
        diagram = await this.repository.load(patch.targetDiagramId);
      } catch {
        return {
          accepted: false,
          reason: "unknown-target",
        };
      }
    }

    // 2. Validate base schema version
    if (patch.baseSchemaVersion !== diagram.schemaVersion) {
      return {
        accepted: false,
        reason: "invalid-schema",
      };
    }

    // 3. Conflict Handling (F-083): verify expectedFileHash
    if (patch.expectedFileHash) {
      let contentToHash = options?.rawContent;
      if (!contentToHash) {
        contentToHash = this.serializer.serialize(diagram, true);
      }
      const actualHash = this.hashFn(contentToHash);

      if (actualHash !== patch.expectedFileHash) {
        const altHash = this.hashFn(this.serializer.serialize(diagram, false));
        if (altHash !== patch.expectedFileHash) {
          return {
            accepted: false,
            reason: "stale-base",
          };
        }
      }
    }

    // 4. Permission Scoping (F-082): resolve permissions for every touched entity
    const offendingIds: Id[] = [];

    for (const op of patch.operations) {
      this.checkOperationPermission(diagram, op, offendingIds);
    }

    if (offendingIds.length > 0) {
      return {
        accepted: false,
        reason: "permission-denied",
        offendingIds: Array.from(new Set(offendingIds)),
      };
    }

    // 5. Apply operations atomically
    for (const op of patch.operations) {
      this.executeOperation(diagram, op);
    }

    // 6. Persist changes to repository
    await this.repository.save(diagram);

    return {
      accepted: true,
    };
  }

  private checkOperationPermission(
    diagram: Diagram,
    op: PatchOperation,
    offendingIds: Id[]
  ): void {
    switch (op.op) {
      case "addNode": {
        const perm = resolveEditPermission(diagram, op.node.id);
        if (perm === "user" || perm === "none") {
          offendingIds.push(op.node.id);
        }
        break;
      }

      case "updateNode":
      case "deleteNode": {
        const perm = resolveEditPermission(diagram, op.nodeId);
        if (perm === "user" || perm === "none") {
          offendingIds.push(op.nodeId);
        }
        break;
      }

      case "addEdge": {
        const fromPerm = resolveEditPermission(diagram, op.edge.fromNodeId);
        const toPerm = resolveEditPermission(diagram, op.edge.toNodeId);
        const edgePerm = diagram.editPermissions.overrides[op.edge.id];

        if (edgePerm === "user" || edgePerm === "none") {
          offendingIds.push(op.edge.id);
        } else if (fromPerm === "user" || fromPerm === "none") {
          offendingIds.push(op.edge.fromNodeId);
        } else if (toPerm === "user" || toPerm === "none") {
          offendingIds.push(op.edge.toNodeId);
        }
        break;
      }

      case "updateEdge":
      case "deleteEdge": {
        const edgeOverride = diagram.editPermissions.overrides[op.edgeId];
        if (edgeOverride === "user" || edgeOverride === "none") {
          offendingIds.push(op.edgeId);
        } else {
          // If no edge override, check endpoints of existing edge
          const existingEdge = diagram.edges.find((e) => e.id === op.edgeId);
          if (existingEdge) {
            const fromPerm = resolveEditPermission(diagram, existingEdge.fromNodeId);
            const toPerm = resolveEditPermission(diagram, existingEdge.toNodeId);
            if (fromPerm === "user" || fromPerm === "none") {
              offendingIds.push(existingEdge.fromNodeId);
            } else if (toPerm === "user" || toPerm === "none") {
              offendingIds.push(existingEdge.toNodeId);
            }
          } else if (diagram.editPermissions.default === "user" || diagram.editPermissions.default === "none") {
            offendingIds.push(op.edgeId);
          }
        }
        break;
      }
    }
  }

  private executeOperation(diagram: Diagram, op: PatchOperation): void {
    switch (op.op) {
      case "addNode": {
        const existingIdx = diagram.nodes.findIndex((n) => n.id === op.node.id);
        if (existingIdx >= 0) {
          diagram.nodes[existingIdx] = op.node;
        } else {
          diagram.nodes.push(op.node);
        }
        break;
      }

      case "updateNode": {
        const node = diagram.nodes.find((n) => n.id === op.nodeId);
        if (node) {
          Object.assign(node, op.changes, { id: node.id });
        }
        break;
      }

      case "deleteNode": {
        diagram.nodes = diagram.nodes.filter((n) => n.id !== op.nodeId);
        // Cascade delete connected edges
        diagram.edges = diagram.edges.filter(
          (e) => e.fromNodeId !== op.nodeId && e.toNodeId !== op.nodeId
        );
        // Remove from groups and layers
        for (const g of diagram.groups) {
          g.nodeIds = g.nodeIds.filter((id) => id !== op.nodeId);
        }
        for (const l of diagram.layers) {
          l.nodeIds = l.nodeIds.filter((id) => id !== op.nodeId);
        }
        break;
      }

      case "addEdge": {
        const existingIdx = diagram.edges.findIndex((e) => e.id === op.edge.id);
        if (existingIdx >= 0) {
          diagram.edges[existingIdx] = op.edge;
        } else {
          diagram.edges.push(op.edge);
        }
        break;
      }

      case "updateEdge": {
        const edge = diagram.edges.find((e) => e.id === op.edgeId);
        if (edge) {
          Object.assign(edge, op.changes, { id: edge.id });
        }
        break;
      }

      case "deleteEdge": {
        diagram.edges = diagram.edges.filter((e) => e.id !== op.edgeId);
        break;
      }
    }
  }
}
