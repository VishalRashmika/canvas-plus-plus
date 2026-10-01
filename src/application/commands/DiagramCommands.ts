import { Diagram } from "../../domain/entities/Diagram";
import { DiagramNode } from "../../domain/entities/DiagramNode";
import { DiagramEdge } from "../../domain/entities/DiagramEdge";
import { Label } from "../../domain/entities/Label";
import { Layer } from "../../domain/entities/Layer";
import { Group, createGroup } from "../../domain/entities/Group";
import { Port } from "../../domain/entities/Port";
import { Compartment } from "../../domain/entities/Compartment";
import { Point } from "../../domain/value-objects/Point";
import { Size } from "../../domain/value-objects/Rect";
import { EdgeRouting, DiagramTypeId, Side } from "../../domain/types";
import { Command } from "./Command";
import {
  SequenceLayoutEngine,
  SequenceLayoutOptions,
  SequenceLayoutResult,
  defaultSequenceLayoutEngine,
} from "../../domain/services/SequenceLayoutEngine";
import { ChipInterfaceDefinition } from "../../domain/entities/ChipInterfaceDefinition";
import { defaultChipService } from "../../domain/services/ChipService";

export class AddNodeCommand implements Command {
  readonly description = "Add node";

  constructor(
    private readonly diagram: Diagram,
    private readonly node: DiagramNode
  ) {}

  execute(): void {
    if (!this.diagram.nodes.some((n) => n.id === this.node.id)) {
      this.diagram.nodes.push(this.node);
    }
  }

  undo(): void {
    const idx = this.diagram.nodes.findIndex((n) => n.id === this.node.id);
    if (idx !== -1) {
      this.diagram.nodes.splice(idx, 1);
    }
  }
}

export class DeleteNodesAndEdgesCommand implements Command {
  readonly description = "Delete nodes and edges";

  private removedNodes: DiagramNode[] = [];
  private removedEdges: DiagramEdge[] = [];

  constructor(
    private readonly diagram: Diagram,
    private readonly targetNodeIds: string[],
    private readonly targetEdgeIds: string[] = []
  ) {}

  execute(): void {
    const nodeSet = new Set(this.targetNodeIds);
    const edgeSet = new Set(this.targetEdgeIds);

    this.removedNodes = this.diagram.nodes.filter((n) => nodeSet.has(n.id));

    // Also remove edges that are connected to deleted nodes or in targetEdgeIds
    this.removedEdges = this.diagram.edges.filter(
      (e) =>
        edgeSet.has(e.id) ||
        nodeSet.has(e.fromNodeId) ||
        nodeSet.has(e.toNodeId)
    );

    const removedEdgeIds = new Set(this.removedEdges.map((e) => e.id));

    this.diagram.nodes = this.diagram.nodes.filter((n) => !nodeSet.has(n.id));
    this.diagram.edges = this.diagram.edges.filter(
      (e) => !removedEdgeIds.has(e.id)
    );
  }

  undo(): void {
    // Restore nodes
    for (const node of this.removedNodes) {
      if (!this.diagram.nodes.some((n) => n.id === node.id)) {
        this.diagram.nodes.push(node);
      }
    }

    // Restore edges
    for (const edge of this.removedEdges) {
      if (!this.diagram.edges.some((e) => e.id === edge.id)) {
        this.diagram.edges.push(edge);
      }
    }
  }
}

export interface NodeMove {
  nodeId: string;
  oldPos: Point;
  newPos: Point;
}

export class MoveNodesCommand implements Command {
  readonly description = "Move nodes";

  constructor(
    private readonly diagram: Diagram,
    private readonly moves: NodeMove[]
  ) {}

  execute(): void {
    for (const move of this.moves) {
      const node = this.diagram.nodes.find((n) => n.id === move.nodeId);
      if (node) {
        node.position = { x: move.newPos.x, y: move.newPos.y };
      }
    }
  }

  undo(): void {
    for (const move of this.moves) {
      const node = this.diagram.nodes.find((n) => n.id === move.nodeId);
      if (node) {
        node.position = { x: move.oldPos.x, y: move.oldPos.y };
      }
    }
  }
}

export interface NodeGeometry {
  position: Point;
  size: Size;
}

