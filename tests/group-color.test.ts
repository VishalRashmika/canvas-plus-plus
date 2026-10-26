import * as fs from "fs";
import * as path from "path";
import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { createGroup } from "../src/domain/entities/Group";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { SvgExporter } from "../src/infrastructure/export/SvgExporter";
import { JsonCanvasSerializer } from "../src/infrastructure/persistence/JsonCanvasSerializer";
import { JsonCanvasExporter } from "../src/infrastructure/export/JsonCanvasExporter";
import { CANVAS_COLOR_PRESETS, resolveCanvasColorHex } from "../src/domain/value-objects/CanvasColor";

// MockElement for Jest test environment
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
    if (val === "") {
      this.children = [];
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

  dispatchEvent(event: any): boolean {
    const type = event.type || event;
    const handlers = this.listeners[type] || [];
    for (const h of handlers) h(event);
    return true;
  }

  click(): void {
    this.dispatchEvent({ type: "click", stopPropagation: () => {} });
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
        const classNames = selector.split(".").filter(Boolean);
        matches = classNames.every((cls) => el.classList.contains(cls));
      } else if (selector.includes("[") && selector.includes("]")) {
        const tag = selector.split("[")[0].trim();
        const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)(?:\*?=['"]?([^'"\]]+)['"]?)?\]/);
        const tagMatches = !tag || el.tagName.toLowerCase() === tag.toLowerCase();
        if (tagMatches) {
          if (!attrMatch) {
            matches = true;
          } else {
            const attrName = attrMatch[1];
            const val = attrMatch[2];
            const actual = (attrName === "title" ? el.title : el.getAttribute(attrName)) || "";
            if (val === undefined) {
              matches = Boolean(actual);
            } else if (selector.includes("*=")) {
              matches = actual.includes(val);
            } else {
              matches = actual === val;
            }
          }
        }
      } else {
        const tag = selector.toUpperCase();
        matches = el.tagName === tag;
      }
      if (matches) results.push(el);
      for (const child of el.children) check(child);
    };

    for (const child of this.children) check(child);
    return results;
  }

  closest(selector: string): MockElement | null {
    const parts = selector.split(",").map((s) => s.trim());
    let cur: MockElement | null = this;
    while (cur) {
      for (const part of parts) {
        if (part.startsWith(".") && cur.classList.contains(part.slice(1))) return cur;
        if (part.startsWith("[") && part.endsWith("]")) {
          const attrName = part.slice(1, -1);
          if (cur.getAttribute(attrName) !== null) return cur;
        }
      }
      cur = cur.parentElement;
    }
    return null;
  }

  dispatch(event: string, data?: any): boolean {
    const handlers = this.listeners[event] || [];
    const ev = { type: event, target: this, preventDefault: () => {}, stopPropagation: () => {}, ...data };
    for (const h of handlers) h(ev);
    return true;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 };
  }
}

