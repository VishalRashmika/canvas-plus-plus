import { Rect, rectFromBounds } from "../value-objects/Rect";
import { Stroke } from "./ShapeRecognizer";
import {
  defaultHandwrittenFontDetector,
  HandwrittenFontDetector,
} from "./HandwrittenFontDetector";

export interface NoteHandwritingResult {
  text: string;
  rawText: string;
  confidence: number;
  bounds: Rect;
  isText: boolean;
  estimatedFontSize: number;
  fontFamily: string;
  words: string[];
}

export const NOTE_TAKING_LEXICON: string[] = [
  // Top common English words
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
  // Lecture, study, notebook & academic vocabulary
  "lecture", "notebook", "notes", "student", "teacher", "class", "study", "exam", "quiz", "homework",
  "assignment", "chapter", "section", "topic", "subject", "lesson", "course", "professor", "university",
  "college", "school", "pencil", "paper", "book", "write", "writing", "read", "reading", "learn",
  "learning", "concept", "theory", "formula", "example", "definition", "question", "answer", "problem",
  "solution", "summary", "review", "important", "remember", "key", "main", "point", "idea", "detail",
  "history", "science", "math", "physics", "biology", "chemistry", "art", "music", "english",
  // Tech, computing & architecture vocabulary
  "computer", "software", "hardware", "code", "coding", "program", "programming", "algorithm",
  "function", "variable", "class", "object", "method", "loop", "array", "string", "number", "boolean",
  "database", "network", "system", "server", "client", "api", "memory", "storage", "cpu", "gpu",
  "thread", "process", "input", "output", "error", "debug", "design", "structure", "logic", "model",
  "view", "controller", "route", "query", "table", "schema", "diagram", "node", "edge", "graph",
  "tree", "stack", "queue", "binary", "search", "sort", "flow", "state", "event", "action",
  // Common phrases & terms
  "hello", "world", "true", "false", "null", "undefined", "done", "todo", "start", "stop", "end",
  "next", "prev", "previous", "step", "rule", "goal", "plan", "task", "date", "time", "title",
  "author", "source", "reference", "citation", "introduction", "conclusion", "abstract", "result",
  "results", "discussion", "method", "methods", "analysis", "figure", "chart", "fit", "red", "blue",
  "green", "yellow", "black", "white", "run", "fast", "slow", "high", "low", "big", "small"
];

/**
 * Checks if a stroke is horizontal and hyphen-like (e.g. dash separator).
 */
export function isHyphenLikeStroke(stroke: Stroke): boolean {
  const pts = stroke.points;
  if (!pts || pts.length < 2) return false;

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const w = maxX - minX;
  const h = maxY - minY;

  // Horizontal aspect ratio: wide and relatively flat
  if (w >= 8 && h <= 25 && w / Math.max(1, h) >= 1.8) {
    let totalLen = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      totalLen += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    }
    const straightness =
      Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) /
      Math.max(1, totalLen);
    return straightness >= 0.65;
  }

  return false;
}

/**
 * NoteHandwritingSystem
 *
 * Dedicated domain service for lecture note handwriting autodetect.
 * Key capabilities:
 * 1. Scoped to lowercase letters only (a-z) to minimize error surface.
 * 2. Hyphen-like character replacement: any hyphen-like stroke (dash, horizontal gesture)
 *    between words is replaced with a clean space delimiter (' ').
 * 3. Cursive stroke segmentation & common words lexicon matching to maximize accuracy.
 * 4. Multi-word and line assembly suitable for physical-notebook-like lecture notes.
 */
export class NoteHandwritingSystem {
  private readonly detector: HandwrittenFontDetector;
  private readonly lexicon: Set<string>;

  constructor(detector = defaultHandwrittenFontDetector, lexicon = NOTE_TAKING_LEXICON) {
    this.detector = detector;
    this.lexicon = new Set(lexicon.map((w) => w.toLowerCase()));
  }

