/** Pure TypeScript. No obsidian, no DOM. */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function point(x: number, y: number): Point {
  return { x, y };
}

export const ORIGIN: Point = point(0, 0);

export function addPoints(a: Point, b: Point): Point {
  return point(a.x + b.x, a.y + b.y);
}

export function subtractPoints(a: Point, b: Point): Point {
  return point(a.x - b.x, a.y - b.y);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return point((a.x + b.x) / 2, (a.y + b.y) / 2);
}
