import { DiagramTypeId, ShapeKind, EdgeRouting } from "../types";
import { Diagram } from "./Diagram";

/**
 * A non-fatal warning surfaced in the property panel, e.g. "Actor node not
 * connected to any use case". Validation informs, it never blocks saving.
 * See docs/02-DOMAIN-MODEL.md.
 */
export interface ValidationIssue {
  severity: "info" | "warning" | "error";
  message: string;
  nodeId?: string;
  edgeId?: string;
  ruleId?: string;
}

export type AxisConstraint =
  | "none"
  | "vertical-lifelines" // Sequence diagrams — x is free, y is time
  | "horizontal-time"; // Timing diagrams — x is time

/**
 * Declares what's legal within a given diagram type and how it validates
 * and routes by default. Registered once per UML/schematic type; the
 * renderer and palette read from this rather than hardcoding per-type
 * branches. See docs/01-ARCHITECTURE.md "Key extension points".
 */
export interface DiagramTypeDefinition {
  id: DiagramTypeId;
  displayName: string;
  allowedNodeKinds: ShapeKind[];
  allowedEdgeKinds: ShapeKind[];
  defaultRouting: EdgeRouting;
  axisConstraint: AxisConstraint;
  validate(diagram: Diagram): ValidationIssue[];
}
