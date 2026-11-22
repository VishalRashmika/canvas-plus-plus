import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { defaultTableDetector, TableDetector } from "../src/domain/services/TableDetector";
import { Stroke } from "../src/domain/services/ShapeRecognizer";
import { defaultShapeRegistry } from "../src/presentation/renderer/ShapeRegistry";
import { defaultSvgExporter } from "../src/infrastructure/export/SvgExporter";

// Headless MockElement for testing renderer & DOM events
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
    contains: (c: string) => this.classList.classes.has(c),
  };
  attributes: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") this.classList.add(...value.split(" "));
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
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
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const check = (el: MockElement) => {
      let matches = false;
      if (selector.startsWith(".")) {
        const classes = selector.split(".").filter(Boolean);
        if (classes.every((c) => el.classList.contains(c))) matches = true;
      } else if (selector.includes(".")) {
        const [tag, ...cls] = selector.split(".");
        if (tag.toLowerCase() === el.tagName.toLowerCase() && cls.every((c) => el.classList.contains(c))) {
          matches = true;
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

if (!(global as any).document) {
  (global as any).document = {
    createElementNS: (_ns: string, tag: string) => new MockElement(tag),
    createElement: (tag: string) => new MockElement(tag),
  };
}

function makeBoxStroke(x: number, y: number, w: number, h: number, id = "box"): Stroke {
  const points = [
    { x, y, pressure: 0.5, time: 0 },
    { x: x + w * 0.5, y, pressure: 0.5, time: 10 },
    { x: x + w, y, pressure: 0.5, time: 20 },
    { x: x + w, y: y + h * 0.5, pressure: 0.5, time: 30 },
    { x: x + w, y: y + h, pressure: 0.5, time: 40 },
    { x: x + w * 0.5, y: y + h, pressure: 0.5, time: 50 },
    { x, y: y + h, pressure: 0.5, time: 60 },
    { x, y: y + h * 0.5, pressure: 0.5, time: 70 },
    { x, y, pressure: 0.5, time: 80 },
  ];
  return { id, points };
}

function makeHLineStroke(x1: number, x2: number, y: number, id = "hline"): Stroke {
  const points = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: x1 + (x2 - x1) * t,
      y: y + (Math.sin(t * Math.PI) * 1.5), // slight human jitter
      pressure: 0.5,
      time: i * 5,
    });
  }
  return { id, points };
}

function makeVLineStroke(x: number, y1: number, y2: number, id = "vline"): Stroke {
  const points = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: x + (Math.sin(t * Math.PI) * 1.5), // slight human jitter
      y: y1 + (y2 - y1) * t,
      pressure: 0.5,
      time: i * 5,
    });
  }
  return { id, points };
}

