import { Rect, rectFromBounds } from "../value-objects/Rect";
import { Stroke, StrokePoint } from "./ShapeRecognizer";

export interface DetectedCharacter {
  char: string;
  confidence: number;
  bounds: Rect;
  strokeIndices: number[];
}

export interface DetectedWord {
  text: string;
  confidence: number;
  bounds: Rect;
  characters: DetectedCharacter[];
}

export interface DetectedLine {
  text: string;
  confidence: number;
  bounds: Rect;
  words: DetectedWord[];
}

export interface HandwrittenFontDetectionResult {
  text: string;
  confidence: number;
  bounds: Rect;
  lines: DetectedLine[];
  words: DetectedWord[];
  characters: DetectedCharacter[];
  isText: boolean;
  estimatedFontSize: number;
  fontFamily: string;
}

export interface StrokeFeatures {
  index: number;
  id?: string;
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
  isVertical: boolean;
  isHorizontal: boolean;
  isDiagonalSlash: boolean;
  isDiagonalBackslash: boolean;
  start: StrokePoint;
  end: StrokePoint;
  dx: number;
  dy: number;
  points: StrokePoint[];
}

interface Cluster {
  strokes: StrokeFeatures[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

/**
 * Pure domain service that detects handwritten text, letters, words, and sentences
 * from sequences of freehand strokes.
 *
 * Solves:
 * 1. Multi-component letters: Clusters strokes belonging to the same letter (e.g. 'E' with 4 lines,
 *    'A' with 3 lines, 'H' with 3 lines, 'T' with 2 lines, 'i'/'j' with dots, 't' with crossbars)
 *    so components are not treated as separate letters.
 * 2. Words: Agglomerative character clustering with cluster-level aspect ratio and center separation
 *    guarantees that multi-letter words are NOT squashed into a single letter.
 * 3. Sentences: Detects inter-word spaces and multi-line breaks to produce sentences and paragraphs.
 * 4. Handwritten Font Styling: Provides appropriate font size and 'handwritten' font family preset.
 */
export class HandwrittenFontDetector {
  /**
   * Detects letters, words, and sentences from one or more strokes.
   */
  public detect(input: Stroke | Stroke[]): HandwrittenFontDetectionResult {
    const rawStrokes = Array.isArray(input) ? input : [input];
    const defaultBounds = rectFromBounds(0, 0, 0, 0);

    // Filter out invalid or zero-point strokes, and support 1-point dots by duplicating point
    const strokes = rawStrokes
      .filter((s) => s && s.points && s.points.length >= 1)
      .map((s) => {
        if (s.points.length === 1) {
          return {
            ...s,
            points: [s.points[0], { ...s.points[0] }],
          };
        }
        return s;
      });

    if (strokes.length === 0) {
      return {
        text: "",
        confidence: 0,
        bounds: defaultBounds,
        lines: [],
        words: [],
        characters: [],
        isText: false,
        estimatedFontSize: 16,
        fontFamily: "handwritten",
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

    const overallWidth = Math.max(1, overallMaxX - overallMinX);
    const overallHeight = Math.max(1, overallMaxY - overallMinY);
    const overallBounds = rectFromBounds(overallMinX, overallMinY, overallWidth, overallHeight);

    // Discard tiny micro-blobs (< 6px)
    if (overallWidth < 6 && overallHeight < 6) {
      return {
        text: "",
        confidence: 0,
        bounds: overallBounds,
        lines: [],
        words: [],
        characters: [],
        isText: false,
        estimatedFontSize: 16,
        fontFamily: "handwritten",
      };
    }

    // 2. Extract geometric features for each stroke
    const strokeFeatures: StrokeFeatures[] = strokes.map((s, idx) =>
      this.extractStrokeFeatures(s, idx)
    );

    // 3. Continuous cursive stroke segmentation is bypassed during character recognition
    // to prevent fragmenting single handwritten letters (such as 'a', 'e', 'm', 'w').
    // The segmentCursiveStroke method remains available for explicit callers and tests.

    // 4. Cluster strokes into character candidates using agglomerative hierarchical clustering
    const charStrokeClusters = this.clusterStrokesIntoCharacters(strokeFeatures);

    // Recognize each character cluster
    const allCharacters: DetectedCharacter[] = [];
    for (const cluster of charStrokeClusters) {
      const detectedChar = this.recognizeCharacterCluster(cluster);
      allCharacters.push(detectedChar);
    }

    if (allCharacters.length === 0) {
      return {
        text: "",
        confidence: 0,
        bounds: overallBounds,
        lines: [],
        words: [],
        characters: [],
        isText: false,
        estimatedFontSize: 16,
        fontFamily: "handwritten",
      };
    }

    // 5. Line segmentation of character clusters based on vertical overlap
    const lineCharGroups = this.segmentCharacterLines(allCharacters);

    const detectedLines: DetectedLine[] = [];
    const allWords: DetectedWord[] = [];

    for (const lineChars of lineCharGroups) {
      // Sort characters from left to right within line
      lineChars.sort((a, b) => a.bounds.position.x - b.bounds.position.x);

      // 6. Group characters into words using inter-character vs inter-word gaps
      const lineWords = this.groupCharactersIntoWords(lineChars);
      allWords.push(...lineWords);

      // Line bounds and text
      let lineMinX = Infinity,
        lineMinY = Infinity,
        lineMaxX = -Infinity,
        lineMaxY = -Infinity;
      for (const w of lineWords) {
        const p = w.bounds.position;
        const s = w.bounds.size;
        lineMinX = Math.min(lineMinX, p.x);
        lineMinY = Math.min(lineMinY, p.y);
        lineMaxX = Math.max(lineMaxX, p.x + s.width);
        lineMaxY = Math.max(lineMaxY, p.y + s.height);
      }

      const lineBounds = rectFromBounds(
        lineMinX,
        lineMinY,
        Math.max(1, lineMaxX - lineMinX),
        Math.max(1, lineMaxY - lineMinY)
      );

      const lineText = lineWords.map((w) => w.text).join(" ");
      const lineConfidence =
        lineWords.reduce((acc, w) => acc + w.confidence, 0) / Math.max(1, lineWords.length);

      detectedLines.push({
        text: lineText,
        confidence: Math.round(lineConfidence * 100) / 100,
        bounds: lineBounds,
        words: lineWords,
      });
    }

    // Flatten all characters in exact reading order (top-to-bottom, left-to-right)
    const orderedCharacters = detectedLines.flatMap((l) => l.words.flatMap((w) => w.characters));

    // 7. Full text assembly (lines joined with newlines)
    const fullText = detectedLines.map((l) => l.text).join("\n");

    // Calculate overall confidence
    const overallConfidence =
      orderedCharacters.length > 0
        ? orderedCharacters.reduce((acc, c) => acc + c.confidence, 0) / orderedCharacters.length
        : 0;

    // Estimate font size based on median character height
    const charHeights = orderedCharacters.map((c) => c.bounds.size.height);
    charHeights.sort((a, b) => a - b);
    const medianHeight =
      charHeights.length > 0 ? charHeights[Math.floor(charHeights.length / 2)] : overallHeight;
    const estimatedFontSize = Math.round(Math.max(11, Math.min(64, medianHeight * 0.88)));

    // 8. Decide whether this is handwritten text vs a non-text geometric shape
    const isText = this.evaluateIsText(strokeFeatures, overallBounds, orderedCharacters, fullText);

    return {
      text: fullText,
      confidence: Math.round(overallConfidence * 100) / 100,
      bounds: overallBounds,
      lines: detectedLines,
      words: allWords,
      characters: orderedCharacters,
      isText,
      estimatedFontSize,
      fontFamily: "handwritten",
    };
  }

  // --- Feature Extraction ---

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
    const start = pts[0];
    const end = pts[pts.length - 1];
    const endToEndDist = Math.hypot(end.x - start.x, end.y - start.y);
    const straightness = totalLength > 0 ? endToEndDist / totalLength : 0;
    const isClosed =
      endToEndDist < Math.max(8, 0.20 * height) &&
      totalLength > 0 &&
      endToEndDist / totalLength < 0.20;
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    const isVertical = height > 1.8 * width && Math.abs(dy) > 1.8 * Math.abs(dx);
    const isHorizontal = width > 1.8 * height && Math.abs(dx) > 1.8 * Math.abs(dy);
    const isDiagonalSlash = !isVertical && !isHorizontal && dx * dy < 0;
    const isDiagonalBackslash = !isVertical && !isHorizontal && dx * dy > 0;

    return {
      index,
      id: stroke.id,
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
      isVertical,
      isHorizontal,
      isDiagonalSlash,
      isDiagonalBackslash,
      start,
      end,
      dx,
      dy,
      points: pts,
    };
  }

  // --- Character Clustering ---

  /**
   * Clusters strokes into character candidates using agglomerative hierarchical clustering.
   */
  private clusterStrokesIntoCharacters(strokes: StrokeFeatures[]): StrokeFeatures[][] {
    const n = strokes.length;
    if (n <= 1) return [strokes];

    // Initial clusters: each stroke begins as an independent cluster
    let clusters: Cluster[] = strokes.map((s) => ({
      strokes: [s],
      minX: s.minX,
      minY: s.minY,
      maxX: s.maxX,
      maxY: s.maxY,
      width: s.width,
      height: s.height,
      cx: s.cx,
      cy: s.cy,
    }));

    // Agglomerative clustering: greedily merge the nearest valid pair
    while (clusters.length > 1) {
      let bestPair: [number, number] | null = null;
      let bestDist = Infinity;

      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const c1 = clusters[i];
          const c2 = clusters[j];

          const check = this.canMergeClusters(c1, c2);
          if (check.mergeable && check.affinityDist < bestDist) {
            bestDist = check.affinityDist;
            bestPair = [i, j];
          }
        }
      }

      if (!bestPair) {
        break; // No further pairs satisfy character merge constraints
      }

      const [idxA, idxB] = bestPair;
      const cA = clusters[idxA];
      const cB = clusters[idxB];

      const mergedStrokes = [...cA.strokes, ...cB.strokes];
      const combMinX = Math.min(cA.minX, cB.minX);
      const combMinY = Math.min(cA.minY, cB.minY);
      const combMaxX = Math.max(cA.maxX, cB.maxX);
      const combMaxY = Math.max(cA.maxY, cB.maxY);
      const combW = Math.max(1, combMaxX - combMinX);
      const combH = Math.max(1, combMaxY - combMinY);

      const mergedCluster: Cluster = {
        strokes: mergedStrokes,
        minX: combMinX,
        minY: combMinY,
        maxX: combMaxX,
        maxY: combMaxY,
        width: combW,
        height: combH,
        cx: combMinX + combW / 2,
        cy: combMinY + combH / 2,
      };

      clusters = clusters.filter((_, idx) => idx !== idxA && idx !== idxB);
      clusters.push(mergedCluster);
    }

    return clusters.map((c) => c.strokes);
  }

  /**
   * Evaluates whether two stroke clusters belong to the same multi-component character.
   */
  private canMergeClusters(
    c1: Cluster,
    c2: Cluster
  ): { mergeable: boolean; affinityDist: number } {
    const totalStrokes = c1.strokes.length + c2.strokes.length;
    // Latin characters have at most 4 strokes (or 5 with serifs/dots)
    if (totalStrokes > 5) {
      return { mergeable: false, affinityDist: Infinity };
    }

    const combMinX = Math.min(c1.minX, c2.minX);
    const combMaxX = Math.max(c1.maxX, c2.maxX);
    const combMinY = Math.min(c1.minY, c2.minY);
    const combMaxY = Math.max(c1.maxY, c2.maxY);
    const combW = Math.max(1, combMaxX - combMinX);
    const combH = Math.max(1, combMaxY - combMinY);
    const combAspect = combW / combH;

    // Special case 1: '=' (2 parallel horizontal lines)
    const areBothHorizontalBars =
      c1.strokes.every((s) => s.isHorizontal) && c2.strokes.every((s) => s.isHorizontal);

    if (areBothHorizontalBars) {
      const overlapX = Math.min(c1.maxX, c2.maxX) - Math.max(c1.minX, c2.minX);
      const gapY = Math.max(0, Math.max(c1.minY, c2.minY) - Math.min(c1.maxY, c2.maxY));
      if (overlapX > 0.30 * Math.min(c1.width, c2.width) && gapY <= Math.max(30, 1.2 * combW)) {
        return { mergeable: true, affinityDist: gapY };
      }
    }

    // Hyphen protection: standalone horizontal hyphen strokes must NOT merge with adjacent characters
    const isHyphen = (c: Cluster) =>
      c.strokes.length === 1 &&
      c.width >= 8 &&
      c.height <= 28 &&
      c.width / Math.max(1, c.height) >= 1.8 &&
      c.strokes[0].straightness >= 0.65;

    if ((isHyphen(c1) || isHyphen(c2)) && !areBothHorizontalBars) {
      const hyphen = isHyphen(c1) ? c1 : c2;
      const nonHyphen = isHyphen(c1) ? c2 : c1;

      // If the hyphen is side-by-side to the left or right of nonHyphen:
      const isSideBySide =
        hyphen.minX >= nonHyphen.maxX - 2 || hyphen.maxX <= nonHyphen.minX + 2;

      if (isSideBySide) {
        // Only merge if touching a vertical stem (e.g. horizontal bar of 'E', 'L', 'F')
        const nonHyphenIsVertStem =
          nonHyphen.strokes.length === 1 &&
          (nonHyphen.strokes[0].isVertical || nonHyphen.height > 1.8 * nonHyphen.width);
        let minDist = Infinity;
        for (const s1 of c1.strokes) {
          for (const s2 of c2.strokes) {
            const d = this.strokeToStrokeMinDist(s1, s2);
            if (d < minDist) minDist = d;
          }
        }
        if (!nonHyphenIsVertStem || minDist > 2) {
          return { mergeable: false, affinityDist: Infinity };
        }
      }
    }

    // Special case 2: ':' (two dots vertically aligned)
    const isC1Dot = c1.strokes.length === 1 && c1.width <= 14 && c1.height <= 14;
    const isC2Dot = c2.strokes.length === 1 && c2.width <= 14 && c2.height <= 14;
    if (isC1Dot && isC2Dot) {
      const xDiff = Math.abs(c1.cx - c2.cx);
      if (xDiff <= Math.max(10, 0.45 * combW) && combH <= 50 && combAspect <= 0.8) {
        return { mergeable: true, affinityDist: Math.abs(c1.cy - c2.cy) };
      }
    }

    // Special case 3: Dot above or below body ('i', 'j', '!', '?')
    if (isC1Dot || isC2Dot) {
      const dot = isC1Dot ? c1 : c2;
      const body = isC1Dot ? c2 : c1;
      const isAbove = dot.cy < body.minY && body.minY - dot.cy <= Math.max(20, 0.65 * combH);
      const isBelow = dot.cy > body.maxY && dot.cy - body.maxY <= Math.max(28, 0.85 * combH);
      const isXAligned = Math.abs(dot.cx - body.cx) <= Math.max(12, 0.50 * body.width);

      if ((isAbove || isBelow) && isXAligned) {
        const d = isAbove ? body.minY - dot.cy : dot.cy - body.maxY;
        return { mergeable: true, affinityDist: d };
      }
    }

    // Cumulative aspect ratio constraint: Latin characters rarely exceed 1.38
    const maxAspect =
      totalStrokes >= 3 || c1.strokes.some((s) => s.isDiagonalSlash || s.isDiagonalBackslash)
        ? 1.40
        : 1.25;
    if (combAspect > maxAspect && !areBothHorizontalBars) {
      return { mergeable: false, affinityDist: Infinity };
    }

    // Block parallel unattached straight vertical lines (e.g. "II")
    const c1IsStraightVert =
      c1.strokes.length === 1 && c1.strokes[0].isVertical && c1.strokes[0].straightness > 0.85;
    const c2IsStraightVert =
      c2.strokes.length === 1 && c2.strokes[0].isVertical && c2.strokes[0].straightness > 0.85;

    if (c1IsStraightVert && c2IsStraightVert) {
      const vertMinDist = this.strokeToStrokeMinDist(c1.strokes[0], c2.strokes[0]);
      if (vertMinDist > 3) {
        return { mergeable: false, affinityDist: Infinity };
      }
    }

    const overlapX = Math.min(c1.maxX, c2.maxX) - Math.max(c1.minX, c2.minX);
    const overlapY = Math.min(c1.maxY, c2.maxY) - Math.max(c1.minY, c2.minY);
    const gapX = Math.max(0, Math.max(c1.minX, c2.minX) - Math.min(c1.maxX, c2.maxX));

    // Minimum physical distance between stroke points
    let minDist = Infinity;
    for (const s1 of c1.strokes) {
      for (const s2 of c2.strokes) {
        const d = this.strokeToStrokeMinDist(s1, s2);
        if (d < minDist) minDist = d;
      }
    }

    // If strokes do not touch (minDist > 4) and are horizontally separated by > 8px, they belong to different letters
    if (minDist > 4 && gapX > 8) {
      return { mergeable: false, affinityDist: Infinity };
    }

    const minH = Math.min(c1.height, c2.height);

    // 1. Physical touch (e.g. Touching bars of 'E', 'A', 'H', 'T', 'X', 'L', 'F', 'K', 'M', 'W', 'N', 'D', 'P', 'R')
    if (minDist <= Math.max(5, 0.20 * minH)) {
      if (overlapX > 0.10 * Math.min(c1.width, c2.width) || minDist <= 4) {
        return { mergeable: true, affinityDist: minDist };
      }
    }

    // 2. Horizontal overlap within character bounds
    if (overlapX > 0.25 * Math.min(c1.width, c2.width) && overlapY > 0 && combAspect <= 1.25) {
      return { mergeable: true, affinityDist: minDist + 2 };
    }

    return { mergeable: false, affinityDist: Infinity };
  }

  private strokeToStrokeMinDist(s1: StrokeFeatures, s2: StrokeFeatures): number {
    let minDist = Infinity;
    for (const p1 of s1.points) {
      for (const p2 of s2.points) {
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (d < minDist) {
          minDist = d;
          if (minDist === 0) return 0;
        }
      }
    }
    return minDist;
  }

  // --- Line Segmentation ---

  /**
   * Segments recognized characters into text lines based on vertical overlap.
   */
  private segmentCharacterLines(chars: DetectedCharacter[]): DetectedCharacter[][] {
    if (chars.length <= 1) return [chars];

    // Sort characters primarily by vertical center
    const sorted = [...chars].sort(
      (a, b) =>
        a.bounds.position.y + a.bounds.size.height / 2 - (b.bounds.position.y + b.bounds.size.height / 2)
    );

    const lines: DetectedCharacter[][] = [];
    let currentLine: DetectedCharacter[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const c = sorted[i];

      // Vertical span of current line
      let lineMinY = Infinity;
      let lineMaxY = -Infinity;
      for (const m of currentLine) {
        lineMinY = Math.min(lineMinY, m.bounds.position.y);
        lineMaxY = Math.max(lineMaxY, m.bounds.position.y + m.bounds.size.height);
      }
      const lineH = lineMaxY - lineMinY;
      const cCenterY = c.bounds.position.y + c.bounds.size.height / 2;
      const lineCenterY = lineMinY + lineH / 2;

      const verticalOverlap =
        Math.min(lineMaxY, c.bounds.position.y + c.bounds.size.height) -
        Math.max(lineMinY, c.bounds.position.y);

      const belongsToLine =
        verticalOverlap > 0.25 * Math.min(lineH, c.bounds.size.height) ||
        Math.abs(cCenterY - lineCenterY) < 0.60 * Math.max(lineH, c.bounds.size.height);

      if (belongsToLine) {
        currentLine.push(c);
      } else {
        lines.push(currentLine);
        currentLine = [c];
      }
    }
    lines.push(currentLine);

    return lines;
  }

  // --- Word Grouping ---

  /**
   * Groups recognized characters into words by measuring inter-character vs inter-word gaps.
   */
  private groupCharactersIntoWords(characters: DetectedCharacter[]): DetectedWord[] {
    if (characters.length === 0) return [];

    const heights = characters.map((c) => c.bounds.size.height);
    const avgH = heights.reduce((a, b) => a + b, 0) / characters.length;

    const gaps: number[] = [];
    for (let i = 0; i < characters.length - 1; i++) {
      const c1 = characters[i];
      const c2 = characters[i + 1];
      const gap = c2.bounds.position.x - (c1.bounds.position.x + c1.bounds.size.width);
      if (gap > 0) gaps.push(gap);
    }
    gaps.sort((a, b) => a - b);
    const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 6;

    // Word boundary threshold for letter-to-letter transitions
    const wordGapThreshold = Math.max(16, Math.max(medianGap * 1.6, 0.48 * avgH));

    const isOperator = (ch: string) => ch === "+" || ch === "=" || ch === "#" || ch === "-";

    const words: DetectedWord[] = [];
    let currentWordChars: DetectedCharacter[] = [characters[0]];

    for (let i = 1; i < characters.length; i++) {
      const prevChar = characters[i - 1];
      const currChar = characters[i];
      const gap =
        currChar.bounds.position.x - (prevChar.bounds.position.x + prevChar.bounds.size.width);

      const isOpBoundary =
        isOperator(prevChar.char) || isOperator(currChar.char);

      if (gap >= wordGapThreshold || isOpBoundary) {
        words.push(this.buildWord(currentWordChars));
        currentWordChars = [currChar];
      } else {
        currentWordChars.push(currChar);
      }
    }
    words.push(this.buildWord(currentWordChars));

    return words;
  }

  private static readonly LEXICON: string[] = [
    // Common words
    "the", "be", "to", "of", "and", "a", "in", "that", "have", "i", "it", "for", "not", "on", "with",
    "he", "as", "you", "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her",
    "she", "or", "an", "will", "my", "one", "all", "would", "there", "their", "what", "so", "up",
    "out", "if", "about", "who", "get", "which", "go", "me", "when", "make", "can", "like", "time",
    "no", "just", "him", "know", "take", "people", "into", "year", "your", "good", "some", "could",
    "them", "see", "other", "than", "then", "now", "look", "only", "come", "its", "over", "think",
    "also", "back", "after", "use", "two", "how", "our", "work", "first", "well", "way", "even",
    "new", "want", "because", "any", "these", "give", "day", "most", "us", "yes", "ok", "app",
    "dog", "cat", "car", "box", "line", "text", "test", "file", "note", "save", "home", "page",
    "help", "info", "view", "edit", "name", "type", "item", "data", "list", "menu", "link",
    // Diagram, software & architecture terms
    "class", "node", "interface", "object", "diagram", "table", "start", "end", "user", "order",
    "payment", "auth", "login", "title", "state", "action", "decision", "package", "component",
    "service", "controller", "model", "api", "database", "server", "client", "request", "response",
    "error", "system", "process", "event", "config", "setting", "settings", "group", "shape",
    "uml", "id", "true", "false", "null", "card", "flow", "step", "todo", "done", "cancel", "submit",
    "hello", "world", "fit", "red", "blue", "green", "run"
  ];

  private refineWordWithLexicon(word: string, chars: DetectedCharacter[]): string {
    if (!word || word.length < 3) return word;

    // Separate leading/trailing punctuation if any
    const match = word.match(/^([^a-zA-Z0-9]*)([a-zA-Z0-9?]+)([^a-zA-Z0-9]*)$/);
    if (!match) return word;
    const prefix = match[1];
    const core = match[2];
    const suffix = match[3];

    if (core.length < 3) return word;

    const lower = core.toLowerCase();
    const isAllUpper = core === core.toUpperCase() && core !== core.toLowerCase();
    const isCapitalized =
      core[0] === core[0].toUpperCase() && core.slice(1) === core.slice(1).toLowerCase();

    // If it's already an exact match in the lexicon, preserve original word characters
    for (const entry of HandwrittenFontDetector.LEXICON) {
      if (entry === lower) {
        return word;
      }
    }

    const hasUncertainChars = chars.some((c) => c.char === "?" || c.confidence < 0.7);

    // Only attempt fuzzy correction if word length >= 4 AND (it has uncertain chars or is unknown)
    if (core.length < 4 && !hasUncertainChars) {
      return word;
    }

    let bestMatch: string | null = null;
    let bestDist = Infinity;
    const maxDist = core.length >= 7 ? 2 : 1;

    for (const entry of HandwrittenFontDetector.LEXICON) {
      if (Math.abs(entry.length - lower.length) > maxDist) continue;
      if (entry.length < 4) continue;
      const d = this.levenshtein(lower, entry);
      if (d <= maxDist && d < bestDist) {
        bestDist = d;
        bestMatch = entry;
      }
    }

    if (bestMatch && bestDist <= maxDist) {
      let formatted: string;
      if (isAllUpper) {
        formatted = bestMatch.toUpperCase();
      } else if (isCapitalized) {
        formatted = bestMatch[0].toUpperCase() + bestMatch.slice(1);
      } else {
        formatted = bestMatch;
      }
      return prefix + formatted + suffix;
    }

    return word;
  }

  private levenshtein(a: string, b: string): number {
    const al = a.length;
    const bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    const matrix: number[][] = [];
    for (let i = 0; i <= al; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= bl; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= al; i++) {
      for (let j = 1; j <= bl; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[al][bl];
  }

  private buildWord(chars: DetectedCharacter[]): DetectedWord {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const c of chars) {
      const p = c.bounds.position;
      const s = c.bounds.size;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.width);
      maxY = Math.max(maxY, p.y + s.height);
    }
    const bounds = rectFromBounds(minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY));
    let text = chars.map((c) => c.char).join("");
    const refinedText = this.refineWordWithLexicon(text, chars);
    if (refinedText !== text) {
      text = refinedText;
    }
    const confidence =
      chars.reduce((acc, c) => acc + c.confidence, 0) / Math.max(1, chars.length);

    return {
      text,
      confidence: Math.round(confidence * 100) / 100,
      bounds,
      characters: chars,
    };
  }

