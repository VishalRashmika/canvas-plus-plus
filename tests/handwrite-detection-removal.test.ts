import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { Stroke, StrokePoint } from "../src/domain/services/ShapeRecognizer";
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
      const willHave = force !== undefined ? force : !this.classList.classes.has(c);
      if (willHave) this.classList.add(c);
      else this.classList.remove(c);
      return willHave;
    },
    contains: (c: string) => this.classList.classes.has(c),
  };
  style: any = {
    setProperty: (name: string, value: string) => {
      this.style[name] = value;
    },
  };
  attributes: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  listeners: Record<string, ((e: any) => void)[]> = {};
  title = "";
  disabled = false;
  value = "";
  private _textContent = "";
  clientWidth = 1000;
  clientHeight = 800;
  scrollWidth = 1000;
  scrollHeight = 800;

  constructor(tagName: string, options?: any) {
    this.tagName = tagName.toUpperCase();
    const classList = options?.cls
      ? Array.isArray(options.cls)
        ? options.cls
        : String(options.cls).split(/\s+/).filter(Boolean)
      : [];
    classList.forEach((c: string) => this.classList.add(c));
    if (options?.text) this.textContent = options.text;
    if (options?.attr) {
      for (const [k, v] of Object.entries(options.attr)) {
        this.attributes[k] = String(v);
      }
    }
  }

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map((c) => c.textContent).join("");
  }
  set textContent(val: string) {
    this._textContent = val;
    if (val === "") this.children = [];
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

  createSpan(options?: any): MockElement {
    const el = new MockElement("span", options);
    this.appendChild(el);
    return el;
  }

  createSvg(tag: string, options?: any): MockElement {
    const el = new MockElement(tag, options);
    this.appendChild(el);
    return el;
  }

  createDiv(options?: any): MockElement {
    const el = new MockElement("div", options);
    this.appendChild(el);
    return el;
  }

  createEl(tag: string, options?: any): MockElement {
    const el = new MockElement(tag, options);
    this.appendChild(el);
    return el;
  }

  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (e: any) => void): void {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
    }
  }

  click(): void {
    if (this.listeners["click"]) {
      this.listeners["click"].forEach((cb) => cb({ target: this, preventDefault: () => {}, stopPropagation: () => {} }));
    }
  }

  dispatch(event: string, e: any = {}): void {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => cb({ target: this, preventDefault: () => {}, stopPropagation: () => {}, ...e }));
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
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
      } else if (selector.toUpperCase() === el.tagName) {
        matches = true;
      }
      if (matches) results.push(el);
      el.children.forEach(check);
    };
    this.children.forEach(check);
    return results;
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }
}

const mockDocument = {
  createElement: (tag: string, options?: any) => new MockElement(tag, options),
  createElementNS: (_ns: string, tag: string, options?: any) => new MockElement(tag, options),
  body: new MockElement("body"),
};
(global as any).document = mockDocument;
(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);
(global as any).window = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
};

function makeStroke(id: string, x1: number, y1: number, x2: number, y2: number): Stroke {
  const points: StrokePoint[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    points.push({
      x: x1 + ((x2 - x1) * i) / steps,
      y: y1 + ((y2 - y1) * i) / steps,
    });
  }
  return { id, points };
}

