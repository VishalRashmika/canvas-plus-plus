import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { defaultShapeRegistry } from "../src/presentation/renderer/ShapeRegistry";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { defaultJsonCanvasImporter } from "../src/infrastructure/persistence/JsonCanvasImporter";
import { defaultJsonCanvasExporter } from "../src/infrastructure/export/JsonCanvasExporter";
import { defaultSvgExporter } from "../src/infrastructure/export/SvgExporter";
import { calculateNodeFitSize } from "../src/domain/services/TextMeasurement";
import { isPdfFile, PdfSuggestModal } from "../src/presentation/views/PdfSuggestModal";
import { UmlCanvasView } from "../src/presentation/views/UmlCanvasView";
import { TFile, WorkspaceLeaf } from "./fakes/MockObsidian";

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

  empty(): void {
    this.children = [];
    this.textContent = "";
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
      button: 0,
      clientX: 0,
      clientY: 0,
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
  body: new MockElement("body"),
};

(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

describe("Open PDF Files Inside Canvas Tests", () => {
  let editor: DiagramEditor;
  let container: MockElement;
  let renderer: SvgSceneRenderer;

  beforeEach(() => {
    editor = new DiagramEditor(
      createDiagram({ id: "diag-pdf-test", title: "PDF Canvas Test", diagramType: "general" })
    );
    container = new MockElement("div", { cls: "umlcanvas-view-container" });
    renderer = new SvgSceneRenderer(container as any, editor);
  });

  describe("isPdfFile Helper & PdfSuggestModal", () => {
    it("should correctly identify PDF files from string path or TFile", () => {
      expect(isPdfFile("report.pdf")).toBe(true);
      expect(isPdfFile("Folder/Document.PDF")).toBe(true);
      expect(isPdfFile("notes/paper.Pdf")).toBe(true);
      expect(isPdfFile(new TFile("docs/manual.pdf", "manual", "pdf"))).toBe(true);

      expect(isPdfFile("image.png")).toBe(false);
      expect(isPdfFile("note.md")).toBe(false);
      expect(isPdfFile("diagram.canvas")).toBe(false);
      expect(isPdfFile(new TFile("notes/daily.md", "daily", "md"))).toBe(false);
    });

    it("should filter only PDF files in PdfSuggestModal and invoke callback on selection", () => {
      const mockFiles = [
        new TFile("docs/ResearchPaper.pdf", "ResearchPaper", "pdf"),
        new TFile("images/photo.png", "photo", "png"),
        new TFile("notes/Notes.md", "Notes", "md"),
        new TFile("manuals/Guide.PDF", "Guide", "PDF"),
      ];

      const mockApp = {
        vault: {
          getFiles: () => mockFiles,
        },
      } as any;

      let selectedFile: TFile | null = null;
      const modal = new PdfSuggestModal(mockApp, (file) => {
        selectedFile = file;
      });

      const items = modal.getItems();
      expect(items.length).toBe(2);
      expect(items.map((f) => f.path)).toEqual(["docs/ResearchPaper.pdf", "manuals/Guide.PDF"]);
      expect(modal.getItemText(items[0])).toBe("docs/ResearchPaper.pdf");

      modal.onChooseItem(items[0]);
      expect(selectedFile).toBe(items[0]);
    });
  });

  describe("generic.pdf Shape Definition & Node Rendering", () => {
    it("should register generic.pdf in defaultShapeRegistry with defaultTitle and size", () => {
      expect(defaultShapeRegistry.has("generic.pdf")).toBe(true);
      const shapeDef = defaultShapeRegistry.get("generic.pdf");
      expect(shapeDef.displayName).toBe("PDF Document");
      expect(shapeDef.defaultTitle).toBe("PDF Document");
      expect(shapeDef.defaultSize).toEqual({ width: 340, height: 440 });
    });

    it("should provide 4 standard ports on top, right, bottom, left", () => {
      const node = editor.addNode({ kind: "generic.pdf", title: "Manual" });
      const shapeDef = defaultShapeRegistry.get("generic.pdf");
      const ports = shapeDef.getPorts(node);
      expect(ports.length).toBe(4);
      expect(ports.map((p) => p.side)).toEqual(["top", "right", "bottom", "left"]);
    });

    it("should render PDF card, header, vector PDF icon, title, open button, and iframe", () => {
      const pdfNode = editor.addNode({
        kind: "generic.pdf",
        title: "Specification.pdf",
        position: { x: 50, y: 80 },
        size: { width: 340, height: 440 },
        customData: {
          src: "app://local/docs/Specification.pdf",
          filePath: "docs/Specification.pdf",
        },
      });

      const shapeDef = defaultShapeRegistry.get("generic.pdf");
      const rendered = shapeDef.renderSvg(pdfNode, { isSelected: false }) as unknown as MockElement;

      // Outer card
      const card = rendered.querySelector(".umlcanvas-pdf-card");
      expect(card).not.toBeNull();
      expect(card?.getAttribute("width")).toBe("340");
      expect(card?.getAttribute("height")).toBe("440");

      // Header background & separator
      const headerBg = rendered.querySelector(".umlcanvas-pdf-header-bg");
      expect(headerBg).not.toBeNull();
      const headerSep = rendered.querySelector(".umlcanvas-pdf-header-sep");
      expect(headerSep).not.toBeNull();

      // Vector PDF icon with badge
      const icon = rendered.querySelector(".umlcanvas-pdf-icon");
      expect(icon).not.toBeNull();
      const badge = rendered.querySelector(".umlcanvas-pdf-badge");
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe("PDF");

      // Title
      const title = rendered.querySelector(".umlcanvas-pdf-title");
      expect(title).not.toBeNull();
      expect(title?.textContent).toBe("Specification");

      // Open button (↗)
      const openBtn = rendered.querySelector(".umlcanvas-pdf-open-btn");
      expect(openBtn).not.toBeNull();
      expect(openBtn?.textContent).toBe("↗");
      expect(openBtn?.getAttribute("data-file-path")).toBe("docs/Specification.pdf");

      // ForeignObject with PDF iframe
      const foreign = rendered.querySelector(".umlcanvas-pdf-foreign");
      expect(foreign).not.toBeNull();
      const iframe = rendered.querySelector(".umlcanvas-pdf-frame");
      expect(iframe).not.toBeNull();
      expect(iframe?.getAttribute("src")).toBe("app://local/docs/Specification.pdf");

      // SVG fallback elements
      const fallback = rendered.querySelector(".umlcanvas-pdf-svg-fallback");
      expect(fallback).not.toBeNull();
      const fallbackText = rendered.querySelector(".umlcanvas-pdf-fallback-text");
      expect(fallbackText?.textContent).toBe("Specification.pdf");
    });

    it("should render page badge in header and append subpath to iframe src when subpath is specified", () => {
      const pdfNode = editor.addNode({
        kind: "generic.pdf",
        title: "Report",
        position: { x: 100, y: 100 },
        size: { width: 340, height: 440 },
        metadata: {
          filePath: "docs/Report.pdf",
          subpath: "#page=4",
        },
        customData: {
          filePath: "docs/Report.pdf",
          src: "app://local/docs/Report.pdf",
          subpath: "#page=4",
        },
      });

      const shapeDef = defaultShapeRegistry.get("generic.pdf");
      const rendered = shapeDef.renderSvg(pdfNode, { isSelected: false }) as unknown as MockElement;

      // Page badge in header
      const pageBadge = rendered.querySelector(".umlcanvas-pdf-page-badge");
      expect(pageBadge).not.toBeNull();
      expect(pageBadge?.textContent).toBe("p. 4");

      // Iframe src includes subpath #page=4
      const iframe = rendered.querySelector(".umlcanvas-pdf-frame");
      expect(iframe).not.toBeNull();
      expect(iframe?.getAttribute("src")).toBe("app://local/docs/Report.pdf#page=4");
    });

    it("should render placeholder when no src is provided yet", () => {
      const pdfNode = editor.addNode({
        kind: "generic.pdf",
        title: "EmptyDoc",
        position: { x: 100, y: 100 },
      });

      const shapeDef = defaultShapeRegistry.get("generic.pdf");
      const rendered = shapeDef.renderSvg(pdfNode, { isSelected: false }) as unknown as MockElement;

      const placeholder = rendered.querySelector(".umlcanvas-pdf-placeholder");
      expect(placeholder).not.toBeNull();
      expect(placeholder?.textContent).toContain("PDF Document");
    });

    it("should render selected state styling on card rect when isSelected is true", () => {
      const pdfNode = editor.addNode({
        kind: "generic.pdf",
        title: "Doc",
      });

      const shapeDef = defaultShapeRegistry.get("generic.pdf");
      const renderedSelected = shapeDef.renderSvg(pdfNode, { isSelected: true }) as unknown as MockElement;
      const card = renderedSelected.querySelector(".umlcanvas-pdf-card");
      expect(card?.classList.contains("umlcanvas-node-selected")).toBe(true);
    });

    it("should calculate auto-fit size for generic.pdf in calculateNodeFitSize", () => {
      const node = editor.addNode({
        kind: "generic.pdf",
        title: "A very long document title that needs sufficient width to be read comfortably",
        size: { width: 100, height: 100 },
      });

      const fitSize = calculateNodeFitSize(node);
      expect(fitSize.width).toBeGreaterThanOrEqual(200);
      expect(fitSize.height).toBeGreaterThanOrEqual(200);
    });
  });

  describe("SvgSceneRenderer Event Handling for PDF Nodes", () => {
    it("should trigger onNoteOpen when clicking open button ↗", () => {
      let openedPath: string | null = null;
      (renderer as any).onNoteOpen = (path: string) => {
        openedPath = path;
      };

      const pdfNode = editor.addNode({
        kind: "generic.pdf",
        title: "Architecture.pdf",
        position: { x: 20, y: 20 },
        customData: {
          filePath: "docs/Architecture.pdf",
          src: "app://local/docs/Architecture.pdf",
        },
      });

      renderer.render();

      const openBtn = container.querySelector(".umlcanvas-pdf-open-btn");
      expect(openBtn).not.toBeNull();

      (renderer as any).svgEl.dispatch("mousedown", { target: openBtn });
      expect(openedPath).toBe("docs/Architecture.pdf");
    });

    it("should trigger onNoteOpen on double clicking PDF node header", () => {
      let openedPath: string | null = null;
      (renderer as any).onNoteOpen = (path: string) => {
        openedPath = path;
      };

      const pdfNode = editor.addNode({
        kind: "generic.pdf",
        title: "Specification",
        position: { x: 50, y: 50 },
        customData: {
          filePath: "docs/Specification.pdf",
        },
      });

      renderer.render();

      const nodeEl = container.querySelector(`[data-node-id="${pdfNode.id}"]`);
      expect(nodeEl).not.toBeNull();

      // Double click event on the node
      const headerBg = nodeEl?.querySelector(".umlcanvas-pdf-header-bg");
      (renderer as any).svgEl.dispatch("dblclick", { target: headerBg });
      expect(openedPath).toBe("docs/Specification.pdf");
    });

    it("should provide in-place editor bounds for header title editing", () => {
      const pdfNode = editor.addNode({
        kind: "generic.pdf",
        title: "Specification",
        position: { x: 100, y: 150 },
        size: { width: 340, height: 440 },
      });

      const bounds = renderer.getNodeInPlaceEditorBounds(pdfNode);
      expect(bounds.x).toBe(130);
      expect(bounds.y).toBe(154);
      expect(bounds.width).toBe(280);
      expect(bounds.height).toBe(24);
      expect(bounds.textAlign).toBe("left");
    });
  });

  describe("Toolbar Integration", () => {
    let toolbar: Toolbar;
    let addPdfRequested = false;

    beforeEach(() => {
      addPdfRequested = false;
      toolbar = new Toolbar(
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
        undefined,
        () => {
          addPdfRequested = true;
        }
      );
    });

    afterEach(() => {
      toolbar.destroy();
    });

    it("should have Insert PDF Document button in the toolbar", () => {
      const pdfBtn = container.querySelector("[title*='Insert PDF Document']");
      expect(pdfBtn).not.toBeNull();

      pdfBtn?.click();
      expect(addPdfRequested).toBe(true);
    });

    it("should add generic.pdf node via addPdfAtCenter", () => {
      toolbar.addPdfAtCenter("app://local/doc.pdf", "My Paper");
      const nodes = editor.diagram.nodes;
      const pdfNode = nodes.find((n) => n.kind === "generic.pdf");
      expect(pdfNode).toBeDefined();
      expect(pdfNode?.labels[0]?.text).toBe("My Paper");
      expect(pdfNode?.size).toEqual({ width: 340, height: 440 });
      expect(pdfNode?.customData?.src).toBe("app://local/doc.pdf");
    });

    it("should include Insert PDF Document in File Menu dropdown", () => {
      const fileBtn = container.querySelector("[title*='File Menu']");
      expect(fileBtn).not.toBeNull();
      fileBtn?.click();

      const popover = container.querySelector(".umlcanvas-menu-dropdown");
      expect(popover).not.toBeNull();

      const items = popover?.querySelectorAll(".umlcanvas-menu-item") ?? [];
      const labels = items.map((i) => i.textContent);
      expect(labels.some((l) => l.includes("Insert PDF Document..."))).toBe(true);

      const pdfItem = items.find((i) => i.textContent.includes("Insert PDF Document..."));
      pdfItem?.click();
      expect(addPdfRequested).toBe(true);
    });
  });

  describe("JSON Canvas Import & Export (.canvas compatibility)", () => {
    it("should import a JSON Canvas file node pointing to a PDF as generic.pdf with subpath", () => {
      const jsonCanvas = JSON.stringify({
        nodes: [
          {
            id: "pdf-node-1",
            type: "file",
            file: "Research/DeepLearning.pdf",
            subpath: "#page=12",
            x: 200,
            y: 150,
            width: 400,
            height: 520,
            color: "4",
          },
        ],
        edges: [],
      });

      const diagram = defaultJsonCanvasImporter.importCanvas(jsonCanvas);
      expect(diagram.nodes.length).toBe(1);

      const importedNode = diagram.nodes[0];
      expect(importedNode.kind).toBe("generic.pdf");
      expect(importedNode.labels[0].text).toBe("DeepLearning");
      expect(importedNode.metadata?.filePath).toBe("Research/DeepLearning.pdf");
      expect(importedNode.metadata?.subpath).toBe("#page=12");
      expect(importedNode.customData?.filePath).toBe("Research/DeepLearning.pdf");
      expect(importedNode.customData?.subpath).toBe("#page=12");
      expect(importedNode.style?.color).toBe("4");
      expect(importedNode.position).toEqual({ x: 200, y: 150 });
      expect(importedNode.size).toEqual({ width: 400, height: 520 });
    });

    it("should export generic.pdf back to JSON Canvas file node format with subpath", () => {
      const pdfNode = editor.addNode({
        id: "exported-pdf",
        kind: "generic.pdf",
        title: "DeepLearning",
        position: { x: 120, y: 80 },
        size: { width: 380, height: 500 },
        style: { color: "2" },
        metadata: {
          filePath: "Research/DeepLearning.pdf",
          subpath: "#page=5",
        },
        customData: {
          filePath: "Research/DeepLearning.pdf",
          subpath: "#page=5",
        },
      });

      const exportedJson = defaultJsonCanvasExporter.exportCanvas(editor.diagram);
      const parsed = JSON.parse(exportedJson);

      expect(parsed.nodes.length).toBe(1);
      const plainNode = parsed.nodes[0];
      expect(plainNode.id).toBe("exported-pdf");
      expect(plainNode.type).toBe("file");
      expect(plainNode.file).toBe("Research/DeepLearning.pdf");
      expect(plainNode.subpath).toBe("#page=5");
      expect(plainNode.color).toBe("2");
      expect(plainNode.x).toBe(120);
      expect(plainNode.y).toBe(80);
      expect(plainNode.width).toBe(380);
      expect(plainNode.height).toBe(500);
    });
  });

  describe("Standalone SVG Export", () => {
    it("should export generic.pdf to standalone SVG with header, icon, and card", () => {
      editor.addNode({
        kind: "generic.pdf",
        title: "Whitepaper",
        position: { x: 50, y: 50 },
        size: { width: 340, height: 440 },
        customData: {
          filePath: "docs/Whitepaper.pdf",
        },
      });

      const svg = defaultSvgExporter.exportToSvg(editor.diagram);
      expect(svg).toContain("umlcanvas-pdf-card");
      expect(svg).toContain("umlcanvas-pdf-title");
      expect(svg).toContain("Whitepaper");
      expect(svg).toContain("PDF:");
    });
  });

  describe("UmlCanvasView Add & Drop Operations", () => {
    let mockApp: any;
    let mockView: UmlCanvasView;

    beforeEach(() => {
      const vaultFiles = new Map<string, any>();
      const samplePdf = new TFile("docs/Sample.pdf", "Sample", "pdf");
      vaultFiles.set("docs/Sample.pdf", samplePdf);

      mockApp = {
        vault: {
          getFiles: () => [samplePdf],
          getAbstractFileByPath: (p: string) => vaultFiles.get(p) ?? null,
          getResourcePath: (f: TFile) => `app://local/${f.path}`,
          read: async () => "%PDF-1.4...",
        },
        workspace: {
          openLinkText: jest.fn(),
          getActiveViewOfType: () => null,
          on: () => ({}),
        },
        metadataCache: {
          getFirstLinkpathDest: (path: string) => vaultFiles.get(path) ?? null,
        },
      };

      const mockLeaf = { app: mockApp };
      mockView = new UmlCanvasView(mockLeaf as any, {} as any);
      (mockView as any).contentEl = container;
      (mockView as any).app = mockApp;
      (mockView as any).editor = editor;
      (mockView as any).renderer = renderer;
    });

    it("should add PDF node to canvas via addPdfToCanvas", async () => {
      const pdfFile = new TFile("docs/Sample.pdf", "Sample", "pdf");
      const node = await mockView.addPdfToCanvas({
        file: pdfFile,
        canvasPoint: { x: 100, y: 200 },
        subpath: "#page=3",
      });

      expect(node).not.toBeNull();
      expect(node?.kind).toBe("generic.pdf");
      expect(node?.labels[0].text).toBe("Sample");
      expect(node?.position).toEqual({ x: 100, y: 200 });
      expect(node?.metadata?.filePath).toBe("docs/Sample.pdf");
      expect(node?.metadata?.subpath).toBe("#page=3");
      expect(node?.customData?.src).toBe("app://local/docs/Sample.pdf");
    });

    it("should resolve vault resource paths on startup for PDF nodes without src", () => {
      const pdfNode = editor.addNode({
        kind: "generic.pdf",
        title: "Sample",
        metadata: { filePath: "docs/Sample.pdf" },
        customData: { filePath: "docs/Sample.pdf" },
      });

      expect(pdfNode.customData?.src).toBeUndefined();

      (mockView as any).resolveVaultResourcePaths();

      expect(pdfNode.customData?.src).toBe("app://local/docs/Sample.pdf");
      expect(pdfNode.metadata?.src).toBe("app://local/docs/Sample.pdf");
    });

    it("should handle vault PDF file renaming properly", () => {
      const pdfNode = editor.addNode({
        kind: "generic.pdf",
        title: "OldManual",
        metadata: { filePath: "docs/OldManual.pdf" },
        customData: { filePath: "docs/OldManual.pdf", src: "app://local/docs/OldManual.pdf" },
      });

      const renamedFile = new TFile("docs/NewManual.pdf", "NewManual", "pdf");
      (mockView as any).handleVaultFileRenamed(renamedFile, "docs/OldManual.pdf");

      expect(pdfNode.labels[0].text).toBe("NewManual");
      expect(pdfNode.metadata?.filePath).toBe("docs/NewManual.pdf");
      expect(pdfNode.customData?.filePath).toBe("docs/NewManual.pdf");
      expect(pdfNode.customData?.src).toBe("app://local/docs/NewManual.pdf");
    });
  });
});
