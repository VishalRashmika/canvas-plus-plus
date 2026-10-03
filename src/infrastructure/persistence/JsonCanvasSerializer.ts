import {
  Diagram,
  CURRENT_SCHEMA_VERSION,
  defaultEditPermissionMap,
  createDiagram,
} from "../../domain/entities/Diagram";
import { DiagramNode, NodeStyle, createDiagramNode } from "../../domain/entities/DiagramNode";
import { DiagramEdge, EdgeStyle, createDiagramEdge } from "../../domain/entities/DiagramEdge";
import { Layer, createLayer } from "../../domain/entities/Layer";
import { Group, createGroup } from "../../domain/entities/Group";
import { Port } from "../../domain/entities/Port";
import { Label } from "../../domain/entities/Label";
import { Compartment } from "../../domain/entities/Compartment";
import { Point } from "../../domain/value-objects/Point";
import { EditPermissionMap } from "../../domain/entities/Diagram";
import { EditPermission } from "../../domain/types";
import { SchemaMigrator, defaultSchemaMigrator } from "./SchemaMigration";

export class InvalidDiagramJsonError extends Error {
  constructor(message: string) {
    super(`Invalid .umlcanvas JSON: ${message}`);
    this.name = "InvalidDiagramJsonError";
  }
}

export class UnsupportedSchemaVersionError extends Error {
  constructor(public readonly version: unknown) {
    super(
      `Unsupported schema version: ${String(
        version
      )}. Expected version ${CURRENT_SCHEMA_VERSION}.`
    );
    this.name = "UnsupportedSchemaVersionError";
  }
}

const VALID_PERMISSIONS: ReadonlySet<string> = new Set<EditPermission>([
  "user",
  "antigravity",
  "both",
  "none",
]);

