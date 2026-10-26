import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { defaultRoutingService } from "../src/domain/services/RoutingService";
import { rectFromBounds } from "../src/domain/value-objects/Rect";
import { SvgExporter } from "../src/infrastructure/export/SvgExporter";
import { defaultEdgeStyleRegistry } from "../src/presentation/renderer/EdgeStyleRegistry";
import { classDiagramDefinition } from "../src/domain/services/DiagramTypeRegistry";
import { UmlCanvasView } from "../src/presentation/views/UmlCanvasView";
import { Stroke } from "../src/domain/services/ShapeRecognizer";
import { JsonCanvasExporter } from "../src/infrastructure/export/JsonCanvasExporter";
import { JsonCanvasImporter } from "../src/infrastructure/persistence/JsonCanvasImporter";

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
    if (val === "") {
      this.children = [];
    }
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const trimmed = selector.trim();
    if (trimmed.includes(" ")) {
      const parts = trimmed.split(/\s+/);
      let current: MockElement[] = [this];
      for (const part of parts) {
        const next: MockElement[] = [];
        for (const el of current) {
          next.push(...el.querySelectorAll(part));
        }
        current = next;
      }
      return current;
    }

    const results: MockElement[] = [];
    const check = (el: MockElement) => {
      let matches = false;
      if (trimmed.startsWith(".")) {
        const cls = trimmed.slice(1);
        if (el.classList.contains(cls)) matches = true;
      } else if (trimmed.startsWith("#")) {
        const id = trimmed.slice(1);
        if (el.getAttribute("id") === id) matches = true;
      } else if (trimmed.includes("[") && trimmed.includes("]")) {
        const attrMatch = trimmed.match(/\[([a-zA-Z0-9_-]+)\*?=["']?([^"'\]]+)["']?\]/);
        if (attrMatch) {
          const attrName = attrMatch[1];
          const val = attrMatch[2];
          const actual = el.getAttribute(attrName) || "";
          if (actual === val || actual.includes(val)) {
            matches = true;
          }
        }
      } else if (trimmed.toLowerCase() === el.tagName.toLowerCase()) {
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

  contains(child: MockElement | null): boolean {
    let curr: MockElement | null = child;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
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

  describe("5. UML Class Diagram Connector Types & Markers", () => {
    it("should register diamond markers with correct refX (12) for aggregation and composition", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      expect(svgEl).not.toBeNull();

      const markers = svgEl?.querySelectorAll("marker") || [];
      const hollowDiamond = markers.find((m) => m.getAttribute("id") === "uml-marker-diamond-hollow");
      const filledDiamond = markers.find((m) => m.getAttribute("id") === "uml-marker-diamond-filled");

      expect(hollowDiamond).toBeDefined();
      expect(hollowDiamond?.getAttribute("refX")).toBe("12");
      expect(hollowDiamond?.getAttribute("refY")).toBe("5");
      expect(hollowDiamond?.getAttribute("viewBox")).toBe("0 0 12 10");
      expect(hollowDiamond?.getAttribute("orient")).toBe("auto-start-reverse");

      expect(filledDiamond).toBeDefined();
      expect(filledDiamond?.getAttribute("refX")).toBe("12");
      expect(filledDiamond?.getAttribute("refY")).toBe("5");
      expect(filledDiamond?.getAttribute("viewBox")).toBe("0 0 12 10");
      expect(filledDiamond?.getAttribute("orient")).toBe("auto-start-reverse");
    });

    it("should render aggregation connector with hollow diamond at marker-start", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 }, size: { width: 100, height: 60 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 }, size: { width: 100, height: 60 } });
      const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.aggregation" });
      editor.clearSelection();

      expect(edge.kind).toBe("uml.aggregation");

      const edgeGroup = container.querySelector(`[data-edge-id="${edge.id}"]`);
      expect(edgeGroup).not.toBeNull();

      const line = edgeGroup?.querySelector(".umlcanvas-edge-line");
      expect(line).not.toBeNull();
      expect(line?.getAttribute("marker-start")).toBe("url(#uml-marker-diamond-hollow)");
      expect(line?.getAttribute("marker-end")).toBeNull();
    });

    it("should render composition connector with filled diamond at marker-start", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 }, size: { width: 100, height: 60 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 }, size: { width: 100, height: 60 } });
      const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.composition" });
      editor.clearSelection();

      expect(edge.kind).toBe("uml.composition");

      const edgeGroup = container.querySelector(`[data-edge-id="${edge.id}"]`);
      expect(edgeGroup).not.toBeNull();

      const line = edgeGroup?.querySelector(".umlcanvas-edge-line");
      expect(line).not.toBeNull();
      expect(line?.getAttribute("marker-start")).toBe("url(#uml-marker-diamond-filled)");
      expect(line?.getAttribute("marker-end")).toBeNull();
    });

    it("should render directed association connector with open arrow at marker-end", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 }, size: { width: 100, height: 60 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 }, size: { width: 100, height: 60 } });
      const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.directedAssociation" });
      editor.clearSelection();

      expect(edge.kind).toBe("uml.directedAssociation");

      const edgeGroup = container.querySelector(`[data-edge-id="${edge.id}"]`);
      expect(edgeGroup).not.toBeNull();

      const line = edgeGroup?.querySelector(".umlcanvas-edge-line");
      expect(line).not.toBeNull();
      expect(line?.getAttribute("marker-end")).toBe("url(#uml-marker-open-arrow)");
      expect(line?.getAttribute("marker-start")).toBeNull();
    });

    it("should render essential UML class diagram connectors: generalization, realization, dependency", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });

      // Generalization
      const genEdge = editor.addEdge(n1.id, n2.id, { kind: "uml.generalization" });
      editor.clearSelection();
      const genEl = container.querySelector(`[data-edge-id="${genEdge.id}"] .umlcanvas-edge-line`);
      expect(genEl?.getAttribute("marker-end")).toBe("url(#uml-marker-triangle-hollow)");
      expect(genEl?.getAttribute("stroke-dasharray")).toBeNull();

      // Realization
      const realEdge = editor.addEdge(n1.id, n2.id, { kind: "uml.realization" });
      editor.clearSelection();
      const realEl = container.querySelector(`[data-edge-id="${realEdge.id}"] .umlcanvas-edge-line`);
      expect(realEl?.getAttribute("marker-end")).toBe("url(#uml-marker-triangle-hollow)");
      expect(realEl?.getAttribute("stroke-dasharray")).toBe("6 4");

      // Dependency
      const depEdge = editor.addEdge(n1.id, n2.id, { kind: "uml.dependency" });
      editor.clearSelection();
      const depEl = container.querySelector(`[data-edge-id="${depEdge.id}"] .umlcanvas-edge-line`);
      expect(depEl?.getAttribute("marker-end")).toBe("url(#uml-marker-open-arrow)");
      expect(depEl?.getAttribute("stroke-dasharray")).toBe("5 4");
    });

    it("should move diamond marker to the new source node when edge direction is reversed", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.aggregation" });
      editor.clearSelection();

      expect(edge.fromNodeId).toBe(n1.id);
      expect(edge.toNodeId).toBe(n2.id);

      editor.reverseEdge(edge.id);

      expect(edge.fromNodeId).toBe(n2.id);
      expect(edge.toNodeId).toBe(n1.id);

      const edgeGroup = container.querySelector(`[data-edge-id="${edge.id}"]`);
      const line = edgeGroup?.querySelector(".umlcanvas-edge-line");
      expect(line?.getAttribute("marker-start")).toBe("url(#uml-marker-diamond-hollow)");
    });

    it("should update edge connector style via updateEdgeKind with undo/redo", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.association" });
      editor.clearSelection();

      expect(edge.kind).toBe("uml.association");

      editor.updateEdgeKind(edge.id, "uml.aggregation");
      expect(edge.kind).toBe("uml.aggregation");

      let edgeGroup = container.querySelector(`[data-edge-id="${edge.id}"]`);
      let line = edgeGroup?.querySelector(".umlcanvas-edge-line");
      expect(line?.getAttribute("marker-start")).toBe("url(#uml-marker-diamond-hollow)");

      editor.updateEdgeKind(edge.id, "uml.composition");
      expect(edge.kind).toBe("uml.composition");
      edgeGroup = container.querySelector(`[data-edge-id="${edge.id}"]`);
      line = edgeGroup?.querySelector(".umlcanvas-edge-line");
      expect(line?.getAttribute("marker-start")).toBe("url(#uml-marker-diamond-filled)");

      // Undo to aggregation
      editor.undo();
      expect(edge.kind).toBe("uml.aggregation");
      edgeGroup = container.querySelector(`[data-edge-id="${edge.id}"]`);
      line = edgeGroup?.querySelector(".umlcanvas-edge-line");
      expect(line?.getAttribute("marker-start")).toBe("url(#uml-marker-diamond-hollow)");

      // Undo to association
      editor.undo();
      expect(edge.kind).toBe("uml.association");
      edgeGroup = container.querySelector(`[data-edge-id="${edge.id}"]`);
      line = edgeGroup?.querySelector(".umlcanvas-edge-line");
      expect(line?.getAttribute("marker-start")).toBeNull();

      // Redo back to aggregation
      editor.redo();
      expect(edge.kind).toBe("uml.aggregation");
      edgeGroup = container.querySelector(`[data-edge-id="${edge.id}"]`);
      line = edgeGroup?.querySelector(".umlcanvas-edge-line");
      expect(line?.getAttribute("marker-start")).toBe("url(#uml-marker-diamond-hollow)");
    });

    it("should allow selecting connector style from Toolbar connector menu", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.association" });

      const toolbar = new Toolbar(container as any, editor, renderer);

      // Select edge
      editor.selectEdge(edge.id, false);

      toolbar.openConnectorMenu();

      const popover = container.querySelector(".umlcanvas-connector-popover");
      expect(popover).not.toBeNull();

      const menuItems = popover?.querySelectorAll(".umlcanvas-menu-item") || [];
      const aggItem = menuItems.find((m) => m.textContent.includes("Aggregation"));
      expect(aggItem).toBeDefined();

      aggItem?.click();

      expect(edge.kind).toBe("uml.aggregation");
      expect(editor.activeEdgeKind).toBe("uml.aggregation");

      toolbar.destroy();
    });

    it("should export standalone SVG with refX='12' for aggregation and composition", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      editor.addEdge(n1.id, n2.id, { kind: "uml.aggregation" });
      editor.addEdge(n1.id, n2.id, { kind: "uml.composition" });

      const exporter = new SvgExporter();
      const svgOutput = exporter.exportToSvg(editor.diagram);

      expect(svgOutput).toContain('id="uml-marker-diamond-hollow" viewBox="0 0 12 10" refX="12" refY="5"');
      expect(svgOutput).toContain('id="uml-marker-diamond-filled" viewBox="0 0 12 10" refX="12" refY="5"');
      expect(svgOutput).toContain('marker-start="url(#uml-marker-diamond-hollow)"');
      expect(svgOutput).toContain('marker-start="url(#uml-marker-diamond-filled)"');
    });

    it("should generate colored diamond markers with refX='12' when edge has custom color or is selected", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const edge = editor.addEdge(n1.id, n2.id, {
        kind: "uml.aggregation",
        style: { color: "red" },
      });
      editor.clearSelection();

      // Colored marker
      const edgeGroup = container.querySelector(`[data-edge-id="${edge.id}"]`);
      const line = edgeGroup?.querySelector(".umlcanvas-edge-line");
      const markerStartAttr = line?.getAttribute("marker-start");
      expect(markerStartAttr).toContain("uml-marker-diamond-hollow--color-red");

      const coloredMarker = container.querySelector("#uml-marker-diamond-hollow--color-red");
      expect(coloredMarker).not.toBeNull();
      expect(coloredMarker?.getAttribute("refX")).toBe("12");

      // Selected marker
      editor.selectEdge(edge.id, false);
      const selectedLine = container.querySelector(`[data-edge-id="${edge.id}"] .umlcanvas-edge-line`);
      expect(selectedLine?.getAttribute("marker-start")).toContain("uml-marker-diamond-hollow--selected");

      const selectedMarker = container.querySelector("#uml-marker-diamond-hollow--selected");
      expect(selectedMarker).not.toBeNull();
      expect(selectedMarker?.getAttribute("refX")).toBe("12");
    });

    it("should provide an edgeStyleBtn in contextGroup when edges are selected, showing current style name", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.aggregation" });

      const toolbar = new Toolbar(container as any, editor, renderer);
      editor.selectEdge(edge.id, false);

      const edgeStyleBtn = container.querySelector(".umlcanvas-edge-style-btn");
      expect(edgeStyleBtn).not.toBeNull();
      expect(edgeStyleBtn?.classList.contains("is-hidden")).toBe(false);
      expect(edgeStyleBtn?.textContent).toContain("Aggregation");

      toolbar.destroy();
    });

    it("should not clear selection when mousedown occurs on toolbar or popovers", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.association" });

      const toolbar = new Toolbar(container as any, editor, renderer);
      editor.selectEdge(edge.id, false);
      expect(editor.selectedEdgeIds.length).toBe(1);

      // Trigger mousedown on edgeStyleBtn
      const edgeStyleBtn = container.querySelector(".umlcanvas-edge-style-btn");
      expect(edgeStyleBtn).not.toBeNull();

      // Simulate mousedown on button that bubbles to container
      container.dispatch("mousedown", { target: edgeStyleBtn, button: 0 });
      expect(editor.selectedEdgeIds.length).toBe(1);

      // Open connector menu and simulate mousedown inside popover
      toolbar.openConnectorMenu();
      const popover = container.querySelector(".umlcanvas-connector-popover");
      expect(popover).not.toBeNull();
      const compItem = popover?.querySelectorAll(".umlcanvas-menu-item").find((m) => m.textContent.includes("Composition"));
      expect(compItem).toBeDefined();

      container.dispatch("mousedown", { target: compItem, button: 0 });
      expect(editor.selectedEdgeIds.length).toBe(1);

      // Click on Composition
      compItem?.click();
      expect(edge.kind).toBe("uml.composition");
      expect(editor.activeEdgeKind).toBe("uml.composition");

      toolbar.destroy();
    });

    it("should support uml.directedAggregation and uml.directedComposition in EdgeStyleRegistry and DiagramTypeRegistry", () => {
      expect(defaultEdgeStyleRegistry.has("uml.directedAggregation")).toBe(true);
      expect(defaultEdgeStyleRegistry.has("uml.directedComposition")).toBe(true);

      const dirAgg = defaultEdgeStyleRegistry.get("uml.directedAggregation");
      expect(dirAgg.markerStartId).toBe("uml-marker-diamond-hollow");
      expect(dirAgg.markerEndId).toBe("uml-marker-open-arrow");

      const dirComp = defaultEdgeStyleRegistry.get("uml.directedComposition");
      expect(dirComp.markerStartId).toBe("uml-marker-diamond-filled");
      expect(dirComp.markerEndId).toBe("uml-marker-open-arrow");

      expect(classDiagramDefinition.allowedEdgeKinds).toContain("uml.directedAggregation");
      expect(classDiagramDefinition.allowedEdgeKinds).toContain("uml.directedComposition");
    });

    it("should render both start diamond and end open arrow markers for directed aggregation and composition", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const e1 = editor.addEdge(n1.id, n2.id, { kind: "uml.directedAggregation" });
      const e2 = editor.addEdge(n1.id, n2.id, { kind: "uml.directedComposition" });

      renderer.render();

      const g1 = container.querySelector(`[data-edge-id="${e1.id}"]`);
      const line1 = g1?.querySelector(".umlcanvas-edge-line");
      expect(line1?.getAttribute("marker-start")).toContain("uml-marker-diamond-hollow");
      expect(line1?.getAttribute("marker-end")).toContain("uml-marker-open-arrow");

      const g2 = container.querySelector(`[data-edge-id="${e2.id}"]`);
      const line2 = g2?.querySelector(".umlcanvas-edge-line");
      expect(line2?.getAttribute("marker-start")).toContain("uml-marker-diamond-filled");
      expect(line2?.getAttribute("marker-end")).toContain("uml-marker-open-arrow");
    });

    it("should update line drag preview marker to match activeEdgeKind", () => {
      editor.activeEdgeKind = "uml.aggregation";
      (renderer as any).dragMode = {
        type: "edge",
        startPoint: { x: 10, y: 10 },
        currentCanvasPoint: { x: 100, y: 100 },
      };

      (renderer as any).renderInteractions();

      const previewLine = container.querySelector(".umlcanvas-edge-preview-line");
      expect(previewLine).not.toBeNull();
      expect(previewLine?.getAttribute("marker-start")).toBe("url(#uml-marker-diamond-hollow)");
    });

    it("should use activeEdgeKind when snapStrokeToShape creates an edge in uml.class diagrams", () => {
      editor.activeEdgeKind = "uml.composition";

      const n1 = editor.addNode({
        kind: "uml.class",
        position: { x: 50, y: 50 },
        size: { width: 100, height: 80 },
      });
      const n2 = editor.addNode({
        kind: "uml.class",
        position: { x: 300, y: 50 },
        size: { width: 100, height: 80 },
      });

      // Line stroke from n1 to n2
      const stroke: Stroke = {
        id: "stroke-test-line",
        points: [
          { x: 155, y: 90, pressure: 0.5, time: 1 },
          { x: 220, y: 90, pressure: 0.5, time: 2 },
          { x: 295, y: 90, pressure: 0.5, time: 3 },
        ],
      };

      const result = editor.snapStrokeToShape(stroke);
      expect(result).not.toBeNull();
      expect((result as any).kind).toBe("uml.composition");
    });

    it("should display connector styles in right-click context menu and allow changing style", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.association" });

      const view = new UmlCanvasView({} as any, { settings: {} } as any);
      (view as any).editor = editor;
      (view as any).renderer = renderer;

      let lastMenu: any = null;
      const obsidianModule = require("obsidian");
      const origShow = obsidianModule.Menu.prototype.showAtMouseEvent;
      obsidianModule.Menu.prototype.showAtMouseEvent = function () {
        lastMenu = this;
      };

      try {
        (view as any).showContextMenu(
          { clientX: 100, clientY: 100 } as any,
          { x: 100, y: 100 },
          undefined,
          edge
        );

        expect(lastMenu).not.toBeNull();
        const styleItems = lastMenu.items.filter((item: any) =>
          item.title.startsWith("Style:")
        );
        expect(styleItems.length).toBeGreaterThanOrEqual(8);

        // Association should have checkmark
        const assocItem = styleItems.find((item: any) =>
          item.title.includes("Association (Line)")
        );
        expect(assocItem?.title).toContain("✓");

        // Click Aggregation
        const aggItem = styleItems.find((item: any) =>
          item.title.includes("Aggregation (Hollow Diamond)")
        );
        expect(aggItem).toBeDefined();
        aggItem.onClickHandler();

        expect(edge.kind).toBe("uml.aggregation");
        expect(editor.activeEdgeKind).toBe("uml.aggregation");
      } finally {
        obsidianModule.Menu.prototype.showAtMouseEvent = origShow;
      }
    });

    it("should connect two selected nodes when pressing 'L' shortcut key using activeEdgeKind", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      editor.selectNode(n1.id, false);
      editor.selectNode(n2.id, true);
      expect(editor.selectedNodeIds.length).toBe(2);

      editor.activeEdgeKind = "uml.directedComposition";
      const initialEdgeCount = editor.diagram.edges.length;

      // Dispatch 'l' keydown on window
      (window as any).dispatch("keydown", {
        key: "l",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        preventDefault: () => {},
      });

      expect(editor.diagram.edges.length).toBe(initialEdgeCount + 1);
      const newEdge = editor.diagram.edges[editor.diagram.edges.length - 1];
      expect(newEdge.fromNodeId).toBe(n1.id);
      expect(newEdge.toNodeId).toBe(n2.id);
      expect(newEdge.kind).toBe("uml.directedComposition");
    });

    it("should export directed aggregation and directed composition to JSON Canvas with toEnd='arrow'", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const e1 = editor.addEdge(n1.id, n2.id, { kind: "uml.directedAggregation" });
      const e2 = editor.addEdge(n1.id, n2.id, { kind: "uml.directedComposition" });

      const exporter = new JsonCanvasExporter();
      const jsonStr = exporter.exportCanvas(editor.diagram);
      const parsed = JSON.parse(jsonStr);

      const jsonE1 = parsed.edges.find((e: any) => e.id === e1.id);
      const jsonE2 = parsed.edges.find((e: any) => e.id === e2.id);

      expect(jsonE1?.toEnd).toBe("arrow");
      expect(jsonE2?.toEnd).toBe("arrow");
    });

    it("should import JSON Canvas edge with toEnd='arrow' as uml.directedAssociation", () => {
      const importer = new JsonCanvasImporter();
      const testCanvas = JSON.stringify({
        nodes: [
          { id: "node-1", type: "text", text: "ClassA", x: 10, y: 10, width: 100, height: 80 },
          { id: "node-2", type: "text", text: "ClassB", x: 200, y: 10, width: 100, height: 80 },
        ],
        edges: [
          { id: "edge-1", fromNode: "node-1", toNode: "node-2", toEnd: "arrow" },
          { id: "edge-2", fromNode: "node-1", toNode: "node-2" },
        ],
      });

      const diagram = importer.importCanvas(testCanvas, { title: "test.canvas" });
      expect(diagram.edges[0].kind).toBe("uml.directedAssociation");
      expect(diagram.edges[1].kind).toBe("uml.association");
    });

    it("should export standalone SVG with both diamond marker-start and arrow marker-end for directed variants", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      editor.addEdge(n1.id, n2.id, { kind: "uml.directedAggregation" });
      editor.addEdge(n1.id, n2.id, {
        kind: "uml.directedComposition",
        style: { color: "purple" },
      });

      const exporter = new SvgExporter();
      const svgOutput = exporter.exportToSvg(editor.diagram);

      // uml.directedAggregation has hollow diamond start and open arrow end
      expect(svgOutput).toContain('marker-start="url(#uml-marker-diamond-hollow)"');
      expect(svgOutput).toContain('marker-end="url(#uml-marker-open-arrow)"');

      // Colored uml.directedComposition has colored filled diamond start and colored open arrow end
      expect(svgOutput).toContain('marker-start="url(#uml-marker-diamond-filled--color-purple)"');
      expect(svgOutput).toContain('marker-end="url(#uml-marker-open-arrow--color-purple)"');
    });
  });

  describe("6. Unified Line Settings, Independent Line Endings & Patterns", () => {
    it("should allow setting line endings independently at both start and end with undo/redo", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.association" });
      editor.clearSelection();

      expect(edge.style?.markerStart).toBeUndefined();
      expect(edge.style?.markerEnd).toBeUndefined();

      // Set start ending to circle-hollow and end ending to triangle-hollow
      editor.setEdgeMarkerStart(edge.id, "circle-hollow");
      editor.setEdgeMarkerEnd(edge.id, "triangle-hollow");

      expect(edge.style?.markerStart).toBe("circle-hollow");
      expect(edge.style?.markerEnd).toBe("triangle-hollow");

      let edgeGroup = container.querySelector(`[data-edge-id="${edge.id}"]`);
      let line = edgeGroup?.querySelector(".umlcanvas-edge-line");
      expect(line?.getAttribute("marker-start")).toBe("url(#uml-marker-circle-hollow)");
      expect(line?.getAttribute("marker-end")).toBe("url(#uml-marker-triangle-hollow)");

      // Undo start marker
      editor.undo(); // undo end marker
      expect(edge.style?.markerEnd).toBeUndefined();

      editor.undo(); // undo start marker
      expect(edge.style?.markerStart).toBeUndefined();

      // Redo
      editor.redo();
      expect(edge.style?.markerStart).toBe("circle-hollow");
      editor.redo();
      expect(edge.style?.markerEnd).toBe("triangle-hollow");
    });

    it("should allow setting all line patterns (solid, dashed, dotted, dash-dot, long-dash)", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.association" });
      editor.clearSelection();

      // Dashed
      editor.setEdgeLineType(edge.id, "dashed");
      expect(edge.style?.lineType).toBe("dashed");
      let line = container.querySelector(`[data-edge-id="${edge.id}"] .umlcanvas-edge-line`);
      expect(line?.getAttribute("stroke-dasharray")).toBe("6 4");

      // Dotted
      editor.setEdgeLineType(edge.id, "dotted");
      expect(edge.style?.lineType).toBe("dotted");
      line = container.querySelector(`[data-edge-id="${edge.id}"] .umlcanvas-edge-line`);
      expect(line?.getAttribute("stroke-dasharray")).toBe("2 4");

      // Dash-dot
      editor.setEdgeLineType(edge.id, "dash-dot");
      expect(edge.style?.lineType).toBe("dash-dot");
      line = container.querySelector(`[data-edge-id="${edge.id}"] .umlcanvas-edge-line`);
      expect(line?.getAttribute("stroke-dasharray")).toBe("8 4 2 4");

      // Long-dash
      editor.setEdgeLineType(edge.id, "long-dash");
      expect(edge.style?.lineType).toBe("long-dash");
      line = container.querySelector(`[data-edge-id="${edge.id}"] .umlcanvas-edge-line`);
      expect(line?.getAttribute("stroke-dasharray")).toBe("12 5");

      // Solid
      editor.setEdgeLineType(edge.id, "solid");
      expect(edge.style?.lineType).toBe("solid");
      line = container.querySelector(`[data-edge-id="${edge.id}"] .umlcanvas-edge-line`);
      expect(line?.getAttribute("stroke-dasharray")).toBeNull();
    });

    it("should keep all line settings at one place in the top bar context group", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.generalization" });

      const toolbar = new Toolbar(container as any, editor, renderer);
      editor.clearSelection();

      const contextGroup = container.querySelector(".umlcanvas-context-group");
      expect(contextGroup?.classList.contains("is-hidden")).toBe(true);

      // Select the edge
      editor.selectEdge(edge.id, false);
      expect(contextGroup?.classList.contains("is-hidden")).toBe(false);

      // Verify all line buttons are present and grouped together
      const startBtn = container.querySelector(".umlcanvas-edge-start-btn");
      const linetypeBtn = container.querySelector(".umlcanvas-edge-linetype-btn");
      const endBtn = container.querySelector(".umlcanvas-edge-end-btn");
      const styleBtn = container.querySelector(".umlcanvas-edge-style-btn");
      const rerouteBtn = contextGroup?.querySelectorAll("button").find((b) => b.title.includes("Reroute Line"));
      const reverseBtn = contextGroup?.querySelectorAll("button").find((b) => b.title.includes("Reverse Line"));

      expect(startBtn).not.toBeNull();
      expect(linetypeBtn).not.toBeNull();
      expect(endBtn).not.toBeNull();
      expect(styleBtn).not.toBeNull();
      expect(rerouteBtn).toBeDefined();
      expect(reverseBtn).toBeDefined();

      // Check current text representations
      expect(startBtn?.textContent).toContain("Start: None");
      expect(linetypeBtn?.textContent).toContain("Solid");
      expect(endBtn?.textContent).toContain("End: Hollow Triangle");
      expect(styleBtn?.textContent).toContain("Generalization");

      toolbar.destroy();
    });

    it("should open unified draw.io style line popover and interact with settings", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.association" });

      const toolbar = new Toolbar(container as any, editor, renderer);
      editor.selectEdge(edge.id, false);

      toolbar.openConnectorMenu();

      const popover = container.querySelector(".umlcanvas-line-popover");
      expect(popover).not.toBeNull();

      // Verify sections exist
      const titles = popover?.querySelectorAll(".umlcanvas-line-section-title") || [];
      const titleTexts = Array.from(titles).map((t) => t.textContent);
      expect(titleTexts).toContain("Start Ending");
      expect(titleTexts).toContain("Line Type");
      expect(titleTexts).toContain("End Ending");
      expect(titleTexts).toContain("Routing");
      expect(titleTexts).toContain("UML Class Diagram Presets");
      expect(titleTexts).toContain("Line Actions");

      // Click on Start Ending: Hollow Diamond
      const startDiamond = popover?.querySelectorAll(".umlcanvas-start-marker-opt").find((b) => b.textContent?.includes("Hollow Diamond"));
      expect(startDiamond).toBeDefined();
      startDiamond?.click();
      expect(edge.style?.markerStart).toBe("diamond-hollow");

      // Click on Line Type: Dashed
      const dashedBtn = popover?.querySelectorAll(".umlcanvas-linetype-opt").find((b) => b.textContent?.includes("Dashed"));
      expect(dashedBtn).toBeDefined();
      dashedBtn?.click();
      expect(edge.style?.lineType).toBe("dashed");

      // Click on End Ending: Hollow Triangle
      const endTriangle = popover?.querySelectorAll(".umlcanvas-end-marker-opt").find((b) => b.textContent?.includes("Hollow Triangle"));
      expect(endTriangle).toBeDefined();
      endTriangle?.click();
      expect(edge.style?.markerEnd).toBe("triangle-hollow");

      // Click on Routing: Straight
      const straightBtn = popover?.querySelectorAll(".umlcanvas-routing-opt").find((b) => b.textContent?.includes("Straight"));
      expect(straightBtn).toBeDefined();
      straightBtn?.click();
      expect(edge.routing).toBe("straight");

      toolbar.destroy();
    });

    it("should export custom line endings, patterns, and circle markers to standalone SVG", () => {
      const n1 = editor.addNode({ position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ position: { x: 300, y: 50 } });
      editor.addEdge(n1.id, n2.id, {
        kind: "uml.association",
        style: {
          markerStart: "circle-filled",
          markerEnd: "circle-hollow",
          lineType: "dash-dot",
        },
      });

      const exporter = new SvgExporter();
      const svgOutput = exporter.exportToSvg(editor.diagram);

      expect(svgOutput).toContain('id="uml-marker-circle-hollow"');
      expect(svgOutput).toContain('id="uml-marker-circle-filled"');
      expect(svgOutput).toContain('marker-start="url(#uml-marker-circle-filled)"');
      expect(svgOutput).toContain('marker-end="url(#uml-marker-circle-hollow)"');
      expect(svgOutput).toContain('stroke-dasharray="8 3 2 3"');
    });
  });
});


