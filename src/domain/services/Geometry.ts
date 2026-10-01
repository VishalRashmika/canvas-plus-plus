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

