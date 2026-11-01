import { defaultHandwrittenFontDetector, HandwrittenFontDetector } from "../src/domain/services/HandwrittenFontDetector";
import { Stroke, StrokePoint } from "../src/domain/services/ShapeRecognizer";
import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { defaultShapeRegistry } from "../src/presentation/renderer/ShapeRegistry";

// Headless MockElement for testing renderer & DOM events
class MockElement {
  tagName: string;
  className: string = "";
  classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => {
      cls.forEach((c) => c && c.split(" ").forEach((k) => k && this.classList.classes.add(k)));
      this.className = Array.from(this.classList.classes).join(" ");
    },
    remove: (...cls: string[]) => {
      cls.forEach((c) => c && c.split(" ").forEach((k) => k && this.classList.classes.delete(k)));
      this.className = Array.from(this.classList.classes).join(" ");
    },
    contains: (c: string) => this.classList.classes.has(c),
  };
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  listeners: Record<string, ((e: any) => void)[]> = {};

  constructor(tagName: string, options?: any) {
    this.tagName = tagName.toUpperCase();
    if (options?.cls) this.classList.add(options.cls);
    if (options?.text) this.textContent = options.text;
    if (options?.attr) {
      for (const [k, v] of Object.entries(options.attr)) {
        this.attributes[k] = String(v);
      }
    }
  }

  createSvg(tag: string, options?: any): MockElement {
    const el = new MockElement(tag, options);
    this.appendChild(el);
    return el;
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") this.classList.add(...value.split(" "));
  }

  setAttributeNS(_ns: any, name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") this.classList.add(...value.split(" "));
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  private _textContent: string = "";
  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map((c) => c.textContent).join("");
  }
  set textContent(val: string) {
    this._textContent = val;
    if (val === "") this.children = [];
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const check = (el: MockElement) => {
      let matches = false;
      if (selector.startsWith(".")) {
        const classes = selector.split(".").filter(Boolean);
        if (classes.every((c) => el.classList.contains(c))) matches = true;
      } else if (selector.includes("[") && selector.includes("]")) {
        const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)\*?=["']?([^"'\]]+)["']?\]/);
        if (attrMatch) {
          const val = attrMatch[2];
          const actual = el.getAttribute(attrMatch[1]) || "";
          if (actual === val || actual.includes(val)) matches = true;
        }
      } else if (selector.toLowerCase() === el.tagName.toLowerCase()) {
        matches = true;
      }
      if (matches) results.push(el);
      el.children.forEach(check);
    };
    this.children.forEach(check);
    return results;
  }
}

// Set up mock DOM
(global as any).document = {
  createElementNS: (_ns: string, tag: string) => new MockElement(tag),
  createElement: (tag: string) => new MockElement(tag),
};

// Helpers to construct realistic strokes
function makeStraightStroke(x1: number, y1: number, x2: number, y2: number, id: string = "strk"): Stroke {
  const steps = 10;
  const points: StrokePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: Math.round((x1 + t * (x2 - x1)) * 10) / 10,
      y: Math.round((y1 + t * (y2 - y1)) * 10) / 10,
    });
  }
  return { id, points };
}

function makeArcStroke(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startAngle: number,
  endAngle: number,
  id: string = "arc"
): Stroke {
  const steps = 20;
  const points: StrokePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + (i / steps) * (endAngle - startAngle);
    points.push({
      x: Math.round((cx + rx * Math.cos(angle)) * 10) / 10,
      y: Math.round((cy + ry * Math.sin(angle)) * 10) / 10,
    });
  }
  return { id, points };
}

/**
 * Letter 'E' composed of 4 lines:
 * 1 vertical stem + 3 horizontal bars (top, mid, bottom)
 */
function makeEStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h, "E-stem"),
    makeStraightStroke(x, y, x + w, y, "E-top"),
    makeStraightStroke(x, y + h / 2, x + w * 0.8, y + h / 2, "E-mid"),
    makeStraightStroke(x, y + h, x + w, y + h, "E-bot"),
  ];
}

/**
 * Letter 'A' composed of 3 lines:
 * Left diagonal, right diagonal, horizontal crossbar
 */
function makeAStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y + h, x + w / 2, y, "A-diag-left"),
    makeStraightStroke(x + w / 2, y, x + w, y + h, "A-diag-right"),
    makeStraightStroke(x + w * 0.2, y + h * 0.6, x + w * 0.8, y + h * 0.6, "A-crossbar"),
  ];
}

/**
 * Letter 'H' composed of 3 lines:
 * 2 vertical stems + 1 horizontal crossbar
 */
function makeHStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h, "H-stem-left"),
    makeStraightStroke(x + w, y, x + w, y + h, "H-stem-right"),
    makeStraightStroke(x, y + h / 2, x + w, y + h / 2, "H-crossbar"),
  ];
}

/**
 * Letter 'F' composed of 3 lines:
 * 1 vertical stem + 2 horizontal bars (top, mid)
 */
function makeFStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h, "F-stem"),
    makeStraightStroke(x, y, x + w, y, "F-top"),
    makeStraightStroke(x, y + h / 2, x + w * 0.75, y + h / 2, "F-mid"),
  ];
}

/**
 * Letter 'T' composed of 2 lines:
 * 1 top horizontal bar + 1 vertical stem
 */
function makeTStrokes(x: number, y: number, w = 26, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x + w, y, "T-top"),
    makeStraightStroke(x + w / 2, y, x + w / 2, y + h, "T-stem"),
  ];
}

/**
 * Letter 'L' composed of 2 lines:
 * 1 vertical stem + 1 bottom horizontal bar
 */
function makeLStrokes(x: number, y: number, w = 22, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h, "L-stem"),
    makeStraightStroke(x, y + h, x + w, y + h, "L-bot"),
  ];
}

/**
 * Letter 'X' composed of 2 diagonal lines
 */
function makeXStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x + w, y + h, "X-backslash"),
    makeStraightStroke(x + w, y, x, y + h, "X-slash"),
  ];
}

/**
 * Letter 'i' composed of 2 strokes:
 * 1 vertical short stem + 1 dot above
 */
function makeIStrokes(x: number, y: number, w = 6, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y + 10, x, y + h, "i-stem"),
    makeStraightStroke(x, y, x + 1, y + 1, "i-dot"),
  ];
}

/**
 * Letter 'O' composed of 1 closed circular stroke
 */
function makeOStroke(x: number, y: number, w = 24, h = 32): Stroke {
  return makeArcStroke(x + w / 2, y + h / 2, w / 2, h / 2, 0, Math.PI * 2, "O-loop");
}

/**
 * Letter 'C' composed of 1 open counter-clockwise arc
 */
function makeCStroke(x: number, y: number, w = 24, h = 32): Stroke {
  const points: StrokePoint[] = [
    { x: x + w, y: y + h * 0.15 },
    { x: x + w * 0.65, y: y },
    { x: x + w * 0.25, y: y + h * 0.1 },
    { x: x, y: y + h * 0.35 },
    { x: x, y: y + h * 0.65 },
    { x: x + w * 0.25, y: y + h * 0.9 },
    { x: x + w * 0.65, y: y + h },
    { x: x + w, y: y + h * 0.85 },
  ];
  return { id: "C-curve", points };
}

function makeBStrokes(x: number, y: number, w = 22, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h, "B-stem"),
    makeArcStroke(x, y + h * 0.25, w * 0.9, h * 0.25, -Math.PI / 2, Math.PI / 2, "B-top"),
    makeArcStroke(x, y + h * 0.75, w, h * 0.25, -Math.PI / 2, Math.PI / 2, "B-bot"),
  ];
}

function makeNStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h, "N-left"),
    makeStraightStroke(x + w, y, x + w, y + h, "N-right"),
    makeStraightStroke(x, y, x + w, y + h, "N-diag"),
  ];
}

function makeKStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h, "K-stem"),
    makeStraightStroke(x, y + h / 2, x + w, y, "K-arm"),
    makeStraightStroke(x, y + h / 2, x + w, y + h, "K-leg"),
  ];
}

function makeYStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x + w / 2, y + h / 2, "Y-diag-left"),
    makeStraightStroke(x + w, y, x + w / 2, y + h / 2, "Y-diag-right"),
    makeStraightStroke(x + w / 2, y + h / 2, x + w / 2, y + h, "Y-stem"),
  ];
}

function makeZStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x + w, y, "Z-top"),
    makeStraightStroke(x + w, y, x, y + h, "Z-diag"),
    makeStraightStroke(x, y + h, x + w, y + h, "Z-bot"),
  ];
}

function makeMStrokes(x: number, y: number, w = 28, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h, "M-left"),
    makeStraightStroke(x + w, y, x + w, y + h, "M-right"),
    makeStraightStroke(x, y, x + w / 2, y + h * 0.8, "M-diag-left"),
    makeStraightStroke(x + w / 2, y + h * 0.8, x + w, y, "M-diag-right"),
  ];
}

function makeWStrokes(x: number, y: number, w = 28, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x + w * 0.25, y + h, "W-1"),
    makeStraightStroke(x + w * 0.25, y + h, x + w * 0.5, y + h * 0.2, "W-2"),
    makeStraightStroke(x + w * 0.5, y + h * 0.2, x + w * 0.75, y + h, "W-3"),
    makeStraightStroke(x + w * 0.75, y + h, x + w, y, "W-4"),
  ];
}

function makeDStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h, "D-stem"),
    makeArcStroke(x, y + h / 2, w, h / 2, -Math.PI / 2, Math.PI / 2, "D-arc"),
  ];
}

function makePStrokes(x: number, y: number, w = 22, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h, "P-stem"),
    makeArcStroke(x, y + h * 0.25, w * 0.9, h * 0.25, -Math.PI / 2, Math.PI / 2, "P-loop"),
  ];
}

function makeRStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h, "R-stem"),
    makeArcStroke(x, y + h * 0.25, w * 0.85, h * 0.25, -Math.PI / 2, Math.PI / 2, "R-loop"),
    makeStraightStroke(x + w * 0.4, y + h * 0.5, x + w, y + h, "R-leg"),
  ];
}

function makeExclamationStrokes(x: number, y: number, w = 6, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h * 0.75, "excl-stem"),
    makeStraightStroke(x, y + h - 2, x + 1, y + h - 1, "excl-dot"),
  ];
}

function makeQuestionStrokes(x: number, y: number, w = 18, h = 32): Stroke[] {
  return [
    makeArcStroke(x + w / 2, y + h * 0.25, w / 2, h * 0.25, -Math.PI, 0, "q-hook"),
    makeStraightStroke(x + w / 2, y + h - 2, x + w / 2 + 1, y + h - 1, "q-dot"),
  ];
}

function makeColonStrokes(x: number, y: number, w = 6, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y + h * 0.25, x + 1, y + h * 0.25 + 1, "colon-top"),
    makeStraightStroke(x, y + h * 0.75, x + 1, y + h * 0.75 + 1, "colon-bot"),
  ];
}

function makeEqualStrokes(x: number, y: number, w = 20, h = 16): Stroke[] {
  return [
    makeStraightStroke(x, y, x + w, y, "eq-top"),
    makeStraightStroke(x, y + h, x + w, y + h, "eq-bot"),
  ];
}

function makePlusStrokes(x: number, y: number, w = 20, h = 20): Stroke[] {
  return [
    makeStraightStroke(x, y + h / 2, x + w, y + h / 2, "plus-horiz"),
    makeStraightStroke(x + w / 2, y, x + w / 2, y + h, "plus-vert"),
  ];
}

