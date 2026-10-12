import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { DiagramNode } from "../src/domain/entities/DiagramNode";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { JsonCanvasSerializer } from "../src/infrastructure/persistence/JsonCanvasSerializer";
import { defaultJsonCanvasImporter } from "../src/infrastructure/persistence/JsonCanvasImporter";
import { defaultJsonCanvasExporter } from "../src/infrastructure/export/JsonCanvasExporter";
import { defaultSvgExporter } from "../src/infrastructure/export/SvgExporter";
import { calculateNodeFitSize } from "../src/domain/services/TextMeasurement";
import { isImageFile, SUPPORTED_IMAGE_EXTENSIONS } from "../src/presentation/views/ImageSuggestModal";

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
          const actual = el.title || el.getAttribute(attrName) || "";
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

// Global environment mocks
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
  setTimeout: (cb: () => void) => {
    cb();
    return 0;
  },
  clearTimeout: () => {},
};

(global as any).document = {
  createElement: (tag: string) => new MockElement(tag),
  createElementNS: (_ns: string, tag: string) => new MockElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {},
};

(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

describe("Import Images and Sticky Notes Tests", () => {
  let editor: DiagramEditor;
  let container: MockElement;
  let renderer: SvgSceneRenderer;

  beforeEach(() => {
    editor = new DiagramEditor(
      createDiagram({ id: "diag-test", title: "Images and Notes", diagramType: "general" })
    );
    container = new MockElement("div", { cls: "umlcanvas-view-container" });
    renderer = new SvgSceneRenderer(container as any, editor);
  });

  describe("Photo-Frame Style Image Nodes", () => {
    it("should create generic.image node with photo frame dimensions and title", () => {
      const imgNode = editor.addNode({
        kind: "generic.image",
        title: "Sunset at Beach",
        position: { x: 150, y: 120 },
        size: { width: 220, height: 260 },
        customData: { src: "app://local/assets/sunset.png", filePath: "assets/sunset.png" },
      });

      expect(imgNode.kind).toBe("generic.image");
      expect(imgNode.labels[0].text).toBe("Sunset at Beach");
      expect(imgNode.size).toEqual({ width: 220, height: 260 });
      expect(imgNode.customData?.src).toBe("app://local/assets/sunset.png");
    });

    it("should render outer frame box, inner photo mat, image element, and title inside frame", () => {
      const imgNode = editor.addNode({
        kind: "generic.image",
        title: "Vacation Photo",
        position: { x: 100, y: 100 },
        size: { width: 220, height: 260 },
        customData: { src: "https://example.com/vacation.jpg" },
      });

      renderer.render();

      const nodeEl = container.querySelector(`[data-node-id="${imgNode.id}"]`);
      expect(nodeEl).not.toBeNull();

      // Outer photo frame body
      const frameBody = nodeEl?.querySelector(".umlcanvas-photo-frame-body");
      expect(frameBody).not.toBeNull();
      expect(frameBody?.getAttribute("rx")).toBe("6");

      // Inner photo mat / viewport
      const mat = nodeEl?.querySelector(".umlcanvas-photo-mat");
      expect(mat).not.toBeNull();

      // Image element with src href
      const imgTag = nodeEl?.querySelector("image");
      expect(imgTag).not.toBeNull();
      expect(imgTag?.getAttribute("href")).toBe("https://example.com/vacation.jpg");

      // Title inside the frame (Polaroid / placard style)
      const titleEl = nodeEl?.querySelector(".umlcanvas-photo-frame-title");
      expect(titleEl).not.toBeNull();
      expect(titleEl?.textContent).toBe("Vacation Photo");
    });

    it("should render placeholder icon and text when no image src is set yet", () => {
      const imgNode = editor.addNode({
        kind: "generic.image",
        title: "Empty Frame",
        position: { x: 100, y: 100 },
        size: { width: 220, height: 260 },
      });

      renderer.render();

      const nodeEl = container.querySelector(`[data-node-id="${imgNode.id}"]`);
      const placeholder = nodeEl?.querySelector(".umlcanvas-photo-placeholder");
      expect(placeholder).not.toBeNull();
      expect(placeholder?.textContent).toContain("Drop or click image");
    });

    it("should calculate in-place editor bounds directly inside the frame title area", () => {
      const imgNode = editor.addNode({
        kind: "generic.image",
        title: "Editable Title",
        position: { x: 100, y: 100 },
        size: { width: 220, height: 260 },
      });

      const bounds = renderer.getNodeInPlaceEditorBounds(imgNode);
      expect(bounds.textAlign).toBe("center");
      // Bounds should be located at the bottom caption area inside the frame
      expect(bounds.x).toBe(imgNode.position.x + 8);
      expect(bounds.y).toBe(imgNode.position.y + imgNode.size.height - 38);
      expect(bounds.width).toBe(imgNode.size.width - 16);
    });

    it("should support in-place title editing on image node", () => {
      const imgNode = editor.addNode({
        kind: "generic.image",
        title: "Old Title",
        position: { x: 100, y: 100 },
        size: { width: 220, height: 260 },
      });

      renderer.render();
      renderer.startInlineEditor(imgNode);

      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      expect(activeEditor).not.toBeNull();
      expect(activeEditor.value).toBe("Old Title");

      activeEditor.value = "New Photo Caption";
      renderer.commitInlineEditor();

      expect(imgNode.labels[0].text).toBe("New Photo Caption");
    });

    it("should provide cardinal ports on photo frame allowing linking with lines", () => {
      const img1 = editor.addNode({
        kind: "generic.image",
        title: "Photo 1",
        position: { x: 100, y: 100 },
        size: { width: 220, height: 260 },
      });
      const img2 = editor.addNode({
        kind: "generic.image",
        title: "Photo 2",
        position: { x: 400, y: 100 },
        size: { width: 220, height: 260 },
      });

      const shapeDef = renderer.shapeRegistry.get("generic.image");
      const ports = shapeDef.getPorts(img1);
      expect(ports.length).toBe(4);
      expect(ports.map((p) => p.side)).toEqual(["top", "right", "bottom", "left"]);

      // Link images with line
      const edge = editor.addEdge(img1.id, img2.id, { routing: "straight" });
      expect(edge).toBeDefined();
      expect(edge.fromNodeId).toBe(img1.id);
      expect(edge.toNodeId).toBe(img2.id);
      expect(editor.diagram.edges.length).toBe(1);
    });

    it("should serialize and deserialize image node with customData src and metadata", () => {
      const imgNode = editor.addNode({
        kind: "generic.image",
        title: "Persisted Photo",
        position: { x: 50, y: 80 },
        size: { width: 220, height: 260 },
        customData: { src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==", filePath: "photos/pic.png" },
        metadata: { filePath: "photos/pic.png" },
      });

      const serializer = new JsonCanvasSerializer();
      const jsonStr = serializer.serialize(editor.diagram);
      const restored = serializer.deserialize(jsonStr);

      const restoredNode = restored.nodes.find((n) => n.id === imgNode.id);
      expect(restoredNode).toBeDefined();
      expect(restoredNode?.kind).toBe("generic.image");
      expect(restoredNode?.labels[0]?.text).toBe("Persisted Photo");
      expect(restoredNode?.customData?.src).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
      expect(restoredNode?.customData?.filePath).toBe("photos/pic.png");
    });

    it("should recognize supported image extensions", () => {
      expect(isImageFile("photo.png")).toBe(true);
      expect(isImageFile("image.jpg")).toBe(true);
      expect(isImageFile("picture.jpeg")).toBe(true);
      expect(isImageFile("vector.svg")).toBe(true);
      expect(isImageFile("animated.gif")).toBe(true);
      expect(isImageFile("modern.webp")).toBe(true);
      expect(isImageFile("document.md")).toBe(false);
      expect(isImageFile("script.ts")).toBe(false);
    });

    it("should export image node to standalone SVG with photo frame", () => {
      editor.addNode({
        kind: "generic.image",
        title: "Exported Frame",
        position: { x: 50, y: 50 },
        size: { width: 220, height: 260 },
        customData: { src: "https://example.com/exported.png" },
      });

      const svg = defaultSvgExporter.exportToSvg(editor.diagram, { theme: "light" });
      expect(svg).toContain("umlcanvas-photo-frame-body");
      expect(svg).toContain("umlcanvas-photo-mat");
      expect(svg).toContain("https://example.com/exported.png");
      expect(svg).toContain("Exported Frame");
    });
  });

  describe("Sticky Notes (Text Pads for Thoughts & Mindmaps)", () => {
    it("should create sticky note with default canary yellow color preset", () => {
      const sticky = editor.addNode({
        kind: "generic.stickyNote",
        title: "Brainstorming idea",
        position: { x: 100, y: 100 },
        size: { width: 180, height: 140 },
        style: { color: "3" },
      });

      expect(sticky.kind).toBe("generic.stickyNote");
      expect(sticky.style?.color).toBe("3");
      expect(sticky.labels[0].text).toBe("Brainstorming idea");
    });

    it("should render sticky body, top adhesive strip, and text pad", () => {
      const sticky = editor.addNode({
        kind: "generic.stickyNote",
        title: "Point 1\nPoint 2\nPoint 3",
        position: { x: 100, y: 100 },
        size: { width: 180, height: 140 },
        style: { color: "3" },
      });

      renderer.render();

      const nodeEl = container.querySelector(`[data-node-id="${sticky.id}"]`);
      expect(nodeEl).not.toBeNull();

      // Sticky body
      const body = nodeEl?.querySelector(".umlcanvas-sticky-body");
      expect(body).not.toBeNull();

      // Adhesive top strip
      const strip = nodeEl?.querySelector(".umlcanvas-sticky-strip");
      expect(strip).not.toBeNull();

      // Multiline text elements
      const textEls = nodeEl?.querySelectorAll(".umlcanvas-sticky-text");
      expect(textEls?.length).toBe(3);
      expect(textEls?.[0]?.textContent).toBe("Point 1");
      expect(textEls?.[1]?.textContent).toBe("Point 2");
      expect(textEls?.[2]?.textContent).toBe("Point 3");
    });

    it("should render placeholder text for empty sticky note", () => {
      const sticky = editor.addNode({
        kind: "generic.stickyNote",
        title: "",
        position: { x: 100, y: 100 },
        size: { width: 180, height: 140 },
      });

      renderer.render();

      const nodeEl = container.querySelector(`[data-node-id="${sticky.id}"]`);
      const placeholder = nodeEl?.querySelector(".umlcanvas-sticky-placeholder");
      expect(placeholder).not.toBeNull();
      expect(placeholder?.textContent).toBe("Type a note...");
    });

    it("should calculate comfortable in-place editor bounds over sticky text pad", () => {
      const sticky = editor.addNode({
        kind: "generic.stickyNote",
        title: "Thought pad",
        position: { x: 200, y: 150 },
        size: { width: 180, height: 140 },
      });

      const bounds = renderer.getNodeInPlaceEditorBounds(sticky);
      expect(bounds.textAlign).toBe("left");
      expect(bounds.x).toBe(sticky.position.x + 10);
      expect(bounds.y).toBe(sticky.position.y + 24);
      expect(bounds.width).toBe(sticky.size.width - 20);
      expect(bounds.height).toBe(sticky.size.height - 32);
    });

    it("should link sticky notes with lines to build mindmaps", () => {
      const rootIdea = editor.addNode({
        kind: "generic.stickyNote",
        title: "Project Architecture",
        position: { x: 200, y: 200 },
        size: { width: 180, height: 140 },
        style: { color: "3" }, // Yellow
      });

      const branch1 = editor.addNode({
        kind: "generic.stickyNote",
        title: "Frontend UI",
        position: { x: 50, y: 400 },
        size: { width: 180, height: 140 },
        style: { color: "5" }, // Sky Blue
      });

      const branch2 = editor.addNode({
        kind: "generic.stickyNote",
        title: "Backend Services",
        position: { x: 350, y: 400 },
        size: { width: 180, height: 140 },
        style: { color: "4" }, // Green
      });

      // Connect mindmap edges
      const edge1 = editor.addEdge(rootIdea.id, branch1.id, { routing: "curved" });
      const edge2 = editor.addEdge(rootIdea.id, branch2.id, { routing: "curved" });

      expect(editor.diagram.edges.length).toBe(2);
      expect(edge1.fromNodeId).toBe(rootIdea.id);
      expect(edge1.toNodeId).toBe(branch1.id);
      expect(edge2.fromNodeId).toBe(rootIdea.id);
      expect(edge2.toNodeId).toBe(branch2.id);

      // Verify cardinal ports are available for interactive line connection
      const shapeDef = renderer.shapeRegistry.get("generic.stickyNote");
      const ports = shapeDef.getPorts(rootIdea);
      expect(ports.length).toBe(4);
      expect(ports.map((p) => p.side)).toEqual(["top", "right", "bottom", "left"]);
    });

    it("should move freely inside canvas workspace while keeping lines connected", () => {
      const sticky1 = editor.addNode({
        kind: "generic.stickyNote",
        title: "Moving Note",
        position: { x: 100, y: 100 },
        size: { width: 180, height: 140 },
      });
      const sticky2 = editor.addNode({
        kind: "generic.stickyNote",
        title: "Target Note",
        position: { x: 300, y: 100 },
        size: { width: 180, height: 140 },
      });
      const edge = editor.addEdge(sticky1.id, sticky2.id);

      // Move sticky note freely
      editor.moveNodes([{ nodeId: sticky1.id, oldPos: sticky1.position, newPos: { x: 150, y: 250 } }]);
      expect(sticky1.position).toEqual({ x: 150, y: 250 });

      // Edge connection remains linked
      expect(edge.fromNodeId).toBe(sticky1.id);
      expect(edge.toNodeId).toBe(sticky2.id);

      // Nudge moves
      editor.selectNode(sticky1.id, false);
      editor.moveNodes([{ nodeId: sticky1.id, oldPos: sticky1.position, newPos: { x: 160, y: 260 } }]);
      expect(sticky1.position).toEqual({ x: 160, y: 260 });
    });

    it("should offer common colors (Presets 1-6 and custom)", () => {
      const sticky = editor.addNode({
        kind: "generic.stickyNote",
        title: "Color Test",
        position: { x: 100, y: 100 },
        size: { width: 180, height: 140 },
        style: { color: "3" },
      });

      editor.selectNode(sticky.id, false);

      // Assign Pink (1)
      editor.setColorForSelection("1");
      expect(sticky.style?.color).toBe("1");

      // Assign Green (4)
      editor.setColorForSelection("4");
      expect(sticky.style?.color).toBe("4");

      // Assign Blue (5)
      editor.setColorForSelection("5");
      expect(sticky.style?.color).toBe("5");

      // Assign Custom Hex
      editor.setColorForSelection("#f0a500");
      expect(sticky.style?.color).toBe("#f0a500");
    });

    it("should auto-fit size according to multiline content", () => {
      const sticky = editor.addNode({
        kind: "generic.stickyNote",
        title: "Line 1 with lots of interesting text here\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6",
        position: { x: 100, y: 100 },
        size: { width: 140, height: 80 },
      });

      const fitSize = calculateNodeFitSize(sticky);
      expect(fitSize.width).toBeGreaterThanOrEqual(180);
      expect(fitSize.height).toBeGreaterThanOrEqual(140);

      editor.autoResizeNode(sticky.id);
      expect(sticky.size.width).toBeGreaterThanOrEqual(180);
      expect(sticky.size.height).toBeGreaterThanOrEqual(140);
    });

    it("should export sticky note to SVG and JsonCanvas", () => {
      const sticky = editor.addNode({
        kind: "generic.stickyNote",
        title: "SVG Exported Thought",
        position: { x: 100, y: 100 },
        size: { width: 180, height: 140 },
        style: { color: "3" },
      });

      // SVG export
      const svg = defaultSvgExporter.exportToSvg(editor.diagram, { theme: "light" });
      expect(svg).toContain("umlcanvas-sticky-body");
      expect(svg).toContain("umlcanvas-sticky-strip");
      expect(svg).toContain("SVG Exported Thought");

      // JsonCanvas export
      const jsonCanvas = defaultJsonCanvasExporter.exportToJsonCanvas(editor.diagram);
      expect(jsonCanvas).toContain("SVG Exported Thought");
      expect(jsonCanvas).toContain('"color": "3"');
    });
  });

  describe("Toolbar Integration", () => {
    it("should provide Sticky Note and Image buttons in bottom floating toolbar", () => {
      const onAddImage = jest.fn();
      const toolbar = new Toolbar(
        container as any,
        editor,
        renderer,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        onAddImage
      );

      const bottomToolbar = container.querySelector(".umlcanvas-floating-bottom-toolbar");
      expect(bottomToolbar).not.toBeNull();

      // Sticky Note button
      const noteBtn = bottomToolbar?.querySelector("[title*='Sticky Note']");
      expect(noteBtn).not.toBeNull();

      // Image button
      const imageBtn = bottomToolbar?.querySelector("[title*='Insert Image']");
      expect(imageBtn).not.toBeNull();

      // Click image button
      imageBtn?.click();
      expect(onAddImage).toHaveBeenCalledTimes(1);

      // Click sticky note button
      const initialNodeCount = editor.diagram.nodes.length;
      noteBtn?.click();
      expect(editor.diagram.nodes.length).toBe(initialNodeCount + 1);
      const addedNode = editor.diagram.nodes[editor.diagram.nodes.length - 1];
      expect(addedNode.kind).toBe("generic.stickyNote");
      expect(addedNode.style?.color).toBe("3"); // Canary yellow

      toolbar.destroy();
    });

    it("should provide Insert Sticky Note and Insert Image in File Menu dropdown", () => {
      const onAddImage = jest.fn();
      const toolbar = new Toolbar(
        container as any,
        editor,
        renderer,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        onAddImage
      );

      const fileBtn = container.querySelector(".umlcanvas-menu-trigger");
      expect(fileBtn).not.toBeNull();
      fileBtn?.click();

      const dropdown = container.querySelector(".umlcanvas-file-menu-dropdown");
      expect(dropdown).not.toBeNull();

      const items = dropdown?.querySelectorAll(".umlcanvas-menu-item") || [];
      const labels = items.map((i) => i.textContent);

      expect(labels.some((l) => l.includes("Insert Sticky Note"))).toBe(true);
      expect(labels.some((l) => l.includes("Insert Image (Photo Frame)"))).toBe(true);

      const imageItem = items.find((i) => i.textContent.includes("Insert Image (Photo Frame)"));
      imageItem?.click();
      expect(onAddImage).toHaveBeenCalledTimes(1);

      toolbar.destroy();
    });
  });
});