export class JsonCanvasSerializer {
  constructor(
    private readonly migrator: SchemaMigrator = defaultSchemaMigrator
  ) {}
  /**
   * Serializes a domain Diagram into a JSON string conforming to
   * schemas/umlcanvas.schema.json (schema v1).
   */
  serialize(diagram: Diagram, pretty = true): string {
    const payload = {
      schemaVersion: diagram.schemaVersion ?? CURRENT_SCHEMA_VERSION,
      id: diagram.id,
      diagramType: diagram.diagramType,
      title: diagram.title,
      nodes: diagram.nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        position: { x: node.position.x, y: node.position.y },
        size: { width: node.size.width, height: node.size.height },
        ports: node.ports ?? [],
        labels: node.labels ?? [],
        compartments: node.compartments,
        stereotype: node.stereotype,
        taggedValues: node.taggedValues,
        style: node.style,
        childDiagramId: node.childDiagramId,
        metadata: node.metadata ?? {},
      })),
      edges: diagram.edges.map((edge) => ({
        id: edge.id,
        kind: edge.kind,
        fromNodeId: edge.fromNodeId,
        fromPortId: edge.fromPortId,
        fromSide: edge.fromSide,
        toNodeId: edge.toNodeId,
        toPortId: edge.toPortId,
        toSide: edge.toSide,
        routing: edge.routing,
        waypoints: edge.waypoints,
        labels: edge.labels ?? [],
        sequenceOrder: edge.sequenceOrder,
        multiplicitySource: edge.multiplicitySource,
        multiplicityTarget: edge.multiplicityTarget,
        style: edge.style,
      })),
      layers: diagram.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        nodeIds: [...layer.nodeIds],
      })),
      groups: diagram.groups.map((group) => ({
        id: group.id,
        name: group.name,
        nodeIds: [...group.nodeIds],
        collapsed: group.collapsed,
        color: group.color,
        position: group.position,
        size: group.size,
        locked: group.locked,
      })),
      editPermissions: {
        default: diagram.editPermissions?.default ?? "both",
        overrides: diagram.editPermissions?.overrides
          ? { ...diagram.editPermissions.overrides }
          : {},
      },
    };

    return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
  }

  /**
   * Deserializes a JSON string into a validated domain Diagram aggregate.
   * Throws InvalidDiagramJsonError or UnsupportedSchemaVersionError if invalid.
   */
  deserialize(jsonString: string): Diagram {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch (err) {
      throw new InvalidDiagramJsonError(
        `Failed to parse JSON string: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new InvalidDiagramJsonError("Root must be a JSON object");
    }

    const rawRecord = parsed as Record<string, unknown>;

    if (typeof rawRecord.schemaVersion !== "number") {
      throw new InvalidDiagramJsonError("Missing required field 'schemaVersion'");
    }

    let record = rawRecord;
    if (rawRecord.schemaVersion < CURRENT_SCHEMA_VERSION) {
      record = this.migrator.migrate(rawRecord, CURRENT_SCHEMA_VERSION);
    } else if (rawRecord.schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new UnsupportedSchemaVersionError(rawRecord.schemaVersion);
    }

    if (typeof record.id !== "string" || record.id.trim() === "") {
      throw new InvalidDiagramJsonError("Missing or invalid required field 'id'");
    }

    if (
      typeof record.diagramType !== "string" ||
      record.diagramType.trim() === ""
    ) {
      throw new InvalidDiagramJsonError(
        "Missing or invalid required field 'diagramType'"
      );
    }

    const title = typeof record.title === "string" ? record.title : "Untitled Diagram";

    // Nodes
    const nodes: DiagramNode[] = [];
    if (record.nodes !== undefined) {
      if (!Array.isArray(record.nodes)) {
        throw new InvalidDiagramJsonError("'nodes' must be an array");
      }
      const rawNodes = record.nodes as unknown[];
      for (let i = 0; i < rawNodes.length; i++) {
        const rawNode: unknown = rawNodes[i];
        if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
          throw new InvalidDiagramJsonError(`Node at index ${i} must be an object`);
        }
        const nr = rawNode as Record<string, unknown>;
        if (typeof nr.id !== "string" || !nr.id) {
          throw new InvalidDiagramJsonError(`Node at index ${i} missing valid 'id'`);
        }
        if (typeof nr.kind !== "string" || !nr.kind) {
          throw new InvalidDiagramJsonError(`Node at index ${i} missing valid 'kind'`);
        }
        const pos = nr.position as { x?: unknown; y?: unknown } | undefined;
        if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") {
          throw new InvalidDiagramJsonError(
            `Node '${nr.id}' missing valid 'position' with numeric x and y`
          );
        }
        const size = nr.size as { width?: unknown; height?: unknown } | undefined;
        if (!size || typeof size.width !== "number" || typeof size.height !== "number") {
          throw new InvalidDiagramJsonError(
            `Node '${nr.id}' missing valid 'size' with numeric width and height`
          );
        }

        nodes.push(
          createDiagramNode({
            id: nr.id,
            kind: nr.kind,
            position: { x: pos.x, y: pos.y },
            size: { width: size.width, height: size.height },
            ports: Array.isArray(nr.ports) ? (nr.ports as Port[]) : [],
            labels: Array.isArray(nr.labels) ? (nr.labels as Label[]) : [],
            compartments: Array.isArray(nr.compartments)
              ? (nr.compartments as Compartment[])
              : undefined,
            stereotype:
              typeof nr.stereotype === "string" ? nr.stereotype : undefined,
            taggedValues:
              nr.taggedValues && typeof nr.taggedValues === "object"
                ? (nr.taggedValues as Record<string, string>)
                : undefined,
            style:
              nr.style && typeof nr.style === "object"
                ? (nr.style as NodeStyle)
                : undefined,
            childDiagramId:
              typeof nr.childDiagramId === "string"
                ? nr.childDiagramId
                : undefined,
            metadata:
              nr.metadata && typeof nr.metadata === "object"
                ? (nr.metadata as Record<string, unknown>)
                : {},
          })
        );
      }
    }

    // Edges
    const edges: DiagramEdge[] = [];
    if (record.edges !== undefined) {
      if (!Array.isArray(record.edges)) {
        throw new InvalidDiagramJsonError("'edges' must be an array");
      }
      const rawEdges = record.edges as unknown[];
      for (let i = 0; i < rawEdges.length; i++) {
        const rawEdge: unknown = rawEdges[i];
        if (!rawEdge || typeof rawEdge !== "object" || Array.isArray(rawEdge)) {
          throw new InvalidDiagramJsonError(`Edge at index ${i} must be an object`);
        }
        const er = rawEdge as Record<string, unknown>;
        if (typeof er.id !== "string" || !er.id) {
          throw new InvalidDiagramJsonError(`Edge at index ${i} missing valid 'id'`);
        }
        if (typeof er.fromNodeId !== "string" || !er.fromNodeId) {
          throw new InvalidDiagramJsonError(
            `Edge '${er.id}' missing valid 'fromNodeId'`
          );
        }
        if (typeof er.toNodeId !== "string" || !er.toNodeId) {
          throw new InvalidDiagramJsonError(`Edge '${er.id}' missing valid 'toNodeId'`);
        }

        const routing =
          er.routing === "orthogonal" || er.routing === "curved"
            ? er.routing
            : "straight";

        edges.push(
          createDiagramEdge({
            id: er.id,
            kind: typeof er.kind === "string" && er.kind ? er.kind : "generic.edge",
            fromNodeId: er.fromNodeId,
            toNodeId: er.toNodeId,
            fromPortId:
              typeof er.fromPortId === "string" ? er.fromPortId : undefined,
            fromSide:
              er.fromSide === "top" ||
              er.fromSide === "right" ||
              er.fromSide === "bottom" ||
              er.fromSide === "left"
                ? er.fromSide
                : undefined,
            toPortId: typeof er.toPortId === "string" ? er.toPortId : undefined,
            toSide:
              er.toSide === "top" ||
              er.toSide === "right" ||
              er.toSide === "bottom" ||
              er.toSide === "left"
                ? er.toSide
                : undefined,
            routing,
            waypoints: Array.isArray(er.waypoints) ? (er.waypoints as Point[]) : undefined,
            labels: Array.isArray(er.labels) ? (er.labels as Label[]) : [],
            sequenceOrder:
              typeof er.sequenceOrder === "number" ? er.sequenceOrder : undefined,
            multiplicitySource:
              typeof er.multiplicitySource === "string"
                ? er.multiplicitySource
                : undefined,
            multiplicityTarget:
              typeof er.multiplicityTarget === "string"
                ? er.multiplicityTarget
                : undefined,
            style:
              er.style && typeof er.style === "object" ? (er.style as EdgeStyle) : undefined,
          })
        );
      }
    }

    // Layers
    const layers: Layer[] = [];
    if (Array.isArray(record.layers)) {
      for (const rawLayer of record.layers) {
        if (rawLayer && typeof rawLayer === "object" && !Array.isArray(rawLayer)) {
          const lr = rawLayer as Record<string, unknown>;
          if (typeof lr.id === "string" && typeof lr.name === "string") {
            layers.push(
              createLayer({
                id: lr.id,
                name: lr.name,
                visible: lr.visible !== false,
                locked: lr.locked === true,
                nodeIds: Array.isArray(lr.nodeIds) ? (lr.nodeIds as string[]) : [],
              })
            );
          }
        }
      }
    }

    // Groups
    const groups: Group[] = [];
    if (Array.isArray(record.groups)) {
      for (const rawGroup of record.groups) {
        if (rawGroup && typeof rawGroup === "object" && !Array.isArray(rawGroup)) {
          const gr = rawGroup as Record<string, unknown>;
          if (typeof gr.id === "string" && typeof gr.name === "string") {
            groups.push(
              createGroup({
                id: gr.id,
                name: gr.name,
                nodeIds: Array.isArray(gr.nodeIds) ? (gr.nodeIds as string[]) : [],
                collapsed: gr.collapsed === true,
                color: typeof gr.color === "string" ? gr.color : undefined,
                position:
                  gr.position && typeof gr.position === "object"
                    ? {
                        x: Number((gr.position as Record<string, unknown>).x) || 0,
                        y: Number((gr.position as Record<string, unknown>).y) || 0,
                      }
                    : undefined,
                size:
                  gr.size && typeof gr.size === "object"
                    ? {
                        width: Number((gr.size as Record<string, unknown>).width) || 0,
                        height: Number((gr.size as Record<string, unknown>).height) || 0,
                      }
                    : undefined,
                locked: gr.locked === true,
              })
            );
          }
        }
      }
    }

    // Edit permissions
    let editPermissions: EditPermissionMap = defaultEditPermissionMap();
    if (
      record.editPermissions &&
      typeof record.editPermissions === "object" &&
      !Array.isArray(record.editPermissions)
    ) {
      const ep = record.editPermissions as Record<string, unknown>;
      const defaultPerm: EditPermission =
        typeof ep.default === "string" && VALID_PERMISSIONS.has(ep.default)
          ? (ep.default as EditPermission)
          : "both";

      const overrides: Record<string, EditPermission> = {};
      if (ep.overrides && typeof ep.overrides === "object" && !Array.isArray(ep.overrides)) {
        for (const [key, val] of Object.entries(
          ep.overrides as Record<string, unknown>
        )) {
          if (typeof val === "string" && VALID_PERMISSIONS.has(val)) {
            overrides[key] = val as EditPermission;
          }
        }
      }

      editPermissions = {
        default: defaultPerm,
        overrides,
      };
    }

    return createDiagram({
      id: record.id,
      diagramType: record.diagramType,
      title,
      nodes,
      edges,
      layers,
      groups,
      editPermissions,
    });
  }
}