describe("Table Detection and Enhancement (F-Table)", () => {
  let detector: TableDetector;
  let editor: DiagramEditor;

  beforeEach(() => {
    detector = new TableDetector();
    const diagram = createDiagram({ id: "diag-table-test", diagramType: "general" });
    editor = new DiagramEditor(diagram);
  });

  describe("1. Pure Table Detection (TableDetector)", () => {
    it("should detect a 3x3 table drawn as an outer box + 2 horizontal dividers + 2 vertical dividers", () => {
      // 300x180 table at (100, 100)
      const outerBox = makeBoxStroke(100, 100, 300, 180, "outer");
      const hLine1 = makeHLineStroke(100, 400, 160, "h1"); // row divider 1
      const hLine2 = makeHLineStroke(100, 400, 220, "h2"); // row divider 2
      const vLine1 = makeVLineStroke(200, 100, 280, "v1"); // col divider 1
      const vLine2 = makeVLineStroke(300, 100, 280, "v2"); // col divider 2

      const result = detector.detect([outerBox, hLine1, hLine2, vLine1, vLine2]);

      expect(result.isTable).toBe(true);
      expect(result.rows).toBe(3);
      expect(result.cols).toBe(3);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.bounds.size.width).toBeCloseTo(300, -1);
      expect(result.bounds.size.height).toBeCloseTo(180, -1);
      expect(result.cells.length).toBe(3);
      expect(result.cells[0].length).toBe(3);
    });

    it("should detect a 3x3 table drawn with 4 perimeter lines + 2 horizontal + 2 vertical dividers", () => {
      const top = makeHLineStroke(100, 400, 100, "top");
      const bot = makeHLineStroke(100, 400, 280, "bot");
      const left = makeVLineStroke(100, 100, 280, "left");
      const right = makeVLineStroke(400, 100, 280, "right");
      const h1 = makeHLineStroke(100, 400, 160, "h1");
      const h2 = makeHLineStroke(100, 400, 220, "h2");
      const v1 = makeVLineStroke(200, 100, 280, "v1");
      const v2 = makeVLineStroke(300, 100, 280, "v2");

      const result = detector.detect([top, bot, left, right, h1, h2, v1, v2]);

      expect(result.isTable).toBe(true);
      expect(result.rows).toBe(3);
      expect(result.cols).toBe(3);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("should detect a 3x3 table from a grid of intersecting lines (4 horizontal + 4 vertical)", () => {
      const hLines = [
        makeHLineStroke(100, 400, 100, "h0"),
        makeHLineStroke(100, 400, 160, "h1"),
        makeHLineStroke(100, 400, 220, "h2"),
        makeHLineStroke(100, 400, 280, "h3"),
      ];
      const vLines = [
        makeVLineStroke(100, 100, 280, "v0"),
        makeVLineStroke(200, 100, 280, "v1"),
        makeVLineStroke(300, 100, 280, "v2"),
        makeVLineStroke(400, 100, 280, "v3"),
      ];

      const result = detector.detect([...hLines, ...vLines]);

      expect(result.isTable).toBe(true);
      expect(result.rows).toBe(3);
      expect(result.cols).toBe(3);
    });

    it("should detect a 3x3 table from crossing tic-tac-toe style lines", () => {
      // 2 horizontal and 2 vertical internal lines crossing
      const h1 = makeHLineStroke(80, 420, 160, "h1");
      const h2 = makeHLineStroke(80, 420, 220, "h2");
      const v1 = makeVLineStroke(190, 80, 300, "v1");
      const v2 = makeVLineStroke(310, 80, 300, "v2");

      const result = detector.detect([h1, h2, v1, v2]);

      expect(result.isTable).toBe(true);
      expect(result.rows).toBe(3);
      expect(result.cols).toBe(3);
    });

    it("should detect 2x2, 2x3, and 4x4 tables dynamically", () => {
      // 2x2
      const box2x2 = makeBoxStroke(50, 50, 200, 200, "box2x2");
      const h2x2 = makeHLineStroke(50, 250, 150, "h2x2");
      const v2x2 = makeVLineStroke(150, 50, 250, "v2x2");
      const res2x2 = detector.detect([box2x2, h2x2, v2x2]);
      expect(res2x2.isTable).toBe(true);
      expect(res2x2.rows).toBe(2);
      expect(res2x2.cols).toBe(2);

      // 2x3 (2 rows, 3 cols)
      const box2x3 = makeBoxStroke(50, 50, 300, 150, "box2x3");
      const h2x3 = makeHLineStroke(50, 350, 125, "h2x3");
      const v2x3_1 = makeVLineStroke(150, 50, 200, "v2x3_1");
      const v2x3_2 = makeVLineStroke(250, 50, 200, "v2x3_2");
      const res2x3 = detector.detect([box2x3, h2x3, v2x3_1, v2x3_2]);
      expect(res2x3.isTable).toBe(true);
      expect(res2x3.rows).toBe(2);
      expect(res2x3.cols).toBe(3);

      // 4x4 (4 rows, 4 cols)
      const box4x4 = makeBoxStroke(100, 100, 400, 400, "box4x4");
      const h4x4 = [
        makeHLineStroke(100, 500, 200, "h4x4_1"),
        makeHLineStroke(100, 500, 300, "h4x4_2"),
        makeHLineStroke(100, 500, 400, "h4x4_3"),
      ];
      const v4x4 = [
        makeVLineStroke(200, 100, 500, "v4x4_1"),
        makeVLineStroke(300, 100, 500, "v4x4_2"),
        makeVLineStroke(400, 100, 500, "v4x4_3"),
      ];
      const res4x4 = detector.detect([box4x4, ...h4x4, ...v4x4]);
      expect(res4x4.isTable).toBe(true);
      expect(res4x4.rows).toBe(4);
      expect(res4x4.cols).toBe(4);
    });

    it("should reject non-table strokes like single box, letter E, and letter H", () => {
      // Single rectangle
      const singleBox = makeBoxStroke(100, 100, 200, 150, "box");
      expect(detector.detect([singleBox]).isTable).toBe(false);

      // Letter E (1 vertical + 3 horizontal)
      const vE = makeVLineStroke(100, 100, 160, "vE");
      const hE1 = makeHLineStroke(100, 130, 100, "hE1");
      const hE2 = makeHLineStroke(100, 125, 130, "hE2");
      const hE3 = makeHLineStroke(100, 130, 160, "hE3");
      expect(detector.detect([vE, hE1, hE2, hE3]).isTable).toBe(false);

      // Letter H (2 vertical + 1 horizontal)
      const vH1 = makeVLineStroke(100, 100, 160, "vH1");
      const vH2 = makeVLineStroke(130, 100, 160, "vH2");
      const hH = makeHLineStroke(100, 130, 130, "hH");
      expect(detector.detect([vH1, vH2, hH]).isTable).toBe(false);
    });
  });

  describe("2. DiagramEditor enhanceSelection with Table Strokes", () => {
    it("enhanceSelection should convert 3x3 table strokes into a generic.table node instead of a single box", () => {
      // User creates a 3x3 table using freehand tool
      const outerBox = makeBoxStroke(100, 100, 300, 180, "s_box");
      const h1 = makeHLineStroke(100, 400, 160, "s_h1");
      const h2 = makeHLineStroke(100, 400, 220, "s_h2");
      const v1 = makeVLineStroke(200, 100, 280, "s_v1");
      const v2 = makeVLineStroke(300, 100, 280, "s_v2");

      const nodeBox = editor.keepAsFreehand(outerBox);
      const nodeH1 = editor.keepAsFreehand(h1);
      const nodeH2 = editor.keepAsFreehand(h2);
      const nodeV1 = editor.keepAsFreehand(v1);
      const nodeV2 = editor.keepAsFreehand(v2);

      // Select all 5 freehand strokes
      editor.selectNode(nodeBox.id, false);
      editor.selectNode(nodeH1.id, true);
      editor.selectNode(nodeH2.id, true);
      editor.selectNode(nodeV1.id, true);
      editor.selectNode(nodeV2.id, true);

      expect(editor.selectedNodeIds.length).toBe(5);

      // Enhance selection!
      const enhancedNode = editor.enhanceSelection() as any;

      expect(enhancedNode).not.toBeNull();
      expect(enhancedNode.kind).toBe("generic.table");
      expect(enhancedNode.customData?.rows).toBe(3);
      expect(enhancedNode.customData?.cols).toBe(3);
      expect(enhancedNode.customData?.cells).toBeDefined();
      expect(enhancedNode.customData?.cells.length).toBe(3);
      expect(enhancedNode.customData?.cells[0].length).toBe(3);

      // Original freehand nodes should be deleted
      expect(editor.diagram.nodes.length).toBe(1);
      expect(editor.diagram.nodes[0].id).toBe(enhancedNode.id);
      expect(editor.diagram.nodes[0].kind).toBe("generic.table");
      expect(editor.selectedNodeIds).toEqual([enhancedNode.id]);
    });

    it("should support undo and redo on table enhancement", () => {
      const outerBox = makeBoxStroke(100, 100, 300, 180, "u_box");
      const h1 = makeHLineStroke(100, 400, 160, "u_h1");
      const h2 = makeHLineStroke(100, 400, 220, "u_h2");
      const v1 = makeVLineStroke(200, 100, 280, "u_v1");
      const v2 = makeVLineStroke(300, 100, 280, "u_v2");

      const nodeBox = editor.keepAsFreehand(outerBox);
      const nodeH1 = editor.keepAsFreehand(h1);
      const nodeH2 = editor.keepAsFreehand(h2);
      const nodeV1 = editor.keepAsFreehand(v1);
      const nodeV2 = editor.keepAsFreehand(v2);

      editor.selectNode(nodeBox.id, false);
      editor.selectNode(nodeH1.id, true);
      editor.selectNode(nodeH2.id, true);
      editor.selectNode(nodeV1.id, true);
      editor.selectNode(nodeV2.id, true);

      const enhancedNode = editor.enhanceSelection() as any;
      expect(editor.diagram.nodes.length).toBe(1);
      expect(editor.diagram.nodes[0].kind).toBe("generic.table");

      // Undo -> restores the 5 original freehand strokes
      editor.undo();
      expect(editor.diagram.nodes.length).toBe(5);
      expect(editor.diagram.nodes.every((n) => n.kind === "generic.freehand")).toBe(true);

      // Redo -> restores the enhanced table node
      editor.redo();
      expect(editor.diagram.nodes.length).toBe(1);
      expect(editor.diagram.nodes[0].id).toBe(enhancedNode.id);
      expect(editor.diagram.nodes[0].kind).toBe("generic.table");
    });
  });

  describe("3. Table Cell & Structure Operations", () => {
    it("updateTableCell should update individual cell text with undo/redo", () => {
      const tableNode = editor.addTableNode({ rows: 3, cols: 3 });

      editor.updateTableCell(tableNode.id, 0, 0, "Header 1");
      editor.updateTableCell(tableNode.id, 0, 1, "Header 2");
      editor.updateTableCell(tableNode.id, 1, 0, "Data Row 1");

      const cells = tableNode.customData?.cells as string[][];
      expect(cells[0][0]).toBe("Header 1");
      expect(cells[0][1]).toBe("Header 2");
      expect(cells[1][0]).toBe("Data Row 1");
      expect(cells[2][2]).toBe("");

      // Undo
      editor.undo();
      expect((tableNode.customData?.cells as string[][])[1][0]).toBe("");

      // Redo
      editor.redo();
      expect((tableNode.customData?.cells as string[][])[1][0]).toBe("Data Row 1");
    });

    it("addTableRow and deleteTableRow should dynamically adjust rows", () => {
      const tableNode = editor.addTableNode({ rows: 3, cols: 3 });
      expect(tableNode.customData?.rows).toBe(3);

      editor.addTableRow(tableNode.id);
      expect(tableNode.customData?.rows).toBe(4);
      expect((tableNode.customData?.cells as string[][]).length).toBe(4);

      editor.deleteTableRow(tableNode.id, 3);
      expect(tableNode.customData?.rows).toBe(3);
      expect((tableNode.customData?.cells as string[][]).length).toBe(3);
    });

    it("addTableColumn and deleteTableColumn should dynamically adjust cols", () => {
      const tableNode = editor.addTableNode({ rows: 3, cols: 3 });
      expect(tableNode.customData?.cols).toBe(3);

      editor.addTableColumn(tableNode.id);
      expect(tableNode.customData?.cols).toBe(4);
      expect((tableNode.customData?.cells as string[][])[0].length).toBe(4);

      editor.deleteTableColumn(tableNode.id, 3);
      expect(tableNode.customData?.cols).toBe(3);
      expect((tableNode.customData?.cells as string[][])[0].length).toBe(3);
    });
  });

  describe("4. ShapeRegistry & SVG Rendering for generic.table", () => {
    it("ShapeRegistry should have generic.table registered and render outer rect + grid lines + cells", () => {
      const shapeDef = defaultShapeRegistry.get("generic.table");
      expect(shapeDef).toBeDefined();
      expect(shapeDef.kind).toBe("generic.table");

      const node = editor.addTableNode({ rows: 3, cols: 3 });
      editor.updateTableCell(node.id, 0, 0, "Col A");
      editor.updateTableCell(node.id, 1, 1, "Cell B2");

      const svgEl = shapeDef.renderSvg(node, {
        isSelected: false,
      });

      expect(svgEl.getAttribute("class")).toBe("umlcanvas-shape-table");

      // Outer rect
      const outerRect = svgEl.querySelector("rect.umlcanvas-node-body");
      expect(outerRect).not.toBeNull();
      expect(outerRect?.getAttribute("width")).toBe("300");
      expect(outerRect?.getAttribute("height")).toBe("180");

      // Divider lines: for 3x3 table, 2 horizontal lines + 2 vertical lines = 4 grid lines
      const gridLines = svgEl.querySelectorAll("line.umlcanvas-table-grid-line");
      expect(gridLines.length).toBe(4);

      // Cells: 3x3 = 9 cells
      const cells = svgEl.querySelectorAll(".umlcanvas-table-cell");
      expect(cells.length).toBe(9);

      // Cell text
      const textElements = svgEl.querySelectorAll(".umlcanvas-table-cell-text");
      expect(textElements.length).toBe(2);
      expect(textElements[0].textContent).toBe("Col A");
      expect(textElements[1].textContent).toBe("Cell B2");
    });

    it("SvgExporter should export generic.table to SVG with rect, lines, and text", () => {
      const node = editor.addTableNode({ rows: 3, cols: 3 });
      editor.updateTableCell(node.id, 0, 0, "Header A");
      editor.updateTableCell(node.id, 0, 1, "Header B");

      const svgOutput = defaultSvgExporter.exportToSvg(editor.diagram);
      expect(svgOutput).toContain("<rect");
      expect(svgOutput).toContain("<line");
      expect(svgOutput).toContain("Header A");
      expect(svgOutput).toContain("Header B");
    });
  });

  describe("5. Edge Cases & Robustness (Multiple Iterations)", () => {
    it("Iteration 2: should detect table when divider lines overshoot or undershoot outer box", () => {
      const outerBox = makeBoxStroke(100, 100, 300, 180, "box");
      // h1 overshoots by 15px on left and right
      const h1 = makeHLineStroke(85, 415, 160, "h1_overshoot");
      // h2 undershoots by 15px
      const h2 = makeHLineStroke(115, 385, 220, "h2_undershoot");
      // v1 overshoots top and undershoots bottom
      const v1 = makeVLineStroke(200, 90, 270, "v1_loose");
      // v2 undershoots top and overshoots bottom
      const v2 = makeVLineStroke(300, 110, 290, "v2_loose");

      const result = detector.detect([outerBox, h1, h2, v1, v2]);
      expect(result.isTable).toBe(true);
      expect(result.rows).toBe(3);
      expect(result.cols).toBe(3);
    });

    it("Iteration 3: should detect table when dividers are drawn in reverse directions", () => {
      const outerBox = makeBoxStroke(100, 100, 300, 180, "box");
      // Drawn right-to-left (400 -> 100)
      const h1Rev = makeHLineStroke(400, 100, 160, "h1_rev");
      const h2Rev = makeHLineStroke(400, 100, 220, "h2_rev");
      // Drawn bottom-to-top (280 -> 100)
      const v1Rev = makeVLineStroke(200, 280, 100, "v1_rev");
      const v2Rev = makeVLineStroke(300, 280, 100, "v2_rev");

      const result = detector.detect([outerBox, h1Rev, h2Rev, v1Rev, v2Rev]);
      expect(result.isTable).toBe(true);
      expect(result.rows).toBe(3);
      expect(result.cols).toBe(3);
    });

    it("Iteration 4: should merge split/overlapping strokes on the same divider", () => {
      const outerBox = makeBoxStroke(100, 100, 300, 180, "box");
      // h1 is drawn as 2 segments at y=160
      const h1a = makeHLineStroke(100, 250, 160, "h1a");
      const h1b = makeHLineStroke(240, 400, 162, "h1b");
      const h2 = makeHLineStroke(100, 400, 220, "h2");
      const v1 = makeVLineStroke(200, 100, 280, "v1");
      const v2 = makeVLineStroke(300, 100, 280, "v2");

      const result = detector.detect([outerBox, h1a, h1b, h2, v1, v2]);
      expect(result.isTable).toBe(true);
      expect(result.rows).toBe(3);
      expect(result.cols).toBe(3);
    });

    it("Iteration 5: should extract text written inside cells", () => {
      const outerBox = makeBoxStroke(100, 100, 300, 180, "box");
      const h1 = makeHLineStroke(100, 400, 160, "h1");
      const h2 = makeHLineStroke(100, 400, 220, "h2");
      const v1 = makeVLineStroke(200, 100, 280, "v1");
      const v2 = makeVLineStroke(300, 100, 280, "v2");

      // An "E" stroke in cell (0, 0) - bounds (100..200, 100..160)
      const eStrokes = [
        makeVLineStroke(120, 115, 145, "e_v"),
        makeHLineStroke(120, 140, 115, "e_h1"),
        makeHLineStroke(120, 135, 130, "e_h2"),
        makeHLineStroke(120, 140, 145, "e_h3"),
      ];

      const result = detector.detect([outerBox, h1, h2, v1, v2, ...eStrokes]);
      expect(result.isTable).toBe(true);
      expect(result.rows).toBe(3);
      expect(result.cols).toBe(3);
      expect(result.cells[0][0]).toBe("E");
    });

    it("Iteration 6: generic.table proportional scaling when resized", () => {
      const node = editor.addTableNode({ rows: 3, cols: 3, size: { width: 300, height: 180 } });
      const shapeDef = defaultShapeRegistry.get("generic.table");

      // Resize node to 600x360
      node.size = { width: 600, height: 360 };
      const svgEl = shapeDef.renderSvg(node, { isSelected: false });

      const outerRect = svgEl.querySelector("rect.umlcanvas-node-body");
      expect(outerRect?.getAttribute("width")).toBe("600");
      expect(outerRect?.getAttribute("height")).toBe("360");

      const gridLines = svgEl.querySelectorAll("line.umlcanvas-table-grid-line");
      expect(gridLines.length).toBe(4);
      // Row lines at y = 120, 240
      const rowLines = Array.from(gridLines).filter((l) => l.getAttribute("x1") === "0");
      expect(rowLines[0].getAttribute("y1")).toBe("120");
      expect(rowLines[1].getAttribute("y1")).toBe("240");
    });
  });
});
