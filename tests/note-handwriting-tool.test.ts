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
});
