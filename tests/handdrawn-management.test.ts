import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { defaultShapeRecognizer, Stroke, StrokePoint } from "../src/domain/services/ShapeRecognizer";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
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

  setCssProps(props: Record<string, string>): void {
    Object.assign(this.style, props);
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

  dispatch(event: string, detail: any = {}): void {
    const handlers = [...(this.listeners[event] || [])];
    const evt = { stopPropagation: () => {}, preventDefault: () => {}, target: this, ...detail };
    handlers.forEach((h) => h(evt));
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 };
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

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (selector.startsWith(".")) {
        const classes = selector.split(",").map((s) => s.trim().replace(/^\./, ""));
        for (const cls of classes) {
          if (curr.classList.contains(cls)) return curr;
        }
      }
      curr = curr.parentElement;
    }
    return null;
  }
}

// Global mocks
const mockDocument = {
  createElement: (tag: string) => new MockElement(tag),
  createElementNS: (_ns: string, tag: string) => new MockElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {},
};
(global as any).document = mockDocument;
const windowListeners: Record<string, ((e: any) => void)[]> = {};
(global as any).window = {
  addEventListener: (event: string, handler: (e: any) => void) => {
    if (!windowListeners[event]) windowListeners[event] = [];
    windowListeners[event].push(handler);
  },
  removeEventListener: (event: string, handler: (e: any) => void) => {
    if (windowListeners[event]) {
      windowListeners[event] = windowListeners[event].filter((h) => h !== handler);
    }
  },
  dispatch: (event: string, detail: any = {}) => {
    const handlers = [...(windowListeners[event] || [])];
    const evt = { stopPropagation: () => {}, preventDefault: () => {}, ...detail };
    handlers.forEach((h) => h(evt));
  },
};
(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

// Stroke generation helpers
function makeRectStroke(x = 10, y = 10, w = 140, h = 80): Stroke {
  const points: StrokePoint[] = [];
  for (let i = 0; i <= 10; i++) points.push({ x: x + (w * i) / 10, y });
  for (let i = 0; i <= 10; i++) points.push({ x: x + w, y: y + (h * i) / 10 });
  for (let i = 0; i <= 10; i++) points.push({ x: x + w - (w * i) / 10, y: y + h });
  for (let i = 0; i <= 10; i++) points.push({ x, y: y + h - (h * i) / 10 });
  return { id: "rect-stroke", points };
}

function makeHanddrawnRectStroke(x = 20, y = 20, w = 180, h = 90): Stroke {
  const points: StrokePoint[] = [];
  const N = 20;
  for (let i = 0; i <= N; i++) points.push({ x: x + (w * i) / N, y: y + Math.sin(i) * 2 });
  for (let i = 0; i <= N; i++) points.push({ x: x + w + Math.cos(i) * 2, y: y + (h * i) / N });
  for (let i = 0; i <= N; i++) points.push({ x: x + w - (w * i) / N, y: y + h + Math.sin(i) * 2 });
  for (let i = 0; i <= N; i++) points.push({ x: x + Math.cos(i) * 2, y: y + h - (h * i) / N });
  return { id: "handdrawn-rect-stroke", points };
}

function makeSquareStroke(x = 10, y = 10, s = 100): Stroke {
  return makeRectStroke(x, y, s, s);
}

function makeHanddrawnSquareStroke(x = 20, y = 20, s = 110): Stroke {
  return makeHanddrawnRectStroke(x, y, s, s);
}

function makeDiamondStroke(cx = 60, cy = 60, rx = 40, ry = 40): Stroke {
  const points: StrokePoint[] = [];
  const v1 = { x: cx, y: cy - ry };
  const v2 = { x: cx + rx, y: cy };
  const v3 = { x: cx, y: cy + ry };
  const v4 = { x: cx - rx, y: cy };
  for (let i = 0; i <= 8; i++) points.push({ x: v1.x + ((v2.x - v1.x) * i) / 8, y: v1.y + ((v2.y - v1.y) * i) / 8 });
  for (let i = 0; i <= 8; i++) points.push({ x: v2.x + ((v3.x - v2.x) * i) / 8, y: v2.y + ((v3.y - v2.y) * i) / 8 });
  for (let i = 0; i <= 8; i++) points.push({ x: v3.x + ((v4.x - v3.x) * i) / 8, y: v3.y + ((v4.y - v3.y) * i) / 8 });
  for (let i = 0; i <= 8; i++) points.push({ x: v4.x + ((v1.x - v4.x) * i) / 8, y: v4.y + ((v1.y - v4.y) * i) / 8 });
  return { id: "diamond-stroke", points };
}

function makeCircleStroke(cx = 60, cy = 60, r = 40): Stroke {
  const points: StrokePoint[] = [];
  const N = 32;
  for (let i = 0; i <= N; i++) {
    const angle = (2 * Math.PI * i) / N;
    points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return { id: "circle-stroke", points };
}

function makeLineStroke(x1: number, y1: number, x2: number, y2: number): Stroke {
  const points: StrokePoint[] = [];
  const N = 15;
  for (let i = 0; i <= N; i++) {
    points.push({ x: x1 + ((x2 - x1) * i) / N, y: y1 + ((y2 - y1) * i) / N });
  }
  return { id: "line-stroke", points };
}

describe("Issue #17 & #18: Hand Drawn Shapes, Auto Connection & Object Management", () => {
  describe("Shape Recognition for Rectangles and Squares (Issue #17)", () => {
    it("should recognize rectangles distinctly from diamonds and circles", () => {
      const rectResult = defaultShapeRecognizer.recognize(makeRectStroke(50, 50, 160, 90));
      expect(rectResult.shape).toBe("rectangle");
      expect(rectResult.confidence).toBeGreaterThanOrEqual(0.75);

      const handdrawnRect = defaultShapeRecognizer.recognize(makeHanddrawnRectStroke(50, 50, 150, 80));
      expect(handdrawnRect.shape).toBe("rectangle");
      expect(handdrawnRect.confidence).toBeGreaterThanOrEqual(0.70);
    });

    it("should recognize squares properly with square shape classification", () => {
      const squareResult = defaultShapeRecognizer.recognize(makeSquareStroke(50, 50, 100));
      expect(squareResult.shape).toBe("square");
      expect(squareResult.confidence).toBeGreaterThanOrEqual(0.75);

      const handdrawnSquare = defaultShapeRecognizer.recognize(makeHanddrawnSquareStroke(50, 50, 110));
      expect(handdrawnSquare.shape).toBe("square");
      expect(handdrawnSquare.confidence).toBeGreaterThanOrEqual(0.70);
    });

    it("should recognize diamonds accurately without confusing them with rectangles", () => {
      const diamondResult = defaultShapeRecognizer.recognize(makeDiamondStroke(100, 100, 60, 60));
      expect(diamondResult.shape).toBe("diamond");
      expect(diamondResult.confidence).toBeGreaterThanOrEqual(0.70);
    });

    it("should recognize circles accurately without confusing them with squares", () => {
      const circleResult = defaultShapeRecognizer.recognize(makeCircleStroke(100, 100, 50));
      expect(circleResult.shape).toBe("circle");
      expect(circleResult.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it("snapStrokeToShape should create symmetric bounds for squares and proper bounds for rectangles", () => {
      const editor = new DiagramEditor(createDiagram({ id: "diag-shapes", diagramType: "general" }));

      // Rectangle snap
      const rectNode = editor.snapStrokeToShape(makeRectStroke(50, 50, 160, 90)) as any;
      expect(rectNode).toBeDefined();
      expect(rectNode.kind).toBe("generic.rectangle");
      expect(rectNode.size.width).toBe(160);
      expect(rectNode.size.height).toBe(90);

      // Square snap
      const squareNode = editor.snapStrokeToShape(makeSquareStroke(200, 50, 100)) as any;
      expect(squareNode).toBeDefined();
      expect(squareNode.kind).toBe("generic.rectangle");
      expect(squareNode.size.width).toBe(squareNode.size.height);
      expect(squareNode.size.width).toBe(100);
    });

    it("should correctly recognize casual handdrawn boxes with rounded corners as rectangles or squares, not diamond or circle", () => {
      // Casual rectangle with slightly rounded corners & hand jitter
      const casualRectStroke: Stroke = {
        id: "casual-rect",
        points: [
          { x: 100, y: 100 }, { x: 150, y: 102 }, { x: 200, y: 99 }, { x: 250, y: 103 },
          { x: 252, y: 130 }, { x: 249, y: 160 }, { x: 251, y: 190 },
          { x: 205, y: 192 }, { x: 155, y: 188 }, { x: 98, y: 191 },
          { x: 101, y: 160 }, { x: 99, y: 130 }, { x: 102, y: 105 },
        ],
      };
      const rectResult = defaultShapeRecognizer.recognize(casualRectStroke);
      expect(rectResult.shape).toBe("rectangle");
      expect(rectResult.confidence).toBeGreaterThanOrEqual(0.70);

      // Casual square with hand wobble
      const casualSquareStroke: Stroke = {
        id: "casual-square",
        points: [
          { x: 50, y: 50 }, { x: 80, y: 52 }, { x: 110, y: 49 }, { x: 140, y: 51 },
          { x: 139, y: 80 }, { x: 141, y: 110 }, { x: 140, y: 140 },
          { x: 110, y: 139 }, { x: 80, y: 142 }, { x: 51, y: 140 },
          { x: 49, y: 110 }, { x: 52, y: 80 }, { x: 50, y: 52 },
        ],
      };
      const squareResult = defaultShapeRecognizer.recognize(casualSquareStroke);
      expect(squareResult.shape).toBe("square");
      expect(squareResult.confidence).toBeGreaterThanOrEqual(0.70);
    });
  });

  describe("Handdrawn Connection Line Between Components (Issue #17)", () => {
    let editor: DiagramEditor;
    let nodeA: any;
    let nodeB: any;

    beforeEach(() => {
      editor = new DiagramEditor(createDiagram({ id: "diag-conn", diagramType: "general" }));
      // Component A at (100, 100) size 120x80 (bounds: x 100-220, y 100-180)
      nodeA = editor.addNode({
        kind: "generic.rectangle",
        title: "Node A",
        position: { x: 100, y: 100 },
        size: { width: 120, height: 80 },
      });
      // Component B at (400, 100) size 120x80 (bounds: x 400-520, y 100-180)
      nodeB = editor.addNode({
        kind: "generic.rectangle",
        title: "Node B",
        position: { x: 400, y: 100 },
        size: { width: 120, height: 80 },
      });
      editor.clearSelection();
    });

    it("should automatically create a proper connection line when drawing a line from Node A to Node B", () => {
      // Line starting near right edge of Node A (225, 140) and ending near left edge of Node B (395, 140)
      const lineStroke = makeLineStroke(225, 140, 395, 140);
      const result = editor.snapStrokeToShape(lineStroke) as any;

      expect(result).toBeDefined();
      expect(result.fromNodeId).toBe(nodeA.id);
      expect(result.toNodeId).toBe(nodeB.id);
      expect(result.fromSide).toBe("right");
      expect(result.toSide).toBe("left");
      expect(editor.diagram.edges.length).toBe(1);
    });

    it("should connect properly when drawing from inside Node A to inside Node B", () => {
      const lineStroke = makeLineStroke(150, 140, 450, 140);
      const result = editor.snapStrokeToShape(lineStroke) as any;

      expect(result).toBeDefined();
      expect(result.fromNodeId).toBe(nodeA.id);
      expect(result.toNodeId).toBe(nodeB.id);
      expect(editor.diagram.edges.length).toBe(1);
    });

    it("should connect properly in reversed direction from Node B to Node A", () => {
      const lineStroke = makeLineStroke(390, 140, 230, 140);
      const result = editor.snapStrokeToShape(lineStroke) as any;

      expect(result).toBeDefined();
      expect(result.fromNodeId).toBe(nodeB.id);
      expect(result.toNodeId).toBe(nodeA.id);
      expect(result.fromSide).toBe("left");
      expect(result.toSide).toBe("right");
    });

    it("should connect components vertically when one is above the other", () => {
      const nodeC = editor.addNode({
        kind: "generic.rectangle",
        title: "Node C",
        position: { x: 100, y: 350 },
        size: { width: 120, height: 80 },
      });

      // Line from Node A (bottom edge y=180) to Node C (top edge y=350)
      const lineStroke = makeLineStroke(160, 185, 160, 345);
      const result = editor.snapStrokeToShape(lineStroke) as any;

      expect(result).toBeDefined();
      expect(result.fromNodeId).toBe(nodeA.id);
      expect(result.toNodeId).toBe(nodeC.id);
      expect(result.fromSide).toBe("bottom");
      expect(result.toSide).toBe("top");
    });

    it("should auto-connect with an arrow kind when an arrow is drawn between components", () => {
      const arrowStroke: Stroke = {
        id: "arrow-stroke",
        points: [
          { x: 225, y: 140 },
          { x: 280, y: 140 },
          { x: 340, y: 140 },
          { x: 390, y: 140 },
          { x: 380, y: 130 },
          { x: 390, y: 140 },
          { x: 380, y: 150 },
        ],
      };

      const result = editor.snapStrokeToShape(arrowStroke) as any;
      expect(result).toBeDefined();
      expect(result.fromNodeId).toBe(nodeA.id);
      expect(result.toNodeId).toBe(nodeB.id);
    });

    it("should automatically connect two components when drawing a slightly curved or wobbly handdrawn line between them", () => {
      // Wavy/curved line between Node A (around 220, 140) and Node B (around 400, 140)
      const wavyLineStroke: Stroke = {
        id: "wavy-connector",
        points: [
          { x: 220, y: 140 },
          { x: 250, y: 160 },
          { x: 290, y: 170 },
          { x: 330, y: 130 },
          { x: 370, y: 125 },
          { x: 405, y: 140 },
        ],
      };

      const result = editor.snapStrokeToShape(wavyLineStroke) as any;
      expect(result).toBeDefined();
      expect(result.fromNodeId).toBe(nodeA.id);
      expect(result.toNodeId).toBe(nodeB.id);
      expect(editor.diagram.edges.length).toBe(1);
    });

    it("should fall back to freehand if line is drawn in empty space far from any components", () => {
      const lineInEmptySpace = makeLineStroke(700, 700, 850, 700);
      const result = editor.snapStrokeToShape(lineInEmptySpace, { fallbackToFreehand: true }) as any;

      expect(result).toBeDefined();
      expect(result.kind).toBe("generic.freehand");
      expect(editor.diagram.edges.length).toBe(0);
    });
  });

  describe("Handdrawn Object Management & Deselection (Issue #18)", () => {
    let editor: DiagramEditor;
    let container: MockElement;
    let renderer: SvgSceneRenderer;
    let freehandNode: any;

    beforeEach(() => {
      editor = new DiagramEditor(createDiagram({ id: "diag-mgmt", diagramType: "general" }));

      // Add a handdrawn freehand stroke from (100, 100) to (250, 200)
      const stroke: Stroke = {
        id: "handdrawn-stroke-1",
        points: [
          { x: 100, y: 100 },
          { x: 140, y: 120 },
          { x: 190, y: 170 },
          { x: 250, y: 200 },
        ],
      };
      freehandNode = editor.addFreehandNode(stroke);
      editor.clearSelection();

      container = new MockElement("div", { cls: "umlcanvas-svg-container" });
      renderer = new SvgSceneRenderer(container as any, editor);
    });

    afterEach(() => {
      renderer.destroy();
    });

    it("ShapeRegistry should render generic.freehand with wide stroke hitbox and custom styling", () => {
      const shapeDef = defaultShapeRegistry.get("generic.freehand");
      expect(shapeDef).toBeDefined();

      const el = shapeDef.renderSvg(freehandNode, { isSelected: false });
      const hitbox = el.querySelector(".umlcanvas-freehand-hitbox");
      const path = el.querySelector(".umlcanvas-freehand-path");

      expect(hitbox).not.toBeNull();
      expect(hitbox?.getAttribute("stroke-width")).toBe("16");
      expect(hitbox?.getAttribute("stroke")).toBe("transparent");

      expect(path).not.toBeNull();
      expect(path?.getAttribute("stroke-linecap")).toBe("round");
    });

    it("should allow moving a handdrawn object around the canvas in select mode", () => {
      // Select the handdrawn node
      editor.selectNode(freehandNode.id, false);
      expect(editor.selectedNodeIds).toEqual([freehandNode.id]);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const nodeEl = container.querySelector(`[data-node-id="${freehandNode.id}"]`);
      expect(nodeEl).not.toBeNull();

      const initialPos = { ...freehandNode.position };

      // Grab node and drag by 50px X, 30px Y
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: nodeEl,
        clientX: initialPos.x,
        clientY: initialPos.y,
      });

      (window as any).dispatch("mousemove", {
        clientX: initialPos.x + 50,
        clientY: initialPos.y + 30,
      });

      (window as any).dispatch("mouseup", {
        clientX: initialPos.x + 50,
        clientY: initialPos.y + 30,
      });

      expect(freehandNode.position.x).toBe(initialPos.x + 50);
      expect(freehandNode.position.y).toBe(initialPos.y + 30);
    });

    it("should deselect handdrawn object when clicking empty canvas space", () => {
      editor.selectNode(freehandNode.id, false);
      expect(editor.hasSelection).toBe(true);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");
      expect(bgRect).not.toBeNull();

      // Click on background
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: bgRect,
        clientX: 50,
        clientY: 50,
      });

      (window as any).dispatch("mouseup", {
        clientX: 50,
        clientY: 50,
      });

      expect(editor.hasSelection).toBe(false);
      expect(editor.selectedNodeIds).toEqual([]);
    });

    it("clicking empty space inside freehand bounding box should click through and deselect", () => {
      editor.selectNode(freehandNode.id, false);
      expect(editor.hasSelection).toBe(true);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");

      // Freehand node is at (100, 100), size (150, 100).
      // Point (110, 190) is inside bounding box rect, but far from the stroke diagonal (which goes 100,100 -> 250,200).
      // Since generic.freehand has no full rect hitbox, the click falls through to the canvas bg.
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: bgRect,
        clientX: 110,
        clientY: 190,
      });

      (window as any).dispatch("mouseup", {
        clientX: 110,
        clientY: 190,
      });

      expect(editor.hasSelection).toBe(false);
    });

    it("clicking on an already-selected generic.freehand node should not start inline editor", () => {
      editor.selectNode(freehandNode.id, false);
      expect(editor.hasSelection).toBe(true);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const nodeEl = container.querySelector(`[data-node-id="${freehandNode.id}"]`);
      expect(nodeEl).not.toBeNull();

      // Click on the node again without dragging (single click)
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: nodeEl,
        clientX: freehandNode.position.x + 20,
        clientY: freehandNode.position.y + 20,
      });

      (window as any).dispatch("mouseup", {
        clientX: freehandNode.position.x + 20,
        clientY: freehandNode.position.y + 20,
      });

      // No inline editor element should be created or attached
      expect(renderer.activeInlineEditor).toBeNull();
      expect(editor.hasSelection).toBe(true);
    });

    it("in freehand mode, clicking on empty canvas should deselect any active selection", () => {
      editor.selectNode(freehandNode.id, false);
      expect(editor.hasSelection).toBe(true);

      // Enable freehand mode
      renderer.setFreehandMode(true);
      expect(renderer.freehandMode).toBe(true);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");

      // Click on empty canvas in freehand mode
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: bgRect,
        clientX: 400,
        clientY: 400,
      });

      // The selection should immediately be cleared upon clicking
      expect(editor.hasSelection).toBe(false);

      // Release mouse without drawing (micro-stroke)
      (window as any).dispatch("mouseup", {
        clientX: 400,
        clientY: 400,
      });

      expect(editor.hasSelection).toBe(false);
    });

    it("should scale stroke points and pathData proportionally when resizing a generic.freehand node", () => {
      editor.selectNode(freehandNode.id, false);

      const oldWidth = freehandNode.size.width;
      const oldHeight = freehandNode.size.height;
      const oldPoints = JSON.parse(JSON.stringify(freehandNode.customData.points));

      const svgEl = container.querySelector(".umlcanvas-svg");

      // Find SE resize handle
      const seHandle = container.querySelector(".umlcanvas-resize-handle.handle-se");
      expect(seHandle).not.toBeNull();

      svgEl?.dispatch("mousedown", {
        button: 0,
        target: seHandle,
        clientX: freehandNode.position.x + oldWidth,
        clientY: freehandNode.position.y + oldHeight,
      });

      // Drag SE handle by +100px width, +50px height
      (window as any).dispatch("mousemove", {
        clientX: freehandNode.position.x + oldWidth + 100,
        clientY: freehandNode.position.y + oldHeight + 50,
      });

      (window as any).dispatch("mouseup", {
        clientX: freehandNode.position.x + oldWidth + 100,
        clientY: freehandNode.position.y + oldHeight + 50,
      });

      expect(freehandNode.size.width).toBe(oldWidth + 100);
      expect(freehandNode.size.height).toBe(oldHeight + 50);

      // Scaled points should be proportionally stretched
      const newPoints = freehandNode.customData.points;
      const lastOldPt = oldPoints[oldPoints.length - 1];
      const lastNewPt = newPoints[newPoints.length - 1];

      const expectedSx = (oldWidth + 100) / oldWidth;
      const expectedSy = (oldHeight + 50) / oldHeight;

      expect(lastNewPt.x).toBeCloseTo(lastOldPt.x * expectedSx, 0);
      expect(lastNewPt.y).toBeCloseTo(lastOldPt.y * expectedSy, 0);

      // Undo should restore original size and points
      editor.undo();
      expect(freehandNode.size.width).toBe(oldWidth);
      expect(freehandNode.size.height).toBe(oldHeight);
    });

    it("should handle P, Shift+P, and V keyboard shortcuts correctly between Draw, Auto Shape, and Select modes", () => {
      // Start in select mode with autoShapeDetection true
      renderer.setFreehandMode(false);
      renderer.setAutoShapeDetection(true);
      expect(renderer.freehandMode).toBe(false);

      // Press Shift+P -> switches to Auto Shape mode (freehand = true, autoShapeDetection = true)
      (window as any).dispatch("keydown", { key: "p", shiftKey: true });
      expect(renderer.freehandMode).toBe(true);
      expect(renderer.isAutoShapeDetection).toBe(true);

      // Press P -> switches to regular Draw mode (freehand = true, autoShapeDetection = false)
      (window as any).dispatch("keydown", { key: "p", shiftKey: false });
      expect(renderer.freehandMode).toBe(true);
      expect(renderer.isAutoShapeDetection).toBe(false);

      // Press Shift+P -> switches to Auto Shape mode (freehand = true, autoShapeDetection = true)
      (window as any).dispatch("keydown", { key: "p", shiftKey: true });
      expect(renderer.freehandMode).toBe(true);
      expect(renderer.isAutoShapeDetection).toBe(true);

      // Press Shift+P again while active -> toggles off to Select mode
      (window as any).dispatch("keydown", { key: "p", shiftKey: true });
      expect(renderer.freehandMode).toBe(false);

      // Press P -> enters regular Draw mode
      (window as any).dispatch("keydown", { key: "p", shiftKey: false });
      expect(renderer.freehandMode).toBe(true);
      expect(renderer.isAutoShapeDetection).toBe(false);

      // Press V -> switches back to Select mode
      (window as any).dispatch("keydown", { key: "v" });
      expect(renderer.freehandMode).toBe(false);
    });
  });
});
