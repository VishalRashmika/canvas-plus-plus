import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { PalettePanel } from "../src/presentation/views/PalettePanel";
import { ShapeRegistry } from "../src/presentation/renderer/ShapeRegistry";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { Toolbar } from "../src/presentation/views/Toolbar";

// Mock DOM Element for Jest Node test environment
class MockElement {
  tagName: string;
  className: string = "";
  classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => {
      cls.forEach((c) => {
        if (!c) return;
        this.classList.classes.add(c);
      });
      this.className = Array.from(this.classList.classes).join(" ");
    },
    remove: (...cls: string[]) => {
      cls.forEach((c) => {
        if (!c) return;
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

  createSvg(tag: string, options?: any): MockElement {
    const el = new MockElement(tag, options);
    this.appendChild(el);
    return el;
  }

  empty(): void {
    this.children = [];
  }

  focus(): void {}
  blur(): void {}

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

  dispatchEvent(event: { type: string; [key: string]: any }): void {
    const handlers = [...(this.listeners[event.type] || [])];
    if (!event.stopPropagation) event.stopPropagation = () => {};
    if (!event.preventDefault) event.preventDefault = () => {};
    if (!event.target) event.target = this;
    handlers.forEach((h) => h(event));
  }

  click(): void {
    this.dispatchEvent({ type: "click" });
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

// Global setup
(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

describe("PalettePanel Shapes Menu & Close Button Tests", () => {
  let editor: DiagramEditor;
  let container: MockElement;
  let rendererMock: Partial<SvgSceneRenderer>;
  let shapeRegistry: ShapeRegistry;

  beforeEach(() => {
    const diagram = createDiagram({ id: "test-diagram", diagramType: "general", title: "Test Diagram" });
    editor = new DiagramEditor(diagram);
    container = new MockElement("div", { cls: "umlcanvas-view-container" });
    shapeRegistry = new ShapeRegistry();
    rendererMock = {
      shapeRegistry,
      currentTransform: { panX: 0, panY: 0, zoom: 1 },
      isFreehandEnabled: false,
    };
  });

  it("should initialize in collapsed state with toggle tab visible", () => {
    const onToggleChange = jest.fn();
    const panel = new PalettePanel(
      container as any,
      editor,
      rendererMock as any,
      shapeRegistry,
      onToggleChange
    );

    const panelEl = container.querySelector(".umlcanvas-palette-panel");
    const toggleTabEl = container.querySelector(".umlcanvas-palette-toggle-tab");
    const closeBtn = container.querySelector(".umlcanvas-palette-close-btn");

    expect(panelEl).not.toBeNull();
    expect(toggleTabEl).not.toBeNull();
    expect(closeBtn).not.toBeNull();

    expect(panel.isOpen).toBe(false);
    expect(panelEl?.classList.contains("is-collapsed")).toBe(true);
    expect(panelEl?.classList.contains("is-open")).toBe(false);
    expect(toggleTabEl?.classList.contains("is-hidden")).toBe(false);

    // Initial state does not fire onToggleChange
    expect(onToggleChange).not.toHaveBeenCalled();

    panel.destroy();
  });

  it("should open and close programmatically via open(), close(), and toggle()", () => {
    const onToggleChange = jest.fn();
    const panel = new PalettePanel(
      container as any,
      editor,
      rendererMock as any,
      shapeRegistry,
      onToggleChange
    );
    const panelEl = container.querySelector(".umlcanvas-palette-panel");
    const toggleTabEl = container.querySelector(".umlcanvas-palette-toggle-tab");

    // Open
    panel.open();
    expect(panel.isOpen).toBe(true);
    expect(panelEl?.classList.contains("is-collapsed")).toBe(false);
    expect(panelEl?.classList.contains("is-open")).toBe(true);
    expect(toggleTabEl?.classList.contains("is-hidden")).toBe(true);
    expect(onToggleChange).toHaveBeenCalledWith(true);

    // Calling open() again when already open is a no-op
    onToggleChange.mockClear();
    panel.open();
    expect(onToggleChange).not.toHaveBeenCalled();

    // Close
    panel.close();
    expect(panel.isOpen).toBe(false);
    expect(panelEl?.classList.contains("is-collapsed")).toBe(true);
    expect(panelEl?.classList.contains("is-open")).toBe(false);
    expect(toggleTabEl?.classList.contains("is-hidden")).toBe(false);
    expect(onToggleChange).toHaveBeenCalledWith(false);

    // Calling close() again when already closed is a no-op
    onToggleChange.mockClear();
    panel.close();
    expect(onToggleChange).not.toHaveBeenCalled();

    // Toggle from closed -> open
    panel.toggle();
    expect(panel.isOpen).toBe(true);
    expect(onToggleChange).toHaveBeenCalledWith(true);

    // Toggle from open -> closed in exactly one call
    onToggleChange.mockClear();
    panel.toggle();
    expect(panel.isOpen).toBe(false);
    expect(onToggleChange).toHaveBeenCalledWith(false);

    panel.destroy();
  });

  it("should close immediately when clicking the '✕' close button with click event", () => {
    const onToggleChange = jest.fn();
    const panel = new PalettePanel(
      container as any,
      editor,
      rendererMock as any,
      shapeRegistry,
      onToggleChange
    );
    const panelEl = container.querySelector(".umlcanvas-palette-panel");
    const closeBtn = container.querySelector(".umlcanvas-palette-close-btn");

    // Open panel first
    panel.open();
    expect(panel.isOpen).toBe(true);
    expect(panelEl?.classList.contains("is-collapsed")).toBe(false);

    // Click '✕' button
    let stoppedPropagation = false;
    let preventedDefault = false;
    let markedHandled = false;

    closeBtn?.dispatchEvent({
      type: "click",
      stopPropagation: () => {
        stoppedPropagation = true;
      },
      preventDefault: () => {
        preventedDefault = true;
      },
      get _umlHandled() {
        return markedHandled;
      },
      set _umlHandled(val: boolean) {
        markedHandled = val;
      },
    });

    expect(panel.isOpen).toBe(false);
    expect(panelEl?.classList.contains("is-collapsed")).toBe(true);
    expect(panelEl?.classList.contains("is-open")).toBe(false);
    expect(onToggleChange).toHaveBeenCalledWith(false);
    expect(stoppedPropagation).toBe(true);
    expect(preventedDefault).toBe(true);
    expect(markedHandled).toBe(true);

    panel.destroy();
  });

  it("should close immediately when clicking '✕' via mousedown or pointerdown event", () => {
    const onToggleChange = jest.fn();
    const panel = new PalettePanel(
      container as any,
      editor,
      rendererMock as any,
      shapeRegistry,
      onToggleChange
    );
    const closeBtn = container.querySelector(".umlcanvas-palette-close-btn");

    // Test mousedown closes immediately
    panel.open();
    expect(panel.isOpen).toBe(true);

    closeBtn?.dispatchEvent({
      type: "mousedown",
      stopPropagation: () => {},
      preventDefault: () => {},
    });

    expect(panel.isOpen).toBe(false);
    expect(onToggleChange).toHaveBeenCalledWith(false);

    // Test pointerdown closes immediately
    panel.open();
    expect(panel.isOpen).toBe(true);

    closeBtn?.dispatchEvent({
      type: "pointerdown",
      stopPropagation: () => {},
      preventDefault: () => {},
    });

    expect(panel.isOpen).toBe(false);

    panel.destroy();
  });

  it("should close when pressing Escape key in search input or panel", () => {
    const panel = new PalettePanel(
      container as any,
      editor,
      rendererMock as any,
      shapeRegistry
    );
    const panelEl = container.querySelector(".umlcanvas-palette-panel");
    const searchInput = container.querySelector(".umlcanvas-palette-search-input");

    // Open panel
    panel.open();
    expect(panel.isOpen).toBe(true);

    // Press Escape inside search input
    let stopped = false;
    let prevented = false;
    searchInput?.dispatchEvent({
      type: "keydown",
      key: "Escape",
      stopPropagation: () => {
        stopped = true;
      },
      preventDefault: () => {
        prevented = true;
      },
    });

    expect(panel.isOpen).toBe(false);
    expect(panelEl?.classList.contains("is-collapsed")).toBe(true);
    expect(stopped).toBe(true);
    expect(prevented).toBe(true);

    // Open again, press Escape on panel container
    panel.open();
    expect(panel.isOpen).toBe(true);

    panelEl?.dispatchEvent({
      type: "keydown",
      key: "Escape",
      stopPropagation: () => {},
      preventDefault: () => {},
    });

    expect(panel.isOpen).toBe(false);

    panel.destroy();
  });

  it("should prevent accidental opening of the drawer when a drag ends over toggleTabEl", () => {
    const panel = new PalettePanel(
      container as any,
      editor,
      rendererMock as any,
      shapeRegistry
    );
    const toggleTabEl = container.querySelector(".umlcanvas-palette-toggle-tab");

    expect(panel.isOpen).toBe(false);

    // Case 1: Drag started on canvas and mouse released over toggleTabEl
    // pointerdown did NOT happen on toggleTabEl, only a bare click
    toggleTabEl?.click();
    expect(panel.isOpen).toBe(false);

    // Case 2: Drag originated on toggleTabEl but moved > 8px (e.g. user dragged across screen)
    toggleTabEl?.dispatchEvent({
      type: "pointerdown",
      clientX: 500,
      clientY: 300,
      stopPropagation: () => {},
    });
    toggleTabEl?.dispatchEvent({
      type: "click",
      clientX: 520,
      clientY: 300,
      stopPropagation: () => {},
    });
    expect(panel.isOpen).toBe(false);

    // Case 3: Genuine clean click starting and ending on toggleTabEl
    toggleTabEl?.dispatchEvent({
      type: "pointerdown",
      clientX: 500,
      clientY: 300,
      stopPropagation: () => {},
    });
    toggleTabEl?.dispatchEvent({
      type: "click",
      clientX: 502,
      clientY: 301,
      stopPropagation: () => {},
    });
    expect(panel.isOpen).toBe(true);

    panel.destroy();
  });

  it("should close in exactly ONE click from top toolbar button when open", () => {
    let panel: PalettePanel;
    let toolbar: Toolbar;

    panel = new PalettePanel(
      container as any,
      editor,
      rendererMock as any,
      shapeRegistry,
      (isOpen) => {
        toolbar?.updatePaletteButtonState(isOpen);
      }
    );

    toolbar = new Toolbar(
      container as any,
      editor,
      rendererMock as any,
      () => {},
      () => {
        panel.toggle();
      }
    );

    const buttons = container.querySelectorAll("button");
    const shapesBtn = buttons.find(
      (b) =>
        b.title.includes("Toggle Shape Library") ||
        (b.title.includes("Shape Library") && !b.classList.contains("umlcanvas-palette-close-btn"))
    );
    expect(shapesBtn).toBeDefined();

    // Initially closed
    expect(panel.isOpen).toBe(false);
    expect(shapesBtn?.classList.contains("is-active")).toBe(false);

    // Click 1: Opens the shapes panel
    shapesBtn?.click();
    expect(panel.isOpen).toBe(true);
    expect(shapesBtn?.classList.contains("is-active")).toBe(true);
    expect(shapesBtn?.getAttribute("aria-pressed")).toBe("true");

    // Click 2: Closes the shapes panel in a single click (NOT requiring two clicks!)
    shapesBtn?.click();
    expect(panel.isOpen).toBe(false);
    expect(shapesBtn?.classList.contains("is-active")).toBe(false);
    expect(shapesBtn?.getAttribute("aria-pressed")).toBe("false");

    // Now open via tab or panel.open()
    panel.open();
    expect(panel.isOpen).toBe(true);
    expect(shapesBtn?.classList.contains("is-active")).toBe(true);

    // Clicking top toolbar button closes it immediately in ONE click
    shapesBtn?.click();
    expect(panel.isOpen).toBe(false);
    expect(shapesBtn?.classList.contains("is-active")).toBe(false);

    panel.destroy();
    toolbar.destroy();
  });

  it("should ensure close button has proper attributes, classes, and fallback icon", () => {
    const panel = new PalettePanel(
      container as any,
      editor,
      rendererMock as any,
      shapeRegistry
    );
    const closeBtn = container.querySelector(".umlcanvas-palette-close-btn");

    expect(closeBtn).not.toBeNull();
    expect(closeBtn?.getAttribute("type")).toBe("button");
    expect(closeBtn?.getAttribute("aria-label")?.toLowerCase()).toBe("close shape library");
    expect(closeBtn?.title.toLowerCase()).toContain("close shape library");
    expect(closeBtn?.classList.contains("clickable-icon")).toBe(true);

    // In test environment without native Obsidian setIcon, fallback glyph is rendered
    expect(closeBtn?.textContent).toContain("✕");

    panel.destroy();
  });
});
