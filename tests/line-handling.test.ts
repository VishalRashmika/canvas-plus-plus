import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { defaultRoutingService } from "../src/domain/services/RoutingService";
import { rectFromBounds } from "../src/domain/value-objects/Rect";

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

  click(): void {
    const handlers = [...(this.listeners["click"] || [])];
    const event = {
      stopPropagation: () => {},
      preventDefault: () => {},
      target: this,
    };
    handlers.forEach((h) => h(event));
  }

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

// Global DOM setup
const mockDocument = {
  createElement: (tag: string) => new MockElement(tag),
  createElementNS: (_ns: string, tag: string) => new MockElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {},
  elementFromPoint: () => null,
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
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

describe("Task #5: Line Handling & Manipulation Tests", () => {
  let editor: DiagramEditor;
  let container: MockElement;
  let renderer: SvgSceneRenderer;

  beforeEach(() => {
    editor = new DiagramEditor(
      createDiagram({ id: "line-test-diagram", title: "Line Diagram", diagramType: "general" })
    );
    container = new MockElement("div", { cls: "umlcanvas-view-container" });
    renderer = new SvgSceneRenderer(container as any, editor);
  });

  afterEach(() => {
    renderer.destroy();
  });

  describe("1. DiagramEditor Line & Waypoint API", () => {
    it("should select, toggle, and deselect edges properly", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 }, title: "A" });
      const n2 = editor.addNode({ position: { x: 300, y: 50 }, title: "B" });
      const n3 = editor.addNode({ position: { x: 300, y: 300 }, title: "C" });
      const edge1 = editor.addEdge(n1.id, n2.id);
      const edge2 = editor.addEdge(n2.id, n3.id);

      editor.clearSelection();
      expect(editor.selectedEdgeIds).toEqual([]);

      // Select edge1
      editor.selectEdge(edge1.id);
      expect(editor.isEdgeSelected(edge1.id)).toBe(true);
      expect(editor.isEdgeSelected(edge2.id)).toBe(false);

      // Additive select edge2
      editor.selectEdge(edge2.id, true);
      expect(editor.selectedEdgeIds).toContain(edge1.id);
      expect(editor.selectedEdgeIds).toContain(edge2.id);

      // Toggle edge1 off
      editor.toggleEdgeSelection(edge1.id);
      expect(editor.isEdgeSelected(edge1.id)).toBe(false);
      expect(editor.isEdgeSelected(edge2.id)).toBe(true);

      // Toggle edge1 on again
      editor.toggleEdgeSelection(edge1.id);
      expect(editor.isEdgeSelected(edge1.id)).toBe(true);

      // Deselect edge2
      editor.deselectEdge(edge2.id);
      expect(editor.isEdgeSelected(edge2.id)).toBe(false);
      expect(editor.isEdgeSelected(edge1.id)).toBe(true);
    });

    it("should add waypoints at specific indices and remove them with undo/redo", () => {
      const n1 = editor.addNode({ position: { x: 0, y: 0 }, title: "Source" });
      const n2 = editor.addNode({ position: { x: 400, y: 0 }, title: "Target" });
      const edge = editor.addEdge(n1.id, n2.id);

      expect(edge.waypoints).toBeUndefined();

      // Add first waypoint
      editor.addEdgeWaypoint(edge.id, { x: 100, y: 50 });
      expect(edge.waypoints).toEqual([{ x: 100, y: 50 }]);

      // Add second waypoint at end
      editor.addEdgeWaypoint(edge.id, { x: 300, y: 50 });
      expect(edge.waypoints).toEqual([{ x: 100, y: 50 }, { x: 300, y: 50 }]);

      // Insert waypoint in middle (index 1)
      editor.addEdgeWaypoint(edge.id, { x: 200, y: 100 }, 1);
      expect(edge.waypoints).toEqual([
        { x: 100, y: 50 },
        { x: 200, y: 100 },
        { x: 300, y: 50 },
      ]);

      // Remove middle waypoint
      editor.removeEdgeWaypoint(edge.id, 1);
      expect(edge.waypoints).toEqual([{ x: 100, y: 50 }, { x: 300, y: 50 }]);

      // Undo removal
      editor.undo();
      expect(edge.waypoints).toEqual([
        { x: 100, y: 50 },
        { x: 200, y: 100 },
        { x: 300, y: 50 },
      ]);

      // Redo removal
      editor.redo();
      expect(edge.waypoints).toEqual([{ x: 100, y: 50 }, { x: 300, y: 50 }]);
    });

    it("should move edge waypoints and execute MoveEdgesCommand with undo/redo", () => {
      const n1 = editor.addNode({ position: { x: 0, y: 0 }, title: "S" });
      const n2 = editor.addNode({ position: { x: 400, y: 0 }, title: "T" });
      const edge = editor.addEdge(n1.id, n2.id, {
        waypoints: [{ x: 100, y: 50 }, { x: 200, y: 50 }],
      });

      // Move waypoints via moveEdgeWaypoints helper
      editor.moveEdgeWaypoints(edge.id, 20, -10);
      expect(edge.waypoints).toEqual([{ x: 120, y: 40 }, { x: 220, y: 40 }]);

      // Move via moveEdges command (simulating batch or interactive drag)
      editor.moveEdges([
        {
          edgeId: edge.id,
          oldWaypoints: [{ x: 120, y: 40 }, { x: 220, y: 40 }],
          newWaypoints: [{ x: 150, y: 60 }, { x: 250, y: 60 }],
        },
      ]);
      expect(edge.waypoints).toEqual([{ x: 150, y: 60 }, { x: 250, y: 60 }]);

      // Undo
      editor.undo();
      expect(edge.waypoints).toEqual([{ x: 120, y: 40 }, { x: 220, y: 40 }]);

      // Redo
      editor.redo();
      expect(edge.waypoints).toEqual([{ x: 150, y: 60 }, { x: 250, y: 60 }]);
    });

    it("should reroute edge and reverse edge direction properly", () => {
      const n1 = editor.addNode({ position: { x: 10, y: 10 }, title: "From" });
      const n2 = editor.addNode({ position: { x: 500, y: 10 }, title: "To" });
      const edge = editor.addEdge(n1.id, n2.id, {
        waypoints: [{ x: 100, y: 80 }, { x: 300, y: 80 }],
        multiplicitySource: "1",
        multiplicityTarget: "*",
      });

      // Reverse edge
      editor.reverseEdge(edge.id);
      expect(edge.fromNodeId).toBe(n2.id);
      expect(edge.toNodeId).toBe(n1.id);
      expect(edge.waypoints).toEqual([{ x: 300, y: 80 }, { x: 100, y: 80 }]);
      expect(edge.multiplicitySource).toBe("*");
      expect(edge.multiplicityTarget).toBe("1");

      // Undo reverse
      editor.undo();
      expect(edge.fromNodeId).toBe(n1.id);
      expect(edge.toNodeId).toBe(n2.id);
      expect(edge.waypoints).toEqual([{ x: 100, y: 80 }, { x: 300, y: 80 }]);

      // Reroute edge (clears manual waypoints)
      editor.rerouteEdge(edge.id);
      expect(edge.waypoints).toBeUndefined();

      // Undo reroute
      editor.undo();
      expect(edge.waypoints).toEqual([{ x: 100, y: 80 }, { x: 300, y: 80 }]);
    });

    it("should select edges inside marquee selection area", () => {
      const n1 = editor.addNode({ position: { x: 0, y: 0 }, size: { width: 40, height: 40 } });
      const n2 = editor.addNode({ position: { x: 400, y: 0 }, size: { width: 40, height: 40 } });
      const edge = editor.addEdge(n1.id, n2.id, {
        waypoints: [{ x: 200, y: 200 }],
      });

      editor.clearSelection();

      // Marquee box that crosses the edge waypoint (150, 150) to (250, 250)
      editor.selectArea(rectFromBounds(150, 150, 100, 100));
      expect(editor.isEdgeSelected(edge.id)).toBe(true);

      // Marquee box far away in empty space
      editor.selectArea(rectFromBounds(800, 800, 50, 50));
      expect(editor.isEdgeSelected(edge.id)).toBe(false);
    });

    it("should duplicate and copy-paste an edge as a whole", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 }, title: "N1" });
      const n2 = editor.addNode({ position: { x: 300, y: 50 }, title: "N2" });
      const edge = editor.addEdge(n1.id, n2.id, {
        waypoints: [{ x: 150, y: 100 }],
      });

      editor.clearSelection();
      editor.selectEdge(edge.id, false);

      const duplicated = editor.duplicateSelection({ x: 25, y: 25 });
      expect(duplicated.edges.length).toBe(1);
      expect(editor.diagram.edges.length).toBe(2);

      const newEdge = duplicated.edges[0];
      expect(newEdge.id).not.toBe(edge.id);
      expect(newEdge.fromNodeId).toBe(n1.id);
      expect(newEdge.toNodeId).toBe(n2.id);
      expect(newEdge.waypoints).toEqual([{ x: 175, y: 125 }]);
    });
  });

  describe("2. Orthogonal Routing with Waypoints", () => {
    it("should route orthogonally through manual waypoints without diagonal jumps", () => {
      const source = {
        position: { x: 50, y: 50 },
        size: { width: 100, height: 60 },
        side: "right" as const,
      };
      const target = {
        position: { x: 350, y: 250 },
        size: { width: 100, height: 60 },
        side: "left" as const,
      };

      const routingResult = defaultRoutingService.route(source, target, {
        routing: "orthogonal",
        manualWaypoints: [{ x: 220, y: 180 }],
      });

      expect(routingResult.points.length).toBeGreaterThanOrEqual(4);

      // Verify that every segment is strictly horizontal or vertical
      for (let i = 0; i < routingResult.points.length - 1; i++) {
        const p1 = routingResult.points[i];
        const p2 = routingResult.points[i + 1];
        const isHoriz = Math.abs(p1.y - p2.y) < 0.1;
        const isVert = Math.abs(p1.x - p2.x) < 0.1;
        expect(isHoriz || isVert).toBe(true);
      }
    });
  });

  describe("3. SvgSceneRenderer UI & Interactive Manipulation", () => {
    it("should render endpoint handles, waypoint handles, and segment midpoint handles for selected edge", () => {
      const n1 = editor.addNode({ position: { x: 40, y: 40 }, size: { width: 100, height: 60 } });
      const n2 = editor.addNode({ position: { x: 350, y: 40 }, size: { width: 100, height: 60 } });
      const edge = editor.addEdge(n1.id, n2.id, {
        waypoints: [{ x: 200, y: 120 }],
      });

      editor.selectEdge(edge.id, false);

      const svgEl = container.querySelector(".umlcanvas-svg");
      expect(svgEl).not.toBeNull();

      // Check endpoint handles
      const sourceHandle = container.querySelector(".handle-source");
      const targetHandle = container.querySelector(".handle-target");
      expect(sourceHandle).not.toBeNull();
      expect(targetHandle).not.toBeNull();

      // Check waypoint handle
      const wpHandle = container.querySelector(".umlcanvas-edge-waypoint-handle");
      expect(wpHandle).not.toBeNull();
      expect(wpHandle?.getAttribute("data-waypoint-index")).toBe("0");

      // Check midpoint handles
      const midpointHandles = container.querySelectorAll(".umlcanvas-edge-midpoint-handle");
      expect(midpointHandles.length).toBeGreaterThanOrEqual(1);
    });

    it("should insert and drag a new waypoint when dragging a midpoint handle", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 }, size: { width: 80, height: 60 } });
      const n2 = editor.addNode({ position: { x: 400, y: 50 }, size: { width: 80, height: 60 } });
      const edge = editor.addEdge(n1.id, n2.id, { routing: "straight" });

      editor.selectEdge(edge.id, false);

      const midHandle = container.querySelector(".umlcanvas-edge-midpoint-handle");
      expect(midHandle).not.toBeNull();
      const midX = parseFloat(midHandle?.getAttribute("data-midpoint-x")!);
      const midY = parseFloat(midHandle?.getAttribute("data-midpoint-y")!);

      const svgEl = container.querySelector(".umlcanvas-svg");

      // Mouse down on midpoint handle
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: midHandle,
        clientX: midX,
        clientY: midY,
      });

      // Midpoint should now be inserted as a waypoint
      expect(edge.waypoints).toBeDefined();
      expect(edge.waypoints?.length).toBe(1);

      // Drag waypoint 40px down
      (window as any).dispatch("mousemove", {
        clientX: midX,
        clientY: midY + 40,
      });

      // Mouse up to commit
      (window as any).dispatch("mouseup", {
        clientX: midX,
        clientY: midY + 40,
      });

      expect(edge.waypoints?.length).toBe(1);
      expect(edge.waypoints?.[0].y).toBe(Math.round(midY + 40));

      // Test undo restores no waypoints
      editor.undo();
      expect(edge.waypoints).toBeUndefined();
    });

    it("should remove waypoint on double click of waypoint handle", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 }, size: { width: 80, height: 60 } });
      const n2 = editor.addNode({ position: { x: 400, y: 50 }, size: { width: 80, height: 60 } });
      const edge = editor.addEdge(n1.id, n2.id, {
        waypoints: [{ x: 220, y: 150 }],
      });

      editor.selectEdge(edge.id, false);

      const wpHandle = container.querySelector(".umlcanvas-edge-waypoint-handle");
      expect(wpHandle).not.toBeNull();

      const svgEl = container.querySelector(".umlcanvas-svg");

      // Double-click on waypoint handle
      svgEl?.dispatch("dblclick", {
        target: wpHandle,
        clientX: 220,
        clientY: 150,
      });

      expect(edge.waypoints).toBeUndefined();

      // Undo restores it
      editor.undo();
      expect(edge.waypoints).toEqual([{ x: 220, y: 150 }]);
    });

    it("should remove waypoint on Alt+click of waypoint handle", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 }, size: { width: 80, height: 60 } });
      const n2 = editor.addNode({ position: { x: 400, y: 50 }, size: { width: 80, height: 60 } });
      const edge = editor.addEdge(n1.id, n2.id, {
        waypoints: [{ x: 220, y: 150 }],
      });

      editor.selectEdge(edge.id, false);

      const wpHandle = container.querySelector(".umlcanvas-edge-waypoint-handle");
      expect(wpHandle).not.toBeNull();

      const svgEl = container.querySelector(".umlcanvas-svg");

      // Alt+click on waypoint handle
      svgEl?.dispatch("mousedown", {
        button: 0,
        altKey: true,
        target: wpHandle,
        clientX: 220,
        clientY: 150,
      });

      expect(edge.waypoints).toBeUndefined();
    });

    it("should move the line when dragging an edge with existing waypoints", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 }, size: { width: 80, height: 60 } });
      const n2 = editor.addNode({ position: { x: 400, y: 50 }, size: { width: 80, height: 60 } });
      const edge = editor.addEdge(n1.id, n2.id, {
        waypoints: [{ x: 200, y: 100 }],
      });

      editor.selectEdge(edge.id, false);

      const edgeEl = container.querySelector(`[data-edge-id="${edge.id}"]`);
      expect(edgeEl).not.toBeNull();

      const svgEl = container.querySelector(".umlcanvas-svg");

      // Mouse down on edge
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: edgeEl,
        clientX: 200,
        clientY: 100,
      });

      // Mouse move 30px down, 20px right
      (window as any).dispatch("mousemove", {
        clientX: 220,
        clientY: 130,
      });

      // Mouse up to commit
      (window as any).dispatch("mouseup", {
        clientX: 220,
        clientY: 130,
      });

      expect(edge.waypoints).toEqual([{ x: 220, y: 130 }]);

      // Undo restores original waypoint
      editor.undo();
      expect(edge.waypoints).toEqual([{ x: 200, y: 100 }]);
    });

    it("should reroute/bend line when dragging an edge that has no waypoints yet", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 }, size: { width: 80, height: 60 } });
      const n2 = editor.addNode({ position: { x: 400, y: 50 }, size: { width: 80, height: 60 } });
      const edge = editor.addEdge(n1.id, n2.id, { routing: "straight" });

      expect(edge.waypoints).toBeUndefined();

      const edgeEl = container.querySelector(`[data-edge-id="${edge.id}"]`);
      const svgEl = container.querySelector(".umlcanvas-svg");

      // Mouse down on edge
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: edgeEl,
        clientX: 225,
        clientY: 50,
      });

      // Drag line down 50px
      (window as any).dispatch("mousemove", {
        clientX: 225,
        clientY: 100,
      });

      // Mouse up
      (window as any).dispatch("mouseup", {
        clientX: 225,
        clientY: 100,
      });

      expect(edge.waypoints).toBeDefined();
      expect(edge.waypoints?.length).toBe(1);
      expect(edge.waypoints?.[0].y).toBeGreaterThan(50);
    });

    it("should nudge edge waypoints using keyboard arrow keys", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 }, size: { width: 80, height: 60 } });
      const n2 = editor.addNode({ position: { x: 400, y: 50 }, size: { width: 80, height: 60 } });
      const edge = editor.addEdge(n1.id, n2.id, {
        waypoints: [{ x: 200, y: 100 }],
      });

      editor.clearSelection();
      editor.selectEdge(edge.id, false);

      // Press ArrowDown
      (window as any).dispatch("keydown", {
        key: "ArrowDown",
      });

      expect(edge.waypoints).toEqual([{ x: 200, y: 105 }]);

      // Press ArrowRight with Shift (step = 20)
      (window as any).dispatch("keydown", {
        key: "ArrowRight",
        shiftKey: true,
      });

      expect(edge.waypoints).toEqual([{ x: 220, y: 105 }]);

      // Undo
      editor.undo();
      expect(edge.waypoints).toEqual([{ x: 200, y: 105 }]);
      editor.undo();
      expect(edge.waypoints).toEqual([{ x: 200, y: 100 }]);
    });
  });

  describe("4. Toolbar Integration for Lines", () => {
    it("should show '1 Edge' in toolbar context group and provide routing and reroute buttons", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const edge = editor.addEdge(n1.id, n2.id, { routing: "orthogonal" });

      const toolbar = new Toolbar(container as any, editor, renderer);

      editor.clearSelection();
      expect(container.querySelector(".umlcanvas-context-group")?.classList.contains("is-hidden")).toBe(true);

      // Select edge
      editor.selectEdge(edge.id, false);

      const contextGroup = container.querySelector(".umlcanvas-context-group");
      expect(contextGroup?.classList.contains("is-hidden")).toBe(false);

      const badge = container.querySelector(".umlcanvas-selection-badge");
      expect(badge?.textContent).toBe("1 Edge");

      // Find edge routing button in context menu
      const edgeRouteBtn = contextGroup?.querySelectorAll("button").find((b) => b.title.includes("Change Line Routing"));
      expect(edgeRouteBtn).toBeDefined();

      // Click to cycle routing: orthogonal -> straight
      edgeRouteBtn?.click();
      expect(edge.routing).toBe("straight");

      // Click to cycle routing: straight -> curved
      edgeRouteBtn?.click();
      expect(edge.routing).toBe("curved");

      // Reroute button
      const rerouteBtn = contextGroup?.querySelectorAll("button").find((b) => b.title.includes("Reroute Line"));
      expect(rerouteBtn).toBeDefined();

      edge.waypoints = [{ x: 100, y: 100 }];
      rerouteBtn?.click();
      expect(edge.waypoints).toBeUndefined();

      toolbar.destroy();
    });
  });
});
