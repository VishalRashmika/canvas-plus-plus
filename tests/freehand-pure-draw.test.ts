import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { DEFAULT_SETTINGS } from "../src/infrastructure/obsidian/PluginSettings";
import { UmlCanvasView } from "../src/presentation/views/UmlCanvasView";

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
    toggle: (c: string, force?: boolean) => {
      const willHave = force !== undefined ? force : !this.classList.classes.has(c);
      if (willHave) this.classList.classes.add(c);
      else this.classList.classes.delete(c);
      this.className = Array.from(this.classList.classes).join(" ");
      return willHave;
    },
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

  createDiv(options?: any): MockElement {
    const el = new MockElement("div", options);
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
    return this._textContent;
  }
  set textContent(val: string) {
    this._textContent = val;
  }

  querySelector(selector: string): MockElement | null {
    if (selector.startsWith(".")) {
      const cls = selector.substring(1);
      for (const child of this.children) {
        if (child.classList.contains(cls)) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
    } else if (selector.startsWith("[data-node-id=")) {
      const id = selector.match(/\[data-node-id="([^"]+)"\]/)?.[1];
      for (const child of this.children) {
        if (child.getAttribute("data-node-id") === id) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    if (selector.startsWith(".")) {
      const cls = selector.substring(1);
      for (const child of this.children) {
        if (child.classList.contains(cls)) results.push(child);
        results.push(...child.querySelectorAll(selector));
      }
    }
    return results;
  }

  closest(selector: string): MockElement | null {
    if (selector.startsWith(".")) {
      const cls = selector.substring(1);
      if (this.classList.contains(cls)) return this;
    }
    return this.parentElement ? this.parentElement.closest(selector) : null;
  }
}

describe("Pure Freehand Draw Tool Mode", () => {
  let editor: DiagramEditor;
  let container: MockElement;
  let renderer: SvgSceneRenderer;

  beforeEach(() => {
    (global as any).document = {
      createElementNS: (_ns: string, tag: string) => new MockElement(tag),
      createElement: (tag: string) => new MockElement(tag),
    };
    (global as any).window = {
      listeners: {} as Record<string, ((e: any) => void)[]>,
      addEventListener(event: string, handler: (e: any) => void) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(handler);
      },
      removeEventListener(event: string, handler: (e: any) => void) {
        if (this.listeners[event]) {
          this.listeners[event] = this.listeners[event].filter((h: any) => h !== handler);
        }
      },
      dispatch(event: string, detail: any = {}) {
        const handlers = [...(this.listeners[event] || [])];
        const evt = { stopPropagation: () => {}, preventDefault: () => {}, ...detail };
        handlers.forEach((h) => h(evt));
      },
    };

    editor = new DiagramEditor(createDiagram({ id: "diag-pure-freehand", diagramType: "general" }));
    container = new MockElement("div", { cls: "umlcanvas-svg-container" });
    renderer = new SvgSceneRenderer(container as any, editor, {
      enableFreehand: true,
      onStrokeComplete: (stroke, opts) => {
        const autoDetect = opts?.autoDetect ?? renderer.isAutoShapeDetection ?? false;
        if (autoDetect) {
          editor.snapStrokeToShape(stroke, { select: false, fallbackToFreehand: true });
        } else {
          editor.keepAsFreehand(stroke, { select: false });
        }
      },
    });
  });

  afterEach(() => {
    renderer.destroy();
  });

  it("should have autoShapeDetection set to false by default in DEFAULT_SETTINGS and renderer", () => {
    expect(DEFAULT_SETTINGS.autoShapeDetection).toBe(false);
    expect(renderer.isAutoShapeDetection).toBe(false);
  });

  it("should stay purely freehand and NOT auto-format or add shape when drawing a rectangle in freehand draw mode", () => {
    renderer.setFreehandMode(true);
    expect(renderer.freehandMode).toBe(true);
    expect(renderer.isAutoShapeDetection).toBe(false);

    const svgEl = container.querySelector(".umlcanvas-svg");
    const bgRect = container.querySelector(".umlcanvas-bg");

    // Draw a rectangle stroke: (50, 50) -> (200, 50) -> (200, 150) -> (50, 150) -> (50, 50)
    svgEl?.dispatch("mousedown", { button: 0, target: bgRect, clientX: 50, clientY: 50 });
    (window as any).dispatch("mousemove", { clientX: 200, clientY: 50 });
    (window as any).dispatch("mousemove", { clientX: 200, clientY: 150 });
    (window as any).dispatch("mousemove", { clientX: 50, clientY: 150 });
    (window as any).dispatch("mousemove", { clientX: 50, clientY: 50 });
    (window as any).dispatch("mouseup", { clientX: 50, clientY: 50 });

    expect(editor.diagram.nodes.length).toBe(1);
    const node = editor.diagram.nodes[0];
    expect(node.kind).toBe("generic.freehand");
    expect(node.kind).not.toBe("generic.rectangle");
  });

  it("should stay purely freehand and NOT auto-format or add shape when drawing a circle in freehand draw mode", () => {
    renderer.setFreehandMode(true);

    const svgEl = container.querySelector(".umlcanvas-svg");
    const bgRect = container.querySelector(".umlcanvas-bg");

    // Draw a circle stroke
    const cx = 150;
    const cy = 150;
    const r = 50;
    const numPts = 16;
    svgEl?.dispatch("mousedown", { button: 0, target: bgRect, clientX: cx + r, clientY: cy });
    for (let i = 1; i <= numPts; i++) {
      const theta = (i / numPts) * 2 * Math.PI;
      (window as any).dispatch("mousemove", {
        clientX: cx + r * Math.cos(theta),
        clientY: cy + r * Math.sin(theta),
      });
    }
    (window as any).dispatch("mouseup", { clientX: cx + r, clientY: cy });

    expect(editor.diagram.nodes.length).toBe(1);
    const node = editor.diagram.nodes[0];
    expect(node.kind).toBe("generic.freehand");
    expect(node.kind).not.toBe("generic.circle");
  });

  it("should NOT create edges or connectors between nodes when drawing a line in freehand draw mode", () => {
    // Add two existing nodes
    const n1 = editor.addNode({ kind: "generic.rectangle", position: { x: 50, y: 50 }, size: { width: 100, height: 60 } });
    const n2 = editor.addNode({ kind: "generic.rectangle", position: { x: 300, y: 50 }, size: { width: 100, height: 60 } });
    expect(editor.diagram.nodes.length).toBe(2);
    expect(editor.diagram.edges.length).toBe(0);

    renderer.setFreehandMode(true);
    const svgEl = container.querySelector(".umlcanvas-svg");
    const bgRect = container.querySelector(".umlcanvas-bg");

    // Draw a line connecting the two nodes: (150, 80) to (300, 80)
    svgEl?.dispatch("mousedown", { button: 0, target: bgRect, clientX: 150, clientY: 80 });
    (window as any).dispatch("mousemove", { clientX: 220, clientY: 80 });
    (window as any).dispatch("mousemove", { clientX: 300, clientY: 80 });
    (window as any).dispatch("mouseup", { clientX: 300, clientY: 80 });

    // Must NOT add an edge between n1 and n2!
    expect(editor.diagram.edges.length).toBe(0);
    // Must add purely a freehand node
    expect(editor.diagram.nodes.length).toBe(3);
    const freehandNode = editor.diagram.nodes.find((n) => n.kind === "generic.freehand");
    expect(freehandNode).toBeDefined();
  });

  it("should NOT add nodes on double-click when in freehand draw mode", () => {
    renderer.setFreehandMode(true);
    expect(renderer.freehandMode).toBe(true);
    expect(editor.diagram.nodes.length).toBe(0);

    const svgEl = container.querySelector(".umlcanvas-svg");
    const bgRect = container.querySelector(".umlcanvas-bg");

    // Double-click on canvas in freehand mode
    svgEl?.dispatch("dblclick", { button: 0, target: bgRect, clientX: 200, clientY: 200 });

    // No node should be added on double-click in freehand mode!
    expect(editor.diagram.nodes.length).toBe(0);
  });

  it("should NOT convert to shapes even if Shift key is held while drawing in freehand draw mode", () => {
    renderer.setFreehandMode(true);
    expect(renderer.isAutoShapeDetection).toBe(false);

    const svgEl = container.querySelector(".umlcanvas-svg");
    const bgRect = container.querySelector(".umlcanvas-bg");

    // Draw a rectangle while holding Shift
    svgEl?.dispatch("mousedown", { button: 0, target: bgRect, clientX: 100, clientY: 100, shiftKey: true });
    (window as any).dispatch("mousemove", { clientX: 250, clientY: 100, shiftKey: true });
    (window as any).dispatch("mousemove", { clientX: 250, clientY: 200, shiftKey: true });
    (window as any).dispatch("mousemove", { clientX: 100, clientY: 200, shiftKey: true });
    (window as any).dispatch("mousemove", { clientX: 100, clientY: 100, shiftKey: true });
    (window as any).dispatch("mouseup", { clientX: 100, clientY: 100, shiftKey: true });

    expect(editor.diagram.nodes.length).toBe(1);
    const node = editor.diagram.nodes[0];
    expect(node.kind).toBe("generic.freehand");
  });

  it("should preserve single-click dots and small ticks cleanly in freehand draw mode", () => {
    renderer.setFreehandMode(true);

    const svgEl = container.querySelector(".umlcanvas-svg");
    const bgRect = container.querySelector(".umlcanvas-bg");

    // Click to draw a dot
    svgEl?.dispatch("mousedown", { button: 0, target: bgRect, clientX: 150, clientY: 150 });
    (window as any).dispatch("mouseup", { clientX: 150, clientY: 150 });

    expect(editor.diagram.nodes.length).toBe(1);
    expect(editor.diagram.nodes[0].kind).toBe("generic.freehand");
    expect(editor.diagram.nodes[0].position).toEqual({ x: 150, y: 150 });
  });

  it("should reset autoShapeDetection to false when exiting freehand mode", () => {
    renderer.setAutoShapeDetection(true);
    renderer.setFreehandMode(true);
    expect(renderer.freehandMode).toBe(true);
    expect(renderer.isAutoShapeDetection).toBe(true);

    // Switch to select mode
    renderer.setFreehandMode(false);
    expect(renderer.freehandMode).toBe(false);
    expect(renderer.isAutoShapeDetection).toBe(false);
  });
});
