import { Point } from "../value-objects/Point";
import { Stroke, StrokePoint } from "./ShapeRecognizer";

export interface RecognizedTextLine {
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
  strokes: Stroke[];
}

/**
 * Common vocabulary frequently written in software architecture, UML diagrams,
 * tables, task lists, and notes. Used to enhance raw character recognition into
 * clean, properly typed words.
 */
const COMMON_NOTE_VOCABULARY = [
  // High-frequency diagram/technical words
  "API",
  "APP",
  "AUTH",
  "USER",
  "USERS",
  "LOGIN",
  "LOGOUT",
  "SIGNUP",
  "DATABASE",
  "DB",
  "SERVER",
  "CLIENT",
  "SERVICE",
  "SERVICES",
  "CONTROLLER",
  "MODEL",
  "VIEW",
  "ROUTE",
  "ROUTER",
  "DATA",
  "FRONTEND",
  "BACKEND",
  "UI",
  "UX",
  "CACHE",
  "REDIS",
  "POSTGRES",
  "SQL",
  "QUEUE",
  "WORKER",
  "GATEWAY",
  "PROXY",
  "CONFIG",
  "SETTINGS",
  "EVENT",
  "EVENTS",
  "MESSAGE",
  "BUS",
  "NOTIFICATION",
  "PAYMENT",
  "ORDER",
  "ORDERS",
  "CART",
  "PRODUCT",
  "PRODUCTS",
  "ITEM",
  "ITEMS",
  "PROFILE",
  "ADMIN",
  "ROLE",
  "ROLES",
  "TOKEN",
  "SESSION",
  "REQUEST",
  "RESPONSE",
  "INPUT",
  "OUTPUT",
  "PROCESS",
  "START",
  "STOP",
  "END",
  "SUCCESS",
  "ERROR",
  "FAIL",
  "FAILED",
  "OK",
  "YES",
  "NO",
  "TRUE",
  "FALSE",
  "STATUS",
  "TYPE",
  "NAME",
  "TITLE",
  "ID",
  "DATE",
  "TIME",
  "PRICE",
  "TOTAL",
  "QTY",
  "COUNT",
  "NOTE",
  "NOTES",
  "TODO",
  "DOING",
  "DONE",
  "TASK",
  "TASKS",
  "STEP",
  "STEP 1",
  "STEP 2",
  "STEP 3",
  "TEST",
  "TESTS",
  "HEADER",
  "FOOTER",
  "TABLE",
  "ROW",
  "COL",
  "COLUMN",
  "VALUE",
  "KEY",
  "INFO",
  "PLAN",
  "DOC",
  "DOCS",
  "SYSTEM",
  "MODULE",
  "COMPONENT",
  "CLASS",
  "INTERFACE",
  "METHOD",
  "PROPERTY",
  "ACTION",
  "STATE",
  "STATE 1",
  "STATE 2",
  "ACTIVE",
  "INACTIVE",
  "PENDING",
  "CANCEL",
  "SAVE",
  "EDIT",
  "DELETE",
  "ADD",
  "NEW",
  "UPDATE",
  "CREATE",
  "READ",
  "FIND",
  "SEARCH",
  "FILTER",
  "HOME",
  "ABOUT",
  "CONTACT",
  "HELP",
];

interface PointCloudTemplate {
  name: string;
  points: Point[];
  strokeCount: number;
}

/**
 * Normalizes and resamples a set of stroke points into a fixed number of equidistant points (N=32),
 * translated to origin (0, 0) and scaled to unit box [0, 1] while preserving aspect ratio.
 */
