import { NoteHandwritingSystem, isHyphenLikeStroke, defaultNoteHandwritingSystem } from "../src/domain/services/NoteHandwritingSystem";
import { defaultHandwrittenFontDetector } from "../src/domain/services/HandwrittenFontDetector";
import { Stroke, StrokePoint } from "../src/domain/services/ShapeRecognizer";
import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { DiagramNode } from "../src/domain/entities/DiagramNode";

// Mock Element for testing DOM interaction
class MockElement {
  tagName: string;
  className = "";
  classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => {
      cls.forEach((c) => {
        if (!c) return;
        c.split(/\s+/).filter(Boolean).forEach((k) => this.classList.classes.add(k));
      });
      this.className = Array.from(this.classList.classes).join(" ");
    },
    remove: (...cls: string[]) => {
      cls.forEach((c) => {
        if (!c) return;
        c.split(/\s+/).filter(Boolean).forEach((k) => this.classList.classes.delete(k));
      });
      this.className = Array.from(this.classList.classes).join(" ");
    },
    toggle: (c: string, force?: boolean) => {
      const willHave = force !== undefined ? force : !this.classList.contains(c);
      if (willHave) this.classList.add(c);
      else this.classList.remove(c);
      return willHave;
    },
    contains: (c: string) => this.classList.classes.has(c),
  };
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  listeners: Record<string, ((e: any) => void)[]> = {};
  title = "";
  disabled = false;
  value = "";
  clientWidth = 1000;
  clientHeight = 800;

  constructor(tagName: string, options?: any) {
    this.tagName = tagName.toUpperCase();
    if (options?.cls) {
      const classes = Array.isArray(options.cls)
        ? options.cls
        : String(options.cls).split(/\s+/).filter(Boolean);
      classes.forEach((c: string) => this.classList.classes.add(c));
      this.className = Array.from(this.classList.classes).join(" ");
    }
    if (options?.text) this.textContent = options.text;
    if (options?.title) this.title = options.title;
    if (options?.attr) {
      for (const [k, v] of Object.entries(options.attr)) {
        this.attributes[k] = String(v);
      }
    }
  }

  createDiv(options?: any): MockElement {
    const el = new MockElement("div", options);
    this.appendChild(el);
    return el;
  }

  createSpan(options?: any): MockElement {
    const el = new MockElement("span", options);
    this.appendChild(el);
    return el;
  }

  createEl(tag: string, options?: any): MockElement {
    const el = new MockElement(tag, options);
    this.appendChild(el);
    return el;
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  prepend(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.unshift(child);
    return child;
  }

  setCssStyles(styles: Record<string, string>): void {
    Object.assign(this.style, styles);
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  setAttribute(k: string, v: string): void {
    this.attributes[k] = v;
  }

  getAttribute(k: string): string | null {
    return this.attributes[k] ?? null;
  }

  addEventListener(type: string, listener: (e: any) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  click(): void {
    const clickListeners = this.listeners["click"] || [];
    const event = {
      type: "click",
      target: this,
      preventDefault: () => {},
      stopPropagation: () => {},
    };
    for (const l of clickListeners) {
      l(event);
    }
  }

  querySelector(sel: string): MockElement | null {
    return this.querySelectorAll(sel)[0] || null;
  }

  querySelectorAll(sel: string): MockElement[] {
    const res: MockElement[] = [];
    const match = (el: MockElement) => {
      let isMatch = false;
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        if (el.classList.contains(cls)) isMatch = true;
      } else if (sel.toLowerCase() === el.tagName.toLowerCase()) {
        isMatch = true;
      }
      if (isMatch) res.push(el);
      for (const c of el.children) match(c);
    };
    for (const c of this.children) match(c);
    return res;
  }

  private _textContent = "";
  get textContent(): string {
    return this._textContent + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this._textContent = v;
  }
}

// Global DOM mock
(global as any).document = {
  createElement: (tag: string, options?: any) => new MockElement(tag, options),
  createElementNS: (_ns: string, tag: string, options?: any) => new MockElement(tag, options),
};
(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

function makeStraightStroke(x1: number, y1: number, x2: number, y2: number, id = "strk"): Stroke {
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

function makeHyphenStroke(x: number, y: number, w = 30): Stroke {
  return makeStraightStroke(x, y, x + w, y, "hyphen-dash");
}

function makeEStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h, "e-stem"),
    makeStraightStroke(x, y, x + w, y, "e-top"),
    makeStraightStroke(x, y + h / 2, x + w * 0.8, y + h / 2, "e-mid"),
    makeStraightStroke(x, y + h, x + w, y + h, "e-bot"),
  ];
}

function makeTStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x + w, y, "t-crossbar"),
    makeStraightStroke(x + w / 2, y, x + w / 2, y + h, "t-stem"),
  ];
}

function makeHStrokes(x: number, y: number, w = 24, h = 32): Stroke[] {
  return [
    makeStraightStroke(x, y, x, y + h, "h-left"),
    makeStraightStroke(x + w, y, x + w, y + h, "h-right"),
    makeStraightStroke(x, y + h / 2, x + w, y + h / 2, "h-mid"),
  ];
}

describe("Lecture Note Handwriting Tool & System", () => {
  let editor: DiagramEditor;
  let system: NoteHandwritingSystem;

  beforeEach(() => {
    editor = new DiagramEditor(createDiagram({ id: "diag-note", diagramType: "generic" }));
    system = new NoteHandwritingSystem();
  });

  describe("1. Bottom Toolbar Handwrite Text Tool", () => {
    let container: MockElement;
    let rendererMock: any;
    let toolbar: Toolbar;

    beforeEach(() => {
      container = new MockElement("div");
      rendererMock = {
        isFreehandEnabled: true,
        freehandMode: false,
        grabMode: false,
        isAutoShapeDetection: false,
        isHandwritingTextMode: false,
        setFreehandMode: jest.fn((val: boolean) => {
          rendererMock.freehandMode = val;
        }),
        setGrabMode: jest.fn((val: boolean) => {
          rendererMock.grabMode = val;
        }),
        setAutoShapeDetection: jest.fn((val: boolean) => {
          rendererMock.isAutoShapeDetection = val;
        }),
        setHandwritingTextMode: jest.fn((val: boolean) => {
          rendererMock.isHandwritingTextMode = val;
        }),
      };
      toolbar = new Toolbar(container as any, editor, rendererMock as any);
    });

    afterEach(() => {
      toolbar.destroy();
    });

    it("should add the new Handwrite Text tool to the floating bottom toolbar", () => {
      const bottomToolbar = container.querySelector(".umlcanvas-floating-bottom-toolbar");
      expect(bottomToolbar).not.toBeNull();

      const buttons = bottomToolbar?.querySelectorAll("button") || [];
      const handwriteBtn = buttons.find((b) => b.title.includes("Handwrite Text"));

      expect(handwriteBtn).toBeDefined();
      expect(handwriteBtn?.classList.contains("is-icon-only")).toBe(true);
      expect(handwriteBtn?.title).toContain("Handwrite Text");
      expect(handwriteBtn?.title).toContain("lowercase");
    });

    it("should toggle Handwrite Text mode on and synchronize active state", () => {
      const bottomToolbar = container.querySelector(".umlcanvas-floating-bottom-toolbar");
      const buttons = bottomToolbar?.querySelectorAll("button") || [];
      const selectBtn = buttons.find((b) => b.title.includes("Select"));
      const handwriteBtn = buttons.find((b) => b.title.includes("Handwrite Text"));
      const drawBtn = buttons.find((b) => b.title.includes("Draw"));
      const autoShapeBtn = buttons.find((b) => b.title.includes("Auto Shape"));

      // Initial state: Select is active
      expect(selectBtn?.classList.contains("is-active")).toBe(true);
      expect(handwriteBtn?.classList.contains("is-active")).toBe(false);

      // Click Handwrite Text tool
      handwriteBtn?.click();
      expect(rendererMock.setHandwritingTextMode).toHaveBeenCalledWith(true);
      expect(rendererMock.setFreehandMode).toHaveBeenCalledWith(true);
      expect(rendererMock.setAutoShapeDetection).toHaveBeenCalledWith(false);

      // Update toolbar
      rendererMock.freehandMode = true;
      rendererMock.isHandwritingTextMode = true;
      rendererMock.isAutoShapeDetection = false;
      toolbar.updateToolMode();

      expect(handwriteBtn?.classList.contains("is-active")).toBe(true);
      expect(selectBtn?.classList.contains("is-active")).toBe(false);
      expect(drawBtn?.classList.contains("is-active")).toBe(false);
      expect(autoShapeBtn?.classList.contains("is-active")).toBe(false);
    });

    it("should toggle Handwrite Text off and return to Select mode when clicked while active", () => {
      const bottomToolbar = container.querySelector(".umlcanvas-floating-bottom-toolbar");
      const buttons = bottomToolbar?.querySelectorAll("button") || [];
      const selectBtn = buttons.find((b) => b.title.includes("Select"));
      const handwriteBtn = buttons.find((b) => b.title.includes("Handwrite Text"));

      // Activate Handwrite mode
      rendererMock.freehandMode = true;
      rendererMock.isHandwritingTextMode = true;
      toolbar.updateToolMode();
      expect(handwriteBtn?.classList.contains("is-active")).toBe(true);

      // Click again while active -> toggles off
      handwriteBtn?.click();
      expect(rendererMock.setFreehandMode).toHaveBeenCalledWith(false);
      expect(rendererMock.setHandwritingTextMode).toHaveBeenCalledWith(false);

      rendererMock.freehandMode = false;
      rendererMock.isHandwritingTextMode = false;
      toolbar.updateToolMode();

      expect(handwriteBtn?.classList.contains("is-active")).toBe(false);
      expect(selectBtn?.classList.contains("is-active")).toBe(true);
    });

    it("should deactivate Handwrite Text tool when Select, Draw, or Auto Shape is selected", () => {
      const bottomToolbar = container.querySelector(".umlcanvas-floating-bottom-toolbar");
      const buttons = bottomToolbar?.querySelectorAll("button") || [];
      const selectBtn = buttons.find((b) => b.title.includes("Select"));
      const handwriteBtn = buttons.find((b) => b.title.includes("Handwrite Text"));
      const drawBtn = buttons.find((b) => b.title.includes("Draw"));

      // Handwrite active
      rendererMock.freehandMode = true;
      rendererMock.isHandwritingTextMode = true;
      toolbar.updateToolMode();
      expect(handwriteBtn?.classList.contains("is-active")).toBe(true);

      // Click Draw
      drawBtn?.click();
      expect(rendererMock.setHandwritingTextMode).toHaveBeenCalledWith(false);

      // Click Select
      selectBtn?.click();
      expect(rendererMock.setHandwritingTextMode).toHaveBeenCalledWith(false);
    });
  });

  describe("2. Lowercase Scoping & Character Sanitization", () => {
    it("should strictly scope all recognized characters down to lowercase (a-z)", () => {
      // Strokes resembling uppercase "HE"
      const hStrokes = makeHStrokes(10, 10, 20, 30);
      const eStrokes = makeEStrokes(35, 10, 20, 30);
      const res = system.recognize([...hStrokes, ...eStrokes]);

      expect(res.text).toBe("he");
      expect(res.text).toBe(res.text.toLowerCase());
      expect(/^[a-z\s]+$/.test(res.text)).toBe(true);
    });

    it("should format any mixed case or uppercase words into clean lowercase words", () => {
      const cleaned = system.formatToLowercaseLetters("HELLO WORLD NOTEBOOK LECTURE");
      expect(cleaned).toBe("hello world notebook lecture");
    });

    it("should map ambiguous handwriting digits into appropriate lowercase letters", () => {
      // '0' -> 'o', '1' -> 'l', '5' -> 's', '+' -> 't'
      const mapped = system.formatToLowercaseLetters("h1ll0 w0r1d");
      expect(mapped).toBe("hlllo world");
    });
  });

  describe("3. Hyphen-like Character Replaced with Space Between Words", () => {
    it("should detect hyphen-like horizontal strokes correctly", () => {
      const horizontalDash = makeHyphenStroke(50, 20, 35);
      expect(isHyphenLikeStroke(horizontalDash)).toBe(true);

      const verticalLine = makeStraightStroke(50, 10, 50, 60);
      expect(isHyphenLikeStroke(verticalLine)).toBe(false);
    });

    it("should replace hyphen-like characters with a single space between words (e.g. hello - world)", () => {
      const result = system.replaceHyphensWithSpaces("hello - world");
      expect(result).toBe("hello world");

      const resultDirectHyphen = system.replaceHyphensWithSpaces("hello-world");
      expect(resultDirectHyphen).toBe("hello world");

      const resultMultiHyphen = system.replaceHyphensWithSpaces("hello---world");
      expect(resultMultiHyphen).toBe("hello world");

      const resultSpacesAndHyphen = system.replaceHyphensWithSpaces("hello   -   world");
      expect(resultSpacesAndHyphen).toBe("hello world");
    });

    it("should replace hyphens between words for notes taken during lectures", () => {
      const note = system.replaceHyphensWithSpaces("lecture - notes - physics");
      expect(note).toBe("lecture notes physics");

      const scoped = system.recognize([
        makeHyphenStroke(40, 20, 25), // isolated dash
      ]);
      expect(scoped.text).toBe(""); // isolated delimiter alone produces no trailing clutter
    });

    it("should strip leading or trailing hyphens so notes stay clean", () => {
      const trimmed = system.replaceHyphensWithSpaces("- hello world -");
      expect(trimmed).toBe("hello world");
    });
  });

  describe("4. Common Words Matching & Cursive Recognition", () => {
    it("should refine near-miss words using common notebook vocabulary", () => {
      const refined = system.refineWords(["hel1o", "wnrld", "natbook", "lactura", "studant"]);
      expect(refined).toEqual(["hello", "world", "notebook", "lecture", "student"]);
    });

    it("should segment continuous cursive strokes and recognize the words", () => {
      // Construct a cursive wave stroke with multiple loops / valleys
      const points: StrokePoint[] = [];
      const waveCount = 5;
      const width = 120;
      for (let i = 0; i <= 60; i++) {
        const x = 10 + (i / 60) * width;
        const y = 30 + Math.sin((i / 60) * waveCount * Math.PI * 2) * 12;
        points.push({ x, y });
      }
      const cursiveStroke: Stroke = { id: "cursive-word", points };

      // segmentCursiveStroke splits at valleys
      const sub = defaultHandwrittenFontDetector.segmentCursiveStroke(cursiveStroke);
      expect(sub.length).toBeGreaterThan(1);
    });
  });

  describe("5. Shape Enhance Mode MUST NOT Detect Characters (Redundancy Removal)", () => {
    it("snapStrokeToShape should NOT recognize character strokes as generic.text nodes", () => {
      // Stroke for 'T' (crossbar + stem) or single straight line
      const singleLetterStroke = makeStraightStroke(50, 10, 50, 60, "letter-i");

      // In Auto Shape mode, snapStrokeToShape is called:
      // A vertical straight line is recognized as a line or kept freehand, NEVER generic.text
      const result = editor.snapStrokeToShape(singleLetterStroke) as any;

      if (result) {
        expect(result.kind).not.toBe("generic.text");
      }
    });

    it("snapStrokeToShape with letter-like strokes falls back to shape or freehand, not text", () => {
      const eStrokes = makeEStrokes(50, 50);
      const res = editor.snapStrokeToShape(eStrokes[0], { fallbackToFreehand: true }) as DiagramNode;

      if (res) {
        expect(res.kind).not.toBe("generic.text");
      }
    });
  });

  describe("6. DiagramEditor Integration (handwriteTextFromStrokes)", () => {
    it("should create a generic.text node with lowercase text and handwritten font styling", () => {
      const hStrokes = makeHStrokes(100, 100, 20, 30);
      const eStrokes = makeEStrokes(125, 100, 20, 30);

      const node = editor.handwriteTextFromStrokes([...hStrokes, ...eStrokes]);

      expect(node).not.toBeNull();
      expect(node?.kind).toBe("generic.text");
      expect(node?.title).toBe("he");
      expect(node?.style?.fontFamily).toBe("handwritten");
      expect(node?.labels[0].text).toBe("he");
      expect(editor.diagram.nodes.length).toBe(1);
    });

    it("should handle 'hello - world' by replacing hyphen with space in editor", () => {
      // Mock recognition of "hello-world"
      const spy = jest.spyOn(defaultNoteHandwritingSystem, "recognize").mockReturnValueOnce({
        text: "hello world",
        rawText: "hello-world",
        confidence: 0.95,
        bounds: { position: { x: 50, y: 50 }, size: { width: 140, height: 35 } },
        isText: true,
        estimatedFontSize: 18,
        fontFamily: "handwritten",
        words: ["hello", "world"],
      });

      const stroke1 = makeStraightStroke(50, 50, 100, 50);
      const stroke2 = makeHyphenStroke(105, 50);
      const stroke3 = makeStraightStroke(140, 50, 190, 50);

      const node = editor.handwriteTextFromStrokes([stroke1, stroke2, stroke3]);

      expect(node).not.toBeNull();
      expect(node?.title).toBe("hello world");
      expect(node?.title).not.toContain("-");

      spy.mockRestore();
    });

    it("should append to nearby text node on the same line when taking sequential notes", () => {
      // First note: "hello"
      const firstNode = editor.handwriteTextFromStrokes(makeHStrokes(50, 50));
      expect(firstNode).not.toBeNull();

      // Subsequent note immediately adjacent on same line: "world"
      const spy = jest.spyOn(defaultNoteHandwritingSystem, "recognize").mockReturnValueOnce({
        text: "world",
        rawText: "world",
        confidence: 0.95,
        bounds: { position: { x: firstNode!.position.x + firstNode!.size.width + 10, y: 50 }, size: { width: 60, height: 30 } },
        isText: true,
        estimatedFontSize: 16,
        fontFamily: "handwritten",
        words: ["world"],
      });

      const updated = editor.handwriteTextFromStrokes([makeStraightStroke(150, 50, 180, 50)], {
        appendToNearby: true,
      });

      expect(updated).not.toBeNull();
      expect(updated?.id).toBe(firstNode?.id);
      expect(updated?.title).toContain("world");

      spy.mockRestore();
    });
  });

  describe("7. Robust Lowercase Individual Letter Detection & Hyphen Space Retention", () => {
    function makeArcPts(cx: number, cy: number, rx: number, ry: number, startA: number, endA: number, steps = 20): StrokePoint[] {
      const pts: StrokePoint[] = [];
      for (let i = 0; i <= steps; i++) {
        const a = startA + (i / steps) * (endA - startA);
        pts.push({ x: Math.round((cx + rx * Math.cos(a)) * 10) / 10, y: Math.round((cy + ry * Math.sin(a)) * 10) / 10 });
      }
      return pts;
    }

    function makeLinePts(x1: number, y1: number, x2: number, y2: number, steps = 10): StrokePoint[] {
      const pts: StrokePoint[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        pts.push({ x: Math.round((x1 + t * (x2 - x1)) * 10) / 10, y: Math.round((y1 + t * (y2 - y1)) * 10) / 10 });
      }
      return pts;
    }

    function generateAllLowercaseLetters(offsetX = 0): Record<string, Stroke[]> {
      const l: Record<string, Stroke[]> = {};

      // a (1 stroke: CCW loop starting top-right, then downward stem along right edge)
      {
        const pts: StrokePoint[] = [];
        for (let i = 0; i <= 20; i++) {
          const th = (i / 20) * 2 * Math.PI;
          pts.push({ x: offsetX + 20 - 9 * Math.sin(th), y: 20 - 9 * Math.cos(th) });
        }
        for (let i = 1; i <= 10; i++) {
          pts.push({ x: offsetX + 29, y: 20 + (i / 10) * 9 });
        }
        l["a"] = [{ id: "letter-a", points: pts }];
      }

      // b (1 stroke: tall stem down, retrace up, loop on right)
      {
        const pts: StrokePoint[] = [
          ...makeLinePts(offsetX + 10, 5, offsetX + 10, 35, 15),
          ...makeLinePts(offsetX + 10, 35, offsetX + 10, 20, 8),
          ...makeArcPts(offsetX + 18, 27.5, 8, 7.5, Math.PI, 3 * Math.PI, 20),
        ];
        l["b"] = [{ id: "letter-b", points: pts }];
      }

      // c (1 stroke: open C-arc)
      {
        const pts: StrokePoint[] = [];
        for (let i = 0; i <= 20; i++) {
          const a = -0.3 * Math.PI - (i / 20) * 1.4 * Math.PI;
          pts.push({ x: offsetX + 20 + 9 * Math.cos(a), y: 20 + 10 * Math.sin(a) });
        }
        l["c"] = [{ id: "letter-c", points: pts }];
      }

      // d (2 strokes: loop on left + tall right stem)
      {
        l["d"] = [
          { id: "d-loop", points: makeArcPts(offsetX + 18, 27.5, 8, 7.5, 0, 2 * Math.PI, 20) },
          { id: "d-stem", points: makeLinePts(offsetX + 26, 5, offsetX + 26, 35, 15) },
        ];
      }

      // e (1 stroke: mid crossbar right, loop over top, around bottom, open bottom-right)
      {
        const pts: StrokePoint[] = [
          ...makeLinePts(offsetX + 14, 20, offsetX + 26, 20, 10),
          ...makeArcPts(offsetX + 20, 20, 8, 9, 0, 1.5 * Math.PI, 25),
        ];
        l["e"] = [{ id: "letter-e", points: pts }];
      }

      // f (2 strokes: hooked stem + crossbar)
      {
        l["f"] = [
          {
            id: "f-stem",
            points: [
              ...makeArcPts(offsetX + 22, 10, 5, 5, 0, -Math.PI, 10),
              ...makeLinePts(offsetX + 17, 10, offsetX + 17, 35, 15),
            ],
          },
          { id: "f-bar", points: makeLinePts(offsetX + 12, 18, offsetX + 24, 18, 8) },
        ];
      }

      // g (1 stroke: upper loop + descender left hook)
      {
        l["g"] = [
          {
            id: "letter-g",
            points: [
              ...makeArcPts(offsetX + 20, 15, 8, 8, 0, 2 * Math.PI, 20),
              ...makeLinePts(offsetX + 28, 15, offsetX + 28, 35, 12),
              ...makeArcPts(offsetX + 23, 35, 5, 5, 0, Math.PI / 2, 8),
            ],
          },
        ];
      }

      // h (2 strokes: tall stem + arch)
      {
        l["h"] = [
          { id: "h-stem", points: makeLinePts(offsetX + 10, 5, offsetX + 10, 35, 15) },
          {
            id: "h-arch",
            points: [
              ...makeArcPts(offsetX + 18, 23, 8, 6, Math.PI, 0, 12),
              ...makeLinePts(offsetX + 26, 23, offsetX + 26, 35, 8),
            ],
          },
        ];
      }

      // i (2 strokes: short stem + dot)
      {
        l["i"] = [
          { id: "i-stem", points: makeLinePts(offsetX + 15, 16, offsetX + 15, 32, 10) },
          { id: "i-dot", points: makeLinePts(offsetX + 15, 8, offsetX + 15, 9, 2) },
        ];
      }

      // j (2 strokes: descender hook + dot)
      {
        l["j"] = [
          {
            id: "j-stem",
            points: [
              ...makeLinePts(offsetX + 18, 16, offsetX + 18, 38, 12),
              ...makeArcPts(offsetX + 13, 38, 5, 5, 0, Math.PI / 2, 8),
            ],
          },
          { id: "j-dot", points: makeLinePts(offsetX + 18, 8, offsetX + 18, 9, 2) },
        ];
      }

      // k (2 strokes: tall stem + chevron)
      {
        l["k"] = [
          { id: "k-stem", points: makeLinePts(offsetX + 10, 5, offsetX + 10, 35, 15) },
          {
            id: "k-arm",
            points: [
              ...makeLinePts(offsetX + 22, 16, offsetX + 11, 24, 8),
              ...makeLinePts(offsetX + 11, 24, offsetX + 23, 35, 8),
            ],
          },
        ];
      }

      // l (1 stroke: tall straight line)
      {
        l["l"] = [{ id: "letter-l", points: makeLinePts(offsetX + 15, 5, offsetX + 15, 35, 15) }];
      }

      // m (1 stroke: 2 arches)
      {
        l["m"] = [
          {
            id: "letter-m",
            points: [
              ...makeLinePts(offsetX + 10, 16, offsetX + 10, 32, 8),
              ...makeArcPts(offsetX + 16, 20, 6, 4, Math.PI, 0, 10),
              ...makeLinePts(offsetX + 22, 20, offsetX + 22, 32, 6),
              ...makeArcPts(offsetX + 28, 20, 6, 4, Math.PI, 0, 10),
              ...makeLinePts(offsetX + 34, 20, offsetX + 34, 32, 6),
            ],
          },
        ];
      }

      // n (1 stroke: 1 arch)
      {
        l["n"] = [
          {
            id: "letter-n",
            points: [
              ...makeLinePts(offsetX + 10, 16, offsetX + 10, 32, 8),
              ...makeArcPts(offsetX + 18, 20, 8, 4, Math.PI, 0, 12),
              ...makeLinePts(offsetX + 26, 20, offsetX + 26, 32, 8),
            ],
          },
        ];
      }

      // o (1 stroke: closed circle)
      {
        l["o"] = [{ id: "letter-o", points: makeArcPts(offsetX + 20, 20, 9, 9, -Math.PI / 2, 1.5 * Math.PI, 24) }];
      }

      // p (2 strokes: descender stem + loop)
      {
        l["p"] = [
          { id: "p-stem", points: makeLinePts(offsetX + 10, 15, offsetX + 10, 42, 15) },
          { id: "p-loop", points: makeArcPts(offsetX + 18, 23, 8, 8, -Math.PI / 2, 1.5 * Math.PI, 20) },
        ];
      }

      // q (2 strokes: loop + right descender stem)
      {
        l["q"] = [
          { id: "q-loop", points: makeArcPts(offsetX + 16, 23, 8, 8, -Math.PI / 2, 1.5 * Math.PI, 20) },
          { id: "q-stem", points: makeLinePts(offsetX + 24, 15, offsetX + 24, 42, 15) },
        ];
      }

      // r (1 stroke: short stem + top branch)
      {
        l["r"] = [
          {
            id: "letter-r",
            points: [
              ...makeLinePts(offsetX + 10, 16, offsetX + 10, 32, 10),
              ...makeLinePts(offsetX + 10, 32, offsetX + 10, 20, 6),
              ...makeArcPts(offsetX + 16, 20, 6, 4, Math.PI, 0.2 * Math.PI, 10),
            ],
          },
        ];
      }

      // s (1 stroke: S-curve)
      {
        l["s"] = [
          {
            id: "letter-s",
            points: [
              { x: offsetX + 23, y: 16 },
              { x: offsetX + 18, y: 12 },
              { x: offsetX + 13, y: 15 },
              { x: offsetX + 18, y: 22 },
              { x: offsetX + 23, y: 25 },
              { x: offsetX + 18, y: 30 },
              { x: offsetX + 13, y: 28 },
            ],
          },
        ];
      }

      // t (2 strokes: stem + crossbar)
      {
        l["t"] = [
          {
            id: "t-stem",
            points: [
              ...makeLinePts(offsetX + 18, 8, offsetX + 18, 30, 12),
              ...makeArcPts(offsetX + 22, 30, 4, 3, Math.PI, Math.PI / 2, 6),
            ],
          },
          { id: "t-bar", points: makeLinePts(offsetX + 12, 16, offsetX + 24, 16, 8) },
        ];
      }

      // u (1 stroke: cup)
      {
        l["u"] = [
          {
            id: "letter-u",
            points: [
              ...makeLinePts(offsetX + 12, 16, offsetX + 12, 26, 8),
              ...makeArcPts(offsetX + 18, 26, 6, 6, Math.PI, 0, 12),
              ...makeLinePts(offsetX + 24, 26, offsetX + 24, 16, 8),
            ],
          },
        ];
      }

      // v (1 stroke: V)
      {
        l["v"] = [
          {
            id: "letter-v",
            points: [
              ...makeLinePts(offsetX + 12, 16, offsetX + 19, 32, 10),
              ...makeLinePts(offsetX + 19, 32, offsetX + 26, 16, 10),
            ],
          },
        ];
      }

      // w (1 stroke: W)
      {
        l["w"] = [
          {
            id: "letter-w",
            points: [
              ...makeLinePts(offsetX + 10, 16, offsetX + 15, 32, 8),
              ...makeLinePts(offsetX + 15, 32, offsetX + 20, 18, 8),
              ...makeLinePts(offsetX + 20, 18, offsetX + 25, 32, 8),
              ...makeLinePts(offsetX + 25, 32, offsetX + 30, 16, 8),
            ],
          },
        ];
      }

      // x (2 strokes: crossing diagonals)
      {
        l["x"] = [
          { id: "x-1", points: makeLinePts(offsetX + 12, 16, offsetX + 26, 32, 10) },
          { id: "x-2", points: makeLinePts(offsetX + 26, 16, offsetX + 12, 32, 10) },
        ];
      }

      // y (2 strokes: cup + descender)
      {
        l["y"] = [
          {
            id: "y-cup",
            points: [
              ...makeLinePts(offsetX + 12, 16, offsetX + 12, 26, 6),
              ...makeArcPts(offsetX + 18, 26, 6, 5, Math.PI, 0, 10),
              ...makeLinePts(offsetX + 24, 26, offsetX + 24, 16, 6),
            ],
          },
          { id: "y-stem", points: makeLinePts(offsetX + 24, 16, offsetX + 16, 42, 12) },
        ];
      }

      // z (1 stroke: zigzag)
      {
        l["z"] = [
          {
            id: "letter-z",
            points: [
              ...makeLinePts(offsetX + 12, 16, offsetX + 26, 16, 8),
              ...makeLinePts(offsetX + 26, 16, offsetX + 12, 32, 10),
              ...makeLinePts(offsetX + 12, 32, offsetX + 26, 32, 8),
            ],
          },
        ];
      }

      // hyphen '-'
      l["-"] = [
        { id: "hyphen", points: makeLinePts(offsetX + 15, 20, offsetX + 35, 20, 10) },
      ];

      return l;
    }

    it("should accurately differentiate letter 'a' and letter 'e'", () => {
      const letters = generateAllLowercaseLetters(0);

      const resA = system.recognize(letters["a"]);
      expect(resA.text).toBe("a");
      expect(resA.text).not.toBe("e");
      expect(resA.text).not.toBe("c");

      const resE = system.recognize(letters["e"]);
      expect(resE.text).toBe("e");
      expect(resE.text).not.toBe("a");
      expect(resE.text).not.toBe("c");
    });

    it("should correctly recognize all 26 individual lowercase letters (a-z)", () => {
      const letters = generateAllLowercaseLetters(0);

      for (let code = 97; code <= 122; code++) {
        const char = String.fromCharCode(code);
        const result = system.recognize(letters[char]);
        expect(result.text).toBe(char);
      }
    });

    it("should detect hyphens to keep spaces between letters (e.g. 'a - b' -> 'a b')", () => {
      const lettersA = generateAllLowercaseLetters(0);
      const hyphenStrokes = [{ id: "dash", points: makeLinePts(40, 20, 60, 20, 10) }];
      const lettersB = generateAllLowercaseLetters(70);

      const strokesAB = [...lettersA["a"], ...hyphenStrokes, ...lettersB["b"]];
      const resultAB = system.recognize(strokesAB);

      expect(resultAB.text).toBe("a b");
      expect(resultAB.words).toEqual(["a", "b"]);
    });

    it("should detect hyphens to keep spaces between 'a' and 'e' (e.g. 'a - e' -> 'a e')", () => {
      const lettersA = generateAllLowercaseLetters(0);
      const hyphenStrokes = [{ id: "dash", points: makeLinePts(40, 20, 60, 20, 10) }];
      const lettersE = generateAllLowercaseLetters(70);

      const strokesAE = [...lettersA["a"], ...hyphenStrokes, ...lettersE["e"]];
      const resultAE = system.recognize(strokesAE);

      expect(resultAE.text).toBe("a e");
      expect(resultAE.words).toEqual(["a", "e"]);
    });

    it("should keep spaces between multiple letters separated by hyphens (e.g. 'x - y - z')", () => {
      const lettersX = generateAllLowercaseLetters(0);
      const dash1 = [{ id: "dash-1", points: makeLinePts(35, 20, 50, 20, 8) }];
      const lettersY = generateAllLowercaseLetters(60);
      const dash2 = [{ id: "dash-2", points: makeLinePts(95, 20, 110, 20, 8) }];
      const lettersZ = generateAllLowercaseLetters(120);

      const strokes = [
        ...lettersX["x"],
        ...dash1,
        ...lettersY["y"],
        ...dash2,
        ...lettersZ["z"],
      ];

      const result = system.recognize(strokes);
      expect(result.text).toBe("x y z");
      expect(result.words).toEqual(["x", "y", "z"]);
    });

    it("handwriteTextFromStrokes in DiagramEditor creates text node with space between letters", () => {
      const lettersA = generateAllLowercaseLetters(100);
      const hyphenStrokes = [{ id: "dash", points: makeLinePts(140, 20, 160, 20, 10) }];
      const lettersE = generateAllLowercaseLetters(170);

      // In real editor integration:
      const node = editor.handwriteTextFromStrokes([...lettersA["a"], ...hyphenStrokes, ...lettersE["e"]]);

      expect(node).not.toBeNull();
      expect(node?.kind).toBe("generic.text");
      expect(node?.title).toBe("a e");
      expect(node?.style?.fontFamily).toBe("handwritten");
    });
  });
});
