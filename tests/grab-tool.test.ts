import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";

// Mock Element for Jest test environment
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
  title: string = "";
  disabled: boolean = false;
  value: string = "";
  clientWidth: number = 1000;
  clientHeight: number = 800;

  constructor(tagName: string, options?: any) {
    this.tagName = tagName.toUpperCase();
    if (options?.cls) {
      this.classList.add(options.cls);
    }
    if (options?.text) {
      this.textContent = options.text;
    }
    if (options?.title) {
      this.title = options.title;
    }
    if (options?.value) {
      this.value = options.value;
    }
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

  prepend(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.unshift(child);
    return child;
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        this.parentElement.children.splice(idx, 1);
      }
      this.parentElement = null;
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") {
      this.classList.add(...value.split(" "));
    }
  }

  setAttributeNS(_ns: any, name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") {
      this.classList.add(...value.split(" "));
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  setCssStyles(styles: Record<string, string>): void {
    Object.assign(this.style, styles);
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

  dispatch(event: string, eventObj: any = {}): void {
    const handlers = [...(this.listeners[event] || [])];
    const fullEvent = {
      stopPropagation: () => {},
      preventDefault: () => {},
      target: this,
      clientX: 0,
      clientY: 0,
      button: 0,
      ...eventObj,
    };
    handlers.forEach((h) => h(fullEvent));
  }

  click(): void {
    this.dispatch("click");
  }

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
    };
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

  private _textContent: string = "";
  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map((c) => c.textContent).join("");
  }
  set textContent(val: string) {
    this._textContent = val;
    if (val === "") {
      this.children = [];
    }
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const check = (el: MockElement) => {
      let matches = false;
      if (selector.startsWith(".")) {
        const cls = selector.slice(1);
        if (el.classList.contains(cls)) matches = true;
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

// Global DOM setup
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
  dispatch: (event: string, eventObj: any = {}) => {
    const handlers = [...(windowListeners[event] || [])];
    const fullEvent = {
      stopPropagation: () => {},
      preventDefault: () => {},
      ...eventObj,
    };
    handlers.forEach((h) => h(fullEvent));
  },
};

(global as any).document = {
  createElementNS: (_ns: string, tag: string) => new MockElement(tag),
  createElement: (tag: string) => new MockElement(tag),
};

(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

describe("Grab Tool & Canvas Move Feature", () => {
  let editor: DiagramEditor;
  let rootContainer: MockElement;
  let svgContainer: MockElement;
  let renderer: SvgSceneRenderer;
  let toolbar: Toolbar;

  beforeEach(() => {
    const diagram = createDiagram({ id: "grab-diag", title: "Grab Diagram", diagramType: "uml.class" });
    editor = new DiagramEditor(diagram);
    rootContainer = new MockElement("div", { cls: "umlcanvas-view-container" });
    svgContainer = rootContainer.createDiv({ cls: "umlcanvas-svg-container" });

    renderer = new SvgSceneRenderer(svgContainer as any, editor, {
      onModeChange: () => {
        if (toolbar) {
          toolbar.updateToolMode();
        }
      },
    });

    toolbar = new Toolbar(rootContainer as any, editor, renderer);
  });

  afterEach(() => {
    toolbar.destroy();
    renderer.destroy();
  });

  it("should have Grab tool button in floating bottom toolbar with icon-only class", () => {
    const bottomToolbar = rootContainer.querySelector(".umlcanvas-floating-bottom-toolbar");
    expect(bottomToolbar).not.toBeNull();

    const buttons = bottomToolbar?.querySelectorAll("button") || [];
    const grabBtn = buttons.find((b) => b.title.includes("Grab"));

    expect(grabBtn).toBeDefined();
    expect(grabBtn?.title).toContain("Grab / Move Canvas");
    expect(grabBtn?.classList.contains("is-icon-only")).toBe(true);
  });

  it("should toggle between select tool and grab tool on button click", () => {
    const bottomToolbar = rootContainer.querySelector(".umlcanvas-floating-bottom-toolbar");
    const buttons = bottomToolbar?.querySelectorAll("button") || [];
    const selectBtn = buttons.find((b) => b.title.includes("Select"));
    const grabBtn = buttons.find((b) => b.title.includes("Grab"));

    expect(selectBtn?.classList.contains("is-active")).toBe(true);
    expect(grabBtn?.classList.contains("is-active")).toBe(false);
    expect(renderer.grabMode).toBe(false);
    expect(svgContainer.classList.contains("umlcanvas-grab-mode")).toBe(false);

    // Click Grab button
    grabBtn?.click();
    expect(renderer.grabMode).toBe(true);
    expect(grabBtn?.classList.contains("is-active")).toBe(true);
    expect(selectBtn?.classList.contains("is-active")).toBe(false);
    expect(svgContainer.classList.contains("umlcanvas-grab-mode")).toBe(true);

    // Click Grab button again -> toggles off back to select
    grabBtn?.click();
    expect(renderer.grabMode).toBe(false);
    expect(selectBtn?.classList.contains("is-active")).toBe(true);
    expect(grabBtn?.classList.contains("is-active")).toBe(false);
    expect(svgContainer.classList.contains("umlcanvas-grab-mode")).toBe(false);

    // Click Grab button -> then click Select button
    grabBtn?.click();
    expect(renderer.grabMode).toBe(true);
    selectBtn?.click();
    expect(renderer.grabMode).toBe(false);
    expect(selectBtn?.classList.contains("is-active")).toBe(true);
    expect(grabBtn?.classList.contains("is-active")).toBe(false);
  });

  it("should pan canvas by clicking and dragging when grab tool is selected without pressing space bar", () => {
    // Enable grab mode
    renderer.setGrabMode(true);
    expect(renderer.grabMode).toBe(true);

    const initialTransform = renderer.currentTransform;
    expect(initialTransform.panX).toBe(0);
    expect(initialTransform.panY).toBe(0);

    const svgEl = svgContainer.querySelector(".umlcanvas-svg");
    expect(svgEl).not.toBeNull();

    // 1. Mouse down with left click (button: 0) - NO space bar!
    svgEl?.dispatch("mousedown", {
      button: 0,
      clientX: 200,
      clientY: 150,
    });

    expect(svgContainer.classList.contains("umlcanvas-panning")).toBe(true);

    // 2. Drag mouse to clientX: 250, clientY: 180 (delta +50, +30)
    (window as any).dispatch("mousemove", {
      clientX: 250,
      clientY: 180,
    });

    const draggedTransform = renderer.currentTransform;
    expect(draggedTransform.panX).toBe(50);
    expect(draggedTransform.panY).toBe(30);

    // 3. Mouse up to end drag
    (window as any).dispatch("mouseup", {
      clientX: 250,
      clientY: 180,
    });

    expect(svgContainer.classList.contains("umlcanvas-panning")).toBe(false);
    // Canvas transform remains moved
    expect(renderer.currentTransform.panX).toBe(50);
    expect(renderer.currentTransform.panY).toBe(30);

    // Grab mode is still active for subsequent pan operations
    expect(renderer.grabMode).toBe(true);
    expect(svgContainer.classList.contains("umlcanvas-grab-mode")).toBe(true);
  });

  it("should pan canvas when clicking over a node while grab tool is active rather than moving or selecting the node", () => {
    // Add a node at position (100, 100)
    const node = editor.addNode({
      title: "Test Node",
      position: { x: 100, y: 100 },
      size: { width: 140, height: 80 },
    });
    editor.clearSelection();
    expect(editor.selectedNodeIds).toEqual([]);

    // Enable grab mode
    renderer.setGrabMode(true);

    const svgEl = svgContainer.querySelector(".umlcanvas-svg");
    const nodeEl = svgContainer.querySelector(".umlcanvas-node");
    expect(nodeEl).not.toBeNull();

    // Mouse down over the node element
    svgEl?.dispatch("mousedown", {
      button: 0,
      target: nodeEl,
      clientX: 120,
      clientY: 120,
    });

    // Panning begins immediately
    expect(svgContainer.classList.contains("umlcanvas-panning")).toBe(true);

    // Drag canvas
    (window as any).dispatch("mousemove", {
      clientX: 170,
      clientY: 140,
    });

    // Node was NOT moved; canvas transform was moved!
    const updatedNode = editor.diagram.nodes.find((n) => n.id === node.id);
    expect(updatedNode?.position.x).toBe(100);
    expect(updatedNode?.position.y).toBe(100);

    expect(renderer.currentTransform.panX).toBe(50);
    expect(renderer.currentTransform.panY).toBe(20);

    // Release mouse
    (window as any).dispatch("mouseup", {
      clientX: 170,
      clientY: 140,
    });

    // Node should NOT be selected
    expect(editor.selectedNodeIds).toEqual([]);
  });

  it("should support keyboard shortcut H to toggle grab tool", () => {
    expect(renderer.grabMode).toBe(false);

    // Press 'H'
    (window as any).dispatch("keydown", { key: "h" });
    expect(renderer.grabMode).toBe(true);

    // Press 'H' again
    (window as any).dispatch("keydown", { key: "h" });
    expect(renderer.grabMode).toBe(false);
  });

  it("should exit grab tool when pressing Escape or V", () => {
    renderer.setGrabMode(true);
    expect(renderer.grabMode).toBe(true);

    // Press Escape
    (window as any).dispatch("keydown", { key: "Escape" });
    expect(renderer.grabMode).toBe(false);

    // Re-enable grab mode
    renderer.setGrabMode(true);
    expect(renderer.grabMode).toBe(true);

    // Press V
    (window as any).dispatch("keydown", { key: "v" });
    expect(renderer.grabMode).toBe(false);
  });

  it("should switch from grab mode to freehand mode when Draw tool is selected", () => {
    renderer.setGrabMode(true);
    expect(renderer.grabMode).toBe(true);

    const bottomToolbar = rootContainer.querySelector(".umlcanvas-floating-bottom-toolbar");
    const buttons = bottomToolbar?.querySelectorAll("button") || [];
    const drawBtn = buttons.find((b) => b.title.includes("Draw"));

    drawBtn?.click();
    expect(renderer.grabMode).toBe(false);
    expect(renderer.freehandMode).toBe(true);
  });
});
