import { Point, point } from "../value-objects/Point";
import { Size } from "../value-objects/Rect";
import { Side, EdgeRouting } from "../types";
import {
  getRectCenter,
  getSidePoint,
  getFacingSide,
  calculateStraightEndpoints,
} from "./Geometry";

export interface NodeBoundary {
  id?: string;
  position: Point;
  size: Size;
  side?: Side;
  portOffset?: number;
}

export interface RoutingOptions {
  routing?: EdgeRouting;
  obstacles?: Array<{ id?: string; position: Point; size: Size }>;
  clearance?: number;
  manualWaypoints?: Point[];
}

export interface RoutingResult {
  points: Point[];
  svgPath: string;
}

const SIDE_DIRECTIONS: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export class RoutingService {
  /**
   * Main entry point to compute edge path points and SVG path string.
   */
  route(
    source: NodeBoundary,
    target: NodeBoundary,
    options?: RoutingOptions
  ): RoutingResult {
    const routingMode = options?.routing ?? "straight";

    if (routingMode === "straight") {
      const endpoints = calculateStraightEndpoints(
        { position: source.position, size: source.size, side: source.side },
        { position: target.position, size: target.size, side: target.side }
      );
      const points = [endpoints.start, ...(options?.manualWaypoints ?? []), endpoints.end];
      return {
        points,
        svgPath: this.pointsToSvgPath(points),
      };
    }

    if (routingMode === "orthogonal") {
      const points = this.routeOrthogonal(source, target, options);
      return {
        points,
        svgPath: this.pointsToSvgPath(points),
      };
    }

    if (routingMode === "curved") {
      return this.routeCurved(source, target, options);
    }

    // Default fallback to straight
    const endpoints = calculateStraightEndpoints(
      { position: source.position, size: source.size, side: source.side },
      { position: target.position, size: target.size, side: target.side }
    );
    const points = [endpoints.start, ...(options?.manualWaypoints ?? []), endpoints.end];
    return {
      points,
      svgPath: this.pointsToSvgPath(points),
    };
  }

  private routeOrthogonal(
    source: NodeBoundary,
    target: NodeBoundary,
    options?: RoutingOptions
  ): Point[] {
    const clearance = options?.clearance ?? 16;
    const sourceCenter = getRectCenter(source.position, source.size);
    const targetCenter = getRectCenter(target.position, target.size);

    // Determine departure and arrival sides
    const fromSide =
      source.side ?? getFacingSide(source.position, source.size, targetCenter);
    const toSide =
      target.side ?? getFacingSide(target.position, target.size, sourceCenter);

    const fromPt = getSidePoint(
      source.position,
      source.size,
      fromSide,
      source.portOffset ?? 0.5
    );
    const toPt = getSidePoint(
      target.position,
      target.size,
      toSide,
      target.portOffset ?? 0.5
    );

    // Stubs extending perpendicularly outward from source and target boundaries
    const fromDir = SIDE_DIRECTIONS[fromSide];
    const toDir = SIDE_DIRECTIONS[toSide];

    const stubStart = point(
      fromPt.x + fromDir.x * clearance,
      fromPt.y + fromDir.y * clearance
    );
    const stubEnd = point(
      toPt.x + toDir.x * clearance,
      toPt.y + toDir.y * clearance
    );

    // If manual waypoints provided, route through them
    if (options?.manualWaypoints && options.manualWaypoints.length > 0) {
      const raw = [fromPt, stubStart, ...options.manualWaypoints, stubEnd, toPt];
      return this.simplifyCollinear(raw);
    }

    // Filter obstacles: exclude source and target
    const obstacles = (options?.obstacles ?? []).filter(
      (o) => o.id !== source.id && o.id !== target.id
    );

    // If there are intervening obstacles, run A* grid router
    if (obstacles.length > 0) {
      const path = this.findObstacleFreePath(
        stubStart,
        stubEnd,
        source,
        target,
        obstacles,
        clearance
      );
      if (path && path.length > 0) {
        return this.simplifyCollinear([fromPt, ...path, toPt]);
      }
    }

    // Standard Manhattan routing between stubs (no intervening obstacles)
    const simple = this.routeSimpleManhattan(stubStart, fromSide, stubEnd, toSide);
    return this.simplifyCollinear([fromPt, ...simple, toPt]);
  }

  private routeCurved(
    source: NodeBoundary,
    target: NodeBoundary,
    options?: RoutingOptions
  ): RoutingResult {
    const sourceCenter = getRectCenter(source.position, source.size);
    const targetCenter = getRectCenter(target.position, target.size);

    const fromSide =
      source.side ?? getFacingSide(source.position, source.size, targetCenter);
    const toSide =
      target.side ?? getFacingSide(target.position, target.size, sourceCenter);

    const fromPt = getSidePoint(
      source.position,
      source.size,
      fromSide,
      source.portOffset ?? 0.5
    );
    const toPt = getSidePoint(
      target.position,
      target.size,
      toSide,
      target.portOffset ?? 0.5
    );

    const manualWaypoints = options?.manualWaypoints;
    if (manualWaypoints && manualWaypoints.length > 0) {
      const allPts = [fromPt, ...manualWaypoints, toPt];
      const svgPath = this.pointsToSmoothBezier(allPts);
      const sampledPoints = this.sampleSmoothCurve(allPts);
      return {
        points: sampledPoints,
        svgPath,
      };
    }

    const fromDir = SIDE_DIRECTIONS[fromSide];
    const toDir = SIDE_DIRECTIONS[toSide];

    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const dist = Math.hypot(dx, dy);

    // Natural control point distance (30px to 220px based on distance)
    const factor = Math.max(30, Math.min(dist * 0.45, 220));

    const cp1 = {
      x: Math.round(fromPt.x + fromDir.x * factor),
      y: Math.round(fromPt.y + fromDir.y * factor),
    };
    const cp2 = {
      x: Math.round(toPt.x + toDir.x * factor),
      y: Math.round(toPt.y + toDir.y * factor),
    };

    const svgPath = `M ${fromPt.x} ${fromPt.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${toPt.x} ${toPt.y}`;

    // Sample 11 points along cubic bezier curve: B(t) for t in [0, 0.1, ..., 1.0]
    const points: Point[] = [];
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const t1 = 1 - t;
      const x =
        t1 * t1 * t1 * fromPt.x +
        3 * t1 * t1 * t * cp1.x +
        3 * t1 * t * t * cp2.x +
        t * t * t * toPt.x;
      const y =
        t1 * t1 * t1 * fromPt.y +
        3 * t1 * t1 * t * cp1.y +
        3 * t1 * t * t * cp2.y +
        t * t * t * toPt.y;
      points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    }

    return { points, svgPath };
  }

  private pointsToSmoothBezier(pts: Point[]): string {
    if (pts.length < 2) return this.pointsToSvgPath(pts);
    if (pts.length === 2) {
      return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
    }
    if (pts.length === 3) {
      return `M ${pts[0].x} ${pts[0].y} Q ${pts[1].x} ${pts[1].y} ${pts[2].x} ${pts[2].y}`;
    }

    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = i > 0 ? pts[i - 1] : pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = i < pts.length - 2 ? pts[i + 2] : p2;

      const cp1x = Math.round(p1.x + (p2.x - p0.x) / 6);
      const cp1y = Math.round(p1.y + (p2.y - p0.y) / 6);
      const cp2x = Math.round(p2.x - (p3.x - p1.x) / 6);
      const cp2y = Math.round(p2.y - (p3.y - p1.y) / 6);

      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  private sampleSmoothCurve(pts: Point[]): Point[] {
    if (pts.length <= 2) return pts;
    const sampled: Point[] = [];

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = i > 0 ? pts[i - 1] : pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = i < pts.length - 2 ? pts[i + 2] : p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      const steps = 4;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const t1 = 1 - t;
        const x =
          t1 * t1 * t1 * p1.x +
          3 * t1 * t1 * t * cp1x +
          3 * t1 * t * t * cp2x +
          t * t * t * p2.x;
        const y =
          t1 * t1 * t1 * p1.y +
          3 * t1 * t1 * t * cp1y +
          3 * t1 * t * t * cp2y +
          t * t * t * p2.y;
        sampled.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
      }
    }
    sampled.push(pts[pts.length - 1]);
    return sampled;
  }

  private routeSimpleManhattan(
    p1: Point,
    side1: Side,
    p2: Point,
    side2: Side
  ): Point[] {
    const isSide1Horiz = side1 === "left" || side1 === "right";
    const isSide2Horiz = side2 === "left" || side2 === "right";

    if (isSide1Horiz && isSide2Horiz) {
      if (side1 === side2) {
        // Both exit horizontally on the same side: U-bend
        const offset = 24;
        const x = side1 === "right" ? Math.max(p1.x, p2.x) + offset : Math.min(p1.x, p2.x) - offset;
        return [p1, point(x, p1.y), point(x, p2.y), p2];
      }

      // Opposite horizontal exits: right -> left or left -> right
      if (side1 === "right" && side2 === "left") {
        if (p1.x < p2.x) {
          const midX = (p1.x + p2.x) / 2;
          return [p1, point(midX, p1.y), point(midX, p2.y), p2];
        } else {
          // Target is behind source: route around vertically
          const midY = p1.y <= p2.y ? Math.min(p1.y, p2.y) - 30 : Math.max(p1.y, p2.y) + 30;
          return [p1, point(p1.x, midY), point(p2.x, midY), p2];
        }
      } else {
        // left -> right
        if (p1.x > p2.x) {
          const midX = (p1.x + p2.x) / 2;
          return [p1, point(midX, p1.y), point(midX, p2.y), p2];
        } else {
          const midY = p1.y <= p2.y ? Math.min(p1.y, p2.y) - 30 : Math.max(p1.y, p2.y) + 30;
          return [p1, point(p1.x, midY), point(p2.x, midY), p2];
        }
      }
    } else if (!isSide1Horiz && !isSide2Horiz) {
      if (side1 === side2) {
        // Both exit vertically on the same side: U-bend
        const offset = 24;
        const y = side1 === "bottom" ? Math.max(p1.y, p2.y) + offset : Math.min(p1.y, p2.y) - offset;
        return [p1, point(p1.x, y), point(p2.x, y), p2];
      }

      // Opposite vertical exits: bottom -> top or top -> bottom
      if (side1 === "bottom" && side2 === "top") {
        if (p1.y < p2.y) {
          const midY = (p1.y + p2.y) / 2;
          return [p1, point(p1.x, midY), point(p2.x, midY), p2];
        } else {
          const midX = p1.x <= p2.x ? Math.min(p1.x, p2.x) - 30 : Math.max(p1.x, p2.x) + 30;
          return [p1, point(midX, p1.y), point(midX, p2.y), p2];
        }
      } else {
        // top -> bottom
        if (p1.y > p2.y) {
          const midY = (p1.y + p2.y) / 2;
          return [p1, point(p1.x, midY), point(p2.x, midY), p2];
        } else {
          const midX = p1.x <= p2.x ? Math.min(p1.x, p2.x) - 30 : Math.max(p1.x, p2.x) + 30;
          return [p1, point(midX, p1.y), point(midX, p2.y), p2];
        }
      }
    } else if (isSide1Horiz && !isSide2Horiz) {
      // Horizontal to vertical: L-bend
      return [p1, point(p2.x, p1.y), p2];
    } else {
      // Vertical to horizontal: L-bend
      return [p1, point(p1.x, p2.y), p2];
    }
  }

  /**
   * Grid-based A* routing avoiding obstacle bounding boxes.
   */
  private findObstacleFreePath(
    start: Point,
    goal: Point,
    source: NodeBoundary,
    target: NodeBoundary,
    obstacles: Array<{ position: Point; size: Size }>,
    clearance: number
  ): Point[] | null {
    // Collect all obstacle boxes (inflated)
    const boxes = [
      // source and target bodies (inflated slightly)
      {
        minX: source.position.x - clearance / 2,
        maxX: source.position.x + source.size.width + clearance / 2,
        minY: source.position.y - clearance / 2,
        maxY: source.position.y + source.size.height + clearance / 2,
      },
      {
        minX: target.position.x - clearance / 2,
        maxX: target.position.x + target.size.width + clearance / 2,
        minY: target.position.y - clearance / 2,
        maxY: target.position.y + target.size.height + clearance / 2,
      },
      ...obstacles.map((o) => ({
        minX: o.position.x - clearance,
        maxX: o.position.x + o.size.width + clearance,
        minY: o.position.y - clearance,
        maxY: o.position.y + o.size.height + clearance,
      })),
    ];

    // Build candidate grid lines from start, goal, and obstacle boundaries
    const xSet = new Set<number>([start.x, goal.x]);
    const ySet = new Set<number>([start.y, goal.y]);

    for (const b of boxes) {
      xSet.add(Math.round(b.minX));
      xSet.add(Math.round(b.maxX));
      xSet.add(Math.round((b.minX + b.maxX) / 2));

      ySet.add(Math.round(b.minY));
      ySet.add(Math.round(b.maxY));
      ySet.add(Math.round((b.minY + b.maxY) / 2));
    }

    const xs = Array.from(xSet).sort((a, b) => a - b);
    const ys = Array.from(ySet).sort((a, b) => a - b);

    // Helper: is segment blocked by any obstacle?
    const isSegmentBlocked = (pA: Point, pB: Point): boolean => {
      const segMinX = Math.min(pA.x, pB.x);
      const segMaxX = Math.max(pA.x, pB.x);
      const segMinY = Math.min(pA.y, pB.y);
      const segMaxY = Math.max(pA.y, pB.y);

      for (const b of boxes) {
        // If segment penetrates the inside of an obstacle
        const overlapsX = segMinX < b.maxX && segMaxX > b.minX;
        const overlapsY = segMinY < b.maxY && segMaxY > b.minY;
        if (overlapsX && overlapsY) {
          // Allow if the endpoint is the start or goal
          const isAtStart =
            (pA.x === start.x && pA.y === start.y) ||
            (pB.x === start.x && pB.y === start.y);
          const isAtGoal =
            (pA.x === goal.x && pA.y === goal.y) ||
            (pB.x === goal.x && pB.y === goal.y);
          if (!isAtStart && !isAtGoal) {
            return true;
          }
        }
      }
      return false;
    };

    // A* algorithm on grid graph
    interface NodeState {
      key: string;
      pt: Point;
      gCost: number;
      fCost: number;
      parentKey?: string;
      direction?: "H" | "V";
    }

    const keyOf = (p: Point) => `${Math.round(p.x)},${Math.round(p.y)}`;
    const startKey = keyOf(start);
    const goalKey = keyOf(goal);

    const openSet = new Map<string, NodeState>();
    const closedSet = new Set<string>();
    const allNodes = new Map<string, NodeState>();

    const hCost = (p: Point) => Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y);

    const startNode: NodeState = {
      key: startKey,
      pt: start,
      gCost: 0,
      fCost: hCost(start),
    };
    openSet.set(startKey, startNode);
    allNodes.set(startKey, startNode);

    let iterations = 0;
    const maxIterations = 800;

    while (openSet.size > 0 && iterations++ < maxIterations) {
      // Find node with lowest fCost
      let current: NodeState | null = null;
      for (const node of openSet.values()) {
        if (!current || node.fCost < current.fCost) {
          current = node;
        }
      }

      if (!current) break;
      if (current.key === goalKey) {
        // Reconstruct path
        const path: Point[] = [];
        let curr: NodeState | undefined = current;
        while (curr) {
          path.push(curr.pt);
          curr = curr.parentKey ? allNodes.get(curr.parentKey) : undefined;
        }
        path.reverse();
        return path;
      }

      openSet.delete(current.key);
      closedSet.add(current.key);

      const curXIdx = xs.indexOf(Math.round(current.pt.x));
      const curYIdx = ys.indexOf(Math.round(current.pt.y));

      // Neighbors: up, down, left, right in grid
      const neighbors: Array<{ pt: Point; dir: "H" | "V" }> = [];
      if (curXIdx > 0) neighbors.push({ pt: point(xs[curXIdx - 1], current.pt.y), dir: "H" });
      if (curXIdx < xs.length - 1) neighbors.push({ pt: point(xs[curXIdx + 1], current.pt.y), dir: "H" });
      if (curYIdx > 0) neighbors.push({ pt: point(current.pt.x, ys[curYIdx - 1]), dir: "V" });
      if (curYIdx < ys.length - 1) neighbors.push({ pt: point(current.pt.x, ys[curYIdx + 1]), dir: "V" });

      for (const n of neighbors) {
        const nKey = keyOf(n.pt);
        if (closedSet.has(nKey)) continue;

        // Check if edge is blocked
        if (isSegmentBlocked(current.pt, n.pt)) continue;

        const dist = Math.abs(n.pt.x - current.pt.x) + Math.abs(n.pt.y - current.pt.y);
        // Add bend penalty if direction changes (favors fewer turns)
        const bendPenalty =
          current.direction && current.direction !== n.dir ? 30 : 0;
        const tentativeG = current.gCost + dist + bendPenalty;

        const existing = openSet.get(nKey);
        if (!existing || tentativeG < existing.gCost) {
          const neighborNode: NodeState = {
            key: nKey,
            pt: n.pt,
            gCost: tentativeG,
            fCost: tentativeG + hCost(n.pt),
            parentKey: current.key,
            direction: n.dir,
          };
          openSet.set(nKey, neighborNode);
          allNodes.set(nKey, neighborNode);
        }
      }
    }

    // If A* couldn't find a path (e.g. timeout), fall back to simple Manhattan
    return null;
  }

  /**
   * Merges contiguous horizontal or vertical line segments into a single segment.
   */
  simplifyCollinear(points: Point[]): Point[] {
    if (points.length <= 2) return points;

    const result: Point[] = [points[0]];

    for (let i = 1; i < points.length - 1; i++) {
      const prev = result[result.length - 1];
      const curr = points[i];
      const next = points[i + 1];

      // Ignore zero-length moves
      if (curr.x === prev.x && curr.y === prev.y) {
        continue;
      }

      // Check if collinear
      const isCollinearHoriz =
        Math.abs(prev.y - curr.y) < 0.5 && Math.abs(curr.y - next.y) < 0.5;
      const isCollinearVert =
        Math.abs(prev.x - curr.x) < 0.5 && Math.abs(curr.x - next.x) < 0.5;

      if (!isCollinearHoriz && !isCollinearVert) {
        result.push(curr);
      }
    }

    result.push(points[points.length - 1]);
    return result;
  }

  pointsToSvgPath(points: Point[]): string {
    if (points.length === 0) return "";
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
  }
}

export const defaultRoutingService = new RoutingService();
