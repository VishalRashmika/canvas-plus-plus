import { Point, point } from "../value-objects/Point";
import { Size } from "../value-objects/Rect";

export interface AlignmentGuides {
  verticalLines: number[];
  horizontalLines: number[];
}

export interface SnappedGuideResult {
  snappedPosition: Point;
  guides: AlignmentGuides;
}

export class SnappingService {
  snapToGrid(pt: Point, gridSize = 20): Point {
    if (gridSize <= 0) return pt;
    return point(
      Math.round(pt.x / gridSize) * gridSize,
      Math.round(pt.y / gridSize) * gridSize
    );
  }

  snapToGuides(
    movingRect: { position: Point; size: Size },
    otherRects: Array<{ position: Point; size: Size }>,
    threshold = 8
  ): SnappedGuideResult {
    let snappedX = movingRect.position.x;
    let snappedY = movingRect.position.y;
    const verticalLines: number[] = [];
    const horizontalLines: number[] = [];

    const movingW = movingRect.size.width;
    const movingH = movingRect.size.height;
    const movingCenterX = movingRect.position.x + movingW / 2;
    const movingCenterY = movingRect.position.y + movingH / 2;
    const movingRight = movingRect.position.x + movingW;
    const movingBottom = movingRect.position.y + movingH;

    let minDeltaX = threshold + 1;
    let minDeltaY = threshold + 1;

    for (const other of otherRects) {
      const otherW = other.size.width;
      const otherH = other.size.height;
      const otherCenterX = other.position.x + otherW / 2;
      const otherCenterY = other.position.y + otherH / 2;
      const otherRight = other.position.x + otherW;
      const otherBottom = other.position.y + otherH;

      // Vertical alignment candidates (checks X positions)
      const xAlignments: Array<{ movingVal: number; otherVal: number; targetX: number }> = [
        { movingVal: movingRect.position.x, otherVal: other.position.x, targetX: other.position.x },
        { movingVal: movingRight, otherVal: otherRight, targetX: otherRight - movingW },
        { movingVal: movingCenterX, otherVal: otherCenterX, targetX: otherCenterX - movingW / 2 },
        { movingVal: movingRect.position.x, otherVal: otherRight, targetX: otherRight },
        { movingVal: movingRight, otherVal: other.position.x, targetX: other.position.x - movingW },
      ];

      for (const a of xAlignments) {
        const delta = Math.abs(a.movingVal - a.otherVal);
        if (delta <= threshold && delta < minDeltaX) {
          minDeltaX = delta;
          snappedX = a.targetX;
          verticalLines.length = 0;
          verticalLines.push(a.otherVal);
        }
      }

      // Horizontal alignment candidates (checks Y positions)
      const yAlignments: Array<{ movingVal: number; otherVal: number; targetY: number }> = [
        { movingVal: movingRect.position.y, otherVal: other.position.y, targetY: other.position.y },
        { movingVal: movingBottom, otherVal: otherBottom, targetY: otherBottom - movingH },
        { movingVal: movingCenterY, otherVal: otherCenterY, targetY: otherCenterY - movingH / 2 },
        { movingVal: movingRect.position.y, otherVal: otherBottom, targetY: otherBottom },
        { movingVal: movingBottom, otherVal: other.position.y, targetY: other.position.y - movingH },
      ];

      for (const a of yAlignments) {
        const delta = Math.abs(a.movingVal - a.otherVal);
        if (delta <= threshold && delta < minDeltaY) {
          minDeltaY = delta;
          snappedY = a.targetY;
          horizontalLines.length = 0;
          horizontalLines.push(a.otherVal);
        }
      }
    }

    return {
      snappedPosition: point(Math.round(snappedX), Math.round(snappedY)),
      guides: {
        verticalLines,
        horizontalLines,
      },
    };
  }
}

export const defaultSnappingService = new SnappingService();
