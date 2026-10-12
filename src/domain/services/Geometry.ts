import { Point } from "../value-objects/Point";
import { Size } from "../value-objects/Rect";
import { Side } from "../types";

/**
 * Calculates the center point of a rectangle.
 */
export function getRectCenter(position: Point, size: Size): Point {
  return {
    x: position.x + size.width / 2,
    y: position.y + size.height / 2,
  };
}

/**
 * Calculates the anchor point on a specific side of a rectangle.
 * offset: 0..1 along the edge (0.5 is center).
 */
export function getSidePoint(
  position: Point,
  size: Size,
  side: Side,
  offset = 0.5
): Point {
  switch (side) {
    case "top":
      return { x: position.x + size.width * offset, y: position.y };
    case "bottom":
      return { x: position.x + size.width * offset, y: position.y + size.height };
    case "left":
      return { x: position.x, y: position.y + size.height * offset };
    case "right":
      return { x: position.x + size.width, y: position.y + size.height * offset };
  }
}

/**
 * Determines the closest side of a rectangle facing a given external target point.
 */
export function getFacingSide(position: Point, size: Size, target: Point): Side {
  const center = getRectCenter(position, size);
  const dx = target.x - center.x;
  const dy = target.y - center.y;

  const halfWidth = size.width / 2;
  const halfHeight = size.height / 2;

  // Normalized directional comparison against rectangle diagonals
  if (Math.abs(dx) * halfHeight > Math.abs(dy) * halfWidth) {
    return dx > 0 ? "right" : "left";
  } else {
    return dy > 0 ? "bottom" : "top";
  }
}

/**
 * Calculates the intersection point between a ray from the rect's center
 * to a target point and the perimeter of the rectangle.
 */
export function getRectPerimeterIntersection(
  rect: { position: Point; size: Size },
  target: Point
): Point {
  const center = getRectCenter(rect.position, rect.size);
  const dx = target.x - center.x;
  const dy = target.y - center.y;

  if (dx === 0 && dy === 0) {
    return center;
  }

  const halfW = rect.size.width / 2;
  const halfH = rect.size.height / 2;

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx * halfH > absDy * halfW) {
    // Intersects left or right edge
    const x = dx > 0 ? rect.position.x + rect.size.width : rect.position.x;
    const y = center.y + (dy / absDx) * halfW;
    return { x, y };
  } else {
    // Intersects top or bottom edge
    const y = dy > 0 ? rect.position.y + rect.size.height : rect.position.y;
    const x = center.x + (dx / absDy) * halfH;
    return { x, y };
  }
}

export interface StraightConnectionEndpoints {
  start: Point;
  end: Point;
}

/**
 * Calculates straight-line endpoints between source and target rectangles,
 * optionally constrained to specific sides or ports.
 */
export function calculateStraightEndpoints(
  source: { position: Point; size: Size; side?: Side },
  target: { position: Point; size: Size; side?: Side }
): StraightConnectionEndpoints {
  const sourceCenter = getRectCenter(source.position, source.size);
  const targetCenter = getRectCenter(target.position, target.size);

  const start = source.side
    ? getSidePoint(source.position, source.size, source.side)
    : getRectPerimeterIntersection(source, targetCenter);

  const end = target.side
    ? getSidePoint(target.position, target.size, target.side)
    : getRectPerimeterIntersection(target, sourceCenter);

  return { start, end };
}

/**
 * Calculates the intersection point between a ray from an ellipse center
 * to a target point and the perimeter of the ellipse.
 */
export function getEllipsePerimeterIntersection(
  boundary: { position: Point; size: Size },
  target: Point
): Point {
  const cx = boundary.position.x + boundary.size.width / 2;
  const cy = boundary.position.y + boundary.size.height / 2;
  const rx = boundary.size.width / 2;
  const ry = boundary.size.height / 2;

  const dx = target.x - cx;
  const dy = target.y - cy;

  if (dx === 0 && dy === 0) {
    return { x: cx + rx, y: cy };
  }

  const angle = Math.atan2(dy, dx);
  return {
    x: Math.round(cx + rx * Math.cos(angle)),
    y: Math.round(cy + ry * Math.sin(angle)),
  };
}

/**
 * Calculates the intersection point between a ray from a diamond center
 * to a target point and the perimeter of the diamond (|x/rx| + |y/ry| = 1).
 */