describe("Handwritten Font Detection System", () => {
  let detector: HandwrittenFontDetector;

  beforeEach(() => {
    detector = new HandwrittenFontDetector();
  });

  describe("1. Multi-component letter clustering (Issue #1)", () => {
    it("should recognize 'E' containing 4 lines as a single letter E, not 4 separate letters", () => {
      const eStrokes = makeEStrokes(50, 50, 24, 32);
      expect(eStrokes.length).toBe(4);

      const result = detector.detect(eStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("E");
      expect(result.text).toBe("E");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      expect(result.fontFamily).toBe("handwritten");
    });

    it("should recognize 'A' containing 3 lines as a single letter A", () => {
      const aStrokes = makeAStrokes(50, 50, 24, 32);
      expect(aStrokes.length).toBe(3);

      const result = detector.detect(aStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("A");
      expect(result.text).toBe("A");
    });

    it("should recognize 'H' containing 3 lines as a single letter H", () => {
      const hStrokes = makeHStrokes(50, 50, 24, 32);
      expect(hStrokes.length).toBe(3);

      const result = detector.detect(hStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("H");
      expect(result.text).toBe("H");
    });

    it("should recognize 'F' containing 3 lines as a single letter F", () => {
      const fStrokes = makeFStrokes(50, 50, 24, 32);
      expect(fStrokes.length).toBe(3);

      const result = detector.detect(fStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("F");
      expect(result.text).toBe("F");
    });

    it("should recognize 'T' containing 2 lines as a single letter T", () => {
      const tStrokes = makeTStrokes(50, 50, 24, 32);
      expect(tStrokes.length).toBe(2);

      const result = detector.detect(tStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("T");
      expect(result.text).toBe("T");
    });

    it("should recognize 'X' containing 2 diagonal lines as a single letter X", () => {
      const xStrokes = makeXStrokes(50, 50, 24, 32);
      expect(xStrokes.length).toBe(2);

      const result = detector.detect(xStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("X");
      expect(result.text).toBe("X");
    });

    it("should recognize 'i' containing stem and dot as a single letter i", () => {
      const iStrokes = makeIStrokes(50, 50, 6, 32);
      expect(iStrokes.length).toBe(2);

      const result = detector.detect(iStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("i");
      expect(result.text).toBe("i");
    });

    it("should recognize 'L' containing 2 lines as a single letter L", () => {
      const lStrokes = makeLStrokes(50, 50, 22, 32);
      expect(lStrokes.length).toBe(2);

      const result = detector.detect(lStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("L");
      expect(result.text).toBe("L");
    });

    it("should recognize 'M' containing 4 lines as a single letter M", () => {
      const mStrokes = makeMStrokes(50, 50, 28, 32);
      const result = detector.detect(mStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("M");
    });

    it("should recognize 'W' containing 4 diagonal lines as a single letter W", () => {
      const wStrokes = makeWStrokes(50, 50, 28, 32);
      const result = detector.detect(wStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("W");
    });

    it("should recognize 'N' containing 3 lines as a single letter N", () => {
      const nStrokes = makeNStrokes(50, 50, 24, 32);
      const result = detector.detect(nStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("N");
    });

    it("should recognize 'K' containing 3 lines as a single letter K", () => {
      const kStrokes = makeKStrokes(50, 50, 24, 32);
      const result = detector.detect(kStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("K");
    });

    it("should recognize 'Y' containing 3 lines as a single letter Y", () => {
      const yStrokes = makeYStrokes(50, 50, 24, 32);
      const result = detector.detect(yStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("Y");
    });

    it("should recognize 'Z' containing 3 lines as a single letter Z", () => {
      const zStrokes = makeZStrokes(50, 50, 24, 32);
      const result = detector.detect(zStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("Z");
    });

    it("should recognize 'D' containing 2 lines as a single letter D", () => {
      const dStrokes = makeDStrokes(50, 50, 24, 32);
      const result = detector.detect(dStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("D");
    });

    it("should recognize 'P' containing 2 lines as a single letter P", () => {
      const pStrokes = makePStrokes(50, 50, 22, 32);
      const result = detector.detect(pStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("P");
    });

    it("should recognize 'R' containing 3 lines as a single letter R", () => {
      const rStrokes = makeRStrokes(50, 50, 24, 32);
      const result = detector.detect(rStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("R");
    });

    it("should recognize '!' containing stem and dot as a single exclamation mark", () => {
      const exclStrokes = makeExclamationStrokes(50, 50, 6, 32);
      const result = detector.detect(exclStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("!");
    });

    it("should recognize '?' containing hook and dot as a single question mark", () => {
      const qStrokes = makeQuestionStrokes(50, 50, 18, 32);
      const result = detector.detect(qStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("?");
    });

    it("should recognize ':' containing two dots as a colon", () => {
      const colonStrokes = makeColonStrokes(50, 50, 6, 32);
      const result = detector.detect(colonStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe(":");
    });

    it("should recognize '=' containing two parallel lines as an equals sign", () => {
      const eqStrokes = makeEqualStrokes(50, 50, 20, 16);
      const result = detector.detect(eqStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("=");
    });

    it("should recognize '+' containing intersecting lines as a plus sign", () => {
      const plusStrokes = makePlusStrokes(50, 50, 20, 20);
      const result = detector.detect(plusStrokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(1);
      expect(result.characters[0].char).toBe("+");
    });
  });

  describe("2. Word recognition without squashing to a single letter", () => {
    it("should recognize word 'HELLO' composed of multi-stroke letters without making it a single letter", () => {
      // H (3) + E (4) + L (2) + L (2) + O (1) = 12 strokes
      const strokes: Stroke[] = [
        ...makeHStrokes(20, 50, 20, 30),
        ...makeEStrokes(50, 50, 20, 30),
        ...makeLStrokes(80, 50, 18, 30),
        ...makeLStrokes(108, 50, 18, 30),
        makeOStroke(136, 50, 20, 30),
      ];

      const result = detector.detect(strokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(5);
      expect(result.words.length).toBe(1);
      expect(result.words[0].text).toBe("HELLO");
      expect(result.text).toBe("HELLO");
      expect(result.fontFamily).toBe("handwritten");
    });

    it("should recognize word 'CAT' correctly into 3 characters, not a single letter", () => {
      const strokes: Stroke[] = [
        makeCStroke(20, 50, 20, 30),
        ...makeAStrokes(50, 50, 20, 30),
        ...makeTStrokes(80, 50, 22, 30),
      ];

      const result = detector.detect(strokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(3);
      expect(result.characters[0].char).toBe("C");
      expect(result.characters[1].char).toBe("A");
      expect(result.characters[2].char).toBe("T");
      expect(result.words[0].text).toBe("CAT");
      expect(result.text).toBe("CAT");
    });

    it("should recognize word 'FIT' correctly with 3-stroke F, 2-stroke i, and 2-stroke T", () => {
      const strokes: Stroke[] = [
        ...makeFStrokes(20, 50, 20, 30),
        ...makeIStrokes(50, 50, 6, 30),
        ...makeTStrokes(66, 50, 22, 30),
      ];

      const result = detector.detect(strokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(3);
      expect(result.characters[0].char).toBe("F");
      expect(result.characters[1].char).toBe("i");
      expect(result.characters[2].char).toBe("T");
      expect(result.words[0].text).toBe("FiT");
    });

    it("should recognize word 'II' as two separate 'I' characters, not squashed into 'T' or 1 letter", () => {
      const strokes: Stroke[] = [
        makeStraightStroke(20, 50, 20, 80, "I-1"),
        makeStraightStroke(27, 50, 27, 80, "I-2"),
      ];

      const result = detector.detect(strokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(2);
      expect(result.characters[0].char).toBe("I");
      expect(result.characters[1].char).toBe("I");
      expect(result.words.length).toBe(1);
      expect(result.words[0].text).toBe("II");
    });

    it("should recognize multi-stroke word 'END' (E:4, N:3, D:2) without squashing", () => {
      const strokes: Stroke[] = [
        ...makeEStrokes(20, 50, 20, 30),
        ...makeNStrokes(48, 50, 20, 30),
        ...makeDStrokes(76, 50, 20, 30),
      ];

      const result = detector.detect(strokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(3);
      expect(result.characters[0].char).toBe("E");
      expect(result.characters[1].char).toBe("N");
      expect(result.characters[2].char).toBe("D");
      expect(result.words[0].text).toBe("END");
    });

    it("should recognize word with exclamation mark 'HI!'", () => {
      const strokes: Stroke[] = [
        ...makeHStrokes(20, 50, 20, 30),
        makeStraightStroke(48, 50, 48, 80, "I-stem"),
        ...makeExclamationStrokes(56, 50, 6, 30),
      ];

      const result = detector.detect(strokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(3);
      expect(result.characters[0].char).toBe("H");
      expect(result.characters[1].char).toBe("I");
      expect(result.characters[2].char).toBe("!");
      expect(result.words[0].text).toBe("HI!");
    });
  });

  describe("3. Sentence and multi-word detection with spaces", () => {
    it("should recognize mathematical expression with spaces 'A + B = C'", () => {
      const strokes: Stroke[] = [
        ...makeAStrokes(20, 50, 18, 30),
        ...makePlusStrokes(50, 55, 16, 20),
        ...makeBStrokes(80, 50, 18, 30),
        ...makeEqualStrokes(110, 58, 16, 14),
        makeCStroke(140, 50, 18, 30),
      ];

      const result = detector.detect(strokes);

      expect(result.isText).toBe(true);
      expect(result.characters.length).toBe(5);
      expect(result.text).toBe("A + B = C");
    });
    it("should detect inter-word space and produce sentence 'HELLO WORLD'", () => {
      const helloStrokes: Stroke[] = [
        ...makeHStrokes(20, 50, 20, 30),
        ...makeEStrokes(50, 50, 20, 30),
        ...makeLStrokes(80, 50, 18, 30),
        ...makeLStrokes(108, 50, 18, 30),
        makeOStroke(136, 50, 20, 30),
      ];

      // Leave a wide gap between 'HELLO' and 'IEL' (40px gap, where character gap is ~8px)
      const worldStrokes: Stroke[] = [
        makeStraightStroke(196, 50, 196, 80, "W1"),
        ...makeEStrokes(206, 50, 20, 30),
        ...makeLStrokes(234, 50, 18, 30),
      ];

      const result = detector.detect([...helloStrokes, ...worldStrokes]);

      expect(result.isText).toBe(true);
      expect(result.words.length).toBe(2);
      expect(result.words[0].text).toBe("HELLO");
      expect(result.words[1].text).toBe("IEL");
      expect(result.text).toContain(" ");
      expect(result.text).toBe("HELLO IEL");
    });

    it("should detect multi-line sentences separated by newlines", () => {
      const line1: Stroke[] = [
        makeCStroke(20, 40, 20, 28),
        ...makeAStrokes(50, 40, 20, 28),
        ...makeTStrokes(80, 40, 20, 28),
      ];

      // Line 2 at y = 110 (distinct vertical separation)
      const line2: Stroke[] = [
        ...makeFStrokes(20, 110, 20, 28),
        ...makeIStrokes(50, 110, 6, 28),
        ...makeTStrokes(66, 110, 20, 28),
      ];

      const result = detector.detect([...line1, ...line2]);

      expect(result.isText).toBe(true);
      expect(result.lines.length).toBe(2);
      expect(result.lines[0].text).toBe("CAT");
      expect(result.lines[1].text).toBe("FiT");
      expect(result.text).toBe("CAT\nFiT");
    });
  });

  describe("4. Font styling and size estimation", () => {
    it("should set font family to 'handwritten'", () => {
      const strokes = makeEStrokes(100, 100, 24, 32);
      const result = detector.detect(strokes);

      expect(result.fontFamily).toBe("handwritten");
    });

    it("should estimate font size according to stroke height", () => {
      // 20px tall handwriting
      const smallStrokes = makeEStrokes(50, 50, 15, 20);
      const smallResult = detector.detect(smallStrokes);
      expect(smallResult.estimatedFontSize).toBeLessThanOrEqual(20);
      expect(smallResult.estimatedFontSize).toBeGreaterThanOrEqual(14);

      // 40px tall handwriting
      const largeStrokes = makeEStrokes(50, 50, 30, 40);
      const largeResult = detector.detect(largeStrokes);
      expect(largeResult.estimatedFontSize).toBeGreaterThan(smallResult.estimatedFontSize);
    });
  });

  describe("5. DiagramEditor Integration (enhanceStrokes & enhanceSelection)", () => {
    let editor: DiagramEditor;

    beforeEach(() => {
      editor = new DiagramEditor(createDiagram({ id: "diag-font-test", diagramType: "general" }));
    });

    it("recognizeHandwrittenText should be available on DiagramEditor", () => {
      const strokes = makeEStrokes(50, 50, 20, 30);
      const res = editor.recognizeHandwrittenText(strokes);

      expect(res).toBeDefined();
      expect(res.text).toBe("E");
      expect(res.isText).toBe(true);
    });

    it("enhanceStrokes should create a generic.text node with handwritten font styling", () => {
      const strokes = [
        makeCStroke(20, 50, 20, 30),
        ...makeAStrokes(50, 50, 20, 30),
        ...makeTStrokes(80, 50, 22, 30),
      ];

      const node = editor.enhanceStrokes(strokes) as any;

      expect(node).not.toBeNull();
      expect(node.kind).toBe("generic.text");
      expect(node.labels[0].text).toBe("CAT");
      expect(node.style?.fontFamily).toBe("handwritten");
    });

    it("enhanceSelection should replace selected freehand strokes with recognized text node", () => {
      // User drew 4 lines of 'E' as separate freehand nodes
      const eStrokes = makeEStrokes(100, 100, 24, 32);
      const freehandNodes = eStrokes.map((s) => editor.addFreehandNode(s));
      expect(editor.diagram.nodes.length).toBe(4);

      // Select all 4 freehand nodes
      editor.selectNodes(freehandNodes.map((n) => n.id));
      expect(editor.selectedNodeIds.length).toBe(4);

      // Execute enhanceSelection
      const enhancedNode = editor.enhanceSelection() as any;

      expect(enhancedNode).not.toBeNull();
      expect(enhancedNode.kind).toBe("generic.text");
      expect(enhancedNode.labels[0].text).toBe("E");
      expect(enhancedNode.style?.fontFamily).toBe("handwritten");

      // The 4 original freehand nodes were removed and replaced by the 1 text node
      expect(editor.diagram.nodes.length).toBe(1);
      expect(editor.diagram.nodes[0].id).toBe(enhancedNode.id);
    });

    it("should support undo and redo on enhanceSelection", () => {
      const eStrokes = makeEStrokes(100, 100, 24, 32);
      const freehandNodes = eStrokes.map((s) => editor.addFreehandNode(s));
      editor.selectNodes(freehandNodes.map((n) => n.id));

      const enhancedNode = editor.enhanceSelection() as any;
      expect(editor.diagram.nodes.length).toBe(1);

      // Undo -> restores the 4 original freehand nodes
      editor.undo();
      expect(editor.diagram.nodes.length).toBe(4);
      expect(editor.diagram.nodes.every((n) => n.kind === "generic.freehand")).toBe(true);

      // Redo -> replaces them again with the single enhanced text node
      editor.redo();
      expect(editor.diagram.nodes.length).toBe(1);
      expect(editor.diagram.nodes[0].id).toBe(enhancedNode?.id);
      expect(editor.diagram.nodes[0].kind).toBe("generic.text");
    });
  });

  describe("6. ShapeRegistry rendering for generic.text", () => {
    it("should render generic.text cleanly with transparent hitbox and SVG text elements", () => {
      const shapeDef = defaultShapeRegistry.get("generic.text");
      expect(shapeDef).toBeDefined();

      const textNode = {
        id: "text-node-1",
        kind: "generic.text",
        position: { x: 50, y: 50 },
        size: { width: 120, height: 40 },
        ports: [],
        labels: [{ id: "l1", text: "HELLO WORLD", anchor: "node" as const, position: { x: 0, y: 0 } }],
        style: { fontFamily: "handwritten", fontSize: 18 },
        metadata: {},
      };

      const svgEl = shapeDef.renderSvg(textNode as any, { isSelected: false });
      expect(svgEl).not.toBeNull();

      const hitbox = (svgEl as any).querySelector(".umlcanvas-text-hitbox");
      expect(hitbox).not.toBeNull();
      expect(hitbox?.getAttribute("fill")).toBe("transparent");

      const textBody = (svgEl as any).querySelector(".umlcanvas-text-body");
      expect(textBody).not.toBeNull();
      expect(textBody?.textContent).toBe("HELLO WORLD");
    });
  });

  describe("7. Discarding micro-blobs and non-text shapes", () => {
    it("should return isText false for tiny micro-blobs", () => {
      const microStroke: Stroke = {
        id: "micro",
        points: [
          { x: 10, y: 10 },
          { x: 12, y: 12 },
        ],
      };
      const result = detector.detect(microStroke);
      expect(result.isText).toBe(false);
    });

    it("should distinguish a large geometric rectangle from handwriting", () => {
      // 100x80 clean closed rectangle
      const rectPoints: StrokePoint[] = [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
        { x: 110, y: 90 },
        { x: 10, y: 90 },
        { x: 10, y: 10 },
      ];
      const rectStroke: Stroke = { id: "box", points: rectPoints };

      const result = detector.detect(rectStroke);
      expect(result.isText).toBe(false);
    });
  });
});
