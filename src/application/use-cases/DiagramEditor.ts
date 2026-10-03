import { Diagram } from "../../domain/entities/Diagram";
import { DiagramNode, createDiagramNode, NodeStyle } from "../../domain/entities/DiagramNode";
import { DiagramEdge, createDiagramEdge } from "../../domain/entities/DiagramEdge";
import { Point } from "../../domain/value-objects/Point";
import { Rect, Size, rect, intersects } from "../../domain/value-objects/Rect";
import { CommandStack } from "../commands/CommandStack";
import { Layer, createLayer } from "../../domain/entities/Layer";
import { Group } from "../../domain/entities/Group";
import { Port } from "../../domain/entities/Port";
import { Compartment } from "../../domain/entities/Compartment";
import {
  AddNodeCommand,
  DeleteNodesAndEdgesCommand,
  MoveNodesCommand,
  ResizeNodeCommand,
  AddEdgeCommand,
  DeleteEdgesCommand,
  UpdateNodeLabelCommand,
  GroupSelectionCommand,
  UngroupSelectionCommand,
  RenameGroupCommand,
  MoveGroupCommand,
  ResizeGroupCommand,
  ToggleGroupCollapseCommand,
  UpdateGroupMembershipCommand,
  ToggleGroupLockCommand,
  CreateLayerCommand,
  DeleteLayerCommand,
  ToggleLayerVisibilityCommand,
  ToggleLayerLockCommand,
  AssignNodesToLayerCommand,
  AddPortCommand,
  UpdateCompartmentsCommand,
  UpdateStereotypeAndTaggedValuesCommand,
  UpdateEdgeMultiplicityCommand,
  AddEdgeLabelCommand,
  UpdateEdgeLabelCommand,
  UpdateEdgeRoutingCommand,
  ReconnectEdgeCommand,
  UpdateEdgeWaypointsCommand,
  SwitchDiagramTypeCommand,
  AutoResizeNodeCommand,
  LayoutSequenceDiagramCommand,
  CompoundCommand,
  SetColorCommand,
  UpdateChipNodeCommand,
  PropagateChipInterfaceCommand,
  NodeMove,
  NodeGeometry,
} from "../commands/DiagramCommands";
import { ChipInterfaceDefinition } from "../../domain/entities/ChipInterfaceDefinition";
import {
  CreateChipInstanceOptions,
  defaultChipService,
} from "../../domain/services/ChipService";
import {
  defaultCustomChipRegistry,
} from "../../domain/services/CustomChipRegistry";
import { EdgeRouting, DiagramTypeId, Side } from "../../domain/types";
import { defaultDiagramTypeRegistry } from "../../domain/services/DiagramTypeRegistry";
import { ValidationIssue } from "../../domain/entities/DiagramTypeDefinition";
import { calculateNodeFitSize } from "../../domain/services/TextMeasurement";
import { defaultJsonCanvasImporter } from "../../infrastructure/persistence/JsonCanvasImporter";
import { Stereotype } from "../../domain/value-objects/Stereotype";
import { Stroke, defaultShapeRecognizer } from "../../domain/services/ShapeRecognizer";
import {
  SequenceLayoutOptions,
  SequenceLayoutResult,
} from "../../domain/services/SequenceLayoutEngine";
import { DiagramRepository } from "../ports/DiagramRepository";
import { defaultJsonCanvasExporter, JsonCanvasExportOptions } from "../../infrastructure/export/JsonCanvasExporter";
import { defaultSvgExporter, SvgExportOptions } from "../../infrastructure/export/SvgExporter";
import { ExportForRAG } from "./ExportForRAG";

export interface BreadcrumbItem {
  id: string;
  title: string;
}

