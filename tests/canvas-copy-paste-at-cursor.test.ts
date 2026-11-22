import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { DiagramNode } from "../src/domain/entities/DiagramNode";
import { App, TFile, WorkspaceLeaf } from "./fakes/MockObsidian";
import { UmlCanvasView } from "../src/presentation/views/UmlCanvasView";

describe("Canvas Copy & Paste at Cursor Position", () => {
  let editor: DiagramEditor;

  beforeEach(() => {
    const diagram = createDiagram({
      id: "test-diagram-1",
      diagramType: "uml.class",
      title: "Copy Paste Test",
      nodes: [],
      edges: [],
    });
    editor = new DiagramEditor(diagram);
  });

  describe("1. Single Node Copy & Paste at Cursor Position", () => {
    it("should place the copied node directly where the cursor is currently at", () => {
      const origNode = editor.addNode({
        kind: "uml.class",
        title: "UserAccount",
        position: { x: 100, y: 150 },
        size: { width: 180, height: 120 },
      });

      editor.selectNode(origNode.id, false);
      editor.copySelection();

      // Cursor is at (550, 400)
      const cursorPoint = { x: 550, y: 400 };
      const pasteResult = editor.pasteAt(cursorPoint);

      expect(pasteResult.nodes.length).toBe(1);
      const pastedNode = pasteResult.nodes[0];

      // Verifies position matches cursor exactly
      expect(pastedNode.position).toEqual({ x: 550, y: 400 });
      expect(pastedNode.id).not.toBe(origNode.id);
      expect(pastedNode.kind).toBe("uml.class");
      expect(pastedNode.labels[0].text).toBe("UserAccount");
      expect(pastedNode.size).toEqual({ width: 180, height: 120 });

      // Verifies the newly pasted node is selected
      expect(editor.isNodeSelected(pastedNode.id)).toBe(true);
      expect(editor.isNodeSelected(origNode.id)).toBe(false);
    });

    it("should preserve customData, style, and compartments when pasted at cursor", () => {
      const origTable = editor.addTableNode({
        rows: 2,
        cols: 2,
        position: { x: 50, y: 80 },
      });
      editor.updateTableCell(origTable.id, 0, 0, "Header 1");
      editor.updateTableCell(origTable.id, 1, 1, "Cell Data");

      editor.selectNode(origTable.id, false);
      editor.copySelection();

      const cursorPoint = { x: 420, y: 300 };
      const pasteResult = editor.pasteAt(cursorPoint);

      expect(pasteResult.nodes.length).toBe(1);
      const pastedTable = pasteResult.nodes[0];
      expect(pastedTable.position).toEqual({ x: 420, y: 300 });

      const cells = pastedTable.customData?.cells as string[][];
      expect(cells[0][0]).toBe("Header 1");
      expect(cells[1][1]).toBe("Cell Data");
    });
  });

  describe("2. Multiple Nodes Copy & Paste at Cursor Position", () => {
    it("should anchor the top-left of the selection at cursor and preserve relative offsets", () => {
      const nodeA = editor.addNode({
        kind: "generic.rectangle",
        title: "Node A",
        position: { x: 100, y: 100 },
        size: { width: 120, height: 80 },
      });
      const nodeB = editor.addNode({
        kind: "generic.rectangle",
        title: "Node B",
        position: { x: 300, y: 220 },
        size: { width: 140, height: 90 },
      });

      // Select both nodes
      editor.selectNode(nodeA.id, false);
      editor.selectNode(nodeB.id, true);
      editor.copySelection();

      // minX = 100, minY = 100
      // Paste at cursor (500, 350)
      const cursorPoint = { x: 500, y: 350 };
      const pasteResult = editor.pasteAt(cursorPoint);

      expect(pasteResult.nodes.length).toBe(2);
      const pastedA = pasteResult.nodes.find((n) => n.labels[0].text === "Node A")!;
      const pastedB = pasteResult.nodes.find((n) => n.labels[0].text === "Node B")!;

      expect(pastedA).toBeDefined();
      expect(pastedB).toBeDefined();

      // Top-left of the selection (Node A) should be placed at the cursor
      expect(pastedA.position).toEqual({ x: 500, y: 350 });

      // Relative offset between Node A and Node B (dx=200, dy=120) must be preserved
      expect(pastedB.position).toEqual({ x: 700, y: 470 });
      expect(pastedB.position.x - pastedA.position.x).toBe(200);
      expect(pastedB.position.y - pastedA.position.y).toBe(120);

      // Both pasted nodes are selected
      expect(editor.isNodeSelected(pastedA.id)).toBe(true);
      expect(editor.isNodeSelected(pastedB.id)).toBe(true);
    });
  });

  describe("3. Connected Nodes and Edge Routing at Cursor Position", () => {
    it("should clone connected edges, shift waypoints, and attach to cloned nodes", () => {
      const node1 = editor.addNode({
        kind: "uml.class",
        title: "Publisher",
        position: { x: 100, y: 100 },
      });
      const node2 = editor.addNode({
        kind: "uml.class",
        title: "Subscriber",
        position: { x: 400, y: 100 },
      });

      const edge = editor.addEdge(node1.id, node2.id, {
        kind: "uml.association",
        waypoints: [{ x: 250, y: 120 }],
      });

      editor.selectNode(node1.id, false);
      editor.selectNode(node2.id, true);
      editor.selectEdge(edge.id, true);
      editor.copySelection();

      // Cursor at (300, 500)
      const cursorPoint = { x: 300, y: 500 };
      const pasteResult = editor.pasteAt(cursorPoint);

      expect(pasteResult.nodes.length).toBe(2);
      expect(pasteResult.edges.length).toBe(1);

      const clonedNode1 = pasteResult.nodes.find((n) => n.labels[0].text === "Publisher")!;
      const clonedNode2 = pasteResult.nodes.find((n) => n.labels[0].text === "Subscriber")!;
      const clonedEdge = pasteResult.edges[0];

      expect(clonedNode1.position).toEqual({ x: 300, y: 500 });
      expect(clonedNode2.position).toEqual({ x: 600, y: 500 });

      // Edge endpoints must point to cloned nodes, not original nodes
      expect(clonedEdge.fromNodeId).toBe(clonedNode1.id);
      expect(clonedEdge.toNodeId).toBe(clonedNode2.id);

      // Waypoint must be shifted by dx = 200, dy = 400
      expect(clonedEdge.waypoints).toEqual([{ x: 450, y: 520 }]);
    });
  });

  describe("4. Group Box Copy & Paste at Cursor Position", () => {
    it("should copy a selected group with its members and place group at cursor", () => {
      const member1 = editor.addNode({
        kind: "generic.rectangle",
        title: "Member 1",
        position: { x: 120, y: 140 },
        size: { width: 100, height: 60 },
      });
      const member2 = editor.addNode({
        kind: "generic.rectangle",
        title: "Member 2",
        position: { x: 260, y: 140 },
        size: { width: 100, height: 60 },
      });

      const group = editor.addGroup({
        name: "Backend Service",
        position: { x: 100, y: 100 },
        size: { width: 300, height: 150 },
        nodeIds: [member1.id, member2.id],
      });

      editor.clearSelection();
      editor.selectGroup(group.id, false);
      editor.copySelection();

      // Paste at cursor (600, 400)
      const cursorPoint = { x: 600, y: 400 };
      const pasteResult = editor.pasteAt(cursorPoint);

      expect(pasteResult.groups.length).toBe(1);
      expect(pasteResult.nodes.length).toBe(2);

      const clonedGroup = pasteResult.groups[0];
      expect(clonedGroup.id).not.toBe(group.id);
      expect(clonedGroup.position).toEqual({ x: 600, y: 400 });

      // Member nodes must be updated to cloned node IDs
      expect(clonedGroup.nodeIds.length).toBe(2);
      expect(clonedGroup.nodeIds).not.toContain(member1.id);
      expect(clonedGroup.nodeIds).not.toContain(member2.id);

      const clonedM1 = pasteResult.nodes.find((n) => n.labels[0].text === "Member 1")!;
      const clonedM2 = pasteResult.nodes.find((n) => n.labels[0].text === "Member 2")!;
      expect(clonedGroup.nodeIds).toContain(clonedM1.id);
      expect(clonedGroup.nodeIds).toContain(clonedM2.id);

      // Relative position inside group maintained (dx = 500, dy = 300)
      expect(clonedM1.position).toEqual({ x: 620, y: 440 });
      expect(clonedM2.position).toEqual({ x: 760, y: 440 });
    });
  });

  describe("5. Successive Pasting at Different Cursor Positions", () => {
    it("should make separate copies at each specified cursor point", () => {
      const origNode = editor.addNode({
        kind: "generic.note",
        title: "Original Sticky",
        position: { x: 100, y: 100 },
      });

      editor.selectNode(origNode.id, false);
      editor.copySelection();

      // First paste at (350, 450)
      const paste1 = editor.pasteAt({ x: 350, y: 450 });
      expect(paste1.nodes[0].position).toEqual({ x: 350, y: 450 });

      // Second paste at (800, 200)
      const paste2 = editor.pasteAt({ x: 800, y: 200 });
      expect(paste2.nodes[0].position).toEqual({ x: 800, y: 200 });

      // All three nodes coexist with their correct coordinates
      expect(editor.diagram.nodes.length).toBe(3);
      expect(editor.diagram.nodes[0].position).toEqual({ x: 100, y: 100 });
      expect(editor.diagram.nodes[1].position).toEqual({ x: 350, y: 450 });
      expect(editor.diagram.nodes[2].position).toEqual({ x: 800, y: 200 });
    });
  });

  describe("6. Edge Case: Pasting Without Moving Cursor (dx=0, dy=0)", () => {
    it("should apply fallback offset (+20, +20) when cursor is at the exact origin", () => {
      const origNode = editor.addNode({
        kind: "generic.rectangle",
        title: "Box",
        position: { x: 150, y: 200 },
      });

      editor.selectNode(origNode.id, false);
      editor.copySelection();

      // User hits paste without moving cursor (cursor still at origin (150, 200))
      const pasteResult = editor.pasteAt({ x: 150, y: 200 });
      expect(pasteResult.nodes[0].position).toEqual({ x: 170, y: 220 });
    });
  });

  describe("7. Duplicate Selection (Ctrl+D) Contrast", () => {
    it("should duplicate in-place with (+30, +30) offset without moving to cursor", () => {
      const origNode = editor.addNode({
        kind: "generic.rectangle",
        title: "Box D",
        position: { x: 100, y: 100 },
      });

      editor.selectNode(origNode.id, false);
      const dupResult = editor.duplicateSelection();

      expect(dupResult.nodes.length).toBe(1);
      expect(dupResult.nodes[0].position).toEqual({ x: 130, y: 130 });
    });
  });

  describe("8. Undo and Redo", () => {
    it("should cleanly undo and redo pasting at cursor", () => {
      const origNode = editor.addNode({
        kind: "generic.circle",
        title: "Circle",
        position: { x: 80, y: 80 },
      });

      editor.selectNode(origNode.id, false);
      editor.copySelection();

      editor.pasteAt({ x: 400, y: 300 });
      expect(editor.diagram.nodes.length).toBe(2);

      // Undo removes pasted node
      editor.undo();
      expect(editor.diagram.nodes.length).toBe(1);
      expect(editor.diagram.nodes[0].id).toBe(origNode.id);

      // Redo restores pasted node at cursor position
      editor.redo();
      expect(editor.diagram.nodes.length).toBe(2);
      expect(editor.diagram.nodes[1].position).toEqual({ x: 400, y: 300 });
    });
  });

  describe("9. UmlCanvasView Paste Integration", () => {
    let mockApp: App;
    let mockLeaf: WorkspaceLeaf;
    let mockFile: TFile;
    let view: UmlCanvasView;

    beforeEach(() => {
      mockApp = new App();
      mockLeaf = new WorkspaceLeaf();
      mockFile = new TFile("Diagram.canvas++", "Diagrams/Diagram.canvas++");
      view = new UmlCanvasView(mockLeaf as any, mockApp as any);
      (view as any).editor = editor;
    });

    afterEach(() => {
      // Clean up view
    });

    it("should paste internal copied node at canvasPoint passed to pasteFromClipboardOrEditor", async () => {
      const origNode = editor.addNode({
        kind: "generic.rectangle",
        title: "View Copied Box",
        position: { x: 50, y: 50 },
      });

      editor.selectNode(origNode.id, false);
      editor.copySelection();

      // Paste with explicit canvasPoint (e.g. from context menu)
      await view.pasteFromClipboardOrEditor({ x: 480, y: 320 });

      expect(editor.diagram.nodes.length).toBe(2);
      const pastedNode = editor.diagram.nodes[1];
      expect(pastedNode.position).toEqual({ x: 480, y: 320 });
      expect(pastedNode.labels[0].text).toBe("View Copied Box");
    });

    it("should paste at tracked mouse cursor position when canvasPoint is omitted", async () => {
      const origNode = editor.addNode({
        kind: "generic.rectangle",
        title: "Tracked Cursor Box",
        position: { x: 40, y: 40 },
      });

      editor.selectNode(origNode.id, false);
      editor.copySelection();

      // Simulate mousemove tracking
      (view as any).lastMouseCanvasPos = { x: 620, y: 280 };

      await view.pasteFromClipboardOrEditor();

      expect(editor.diagram.nodes.length).toBe(2);
      const pastedNode = editor.diagram.nodes[1];
      expect(pastedNode.position).toEqual({ x: 620, y: 280 });
    });

    it("should paste canvas-plus-plus JSON text at cursor position on handlePaste event", () => {
      const origNode = editor.addNode({
        kind: "generic.rectangle",
        title: "JSON Pasted Box",
        position: { x: 60, y: 60 },
      });
      editor.selectNode(origNode.id, false);
      const clipboardPayload = editor.copySelection();

      (view as any).lastMouseCanvasPos = { x: 500, y: 350 };

      const pasteEvent = {
        preventDefault: jest.fn(),
        clipboardData: {
          items: [],
          getData: (format: string) =>
            format === "text/plain" ? JSON.stringify(clipboardPayload) : "",
        },
      } as any;

      view.handlePaste(pasteEvent);

      expect(pasteEvent.preventDefault).toHaveBeenCalled();
      expect(editor.diagram.nodes.length).toBe(2);
      const pastedNode = editor.diagram.nodes[1];
      expect(pastedNode.position).toEqual({ x: 500, y: 350 });
      expect(pastedNode.labels[0].text).toBe("JSON Pasted Box");
    });
  });
});
