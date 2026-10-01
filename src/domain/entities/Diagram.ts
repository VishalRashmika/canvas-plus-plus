import { Id, DiagramTypeId, EditPermission } from "../types";
import { DiagramNode } from "./DiagramNode";
import { DiagramEdge } from "./DiagramEdge";
import { Layer } from "./Layer";
import { Group } from "./Group";

/**
 * Per-entity edit-permission overrides, keyed by node/group/layer id.
 * Resolution order (most specific wins): node > group > layer > default.
 * See docs/08-CLI-INTEGRATION-SPEC.md "Permission model".
 */
export interface EditPermissionMap {
  default: EditPermission;
  overrides: Record<Id, EditPermission>;
}

export function defaultEditPermissionMap(): EditPermissionMap {
  return { default: "both", overrides: {} };
}

/**
 * The aggregate root for a single diagram file. Mirrors
 * docs/07-FILE-FORMAT-SPEC.md schema v1 exactly — the serializer in
 * infrastructure/persistence should be a near-identity transform of this
 * shape, not a reinterpretation of it.
 */
export interface Diagram {
  readonly id: Id;
  diagramType: DiagramTypeId;
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  layers: Layer[];
  groups: Group[];
  editPermissions: EditPermissionMap;
  schemaVersion: number;
}

export const CURRENT_SCHEMA_VERSION = 1;

export function createDiagram(params: {
  id: Id;
  diagramType: DiagramTypeId;
  title?: string;
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
  layers?: Layer[];
  groups?: Group[];
  editPermissions?: EditPermissionMap;
}): Diagram {
  return {
    id: params.id,
    diagramType: params.diagramType,
    title: params.title ?? "Untitled Diagram",
    nodes: params.nodes ?? [],
    edges: params.edges ?? [],
    layers: params.layers ?? [],
    groups: params.groups ?? [],
    editPermissions: params.editPermissions ?? defaultEditPermissionMap(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

/**
 * Resolves the effective edit permission for a node, applying the
 * node > group > layer > default precedence. Pure function — the
 * ApplyExternalPatch use-case (application layer) is the caller that
 * matters, but this lives in domain because the resolution *rule* is a
 * domain concept, not an infrastructure detail.
 */
export function resolveEditPermission(
  diagram: Diagram,
  nodeId: Id
): EditPermission {
  const nodeOverride = diagram.editPermissions.overrides[nodeId];
  if (nodeOverride) return nodeOverride;

  const owningGroup = diagram.groups.find((g) => g.nodeIds.includes(nodeId));
  if (owningGroup) {
    const groupOverride = diagram.editPermissions.overrides[owningGroup.id];
    if (groupOverride) return groupOverride;
  }

  const owningLayer = diagram.layers.find((l) => l.nodeIds.includes(nodeId));
  if (owningLayer) {
    const layerOverride = diagram.editPermissions.overrides[owningLayer.id];
    if (layerOverride) return layerOverride;
  }

  return diagram.editPermissions.default;
}
