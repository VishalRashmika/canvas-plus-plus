import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import {
  ArrowAttachmentPopup,
  DEFAULT_ATTACHMENT_ITEMS,
} from "../src/presentation/views/ArrowAttachmentPopup";
import { JsonCanvasSerializer } from "../src/infrastructure/persistence/JsonCanvasSerializer";
import { SvgExporter } from "../src/infrastructure/export/SvgExporter";
import { Stroke } from "../src/domain/services/ShapeRecognizer";

// Mock element for DOM interaction in Jest
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
  value: string = "";
  innerHTML: string = "";
  textContent: string = "";
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
      this.classList.classes.clear();
      this.classList.add(...value.split(" "));
    }
  }

  setAttributeNS(_ns: string, name: string, value: string): void {
    this.setAttribute(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
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

  setCssStyles(styles: Record<string, string>): void {
    Object.assign(this.style, styles);
  }

  contains(other: any): boolean {
    if (other === this) return true;
    for (const c of this.children) {
      if (c === other || (c.contains && c.contains(other))) return true;
    }
    return false;
  }

  querySelector(selector: string): MockElement | null {
    if (selector.startsWith(".")) {
      const cls = selector.slice(1);
      if (this.classList.contains(cls)) return this;
      for (const c of this.children) {
        const found = c.querySelector(selector);
        if (found) return found;
      }
    }
    if (selector.startsWith("[data-item-id=")) {
      const id = selector.replace('[data-item-id="', "").replace('"]', "");
      if (this.attributes["data-item-id"] === id) return this;
      for (const c of this.children) {
        const found = c.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    if (selector.startsWith(".")) {
      const cls = selector.slice(1);
      if (this.classList.contains(cls)) results.push(this);
      for (const c of this.children) {
        results.push(...c.querySelectorAll(selector));
      }
    }
    return results;
  }

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (selector.startsWith(".") && curr.classList.contains(selector.slice(1))) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  getBoundingClientRect(): any {
    return {
      left: 0,
      top: 0,
      width: this.clientWidth,
      height: this.clientHeight,
      right: this.clientWidth,
      bottom: this.clientHeight,
    };
  }

  dispatchEvent(event: any): boolean {
    const list = this.listeners[event.type] || [];
    for (const h of list) {
      h(event);
    }
    return true;
  }
}

// Global DOM setup
const docListeners: Record<string, ((e: any) => void)[]> = {};
const mockDocument = {
  createElement: (tag: string, options?: any) => new MockElement(tag, options),
  createElementNS: (_ns: string, tag: string) => new MockElement(tag),
  addEventListener: (event: string, handler: (e: any) => void) => {
    if (!docListeners[event]) docListeners[event] = [];
    docListeners[event].push(handler);
  },
  removeEventListener: (event: string, handler: (e: any) => void) => {
    if (docListeners[event]) {
      docListeners[event] = docListeners[event].filter((h) => h !== handler);
    }
  },
  elementFromPoint: () => null,
};

(global as any).document = mockDocument;
const winListeners: Record<string, ((e: any) => void)[]> = {};
(global as any).window = {
  addEventListener: (event: string, handler: (e: any) => void) => {
    if (!winListeners[event]) winListeners[event] = [];
    winListeners[event].push(handler);
  },
  removeEventListener: (event: string, handler: (e: any) => void) => {
    if (winListeners[event]) {
      winListeners[event] = winListeners[event].filter((h) => h !== handler);
    }
  },
  requestAnimationFrame: (cb: () => void) => cb(),
};

(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

describe("Arrow to Empty Space Popup & Dangling Edge Tests", () => {
  let editor: DiagramEditor;
  let container: MockElement;
  let renderer: SvgSceneRenderer;
  let sourceNode: any;

  beforeEach(() => {
    editor = new DiagramEditor(createDiagram({ id: "diag-empty-arrow-test", diagramType: "general" }));
    sourceNode = editor.addNode({
      kind: "generic.rectangle",
      title: "Source Card",
      position: { x: 100, y: 100 },
      size: { width: 140, height: 80 },
    });
    editor.clearSelection();

    container = new MockElement("div", { cls: "umlcanvas-container" });
    renderer = new SvgSceneRenderer(container as any, editor);
  });

  afterEach(() => {
    renderer.destroy();
  });

  describe("1. Popup Menu Opening & Items", () => {
    it("should open attachment popup with all shapes and items when arrow is dropped onto empty space", () => {
      expect(renderer.isArrowAttachmentPopupOpen()).toBe(false);

      // Simulate dragging arrow from sourceNode to empty space at (400, 200)
      const popup = renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        fromSide: "right",
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: { x: 400, y: 200 },
        dropClientPoint: { x: 400, y: 200 },
      });

      expect(renderer.isArrowAttachmentPopupOpen()).toBe(true);
      expect(popup).toBeDefined();
      expect(popup.isOpen).toBe(true);

      const items = popup.getFilteredItems();
      const itemIds = items.map((it) => it.id);

      // Must include node, triangle, table, sticky note, circle, diamond, text, vault note, image, class
      expect(itemIds).toContain("node");
      expect(itemIds).toContain("triangle");
      expect(itemIds).toContain("table");
      expect(itemIds).toContain("sticky-note");
      expect(itemIds).toContain("circle");
      expect(itemIds).toContain("diamond");
      expect(itemIds).toContain("text");
      expect(itemIds).toContain("vault-note");
      expect(itemIds).toContain("image");
      expect(itemIds).toContain("uml-class");

      // Verify DOM element was attached inside container
      const popupEl = container.querySelector(".umlcanvas-arrow-attachment-popup");
      expect(popupEl).not.toBeNull();
    });

    it("should filter popup items when typing into search input", () => {
      const popup = renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        fromSide: "right",
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: { x: 400, y: 200 },
        dropClientPoint: { x: 400, y: 200 },
      });

      // Filter by "tri" -> only triangle
      popup.filter("tri");
      let filtered = popup.getFilteredItems();
      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe("triangle");

      // Filter by "table" -> only table
      popup.filter("table");
      filtered = popup.getFilteredItems();
      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe("table");

      // Filter by "sticky" -> sticky note
      popup.filter("sticky");
      filtered = popup.getFilteredItems();
      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe("sticky-note");

      // Clear filter
      popup.filter("");
      filtered = popup.getFilteredItems();
      expect(filtered.length).toBe(DEFAULT_ATTACHMENT_ITEMS.length);
    });

    it("should navigate items with moveActive", () => {
      const popup = renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        fromSide: "right",
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: { x: 400, y: 200 },
        dropClientPoint: { x: 400, y: 200 },
      });

      expect(popup.getActiveItem()?.id).toBe("node");
      popup.moveActive(1);
      expect(popup.getActiveItem()?.id).toBe("triangle");
      popup.moveActive(1);
      expect(popup.getActiveItem()?.id).toBe("table");
      popup.moveActive(-1);
      expect(popup.getActiveItem()?.id).toBe("triangle");
    });
  });

  describe("2. Pressing Escape (Esc) dismisses popup and makes arrow point to empty space", () => {
    it("should remove popup and create a dangling edge pointing to empty space when Esc is pressed", () => {
      const dropPoint = { x: 450, y: 250 };
      renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        fromSide: "right",
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: dropPoint,
        dropClientPoint: dropPoint,
      });

      expect(renderer.isArrowAttachmentPopupOpen()).toBe(true);

      // Simulate Esc key event
      const dismissedEdge = renderer.dismissArrowAttachmentPopupToEmptySpace();
      expect(dismissedEdge).not.toBeNull();
      expect(renderer.isArrowAttachmentPopupOpen()).toBe(false);

      // Popup element should be removed from DOM
      const popupEl = container.querySelector(".umlcanvas-arrow-attachment-popup");
      expect(popupEl).toBeNull();

      // The edge should exist and connect from sourceNode to empty space
      expect(dismissedEdge!.fromNodeId).toBe(sourceNode.id);
      expect(dismissedEdge!.toNodeId).toBe("");
      expect(dismissedEdge!.toPoint).toEqual(dropPoint);

      // Edge is in diagram.edges
      const foundEdge = editor.diagram.edges.find((e) => e.id === dismissedEdge!.id);
      expect(foundEdge).toBeDefined();
      expect(foundEdge!.toPoint).toEqual(dropPoint);

      // Edge is selected
      expect(editor.selectedEdgeIds).toContain(dismissedEdge!.id);
    });

    it("should support undo/redo when dismissed to empty space", () => {
      const dropPoint = { x: 450, y: 250 };
      renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        fromSide: "right",
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: dropPoint,
        dropClientPoint: dropPoint,
      });

      const edge = renderer.dismissArrowAttachmentPopupToEmptySpace()!;
      expect(editor.diagram.edges.some((e) => e.id === edge.id)).toBe(true);

      // Undo removes edge
      editor.undo();
      expect(editor.diagram.edges.some((e) => e.id === edge.id)).toBe(false);

      // Redo restores edge
      editor.redo();
      expect(editor.diagram.edges.some((e) => e.id === edge.id)).toBe(true);
      expect(editor.diagram.edges.find((e) => e.id === edge.id)?.toPoint).toEqual(dropPoint);
    });
  });

  describe("3. Attaching components to the end of the arrow", () => {
    it("should attach a Node (rectangle) and connect the arrow to it", () => {
      const dropPoint = { x: 400, y: 140 };
      renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        fromSide: "right",
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: dropPoint,
        dropClientPoint: dropPoint,
      });

      const result = renderer.attachShapeToArrow("node");
      expect(result).not.toBeNull();
      expect(renderer.isArrowAttachmentPopupOpen()).toBe(false);

      const { node, edge } = result!;
      expect(node.kind).toBe("generic.rectangle");
      expect(node.title).toBe("Node");
      // Since arrow traveled rightwards, node entry side should be left
      expect(edge.toSide).toBe("left");
      expect(edge.fromNodeId).toBe(sourceNode.id);
      expect(edge.toNodeId).toBe(node.id);
      expect(edge.toPoint).toBeUndefined();

      // Node is selected
      expect(editor.selectedNodeIds).toContain(node.id);
    });

    it("should attach a Triangle shape and connect the arrow to it", () => {
      const dropPoint = { x: 400, y: 140 };
      renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        fromSide: "right",
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: dropPoint,
        dropClientPoint: dropPoint,
      });

      const result = renderer.attachShapeToArrow("triangle");
      expect(result).not.toBeNull();

      const { node, edge } = result!;
      expect(node.kind).toBe("generic.triangle");
      expect(edge.fromNodeId).toBe(sourceNode.id);
      expect(edge.toNodeId).toBe(node.id);
      expect(edge.toSide).toBe("left");
    });

    it("should attach a Table and connect the arrow to it", () => {
      const dropPoint = { x: 450, y: 140 };
      renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        fromSide: "right",
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: dropPoint,
        dropClientPoint: dropPoint,
      });

      const result = renderer.attachShapeToArrow("table");
      expect(result).not.toBeNull();

      const { node, edge } = result!;
      expect(node.kind).toBe("generic.table");
      expect(node.customData?.rows).toBe(3);
      expect(node.customData?.cols).toBe(3);
      expect(node.customData?.cells).toEqual([
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
      ]);
      expect(edge.fromNodeId).toBe(sourceNode.id);
      expect(edge.toNodeId).toBe(node.id);
    });

    it("should attach a Sticky Note and connect the arrow to it", () => {
      const dropPoint = { x: 400, y: 140 };
      renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        fromSide: "right",
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: dropPoint,
        dropClientPoint: dropPoint,
      });

      const result = renderer.attachShapeToArrow("sticky-note");
      expect(result).not.toBeNull();

      const { node, edge } = result!;
      expect(node.kind).toBe("generic.stickyNote");
      expect(node.style?.color).toBe("3"); // Yellow preset
      expect(edge.fromNodeId).toBe(sourceNode.id);
      expect(edge.toNodeId).toBe(node.id);
    });

    it("should attach other shapes: circle, diamond, and text", () => {
      // Circle
      renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: { x: 400, y: 140 },
        dropClientPoint: { x: 400, y: 140 },
      });
      const circleRes = renderer.attachShapeToArrow("circle");
      expect(circleRes?.node.kind).toBe("generic.circle");

      // Diamond
      renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: { x: 400, y: 140 },
        dropClientPoint: { x: 400, y: 140 },
      });
      const diamondRes = renderer.attachShapeToArrow("diamond");
      expect(diamondRes?.node.kind).toBe("generic.diamond");

      // Text
      renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: { x: 400, y: 140 },
        dropClientPoint: { x: 400, y: 140 },
      });
      const textRes = renderer.attachShapeToArrow("text");
      expect(textRes?.node.kind).toBe("generic.text");
    });

    it("should correctly calculate entry side based on arrow direction", () => {
      // Arrow drawn downward (dy > dx)
      renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        startPoint: { x: 170, y: 180 },
        dropCanvasPoint: { x: 170, y: 400 },
        dropClientPoint: { x: 170, y: 400 },
      });
      const downRes = renderer.attachShapeToArrow("node");
      expect(downRes?.edge.toSide).toBe("top");

      // Arrow drawn upward
      renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        startPoint: { x: 170, y: 100 },
        dropCanvasPoint: { x: 170, y: -100 },
        dropClientPoint: { x: 170, y: -100 },
      });
      const upRes = renderer.attachShapeToArrow("node");
      expect(upRes?.edge.toSide).toBe("bottom");

      // Arrow drawn leftward
      renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        startPoint: { x: 100, y: 140 },
        dropCanvasPoint: { x: -100, y: 140 },
        dropClientPoint: { x: -100, y: 140 },
      });
      const leftRes = renderer.attachShapeToArrow("node");
      expect(leftRes?.edge.toSide).toBe("right");
    });
  });

  describe("4. Dangling Edges (Pointing to Empty Space) Reconnection & Exporting", () => {
    it("should reconnect dangling edge endpoint to an existing node when dragged to it", () => {
      // Target node
      const targetNode = editor.addNode({
        kind: "generic.rectangle",
        title: "Target Card",
        position: { x: 500, y: 100 },
        size: { width: 140, height: 80 },
      });

      // Add dangling edge pointing to (350, 200)
      const edge = editor.addEdge(sourceNode.id, "", {
        toPoint: { x: 350, y: 200 },
      });
      expect(edge.toPoint).toEqual({ x: 350, y: 200 });
      expect(edge.toNodeId).toBe("");

      // Reconnect target endpoint to targetNode
      editor.reconnectEdge(edge.id, "target", {
        nodeId: targetNode.id,
        side: "left",
      });

      const reconnected = editor.diagram.edges.find((e) => e.id === edge.id);
      expect(reconnected?.toNodeId).toBe(targetNode.id);
      expect(reconnected?.toPoint).toBeUndefined();
      expect(reconnected?.toSide).toBe("left");

      // Undo reconnect
      editor.undo();
      const restored = editor.diagram.edges.find((e) => e.id === edge.id);
      expect(restored?.toNodeId).toBe("");
      expect(restored?.toPoint).toEqual({ x: 350, y: 200 });
    });

    it("should serialize and deserialize diagrams with dangling edges pointing to empty space", () => {
      const serializer = new JsonCanvasSerializer();

      editor.addEdge(sourceNode.id, "", {
        toPoint: { x: 380, y: 220 },
      });

      const serializedJson = serializer.serialize(editor.diagram);
      expect(serializedJson).toContain('"toPoint"');
      expect(serializedJson).toContain('"x": 380');
      expect(serializedJson).toContain('"y": 220');

      const parsedDiagram = serializer.deserialize(serializedJson);
      expect(parsedDiagram.edges.length).toBe(1);
      expect(parsedDiagram.edges[0].fromNodeId).toBe(sourceNode.id);
      expect(parsedDiagram.edges[0].toPoint).toEqual({ x: 380, y: 220 });
    });

    it("should export SVG cleanly when diagram has edges pointing to empty canvas space", () => {
      const exporter = new SvgExporter();

      editor.addEdge(sourceNode.id, "", {
        toPoint: { x: 420, y: 280 },
      });

      const svg = exporter.exportToSvg(editor.diagram, { theme: "light" });
      expect(svg).toBeDefined();
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
      expect(svg).toContain('class="edge-path"');
    });
  });

  describe("5. Freehand Stroke to Empty Space Detection", () => {
    it("should detect stroke drawn from a component to empty canvas space", () => {
      // Stroke starting at (230, 140) near sourceNode and ending in empty space (450, 140)
      const stroke: Stroke = {
        id: "stroke-to-empty",
        points: [
          { x: 230, y: 140 },
          { x: 300, y: 140 },
          { x: 380, y: 140 },
          { x: 450, y: 140 },
          { x: 435, y: 128 },
          { x: 450, y: 140 },
          { x: 435, y: 152 },
        ],
      };

      const result = editor.detectStrokeToEmptySpace(stroke);
      expect(result).not.toBeNull();
      expect(result?.fromNode.id).toBe(sourceNode.id);
      expect(result?.endPoint).toEqual({ x: 450, y: 140 });
      expect(result?.isArrow).toBe(true);
    });

    it("should not detect as empty space if stroke ends near another node", () => {
      // Another node at (450, 100)
      editor.addNode({
        kind: "generic.rectangle",
        position: { x: 450, y: 100 },
        size: { width: 140, height: 80 },
      });

      const stroke: Stroke = {
        id: "stroke-between-nodes",
        points: [
          { x: 230, y: 140 },
          { x: 320, y: 140 },
          { x: 440, y: 140 },
        ],
      };

      const result = editor.detectStrokeToEmptySpace(stroke);
      expect(result).toBeNull();
    });
  });

  describe("6. Interactive Dragging, Keyboard & Mouse Events", () => {
    it("should trigger popup when mouse drags from port handle to empty space", () => {
      // Simulate mousedown on port handle
      const portHandle = new MockElement("circle", {
        cls: "umlcanvas-port-handle",
        attr: {
          "data-port-id": "port-r",
          "data-side": "right",
        },
      });
      const nodeEl = new MockElement("g", {
        cls: "umlcanvas-node",
        attr: { "data-node-id": sourceNode.id },
      });
      nodeEl.appendChild(portHandle);

      (renderer as any).handleMouseDown({
        target: portHandle,
        clientX: 240,
        clientY: 140,
        button: 0,
        preventDefault: () => {},
        stopPropagation: () => {},
      });

      // Mousemove into empty space
      (renderer as any).handleMouseMove({
        clientX: 420,
        clientY: 240,
      });

      // Mouseup in empty space
      (renderer as any).handleMouseUp({
        clientX: 420,
        clientY: 240,
      });

      // Popup should be open!
      expect(renderer.isArrowAttachmentPopupOpen()).toBe(true);

      // Now press Escape on the document
      const escEvt = {
        key: "Escape",
        preventDefault: () => {},
        stopPropagation: () => {},
      };
      (renderer as any).handleKeyDown(escEvt);

      // Popup closed, dangling edge created pointing to empty space
      expect(renderer.isArrowAttachmentPopupOpen()).toBe(false);
      expect(editor.diagram.edges.length).toBe(1);
      const edge = editor.diagram.edges[0];
      expect(edge.fromNodeId).toBe(sourceNode.id);
      expect(edge.toNodeId).toBe("");
      expect(edge.toPoint).toEqual({ x: 420, y: 240 });
    });

    it("should select shape when Enter is pressed in search input", () => {
      const popup = renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        fromSide: "right",
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: { x: 420, y: 240 },
        dropClientPoint: { x: 420, y: 240 },
      });

      // Type "tri" and press Enter
      popup.filter("tri");
      expect(popup.getActiveItem()?.id).toBe("triangle");

      popup.selectActive();
      expect(renderer.isArrowAttachmentPopupOpen()).toBe(false);

      const triangleNode = editor.diagram.nodes.find((n) => n.kind === "generic.triangle");
      expect(triangleNode).toBeDefined();
      expect(editor.diagram.edges.length).toBe(1);
      expect(editor.diagram.edges[0].toNodeId).toBe(triangleNode!.id);
    });

    it("should dismiss popup and create dangling arrow when clicking outside popup", () => {
      renderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        fromSide: "right",
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: { x: 420, y: 240 },
        dropClientPoint: { x: 420, y: 240 },
      });

      expect(renderer.isArrowAttachmentPopupOpen()).toBe(true);

      // Simulate document mousedown outside popup
      const outsideEl = new MockElement("div", { cls: "outside" });
      const docMouseDownHandlers = docListeners["mousedown"] || [];
      docMouseDownHandlers.forEach((h) => h({ target: outsideEl }));

      expect(renderer.isArrowAttachmentPopupOpen()).toBe(false);
      expect(editor.diagram.edges.length).toBe(1);
      expect(editor.diagram.edges[0].toPoint).toEqual({ x: 420, y: 240 });
    });

    it("should reopen attachment popup when double-clicking dangling arrow target endpoint", () => {
      // Create dangling edge pointing to empty space
      const edge = editor.addEdge(sourceNode.id, "", {
        toPoint: { x: 480, y: 220 },
      });

      const endpointHandle = new MockElement("circle", {
        cls: "umlcanvas-edge-handle umlcanvas-edge-endpoint-handle",
        attr: {
          "data-edge-id": edge.id,
          "data-endpoint": "target",
        },
      });

      (renderer as any).handleDblClick({
        target: endpointHandle,
        clientX: 480,
        clientY: 220,
      });

      expect(renderer.isArrowAttachmentPopupOpen()).toBe(true);
      expect((renderer as any).arrowAttachmentState?.dropCanvasPoint).toEqual({ x: 480, y: 220 });
    });
  });

  describe("7. Vault Note & Image Attachments Integration", () => {
    it("should invoke onOpenVaultNote when selecting Vault Note", () => {
      let vaultNoteCalled = false;
      const customRenderer = new SvgSceneRenderer(container as any, editor, {
        onOpenVaultNote: (cb) => {
          vaultNoteCalled = true;
          cb({ path: "Notes/MyIdea.md", basename: "MyIdea" });
        },
      });

      customRenderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        fromSide: "right",
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: { x: 400, y: 200 },
        dropClientPoint: { x: 400, y: 200 },
      });

      customRenderer.attachShapeToArrow("vault-note");
      expect(vaultNoteCalled).toBe(true);

      const noteNode = editor.diagram.nodes.find((n) => n.kind === "obsidian.note");
      expect(noteNode).toBeDefined();
      expect(noteNode?.title).toBe("MyIdea");
      expect(noteNode?.metadata?.filePath).toBe("Notes/MyIdea.md");

      customRenderer.destroy();
    });

    it("should invoke onOpenVaultImage when selecting Image", () => {
      let vaultImageCalled = false;
      const customRenderer = new SvgSceneRenderer(container as any, editor, {
        onOpenVaultImage: (cb) => {
          vaultImageCalled = true;
          cb({ path: "Images/diagram.png", src: "app://local/diagram.png" });
        },
      });

      customRenderer.openArrowAttachmentPopup({
        fromNodeId: sourceNode.id,
        fromSide: "right",
        startPoint: { x: 240, y: 140 },
        dropCanvasPoint: { x: 400, y: 200 },
        dropClientPoint: { x: 400, y: 200 },
      });

      customRenderer.attachShapeToArrow("image");
      expect(vaultImageCalled).toBe(true);

      const imgNode = editor.diagram.nodes.find((n) => n.kind === "generic.image");
      expect(imgNode).toBeDefined();
      expect(imgNode?.metadata?.src).toBe("app://local/diagram.png");

      customRenderer.destroy();
    });
  });
});