export class ResizeNodeCommand implements Command {
  readonly description = "Resize node";

  constructor(
    private readonly diagram: Diagram,
    private readonly nodeId: string,
    private readonly oldGeometry: NodeGeometry,
    private readonly newGeometry: NodeGeometry
  ) {}

  execute(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node) {
      node.position = { ...this.newGeometry.position };
      node.size = { ...this.newGeometry.size };
    }
  }

  undo(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node) {
      node.position = { ...this.oldGeometry.position };
      node.size = { ...this.oldGeometry.size };
    }
  }
}

export class AddEdgeCommand implements Command {
  readonly description = "Add edge";

  constructor(
    private readonly diagram: Diagram,
    private readonly edge: DiagramEdge
  ) {}

  execute(): void {
    if (!this.diagram.edges.some((e) => e.id === this.edge.id)) {
      this.diagram.edges.push(this.edge);
    }
  }

  undo(): void {
    const idx = this.diagram.edges.findIndex((e) => e.id === this.edge.id);
    if (idx !== -1) {
      this.diagram.edges.splice(idx, 1);
    }
  }
}

export class DeleteEdgesCommand implements Command {
  readonly description = "Delete edges";

  private removedEdges: DiagramEdge[] = [];

  constructor(
    private readonly diagram: Diagram,
    private readonly targetEdgeIds: string[]
  ) {}

  execute(): void {
    const edgeSet = new Set(this.targetEdgeIds);
    this.removedEdges = this.diagram.edges.filter((e) => edgeSet.has(e.id));
    this.diagram.edges = this.diagram.edges.filter((e) => !edgeSet.has(e.id));
  }

  undo(): void {
    for (const edge of this.removedEdges) {
      if (!this.diagram.edges.some((e) => e.id === edge.id)) {
        this.diagram.edges.push(edge);
      }
    }
  }
}

export class UpdateNodeLabelCommand implements Command {
  readonly description = "Update node label";

  private oldLabels: Label[] = [];
  private newLabels: Label[] = [];

  constructor(
    private readonly diagram: Diagram,
    private readonly nodeId: string,
    private readonly newText: string,
    private readonly labelIndex = 0
  ) {}

  execute(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (!node) return;

    this.oldLabels = node.labels.map((l) => ({ ...l }));

    const updatedLabels = [...node.labels];
    if (updatedLabels[this.labelIndex]) {
      updatedLabels[this.labelIndex] = {
        ...updatedLabels[this.labelIndex],
        text: this.newText,
      };
    } else {
      updatedLabels.push({
        id: `label-${Date.now()}`,
        text: this.newText,
        anchor: "node",
        position: { x: 0, y: 0 },
      });
    }

    node.labels = updatedLabels;
    this.newLabels = updatedLabels;
  }

  undo(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node) {
      node.labels = this.oldLabels.map((l) => ({ ...l }));
    }
  }
}

export class CompoundCommand implements Command {
  constructor(
    private readonly commands: Command[],
    public readonly description = "Compound operation"
  ) {}

  execute(): void {
    for (const cmd of this.commands) {
      cmd.execute();
    }
  }

  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }
}

export class GroupSelectionCommand implements Command {
  readonly description = "Group selection";
  private createdGroup: Group;

  constructor(
    private readonly diagram: Diagram,
    groupId: string,
    name: string,
    nodeIds: string[],
    position?: Point,
    size?: Size,
    color?: string
  ) {
    this.createdGroup = createGroup({ id: groupId, name, nodeIds, position, size, color });
  }

  execute(): void {
    this.diagram.groups.push(this.createdGroup);
  }

  undo(): void {
    const idx = this.diagram.groups.findIndex((g) => g.id === this.createdGroup.id);
    if (idx !== -1) {
      this.diagram.groups.splice(idx, 1);
    }
  }
}

export class UngroupSelectionCommand implements Command {
  readonly description = "Ungroup";
  private removedGroups: Group[] = [];

  constructor(
    private readonly diagram: Diagram,
    private readonly groupIds: string[]
  ) {}

  execute(): void {
    const set = new Set(this.groupIds);
    this.removedGroups = this.diagram.groups.filter((g) => set.has(g.id));
    this.diagram.groups = this.diagram.groups.filter((g) => !set.has(g.id));
  }

