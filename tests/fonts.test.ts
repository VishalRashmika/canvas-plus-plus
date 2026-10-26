import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { DiagramNode } from "../src/domain/entities/DiagramNode";
import { createGroup } from "../src/domain/entities/Group";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { defaultSvgExporter } from "../src/infrastructure/export/SvgExporter";
import { JsonCanvasSerializer } from "../src/infrastructure/persistence/JsonCanvasSerializer";
import { FONT_SIZE_PRESETS, FONT_FAMILY_PRESETS } from "../src/presentation/theme/Typography";

// Comprehensive MockElement for testing in Jest / Node environment
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
  private _style: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  listeners: Record<string, ((e: any) => void)[]> = {};
  title: string = "";
  disabled: boolean = false;
  value: string = "";
  private _textContent: string = "";
  clientWidth: number = 1000;
  clientHeight: number = 800;
  scrollWidth: number = 1000;
  scrollHeight: number = 800;

  get style(): any {
    return new Proxy(this._style, {
      get: (target, prop: string) => {
        if (typeof prop !== "string") return (target as any)[prop];
        const camel = prop.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
        const kebab = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
        return target[prop] ?? target[camel] ?? target[kebab];
      },
      set: (target, prop: string, value: any) => {
        if (typeof prop !== "string") {
          (target as any)[prop] = value;
          return true;
        }
        const camel = prop.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
        const kebab = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
        target[prop] = String(value);
        target[camel] = String(value);
        target[kebab] = String(value);
        return true;
      },
    });
  }

  set style(val: any) {
    if (typeof val === "object" && val !== null) {
      Object.assign(this._style, val);
    }
  }

  constructor(tagName: string, options?: any) {
    this.tagName = tagName.toUpperCase();
    if (options?.cls) {
      this.classList.add(options.cls);
    }
    if (options?.text) {
      this._textContent = options.text;
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

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map((c) => c.textContent).join("");
  }
  set textContent(val: string) {
    this._textContent = val;
    this.children.forEach((c) => (c.parentElement = null));
    this.children = [];
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

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const traverse = (el: MockElement) => {
      for (const child of el.children) {
        if (this.matchesSelector(child, selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  private matchesSelector(el: MockElement, selector: string): boolean {
    if (selector.startsWith(".")) {
      const cls = selector.slice(1);
      return el.classList.contains(cls);
    }
    if (selector.startsWith("#")) {
      const id = selector.slice(1);
      return el.attributes["id"] === id;
    }
    if (selector.startsWith("[")) {
      const match = selector.match(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"']+)["']?)?\]/);
      if (match) {
        const [, attr, val] = match;
        return val !== undefined ? el.attributes[attr] === val : attr in el.attributes;
      }
    }
    return el.tagName.toLowerCase() === selector.toLowerCase();
  }

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      const parts = selector.split(",").map((s) => s.trim());
      for (const part of parts) {
        if (this.matchesSelector(curr, part)) {
          return curr;
        }
      }
      curr = curr.parentElement;
    }
    return null;
  }

  getBoundingClientRect() {
    return {
      left: 100,
      top: 100,
      right: 300,
      bottom: 200,
      width: 200,
      height: 100,
      x: 100,
      y: 100,
    };
  }
}

// Global Obsidian mock functions
(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

describe("Font Adjustments Across the Entire Canvas", () => {
  let editor: DiagramEditor;
  let originalCreateElement: any;
  let originalCreateNS: any;

  beforeAll(() => {
    originalCreateElement = (global as any).document?.createElement;
    originalCreateNS = (global as any).document?.createElementNS;

    (global as any).document = {
      createElement: (tag: string, options?: any) => new MockElement(tag, options),
      createElementNS: (_ns: string, tag: string) => new MockElement(tag),
      addEventListener: () => {},
      removeEventListener: () => {},
      body: new MockElement("body"),
    };
    (global as any).window = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });

  afterAll(() => {
    if (originalCreateElement) {
      (global as any).document.createElement = originalCreateElement;
      (global as any).document.createElementNS = originalCreateNS;
    }
  });

  beforeEach(() => {
    const diagram = createDiagram({
      id: "test-diagram",
      diagramType: "general",
      title: "Typography Diagram",
    });
    editor = new DiagramEditor(diagram);
  });

  describe("1. DiagramEditor Font Manipulation & Undo/Redo", () => {
    test("sets font size, bold, and italic on a selected node", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        title: "My Class",
        position: { x: 50, y: 50 },
        size: { width: 120, height: 60 },
      });
      editor.selectNode(node.id);

      // Set font size to 20
      editor.setFontSizeForSelection(20);
      let font = editor.getNodeFont(node.id);
      expect(font.fontSize).toBe(20);
      expect(editor.diagram.nodes[0].style?.fontSize).toBe(20);

      // Toggle bold
      editor.toggleBoldForSelection();
      font = editor.getNodeFont(node.id);
      expect(font.bold).toBe(true);
      expect(editor.diagram.nodes[0].style?.bold).toBe(true);

      // Toggle italic
      editor.toggleItalicForSelection();
      font = editor.getNodeFont(node.id);
      expect(font.italic).toBe(true);
      expect(editor.diagram.nodes[0].style?.italic).toBe(true);

      // Undo italic
      editor.undo();
      font = editor.getNodeFont(node.id);
      expect(font.italic).toBeFalsy();

      // Undo bold
      editor.undo();
      font = editor.getNodeFont(node.id);
      expect(font.bold).toBeFalsy();

      // Undo font size
      editor.undo();
      font = editor.getNodeFont(node.id);
      expect(font.fontSize).toBeUndefined();

      // Redo font size
      editor.redo();
      font = editor.getNodeFont(node.id);
      expect(font.fontSize).toBe(20);
    });

    test("adjusts font size with steppers (+2 / -2) and clamps properly", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        title: "Stepper Test",
        position: { x: 50, y: 50 },
        size: { width: 120, height: 60 },
      });
      editor.selectNode(node.id);

      // Default font size starts at 13; +2 should make it 15
      editor.adjustFontSizeForSelection(2);
      expect(editor.getNodeFont(node.id).fontSize).toBe(15);

      // -2 brings it back to 13
      editor.adjustFontSizeForSelection(-2);
      expect(editor.getNodeFont(node.id).fontSize).toBe(13);

      // Cannot go below 8
      editor.setFontSizeForSelection(8);
      editor.adjustFontSizeForSelection(-2);
      expect(editor.getNodeFont(node.id).fontSize).toBe(8);

      // Cannot go above 72
      editor.setFontSizeForSelection(72);
      editor.adjustFontSizeForSelection(4);
      expect(editor.getNodeFont(node.id).fontSize).toBe(72);
    });

    test("resets font to default", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        title: "Reset Test",
        position: { x: 50, y: 50 },
        size: { width: 120, height: 60 },
      });
      editor.selectNode(node.id);

      editor.setFontSizeForSelection(28);
      editor.toggleBoldForSelection();
      editor.toggleItalicForSelection();

      editor.resetFontForSelection();
      const font = editor.getNodeFont(node.id);
      expect(font.fontSize).toBeUndefined();
      expect(font.bold).toBeFalsy();
      expect(font.italic).toBeFalsy();
    });

    test("sets and undoes font on edges", () => {
      const n1 = editor.addNode({
        kind: "generic.rectangle",
        title: "Source",
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 },
      });
      const n2 = editor.addNode({
        kind: "generic.rectangle",
        title: "Target",
        position: { x: 200, y: 0 },
        size: { width: 100, height: 50 },
      });

      const edge = editor.addEdge(n1.id, n2.id, {
        labels: [{ id: "el1", text: "contains" } as any],
      });
      editor.selectEdge(edge.id);

      editor.setFontSizeForSelection(16);
      editor.toggleBoldForSelection();

      let font = editor.getEdgeFont(edge.id);
      expect(font.fontSize).toBe(16);
      expect(font.bold).toBe(true);

      editor.undo();
      font = editor.getEdgeFont(edge.id);
      expect(font.bold).toBeFalsy();

      editor.undo();
      font = editor.getEdgeFont(edge.id);
      expect(font.fontSize).toBeUndefined();
    });

    test("sets and undoes font on groups", () => {
      const group = createGroup({
        id: "group-1",
        name: "Backend Services",
        nodeIds: ["n1", "n2"],
      });
      editor.diagram.groups.push(group);
      editor.selectGroup("group-1");

      editor.setFontSizeForSelection(20);
      editor.toggleItalicForSelection();

      let font = editor.getGroupFont("group-1");
      expect(font.fontSize).toBe(20);
      expect(font.italic).toBe(true);

      editor.undo();
      font = editor.getGroupFont("group-1");
      expect(font.italic).toBeFalsy();

      editor.undo();
      font = editor.getGroupFont("group-1");
      expect(font.fontSize).toBeUndefined();
    });

    test("applies font to multi-selection with mixed elements (node, edge, group)", () => {
      const n1 = editor.addNode({
        kind: "generic.rectangle",
        title: "N1",
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 },
      });
      const n2 = editor.addNode({
        kind: "generic.rectangle",
        title: "N2",
        position: { x: 200, y: 0 },
        size: { width: 100, height: 50 },
      });

      const edge = editor.addEdge(n1.id, n2.id, {
        labels: [{ id: "el1", text: "link" } as any],
      });
      const group = createGroup({
        id: "g1",
        name: "Group",
        nodeIds: [n1.id],
      });
      editor.diagram.groups.push(group);

      // Select all 3
      editor.selectNode(n1.id);
      editor.selectEdge(edge.id, true);
      editor.selectGroup(group.id, true);

      // Set font size 28 for all
      editor.setFontSizeForSelection(28);
      expect(editor.getNodeFont(n1.id).fontSize).toBe(28);
      expect(editor.getEdgeFont(edge.id).fontSize).toBe(28);
      expect(editor.getGroupFont(group.id).fontSize).toBe(28);

      // Toggle bold for all
      editor.toggleBoldForSelection();
      expect(editor.getNodeFont(n1.id).bold).toBe(true);
      expect(editor.getEdgeFont(edge.id).bold).toBe(true);
      expect(editor.getGroupFont(group.id).bold).toBe(true);

      // Undo should revert all 3 together
      editor.undo();
      expect(editor.getNodeFont(n1.id).bold).toBeFalsy();
      expect(editor.getEdgeFont(edge.id).bold).toBeFalsy();
      expect(editor.getGroupFont(group.id).bold).toBeFalsy();
    });
  });

  describe("2. SvgSceneRenderer Visual Font Rendering", () => {
    test("renders node with custom font size, bold, and italic classes", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        title: "Visual Node",
        position: { x: 10, y: 10 },
        size: { width: 140, height: 70 },
        style: {
          fontSize: 20,
          bold: true,
          italic: true,
        },
      });

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      const titleEl = container.querySelector(".umlcanvas-node-title");
      expect(titleEl).not.toBeNull();
      expect(titleEl.style["font-size"]).toBe("20px");
      expect(titleEl.classList.contains("umlcanvas-bold")).toBe(true);
      expect(titleEl.classList.contains("umlcanvas-italic")).toBe(true);
    });

    test("renders edge label with custom font size, bold, and italic", () => {
      const n1 = editor.addNode({
        kind: "generic.rectangle",
        title: "A",
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 },
      });
      const n2 = editor.addNode({
        kind: "generic.rectangle",
        title: "B",
        position: { x: 200, y: 0 },
        size: { width: 100, height: 50 },
      });

      const edge = editor.addEdge(n1.id, n2.id, {
        labels: [{ id: "el1", text: "Custom Font Edge" } as any],
        style: {
          fontSize: 16,
          bold: true,
        },
      });

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      const edgeLabel = container.querySelector(".umlcanvas-edge-label");
      expect(edgeLabel).not.toBeNull();
      expect(edgeLabel.style["font-size"]).toBe("16px");
      expect(edgeLabel.classList.contains("umlcanvas-bold")).toBe(true);
    });

    test("renders group title with custom font size and bold", () => {
      const n1 = editor.addNode({
        kind: "generic.rectangle",
        title: "G Node",
        position: { x: 50, y: 50 },
        size: { width: 100, height: 50 },
      });

      const group = createGroup({
        id: "group-render",
        name: "Custom Font Group",
        nodeIds: [n1.id],
        fontSize: 24,
        bold: true,
      });
      editor.diagram.groups.push(group);

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      const groupTitle = container.querySelector(".umlcanvas-group-title");
      expect(groupTitle).not.toBeNull();
      expect(groupTitle.style["font-size"]).toBe("24px");
      expect(groupTitle.classList.contains("umlcanvas-bold")).toBe(true);
    });
  });

  describe("3. Inline Editor Font Inheritance & Dynamic Shortcuts", () => {
    test("inline editor inherits node font styles and updates via Ctrl+B / Ctrl+I", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        title: "Inline Node",
        position: { x: 100, y: 100 },
        size: { width: 140, height: 80 },
        style: {
          fontSize: 18,
          bold: false,
          italic: false,
        },
      });

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      // Start inline editor
      renderer.startInlineEditor(node);

      const input = container.querySelector(".umlcanvas-node-inline-editor");
      expect(input).not.toBeNull();
      expect(input.style["font-size"]).toBe("18px");
      expect(input.style["font-weight"]).toBe("normal");
      expect(input.style["font-style"]).toBe("normal");

      // Press Ctrl+B while editing inline
      input.dispatch("keydown", { key: "b", ctrlKey: true });
      expect(input.style["font-weight"]).toBe("bold");

      // Press Ctrl+I while editing inline
      input.dispatch("keydown", { key: "i", ctrlKey: true });
      expect(input.style["font-style"]).toBe("italic");

      // Blur to commit
      input.value = "Updated Title";
      input.dispatch("blur");

      // Node should reflect the new bold and italic styles
      const updatedFont = editor.getNodeFont(node.id);
      expect(updatedFont.bold).toBe(true);
      expect(updatedFont.italic).toBe(true);
    });

    test("inline editor for group inherits group font size and style", () => {
      const n1 = editor.addNode({
        kind: "generic.rectangle",
        title: "Group Mem",
        position: { x: 50, y: 50 },
        size: { width: 100, height: 50 },
      });

      const group = createGroup({
        id: "group-inline",
        name: "Cluster Alpha",
        nodeIds: [n1.id],
        fontSize: 20,
        bold: true,
      });
      editor.diagram.groups.push(group);

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      renderer.startGroupInlineEditor(group);

      const groupInput = container.querySelector(".umlcanvas-group-inline-editor");
      expect(groupInput).not.toBeNull();
      expect(groupInput.style["font-size"]).toBe("20px");
      expect(groupInput.style["font-weight"]).toBe("bold");
    });
  });

  describe("4. Global Canvas Shortcuts (Ctrl+B, Ctrl+I, Ctrl+[, Ctrl+])", () => {
    test("global shortcuts toggle bold, italic, and step font size", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        title: "Shortcut Test",
        position: { x: 50, y: 50 },
        size: { width: 120, height: 60 },
      });
      editor.selectNode(node.id);

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      // Ctrl+B -> bold
      (renderer as any).handleKeyDown({
        key: "b",
        ctrlKey: true,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as any);
      expect(editor.getNodeFont(node.id).bold).toBe(true);

      // Ctrl+I -> italic
      (renderer as any).handleKeyDown({
        key: "i",
        ctrlKey: true,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as any);
      expect(editor.getNodeFont(node.id).italic).toBe(true);

      // Ctrl+] -> +2px (from default 13 to 15)
      (renderer as any).handleKeyDown({
        key: "]",
        ctrlKey: true,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as any);
      expect(editor.getNodeFont(node.id).fontSize).toBe(15);

      // Ctrl+[ -> -2px (from 15 to 13)
      (renderer as any).handleKeyDown({
        key: "[",
        ctrlKey: true,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as any);
      expect(editor.getNodeFont(node.id).fontSize).toBe(13);
    });
  });

  describe("5. Toolbar Typography Controls & Popover", () => {
    test("toolbar font buttons and popover interaction", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        title: "Toolbar Node",
        position: { x: 50, y: 50 },
        size: { width: 120, height: 60 },
      });
      editor.selectNode(node.id);

      const container = new MockElement("div") as any;
      const rendererMock: any = {
        isFreehandEnabled: true,
        freehandMode: false,
        isAutoShapeDetection: false,
        currentTransform: { panX: 0, panY: 0, zoom: 1 },
        setFreehandMode: jest.fn(),
        setAutoShapeDetection: jest.fn(),
        setGridVisible: jest.fn(),
        zoomIn: jest.fn(),
        zoomOut: jest.fn(),
        resetZoom: jest.fn(),
        startInlineEditor: jest.fn(),
        startEdgeInlineEditor: jest.fn(),
        startGroupInlineEditor: jest.fn(),
      };

      const toolbar = new Toolbar(container, editor, rendererMock);
      (toolbar as any).updateState();

      const boldBtn = container.querySelector(".umlcanvas-bold-btn");
      const italicBtn = container.querySelector(".umlcanvas-italic-btn");
      const fontSizeBtn = container.querySelector(".umlcanvas-font-size-btn");

      expect(boldBtn).not.toBeNull();
      expect(italicBtn).not.toBeNull();
      expect(fontSizeBtn).not.toBeNull();

      // Click bold button
      boldBtn.dispatch("click");
      expect(editor.getNodeFont(node.id).bold).toBe(true);
      expect(boldBtn.classList.contains("is-active")).toBe(true);

      // Click italic button
      italicBtn.dispatch("click");
      expect(editor.getNodeFont(node.id).italic).toBe(true);
      expect(italicBtn.classList.contains("is-active")).toBe(true);

      // Click font size button to open popover
      fontSizeBtn.dispatch("click");
      const popover = container.querySelector(".umlcanvas-font-size-popover");
      expect(popover).not.toBeNull();

      // Click preset (e.g. Large 20px)
      const presets = popover.querySelectorAll(".umlcanvas-font-preset-btn");
      expect(presets.length).toBe(FONT_SIZE_PRESETS.length);

      const largePreset = presets.find((p: MockElement) =>
        p.textContent.includes("Large")
      );
      expect(largePreset).toBeDefined();
      largePreset.dispatch("click");

      expect(editor.getNodeFont(node.id).fontSize).toBe(20);

      // Re-open and click reset
      fontSizeBtn.dispatch("click");
      const resetBtn = container.querySelector(".umlcanvas-font-reset-btn");
      expect(resetBtn).not.toBeNull();
      resetBtn.dispatch("click");

      expect(editor.getNodeFont(node.id).fontSize).toBeUndefined();
    });
  });

  describe("6. SVG Exporter Standalone Font Attributes", () => {
    test("SvgExporter outputs font-size, font-weight, and font-style for nodes, edges, and groups", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        title: "Export Node",
        position: { x: 50, y: 50 },
        size: { width: 120, height: 60 },
        style: {
          fontSize: 28,
          bold: true,
          italic: true,
        },
      });

      const edge = editor.addEdge(node.id, node.id, {
        labels: [{ id: "el1", text: "Export Edge Label" } as any],
        style: {
          fontSize: 16,
          bold: true,
        },
      });

      const group = createGroup({
        id: "exp-group",
        name: "Export Group",
        nodeIds: [node.id],
        fontSize: 20,
        bold: true,
      });
      editor.diagram.groups.push(group);

      const svg = defaultSvgExporter.exportToSvg(editor.diagram);

      // Verify node title SVG attributes
      expect(svg).toContain('font-size="28"');
      expect(svg).toContain('font-weight="bold"');
      expect(svg).toContain('font-style="italic"');
      expect(svg).toContain('style="font-size: 28px; font-weight: bold; font-style: italic"');

      // Verify edge label SVG attributes
      expect(svg).toContain('font-size="16"');

      // Verify group title SVG attributes
      expect(svg).toContain('font-size="20"');
    });
  });

  describe("7. JsonCanvasSerializer Group Font Attributes", () => {
    test("serializes and deserializes group font adjustments", () => {
      const serializer = new JsonCanvasSerializer();
      const group = createGroup({
        id: "g-json",
        name: "Serialized Group",
        nodeIds: [],
        fontSize: 24,
        bold: true,
        italic: true,
      });
      editor.diagram.groups.push(group);

      const json = serializer.serialize(editor.diagram);
      const parsed = JSON.parse(json);
      const serializedGroup = parsed.groups.find((g: any) => g.id === "g-json");

      expect(serializedGroup).toBeDefined();
      expect(serializedGroup.fontSize).toBe(24);
      expect(serializedGroup.bold).toBe(true);
      expect(serializedGroup.italic).toBe(true);

      // Deserialize back
      const restored = serializer.deserialize(json);
      const restoredGroup = restored.groups.find((g) => g.id === "g-json");
      expect(restoredGroup).toBeDefined();
      expect(restoredGroup?.fontSize).toBe(24);
      expect(restoredGroup?.bold).toBe(true);
      expect(restoredGroup?.italic).toBe(true);
    });
  });

  describe("8. Canvas-wide font adjustments for all shapes, sub-elements, and multi-labels", () => {
    test("SetFontCommand updates all labels in multi-label nodes and edges and restores on undo", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        title: "Main Label",
        position: { x: 50, y: 50 },
        size: { width: 120, height: 60 },
      });
      node.labels.push({ id: "lbl-2", text: "Secondary Label" } as any);

      const edge = editor.addEdge(node.id, node.id, {
        labels: [
          { id: "e-lbl-1", text: "Edge Label 1" } as any,
          { id: "e-lbl-2", text: "Edge Label 2" } as any,
        ],
      });

      editor.selectNode(node.id);
      editor.selectEdge(edge.id, true);

      // Set font size, bold, italic
      editor.setFontSizeForSelection(20);
      editor.toggleBoldForSelection();
      editor.toggleItalicForSelection();

      // Check all node labels
      for (const label of node.labels) {
        expect(label.style?.fontSize).toBe(20);
        expect(label.style?.bold).toBe(true);
        expect(label.style?.italic).toBe(true);
      }

      // Check all edge labels
      for (const label of edge.labels) {
        expect(label.style?.fontSize).toBe(20);
        expect(label.style?.bold).toBe(true);
        expect(label.style?.italic).toBe(true);
      }

      // Undo
      editor.undo(); // undo italic
      expect(node.labels[0].style?.italic).toBeFalsy();
      expect(node.labels[1].style?.italic).toBeFalsy();
      expect(edge.labels[0].style?.italic).toBeFalsy();
      expect(edge.labels[1].style?.italic).toBeFalsy();

      editor.undo(); // undo bold
      expect(node.labels[0].style?.bold).toBeFalsy();
      expect(node.labels[1].style?.bold).toBeFalsy();

      editor.undo(); // undo font size
      expect(node.labels[0].style?.fontSize).toBeUndefined();
      expect(node.labels[1].style?.fontSize).toBeUndefined();
      expect(edge.labels[0].style?.fontSize).toBeUndefined();
      expect(edge.labels[1].style?.fontSize).toBeUndefined();
    });

    test("UML Class shape renders stereotype and compartment items with scaled font size and styles", () => {
      const classNode = editor.addNode({
        kind: "uml.class",
        title: "OrderService",
        stereotype: "service",
        position: { x: 10, y: 10 },
        size: { width: 200, height: 160 },
        compartments: [
          {
            title: "Attributes",
            items: [
              { text: "orderId: string", visibility: "+" },
              { text: "total: number", visibility: "-" },
            ],
          },
        ],
        style: {
          fontSize: 20,
          bold: true,
          italic: true,
        },
      });

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      // Check title
      const title = container.querySelector(".umlcanvas-class-title");
      expect(title).not.toBeNull();
      expect(title.style["font-size"]).toBe("20px");
      expect(title.classList.contains("umlcanvas-bold")).toBe(true);

      // Check stereotype (scaled ~77% -> 15px)
      const st = container.querySelector(".umlcanvas-node-stereotype");
      expect(st).not.toBeNull();
      expect(st.style["font-size"]).toBe("15px");
      expect(st.classList.contains("umlcanvas-italic")).toBe(true);

      // Check compartment items (scaled ~85% -> 17px)
      const items = container.querySelectorAll(".umlcanvas-compartment-item");
      expect(items.length).toBe(2);
      expect(items[0].style["font-size"]).toBe("17px");
      expect(items[0].classList.contains("umlcanvas-bold")).toBe(true);
      expect(items[0].classList.contains("umlcanvas-italic")).toBe(true);
    });

    test("UML Object shape renders slot items with scaled font size and styles", () => {
      const objNode = editor.addNode({
        kind: "uml.object",
        title: "order1: Order",
        position: { x: 10, y: 10 },
        size: { width: 180, height: 120 },
        compartments: [
          {
            title: "Slots",
            items: [{ text: "status = 'PAID'" }],
          },
        ],
        style: {
          fontSize: 20,
          bold: true,
        },
      });

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      const item = container.querySelector(".umlcanvas-compartment-item");
      expect(item).not.toBeNull();
      expect(item.style["font-size"]).toBe("17px");
      expect(item.classList.contains("umlcanvas-bold")).toBe(true);
    });

    test("Edge multiplicity labels inherit edge font adjustments and render correctly", () => {
      const n1 = editor.addNode({
        kind: "generic.rectangle",
        title: "A",
        position: { x: 0, y: 0 },
        size: { width: 100, height: 60 },
      });
      const n2 = editor.addNode({
        kind: "generic.rectangle",
        title: "B",
        position: { x: 300, y: 0 },
        size: { width: 100, height: 60 },
      });

      const edge = editor.addEdge(n1.id, n2.id, {
        multiplicitySource: "1",
        multiplicityTarget: "0..*",
        style: {
          fontSize: 20,
          bold: true,
          italic: true,
        },
      });

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      const sText = container.querySelector(".umlcanvas-multiplicity-source");
      const tText = container.querySelector(".umlcanvas-multiplicity-target");
      expect(sText).not.toBeNull();
      expect(tText).not.toBeNull();

      // Scaled ~85% -> 17px
      expect(sText.style["font-size"]).toBe("17px");
      expect(sText.classList.contains("umlcanvas-bold")).toBe(true);
      expect(sText.classList.contains("umlcanvas-italic")).toBe(true);

      expect(tText.style["font-size"]).toBe("17px");
      expect(tText.classList.contains("umlcanvas-bold")).toBe(true);
      expect(tText.classList.contains("umlcanvas-italic")).toBe(true);
    });

    test("SvgExporter outputs font attributes for compartments, stereotypes, and multiplicities", () => {
      const classNode = editor.addNode({
        kind: "uml.class",
        title: "Customer",
        stereotype: "entity",
        position: { x: 50, y: 50 },
        size: { width: 180, height: 120 },
        compartments: [
          {
            title: "Attributes",
            items: [{ text: "name: string", visibility: "+" }],
          },
        ],
        style: {
          fontSize: 20,
          bold: true,
          italic: true,
        },
      });

      const edge = editor.addEdge(classNode.id, classNode.id, {
        multiplicitySource: "1",
        multiplicityTarget: "many",
        style: {
          fontSize: 16,
          bold: true,
        },
      });

      const svg = defaultSvgExporter.exportToSvg(editor.diagram);

      // Verify stereotype font size & style
      expect(svg).toContain('class="node-st" font-size="15"');
      // Verify compartment item font size & style
      expect(svg).toContain('class="comp-item" font-size="17"');
      // Verify multiplicity font size & style
      expect(svg).toContain('class="edge-label" font-size="14"');
    });
  });

  describe("8. Full Toolbar Typography Controls, Defaults & Non-clipping", () => {
    test("Typography group is permanently visible in toolbar even when nothing is selected", () => {
      editor.clearSelection();
      const container = new MockElement("div") as any;
      const rendererMock: any = {
        isFreehandEnabled: true,
        freehandMode: false,
        isAutoShapeDetection: false,
        currentTransform: { panX: 0, panY: 0, zoom: 1 },
        setFreehandMode: jest.fn(),
        setAutoShapeDetection: jest.fn(),
        setGridVisible: jest.fn(),
        zoomIn: jest.fn(),
        zoomOut: jest.fn(),
        resetZoom: jest.fn(),
      };

      const toolbar = new Toolbar(container, editor, rendererMock);
      (toolbar as any).updateState();

      const typoGroup = container.querySelector(".umlcanvas-typography-group");
      expect(typoGroup).not.toBeNull();
      expect(typoGroup.classList.contains("is-hidden")).toBe(false);

      const boldBtn = container.querySelector(".umlcanvas-bold-btn");
      const italicBtn = container.querySelector(".umlcanvas-italic-btn");
      const fontSizeBtn = container.querySelector(".umlcanvas-font-size-btn");
      const fontFamilyBtn = container.querySelector(".umlcanvas-font-family-btn");

      expect(boldBtn).not.toBeNull();
      expect(italicBtn).not.toBeNull();
      expect(fontSizeBtn).not.toBeNull();
      expect(fontFamilyBtn).not.toBeNull();
    });

    test("Setting typography when nothing is selected updates active defaults and applies to new elements", () => {
      editor.clearSelection();
      editor.setFontForSelection({ fontSize: 22, bold: true, italic: true, fontFamily: "var(--font-monospace, monospace)" });

      const selectionFont = editor.getSelectionFont();
      expect(selectionFont.fontSize).toBe(22);
      expect(selectionFont.bold).toBe(true);
      expect(selectionFont.italic).toBe(true);
      expect(selectionFont.fontFamily).toBe("var(--font-monospace, monospace)");

      // Create a new node with addNode
      const newNode = editor.addNode({ title: "Custom Default Node" });
      expect(newNode.style?.fontSize).toBe(22);
      expect(newNode.style?.bold).toBe(true);
      expect(newNode.style?.italic).toBe(true);
      expect(newNode.style?.fontFamily).toBe("var(--font-monospace, monospace)");
      expect(newNode.labels[0].style?.fontSize).toBe(22);
      expect(newNode.labels[0].style?.bold).toBe(true);
      expect(newNode.labels[0].style?.italic).toBe(true);

      // Reset
      editor.resetFontForSelection();
    });

    test("Font Family selection via popover and API", () => {
      const node = editor.addNode({ title: "Family Test Node" });
      editor.selectNode(node.id);

      const container = new MockElement("div") as any;
      const rendererMock: any = {
        isFreehandEnabled: true,
        freehandMode: false,
        isAutoShapeDetection: false,
        currentTransform: { panX: 0, panY: 0, zoom: 1 },
      };

      const toolbar = new Toolbar(container, editor, rendererMock);
      const fontSizeBtn = container.querySelector(".umlcanvas-font-size-btn");

      // Open popover
      fontSizeBtn.dispatch("click");
      const popover = container.querySelector(".umlcanvas-font-size-popover");
      expect(popover).not.toBeNull();

      const familyItems = popover.querySelectorAll(".umlcanvas-font-family-item");
      expect(familyItems.length).toBe(FONT_FAMILY_PRESETS.length);

      // Select Handwritten family
      const handwrittenItem = familyItems.find((item: MockElement) => item.textContent.includes("Handwritten"));
      expect(handwrittenItem).toBeDefined();
      handwrittenItem.dispatch("click");

      const nodeFont = editor.getNodeFont(node.id);
      expect(nodeFont.fontFamily).toContain("Virgil");
    });

    test("Apply to All Canvas Elements applies typography across all nodes, edges, and groups", () => {
      const n1 = editor.addNode({ title: "N1" });
      const n2 = editor.addNode({ title: "N2" });
      const edge = editor.addEdge(n1.id, n2.id, {});
      const group = editor.addGroup({ nodeIds: [n1.id, n2.id], name: "Test Group" });

      editor.setFontForAllElements({
        fontSize: 18,
        bold: true,
        italic: true,
        fontFamily: "var(--font-monospace, monospace)",
      });

      expect(editor.getNodeFont(n1.id).fontSize).toBe(18);
      expect(editor.getNodeFont(n1.id).bold).toBe(true);
      expect(editor.getNodeFont(n1.id).fontFamily).toBe("var(--font-monospace, monospace)");

      expect(editor.getNodeFont(n2.id).fontSize).toBe(18);
      expect(editor.getNodeFont(n2.id).bold).toBe(true);

      expect(editor.getEdgeFont(edge.id).fontSize).toBe(18);
      expect(editor.getEdgeFont(edge.id).bold).toBe(true);

      expect(editor.getGroupFont(group.id).fontSize).toBe(18);
      expect(editor.getGroupFont(group.id).bold).toBe(true);
    });

    test("Popover coordinates are clamped within container bounds to prevent clipping", () => {
      const container = new MockElement("div") as any;
      container.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: 400,
        height: 600,
        right: 400,
        bottom: 600,
      });

      const rendererMock: any = {
        isFreehandEnabled: true,
        freehandMode: false,
        isAutoShapeDetection: false,
        currentTransform: { panX: 0, panY: 0, zoom: 1 },
      };

      const toolbar = new Toolbar(container, editor, rendererMock);
      const fontSizeBtn = container.querySelector(".umlcanvas-font-size-btn");

      // Mock button located near right edge (e.g. left = 350)
      fontSizeBtn.getBoundingClientRect = () => ({
        left: 350,
        top: 20,
        right: 390,
        bottom: 48,
        width: 40,
        height: 28,
      });

      fontSizeBtn.dispatch("click");
      const popover = container.querySelector(".umlcanvas-font-size-popover");
      expect(popover).not.toBeNull();

      // Check left coordinate: container width 400 - default popover width 260 - 10 = 130 maxLeft
      const styleLeft = popover.style?.left ?? popover.getAttribute("style");
      expect(styleLeft).toBeDefined();
      const leftVal = parseInt(styleLeft, 10);
      expect(leftVal).toBeLessThanOrEqual(150);
      expect(leftVal).toBeGreaterThanOrEqual(10);
    });
  });

  describe("Node Text Selection, Font Settings & Inline Editor Integration", () => {
    test("Selecting a node and changing font size via popover applies to node and labels", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        position: { x: 100, y: 100 },
        size: { width: 140, height: 80 },
        labels: [{ text: "Service Component" }],
      });
      editor.selectNode(node.id, false);

      const container = new MockElement("div") as any;
      const rendererMock: any = {
        isFreehandEnabled: true,
        freehandMode: false,
        isAutoShapeDetection: false,
        currentTransform: { panX: 0, panY: 0, zoom: 1 },
      };
      const toolbar = new Toolbar(container, editor, rendererMock);
      const fontSizeBtn = container.querySelector(".umlcanvas-font-size-btn");
      fontSizeBtn.dispatch("click");

      const popover = container.querySelector(".umlcanvas-font-size-popover");
      expect(popover).not.toBeNull();

      // Click 16px preset button
      const presetButtons = popover.querySelectorAll(".umlcanvas-font-preset-btn");
      const btn16 = presetButtons.find((b: any) => b.textContent.includes("16px"));
      expect(btn16).toBeDefined();
      btn16.dispatch("click");

      // Verify font size is applied to node and its label
      expect(node.style?.fontSize).toBe(16);
      expect(node.labels[0].style?.fontSize).toBe(16);
    });

    test("Clicking font size popover items does not deselect the active node", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        position: { x: 50, y: 50 },
        size: { width: 120, height: 60 },
        labels: [{ text: "Auth Module" }],
      });
      editor.selectNode(node.id, false);
      expect(editor.isNodeSelected(node.id)).toBe(true);

      const container = new MockElement("div") as any;
      const rendererMock: any = {
        isFreehandEnabled: true,
        freehandMode: false,
        isAutoShapeDetection: false,
        currentTransform: { panX: 0, panY: 0, zoom: 1 },
      };
      const toolbar = new Toolbar(container, editor, rendererMock);
      const fontSizeBtn = container.querySelector(".umlcanvas-font-size-btn");
      fontSizeBtn.dispatch("click");

      const popover = container.querySelector(".umlcanvas-font-size-popover");
      expect(popover).not.toBeNull();

      // Simulate mousedown on popover element
      let stopped = false;
      popover.dispatch("mousedown", {
        stopPropagation: () => {
          stopped = true;
        },
      });
      expect(stopped).toBe(true);
      expect(popover.closest(".umlcanvas-font-size-popover")).not.toBeNull();

      // Node remains selected
      expect(editor.isNodeSelected(node.id)).toBe(true);
    });

    test("Toggling bold, italic, font family, and reset font updates the node", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        position: { x: 200, y: 200 },
        size: { width: 150, height: 75 },
        labels: [{ text: "Database Gateway" }],
      });
      editor.selectNode(node.id, false);

      // Apply bold and italic
      editor.toggleBoldForSelection();
      expect(node.style?.bold).toBe(true);
      expect(node.labels[0].style?.bold).toBe(true);

      editor.toggleItalicForSelection();
      expect(node.style?.italic).toBe(true);
      expect(node.labels[0].style?.italic).toBe(true);

      // Apply font family
      editor.setFontFamilyForSelection("var(--font-monospace)");
      expect(node.style?.fontFamily).toBe("var(--font-monospace)");
      expect(node.labels[0].style?.fontFamily).toBe("var(--font-monospace)");

      // Reset typography
      editor.resetFontForSelection();
      expect(node.style?.fontSize).toBeUndefined();
      expect(node.style?.bold).toBeUndefined();
      expect(node.style?.italic).toBeUndefined();
      expect(node.style?.fontFamily).toBeUndefined();
      expect(node.labels[0].style?.fontFamily).toBeUndefined();
    });

    test("Editing node text via inline editor commits updated text, empty text, or multiline text", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        position: { x: 100, y: 100 },
        size: { width: 140, height: 80 },
        labels: [{ text: "Initial Text" }],
      });

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      // Start inline editor
      renderer.startInlineEditor(node);
      expect(renderer.activeInlineEditor).not.toBeNull();
      expect(editor.isNodeSelected(node.id)).toBe(true);

      // Update text to multiline
      renderer.activeInlineEditor!.value = "Line 1\nLine 2";
      renderer.commitInlineEditor();
      expect(node.labels[0].text).toBe("Line 1\nLine 2");

      // Now clear text to empty string
      renderer.startInlineEditor(node);
      renderer.activeInlineEditor!.value = "";
      renderer.commitInlineEditor();
      expect(node.labels[0].text).toBe("");
    });

    test("Multiline text renders with tspans in generic shapes", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        position: { x: 50, y: 50 },
        size: { width: 160, height: 100 },
        labels: [{ text: "Title Line 1\nTitle Line 2\nTitle Line 3" }],
      });

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      const nodeGroup = container.querySelector(`[data-node-id="${node.id}"]`);
      expect(nodeGroup).not.toBeNull();
      const textEl = nodeGroup.querySelector("text");
      expect(textEl).not.toBeNull();
      const tspans = textEl.querySelectorAll("tspan");
      expect(tspans.length).toBe(3);
      expect(tspans[0].textContent).toBe("Title Line 1");
      expect(tspans[1].textContent).toBe("Title Line 2");
      expect(tspans[2].textContent).toBe("Title Line 3");
    });

    test("Changing font size while inline editor is active keeps inline editor styled", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        position: { x: 120, y: 120 },
        size: { width: 140, height: 80 },
        labels: [{ text: "Active Editing" }],
      });

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      renderer.startInlineEditor(node);
      const editorEl = renderer.activeInlineEditor;
      expect(editorEl).not.toBeNull();

      // Adjust font size
      editor.setFontSizeForSelection(20);
      renderer.render();

      expect(editorEl!.style.fontSize).toBe("20px");
      renderer.commitInlineEditor();
    });

    test("Common font size stepper controls directly increment and decrement font size", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        position: { x: 100, y: 100 },
        size: { width: 140, height: 80 },
        labels: [{ text: "Font Stepper Node" }],
      });
      editor.selectNode(node.id, false);

      const container = new MockElement("div") as any;
      const rendererMock: any = {
        isFreehandEnabled: true,
        freehandMode: false,
        isAutoShapeDetection: false,
        currentTransform: { panX: 0, panY: 0, zoom: 1 },
      };
      const toolbar = new Toolbar(container, editor, rendererMock);
      (toolbar as any).updateState();

      const decBtn = container.querySelector(".umlcanvas-font-dec-btn");
      const incBtn = container.querySelector(".umlcanvas-font-inc-btn");
      const sizeBtn = container.querySelector(".umlcanvas-font-size-btn");

      expect(decBtn).not.toBeNull();
      expect(incBtn).not.toBeNull();
      expect(sizeBtn).not.toBeNull();

      // Step up (+): 13 -> 14
      incBtn.dispatch("click");
      expect(editor.getSelectionFont().fontSize).toBe(14);
      expect(node.style?.fontSize).toBe(14);

      // Step up again (+): 14 -> 16
      incBtn.dispatch("click");
      expect(editor.getSelectionFont().fontSize).toBe(16);

      // Step down (-): 16 -> 14
      decBtn.dispatch("click");
      expect(editor.getSelectionFont().fontSize).toBe(14);

      // Step down again (-): 14 -> 13
      decBtn.dispatch("click");
      expect(editor.getSelectionFont().fontSize).toBe(13);

      toolbar.destroy();
    });

    test("Contextual selection inspector provides font settings and updates selected node font", () => {
      const node = editor.addNode({
        kind: "generic.rectangle",
        position: { x: 80, y: 80 },
        size: { width: 140, height: 80 },
        labels: [{ text: "Context Typography Node" }],
      });
      editor.selectNode(node.id, false);

      const container = new MockElement("div") as any;
      const rendererMock: any = {
        isFreehandEnabled: true,
        freehandMode: false,
        isAutoShapeDetection: false,
        currentTransform: { panX: 0, panY: 0, zoom: 1 },
      };
      const toolbar = new Toolbar(container, editor, rendererMock);
      (toolbar as any).updateState();

      const contextGroup = container.querySelector(".umlcanvas-context-group");
      expect(contextGroup).not.toBeNull();
      expect(contextGroup.classList.contains("is-hidden")).toBe(false);

      // Verify label button has edit-3 icon and clear title
      const buttons = contextGroup.querySelectorAll("button");
      const labelBtn = buttons.find((b: MockElement) => b.title.includes("Edit Text / Label"));
      expect(labelBtn).toBeDefined();

      // Find contextual typography controls inside context group
      const contextDecBtn = contextGroup.querySelector(".umlcanvas-font-dec-btn");
      const contextIncBtn = contextGroup.querySelector(".umlcanvas-font-inc-btn");
      const contextSizeBtn = contextGroup.querySelector(".umlcanvas-context-font-size-btn");
      const contextBoldBtn = contextGroup.querySelector(".umlcanvas-context-bold-btn");
      const contextItalicBtn = contextGroup.querySelector(".umlcanvas-context-italic-btn");
      const contextFamilyBtn = contextGroup.querySelector(".umlcanvas-context-font-family-btn");

      expect(contextDecBtn).not.toBeNull();
      expect(contextIncBtn).not.toBeNull();
      expect(contextSizeBtn).not.toBeNull();
      expect(contextBoldBtn).not.toBeNull();
      expect(contextItalicBtn).not.toBeNull();
      expect(contextFamilyBtn).not.toBeNull();

      // Step font size using contextual incBtn (+): 13 -> 14
      contextIncBtn.dispatch("click");
      expect(editor.getNodeFont(node.id).fontSize).toBe(14);
      expect(node.style?.fontSize).toBe(14);
      expect(contextSizeBtn.textContent).toContain("14px");

      // Step font size using contextual incBtn again (+): 14 -> 16
      contextIncBtn.dispatch("click");
      expect(editor.getNodeFont(node.id).fontSize).toBe(16);
      expect(contextSizeBtn.textContent).toContain("16px");

      // Toggle bold using contextual bold button
      contextBoldBtn.dispatch("click");
      expect(editor.getNodeFont(node.id).bold).toBe(true);
      expect(node.style?.bold).toBe(true);
      expect(contextBoldBtn.classList.contains("is-active")).toBe(true);

      // Toggle italic using contextual italic button
      contextItalicBtn.dispatch("click");
      expect(editor.getNodeFont(node.id).italic).toBe(true);
      expect(node.style?.italic).toBe(true);
      expect(contextItalicBtn.classList.contains("is-active")).toBe(true);

      // Click context font size button to open popover
      contextSizeBtn.dispatch("click");
      const popover = container.querySelector(".umlcanvas-font-size-popover");
      expect(popover).not.toBeNull();

      // Choose Extra Large (28px) preset
      const presets = popover.querySelectorAll(".umlcanvas-font-preset-btn");
      const xlargePreset = presets.find((p: MockElement) => p.textContent.includes("Extra Large"));
      expect(xlargePreset).toBeDefined();
      xlargePreset.dispatch("click");

      expect(editor.getNodeFont(node.id).fontSize).toBe(28);
      expect(node.style?.fontSize).toBe(28);
      expect(contextSizeBtn.textContent).toContain("28px");

      // Step down using contextual decBtn (-): 28 -> 24
      contextDecBtn.dispatch("click");
      expect(editor.getNodeFont(node.id).fontSize).toBe(24);
      expect(node.style?.fontSize).toBe(24);
      expect(contextSizeBtn.textContent).toContain("24px");

      // Clear selection -> context group hides
      editor.clearSelection();
      expect(contextGroup.classList.contains("is-hidden")).toBe(true);

      toolbar.destroy();
    });
  });
});