function normalizeStrokePoints(points: StrokePoint[], targetCount = 32): Point[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    return Array.from({ length: targetCount }, () => ({ x: 0.5, y: 0.5 }));
  }

  // 1. Calculate arc length
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalLength += Math.hypot(
      points[i + 1].x - points[i].x,
      points[i + 1].y - points[i].y
    );
  }

  // 2. Resample to targetCount equidistant points
  const interval = totalLength / Math.max(1, targetCount - 1);
  const resampled: Point[] = [{ x: points[0].x, y: points[0].y }];
  let distAccum = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const segDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (segDist === 0) continue;

    let d = segDist;
    let currDist = distAccum;
    let t = 0;

    while (currDist + d >= interval && resampled.length < targetCount) {
      const step = interval - currDist;
      t += step / d;
      const nx = p1.x + (p2.x - p1.x) * t;
      const ny = p1.y + (p2.y - p1.y) * t;
      resampled.push({ x: nx, y: ny });
      d -= step;
      currDist = 0;
    }
    distAccum = currDist + d;
  }

  while (resampled.length < targetCount) {
    const last = points[points.length - 1];
    resampled.push({ x: last.x, y: last.y });
  }

  // 3. Compute centroid and translate to (0,0)
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of resampled) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const width = Math.max(0.001, maxX - minX);
  const height = Math.max(0.001, maxY - minY);
  const scale = Math.max(width, height);

  return resampled.map((p) => ({
    x: (p.x - minX) / scale,
    y: (p.y - minY) / scale,
  }));
}

/**
 * Calculates Point-Cloud distance between candidate points and template points ($P Recognizer).
 */
function pointCloudDistance(pts1: Point[], pts2: Point[]): number {
  const n = Math.min(pts1.length, pts2.length);
  if (n === 0) return Infinity;

  // Greedy minimum-distance bipartite matching
  const matched = new Array<boolean>(n).fill(false);
  let totalDist = 0;

  for (let i = 0; i < n; i++) {
    let minDist = Infinity;
    let bestIndex = -1;
    for (let j = 0; j < n; j++) {
      if (!matched[j]) {
        const d = Math.hypot(pts1[i].x - pts2[j].x, pts1[i].y - pts2[j].y);
        if (d < minDist) {
          minDist = d;
          bestIndex = j;
        }
      }
    }
    if (bestIndex !== -1) {
      matched[bestIndex] = true;
      totalDist += minDist;
    } else {
      totalDist += 1.0;
    }
  }

  return totalDist / n;
}

/**
 * Generate synthetic canonical stroke points for letter templates.
 */
function createSyntheticStroke(commands: Array<[number, number]>): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i < commands.length - 1; i++) {
    const [x1, y1] = commands[i];
    const [x2, y2] = commands[i + 1];
    const steps = 10;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      points.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
    }
  }
  const last = commands[commands.length - 1];
  points.push({ x: last[0], y: last[1] });
  return points;
}

/**
 * Generates canonical point cloud templates for character recognition.
 */