  undo(): void {
    for (const g of this.removedGroups) {
      if (!this.diagram.groups.some((existing) => existing.id === g.id)) {
        this.diagram.groups.push(g);
      }
    }
  }
}

export class RenameGroupCommand implements Command {
  readonly description = "Rename group";
  private readonly previousName: string;

  constructor(
    private readonly group: Group,
    private readonly newName: string
  ) {
    this.previousName = group.name;
  }

  execute(): void {
    this.group.name = this.newName;
  }

  undo(): void {
    this.group.name = this.previousName;
  }
}

export class MoveGroupCommand implements Command {
  readonly description = "Move group";
  private oldNodePositions: Map<string, Point> = new Map();
  private oldGroupPosition?: Point;

  constructor(
    private readonly diagram: Diagram,
    private readonly groupId: string,
    private readonly delta: Point
  ) {
    const group = this.diagram.groups.find((g) => g.id === this.groupId);
    if (group) {
      this.oldGroupPosition = group.position ? { ...group.position } : undefined;
      for (const nid of group.nodeIds) {
        const node = this.diagram.nodes.find((n) => n.id === nid);
        if (node) {
          this.oldNodePositions.set(nid, { ...node.position });
        }
      }
    }
  }

  execute(): void {
    const group = this.diagram.groups.find((g) => g.id === this.groupId);
    if (!group) return;

    if (group.position) {
      group.position = {
        x: group.position.x + this.delta.x,
        y: group.position.y + this.delta.y,
      };
    }

    for (const nid of group.nodeIds) {
      const node = this.diagram.nodes.find((n) => n.id === nid);
      if (node) {
        node.position = {
          x: node.position.x + this.delta.x,
          y: node.position.y + this.delta.y,
        };
      }
    }
  }

  undo(): void {
    const group = this.diagram.groups.find((g) => g.id === this.groupId);
    if (group) {
      group.position = this.oldGroupPosition ? { ...this.oldGroupPosition } : undefined;
    }

    for (const [nid, oldPos] of this.oldNodePositions) {
      const node = this.diagram.nodes.find((n) => n.id === nid);
      if (node) {
        node.position = { ...oldPos };
      }
    }
  }
}

export class ResizeGroupCommand implements Command {
  readonly description = "Resize group";
  private oldPosition?: Point;
  private oldSize?: Size;

  constructor(
    private readonly group: Group,
    private readonly newPosition: Point,
    private readonly newSize: Size
  ) {
    this.oldPosition = group.position ? { ...group.position } : undefined;
    this.oldSize = group.size ? { ...group.size } : undefined;
  }

  execute(): void {
    this.group.position = { ...this.newPosition };
    this.group.size = { ...this.newSize };
  }

  undo(): void {
    this.group.position = this.oldPosition ? { ...this.oldPosition } : undefined;
    this.group.size = this.oldSize ? { ...this.oldSize } : undefined;
  }
}

export class ToggleGroupCollapseCommand implements Command {
  readonly description = "Toggle group collapse";

  constructor(private readonly group: Group) {}

  execute(): void {
    this.group.collapsed = !this.group.collapsed;
  }

  undo(): void {
    this.group.collapsed = !this.group.collapsed;
  }
}

export class UpdateGroupMembershipCommand implements Command {
  readonly description = "Update group membership";
  private oldNodeIds: string[];

  constructor(
    private readonly group: Group,
    private readonly newNodeIds: string[]
  ) {
    this.oldNodeIds = [...group.nodeIds];
  }

  execute(): void {
    this.group.nodeIds = [...this.newNodeIds];
  }

  undo(): void {
    this.group.nodeIds = [...this.oldNodeIds];
  }
}

export class ToggleGroupLockCommand implements Command {
  readonly description = "Toggle group lock";

  constructor(private readonly group: Group) {}

  execute(): void {
    this.group.locked = !this.group.locked;
  }

  undo(): void {
    this.group.locked = !this.group.locked;
  }
}

export class CreateLayerCommand implements Command {
  readonly description = "Create layer";

  constructor(
    private readonly diagram: Diagram,
    private readonly layer: Layer
  ) {}

  execute(): void {
    this.diagram.layers.push(this.layer);
  }

