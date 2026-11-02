import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { DiagramNode } from "../src/domain/entities/DiagramNode";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { defaultJsonCanvasExporter } from "../src/infrastructure/export/JsonCanvasExporter";
import { defaultJsonCanvasImporter } from "../src/infrastructure/persistence/JsonCanvasImporter";
import { JsonCanvasSerializer } from "../src/infrastructure/persistence/JsonCanvasSerializer";
import { UmlCanvasView } from "../src/presentation/views/UmlCanvasView";
import {
  CanvasAttachmentService,
  CanvasAttachmentFolderInfo,
} from "../src/infrastructure/obsidian/CanvasAttachmentService";
import { App, TFile, TFolder, WorkspaceLeaf, normalizePath } from "./fakes/MockObsidian";

// Mock Element for headless DOM testing
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
    if (options?.cls) this.classList.add(options.cls);
    if (options?.text) this.textContent = options.text;
    if (options?.title) this.title = options.title;
    if (options?.value) this.value = options.value;
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
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  empty(): void {
    this.children = [];
    this.textContent = "";
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") this.classList.add(...value.split(" "));
  }

  setAttributeNS(_ns: any, name: string, value: string): void {
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

  dispatch(event: string, detail: any = {}): void {
    const handlers = [...(this.listeners[event] || [])];
    const evt = {
      stopPropagation: () => {},
      preventDefault: () => {},
      target: this,
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
          if (actual === val || actual.includes(val)) matches = true;
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

// Global environment setup
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

// Helper to create a fake image Blob with ArrayBuffer
function createFakeImageBlob(
  type = "image/png",
  name = "test.png",
  byteLength = 64
): Blob {
  const buffer = new ArrayBuffer(byteLength);
  const uint8 = new Uint8Array(buffer);
  for (let i = 0; i < byteLength; i++) uint8[i] = i % 256;

  const blob = new Blob([buffer], { type });
  (blob as any).name = name;
  return blob;
}

describe("Pasted Images in Canvas Working Directory (#5)", () => {
  let app: App;
  let service: CanvasAttachmentService;

  beforeEach(() => {
    app = new App();
    service = new CanvasAttachmentService(app as any);
  });

  describe("CanvasAttachmentService - Folder Computation", () => {
    it("should compute directory for canvas document located in vault root", () => {
      const file = new TFile("Architecture.canvas++", "Architecture", "canvas++");
      const folderInfo = service.getCanvasDocumentFolder(file);

      expect(folderInfo.workingDir).toBe("");
      expect(folderInfo.folderName).toBe("Architecture");
      expect(folderInfo.fullFolderPath).toBe("Architecture");
    });

    it("should compute directory for canvas document in subfolder", () => {
      const file = new TFile(
        "Projects/Backend/SystemDesign.canvas++",
        "SystemDesign",
        "canvas++"
      );
      file.parent = new TFolder("Projects/Backend", "Backend");

      const folderInfo = service.getCanvasDocumentFolder(file);

      expect(folderInfo.workingDir).toBe("Projects/Backend");
      expect(folderInfo.folderName).toBe("SystemDesign");
      expect(folderInfo.fullFolderPath).toBe("Projects/Backend/SystemDesign");
    });

    it("should cleanly strip all canvas extensions (.canvas, .canvuspp, .canvaspp, .canvasplusplus)", () => {
      const f1 = new TFile("Diagram.canvas", "Diagram", "canvas");
      expect(service.getCanvasDocumentFolder(f1).fullFolderPath).toBe("Diagram");

      const f2 = new TFile("Diagram.canvuspp", "Diagram", "canvuspp");
      expect(service.getCanvasDocumentFolder(f2).fullFolderPath).toBe("Diagram");

      const f3 = new TFile("Diagram.canvasplusplus", "Diagram", "canvasplusplus");
      expect(service.getCanvasDocumentFolder(f3).fullFolderPath).toBe("Diagram");

      const f4 = new TFile("Diagram.canvaspp", "Diagram", "canvaspp");
      expect(service.getCanvasDocumentFolder(f4).fullFolderPath).toBe("Diagram");
    });

    it("should sanitize illegal characters in canvas document names", () => {
      const file = new TFile("Diagram:Illegal*Test?.canvas++", "Diagram:Illegal*Test?", "canvas++");
      const folderInfo = service.getCanvasDocumentFolder(file);

      expect(folderInfo.folderName).toBe("Diagram_Illegal_Test_");
      expect(folderInfo.fullFolderPath).toBe("Diagram_Illegal_Test_");
    });

    it("should fallback to diagram title or 'canvas' when file is null (unsaved canvas)", () => {
      const folderInfo = service.getCanvasDocumentFolder(null, "Unsaved Draft");
      expect(folderInfo.folderName).toBe("Unsaved Draft");
      expect(folderInfo.fullFolderPath).toBe("Unsaved Draft");

      const folderInfoDefault = service.getCanvasDocumentFolder(null);
      expect(folderInfoDefault.folderName).toBe("canvas");
      expect(folderInfoDefault.fullFolderPath).toBe("canvas");
    });
  });

  describe("CanvasAttachmentService - Folder Creation & File Naming", () => {
    it("should create target folder in vault if it does not exist", async () => {
      const folderPath = "Projects/Architecture";
      expect(app.vault.getAbstractFileByPath(folderPath)).toBeNull();

      const created = await service.ensureFolderExists(folderPath);
      expect(created).not.toBeNull();
      expect(app.vault.getAbstractFileByPath(folderPath)).toBeDefined();
    });

    it("should safely return existing folder without throwing when it already exists", async () => {
      const folderPath = "ExistingFolder";
      await service.ensureFolderExists(folderPath);

      // Call again on existing folder
      const secondCall = await service.ensureFolderExists(folderPath);
      expect(secondCall).not.toBeNull();
    });

    it("should recursively create nested intermediate folders", async () => {
      const deepPath = "FolderA/FolderB/FolderC/DiagramFolder";
      await service.ensureFolderExists(deepPath);

      expect(app.vault.getAbstractFileByPath("FolderA")).toBeDefined();
      expect(app.vault.getAbstractFileByPath("FolderA/FolderB")).toBeDefined();
      expect(app.vault.getAbstractFileByPath("FolderA/FolderB/FolderC")).toBeDefined();
      expect(app.vault.getAbstractFileByPath(deepPath)).toBeDefined();
    });

    it("should generate Pasted image YYYYMMDDHHmmss.png for generic clipboard images", () => {
      const { fileName, fullFilePath } = service.getUniqueImageFilePath(
        "MyDoc",
        "image/png",
        "image.png"
      );

      expect(fileName).toMatch(/^Pasted image \d{14}\.png$/);
      expect(fullFilePath).toMatch(/^MyDoc\/Pasted image \d{14}\.png$/);
    });

    it("should detect correct extensions for jpeg, gif, webp, svg", () => {
      const jpg = service.getUniqueImageFilePath("MyDoc", "image/jpeg");
      expect(jpg.fileName).toMatch(/\.jpg$/);

      const gif = service.getUniqueImageFilePath("MyDoc", "image/gif");
      expect(gif.fileName).toMatch(/\.gif$/);

      const webp = service.getUniqueImageFilePath("MyDoc", "image/webp");
      expect(webp.fileName).toMatch(/\.webp$/);

      const svg = service.getUniqueImageFilePath("MyDoc", "image/svg+xml");
      expect(svg.fileName).toMatch(/\.svg$/);
    });

    it("should increment counter suffix to prevent file collisions", async () => {
      const folder = "DiagramAssets";
      await service.ensureFolderExists(folder);

      const name1 = service.getUniqueImageFilePath(folder, "image/png", "chart.png");
      await app.vault.createBinary(name1.fullFilePath, new ArrayBuffer(8));

      // Same name again
      const name2 = service.getUniqueImageFilePath(folder, "image/png", "chart.png");
      expect(name2.fileName).toBe("chart 1.png");
      await app.vault.createBinary(name2.fullFilePath, new ArrayBuffer(8));

      // Third time
      const name3 = service.getUniqueImageFilePath(folder, "image/png", "chart.png");
      expect(name3.fileName).toBe("chart 2.png");
    });

    it("should save pasted image blob into canvas document directory", async () => {
      const canvasFile = new TFile("Work/Arch.canvas++", "Arch", "canvas++");
      canvasFile.parent = new TFolder("Work", "Work");
      await app.vault.createFolder("Work");

      const blob = createFakeImageBlob("image/png", "image.png");
      const result = await service.savePastedImage(blob, { file: canvasFile });

      expect(result.filePath).toMatch(/^Work\/Arch\/Pasted image \d{14}\.png$/);
      expect(result.file).not.toBeNull();
      expect(result.src).toContain(result.filePath);
      expect(app.vault.getAbstractFileByPath(result.filePath)).toBeDefined();
    });
  });

  describe("CanvasAttachmentService - Data URL Parsing", () => {
    it("should convert valid base64 data URL to Blob", () => {
      const sampleBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      const blob = service.dataUrlToBlob(sampleBase64);

      expect(blob).not.toBeNull();
      expect(blob?.type).toBe("image/png");
      expect(blob?.size).toBeGreaterThan(0);
    });

    it("should return null on invalid data URL string", () => {
      expect(service.dataUrlToBlob("invalid-data")).toBeNull();
      expect(service.dataUrlToBlob("")).toBeNull();
    });
  });

  describe("UmlCanvasView - Copy & Paste Integration", () => {
    let mockView: UmlCanvasView;
    let editor: DiagramEditor;
    let renderer: SvgSceneRenderer;
    let containerEl: MockElement;
    let canvasFile: TFile;

    beforeEach(() => {
      editor = new DiagramEditor(
        createDiagram({ id: "diag-test", title: "System Architecture", diagramType: "general" })
      );
      containerEl = new MockElement("div", { cls: "umlcanvas-view-container" });
      renderer = new SvgSceneRenderer(containerEl as any, editor);

      const leaf = new WorkspaceLeaf();
      (leaf as any).app = app;
      mockView = new UmlCanvasView(leaf as any, { settings: {} } as any);
      (mockView as any).contentEl = containerEl;
      (mockView as any).app = app;
      (mockView as any).editor = editor;
      (mockView as any).renderer = renderer;

      canvasFile = new TFile("Diagrams/SystemArch.canvas++", "SystemArch", "canvas++");
      canvasFile.parent = new TFolder("Diagrams", "Diagrams");
      mockView.file = canvasFile;
    });

    it("should automatically create canvas document directory, save image binary into it, and link to canvas upon paste", async () => {
      const initialNodeCount = editor.diagram.nodes.length;
      const blob = createFakeImageBlob("image/png", "image.png");

      const pasteEvent = {
        preventDefault: jest.fn(),
        clipboardData: {
          items: [
            {
              type: "image/png",
              getAsFile: () => blob,
            },
          ],
        },
      } as any;

      mockView.handlePaste(pasteEvent);
      expect(pasteEvent.preventDefault).toHaveBeenCalled();

      // Allow async saving and node creation
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(editor.diagram.nodes.length).toBe(initialNodeCount + 1);
      const imageNode = editor.diagram.nodes.find((n) => n.kind === "generic.image");
      expect(imageNode).toBeDefined();

      // Check that the image was saved inside Diagrams/SystemArch/
      const expectedPrefix = "Diagrams/SystemArch/Pasted image ";
      expect(imageNode?.metadata?.filePath).toContain(expectedPrefix);
      expect(imageNode?.customData?.filePath).toContain(expectedPrefix);
      expect(imageNode?.customData?.src).toContain("Diagrams/SystemArch/");

      // Check that the file actually exists in the Obsidian vault map
      const createdVaultFile = app.vault.getAbstractFileByPath(imageNode?.metadata?.filePath as string);
      expect(createdVaultFile).toBeDefined();
    });

    it("should handle paste when canvas document is in vault root", async () => {
      mockView.file = new TFile("RootDiagram.canvas", "RootDiagram", "canvas");

      const blob = createFakeImageBlob("image/jpeg", "image.jpg");
      const pasteEvent = {
        preventDefault: jest.fn(),
        clipboardData: {
          items: [
            {
              type: "image/jpeg",
              getAsFile: () => blob,
            },
          ],
        },
      } as any;

      mockView.handlePaste(pasteEvent);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const imageNode = editor.diagram.nodes.find((n) => n.kind === "generic.image");
      expect(imageNode).toBeDefined();
      expect(imageNode?.metadata?.filePath).toMatch(/^RootDiagram\/Pasted image \d{14}\.jpg$/);

      const inVault = app.vault.getAbstractFileByPath(imageNode?.metadata?.filePath as string);
      expect(inVault).toBeDefined();
    });

    it("should handle multiple pasted images without collisions", async () => {
      const blob1 = createFakeImageBlob("image/png", "chart1.png");
      const blob2 = createFakeImageBlob("image/png", "chart2.png");

      const pasteEvent = {
        preventDefault: jest.fn(),
        clipboardData: {
          items: [
            { type: "image/png", getAsFile: () => blob1 },
            { type: "image/png", getAsFile: () => blob2 },
          ],
        },
      } as any;

      mockView.handlePaste(pasteEvent);
      await new Promise((resolve) => setTimeout(resolve, 80));

      const imageNodes = editor.diagram.nodes.filter((n) => n.kind === "generic.image");
      expect(imageNodes.length).toBe(2);
      expect(imageNodes[0].metadata?.filePath).not.toBe(imageNodes[1].metadata?.filePath);

      // Verify second image has offset position
      expect(imageNodes[1].position.x).toBeGreaterThan(imageNodes[0].position.x);
    });

    it("should handle paste event containing base64 data URL text", async () => {
      const base64Data =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

      const pasteEvent = {
        preventDefault: jest.fn(),
        clipboardData: {
          items: [],
          getData: (type: string) => (type === "text/plain" ? base64Data : ""),
        },
      } as any;

      mockView.handlePaste(pasteEvent);
      expect(pasteEvent.preventDefault).toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 50));

      const imageNode = editor.diagram.nodes.find((n) => n.kind === "generic.image");
      expect(imageNode).toBeDefined();
      expect(imageNode?.metadata?.filePath).toContain("Diagrams/SystemArch/Pasted image ");
    });

    it("should fallback to internal diagram paste when no image is in clipboard", () => {
      // Copy a node inside editor
      const origNode = editor.addNode({
        kind: "generic.rectangle",
        title: "Copied Box",
        position: { x: 50, y: 50 },
      });
      editor.selectNode(origNode.id, false);
      editor.copySelection();

      const initialCount = editor.diagram.nodes.length;

      // Paste event without image items
      const pasteEvent = {
        preventDefault: jest.fn(),
        clipboardData: {
          items: [],
          getData: () => "",
        },
      } as any;

      mockView.handlePaste(pasteEvent);
      expect(pasteEvent.preventDefault).toHaveBeenCalled();
      expect(editor.diagram.nodes.length).toBe(initialCount + 1);

      const pastedNode = editor.diagram.nodes[editor.diagram.nodes.length - 1];
      expect(pastedNode.labels[0].text).toBe("Copied Box");
      expect(pastedNode.id).not.toBe(origNode.id);
    });

    it("should place image at target position when canvasPoint is passed", async () => {
      const blob = createFakeImageBlob("image/png", "placed.png");
      await mockView.handlePastedImageBlob(blob, { x: 350, y: 450 });

      const imageNode = editor.diagram.nodes.find((n) => n.kind === "generic.image");
      expect(imageNode).toBeDefined();
      expect(imageNode?.position).toEqual({ x: 350, y: 450 });
    });

    it("should handle external OS drag-and-drop of an image file", async () => {
      const osFile = createFakeImageBlob("image/png", "dropped_screenshot.png");
      const dropEvent = {
        dataTransfer: {
          files: [osFile],
          getData: () => "",
        },
      } as any;

      const handled = await mockView.handleExternalDrop(dropEvent, { x: 200, y: 300 });
      expect(handled).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const imageNode = editor.diagram.nodes.find((n) => n.kind === "generic.image");
      expect(imageNode).toBeDefined();
      expect(imageNode?.metadata?.filePath).toContain("Diagrams/SystemArch/dropped_screenshot");
    });

    it("should update image node filePath and label when the image file is renamed in the vault", () => {
      const imageNode = editor.addNode({
        kind: "generic.image",
        title: "OldPhotoName",
        position: { x: 100, y: 100 },
        metadata: { filePath: "Diagrams/SystemArch/OldPhotoName.png" },
        customData: { filePath: "Diagrams/SystemArch/OldPhotoName.png", src: "app://local/old.png" },
      });

      const renamedFile = new TFile(
        "Diagrams/SystemArch/NewPhotoName.png",
        "NewPhotoName",
        "png"
      );

      (mockView as any).handleVaultFileRenamed(
        renamedFile,
        "Diagrams/SystemArch/OldPhotoName.png"
      );

      expect(imageNode.metadata?.filePath).toBe("Diagrams/SystemArch/NewPhotoName.png");
      expect(imageNode.customData?.filePath).toBe("Diagrams/SystemArch/NewPhotoName.png");
      expect(imageNode.labels[0].text).toBe("NewPhotoName");
    });
  });

  describe("JSON Canvas & Persistence Round-Trip for Linked Images", () => {
    it("should export linked image node as JSON Canvas file node with vault path", () => {
      const editor = new DiagramEditor(
        createDiagram({ id: "diag-export", title: "Export Test", diagramType: "general" })
      );

      editor.addNode({
        kind: "generic.image",
        title: "Pasted Photo",
        position: { x: 100, y: 150 },
        size: { width: 220, height: 260 },
        metadata: { filePath: "Projects/MyCanvas/Pasted image 20261102120000.png" },
        customData: { filePath: "Projects/MyCanvas/Pasted image 20261102120000.png" },
      });

      const jsonCanvas = defaultJsonCanvasExporter.exportToJsonCanvas(editor.diagram);
      const parsed = JSON.parse(jsonCanvas);

      const fileNode = parsed.nodes.find(
        (n: any) => n.file === "Projects/MyCanvas/Pasted image 20261102120000.png"
      );
      expect(fileNode).toBeDefined();
      expect(fileNode.type).toBe("file");
      expect(fileNode.x).toBe(100);
      expect(fileNode.y).toBe(150);
    });

    it("should import JSON Canvas file node back into generic.image with filePath", () => {
      const jsonCanvasData = {
        nodes: [
          {
            id: "node-img-1",
            type: "file",
            file: "Projects/MyCanvas/Pasted image 20261102120000.png",
            x: 100,
            y: 150,
            width: 220,
            height: 260,
          },
        ],
        edges: [],
      };

      const diagram = defaultJsonCanvasImporter.importCanvas(JSON.stringify(jsonCanvasData));
      expect(diagram.nodes.length).toBe(1);

      const importedNode = diagram.nodes[0];
      expect(importedNode.kind).toBe("generic.image");
      expect(importedNode.metadata?.filePath).toBe(
        "Projects/MyCanvas/Pasted image 20261102120000.png"
      );
      expect(importedNode.labels[0].text).toBe("Pasted image 20261102120000");
    });
  });

  describe("Toolbar Paste Button Integration", () => {
    it("should invoke onPasteRequested callback when clicking Paste button in Toolbar", () => {
      const editor = new DiagramEditor(
        createDiagram({ id: "diag-tb", title: "TB", diagramType: "general" })
      );
      const container = new MockElement("div");
      const renderer = new SvgSceneRenderer(container as any, editor);

      let pasteCalled = false;
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
        undefined,
        undefined,
        () => {
          pasteCalled = true;
        }
      );

      const pasteBtn = container.querySelector("[title*='Paste Selection']");
      expect(pasteBtn).not.toBeNull();

      pasteBtn?.click();
      expect(pasteCalled).toBe(true);

      toolbar.destroy();
    });
  });
});