function generateCharacterTemplates(): PointCloudTemplate[] {
  const templates: PointCloudTemplate[] = [];

  const add = (name: string, strokeCommands: Array<Array<[number, number]>>) => {
    const allPoints: StrokePoint[] = [];
    for (const stroke of strokeCommands) {
      allPoints.push(...createSyntheticStroke(stroke));
    }
    templates.push({
      name,
      points: normalizeStrokePoints(allPoints, 32),
      strokeCount: strokeCommands.length,
    });
  };

  // Letters A-Z
  add("A", [
    [[0, 1], [0.5, 0], [1, 1]], // Tent
    [[0.2, 0.6], [0.8, 0.6]],   // Crossbar
  ]);
  add("B", [
    [[0, 1], [0, 0]],
    [[0, 0], [0.8, 0.25], [0, 0.5]],
    [[0, 0.5], [0.9, 0.75], [0, 1]],
  ]);
  add("C", [
    [[0.9, 0.2], [0.5, 0], [0.1, 0.5], [0.5, 1], [0.9, 0.8]],
  ]);
  add("D", [
    [[0, 1], [0, 0]],
    [[0, 0], [0.9, 0.5], [0, 1]],
  ]);
  add("E", [
    [[0, 1], [0, 0]],
    [[0, 0], [0.8, 0]],
    [[0, 0.5], [0.6, 0.5]],
    [[0, 1], [0.8, 1]],
  ]);
  add("F", [
    [[0, 1], [0, 0]],
    [[0, 0], [0.8, 0]],
    [[0, 0.5], [0.6, 0.5]],
  ]);
  add("G", [
    [[0.9, 0.2], [0.5, 0], [0.1, 0.5], [0.5, 1], [0.9, 0.8], [0.9, 0.5], [0.5, 0.5]],
  ]);
  add("H", [
    [[0, 0], [0, 1]],
    [[1, 0], [1, 1]],
    [[0, 0.5], [1, 0.5]],
  ]);
  add("I", [
    [[0.5, 0], [0.5, 1]],
  ]);
  add("J", [
    [[0.8, 0], [0.8, 0.8], [0.5, 1], [0.2, 0.8]],
  ]);
  add("K", [
    [[0, 0], [0, 1]],
    [[0.9, 0], [0, 0.5], [0.9, 1]],
  ]);
  add("L", [
    [[0, 0], [0, 1], [0.8, 1]],
  ]);
  add("M", [
    [[0, 1], [0, 0], [0.5, 0.6], [1, 0], [1, 1]],
  ]);
  add("N", [
    [[0, 1], [0, 0], [1, 1], [1, 0]],
  ]);
  add("O", [
    [[0.5, 0], [0.9, 0.3], [0.9, 0.7], [0.5, 1], [0.1, 0.7], [0.1, 0.3], [0.5, 0]],
  ]);
  add("P", [
    [[0, 1], [0, 0]],
    [[0, 0], [0.8, 0.25], [0, 0.5]],
  ]);
  add("Q", [
    [[0.5, 0], [0.9, 0.3], [0.9, 0.7], [0.5, 1], [0.1, 0.7], [0.1, 0.3], [0.5, 0]],
    [[0.6, 0.7], [1, 1]],
  ]);
  add("R", [
    [[0, 1], [0, 0]],
    [[0, 0], [0.8, 0.25], [0, 0.5]],
    [[0, 0.5], [0.9, 1]],
  ]);
  add("S", [
    [[0.9, 0.2], [0.5, 0], [0.1, 0.3], [0.9, 0.7], [0.5, 1], [0.1, 0.8]],
  ]);
  add("T", [
    [[0, 0], [1, 0]],
    [[0.5, 0], [0.5, 1]],
  ]);
  add("U", [
    [[0.1, 0], [0.1, 0.8], [0.5, 1], [0.9, 0.8], [0.9, 0]],
  ]);
  add("V", [
    [[0, 0], [0.5, 1], [1, 0]],
  ]);
  add("W", [
    [[0, 0], [0.25, 1], [0.5, 0.4], [0.75, 1], [1, 0]],
  ]);
  add("X", [
    [[0, 0], [1, 1]],
    [[1, 0], [0, 1]],
  ]);
  add("Y", [
    [[0, 0], [0.5, 0.5]],
    [[1, 0], [0.5, 0.5], [0.5, 1]],
  ]);
  add("Z", [
    [[0, 0], [1, 0], [0, 1], [1, 1]],
  ]);

  // Digits 0-9
  add("0", [
    [[0.5, 0], [0.9, 0.5], [0.5, 1], [0.1, 0.5], [0.5, 0]],
  ]);
  add("1", [
    [[0.3, 0.2], [0.5, 0], [0.5, 1]],
  ]);
  add("2", [
    [[0.1, 0.3], [0.5, 0], [0.9, 0.3], [0, 1], [1, 1]],
  ]);
  add("3", [
    [[0.1, 0.1], [0.8, 0], [0.4, 0.5], [0.9, 0.8], [0.1, 1]],
  ]);
  add("4", [
    [[0.8, 0.8], [0.8, 0], [0.8, 1]],
    [[0.8, 0.7], [0, 0.7], [0.7, 0]],
  ]);
  add("5", [
    [[0.9, 0], [0.1, 0], [0.1, 0.4], [0.9, 0.6], [0.5, 1], [0.1, 0.9]],
  ]);
  add("6", [
    [[0.8, 0.2], [0.4, 0], [0.1, 0.5], [0.5, 1], [0.9, 0.8], [0.9, 0.6], [0.5, 0.5], [0.1, 0.6]],
  ]);
  add("7", [
    [[0, 0], [1, 0], [0.3, 1]],
  ]);
  add("8", [
    [[0.5, 0.5], [0.1, 0.25], [0.5, 0], [0.9, 0.25], [0.5, 0.5], [0.1, 0.75], [0.5, 1], [0.9, 0.75], [0.5, 0.5]],
  ]);
  add("9", [
    [[0.9, 0.5], [0.5, 0.5], [0.1, 0.25], [0.5, 0], [0.9, 0.25], [0.9, 0.8], [0.5, 1], [0.2, 0.9]],
  ]);

  // Symbols
  add("+", [
    [[0.5, 0.1], [0.5, 0.9]],
    [[0.1, 0.5], [0.9, 0.5]],
  ]);
  add("-", [
    [[0.1, 0.5], [0.9, 0.5]],
  ]);
  add("=", [
    [[0.1, 0.35], [0.9, 0.35]],
    [[0.1, 0.65], [0.9, 0.65]],
  ]);
  add(":", [
    [[0.5, 0.25], [0.5, 0.3]],
    [[0.5, 0.75], [0.5, 0.8]],
  ]);
  add("/", [
    [[0.1, 1], [0.9, 0]],
  ]);

  return templates;
}

