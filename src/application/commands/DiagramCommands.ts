import { Diagram } from "../../domain/entities/Diagram";
import { DiagramNode } from "../../domain/entities/DiagramNode";
import { DiagramEdge, EdgeStyle } from "../../domain/entities/DiagramEdge";
import { Label, TextStyle } from "../../domain/entities/Label";
import { Layer } from "../../domain/entities/Layer";
import { Group, createGroup } from "../../domain/entities/Group";
import { Port } from "../../domain/entities/Port";
import { Compartment } from "../../domain/entities/Compartment";
import { Point, point } from "../../domain/value-objects/Point";
import { Rect, Size, rect, size, contains, center } from "../../domain/value-objects/Rect";
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
import { getNodeFontStyle } from "../../presentation/theme/Typography";
import { wrapTextToLines } from "../../domain/services/TextMeasurement";

export class AddNodeCommand implements Command {
  readonly description = "Add node";
  private addedToGroupId?: string;

  constructor(
    private readonly diagram: Diagram,
    private readonly node: DiagramNode
  ) {}

  execute(): void {
    if (!this.diagram.nodes.some((n) => n.id === this.node.id)) {
      this.diagram.nodes.push(this.node);
    }

    // Check if newly added node is placed inside an existing expanded group
    const nodeCenter = center(rect(this.node.position, this.node.size));
    let targetGroup: Group | null = null;
    let minArea = Infinity;

    for (const group of this.diagram.groups) {
      if (group.collapsed || group.locked) continue;
      const bounds = computeGroupBounds(this.diagram, group);
      if (contains(bounds, nodeCenter) || contains(bounds, this.node.position)) {
        const area = bounds.size.width * bounds.size.height;
        if (area < minArea) {
          minArea = area;
          targetGroup = group;
        }
      }
    }

    if (targetGroup && !targetGroup.nodeIds.includes(this.node.id)) {
      targetGroup.nodeIds.push(this.node.id);
      this.addedToGroupId = targetGroup.id;
    }
  }

