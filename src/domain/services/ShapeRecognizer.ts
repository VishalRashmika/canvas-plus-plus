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

    // Check if stroke ends with an arrow head (or starts with an arrowhead)
    const arrowCheck = this.detectArrowHead(points);
    if (arrowCheck.hasArrowHead) {
      return {
        shape: "arrow",
        confidence: Math.min(0.95, Math.max(0.7, arrowCheck.confidence)),
        bounds,
        startPoint: arrowCheck.tailPoint ?? { x: start.x, y: start.y },
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

  public detectArrowHead(points: StrokePoint[]): {
    hasArrowHead: boolean;
    confidence: number;
    tipPoint: Point;
    tailPoint: Point;
    atStart?: boolean;
  } {
    const n = points.length;
    const defaultRes = {
      hasArrowHead: false,
      confidence: 0,
      tipPoint: { x: points[n - 1].x, y: points[n - 1].y },
      tailPoint: { x: points[0].x, y: points[0].y },
    };

    if (n < 4) {
      return defaultRes;
    }

    // 1. Calculate arc lengths and total length
    const arcLengths: number[] = [0];
    for (let i = 0; i < n - 1; i++) {
      const segLen = Math.hypot(
        points[i + 1].x - points[i].x,
        points[i + 1].y - points[i].y
      );
      arcLengths.push(arcLengths[i] + segLen);
    }
    const totalLen = arcLengths[n - 1];
    if (totalLen < 12) {
      return defaultRes;
    }

    // --- Hypothesis A: Arrowhead at the END (shaft from start to tip, head turns backwards) ---
    const minSplitA = Math.max(2, Math.floor(n * 0.35));
    const refIdxA = Math.min(n - 1, Math.max(minSplitA, Math.floor(n * 0.65)));
    let refDxA = points[refIdxA].x - points[0].x;
    let refDyA = points[refIdxA].y - points[0].y;
    let refDistA = Math.hypot(refDxA, refDyA);
    if (refDistA < 5) {
      refDxA = points[n - 1].x - points[0].x;
      refDyA = points[n - 1].y - points[0].y;
      refDistA = Math.hypot(refDxA, refDyA);
    }

    if (refDistA >= 8) {
      const uAx = refDxA / refDistA;
      const uAy = refDyA / refDistA;

      let maxProjA = -Infinity;
      let maxProjIdxA = minSplitA;
      for (let i = minSplitA; i < n; i++) {
        const proj = (points[i].x - points[0].x) * uAx + (points[i].y - points[0].y) * uAy;
        if (proj > maxProjA) {
          maxProjA = proj;
          maxProjIdxA = i;
        }
      }

      const candidatesA: number[] = [];
      if (maxProjIdxA < n - 1 && maxProjIdxA >= minSplitA) {
        candidatesA.push(maxProjIdxA);
      }
      for (let i = minSplitA; i < n - 1; i++) {
        if (!candidatesA.includes(i)) {
          candidatesA.push(i);
        }
      }

      let bestTipIdxA = -1;
      let bestConfidenceA = 0;

      for (const k of candidatesA) {
        const shaftDist = Math.hypot(points[k].x - points[0].x, points[k].y - points[0].y);
        const shaftLen = arcLengths[k];
        const shaftStraightness = shaftDist / Math.max(1, shaftLen);
        if (shaftStraightness < 0.65 || shaftDist < 10) continue;

        const headLen = totalLen - shaftLen;
        if (headLen < 4 || headLen > 1.35 * shaftLen) continue;

        const sDx = points[k].x - points[0].x;
        const sDy = points[k].y - points[0].y;
        const sDist = Math.hypot(sDx, sDy);
        if (sDist < 5) continue;
        const sUx = sDx / sDist;
        const sUy = sDy / sDist;

        let maxRetreat = 0;
        for (let j = k; j < n; j++) {
          const pProj = (points[j].x - points[k].x) * sUx + (points[j].y - points[k].y) * sUy;
          if (pProj < maxRetreat) {
            maxRetreat = pProj;
          }
        }

        const shaftAngle = Math.atan2(sDy, sDx);
        let sharpTurns = 0;
        for (let j = k; j < n - 1; j++) {
          const segDx = points[j + 1].x - points[j].x;
          const segDy = points[j + 1].y - points[j].y;
          const segLen = Math.hypot(segDx, segDy);
          if (segLen < 1.5) continue;
          const segAngle = Math.atan2(segDy, segDx);
          let diff = Math.abs(segAngle - shaftAngle);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          if (diff > Math.PI * 0.35) { // > ~63 degrees
            sharpTurns++;
          }
        }

        if (maxRetreat <= -2.5 || sharpTurns >= 1) {
          const conf = Math.min(0.98, Math.max(0.72, shaftStraightness - (headLen / shaftLen) * 0.08));
          if (conf > bestConfidenceA) {
            bestConfidenceA = conf;
            bestTipIdxA = k;
          }
        }
      }

      if (bestTipIdxA !== -1) {
        return {
          hasArrowHead: true,
          confidence: bestConfidenceA,
          tipPoint: { x: points[bestTipIdxA].x, y: points[bestTipIdxA].y },
          tailPoint: { x: points[0].x, y: points[0].y },
          atStart: false,
        };
      }
    }

    // --- Hypothesis B: Arrowhead at the START (stroke drawn starting with arrowhead, then shaft) ---
    const maxSplitB = Math.min(n - 3, Math.ceil(n * 0.65));
    const refIdxB = Math.max(0, Math.floor(n * 0.35));
    let refDxB = points[n - 1].x - points[refIdxB].x;
    let refDyB = points[n - 1].y - points[refIdxB].y;
    let refDistB = Math.hypot(refDxB, refDyB);
    if (refDistB < 5) {
      refDxB = points[n - 1].x - points[0].x;
      refDyB = points[n - 1].y - points[0].y;
      refDistB = Math.hypot(refDxB, refDyB);
    }

    if (refDistB >= 8) {
      const uBx = refDxB / refDistB;
      const uBy = refDyB / refDistB;

      let minProjB = Infinity;
      let minProjIdxB = 0;
      for (let i = 0; i <= maxSplitB; i++) {
        const proj = (points[i].x - points[n - 1].x) * uBx + (points[i].y - points[n - 1].y) * uBy;
        if (proj < minProjB) {
          minProjB = proj;
          minProjIdxB = i;
        }
      }

      const candidatesB: number[] = [];
      if (minProjIdxB > 0 && minProjIdxB <= maxSplitB) {
        candidatesB.push(minProjIdxB);
      }
      for (let i = 1; i <= maxSplitB; i++) {
        if (!candidatesB.includes(i)) candidatesB.push(i);
      }

      let bestTipIdxB = -1;
      let bestConfidenceB = 0;

      for (const k of candidatesB) {
        const shaftDist = Math.hypot(points[n - 1].x - points[k].x, points[n - 1].y - points[k].y);
        const shaftLen = totalLen - arcLengths[k];
        const shaftStraightness = shaftDist / Math.max(1, shaftLen);
        if (shaftStraightness < 0.65 || shaftDist < 10) continue;

        const headLen = arcLengths[k];
        if (headLen < 4 || headLen > 1.35 * shaftLen) continue;

        const sDx = points[n - 1].x - points[k].x;
        const sDy = points[n - 1].y - points[k].y;
        const sDist = Math.hypot(sDx, sDy);
        if (sDist < 5) continue;

        const shaftAngle = Math.atan2(sDy, sDx);
        let sharpTurns = 0;
        for (let j = 0; j < k; j++) {
          const segDx = points[j + 1].x - points[j].x;
          const segDy = points[j + 1].y - points[j].y;
          const segLen = Math.hypot(segDx, segDy);
          if (segLen < 1.5) continue;
          const segAngle = Math.atan2(segDy, segDx);
          let diff = Math.abs(segAngle - shaftAngle);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          if (diff > Math.PI * 0.35) {
            sharpTurns++;
          }
        }

        if (sharpTurns >= 1) {
          const conf = Math.min(0.98, Math.max(0.72, shaftStraightness - (headLen / shaftLen) * 0.08));
          if (conf > bestConfidenceB) {
            bestConfidenceB = conf;
            bestTipIdxB = k;
          }
        }
      }

      if (bestTipIdxB !== -1) {
        return {
          hasArrowHead: true,
          confidence: bestConfidenceB,
          tipPoint: { x: points[bestTipIdxB].x, y: points[bestTipIdxB].y },
          tailPoint: { x: points[n - 1].x, y: points[n - 1].y },
          atStart: true,
        };
      }
    }

    return defaultRes;
  }

  public detectStandaloneArrowhead(points: StrokePoint[]): {
    isArrowHead: boolean;
    confidence: number;
    tipPoint: Point;
    direction: Point;
  } {
    const n = points.length;
    const defaultRes = {
      isArrowHead: false,
      confidence: 0,
      tipPoint: { x: points[Math.floor(n / 2)]?.x ?? 0, y: points[Math.floor(n / 2)]?.y ?? 0 },
      direction: { x: 1, y: 0 },
    };

    if (n < 3) return defaultRes;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const width = maxX - minX;
    const height = maxY - minY;
    if (Math.max(width, height) < 6 || Math.max(width, height) > 160) {
      return defaultRes;
    }

    let totalLen = 0;
    for (let i = 0; i < n - 1; i++) {
      totalLen += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    }
    if (totalLen < 8 || totalLen > 320) return defaultRes;

    const endDist = Math.hypot(points[n - 1].x - points[0].x, points[n - 1].y - points[0].y);
    if (endDist < 6 && totalLen > 30) return defaultRes;

    let bestCornerIdx = -1;
    let bestAngleDiff = 0;
    for (let i = 1; i < n - 1; i++) {
      const dx1 = points[i].x - points[0].x;
      const dy1 = points[i].y - points[0].y;
      const len1 = Math.hypot(dx1, dy1);
      const dx2 = points[n - 1].x - points[i].x;
      const dy2 = points[n - 1].y - points[i].y;
      const len2 = Math.hypot(dx2, dy2);

      if (len1 < 3 || len2 < 3) continue;

      const ratio = len1 / len2;
      if (ratio < 0.18 || ratio > 5.5) continue;

      const ang1 = Math.atan2(dy1, dx1);
      const ang2 = Math.atan2(dy2, dx2);
      let diff = Math.abs(ang2 - ang1);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;

      if (diff >= Math.PI * 0.20 && diff <= Math.PI * 0.90) {
        if (diff > bestAngleDiff) {
          bestAngleDiff = diff;
          bestCornerIdx = i;
        }
      }
    }

    if (bestCornerIdx !== -1) {
      const tip = { x: points[bestCornerIdx].x, y: points[bestCornerIdx].y };
      const baseMid = {
        x: (points[0].x + points[n - 1].x) / 2,
        y: (points[0].y + points[n - 1].y) / 2,
      };
      const dirDx = tip.x - baseMid.x;
      const dirDy = tip.y - baseMid.y;
      const dirLen = Math.hypot(dirDx, dirDy);
      const direction = dirLen > 0 ? { x: dirDx / dirLen, y: dirDy / dirLen } : { x: 1, y: 0 };

      return {
        isArrowHead: true,
        confidence: 0.85,
        tipPoint: tip,
        direction,
      };
    }

    return defaultRes;
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

    if (rectErr < 0.28 || areaRatio >= 0.60) {
      return { shape: isSquare ? "square" : "rectangle", confidence: 0.70, bounds };
    }

    return { shape: "none", confidence: 0.25, bounds };
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
