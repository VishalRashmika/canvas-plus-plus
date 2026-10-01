import { Diagram } from "../entities/Diagram";
import { Point } from "../value-objects/Point";

export interface SequenceLayoutOptions {
  headerY?: number;
  lifelineSpacing?: number;
  messageStartY?: number;
  messageSpacing?: number;
  activationWidth?: number;
  selfCallLoopWidth?: number;
  selfCallLoopHeight?: number;
}

export interface SequenceMessageLayout {
  edgeId: string;
  order: number;
  y: number;
  fromPoint: Point;
  toPoint: Point;
  waypoints?: Point[];
}

export interface SequenceLayoutResult {
  lifelineY: number;
  lifelineLength: number;
  messageLayouts: SequenceMessageLayout[];
}

/**
 * Pure domain layout engine for Sequence Diagrams (F-045).
 * Enforces the UML 'vertical-lifelines' axis constraint:
 * - Lifelines are arranged horizontally across the top row.
 * - Vertical axis Y is strictly reserved for time / chronological message sequence.
 * - Assigns Y coordinates purely from chronological sequence order.
 */
export class SequenceLayoutEngine {
  private readonly headerY: number;
  private readonly lifelineSpacing: number;
  private readonly messageStartY: number;
  private readonly messageSpacing: number;
  private readonly activationWidth: number;
  private readonly selfCallLoopWidth: number;
  private readonly selfCallLoopHeight: number;

  constructor(options?: SequenceLayoutOptions) {
    this.headerY = options?.headerY ?? 50;
    this.lifelineSpacing = options?.lifelineSpacing ?? 220;
    this.messageStartY = options?.messageStartY ?? 130;
    this.messageSpacing = options?.messageSpacing ?? 60;
    this.activationWidth = options?.activationWidth ?? 14;
    this.selfCallLoopWidth = options?.selfCallLoopWidth ?? 40;
    this.selfCallLoopHeight = options?.selfCallLoopHeight ?? 24;
  }