export function getDiamondPerimeterIntersection(
  boundary: { position: Point; size: Size },
  target: Point
): Point {
  const cx = boundary.position.x + boundary.size.width / 2;
  const cy = boundary.position.y + boundary.size.height / 2;
  const rx = boundary.size.width / 2;
  const ry = boundary.size.height / 2;

  const dx = target.x - cx;
  const dy = target.y - cy;

  if (dx === 0 && dy === 0) {
    return { x: Math.round(cx + rx), y: Math.round(cy) };
  }

  const denom = Math.abs(dx) / rx + Math.abs(dy) / ry;
  if (denom === 0) {
    return { x: Math.round(cx), y: Math.round(cy) };
  }

  const t = 1 / denom;
  return {
    x: Math.round(cx + t * dx),
    y: Math.round(cy + t * dy),
  };
}

/**
 * Calculates the intersection point between a ray from a circle center
 * to a target point and the perimeter of the circle.
 */
export function getCirclePerimeterIntersection(
  boundary: { position: Point; size: Size },
  target: Point
): Point {
  const cx = boundary.position.x + boundary.size.width / 2;
  const cy = boundary.position.y + boundary.size.height / 2;
  const radius = Math.min(boundary.size.width, boundary.size.height) / 2;

  const dx = target.x - cx;
  const dy = target.y - cy;

  if (dx === 0 && dy === 0) {
    return { x: Math.round(cx + radius), y: Math.round(cy) };
  }

  const angle = Math.atan2(dy, dx);
  return {
    x: Math.round(cx + radius * Math.cos(angle)),
    y: Math.round(cy + radius * Math.sin(angle)),
  };
}

/**
 * Calculates the intersection point between a ray from an upright triangle center
 * to a target point and the perimeter of the triangle.
 * Top vertex: (cx, by); Bottom-right: (bx + bw, by + bh); Bottom-left: (bx, by + bh).
 */
export function getTrianglePerimeterIntersection(
  boundary: { position: Point; size: Size },
  target: Point
): Point {
  const bx = boundary.position.x;
  const by = boundary.position.y;
  const bw = boundary.size.width;
  const bh = boundary.size.height;
  const cx = bx + bw / 2;
  const cy = by + bh / 2;

  const dx = target.x - cx;
  const dy = target.y - cy;

  if (dx === 0 && dy === 0) {
    return { x: Math.round(cx), y: Math.round(by) };
  }

  const v1 = { x: cx, y: by };
  const v2 = { x: bx + bw, y: by + bh };
  const v3 = { x: bx, y: by + bh };

  const edges = [
    [v1, v2],
    [v2, v3],
    [v3, v1],
  ];

  let closestPt: Point = { x: Math.round(cx), y: Math.round(by) };
  let minT = Infinity;

  for (const [a, b] of edges) {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-6) continue;

    const t = ((a.x - cx) * ey - (a.y - cy) * ex) / denom;
    const u = ((a.x - cx) * dy - (a.y - cy) * dx) / denom;

    if (t > 0 && u >= 0 && u <= 1 && t < minT) {
      minT = t;
      closestPt = {
        x: Math.round(cx + t * dx),
        y: Math.round(cy + t * dy),
      };
    }
  }

  return closestPt;
}

function ccw(p1: Point, p2: Point, p3: Point): boolean {
  return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
}

export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  return (
    ccw(p1, p3, p4) !== ccw(p2, p3, p4) &&
    ccw(p1, p2, p3) !== ccw(p1, p2, p4)
  );
}

export function lineSegmentIntersectsRect(
  p1: Point,
  p2: Point,
  r: { position: Point; size: Size }
): boolean {
  const minX = r.position.x;
  const maxX = r.position.x + r.size.width;
  const minY = r.position.y;
  const maxY = r.position.y + r.size.height;

  // Check if either endpoint is inside the rect
  if (
    (p1.x >= minX && p1.x <= maxX && p1.y >= minY && p1.y <= maxY) ||
    (p2.x >= minX && p2.x <= maxX && p2.y >= minY && p2.y <= maxY)
  ) {
    return true;
  }

  // Check intersection with all 4 rectangle boundary edges
  const rectEdges: [Point, Point][] = [
    [{ x: minX, y: minY }, { x: maxX, y: minY }],
    [{ x: maxX, y: minY }, { x: maxX, y: maxY }],
    [{ x: maxX, y: maxY }, { x: minX, y: maxY }],
    [{ x: minX, y: maxY }, { x: minX, y: minY }],
  ];

  for (const [e1, e2] of rectEdges) {
    if (segmentsIntersect(p1, p2, e1, e2)) {
      return true;
    }
  }

  return false;
}


