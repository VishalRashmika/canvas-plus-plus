import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { defaultTableDetector } from "../src/domain/services/TableDetector";
import { defaultHandwrittenFontDetector } from "../src/domain/services/HandwrittenFontDetector";
import { defaultShapeRecognizer, Stroke, StrokePoint } from "../src/domain/services/ShapeRecognizer";
import { calculateNodeFitSize } from "../src/domain/services/TextMeasurement";
import { resolveFontFamily, applyFontToSvgElement } from "../src/presentation/theme/Typography";
import { DiagramNode } from "../src/domain/entities/DiagramNode";

class MockElement {
  tagName: string;
  attributes: Record<string, string> = {};
  children: MockElement[] = [];
  classList = {
    classes: new Set<string>(),
    add: (...names: string[]) => names.forEach((n) => this.classList.classes.add(n)),
    remove: (...names: string[]) => names.forEach((n) => this.classList.classes.delete(n)),
    contains: (name: string) => this.classList.classes.has(name),
  };
  style: any = {
    setProperty: (name: string, value: string) => {
      this.style[name] = value;
    },
  };

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") this.classList.add(...value.split(" "));
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  appendChild(child: MockElement): void {
    this.children.push(child);
  }
}

(global as any).document = {
  createElementNS: (_ns: string, tag: string) => new MockElement(tag),
  createElement: (tag: string) => new MockElement(tag),
};

function makeStraightStroke(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  id: string = "strk"
): Stroke {
  const steps = 10;
  const points: StrokePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: Math.round((x1 + t * (x2 - x1)) * 10) / 10,
      y: Math.round((y1 + t * (y2 - y1)) * 10) / 10,
    });
  }
  return { id, points };
}

function makeBoxStroke(x: number, y: number, w: number, h: number, id = "box"): Stroke {
  const points: StrokePoint[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
    { x, y },
  ];
  return { id, points };
}