describe("Complete Removal of Handwrite Detect Feature and Tool", () => {
  let editor: DiagramEditor;
  let container: MockElement;
  let renderer: SvgSceneRenderer;
  let toolbar: Toolbar;

  beforeEach(() => {
    editor = new DiagramEditor(createDiagram({ id: "diag-test", diagramType: "general" }));
    container = new MockElement("div");

    renderer = new SvgSceneRenderer(container as any, editor, {
      enableFreehand: true,
      autoShapeDetection: false,
    });

    toolbar = new Toolbar(container as any, editor, renderer);
  });

  describe("1. Bottom Toolbar Handwrite Tool Removal", () => {
    it("MUST NOT have the Handwrite Text button (umlcanvas-handwrite-btn) in toolbar", () => {
      const allButtons = container.querySelectorAll("button");
      const handwriteBtn = allButtons.find(
        (b) =>
          b.classList.contains("umlcanvas-handwrite-btn") ||
          b.title.toLowerCase().includes("handwrite")
      );

      expect(handwriteBtn).toBeUndefined();
    });

    it("Toolbar mode buttons only include Select, Grab, Draw, Auto Shape", () => {
      const selectBtn = container.querySelector(".umlcanvas-select-btn");
      const grabBtn = container.querySelector(".umlcanvas-grab-btn");
      const drawBtn = container.querySelector(".umlcanvas-draw-btn");
      const autoShapeBtn = container.querySelector(".umlcanvas-autoshape-btn");

      expect(selectBtn).toBeDefined();
      expect(grabBtn).toBeDefined();
      expect(drawBtn).toBeDefined();
      expect(autoShapeBtn).toBeDefined();

      const handwriteBtn = container.querySelector(".umlcanvas-handwrite-btn");
      expect(handwriteBtn).toBeNull();
    });
  });

  describe("2. Renderer Handwriting Mode and Shortcut Removal", () => {
    it("MUST NOT have isHandwritingTextMode or setHandwritingTextMode on renderer", () => {
      expect((renderer as any).isHandwritingTextMode).toBeUndefined();
      expect((renderer as any).setHandwritingTextMode).toBeUndefined();
      expect((renderer as any).handwritingTextMode).toBeUndefined();
    });

    it("keyboard shortcut 'w' or 'W' MUST NOT activate handwriting text mode", () => {
      const keyEvent = {
        key: "w",
        code: "KeyW",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault: jest.fn(),
      };

      (renderer as any).handleKeyDown(keyEvent);

      expect(renderer.freehandMode).toBe(false);
      expect((renderer as any).isHandwritingTextMode).toBeUndefined();
    });

    it("mode change callback MUST NOT emit 'handwrite'", () => {
      const emittedModes: string[] = [];
      const testRenderer = new SvgSceneRenderer(new MockElement("div") as any, editor, {
        enableFreehand: true,
        onModeChange: (mode) => emittedModes.push(mode),
      });

      testRenderer.setFreehandMode(true);
      expect(emittedModes).toContain("draw");

      testRenderer.setGrabMode(true);
      expect(emittedModes).toContain("grab");

      testRenderer.setFreehandMode(false);
      testRenderer.setGrabMode(false);
      expect(emittedModes).toContain("select");

      expect(emittedModes).not.toContain("handwrite");
    });
  });

  describe("3. DiagramEditor Text & Font Recognition Removal", () => {
    it("DiagramEditor MUST NOT expose handwriteTextFromStrokes or recognizeHandwrittenText", () => {
      expect((editor as any).handwriteTextFromStrokes).toBeUndefined();
      expect((editor as any).recognizeHandwrittenText).toBeUndefined();
    });

    it("enhanceStrokes MUST NOT convert letter-like handwriting strokes into generic.text with handwritten fonts", () => {
      // Simulate letter 'E' strokes (1 vertical + 3 horizontal lines)
      const vStroke = makeStroke("e_v", 100, 100, 100, 160);
      const h1Stroke = makeStroke("e_h1", 100, 100, 140, 100);
      const h2Stroke = makeStroke("e_h2", 100, 130, 130, 130);
      const h3Stroke = makeStroke("e_h3", 100, 160, 140, 160);

      const result = editor.enhanceStrokes([vStroke, h1Stroke, h2Stroke, h3Stroke]);

      if (result) {
        expect((result as DiagramNode).kind).not.toBe("generic.text");
        expect((result as DiagramNode).style?.fontFamily).not.toBe("handwritten");
      } else {
        expect(result).toBeNull();
      }
    });

    it("enhanceSelection MUST NOT convert freehand handwriting strokes into generic.text with handwritten fonts", () => {
      const vStroke = makeStroke("e_v", 100, 100, 100, 160);
      const h1Stroke = makeStroke("e_h1", 100, 100, 140, 100);
      const h2Stroke = makeStroke("e_h2", 100, 130, 130, 130);
      const h3Stroke = makeStroke("e_h3", 100, 160, 140, 160);

      const node1 = editor.keepAsFreehand(vStroke);
      const node2 = editor.keepAsFreehand(h1Stroke);
      const node3 = editor.keepAsFreehand(h2Stroke);
      const node4 = editor.keepAsFreehand(h3Stroke);

      editor.selectNode(node1.id, false);
      editor.selectNode(node2.id, true);
      editor.selectNode(node3.id, true);
      editor.selectNode(node4.id, true);

      const enhanced = editor.enhanceSelection();

      // Freehand strokes must not be enhanced into generic.text
      if (enhanced) {
        if (!Array.isArray(enhanced)) {
          expect((enhanced as DiagramNode).kind).not.toBe("generic.text");
          expect((enhanced as DiagramNode).style?.fontFamily).not.toBe("handwritten");
        }
      } else {
        expect(enhanced).toBeNull();
      }
    });
  });
});
