import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { MinimapView } from "../src/presentation/views/MinimapView";

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
  getBoundingClientRectCalls: number = 0;

  constructor(tagName: string, options?: any) {
    this.tagName = tagName.toUpperCase();
    if (options?.cls) {
      this.classList.add(options.cls);
    }
    if (options?.text) {
      this.textContent = options.text;
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

  createSvg(tag: string, options?: any): MockElement {
    const el = new MockElement(tag, options);
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

  dispatch(event: string, detail: any = {}): void {
    const handlers = [...(this.listeners[event] || [])];
    const evt = {
      stopPropagation: () => {},
      preventDefault: () => {},
      target: this,
      ...detail,
    };
    for (const h of handlers) {
      h(evt);
    }
  }

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const check = (el: MockElement) => {
      let matches = false;
      if (selector.startsWith(".")) {
        const classNames = selector.split(".").filter(Boolean);
        matches = classNames.every((cls) => el.classList.contains(cls));
      } else if (selector.includes("[") && selector.includes("]")) {
        const tag = selector.split("[")[0].trim();
        const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)(?:\*?=['"]?([^'"\]]+)['"]?)?\]/);
        const tagMatches = !tag || el.tagName.toLowerCase() === tag.toLowerCase();
        if (tagMatches && attrMatch) {
          const attrName = attrMatch[1];
          const val = attrMatch[2];
          const actual = el.getAttribute(attrName) || "";
          matches = val === undefined ? Boolean(actual) : actual === val;
        }
      } else {
        const tag = selector.toUpperCase();
        matches = el.tagName === tag;
      }
      if (matches) results.push(el);
      for (const child of el.children) check(child);
    };

    for (const child of this.children) check(child);
    return results;
  }

  closest(selector: string): MockElement | null {
    let cur: MockElement | null = this;
    while (cur) {
      if (selector.startsWith(".") && cur.classList.contains(selector.slice(1))) return cur;
      if (selector.startsWith("[") && selector.endsWith("]")) {
        const attrName = selector.slice(1, -1);
        if (cur.getAttribute(attrName) !== null) return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  getBoundingClientRect(): any {
    this.getBoundingClientRectCalls++;
    return {
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
    };
  }

  textContent: string = "";
}

describe("Canvas Efficiency & Lag-Free Performance Tests", () => {
  let editor: DiagramEditor;
  let container: MockElement;
  let renderer: SvgSceneRenderer;
  let windowListeners: Record<string, ((e: any) => void)[]>;

  beforeEach(() => {
    (global as any).document = {
      createElement: (tag: string) => new MockElement(tag),
      createElementNS: (_ns: string, tag: string) => new MockElement(tag),
    };

    windowListeners = {};
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
      dispatch: (event: string, data?: any) => {
        const handlers = windowListeners[event] || [];
        const ev = { type: event, preventDefault: () => {}, stopPropagation: () => {}, ...data };
        for (const h of handlers) h(ev);
        return true;
      },
    };

    const diagram = createDiagram({
      id: "diag-perf-test",
      title: "Performance Test",
      diagramType: "general",
    });
    editor = new DiagramEditor(diagram);
    container = new MockElement("div");
    renderer = new SvgSceneRenderer(container as any, editor);
  });

  afterEach(() => {
    renderer.destroy();
  });

  describe("1. Retained DOM Node Preservation", () => {
    test("preserves existing DOM nodes across renders when node attributes are unchanged", () => {
      const node1 = editor.addNode({
        title: "Node 1",
        position: { x: 100, y: 100 },
        size: { width: 120, height: 60 },
      });
      const node2 = editor.addNode({
        title: "Node 2",
        position: { x: 300, y: 200 },
        size: { width: 140, height: 80 },
      });

      renderer.render();

      const el1Before = renderer.getNodeElement(node1.id);
      const el2Before = renderer.getNodeElement(node2.id);

      expect(el1Before).not.toBeNull();
      expect(el2Before).not.toBeNull();

      // Render again without changes
      renderer.render();

      const el1After = renderer.getNodeElement(node1.id);
      const el2After = renderer.getNodeElement(node2.id);

      // DOM references MUST be identical (no tear-down and rebuild)
      expect(el1After).toBe(el1Before);
      expect(el2After).toBe(el2Before);
    });

    test("preserves DOM elements and updates transform directly on move without recreating DOM tree", () => {
      const node = editor.addNode({
        title: "Movable Node",
        position: { x: 50, y: 50 },
        size: { width: 100, height: 50 },
      });

      renderer.render();
      const elBefore = renderer.getNodeElement(node.id);
      expect(elBefore?.getAttribute("transform")).toBe("translate(50, 50)");

      // Move node to (150, 220)
      editor.moveNodes([
        {
          nodeId: node.id,
          oldPos: { x: 50, y: 50 },
          newPos: { x: 150, y: 220 },
        },
      ]);
      renderer.render();

      const elAfter = renderer.getNodeElement(node.id);
      // Retained node element preserved with updated position transform
      expect(elAfter).toBe(elBefore);
      expect(elAfter?.getAttribute("transform")).toBe("translate(150, 220)");
    });

    test("preserves DOM element during live dragging interaction", () => {
      const node = editor.addNode({
        title: "Drag Node",
        position: { x: 100, y: 100 },
        size: { width: 120, height: 60 },
      });

      renderer.render();
      const elBefore = renderer.getNodeElement(node.id);
      expect(elBefore).not.toBeNull();

      // Start drag via handleMouseDown
      (renderer as any).handleMouseDown({
        target: elBefore,
        clientX: 110,
        clientY: 110,
        button: 0,
        preventDefault: () => {},
        stopPropagation: () => {},
      });

      // Move mouse by (+50, +70)
      (renderer as any).handleMouseMove({ clientX: 160, clientY: 180 });

      // Node element remains identical and has been translated smoothly
      const elDuringDrag = renderer.getNodeElement(node.id);
      expect(elDuringDrag).toBe(elBefore);
      expect(elDuringDrag?.getAttribute("transform")).toBe("translate(150, 170)");

      // Release mouse
      (renderer as any).handleMouseUp({ clientX: 160, clientY: 180, button: 0 });

      const elAfterDrag = renderer.getNodeElement(node.id);
      expect(elAfterDrag).toBe(elBefore);
      expect(node.position.x).toBe(150);
      expect(node.position.y).toBe(170);
    });
  });

  describe("2. Route Caching & Retained Edges", () => {
    test("preserves edge DOM elements and route calculations when endpoints do not change", () => {
      const nodeA = editor.addNode({
        title: "Node A",
        position: { x: 50, y: 50 },
        size: { width: 100, height: 50 },
      });
      const nodeB = editor.addNode({
        title: "Node B",
        position: { x: 300, y: 50 },
        size: { width: 100, height: 50 },
      });
      const edge = editor.addEdge(nodeA.id, nodeB.id, {
        kind: "uml.association",
      });

      // Unrelated node C
      const nodeC = editor.addNode({
        title: "Unrelated Node C",
        position: { x: 100, y: 300 },
        size: { width: 100, height: 50 },
      });

      renderer.render();

      const edgeElBefore = renderer.getEdgeElement(edge.id);
      expect(edgeElBefore).not.toBeNull();

      // Move unrelated node C
      editor.moveNodes([
        {
          nodeId: nodeC.id,
          oldPos: { x: 100, y: 300 },
          newPos: { x: 120, y: 320 },
        },
      ]);
      renderer.render();

      const edgeElAfter = renderer.getEdgeElement(edge.id);
      // Unchanged edge DOM element preserved
      expect(edgeElAfter).toBe(edgeElBefore);
    });
  });

  describe("3. Retained Groups", () => {
    test("preserves group DOM element across renders without recreating children", () => {
      const group = editor.addGroup({
        name: "Test Group",
        color: "3",
      });

      renderer.render();
      const groupElBefore = renderer.getGroupElement(group.id);
      expect(groupElBefore).not.toBeNull();

      renderer.render();
      const groupElAfter = renderer.getGroupElement(group.id);
      expect(groupElAfter).toBe(groupElBefore);
    });
  });

  describe("4. Layout Reflow Prevention (Cached Container Rect)", () => {
    test("reuses cached container dimensions across mousemove events without calling getBoundingClientRect repeatedly", () => {
      container.getBoundingClientRectCalls = 0;

      // First mousemove caches the rect
      (global as any).window.dispatch("mousemove", { clientX: 200, clientY: 200 });
      const initialCalls = container.getBoundingClientRectCalls;
      expect(initialCalls).toBeGreaterThan(0);

      // Subsequent 50 mouse moves should NOT call getBoundingClientRect again
      for (let i = 0; i < 50; i++) {
        (global as any).window.dispatch("mousemove", { clientX: 200 + i, clientY: 200 + i });
      }

      // No new getBoundingClientRect layout reflow calls triggered
      expect(container.getBoundingClientRectCalls).toBe(initialCalls);
    });
  });

  describe("5. Minimap Efficiency (Viewport vs Content Updates)", () => {
    test("updateViewport updates only camera indicator rect without touching diagram content group", () => {
      const minimapContainer = new MockElement("div");
      const minimap = new MinimapView(editor, renderer, minimapContainer as any);

      editor.addNode({
        title: "Mini Node 1",
        position: { x: 100, y: 100 },
        size: { width: 100, height: 50 },
      });
      editor.addNode({
        title: "Mini Node 2",
        position: { x: 300, y: 300 },
        size: { width: 100, height: 50 },
      });

      minimap.update();

      const contentGroup = minimapContainer.querySelector(".umlcanvas-minimap-content");
      expect(contentGroup).not.toBeNull();
      const contentChildrenBefore = [...contentGroup!.children];
      expect(contentChildrenBefore.length).toBeGreaterThan(0);

      // Pan viewport multiple times via updateViewport
      minimap.updateViewport();
      minimap.updateViewport();

      // Minimap content children were untouched (no DOM destruction/recreation during pan/zoom)
      expect(contentGroup!.children).toEqual(contentChildrenBefore);

      minimap.destroy();
    });
  });

  describe("6. Notification Redundancy in DiagramEditor", () => {
    test("does not double-notify listeners on single table commands", () => {
      const tableNode = editor.addTableNode({ position: { x: 50, y: 50 }, rows: 2, cols: 2 });
      let notifyCount = 0;
      const unsubscribe = editor.subscribe(() => {
        notifyCount++;
      });

      editor.updateTableCell(tableNode.id, 0, 0, "Updated Cell Content");
      // Exactly 1 notification should be received, not 2
      expect(notifyCount).toBe(1);

      unsubscribe();
    });
  });
});
