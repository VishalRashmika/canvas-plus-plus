import { Id, ShapeKind, Side, EdgeRouting } from "../types";
import { Point } from "../value-objects/Point";
import { Label } from "./Label";

export type LineEndingType =
  | "none"
  | "arrow-open"
  | "arrow-filled"
  | "triangle-hollow"
  | "triangle-filled"
  | "diamond-hollow"
  | "diamond-filled"
  | "circle-hollow"
  | "circle-filled"
  | "stop";

export type LinePatternType =
  | "solid"
  | "dashed"
  | "dotted"
  | "dash-dot"
  | "long-dash";

export interface EdgeStyle {
  strokeColor?: string;
  strokeWidth?: number;
  dashed?: boolean;
  color?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  fontWeight?: string | number;
  fontStyle?: "normal" | "italic";
  fontFamily?: string;
  lineType?: LinePatternType;
  strokeDasharray?: string;
  markerStart?: string;
  markerEnd?: string;
}

/**
 * A connection between two nodes (optionally bound to specific ports).
 * `kind` drives arrowhead/line-end decoration via the shared
 * EdgeStyleRegistry (docs/05-UML-DIAGRAM-SPECS.md "Shared rules").
 */
export interface DiagramEdge {
  readonly id: Id;
  kind: ShapeKind;
  fromNodeId: Id;
  fromPortId?: Id;
  fromSide?: Side;
  toNodeId: Id;
  toPortId?: Id;
  toSide?: Side;
  routing: EdgeRouting;
  /** User-adjusted manual routing overrides; absent means "let the router decide". */
  waypoints?: Point[];
  labels: Label[];
  /** Sequence/Communication diagrams only — drives message ordering. */
  sequenceOrder?: number;
  /** UML multiplicity strings, parsed via the Multiplicity value object when rendered. */
  multiplicitySource?: string;
  multiplicityTarget?: string;
  style?: EdgeStyle;
}

export function createDiagramEdge(params: {
  id: Id;
  kind?: ShapeKind;
  fromNodeId: Id;
  toNodeId: Id;
  fromPortId?: Id;
  fromSide?: Side;
  toPortId?: Id;
  toSide?: Side;
  routing?: EdgeRouting;
  waypoints?: Point[];
  labels?: Label[];
  sequenceOrder?: number;
  multiplicitySource?: string;
  multiplicityTarget?: string;
  style?: EdgeStyle;
}): DiagramEdge {
  return {
    id: params.id,
    kind: params.kind ?? "generic.edge",
    fromNodeId: params.fromNodeId,
    fromPortId: params.fromPortId,
    fromSide: params.fromSide,
    toNodeId: params.toNodeId,
    toPortId: params.toPortId,
    toSide: params.toSide,
    routing: params.routing ?? "straight",
    waypoints: params.waypoints,
    labels: params.labels ?? [],
    sequenceOrder: params.sequenceOrder,
    multiplicitySource: params.multiplicitySource,
    multiplicityTarget: params.multiplicityTarget,
    style: params.style,
  };
}
