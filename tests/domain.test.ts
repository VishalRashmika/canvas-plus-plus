import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { Diagram, createDiagram } from "../src/domain/entities/Diagram";
import { resolveCanvasColor, CANVAS_COLOR_PRESETS } from "../src/domain/value-objects/CanvasColor";
import { JsonCanvasSerializer } from "../src/infrastructure/persistence/JsonCanvasSerializer";
import { defaultCustomChipRegistry } from "../src/domain/services/CustomChipRegistry";
import { defaultDiagramTypeRegistry } from "../src/domain/services/DiagramTypeRegistry";
import { createPort } from "../src/domain/entities/Port";
import { createChipInterfaceDefinition } from "../src/domain/entities/ChipInterfaceDefinition";

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
      expect(types.map((t) => t.id)).toContain("uml.class");
      expect(types.map((t) => t.id)).toContain("uml.sequence");
      expect(types.map((t) => t.id)).toContain("uml.component");
    });
  });
});