  // --- Character Recognition ---

  /**
   * Recognizes a single character from a cluster of 1 to 5 strokes.
   */
  public recognizeCharacterCluster(strokes: StrokeFeatures[]): DetectedCharacter {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const s of strokes) {
      minX = Math.min(minX, s.minX);
      minY = Math.min(minY, s.minY);
      maxX = Math.max(maxX, s.maxX);
      maxY = Math.max(maxY, s.maxY);
    }
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const bounds = rectFromBounds(minX, minY, width, height);
    const strokeIndices = strokes.map((s) => s.index);

    const n = strokes.length;
    let char = "?";
    let confidence = 0.80;

    if (n === 4) {
      const res = this.classify4StrokeCluster(strokes, width, height, minX, minY);
      char = res.char;
      confidence = res.confidence;
    } else if (n === 3) {
      const res = this.classify3StrokeCluster(strokes, width, height, minX, minY);
      char = res.char;
      confidence = res.confidence;
    } else if (n === 2) {
      const res = this.classify2StrokeCluster(strokes, width, height, minX, minY);
      char = res.char;
      confidence = res.confidence;
    } else if (n === 1) {
      const res = this.classify1Stroke(strokes[0], width, height, minX, minY);
      char = res.char;
      confidence = res.confidence;
    } else {
      // 5 strokes: Check if 'E' with serifs
      const res = this.classify4StrokeCluster(strokes, width, height, minX, minY);
      char = res.char !== "?" ? res.char : "E";
      confidence = 0.85;
    }

