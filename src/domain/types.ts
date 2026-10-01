/**
 * Shared primitive types used across the domain layer.
 * See docs/02-DOMAIN-MODEL.md — this file has no behavior, just the small
 * closed sets of string literals referenced everywhere else.
 *
 * Pure TypeScript. No obsidian, no DOM. Never import anything into this file.
 */

/** UUID v4 string. Generation happens in infrastructure, never in domain. */
export type Id = string;

export type Side = "top" | "right" | "bottom" | "left";

export type PortDirection = "in" | "out" | "inout";

/** UML visibility markers rendered on compartment items. */
export type Visibility = "+" | "-" | "#" | "~";

export type EdgeRouting = "straight" | "orthogonal" | "curved";

/**
 * Who is allowed to edit a given node/group/layer via an external
 * (Antigravity CLI) patch. See docs/08-CLI-INTEGRATION-SPEC.md.
 * "user" and "none" both reject external patches; they are kept distinct so
 * the property panel can explain *why* ("reserved for you" vs "locked").
 */
export type EditPermission = "user" | "antigravity" | "both" | "none";

/**
 * Registry key identifying a diagram type, e.g. "uml.class", "uml.sequence",
 * "schematic". Defined as a plain string (not a closed union) so new
 * diagram types can be registered without editing this file — see
 * DiagramTypeDefinition.ts and docs/01-ARCHITECTURE.md's ShapeRegistry /
 * DiagramType extension points.
 */
export type DiagramTypeId = string;

/**
 * Registry key identifying a node or edge shape kind, e.g. "uml.class",
 * "schematic.chip", "activity.decision". Same rationale as DiagramTypeId:
 * open string, not a closed union, so the ShapeRegistry stays the single
 * place new shapes are added.
 */
export type ShapeKind = string;
