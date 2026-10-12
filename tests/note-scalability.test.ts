import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { DiagramNode, createDiagramNode } from "../src/domain/entities/DiagramNode";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { defaultShapeRegistry, calculateNoteContentScale } from "../src/presentation/renderer/ShapeRegistry";
import { estimateMarkdownContentHeight, calculateNodeFitSize } from "../src/domain/services/TextMeasurement";
import { SvgExporter } from "../src/infrastructure/export/SvgExporter";
import { defaultJsonCanvasImporter } from "../src/infrastructure/persistence/JsonCanvasImporter";
import { defaultJsonCanvasExporter } from "../src/infrastructure/export/JsonCanvasExporter";
import { TFile } from "./fakes/MockObsidian";

// Mock element for headless DOM testing
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
  clientWidth: number = 1000;
  clientHeight: number = 800;
  scrollHeight: number = 0;

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
      this.classList.add(...value.split(" "));
    }
  }

  setAttributeNS(_ns: any, name: string, value: string): void {
    this.setAttribute(name, value);
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
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
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

// Global setup
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
(global as any).document = {
  createElement: (tag: string) => new MockElement(tag),
  createElementNS: (_ns: string, tag: string) => new MockElement(tag),
  body: new MockElement("body"),
};

describe("Improve Imported Note Scalability (#12)", () => {
  const largeNoteMarkdown = `
# System Architecture Specification

## Overview
This document specifies the scalable microservices architecture for Canvas++.
It contains extensive documentation and implementation notes.

### Core Modules
- **Renderer Engine**: Handles high-performance vector SVG scene rendering.
- **Diagram Editor**: Maintains undo/redo command stack and domain model.
- **Snapping & Layout**: Automatic alignment guides and connector routing.
- **JsonCanvas Importer/Exporter**: Bi-directional JSON Canvas persistence.
- **Text Measurement Engine**: Real-time bounding box calculation and fitting.

### Database Design
- Schema v1 stores node geometry, customData, ports, and metadata.
- Group hierarchies support nesting and dynamic membership calculation.

### Performance Considerations
- Virtualization enabled for diagrams with over 100 elements.
- ForeignObject content scaling prevents forced full-size card resizing.
- CSS transforms preserve pixel density during canvas zooming.

### API Interface
\`\`\`typescript
export interface NoteScalabilityOptions {
  scaleMode: "fit" | "custom" | "none";
  scale: number;
}
\`\`\`

> Note: All notes embedded onto the canvas must scale their view to fit comfortably!
`.trim();

  let editor: DiagramEditor;
  let container: MockElement;
  let renderer: SvgSceneRenderer;

  beforeEach(() => {
    const diagram = createDiagram({
      id: "diag-note-test",
      diagramType: "general",
      title: "Scalability Test",
    });
    editor = new DiagramEditor(diagram);
    container = new MockElement("div", { cls: "umlcanvas-view-container" });
    renderer = new SvgSceneRenderer(container as any, editor);
  });

  afterEach(() => {
    renderer.destroy();
  });

  describe("TextMeasurement & Height Estimation", () => {
    it("should calculate estimated height for large markdown content", () => {
      const height = estimateMarkdownContentHeight(largeNoteMarkdown, 340);
      expect(height).toBeGreaterThan(400);
    });

    it("should handle empty or small markdown note content gracefully", () => {
      const emptyH = estimateMarkdownContentHeight("", 340);
      expect(emptyH).toBe(40);

      const shortH = estimateMarkdownContentHeight("A brief single-line note.", 340);
      expect(shortH).toBeLessThan(100);
    });

    it("should calculate auto-fit size for obsidian.note in calculateNodeFitSize", () => {
      const noteNode = editor.addNode({
        kind: "obsidian.note",
        title: "Architecture",
        position: { x: 50, y: 50 },
        size: { width: 340, height: 240 },
        customData: {
          filePath: "docs/architecture.md",
          content: largeNoteMarkdown,
        },
      });

      const fitSize = calculateNodeFitSize(noteNode);
      expect(fitSize.width).toBeGreaterThanOrEqual(340);
      expect(fitSize.height).toBeGreaterThan(240);
    });
  });

  describe("calculateNoteContentScale", () => {
    it("should calculate scale < 1.0 in fit mode for large notes", () => {
      const noteNode = createDiagramNode({
        id: "note-1",
        kind: "obsidian.note",
        position: { x: 0, y: 0 },
        size: { width: 340, height: 240 },
        labels: [],
        customData: {
          content: largeNoteMarkdown,
          scaleMode: "fit",
        },
      });

      const scaleInfo = calculateNoteContentScale(noteNode, 340, 240);
      expect(scaleInfo.scaleMode).toBe("fit");
      expect(scaleInfo.effectiveScale).toBeLessThan(1.0);
      expect(scaleInfo.effectiveScale).toBeGreaterThanOrEqual(0.15);
      expect(scaleInfo.isScaled).toBe(true);
    });

    it("should return scale = 1.0 when note content comfortably fits inside card", () => {
      const shortMarkdown = "# Short Note\nA couple lines of text.";
      const noteNode = createDiagramNode({
        id: "note-short",
        kind: "obsidian.note",
        position: { x: 0, y: 0 },
        size: { width: 340, height: 240 },
        labels: [],
        customData: {
          content: shortMarkdown,
          scaleMode: "fit",
        },
      });

      const scaleInfo = calculateNoteContentScale(noteNode, 340, 240);
      expect(scaleInfo.effectiveScale).toBe(1.0);
      expect(scaleInfo.isScaled).toBe(false);
    });

    it("should respect explicit custom scale when scaleMode is custom", () => {
      const noteNode = createDiagramNode({
        id: "note-custom",
        kind: "obsidian.note",
        position: { x: 0, y: 0 },
        size: { width: 340, height: 240 },
        labels: [],
        customData: {
          content: largeNoteMarkdown,
          scaleMode: "custom",
          scale: 0.65,
        },
      });

      const scaleInfo = calculateNoteContentScale(noteNode, 340, 240);
      expect(scaleInfo.scaleMode).toBe("custom");
      expect(scaleInfo.effectiveScale).toBe(0.65);
    });
  });

  describe("Note Rendering & Scalability Elements", () => {
    it("should render scalable container and scale wrapper in foreignObject", () => {
      const noteNode = editor.addNode({
        kind: "obsidian.note",
        title: "Large Note",
        position: { x: 100, y: 100 },
        size: { width: 340, height: 240 },
        customData: {
          filePath: "notes/large.md",
          content: largeNoteMarkdown,
          scaleMode: "fit",
        },
      });

      const renderedSvg = defaultShapeRegistry.get("obsidian.note").renderSvg(noteNode, { isSelected: false });
      const nodeEl = renderedSvg as unknown as MockElement;

      // Check scale attribute
      const dataScale = nodeEl.getAttribute("data-scale");
      expect(dataScale).not.toBeNull();
      const scaleNum = parseFloat(dataScale!);
      expect(scaleNum).toBeLessThan(1.0);

      // Check scalable container and wrapper
      const containerEl = nodeEl.querySelector(".umlcanvas-obsidian-note-container");
      expect(containerEl).not.toBeNull();

      const scaleWrapper = nodeEl.querySelector(".umlcanvas-obsidian-note-scale-wrapper");
      expect(scaleWrapper).not.toBeNull();
      expect(scaleWrapper?.style.transform).toContain("scale(");

      const bodyEl = nodeEl.querySelector(".umlcanvas-obsidian-note-body");
      expect(bodyEl).not.toBeNull();
    });

    it("should render scalability controls in note header", () => {
      const noteNode = editor.addNode({
        kind: "obsidian.note",
        title: "Test Note",
        position: { x: 100, y: 100 },
        size: { width: 340, height: 240 },
        customData: {
          filePath: "notes/test.md",
          content: largeNoteMarkdown,
          scaleMode: "fit",
        },
      });

      const renderedSvg = defaultShapeRegistry.get("obsidian.note").renderSvg(noteNode, { isSelected: false });
      const nodeEl = renderedSvg as unknown as MockElement;

      // Header controls: Fit button, zoom in/out, scale badge, open icon
      const fitBtn = nodeEl.querySelector(".umlcanvas-obsidian-note-scale-btn");
      expect(fitBtn).not.toBeNull();
      expect(fitBtn?.textContent).toBe("Fit");
      expect(fitBtn?.classList.contains("is-active")).toBe(true);

      const zoomInBtn = nodeEl.querySelector(".umlcanvas-obsidian-note-zoom-in-btn");
      expect(zoomInBtn).not.toBeNull();
      expect(zoomInBtn?.textContent).toBe("+");

      const zoomOutBtn = nodeEl.querySelector(".umlcanvas-obsidian-note-zoom-out-btn");
      expect(zoomOutBtn).not.toBeNull();
      expect(zoomOutBtn?.textContent).toBe("−");

      const scaleBadge = nodeEl.querySelector(".umlcanvas-obsidian-note-scale-badge");
      expect(scaleBadge).not.toBeNull();
      expect(scaleBadge?.textContent).toContain("%");

      const openBtn = nodeEl.querySelector(".umlcanvas-obsidian-note-open-btn");
      expect(openBtn).not.toBeNull();
      expect(openBtn?.textContent).toBe("↗");
    });

    it("should scale up automatically when user resizes the note card larger", () => {
      const noteNodeSmall = createDiagramNode({
        id: "note-resize-1",
        kind: "obsidian.note",
        position: { x: 0, y: 0 },
        size: { width: 340, height: 240 },
        labels: [],
        customData: {
          content: largeNoteMarkdown,
          scaleMode: "fit",
        },
      });

      const noteNodeLarge = createDiagramNode({
        id: "note-resize-2",
        kind: "obsidian.note",
        position: { x: 0, y: 0 },
        size: { width: 450, height: 450 },
        labels: [],
        customData: {
          content: largeNoteMarkdown,
          scaleMode: "fit",
        },
      });

      const scaleSmall = calculateNoteContentScale(noteNodeSmall, 340, 240);
      const scaleLarge = calculateNoteContentScale(noteNodeLarge, 450, 450);

      // Resizing card larger gives a higher scale factor
      expect(scaleLarge.effectiveScale).toBeGreaterThan(scaleSmall.effectiveScale);
    });

    it("should render all content lines scaled in SVG fallback", () => {
      const noteNode = editor.addNode({
        kind: "obsidian.note",
        title: "Fallback Test",
        position: { x: 0, y: 0 },
        size: { width: 340, height: 240 },
        customData: {
          content: largeNoteMarkdown,
          scaleMode: "fit",
        },
      });

      const renderedSvg = defaultShapeRegistry.get("obsidian.note").renderSvg(noteNode, { isSelected: false });
      const nodeEl = renderedSvg as unknown as MockElement;

      const fallbackGroup = nodeEl.querySelector(".umlcanvas-obsidian-note-svg-fallback");
      expect(fallbackGroup).not.toBeNull();
      expect(fallbackGroup?.getAttribute("data-scale")).not.toBeNull();

      const lines = nodeEl.querySelectorAll(".umlcanvas-obsidian-note-body-line");
      // All lines of the document should be rendered rather than being cut off at 5
      expect(lines.length).toBeGreaterThan(5);
    });
  });

  describe("Interactive Scale Manipulation", () => {
    it("should toggle note scale mode between fit and custom", () => {
      const noteNode = editor.addNode({
        kind: "obsidian.note",
        title: "Toggle Test",
        position: { x: 50, y: 50 },
        size: { width: 340, height: 240 },
        customData: {
          content: largeNoteMarkdown,
          scaleMode: "fit",
        },
      });

      // Toggle from fit -> custom (100%)
      renderer.toggleNoteScaleMode(noteNode.id);
      let updated = editor.diagram.nodes.find((n) => n.id === noteNode.id);
      expect(updated?.customData?.scaleMode).toBe("custom");
      expect(updated?.customData?.scale).toBe(1.0);

      // Toggle back from custom -> fit
      renderer.toggleNoteScaleMode(noteNode.id);
      updated = editor.diagram.nodes.find((n) => n.id === noteNode.id);
      expect(updated?.customData?.scaleMode).toBe("fit");
    });

    it("should adjust note scale with zoom in / zoom out controls", () => {
      const noteNode = editor.addNode({
        kind: "obsidian.note",
        title: "Adjust Test",
        position: { x: 50, y: 50 },
        size: { width: 340, height: 240 },
        customData: {
          content: largeNoteMarkdown,
          scaleMode: "custom",
          scale: 0.5,
        },
      });

      // Zoom in
      renderer.adjustNoteScale(noteNode.id, 0.15);
      let updated = editor.diagram.nodes.find((n) => n.id === noteNode.id);
      expect(updated?.customData?.scale).toBe(0.65);
      expect(updated?.customData?.scaleMode).toBe("custom");

      // Zoom out
      renderer.adjustNoteScale(noteNode.id, -0.3);
      updated = editor.diagram.nodes.find((n) => n.id === noteNode.id);
      expect(updated?.customData?.scale).toBe(0.35);
    });

    it("should auto-resize note node to fit content via autoResizeNode", () => {
      const noteNode = editor.addNode({
        kind: "obsidian.note",
        title: "Auto Resize Test",
        position: { x: 50, y: 50 },
        size: { width: 340, height: 240 },
        customData: {
          content: largeNoteMarkdown,
        },
      });

      editor.autoResizeNode(noteNode.id);
      const updated = editor.diagram.nodes.find((n) => n.id === noteNode.id);
      expect(updated?.size.height).toBeGreaterThan(240);
    });
  });

  describe("SVG Exporter & JSON Canvas Persistence", () => {
    it("should export obsidian.note to standalone SVG with proper scaling", () => {
      editor.addNode({
        kind: "obsidian.note",
        title: "Export Note",
        position: { x: 50, y: 50 },
        size: { width: 340, height: 240 },
        customData: {
          filePath: "notes/export.md",
          content: largeNoteMarkdown,
          scaleMode: "fit",
        },
      });

      const exporter = new SvgExporter();
      const svgOutput = exporter.exportToSvg(editor.diagram);

      expect(svgOutput).toContain("Export Note");
      expect(svgOutput).toContain("Overview");
      expect(svgOutput).toContain("Renderer Engine");
    });

    it("should set scaleMode fit when importing from JSON Canvas", () => {
      const jsonCanvasString = JSON.stringify({
        nodes: [
          {
            id: "node-canvas-import",
            type: "file",
            file: "notes/project-spec.md",
            x: 100,
            y: 100,
            width: 340,
            height: 240,
          },
        ],
        edges: [],
      });

      const diagram = defaultJsonCanvasImporter.importCanvas(jsonCanvasString);
      expect(diagram.nodes.length).toBe(1);
      const importedNode = diagram.nodes[0];
      expect(importedNode.kind).toBe("obsidian.note");
      expect(importedNode.customData?.scaleMode).toBe("fit");
    });

    it("should export obsidian.note back to JSON Canvas file node", () => {
      editor.addNode({
        kind: "obsidian.note",
        title: "Export Canvas",
        position: { x: 100, y: 120 },
        size: { width: 340, height: 240 },
        customData: {
          filePath: "notes/spec.md",
          scaleMode: "fit",
        },
      });

      const canvasJson = defaultJsonCanvasExporter.exportToJsonCanvas(editor.diagram);
      const canvasOutput = JSON.parse(canvasJson);
      expect(canvasOutput.nodes.length).toBe(1);
      expect(canvasOutput.nodes[0].type).toBe("file");
      expect((canvasOutput.nodes[0] as any).file).toBe("notes/spec.md");
    });
  });
});
