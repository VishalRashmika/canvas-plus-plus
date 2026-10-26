import * as fs from "fs";
import * as path from "path";
import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";

// Simple mock DOM element for Node/Jest test environment
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
      const classes =
        typeof options.cls === "string"
          ? options.cls.split(/\s+/).filter(Boolean)
          : Array.isArray(options.cls)
          ? options.cls
          : [options.cls];
      classes.forEach((c: string) => this.classList.classes.add(c));
      this.className = Array.from(this.classList.classes).join(" ");
    }
    if (options?.text) {
      this.textContent = options.text;
    }
    if (options?.title) {
      this.title = options.title;
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
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  setCssStyles(styles: Record<string, string>): void {
    Object.assign(this.style, styles);
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

  click(): void {
    const handlers = [...(this.listeners["click"] || [])];
    const event = {
      stopPropagation: () => {},
      preventDefault: () => {},
      target: this,
    };
    handlers.forEach((h) => h(event));
  }

  getBoundingClientRect() {
    return {
      left: 100,
      top: 50,
      right: 200,
      bottom: 80,
      width: 100,
      height: 30,
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
        const tag = selector.split("[")[0].trim();
        const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)\*?='([^']+)'\]/);
        const tagMatches = !tag || el.tagName.toLowerCase() === tag.toLowerCase();
        if (tagMatches && attrMatch) {
          const attrName = attrMatch[1];
          const val = attrMatch[2];
          const actual = el.title || el.getAttribute(attrName) || "";
          if (actual.includes(val)) {
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
}

// Setup global helpers if in node environment
(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

describe("Toolbar Redesign Tests", () => {
  let editor: DiagramEditor;
  let container: MockElement;
  let rendererMock: Partial<SvgSceneRenderer>;

  beforeEach(() => {
    editor = new DiagramEditor(
      createDiagram({ id: "diag-1", title: "Test Diagram", diagramType: "uml.class" })
    );
    container = new MockElement("div", { cls: "umlcanvas-view-container" });

    rendererMock = {
      isFreehandEnabled: true,
      freehandMode: false,
      grabMode: false,
      isAutoShapeDetection: false,
      currentTransform: { panX: 0, panY: 0, zoom: 1 },
      setFreehandMode: jest.fn((val: boolean) => {
        (rendererMock as any).freehandMode = val;
      }),
      setGrabMode: jest.fn((val: boolean) => {
        (rendererMock as any).grabMode = val;
      }),
      setAutoShapeDetection: jest.fn((val: boolean) => {
        (rendererMock as any).isAutoShapeDetection = val;
      }),
      setGridVisible: jest.fn(),
      zoomIn: jest.fn(),
      zoomOut: jest.fn(),
      resetZoom: jest.fn(),
      startInlineEditor: jest.fn(),
      startEdgeInlineEditor: jest.fn(),
      startGroupInlineEditor: jest.fn(),
    };
  });

  it("should divide toolbar into main top toolbar and floating bottom toolbar", () => {
    const toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any
    );

    const mainToolbar = container.querySelector(".umlcanvas-main-toolbar");
    const bottomToolbar = container.querySelector(".umlcanvas-floating-bottom-toolbar");

    expect(mainToolbar).toBeDefined();
    expect(bottomToolbar).toBeDefined();
    expect(mainToolbar).not.toBeNull();
    expect(bottomToolbar).not.toBeNull();

    toolbar.destroy();
  });

  it("should assign clickable-icon class to toolbar buttons to prevent host button overlays", () => {
    const toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any
    );

    const buttons = container.querySelectorAll(".umlcanvas-toolbar-btn");
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn.classList.contains("clickable-icon")).toBe(true);
    }

    toolbar.destroy();
  });

  it("should correctly add compound extraClass tokens without throwing InvalidCharacterError", () => {
    const toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any
    );
    expect(toolbar).toBeDefined();

    const decBtns = container.querySelectorAll(".umlcanvas-font-dec-btn");
    expect(decBtns.length).toBeGreaterThanOrEqual(2);
    for (const decBtn of decBtns) {
      expect(decBtn.classList.contains("umlcanvas-font-step-btn")).toBe(true);
      expect(decBtn.classList.contains("umlcanvas-font-dec-btn")).toBe(true);
    }

    const incBtns = container.querySelectorAll(".umlcanvas-font-inc-btn");
    expect(incBtns.length).toBeGreaterThanOrEqual(2);
    for (const incBtn of incBtns) {
      expect(incBtn.classList.contains("umlcanvas-font-step-btn")).toBe(true);
      expect(incBtn.classList.contains("umlcanvas-font-inc-btn")).toBe(true);
    }

    toolbar.destroy();
  });

  it("should group save and export settings under a common File menu dropdown", () => {
    const onSave = jest.fn();
    const onExportSvg = jest.fn();
    const onExportCanvas = jest.fn();

    const toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any,
      onSave,
      undefined,
      onExportSvg,
      onExportCanvas
    );

    // Find File menu button
    const fileBtn = container.querySelector(".umlcanvas-menu-trigger");
    expect(fileBtn).toBeDefined();
    expect(fileBtn?.textContent).toContain("File");

    // Open File menu
    fileBtn?.click();

    const fileDropdown = container.querySelector(".umlcanvas-file-menu-dropdown");
    expect(fileDropdown).not.toBeNull();

    // Verify File menu items exist
    const items = fileDropdown?.querySelectorAll(".umlcanvas-menu-item") || [];
    const labels = items.map((i) => i.textContent);
    expect(labels.some((l) => l.includes("Save Diagram"))).toBe(true);
    expect(labels.some((l) => l.includes("Export Standalone SVG"))).toBe(true);
    expect(labels.some((l) => l.includes("Export Obsidian .canvas"))).toBe(false);
    expect(labels.some((l) => l.toLowerCase().includes("obsidian .canvas"))).toBe(false);
    expect(labels.some((l) => l.toLowerCase().includes("obsidian canvas"))).toBe(false);
    expect(labels.some((l) => l.includes("Export for LLM"))).toBe(true);

    // Click Save
    const saveItem = items.find((i) => i.textContent.includes("Save Diagram"));
    saveItem?.click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onExportCanvas).not.toHaveBeenCalled();

    toolbar.destroy();
  });

  it("should not provide any option to export to obsidian canvas in File menu", () => {
    const toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any
    );

    const fileBtn = container.querySelector(".umlcanvas-menu-trigger");
    fileBtn?.click();

    const fileDropdown = container.querySelector(".umlcanvas-file-menu-dropdown");
    expect(fileDropdown).not.toBeNull();

    const items = fileDropdown?.querySelectorAll(".umlcanvas-menu-item") || [];
    const labels = items.map((i) => (i.textContent || "").toLowerCase());
    expect(labels.some((l) => l.includes(".canvas"))).toBe(false);
    expect(labels.some((l) => l.includes("obsidian canvas"))).toBe(false);

    toolbar.destroy();
  });

  it("should support theme toggle in File menu dropdown", () => {
    const onToggleTheme = jest.fn();

    const toolbar = new Toolbar(
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
      onToggleTheme
    );

    const fileBtn = container.querySelector(".umlcanvas-menu-trigger");
    fileBtn?.click();

    const fileDropdown = container.querySelector(".umlcanvas-file-menu-dropdown");
    expect(fileDropdown).not.toBeNull();

    const items = fileDropdown?.querySelectorAll(".umlcanvas-menu-item") || [];
    const themeItem = items.find(
      (i) =>
        i.textContent.includes("Pastel Light Theme") ||
        i.textContent.includes("Dark Theme")
    );
    expect(themeItem).toBeDefined();

    themeItem?.click();
    expect(onToggleTheme).toHaveBeenCalledTimes(1);

    toolbar.destroy();
  });

  it("should hide context-sensitive options when nothing is selected and show them when a component is selected", () => {
    const toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any
    );

    const contextGroup = container.querySelector(".umlcanvas-context-group");
    expect(contextGroup).not.toBeNull();
    // Initially nothing selected -> context group must be hidden
    expect(contextGroup?.classList.contains("is-hidden")).toBe(true);

    // Add a node and select it
    const node = editor.addNode({ title: "Box A" });
    // editor.addNode automatically selects the node
    expect(editor.selectedNodeIds).toContain(node.id);

    // Context group should now be visible!
    expect(contextGroup?.classList.contains("is-hidden")).toBe(false);

    // Selection badge should indicate 1 Node
    const badge = contextGroup?.querySelector(".umlcanvas-selection-badge");
    expect(badge?.textContent).toBe("1 Node");

    // With 1 node: align and group should be hidden (needs 2+ nodes)
    const alignBtn = contextGroup?.querySelector("button[title*='Align']");
    expect(alignBtn?.classList.contains("is-hidden")).toBe(true);

    // Add another node and select both
    const node2 = editor.addNode({ title: "Box B" });
    editor.selectNode(node.id, true); // additive
    expect(editor.selectedNodeIds.length).toBe(2);

    expect(badge?.textContent).toBe("2 Nodes");
    // With 2 nodes: align button should now be visible!
    expect(alignBtn?.classList.contains("is-hidden")).toBe(false);

    // Clear selection
    editor.clearSelection();
    expect(contextGroup?.classList.contains("is-hidden")).toBe(true);

    toolbar.destroy();
  });

  it("should show font management controls in context group when a component is selected", () => {
    const toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any
    );

    const node = editor.addNode({ title: "Box Typography" });
    editor.selectNode(node.id, false);

    const contextGroup = container.querySelector(".umlcanvas-context-group");
    expect(contextGroup).not.toBeNull();
    expect(contextGroup?.classList.contains("is-hidden")).toBe(false);

    const fontStepper = contextGroup?.querySelector(".umlcanvas-context-font-stepper");
    expect(fontStepper).not.toBeNull();

    const decBtn = contextGroup?.querySelector(".umlcanvas-font-dec-btn");
    const incBtn = contextGroup?.querySelector(".umlcanvas-font-inc-btn");
    const sizeBtn = contextGroup?.querySelector(".umlcanvas-context-font-size-btn");
    const boldBtn = contextGroup?.querySelector(".umlcanvas-context-bold-btn");
    const italicBtn = contextGroup?.querySelector(".umlcanvas-context-italic-btn");

    expect(decBtn).not.toBeNull();
    expect(incBtn).not.toBeNull();
    expect(sizeBtn).not.toBeNull();
    expect(boldBtn).not.toBeNull();
    expect(italicBtn).not.toBeNull();

    // Click bold in context group
    boldBtn?.click();
    expect(editor.getNodeFont(node.id).bold).toBe(true);

    // Click incBtn in context group
    incBtn?.click();
    expect(editor.getNodeFont(node.id).fontSize).toBe(14);

    toolbar.destroy();
  });

  it("should have select, draw, shape creation, and line tools in floating bottom toolbar with icons", () => {
    const toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any
    );

    const bottomToolbar = container.querySelector(".umlcanvas-floating-bottom-toolbar");
    expect(bottomToolbar).not.toBeNull();

    // Verify icon-only tools in bottom toolbar
    const buttons = bottomToolbar?.querySelectorAll("button") || [];
    // Tools in bottom toolbar should be icon-only (no verbose text clutter)
    for (const btn of buttons) {
      expect(btn.classList.contains("is-icon-only")).toBe(true);
    }

    // Verify Shape Creation buttons: Rectangle, Circle, Diamond, Triangle, Note, Grab
    const selectBtn = buttons.find((b) => b.title.includes("Select"));
    const grabBtn = buttons.find((b) => b.title.includes("Grab"));
    const rectBtn = buttons.find((b) => b.title.includes("Rectangle"));
    const circleBtn = buttons.find((b) => b.title.includes("Circle"));
    const diamondBtn = buttons.find((b) => b.title.includes("Diamond"));
    const triangleBtn = buttons.find((b) => b.title.includes("Triangle"));
    const noteBtn = buttons.find((b) => b.title.includes("Note"));
    const lineBtn = buttons.find((b) => b.title.includes("Connector"));

    expect(selectBtn).toBeDefined();
    expect(grabBtn).toBeDefined();
    expect(rectBtn).toBeDefined();
    expect(circleBtn).toBeDefined();
    expect(diamondBtn).toBeDefined();
    expect(triangleBtn).toBeDefined();
    expect(noteBtn).toBeDefined();
    expect(lineBtn).toBeDefined();

    // Clicking Rectangle creates a generic.rectangle node
    expect(editor.diagram.nodes.length).toBe(0);
    rectBtn?.click();
    expect(editor.diagram.nodes.length).toBe(1);
    expect(editor.diagram.nodes[0].kind).toBe("generic.rectangle");

    // Clicking Circle creates a generic.circle node
    circleBtn?.click();
    expect(editor.diagram.nodes.length).toBe(2);
    expect(editor.diagram.nodes[1].kind).toBe("generic.circle");

    // Clicking Diamond creates a generic.diamond node named Diamond
    expect(diamondBtn?.title).toBe("Diamond (D)");
    expect(diamondBtn?.title.toLowerCase()).not.toContain("decision");
    diamondBtn?.click();
    expect(editor.diagram.nodes.length).toBe(3);
    expect(editor.diagram.nodes[2].kind).toBe("generic.diamond");
    expect(editor.diagram.nodes[2].labels[0].text).toBe("Diamond");
    expect(editor.diagram.nodes[2].labels[0].text.toLowerCase()).not.toContain("decision");

    // Test Line Tool: selecting 2 nodes and clicking line connects them!
    editor.clearSelection();
    editor.selectNode(editor.diagram.nodes[0].id, false);
    editor.selectNode(editor.diagram.nodes[1].id, true);
    expect(editor.selectedNodeIds.length).toBe(2);
    expect(editor.diagram.edges.length).toBe(0);

    lineBtn?.click();
    expect(editor.diagram.edges.length).toBe(1);
    expect(editor.diagram.edges[0].fromNodeId).toBe(editor.diagram.nodes[0].id);
    expect(editor.diagram.edges[0].toNodeId).toBe(editor.diagram.nodes[1].id);

    toolbar.destroy();
  });

  it("should keep shape library button in main toolbar at current location", () => {
    const onTogglePalette = jest.fn();

    const toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any,
      undefined,
      onTogglePalette
    );

    const mainToolbar = container.querySelector(".umlcanvas-main-toolbar");
    const shapesBtn = mainToolbar?.querySelectorAll("button").find((b) => b.title.includes("Shape Library"));
    expect(shapesBtn).toBeDefined();
    expect(shapesBtn?.textContent).toContain("Shapes");

    shapesBtn?.click();
    expect(onTogglePalette).toHaveBeenCalledTimes(1);

    // Test updating palette button active state
    toolbar.updatePaletteButtonState(true);
    expect(shapesBtn?.classList.contains("is-active")).toBe(true);

    toolbar.updatePaletteButtonState(false);
    expect(shapesBtn?.classList.contains("is-active")).toBe(false);

    toolbar.destroy();
  });

  it("should activate grab tool and synchronize active states between select and grab buttons", () => {
    const toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any
    );

    const bottomToolbar = container.querySelector(".umlcanvas-floating-bottom-toolbar");
    const buttons = bottomToolbar?.querySelectorAll("button") || [];
    const selectBtn = buttons.find((b) => b.title.includes("Select"));
    const grabBtn = buttons.find((b) => b.title.includes("Grab"));

    expect(selectBtn).toBeDefined();
    expect(grabBtn).toBeDefined();

    // Initially select tool is active
    expect(selectBtn?.classList.contains("is-active")).toBe(true);
    expect(grabBtn?.classList.contains("is-active")).toBe(false);

    // Clicking grab tool activates grab mode
    grabBtn?.click();
    expect(rendererMock.setGrabMode).toHaveBeenCalledWith(true);

    // Simulate renderer mode update
    (rendererMock as any).grabMode = true;
    toolbar.updateToolMode();

    expect(grabBtn?.classList.contains("is-active")).toBe(true);
    expect(selectBtn?.classList.contains("is-active")).toBe(false);

    // Clicking select tool switches back to select mode
    selectBtn?.click();
    expect(rendererMock.setGrabMode).toHaveBeenCalledWith(false);
    expect(rendererMock.setFreehandMode).toHaveBeenCalledWith(false);

    (rendererMock as any).grabMode = false;
    toolbar.updateToolMode();

    expect(selectBtn?.classList.contains("is-active")).toBe(true);
    expect(grabBtn?.classList.contains("is-active")).toBe(false);

    toolbar.destroy();
  });

  it("should never have Select tool and Auto Shape tool active at the same time", () => {
    // Enable auto shape detection in renderer (default setting)
    (rendererMock as any).isAutoShapeDetection = true;
    (rendererMock as any).freehandMode = false;
    (rendererMock as any).grabMode = false;

    const toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any
    );

    const bottomToolbar = container.querySelector(".umlcanvas-floating-bottom-toolbar");
    const buttons = bottomToolbar?.querySelectorAll("button") || [];
    const selectBtn = buttons.find((b) => b.title.includes("Select"));
    const autoShapeBtn = buttons.find((b) => b.title.includes("Auto Shape"));
    const drawBtn = buttons.find((b) => b.title.includes("Draw"));
    const grabBtn = buttons.find((b) => b.title.includes("Grab"));

    expect(selectBtn).toBeDefined();
    expect(autoShapeBtn).toBeDefined();
    expect(drawBtn).toBeDefined();
    expect(grabBtn).toBeDefined();

    // 1. Initial State: Only Select tool is active, Auto Shape is NOT active
    expect(selectBtn?.classList.contains("is-active")).toBe(true);
    expect(autoShapeBtn?.classList.contains("is-active")).toBe(false);
    expect(drawBtn?.classList.contains("is-active")).toBe(false);
    expect(grabBtn?.classList.contains("is-active")).toBe(false);

    // 2. Click Auto Shape tool: Activates Auto Shape mode
    autoShapeBtn?.click();
    expect(rendererMock.setAutoShapeDetection).toHaveBeenCalledWith(true);
    expect(rendererMock.setFreehandMode).toHaveBeenCalledWith(true);

    // Simulate renderer updated to auto shape mode
    (rendererMock as any).freehandMode = true;
    (rendererMock as any).isAutoShapeDetection = true;
    toolbar.updateToolMode();

    expect(autoShapeBtn?.classList.contains("is-active")).toBe(true);
    expect(selectBtn?.classList.contains("is-active")).toBe(false);
    expect(drawBtn?.classList.contains("is-active")).toBe(false);
    expect(grabBtn?.classList.contains("is-active")).toBe(false);

    // 3. Click Select & Move tool: Switches back to Select mode
    selectBtn?.click();
    expect(rendererMock.setFreehandMode).toHaveBeenCalledWith(false);

    (rendererMock as any).freehandMode = false;
    // autoShapeDetection setting is still true in renderer
    (rendererMock as any).isAutoShapeDetection = true;
    toolbar.updateToolMode();

    // MUST NOT have both active! Only selectBtn is active
    expect(selectBtn?.classList.contains("is-active")).toBe(true);
    expect(autoShapeBtn?.classList.contains("is-active")).toBe(false);
    expect(drawBtn?.classList.contains("is-active")).toBe(false);
    expect(grabBtn?.classList.contains("is-active")).toBe(false);

    // 4. Click Draw tool: Switches to Draw mode (autoShapeDetection = false)
    drawBtn?.click();
    expect(rendererMock.setAutoShapeDetection).toHaveBeenCalledWith(false);
    expect(rendererMock.setFreehandMode).toHaveBeenCalledWith(true);

    (rendererMock as any).freehandMode = true;
    (rendererMock as any).isAutoShapeDetection = false;
    toolbar.updateToolMode();

    expect(drawBtn?.classList.contains("is-active")).toBe(true);
    expect(selectBtn?.classList.contains("is-active")).toBe(false);
    expect(autoShapeBtn?.classList.contains("is-active")).toBe(false);
    expect(grabBtn?.classList.contains("is-active")).toBe(false);

    // 5. From Draw mode, click Auto Shape tool: Switches directly to Auto Shape
    autoShapeBtn?.click();
    expect(rendererMock.setAutoShapeDetection).toHaveBeenCalledWith(true);
    expect(rendererMock.setFreehandMode).toHaveBeenCalledWith(true);

    (rendererMock as any).freehandMode = true;
    (rendererMock as any).isAutoShapeDetection = true;
    toolbar.updateToolMode();

    expect(autoShapeBtn?.classList.contains("is-active")).toBe(true);
    expect(drawBtn?.classList.contains("is-active")).toBe(false);
    expect(selectBtn?.classList.contains("is-active")).toBe(false);

    // 6. Click Auto Shape tool while active: Toggles off to Select mode
    autoShapeBtn?.click();
    expect(rendererMock.setFreehandMode).toHaveBeenCalledWith(false);

    (rendererMock as any).freehandMode = false;
    toolbar.updateToolMode();

    expect(selectBtn?.classList.contains("is-active")).toBe(true);
    expect(autoShapeBtn?.classList.contains("is-active")).toBe(false);
    expect(drawBtn?.classList.contains("is-active")).toBe(false);

    toolbar.destroy();
  });

  it("should properly destroy and remove DOM elements", () => {
    const toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any
    );

    expect(container.children.length).toBeGreaterThan(0);

    toolbar.destroy();

    expect(container.querySelector(".umlcanvas-main-toolbar")).toBeNull();
    expect(container.querySelector(".umlcanvas-floating-bottom-toolbar")).toBeNull();
    expect(container.querySelector(".umlcanvas-breadcrumbs")).toBeNull();
  });

  it("should render color selection menu button with non-clipping umlcanvas-color-btn class", () => {
    const node = editor.addNode({ title: "Test Color Node", style: { color: "1" } });
    editor.selectNode(node.id);

    const toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any
    );

    const colorBtn = container.querySelector(".umlcanvas-color-btn");
    expect(colorBtn).not.toBeNull();
    expect(colorBtn?.classList.contains("umlcanvas-toolbar-btn")).toBe(true);
    expect(colorBtn?.classList.contains("clickable-icon")).toBe(true);

    const iconSpan = colorBtn?.querySelector(".umlcanvas-btn-icon");
    expect(iconSpan).not.toBeNull();

    const indicator = colorBtn?.querySelector(".umlcanvas-color-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator?.classList.contains("is-visible")).toBe(true);

    // Clicking colorBtn toggles color palette popover
    colorBtn?.click();
    const popover = container.querySelector(".umlcanvas-color-palette-popover");
    expect(popover).not.toBeNull();

    // Verify styles.css contains non-clipping overflow: visible and auto width definitions
    const stylesPath = path.resolve(__dirname, "../styles.css");
    const stylesContent = fs.readFileSync(stylesPath, "utf-8");
    expect(stylesContent).toContain(".umlcanvas-color-btn");
    expect(stylesContent).toContain("overflow: visible");

    toolbar.destroy();
  });
});
