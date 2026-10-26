import CanvasPlusPlusPlugin, { VIEW_TYPE_UML_CANVAS } from "../src/main";
import { UmlCanvasView } from "../src/presentation/views/UmlCanvasView";
import { App, TFile, TFolder, WorkspaceLeaf } from "./fakes/MockObsidian";
import { createDiagram } from "../src/domain/entities/Diagram";
import { createDiagramNode } from "../src/domain/entities/DiagramNode";
import { JsonCanvasSerializer } from "../src/infrastructure/persistence/JsonCanvasSerializer";

class MockElement {
  tagName: string;
  className: string = "";
  classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => {
      cls.forEach((c) => {
        if (!c) return;
        if (c.includes(" ")) {
          throw new DOMException(
            `Failed to execute 'add' on 'DOMTokenList': The token provided ('${c}') contains HTML space characters, which are not valid in tokens.`,
            "InvalidCharacterError"
          );
        }
        this.classList.classes.add(c);
      });
      this.className = Array.from(this.classList.classes).join(" ");
    },
    remove: (...cls: string[]) => {
      cls.forEach((c) => {
        if (!c) return;
        if (c.includes(" ")) {
          throw new DOMException(
            `Failed to execute 'remove' on 'DOMTokenList': The token provided ('${c}') contains HTML space characters, which are not valid in tokens.`,
            "InvalidCharacterError"
          );
        }
        this.classList.classes.delete(c);
      });
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
      get: (target, prop: string) => target[prop] || "",
      set: (target, prop: string, val: string) => {
        target[prop] = val;
        return true;
      },
    });
  }

  setCssStyles(styles: Record<string, string>) {
    Object.assign(this._style, styles);
  }

  setCssProps(props: Record<string, string>) {
    Object.assign(this._style, props);
  }

  get textContent(): string {
    return this._textContent;
  }
  set textContent(val: string) {
    this._textContent = val;
  }

  constructor(tagName = "div", options?: any) {
    this.tagName = tagName;
    if (options?.cls) this.className = options.cls;
    if (options?.text) this._textContent = options.text;
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

  removeChild(child: MockElement): MockElement {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  setAttribute(k: string, v: string) {
    this.attributes[k] = v;
  }
  getAttribute(k: string): string | null {
    return this.attributes[k] || null;
  }
  removeAttribute(k: string) {
    delete this.attributes[k];
  }

  addEventListener(event: string, handler: (e: any) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }
  removeEventListener(event: string, handler: (e: any) => void) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
    }
  }

  createDiv(options?: any): MockElement {
    const div = new MockElement("div", options);
    this.appendChild(div);
    return div;
  }

  createSpan(options?: any): MockElement {
    const span = new MockElement("span", options);
    this.appendChild(span);
    return span;
  }

  createEl(tag: string, options?: any): MockElement {
    const el = new MockElement(tag, options);
    this.appendChild(el);
    return el;
  }

  createSvg(tag: string, options?: any): MockElement {
    const el = new MockElement(tag, options);
    if (options?.attr) {
      for (const [k, v] of Object.entries(options.attr)) {
        el.setAttribute(k, v as string);
      }
    }
    this.appendChild(el);
    return el;
  }

  empty() {
    this.children = [];
    this._textContent = "";
  }

  querySelector(selector: string): MockElement | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const result: MockElement[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }

  matches(selector: string): boolean {
    if (selector.startsWith(".")) {
      const cls = selector.slice(1);
      return this.classList.contains(cls);
    }
    if (selector === this.tagName) return true;
    return false;
  }

  closest(selector: string): MockElement | null {
    let current: MockElement | null = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  getBoundingClientRect() {
    return {
      top: 0,
      left: 0,
      bottom: 800,
      right: 1000,
      width: 1000,
      height: 800,
      x: 0,
      y: 0,
    };
  }
}