const TEMPLATES: PointCloudTemplate[] = generateCharacterTemplates();

/**
 * Levenshtein distance between two strings for dictionary snapping.
 */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    const row: number[] = new Array<number>(n + 1).fill(0);
    row[0] = i;
    dp.push(row);
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,       // deletion
        dp[i][j - 1] + 1,       // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

export class HandwritingRecognizer {
  /**
   * Evaluates if a given stroke is likely part of handwriting (as opposed to a large shape,
   * table border, or full diagram connection arrow).
   */
  public isLikelyText(stroke: Stroke): boolean {
    const pts = stroke.points;
    if (!pts || pts.length < 2) return false;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const width = maxX - minX;
    const height = maxY - minY;

    // Small or moderate bounding box characteristic of handwriting
    // Extremely large strokes (> 350px width AND > 200px height) are usually container boxes
    if (width > 350 && height > 200) {
      return false;
    }

    // Single stroke aspect ratio: if extremely wide and flat across canvas, it's a divider line, not a letter
    if (width > 220 && height < 15) {
      return false;
    }
    // Very tall single vertical line across canvas
    if (height > 220 && width < 15) {
      return false;
    }

    return true;
  }

  /**
   * Main entry point: converts a set of handwritten strokes into standardized typed text lines.
   */
  public recognizeStrokes(strokes: Stroke[]): string {
    if (!strokes || strokes.length === 0) return "";

    // 1. Group strokes into text lines based on Y coordinate overlap and baseline
    const lines = this.clusterStrokesIntoLines(strokes);
    if (lines.length === 0) return "";

    const recognizedLineStrings: string[] = [];

    for (const line of lines) {
      // 2. Within each line, group strokes into words based on horizontal proximity
      const words = this.clusterLineStrokesIntoWords(line.strokes);
      const recognizedWords: string[] = [];

      for (const wordStrokes of words) {
        const wordText = this.recognizeWord(wordStrokes);
        if (wordText) {
          recognizedWords.push(wordText);
        }
      }

      if (recognizedWords.length > 0) {
        recognizedLineStrings.push(recognizedWords.join(" "));
      }
    }

    return recognizedLineStrings.join("\n");
  }

