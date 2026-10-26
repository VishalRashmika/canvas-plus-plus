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
  | "square"
  | "diamond"
  | "ellipse"
  | "circle"
  | "triangle"
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

    const isClosed =
      (closureRatio < 0.25 && endToEndDist < Math.max(50, 0.35 * Math.hypot(width, height))) ||
      (endToEndDist < 25 && closureRatio < 0.40);

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

    // Straight line evaluation (support natural handdrawn lines with slight curves/wobble)
    if (straightness >= 0.50) {
      const confidence = Math.max(0.70, Math.min(1.0, straightness));
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
      confidence: Math.max(0.2, straightness),
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
    const aspectRatio = bw / bh;
    const diag = Math.hypot(bw, bh);

    // Shoelace Area Ratio
    const polygonArea = this.calculateShoelaceArea(points);
    const boxArea = bw * bh;
    const areaRatio = polygonArea / Math.max(1, boxArea);

    // Multi-norm error calculations & geometric indicators
    let rectErrSum = 0;
    let ellipseErrSum = 0;
    let diamondErrSum = 0;
    let boxEdgeDistSum = 0;
    const ellipseDists: number[] = [];
    let maxHypot = 0;

    const corners: Point[] = [
      { x: bx, y: by },
      { x: bx + bw, y: by },
      { x: bx + bw, y: by + bh },
      { x: bx, y: by + bh },
    ];
    const cornerDists = corners.map(
      (c) => Math.min(...points.map((p) => Math.hypot(p.x - c.x, p.y - c.y))) / diag
    );
    const avgCornerDist = cornerDists.reduce((a, b) => a + b, 0) / 4;
    const cornersReached = cornerDists.filter((d) => d < 0.11).length;

    for (const p of points) {
      const u = Math.abs(p.x - cx) / rx;
      const v = Math.abs(p.y - cy) / ry;

      // L_inf norm: distance to rectangle perimeter
      const dRect = Math.max(u, v);
      rectErrSum += Math.abs(dRect - 1);

      // L_2 norm: distance to ellipse/circle perimeter
      const dEllipse = Math.hypot(u, v);
      ellipseErrSum += Math.abs(dEllipse - 1);
      ellipseDists.push(dEllipse);
      if (dEllipse > maxHypot) {
        maxHypot = dEllipse;
      }

      // L_1 norm: distance to diamond perimeter
      const dDiamond = u + v;
      diamondErrSum += Math.abs(dDiamond - 1);

      // Distance to 4 bounding box edges
      const distToSides =
        Math.min(
          Math.abs(p.x - bx),
          Math.abs(p.x - (bx + bw)),
          Math.abs(p.y - by),
          Math.abs(p.y - (by + bh))
        ) / Math.min(bw, bh);
      boxEdgeDistSum += distToSides;
    }

    const n = points.length;
    const rectErr = rectErrSum / n;
    const ellipseErr = ellipseErrSum / n;
    const diamondErr = diamondErrSum / n;
    const boxEdgeDistAvg = boxEdgeDistSum / n;

    const meanEllipseDist = ellipseDists.reduce((a, b) => a + b, 0) / n;
    let ellipseVariance = 0;
    for (const d of ellipseDists) {
      ellipseVariance += (d - meanEllipseDist) * (d - meanEllipseDist);
    }
    const stdDevEllipse = Math.sqrt(ellipseVariance / n);

    // Triangle perimeter fit
    const candidateTriangles: [Point, Point, Point][] = [
      // Upright
      [{ x: cx, y: by }, { x: bx + bw, y: by + bh }, { x: bx, y: by + bh }],
      // Inverted
      [{ x: cx, y: by + bh }, { x: bx + bw, y: by }, { x: bx, y: by }],
      // Right-pointing
      [{ x: bx + bw, y: cy }, { x: bx, y: by }, { x: bx, y: by + bh }],
      // Left-pointing
      [{ x: bx, y: cy }, { x: bx + bw, y: by }, { x: bx + bw, y: by + bh }],
    ];

    let bestTriangleNormDist = Infinity;
    for (const [t1, t2, t3] of candidateTriangles) {
      let distSum = 0;
      for (const p of points) {
        distSum += this.distToTriangle(p, t1, t2, t3);
      }
      const normDist = distSum / (n * diag);
      if (normDist < bestTriangleNormDist) {
        bestTriangleNormDist = normDist;
      }
    }

    // 1. Triangle
    if (
      areaRatio >= 0.28 &&
      areaRatio <= 0.65 &&
      bestTriangleNormDist < 0.14 &&
      bestTriangleNormDist < diamondErr &&
      bestTriangleNormDist < rectErr
    ) {
      const confidence = Math.max(
        0.75,
        Math.min(0.98, 1.0 - bestTriangleNormDist * 2 - Math.abs(areaRatio - 0.5) * 0.4)
      );
      return { shape: "triangle", confidence, bounds };
    }

    // 2. Diamond:
    // A diamond has area ratio around 0.40 - 0.58, minimal diamondErr, corners of bounding box are empty,
    // and points never reach into the corner quadrants (maxHypot < 1.15).
    const isDiamond =
      areaRatio <= 0.58 &&
      areaRatio >= 0.35 &&
      diamondErr < 0.18 &&
      diamondErr < ellipseErr &&
      diamondErr < rectErr &&
      maxHypot < 1.15 &&
      avgCornerDist >= 0.18 &&
      cornersReached === 0;

    if (isDiamond) {
      const confidence = Math.max(
        0.75,
        Math.min(0.98, 1.0 - Math.abs(areaRatio - 0.5) - diamondErr)
      );
      return { shape: "diamond", confidence, bounds };
    }

    // 3. Circle / Ellipse:
    // Low ellipse radial deviation, low ellipseErr, maxHypot < 1.18 (points cannot exceed radius),
    // corners are not filled (avgCornerDist >= 0.12), and points curve away from bounding box edges.
    const isSquareAspect = aspectRatio >= 0.75 && aspectRatio <= 1.33;
    const isEllipse =
      !isDiamond &&
      stdDevEllipse < 0.14 &&
      ellipseErr < 0.15 &&
      ellipseErr < rectErr &&
      maxHypot < 1.18 &&
      areaRatio >= 0.60 &&
      areaRatio <= 0.88 &&
      cornersReached < 2 &&
      avgCornerDist >= 0.10;

    if (isEllipse) {
      const isCircle = isSquareAspect;
      const aspectDiff = Math.abs(aspectRatio - 1.0);
      const confidence = Math.max(
        0.75,
        Math.min(
          0.98,
          1.0 - stdDevEllipse * 2 - Math.abs(areaRatio - 0.785) - (isCircle ? aspectDiff * 0.08 : 0)
        )
      );
      return { shape: isCircle ? "circle" : "ellipse", confidence, bounds };
    }

    // 4. Rectangle / Square:
    // Handdrawn boxes and squares occupy the bounding box perimeter (high area ratio >= 0.65,
    // corner reach in multiple quadrants, maxHypot reaching >= 1.18 at corners, or low boxEdgeDistAvg).
    const isSquare = isSquareAspect;
    const isRectangular =
      !isDiamond &&
      !isEllipse &&
      (areaRatio >= 0.65 ||
        cornersReached >= 2 ||
        maxHypot >= 1.18 ||
        rectErr <= ellipseErr ||
        boxEdgeDistAvg <= 0.08 ||
        rectErr < 0.25);

    if (isRectangular) {
      const confidence = Math.max(
        0.75,
        Math.min(0.98, 1.0 - Math.min(rectErr, boxEdgeDistAvg) * 1.5)
      );
      return { shape: isSquare ? "square" : "rectangle", confidence, bounds };
    }

    // Fallbacks
    if (bestTriangleNormDist < rectErr && bestTriangleNormDist < diamondErr) {
      return { shape: "triangle", confidence: 0.70, bounds };
    }

    if (diamondErr < rectErr && diamondErr < ellipseErr && areaRatio <= 0.58 && avgCornerDist >= 0.18) {
      return { shape: "diamond", confidence: 0.70, bounds };
    }

    if (stdDevEllipse < 0.14 && ellipseErr < rectErr && maxHypot < 1.18) {
      return { shape: isSquareAspect ? "circle" : "ellipse", confidence: 0.70, bounds };
    }

    return { shape: isSquare ? "square" : "rectangle", confidence: 0.75, bounds };
  }

  private distToSegment(p: Point, v: Point, w: Point): number {
    const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = v.x + t * (w.x - v.x);
    const projY = v.y + t * (w.y - v.y);
    return Math.hypot(p.x - projX, p.y - projY);
  }

  private distToTriangle(p: Point, a: Point, b: Point, c: Point): number {
    return Math.min(
      this.distToSegment(p, a, b),
      this.distToSegment(p, b, c),
      this.distToSegment(p, c, a)
    );
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