  undo(): void {
    const idx = this.diagram.layers.findIndex((l) => l.id === this.layer.id);
    if (idx !== -1) {
      this.diagram.layers.splice(idx, 1);
    }
  }
}

export class DeleteLayerCommand implements Command {
  readonly description = "Delete layer";
  private removedLayer: Layer | null = null;

  constructor(
    private readonly diagram: Diagram,
    private readonly layerId: string
  ) {}

  execute(): void {
    const idx = this.diagram.layers.findIndex((l) => l.id === this.layerId);
    if (idx !== -1) {
      this.removedLayer = this.diagram.layers[idx];
      this.diagram.layers.splice(idx, 1);
    }
  }

  undo(): void {
    if (this.removedLayer) {
      this.diagram.layers.push(this.removedLayer);
    }
  }
}

export class ToggleLayerVisibilityCommand implements Command {
  readonly description = "Toggle layer visibility";

  constructor(
    private readonly diagram: Diagram,
    private readonly layerId: string
  ) {}

  execute(): void {
    const layer = this.diagram.layers.find((l) => l.id === this.layerId);
    if (layer) {
      layer.visible = !layer.visible;
    }
  }

  undo(): void {
    this.execute(); // toggling again inverts back
  }
}

export class ToggleLayerLockCommand implements Command {
  readonly description = "Toggle layer lock";

  constructor(
    private readonly diagram: Diagram,
    private readonly layerId: string
  ) {}

  execute(): void {
    const layer = this.diagram.layers.find((l) => l.id === this.layerId);
    if (layer) {
      layer.locked = !layer.locked;
    }
  }

  undo(): void {
    this.execute();
  }
}

export class AssignNodesToLayerCommand implements Command {
  readonly description = "Assign nodes to layer";
  private previousAssignments = new Map<string, string | null>();

  constructor(
    private readonly diagram: Diagram,
    private readonly nodeIds: string[],
    private readonly targetLayerId: string
  ) {}

  execute(): void {
    this.previousAssignments.clear();

    for (const nodeId of this.nodeIds) {
      const prev = this.diagram.layers.find((l) => l.nodeIds.includes(nodeId));
      this.previousAssignments.set(nodeId, prev ? prev.id : null);
      if (prev) {
        prev.nodeIds = prev.nodeIds.filter((id) => id !== nodeId);
      }
    }

    const targetLayer = this.diagram.layers.find((l) => l.id === this.targetLayerId);
    if (targetLayer) {
      for (const nodeId of this.nodeIds) {
        if (!targetLayer.nodeIds.includes(nodeId)) {
          targetLayer.nodeIds.push(nodeId);
        }
      }
    }
  }

  undo(): void {
    const targetLayer = this.diagram.layers.find((l) => l.id === this.targetLayerId);
    if (targetLayer) {
      targetLayer.nodeIds = targetLayer.nodeIds.filter((id) => !this.nodeIds.includes(id));
    }

    for (const [nodeId, prevLayerId] of this.previousAssignments.entries()) {
      if (prevLayerId) {
        const prev = this.diagram.layers.find((l) => l.id === prevLayerId);
        if (prev && !prev.nodeIds.includes(nodeId)) {
          prev.nodeIds.push(nodeId);
        }
      }
    }
  }
}

export class AddPortCommand implements Command {
  readonly description = "Add port";

  constructor(
    private readonly diagram: Diagram,
    private readonly nodeId: string,
    private readonly port: Port
  ) {}

  execute(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node && !node.ports.some((p) => p.id === this.port.id)) {
      node.ports.push(this.port);
    }
  }

  undo(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node) {
      node.ports = node.ports.filter((p) => p.id !== this.port.id);
    }
  }
}

export class UpdateCompartmentsCommand implements Command {
  readonly description = "Update compartments";
  private previousCompartments?: Compartment[];

  constructor(
    private readonly diagram: Diagram,
    private readonly nodeId: string,
    private readonly newCompartments: Compartment[]
  ) {}

  execute(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node) {
      this.previousCompartments = node.compartments
        ? JSON.parse(JSON.stringify(node.compartments))
        : undefined;
      node.compartments = JSON.parse(JSON.stringify(this.newCompartments));
    }
  }

  undo(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node) {
      node.compartments = this.previousCompartments
        ? JSON.parse(JSON.stringify(this.previousCompartments))
        : undefined;
    }
  }
}