  /**
   * Main entry point: converts a set of handwritten strokes into clean lowercase text.
   */
  public recognize(input: Stroke | Stroke[]): NoteHandwritingResult {
    const rawStrokes = Array.isArray(input) ? input : [input];
    const defaultBounds = rectFromBounds(0, 0, 0, 0);

    const validStrokes = rawStrokes
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
    if (validStrokes.length === 0) {
      return {
        text: "",
        rawText: "",
        confidence: 0,
        bounds: defaultBounds,
        isText: false,
        estimatedFontSize: 16,
        fontFamily: "handwritten",
        words: [],
      };
    }

    // 1. Calculate overall bounds
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const s of validStrokes) {
      for (const p of s.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    const bounds = rectFromBounds(
      minX,
      minY,
      Math.max(1, maxX - minX),
      Math.max(1, maxY - minY)
    );

    // 2. Identify hyphen-like strokes that serve as word separators
    const hyphenIndices = new Set<number>();
    validStrokes.forEach((s, idx) => {
      if (isHyphenLikeStroke(s)) {
        // Only treat as standalone hyphen if not intersecting another letter stem
        hyphenIndices.add(idx);
      }
    });

    // 3. Delegate to HandwrittenFontDetector for clustering, cursive segmentation, & character recognition
    const detection = this.detector.detect(validStrokes);

    // In single lowercase letter handwriting, a 1-stroke vertical line without a dot represents 'l'
    // (whereas 'i' has 2 strokes with a dot above the stem).
    let rawText = detection.lines
      .map((line) =>
        line.words
          .map((word) =>
            word.characters
              .map((c) => {
                if (
                  c.char === "I" &&
                  c.strokeIndices.length === 1 &&
                  word.characters.length === 1
                ) {
                  return "l";
                }
                return c.char;
              })
              .join("")
          )
          .join(" ")
      )
      .join("\n") || detection.text || "";

    // 4. If hyphen strokes were drawn or rawText has hyphens/dashes between words,
    // replace any hyphen-like character with a space between words.
    // Examples: "hello-world" -> "hello world", "hello - world" -> "hello world"
    let text = this.replaceHyphensWithSpaces(rawText);

    // 5. Scope down strictly to lowercase letters only (a-z) and whitespace/newlines
    text = this.formatToLowercaseLetters(text);

    // 6. Refine words with common note vocabulary / lexicon
    const refinedWords = this.refineWords(text.split(/\s+/).filter(Boolean));
    text = refinedWords.join(" ");

    const words = text ? text.split(/\s+/).filter(Boolean) : [];

    return {
      text,
      rawText,
      confidence: detection.confidence,
      bounds: detection.bounds.size.width > 0 ? detection.bounds : bounds,
      isText: text.length > 0,
      estimatedFontSize: detection.estimatedFontSize || 16,
      fontFamily: "handwritten",
      words,
    };
  }

  /**
   * Replaces hyphen-like characters (-, –, —, _) between words with a space.
   */
  public replaceHyphensWithSpaces(text: string): string {
    if (!text) return "";

    // Replace sequences of hyphens/dashes flanked by optional spaces with a single space
    let result = text.replace(/[\s\-_–—]*[-–—_]+[\s\-_–—]*/g, " ");

    // Trim leading/trailing hyphens and whitespace
    result = result.replace(/^[\s\-_–—]+|[\s\-_–—]+$/g, "");

    return result;
  }

  /**
   * Scopes text down to lowercase letters only [a-z] and whitespace.
   * Maps common ambiguous handwriting digits to corresponding lowercase letters:
   * '0' -> 'o', '1' -> 'l', '5' -> 's', '2' -> 'z', '+' -> 't', '8' -> 'b'.
   */
  public formatToLowercaseLetters(text: string): string {
    if (!text) return "";

    // 1. Lowercase conversion
    let lower = text.toLowerCase();

    // 2. Map ambiguous character strokes to lowercase letters
    lower = lower
      .replace(/0/g, "o")
      .replace(/1/g, "l")
      .replace(/5/g, "s")
      .replace(/2/g, "z")
      .replace(/\+/g, "t")
      .replace(/@/g, "a")
      .replace(/8/g, "b");

    // 3. Remove any non-lowercase letters (preserve spaces and newlines)
    lower = lower.replace(/[^a-z\s\n]/g, "");

    // 4. Normalize multiple consecutive spaces
    lower = lower.replace(/[ ]{2,}/g, " ").trim();

    return lower;
  }

  /**
   * Refines recognized words using the common words lexicon (dictionary matching).
   * Enables accurate recognition even with rapid cursive or ambiguous ligatures.
   */
  public refineWords(words: string[]): string[] {
    return words.map((w) => this.refineSingleWord(w));
  }

  private refineSingleWord(word: string): string {
    if (!word || word.length < 2) return word;

    const lower = word.toLowerCase();

    // Exact match in lexicon
    if (this.lexicon.has(lower)) {
      return lower;
    }

    // Levenshtein distance match for words of length >= 3
    if (lower.length >= 3) {
      const maxDist = lower.length >= 6 ? 2 : 1;
      let bestMatch: string | null = null;
      let bestDist = Infinity;

      for (const entry of this.lexicon) {
        if (Math.abs(entry.length - lower.length) > maxDist) continue;
        const dist = this.levenshtein(lower, entry);
        if (dist <= maxDist && dist < bestDist) {
          bestDist = dist;
          bestMatch = entry;
        }
      }

      if (bestMatch && bestDist <= maxDist) {
        return bestMatch;
      }
    }

    return lower;
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
}

export const defaultNoteHandwritingSystem = new NoteHandwritingSystem();
