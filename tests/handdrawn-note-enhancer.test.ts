import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { DiagramNode } from "../src/domain/entities/DiagramNode";
import { defaultShapeRegistry, getTableDataFromNode, TableCustomData } from "../src/presentation/renderer/ShapeRegistry";
import { defaultSvgExporter } from "../src/infrastructure/export/SvgExporter";
import { Stroke, StrokePoint } from "../src/domain/services/ShapeRecognizer";
import { defaultHandwritingRecognizer } from "../src/domain/services/HandwritingRecognizer";
import { defaultHanddrawnNoteEnhancer } from "../src/domain/services/HanddrawnNoteEnhancer";

// Headless MockElement for SVG/DOM checks
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
  style: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;

  constructor(tagName: string, options?: any) {
    this.tagName = tagName.toUpperCase();
    if (options?.cls) this.classList.add(options.cls);
    if (options?.text) this.textContent = options.text;
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

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") this.classList.add(...value.split(" "));
  }

  setAttributeNS(_ns: any, name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") this.classList.add(...value.split(" "));
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  setCssProps(props: Record<string, string>): void {
    Object.assign(this.style, props);
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

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const check = (el: MockElement) => {
      let matches = false;
      if (selector.startsWith(".")) {
        const classes = selector.split(".").filter(Boolean);
        if (classes.every((c) => el.classList.contains(c))) matches = true;
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

// Global mock DOM
const mockDocument = {
  createElement: (tag: string) => new MockElement(tag),
  createElementNS: (_ns: string, tag: string) => new MockElement(tag),
};
(global as any).document = mockDocument;

// Helper stroke generators
function makeRectStroke(id: string, x: number, y: number, w: number, h: number): Stroke {
  const points: StrokePoint[] = [];
  const N = 8;
  for (let i = 0; i <= N; i++) points.push({ x: x + (w * i) / N, y });
  for (let i = 0; i <= N; i++) points.push({ x: x + w, y: y + (h * i) / N });
  for (let i = 0; i <= N; i++) points.push({ x: x + w - (w * i) / N, y: y + h });
  for (let i = 0; i <= N; i++) points.push({ x, y: y + h - (h * i) / N });
  return { id, points };
}

function makeCircleStroke(id: string, cx: number, cy: number, r: number): Stroke {
  const points: StrokePoint[] = [];
  const N = 32;
  for (let i = 0; i <= N; i++) {
    const angle = (2 * Math.PI * i) / N;
    points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return { id, points };
}

function makeLineStroke(id: string, x1: number, y1: number, x2: number, y2: number, steps = 12): Stroke {
  const points: StrokePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push({ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps });
  }
  return { id, points };
}

function makeLetterT(idPrefix: string, x: number, y: number, size = 18): Stroke[] {
  // Top horizontal bar
  const topBar = makeLineStroke(`${idPrefix}-t1`, x, y, x + size, y, 6);
  // Vertical stem
  const stem = makeLineStroke(`${idPrefix}-t2`, x + size / 2, y, x + size / 2, y + size, 6);
  return [topBar, stem];
}

function makeLetterO(id: string, x: number, y: number, r = 8): Stroke {
  return makeCircleStroke(id, x + r, y + r, r);
}

function makeArrowStroke(id: string, x1: number, y1: number, x2: number, y2: number): Stroke {
  const points: StrokePoint[] = [];
  // Main shaft
  for (let i = 0; i <= 15; i++) {
    points.push({ x: x1 + ((x2 - x1) * i) / 15, y: y1 + ((y2 - y1) * i) / 15 });
  }
  // Arrow head barbs
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 12;
  const a1 = angle + Math.PI * 0.85;
  const a2 = angle - Math.PI * 0.85;
  points.push({ x: x2 + headLen * Math.cos(a1), y: y2 + headLen * Math.sin(a1) });
  points.push({ x: x2, y: y2 });
  points.push({ x: x2 + headLen * Math.cos(a2), y: y2 + headLen * Math.sin(a2) });
  return { id, points };
}

describe("v2.1.0 Feature: Handdrawn Note Enhancement & Standardized Note Generation", () => {
  describe("1. Direct Canvas Text Node (generic.text)", () => {
    it("is registered in defaultShapeRegistry with proper boundary point and ports", () => {
      const textDef = defaultShapeRegistry.get("generic.text");
      expect(textDef).toBeDefined();

      const node: any = {
        id: "text-1",
        kind: "generic.text",
        title: "Direct canvas text note",
        position: { x: 50, y: 80 },
        size: { width: 180, height: 40 },
        customData: {},
      };

      // Boundary point
      const bp = textDef!.getBoundaryPoint(node, { x: 0, y: 100 });
      expect(bp.x).toBe(50);
      expect(bp.y).toBe(100);

      // Ports
      const ports = textDef!.getPorts(node);
      expect(ports.length).toBe(4);

      // RenderSvg
      const svgEl = textDef!.renderSvg(node, { isSelected: false }) as any;
      expect(svgEl).toBeDefined();
      expect(svgEl.textContent).toContain("Direct canvas text note");
    });

    it("renders multi-line direct text with tspan elements", () => {
      const textDef = defaultShapeRegistry.get("generic.text");
      const node: any = {
        id: "text-multi",
        kind: "generic.text",
        title: "Line 1\nLine 2\nLine 3",
        position: { x: 20, y: 30 },
        size: { width: 120, height: 60 },
      };

      const svgEl = textDef!.renderSvg(node, { isSelected: false }) as any;
      const tspans = svgEl.querySelectorAll("tspan");
      expect(tspans.length).toBe(3);
    });

    it("exports generic.text to clean SVG via SvgExporter", () => {
      const editor = new DiagramEditor(createDiagram({ id: "diag-text", diagramType: "general" }));
      editor.addNode({
        kind: "generic.text",
        title: "Canvas Note Header",
        position: { x: 100, y: 100 },
        size: { width: 200, height: 35 },
      });

      const svg = defaultSvgExporter.exportToSvg(editor.diagram);
      expect(svg).toContain("Canvas Note Header");
      expect(svg).toContain("node-title");
    });
  });

  describe("2. Structured Table Node (generic.table)", () => {
    it("parses TableCustomData correctly and falls back to default 3x3 if empty", () => {
      const emptyNode: any = { id: "tbl-empty", customData: undefined };
      const defaultTable = getTableDataFromNode(emptyNode);
      expect(defaultTable.rows).toBe(3);
      expect(defaultTable.cols).toBe(3);
      expect(defaultTable.cells.length).toBe(3);

      const customNode: any = {
        id: "tbl-custom",
        customData: {
          tableData: {
            rows: 2,
            cols: 2,
            headers: ["Col A", "Col B"],
            cells: [["A1", "B1"], ["A2", "B2"]],
          },
        },
      };
      const customTable = getTableDataFromNode(customNode);
      expect(customTable.rows).toBe(2);
      expect(customTable.cols).toBe(2);
      expect(customTable.headers).toEqual(["Col A", "Col B"]);
      expect(customTable.cells[1][0]).toBe("A2");
    });

    it("renders table with gridlines, header accent band, and cell content", () => {
      const tableDef = defaultShapeRegistry.get("generic.table");
      expect(tableDef).toBeDefined();

      const tableData: TableCustomData = {
        rows: 2,
        cols: 2,
        headers: ["Task", "Status"],
        cells: [["Task", "Status"], ["Design", "Done"]],
      };
      const node: any = {
        id: "tbl-render",
        kind: "generic.table",
        title: "Status Table",
        position: { x: 50, y: 50 },
        size: { width: 240, height: 100 },
        customData: { tableData },
      };

      const svgEl = tableDef!.renderSvg(node, { isSelected: false }) as any;

      // Verify grid and headers
      const rects = svgEl.querySelectorAll("rect");
      expect(rects.length).toBeGreaterThanOrEqual(2); // Outer border and header background

      const lines = svgEl.querySelectorAll("line");
      expect(lines.length).toBeGreaterThanOrEqual(2); // Column divider and row divider

      const texts = svgEl.querySelectorAll("text");
      expect(texts.length).toBeGreaterThan(0);
      expect(svgEl.textContent).toContain("Task");
      expect(svgEl.textContent).toContain("Status");
      expect(svgEl.textContent).toContain("Design");
      expect(svgEl.textContent).toContain("Done");
    });

    it("exports generic.table cleanly in SvgExporter", () => {
      const editor = new DiagramEditor(createDiagram({ id: "diag-table", diagramType: "general" }));
      editor.addNode({
        kind: "generic.table",
        title: "Sprint Tasks",
        position: { x: 40, y: 40 },
        size: { width: 300, height: 120 },
        customData: {
          tableData: {
            rows: 2,
            cols: 2,
            headers: ["Item", "Owner"],
            cells: [["Item", "Owner"], ["Auth", "Alice"]],
          },
        },
      });

      const svg = defaultSvgExporter.exportToSvg(editor.diagram);
      expect(svg).toContain("Item");
      expect(svg).toContain("Owner");
      expect(svg).toContain("Auth");
      expect(svg).toContain("Alice");
    });
  });

  describe("3. HandwritingRecognizer Engine", () => {
    it("evaluates isLikelyText correctly against stroke dimensions", () => {
      // Small stroke typical of handwriting letter
      const letterStroke = makeLineStroke("s-letter", 100, 100, 115, 120);
      expect(defaultHandwritingRecognizer.isLikelyText(letterStroke)).toBe(true);

      // Huge box stroke
      const boxStroke = makeRectStroke("s-box", 0, 0, 400, 300);
      expect(defaultHandwritingRecognizer.isLikelyText(boxStroke)).toBe(false);

      // Long divider line
      const dividerStroke = makeLineStroke("s-divider", 50, 200, 350, 202);
      expect(defaultHandwritingRecognizer.isLikelyText(dividerStroke)).toBe(false);
    });

    it("clusters handwriting strokes into lines and words", () => {
      // Line 1: Word "TO"
      const letterT = makeLetterT("t1", 50, 50, 16);
      const letterO = makeLetterO("o1", 72, 50, 8);

      // Line 2: Word "TO" lower down
      const letterT2 = makeLetterT("t2", 50, 90, 16);
      const letterO2 = makeLetterO("o2", 72, 90, 8);

      const allStrokes = [...letterT, letterO, ...letterT2, letterO2];
      const lines = defaultHandwritingRecognizer.clusterStrokesIntoLines(allStrokes);

      expect(lines.length).toBe(2);
      expect(lines[0].strokes.length).toBe(3); // 2 strokes for T, 1 for O
      expect(lines[1].strokes.length).toBe(3);
    });

    it("recognizes characters and clusters words accurately", () => {
      // Create strokes forming "TO"
      const tStrokes = makeLetterT("word-t", 100, 100, 20);
      const oStroke = makeLetterO("word-o", 126, 100, 10);
      const word = defaultHandwritingRecognizer.recognizeWord([...tStrokes, oStroke]);

      expect(word).toBe("TO");
    });

    it("snaps recognized words to vocabulary for common diagram / note terms", () => {
      const recognized = defaultHandwritingRecognizer.snapToVocabulary("TODOO");
      expect(recognized).toBe("TODO");

      const authSnap = defaultHandwritingRecognizer.snapToVocabulary("AUTTH");
      expect(authSnap).toBe("AUTH");
    });
  });

  describe("4. HanddrawnNoteEnhancer Structural & Semantic Detection", () => {
    it("detects handdrawn table with outer rectangle and dividing lines", () => {
      // Outer box 240 x 120 at (100, 100)
      const outerBox = makeRectStroke("table-outer", 100, 100, 240, 120);
      // Horizontal divider at y=150
      const hDivider = makeLineStroke("table-h1", 102, 150, 338, 150);
      // Vertical divider at x=220
      const vDivider = makeLineStroke("table-v1", 220, 102, 220, 218);

      const result = defaultHanddrawnNoteEnhancer.enhanceStrokes([outerBox, hDivider, vDivider]);
      expect(result.tables.length).toBe(1);
      const tbl = result.tables[0];
      expect(tbl.kind).toBe("generic.table");
      expect(tbl.position.x).toBe(100);
      expect(tbl.position.y).toBe(100);
      expect(tbl.size.width).toBe(240);
      expect(tbl.size.height).toBe(120);

      const tblData = getTableDataFromNode(tbl);
      expect(tblData.rows).toBe(2);
      expect(tblData.cols).toBe(2);
    });

    it("detects handdrawn container with enclosed handwriting as a titled node", () => {
      // Box at (100, 100) size 160 x 100
      const box = makeRectStroke("box-1", 100, 100, 160, 100);
      // Handwriting "TO" inside the box at (140, 135)
      const t = makeLetterT("box-t", 140, 135, 18);
      const o = makeLetterO("box-o", 164, 135, 9);

      const result = defaultHanddrawnNoteEnhancer.enhanceStrokes([box, ...t, o]);
      expect(result.containers.length).toBe(1);
      const container = result.containers[0];
      expect(container.kind).toBe("generic.rectangle");
      expect(container.labels[0]?.text).toBe("TO");
      expect(container.position.x).toBe(100);
      expect(container.position.y).toBe(100);
    });

    it("detects handdrawn circle container with empty title when no text inside", () => {
      const circle = makeCircleStroke("circ-1", 200, 200, 50);
      const result = defaultHanddrawnNoteEnhancer.enhanceStrokes([circle]);
      expect(result.containers.length).toBe(1);
      expect(result.containers[0].kind).toBe("generic.circle");
    });

    it("detects directional arrows between components and creates connected edges", () => {
      // Box A at (100, 100) size 100x80 (bounds 100-200, 100-180)
      const boxA = makeRectStroke("boxA", 100, 100, 100, 80);
      // Box B at (350, 100) size 100x80 (bounds 350-450, 100-180)
      const boxB = makeRectStroke("boxB", 350, 100, 100, 80);
      // Arrow from right edge of Box A (205, 140) to left edge of Box B (345, 140)
      const arrow = makeArrowStroke("arr-1", 205, 140, 345, 140);

      const result = defaultHanddrawnNoteEnhancer.enhanceStrokes([boxA, boxB, arrow]);
      expect(result.containers.length).toBe(2);
      expect(result.edges.length).toBe(1);

      const edge = result.edges[0];
      expect(edge.fromNodeId).toBe(result.containers[0].id);
      expect(edge.toNodeId).toBe(result.containers[1].id);
      expect(edge.fromSide).toBe("right");
      expect(edge.toSide).toBe("left");
      expect(edge.style?.markerEnd).toBe("arrow");
    });

    it("converts standalone handwriting strokes outside containers into generic.text notes", () => {
      // Freeform handwritten "TO" in open canvas
      const t = makeLetterT("free-t", 300, 400, 20);
      const o = makeLetterO("free-o", 326, 400, 10);

      const result = defaultHanddrawnNoteEnhancer.enhanceStrokes([...t, o]);
      expect(result.containers.length).toBe(0);
      expect(result.textNotes.length).toBe(1);

      const textNode = result.textNotes[0];
      expect(textNode.kind).toBe("generic.text");
      expect(textNode.labels[0]?.text).toBe("TO");
      expect(textNode.position.x).toBeLessThanOrEqual(300);
      expect(textNode.position.y).toBeLessThanOrEqual(400);
    });
  });

  describe("5. EnhanceHanddrawnNotesCommand & DiagramEditor End-to-End Workflow", () => {
    let editor: DiagramEditor;

    beforeEach(() => {
      editor = new DiagramEditor(createDiagram({ id: "diag-enhancer", diagramType: "general" }));
    });

    it("returns false and does nothing when no strokes are selected", () => {
      const res = editor.enhanceHanddrawnSelection();
      expect(res).toBe(false);
      expect(editor.diagram.nodes.length).toBe(0);
      expect(editor.diagram.edges.length).toBe(0);
    });

    it("executes complete enhancement on selected mixed handdrawn components", () => {
      // 1. Box A with enclosed "TO"
      const boxA = makeRectStroke("stroke-box-a", 100, 100, 120, 80);
      const textA = [...makeLetterT("ta", 130, 130, 16), makeLetterO("oa", 152, 130, 8)];

      // 2. Box B with enclosed "TO"
      const boxB = makeRectStroke("stroke-box-b", 350, 100, 120, 80);
      const textB = [...makeLetterT("tb", 380, 130, 16), makeLetterO("ob", 402, 130, 8)];

      // 3. Arrow from Box A to Box B
      const arrow = makeArrowStroke("stroke-arrow-ab", 225, 140, 345, 140);

      // 4. Standalone table
      const tblOuter = makeRectStroke("tbl-o", 100, 300, 200, 100);
      const tblH = makeLineStroke("tbl-h", 102, 345, 298, 345);
      const tblV = makeLineStroke("tbl-v", 195, 302, 195, 398);

      // 5. Standalone direct note text "TO"
      const standText = [...makeLetterT("st", 350, 300, 18), makeLetterO("so", 374, 300, 9)];

      // Add all strokes to editor as freehand nodes
      const allStrokes = [boxA, ...textA, boxB, ...textB, arrow, tblOuter, tblH, tblV, ...standText];
      const addedNodes: DiagramNode[] = [];
      allStrokes.forEach((s) => {
        const n = editor.addStroke(s);
        addedNodes.push(n);
      });

      expect(editor.diagram.nodes.filter((n) => n.kind === "generic.freehand").length).toBe(allStrokes.length);

      // Select all freehand nodes
      addedNodes.forEach((n) => editor.selectNode(n.id, true));

      // Execute enhancement
      const success = editor.enhanceHanddrawnSelection();
      expect(success).toBe(true);

      // Verify original freehand nodes removed
      expect(editor.diagram.nodes.filter((n) => n.kind === "generic.freehand").length).toBe(0);

      // Verify nodes created: 2 containers (Box A & B) + 1 table + 1 direct text note = 4 nodes
      expect(editor.diagram.nodes.length).toBe(4);

      // Verify edge created connecting Box A to Box B
      expect(editor.diagram.edges.length).toBe(1);
      expect(editor.diagram.edges[0].style?.markerEnd).toBe("arrow");

      // Verify selection shifted to newly created standardized elements
      expect(editor.selectedNodeIds.length).toBe(4);
      expect(editor.selectedEdgeIds.length).toBe(1);

      // Verify node types
      const kinds = editor.diagram.nodes.map((n) => n.kind);
      expect(kinds).toContain("generic.rectangle");
      expect(kinds).toContain("generic.table");
      expect(kinds).toContain("generic.text");
    });

    it("supports full Undo and Redo via EnhanceHanddrawnNotesCommand", () => {
      const box = makeRectStroke("undo-box", 50, 50, 100, 80);
      const freehandNode = editor.addStroke(box);
      editor.selectNode(freehandNode.id, true);

      const success = editor.enhanceHanddrawnSelection();
      expect(success).toBe(true);
      expect(editor.diagram.nodes.filter((n) => n.kind === "generic.freehand").length).toBe(0);
      expect(editor.diagram.nodes.length).toBe(1);

      // Undo
      editor.undo();
      expect(editor.diagram.nodes.filter((n) => n.kind === "generic.freehand").length).toBe(1);
      expect(editor.diagram.nodes[0].kind).toBe("generic.freehand");

      // Redo
      editor.redo();
      expect(editor.diagram.nodes.filter((n) => n.kind === "generic.freehand").length).toBe(0);
      expect(editor.diagram.nodes.length).toBe(1);
      expect(editor.diagram.nodes[0].kind).toBe("generic.rectangle");
    });
  });
});
