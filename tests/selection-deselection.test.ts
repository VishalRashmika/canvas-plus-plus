import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { DiagramNode } from "../src/domain/entities/DiagramNode";
import { DiagramEdge } from "../src/domain/entities/DiagramEdge";
import { Group } from "../src/domain/entities/Group";

// Mock DOM element for headless Node / Jest environment
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

  setCssStyles(styles: Record<string, string>): void {
    Object.assign(this.style, styles);
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

  focus(): void {}
  select(): void {}

  dispatch(event: string, detail: any = {}): void {
    const handlers = [...(this.listeners[event] || [])];
    const evt = {
      stopPropagation: () => {},
      preventDefault: () => {},
      target: this,
      ...detail,
    };
    handlers.forEach((h) => h(evt));
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
      } else if (selector.includes("[") && selector.includes("]")) {
        const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)\*?=["']?([^"'\]]+)["']?\]/);
        if (attrMatch) {
          const attrName = attrMatch[1];
          const val = attrMatch[2];
          const actual = el.getAttribute(attrName) || "";
          if (actual === val || actual.includes(val)) {
            matches = true;
          }
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

// Setup environment mocks
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

describe("Component Selection and Deselection (Issue #9)", () => {
  let editor: DiagramEditor;
  let container: MockElement;
  let renderer: SvgSceneRenderer;
  let node1: DiagramNode;
  let node2: DiagramNode;
  let edge: DiagramEdge;
  let group: Group;

  beforeEach(() => {
    editor = new DiagramEditor(
      createDiagram({ id: "diag-deselect-test", title: "Deselect Test", diagramType: "general" })
    );

    node1 = editor.addNode({
      kind: "generic.rectangle",
      title: "Service Alpha",
      position: { x: 100, y: 100 },
      size: { width: 140, height: 80 },
    });

    node2 = editor.addNode({
      kind: "generic.rectangle",
      title: "Service Beta",
      position: { x: 350, y: 100 },
      size: { width: 140, height: 80 },
    });

    edge = editor.addEdge(node1.id, node2.id, {
      kind: "uml.association",
    });

    editor.selectNode(node1.id, false);
    group = editor.groupSelection("Services Group")!;

    // Clear initial selection from node additions
    editor.clearSelection();

    container = new MockElement("div", { cls: "umlcanvas-svg-container" });
    renderer = new SvgSceneRenderer(container as any, editor);
  });

  afterEach(() => {
    renderer.destroy();
  });

  describe("Single Component Deselection on Empty Canvas Space Click", () => {
    it("should deselect a single selected node when clicking empty canvas space", () => {
      // Select node1
      editor.selectNode(node1.id, false);
      expect(editor.selectedNodeIds).toEqual([node1.id]);
      expect(editor.hasSelection).toBe(true);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");
      expect(svgEl).not.toBeNull();
      expect(bgRect).not.toBeNull();

      // Click on background rect
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

      // Selection must be cleared
      expect(editor.selectedNodeIds).toEqual([]);
      expect(editor.hasSelection).toBe(false);
    });

    it("should deselect a selected edge when clicking empty canvas space", () => {
      // Select edge
      editor.selectEdge(edge.id, false);
      expect(editor.selectedEdgeIds).toEqual([edge.id]);
      expect(editor.hasSelection).toBe(true);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");

      // Click on empty canvas space
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: bgRect,
        clientX: 20,
        clientY: 20,
      });
      (window as any).dispatch("mouseup", {
        clientX: 20,
        clientY: 20,
      });

      expect(editor.selectedEdgeIds).toEqual([]);
      expect(editor.hasSelection).toBe(false);
    });

    it("should deselect a selected group when clicking empty canvas space", () => {
      // Select group
      editor.selectGroup(group.id, false);
      expect(editor.selectedGroupIds).toEqual([group.id]);
      expect(editor.hasSelection).toBe(true);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");

      // Click on empty canvas space
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: bgRect,
        clientX: 600,
        clientY: 500,
      });
      (window as any).dispatch("mouseup", {
        clientX: 600,
        clientY: 500,
      });

      expect(editor.selectedGroupIds).toEqual([]);
      expect(editor.hasSelection).toBe(false);
    });
  });

  describe("Multiple Components Deselection", () => {
    it("should deselect all nodes when multiple nodes are selected", () => {
      editor.selectNode(node1.id, false);
      editor.selectNode(node2.id, true);
      expect(editor.selectedNodeIds.length).toBe(2);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");

      svgEl?.dispatch("mousedown", {
        button: 0,
        target: bgRect,
        clientX: 30,
        clientY: 30,
      });
      (window as any).dispatch("mouseup", {
        clientX: 30,
        clientY: 30,
      });

      expect(editor.selectedNodeIds).toEqual([]);
      expect(editor.hasSelection).toBe(false);
    });

    it("should deselect mixed selections (nodes + edges + groups)", () => {
      editor.selectNode(node1.id, false);
      editor.selectEdge(edge.id, true);
      editor.selectGroup(group.id, true);
      expect(editor.selectedNodeIds.length).toBe(1);
      expect(editor.selectedEdgeIds.length).toBe(1);
      expect(editor.selectedGroupIds.length).toBe(1);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");

      svgEl?.dispatch("mousedown", {
        button: 0,
        target: bgRect,
        clientX: 10,
        clientY: 10,
      });
      (window as any).dispatch("mouseup", {
        clientX: 10,
        clientY: 10,
      });

      expect(editor.selectedNodeIds).toEqual([]);
      expect(editor.selectedEdgeIds).toEqual([]);
      expect(editor.selectedGroupIds).toEqual([]);
      expect(editor.hasSelection).toBe(false);
    });
  });

  describe("Clicks on Container Fallback", () => {
    it("should deselect when click falls through to the container element", () => {
      editor.selectNode(node1.id, false);
      expect(editor.hasSelection).toBe(true);

      // Dispatch mousedown directly on container (representing click falling through transparent SVG)
      container.dispatch("mousedown", {
        button: 0,
        target: container,
        clientX: 500,
        clientY: 400,
      });
      (window as any).dispatch("mouseup", {
        clientX: 500,
        clientY: 400,
      });

      expect(editor.selectedNodeIds).toEqual([]);
      expect(editor.hasSelection).toBe(false);
    });
  });

  describe("Empty Space Inside Group Boundary", () => {
    it("should deselect selected node when clicking empty canvas space inside group boundary", () => {
      editor.selectNode(node1.id, false);
      expect(editor.selectedNodeIds).toContain(node1.id);

      // The group box rect has pointer-events: stroke, so clicking the canvas background inside the group deselects
      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");

      svgEl?.dispatch("mousedown", {
        button: 0,
        target: bgRect,
        clientX: 120, // inside group boundary, but empty canvas
        clientY: 160,
      });
      (window as any).dispatch("mouseup", {
        clientX: 120,
        clientY: 160,
      });

      expect(editor.selectedNodeIds).toEqual([]);
      expect(editor.hasSelection).toBe(false);
    });
  });

  describe("Toolbar Integration and UI State", () => {
    it("should hide context-sensitive toolbar options when deselected via canvas click", () => {
      const parentView = new MockElement("div", { cls: "umlcanvas-view-container" });
      parentView.appendChild(container);

      const toolbar = new Toolbar(
        parentView as any,
        editor,
        renderer as any
      );

      const contextGroup = parentView.querySelector(".umlcanvas-context-group");
      expect(contextGroup).not.toBeNull();

      // Initially nothing selected -> hidden
      expect(contextGroup?.classList.contains("is-hidden")).toBe(true);

      // Select node
      editor.selectNode(node1.id, false);
      expect(contextGroup?.classList.contains("is-hidden")).toBe(false);

      // Click empty canvas space
      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: bgRect,
        clientX: 40,
        clientY: 40,
      });
      (window as any).dispatch("mouseup", {
        clientX: 40,
        clientY: 40,
      });

      // Context group should now be hidden again
      expect(contextGroup?.classList.contains("is-hidden")).toBe(true);
      expect(editor.hasSelection).toBe(false);

      toolbar.destroy();
    });

    it("should remove selection outline and resize handles from interaction layer after deselect", () => {
      editor.selectNode(node1.id, false);
      let outlines = container.querySelectorAll(".umlcanvas-selection-outline");
      let handles = container.querySelectorAll(".umlcanvas-resize-handle");
      expect(outlines.length).toBeGreaterThan(0);
      expect(handles.length).toBeGreaterThan(0);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: bgRect,
        clientX: 25,
        clientY: 25,
      });
      (window as any).dispatch("mouseup", {
        clientX: 25,
        clientY: 25,
      });

      outlines = container.querySelectorAll(".umlcanvas-selection-outline");
      handles = container.querySelectorAll(".umlcanvas-resize-handle");
      expect(outlines.length).toBe(0);
      expect(handles.length).toBe(0);
    });
  });

  describe("Modifier and Component Click Behaviors", () => {
    it("should NOT deselect when Shift-clicking empty space (additive marquee mode)", () => {
      editor.selectNode(node1.id, false);
      expect(editor.selectedNodeIds).toEqual([node1.id]);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: bgRect,
        clientX: 30,
        clientY: 30,
        shiftKey: true,
      });
      (window as any).dispatch("mouseup", {
        clientX: 30,
        clientY: 30,
      });

      // Selection must be preserved
      expect(editor.selectedNodeIds).toEqual([node1.id]);
    });

    it("should change selection when clicking another component rather than clearing", () => {
      editor.selectNode(node1.id, false);
      expect(editor.selectedNodeIds).toEqual([node1.id]);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const node2El = container.querySelector(`[data-node-id="${node2.id}"]`);
      expect(node2El).not.toBeNull();

      // Click node2
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: node2El,
        clientX: 360,
        clientY: 110,
      });
      (window as any).dispatch("mouseup", {
        clientX: 360,
        clientY: 110,
      });

      // Selection changed to node2
      expect(editor.selectedNodeIds).toEqual([node2.id]);
    });
  });
});