describe("Handwritten Text without Bounding Shape Enhancement", () => {
  let editor: DiagramEditor;

  beforeEach(() => {
    editor = new DiagramEditor(createDiagram({ id: "test-diag", diagramType: "generic" }));
  });

  describe("1. Prevention of False-Positive Table Detection on Normal Words", () => {
    it("should NOT detect 'IT' as a table", () => {
      const itStrokes = [
        makeStraightStroke(10, 10, 10, 50, "i-stem"),
        makeStraightStroke(5, 10, 15, 10, "i-top"),
        makeStraightStroke(5, 50, 15, 50, "i-bot"),
        makeStraightStroke(25, 10, 45, 10, "t-top"),
        makeStraightStroke(35, 10, 35, 50, "t-stem"),
      ];
      const res = defaultTableDetector.detect(itStrokes);
      expect(res.isTable).toBe(false);
    });

    it("should NOT detect 'HE' as a table", () => {
      const heStrokes = [
        makeStraightStroke(10, 10, 10, 50, "h-left"),
        makeStraightStroke(30, 10, 30, 50, "h-right"),
        makeStraightStroke(10, 30, 30, 30, "h-cross"),
        makeStraightStroke(40, 10, 40, 50, "e-stem"),
        makeStraightStroke(40, 10, 60, 10, "e-top"),
        makeStraightStroke(40, 30, 55, 30, "e-mid"),
        makeStraightStroke(40, 50, 60, 50, "e-bot"),
      ];
      const res = defaultTableDetector.detect(heStrokes);
      expect(res.isTable).toBe(false);
    });

    it("should NOT detect 'FILE' as a table", () => {
      const fileStrokes = [
        makeStraightStroke(10, 10, 10, 50, "f-stem"),
        makeStraightStroke(10, 10, 30, 10, "f-top"),
        makeStraightStroke(10, 30, 25, 30, "f-mid"),
        makeStraightStroke(40, 10, 40, 50, "i-stem"),
        makeStraightStroke(50, 10, 50, 50, "l-stem"),
        makeStraightStroke(50, 50, 70, 50, "l-bot"),
        makeStraightStroke(80, 10, 80, 50, "e-stem"),
        makeStraightStroke(80, 10, 100, 10, "e-top"),
        makeStraightStroke(80, 30, 95, 30, "e-mid"),
        makeStraightStroke(80, 50, 100, 50, "e-bot"),
      ];
      const res = defaultTableDetector.detect(fileStrokes);
      expect(res.isTable).toBe(false);
    });

    it("should correctly detect a true crossing-line grid as a table", () => {
      // 2 horizontal spanning lines and 2 vertical spanning lines crossing into a 2x2 grid
      const gridStrokes = [
        makeStraightStroke(10, 30, 90, 30, "grid-h1"),
        makeStraightStroke(10, 70, 90, 70, "grid-h2"),
        makeStraightStroke(35, 10, 35, 90, "grid-v1"),
        makeStraightStroke(65, 10, 65, 90, "grid-v2"),
      ];
      const res = defaultTableDetector.detect(gridStrokes);
      expect(res.isTable).toBe(true);
      expect(res.rows).toBe(3);
      expect(res.cols).toBe(3);
    });
  });

  describe("2. Enhancing Freehand Words into generic.text without Bounding Shapes", () => {
    it("should enhance freehand 'FILE' into a generic.text node, never into a box", () => {
      const fileStrokes = [
        makeStraightStroke(10, 10, 10, 50, "f-stem"),
        makeStraightStroke(10, 10, 30, 10, "f-top"),
        makeStraightStroke(10, 30, 25, 30, "f-mid"),
        makeStraightStroke(40, 10, 40, 50, "i-stem"),
        makeStraightStroke(50, 10, 50, 50, "l-stem"),
        makeStraightStroke(50, 50, 70, 50, "l-bot"),
        makeStraightStroke(80, 10, 80, 50, "e-stem"),
        makeStraightStroke(80, 10, 100, 10, "e-top"),
        makeStraightStroke(80, 30, 95, 30, "e-mid"),
        makeStraightStroke(80, 50, 100, 50, "e-bot"),
      ];

      const freehandNodes = fileStrokes.map((s) =>
        editor.addFreehandNode(s)
      );
      editor.selectNodes(freehandNodes.map((n) => n.id));

      const enhanced = editor.enhanceSelection() as DiagramNode;
      expect(enhanced).not.toBeNull();
      expect(enhanced.kind).toBe("generic.text");
      expect(enhanced.kind).not.toBe("generic.table");
      expect(enhanced.kind).not.toBe("uml.class");
      expect(enhanced.kind).not.toBe("generic.rectangle");
      expect(enhanced.title).toBe("FILE");
      expect(enhanced.style?.fontFamily).toBe("handwritten");
    });

    it("should enhance freehand 'HE' into a generic.text node", () => {
      const heStrokes = [
        makeStraightStroke(10, 10, 10, 50, "h-left"),
        makeStraightStroke(30, 10, 30, 50, "h-right"),
        makeStraightStroke(10, 30, 30, 30, "h-cross"),
        makeStraightStroke(40, 10, 40, 50, "e-stem"),
        makeStraightStroke(40, 10, 60, 10, "e-top"),
        makeStraightStroke(40, 30, 55, 30, "e-mid"),
        makeStraightStroke(40, 50, 60, 50, "e-bot"),
      ];

      const freehandNodes = heStrokes.map((s) =>
        editor.addFreehandNode(s)
      );
      editor.selectNodes(freehandNodes.map((n) => n.id));

      const enhanced = editor.enhanceSelection() as DiagramNode;
      expect(enhanced).not.toBeNull();
      expect(enhanced.kind).toBe("generic.text");
      expect(enhanced.title).toBe("HE");
    });

    it("should enhance freehand 'CAT' into a generic.text node", () => {
      // C: arc, A: 3 lines, T: 2 lines
      const catStrokes = [
        // C
        {
          id: "c-arc",
          points: [
            { x: 30, y: 15 },
            { x: 20, y: 10 },
            { x: 10, y: 25 },
            { x: 20, y: 45 },
            { x: 30, y: 40 },
          ],
        },
        // A
        makeStraightStroke(40, 45, 50, 10, "a-left"),
        makeStraightStroke(50, 10, 60, 45, "a-right"),
        makeStraightStroke(44, 30, 56, 30, "a-cross"),
        // T
        makeStraightStroke(70, 10, 95, 10, "t-top"),
        makeStraightStroke(82, 10, 82, 45, "t-stem"),
      ];

      const freehandNodes = catStrokes.map((s) =>
        editor.addFreehandNode(s)
      );
      editor.selectNodes(freehandNodes.map((n) => n.id));

      const enhanced = editor.enhanceSelection() as DiagramNode;
      expect(enhanced).not.toBeNull();
      expect(enhanced.kind).toBe("generic.text");
      expect(enhanced.title).toBe("CAT");
    });
  });

  describe("3. Preserving Shapes with Contained Text", () => {
    it("should enhance an outer bounding box with text inside as generic.rectangle with text title", () => {
      // Outer rectangle enclosing inner strokes
      const outerBox = makeBoxStroke(0, 0, 120, 70, "outer-rect");
      // Inner "HE"
      const innerHE = [
        makeStraightStroke(20, 20, 20, 50, "h-left"),
        makeStraightStroke(40, 20, 40, 50, "h-right"),
        makeStraightStroke(20, 35, 40, 35, "h-cross"),
        makeStraightStroke(55, 20, 55, 50, "e-stem"),
        makeStraightStroke(55, 20, 75, 20, "e-top"),
        makeStraightStroke(55, 35, 70, 35, "e-mid"),
        makeStraightStroke(55, 50, 75, 50, "e-bot"),
      ];

      const allNodes = [outerBox, ...innerHE].map((s) => editor.addFreehandNode(s));
      editor.selectNodes(allNodes.map((n) => n.id));

      const enhanced = editor.enhanceSelection() as DiagramNode;
      expect(enhanced).not.toBeNull();
      expect(enhanced.kind).toBe("generic.rectangle");
      expect(enhanced.title).toBe("HE");
    });

    it("should enhance outer bounding box in uml.class diagram to uml.class with text title", () => {
      const umlEditor = new DiagramEditor(createDiagram({ id: "uml-diag", diagramType: "uml.class" }));
      const outerBox = makeBoxStroke(0, 0, 120, 70, "outer-rect");
      const innerHE = [
        makeStraightStroke(20, 20, 20, 50, "h-left"),
        makeStraightStroke(40, 20, 40, 50, "h-right"),
        makeStraightStroke(20, 35, 40, 35, "h-cross"),
        makeStraightStroke(55, 20, 55, 50, "e-stem"),
        makeStraightStroke(55, 20, 75, 20, "e-top"),
        makeStraightStroke(55, 35, 70, 35, "e-mid"),
        makeStraightStroke(55, 50, 75, 50, "e-bot"),
      ];

      const allNodes = [outerBox, ...innerHE].map((s) => umlEditor.addFreehandNode(s));
      umlEditor.selectNodes(allNodes.map((n) => n.id));

      const enhanced = umlEditor.enhanceSelection() as DiagramNode;
      expect(enhanced).not.toBeNull();
      expect(enhanced.kind).toBe("uml.class");
      expect(enhanced.title).toBe("HE");
    });
  });

  describe("4. Font Styling & Typography Resolution", () => {
    it("should resolve 'handwritten' to the cursive font stack", () => {
      const resolved = resolveFontFamily("handwritten");
      expect(resolved).toBe("Virgil, 'Comic Sans MS', cursive, sans-serif");
    });

    it("should apply resolved font to SVG text element", () => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
      applyFontToSvgElement(el, { fontFamily: "handwritten", fontSize: 20 });
      expect(el.getAttribute("font-family")).toBe("Virgil, 'Comic Sans MS', cursive, sans-serif");
      expect(el.getAttribute("font-size")).toBe("20");
    });
  });

  describe("5. Text Measurement & Auto Fit for generic.text", () => {
    it("should calculate tight fitting bounds for generic.text without compartment overhead", () => {
      const textNode: DiagramNode = {
        id: "text-1",
        kind: "generic.text",
        title: "Hello World",
        position: { x: 100, y: 100 },
        size: { width: 140, height: 40 },
        ports: [],
        labels: [{ id: "l1", text: "Hello World", anchor: "node", position: { x: 0, y: 0 } }],
        style: { fontSize: 16, fontFamily: "handwritten" },
        metadata: {},
      };

      const fitSize = calculateNodeFitSize(textNode);
      expect(fitSize.width).toBeGreaterThanOrEqual(40);
      expect(fitSize.height).toBeGreaterThanOrEqual(24);
      // Ensure height is not inflated by class compartments (e.g. 60+ min)
      expect(fitSize.height).toBeLessThan(40);
    });
  });
});
