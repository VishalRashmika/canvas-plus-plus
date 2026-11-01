import { Point } from "../value-objects/Point";
import { Rect, rectFromBounds } from "../value-objects/Rect";
import { Stroke, StrokePoint } from "./ShapeRecognizer";
import { defaultHandwrittenFontDetector } from "./HandwrittenFontDetector";

export interface DetectedTable {
  isTable: boolean;
  confidence: number;
  rows: number;
  cols: number;
  bounds: Rect;
  cells: string[][];
  rowHeights?: number[];
  colWidths?: number[];
}

interface StrokeFeatures {
  stroke: Stroke;
  index: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
  totalLength: number;
  straightness: number;
  isClosed: boolean;
  isRectangle: boolean;
  isHorizontal: boolean;
  isVertical: boolean;
  p0: StrokePoint;
  pN: StrokePoint;
  shoelaceArea: number;
}

/**
 * TableDetector
 *
 * Domain service that detects whether a collection of freehand strokes forms
 * a hand-drawn table (e.g. 3x3 table, 2x2 table, NxM grid).
 *
 * Detects:
 * 1. Outer bounding box + internal horizontal row dividers & vertical column dividers.
 * 2. Grid of intersecting horizontal and vertical lines (e.g. 4 horizontal + 4 vertical = 3x3 table,
 *    or tic-tac-toe style crossing lines).
 * 3. Grid of adjacent cell rectangles.
 * 4. Extracts text handwritten inside individual cells if present.
 */
export class TableDetector {
  public detect(input: Stroke | Stroke[]): DetectedTable {
    const rawStrokes = Array.isArray(input) ? input : [input];
    const defaultBounds = rectFromBounds(0, 0, 0, 0);

    const strokes = rawStrokes.filter((s) => s && s.points && s.points.length >= 2);

    if (strokes.length < 2) {
      return {
        isTable: false,
        confidence: 0,
        rows: 0,
        cols: 0,
        bounds: defaultBounds,
        cells: [],
      };
    }

    // 1. Calculate overall bounding box
    let overallMinX = Infinity;
    let overallMinY = Infinity;
    let overallMaxX = -Infinity;
    let overallMaxY = -Infinity;

    for (const stroke of strokes) {
      for (const p of stroke.points) {
        if (p.x < overallMinX) overallMinX = p.x;
        if (p.x > overallMaxX) overallMaxX = p.x;
        if (p.y < overallMinY) overallMinY = p.y;
        if (p.y > overallMaxY) overallMaxY = p.y;
      }
    }

    const overallW = Math.max(1, overallMaxX - overallMinX);
    const overallH = Math.max(1, overallMaxY - overallMinY);
    const overallBounds = rectFromBounds(overallMinX, overallMinY, overallW, overallH);

    // Reject tiny drawings (< 50x40) - characters or icons, not tables
    if (overallW < 50 || overallH < 40) {
      return {
        isTable: false,
        confidence: 0,
        rows: 0,
        cols: 0,
        bounds: overallBounds,
        cells: [],
      };
    }

    // 2. Extract stroke features
    const features: StrokeFeatures[] = strokes.map((s, idx) =>
      this.extractStrokeFeatures(s, idx)
    );

    // 3. Check for Grid of Individual Rectangles (e.g. 9 adjacent cell boxes)
    const cellBoxTable = this.detectGridOfRectangles(features, overallBounds);
    if (cellBoxTable && cellBoxTable.isTable) {
      return cellBoxTable;
    }

    // 4. Check for Outer Bounding Box + Dividers, or Grid of Crossing Lines
    const gridTable = this.detectGridFromDividers(features, overallBounds, strokes);
    if (gridTable && gridTable.isTable) {
      return gridTable;
    }

    return {
      isTable: false,
      confidence: 0,
      rows: 0,
      cols: 0,
      bounds: overallBounds,
      cells: [],
    };
  }

  private extractStrokeFeatures(stroke: Stroke, index: number): StrokeFeatures {
    const pts = stroke.points;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let totalLength = 0;

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (i > 0) {
        totalLength += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
      }
    }

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const p0 = pts[0];
    const pN = pts[pts.length - 1];
    const dx = pN.x - p0.x;
    const dy = pN.y - p0.y;
    const endToEndDist = Math.hypot(dx, dy);
    const straightness = totalLength > 0 ? endToEndDist / totalLength : 0;