  /**
   * Calculates and applies layout for all sequence elements in the diagram.
   */
  layout(diagram: Diagram): SequenceLayoutResult {
    // 1. Collect and sort lifelines horizontally by current X position
    const lifelines = diagram.nodes
      .filter((n) => n.kind === "sequence.lifeline")
      .sort((a, b) => a.position.x - b.position.x);

    // Normalize lifeline Y positions to headerY
    lifelines.forEach((lifeline, index) => {
      let newX = lifeline.position.x;
      // If unpositioned or overlapping, space them cleanly
      if (index > 0 && newX < lifelines[index - 1].position.x + this.lifelineSpacing) {
        newX = lifelines[index - 1].position.x + this.lifelineSpacing;
      }
      lifeline.position = { x: newX, y: this.headerY };
    });

    // Map each lifeline to its horizontal center axis
    const lifelineCenters = new Map<string, number>();
    for (const lf of lifelines) {
      lifelineCenters.set(lf.id, lf.position.x + lf.size.width / 2);
    }

    // 2. Identify activations and map them to their parent lifelines
    const activations = diagram.nodes.filter(
      (n) => n.kind === "sequence.activation"
    );
    const activationToLifeline = new Map<string, string>();

    for (const act of activations) {
      const parentLifelineId = act.metadata?.lifelineId as string | undefined;
      if (parentLifelineId && lifelineCenters.has(parentLifelineId)) {
        activationToLifeline.set(act.id, parentLifelineId);
      } else {
        // Find closest lifeline horizontally
        let closestId = lifelines[0]?.id;
        let minDist = Infinity;
        const actCenterX = act.position.x + act.size.width / 2;
        for (const [lfId, cx] of lifelineCenters.entries()) {
          const dist = Math.abs(cx - actCenterX);
          if (dist < minDist) {
            minDist = dist;
            closestId = lfId;
          }
        }
        if (closestId) {
          activationToLifeline.set(act.id, closestId);
          act.metadata.lifelineId = closestId;
        }
      }
    }

    // Helper to resolve an anchor (lifeline or activation) to its lifeline center X
    const getCenterX = (nodeId: string): number | undefined => {
      if (lifelineCenters.has(nodeId)) {
        return lifelineCenters.get(nodeId);
      }
      const parentLifelineId = activationToLifeline.get(nodeId);
      if (parentLifelineId) {
        return lifelineCenters.get(parentLifelineId);
      }
      return undefined;
    };

    // 3. Collect and order message edges
    const isSequenceEdge = (kind: string): boolean =>
      kind.startsWith("sequence.") ||
      kind === "uml.message" ||
      kind === "uml.asyncMessage" ||
      kind === "uml.replyMessage";

    const sequenceEdges = diagram.edges
      .filter((e) => isSequenceEdge(e.kind))
      .sort((a, b) => {
        const orderA = typeof a.sequenceOrder === "number"
          ? a.sequenceOrder
          : Infinity;
        const orderB = typeof b.sequenceOrder === "number"
          ? b.sequenceOrder
          : Infinity;
        if (orderA !== orderB) return orderA - orderB;
        // Fall back to first waypoint Y or edge position
        const yA = a.waypoints?.[0]?.y ?? 0;
        const yB = b.waypoints?.[0]?.y ?? 0;
        return yA - yB;
      });

    // 4. Assign vertical time positions to each message
    const messageLayouts: SequenceMessageLayout[] = [];
    let currentY = this.messageStartY;

    sequenceEdges.forEach((edge, index) => {
      const order = index + 1;
      edge.sequenceOrder = order;

      const fromX = getCenterX(edge.fromNodeId) ?? 100;
      const toX = getCenterX(edge.toNodeId) ?? fromX + 150;

      const isSelfCall = edge.fromNodeId === edge.toNodeId ||
        (activationToLifeline.get(edge.fromNodeId) &&
         activationToLifeline.get(edge.fromNodeId) === activationToLifeline.get(edge.toNodeId));

      let fromPoint: Point;
      let toPoint: Point;
      let waypoints: Point[] | undefined;

      if (isSelfCall) {
        fromPoint = { x: fromX, y: currentY };
        const loopOutX = fromX + this.selfCallLoopWidth;
        const returnY = currentY + this.selfCallLoopHeight;
        toPoint = { x: fromX, y: returnY };
        waypoints = [
          { x: fromX, y: currentY },
          { x: loopOutX, y: currentY },
          { x: loopOutX, y: returnY },
          { x: fromX, y: returnY },
        ];
        currentY += this.selfCallLoopHeight + this.messageSpacing;
      } else {
        fromPoint = { x: fromX, y: currentY };
        toPoint = { x: toX, y: currentY };
        waypoints = [fromPoint, toPoint];
        currentY += this.messageSpacing;
      }

      edge.waypoints = waypoints;
      // Straight horizontal routing for sequence messages
      edge.routing = "straight";

      messageLayouts.push({
        edgeId: edge.id,
        order,
        y: fromPoint.y,
        fromPoint,
        toPoint,
        waypoints,
      });
    });

    // 5. Align activations to lifelines and span message intervals
    for (const act of activations) {
      const parentLifelineId = activationToLifeline.get(act.id);
      if (!parentLifelineId) continue;
      const cx = lifelineCenters.get(parentLifelineId)!;

      // Find incoming / outgoing messages for this activation
      const relatedLayouts = messageLayouts.filter((m) => {
        const edge = diagram.edges.find((e) => e.id === m.edgeId);
        return (
          edge &&
          (edge.fromNodeId === act.id ||
            edge.toNodeId === act.id ||
            edge.fromNodeId === parentLifelineId ||
            edge.toNodeId === parentLifelineId)
        );
      });

      let newY = act.position.y;
      let newHeight = act.size.height;

      if (relatedLayouts.length > 0) {
        const minY = Math.min(...relatedLayouts.map((m) => m.y));
        const maxY = Math.max(
          ...relatedLayouts.map((m) => {
            const lastWp = m.waypoints?.[m.waypoints.length - 1];
            return lastWp ? lastWp.y : m.y;
          })
        );
        newY = Math.round(minY - 10);
        newHeight = Math.max(40, Math.round(maxY - minY + 20));
      } else if (act.size.height < 40) {
        newHeight = 60;
      }

      const newX = Math.round(cx - this.activationWidth / 2);
      act.position = { x: newX, y: newY };
      act.size = { width: this.activationWidth, height: newHeight };
    }

    // 6. Compute total lifeline length
    const lifelineLength = Math.max(400, currentY + 60 - this.headerY);
    for (const lf of lifelines) {
      lf.metadata.lifelineLength = lifelineLength;
    }

    return {
      lifelineY: this.headerY,
      lifelineLength,
      messageLayouts,
    };
  }
}

export const defaultSequenceLayoutEngine = new SequenceLayoutEngine();
