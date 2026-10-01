import { Point } from "../value-objects/Point";
import { Rect, rectFromBounds } from "../value-objects/Rect";

export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
  time?: number;
}

export interface Stroke {
  id: string;
  points: StrokePoint[];
}

export type RecognizedShapeKind =
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "line"
  | "arrow"
  | "none";

export interface RecognitionResult {
  shape: RecognizedShapeKind;
  confidence: number; // 0.0 to 1.0
  bounds: Rect;
  startPoint?: Point;
  endPoint?: Point;
}

/**
 * Pure domain service that recognizes geometric shapes from a sequence of stroke points.
 * Operates without DOM dependencies.
 */
export class ShapeRecognizer {
  /**
   * Recognizes the most probable geometric shape from a freehand stroke.
   */
  public recognize(stroke: Stroke): RecognitionResult {
    const points = stroke.points;
    const defaultBounds: Rect = rectFromBounds(0, 0, 0, 0);

    if (!points || points.length < 3) {
      return { shape: "none", confidence: 0, bounds: defaultBounds };
    }

    // 1. Calculate bounding box
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const bounds: Rect = rectFromBounds(minX, minY, width, height);

    if (width < 6 && height < 6) {
      return { shape: "none", confidence: 0, bounds };
    }

    // 2. Calculate total arc length
    let totalLength = 0;
    for (let i = 0; i < points.length - 1; i++) {
      totalLength += Math.hypot(
        points[i + 1].x - points[i].x,
        points[i + 1].y - points[i].y
      );
    }

    if (totalLength < 10) {
      return { shape: "none", confidence: 0, bounds };
    }

    const start = points[0];
    const end = points[points.length - 1];
    const endToEndDist = Math.hypot(end.x - start.x, end.y - start.y);
    const closureRatio = endToEndDist / totalLength;

    const isClosed = endToEndDist < 35 || closureRatio < 0.22;

    if (!isClosed) {
      return this.recognizeOpenStroke(points, bounds, totalLength, endToEndDist);
    } else {
      return this.recognizeClosedStroke(points, bounds);
    }
  }

  private recognizeOpenStroke(
    points: StrokePoint[],
    bounds: Rect,
    totalLength: number,
    endToEndDist: number
  ): RecognitionResult {
    const start = points[0];
    const end = points[points.length - 1];
    const straightness = endToEndDist / totalLength;

    // Check if stroke ends with an arrow head (hook/barb in the last 20-30% of stroke)
    const arrowCheck = this.detectArrowHead(points);
    if (arrowCheck.hasArrowHead) {
      return {
        shape: "arrow",
        confidence: Math.min(0.95, Math.max(0.7, arrowCheck.confidence)),
        bounds,
        startPoint: { x: start.x, y: start.y },
        endPoint: arrowCheck.tipPoint,
      };
    }

    // Straight line evaluation
    if (straightness >= 0.82) {
      const confidence = Math.min(1.0, straightness);
      return {
        shape: "line",
        confidence,
        bounds,
        startPoint: { x: start.x, y: start.y },
        endPoint: { x: end.x, y: end.y },
      };
    }

    return {
      shape: "none",
      confidence: 0.2,
      bounds,
      startPoint: { x: start.x, y: start.y },
      endPoint: { x: end.x, y: end.y },
    };
  }

