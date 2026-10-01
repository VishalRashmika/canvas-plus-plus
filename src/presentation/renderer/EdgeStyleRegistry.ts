import { ShapeKind } from "../../domain/types";

export interface EdgeStyleDefinition {
  kind: ShapeKind;
  displayName: string;
  markerEndId?: string;
  markerStartId?: string;
  strokeDasharray?: string;
  strokeWidth?: number;
  defaultStereotype?: string;
}

export class EdgeStyleRegistry {
  private styles = new Map<ShapeKind, EdgeStyleDefinition>();

  constructor() {
    this.registerDefaults();
  }

  register(style: EdgeStyleDefinition): void {
    this.styles.set(style.kind, style);
  }

  get(kind: ShapeKind): EdgeStyleDefinition {
    return (
      this.styles.get(kind) ?? {
        kind,
        displayName: "Association",
        markerEndId: undefined,
        markerStartId: undefined,
      }
    );
  }

  has(kind: ShapeKind): boolean {
    return this.styles.has(kind);
  }

  getAll(): EdgeStyleDefinition[] {
    return Array.from(this.styles.values());
  }

  private registerDefaults(): void {
    this.register({
      kind: "uml.association",
      displayName: "Association",
      markerEndId: undefined,
      markerStartId: undefined,
    });

    this.register({
      kind: "uml.aggregation",
      displayName: "Aggregation",
      markerStartId: "uml-marker-diamond-hollow",
      markerEndId: undefined,
    });

    this.register({
      kind: "uml.composition",
      displayName: "Composition",
      markerStartId: "uml-marker-diamond-filled",
      markerEndId: undefined,
    });

    this.register({
      kind: "uml.generalization",
      displayName: "Generalization",
      markerEndId: "uml-marker-triangle-hollow",
    });

    this.register({
      kind: "uml.realization",
      displayName: "Realization",
      markerEndId: "uml-marker-triangle-hollow",
      strokeDasharray: "6 4",
    });

    this.register({
      kind: "uml.dependency",
      displayName: "Dependency",
      markerEndId: "uml-marker-open-arrow",
      strokeDasharray: "5 4",
    });

    this.register({
      kind: "uml.link",
      displayName: "Link",
      markerEndId: undefined,
      markerStartId: undefined,
    });

    this.register({
      kind: "uml.include",
      displayName: "«include»",
      markerEndId: "uml-marker-open-arrow",
      strokeDasharray: "5 4",
      defaultStereotype: "include",
    });

    this.register({
      kind: "uml.extend",
      displayName: "«extend»",
      markerEndId: "uml-marker-open-arrow",
      strokeDasharray: "5 4",
      defaultStereotype: "extend",
    });

    // --- Phase 3 Behavioral Edge Styles ---

    this.register({
      kind: "activity.controlFlow",
      displayName: "Control Flow",
      markerEndId: "uml-marker-open-arrow",
    });

    this.register({
      kind: "state.transition",
      displayName: "Transition",
      markerEndId: "uml-marker-open-arrow",
    });

    this.register({
      kind: "sequence.syncMessage",
      displayName: "Sync Call",
      markerEndId: "uml-marker-arrow-filled",
    });

    this.register({
      kind: "sequence.asyncMessage",
      displayName: "Async Signal",
      markerEndId: "uml-marker-open-arrow",
    });

    this.register({
      kind: "sequence.replyMessage",
      displayName: "Reply / Return",
      markerEndId: "uml-marker-open-arrow",
      strokeDasharray: "5 4",
    });

    this.register({
      kind: "sequence.createMessage",
      displayName: "Create Message",
      markerEndId: "uml-marker-open-arrow",
      strokeDasharray: "5 4",
    });

    // --- Phase 4 Edge Styles ---

    this.register({
      kind: "communication.message",
      displayName: "Message",
      markerEndId: "uml-marker-arrow-filled",
    });

    this.register({
      kind: "timing.constraint",
      displayName: "Timing Constraint",
      markerStartId: "uml-marker-timing-stop",
      markerEndId: "uml-marker-timing-stop",
      strokeDasharray: "4 4",
    });

    this.register({
      kind: "uml.assembly",
      displayName: "Assembly Connector",
      markerEndId: undefined,
      markerStartId: undefined,
    });

    this.register({
      kind: "uml.delegation",
      displayName: "Delegation Connector",
      markerEndId: "uml-marker-open-arrow",
    });

    this.register({
      kind: "deployment.communicationPath",
      displayName: "Communication Path",
      markerEndId: undefined,
      markerStartId: undefined,
    });

    this.register({
      kind: "deployment.manifest",
      displayName: "«manifest»",
      markerEndId: "uml-marker-open-arrow",
      strokeDasharray: "5 4",
      defaultStereotype: "manifest",
    });

    this.register({
      kind: "schematic.wire",
      displayName: "Wire",
      markerEndId: undefined,
      markerStartId: undefined,
    });

    this.register({
      kind: "generic.edge",
      displayName: "Generic Edge",
      markerEndId: "uml-marker-arrow-filled",
    });

    // --- Phase 5 Edge Styles ---

    this.register({
      kind: "package.dependency",
      displayName: "Dependency",
      markerEndId: "uml-marker-open-arrow",
      strokeDasharray: "5 4",
    });

    this.register({
      kind: "package.import",
      displayName: "«import»",
      markerEndId: "uml-marker-open-arrow",
      strokeDasharray: "5 4",
      defaultStereotype: "import",
    });

    this.register({
      kind: "package.merge",
      displayName: "«merge»",
      markerEndId: "uml-marker-open-arrow",
      strokeDasharray: "5 4",
      defaultStereotype: "merge",
    });

    this.register({
      kind: "package.access",
      displayName: "«access»",
      markerEndId: "uml-marker-open-arrow",
      strokeDasharray: "5 4",
      defaultStereotype: "access",
    });

    this.register({
      kind: "composite.connector",
      displayName: "Connector",
      markerEndId: undefined,
      markerStartId: undefined,
      strokeWidth: 1.5,
    });

    this.register({
      kind: "profile.extension",
      displayName: "Extension",
      markerEndId: "uml-marker-triangle-filled",
    });

    this.register({
      kind: "schematic.bus",
      displayName: "Bus",
      strokeWidth: 3.5,
      markerEndId: undefined,
      markerStartId: undefined,
    });
  }
}

export const defaultEdgeStyleRegistry = new EdgeStyleRegistry();
