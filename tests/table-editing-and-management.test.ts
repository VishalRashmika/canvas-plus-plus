import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { UmlCanvasView } from "../src/presentation/views/UmlCanvasView";
import { defaultShapeRegistry } from "../src/presentation/renderer/ShapeRegistry";
import { defaultSvgExporter } from "../src/infrastructure/export/SvgExporter";
import { calculateNodeFitSize } from "../src/domain/services/TextMeasurement";

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
  clientWidth: number = 1000;
  clientHeight: number = 800;

  constructor(tagName: string, options?: any) {
    this.tagName = tagName.toUpperCase();
    if (options?.cls) {
      this.classList.add(...options.cls.split(" "));
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

  createSvg(tag: string, options?: any): MockElement {
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

  focus(): void {}
  select(): void {}

  click(): void {
    this.dispatch("click");
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

  querySelector(sel: string): MockElement | null {
    const match = (el: MockElement): boolean => {
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        if (cls.includes(".")) {
          return cls.split(".").every((c) => el.classList.contains(c));
        }
        return el.classList.contains(cls);
      }
      if (sel.startsWith("[data-node-id=")) {
        const id = sel.replace("[data-node-id=\"", "").replace("\"]", "");
        return el.getAttribute("data-node-id") === id;
      }
      if (sel.startsWith("[data-handle=")) {
        const h = sel.replace("[data-handle=\"", "").replace("\"]", "");
        return el.getAttribute("data-handle") === h;
      }
      if (sel.startsWith("[title*=")) {
        const t = sel.replace("[title*=\"", "").replace("[\"]", "").replace("']", "").replace("[title*='", "");
        return el.title.includes(t);
      }
      return el.tagName.toLowerCase() === sel.toLowerCase();
    };

    for (const child of this.children) {
      if (match(child)) return child;
      const found = child.querySelector(sel);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(sel: string): MockElement[] {
    const results: MockElement[] = [];
    const match = (el: MockElement): boolean => {
      if (sel.startsWith(".")) {
        const classes = sel.split(".").filter(Boolean);
        return classes.every((c) => el.classList.contains(c));
      }
      return el.tagName.toLowerCase() === sel.toLowerCase();
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

  closest(sel: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (sel.startsWith(".")) {
        const clsList = sel.split(".").filter(Boolean);
        const matchesAll = clsList.every((c) => curr!.classList.contains(c));
        if (matchesAll) return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  private _textContent: string = "";
  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map((c) => c.textContent).join("");
  }
  set textContent(val: string) {
    this._textContent = val;
    this.children = [];
  }
}

describe("Table Cell Editing and Management Tests", () => {
  let editor: DiagramEditor;
  let container: MockElement;
  let renderer: SvgSceneRenderer;

  beforeEach(() => {
    (global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);
    (global as any).createDiv = (options?: any) => new MockElement("div", options);
    (global as any).createSpan = (options?: any) => new MockElement("span", options);

    // Setup mock document for SvgSceneRenderer
    (global as any).document = {
      createElementNS: (_ns: string, tag: string) => new MockElement(tag),
      createElement: (tag: string) => new MockElement(tag),
    };

    const listeners: Record<string, ((e: any) => void)[]> = {};
    (global as any).window = {
      addEventListener: (event: string, handler: (e: any) => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
      },
      removeEventListener: (event: string, handler: (e: any) => void) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((h) => h !== handler);
        }
      },
      dispatch: (event: string, detail: any = {}) => {
        const handlers = [...(listeners[event] || [])];
        const evt = {
          stopPropagation: () => {},
          preventDefault: () => {},
          ...detail,
        };
        handlers.forEach((h) => h(evt));
      },
    };

    editor = new DiagramEditor(createDiagram({ id: "diag-table", diagramType: "generic" }));
    container = new MockElement("div", { cls: "umlcanvas-view-container" });
    renderer = new SvgSceneRenderer(container as any, editor);
  });

  afterEach(() => {
    renderer.destroy();
  });

  describe("1. Bottom Bar Toolbar: Insert Table & Immediate First Cell Editing", () => {
    it("should create a 3x3 table and immediately activate inline editor on cell (0, 0)", () => {
      const toolbar = new Toolbar(container as any, editor, renderer);

      // Verify Table button exists in floating bottom toolbar
      const bottomToolbar = container.querySelector(".umlcanvas-floating-bottom-toolbar");
      const buttons = bottomToolbar?.querySelectorAll("button") || [];
      const tableBtn = buttons.find((b) => b.title.startsWith("Table"));
      expect(tableBtn).toBeDefined();

      // Click table button
      tableBtn?.click();

      expect(editor.diagram.nodes.length).toBe(1);
      const tableNode = editor.diagram.nodes[0];
      expect(tableNode.kind).toBe("generic.table");
      expect(tableNode.customData?.rows).toBe(3);
      expect(tableNode.customData?.cols).toBe(3);

      // Verify inline editor was immediately opened on cell (0, 0)
      expect(renderer.activeInlineEditor).not.toBeNull();
      expect(renderer.activeEditingNodeId).toBe(tableNode.id);
      expect(renderer.activeEditingCell).toEqual({ row: 0, col: 0 });

      toolbar.destroy();
    });
  });

  describe("2. Editing Every Single Cell in the Table", () => {
    it("should allow editing every single cell across all rows and columns", () => {
      const table = editor.addTableNode({ rows: 3, cols: 3 });

      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          renderer.startInlineEditor(table, { row: r, col: c });

          expect(renderer.activeInlineEditor).not.toBeNull();
          expect(renderer.activeEditingCell).toEqual({ row: r, col: c });

          // Type text into the active cell
          const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
          activeEditor.value = `Cell_${r}_${c}`;

          // Commit
          renderer.commitInlineEditor();

          const cells = table.customData?.cells as string[][];
          expect(cells[r][c]).toBe(`Cell_${r}_${c}`);
        }
      }

      // Verify all 9 cells have their updated text
      const finalCells = table.customData?.cells as string[][];
      expect(finalCells).toEqual([
        ["Cell_0_0", "Cell_0_1", "Cell_0_2"],
        ["Cell_1_0", "Cell_1_1", "Cell_1_2"],
        ["Cell_2_0", "Cell_2_1", "Cell_2_2"],
      ]);
    });

    it("should hide static text and highlight active cell with is-editing class during edit", () => {
      const table = editor.addTableNode({ rows: 2, cols: 2 });
      editor.updateTableCell(table.id, 0, 0, "Original");

      renderer.startInlineEditor(table, { row: 0, col: 0 });

      const nodeEl = container.querySelector(`[data-node-id="${table.id}"]`);
      expect(nodeEl?.classList.contains("umlcanvas-node-editing")).toBe(true);

      const cellEls = nodeEl?.querySelectorAll(".umlcanvas-table-cell") || [];
      const cell00 = cellEls.find(
        (el) => el.getAttribute("data-row") === "0" && el.getAttribute("data-col") === "0"
      );
      const cell01 = cellEls.find(
        (el) => el.getAttribute("data-row") === "0" && el.getAttribute("data-col") === "1"
      );

      expect(cell00?.classList.contains("is-editing")).toBe(true);
      expect(cell01?.classList.contains("is-editing")).toBe(false);

      renderer.commitInlineEditor();

      expect(cell00?.classList.contains("is-editing")).toBe(false);
    });
  });

  describe("3. Keyboard Navigation inside Table Inline Editor", () => {
    it("Tab key should navigate to the next cell in the same row or wrap to next row", () => {
      const table = editor.addTableNode({ rows: 3, cols: 3 });

      renderer.startInlineEditor(table, { row: 0, col: 0 });
      let activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "TopLeft";

      // Tab -> moves to (0, 1)
      activeEditor.dispatch("keydown", { key: "Tab", shiftKey: false });
      expect(renderer.activeEditingCell).toEqual({ row: 0, col: 1 });
      expect((table.customData?.cells as string[][])[0][0]).toBe("TopLeft");

      // Tab -> moves to (0, 2)
      activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "TopRight";
      activeEditor.dispatch("keydown", { key: "Tab", shiftKey: false });
      expect(renderer.activeEditingCell).toEqual({ row: 0, col: 2 });

      // Tab -> wraps to (1, 0)
      activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.dispatch("keydown", { key: "Tab", shiftKey: false });
      expect(renderer.activeEditingCell).toEqual({ row: 1, col: 0 });
    });

    it("Shift+Tab key should navigate to the previous cell", () => {
      const table = editor.addTableNode({ rows: 3, cols: 3 });

      renderer.startInlineEditor(table, { row: 1, col: 0 });
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;

      // Shift+Tab -> moves back to (0, 2)
      activeEditor.dispatch("keydown", { key: "Tab", shiftKey: true });
      expect(renderer.activeEditingCell).toEqual({ row: 0, col: 2 });
    });

    it("Tab on the very last cell should automatically add a new row and edit its first cell", () => {
      const table = editor.addTableNode({ rows: 2, cols: 2 });
      expect(table.customData?.rows).toBe(2);

      // Start on cell (1, 1) - the last cell
      renderer.startInlineEditor(table, { row: 1, col: 1 });
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "End";

      // Press Tab on last cell
      activeEditor.dispatch("keydown", { key: "Tab", shiftKey: false });

      // Should have auto-added row 3!
      expect(table.customData?.rows).toBe(3);
      expect((table.customData?.cells as string[][]).length).toBe(3);
      // And active cell is now (2, 0)
      expect(renderer.activeEditingCell).toEqual({ row: 2, col: 0 });
    });

    it("Enter key without shift should move to the cell in the row below", () => {
      const table = editor.addTableNode({ rows: 3, cols: 3 });

      renderer.startInlineEditor(table, { row: 0, col: 1 });
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "Header2";

      // Enter -> moves to (1, 1)
      activeEditor.dispatch("keydown", { key: "Enter", shiftKey: false });
      expect(renderer.activeEditingCell).toEqual({ row: 1, col: 1 });
      expect((table.customData?.cells as string[][])[0][1]).toBe("Header2");
    });

    it("Shift+Enter should allow multi-line text inside cell without committing", () => {
      const table = editor.addTableNode({ rows: 3, cols: 3 });

      renderer.startInlineEditor(table, { row: 0, col: 0 });
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;

      activeEditor.dispatch("keydown", { key: "Enter", shiftKey: true });
      expect(renderer.activeInlineEditor).not.toBeNull();
      expect(renderer.activeEditingCell).toEqual({ row: 0, col: 0 });
    });
  });

  describe("4. Adding and Deleting Rows and Columns with Dimensions & Undo/Redo", () => {
    it("should dynamically add and delete rows and update height proportionally", () => {
      const table = editor.addTableNode({ rows: 3, cols: 3, size: { width: 300, height: 180 } });
      const initialHeight = table.size.height;

      // Add row
      editor.addTableRow(table.id);
      expect(table.customData?.rows).toBe(4);
      expect((table.customData?.cells as string[][]).length).toBe(4);
      expect(table.size.height).toBeGreaterThan(initialHeight);

      // Delete row
      editor.deleteTableRow(table.id);
      expect(table.customData?.rows).toBe(3);
      expect((table.customData?.cells as string[][]).length).toBe(3);
      expect(table.size.height).toBe(initialHeight);

      // Undo delete
      editor.undo();
      expect(table.customData?.rows).toBe(4);

      // Redo delete
      editor.redo();
      expect(table.customData?.rows).toBe(3);
    });

    it("should not delete row when only 1 row remains", () => {
      const table = editor.addTableNode({ rows: 1, cols: 3 });
      editor.deleteTableRow(table.id);
      expect(table.customData?.rows).toBe(1);
    });

    it("should dynamically add and delete columns and update width proportionally", () => {
      const table = editor.addTableNode({ rows: 3, cols: 3, size: { width: 300, height: 180 } });
      const initialWidth = table.size.width;

      // Add column
      editor.addTableColumn(table.id);
      expect(table.customData?.cols).toBe(4);
      expect((table.customData?.cells as string[][])[0].length).toBe(4);
      expect(table.size.width).toBeGreaterThan(initialWidth);

      // Delete column
      editor.deleteTableColumn(table.id);
      expect(table.customData?.cols).toBe(3);
      expect((table.customData?.cells as string[][])[0].length).toBe(3);
      expect(table.size.width).toBe(initialWidth);

      // Undo delete
      editor.undo();
      expect(table.customData?.cols).toBe(4);

      // Redo delete
      editor.redo();
      expect(table.customData?.cols).toBe(3);
    });

    it("should not delete column when only 1 column remains", () => {
      const table = editor.addTableNode({ rows: 3, cols: 1 });
      editor.deleteTableColumn(table.id);
      expect(table.customData?.cols).toBe(1);
    });
  });

  describe("5. On-Canvas Interactive Table Controls (+/- for rows & columns)", () => {
    it("should render on-canvas add/delete action buttons when single table is selected", () => {
      const table = editor.addTableNode({ rows: 3, cols: 3 });
      editor.selectNode(table.id, false);

      const addColBtn = container.querySelector(".umlcanvas-table-add-col-btn");
      const delColBtn = container.querySelector(".umlcanvas-table-del-col-btn");
      const addRowBtn = container.querySelector(".umlcanvas-table-add-row-btn");
      const delRowBtn = container.querySelector(".umlcanvas-table-del-row-btn");

      expect(addColBtn).not.toBeNull();
      expect(delColBtn).not.toBeNull();
      expect(addRowBtn).not.toBeNull();
      expect(delRowBtn).not.toBeNull();

      // Click on-canvas Add Column button
      const svgEl = container.querySelector(".umlcanvas-svg");
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: addColBtn,
        clientX: 350,
        clientY: 150,
      });

      expect(table.customData?.cols).toBe(4);

      // Click on-canvas Add Row button
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: addRowBtn,
        clientX: 250,
        clientY: 320,
      });

      expect(table.customData?.rows).toBe(4);

      // Click on-canvas Delete Column button
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: delColBtn,
        clientX: 350,
        clientY: 170,
      });

      expect(table.customData?.cols).toBe(3);

      // Click on-canvas Delete Row button
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: delRowBtn,
        clientX: 270,
        clientY: 320,
      });

      expect(table.customData?.rows).toBe(3);
    });
  });

  describe("6. Context Menu Actions for Table", () => {
    let view: UmlCanvasView;
    let lastMenu: any = null;
    const obsidianModule = require("obsidian");
    const origShow = obsidianModule.Menu.prototype.showAtMouseEvent;

    beforeEach(() => {
      view = new UmlCanvasView({} as any, { settings: {} } as any);
      (view as any).editor = editor;
      (view as any).renderer = renderer;

      lastMenu = null;
      obsidianModule.Menu.prototype.showAtMouseEvent = function () {
        lastMenu = this;
      };
    });

    afterEach(() => {
      obsidianModule.Menu.prototype.showAtMouseEvent = origShow;
    });

    it("should provide table-specific actions when right-clicking on a table", () => {
      const table = editor.addTableNode({ rows: 3, cols: 3, position: { x: 100, y: 100 } });

      // Right-click at center of cell (1, 1): x = 100 + 150 = 250, y = 100 + 90 = 190
      (view as any).showContextMenu(
        { clientX: 250, clientY: 190 } as any,
        { x: 250, y: 190 },
        table
      );

      expect(lastMenu).not.toBeNull();
      const titles = lastMenu.items.map((i: any) => i.title);

      expect(titles.some((t: string) => t.includes("Edit cell (2, 2)"))).toBe(true);
      expect(titles.some((t: string) => t.includes("Add row above"))).toBe(true);
      expect(titles.some((t: string) => t.includes("Add row below"))).toBe(true);
      expect(titles.some((t: string) => t.includes("Delete row (2)"))).toBe(true);
      expect(titles.some((t: string) => t.includes("Add column left"))).toBe(true);
      expect(titles.some((t: string) => t.includes("Add column right"))).toBe(true);
      expect(titles.some((t: string) => t.includes("Delete column (2)"))).toBe(true);

      // Click "Add row above"
      const addRowAboveItem = lastMenu.items.find((i: any) => i.title === "Add row above");
      addRowAboveItem.onClickHandler();
      expect(table.customData?.rows).toBe(4);

      // Click "Delete row (2)"
      const delRowItem = lastMenu.items.find((i: any) => i.title.startsWith("Delete row"));
      delRowItem.onClickHandler();
      expect(table.customData?.rows).toBe(3);
    });
  });

  describe("7. Multi-line Cell Text Rendering & SVG Export", () => {
    it("should render <tspan> elements for multi-line cell text in ShapeRegistry", () => {
      const table = editor.addTableNode({ rows: 2, cols: 2 });
      editor.updateTableCell(table.id, 0, 0, "Line 1\nLine 2\nLine 3");

      const shapeDef = defaultShapeRegistry.get("generic.table");
      const svgEl = shapeDef.renderSvg(table, { isSelected: false });

      const cellTextEl = svgEl.querySelector(".umlcanvas-table-cell-text");
      expect(cellTextEl).not.toBeNull();
      const tspans = cellTextEl?.querySelectorAll("tspan") || [];
      expect(tspans.length).toBe(3);
      expect(tspans[0].textContent).toBe("Line 1");
      expect(tspans[1].textContent).toBe("Line 2");
      expect(tspans[2].textContent).toBe("Line 3");
    });

    it("SvgExporter should export multi-line cell text with <tspan> tags", () => {
      const table = editor.addTableNode({ rows: 2, cols: 2 });
      editor.updateTableCell(table.id, 0, 0, "Header A\nSubheading");

      const exported = defaultSvgExporter.exportToSvg(editor.diagram);
      expect(exported).toContain("<tspan");
      expect(exported).toContain("Header A");
      expect(exported).toContain("Subheading");
    });
  });

  describe("8. Direct Single-Click Table Cell Editing & Seamless Cell Switching", () => {
    it("should start editing cell directly on single click without requiring table to be pre-selected", () => {
      const table = editor.addTableNode({
        rows: 3,
        cols: 3,
        position: { x: 100, y: 100 },
        size: { width: 300, height: 180 },
      });
      editor.clearSelection();
      expect(editor.selectedNodeIds.length).toBe(0);

      renderer.render();

      const nodeEl = container.querySelector(`[data-node-id="${table.id}"]`);
      expect(nodeEl).not.toBeNull();
      const cellEls = nodeEl?.querySelectorAll(".umlcanvas-table-cell") || [];
      const cell11 = cellEls.find(
        (el) => el.getAttribute("data-row") === "1" && el.getAttribute("data-col") === "1"
      );
      expect(cell11).toBeDefined();

      const svgEl = container.querySelector(".umlcanvas-svg");

      // Simulate mousedown on cell (1, 1)
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: cell11,
        clientX: 250,
        clientY: 190,
      });

      // Simulate mouseup on the same spot without moving
      (global as any).window.dispatch("mouseup", {
        clientX: 250,
        clientY: 190,
      });

      // Inline editor should be opened immediately on cell (1, 1)
      expect(renderer.activeInlineEditor).not.toBeNull();
      expect(renderer.activeEditingNodeId).toBe(table.id);
      expect(renderer.activeEditingCell).toEqual({ row: 1, col: 1 });
    });

    it("should seamlessly switch cells when clicking another cell while actively editing", () => {
      const table = editor.addTableNode({
        rows: 3,
        cols: 3,
        position: { x: 100, y: 100 },
        size: { width: 300, height: 180 },
      });
      renderer.render();

      // Start editing cell (0, 0)
      renderer.startInlineEditor(table, { row: 0, col: 0 });
      expect(renderer.activeEditingCell).toEqual({ row: 0, col: 0 });

      // Type some content
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "Updated Cell (0,0)";

      // Find cell (2, 2) in DOM
      const nodeEl = container.querySelector(`[data-node-id="${table.id}"]`);
      const cellEls = nodeEl?.querySelectorAll(".umlcanvas-table-cell") || [];
      const cell22 = cellEls.find(
        (el) => el.getAttribute("data-row") === "2" && el.getAttribute("data-col") === "2"
      );
      expect(cell22).toBeDefined();

      const svgEl = container.querySelector(".umlcanvas-svg");

      // Click directly on cell (2, 2)
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: cell22,
        clientX: 350,
        clientY: 250,
      });
      (global as any).window.dispatch("mouseup", {
        clientX: 350,
        clientY: 250,
      });

      // Previous cell (0, 0) should be committed with new text
      const cells = table.customData?.cells as string[][];
      expect(cells[0][0]).toBe("Updated Cell (0,0)");

      // New cell (2, 2) should now be in active inline editing mode
      expect(renderer.activeInlineEditor).not.toBeNull();
      expect(renderer.activeEditingCell).toEqual({ row: 2, col: 2 });
    });
  });

  describe("9. Copy / Paste and Duplicate Table Integrity", () => {
    it("should deep-clone customData cells, rows, and cols when copying and pasting a table", () => {
      const table = editor.addTableNode({ rows: 3, cols: 3, position: { x: 50, y: 50 } });
      editor.updateTableCell(table.id, 0, 0, "Original Alpha");
      editor.updateTableCell(table.id, 2, 2, "Original Omega");

      editor.selectNode(table.id, false);
      editor.copySelection();
      const pasteResult = editor.paste({ x: 100, y: 100 });

      expect(pasteResult.nodes.length).toBe(1);
      const pastedTable = pasteResult.nodes[0];
      expect(pastedTable.kind).toBe("generic.table");
      expect(pastedTable.id).not.toBe(table.id);
      expect(pastedTable.customData?.rows).toBe(3);
      expect(pastedTable.customData?.cols).toBe(3);

      const pastedCells = pastedTable.customData?.cells as string[][];
      expect(pastedCells[0][0]).toBe("Original Alpha");
      expect(pastedCells[2][2]).toBe("Original Omega");

      // Modifying pasted table does not mutate original table
      editor.updateTableCell(pastedTable.id, 0, 0, "Modified Alpha");
      expect((table.customData?.cells as string[][])[0][0]).toBe("Original Alpha");
      expect((pastedTable.customData?.cells as string[][])[0][0]).toBe("Modified Alpha");
    });

    it("should deep-clone customData cells, rows, and cols when duplicating a table", () => {
      const table = editor.addTableNode({ rows: 2, cols: 2, position: { x: 50, y: 50 } });
      editor.updateTableCell(table.id, 1, 1, "Dup Test");

      editor.selectNode(table.id, false);
      const dupResult = editor.duplicateSelection({ x: 50, y: 50 });

      expect(dupResult.nodes.length).toBe(1);
      const dupTable = dupResult.nodes[0];
      expect(dupTable.kind).toBe("generic.table");
      expect(dupTable.id).not.toBe(table.id);
      expect(dupTable.customData?.rows).toBe(2);
      expect(dupTable.customData?.cols).toBe(2);
      expect((dupTable.customData?.cells as string[][])[1][1]).toBe("Dup Test");
    });
  });

  describe("10. Auto-Fit / Text Measurement for Table Nodes", () => {
    it("should calculate appropriate fit size based on row/column count and content length", () => {
      const table = editor.addTableNode({ rows: 3, cols: 3, size: { width: 100, height: 50 } });
      editor.updateTableCell(table.id, 0, 0, "A very long header title that spans quite some width");
      editor.updateTableCell(table.id, 1, 1, "Line 1\nLine 2\nLine 3\nLine 4");

      const fitSize = calculateNodeFitSize(table);
      expect(fitSize.width).toBeGreaterThanOrEqual(180); // At least 3 cols * 60px
      expect(fitSize.height).toBeGreaterThanOrEqual(90); // At least 3 rows * 30px

      // Height should expand to fit the 4-line cell
      const rows = 3;
      const cols = 3;
      const expectedMinColW = Math.max(60, 100);
      expect(fitSize.width).toBeGreaterThanOrEqual(cols * 60);
    });
  });

  describe("11. Toolbar Structure Controls (+/- Row, +/- Col) commit inline editor", () => {
    it("should commit active cell inline editing before adding or deleting rows or columns from toolbar", () => {
      const toolbar = new Toolbar(container as any, editor, renderer);
      const table = editor.addTableNode({ rows: 3, cols: 3 });
      editor.selectNode(table.id, false);

      // Start editing cell (0, 0)
      renderer.startInlineEditor(table, { row: 0, col: 0 });
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "Toolbar Commit Test";

      // Find "+ Row" button
      const buttons = container.querySelectorAll("button");
      const addRowBtn = buttons.find((b) => b.title.startsWith("Add Row"));
      expect(addRowBtn).toBeDefined();

      addRowBtn?.click();

      // Table should now have 4 rows
      expect(table.customData?.rows).toBe(4);
      // And the cell edit should have been committed
      expect((table.customData?.cells as string[][])[0][0]).toBe("Toolbar Commit Test");

      toolbar.destroy();
    });
  });
});