export interface AddNodeOptions {
  id?: string;
  kind?: string;
  position?: Point;
  size?: Size;
  title?: string;
  ports?: Port[];
  childDiagramId?: string;
  stereotype?: string;
  style?: NodeStyle;
  customData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CanvasClipboardData {
  version: number;
  format: "canvas-plus-plus" | "obsidian-canvas-uml";
  diagramType?: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export type AlignmentType =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom";

export type DistributionDirection = "horizontal" | "vertical";

export class DiagramEditor {
  readonly commandStack: CommandStack;
  private breadcrumbsStack: BreadcrumbItem[] = [];
  private selectedNodeIdSet = new Set<string>();
  private selectedEdgeIdSet = new Set<string>();
  private selectedGroupIdSet = new Set<string>();
  private dirty = false;
  private listeners = new Set<() => void>();

  constructor(
    public diagram: Diagram,
    commandStack?: CommandStack
  ) {
    this.commandStack = commandStack ?? new CommandStack();
    this.commandStack.onChange(() => {
      this.dirty = true;
      this.notify();
    });
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  markClean(): void {
    this.dirty = false;
    this.notify();
  }

  updateDiagram(updatedDiagram: Diagram): void {
    this.diagram = updatedDiagram;
    this.pruneSelection();
    this.notify();
  }

  get canUndo(): boolean {
    return this.commandStack.canUndo;
  }

  get canRedo(): boolean {
    return this.commandStack.canRedo;
  }

  undo(): boolean {
    const success = this.commandStack.undo();
    if (success) {
      this.pruneSelection();
    }
    return success;
  }

  redo(): boolean {
    const success = this.commandStack.redo();
    if (success) {
      this.pruneSelection();
    }
    return success;
  }

  // --- Selection ---

  get selectedNodeIds(): string[] {
    return Array.from(this.selectedNodeIdSet);
  }

  get selectedEdgeIds(): string[] {
    return Array.from(this.selectedEdgeIdSet);
  }

  get selectedGroupIds(): string[] {
    return Array.from(this.selectedGroupIdSet);
  }

  isNodeSelected(id: string): boolean {
    return this.selectedNodeIdSet.has(id);
  }

  isEdgeSelected(id: string): boolean {
    return this.selectedEdgeIdSet.has(id);
  }

  isGroupSelected(id: string): boolean {
    return this.selectedGroupIdSet.has(id);
  }

  selectNode(id: string, additive = false): void {
    if (!additive) {
      this.selectedNodeIdSet.clear();
      this.selectedEdgeIdSet.clear();
      this.selectedGroupIdSet.clear();
    }
    this.selectedNodeIdSet.add(id);
    this.notify();
  }

  toggleNodeSelection(id: string): void {
    if (this.selectedNodeIdSet.has(id)) {
      this.selectedNodeIdSet.delete(id);
    } else {
      this.selectedNodeIdSet.add(id);
    }
    this.notify();
  }

  selectEdge(id: string, additive = false): void {
    if (!additive) {
      this.selectedNodeIdSet.clear();
      this.selectedEdgeIdSet.clear();
      this.selectedGroupIdSet.clear();
    }
    this.selectedEdgeIdSet.add(id);
    this.notify();
  }

  selectGroup(id: string, additive = false): void {
    if (!additive) {
      this.selectedNodeIdSet.clear();
      this.selectedEdgeIdSet.clear();
      this.selectedGroupIdSet.clear();
    }
    this.selectedGroupIdSet.add(id);
    this.notify();
  }

  toggleGroupSelection(id: string): void {
    if (this.selectedGroupIdSet.has(id)) {
      this.selectedGroupIdSet.delete(id);
    } else {
      this.selectedGroupIdSet.add(id);
    }
    this.notify();
  }

  deselectGroup(id: string): void {
    if (this.selectedGroupIdSet.delete(id)) {
      this.notify();
    }
  }

  clearSelection(): void {
    if (
      this.selectedNodeIdSet.size > 0 ||
      this.selectedEdgeIdSet.size > 0 ||
      this.selectedGroupIdSet.size > 0
    ) {
      this.selectedNodeIdSet.clear();
      this.selectedEdgeIdSet.clear();
      this.selectedGroupIdSet.clear();
      this.notify();
    }
  }

  selectArea(area: Rect): void {
    this.selectedNodeIdSet.clear();
    this.selectedEdgeIdSet.clear();
    this.selectedGroupIdSet.clear();

    for (const node of this.diagram.nodes) {
      const nodeRect = rect(node.position, node.size);
      if (intersects(area, nodeRect)) {
        this.selectedNodeIdSet.add(node.id);
      }
    }
    this.notify();
  }

  selectAll(): void {
    this.selectedNodeIdSet.clear();
    this.selectedEdgeIdSet.clear();
    this.selectedGroupIdSet.clear();

    for (const node of this.diagram.nodes) {
      if (!this.isNodeLocked(node.id)) {
        this.selectedNodeIdSet.add(node.id);
      }
    }
    for (const edge of this.diagram.edges) {
      this.selectedEdgeIdSet.add(edge.id);
    }
    for (const group of this.diagram.groups) {
      if (!group.locked) {
        this.selectedGroupIdSet.add(group.id);
      }
    }
    this.notify();
  }

  // --- Node CRUD ---

  addNode(options?: AddNodeOptions): DiagramNode {
    const id = options?.id ?? `node-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const kind = options?.kind ?? "generic.rectangle";
    const position = options?.position ?? { x: 100, y: 100 };
    const size = options?.size ?? { width: 140, height: 80 };
    const title = options?.title ?? "New Node";

    const node = createDiagramNode({
      id,
      kind,
      position,
      size,
      ports: options?.ports ?? [],
      childDiagramId: options?.childDiagramId,
      stereotype: options?.stereotype,
      style: options?.style,
      customData: options?.customData,
      metadata: options?.metadata ? { ...options.metadata } : {},
      labels: [
        {
          id: `label-${id}-0`,
          text: title,
          anchor: "node",
          position: { x: 0, y: 0 },
        },
      ],
    });

    const cmd = new AddNodeCommand(this.diagram, node);
    this.commandStack.execute(cmd);

    this.selectNode(node.id, false);
    return node;
  }

  /**
   * Instantiates a custom or standard chip interface as a schematic.chip node (F-061).
   */
  instantiateChip(
    interfaceDef: ChipInterfaceDefinition,
    position: Point = { x: 100, y: 100 },
    options?: CreateChipInstanceOptions
  ): DiagramNode {
    const node = defaultChipService.createChipInstanceNode(
      interfaceDef,
      position,
      options
    );
    const cmd = new AddNodeCommand(this.diagram, node);
    this.commandStack.execute(cmd);
    this.selectNode(node.id, false);
    return node;
  }

  /**
   * Updates an existing chip instance node's interface (or propagates to all instances) (F-063).
   */
  updateChipNode(
    nodeId: string,
    updatedDef: ChipInterfaceDefinition,
    propagateToAll = false
  ): void {
    if (propagateToAll) {
      const prevDef = defaultCustomChipRegistry.get(updatedDef.id);
      const cmd = new PropagateChipInterfaceCommand(
        this.diagram,
        updatedDef,
        prevDef
      );
      this.commandStack.execute(cmd);
    } else {
      const cmd = new UpdateChipNodeCommand(
        this.diagram,
        nodeId,
        updatedDef
      );
      this.commandStack.execute(cmd);
    }
  }

  updateNode(nodeId: string, partial: Partial<DiagramNode>): void {
    const node = this.diagram.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    Object.assign(node, partial);
    this.notify();
  }

  getCustomChips(): ChipInterfaceDefinition[] {
    return defaultCustomChipRegistry.getAll();
  }

  registerCustomChip(def: ChipInterfaceDefinition): void {
    defaultCustomChipRegistry.register(def);
  }

  moveNodes(moves: NodeMove[]): void {
    if (moves.length === 0) return;
    const cmd = new MoveNodesCommand(this.diagram, moves);
    this.commandStack.execute(cmd);
  }

  resizeNode(
    nodeId: string,
    oldGeometry: NodeGeometry,
    newGeometry: NodeGeometry
  ): void {
    const cmd = new ResizeNodeCommand(
      this.diagram,
      nodeId,
      oldGeometry,
      newGeometry
    );
    this.commandStack.execute(cmd);
  }

  deleteNode(nodeId: string): void {
    const cmd = new DeleteNodesAndEdgesCommand(this.diagram, [nodeId], []);
    this.commandStack.execute(cmd);
    this.selectedNodeIdSet.delete(nodeId);
  }

  deleteSelection(): void {
    if (
      this.selectedNodeIdSet.size === 0 &&
      this.selectedEdgeIdSet.size === 0 &&
      this.selectedGroupIdSet.size === 0
    ) {
      return;
    }

    const nodeIds = Array.from(this.selectedNodeIdSet);
    const edgeIds = Array.from(this.selectedEdgeIdSet);
    const groupIds = Array.from(this.selectedGroupIdSet);

    if (nodeIds.length > 0 || edgeIds.length > 0) {
      const cmd = new DeleteNodesAndEdgesCommand(this.diagram, nodeIds, edgeIds);
      this.commandStack.execute(cmd);
    }

    if (groupIds.length > 0) {
      const cmd = new UngroupSelectionCommand(this.diagram, groupIds);
      this.commandStack.execute(cmd);
    }

    this.selectedNodeIdSet.clear();
    this.selectedEdgeIdSet.clear();
    this.selectedGroupIdSet.clear();
  }

  // --- Edge CRUD ---

  public defaultRouting: EdgeRouting = "orthogonal";
  public activeEdgeKind: string = "uml.association";

  addEdge(
    fromNodeId: string,
    toNodeId: string,
    options?: Partial<DiagramEdge>
  ): DiagramEdge {
    const id =
      options?.id ?? `edge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const kind = options?.kind ?? this.activeEdgeKind;
    const routing = options?.routing ?? this.defaultRouting;

    const labels = options?.labels ? [...options.labels] : [];
    if (labels.length === 0) {
      if (kind === "uml.include") {
        labels.push({
          id: `lbl-${Date.now()}-inc`,
          text: Stereotype.from("include").format(),
          anchor: "edge",
          position: { x: 0, y: -10 },
        });
      } else if (kind === "uml.extend") {
        labels.push({
          id: `lbl-${Date.now()}-ext`,
          text: Stereotype.from("extend").format(),
          anchor: "edge",
          position: { x: 0, y: -10 },
        });
      }
    }

    const edge = createDiagramEdge({
      id,
      kind,
      fromNodeId,
      toNodeId,
      fromPortId: options?.fromPortId,
      fromSide: options?.fromSide,
      toPortId: options?.toPortId,
      toSide: options?.toSide,
      routing,
      waypoints: options?.waypoints,
      labels,
      multiplicitySource: options?.multiplicitySource,
      multiplicityTarget: options?.multiplicityTarget,
      style: options?.style,
    });

    const cmd = new AddEdgeCommand(this.diagram, edge);
    this.commandStack.execute(cmd);

    this.selectEdge(edge.id, false);
    return edge;
  }

  deleteEdge(edgeId: string): void {
    const cmd = new DeleteEdgesCommand(this.diagram, [edgeId]);
    this.commandStack.execute(cmd);
    this.selectedEdgeIdSet.delete(edgeId);
  }

  // --- Label Editing ---

  updateNodeLabel(nodeId: string, text: string, labelIndex = 0): void {
    const cmd = new UpdateNodeLabelCommand(
      this.diagram,
      nodeId,
      text,
      labelIndex
    );
    this.commandStack.execute(cmd);
  }

  // --- Groups & Layers (F-010) ---

  groupSelection(name = "Group"): Group | null {
    if (this.selectedNodeIdSet.size === 0) return null;
    const nodeIds = Array.from(this.selectedNodeIdSet);
    const groupId = `group-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const nid of nodeIds) {
      const n = this.diagram.nodes.find((nd) => nd.id === nid);
      if (n) {
        minX = Math.min(minX, n.position.x);
        minY = Math.min(minY, n.position.y);
        maxX = Math.max(maxX, n.position.x + n.size.width);
        maxY = Math.max(maxY, n.position.y + n.size.height);
      }
    }
    const pad = 16;
    const initialPos = isFinite(minX) ? { x: Math.round(minX - pad), y: Math.round(minY - pad - 26) } : undefined;
    const initialSize = isFinite(minX) ? { width: Math.round(maxX - minX + pad * 2), height: Math.round(maxY - minY + pad * 2 + 26) } : undefined;

    const cmd = new GroupSelectionCommand(this.diagram, groupId, name, nodeIds, initialPos, initialSize);
    this.commandStack.execute(cmd);

    const group = this.diagram.groups.find((g) => g.id === groupId) ?? null;
    if (group) {
      this.selectedGroupIdSet.add(group.id);
      this.notify();
    }
    return group;
  }

  ungroupSelection(): void {
    const matchingGroupIds = new Set<string>();
    for (const gid of this.selectedGroupIdSet) {
      matchingGroupIds.add(gid);
    }
    const selected = this.selectedNodeIdSet;
    for (const g of this.diagram.groups) {
      if (g.nodeIds.some((id) => selected.has(id))) {
        matchingGroupIds.add(g.id);
      }
    }

    if (matchingGroupIds.size === 0) return;
    const cmd = new UngroupSelectionCommand(this.diagram, Array.from(matchingGroupIds));
    this.commandStack.execute(cmd);
    for (const gid of matchingGroupIds) {
      this.selectedGroupIdSet.delete(gid);
    }
  }

  renameGroup(groupId: string, newName: string): void {
    const group = this.diagram.groups.find((g) => g.id === groupId);
    if (!group || group.name === newName) return;
    const cmd = new RenameGroupCommand(group, newName);
    this.commandStack.execute(cmd);
  }

  moveGroup(groupId: string, delta: Point): void {
    if (delta.x === 0 && delta.y === 0) return;
    const group = this.diagram.groups.find((g) => g.id === groupId);
    if (!group || group.locked) return;
    const cmd = new MoveGroupCommand(this.diagram, groupId, delta);
    this.commandStack.execute(cmd);
  }

  resizeGroup(groupId: string, newPosition: Point, newSize: Size): void {
    const group = this.diagram.groups.find((g) => g.id === groupId);
    if (!group || group.locked) return;
    const cmd = new ResizeGroupCommand(group, newPosition, newSize);
    this.commandStack.execute(cmd);
  }

  toggleGroupCollapse(groupId: string): void {
    const group = this.diagram.groups.find((g) => g.id === groupId);
    if (!group) return;
    const cmd = new ToggleGroupCollapseCommand(group);
    this.commandStack.execute(cmd);
  }

  toggleGroupLock(groupId: string): void {
    const group = this.diagram.groups.find((g) => g.id === groupId);
    if (!group) return;
    const cmd = new ToggleGroupLockCommand(group);
    this.commandStack.execute(cmd);
  }

  addNodesToGroup(groupId: string, nodeIds: string[]): void {
    const group = this.diagram.groups.find((g) => g.id === groupId);
    if (!group || nodeIds.length === 0) return;
    const set = new Set(group.nodeIds);
    for (const nid of nodeIds) set.add(nid);
    const cmd = new UpdateGroupMembershipCommand(group, Array.from(set));
    this.commandStack.execute(cmd);
  }

  removeNodesFromGroup(groupId: string, nodeIds: string[]): void {
    const group = this.diagram.groups.find((g) => g.id === groupId);
    if (!group || nodeIds.length === 0) return;
    const toRemove = new Set(nodeIds);
    const remaining = group.nodeIds.filter((id) => !toRemove.has(id));
    const cmd = new UpdateGroupMembershipCommand(group, remaining);
    this.commandStack.execute(cmd);
  }

  selectGroupMembers(groupId: string): void {
    const group = this.diagram.groups.find((g) => g.id === groupId);
    if (!group || group.nodeIds.length === 0) return;
    this.selectedNodeIdSet.clear();
    this.selectedEdgeIdSet.clear();
    this.selectedGroupIdSet.clear();
    for (const nid of group.nodeIds) {
      this.selectedNodeIdSet.add(nid);
    }
    this.notify();
  }

  deleteGroup(groupId: string): void {
    const cmd = new UngroupSelectionCommand(this.diagram, [groupId]);
    this.commandStack.execute(cmd);
    this.selectedGroupIdSet.delete(groupId);
  }

  createLayer(name: string): Layer {
    const layer = createLayer({
      id: `layer-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name,
    });
    const cmd = new CreateLayerCommand(this.diagram, layer);
    this.commandStack.execute(cmd);
    return layer;
  }

  deleteLayer(layerId: string): void {
    const cmd = new DeleteLayerCommand(this.diagram, layerId);
    this.commandStack.execute(cmd);
  }

  toggleLayerVisibility(layerId: string): void {
    const cmd = new ToggleLayerVisibilityCommand(this.diagram, layerId);
    this.commandStack.execute(cmd);
  }

  toggleLayerLock(layerId: string): void {
    const cmd = new ToggleLayerLockCommand(this.diagram, layerId);
    this.commandStack.execute(cmd);
  }

  toggleNodeLock(nodeId: string): void {
    let owningLayer = this.diagram.layers.find((l) => l.nodeIds.includes(nodeId));
    if (!owningLayer) {
      const layer = this.createLayer(`Node ${nodeId}`);
      const cmd = new AssignNodesToLayerCommand(this.diagram, [nodeId], layer.id);
      this.commandStack.execute(cmd);
      owningLayer = layer;
    }
    if (owningLayer) {
      this.toggleLayerLock(owningLayer.id);
    }
  }

  assignSelectionToLayer(layerId: string): void {
    if (this.selectedNodeIdSet.size === 0) return;
    const nodeIds = Array.from(this.selectedNodeIdSet);
    const cmd = new AssignNodesToLayerCommand(this.diagram, nodeIds, layerId);
    this.commandStack.execute(cmd);
  }

  isNodeLocked(nodeId: string): boolean {
    const owningLayer = this.diagram.layers.find((l) => l.nodeIds.includes(nodeId));
    if (owningLayer && owningLayer.locked) return true;
    const owningGroup = this.diagram.groups.find((g) => g.nodeIds.includes(nodeId));
    if (owningGroup && owningGroup.locked) return true;
    return false;
  }

  isGroupLocked(groupId: string): boolean {
    const group = this.diagram.groups.find((g) => g.id === groupId);
    return group?.locked ?? false;
  }

  isNodeVisible(nodeId: string): boolean {
    const owningLayer = this.diagram.layers.find((l) => l.nodeIds.includes(nodeId));
    if (owningLayer && !owningLayer.visible) return false;
    const owningGroup = this.diagram.groups.find((g) => g.nodeIds.includes(nodeId));
    if (owningGroup && owningGroup.collapsed) return false;
    return true;
  }

  // --- Ports / Anchors (F-007) ---

  addPort(nodeId: string, port: Port): void {
    const cmd = new AddPortCommand(this.diagram, nodeId, port);
    this.commandStack.execute(cmd);
  }

  // --- Compartments (F-032) ---

  updateCompartments(nodeId: string, compartments: Compartment[]): void {
    const cmd = new UpdateCompartmentsCommand(this.diagram, nodeId, compartments);
    this.commandStack.execute(cmd);
  }

  // --- Stereotype & Tagged Values (F-033) ---

  updateStereotype(
    nodeId: string,
    stereotype?: string,
    taggedValues?: Record<string, string>
  ): void {
    const cmd = new UpdateStereotypeAndTaggedValuesCommand(
      this.diagram,
      nodeId,
      stereotype,
      taggedValues
    );
    this.commandStack.execute(cmd);
  }

  // --- Multiplicity & Labels (F-031, F-034) ---

  updateEdgeMultiplicity(
    edgeId: string,
    sourceMult?: string,
    targetMult?: string
  ): void {
    const cmd = new UpdateEdgeMultiplicityCommand(
      this.diagram,
      edgeId,
      sourceMult,
      targetMult
    );
    this.commandStack.execute(cmd);
  }

  addEdgeLabel(edgeId: string, text: string, position?: Point): void {
    const labelId = `label-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const cmd = new AddEdgeLabelCommand(
      this.diagram,
      edgeId,
      labelId,
      text,
      position
    );
    this.commandStack.execute(cmd);
  }

  updateEdgeLabel(edgeId: string, text: string, labelIndex = 0): void {
    const cmd = new UpdateEdgeLabelCommand(this.diagram, edgeId, text, labelIndex);
    this.commandStack.execute(cmd);
  }

  updateEdgeRouting(edgeId: string, routing: EdgeRouting): void {
    const cmd = new UpdateEdgeRoutingCommand(this.diagram, edgeId, routing);
    this.commandStack.execute(cmd);
  }

  reconnectEdge(
    edgeId: string,
    endpoint: "source" | "target",
    target: { nodeId: string; portId?: string; side?: Side }
  ): void {
    const targetNode = this.diagram.nodes.find((n) => n.id === target.nodeId);
    if (!targetNode) return;
    const cmd = new ReconnectEdgeCommand(this.diagram, edgeId, endpoint, target);
    this.commandStack.execute(cmd);
  }

  updateEdgeWaypoints(edgeId: string, waypoints?: Point[]): void {
    const cmd = new UpdateEdgeWaypointsCommand(this.diagram, edgeId, waypoints);
    this.commandStack.execute(cmd);
  }

  addEdgeWaypoint(edgeId: string, point: Point): void {
    const edge = this.diagram.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const current = edge.waypoints ? [...edge.waypoints] : [];
    current.push({ ...point });
    this.updateEdgeWaypoints(edgeId, current);
  }

  clearEdgeWaypoints(edgeId: string): void {
    this.updateEdgeWaypoints(edgeId, undefined);
  }

  // --- Color Styling ---

  setNodeColor(nodeId: string | string[], color: string | undefined): void {
    const ids = Array.isArray(nodeId) ? nodeId : [nodeId];
    const nodes = this.diagram.nodes.filter((n) => ids.includes(n.id));
    if (nodes.length === 0) return;
    const cmd = new SetColorCommand({ nodes }, color);
    this.commandStack.execute(cmd);
  }

  setEdgeColor(edgeId: string | string[], color: string | undefined): void {
    const ids = Array.isArray(edgeId) ? edgeId : [edgeId];
    const edges = this.diagram.edges.filter((e) => ids.includes(e.id));
    if (edges.length === 0) return;
    const cmd = new SetColorCommand({ edges }, color);
    this.commandStack.execute(cmd);
  }

  setGroupColor(groupId: string | string[], color: string | undefined): void {
    const ids = Array.isArray(groupId) ? groupId : [groupId];
    const groups = this.diagram.groups.filter((g) => ids.includes(g.id));
    if (groups.length === 0) return;
    const cmd = new SetColorCommand({ groups }, color);
    this.commandStack.execute(cmd);
  }

  setColorForSelection(color: string | undefined): void {
    const nodes = this.diagram.nodes.filter((n) => this.selectedNodeIds.includes(n.id));
    const edges = this.diagram.edges.filter((e) => this.selectedEdgeIds.includes(e.id));
    
    // Include any directly selected groups or groups whose nodes are selected
    const groups = this.diagram.groups.filter((g) =>
      this.selectedGroupIdSet.has(g.id) ||
      g.nodeIds.some((id) => this.selectedNodeIds.includes(id))
    );

    if (nodes.length === 0 && edges.length === 0 && groups.length === 0) return;

    const cmd = new SetColorCommand({ nodes, edges, groups }, color);
    this.commandStack.execute(cmd);
  }

  // --- Diagram Type & Validation (F-040, F-041, F-042, F-054) ---

  switchDiagramType(newType: DiagramTypeId): void {
    const cmd = new SwitchDiagramTypeCommand(this.diagram, newType);
    this.commandStack.execute(cmd);
    const def = defaultDiagramTypeRegistry.get(newType);
    if (def) {
      this.defaultRouting = def.defaultRouting;
      if (def.allowedEdgeKinds.length > 0) {
        this.activeEdgeKind = def.allowedEdgeKinds[0];
      }
    }
  }

  validateDiagram(): ValidationIssue[] {
    const def = defaultDiagramTypeRegistry.get(this.diagram.diagramType);
    if (!def) return [];
    return def.validate(this.diagram);
  }

  // --- Auto-resize (F-036) ---

  autoResizeNode(nodeId: string): void {
    const node = this.diagram.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const fitSize = calculateNodeFitSize(node);
    const cmd = new AutoResizeNodeCommand(this.diagram, nodeId, fitSize);
    this.commandStack.execute(cmd);
  }

  autoResizeAllNodes(): void {
    for (const node of this.diagram.nodes) {
      this.autoResizeNode(node.id);
    }
  }

  // --- Sequence Diagram Layout (F-045) ---

  layoutSequenceDiagram(options?: SequenceLayoutOptions): SequenceLayoutResult {
    const cmd = new LayoutSequenceDiagramCommand(this.diagram, options);
    this.commandStack.execute(cmd);
    return cmd.result!;
  }

  // --- Plain .canvas Import (F-023) ---

  importCanvas(jsonString: string, mode: "replace" | "merge" = "replace"): void {
    const imported = defaultJsonCanvasImporter.importCanvas(jsonString);
    if (mode === "merge") {
      this.diagram.nodes.push(...imported.nodes);
      this.diagram.edges.push(...imported.edges);
      this.diagram.groups.push(...imported.groups);
    } else {
      this.diagram.nodes = imported.nodes;
      this.diagram.edges = imported.edges;
      this.diagram.groups = imported.groups;
    }
    this.clearSelection();
    this.notify();
  }

  // --- Nested Diagram Drill-down & Breadcrumbs (F-062) ---

  get breadcrumbs(): ReadonlyArray<BreadcrumbItem> {
    return this.breadcrumbsStack;
  }

  async drillIntoChild(nodeId: string, repository: DiagramRepository): Promise<Diagram> {
    const node = this.diagram.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new Error(`Node with id "${nodeId}" not found`);
    }
    if (!node.childDiagramId) {
      throw new Error(`Node "${nodeId}" does not have a nested child diagram`);
    }

    this.breadcrumbsStack.push({
      id: this.diagram.id,
      title: this.diagram.title || "Untitled Diagram",
    });

    const child = await repository.load(node.childDiagramId);
    this.diagram = child;
    this.clearSelection();
    this.notify();
    return child;
  }

  async navigateUp(repository: DiagramRepository): Promise<Diagram | null> {
    if (this.breadcrumbsStack.length === 0) return null;
    const parentCrumb = this.breadcrumbsStack.pop()!;
    const parent = await repository.load(parentCrumb.id);
    this.diagram = parent;
    this.clearSelection();
    this.notify();
    return parent;
  }

  async navigateToBreadcrumb(
    index: number,
    repository: DiagramRepository
  ): Promise<Diagram | null> {
    if (index < 0 || index >= this.breadcrumbsStack.length) return null;
    const targetCrumb = this.breadcrumbsStack[index];
    this.breadcrumbsStack = this.breadcrumbsStack.slice(0, index);
    const target = await repository.load(targetCrumb.id);
    this.diagram = target;
    this.clearSelection();
    this.notify();
    return target;
  }

  // --- Export Helpers (F-024, F-025) ---

  exportToJsonCanvas(options?: JsonCanvasExportOptions): string {
    return defaultJsonCanvasExporter.exportCanvas(this.diagram, options);
  }

  exportToSvg(options?: SvgExportOptions): string {
    return defaultSvgExporter.exportToSvg(this.diagram, options);
  }

  exportForRAG(): string {
    const ragExporter = new ExportForRAG();
    return ragExporter.exportToString(this.diagram);
  }

  // --- Hand-Drawing, Shape Snapping & Freehand Escape Hatch (F-071, F-072, F-073) ---

  addFreehandNode(stroke: Stroke): DiagramNode {
    const points = stroke.points;
    if (!points || points.length === 0) {
      return this.addNode({
        kind: "generic.freehand",
        position: { x: 0, y: 0 },
        size: { width: 100, height: 60 },
        title: "",
        customData: { pathData: "", points: [] },
      });
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    const width = Math.max(20, maxX - minX);
    const height = Math.max(20, maxY - minY);

    const relPoints = points.map((p) => ({
      x: Math.round((p.x - minX) * 10) / 10,
      y: Math.round((p.y - minY) * 10) / 10,
    }));

    const pathData = relPoints.reduce(
      (acc, p, i) => `${acc}${i === 0 ? "M" : " L"} ${p.x},${p.y}`,
      ""
    );

    return this.addNode({
      kind: "generic.freehand",
      position: { x: Math.round(minX), y: Math.round(minY) },
      size: { width: Math.round(width), height: Math.round(height) },
      title: "",
      customData: {
        pathData,
        points: relPoints,
        originalStrokeId: stroke.id,
      },
    });
  }

  keepAsFreehand(stroke: Stroke): DiagramNode {
    return this.addFreehandNode(stroke);
  }

  snapStrokeToShape(
    stroke: Stroke,
    optionsOrThreshold: {
      confidenceThreshold?: number;
      forceFreehand?: boolean;
      fallbackToFreehand?: boolean;
    } | number = 0.65
  ): DiagramNode | DiagramEdge | null {
    const opts =
      typeof optionsOrThreshold === "number"
        ? { confidenceThreshold: optionsOrThreshold }
        : optionsOrThreshold;

    if (opts.forceFreehand) {
      return this.addFreehandNode(stroke);
    }

    const confidenceThreshold = opts.confidenceThreshold ?? 0.65;
    const result = defaultShapeRecognizer.recognize(stroke);
    if (result.confidence < confidenceThreshold || result.shape === "none") {
      if (opts.fallbackToFreehand) {
        return this.addFreehandNode(stroke);
      }
      return null;
    }

    const dt = this.diagram.diagramType;

    // Closed nodes: Rectangle, Diamond, Ellipse
    if (
      result.shape === "rectangle" ||
      result.shape === "diamond" ||
      result.shape === "ellipse"
    ) {
      let nodeKind = "generic.rectangle";
      let title = "New Node";

      if (result.shape === "rectangle") {
        switch (dt) {
          case "uml.class":
            nodeKind = "uml.class";
            title = "Class";
            break;
          case "uml.package":
            nodeKind = "uml.package";
            title = "Package";
            break;
          case "uml.component":
            nodeKind = "uml.component";
            title = "Component";
            break;
          case "uml.deployment":
            nodeKind = "uml.node3d";
            title = "Node";
            break;
          case "uml.composite":
            nodeKind = "uml.compositeClassifier";
            title = "Classifier";
            break;
          case "uml.profile":
            nodeKind = "uml.stereotype";
            title = "Stereotype";
            break;
          case "uml.activity":
            nodeKind = "activity.action";
            title = "Action";
            break;
          case "uml.stateMachine":
          case "uml.state":
            nodeKind = "state.simple";
            title = "State";
            break;
          case "schematic":
            nodeKind = "schematic.chip";
            title = "Chip";
            break;
          default:
            nodeKind = "generic.rectangle";
            title = "Node";
        }
      } else if (result.shape === "diamond") {
        switch (dt) {
          case "uml.stateMachine":
          case "uml.state":
            nodeKind = "state.choice";
            title = "";
            break;
          case "uml.activity":
          default:
            nodeKind = "activity.decision";
            title = "Decision";
        }
      } else if (result.shape === "ellipse") {
        switch (dt) {
          case "uml.activity":
            nodeKind = "activity.initial";
            title = "";
            break;
          case "uml.stateMachine":
          case "uml.state":
            nodeKind = "state.initial";
            title = "";
            break;
          case "uml.useCase":
          case "uml.usecase":
          default:
            nodeKind = "uml.usecase";
            title = "Use Case";
        }
      }

      return this.addNode({
        kind: nodeKind,
        position: {
          x: Math.round(result.bounds.position.x),
          y: Math.round(result.bounds.position.y),
        },
        size: {
          width: Math.max(40, Math.round(result.bounds.size.width)),
          height: Math.max(30, Math.round(result.bounds.size.height)),
        },
        title,
      });
    }

    // Connectors: Line or Arrow
    if (result.shape === "line" || result.shape === "arrow") {
      const sp = result.startPoint ?? {
        x: result.bounds.position.x,
        y: result.bounds.position.y,
      };
      const ep = result.endPoint ?? {
        x: result.bounds.position.x + result.bounds.size.width,
        y: result.bounds.position.y + result.bounds.size.height,
      };

      const fromNode = this.findNearestNode(sp, 100);
      const toNode = this.findNearestNode(ep, 100);

      if (fromNode && toNode) {
        let edgeKind = "uml.association";
        if (result.shape === "arrow") {
          switch (dt) {
            case "uml.activity":
            case "uml.interactionOverview":
              edgeKind = "activity.controlFlow";
              break;
            case "uml.stateMachine":
              edgeKind = "state.transition";
              break;
            case "uml.package":
              edgeKind = "package.dependency";
              break;
            case "uml.profile":
              edgeKind = "profile.extension";
              break;
            case "uml.class":
            default:
              edgeKind = "uml.dependency";
          }
        } else {
          switch (dt) {
            case "schematic":
              edgeKind = "schematic.wire";
              break;
            case "uml.sequence":
              edgeKind = "sequence.syncMessage";
              break;
            case "uml.object":
              edgeKind = "uml.link";
              break;
            case "uml.composite":
              edgeKind = "composite.connector";
              break;
            case "uml.class":
            default:
              edgeKind = "uml.association";
          }
        }

        return this.addEdge(fromNode.id, toNode.id, {
          kind: edgeKind,
        });
      }
    }

    if (opts.fallbackToFreehand) {
      return this.addFreehandNode(stroke);
    }

    return null;
  }

  private findNearestNode(pt: Point, maxDist = 100): DiagramNode | null {
    let bestNode: DiagramNode | null = null;
    let minDist = maxDist;

    for (const node of this.diagram.nodes) {
      const cx = node.position.x + node.size.width / 2;
      const cy = node.position.y + node.size.height / 2;
      const d = Math.hypot(pt.x - cx, pt.y - cy);
      if (d < minDist) {
        minDist = d;
        bestNode = node;
      }
    }

    return bestNode;
  }

  // --- Copy / Paste (F-012) ---

  private static globalClipboard: CanvasClipboardData | null = null;

  copySelection(): CanvasClipboardData {
    const selectedNodes = this.diagram.nodes.filter((n) =>
      this.selectedNodeIdSet.has(n.id)
    );
    const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));

    const selectedEdges = this.diagram.edges.filter(
      (e) =>
        this.selectedEdgeIdSet.has(e.id) ||
        (selectedNodeIds.has(e.fromNodeId) && selectedNodeIds.has(e.toNodeId))
    );

    const payload: CanvasClipboardData = {
      version: 1,
      format: "canvas-plus-plus",
      diagramType: this.diagram.diagramType,
      nodes: JSON.parse(JSON.stringify(selectedNodes)) as DiagramNode[],
      edges: JSON.parse(JSON.stringify(selectedEdges)) as DiagramEdge[],
    };

    DiagramEditor.globalClipboard = payload;
    return payload;
  }

  paste(
    offset: Point = { x: 20, y: 20 },
    sourceData?: CanvasClipboardData
  ): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
    const data = sourceData ?? DiagramEditor.globalClipboard;
    if (!data || !data.nodes || data.nodes.length === 0) {
      return { nodes: [], edges: [] };
    }

    const nodeIdMap = new Map<string, string>();
    const portIdMap = new Map<string, string>();
    const newNodes: DiagramNode[] = [];
    const newEdges: DiagramEdge[] = [];
    const commands: (AddNodeCommand | AddEdgeCommand)[] = [];

    // Remap nodes
    for (const node of data.nodes) {
      const newNodeId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      nodeIdMap.set(node.id, newNodeId);

      const clonedPorts: Port[] = (node.ports || []).map((p) => {
        const newPortId = `port-${newNodeId}-${Math.random().toString(36).substring(2, 6)}`;
        portIdMap.set(p.id, newPortId);
        return {
          ...p,
          id: newPortId,
          ownerNodeId: newNodeId,
        };
      });

      const clonedLabels = (node.labels || []).map((l, i) => ({
        ...l,
        id: `label-${newNodeId}-${i}`,
      }));

      const clonedNode = createDiagramNode({
        id: newNodeId,
        kind: node.kind,
        position: {
          x: node.position.x + offset.x,
          y: node.position.y + offset.y,
        },
        size: { ...node.size },
        stereotype: node.stereotype,
        taggedValues: node.taggedValues ? { ...node.taggedValues } : undefined,
        compartments: node.compartments
          ? (JSON.parse(JSON.stringify(node.compartments)) as Compartment[])
          : [],
        ports: clonedPorts,
        labels: clonedLabels,
        childDiagramId: node.childDiagramId,
        metadata: node.metadata ? { ...node.metadata } : {},
      });

      newNodes.push(clonedNode);
      commands.push(new AddNodeCommand(this.diagram, clonedNode));
    }

    // Remap edges connecting copied nodes
    for (const edge of data.edges) {
      const newFromNodeId = nodeIdMap.get(edge.fromNodeId);
      const newToNodeId = nodeIdMap.get(edge.toNodeId);

      if (newFromNodeId && newToNodeId) {
        const newEdgeId = `edge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const newFromPortId = edge.fromPortId
          ? portIdMap.get(edge.fromPortId)
          : undefined;
        const newToPortId = edge.toPortId
          ? portIdMap.get(edge.toPortId)
          : undefined;

        const clonedWaypoints = edge.waypoints
          ? edge.waypoints.map((pt) => ({
              x: pt.x + offset.x,
              y: pt.y + offset.y,
            }))
          : undefined;

        const clonedLabels = (edge.labels || []).map((l, i) => ({
          ...l,
          id: `label-${newEdgeId}-${i}`,
        }));

        const clonedEdge = createDiagramEdge({
          id: newEdgeId,
          kind: edge.kind,
          fromNodeId: newFromNodeId,
          toNodeId: newToNodeId,
          fromPortId: newFromPortId,
          toPortId: newToPortId,
          routing: edge.routing,
          waypoints: clonedWaypoints,
          labels: clonedLabels,
          multiplicitySource: edge.multiplicitySource,
          multiplicityTarget: edge.multiplicityTarget,
          style: edge.style ? { ...edge.style } : undefined,
        });

        newEdges.push(clonedEdge);
        commands.push(new AddEdgeCommand(this.diagram, clonedEdge));
      }
    }

