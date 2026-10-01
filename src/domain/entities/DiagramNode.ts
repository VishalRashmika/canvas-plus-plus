import { Id, ShapeKind } from "../types";
import { Point } from "../value-objects/Point";
import { Size } from "../value-objects/Rect";
import { Port } from "./Port";
import { Label } from "./Label";
import { Compartment } from "./Compartment";

export interface NodeStyle {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  color?: string;
}

/**
 * A node on a diagram — a UML class box, an activity action, a schematic
 * chip instance, etc. `kind` is the ShapeRegistry key that determines how
 * it's drawn and validated; nothing UML-specific is hardcoded on this type
 * itself. See docs/01-ARCHITECTURE.md (ShapeRegistry) and
 * docs/02-DOMAIN-MODEL.md.
 */
export interface DiagramNode {
  readonly id: Id;
  kind: ShapeKind;
  position: Point;
  size: Size;
  ports: Port[];
  labels: Label[];
  /** Only meaningful for kinds that render compartments (uml.class, uml.object). */
  compartments?: Compartment[];
  /** e.g. "interface", "abstract" — rendered via the Stereotype value object. */
  stereotype?: string;
  taggedValues?: Record<string, string>;
  style?: NodeStyle;
  /** Custom data for specialized shapes like generic.freehand (pathData, points). */
  customData?: Record<string, unknown>;
  /**
   * Set when this node is a chip instance (kind "schematic.chip") that
   * drills into a nested Diagram. See docs/06-SCHEMATIC-CHIP-SPEC.md.
   */
  childDiagramId?: Id;
  /** Free-form, consumed by RAG export (F-084) and the CLI bridge; not rendered. */
  metadata: Record<string, unknown>;
}

export function createDiagramNode(params: {
  id: Id;
  kind?: ShapeKind;
  position?: Point;
  size?: Size;
  ports?: Port[];
  labels?: Label[];
  compartments?: Compartment[];
  stereotype?: string;
  taggedValues?: Record<string, string>;
  style?: NodeStyle;
  customData?: Record<string, unknown>;
  childDiagramId?: Id;
  metadata?: Record<string, unknown>;
}): DiagramNode {
  return {
    id: params.id,
    kind: params.kind ?? "uml.class",
    position: params.position ?? { x: 0, y: 0 },
    size: params.size ?? { width: 100, height: 60 },
    ports: params.ports ?? [],
    labels: params.labels ?? [],
    compartments: params.compartments,
    stereotype: params.stereotype,
    taggedValues: params.taggedValues,
    style: params.style,
    customData: params.customData,
    childDiagramId: params.childDiagramId,
    metadata: params.metadata ?? {},
  };
}
