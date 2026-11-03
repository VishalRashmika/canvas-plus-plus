import { Point } from "../value-objects/Point";

/**
 * Rounds a number to specified precision (default 1 decimal place)
 * for compact and efficient SVG path strings.
 */
export function roundCoord(n: number, decimals = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

/**
 * Filters out consecutive points that are too close to each other (< minDistance).
 * Always preserves the first and last points.
 */
export function filterClosePoints<T extends Point>(points: T[], minDistance = 1.2): T[] {
  if (points.length <= 2) return points;
  const minDistSq = minDistance * minDistance;
  const result: T[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const last = result[result.length - 1];
    const curr = points[i];
    const dx = curr.x - last.x;
    const dy = curr.y - last.y;
    if (dx * dx + dy * dy >= minDistSq) {
      result.push(curr);
    }
  }

  // Always keep the final point
  result.push(points[points.length - 1]);
  return result;
}

/**
 * Smooths stroke points by applying a moving average filter (Gaussian-weighted 0.25 / 0.5 / 0.25)
 * to eliminate high-frequency hand tremor and mouse sensor jitter while preserving overall shape and endpoints.
 */
export function smoothPoints<T extends Point>(points: T[]): T[] {
  if (points.length <= 3) return points;

  const result: T[] = [{ ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const smoothedX = roundCoord(0.25 * prev.x + 0.5 * curr.x + 0.25 * next.x, 2);
    const smoothedY = roundCoord(0.25 * prev.y + 0.5 * curr.y + 0.25 * next.y, 2);

    result.push({
      ...curr,
      x: smoothedX,
      y: smoothedY,
    });
  }

  result.push({ ...points[points.length - 1] });
  return result;
}

/**
 * Converts a sequence of 2D points into a continuous, smooth SVG path string (d attribute).
 *
 * Uses midpoint quadratic Bezier curves (splines) with C^1 continuous tangents between segments.
 *
 * - 0 points: ""
 * - 1 point:  "M x0,y0 L x0,y0" (renders a circular dot with stroke-linecap: round)
 * - 2 points: "M x0,y0 L x1,y1"
 * - 3 points: "M x0,y0 L x1,y1 L x2,y2"
 * - 4+ points: Smooth quadratic Bezier spline through midpoints:
 *              "M x0,y0 L m0x,m0y Q x1,y1 m1x,m1y Q x2,y2 m2x,m2y ... L xN,yN"
 */
export function pointsToSmoothSvgPath(points: Point[]): string {
  const len = points.length;
  if (len === 0) return "";
  if (len === 1) {
    const p = points[0];
    const x = roundCoord(p.x);
    const y = roundCoord(p.y);
    return `M ${x},${y} L ${x},${y}`;
  }
  if (len === 2) {
    const p0 = points[0];
    const p1 = points[1];
    return `M ${roundCoord(p0.x)},${roundCoord(p0.y)} L ${roundCoord(p1.x)},${roundCoord(p1.y)}`;
  }
  if (len === 3) {
    const p0 = points[0];
    const p1 = points[1];
    const p2 = points[2];
    return `M ${roundCoord(p0.x)},${roundCoord(p0.y)} L ${roundCoord(p1.x)},${roundCoord(p1.y)} L ${roundCoord(p2.x)},${roundCoord(p2.y)}`;
  }

  const p0 = points[0];
  const p1 = points[1];
  const m0x = roundCoord((p0.x + p1.x) * 0.5);
  const m0y = roundCoord((p0.y + p1.y) * 0.5);

  let d = `M ${roundCoord(p0.x)},${roundCoord(p0.y)} L ${m0x},${m0y}`;

  for (let i = 1; i < len - 1; i++) {
    const pi = points[i];
    const pNext = points[i + 1];
    const mx = roundCoord((pi.x + pNext.x) * 0.5);
    const my = roundCoord((pi.y + pNext.y) * 0.5);
    d += ` Q ${roundCoord(pi.x)},${roundCoord(pi.y)} ${mx},${my}`;
  }

  const pLast = points[len - 1];
  d += ` L ${roundCoord(pLast.x)},${roundCoord(pLast.y)}`;
  return d;
}