  private detectArrowHead(points: StrokePoint[]): {
    hasArrowHead: boolean;
    confidence: number;
    tipPoint: Point;
  } {
    const n = points.length;
    if (n < 8) {
      return {
        hasArrowHead: false,
        confidence: 0,
        tipPoint: { x: points[n - 1].x, y: points[n - 1].y },
      };
    }

    // Main shaft should be roughly the first 70-80% of points
    const splitIndex = Math.floor(n * 0.75);
    const shaftPoints = points.slice(0, splitIndex);
    const headPoints = points.slice(splitIndex);

    let shaftLength = 0;
    for (let i = 0; i < shaftPoints.length - 1; i++) {
      shaftLength += Math.hypot(
        shaftPoints[i + 1].x - shaftPoints[i].x,
        shaftPoints[i + 1].y - shaftPoints[i].y
      );
    }
    const shaftDist = Math.hypot(
      shaftPoints[shaftPoints.length - 1].x - shaftPoints[0].x,
      shaftPoints[shaftPoints.length - 1].y - shaftPoints[0].y
    );

    const shaftStraightness = shaftDist / Math.max(1, shaftLength);

    if (shaftStraightness < 0.8) {
      return {
        hasArrowHead: false,
        confidence: 0,
        tipPoint: { x: points[n - 1].x, y: points[n - 1].y },
      };
    }

    // Check angle change in head points relative to shaft direction
    const shaftDx = shaftPoints[shaftPoints.length - 1].x - shaftPoints[0].x;
    const shaftDy = shaftPoints[shaftPoints.length - 1].y - shaftPoints[0].y;
    const shaftAngle = Math.atan2(shaftDy, shaftDx);

    let sharpTurnCount = 0;
    for (let i = 0; i < headPoints.length - 1; i++) {
      const hDx = headPoints[i + 1].x - headPoints[i].x;
      const hDy = headPoints[i + 1].y - headPoints[i].y;
      const headAngle = Math.atan2(hDy, hDx);
      let angleDiff = Math.abs(headAngle - shaftAngle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

      // An arrow barb turns sharply back (> 90 degrees)
      if (angleDiff > Math.PI / 2) {
        sharpTurnCount++;
      }
    }

    let maxProj = -Infinity;
    let tip = shaftPoints[shaftPoints.length - 1];
    const shaftLen = Math.hypot(shaftDx, shaftDy);
    if (shaftLen > 0) {
      const uX = shaftDx / shaftLen;
      const uY = shaftDy / shaftLen;
      for (const p of points) {
        const proj = (p.x - points[0].x) * uX + (p.y - points[0].y) * uY;
        if (proj > maxProj) {
          maxProj = proj;
          tip = p;
        }
      }
    }

    if (sharpTurnCount >= 1) {
      return {
        hasArrowHead: true,
        confidence: 0.85,
        tipPoint: { x: tip.x, y: tip.y },
      };
    }

    return {
      hasArrowHead: false,
      confidence: 0,
      tipPoint: { x: points[n - 1].x, y: points[n - 1].y },
    };
  }

  private recognizeClosedStroke(
    points: StrokePoint[],
    bounds: Rect
  ): RecognitionResult {
    const bx = bounds.position.x;
    const by = bounds.position.y;
    const bw = bounds.size.width;
    const bh = bounds.size.height;

    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    const rx = bw / 2;
    const ry = bh / 2;

    // 1. Ellipse Radial Distance Fit
    // For an ellipse: ((x - cx) / rx)^2 + ((y - cy) / ry)^2 should be close to 1
    let sumNormalizedDist = 0;
    const normalizedDists: number[] = [];

    for (const p of points) {
      const d = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
      normalizedDists.push(d);
      sumNormalizedDist += d;
    }

    const meanDist = sumNormalizedDist / points.length;
    let variance = 0;
    for (const d of normalizedDists) {
      variance += (d - meanDist) * (d - meanDist);
    }
    const stdDev = Math.sqrt(variance / points.length);

    // 2. Shoelace Area Ratio
    const polygonArea = this.calculateShoelaceArea(points);
    const boxArea = bw * bh;
    const areaRatio = polygonArea / Math.max(1, boxArea);

    // 3. Simplified corner detection via Ramer-Douglas-Peucker
    const epsilon = Math.max(bw, bh) * 0.05;
    const simplified = this.rdpSimplify(points, epsilon);
    const cornerCount = simplified.length - 1;

    // Determine whether corners match diamond midpoints or rectangle corners
    let rectCornerDistSum = 0;
    let diamondCornerDistSum = 0;

    const rectCorners: Point[] = [
      { x: bx, y: by },
      { x: bx + bw, y: by },
      { x: bx + bw, y: by + bh },
      { x: bx, y: by + bh },
    ];

    const diamondCorners: Point[] = [
      { x: cx, y: by },
      { x: bx + bw, y: cy },
      { x: cx, y: by + bh },
      { x: bx, y: cy },
    ];

    for (const rc of rectCorners) {
      let minDist = Infinity;
      for (const p of points) {
        minDist = Math.min(minDist, Math.hypot(p.x - rc.x, p.y - rc.y));
      }
      rectCornerDistSum += minDist;
    }

    for (const dc of diamondCorners) {
      let minDist = Infinity;
      for (const p of points) {
        minDist = Math.min(minDist, Math.hypot(p.x - dc.x, p.y - dc.y));
      }
      diamondCornerDistSum += minDist;
    }

    const diag = Math.hypot(bw, bh);
    const normRectDist = rectCornerDistSum / (4 * diag);
    const normDiamondDist = diamondCornerDistSum / (4 * diag);

    // Classification Logic:

    // A. Diamond: area ratio around 0.45 - 0.65, diamond midpoints matched better than corners
    if (
      areaRatio < 0.68 &&
      normDiamondDist < normRectDist &&
      normDiamondDist < 0.22
    ) {
      const confidence = Math.max(
        0.7,
        Math.min(0.96, 1.0 - Math.abs(areaRatio - 0.5) - normDiamondDist)
      );
      return { shape: "diamond", confidence, bounds };
    }

    // B. Ellipse / Circle: low standard deviation from ellipse radial equation and area ratio ~0.78
    if (stdDev < 0.16 && areaRatio >= 0.65 && areaRatio <= 0.88) {
      const confidence = Math.max(
        0.75,
        Math.min(0.98, 1.0 - stdDev * 2 - Math.abs(areaRatio - 0.785))
      );
      return { shape: "ellipse", confidence, bounds };
    }

    // C. Rectangle: area ratio >= 0.70, rect corners matched well
    if (areaRatio >= 0.70 && normRectDist < 0.20) {
      const confidence = Math.max(
        0.75,
        Math.min(0.98, 1.0 - normRectDist * 2)
      );
      return { shape: "rectangle", confidence, bounds };
    }

    // Secondary checks based on corner count
    if (cornerCount >= 4 && cornerCount <= 6) {
      if (normDiamondDist < normRectDist) {
        return { shape: "diamond", confidence: 0.72, bounds };
      }
      return { shape: "rectangle", confidence: 0.75, bounds };
    }

    if (stdDev < 0.22) {
      return { shape: "ellipse", confidence: 0.68, bounds };
    }

    return { shape: "rectangle", confidence: 0.65, bounds };
  }

  private calculateShoelaceArea(points: StrokePoint[]): number {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
  }

  private rdpSimplify(points: StrokePoint[], epsilon: number): StrokePoint[] {
    if (points.length <= 2) return points;

    let maxDist = 0;
    let index = 0;
    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
      const dist = this.perpendicularDistance(points[i], first, last);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }

    if (maxDist > epsilon) {
      const left = this.rdpSimplify(points.slice(0, index + 1), epsilon);
      const right = this.rdpSimplify(points.slice(index), epsilon);
      return left.slice(0, left.length - 1).concat(right);
    } else {
      return [first, last];
    }
  }

  private perpendicularDistance(
    p: StrokePoint,
    lineStart: StrokePoint,
    lineEnd: StrokePoint
  ): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lineLen = Math.hypot(dx, dy);
    if (lineLen === 0) return Math.hypot(p.x - lineStart.x, p.y - lineStart.y);

    return Math.abs(dy * p.x - dx * p.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / lineLen;
  }
}

export const defaultShapeRecognizer = new ShapeRecognizer();
