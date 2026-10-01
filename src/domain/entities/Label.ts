import { Id } from "../types";
import { Point } from "../value-objects/Point";

export type LabelAnchor = "node" | "edge" | "port";

export interface TextStyle {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

/**
 * A piece of editable text attached to a node, edge, or port (F-031).
 * See docs/02-DOMAIN-MODEL.md.
 */
export interface Label {
  readonly id: Id;
  text: string;
  anchor: LabelAnchor;
  /** Offset relative to the anchor's own position/geometry. */
  position: Point;
  style?: TextStyle;
}

export function createLabel(params: {
  id: Id;
  text: string;
  anchor: LabelAnchor;
  position: Point;
  style?: TextStyle;
}): Label {
  return { ...params };
}