    if (commands.length > 0) {
      const compound = new CompoundCommand(commands, "Paste selection");
      this.commandStack.execute(compound);

      this.selectedNodeIdSet.clear();
      this.selectedEdgeIdSet.clear();
      for (const n of newNodes) this.selectedNodeIdSet.add(n.id);
      for (const e of newEdges) this.selectedEdgeIdSet.add(e.id);
      this.notify();
    }

    return { nodes: newNodes, edges: newEdges };
  }

  duplicateSelection(
    offset: Point = { x: 30, y: 30 }
  ): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
    const clipboardData = this.copySelection();
    if (!clipboardData || clipboardData.nodes.length === 0) {
      return { nodes: [], edges: [] };
    }
    return this.paste(offset, clipboardData);
  }

  alignNodes(type: AlignmentType): boolean {
    const selectedNodes = this.diagram.nodes.filter(
      (n) => this.selectedNodeIdSet.has(n.id) && !this.isNodeLocked(n.id)
    );
    if (selectedNodes.length < 2) return false;

    const minX = Math.min(...selectedNodes.map((n) => n.position.x));
    const maxX = Math.max(...selectedNodes.map((n) => n.position.x + n.size.width));
    const minY = Math.min(...selectedNodes.map((n) => n.position.y));
    const maxY = Math.max(...selectedNodes.map((n) => n.position.y + n.size.height));
    const midX = minX + (maxX - minX) / 2;
    const midY = minY + (maxY - minY) / 2;

    const moves: Array<{ nodeId: string; oldPos: Point; newPos: Point }> = [];

    for (const node of selectedNodes) {
      let targetX = node.position.x;
      let targetY = node.position.y;

      switch (type) {
        case "left":
          targetX = minX;
          break;
        case "center":
          targetX = Math.round(midX - node.size.width / 2);
          break;
        case "right":
          targetX = maxX - node.size.width;
          break;
        case "top":
          targetY = minY;
          break;
        case "middle":
          targetY = Math.round(midY - node.size.height / 2);
          break;
        case "bottom":
          targetY = maxY - node.size.height;
          break;
      }

      if (targetX !== node.position.x || targetY !== node.position.y) {
        moves.push({
          nodeId: node.id,
          oldPos: { ...node.position },
          newPos: { x: targetX, y: targetY },
        });
      }
    }

    if (moves.length === 0) return false;
    this.moveNodes(moves);
    return true;
  }

  distributeNodes(direction: DistributionDirection): boolean {
    const selectedNodes = this.diagram.nodes.filter(
      (n) => this.selectedNodeIdSet.has(n.id) && !this.isNodeLocked(n.id)
    );
    if (selectedNodes.length < 3) return false;

    const moves: Array<{ nodeId: string; oldPos: Point; newPos: Point }> = [];

    if (direction === "horizontal") {
      const sorted = [...selectedNodes].sort((a, b) => a.position.x - b.position.x);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = last.position.x + last.size.width - first.position.x;
      const totalWidth = sorted.reduce((sum, n) => sum + n.size.width, 0);
      const totalGap = Math.max(0, totalSpan - totalWidth);
      const gap = totalGap / (sorted.length - 1);

      let currentX = first.position.x;
      for (const node of sorted) {
        const targetX = Math.round(currentX);
        if (targetX !== node.position.x) {
          moves.push({
            nodeId: node.id,
            oldPos: { ...node.position },
            newPos: { x: targetX, y: node.position.y },
          });
        }
        currentX += node.size.width + gap;
      }
    } else {
      const sorted = [...selectedNodes].sort((a, b) => a.position.y - b.position.y);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = last.position.y + last.size.height - first.position.y;
      const totalHeight = sorted.reduce((sum, n) => sum + n.size.height, 0);
      const totalGap = Math.max(0, totalSpan - totalHeight);
      const gap = totalGap / (sorted.length - 1);

      let currentY = first.position.y;
      for (const node of sorted) {
        const targetY = Math.round(currentY);
        if (targetY !== node.position.y) {
          moves.push({
            nodeId: node.id,
            oldPos: { ...node.position },
            newPos: { x: node.position.x, y: targetY },
          });
        }
        currentY += node.size.height + gap;
      }
    }

    if (moves.length === 0) return false;
    this.moveNodes(moves);
    return true;
  }

  matchNodeSizes(dimension: "width" | "height" | "both"): boolean {
    const selectedNodes = this.diagram.nodes.filter(
      (n) => this.selectedNodeIdSet.has(n.id) && !this.isNodeLocked(n.id)
    );
    if (selectedNodes.length < 2) return false;

    const maxWidth = Math.max(...selectedNodes.map((n) => n.size.width));
    const maxHeight = Math.max(...selectedNodes.map((n) => n.size.height));

    const commands: ResizeNodeCommand[] = [];
    for (const node of selectedNodes) {
      const targetW = dimension === "height" ? node.size.width : maxWidth;
      const targetH = dimension === "width" ? node.size.height : maxHeight;

      if (targetW !== node.size.width || targetH !== node.size.height) {
        commands.push(
          new ResizeNodeCommand(
            this.diagram,
            node.id,
            { position: { ...node.position }, size: { ...node.size } },
            { position: { ...node.position }, size: { width: targetW, height: targetH } }
          )
        );
      }
    }

    if (commands.length === 0) return false;
    this.commandStack.execute(new CompoundCommand(commands, "Match node sizes"));
    this.notify();
    return true;
  }

  // --- Notifications ---

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private pruneSelection(): void {
    const existingNodeIds = new Set(this.diagram.nodes.map((n) => n.id));
    const existingEdgeIds = new Set(this.diagram.edges.map((e) => e.id));
    const existingGroupIds = new Set(this.diagram.groups.map((g) => g.id));

    for (const id of this.selectedNodeIdSet) {
      if (!existingNodeIds.has(id)) {
        this.selectedNodeIdSet.delete(id);
      }
    }
    for (const id of this.selectedEdgeIdSet) {
      if (!existingEdgeIds.has(id)) {
        this.selectedEdgeIdSet.delete(id);
      }
    }
    for (const id of this.selectedGroupIdSet) {
      if (!existingGroupIds.has(id)) {
        this.selectedGroupIdSet.delete(id);
      }
    }
    this.notify();
  }
}
