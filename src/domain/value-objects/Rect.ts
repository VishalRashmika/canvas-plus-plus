/** Pure TypeScript. No obsidian, no DOM. */

import { Point, point } from "./Point";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export function size(width: number, height: number): Size {
  return { width, height };
}

export interface Rect {
  readonly position: Point;
  readonly size: Size;
}

export function rect(position: Point, dimensions: Size): Rect {
  return { position, size: dimensions };
}

export function rectFromBounds(
  x: number,
  y: number,
  width: number,
  height: number
): Rect {
  return rect(point(x, y), size(width, height));
}

export function right(r: Rect): number {
  return r.position.x + r.size.width;
}

export function bottom(r: Rect): number {
  return r.position.y + r.size.height;
}

export function center(r: Rect): Point {
  return point(
    r.position.x + r.size.width / 2,
    r.position.y + r.size.height / 2
  );
}

export function contains(r: Rect, p: Point): boolean {
  return (
    p.x >= r.position.x &&
    p.x <= right(r) &&
    p.y >= r.position.y &&
    p.y <= bottom(r)
  );
}

export function intersects(a: Rect, b: Rect): boolean {
  return !(
    right(a) < b.position.x ||
    right(b) < a.position.x ||
    bottom(a) < b.position.y ||
    bottom(b) < a.position.y
  );
}

/** Expands a rect by `amount` on every side. Used for auto-routing clearance. */
export function inflate(r: Rect, amount: number): Rect {
  return rectFromBounds(
    r.position.x - amount,
    r.position.y - amount,
    r.size.width + amount * 2,
    r.size.height + amount * 2
  );
}
