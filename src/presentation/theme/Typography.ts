/**
 * Typography Scale & Token System (F-035).
 * Enforces consistent type scale across all UML diagrams and theme parity with Obsidian.
 */

export interface TextStyleToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: number | string;
  fontStyle?: "normal" | "italic";
  fontFamilyVar: string;
  className: string;
}

export const TypographyScale: Record<string, TextStyleToken> = {
  title: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: 600,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-node-title",
  },
  classTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: 700,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-class-title",
  },
  objectTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: 600,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-object-title",
  },
  stereotype: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: 500,
    fontStyle: "italic",
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-node-stereotype",
  },
  taggedValues: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: 400,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-node-tagged-values",
  },
  compartmentTitle: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: 600,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-compartment-title",
  },
  compartmentItem: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: 400,
    fontFamilyVar: "var(--font-monospace, monospace)",
    className: "umlcanvas-compartment-item",
  },
  edgeLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 500,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-edge-label",
  },
  multiplicity: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: 500,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-edge-multiplicity",
  },
  portLabel: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: 500,
    fontFamilyVar: "var(--font-monospace, monospace)",
    className: "umlcanvas-port-label",
  },
  groupTitle: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 600,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-group-title",
  },
  actorLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: 600,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-actor-label",
  },
  useCaseTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: 600,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-usecase-title",
  },
  noteText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: 400,
    fontFamilyVar: "var(--font-text)",
    className: "umlcanvas-note-text",
  },
};

export const TYPOGRAPHY = TypographyScale;