  undo(): void {
    const idx = this.diagram.nodes.findIndex((n) => n.id === this.node.id);
    if (idx !== -1) {
      this.diagram.nodes.splice(idx, 1);
    }
    if (this.addedToGroupId) {
      const group = this.diagram.groups.find((g) => g.id === this.addedToGroupId);
      if (group) {
        group.nodeIds = group.nodeIds.filter((id) => id !== this.node.id);
      }
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

export function computeGroupBounds(
  diagram: Diagram,
  group: Group,
  moves?: NodeMove[]
): Rect {
  if (group.position && group.size) {
    return rect(group.position, group.size);
  }

  const padding = 20;
  const headerHeight = 28;

  if (group.nodeIds.length === 0) {
    return rect(point(100, 100), size(200, 120));
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const nodeId of group.nodeIds) {
    const node = diagram.nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    const move = moves?.find((m) => m.nodeId === nodeId);
    const pos = move ? move.oldPos : node.position;

    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + node.size.width);
    maxY = Math.max(maxY, pos.y + node.size.height);
  }

  if (!isFinite(minX)) {
    return rect(point(100, 100), size(200, 120));
  }

  const gx = minX - padding;
  const gy = minY - padding - headerHeight;
  const gw = maxX - minX + padding * 2;
  const gh = maxY - minY + padding * 2 + headerHeight;

  return rect(point(Math.round(gx), Math.round(gy)), size(Math.round(gw), Math.round(gh)));
}

export class MoveNodesCommand implements Command {
  readonly description = "Move nodes";
  private removedGroupMemberships: { groupId: string; nodeId: string }[] = [];
  private addedGroupMemberships: { groupId: string; nodeId: string }[] = [];

  constructor(
    private readonly diagram: Diagram,
    private readonly moves: NodeMove[]
  ) {}

  execute(): void {
    // 1. Capture group bounds before moving nodes
    const groupBoundsMap = new Map<string, Rect>();
    for (const group of this.diagram.groups) {
      groupBoundsMap.set(group.id, computeGroupBounds(this.diagram, group, this.moves));
    }

    // 2. Apply moves
    for (const move of this.moves) {
      const node = this.diagram.nodes.find((n) => n.id === move.nodeId);
      if (node) {
        node.position = { x: move.newPos.x, y: move.newPos.y };
      }
    }

    // 3. Update group memberships
    this.removedGroupMemberships = [];
    this.addedGroupMemberships = [];

    for (const move of this.moves) {
      const node = this.diagram.nodes.find((n) => n.id === move.nodeId);
      if (!node) continue;

      const nodeCenter = center(rect(node.position, node.size));

      // Find target group containing this node (choose smallest area if nested)
      let targetGroup: Group | null = null;
      let minArea = Infinity;

      for (const group of this.diagram.groups) {
        if (group.collapsed || group.locked) continue;
        const bounds = groupBoundsMap.get(group.id);
        if (!bounds) continue;

        if (contains(bounds, nodeCenter) || contains(bounds, node.position)) {
          const area = bounds.size.width * bounds.size.height;
          if (area < minArea) {
            minArea = area;
            targetGroup = group;
          }
        }
      }

      // Check current memberships: remove from groups if no longer inside or if moved to a different targetGroup
      for (const group of this.diagram.groups) {
        if (group.nodeIds.includes(node.id)) {
          const bounds = groupBoundsMap.get(group.id);
          const stillInside = bounds && (contains(bounds, nodeCenter) || contains(bounds, node.position));
          if (!stillInside || (targetGroup && targetGroup.id !== group.id)) {
            group.nodeIds = group.nodeIds.filter((id) => id !== node.id);
            this.removedGroupMemberships.push({
              groupId: group.id,
              nodeId: node.id,
            });
          }
        }
      }

      // Add to targetGroup if found and not already present
      if (targetGroup && !targetGroup.nodeIds.includes(node.id)) {
        targetGroup.nodeIds.push(node.id);
        this.addedGroupMemberships.push({
          groupId: targetGroup.id,
          nodeId: node.id,
        });
      }
    }
  }

  undo(): void {
    // 1. Restore node positions
    for (const move of this.moves) {
      const node = this.diagram.nodes.find((n) => n.id === move.nodeId);
      if (node) {
        node.position = { x: move.oldPos.x, y: move.oldPos.y };
      }
    }

    // 2. Restore group memberships
    for (const { groupId, nodeId } of this.removedGroupMemberships) {
      const group = this.diagram.groups.find((g) => g.id === groupId);
      if (group && !group.nodeIds.includes(nodeId)) {
        group.nodeIds.push(nodeId);
      }
    }

    for (const { groupId, nodeId } of this.addedGroupMemberships) {
      const group = this.diagram.groups.find((g) => g.id === groupId);
      if (group) {
        group.nodeIds = group.nodeIds.filter((id) => id !== nodeId);
      }
    }
  }
}

export interface NodeGeometry {
  position: Point;
  size: Size;
  customData?: Record<string, unknown>;
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
      if (this.newGeometry.customData) {
        node.customData = JSON.parse(JSON.stringify(this.newGeometry.customData));
      }
    }
  }

  undo(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node) {
      node.position = { ...this.oldGeometry.position };
      node.size = { ...this.oldGeometry.size };
      if (this.oldGeometry.customData) {
        node.customData = JSON.parse(JSON.stringify(this.oldGeometry.customData));
      }
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
  private oldSize?: Size;

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
    this.oldSize = { ...node.size };

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

    if (node.kind === "generic.stickyNote" || node.kind === "generic.note") {
      const nodeFont = getNodeFontStyle(node);
      const fontSize = nodeFont.fontSize ?? (node.kind === "generic.note" ? 11 : 13);
      const boldMultiplier = nodeFont.bold ? 1.1 : 1.0;
      const charWidth = Math.max(5, fontSize * 0.58 * boldMultiplier);
      const availableW = Math.max(40, node.size.width - (node.kind === "generic.stickyNote" ? 24 : 20));
      const wrapped = wrapTextToLines(this.newText, availableW, charWidth);
      const topOffset = node.kind === "generic.stickyNote" ? (26 + fontSize) : (14 + fontSize);
      const neededH = topOffset + Math.max(1, wrapped.length) * Math.round(fontSize * 1.38) + 12;
      if (neededH > node.size.height) {
        node.size = {
          width: node.size.width,
          height: Math.round(neededH),
        };
      }
    }
  }