    const shoelaceArea = this.calculateShoelaceArea(pts);
    const boxArea = width * height;
    const areaRatio = shoelaceArea / Math.max(1, boxArea);

    const isClosed =
      endToEndDist < Math.max(16, 0.22 * Math.max(width, height)) &&
      totalLength > 0 &&
      endToEndDist / totalLength < 0.25;

    const isRectangle = isClosed && areaRatio >= 0.50 && width >= 25 && height >= 20;

    const thetaDeg = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;

    // A stroke is horizontal if it's substantially wider than tall and roughly horizontal
    const isHorizontal =
      !isRectangle && (width >= 1.6 * height || thetaDeg <= 25) && width >= 20;

    // A stroke is vertical if it's substantially taller than wide and roughly vertical
    const isVertical =
      !isRectangle && (height >= 1.6 * width || thetaDeg >= 65) && height >= 20;

    return {
      stroke,
      index,
      minX,
      minY,
      maxX,
      maxY,
      width,
      height,
      cx: minX + width / 2,
      cy: minY + height / 2,
      totalLength,
      straightness,
      isClosed,
      isRectangle,
      isHorizontal,
      isVertical,
      p0,
      pN,
      shoelaceArea,
    };
  }

  /**
   * Scenario: Grid of Rectangles (e.g. 9 individual rectangular boxes arranged in 3x3)
   */
  private detectGridOfRectangles(
    features: StrokeFeatures[],
    overallBounds: Rect
  ): DetectedTable | null {
    const rects = features.filter((f) => f.isRectangle);
    if (rects.length < 4) return null;

    // Must be at least 70% of all strokes
    if (rects.length / features.length < 0.7) return null;

    const avgW = rects.reduce((sum, r) => sum + r.width, 0) / rects.length;
    const avgH = rects.reduce((sum, r) => sum + r.height, 0) / rects.length;

    // Cluster centers by Y
    const rowClusters: number[][] = [];
    const sortedByY = [...rects].sort((a, b) => a.cy - b.cy);
    for (const r of sortedByY) {
      const match = rowClusters.find((c) => Math.abs(c[0] - r.cy) < avgH * 0.5);
      if (match) {
        match.push(r.cy);
      } else {
        rowClusters.push([r.cy]);
      }
    }

    // Cluster centers by X
    const colClusters: number[][] = [];
    const sortedByX = [...rects].sort((a, b) => a.cx - b.cx);
    for (const r of sortedByX) {
      const match = colClusters.find((c) => Math.abs(c[0] - r.cx) < avgW * 0.5);
      if (match) {
        match.push(r.cx);
      } else {
        colClusters.push([r.cx]);
      }
    }

    const rows = rowClusters.length;
    const cols = colClusters.length;

    if (rows >= 2 && cols >= 2 && Math.abs(rows * cols - rects.length) <= 2) {
      const emptyCells = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => "")
      );
      return {
        isTable: true,
        confidence: 0.95,
        rows,
        cols,
        bounds: overallBounds,
        cells: emptyCells,
        rowHeights: Array(rows).fill(Math.round(overallBounds.size.height / rows)),
        colWidths: Array(cols).fill(Math.round(overallBounds.size.width / cols)),
      };
    }

    return null;
  }

  /**
   * Scenario: Outer Bounding Box with Internal Dividers, OR Grid of Crossing Lines
   */
  private detectGridFromDividers(
    features: StrokeFeatures[],
    overallBounds: Rect,
    rawStrokes: Stroke[]
  ): DetectedTable | null {
    const overallW = overallBounds.size.width;
    const overallH = overallBounds.size.height;

    // Check for an outer enclosing rectangle stroke
    const outerBox = features.find(
      (f) =>
        f.isRectangle &&
        f.width >= 0.65 * overallW &&
        f.height >= 0.65 * overallH &&
        f.shoelaceArea / Math.max(1, f.width * f.height) >= 0.55
    );

    let tableMinX = outerBox ? outerBox.minX : overallBounds.position.x;
    let tableMaxX = outerBox ? outerBox.maxX : overallBounds.position.x + overallW;
    let tableMinY = outerBox ? outerBox.minY : overallBounds.position.y;
    let tableMaxY = outerBox ? outerBox.maxY : overallBounds.position.y + overallH;

    let tableW = Math.max(1, tableMaxX - tableMinX);
    let tableH = Math.max(1, tableMaxY - tableMinY);

    // Candidates for dividers / grid lines
    const otherFeatures = outerBox ? features.filter((f) => f !== outerBox) : features;

    // Filter horizontal lines that span at least 35% of the table width
    const hLines = otherFeatures.filter(
      (f) =>
        f.isHorizontal &&
        f.width >= 0.35 * tableW &&
        f.cx >= tableMinX - 0.15 * tableW &&
        f.cx <= tableMaxX + 0.15 * tableW
    );

    // Filter vertical lines that span at least 35% of the table height
    const vLines = otherFeatures.filter(
      (f) =>
        f.isVertical &&
        f.height >= 0.35 * tableH &&
        f.cy >= tableMinY - 0.15 * tableH &&
        f.cy <= tableMaxY + 0.15 * tableH
    );

    // If no outer box, ensure the extents are updated from the crossing lines
    if (!outerBox) {
      if (hLines.length < 2 || vLines.length < 2) {
        return null;
      }

      // In a real grid table of crossing lines (like # or a tic-tac-toe / NxM grid without an outer box),
      // the horizontal grid lines must span across the columns (from the leftmost vertical line to the rightmost),
      // and vertical grid lines must span across the rows (from the topmost horizontal line to the bottommost).
      // Separate letter strokes (e.g. in "HE", "TE", "THE", "THIS", "FILE") only span their own individual letter!
      const minVX = Math.min(...vLines.map((v) => v.cx));
      const maxVX = Math.max(...vLines.map((v) => v.cx));
      const minHY = Math.min(...hLines.map((h) => h.cy));
      const maxHY = Math.max(...hLines.map((h) => h.cy));

      // Must have distinct horizontal and vertical spread
      if (maxVX - minVX < 20 || maxHY - minHY < 20) {
        return null;
      }

      const tolSpanX = Math.max(12, (maxVX - minVX) * 0.18);
      const tolSpanY = Math.max(12, (maxHY - minHY) * 0.18);

      // Verify each horizontal line spans across the vertical lines
      const spanningHLines = hLines.filter(
        (hl) => hl.minX <= minVX + tolSpanX && hl.maxX >= maxVX - tolSpanX
      );

      // Verify each vertical line spans across the horizontal lines
      const spanningVLines = vLines.filter(
        (vl) => vl.minY <= minHY + tolSpanY && vl.maxY >= maxHY - tolSpanY
      );

      if (spanningHLines.length < 2 || spanningVLines.length < 2) {
        return null;
      }

      // Verify that horizontal and vertical lines actually cross each other into a grid.
      const tolX = Math.max(8, tableW * 0.08);
      const tolY = Math.max(8, tableH * 0.08);
      let intersectionCount = 0;

      for (const hl of spanningHLines) {
        for (const vl of spanningVLines) {
          const crosses =
            vl.cx >= hl.minX - tolX &&
            vl.cx <= hl.maxX + tolX &&
            hl.cy >= vl.minY - tolY &&
            hl.cy <= vl.maxY + tolY;
          if (crosses) {
            intersectionCount++;
          }
        }
      }

      if (intersectionCount < 4) {
        return null;
      }

      tableMinX = Math.min(
        ...hLines.map((l) => l.minX),
        ...vLines.map((l) => l.minX)
      );
      tableMaxX = Math.max(
        ...hLines.map((l) => l.maxX),
        ...vLines.map((l) => l.maxX)
      );
      tableMinY = Math.min(
        ...hLines.map((l) => l.minY),
        ...vLines.map((l) => l.minY)
      );
      tableMaxY = Math.max(
        ...hLines.map((l) => l.maxY),
        ...vLines.map((l) => l.maxY)
      );
      tableW = Math.max(1, tableMaxX - tableMinX);
      tableH = Math.max(1, tableMaxY - tableMinY);
    }

    // Cluster horizontal line Y coordinates (tolerance 8% of table height)
    const clusterTolY = Math.max(6, tableH * 0.08);
    const sortedHY = hLines.map((l) => l.cy).sort((a, b) => a - b);
    const clusteredHY: number[] = [];
    for (const y of sortedHY) {
      const matchIdx = clusteredHY.findIndex((cy) => Math.abs(cy - y) <= clusterTolY);
      if (matchIdx >= 0) {
        clusteredHY[matchIdx] = (clusteredHY[matchIdx] + y) / 2;
      } else {
        clusteredHY.push(y);
      }
    }
    clusteredHY.sort((a, b) => a - b);

    // Cluster vertical line X coordinates (tolerance 8% of table width)
    const clusterTolX = Math.max(6, tableW * 0.08);
    const sortedVX = vLines.map((l) => l.cx).sort((a, b) => a - b);
    const clusteredVX: number[] = [];
    for (const x of sortedVX) {
      const matchIdx = clusteredVX.findIndex((cx) => Math.abs(cx - x) <= clusterTolX);
      if (matchIdx >= 0) {
        clusteredVX[matchIdx] = (clusteredVX[matchIdx] + x) / 2;
      } else {
        clusteredVX.push(x);
      }
    }
    clusteredVX.sort((a, b) => a - b);

    // Determine row boundaries:
    // If outerBox is present, internal dividers are lines strictly within the box
    let internalHY: number[] = [];
    let internalVX: number[] = [];

    if (outerBox) {
      // Horizontal dividers inside the outer box must span across the table (at least 65% of width)
      internalHY = clusteredHY.filter((cy) => {
        if (cy <= tableMinY + 0.12 * tableH || cy >= tableMaxY - 0.12 * tableH) return false;
        const linesAtY = hLines.filter((l) => Math.abs(l.cy - cy) <= clusterTolY);
        if (linesAtY.length === 0) return false;
        const minX = Math.min(...linesAtY.map((l) => l.minX));
        const maxX = Math.max(...linesAtY.map((l) => l.maxX));
        return maxX - minX >= 0.65 * tableW;
      });

      // Vertical dividers inside the outer box must span across the table (at least 65% of height)
      internalVX = clusteredVX.filter((cx) => {
        if (cx <= tableMinX + 0.12 * tableW || cx >= tableMaxX - 0.12 * tableW) return false;
        const linesAtX = vLines.filter((l) => Math.abs(l.cx - cx) <= clusterTolX);
        if (linesAtX.length === 0) return false;
        const minY = Math.min(...linesAtX.map((l) => l.minY));
        const maxY = Math.max(...linesAtX.map((l) => l.maxY));
        return maxY - minY >= 0.65 * tableH;
      });
    } else {
      // Lines near the outer edges (within 12% of extremes) serve as boundaries
      internalHY = clusteredHY.filter(
        (y) => y > tableMinY + 0.12 * tableH && y < tableMaxY - 0.12 * tableH
      );
      internalVX = clusteredVX.filter(
        (x) => x > tableMinX + 0.12 * tableW && x < tableMaxX - 0.12 * tableW
      );
    }

    // Calculate number of rows and columns
    let rows = 0;
    let cols = 0;
    let confidence = 0;

    if (outerBox) {
      // Outer box + internal dividers:
      // For 3x3 table: 2 internal horizontal dividers, 2 internal vertical dividers
      if (internalHY.length >= 1 && internalVX.length >= 1) {
        rows = internalHY.length + 1;
        cols = internalVX.length + 1;
        confidence = 0.96;
      } else if (internalHY.length >= 1 && clusteredVX.length === 0) {
        // Multi-row single-column table (like a list/table with rows)
        rows = internalHY.length + 1;
        cols = 1;
        confidence = 0.88;
      } else if (internalVX.length >= 1 && clusteredHY.length === 0) {
        // Multi-column single-row table
        rows = 1;
        cols = internalVX.length + 1;
        confidence = 0.88;
      }
    } else {
      // Grid of crossing lines:
      // If we have distinct horizontal and vertical lines:
      if (clusteredHY.length >= 2 && clusteredVX.length >= 2) {
        if (internalHY.length >= 1 && internalVX.length >= 1) {
          // If we have explicit internal lines inside the outer lines:
          rows = internalHY.length + 1;
          cols = internalVX.length + 1;
          confidence = 0.94;
        } else if (clusteredHY.length >= 3 && clusteredVX.length >= 3) {
          // 3+ horizontal and 3+ vertical boundary lines
          rows = clusteredHY.length - 1;
          cols = clusteredVX.length - 1;
          confidence = 0.92;
        } else if (clusteredHY.length === 2 && clusteredVX.length === 2) {
          // 2 crossing horizontal lines and 2 crossing vertical lines (like tic-tac-toe)
          // Tic-tac-toe lines divide the bounding space into 3 rows and 3 columns!
          const hLineSpanY = Math.abs(clusteredHY[1] - clusteredHY[0]);
          const vLineSpanX = Math.abs(clusteredVX[1] - clusteredVX[0]);
          if (hLineSpanY < 0.65 * tableH && vLineSpanX < 0.65 * tableW) {
            rows = 3;
            cols = 3;
            confidence = 0.90;
          } else {
            rows = 2;
            cols = 2;
            confidence = 0.85;
          }
        }
      }
    }

    if (rows < 2 && cols < 2) {
      return null;
    }

    // Build row divider coordinates: [tableMinY, ...internalHY, tableMaxY]
    const rowCoords: number[] = [tableMinY];
    if (internalHY.length > 0 && internalHY.length === rows - 1) {
      rowCoords.push(...internalHY);
    } else {
      // Uniform fallback
      for (let r = 1; r < rows; r++) {
        rowCoords.push(tableMinY + (r * tableH) / rows);
      }
    }
    rowCoords.push(tableMaxY);

    // Build column divider coordinates: [tableMinX, ...internalVX, tableMaxX]
    const colCoords: number[] = [tableMinX];
    if (internalVX.length > 0 && internalVX.length === cols - 1) {
      colCoords.push(...internalVX);
    } else {
      // Uniform fallback
      for (let c = 1; c < cols; c++) {
        colCoords.push(tableMinX + (c * tableW) / cols);
      }
    }
    colCoords.push(tableMaxX);

    // Row heights and col widths
    const rowHeights: number[] = [];
    for (let r = 0; r < rows; r++) {
      rowHeights.push(Math.round(rowCoords[r + 1] - rowCoords[r]));
    }
    const colWidths: number[] = [];
    for (let c = 0; c < cols; c++) {
      colWidths.push(Math.round(colCoords[c + 1] - colCoords[c]));
    }

    // 5. Text extraction inside individual cells
    // Strokes that are not part of outer box or divider lines
    const gridStrokeIndices = new Set<number>();
    if (outerBox) gridStrokeIndices.add(outerBox.index);
    for (const h of hLines) gridStrokeIndices.add(h.index);
    for (const v of vLines) gridStrokeIndices.add(v.index);

    const cellStrokes: Stroke[][][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => [])
    );

    for (let i = 0; i < features.length; i++) {
      if (gridStrokeIndices.has(i)) continue;
      const feat = features[i];
      // Find which cell feat.cx, feat.cy falls into
      for (let r = 0; r < rows; r++) {
        const top = rowCoords[r];
        const bot = rowCoords[r + 1];
        if (feat.cy < top || feat.cy > bot) continue;

        for (let c = 0; c < cols; c++) {
          const left = colCoords[c];
          const right = colCoords[c + 1];
          if (feat.cx >= left && feat.cx <= right) {
            cellStrokes[r][c].push(rawStrokes[i]);
            break;
          }
        }
      }
    }

    const cells: string[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => "")
    );

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const strokesInCell = cellStrokes[r][c];
        if (strokesInCell.length > 0) {
          const fontRes = defaultHandwrittenFontDetector.detect(strokesInCell);
          if (fontRes.isText && fontRes.text.trim().length > 0) {
            cells[r][c] = fontRes.text.trim();
          }
        }
      }
    }

    return {
      isTable: true,
      confidence,
      rows,
      cols,
      bounds: rectFromBounds(tableMinX, tableMinY, tableW, tableH),
      cells,
      rowHeights,
      colWidths,
    };
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
}

export const defaultTableDetector = new TableDetector();