  /**
   * Recognizes a single word cluster from a set of strokes.
   */
  public recognizeWord(strokes: Stroke[]): string {
    if (strokes.length === 0) return "";

    // 1. Segment word strokes into individual character clusters
    const charClusters = this.segmentStrokesIntoCharacters(strokes);
    let rawWord = "";

    for (const cluster of charClusters) {
      const char = this.recognizeCharacter(cluster);
      if (char) {
        rawWord += char;
      }
    }

    if (!rawWord) return "";

    // 2. Enhance raw recognized word with dictionary / common note vocabulary
    return this.snapToVocabulary(rawWord);
  }

  /**
   * Recognizes an individual character from 1 to 4 closely grouped strokes.
   */
  public recognizeCharacter(strokes: Stroke[]): string {
    if (strokes.length === 0) return "";

    // Flatten all points in character cluster
    const allPoints: StrokePoint[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const s of strokes) {
      for (const p of s.points) {
        allPoints.push(p);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }

    if (allPoints.length < 2) return "";

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const aspectRatio = width / height;

    // Fast-path geometric checks:
    // 1. Vertical straight stroke -> 'I' or '1' or 'l'
    if (strokes.length === 1 && aspectRatio < 0.25) {
      return "I";
    }
    // 2. Horizontal straight stroke -> '-'
    if (strokes.length === 1 && aspectRatio > 3.0) {
      return "-";
    }

    // 3. Dot or tiny stroke -> '.'
    if (width < 6 && height < 6) {
      return ".";
    }

    // 4. Point-cloud template matching ($P)
    const normalizedPoints = normalizeStrokePoints(allPoints, 32);
    let bestScore = Infinity;
    let bestChar = "";

    for (const tmpl of TEMPLATES) {
      // Stroke count penalty if template stroke count differs widely
      const strokeDiff = Math.abs(tmpl.strokeCount - strokes.length);
      const strokePenalty = strokeDiff * 0.15;

      const dist = pointCloudDistance(normalizedPoints, tmpl.points) + strokePenalty;
      if (dist < bestScore) {
        bestScore = dist;
        bestChar = tmpl.name;
      }
    }

    return bestChar;
  }

  /**
   * Groups strokes into lines based on vertical overlap.
   */
  public clusterStrokesIntoLines(strokes: Stroke[]): RecognizedTextLine[] {
    interface StrokeBounds {
      stroke: Stroke;
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
      height: number;
      centerY: number;
    }

    const items: StrokeBounds[] = strokes
      .map((s) => {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of s.points) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        return {
          stroke: s,
          minX,
          maxX,
          minY,
          maxY,
          height: Math.max(1, maxY - minY),
          centerY: (minY + maxY) / 2,
        };
      })
      .sort((a, b) => a.centerY - b.centerY);

    const lineBuckets: StrokeBounds[][] = [];

    for (const item of items) {
      let placed = false;
      for (const bucket of lineBuckets) {
        // Compute average center and height of bucket
        const avgCenter = bucket.reduce((sum, b) => sum + b.centerY, 0) / bucket.length;
        const avgHeight = bucket.reduce((sum, b) => sum + b.height, 0) / bucket.length;

        // If stroke vertical center is close enough to line baseline
        if (Math.abs(item.centerY - avgCenter) <= Math.max(18, avgHeight * 0.65)) {
          bucket.push(item);
          placed = true;
          break;
        }
      }
      if (!placed) {
        lineBuckets.push([item]);
      }
    }

    // Convert buckets into RecognizedTextLine
    const result: RecognizedTextLine[] = [];
    for (const bucket of lineBuckets) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      const bucketStrokes: Stroke[] = [];

      for (const b of bucket) {
        bucketStrokes.push(b.stroke);
        if (b.minX < minX) minX = b.minX;
        if (b.maxX > maxX) maxX = b.maxX;
        if (b.minY < minY) minY = b.minY;
        if (b.maxY > maxY) maxY = b.maxY;
      }

      result.push({
        text: "",
        bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        strokes: bucketStrokes,
      });
    }