// Global DOM helpers for Toolbar and SvgSceneRenderer
(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

describe("Group Colors Feature (#16)", () => {
  let editor: DiagramEditor;

  beforeEach(() => {
    (global as any).document = {
      createElement: (tag: string) => new MockElement(tag),
      createElementNS: (_ns: string, tag: string) => new MockElement(tag),
    };
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
      dispatch: (event: string, data?: any) => {
        const handlers = windowListeners[event] || [];
        const ev = { type: event, preventDefault: () => {}, stopPropagation: () => {}, ...data };
        for (const h of handlers) h(ev);
        return true;
      },
    };

    const diagram = createDiagram({
      id: "diag-group-color-test",
      title: "Group Color Test",
      diagramType: "general",
    });
    editor = new DiagramEditor(diagram);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("1. Domain & DiagramEditor Group Color Management", () => {
    test("creates group with initial color via groupSelection", () => {
      const n1 = editor.addNode({ title: "Node 1", position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ title: "Node 2", position: { x: 200, y: 50 } });

      editor.selectNode(n1.id, false);
      editor.selectNode(n2.id, true);

      // Group selection with color "1" (Red)
      const group = editor.groupSelection("Backend Services", "1");
      expect(group).not.toBeNull();
      expect(group?.color).toBe("1");
      expect(editor.getGroupColor(group!.id)).toBe("1");
    });

    test("adds standalone group box via addGroup with custom color", () => {
      const group = editor.addGroup({
        name: "Infrastructure Box",
        color: "#1abc9c",
        position: { x: 100, y: 100 },
        size: { width: 320, height: 220 },
      });

      expect(group).toBeDefined();
      expect(group.color).toBe("#1abc9c");
      expect(editor.getGroupColor(group.id)).toBe("#1abc9c");
      expect(editor.isGroupSelected(group.id)).toBe(true);
    });

    test("changes group color via setGroupColor", () => {
      const group = editor.addGroup({ name: "Worker Group" });
      expect(group.color).toBeUndefined();

      // Change to Green (4)
      editor.setGroupColor(group.id, "4");
      expect(group.color).toBe("4");

      // Change to Purple (6)
      editor.setGroupColor(group.id, "6");
      expect(group.color).toBe("6");

      // Reset to default
      editor.setGroupColor(group.id, undefined);
      expect(group.color).toBeUndefined();
    });

    test("changes group color for selected group via setColorForSelection", () => {
      const group = editor.addGroup({ name: "Database Cluster" });
      editor.selectGroup(group.id, false);

      // Change to Cyan (5)
      editor.setColorForSelection("5");
      expect(group.color).toBe("5");

      // Change to Orange (2)
      editor.setColorForSelection("2");
      expect(group.color).toBe("2");

      // Change to custom hex
      editor.setColorForSelection("#e91e63");
      expect(group.color).toBe("#e91e63");

      // Clear color
      editor.setColorForSelection(undefined);
      expect(group.color).toBeUndefined();
    });

    test("supports undo and redo for group color changes", () => {
      const group = editor.addGroup({ name: "Gateway", color: "1" });
      editor.selectGroup(group.id, false);

      // Change to Blue/Cyan (5)
      editor.setColorForSelection("5");
      expect(group.color).toBe("5");

      // Undo -> restores "1"
      editor.undo();
      expect(group.color).toBe("1");

      // Redo -> reapplies "5"
      editor.redo();
      expect(group.color).toBe("5");
    });

    test("recoloring a single node inside a group does not recolor the parent group", () => {
      const n1 = editor.addNode({ title: "Service A", position: { x: 50, y: 50 } });
      const n2 = editor.addNode({ title: "Service B", position: { x: 200, y: 50 } });
      editor.selectNode(n1.id, false);
      editor.selectNode(n2.id, true);

      const group = editor.groupSelection("Microservices", "3")!; // Yellow group
      expect(group.color).toBe("3");

      // Select ONLY n1 and change n1's color to Green (4)
      editor.selectNode(n1.id, false);
      editor.setColorForSelection("4");

      expect(n1.style?.color).toBe("4");
      // Group color must remain "3" (Yellow), NOT change to "4"
      expect(group.color).toBe("3");
    });

    test("automatically inherits shared node color if all selected nodes share the same color", () => {
      const n1 = editor.addNode({ title: "Green 1", position: { x: 50, y: 50 }, style: { color: "4" } });
      const n2 = editor.addNode({ title: "Green 2", position: { x: 200, y: 50 }, style: { color: "4" } });
      editor.selectNode(n1.id, false);
      editor.selectNode(n2.id, true);

      // Group without explicit color parameter
      const group = editor.groupSelection("Green Services");
      expect(group).not.toBeNull();
      expect(group?.color).toBe("4");
      expect(editor.isGroupSelected(group!.id)).toBe(true);
      expect(editor.selectedNodeIds).toHaveLength(0);
    });

    test("leaves group color undefined if selected nodes have different colors", () => {
      const n1 = editor.addNode({ title: "Red 1", position: { x: 50, y: 50 }, style: { color: "1" } });
      const n2 = editor.addNode({ title: "Blue 2", position: { x: 200, y: 50 }, style: { color: "5" } });
      editor.selectNode(n1.id, false);
      editor.selectNode(n2.id, true);

      const group = editor.groupSelection("Mixed Services");
      expect(group).not.toBeNull();
      expect(group?.color).toBeUndefined();
    });
  });

  describe("2. SvgSceneRenderer Group Color Presentation", () => {
    test("renders group with data-color and preset class", () => {
      const group = editor.addGroup({ name: "API Group", color: "4" }); // Green
      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      const groupEl = container.querySelector(".umlcanvas-group");
      expect(groupEl).not.toBeNull();
      expect(groupEl.getAttribute("data-color")).toBe("4");
      expect(groupEl.classList.contains("is-color-4")).toBe(true);
      expect(groupEl.style["--canvas-color"]).toBe("var(--canvas-color-4, #69db7c)");
    });

    test("renders group with custom hex color and has-custom-color class", () => {
      const group = editor.addGroup({ name: "Custom Color Group", color: "#9b59b6" });
      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      const groupEl = container.querySelector(".umlcanvas-group");
      expect(groupEl).not.toBeNull();
      expect(groupEl.getAttribute("data-color")).toBe("#9b59b6");
      expect(groupEl.classList.contains("has-custom-color")).toBe(true);
      expect(groupEl.style["--canvas-color"]).toBe("#9b59b6");
    });

    test("removes data-color and color classes when reset to default", () => {
      const group = editor.addGroup({ name: "Default Group", color: "2" });
      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      let groupEl = container.querySelector(".umlcanvas-group");
      expect(groupEl.getAttribute("data-color")).toBe("2");

      editor.setGroupColor(group.id, undefined);
      renderer.render();

      groupEl = container.querySelector(".umlcanvas-group");
      expect(groupEl.getAttribute("data-color")).toBeNull();
      expect(groupEl.classList.contains("is-color-2")).toBe(false);
    });

    test("renders collapsed group card with data-color", () => {
      const group = editor.addGroup({ name: "Collapsed Group", color: "1" });
      group.collapsed = true;
      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      const groupEl = container.querySelector(".umlcanvas-group");
      expect(groupEl.getAttribute("data-color")).toBe("1");
      const card = container.querySelector(".umlcanvas-group-collapsed-card");
      expect(card).not.toBeNull();
    });

    test("renders interactive color indicator dot on group header", () => {
      const group = editor.addGroup({ name: "Dot Group", color: "2" });
      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      const dot = container.querySelector(".umlcanvas-group-color-dot");
      expect(dot).not.toBeNull();
      expect(dot.getAttribute("data-group-id")).toBe(group.id);
      expect(dot.getAttribute("fill")).toBe("var(--canvas-color-2, #ffa94d)");
    });

    test("renders interactive color indicator dot on collapsed group card", () => {
      const group = editor.addGroup({ name: "Collapsed Dot Group", color: "3" });
      group.collapsed = true;
      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      const dot = container.querySelector(".umlcanvas-group-color-dot");
      expect(dot).not.toBeNull();
      expect(dot.getAttribute("data-group-id")).toBe(group.id);
      expect(dot.getAttribute("fill")).toBe("var(--canvas-color-3, #ffd43b)");
    });

    test("clicking color dot cycles through color presets and default", () => {
      const group = editor.addGroup({ name: "Cycle Group" });
      expect(group.color).toBeUndefined();

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      const svgEl = container.querySelector(".umlcanvas-svg");
      const dot = container.querySelector(".umlcanvas-group-color-dot");
      expect(dot).not.toBeNull();

      // Click 1: cycles from undefined to "1" (Red)
      svgEl?.dispatch("mousedown", { target: dot, button: 0 });
      expect(group.color).toBe("1");
      expect(editor.isGroupSelected(group.id)).toBe(true);

      // Click 2: cycles to "2" (Orange)
      svgEl?.dispatch("mousedown", { target: dot, button: 0 });
      expect(group.color).toBe("2");

      // Click 3: cycles to "3" (Yellow)
      svgEl?.dispatch("mousedown", { target: dot, button: 0 });
      expect(group.color).toBe("3");

      // Cycle all the way back to undefined: 4 -> 5 -> 6 -> undefined
      svgEl?.dispatch("mousedown", { target: dot, button: 0 }); // 4
      svgEl?.dispatch("mousedown", { target: dot, button: 0 }); // 5
      svgEl?.dispatch("mousedown", { target: dot, button: 0 }); // 6
      expect(group.color).toBe("6");
      svgEl?.dispatch("mousedown", { target: dot, button: 0 }); // undefined
      expect(group.color).toBeUndefined();
    });

    test("keyboard shortcut 1-6 changes color when group is selected", () => {
      const group = editor.addGroup({ name: "Shortcut Group" });
      editor.selectGroup(group.id, false);

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      // Press key '4' (Green)
      (window as any).dispatch("keydown", { key: "4" });
      expect(group.color).toBe("4");

      // Press Alt+0 (Clear)
      (window as any).dispatch("keydown", { key: "0", altKey: true });
      expect(group.color).toBeUndefined();
    });

    test("arrow keys nudge selected group position", () => {
      const group = editor.addGroup({
        name: "Moving Group",
        position: { x: 100, y: 100 },
        size: { width: 300, height: 200 },
      });
      editor.selectGroup(group.id, false);

      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      // Press ArrowRight (+5px)
      (window as any).dispatch("keydown", { key: "ArrowRight" });
      expect(group.position?.x).toBe(105);
      expect(group.position?.y).toBe(100);

      // Press ArrowDown (+5px)
      (window as any).dispatch("keydown", { key: "ArrowDown" });
      expect(group.position?.x).toBe(105);
      expect(group.position?.y).toBe(105);

      // Press Shift+ArrowRight (+20px)
      (window as any).dispatch("keydown", { key: "ArrowRight", shiftKey: true });
      expect(group.position?.x).toBe(125);
      expect(group.position?.y).toBe(105);
    });

    test("pressing G key when nothing is selected creates a standalone group box", () => {
      const initialCount = editor.diagram.groups.length;
      const container = new MockElement("div") as any;
      const renderer = new SvgSceneRenderer(container, editor);
      renderer.render();

      (window as any).dispatch("keydown", { key: "g" });
      expect(editor.diagram.groups.length).toBe(initialCount + 1);
      const newGroup = editor.diagram.groups[editor.diagram.groups.length - 1];
      expect(newGroup.name).toBe("Group");
      expect(editor.isGroupSelected(newGroup.id)).toBe(true);
    });
  });

  describe("3. Toolbar Color Controls for Groups", () => {
    const makeRendererMock = () =>
      ({
        isFreehandEnabled: true,
        freehandMode: false,
        isAutoShapeDetection: false,
        currentTransform: { panX: 0, panY: 0, zoom: 1 },
      } as any);

    test("toolbar color indicator shows active group color", () => {
      const group = editor.addGroup({ name: "Cloud", color: "2" }); // Orange
      editor.selectGroup(group.id, false);

      const container = new MockElement("div") as any;
      const toolbar = new Toolbar(container, editor, makeRendererMock());

      const badge = container.querySelector(".umlcanvas-selection-badge");
      expect(badge?.textContent).toBe("1 Group");

      const indicator = container.querySelector(".umlcanvas-color-indicator");
      expect(indicator?.classList.contains("is-visible")).toBe(true);

      const colorBtn = container.querySelector("button[title*='Assign Color']");
      expect(colorBtn?.title).toContain("Orange");

      toolbar.destroy();
    });

    test("toolbar color popover highlights active group color swatch and allows changing color", () => {
      const group = editor.addGroup({ name: "Storage", color: "3" }); // Yellow
      editor.selectGroup(group.id, false);

      const container = new MockElement("div") as any;
      const toolbar = new Toolbar(container, editor, makeRendererMock());

      // Open color palette
      toolbar.toggleColorPalette();
      const popover = container.querySelector(".umlcanvas-color-palette-popover");
      expect(popover).not.toBeNull();

      // Swatch 3 should be marked active
      const swatch3 = popover?.querySelector(".is-preset-3");
      expect(swatch3?.classList.contains("is-active")).toBe(true);

      // Click swatch 5 (Cyan)
      const swatch5 = popover?.querySelector(".is-preset-5");
      expect(swatch5).not.toBeNull();
      swatch5?.click();

      expect(group.color).toBe("5");

      toolbar.destroy();
    });

    test("toolbar allows clearing color on group back to default", () => {
      const group = editor.addGroup({ name: "Core", color: "1" });
      editor.selectGroup(group.id, false);

      const container = new MockElement("div") as any;
      const toolbar = new Toolbar(container, editor, makeRendererMock());

      toolbar.toggleColorPalette();
      const popover = container.querySelector(".umlcanvas-color-palette-popover");
      const noneBtn = popover?.querySelector(".is-none");
      expect(noneBtn).not.toBeNull();
      noneBtn?.click();

      expect(group.color).toBeUndefined();

      toolbar.destroy();
    });

    test("toolbar has standalone group box button and addGroupBoxAtCenter works", () => {
      const container = new MockElement("div") as any;
      const toolbar = new Toolbar(container, editor, makeRendererMock());

      const groupBoxBtn = container.querySelector("button[title*='Group Box (G)']");
      expect(groupBoxBtn).not.toBeNull();

      const created = toolbar.addGroupBoxAtCenter("4", "Custom Center Group");
      expect(created).toBeDefined();
      expect(created.name).toBe("Custom Center Group");
      expect(created.color).toBe("4");
      expect(editor.isGroupSelected(created.id)).toBe(true);

      toolbar.destroy();
    });
  });

  describe("4. Theme and CSS Rule Verification", () => {
    const cssPath = path.resolve(__dirname, "../styles.css");
    const css = fs.readFileSync(cssPath, "utf-8");

    test("defines .umlcanvas-group[data-color] styles with stroke: var(--canvas-color)", () => {
      expect(css).toContain(".umlcanvas-group[data-color] .umlcanvas-group-box");
      expect(css).toContain(".umlcanvas-group[data-color] .umlcanvas-group-header-bg");
      expect(css).toContain(".umlcanvas-group[data-color] .umlcanvas-group-title");
      expect(css).toContain(".umlcanvas-group[data-color] .umlcanvas-group-collapsed-card");
      expect(css).toContain(".umlcanvas-group[data-color] .umlcanvas-group-resize-handle");
    });

    test("selected colored group does not revert to purple accent stroke", () => {
      // Must maintain --canvas-color stroke rather than var(--interactive-accent)
      expect(css).toMatch(/\.umlcanvas-group\[data-color\]\.is-selected\s+\.umlcanvas-group-box[\s\S]*?stroke:\s*var\(--canvas-color\)/);
      expect(css).toMatch(/\.umlcanvas-group\[data-color\]\.is-selected\s+\.umlcanvas-group-header-bg[\s\S]*?fill:\s*color-mix/);
    });

    test("defines light theme group color rules for high-contrast presentation", () => {
      expect(css).toContain(".umlcanvas-theme-light .umlcanvas-group[data-color] .umlcanvas-group-box");
      expect(css).toContain(".umlcanvas-theme-light .umlcanvas-group[data-color] .umlcanvas-group-header-bg");
      expect(css).toContain(".umlcanvas-theme-light .umlcanvas-group[data-color].is-selected .umlcanvas-group-box");
    });

    test("defines styles for .umlcanvas-group-color-dot and theme overrides", () => {
      expect(css).toContain(".umlcanvas-group-color-dot");
      expect(css).toContain(".umlcanvas-group[data-color] .umlcanvas-group-color-dot");
      expect(css).toContain(".umlcanvas-theme-light .umlcanvas-group[data-color] .umlcanvas-group-color-dot");
    });

    test("defines node data-color rules covering timing segments and package tabs", () => {
      expect(css).toContain(".umlcanvas-node[data-color] .umlcanvas-timing-segment-body");
      expect(css).toContain(".umlcanvas-node[data-color] .umlcanvas-package-tab");
    });
  });

  describe("5. Persistence and Export Roundtrip", () => {
    test("serializes and deserializes group color in JsonCanvasSerializer", () => {
      const serializer = new JsonCanvasSerializer();
      const group = editor.addGroup({ name: "Exported Group", color: "4" });
      const json = serializer.serialize(editor.diagram);
      const parsed = JSON.parse(json);

      const serializedGroup = parsed.groups.find((g: any) => g.id === group.id);
      expect(serializedGroup).toBeDefined();
      expect(serializedGroup.color).toBe("4");

      const deserialized = serializer.deserialize(json);
      const restoredGroup = deserialized.groups.find((g) => g.id === group.id);
      expect(restoredGroup).toBeDefined();
      expect(restoredGroup?.color).toBe("4");
    });

    test("exports group with color in JsonCanvasExporter", () => {
      const exporter = new JsonCanvasExporter();
      editor.addGroup({ name: "JC Group", color: "2" });
      const exportedJson = exporter.exportToJsonCanvas(editor.diagram);
      const exported = JSON.parse(exportedJson);

      const groupNode = exported.nodes.find((n: any) => n.label === "JC Group");
      expect(groupNode).toBeDefined();
      expect(groupNode?.color).toBe("2");
    });

    test("exports group in SvgExporter with resolved theme colors", () => {
      const exporter = new SvgExporter();
      editor.addGroup({ name: "SVG Colored Group", color: "1" });

      const lightSvg = exporter.exportToSvg(editor.diagram, { theme: "light" });
      expect(lightSvg).toContain('data-color="1"');
      expect(lightSvg).toContain(resolveCanvasColorHex("1", "light")); // #ff758f

      const darkSvg = exporter.exportToSvg(editor.diagram, { theme: "dark" });
      expect(darkSvg).toContain('data-color="1"');
      expect(darkSvg).toContain(resolveCanvasColorHex("1", "dark")); // #ff859b
    });
  });
});
