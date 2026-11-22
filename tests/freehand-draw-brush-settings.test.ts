import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { defaultShapeRegistry } from "../src/presentation/renderer/ShapeRegistry";
import { defaultSvgExporter } from "../src/infrastructure/export/SvgExporter";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { DEFAULT_SETTINGS } from "../src/infrastructure/obsidian/PluginSettings";
import { UmlCanvasSettingTab } from "../src/presentation/views/UmlCanvasSettingTab";
import { SetStrokeStyleCommand } from "../src/application/commands/DiagramCommands";

// Headless MockElement for testing renderer & DOM events
class MockElement {
  tagName: string;
  className: string = "";
  classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => {
      cls.forEach((c) => {
        if (!c) return;
        c.split(" ").forEach((k) => k && this.classList.classes.add(k));
      });
      this.className = Array.from(this.classList.classes).join(" ");
    },
    remove: (...cls: string[]) => {
      cls.forEach((c) => {
        if (!c) return;
        c.split(" ").forEach((k) => k && this.classList.classes.delete(k));
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
  style: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  listeners: Record<string, ((e: any) => void)[]> = {};
  title: string = "";
  disabled: boolean = false;
  value: string = "";
  offsetWidth: number = 240;
  offsetHeight: number = 300;
  clientWidth: number = 800;
  clientHeight: number = 600;

  constructor(tagName: string, options?: any) {
    this.tagName = tagName.toUpperCase();
    if (options?.cls) this.classList.add(options.cls);
    if (options?.text) this.textContent = options.text;
    if (options?.title) this.title = options.title;
    if (options?.attr) {
      for (const [k, v] of Object.entries(options.attr)) {
        this.attributes[k] = String(v);
      }
    }
  }

  createSvg(tag: string, options?: any): MockElement {
    const el = new MockElement(tag, options);
    this.appendChild(el);
    return el;
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

  prepend(child: MockElement): void {
    child.parentElement = this;
    this.children.unshift(child);
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  empty(): void {
    this.children = [];
    this.textContent = "";
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  }

  dispatch(event: string, data: any = {}): void {
    const handlers = [...(this.listeners[event] || [])];
    const evt = {
      ...data,
      target: data.target ?? this,
      currentTarget: this,
      stopPropagation: () => {},
      preventDefault: () => {},
    };
    for (const h of handlers) {
      h(evt);
    }
  }

  click(): void {
    this.dispatch("click");
  }

  setAttribute(k: string, v: string): void {
    this.attributes[k] = String(v);
    if (k === "class") {
      this.classList.add(...v.split(" "));
    }
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

  getAttribute(k: string): string | null {
    return this.attributes[k] ?? null;
  }

  removeAttribute(k: string): void {
    delete this.attributes[k];
  }

  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    return { left: 10, top: 10, right: 250, bottom: 50, width: 240, height: 40 };
  }

  setCssStyles(styles: Record<string, string>): void {
    Object.assign(this.style, styles);
  }

  contains(child: any): boolean {
    if (child === this) return true;
    for (const c of this.children) {
      if (c === child || (c.contains && c.contains(child))) return true;
    }
    return false;
  }

  private _textContent: string = "";
  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map((c) => c.textContent).join("");
  }
  set textContent(val: string) {
    this._textContent = val;
    if (val === "") this.children = [];
  }

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const match = (el: MockElement): boolean => {
      if (selector.startsWith(".")) {
        const cls = selector.substring(1);
        return el.classList.contains(cls);
      }
      if (selector.startsWith("#")) {
        const id = selector.substring(1);
        return el.getAttribute("id") === id;
      }
      if (selector.includes("[") && selector.includes("]")) {
        const attrName = selector.replace(/[\[\]]/g, "");
        return el.getAttribute(attrName) !== null;
      }
      return el.tagName.toLowerCase() === selector.toLowerCase();
    };

    const traverse = (el: MockElement) => {
      for (const child of el.children) {
        if (match(child)) results.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }
}

// Global mocks setup
const mockDocument = {
  createElement: (tag: string) => new MockElement(tag),
  createElementNS: (_ns: string, tag: string) => new MockElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {},
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
  setTimeout: (fn: () => void) => {
    fn();
    return 1;
  },
  clearTimeout: () => {},
};

(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

describe("Freehand Draw Tool Brush Settings (Width & Strength)", () => {
  describe("DiagramEditor Freehand Brush Configuration", () => {
    it("should initialize with default brush settings (width: 2, strength: 1.0)", () => {
      const editor = new DiagramEditor(createDiagram({ id: "diag-brush-1", diagramType: "general" }));
      expect(editor.freehandStrokeWidth).toBe(2);
      expect(editor.freehandStrokeStrength).toBe(1.0);
      expect(editor.getFreehandBrushSettings()).toEqual({
        strokeWidth: 2,
        strokeStrength: 1.0,
      });
    });

    it("should update brush settings and propagate them to newly drawn freehand nodes", () => {
      const editor = new DiagramEditor(createDiagram({ id: "diag-brush-2", diagramType: "general" }));
      editor.setFreehandBrushSettings({ strokeWidth: 6, strokeStrength: 0.5 });

      expect(editor.freehandStrokeWidth).toBe(6);
      expect(editor.freehandStrokeStrength).toBe(0.5);

      const stroke = {
        id: "stroke-1",
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 30 },
          { x: 80, y: 60 },
        ],
      };

      const node = editor.keepAsFreehand(stroke);
      expect(node.kind).toBe("generic.freehand");
      expect(node.style?.strokeWidth).toBe(6);
      expect(node.style?.strokeOpacity).toBe(0.5);
    });

    it("should allow explicit overrides when creating a freehand node", () => {
      const editor = new DiagramEditor(createDiagram({ id: "diag-brush-3", diagramType: "general" }));
      editor.setFreehandBrushSettings({ strokeWidth: 4, strokeStrength: 0.8 });

      const stroke = {
        id: "stroke-override",
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 20 },
        ],
      };

      const node = editor.addFreehandNode(stroke, { strokeWidth: 10, strokeOpacity: 0.3 });
      expect(node.style?.strokeWidth).toBe(10);
      expect(node.style?.strokeOpacity).toBe(0.3);
    });

    it("should update existing selected freehand nodes when brush settings are adjusted with undo/redo", () => {
      const editor = new DiagramEditor(createDiagram({ id: "diag-brush-4", diagramType: "general" }));
      const stroke = {
        id: "stroke-sel",
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 30 },
        ],
      };

      const node = editor.addFreehandNode(stroke);
      expect(node.style?.strokeWidth).toBe(2);
      expect(node.style?.strokeOpacity).toBe(1.0);

      // Select the freehand node
      editor.selectNode(node.id, false);

      // Adjust brush settings while node is selected
      editor.setFreehandBrushSettings({ strokeWidth: 8, strokeStrength: 0.4 });
      expect(node.style?.strokeWidth).toBe(8);
      expect(node.style?.strokeOpacity).toBe(0.4);

      // Undo reverts to previous stroke width and strength
      editor.undo();
      expect(node.style?.strokeWidth).toBe(2);
      expect(node.style?.strokeOpacity).toBe(1.0);

      // Redo restores new stroke width and strength
      editor.redo();
      expect(node.style?.strokeWidth).toBe(8);
      expect(node.style?.strokeOpacity).toBe(0.4);
    });

    it("should execute SetStrokeStyleCommand correctly", () => {
      const editor = new DiagramEditor(createDiagram({ id: "diag-cmd", diagramType: "general" }));
      const stroke = { id: "s1", points: [{ x: 5, y: 5 }, { x: 15, y: 15 }] };
      const node = editor.addFreehandNode(stroke);

      const cmd = new SetStrokeStyleCommand([node], { strokeWidth: 12, strokeOpacity: 0.25 });
      cmd.execute();
      expect(node.style?.strokeWidth).toBe(12);
      expect(node.style?.strokeOpacity).toBe(0.25);

      cmd.undo();
      expect(node.style?.strokeWidth).toBe(2);
      expect(node.style?.strokeOpacity).toBe(1.0);
    });
  });

  describe("ShapeRegistry & SVG Rendering with Custom Brush Width and Strength", () => {
    it("should render generic.freehand with specified strokeWidth and strokeOpacity", () => {
      const shapeDef = defaultShapeRegistry.get("generic.freehand");
      expect(shapeDef).toBeDefined();

      const freehandNode = {
        id: "fh-node-1",
        kind: "generic.freehand",
        position: { x: 10, y: 10 },
        size: { width: 100, height: 60 },
        title: "",
        style: {
          strokeWidth: 6,
          strokeOpacity: 0.6,
        },
        customData: {
          pathData: "M 0,0 L 50,50",
          points: [{ x: 0, y: 0 }, { x: 50, y: 50 }],
        },
      };

      const renderedEl = shapeDef.renderSvg(freehandNode as any, { isSelected: false });
      const pathEl = (renderedEl as any).querySelector(".umlcanvas-freehand-path");
      const hitboxEl = (renderedEl as any).querySelector(".umlcanvas-freehand-hitbox");

      expect(pathEl).not.toBeNull();
      expect(pathEl?.getAttribute("stroke-width")).toBe("6");
      expect(pathEl?.getAttribute("stroke-opacity")).toBe("0.6");
      expect(pathEl?.style?.strokeWidth).toBe("6px");
      expect(pathEl?.style?.strokeOpacity).toBe("0.6");

      // Hitbox dynamically scales with stroke width
      expect(hitboxEl).not.toBeNull();
      expect(hitboxEl?.getAttribute("stroke-width")).toBe(String(Math.max(16, 6 + 12)));
    });

    it("SvgExporter should export freehand strokes with stroke-width and stroke-opacity attributes", () => {
      const editor = new DiagramEditor(createDiagram({ id: "diag-svg-export", diagramType: "general" }));
      editor.setFreehandBrushSettings({ strokeWidth: 5, strokeStrength: 0.75 });

      editor.addFreehandNode({
        id: "stroke-export",
        points: [{ x: 10, y: 10 }, { x: 50, y: 50 }],
      });

      const svg = editor.exportToSvg();
      expect(svg).toContain('stroke-width="5"');
      expect(svg).toContain('stroke-opacity="0.75"');
      expect(svg).toContain('class="umlcanvas-freehand-path"');
    });
  });

  describe("SvgSceneRenderer Brush Settings & Preview", () => {
    let container: MockElement;
    let editor: DiagramEditor;
    let renderer: SvgSceneRenderer;

    beforeEach(() => {
      container = new MockElement("div", { cls: "umlcanvas-svg-container" });
      editor = new DiagramEditor(createDiagram({ id: "diag-renderer", diagramType: "general" }));
      renderer = new SvgSceneRenderer(container as any, editor, {
        enableFreehand: true,
        freehandBrushWidth: 4,
        freehandBrushStrength: 0.7,
      });
    });

    it("should initialize with custom brushWidth and brushStrength", () => {
      expect(renderer.brushWidth).toBe(4);
      expect(renderer.brushStrength).toBe(0.7);
    });

    it("should allow setting brushWidth and brushStrength dynamically", () => {
      renderer.setFreehandBrushWidth(8);
      renderer.setFreehandBrushStrength(0.4);

      expect(renderer.brushWidth).toBe(8);
      expect(renderer.brushStrength).toBe(0.4);
    });

    it("should apply configured brushWidth and brushStrength to the live drawing preview path", () => {
      renderer.setFreehandMode(true);
      renderer.setFreehandBrushWidth(5);
      renderer.setFreehandBrushStrength(0.65);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");

      // Start stroke
      svgEl?.dispatch("mousedown", { button: 0, target: bgRect, clientX: 20, clientY: 20 });

      const strokePreview = container.querySelector(".umlcanvas-freehand-stroke");
      expect(strokePreview).not.toBeNull();
      expect(strokePreview?.getAttribute("stroke-width")).toBe("5");
      expect(strokePreview?.getAttribute("stroke-opacity")).toBe("0.65");
      expect(strokePreview?.style.strokeWidth).toBe("5px");
      expect(strokePreview?.style.strokeOpacity).toBe("0.65");
    });

    it("should commit stroke with configured brush settings on mouse up", () => {
      renderer.setFreehandMode(true);
      renderer.setAutoShapeDetection(false);
      renderer.setFreehandBrushWidth(7);
      renderer.setFreehandBrushStrength(0.85);

      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");

      // Draw stroke
      svgEl?.dispatch("mousedown", { button: 0, target: bgRect, clientX: 10, clientY: 10 });
      (global as any).window.dispatch("mousemove", { clientX: 40, clientY: 40 });
      (global as any).window.dispatch("mousemove", { clientX: 70, clientY: 70 });
      (global as any).window.dispatch("mouseup", { clientX: 70, clientY: 70 });

      const nodes = editor.diagram.nodes.filter((n) => n.kind === "generic.freehand");
      expect(nodes.length).toBe(1);
      expect(nodes[0].style?.strokeWidth).toBe(7);
      expect(nodes[0].style?.strokeOpacity).toBe(0.85);
    });
  });

  describe("Toolbar Brush Settings UI & Popover", () => {
    let container: MockElement;
    let editor: DiagramEditor;
    let rendererMock: Partial<SvgSceneRenderer>;
    let toolbar: Toolbar;
    let onSettingsChangeMock: jest.Mock;

    beforeEach(() => {
      container = new MockElement("div", { cls: "umlcanvas-view-container" });
      editor = new DiagramEditor(createDiagram({ id: "diag-tb", diagramType: "general" }));
      onSettingsChangeMock = jest.fn();

      rendererMock = {
        isFreehandEnabled: true,
        freehandMode: false,
        grabMode: false,
        isAutoShapeDetection: false,
        currentTransform: { panX: 0, panY: 0, zoom: 1 },
        brushWidth: 2,
        brushStrength: 1.0,
        setFreehandMode: jest.fn((val: boolean) => {
          (rendererMock as any).freehandMode = val;
        }),
        setGrabMode: jest.fn(),
        setAutoShapeDetection: jest.fn(),
        setFreehandBrushWidth: jest.fn((w: number) => {
          (rendererMock as any).brushWidth = w;
        }),
        setFreehandBrushStrength: jest.fn((s: number) => {
          (rendererMock as any).brushStrength = s;
        }),
      };

      toolbar = new Toolbar(
        container as any,
        editor,
        rendererMock as any,
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
        undefined,
        onSettingsChangeMock
      );
    });

    afterEach(() => {
      toolbar.destroy();
    });

    it("should not provide Brush Settings button in the bottom floating toolbar", () => {
      const bottomToolbar = container.querySelector(".umlcanvas-floating-bottom-toolbar");
      expect(bottomToolbar).not.toBeNull();

      const buttons = bottomToolbar?.querySelectorAll("button") || [];
      const brushBtn = buttons.find((b) => b.title.includes("Brush Settings"));
      expect(brushBtn).toBeUndefined();
    });

    it("should provide Brush Settings button in the top toolbar only when Draw tool is chosen", () => {
      const bottomToolbar = container.querySelector(".umlcanvas-floating-bottom-toolbar");
      const topToolbar = container.querySelector(".umlcanvas-main-toolbar");
      expect(bottomToolbar).not.toBeNull();
      expect(topToolbar).not.toBeNull();

      const bottomButtons = bottomToolbar?.querySelectorAll("button") || [];
      const topButtons = topToolbar?.querySelectorAll("button") || [];
      const brushBtn = topButtons.find((b) => b.title.includes("Brush Settings"));
      expect(brushBtn).toBeDefined();
      expect(brushBtn?.classList.contains("umlcanvas-brush-btn")).toBe(true);

      // Initially hidden when draw tool is not chosen
      expect(brushBtn?.classList.contains("is-hidden")).toBe(true);

      // Choose Draw tool
      const drawBtn = bottomButtons.find((b) => b.title.includes("Draw"));
      expect(drawBtn).toBeDefined();
      drawBtn?.click();

      // Now Brush Settings button is visible in the top bar
      expect(brushBtn?.classList.contains("is-hidden")).toBe(false);

      // Open popover
      brushBtn?.click();
      const popover = container.querySelector(".umlcanvas-brush-popover");
      expect(popover).not.toBeNull();
      const text = popover?.textContent || "";
      expect(text).toContain("Brush Settings");
      expect(text).toContain("Brush Width");
      expect(text).toContain("Brush Strength");

      // Click again toggles closed
      brushBtn?.click();
      expect(container.querySelector(".umlcanvas-brush-popover")).toBeNull();

      // Deselect Draw tool
      drawBtn?.click();
      expect(brushBtn?.classList.contains("is-hidden")).toBe(true);
    });

    it("should close Brush Settings popover when Draw tool is deactivated", () => {
      const bottomToolbar = container.querySelector(".umlcanvas-floating-bottom-toolbar");
      const topToolbar = container.querySelector(".umlcanvas-main-toolbar");
      const bottomButtons = bottomToolbar?.querySelectorAll("button") || [];
      const topButtons = topToolbar?.querySelectorAll("button") || [];
      const drawBtn = bottomButtons.find((b) => b.title.includes("Draw"));
      const brushBtn = topButtons.find((b) => b.title.includes("Brush Settings"));

      // Activate Draw tool
      drawBtn?.click();
      expect(brushBtn?.classList.contains("is-hidden")).toBe(false);

      // Open popover
      brushBtn?.click();
      expect(container.querySelector(".umlcanvas-brush-popover")).not.toBeNull();

      // Deactivate Draw tool (e.g. toggle Draw off)
      drawBtn?.click();
      expect(container.querySelector(".umlcanvas-brush-popover")).toBeNull();
      expect(brushBtn?.classList.contains("is-hidden")).toBe(true);
    });

    it("should adjust brush width via quick presets in the popover", () => {
      toolbar.openBrushMenu();
      const popover = container.querySelector(".umlcanvas-brush-popover");
      expect(popover).not.toBeNull();

      // Find the preset buttons
      const presetBtns = popover?.querySelectorAll(".umlcanvas-brush-preset-btn") || [];
      const btn4px = presetBtns.find((b) => b.textContent === "4px");
      expect(btn4px).toBeDefined();

      btn4px?.click();
      expect(toolbar.getBrushWidth()).toBe(4);
      expect(rendererMock.setFreehandBrushWidth).toHaveBeenCalledWith(4);
      expect(editor.freehandStrokeWidth).toBe(4);
      expect(onSettingsChangeMock).toHaveBeenCalledWith(4, 1.0);
    });

    it("should adjust brush strength via quick presets in the popover", () => {
      toolbar.openBrushMenu();
      const popover = container.querySelector(".umlcanvas-brush-popover");
      const presetBtns = popover?.querySelectorAll(".umlcanvas-brush-preset-btn") || [];
      const btn50pct = presetBtns.find((b) => b.textContent === "50%");
      expect(btn50pct).toBeDefined();

      btn50pct?.click();
      expect(toolbar.getBrushStrength()).toBe(0.5);
      expect(rendererMock.setFreehandBrushStrength).toHaveBeenCalledWith(0.5);
      expect(editor.freehandStrokeStrength).toBe(0.5);
      expect(onSettingsChangeMock).toHaveBeenCalledWith(2, 0.5);
    });

    it("should adjust width and strength via stepper buttons", () => {
      toolbar.openBrushMenu();
      const popover = container.querySelector(".umlcanvas-brush-popover");
      const stepBtns = popover?.querySelectorAll(".umlcanvas-brush-step-btn") || [];

      // Find increment for width (first + button)
      const plusBtns = stepBtns.filter((b) => b.textContent === "+");
      const minusBtns = stepBtns.filter((b) => b.textContent === "−");

      expect(plusBtns.length).toBe(2); // One for width, one for strength
      expect(minusBtns.length).toBe(2);

      // Increase width from 2 to 3
      plusBtns[0].click();
      expect(toolbar.getBrushWidth()).toBe(3);

      // Decrease strength from 1.0 to 0.9
      minusBtns[1].click();
      expect(toolbar.getBrushStrength()).toBe(0.9);
    });

    it("should show context brush button when a freehand stroke is selected", () => {
      const stroke = { id: "fh-sel", points: [{ x: 10, y: 10 }, { x: 30, y: 30 }] };
      const node = editor.addFreehandNode(stroke, { strokeWidth: 6, strokeOpacity: 0.7 });

      // Before selection: context brush button is hidden
      const contextBrushBtn = container.querySelector(".umlcanvas-context-brush-btn");
      expect(contextBrushBtn).not.toBeNull();
      expect(contextBrushBtn?.classList.contains("is-hidden")).toBe(true);

      // Select freehand node: context brush button becomes visible
      editor.selectNode(node.id, false);
      expect(contextBrushBtn?.classList.contains("is-hidden")).toBe(false);

      // Click context brush button opens the popover
      contextBrushBtn?.click();
      const popover = container.querySelector(".umlcanvas-brush-popover");
      expect(popover).not.toBeNull();

      // Changing width updates the selected node
      toolbar.setBrushWidth(10);
      expect(node.style?.strokeWidth).toBe(10);
    });
  });

  describe("Obsidian Plugin Settings Tab", () => {
    it("DEFAULT_SETTINGS should include freehandBrushWidth and freehandBrushStrength", () => {
      expect(DEFAULT_SETTINGS.freehandBrushWidth).toBe(2);
      expect(DEFAULT_SETTINGS.freehandBrushStrength).toBe(1.0);
    });

    it("UmlCanvasSettingTab definitions should include brush width and strength settings", () => {
      const mockPlugin: any = {
        settings: { ...DEFAULT_SETTINGS },
        saveSettings: jest.fn().mockResolvedValue(undefined),
      };

      const tab = new UmlCanvasSettingTab({} as any, mockPlugin);
      const defs = tab.getSettingDefinitions();

      const widthDef: any = defs.find((d: any) => d.control?.key === "freehandBrushWidth");
      const strengthDef: any = defs.find((d: any) => d.control?.key === "freehandBrushStrength");

      expect(widthDef).toBeDefined();
      expect(widthDef?.name).toContain("Freehand brush width");

      expect(strengthDef).toBeDefined();
      expect(strengthDef?.name).toContain("Freehand brush strength");

      // Test control value getter/setter
      expect(tab.getControlValue("freehandBrushWidth")).toBe(2);
      expect(tab.getControlValue("freehandBrushStrength")).toBe(1.0);

      tab.setControlValue("freehandBrushWidth", 5);
      expect(mockPlugin.settings.freehandBrushWidth).toBe(5);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });
  });
});