    return {
      char,
      confidence,
      bounds,
      strokeIndices,
    };
  }

  // --- Multi-stroke Classifiers ---

  /**
   * 4-stroke letters:
   * 'E', 'M', 'W', '#'
   */
  private classify4StrokeCluster(
    strokes: StrokeFeatures[],
    w: number,
    h: number,
    minX: number,
    minY: number
  ): { char: string; confidence: number } {
    const trueVerticals = strokes.filter(
      (s) => (s.isVertical || s.height > 0.65 * h) && Math.abs(s.dy) > 1.8 * Math.abs(s.dx)
    );
    const horizontals = strokes.filter(
      (s) => s.isHorizontal || (s.width > 0.30 * w && Math.abs(s.dx) > 1.8 * Math.abs(s.dy))
    );

    // 1. 'E': 1 vertical stem on left + 3 horizontal bars (top, mid, bot)
    if (trueVerticals.length >= 1 && horizontals.length >= 2) {
      horizontals.sort((a, b) => a.cy - b.cy);
      const topBar = horizontals[0];
      const botBar = horizontals[horizontals.length - 1];

      const topAtTop = topBar.cy < minY + 0.40 * h;
      const botAtBot = botBar.cy > minY + 0.60 * h;

      if (topAtTop && botAtBot) {
        return { char: "E", confidence: 0.98 };
      }
      return { char: "E", confidence: 0.94 };
    }

    // 2. '#': 2 verticals + 2 horizontals crossing
    if (trueVerticals.length >= 2 && horizontals.length >= 2) {
      return { char: "#", confidence: 0.95 };
    }

    // 3. 'M' vs 'W': 4 strokes spanning from left to right
    strokes.sort((a, b) => a.cx - b.cx);
    if (strokes.length === 4 && strokes[0].cx < minX + 0.40 * w && strokes[3].cx > minX + 0.60 * w) {
      // Find the junction / meeting point of the two middle strokes
      const s2 = strokes[1];
      const s3 = strokes[2];
      let centerApexY = (s2.cy + s3.cy) / 2;

      for (const p of s2.points) {
        for (const q of s3.points) {
          if (Math.hypot(p.x - q.x, p.y - q.y) < 6) {
            centerApexY = p.y;
            break;
          }
        }
      }

      // In 'W', the center apex points up (small Y near top)
      // In 'M', the center apex points down (large Y near bottom)
      if (centerApexY < minY + 0.50 * h) {
        return { char: "W", confidence: 0.97 };
      } else {
        return { char: "M", confidence: 0.97 };
      }
    }

    return { char: "E", confidence: 0.88 };
  }

  /**
   * 3-stroke letters:
   * 'A', 'H', 'F', 'K', 'N', 'Y', 'Z', 'B', 'R', 'I'
   */
  private classify3StrokeCluster(
    strokes: StrokeFeatures[],
    w: number,
    h: number,
    minX: number,
    minY: number
  ): { char: string; confidence: number } {
    const trueVerticals = strokes.filter(
      (s) => (s.isVertical || s.height > 0.65 * h) && Math.abs(s.dy) > 1.8 * Math.abs(s.dx)
    );
    const horizontals = strokes.filter(
      (s) => s.isHorizontal || (s.width > 0.30 * w && Math.abs(s.dx) > 1.8 * Math.abs(s.dy))
    );

    // 1. 'Z': top horizontal bar + diagonal down-left + bottom horizontal bar
    if (horizontals.length >= 2) {
      horizontals.sort((a, b) => a.cy - b.cy);
      const topH = horizontals[0];
      const botH = horizontals[horizontals.length - 1];
      if (topH.cy < minY + 0.35 * h && botH.cy > minY + 0.65 * h) {
        const diagCandidate = strokes.find((s) => s !== topH && s !== botH);
        if (
          diagCandidate &&
          (diagCandidate.isDiagonalSlash ||
            diagCandidate.dx * diagCandidate.dy < 0 ||
            diagCandidate.start.x > diagCandidate.end.x)
        ) {
          return { char: "Z", confidence: 0.98 };
        }
      }
    }

    // 2. 'F': 1 vertical stem on left + 2 horizontal bars (top and mid, no bottom bar)
    if (trueVerticals.length === 1 && horizontals.length === 2) {
      const stem = trueVerticals[0];
      if (stem.cx < minX + 0.48 * w) {
        horizontals.sort((a, b) => a.cy - b.cy);
        const topH = horizontals[0];
        const hasBottomBar = horizontals.some((b) => b.cy > minY + 0.72 * h);

        if (topH.cy < minY + 0.40 * h && !hasBottomBar) {
          return { char: "F", confidence: 0.98 };
        }
        if (hasBottomBar) {
          return { char: "E", confidence: 0.94 };
        }
      }
    }

    // 3. 'I': 1 vertical stem + top serif bar + bottom serif bar
    if (trueVerticals.length === 1 && horizontals.length === 2) {
      const stem = trueVerticals[0];
      horizontals.sort((a, b) => a.cy - b.cy);
      if (
        horizontals[0].cy < minY + 0.35 * h &&
        horizontals[1].cy > minY + 0.65 * h &&
        Math.abs(stem.cx - (minX + w / 2)) < 0.35 * w
      ) {
        return { char: "I", confidence: 0.97 };
      }
    }

    // 4. 'N': 2 vertical stems + 1 diagonal connecting top of left to bottom of right
    if (trueVerticals.length === 2) {
      trueVerticals.sort((a, b) => a.cx - b.cx);
      const leftStem = trueVerticals[0];
      const rightStem = trueVerticals[1];
      const diag = strokes.find((s) => s !== leftStem && s !== rightStem);
      if (
        diag &&
        (diag.dx * diag.dy > 0 ||
          (diag.end.x > diag.start.x && diag.end.y > diag.start.y) ||
          (diag.start.x < diag.end.x && diag.start.y < diag.end.y))
      ) {
        return { char: "N", confidence: 0.98 };
      }
    }

    // 5. 'A' vs 'H': 2 vertical/diagonal stems + 1 horizontal crossbar
    if (horizontals.length >= 1) {
      const crossbar = horizontals[0];
      const otherTwo = strokes.filter((s) => s !== crossbar);

      if (otherTwo.length === 2) {
        const sA = otherTwo[0];
        const sB = otherTwo[1];

        const topA = sA.start.y < sA.end.y ? sA.start : sA.end;
        const botA = sA.start.y < sA.end.y ? sA.end : sA.start;
        const topB = sB.start.y < sB.end.y ? sB.start : sB.end;
        const botB = sB.start.y < sB.end.y ? sB.end : sB.start;

        const distTop = Math.hypot(topA.x - topB.x, topA.y - topB.y);
        const distBot = Math.hypot(botA.x - botB.x, botA.y - botB.y);

        // In 'A', the two diagonals meet near the apex
        if (distTop < 0.38 * distBot || distTop < 10) {
          return { char: "A", confidence: 0.98 };
        }

        // In 'H', the two stems are parallel
        if (distTop > 0.35 * w && Math.abs(distTop - distBot) < 0.40 * w) {
          return { char: "H", confidence: 0.98 };
        }
      }
    }

    // 6. 'B': 1 vertical stem on left + 2 curved lobes
    if (trueVerticals.length === 1 && trueVerticals[0].cx < minX + 0.45 * w) {
      const otherTwo = strokes.filter((s) => s !== trueVerticals[0]);
      otherTwo.sort((a, b) => a.cy - b.cy);
      if (otherTwo.every((s) => s.cx > minX + 0.35 * w && s.straightness < 0.85)) {
        return { char: "B", confidence: 0.97 };
      }
    }

    // 7. 'R': 1 vertical stem on left + upper curved loop + diagonal leg down-right
    if (trueVerticals.length === 1 && trueVerticals[0].cx < minX + 0.45 * w) {
      const otherTwo = strokes.filter((s) => s !== trueVerticals[0]);
      const hasLoop = otherTwo.some(
        (s) => s.cy < minY + 0.58 * h && s.cx > minX + 0.30 * w && s.straightness < 0.85
      );
      const hasLeg = otherTwo.some(
        (s) => s.cy > minY + 0.45 * h && s.cx > minX + 0.35 * w && (s.dx > 0 || s.isDiagonalBackslash)
      );
      if (hasLoop && hasLeg) {
        return { char: "R", confidence: 0.97 };
      }
    }

    // 8. 'K': 1 vertical stem on left + 2 diagonal arms branching right
    if (trueVerticals.length === 1 && trueVerticals[0].cx < minX + 0.45 * w) {
      const otherTwo = strokes.filter((s) => s !== trueVerticals[0]);
      if (otherTwo.every((s) => s.cx > minX + 0.30 * w)) {
        return { char: "K", confidence: 0.97 };
      }
    }

    // 9. 'Y': 2 upper diagonals + 1 vertical stem below
    if (trueVerticals.length === 1) {
      const stem = trueVerticals[0];
      if (stem.cy > minY + 0.45 * h && Math.abs(stem.cx - (minX + w / 2)) < 0.35 * w) {
        return { char: "Y", confidence: 0.97 };
      }
    }

    // 10. 'm': 3 vertical stems or left stem + 2 arches/lobes to right
    if (trueVerticals.length === 3) {
      return { char: "m", confidence: 0.96 };
    }
    if (trueVerticals.length === 1 && trueVerticals[0].cx < minX + 0.40 * w) {
      const otherTwo = strokes.filter((s) => s !== trueVerticals[0]);
      if (otherTwo.every((s) => s.cx > minX + 0.28 * w && s.straightness < 0.88)) {
        return { char: "m", confidence: 0.95 };
      }
    }

    return { char: "A", confidence: 0.85 };
  }

  /**
   * 2-stroke letters:
   * 'T', 't', 'L', 'X', 'i', 'j', '!', '?', ':', '=', '+', 'A', 'K', 'P', 'D', 'B', 'R', 'Q', 'V', 'Y', '7'
   */
  private classify2StrokeCluster(
    strokes: StrokeFeatures[],
    w: number,
    h: number,
    minX: number,
    minY: number
  ): { char: string; confidence: number } {
    const s1 = strokes[0];
    const s2 = strokes[1];

    // 1. Both are dots: ':' (colon)
    const s1IsDot = s1.width <= 14 && s1.height <= 14;
    const s2IsDot = s2.width <= 14 && s2.height <= 14;
    if (s1IsDot && s2IsDot) {
      if (Math.abs(s1.cx - s2.cx) <= Math.max(10, 0.45 * w)) {
        return { char: ":", confidence: 0.98 };
      }
    }

    // 2. Dot above/below body ('i', 'j', '!', '?')
    const dotCandidate = s1IsDot ? s1 : s2IsDot ? s2 : null;
    const bodyStroke = dotCandidate === s1 ? s2 : s1;

    if (dotCandidate) {
      // If dot is above body -> 'i' or 'j'
      if (dotCandidate.cy < bodyStroke.minY) {
        if (
          bodyStroke.end.x < bodyStroke.start.x - 0.20 * w &&
          bodyStroke.end.y > bodyStroke.minY + 0.65 * h
        ) {
          return { char: "j", confidence: 0.97 };
        }
        return { char: "i", confidence: 0.98 };
      }
      // If dot is below body -> '!' or '?'
      if (dotCandidate.cy > bodyStroke.maxY) {
        if (bodyStroke.straightness > 0.80) {
          return { char: "!", confidence: 0.98 };
        }
        return { char: "?", confidence: 0.97 };
      }
    }

    // 3. '=': 2 parallel horizontal lines
    if (s1.isHorizontal && s2.isHorizontal) {
      return { char: "=", confidence: 0.98 };
    }

    // 4. '+': 1 horizontal + 1 vertical intersecting near center (both straight lines)
    const horizStroke = s1.isHorizontal ? s1 : s2.isHorizontal ? s2 : null;
    const vertStroke = s1.isVertical ? s1 : s2.isVertical ? s2 : null;
    if (
      horizStroke &&
      vertStroke &&
      vertStroke.straightness > 0.85 &&
      horizStroke.straightness > 0.85
    ) {
      const isCenteredH = Math.abs(vertStroke.cx - (minX + w / 2)) < 0.30 * w;
      const isCenteredV = Math.abs(horizStroke.cy - (minY + h / 2)) < 0.28 * h;
      if (isCenteredH && isCenteredV) {
        return { char: "+", confidence: 0.98 };
      }
    }

    // 5. 'T': Top horizontal bar + vertical stem centered underneath
    const topBar =
      s1.isHorizontal && s1.cy < minY + 0.38 * h
        ? s1
        : s2.isHorizontal && s2.cy < minY + 0.38 * h
        ? s2
        : null;
    const stemCandidate = topBar === s1 ? s2 : s1;
    if (topBar && (stemCandidate.isVertical || stemCandidate.height > 0.50 * h)) {
      const stemCentered = Math.abs(stemCandidate.cx - (minX + w / 2)) < 0.35 * w;
      if (stemCentered) {
        return { char: "T", confidence: 0.98 };
      }
    }

    // 6. 't' or 'f': Vertical stem + horizontal crossbar in upper middle
    const crossbarCandidate =
      s1.isHorizontal && s1.cy > minY + 0.15 * h && s1.cy < minY + 0.60 * h
        ? s1
        : s2.isHorizontal && s2.cy > minY + 0.15 * h && s2.cy < minY + 0.60 * h
        ? s2
        : null;
    const tStemCandidate = crossbarCandidate === s1 ? s2 : s1;
    if (crossbarCandidate && (tStemCandidate.isVertical || tStemCandidate.height > 0.55 * h)) {
      const stemStart = tStemCandidate.points[0];
      const hasTopHook =
        stemStart.y < crossbarCandidate.cy - 0.10 * h &&
        (stemStart.x > tStemCandidate.minX + 0.25 * tStemCandidate.width ||
          tStemCandidate.minX < crossbarCandidate.cx - 2);
      if (hasTopHook || tStemCandidate.start.x < tStemCandidate.end.x - 4) {
        return { char: "f", confidence: 0.96 };
      }
      return { char: "t", confidence: 0.97 };
    }

    // 6b. 'e': horizontal mid-bar + C-arc
    const midBar =
      s1.isHorizontal && s1.cy > minY + 0.28 * h && s1.cy < minY + 0.72 * h
        ? s1
        : s2.isHorizontal && s2.cy > minY + 0.28 * h && s2.cy < minY + 0.72 * h
        ? s2
        : null;
    const arcCandidate = midBar === s1 ? s2 : s1;
    if (midBar && arcCandidate && arcCandidate.straightness < 0.82) {
      return { char: "e", confidence: 0.96 };
    }

    // 6c. 'G': C-arc + bottom-right horizontal bar
    const cArc =
      s1.straightness < 0.82 && s1.width > 0.38 * w
        ? s1
        : s2.straightness < 0.82 && s2.width > 0.38 * w
        ? s2
        : null;
    const gBar = cArc === s1 ? s2 : s1;
    if (
      cArc &&
      gBar &&
      (gBar.isHorizontal || gBar.width > 1.4 * gBar.height) &&
      gBar.cx > minX + 0.45 * w &&
      gBar.cy > minY + 0.45 * h
    ) {
      return { char: "G", confidence: 0.96 };
    }

    // 7. 'L': Vertical stem on left + bottom horizontal bar
    const botBar =
      s1.isHorizontal && s1.cy > minY + 0.60 * h
        ? s1
        : s2.isHorizontal && s2.cy > minY + 0.60 * h
        ? s2
        : null;
    const lStem = botBar === s1 ? s2 : s1;
    if (botBar && (lStem.isVertical || lStem.height > 0.55 * h) && lStem.cx < minX + 0.48 * w) {
      return { char: "L", confidence: 0.97 };
    }

    // 8. 'X': 2 diagonal crossing strokes
    if (
      s1.height > 0.60 * h &&
      s2.height > 0.60 * h &&
      ((s1.isDiagonalSlash && s2.isDiagonalBackslash) ||
        (s1.isDiagonalBackslash && s2.isDiagonalSlash) ||
        (Math.abs(s1.dx) > 0.25 * w && Math.abs(s2.dx) > 0.25 * w && s1.dx * s2.dx < 0))
    ) {
      return { char: "X", confidence: 0.98 };
    }

    // 9. 'A': 1 inverted 'V' + 1 horizontal crossbar
    const crossbar = s1.isHorizontal ? s1 : s2.isHorizontal ? s2 : null;
    const apexStroke = crossbar === s1 ? s2 : s1;
    if (crossbar && apexStroke) {
      const topPt = apexStroke.points.reduce(
        (min, p) => (p.y < min.y ? p : min),
        apexStroke.points[0]
      );
      if (
        topPt.y < minY + 0.25 * h &&
        crossbar.cy > minY + 0.35 * h &&
        crossbar.cy < minY + 0.75 * h
      ) {
        return { char: "A", confidence: 0.97 };
      }
    }

    // 10. 'Q': Closed loop 'O' + diagonal tail at bottom-right
    const closedLoop = s1.isClosed ? s1 : s2.isClosed ? s2 : null;
    const tail = closedLoop === s1 ? s2 : s1;
    if (closedLoop && tail) {
      if (tail.cx > minX + 0.50 * w && tail.cy > minY + 0.55 * h) {
        return { char: "Q", confidence: 0.97 };
      }
    }

    // 11. Left stem + rightward stroke: 'P', 'D', 'B', 'R', 'K', 'b', 'h', 'n', 'r', 'p'
    const leftStem =
      (s1.isVertical || s1.height > 0.50 * h) && s1.cx < minX + 0.48 * w
        ? s1
        : (s2.isVertical || s2.height > 0.50 * h) && s2.cx < minX + 0.48 * w
        ? s2
        : null;
    const rightStroke = leftStem === s1 ? s2 : s1;
    if (leftStem && rightStroke && rightStroke.cx > minX + 0.35 * w) {
      // 'K' / 'k': chevron arm branching right (<)
      if (rightStroke.points.length >= 3 && !rightStroke.isClosed) {
        let midPointX = Infinity;
        for (let i = 1; i < rightStroke.points.length - 1; i++) {
          midPointX = Math.min(midPointX, rightStroke.points[i].x);
        }
        if (
          midPointX < rightStroke.start.x - 0.15 * rightStroke.width &&
          midPointX < rightStroke.end.x - 0.15 * rightStroke.width &&
          rightStroke.start.x > minX + 0.35 * w
        ) {
          return { char: "k", confidence: 0.96 };
        }
      }
      // 'D': full height arc spanning from top to bottom
      if (rightStroke.height > 0.68 * h && Math.abs(leftStem.minY - rightStroke.minY) < 0.20 * h) {
        return { char: "D", confidence: 0.97 };
      }
      const rightDistSE = Math.hypot(
        rightStroke.end.x - rightStroke.start.x,
        rightStroke.end.y - rightStroke.start.y
      );
      const isRightLoop =
        rightStroke.isClosed ||
        rightDistSE < 0.35 * Math.max(rightStroke.width, rightStroke.height) ||
        rightStroke.end.x < minX + 0.45 * w;

      // Lowercase 'b': tall stem + loop in bottom half only (ascender stem)
      if (
        leftStem.minY < rightStroke.minY - 0.18 * h &&
        rightStroke.cy > minY + 0.45 * h &&
        isRightLoop
      ) {
        return { char: "b", confidence: 0.97 };
      }
      // Lowercase 'h': tall stem + arch in bottom half
      if (
        leftStem.minY < rightStroke.minY - 0.18 * h &&
        rightStroke.cy > minY + 0.40 * h &&
        rightStroke.end.x > minX + 0.50 * w &&
        !isRightLoop
      ) {
        return { char: "h", confidence: 0.96 };
      }
      // Uppercase 'P': stem with loop in upper half
      if (rightStroke.height <= 0.68 * h && rightStroke.cy < minY + 0.58 * h) {
        return { char: "P", confidence: 0.97 };
      }
      // Lowercase 'p': left stem extends below right loop into descender
      if (
        leftStem.maxY > rightStroke.maxY + 0.15 * h &&
        leftStem.height > 1.3 * leftStem.width
      ) {
        return { char: "p", confidence: 0.96 };
      }
      // Lowercase 'n': shorter stem + arch
      if (leftStem.height <= 0.68 * h && rightStroke.cy > minY + 0.35 * h && rightStroke.straightness < 0.85) {
        return { char: "n", confidence: 0.95 };
      }
      return { char: "P", confidence: 0.90 };
    }

    // 11b. Right stem + leftward stroke: 'd', 'q', 'a', 'y'
    const leftB = s1.cx <= s2.cx ? s1 : s2;
    const rightB = s1.cx <= s2.cx ? s2 : s1;
    const leftBStroke = leftB === s1 ? s1 : s2;
    const rightBStroke = leftB === s1 ? s2 : s1;

    if (rightB.height > 0.50 * h) {
      const leftDistSE = Math.hypot(
        leftBStroke.end.x - leftBStroke.start.x,
        leftBStroke.end.y - leftBStroke.start.y
      );
      const isLeftLoop =
        leftBStroke.isClosed ||
        leftDistSE < 0.35 * Math.max(leftBStroke.width, leftBStroke.height);

      // 'd': right tall stem (ascender: minY extends significantly above left loop)
      if (rightB.minY < leftB.minY - 0.18 * h && rightB.height > 1.3 * rightB.width) {
        return { char: "d", confidence: 0.97 };
      }
      // 'q': left closed loop + right descender stem (maxY extends significantly below left loop)
      if (isLeftLoop && rightB.maxY > leftB.maxY + 0.15 * h) {
        return { char: "q", confidence: 0.97 };
      }
      // 'y': left open cup/V + right descender stem
      if (!isLeftLoop && rightB.maxY > leftB.maxY + 0.15 * h) {
        return { char: "y", confidence: 0.96 };
      }
      // 'a': left loop + right vertical stem of roughly matching height
      if (Math.abs(leftB.minY - rightB.minY) < 0.28 * h && rightB.cx > minX + 0.40 * w) {
        return { char: "a", confidence: 0.97 };
      }
    }

    // 12. 'V': 2 diagonal strokes meeting at bottom vertex
    if (
      s1.straightness > 0.80 &&
      s2.straightness > 0.80 &&
      (Math.abs(s1.end.x - s2.start.x) < 0.35 * w || Math.abs(s1.start.x - s2.end.x) < 0.35 * w) &&
      Math.abs(s1.end.y - s2.end.y) < 0.25 * h
    ) {
      return { char: "V", confidence: 0.95 };
    }

    // 13. 'Y': 1 upper 'V' + 1 vertical stem down
    if (s1.cy < minY + 0.55 * h && s2.cy > minY + 0.45 * h) {
      return { char: "Y", confidence: 0.95 };
    }

    // 14. '7': 1 top horizontal bar + 1 diagonal stem down-left
    if (topBar && (stemCandidate.isDiagonalSlash || stemCandidate.dx < 0)) {
      return { char: "7", confidence: 0.95 };
    }

    if (s1.isHorizontal || s2.isHorizontal) {
      return { char: "T", confidence: 0.85 };
    }
    return { char: "I", confidence: 0.85 };
  }

  /**
   * 1-stroke characters:
   * 'O', '0', 'C', 'S', 'U', 'V', 'W', 'M', 'Z', 'L', 'J', 'I', '1', '-', '/', '.', ',', '2', '3', '6', '8', '9', '7'
   */
  private classify1Stroke(
    s: StrokeFeatures,
    w: number,
    h: number,
    minX: number,
    minY: number
  ): { char: string; confidence: number } {
    const pts = s.points;
    const n = pts.length;
    const aspectRatio = w / h;

    // 1. Tiny dot: '.'
    if (w < 8 && h < 8 && s.totalLength < 16) {
      return { char: ".", confidence: 0.98 };
    }

    // 2. Comma: ',' (small comma stroke near baseline)
    if (w < 12 && h < 18 && s.totalLength < 25 && s.dy > 0 && s.dx < 0) {
      return { char: ",", confidence: 0.96 };
    }

    // 3. Hyphen: '-' (wide, flat horizontal stroke)
    if (
      (aspectRatio >= 1.8 && h <= 28 && s.straightness >= 0.65) ||
      (s.isHorizontal && s.straightness > 0.85)
    ) {
      return { char: "-", confidence: 0.98 };
    }

    // 4. Straight vertical stroke: 'I'
    if ((s.isVertical || aspectRatio < 0.28) && s.straightness > 0.80) {
      return { char: "I", confidence: 0.98 };
    }

    // 5. Diagonal slash: '/'
    if (s.isDiagonalSlash && s.straightness > 0.85) {
      return { char: "/", confidence: 0.96 };
    }

    const start = pts[0];
    const end = pts[n - 1];
    const distStartEnd = Math.hypot(end.x - start.x, end.y - start.y);

    // 6. Closed loop: 'O' or '0'
    if (distStartEnd < 0.22 * Math.max(w, h) || s.isClosed) {
      if (aspectRatio < 0.65) {
        return { char: "0", confidence: 0.96 };
      }
      return { char: "O", confidence: 0.98 };
    }

    const relStartX = (start.x - minX) / w;
    const relStartY = (start.y - minY) / h;
    const relEndX = (end.x - minX) / w;
    const relEndY = (end.y - minY) / h;

    const idx20 = Math.max(1, Math.floor(n * 0.20));
    const dxInit = pts[idx20].x - start.x;

    // 7. 'w' (2 bottom valleys separated by a mid peak, starts & ends in upper half)
    let bottomValleys = 0;
    let inBottom = false;
    let hadMidPeak = false;
    for (let i = 0; i < n; i++) {
      const ry = (pts[i].y - minY) / h;
      if (ry > 0.75) {
        if (!inBottom) {
          if (hadMidPeak) bottomValleys = 2;
          else bottomValleys = 1;
          inBottom = true;
        }
      } else if (ry < 0.55 && inBottom) {
        hadMidPeak = true;
        inBottom = false;
      }
    }
    if (bottomValleys >= 2 && aspectRatio >= 0.75 && relStartY < 0.45 && relEndY < 0.45) {
      return { char: "w", confidence: 0.96 };
    }

    // 8. Left downward stem letters: 'b', 'h', 'r', 'm', 'n'
    const startsLeftDown =
      relStartX < 0.38 && pts[idx20].x < minX + 0.38 * w && pts[idx20].y > start.y;
    let ascendsOnLeft = false;
    let reachedBottom = false;
    let firstBottomIdx = -1;
    for (let i = 0; i < n; i++) {
      if (pts[i].y > minY + 0.75 * h && !reachedBottom) {
        reachedBottom = true;
        firstBottomIdx = i;
      }
      if (
        reachedBottom &&
        pts[i].y < minY + 0.55 * h &&
        pts[i].x < minX + 0.45 * w &&
        i < n * 0.6
      ) {
        ascendsOnLeft = true;
      }
    }

    if (startsLeftDown && ascendsOnLeft) {
      // 'b': tall stem down, ascends, loops clockwise around bottom-right back to stem
      if (relStartY < 0.25 && end.x < minX + 0.55 * w && end.y > minY + 0.5 * h) {
        return { char: "b", confidence: 0.96 };
      }
      // 'h': tall stem down (ascender), arch to bottom-right
      let archMinY = Infinity;
      for (let i = Math.floor(n * 0.3); i < Math.floor(n * 0.8); i++) {
        archMinY = Math.min(archMinY, pts[i].y);
      }
      if (archMinY > minY + 0.28 * h && relStartY < 0.25 && relEndX > 0.55) {
        return { char: "h", confidence: 0.96 };
      }
      // 'r': short stem down, short branch right (ends near top/mid, not baseline)
      if (relEndY < 0.60 && relEndX > 0.45) {
        return { char: "r", confidence: 0.96 };
      }
      // Count arch peaks for 'm' vs 'n'
      const peakXList: number[] = [];
      for (let i = firstBottomIdx + 2; i < n - 2; i++) {
        const ry = (pts[i].y - minY) / h;
        const isTurningPoint = pts[i].y <= pts[i - 2].y && pts[i].y < pts[i + 2].y;
        if (ry < 0.35 && isTurningPoint) {
          if (
            peakXList.length === 0 ||
            Math.abs(pts[i].x - peakXList[peakXList.length - 1]) > 0.25 * w
          ) {
            peakXList.push(pts[i].x);
          }
        }
      }
      if (peakXList.length >= 3 || (aspectRatio >= 1.25 && peakXList.length >= 2)) {
        return { char: "m", confidence: 0.96 };
      }
      return { char: "n", confidence: 0.95 };
    }

    // 9. Zigzag 'z' / 'Z'
    if (relStartX < 0.45 && relStartY < 0.35 && relEndX > 0.55 && relEndY > 0.65) {
      let wentRightTop = false;
      let wentLeftDiag = false;
      for (let i = 0; i < n; i++) {
        if (pts[i].x > minX + 0.65 * w && pts[i].y < minY + 0.4 * h) wentRightTop = true;
        if (wentRightTop && pts[i].x < minX + 0.4 * w && pts[i].y > minY + 0.55 * h)
          wentLeftDiag = true;
      }
      if (wentRightTop && wentLeftDiag) {
        return { char: "z", confidence: 0.97 };
      }
    }

    // Count valleys visiting bottom for 'a' vs 'e'
    let yValleys = 0;
    let inLower = false;
    let visitedUpperAfterLower = false;
    for (let i = 0; i < n; i++) {
      const ry = (pts[i].y - minY) / h;
      if (ry > 0.75) {
        if (!inLower) {
          if (visitedUpperAfterLower) yValleys = 2;
          else yValleys = 1;
          inLower = true;
        }
      } else if (ry < 0.45 && inLower) {
        visitedUpperAfterLower = true;
        inLower = false;
      }
    }

    // 10. Lowercase 'e': starts at mid-height (y in [0.22, 0.78]), initial movement moves rightwards
    // across the mid crossbar (dxInit > 0.12 * w), top loop, single bottom curve (yValleys < 2), open bottom-right
    if (relStartY >= 0.22 && relStartY <= 0.78 && dxInit > 0.12 * w && yValleys < 2) {
      return { char: "e", confidence: 0.98 };
    }

    // 11. Lowercase 'g': upper loop + descender hook curving left at bottom
    let gUpperLoop = false;
    for (let i = Math.floor(n * 0.2); i < Math.floor(n * 0.7); i++) {
      if (Math.hypot(pts[i].x - start.x, pts[i].y - start.y) < 0.25 * Math.max(w, h)) {
        gUpperLoop = true;
        break;
      }
    }
    if (gUpperLoop && relEndY > 0.75 && relEndX < 0.85 && relStartY < 0.45) {
      return { char: "g", confidence: 0.96 };
    }

    // 12. Lowercase 'a': starts upper-right, initial movement left/down (dxInit <= 0.08 * w),
    // loops around counter-clockwise and has downward stem on right visiting bottom twice (yValleys >= 2)
    // or ends at bottom-right after looping
    if (
      (yValleys >= 2 ||
        (relStartY < 0.50 &&
          relEndX > 0.45 &&
          relEndY > 0.60 &&
          s.totalLength > 1.8 * Math.hypot(w, h))) &&
      dxInit <= 0.08 * w
    ) {
      return { char: "a", confidence: 0.98 };
    }

    // 13. S-curve 'S' / 's'
    let sCenterCross = false;
    for (let i = Math.floor(n * 0.2); i < Math.floor(n * 0.8); i++) {
      if (
        pts[i].x > minX + 0.40 * w &&
        pts[i].y > minY + 0.35 * h &&
        pts[i].y < minY + 0.65 * h
      ) {
        sCenterCross = true;
        break;
      }
    }
    if (
      relStartX > 0.35 &&
      relStartY < 0.40 &&
      sCenterCross &&
      distStartEnd > 0.3 * Math.max(w, h)
    ) {
      return { char: "s", confidence: 0.96 };
    }

    // 14. 'u' vs 'v': open cup at top (starts top-left, curves down, ends top-right)
    if (relStartX < 0.45 && relStartY < 0.55 && relEndX > 0.55 && relEndY < 0.65) {
      let minBottomX = Infinity;
      let maxBottomX = -Infinity;
      for (const p of pts) {
        if (p.y > minY + 0.80 * h) {
          minBottomX = Math.min(minBottomX, p.x);
          maxBottomX = Math.max(maxBottomX, p.x);
        }
      }
      const bottomWidth = maxBottomX - minBottomX;
      if (bottomWidth > 0.30 * w) {
        return { char: "u", confidence: 0.96 };
      }
      return { char: "v", confidence: 0.96 };
    }

    // 15. 'C' vs 'G': Starts in right half, curves left to reach minX, ends in right half
    const startsRight = start.x > minX + 0.35 * w && start.y < minY + 0.50 * h;
    const endsRight = end.x > minX + 0.35 * w && end.y > minY + 0.50 * h;
    let reachesFarLeft = false;
    for (const p of pts) {
      if (p.x < minX + 0.30 * w) {
        reachesFarLeft = true;
        break;
      }
    }
    if (startsRight && reachesFarLeft) {
      if (end.x < minX + 0.70 * w && end.y < minY + 0.75 * h && end.y > minY + 0.38 * h) {
        return { char: "G", confidence: 0.96 };
      }
      if (endsRight) {
        return { char: "C", confidence: 0.97 };
      }
    }

    // 16. Digits:
    // '7': Top horizontal right, diagonal down-left
    if (
      start.x < minX + 0.35 * w &&
      start.y < minY + 0.35 * h &&
      end.y > minY + 0.75 * h &&
      end.x < minX + 0.55 * w
    ) {
      return { char: "7", confidence: 0.95 };
    }

    // '2': starts top-left/center, curves over top to right, diagonal down-left, flat bottom right
    if (
      start.y < minY + 0.35 * h &&
      end.y > minY + 0.75 * h &&
      end.x > minX + 0.50 * w &&
      s.totalLength > 1.7 * Math.hypot(w, h)
    ) {
      return { char: "2", confidence: 0.94 };
    }

    // '3': double lobe open to left
    if (
      start.x < minX + 0.45 * w &&
      start.y < minY + 0.35 * h &&
      end.x < minX + 0.45 * w &&
      end.y > minY + 0.65 * h &&
      s.totalLength > 1.8 * Math.hypot(w, h)
    ) {
      return { char: "3", confidence: 0.94 };
    }

    // Fallbacks
    if (s.totalLength > 2.5 * Math.hypot(w, h)) {
      return { char: "s", confidence: 0.82 };
    }
    if (h > 1.8 * w) {
      return { char: "I", confidence: 0.88 };
    }
    return { char: "C", confidence: 0.80 };
  }

  // --- Cursive Word Segmentation ---

  /**
   * For continuous cursive handwriting drawn in a single stroke across a wide area,
   * segments the stroke at baseline valleys / ligatures into individual letter strokes.
   */
  public segmentCursiveStroke(stroke: Stroke): Stroke[] {
    const pts = stroke.points;
    const n = pts.length;
    if (n < 12) return [stroke];

    // Find valleys (local Y maxima because Y points down)
    const valleys: number[] = [];
    for (let i = 4; i < n - 4; i++) {
      const prevY = pts[i - 3].y;
      const currY = pts[i].y;
      const nextY = pts[i + 3].y;
      if (currY > prevY + 2 && currY > nextY + 2) {
        valleys.push(i);
        i += 6;
      }
    }

    if (valleys.length <= 1) return [stroke];

    // Split points midway between valleys
    const splitIndices: number[] = [0];
    for (let v = 0; v < valleys.length - 1; v++) {
      const mid = Math.floor((valleys[v] + valleys[v + 1]) / 2);
      splitIndices.push(mid);
    }
    splitIndices.push(n);

    const subStrokes: Stroke[] = [];
    for (let i = 0; i < splitIndices.length - 1; i++) {
      const slicePts = pts.slice(splitIndices[i], splitIndices[i + 1] + 1);
      if (slicePts.length >= 2) {
        subStrokes.push({
          id: `${stroke.id}-part-${i}`,
          points: slicePts,
        });
      }
    }

    return subStrokes.length > 1 ? subStrokes : [stroke];
  }

  // --- Text vs Geometric Shape Classifier ---

  /**
   * Distinguishes handwriting / text from formal geometric shapes (rectangles, diamonds,
   * circles, clean connectors).
   */
  private evaluateIsText(
    strokes: StrokeFeatures[],
    bounds: Rect,
    characters: DetectedCharacter[],
    fullText: string
  ): boolean {
    if (!fullText || fullText.trim().length === 0) return false;

    if (strokes.length === 1) {
      const s = strokes[0];
      const w = bounds.size.width;
      const h = bounds.size.height;
      const aspectRatio = w / h;

      // Pure rectangle check: single closed stroke covering bounding box perimeter
      if (s.isClosed) {
        const area = this.calculateShoelaceArea(s.points);
        const boxArea = w * h;
        const areaRatio = area / Math.max(1, boxArea);

        if (areaRatio > 0.68 && aspectRatio >= 0.70 && aspectRatio <= 1.40 && w > 40 && h > 40) {
          if (w > 65 && h > 65 && fullText.length === 1 && fullText === "O") {
            return false;
          }
        }
      }

      // Single very long straight line (connector line)
      if (s.straightness > 0.90 && (s.totalLength > 120 || w > 120 || h > 120)) {
        return false;
      }
    }

    // If strokes form an intersecting grid or table, it's not handwritten text
    if (strokes.length >= 3 && bounds.size.width >= 50 && bounds.size.height >= 40) {
      const hLines = strokes.filter((s) => s.isHorizontal && s.width >= 0.35 * bounds.size.width);
      const vLines = strokes.filter((s) => s.isVertical && s.height >= 0.35 * bounds.size.height);
      const hasClosedBox = strokes.some(
        (s) => s.isClosed && s.width >= 0.65 * bounds.size.width && s.height >= 0.65 * bounds.size.height
      );
      if (hasClosedBox && (hLines.length >= 1 || vLines.length >= 1)) {
        return false;
      }
      if (hLines.length >= 2 && vLines.length >= 2) {
        // Only reject as table if lines actually span across each other and intersect >= 4 times
        const minVX = Math.min(...vLines.map((v) => v.cx));
        const maxVX = Math.max(...vLines.map((v) => v.cx));
        const minHY = Math.min(...hLines.map((h) => h.cy));
        const maxHY = Math.max(...hLines.map((h) => h.cy));
        if (maxVX - minVX >= 20 && maxHY - minHY >= 20) {
          const tolSpanX = Math.max(12, (maxVX - minVX) * 0.18);
          const tolSpanY = Math.max(12, (maxHY - minHY) * 0.18);
          const spanningH = hLines.filter((hl) => hl.minX <= minVX + tolSpanX && hl.maxX >= maxVX - tolSpanX);
          const spanningV = vLines.filter((vl) => vl.minY <= minHY + tolSpanY && vl.maxY >= maxHY - tolSpanY);
          if (spanningH.length >= 2 && spanningV.length >= 2) {
            let intersections = 0;
            for (const hl of spanningH) {
              for (const vl of spanningV) {
                if (vl.cx >= hl.minX - 8 && vl.cx <= hl.maxX + 8 && hl.cy >= vl.minY - 8 && hl.cy <= vl.maxY + 8) {
                  intersections++;
                }
              }
            }
            if (intersections >= 4) {
              return false;
            }
          }
        }
      }
    }

    // Multi-stroke letters (like E with 4 lines, A with 3 lines, H with 3 lines):
    if (strokes.length >= 2) {
      return true;
    }

    const recognizedChar = fullText.trim();
    if (
      recognizedChar === "E" ||
      recognizedChar === "F" ||
      recognizedChar === "H" ||
      recognizedChar === "A" ||
      recognizedChar === "T" ||
      recognizedChar === "t" ||
      recognizedChar === "i" ||
      recognizedChar === "j" ||
      recognizedChar === "X" ||
      recognizedChar === "K" ||
      recognizedChar === "Y" ||
      recognizedChar === "S" ||
      recognizedChar === "C" ||
      recognizedChar === "U" ||
      recognizedChar === "V" ||
      recognizedChar === "W" ||
      recognizedChar === "M" ||
      recognizedChar === "N" ||
      recognizedChar === "Z"
    ) {
      return true;
    }

    if (recognizedChar.length >= 2) {
      return true;
    }

    return true;
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

export const defaultHandwrittenFontDetector = new HandwrittenFontDetector();