    // Sort lines top to bottom
    result.sort((a, b) => a.bounds.y - b.bounds.y);
    return result;
  }

  /**
   * Groups strokes within a single line into words based on horizontal proximity.
   */
  public clusterLineStrokesIntoWords(strokes: Stroke[]): Stroke[][] {
    interface Item {
      stroke: Stroke;
      minX: number;
      maxX: number;
      height: number;
    }

    const items: Item[] = strokes
      .map((s) => {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of s.points) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        return {
          stroke: s,
          minX,
          maxX,
          height: Math.max(12, maxY - minY),
        };
      })
      .sort((a, b) => a.minX - b.minX);

    if (items.length === 0) return [];

    const words: Stroke[][] = [];
    let currentWord: Stroke[] = [items[0].stroke];
    let prevMaxX = items[0].maxX;
    const avgHeight = items.reduce((sum, it) => sum + it.height, 0) / items.length;
    // Word spacing threshold is roughly 0.85x average character height
    const wordGapThreshold = Math.max(22, avgHeight * 0.85);

    for (let i = 1; i < items.length; i++) {
      const it = items[i];
      const gap = it.minX - prevMaxX;

      if (gap > wordGapThreshold) {
        // New word
        words.push(currentWord);
        currentWord = [it.stroke];
      } else {
        currentWord.push(it.stroke);
      }
      prevMaxX = Math.max(prevMaxX, it.maxX);
    }

    if (currentWord.length > 0) {
      words.push(currentWord);
    }

    return words;
  }

  /**
   * Segments strokes of a single word into character clusters.
   */
  public segmentStrokesIntoCharacters(strokes: Stroke[]): Stroke[][] {
    interface Item {
      stroke: Stroke;
      minX: number;
      maxX: number;
      width: number;
    }

    const items: Item[] = strokes
      .map((s) => {
        let minX = Infinity;
        let maxX = -Infinity;
        for (const p of s.points) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
        }
        return {
          stroke: s,
          minX,
          maxX,
          width: Math.max(1, maxX - minX),
        };
      })
      .sort((a, b) => a.minX - b.minX);

    if (items.length === 0) return [];

    const clusters: Stroke[][] = [];
    let currentCluster: Stroke[] = [items[0].stroke];
    let clusterMaxX = items[0].maxX;

    for (let i = 1; i < items.length; i++) {
      const it = items[i];
      // If strokes overlap horizontally (like crossbar in 'A' or 't', or stem + bar in 'T')
      const overlap = clusterMaxX - it.minX;
      const isOverlapping = overlap > 2;

      if (isOverlapping && currentCluster.length < 4) {
        currentCluster.push(it.stroke);
        clusterMaxX = Math.max(clusterMaxX, it.maxX);
      } else {
        clusters.push(currentCluster);
        currentCluster = [it.stroke];
        clusterMaxX = it.maxX;
      }
    }

    if (currentCluster.length > 0) {
      clusters.push(currentCluster);
    }

    return clusters;
  }

  /**
   * Snaps a recognized character sequence to common note vocabulary if within close edit distance.
   */
  public snapToVocabulary(rawWord: string): string {
    const upper = rawWord.toUpperCase().trim();
    if (!upper) return rawWord;

    // Direct match
    const exact = COMMON_NOTE_VOCABULARY.find((v) => v.toUpperCase() === upper);
    if (exact) return exact;

    // Digits or short acronyms
    if (/^\d+$/.test(upper)) return upper;
    if (upper.length <= 2) return upper;

    // Fuzzy match against vocabulary: allow distance <= 1 for words <= 4 chars, <= 2 for longer words
    const maxDist = upper.length <= 4 ? 1 : 2;
    let bestMatch = rawWord;
    let minD = maxDist + 1;

    for (const vocab of COMMON_NOTE_VOCABULARY) {
      const vUpper = vocab.toUpperCase();
      if (Math.abs(vUpper.length - upper.length) > maxDist) continue;

      const d = levenshteinDistance(upper, vUpper);
      if (d < minD) {
        minD = d;
        bestMatch = vocab;
      }
    }

    return minD <= maxDist ? bestMatch : rawWord;
  }
}

export const defaultHandwritingRecognizer = new HandwritingRecognizer();