  undo(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node) {
      node.labels = this.oldLabels.map((l) => ({ ...l }));
      if (this.oldSize) {
        node.size = { ...this.oldSize };
      }
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
    if (this.group.locked) return;
    this.group.name = this.newName;
  }

  undo(): void {
    if (this.group.locked) return;
    this.group.name = this.previousName;
  }
}

export class MoveGroupCommand implements Command {
  readonly description = "Move group";
  private oldNodePositions: Map<string, Point> = new Map();
  private oldGroupPosition?: Point;
  private autoAddedNodeIds: string[] = [];

  constructor(
    private readonly diagram: Diagram,
    private readonly groupId: string,
    private readonly delta: Point
  ) {
    const group = this.diagram.groups.find((g) => g.id === this.groupId);
    if (group) {
      // Auto-include any nodes located within group boundary that are not yet in nodeIds
      if (group.position && group.size) {
        const groupBounds = rect(group.position, group.size);
        for (const node of this.diagram.nodes) {
          const nodeCenter = center(rect(node.position, node.size));
          if (contains(groupBounds, nodeCenter) || contains(groupBounds, node.position)) {
            if (!group.nodeIds.includes(node.id)) {
              const otherSmallerGroup = this.diagram.groups.find(
                (og) =>
                  og.id !== group.id &&
                  og.position &&
                  og.size &&
                  (contains(rect(og.position, og.size), nodeCenter) || contains(rect(og.position, og.size), node.position)) &&
                  og.size.width * og.size.height < group.size!.width * group.size!.height
              );
              if (!otherSmallerGroup) {
                group.nodeIds.push(node.id);
                this.autoAddedNodeIds.push(node.id);
              }
            }
          }
        }
      }

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

    for (const nid of this.autoAddedNodeIds) {
      if (!group.nodeIds.includes(nid)) {
        group.nodeIds.push(nid);
      }
    }

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
      if (this.autoAddedNodeIds.length > 0) {
        group.nodeIds = group.nodeIds.filter((id) => !this.autoAddedNodeIds.includes(id));
      }
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
  private oldNodeIds?: string[];

  constructor(
    private readonly group: Group,
    private readonly newPosition: Point,
    private readonly newSize: Size,
    private readonly diagram?: Diagram
  ) {
    this.oldPosition = group.position ? { ...group.position } : undefined;
    this.oldSize = group.size ? { ...group.size } : undefined;
    this.oldNodeIds = [...group.nodeIds];
  }

  execute(): void {
    this.group.position = { ...this.newPosition };
    this.group.size = { ...this.newSize };
    if (this.diagram) {
      const groupBounds = rect(this.newPosition, this.newSize);
      this.group.nodeIds = this.group.nodeIds.filter((nid) => {
        const n = this.diagram!.nodes.find((node) => node.id === nid);
        if (!n) return false;
        const nCenter = center(rect(n.position, n.size));
        return contains(groupBounds, nCenter) || contains(groupBounds, n.position);
      });
      for (const n of this.diagram.nodes) {
        const nCenter = center(rect(n.position, n.size));
        if (contains(groupBounds, nCenter) || contains(groupBounds, n.position)) {
          if (!this.group.nodeIds.includes(n.id)) {
            this.group.nodeIds.push(n.id);
          }
        }
      }
    }
  }

  undo(): void {
    this.group.position = this.oldPosition ? { ...this.oldPosition } : undefined;
    this.group.size = this.oldSize ? { ...this.oldSize } : undefined;
    if (this.oldNodeIds) {
      this.group.nodeIds = [...this.oldNodeIds];
    }
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
        ? (JSON.parse(JSON.stringify(node.compartments)) as Compartment[])
        : undefined;
      node.compartments = JSON.parse(JSON.stringify(this.newCompartments)) as Compartment[];
    }
  }

  undo(): void {
    const node = this.diagram.nodes.find((n) => n.id === this.nodeId);
    if (node) {
      node.compartments = this.previousCompartments
        ? (JSON.parse(JSON.stringify(this.previousCompartments)) as Compartment[])
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

export interface EdgeMove {
  edgeId: string;
  oldWaypoints?: Point[];
  newWaypoints?: Point[];
}

export class MoveEdgesCommand implements Command {
  readonly description = "Move edges";

  constructor(
    private readonly diagram: Diagram,
    private readonly moves: EdgeMove[]
  ) {}

  execute(): void {
    for (const move of this.moves) {
      const edge = this.diagram.edges.find((e) => e.id === move.edgeId);
      if (edge) {
        edge.waypoints = move.newWaypoints
          ? move.newWaypoints.map((p) => ({ ...p }))
          : undefined;
      }
    }
  }

  undo(): void {
    for (const move of this.moves) {
      const edge = this.diagram.edges.find((e) => e.id === move.edgeId);
      if (edge) {
        edge.waypoints = move.oldWaypoints
          ? move.oldWaypoints.map((p) => ({ ...p }))
          : undefined;
      }
    }
  }
}

export class ReverseEdgeCommand implements Command {
  readonly description = "Reverse edge direction";

  private prevFrom: { nodeId: string; portId?: string; side?: Side };
  private prevTo: { nodeId: string; portId?: string; side?: Side };
  private prevWaypoints?: Point[];
  private prevSourceMultiplicity?: string;
  private prevTargetMultiplicity?: string;

  constructor(
    private readonly diagram: Diagram,
    private readonly edgeId: string
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
    this.prevWaypoints = edge?.waypoints
      ? edge.waypoints.map((p) => ({ ...p }))
      : undefined;
    this.prevSourceMultiplicity = edge?.multiplicitySource;
    this.prevTargetMultiplicity = edge?.multiplicityTarget;
  }

  execute(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (!edge) return;

    edge.fromNodeId = this.prevTo.nodeId;
    edge.fromPortId = this.prevTo.portId;
    edge.fromSide = this.prevTo.side;

    edge.toNodeId = this.prevFrom.nodeId;
    edge.toPortId = this.prevFrom.portId;
    edge.toSide = this.prevFrom.side;

    if (edge.waypoints) {
      edge.waypoints = [...edge.waypoints].reverse();
    }
    edge.multiplicitySource = this.prevTargetMultiplicity;
    edge.multiplicityTarget = this.prevSourceMultiplicity;
  }

  undo(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (!edge) return;

    edge.fromNodeId = this.prevFrom.nodeId;
    edge.fromPortId = this.prevFrom.portId;
    edge.fromSide = this.prevFrom.side;

    edge.toNodeId = this.prevTo.nodeId;
    edge.toPortId = this.prevTo.portId;
    edge.toSide = this.prevTo.side;

    edge.waypoints = this.prevWaypoints
      ? this.prevWaypoints.map((p) => ({ ...p }))
      : undefined;
    edge.multiplicitySource = this.prevSourceMultiplicity;
    edge.multiplicityTarget = this.prevTargetMultiplicity;
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

export interface FontStylePatch {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  fontWeight?: string | number;
  fontStyle?: "normal" | "italic";
  fontFamily?: string;
  reset?: boolean;
}

export interface FontTargetItems {
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
  groups?: Group[];
}

interface ItemFontSnapshot {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  fontWeight?: string | number;
  fontStyle?: "normal" | "italic";
  fontFamily?: string;
  labelStyle?: TextStyle;
  labelStyles?: Array<TextStyle | undefined>;
  size?: Size;
}

export class SetFontCommand implements Command {
  readonly description = "Set font style";
  private previousNodeFonts: Map<string, ItemFontSnapshot> = new Map();
  private previousEdgeFonts: Map<string, ItemFontSnapshot> = new Map();
  private previousGroupFonts: Map<string, ItemFontSnapshot> = new Map();

  constructor(
    private readonly targets: FontTargetItems,
    private readonly patch: FontStylePatch
  ) {
    if (targets.nodes) {
      for (const node of targets.nodes) {
        this.previousNodeFonts.set(node.id, {
          fontSize: node.style?.fontSize,
          bold: node.style?.bold,
          italic: node.style?.italic,
          fontWeight: node.style?.fontWeight,
          fontStyle: node.style?.fontStyle,
          fontFamily: node.style?.fontFamily,
          labelStyle: node.labels?.[0]?.style ? { ...node.labels[0].style } : undefined,
          labelStyles: node.labels?.map((l) => (l.style ? { ...l.style } : undefined)),
          size: { ...node.size },
        });
      }
    }
    if (targets.edges) {
      for (const edge of targets.edges) {
        this.previousEdgeFonts.set(edge.id, {
          fontSize: edge.style?.fontSize,
          bold: edge.style?.bold,
          italic: edge.style?.italic,
          fontWeight: edge.style?.fontWeight,
          fontStyle: edge.style?.fontStyle,
          fontFamily: edge.style?.fontFamily,
          labelStyle: edge.labels?.[0]?.style ? { ...edge.labels[0].style } : undefined,
          labelStyles: edge.labels?.map((l) => (l.style ? { ...l.style } : undefined)),
        });
      }
    }
    if (targets.groups) {
      for (const group of targets.groups) {
        const g = group as any;
        this.previousGroupFonts.set(group.id, {
          fontSize: g.fontSize ?? g.style?.fontSize,
          bold: g.bold ?? g.style?.bold,
          italic: g.italic ?? g.style?.italic,
          fontWeight: g.fontWeight ?? g.style?.fontWeight,
          fontStyle: g.fontStyle ?? g.style?.fontStyle,
          fontFamily: g.fontFamily ?? g.style?.fontFamily,
          labelStyle: g.style ? { ...g.style } : undefined,
        });
      }
    }
  }

  execute(): void {
    if (this.targets.nodes) {
      for (const node of this.targets.nodes) {
        if (!node.style) {
          node.style = {};
        }
        if (this.patch.reset) {
          delete node.style.fontSize;
          delete node.style.bold;
          delete node.style.italic;
          delete node.style.fontWeight;
          delete node.style.fontStyle;
          delete node.style.fontFamily;
          for (const label of node.labels ?? []) {
            if (label.style) {
              delete label.style.fontSize;
              delete label.style.bold;
              delete label.style.italic;
              delete label.style.fontWeight;
              delete label.style.fontStyle;
              delete label.style.fontFamily;
            }
          }
        } else {
          if (this.patch.fontSize !== undefined) {
            node.style.fontSize = this.patch.fontSize;
            for (const label of node.labels ?? []) {
              if (!label.style) label.style = {};
              label.style.fontSize = this.patch.fontSize;
            }
          }
          if (this.patch.bold !== undefined) {
            node.style.bold = this.patch.bold;
            node.style.fontWeight = this.patch.bold ? "bold" : "normal";
            for (const label of node.labels ?? []) {
              if (!label.style) label.style = {};
              label.style.bold = this.patch.bold;
              label.style.fontWeight = this.patch.bold ? "bold" : "normal";
            }
          }
          if (this.patch.italic !== undefined) {
            node.style.italic = this.patch.italic;
            node.style.fontStyle = this.patch.italic ? "italic" : "normal";
            for (const label of node.labels ?? []) {
              if (!label.style) label.style = {};
              label.style.italic = this.patch.italic;
              label.style.fontStyle = this.patch.italic ? "italic" : "normal";
            }
          }
          if (this.patch.fontWeight !== undefined) {
            node.style.fontWeight = this.patch.fontWeight;
            node.style.bold = this.patch.fontWeight === "bold" || this.patch.fontWeight === 700;
            for (const label of node.labels ?? []) {
              if (!label.style) label.style = {};
              label.style.fontWeight = this.patch.fontWeight;
              label.style.bold = this.patch.fontWeight === "bold" || this.patch.fontWeight === 700;
            }
          }
          if (this.patch.fontStyle !== undefined) {
            node.style.fontStyle = this.patch.fontStyle;
            node.style.italic = this.patch.fontStyle === "italic";
            for (const label of node.labels ?? []) {
              if (!label.style) label.style = {};
              label.style.fontStyle = this.patch.fontStyle;
              label.style.italic = this.patch.fontStyle === "italic";
            }
          }
          if (this.patch.fontFamily !== undefined) {
            node.style.fontFamily = this.patch.fontFamily;
            for (const label of node.labels ?? []) {
              if (!label.style) label.style = {};
              label.style.fontFamily = this.patch.fontFamily;
            }
          }
        }

        if (node.kind === "generic.stickyNote" || node.kind === "generic.note") {
          const text = node.labels?.[0]?.text ?? "";
          if (text) {
            const nodeFont = getNodeFontStyle(node);
            const fontSize = nodeFont.fontSize ?? (node.kind === "generic.note" ? 11 : 13);
            const boldMultiplier = nodeFont.bold ? 1.1 : 1.0;
            const charWidth = Math.max(5, fontSize * 0.58 * boldMultiplier);
            const availableW = Math.max(40, node.size.width - (node.kind === "generic.stickyNote" ? 24 : 20));
            const wrapped = wrapTextToLines(text, availableW, charWidth);
            const topOffset = node.kind === "generic.stickyNote" ? (26 + fontSize) : (14 + fontSize);
            const neededH = topOffset + Math.max(1, wrapped.length) * Math.round(fontSize * 1.38) + 12;
            if (neededH > node.size.height) {
              node.size = {
                width: node.size.width,
                height: Math.round(neededH),
              };
            }
          }
        }
      }
    }

    if (this.targets.edges) {
      for (const edge of this.targets.edges) {
        if (!edge.style) {
          edge.style = {};
        }
        if (this.patch.reset) {
          delete edge.style.fontSize;
          delete edge.style.bold;
          delete edge.style.italic;
          delete edge.style.fontWeight;
          delete edge.style.fontStyle;
          delete edge.style.fontFamily;
          for (const label of edge.labels ?? []) {
            if (label.style) {
              delete label.style.fontSize;
              delete label.style.bold;
              delete label.style.italic;
              delete label.style.fontWeight;
              delete label.style.fontStyle;
              delete label.style.fontFamily;
            }
          }
        } else {
          if (this.patch.fontSize !== undefined) {
            edge.style.fontSize = this.patch.fontSize;
            for (const label of edge.labels ?? []) {
              if (!label.style) label.style = {};
              label.style.fontSize = this.patch.fontSize;
            }
          }
          if (this.patch.bold !== undefined) {
            edge.style.bold = this.patch.bold;
            edge.style.fontWeight = this.patch.bold ? "bold" : "normal";
            for (const label of edge.labels ?? []) {
              if (!label.style) label.style = {};
              label.style.bold = this.patch.bold;
              label.style.fontWeight = this.patch.bold ? "bold" : "normal";
            }
          }
          if (this.patch.italic !== undefined) {
            edge.style.italic = this.patch.italic;
            edge.style.fontStyle = this.patch.italic ? "italic" : "normal";
            for (const label of edge.labels ?? []) {
              if (!label.style) label.style = {};
              label.style.italic = this.patch.italic;
              label.style.fontStyle = this.patch.italic ? "italic" : "normal";
            }
          }
          if (this.patch.fontWeight !== undefined) {
            edge.style.fontWeight = this.patch.fontWeight;
            edge.style.bold = this.patch.fontWeight === "bold" || this.patch.fontWeight === 700;
            for (const label of edge.labels ?? []) {
              if (!label.style) label.style = {};
              label.style.fontWeight = this.patch.fontWeight;
              label.style.bold = this.patch.fontWeight === "bold" || this.patch.fontWeight === 700;
            }
          }
          if (this.patch.fontStyle !== undefined) {
            edge.style.fontStyle = this.patch.fontStyle;
            edge.style.italic = this.patch.fontStyle === "italic";
            for (const label of edge.labels ?? []) {
              if (!label.style) label.style = {};
              label.style.fontStyle = this.patch.fontStyle;
              label.style.italic = this.patch.fontStyle === "italic";
            }
          }
          if (this.patch.fontFamily !== undefined) {
            edge.style.fontFamily = this.patch.fontFamily;
            for (const label of edge.labels ?? []) {
              if (!label.style) label.style = {};
              label.style.fontFamily = this.patch.fontFamily;
            }
          }
        }
      }
    }

    if (this.targets.groups) {
      for (const group of this.targets.groups) {
        const g = group as any;
        if (this.patch.reset) {
          delete g.fontSize;
          delete g.bold;
          delete g.italic;
          delete g.fontWeight;
          delete g.fontStyle;
          delete g.fontFamily;
          if (g.style) {
            delete g.style.fontSize;
            delete g.style.bold;
            delete g.style.italic;
            delete g.style.fontFamily;
          }
        } else {
          if (this.patch.fontSize !== undefined) {
            g.fontSize = this.patch.fontSize;
            if (!g.style) g.style = {};
            g.style.fontSize = this.patch.fontSize;
          }
          if (this.patch.bold !== undefined) {
            g.bold = this.patch.bold;
            g.fontWeight = this.patch.bold ? "bold" : "normal";
            if (!g.style) g.style = {};
            g.style.bold = this.patch.bold;
          }
          if (this.patch.italic !== undefined) {
            g.italic = this.patch.italic;
            g.fontStyle = this.patch.italic ? "italic" : "normal";
            if (!g.style) g.style = {};
            g.style.italic = this.patch.italic;
          }
          if (this.patch.fontWeight !== undefined) {
            g.fontWeight = this.patch.fontWeight;
            g.bold = this.patch.fontWeight === "bold" || this.patch.fontWeight === 700;
          }
          if (this.patch.fontStyle !== undefined) {
            g.fontStyle = this.patch.fontStyle;
            g.italic = this.patch.fontStyle === "italic";
          }
          if (this.patch.fontFamily !== undefined) {
            g.fontFamily = this.patch.fontFamily;
            if (!g.style) g.style = {};
            g.style.fontFamily = this.patch.fontFamily;
          }
        }
      }
    }
  }

  undo(): void {
    if (this.targets.nodes) {
      for (const node of this.targets.nodes) {
        const prev = this.previousNodeFonts.get(node.id);
        if (!node.style) node.style = {};
        if (!prev) continue;
        if (prev.fontSize !== undefined) node.style.fontSize = prev.fontSize; else delete node.style.fontSize;
        if (prev.bold !== undefined) node.style.bold = prev.bold; else delete node.style.bold;
        if (prev.italic !== undefined) node.style.italic = prev.italic; else delete node.style.italic;
        if (prev.fontWeight !== undefined) node.style.fontWeight = prev.fontWeight; else delete node.style.fontWeight;
        if (prev.fontStyle !== undefined) node.style.fontStyle = prev.fontStyle; else delete node.style.fontStyle;
        if (prev.fontFamily !== undefined) node.style.fontFamily = prev.fontFamily; else delete node.style.fontFamily;
        if (prev.labelStyles && node.labels) {
          for (let i = 0; i < node.labels.length; i++) {
            const ls = prev.labelStyles[i];
            if (ls) node.labels[i].style = { ...ls };
            else if (node.labels[i].style) delete node.labels[i].style;
          }
        } else if (node.labels?.[0]) {
          if (prev.labelStyle) node.labels[0].style = { ...prev.labelStyle };
          else if (node.labels[0].style) delete node.labels[0].style;
        }
        if (prev.size) {
          node.size = { ...prev.size };
        }
      }
    }

    if (this.targets.edges) {
      for (const edge of this.targets.edges) {
        const prev = this.previousEdgeFonts.get(edge.id);
        if (!edge.style) edge.style = {};
        if (!prev) continue;
        if (prev.fontSize !== undefined) edge.style.fontSize = prev.fontSize; else delete edge.style.fontSize;
        if (prev.bold !== undefined) edge.style.bold = prev.bold; else delete edge.style.bold;
        if (prev.italic !== undefined) edge.style.italic = prev.italic; else delete edge.style.italic;
        if (prev.fontWeight !== undefined) edge.style.fontWeight = prev.fontWeight; else delete edge.style.fontWeight;
        if (prev.fontStyle !== undefined) edge.style.fontStyle = prev.fontStyle; else delete edge.style.fontStyle;
        if (prev.fontFamily !== undefined) edge.style.fontFamily = prev.fontFamily; else delete edge.style.fontFamily;
        if (prev.labelStyles && edge.labels) {
          for (let i = 0; i < edge.labels.length; i++) {
            const ls = prev.labelStyles[i];
            if (ls) edge.labels[i].style = { ...ls };
            else if (edge.labels[i].style) delete edge.labels[i].style;
          }
        } else if (edge.labels?.[0]) {
          if (prev.labelStyle) edge.labels[0].style = { ...prev.labelStyle };
          else if (edge.labels[0].style) delete edge.labels[0].style;
        }
      }
    }

    if (this.targets.groups) {
      for (const group of this.targets.groups) {
        const prev = this.previousGroupFonts.get(group.id);
        const g = group as any;
        if (!prev) continue;
        if (prev.fontSize !== undefined) g.fontSize = prev.fontSize; else delete g.fontSize;
        if (prev.bold !== undefined) g.bold = prev.bold; else delete g.bold;
        if (prev.italic !== undefined) g.italic = prev.italic; else delete g.italic;
        if (prev.fontWeight !== undefined) g.fontWeight = prev.fontWeight; else delete g.fontWeight;
        if (prev.fontStyle !== undefined) g.fontStyle = prev.fontStyle; else delete g.fontStyle;
        if (prev.fontFamily !== undefined) g.fontFamily = prev.fontFamily; else delete g.fontFamily;
        if (prev.labelStyle) g.style = { ...prev.labelStyle };
        else if (g.style) delete g.style;
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

export class UpdateEdgeKindCommand implements Command {
  readonly description = "Change connector style";

  private prevKind: string;
  private prevStyle?: EdgeStyle;

  constructor(
    private readonly diagram: Diagram,
    private readonly edgeId: string,
    private readonly newKind: string,
    private readonly newStyle?: Partial<EdgeStyle>
  ) {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    this.prevKind = edge?.kind ?? "uml.association";
    this.prevStyle = edge?.style ? { ...edge.style } : undefined;
  }

  execute(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (edge) {
      edge.kind = this.newKind;
      if (this.newStyle) {
        edge.style = { ...(edge.style ?? {}), ...this.newStyle };
      }
    }
  }

  undo(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (edge) {
      edge.kind = this.prevKind;
      edge.style = this.prevStyle ? { ...this.prevStyle } : undefined;
    }
  }
}

export class UpdateEdgeStyleCommand implements Command {
  readonly description = "Update line style";

  private prevStyle?: EdgeStyle;
  private prevKind?: string;

  constructor(
    private readonly diagram: Diagram,
    private readonly edgeId: string,
    private readonly styleUpdates: Partial<EdgeStyle>,
    private readonly newKind?: string
  ) {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    this.prevStyle = edge?.style ? { ...edge.style } : undefined;
    this.prevKind = edge?.kind;
  }

  execute(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (!edge) return;
    edge.style = { ...(edge.style ?? {}), ...this.styleUpdates };
    if (this.newKind) {
      edge.kind = this.newKind;
    }
  }

  undo(): void {
    const edge = this.diagram.edges.find((e) => e.id === this.edgeId);
    if (!edge) return;
    edge.style = this.prevStyle ? { ...this.prevStyle } : undefined;
    if (this.prevKind) {
      edge.kind = this.prevKind;
    }
  }
}