export class UpdateStereotypeAndTaggedValuesCommand implements Command {
  readonly description = "Update stereotype and tagged values";
  private prevStereotype?: string;
  private prevTaggedValues?: Record<string, string>;

  constructor(
    private readonly diagram: Diagram,
    private readonly nodeId: string,
    private readonly newStereotype?: string,
    private readonly newTaggedValues?: Record<string, string>
  ) {}

  execute(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node) {
      this.prevStereotype = node.stereotype;
      this.prevTaggedValues = node.taggedValues ? { ...node.taggedValues } : undefined;
      node.stereotype = this.newStereotype;
      node.taggedValues = this.newTaggedValues ? { ...this.newTaggedValues } : undefined;
    }
  }

  undo(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node) {
      node.stereotype = this.prevStereotype;
      node.taggedValues = this.prevTaggedValues ? { ...this.prevTaggedValues } : undefined;
    }
  }
}

export class UpdateEdgeMultiplicityCommand implements Command {
  readonly description = "Update edge multiplicity";
  private prevSource?: string;
  private prevTarget?: string;

  constructor(
    private readonly diagram: Diagram,
    private readonly edgeId: string,
    private readonly sourceMultiplicity?: string,
    private readonly targetMultiplicity?: string
  ) {}

  execute(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (edge) {
      this.prevSource = edge.multiplicitySource;
      this.prevTarget = edge.multiplicityTarget;
      edge.multiplicitySource = this.sourceMultiplicity;
      edge.multiplicityTarget = this.targetMultiplicity;
    }
  }

  undo(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (edge) {
      edge.multiplicitySource = this.prevSource;
      edge.multiplicityTarget = this.prevTarget;
    }
  }
}

export class AddEdgeLabelCommand implements Command {
  readonly description = "Add edge label";
  private label: Label;

  constructor(
    private readonly diagram: Diagram,
    private readonly edgeId: string,
    labelId: string,
    text: string,
    position: Point = { x: 0, y: -10 }
  ) {
    this.label = {
      id: labelId,
      text,
      anchor: "edge",
      position,
    };
  }

  execute(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (edge) {
      edge.labels.push(this.label);
    }
  }

  undo(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (edge) {
      edge.labels = edge.labels.filter((l) => l.id !== this.label.id);
    }
  }
}

export class UpdateEdgeLabelCommand implements Command {
  readonly description = "Update edge label";

  private oldLabels: Label[] = [];

  constructor(
    private readonly diagram: Diagram,
    private readonly edgeId: string,
    private readonly newText: string,
    private readonly labelIndex = 0
  ) {}