// Global DOM helpers for SvgSceneRenderer and Toolbar
(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

describe("Canvas++ Document Opening and Creation Tests (#8)", () => {
  let app: App;
  let plugin: CanvasPlusPlusPlugin;
  let leaf: WorkspaceLeaf;
  let view: UmlCanvasView;
  let origDoc: any;
  let origWin: any;
  const serializer = new JsonCanvasSerializer();

  beforeEach(async () => {
    origDoc = (global as any).document;
    origWin = (global as any).window;

    (global as any).document = {
      createElement: (tag: string) => new MockElement(tag),
      createElementNS: (_ns: string, tag: string) => new MockElement(tag),
      body: new MockElement("body"),
    };
    (global as any).window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      clearTimeout: () => {},
      setTimeout: (cb: any) => setTimeout(cb, 0),
    };

    app = new App();
    plugin = new CanvasPlusPlusPlugin(app as any, { id: "canvas-plus-plus", name: "Canvas++" } as any);
    await plugin.onload();

    leaf = new WorkspaceLeaf();
    view = new UmlCanvasView(leaf as any, plugin);
    (view as any).contentEl = new MockElement("div");
    leaf.view = view;
  });

  afterEach(() => {
    (global as any).document = origDoc;
    (global as any).window = origWin;
  });

  describe("Plugin loading and extension registration (#10)", () => {
    it("should load plugin without error even when Obsidian core already claims .canvas", async () => {
      const customApp = new App();
      customApp.viewRegistry = {
        typeByExtension: {
          canvas: "canvas",
          md: "markdown",
        },
      };
      const customPlugin = new CanvasPlusPlusPlugin(customApp as any, { id: "canvas-plus-plus", name: "Canvas++" } as any);
      await expect(customPlugin.onload()).resolves.not.toThrow();

      // Ensure custom extensions are registered
      expect(customApp.viewRegistry.typeByExtension["canvas++"]).toBe(VIEW_TYPE_UML_CANVAS);
      expect(customApp.viewRegistry.typeByExtension["canvuspp"]).toBe(VIEW_TYPE_UML_CANVAS);
      expect(customApp.viewRegistry.typeByExtension["canvaspp"]).toBe(VIEW_TYPE_UML_CANVAS);
      expect(customApp.viewRegistry.typeByExtension["umlcanvas"]).toBe(VIEW_TYPE_UML_CANVAS);
      // Canvas core view remains preserved
      expect(customApp.viewRegistry.typeByExtension["canvas"]).toBe("canvas");
    });

    it("should register .canvas if not claimed by core", async () => {
      const customApp = new App();
      customApp.viewRegistry = {
        typeByExtension: {},
      };
      const customPlugin = new CanvasPlusPlusPlugin(customApp as any, { id: "canvas-plus-plus", name: "Canvas++" } as any);
      await expect(customPlugin.onload()).resolves.not.toThrow();

      expect(customApp.viewRegistry.typeByExtension["canvas"]).toBe(VIEW_TYPE_UML_CANVAS);
      expect(customApp.viewRegistry.typeByExtension["canvas++"]).toBe(VIEW_TYPE_UML_CANVAS);
    });

    it("should tolerate extension registration errors gracefully without failing onload", async () => {
      const customApp = new App();
      const customPlugin = new CanvasPlusPlusPlugin(customApp as any, { id: "canvas-plus-plus", name: "Canvas++" } as any);
      jest.spyOn(customPlugin, "registerExtensions").mockImplementation(() => {
        throw new Error("Simulated registration error");
      });
      await expect(customPlugin.onload()).resolves.not.toThrow();
    });
  });

  describe("canAcceptExtension implementation on UmlCanvasView", () => {
    it("should accept .canvuspp extension", () => {
      expect(view.canAcceptExtension("canvuspp")).toBe(true);
      expect(view.canAcceptExtension(".canvuspp")).toBe(true);
      expect(view.canAcceptExtension("CANVUSPP")).toBe(true);
      expect(view.canAcceptExtension(".CANVUSPP")).toBe(true);
    });

    it("should accept .canvaspp extension (previous plugin format)", () => {
      expect(view.canAcceptExtension("canvaspp")).toBe(true);
      expect(view.canAcceptExtension(".canvaspp")).toBe(true);
      expect(view.canAcceptExtension("CANVASPP")).toBe(true);
      expect(view.canAcceptExtension(" Canvaspp ")).toBe(true);
    });

    it("should accept .canvas extension", () => {
      expect(view.canAcceptExtension("canvas")).toBe(true);
      expect(view.canAcceptExtension(".canvas")).toBe(true);
      expect(view.canAcceptExtension("CANVAS")).toBe(true);
      expect(view.canAcceptExtension(" Canvas ")).toBe(true);
    });

    it("should accept .canvas++ and .canvasplusplus extensions", () => {
      expect(view.canAcceptExtension("canvas++")).toBe(true);
      expect(view.canAcceptExtension(".canvas++")).toBe(true);
      expect(view.canAcceptExtension("canvasplusplus")).toBe(true);
      expect(view.canAcceptExtension("CANVASPLUSPLUS")).toBe(true);
      expect(view.canAcceptExtension("canvas-plus-plus")).toBe(true);
      expect(view.canAcceptExtension("canvpp")).toBe(true);
      expect(view.canAcceptExtension("canv")).toBe(true);
    });

    it("should accept .umlcanvas extension (legacy plugin format)", () => {
      expect(view.canAcceptExtension("umlcanvas")).toBe(true);
      expect(view.canAcceptExtension(".umlcanvas")).toBe(true);
      expect(view.canAcceptExtension("UMLCANVAS")).toBe(true);
    });

    it("should reject non-canvas extensions", () => {
      expect(view.canAcceptExtension("md")).toBe(false);
      expect(view.canAcceptExtension("txt")).toBe(false);
      expect(view.canAcceptExtension("png")).toBe(false);
      expect(view.canAcceptExtension("pdf")).toBe(false);
      expect(view.canAcceptExtension("json")).toBe(false);
      expect(view.canAcceptExtension("")).toBe(false);
      expect(view.canAcceptExtension(null as any)).toBe(false);
      expect(view.canAcceptExtension(undefined as any)).toBe(false);
    });
  });

  describe("Obsidian WorkspaceLeaf integration with canAcceptExtension", () => {
    it("should successfully open a .canvuspp file in the leaf", async () => {
      const file = new TFile("Diagrams/Architecture.canvuspp", "Architecture", "canvuspp");
      await expect(leaf.openFile(file)).resolves.not.toThrow();
    });

    it("should successfully open a previous .canvaspp file in the leaf", async () => {
      const file = new TFile("Diagrams/OldDiagram.canvaspp", "OldDiagram", "canvaspp");
      await expect(leaf.openFile(file)).resolves.not.toThrow();
    });

    it("should successfully open a legacy .umlcanvas file in the leaf", async () => {
      const file = new TFile("Diagrams/LegacyDiagram.umlcanvas", "LegacyDiagram", "umlcanvas");
      await expect(leaf.openFile(file)).resolves.not.toThrow();
    });

    it("should successfully open a .canvas file in the leaf", async () => {
      const file = new TFile("Diagrams/Native.canvas", "Native", "canvas");
      await expect(leaf.openFile(file)).resolves.not.toThrow();
    });

    it("should successfully open a .canvas++ file in the leaf", async () => {
      const file = new TFile("Diagrams/PlusPlus.canvas++", "PlusPlus", "canvas++");
      await expect(leaf.openFile(file)).resolves.not.toThrow();
    });

    it("should successfully open a .canvasplusplus file in the leaf", async () => {
      const file = new TFile("Diagrams/PlusPlusFull.canvasplusplus", "PlusPlusFull", "canvasplusplus");
      await expect(leaf.openFile(file)).resolves.not.toThrow();
    });

    it("should fail with 'Failed to open' error when opening an unsupported file type in the leaf", async () => {
      const file = new TFile("Notes/Daily.md", "Daily", "md");
      await expect(leaf.openFile(file)).rejects.toThrow('Failed to open "Notes/Daily.md"');
    });
  });

  describe("Opening previous canvas++ docs and data deserialization", () => {
    it("should open and deserialize a valid canvas++ diagram file", () => {
      const originalDiagram = createDiagram({
        id: "test-diag-1",
        diagramType: "general",
        title: "Test Diagram",
        nodes: [
          createDiagramNode({
            id: "node-1",
            kind: "class",
            position: { x: 100, y: 150 },
            size: { width: 140, height: 80 },
          }),
        ],
      });
      const serialized = serializer.serialize(originalDiagram, true);

      (view as any).file = new TFile("Test.canvuspp", "Test", "canvuspp");
      view.setViewData(serialized, true);

      expect(view.diagramEditor).not.toBeNull();
      expect(view.diagramEditor?.diagram.nodes).toHaveLength(1);
      expect(view.diagramEditor?.diagram.nodes[0].id).toBe("node-1");
      expect(view.diagramEditor?.diagram.title).toBe("Test Diagram");
    });

    it("should restore a previous diagram saved in plain JSON Canvas format via fallback", () => {
      const jsonCanvasData = JSON.stringify({
        nodes: [
          {
            id: "plain-node-1",
            type: "text",
            text: "Hello from previous canvas",
            x: 50,
            y: 80,
            width: 200,
            height: 100,
          },
        ],
        edges: [],
      });

      (view as any).file = new TFile("Imported.canvaspp", "Imported", "canvaspp");
      view.setViewData(jsonCanvasData, true);

      expect(view.diagramEditor).not.toBeNull();
      expect(view.diagramEditor?.diagram.nodes).toHaveLength(1);
      expect(view.diagramEditor?.diagram.nodes[0].id).toBe("plain-node-1");
    });

    it("should handle blank/empty canvas++ file gracefully", () => {
      (view as any).file = new TFile("Blank.canvuspp", "Blank", "canvuspp");
      view.setViewData("", true);

      expect(view.diagramEditor).not.toBeNull();
      expect(view.diagramEditor?.diagram.title).toBe("Blank");
      expect(view.diagramEditor?.diagram.nodes).toHaveLength(0);
    });

    it("should recover corrupted canvas++ files without crashing", () => {
      (view as any).file = new TFile("Broken.canvuspp", "Broken", "canvuspp");
      view.setViewData("{{{{corrupted json", true);

      expect(view.diagramEditor).not.toBeNull();
      expect(view.diagramEditor?.diagram.title).toBe("Broken");
    });

    it("should open previous canvas++ doc missing schemaVersion", () => {
      const rawDoc = JSON.stringify({
        id: "legacy-no-version",
        diagramType: "general",
        title: "Legacy No Version",
        nodes: [
          {
            id: "node-legacy",
            kind: "generic.rectangle",
            position: { x: 10, y: 20 },
            size: { width: 100, height: 60 },
          },
        ],
        edges: [],
      });

      (view as any).file = new TFile("LegacyDoc.canvaspp", "LegacyDoc", "canvaspp");
      view.setViewData(rawDoc, true);

      expect(view.diagramEditor).not.toBeNull();
      expect(view.diagramEditor?.diagram.nodes).toHaveLength(1);
      expect(view.diagramEditor?.diagram.nodes[0].id).toBe("node-legacy");
    });

    it("should open canvas++ doc with schemaVersion 2", () => {
      const v2Doc = JSON.stringify({
        schemaVersion: 2,
        id: "v2-diag",
        diagramType: "general",
        title: "V2 Diagram",
        nodes: [],
        edges: [],
      });

      (view as any).file = new TFile("V2Diagram.canvas++", "V2Diagram", "canvas++");
      view.setViewData(v2Doc, true);

      expect(view.diagramEditor).not.toBeNull();
      expect(view.diagramEditor?.diagram.title).toBe("V2 Diagram");
    });

    it("should successfully load file via onLoadFile with vault read", async () => {
      const file = new TFile("Docs/MyArch.canvas++", "MyArch", "canvas++");
      const sampleContent = JSON.stringify({
        schemaVersion: 1,
        id: "arch-1",
        diagramType: "general",
        title: "My Architecture",
        nodes: [],
        edges: [],
      });
      app.vault.read = jest.fn().mockResolvedValue(sampleContent);

      await view.onLoadFile(file as any);

      expect(view.file).toBe(file);
      expect(view.diagramEditor).not.toBeNull();
      expect(view.diagramEditor?.diagram.title).toBe("My Architecture");
    });
  });

  describe("Creating new Canvas++ documents", () => {
    it("should create new diagram file and open it in the leaf", async () => {
      const createdTFile = new TFile("Untitled Diagram.canvuspp", "Untitled Diagram", "canvuspp");
      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue(createdTFile);
      const openFileSpy = jest.fn().mockResolvedValue(undefined);

      app.workspace.getLeaf = () => ({
        openFile: openFileSpy,
        view,
      });

      await plugin.createNewDiagramFile("general", "Untitled Diagram");

      expect(createSpy).toHaveBeenCalledWith(
        "Untitled Diagram.canvuspp",
        expect.stringContaining('"schemaVersion": 1')
      );
      expect(openFileSpy).toHaveBeenCalledWith(createdTFile);
    });

    it("should create canvas++ document in a specific target folder", async () => {
      const folder = new TFolder("Architecture/UML", "UML");
      const createdTFile = new TFile("Architecture/UML/Untitled Diagram.canvuspp", "Untitled Diagram", "canvuspp");
      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue(createdTFile);
      const openFileSpy = jest.fn().mockResolvedValue(undefined);

      app.workspace.getLeaf = () => ({
        openFile: openFileSpy,
        view,
      });

      await plugin.createNewDiagramFile("general", "Untitled Diagram", folder as any);

      expect(createSpy).toHaveBeenCalledWith(
        "Architecture/UML/Untitled Diagram.canvuspp",
        expect.any(String)
      );
      expect(openFileSpy).toHaveBeenCalledWith(createdTFile);
    });
  });
});
