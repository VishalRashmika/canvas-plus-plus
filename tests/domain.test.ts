import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { Diagram, createDiagram } from "../src/domain/entities/Diagram";
import { resolveCanvasColor, CANVAS_COLOR_PRESETS } from "../src/domain/value-objects/CanvasColor";
import { JsonCanvasSerializer } from "../src/infrastructure/persistence/JsonCanvasSerializer";
import { defaultCustomChipRegistry } from "../src/domain/services/CustomChipRegistry";
import { defaultDiagramTypeRegistry } from "../src/domain/services/DiagramTypeRegistry";
import { createPort } from "../src/domain/entities/Port";
import { createChipInterfaceDefinition } from "../src/domain/entities/ChipInterfaceDefinition";
import { defaultShapeRecognizer, Stroke, StrokePoint } from "../src/domain/services/ShapeRecognizer";
import { defaultShapeRegistry } from "../src/presentation/renderer/ShapeRegistry";
import { getTrianglePerimeterIntersection } from "../src/domain/services/Geometry";

function createTestDiagram(type = "uml.class"): Diagram {
  return createDiagram({
    id: "test-diagram-1",
    title: "Test Diagram",
    diagramType: type,
  });
}

describe("Domain & Application Tests", () => {
  describe("CanvasColor Value Objects", () => {
    it("should resolve valid canvas color presets", () => {
      expect(resolveCanvasColor("1")).toBe("var(--canvas-color-1, #fb464c)");
      expect(resolveCanvasColor("4")).toBe("var(--canvas-color-4, #44cf6e)");
      expect(resolveCanvasColor("6")).toBe("var(--canvas-color-6, #a882ff)");
    });

    it("should pass through hex colors", () => {
      expect(resolveCanvasColor("#ff0000")).toBe("#ff0000");
      expect(resolveCanvasColor("#abcdef")).toBe("#abcdef");
    });

    it("should return undefined for undefined color", () => {
      expect(resolveCanvasColor(undefined)).toBeUndefined();
    });

    it("should contain 6 standard presets", () => {
      expect(CANVAS_COLOR_PRESETS.length).toBe(6);
      expect(CANVAS_COLOR_PRESETS.map((p) => p.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
    });
  });

  describe("DiagramEditor Use Cases", () => {
    let editor: DiagramEditor;

    beforeEach(() => {
      editor = new DiagramEditor(createTestDiagram());
    });

    it("should initialize with default diagram type and empty elements", () => {
      expect(editor.diagram).toBeDefined();
      expect(editor.diagram.nodes).toEqual([]);
      expect(editor.diagram.edges).toEqual([]);
      expect(editor.canUndo).toBe(false);
      expect(editor.canRedo).toBe(false);
    });

    it("should add and remove nodes", () => {
      const node = editor.addNode({
        position: { x: 100, y: 100 },
        title: "Test Node",
        kind: "uml.class",
      });

      expect(editor.diagram.nodes.length).toBe(1);
      expect(editor.diagram.nodes[0].id).toBe(node.id);
      expect(editor.canUndo).toBe(true);

      editor.deleteNode(node.id);
      expect(editor.diagram.nodes.length).toBe(0);

      editor.undo();
      expect(editor.diagram.nodes.length).toBe(1);

      editor.redo();
      expect(editor.diagram.nodes.length).toBe(0);
    });

    it("should connect nodes with edges", () => {
      const nodeA = editor.addNode({
        position: { x: 0, y: 0 },
        title: "Node A",
      });
      const nodeB = editor.addNode({
        position: { x: 200, y: 0 },
        title: "Node B",
      });

      const edge = editor.addEdge(nodeA.id, nodeB.id, {
        kind: "uml.association",
      });

      expect(editor.diagram.edges.length).toBe(1);
      expect(editor.diagram.edges[0].fromNodeId).toBe(nodeA.id);
      expect(editor.diagram.edges[0].toNodeId).toBe(nodeB.id);

      editor.undo();
      expect(editor.diagram.edges.length).toBe(0);
    });

    it("should group and ungroup nodes", () => {
      const n1 = editor.addNode({ position: { x: 10, y: 10 }, title: "N1" });
      const n2 = editor.addNode({ position: { x: 50, y: 50 }, title: "N2" });

      editor.selectNode(n1.id, false);
      editor.selectNode(n2.id, true);
      const group = editor.groupSelection();
      expect(group).toBeDefined();
      expect(editor.diagram.groups.length).toBe(1);
      expect(editor.diagram.groups[0].nodeIds).toContain(n1.id);
      expect(editor.diagram.groups[0].nodeIds).toContain(n2.id);

      editor.ungroupSelection();
      expect(editor.diagram.groups.length).toBe(0);
    });

    it("should rename group with undo and redo", () => {
      const n1 = editor.addNode({ position: { x: 10, y: 10 }, title: "N1" });
      editor.selectNode(n1.id, false);
      const group = editor.groupSelection("Initial Group Name")!;
      expect(group.name).toBe("Initial Group Name");

      editor.renameGroup(group.id, "Updated Group Name");
      expect(group.name).toBe("Updated Group Name");

      editor.undo();
      expect(group.name).toBe("Initial Group Name");

      editor.redo();
      expect(group.name).toBe("Updated Group Name");
    });

    it("should not rename locked group", () => {
      const n1 = editor.addNode({ position: { x: 10, y: 10 }, title: "N1" });
      editor.selectNode(n1.id, false);
      const group = editor.groupSelection("Locked Group")!;
      editor.toggleGroupLock(group.id);
      expect(group.locked).toBe(true);

      editor.renameGroup(group.id, "Attempted Rename");
      expect(group.name).toBe("Locked Group");
    });

    it("should remove node from group when moved outside group boundary", () => {
      const n1 = editor.addNode({ position: { x: 100, y: 100 }, size: { width: 100, height: 80 }, title: "N1" });
      const n2 = editor.addNode({ position: { x: 250, y: 100 }, size: { width: 100, height: 80 }, title: "N2" });

      editor.selectNode(n1.id, false);
      editor.selectNode(n2.id, true);
      const group = editor.groupSelection("Container Group")!;
      expect(group.nodeIds).toEqual([n1.id, n2.id]);

      // Move n1 within group boundary
      editor.moveNodes([{ nodeId: n1.id, oldPos: n1.position, newPos: { x: 110, y: 110 } }]);
      expect(group.nodeIds).toContain(n1.id);
      expect(group.nodeIds).toContain(n2.id);

      // Move n1 outside group boundary (group right edge is ~382)
      editor.moveNodes([{ nodeId: n1.id, oldPos: n1.position, newPos: { x: 800, y: 800 } }]);
      expect(group.nodeIds).not.toContain(n1.id);
      expect(group.nodeIds).toContain(n2.id);

      // Verify that subsequently moving the group moves only n2, and NOT n1
      editor.moveGroup(group.id, { x: 50, y: 50 });
      expect(n2.position.x).toBe(300);
      expect(n2.position.y).toBe(150);
      expect(n1.position.x).toBe(800);
      expect(n1.position.y).toBe(800);

      // Undo group move
      editor.undo();
      expect(n2.position.x).toBe(250);
      expect(n2.position.y).toBe(100);

      // Undo node move outside group -> n1 should be restored to group
      editor.undo();
      expect(n1.position.x).toBe(110);
      expect(n1.position.y).toBe(110);
      expect(group.nodeIds).toContain(n1.id);

      // Redo node move outside group -> n1 should be removed from group again
      editor.redo();
      expect(n1.position.x).toBe(800);
      expect(n1.position.y).toBe(800);
      expect(group.nodeIds).not.toContain(n1.id);
    });

    it("should switch diagram types", () => {
      editor.switchDiagramType("uml.sequence");
      expect(editor.diagram.diagramType).toBe("uml.sequence");
    });
  });

  describe("JsonCanvasSerializer", () => {
    const serializer = new JsonCanvasSerializer();

    it("should serialize and deserialize diagrams cleanly", () => {
      const editor = new DiagramEditor(createTestDiagram());
      editor.addNode({
        position: { x: 50, y: 60 },
        size: { width: 120, height: 80 },
        title: "Serialized Node",
        kind: "uml.class",
      });

      const serialized = serializer.serialize(editor.diagram);
      expect(typeof serialized).toBe("string");
      expect(serialized).toContain("Serialized Node");

      const deserialized = serializer.deserialize(serialized);
      expect(deserialized.nodes.length).toBe(1);
      expect(deserialized.nodes[0].position.x).toBe(50);
      expect(deserialized.nodes[0].position.y).toBe(60);
    });
  });

  describe("CustomChipRegistry", () => {
    it("should register and retrieve custom chip definitions", () => {
      const chip = createChipInterfaceDefinition({
        id: "test-chip",
        name: "Test Chip",
        ports: [
          createPort({ id: "p1", ownerNodeId: "test-chip", name: "VCC", side: "top", offset: 0.5, direction: "in" }),
          createPort({ id: "p2", ownerNodeId: "test-chip", name: "GND", side: "bottom", offset: 0.5, direction: "out" }),
        ],
      });

      defaultCustomChipRegistry.register(chip);

      const retrieved = defaultCustomChipRegistry.get("test-chip");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Test Chip");
      expect(retrieved?.ports.length).toBe(2);

      defaultCustomChipRegistry.unregister("test-chip");
      expect(defaultCustomChipRegistry.get("test-chip")).toBeUndefined();
    });
  });

  describe("DiagramTypeRegistry", () => {
    it("should contain default UML and technical diagram types", () => {
      const types = defaultDiagramTypeRegistry.getAll();
      expect(types.length).toBeGreaterThanOrEqual(10);
      expect(types.map((t) => t.id)).toContain("general");
      expect(types.map((t) => t.id)).toContain("uml.class");
      expect(types.map((t) => t.id)).toContain("uml.sequence");
      expect(types.map((t) => t.id)).toContain("uml.component");
    });
  });

  describe("General-Purpose Diagramming Mode", () => {
    it("should have general diagram definition registered with all components allowed", () => {
      const generalDef = defaultDiagramTypeRegistry.get("general");
      expect(generalDef).toBeDefined();
      expect(generalDef?.id).toBe("general");
      expect(generalDef?.displayName).toBe("General Diagram");
      expect(generalDef?.allowedNodeKinds.length).toBeGreaterThan(30);
      expect(generalDef?.allowedEdgeKinds.length).toBeGreaterThan(20);
      expect(generalDef?.validate(createDiagram({ id: "d1", diagramType: "general" }))).toEqual([]);
    });

    it("should fallback unknown diagram types to general diagram definition", () => {
      const fallbackDef = defaultDiagramTypeRegistry.get("unknown.type.xyz");
      expect(fallbackDef).toBeDefined();
      expect(fallbackDef?.id).toBe("general");
    });

    it("should allow combining shapes from different categories freely in a single diagram", () => {
      const editor = new DiagramEditor(createDiagram({ id: "gen-1", diagramType: "general" }));

      // Add a UML class
      const classNode = editor.addNode({ kind: "uml.class", title: "UserClass" });
      // Add a schematic chip
      const chipNode = editor.addNode({ kind: "schematic.chip", title: "Microcontroller" });
      // Add an activity action
      const actionNode = editor.addNode({ kind: "activity.action", title: "Process Data" });
      // Add a generic rectangle
      const rectNode = editor.addNode({ kind: "generic.rectangle", title: "Concept Box" });

      expect(editor.diagram.nodes.length).toBe(4);

      // Connect components from different domains
      const edge1 = editor.addEdge(classNode.id, chipNode.id, { kind: "uml.association" });
      const edge2 = editor.addEdge(chipNode.id, actionNode.id, { kind: "schematic.wire" });
      const edge3 = editor.addEdge(actionNode.id, rectNode.id, { kind: "generic.edge" });

      expect(editor.diagram.edges.length).toBe(3);
      expect(edge1.kind).toBe("uml.association");
      expect(edge2.kind).toBe("schematic.wire");
      expect(edge3.kind).toBe("generic.edge");

      // Validation in general mode has no UML-only restrictions blocking users
      const issues = editor.validateDiagram();
      expect(issues).toEqual([]);
    });

    it("should deserialize diagrams without explicit diagramType into general mode", () => {
      const serializer = new JsonCanvasSerializer();
      const rawJson = JSON.stringify({
        schemaVersion: 1,
        id: "native-obsidian-canvas-1",
        title: "Imported Canvas",
        nodes: [
          {
            id: "n1",
            kind: "generic.rectangle",
            position: { x: 10, y: 10 },
            size: { width: 100, height: 60 },
          },
        ],
        edges: [],
      });

      const diagram = serializer.deserialize(rawJson);
      expect(diagram.diagramType).toBe("general");
      expect(diagram.nodes.length).toBe(1);
    });
  });

  describe("Freehand Drawing & Auto Shape Detection", () => {
    function makeCircleStroke(cx = 100, cy = 100, r = 50, count = 32): Stroke {
      const points: StrokePoint[] = [];
      for (let i = 0; i <= count; i++) {
        const angle = (i / count) * 2 * Math.PI;
        points.push({
          x: Math.round(cx + r * Math.cos(angle)),
          y: Math.round(cy + r * Math.sin(angle)),
        });
      }
      return { id: "circle-stroke", points };
    }

    function makeEllipseStroke(cx = 150, cy = 100, rx = 90, ry = 40, count = 32): Stroke {
      const points: StrokePoint[] = [];
      for (let i = 0; i <= count; i++) {
        const angle = (i / count) * 2 * Math.PI;
        points.push({
          x: Math.round(cx + rx * Math.cos(angle)),
          y: Math.round(cy + ry * Math.sin(angle)),
        });
      }
      return { id: "ellipse-stroke", points };
    }

    function makeRectStroke(x = 10, y = 10, w = 120, h = 80): Stroke {
      const points: StrokePoint[] = [];
      for (let i = 0; i <= 10; i++) points.push({ x: x + (w * i) / 10, y });
      for (let i = 0; i <= 10; i++) points.push({ x: x + w, y: y + (h * i) / 10 });
      for (let i = 0; i <= 10; i++) points.push({ x: x + w - (w * i) / 10, y: y + h });
      for (let i = 0; i <= 10; i++) points.push({ x, y: y + h - (h * i) / 10 });
      return { id: "rect-stroke", points };
    }

    function makeTriangleStroke(cx = 60, topY = 10, w = 100, h = 80): Stroke {
      const points: StrokePoint[] = [];
      const v1 = { x: cx, y: topY };
      const v2 = { x: cx + w / 2, y: topY + h };
      const v3 = { x: cx - w / 2, y: topY + h };

      for (let i = 0; i <= 10; i++) points.push({ x: v1.x + ((v2.x - v1.x) * i) / 10, y: v1.y + ((v2.y - v1.y) * i) / 10 });
      for (let i = 0; i <= 10; i++) points.push({ x: v2.x + ((v3.x - v2.x) * i) / 10, y: v2.y + ((v3.y - v2.y) * i) / 10 });
      for (let i = 0; i <= 10; i++) points.push({ x: v3.x + ((v1.x - v3.x) * i) / 10, y: v3.y + ((v1.y - v3.y) * i) / 10 });
      return { id: "triangle-stroke", points };
    }

    function makeDiamondStroke(cx = 60, cy = 60, rx = 40, ry = 40): Stroke {
      const points: StrokePoint[] = [];
      const v1 = { x: cx, y: cy - ry };
      const v2 = { x: cx + rx, y: cy };
      const v3 = { x: cx, y: cy + ry };
      const v4 = { x: cx - rx, y: cy };

      for (let i = 0; i <= 8; i++) points.push({ x: v1.x + ((v2.x - v1.x) * i) / 8, y: v1.y + ((v2.y - v1.y) * i) / 8 });
      for (let i = 0; i <= 8; i++) points.push({ x: v2.x + ((v3.x - v2.x) * i) / 8, y: v2.y + ((v3.y - v2.y) * i) / 8 });
      for (let i = 0; i <= 8; i++) points.push({ x: v3.x + ((v4.x - v3.x) * i) / 8, y: v3.y + ((v4.y - v3.y) * i) / 8 });
      for (let i = 0; i <= 8; i++) points.push({ x: v4.x + ((v1.x - v4.x) * i) / 8, y: v4.y + ((v1.y - v4.y) * i) / 8 });
      return { id: "diamond-stroke", points };
    }

    function makeLineStroke(x1 = 10, y1 = 10, x2 = 120, y2 = 80): Stroke {
      const points: StrokePoint[] = [];
      for (let i = 0; i <= 15; i++) {
        points.push({ x: x1 + ((x2 - x1) * i) / 15, y: y1 + ((y2 - y1) * i) / 15 });
      }
      return { id: "line-stroke", points };
    }

    it("ShapeRecognizer should recognize circles distinctly from ellipses", () => {
      const circleStroke = makeCircleStroke(100, 100, 50);
      const circleResult = defaultShapeRecognizer.recognize(circleStroke);
      expect(circleResult.shape).toBe("circle");
      expect(circleResult.confidence).toBeGreaterThanOrEqual(0.75);

      const ellipseStroke = makeEllipseStroke(150, 100, 100, 40);
      const ellipseResult = defaultShapeRecognizer.recognize(ellipseStroke);
      expect(ellipseResult.shape).toBe("ellipse");
      expect(ellipseResult.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it("ShapeRecognizer should recognize rectangles, triangles, diamonds, and lines", () => {
      const rectResult = defaultShapeRecognizer.recognize(makeRectStroke(10, 10, 140, 80));
      expect(rectResult.shape).toBe("rectangle");
      expect(rectResult.confidence).toBeGreaterThanOrEqual(0.75);

      const triResult = defaultShapeRecognizer.recognize(makeTriangleStroke(80, 10, 100, 90));
      expect(triResult.shape).toBe("triangle");
      expect(triResult.confidence).toBeGreaterThanOrEqual(0.75);

      const diamondResult = defaultShapeRecognizer.recognize(makeDiamondStroke(60, 60, 45, 45));
      expect(diamondResult.shape).toBe("diamond");
      expect(diamondResult.confidence).toBeGreaterThanOrEqual(0.70);

      const lineResult = defaultShapeRecognizer.recognize(makeLineStroke(10, 10, 150, 10));
      expect(lineResult.shape).toBe("line");
      expect(lineResult.confidence).toBeGreaterThanOrEqual(0.80);
    });

    it("auto-detection should turn a drawn circle into a generic circle, NOT a UML usecase", () => {
      const editor = new DiagramEditor(createDiagram({ id: "gen-auto-1", diagramType: "general" }));
      const circleStroke = makeCircleStroke(100, 100, 50);

      const created = editor.snapStrokeToShape(circleStroke) as any;
      expect(created).toBeDefined();
      expect(created.kind).toBe("generic.circle");
      expect(created.kind).not.toBe("uml.usecase");
      // Drawn shapes should not have UML-specific titles like "Use Case"
      expect(created.labels[0]?.text ?? "").not.toBe("Use Case");
      // Circle width and height should be symmetric
      expect(created.size.width).toBe(created.size.height);
    });

    it("auto-detection should recognize rectangles and triangles into generic common shapes", () => {
      const editor = new DiagramEditor(createDiagram({ id: "gen-auto-2", diagramType: "general" }));

      const rectNode = editor.snapStrokeToShape(makeRectStroke(50, 50, 120, 80)) as any;
      expect(rectNode).toBeDefined();
      expect(rectNode.kind).toBe("generic.rectangle");

      const triNode = editor.snapStrokeToShape(makeTriangleStroke(80, 20, 100, 90)) as any;
      expect(triNode).toBeDefined();
      expect(triNode.kind).toBe("generic.triangle");

      const diamondNode = editor.snapStrokeToShape(makeDiamondStroke(80, 80, 50, 50)) as any;
      expect(diamondNode).toBeDefined();
      expect(diamondNode.kind).toBe("generic.diamond");
    });

    it("should support raw freehand drawing via keepAsFreehand and forceFreehand", () => {
      const editor = new DiagramEditor(createDiagram({ id: "gen-freehand-1", diagramType: "general" }));
      const arbitraryStroke: Stroke = {
        id: "wobbly-squiggle",
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 40 },
          { x: 15, y: 70 },
          { x: 80, y: 25 },
        ],
      };

      // Raw freehand drawing directly kept
      const freehandNode1 = editor.keepAsFreehand(arbitraryStroke);
      expect(freehandNode1.kind).toBe("generic.freehand");
      expect(freehandNode1.customData?.pathData).toBeDefined();
      expect(typeof freehandNode1.customData?.pathData).toBe("string");
      expect((freehandNode1.customData?.pathData as string).startsWith("M")).toBe(true);

      // forceFreehand option in snapStrokeToShape
      const circleStroke = makeCircleStroke(100, 100, 40);
      const freehandNode2 = editor.snapStrokeToShape(circleStroke, { forceFreehand: true }) as any;
      expect(freehandNode2.kind).toBe("generic.freehand");
    });

    it("ShapeRegistry should have shape definitions and geometry perimeter calculation for common shapes", () => {
      expect(defaultShapeRegistry.has("generic.circle")).toBe(true);
      expect(defaultShapeRegistry.has("generic.ellipse")).toBe(true);
      expect(defaultShapeRegistry.has("generic.triangle")).toBe(true);
      expect(defaultShapeRegistry.has("generic.diamond")).toBe(true);
      expect(defaultShapeRegistry.has("generic.rectangle")).toBe(true);
      expect(defaultShapeRegistry.has("generic.freehand")).toBe(true);

      // Triangle perimeter intersection test
      const triBoundary = { position: { x: 0, y: 0 }, size: { width: 100, height: 100 } };
      // Target straight up should intersect top vertex (50, 0)
      const topIntersection = getTrianglePerimeterIntersection(triBoundary, { x: 50, y: -50 });
      expect(topIntersection.x).toBe(50);
      expect(topIntersection.y).toBe(0);

      // Target straight down should intersect bottom edge (y=100)
      const bottomIntersection = getTrianglePerimeterIntersection(triBoundary, { x: 50, y: 200 });
      expect(bottomIntersection.y).toBe(100);
    });
  });
});
