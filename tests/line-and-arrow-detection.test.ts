import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { Stroke, defaultShapeRecognizer } from "../src/domain/services/ShapeRecognizer";

describe("Issue #2: Improve Line & Arrowhead Detection Tests", () => {
  let editor: DiagramEditor;
  let nodeA: any;
  let nodeB: any;

  beforeEach(() => {
    editor = new DiagramEditor(createDiagram({ id: "diag-arrow-test", diagramType: "general" }));

    // Node A at (100, 100), Node B at (400, 100)
    nodeA = editor.addNode({
      kind: "generic.rectangle",
      title: "Box A",
      position: { x: 100, y: 100 },
      size: { width: 120, height: 80 },
    });
    nodeB = editor.addNode({
      kind: "generic.rectangle",
      title: "Box B",
      position: { x: 400, y: 100 },
      size: { width: 120, height: 80 },
    });
    editor.clearSelection();
  });

  describe("1. Single-stroke arrow between boxes (solid line with direction, not dotted)", () => {
    it("should create a solid directed association with arrow pointing from Box A to Box B", () => {
      // Stroke from Box A (225, 140) to Box B (395, 140) with arrowhead barbs at Box B
      const arrowStroke: Stroke = {
        id: "arrow-A-to-B",
        points: [
          { x: 225, y: 140 },
          { x: 280, y: 140 },
          { x: 340, y: 140 },
          { x: 395, y: 140 },
          { x: 382, y: 128 },
          { x: 395, y: 140 },
          { x: 382, y: 152 },
        ],
      };

      const result = editor.snapStrokeToShape(arrowStroke) as any;
      expect(result).toBeDefined();
      expect(result.fromNodeId).toBe(nodeA.id);
      expect(result.toNodeId).toBe(nodeB.id);

      // Must NOT be a dotted line:
      expect(result.kind).toBe("uml.directedAssociation");
      expect(result.kind).not.toBe("uml.dependency");
      expect(result.style?.lineType).toBe("solid");
      expect(result.style?.dashed).toBe(false);
      expect(result.style?.strokeDasharray).toBeUndefined();

      // Must have direction pointing to Box B:
      expect(result.style?.markerEnd).toBe("open-arrow");
      expect(result.style?.markerStart).toBeUndefined();
    });

    it("should point from Box B to Box A when drawn from right to left with arrowhead at Box A", () => {
      // Stroke starting near Box B (390, 140) and ending near Box A (225, 140) with arrowhead at Box A
      const arrowStroke: Stroke = {
        id: "arrow-B-to-A",
        points: [
          { x: 390, y: 140 },
          { x: 330, y: 140 },
          { x: 280, y: 140 },
          { x: 225, y: 140 },
          { x: 238, y: 128 },
          { x: 225, y: 140 },
          { x: 238, y: 152 },
        ],
      };

      const result = editor.snapStrokeToShape(arrowStroke) as any;
      expect(result).toBeDefined();
      expect(result.fromNodeId).toBe(nodeB.id);
      expect(result.toNodeId).toBe(nodeA.id);

      // Solid line, not dotted:
      expect(result.style?.lineType).toBe("solid");
      expect(result.style?.dashed).toBe(false);
      expect(result.style?.strokeDasharray).toBeUndefined();

      // Direction pointing to Box A:
      expect(result.style?.markerEnd).toBe("open-arrow");
    });

    it("should work for fast single-stroke arrows with low point count (5 points)", () => {
      // Fast swipe arrow with only 5 points
      const fastArrow: Stroke = {
        id: "fast-arrow",
        points: [
          { x: 225, y: 140 },
          { x: 310, y: 140 },
          { x: 395, y: 140 }, // tip
          { x: 382, y: 128 }, // barb 1
          { x: 382, y: 152 }, // barb 2
        ],
      };

      const result = editor.snapStrokeToShape(fastArrow) as any;
      expect(result).toBeDefined();
      expect(result.fromNodeId).toBe(nodeA.id);
      expect(result.toNodeId).toBe(nodeB.id);
      expect(result.style?.markerEnd).toBe("open-arrow");
      expect(result.style?.lineType).toBe("solid");
    });

    it("should work when stroke is drawn starting with the arrowhead (<---)", () => {
      // User draws arrowhead first at Box B (barb 1 -> tip -> barb 2), then shaft back to Box A
      const reverseDrawnArrow: Stroke = {
        id: "reverse-drawn-arrow",
        points: [
          { x: 382, y: 128 },
          { x: 395, y: 140 }, // tip at Box B
          { x: 382, y: 152 },
          { x: 395, y: 140 },
          { x: 320, y: 140 },
          { x: 225, y: 140 }, // tail at Box A
        ],
      };

      const result = editor.snapStrokeToShape(reverseDrawnArrow) as any;
      expect(result).toBeDefined();
      // Arrowhead was at Box B, so target is Box B, source is Box A
      expect(result.fromNodeId).toBe(nodeA.id);
      expect(result.toNodeId).toBe(nodeB.id);
      expect(result.style?.markerEnd).toBe("open-arrow");
      expect(result.style?.lineType).toBe("solid");
    });

    it("should not be affected if defaultMarkerEnd was previously set to 'none' or defaultLineType was 'dotted'", () => {
      // Simulate user having previously clicked 'Line' or 'Dotted' in toolbar
      editor.defaultMarkerEnd = "none";
      editor.defaultLineType = "dotted";

      const arrowStroke: Stroke = {
        id: "arrow-with-stale-defaults",
        points: [
          { x: 225, y: 140 },
          { x: 300, y: 140 },
          { x: 395, y: 140 },
          { x: 382, y: 128 },
          { x: 395, y: 140 },
          { x: 382, y: 152 },
        ],
      };

      const result = editor.snapStrokeToShape(arrowStroke) as any;
      expect(result).toBeDefined();
      // Must still have direction and solid line despite stale default settings:
      expect(result.style?.markerEnd).toBe("open-arrow");
      expect(result.style?.lineType).toBe("solid");
      expect(result.style?.dashed).toBe(false);
      expect(result.style?.strokeDasharray).toBeUndefined();
    });
  });

  describe("2. Two-stroke arrow: Line drawn first, then arrowhead added at the end", () => {
    it("should attach arrowhead to existing line and convert it to directed solid arrow pointing to Box B", () => {
      // Step 1: User draws a line from Box A to Box B
      const lineStroke: Stroke = {
        id: "step1-line",
        points: [
          { x: 225, y: 140 },
          { x: 300, y: 140 },
          { x: 395, y: 140 },
        ],
      };

      const lineResult = editor.snapStrokeToShape(lineStroke) as any;
      expect(lineResult).toBeDefined();
      expect(lineResult.fromNodeId).toBe(nodeA.id);
      expect(lineResult.toNodeId).toBe(nodeB.id);
      expect(editor.diagram.edges.length).toBe(1);

      // Step 2: User draws an arrowhead (chevron / V) at the end of the line near Box B
      const arrowHeadStroke: Stroke = {
        id: "step2-arrowhead",
        points: [
          { x: 380, y: 128 },
          { x: 395, y: 140 }, // tip near Box B
          { x: 380, y: 152 },
        ],
      };

      const headResult = editor.snapStrokeToShape(arrowHeadStroke) as any;
      expect(headResult).toBeDefined();
      expect(headResult.id).toBe(lineResult.id); // Same edge was updated!

      // Edge now has direction pointing to Box B with a solid line:
      const updatedEdge = editor.diagram.edges.find((e) => e.id === lineResult.id);
      expect(updatedEdge).toBeDefined();
      expect(updatedEdge?.kind).toBe("uml.directedAssociation");
      expect(updatedEdge?.style?.markerEnd).toBe("open-arrow");
      expect(updatedEdge?.style?.lineType).toBe("solid");
      expect(updatedEdge?.style?.dashed).toBe(false);
      expect(updatedEdge?.style?.strokeDasharray).toBeUndefined();
    });

    it("should support undo after attaching arrowhead to restore original line", () => {
      const lineStroke: Stroke = {
        id: "undo-test-line",
        points: [
          { x: 225, y: 140 },
          { x: 395, y: 140 },
        ],
      };
      const lineResult = editor.snapStrokeToShape(lineStroke) as any;

      const arrowHeadStroke: Stroke = {
        id: "undo-test-head",
        points: [
          { x: 380, y: 128 },
          { x: 395, y: 140 },
          { x: 380, y: 152 },
        ],
      };
      editor.snapStrokeToShape(arrowHeadStroke);

      const edgeAfterHead = editor.diagram.edges.find((e) => e.id === lineResult.id);
      expect(edgeAfterHead?.style?.markerEnd).toBe("open-arrow");

      // Undo -> restores edge before arrowhead was attached
      editor.undo();
      const edgeAfterUndo = editor.diagram.edges.find((e) => e.id === lineResult.id);
      expect(edgeAfterUndo?.style?.markerEnd).toBe("none");
    });
  });

  describe("3. Multi-stroke line + arrowhead enhancement (enhanceSelection / enhanceStrokes)", () => {
    it("should replace selected freehand line and arrowhead strokes with a directed solid edge", () => {
      // User draws line and arrowhead in freehand mode without auto-detection
      const lineStroke: Stroke = {
        id: "freehand-line-shaft",
        points: [
          { x: 225, y: 140 },
          { x: 310, y: 140 },
          { x: 395, y: 140 },
        ],
      };
      const headStroke: Stroke = {
        id: "freehand-arrowhead",
        points: [
          { x: 380, y: 128 },
          { x: 395, y: 140 },
          { x: 380, y: 152 },
        ],
      };

      const lineNode = editor.addFreehandNode(lineStroke);
      const headNode = editor.addFreehandNode(headStroke);
      expect(editor.diagram.nodes.length).toBe(4); // Box A, Box B, lineNode, headNode

      // Select the 2 freehand nodes and execute enhanceSelection
      editor.selectNodes([lineNode.id, headNode.id]);
      const enhancedEdge = editor.enhanceSelection() as any;

      expect(enhancedEdge).toBeDefined();
      expect(enhancedEdge.fromNodeId).toBe(nodeA.id);
      expect(enhancedEdge.toNodeId).toBe(nodeB.id);

      // Must be solid directed line pointing to Box B:
      expect(enhancedEdge.kind).toBe("uml.directedAssociation");
      expect(enhancedEdge.style?.markerEnd).toBe("open-arrow");
      expect(enhancedEdge.style?.lineType).toBe("solid");
      expect(enhancedEdge.style?.dashed).toBe(false);
      expect(enhancedEdge.style?.strokeDasharray).toBeUndefined();

      // Freehand strokes were removed and replaced by the edge
      expect(editor.diagram.nodes.find((n) => n.id === lineNode.id)).toBeUndefined();
      expect(editor.diagram.nodes.find((n) => n.id === headNode.id)).toBeUndefined();
      expect(editor.diagram.edges.length).toBe(1);
    });

    it("should support 3-stroke arrow: shaft + 2 separate barb strokes", () => {
      const shaftStroke: Stroke = {
        id: "stroke-shaft",
        points: [{ x: 225, y: 140 }, { x: 395, y: 140 }],
      };
      const barb1Stroke: Stroke = {
        id: "stroke-barb1",
        points: [{ x: 380, y: 128 }, { x: 395, y: 140 }],
      };
      const barb2Stroke: Stroke = {
        id: "stroke-barb2",
        points: [{ x: 380, y: 152 }, { x: 395, y: 140 }],
      };

      const shaftNode = editor.addFreehandNode(shaftStroke);
      const barb1Node = editor.addFreehandNode(barb1Stroke);
      const barb2Node = editor.addFreehandNode(barb2Stroke);

      editor.selectNodes([shaftNode.id, barb1Node.id, barb2Node.id]);
      const edge = editor.enhanceSelection() as any;

      expect(edge).toBeDefined();
      expect(edge.fromNodeId).toBe(nodeA.id);
      expect(edge.toNodeId).toBe(nodeB.id);
      expect(edge.style?.markerEnd).toBe("open-arrow");
      expect(edge.style?.lineType).toBe("solid");
    });
  });

  describe("4. UML Class & Behavioral diagram types", () => {
    it("should create uml.directedAssociation (solid line) in uml.class diagrams, never uml.dependency (dotted)", () => {
      const classEditor = new DiagramEditor(createDiagram({ id: "diag-class", diagramType: "uml.class" }));
      const clsA = classEditor.addNode({ kind: "uml.class", title: "ClassA", position: { x: 50, y: 50 }, size: { width: 100, height: 80 } });
      const clsB = classEditor.addNode({ kind: "uml.class", title: "ClassB", position: { x: 300, y: 50 }, size: { width: 100, height: 80 } });

      const arrow: Stroke = {
        id: "class-arrow",
        points: [
          { x: 155, y: 90 },
          { x: 220, y: 90 },
          { x: 295, y: 90 },
          { x: 283, y: 80 },
          { x: 295, y: 90 },
          { x: 283, y: 100 },
        ],
      };

      const result = classEditor.snapStrokeToShape(arrow) as any;
      expect(result).toBeDefined();
      expect(result.fromNodeId).toBe(clsA.id);
      expect(result.toNodeId).toBe(clsB.id);

      // Must NOT be uml.dependency (which is dotted):
      expect(result.kind).toBe("uml.directedAssociation");
      expect(result.kind).not.toBe("uml.dependency");
      expect(result.style?.lineType).toBe("solid");
      expect(result.style?.strokeDasharray).toBeUndefined();
      expect(result.style?.markerEnd).toBe("open-arrow");
    });

    it("should create activity.controlFlow with open arrow in uml.activity diagrams", () => {
      const actEditor = new DiagramEditor(createDiagram({ id: "diag-act", diagramType: "uml.activity" }));
      const actA = actEditor.addNode({ kind: "activity.action", title: "ActionA", position: { x: 50, y: 50 }, size: { width: 100, height: 50 } });
      const actB = actEditor.addNode({ kind: "activity.action", title: "ActionB", position: { x: 300, y: 50 }, size: { width: 100, height: 50 } });

      const arrow: Stroke = {
        id: "act-arrow",
        points: [
          { x: 155, y: 75 },
          { x: 220, y: 75 },
          { x: 295, y: 75 },
          { x: 283, y: 65 },
          { x: 295, y: 75 },
          { x: 283, y: 85 },
        ],
      };

      const result = actEditor.snapStrokeToShape(arrow) as any;
      expect(result).toBeDefined();
      expect(result.fromNodeId).toBe(actA.id);
      expect(result.toNodeId).toBe(actB.id);
      expect(result.kind).toBe("activity.controlFlow");
      expect(result.style?.markerEnd).toBe("open-arrow");
      expect(result.style?.lineType).toBe("solid");
    });
  });

  describe("5. ShapeRecognizer Arrowhead & Standalone detection API", () => {
    it("detectArrowHead should identify arrow and correct tip point", () => {
      const arrowPoints = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 300, y: 100 }, // tip
        { x: 285, y: 85 },
        { x: 300, y: 100 },
        { x: 285, y: 115 },
      ];

      const check = defaultShapeRecognizer.detectArrowHead(arrowPoints);
      expect(check.hasArrowHead).toBe(true);
      expect(check.tipPoint.x).toBe(300);
      expect(check.tipPoint.y).toBe(100);
      expect(check.tailPoint.x).toBe(100);
    });

    it("detectStandaloneArrowhead should recognize standalone V / chevron strokes", () => {
      const vStroke = [
        { x: 50, y: 30 },
        { x: 70, y: 50 }, // corner / tip
        { x: 50, y: 70 },
      ];

      const check = defaultShapeRecognizer.detectStandaloneArrowhead(vStroke);
      expect(check.isArrowHead).toBe(true);
      expect(check.tipPoint.x).toBe(70);
      expect(check.tipPoint.y).toBe(50);
      expect(check.direction.x).toBeGreaterThan(0); // pointing right
    });
  });
});