  execute(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (!edge) return;

    this.oldLabels = (edge.labels || []).map((l) => ({ ...l }));

    const updatedLabels = [...(edge.labels || [])];
    const trimmed = this.newText.trim();

    if (trimmed === "") {
      if (updatedLabels[this.labelIndex]) {
        updatedLabels.splice(this.labelIndex, 1);
      }
    } else if (updatedLabels[this.labelIndex]) {
      updatedLabels[this.labelIndex] = {
        ...updatedLabels[this.labelIndex],
        text: trimmed,
      };
    } else {
      updatedLabels.push({
        id: `label-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        text: trimmed,
        anchor: "edge",
        position: { x: 0, y: -10 },
      });
    }

    edge.labels = updatedLabels;
  }

  undo(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (!edge) return;
    edge.labels = this.oldLabels.map((l) => ({ ...l }));
  }
}

export class UpdateEdgeRoutingCommand implements Command {
  readonly description = "Update edge routing";
  private prevRouting?: EdgeRouting;

  constructor(
    private readonly diagram: Diagram,
    private readonly edgeId: string,
    private readonly newRouting: EdgeRouting
  ) {}

  execute(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (edge) {
      this.prevRouting = edge.routing;
      edge.routing = this.newRouting;
    }
  }

  undo(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (edge && this.prevRouting) {
      edge.routing = this.prevRouting;
    }
  }
}

export interface ReconnectEndpointParams {
  nodeId: string;
  portId?: string;
  side?: Side;
}

export class ReconnectEdgeCommand implements Command {
  readonly description = "Reconnect edge endpoint";
  private prevFrom: { nodeId: string; portId?: string; side?: Side };
  private prevTo: { nodeId: string; portId?: string; side?: Side };

  constructor(
    private readonly diagram: Diagram,
    private readonly edgeId: string,
    private readonly endpoint: "source" | "target",
    private readonly target: ReconnectEndpointParams
  ) {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    this.prevFrom = {
      nodeId: edge?.fromNodeId ?? "",
      portId: edge?.fromPortId,
      side: edge?.fromSide,
    };
    this.prevTo = {
      nodeId: edge?.toNodeId ?? "",
      portId: edge?.toPortId,
      side: edge?.toSide,
    };
  }

  execute(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (!edge) return;
    if (this.endpoint === "source") {
      edge.fromNodeId = this.target.nodeId;
      edge.fromPortId = this.target.portId;
      edge.fromSide = this.target.side;
    } else {
      edge.toNodeId = this.target.nodeId;
      edge.toPortId = this.target.portId;
      edge.toSide = this.target.side;
    }
  }

  undo(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (!edge) return;
    if (this.endpoint === "source") {
      edge.fromNodeId = this.prevFrom.nodeId;
      edge.fromPortId = this.prevFrom.portId;
      edge.fromSide = this.prevFrom.side;
    } else {
      edge.toNodeId = this.prevTo.nodeId;
      edge.toPortId = this.prevTo.portId;
      edge.toSide = this.prevTo.side;
    }
  }
}

export class UpdateEdgeWaypointsCommand implements Command {
  readonly description = "Update edge waypoints";
  private prevWaypoints?: Point[];

  constructor(
    private readonly diagram: Diagram,
    private readonly edgeId: string,
    private readonly newWaypoints?: Point[]
  ) {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    this.prevWaypoints = edge?.waypoints ? edge.waypoints.map((p) => ({ ...p })) : undefined;
  }

  execute(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (edge) {
      edge.waypoints = this.newWaypoints ? this.newWaypoints.map((p) => ({ ...p })) : undefined;
    }
  }

  undo(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (edge) {
      edge.waypoints = this.prevWaypoints ? this.prevWaypoints.map((p) => ({ ...p })) : undefined;
    }
  }
}

export class SwitchDiagramTypeCommand implements Command {
  readonly description = "Switch diagram type";
  private prevType: DiagramTypeId;

  constructor(
    private readonly diagram: Diagram,
    private readonly newType: DiagramTypeId
  ) {
    this.prevType = diagram.diagramType;
  }

  execute(): void {
    this.prevType = this.diagram.diagramType;
    this.diagram.diagramType = this.newType;
  }

  undo(): void {
    this.diagram.diagramType = this.prevType;
  }
}

export class AutoResizeNodeCommand implements Command {
  readonly description = "Auto-resize node";
  private prevSize?: Size;

  constructor(
    private readonly diagram: Diagram,
    private readonly nodeId: string,
    private readonly targetSize: Size
  ) {}

  execute(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node) {
      this.prevSize = { ...node.size };
      node.size = { ...this.targetSize };
    }
  }

  undo(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node && this.prevSize) {
      node.size = { ...this.prevSize };
    }
  }
}

export class LayoutSequenceDiagramCommand implements Command {
  readonly description = "Layout sequence diagram";
  private previousNodeState: Array<{
    id: string;
    position: Point;
    size: Size;
    metadata: Record<string, unknown>;
  }> = [];
  private previousEdgeState: Array<{
    id: string;
    waypoints?: Point[];
    routing: EdgeRouting;
    sequenceOrder?: number;
  }> = [];
  result?: SequenceLayoutResult;

  constructor(
    private readonly diagram: Diagram,
    private readonly options?: SequenceLayoutOptions
  ) {}

  execute(): void {
    this.previousNodeState = this.diagram.nodes.map((n) => ({
      id: n.id,
      position: { ...n.position },
      size: { ...n.size },
      metadata: { ...n.metadata },
    }));
    this.previousEdgeState = this.diagram.edges.map((e) => ({
      id: e.id,
      waypoints: e.waypoints ? e.waypoints.map((p) => ({ ...p })) : undefined,
      routing: e.routing,
      sequenceOrder: e.sequenceOrder,
    }));

    const engine = this.options
      ? new SequenceLayoutEngine(this.options)
      : defaultSequenceLayoutEngine;
    this.result = engine.layout(this.diagram);
  }

  undo(): void {
    for (const saved of this.previousNodeState) {
      const node = this.diagram.nodes.find((n) => n.id === saved.id);
      if (node) {
        node.position = { ...saved.position };
        node.size = { ...saved.size };
        node.metadata = { ...saved.metadata };
      }
    }
    for (const saved of this.previousEdgeState) {
      const edge = this.diagram.edges.find((e) => e.id === saved.id);
      if (edge) {
        edge.waypoints = saved.waypoints
          ? saved.waypoints.map((p) => ({ ...p }))
          : undefined;
        edge.routing = saved.routing;
        edge.sequenceOrder = saved.sequenceOrder;
      }
    }
  }
}

export interface ColorTargetItems {
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
  groups?: Group[];
}

export class SetColorCommand implements Command {
  readonly description = "Set color";
  private previousNodeColors: Map<string, string | undefined> = new Map();
  private previousEdgeColors: Map<string, string | undefined> = new Map();
  private previousGroupColors: Map<string, string | undefined> = new Map();

  constructor(
    private readonly targets: ColorTargetItems,
    private readonly newColor: string | undefined
  ) {
    if (targets.nodes) {
      for (const node of targets.nodes) {
        this.previousNodeColors.set(node.id, node.style?.color);
      }
    }
    if (targets.edges) {
      for (const edge of targets.edges) {
        this.previousEdgeColors.set(edge.id, edge.style?.color);
      }
    }
    if (targets.groups) {
      for (const group of targets.groups) {
        this.previousGroupColors.set(group.id, group.color);
      }
    }
  }

  execute(): void {
    if (this.targets.nodes) {
      for (const node of this.targets.nodes) {
        if (!node.style) {
          node.style = {};
        }
        if (this.newColor) {
          node.style.color = this.newColor;
        } else {
          delete node.style.color;
        }
      }
    }
    if (this.targets.edges) {
      for (const edge of this.targets.edges) {
        if (!edge.style) {
          edge.style = {};
        }
        if (this.newColor) {
          edge.style.color = this.newColor;
        } else {
          delete edge.style.color;
        }
      }
    }
    if (this.targets.groups) {
      for (const group of this.targets.groups) {
        group.color = this.newColor;
      }
    }
  }

  undo(): void {
    if (this.targets.nodes) {
      for (const node of this.targets.nodes) {
        const prev = this.previousNodeColors.get(node.id);
        if (!node.style) {
          node.style = {};
        }
        if (prev) {
          node.style.color = prev;
        } else {
          delete node.style.color;
        }
      }
    }
    if (this.targets.edges) {
      for (const edge of this.targets.edges) {
        const prev = this.previousEdgeColors.get(edge.id);
        if (!edge.style) {
          edge.style = {};
        }
        if (prev) {
          edge.style.color = prev;
        } else {
          delete edge.style.color;
        }
      }
    }
    if (this.targets.groups) {
      for (const group of this.targets.groups) {
        group.color = this.previousGroupColors.get(group.id);
      }
    }
  }
}

export class UpdateChipNodeCommand implements Command {
  readonly description = "Update chip interface";

  private prevPorts: Port[] = [];
  private prevSize: Size = { width: 140, height: 80 };
  private prevTitle = "";
  private prevMetadata: Record<string, unknown> = {};

  constructor(
    private readonly diagram: Diagram,
    private readonly nodeId: string,
    private readonly updatedInterface: ChipInterfaceDefinition
  ) {}

  execute(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (!node) return;

    this.prevPorts = node.ports.map((p) => ({ ...p }));
    this.prevSize = { ...node.size };
    this.prevTitle = node.labels[0]?.text ?? "";
    this.prevMetadata = { ...node.metadata };

    // Update title
    if (node.labels[0]) {
      node.labels[0].text = this.updatedInterface.name;
    }

    // Update metadata
    node.metadata = {
      ...node.metadata,
      chipInterfaceId: this.updatedInterface.id,
      chipInterfaceVersion: this.updatedInterface.version,
    };

    // Synchronize ports
    const existingPorts = node.ports;
    const newPorts: Port[] = [];

    for (const ifacePort of this.updatedInterface.ports) {
      const expectedInstancePortId = `${node.id}-port-${ifacePort.id}`;
      const existing = existingPorts.find(
        (p) => p.id === expectedInstancePortId || p.name === ifacePort.name
      );

      if (existing) {
        existing.name = ifacePort.name;
        existing.side = ifacePort.side;
        existing.offset = ifacePort.offset;
        existing.direction = ifacePort.direction;
        existing.dataType = ifacePort.dataType;
        newPorts.push(existing);
      } else {
        newPorts.push({
          ...ifacePort,
          id: expectedInstancePortId,
          ownerNodeId: node.id,
        });
      }
    }
    node.ports = newPorts;

    // Recalculate size to fit pins and labels
    const leftCount = newPorts.filter((p) => p.side === "left").length;
    const rightCount = newPorts.filter((p) => p.side === "right").length;
    const topCount = newPorts.filter((p) => p.side === "top").length;
    const bottomCount = newPorts.filter((p) => p.side === "bottom").length;

    const maxVertical = Math.max(leftCount, rightCount, 1);
    const maxHorizontal = Math.max(topCount, bottomCount, 1);

    const maxLeftLabelLen = Math.max(
      0,
      ...newPorts
        .filter((p) => p.side === "left")
        .map((p) => (p.name + (p.dataType ? ` [${p.dataType}]` : "")).length)
    );
    const maxRightLabelLen = Math.max(
      0,
      ...newPorts
        .filter((p) => p.side === "right")
        .map((p) => (p.name + (p.dataType ? ` [${p.dataType}]` : "")).length)
    );
    const titleLen = this.updatedInterface.name.length;
    const estimatedWidthNeeded = Math.max(
      140,
      (maxHorizontal + 1) * 36,
      (maxLeftLabelLen + maxRightLabelLen) * 7.5 + titleLen * 7 + 40
    );

    const calculatedHeight = Math.max(80, (maxVertical + 1) * 26);
    const calculatedWidth = Math.round(estimatedWidthNeeded);

    node.size = {
      width: Math.max(node.size.width, calculatedWidth),
      height: Math.max(node.size.height, calculatedHeight),
    };
  }

  undo(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (!node) return;

    node.ports = this.prevPorts.map((p) => ({ ...p }));
    node.size = { ...this.prevSize };
    if (node.labels[0]) {
      node.labels[0].text = this.prevTitle;
    }
    node.metadata = { ...this.prevMetadata };
  }
}

export class PropagateChipInterfaceCommand implements Command {
  readonly description = "Propagate chip interface";

  private previousNodesSnapshot: Array<{
    id: string;
    ports: Port[];
    size: Size;
    title: string;
    metadata: Record<string, unknown>;
  }> = [];

  constructor(
    private readonly diagram: Diagram,
    private readonly updatedInterface: ChipInterfaceDefinition,
    private readonly previousInterface?: ChipInterfaceDefinition
  ) {}

  execute(): void {
    const instances = this.diagram.nodes.filter(
      (n) =>
        n.kind === "schematic.chip" &&
        n.metadata?.chipInterfaceId === this.updatedInterface.id
    );

    this.previousNodesSnapshot = instances.map((node) => ({
      id: node.id,
      ports: node.ports.map((p) => ({ ...p })),
      size: { ...node.size },
      title: node.labels[0]?.text ?? "",
      metadata: { ...node.metadata },
    }));

    defaultChipService.propagateChipInterface(
      this.diagram,
      this.updatedInterface,
      this.previousInterface
    );
  }

  undo(): void {
    for (const snap of this.previousNodesSnapshot) {
      const node = this.diagram.nodes.find((n) => n.id === snap.id);
      if (node) {
        node.ports = snap.ports.map((p) => ({ ...p }));
        node.size = { ...snap.size };
        if (node.labels[0]) {
          node.labels[0].text = snap.title;
        }
        node.metadata = { ...snap.metadata };
      }
    }
  }
}



