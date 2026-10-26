import { Diagram } from "../../domain/entities/Diagram";
import { DiagramNode, createDiagramNode, NodeStyle } from "../../domain/entities/DiagramNode";
import {
  DiagramEdge,
  EdgeStyle,
  LinePatternType,
  LineEndingType,
  createDiagramEdge,
} from "../../domain/entities/DiagramEdge";
import { Point } from "../../domain/value-objects/Point";
import { Rect, Size, rect, intersects, contains, center } from "../../domain/value-objects/Rect";
import { CommandStack } from "../commands/CommandStack";
import { Layer, createLayer } from "../../domain/entities/Layer";
import { Group } from "../../domain/entities/Group";
import { Port } from "../../domain/entities/Port";
import { Compartment } from "../../domain/entities/Compartment";
import { Label } from "../../domain/entities/Label";
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
  computeGroupBounds,
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
  MoveEdgesCommand,
  ReverseEdgeCommand,
  UpdateEdgeKindCommand,
  UpdateEdgeStyleCommand,
  EdgeMove,
  SwitchDiagramTypeCommand,
  AutoResizeNodeCommand,
  LayoutSequenceDiagramCommand,
  CompoundCommand,
  SetColorCommand,
  SetFontCommand,
  FontStylePatch,
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
import { lineSegmentIntersectsRect, getRectCenter, getFacingSide } from "../../domain/services/Geometry";
import { ValidationIssue } from "../../domain/entities/DiagramTypeDefinition";
import { calculateNodeFitSize } from "../../domain/services/TextMeasurement";
import { defaultJsonCanvasImporter } from "../../infrastructure/persistence/JsonCanvasImporter";
import { Stereotype } from "../../domain/value-objects/Stereotype";
import { Stroke, defaultShapeRecognizer } from "../../domain/services/ShapeRecognizer";
import {
  SequenceLayoutOptions,
  SequenceLayoutResult,
} from "../../domain/services/SequenceLayoutEngine";
import {
  getNodeFontStyle,
  getEdgeFontStyle,
  getGroupFontStyle,
  FontStyleConfig,
} from "../../presentation/theme/Typography";
import { DiagramRepository } from "../ports/DiagramRepository";
import { defaultSvgExporter, SvgExportOptions } from "../../infrastructure/export/SvgExporter";
import { ExportForRAG } from "./ExportForRAG";
import { defaultEdgeStyleRegistry } from "../../presentation/renderer/EdgeStyleRegistry";

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
  taggedValues?: Record<string, string>;
  compartments?: Compartment[];
  style?: NodeStyle;
  labels?: Partial<Label>[];
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
  private activeFontStyle: FontStyleConfig = {};
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

  getActiveFont(): FontStyleConfig {
    return { ...this.activeFontStyle };
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

  get hasSelection(): boolean {
    return (
      this.selectedNodeIdSet.size > 0 ||
      this.selectedEdgeIdSet.size > 0 ||
      this.selectedGroupIdSet.size > 0
    );
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

  toggleEdgeSelection(id: string): void {
    if (this.selectedEdgeIdSet.has(id)) {
      this.selectedEdgeIdSet.delete(id);
    } else {
      this.selectedEdgeIdSet.add(id);
    }
    this.notify();
  }

  deselectEdge(id: string): void {
    if (this.selectedEdgeIdSet.delete(id)) {
      this.notify();
    }
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

    for (const edge of this.diagram.edges) {
      const fromNode = this.diagram.nodes.find((n) => n.id === edge.fromNodeId);
      const toNode = this.diagram.nodes.find((n) => n.id === edge.toNodeId);
      if (fromNode && toNode) {
        const fromCenter = getRectCenter(fromNode.position, fromNode.size);
        const toCenter = getRectCenter(toNode.position, toNode.size);
        const edgePts = [fromCenter, ...(edge.waypoints ?? []), toCenter];
        for (let i = 0; i < edgePts.length - 1; i++) {
          if (lineSegmentIntersectsRect(edgePts[i], edgePts[i + 1], area)) {
            this.selectedEdgeIdSet.add(edge.id);
            break;
          }
        }
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
    const title = options?.title ?? options?.labels?.[0]?.text ?? "New Node";

    const hasActiveFont =
      this.activeFontStyle.fontSize !== undefined ||
      Boolean(this.activeFontStyle.bold) ||
      Boolean(this.activeFontStyle.italic) ||
      Boolean(this.activeFontStyle.fontFamily);

    const effectiveStyle: NodeStyle = {
      ...(this.activeFontStyle.fontSize !== undefined ? { fontSize: this.activeFontStyle.fontSize } : {}),
      ...(this.activeFontStyle.bold ? { bold: true } : {}),
      ...(this.activeFontStyle.italic ? { italic: true } : {}),
      ...(this.activeFontStyle.fontFamily ? { fontFamily: this.activeFontStyle.fontFamily } : {}),
      ...(options?.style ?? {}),
    };

    const node = createDiagramNode({
      id,
      kind,
      position,
      size,
      ports: options?.ports ?? [],
      childDiagramId: options?.childDiagramId,
      stereotype: options?.stereotype,
      taggedValues: options?.taggedValues,
      compartments: options?.compartments,
      style: options?.style || hasActiveFont ? effectiveStyle : undefined,
      customData: options?.customData,
      metadata: options?.metadata ? { ...options.metadata } : {},
      labels: options?.labels && options.labels.length > 0
        ? options.labels.map((l, idx) => ({
            id: l.id || `label-${id}-${idx}`,
            text: l.text ?? title,
            anchor: l.anchor ?? "node",
            position: l.position ?? { x: 0, y: 0 },
            style: {
              ...(effectiveStyle.fontSize !== undefined ? { fontSize: effectiveStyle.fontSize } : {}),
              ...(effectiveStyle.bold ? { bold: true } : {}),
              ...(effectiveStyle.italic ? { italic: true } : {}),
              ...(effectiveStyle.fontFamily ? { fontFamily: effectiveStyle.fontFamily } : {}),
              ...(l.style ?? {}),
            },
          }))
        : [
            {
              id: `label-${id}-0`,
              text: title,
              anchor: "node",
              position: { x: 0, y: 0 },
              style: {
                ...(effectiveStyle.fontSize !== undefined ? { fontSize: effectiveStyle.fontSize } : {}),
                ...(effectiveStyle.bold ? { bold: true } : {}),
                ...(effectiveStyle.italic ? { italic: true } : {}),
                ...(effectiveStyle.fontFamily ? { fontFamily: effectiveStyle.fontFamily } : {}),
              },
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
  public defaultMarkerStart?: string;
  public defaultMarkerEnd?: string;
  public defaultLineType?: LinePatternType;

  addEdge(
    fromNodeId: string,
    toNodeId: string,
    options?: Partial<DiagramEdge>
  ): DiagramEdge {
    const id =
      options?.id ?? `edge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const kind = options?.kind ?? this.activeEdgeKind;
    const routing = options?.routing ?? this.defaultRouting;

    let edgeStyle = options?.style ? { ...options.style } : undefined;
    if (
      this.defaultMarkerStart !== undefined ||
      this.defaultMarkerEnd !== undefined ||
      this.defaultLineType !== undefined
    ) {
      edgeStyle = edgeStyle ?? {};
      if (edgeStyle.markerStart === undefined && this.defaultMarkerStart !== undefined) {
        edgeStyle.markerStart = this.defaultMarkerStart;
      }
      if (edgeStyle.markerEnd === undefined && this.defaultMarkerEnd !== undefined) {
        edgeStyle.markerEnd = this.defaultMarkerEnd;
      }
      if (edgeStyle.lineType === undefined && this.defaultLineType !== undefined) {
        edgeStyle.lineType = this.defaultLineType;
      }
    }

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
      style: edgeStyle,
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

  groupSelection(name = "Group", color?: string): Group | null {
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
    // If no explicit color was specified, check if all selected nodes share a common color preset/hex
    if (!color) {
      const selectedNodes = this.diagram.nodes.filter((n) => nodeIds.includes(n.id));
      const firstColor = selectedNodes[0]?.style?.color;
      if (firstColor && selectedNodes.every((n) => n.style?.color === firstColor)) {
        color = firstColor;
      }
    }

    const pad = 16;
    const initialPos = isFinite(minX) ? { x: Math.round(minX - pad), y: Math.round(minY - pad - 26) } : undefined;
    const initialSize = isFinite(minX) ? { width: Math.round(maxX - minX + pad * 2), height: Math.round(maxY - minY + pad * 2 + 26) } : undefined;

    const cmd = new GroupSelectionCommand(this.diagram, groupId, name, nodeIds, initialPos, initialSize, color);
    this.commandStack.execute(cmd);

    const group = this.diagram.groups.find((g) => g.id === groupId) ?? null;
    if (group) {
      this.selectedNodeIdSet.clear();
      this.selectedEdgeIdSet.clear();
      this.selectedGroupIdSet.clear();
      this.selectedGroupIdSet.add(group.id);
      this.notify();
    }
    return group;
  }

  addGroup(params?: {
    name?: string;
    color?: string;
    position?: Point;
    size?: Size;
    nodeIds?: string[];
  }): Group {
    const groupId = `group-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const name = params?.name ?? "Group";
    const color = params?.color;
    const nodeIds = params?.nodeIds ? [...params.nodeIds] : [];
    const position = params?.position ?? { x: 100, y: 100 };
    const size = params?.size ?? { width: 300, height: 200 };

    if (!params?.nodeIds) {
      const groupRect = rect(position, size);
      for (const node of this.diagram.nodes) {
        const nodeCenter = center(rect(node.position, node.size));
        if (contains(groupRect, nodeCenter) || contains(groupRect, node.position)) {
          if (!nodeIds.includes(node.id)) {
            nodeIds.push(node.id);
          }
        }
      }
    }

    const cmd = new GroupSelectionCommand(
      this.diagram,
      groupId,
      name,
      nodeIds,
      position,
      size,
      color
    );
    this.commandStack.execute(cmd);

    const group = this.diagram.groups.find((g) => g.id === groupId)!;
    this.selectedNodeIdSet.clear();
    this.selectedEdgeIdSet.clear();
    this.selectedGroupIdSet.clear();
    this.selectedGroupIdSet.add(group.id);
    this.notify();
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

  getGroupBounds(group: Group): Rect {
    return computeGroupBounds(this.diagram, group);
  }

  renameGroup(groupId: string, newName: string): void {
    const group = this.diagram.groups.find((g) => g.id === groupId);
    if (!group || group.locked || group.name === newName) return;
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
    const cmd = new ResizeGroupCommand(group, newPosition, newSize, this.diagram);
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
    if (set.size === group.nodeIds.length) return;
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

  updateEdgeKind(edgeId: string, kind: string): void {
    const edge = this.diagram.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const styleDef = defaultEdgeStyleRegistry.get(kind);
    const newStyle: Partial<EdgeStyle> = {
      markerStart: styleDef.markerStartId ?? "none",
      markerEnd: styleDef.markerEndId ?? "none",
      lineType: styleDef.strokeDasharray ? "dashed" : "solid",
      dashed: Boolean(styleDef.strokeDasharray),
      strokeDasharray: styleDef.strokeDasharray,
    };
    const cmd = new UpdateEdgeKindCommand(this.diagram, edgeId, kind, newStyle);
    this.commandStack.execute(cmd);
  }

  updateEdgeStyle(
    edgeId: string,
    styleUpdates: Partial<EdgeStyle>,
    newKind?: string
  ): void {
    const cmd = new UpdateEdgeStyleCommand(this.diagram, edgeId, styleUpdates, newKind);
    this.commandStack.execute(cmd);
  }

  setEdgeMarkerStart(edgeId: string, markerStart: string | undefined): void {
    const edge = this.diagram.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const norm = markerStart || "none";
    const currentEnd = edge.style?.markerEnd ?? defaultEdgeStyleRegistry.get(edge.kind).markerEndId ?? "none";
    const currentType = edge.style?.lineType ?? (edge.style?.dashed || defaultEdgeStyleRegistry.get(edge.kind).strokeDasharray ? "dashed" : "solid");
    const inferredKind = this.inferEdgeKind(norm, currentEnd, currentType, edge.kind);
    this.updateEdgeStyle(edgeId, { markerStart: norm }, inferredKind);
  }

  setEdgeMarkerEnd(edgeId: string, markerEnd: string | undefined): void {
    const edge = this.diagram.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const norm = markerEnd || "none";
    const currentStart = edge.style?.markerStart ?? defaultEdgeStyleRegistry.get(edge.kind).markerStartId ?? "none";
    const currentType = edge.style?.lineType ?? (edge.style?.dashed || defaultEdgeStyleRegistry.get(edge.kind).strokeDasharray ? "dashed" : "solid");
    const inferredKind = this.inferEdgeKind(currentStart, norm, currentType, edge.kind);
    this.updateEdgeStyle(edgeId, { markerEnd: norm }, inferredKind);
  }

  setEdgeLineType(edgeId: string, lineType: LinePatternType): void {
    const edge = this.diagram.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const dashMap: Record<LinePatternType, string | undefined> = {
      solid: undefined,
      dashed: "6 4",
      dotted: "2 4",
      "dash-dot": "8 4 2 4",
      "long-dash": "12 5",
    };
    const dashed = lineType !== "solid";
    const currentStart = edge.style?.markerStart ?? defaultEdgeStyleRegistry.get(edge.kind).markerStartId ?? "none";
    const currentEnd = edge.style?.markerEnd ?? defaultEdgeStyleRegistry.get(edge.kind).markerEndId ?? "none";
    const inferredKind = this.inferEdgeKind(currentStart, currentEnd, lineType, edge.kind);
    this.updateEdgeStyle(
      edgeId,
      {
        lineType,
        strokeDasharray: dashMap[lineType],
        dashed,
      },
      inferredKind
    );
  }

  setEdgeLineSettings(
    edgeId: string,
    settings: {
      markerStart?: string;
      markerEnd?: string;
      lineType?: LinePatternType;
      routing?: EdgeRouting;
      kind?: string;
    }
  ): void {
    const edge = this.diagram.edges.find((e) => e.id === edgeId);
    if (!edge) return;

    const dashMap: Record<LinePatternType, string | undefined> = {
      solid: undefined,
      dashed: "6 4",
      dotted: "2 4",
      "dash-dot": "8 4 2 4",
      "long-dash": "12 5",
    };

    const styleUpdates: Partial<EdgeStyle> = {};
    if (settings.markerStart !== undefined) styleUpdates.markerStart = settings.markerStart;
    if (settings.markerEnd !== undefined) styleUpdates.markerEnd = settings.markerEnd;
    if (settings.lineType !== undefined) {
      styleUpdates.lineType = settings.lineType;
      styleUpdates.strokeDasharray = dashMap[settings.lineType];
      styleUpdates.dashed = settings.lineType !== "solid";
    }

    const start = settings.markerStart ?? edge.style?.markerStart ?? defaultEdgeStyleRegistry.get(edge.kind).markerStartId ?? "none";
    const end = settings.markerEnd ?? edge.style?.markerEnd ?? defaultEdgeStyleRegistry.get(edge.kind).markerEndId ?? "none";
    const type = settings.lineType ?? edge.style?.lineType ?? (edge.style?.dashed || defaultEdgeStyleRegistry.get(edge.kind).strokeDasharray ? "dashed" : "solid");
    const inferredKind = settings.kind ?? this.inferEdgeKind(start, end, type, edge.kind);

    if (settings.routing && settings.routing !== edge.routing) {
      this.updateEdgeRouting(edgeId, settings.routing);
    }
    this.updateEdgeStyle(edgeId, styleUpdates, inferredKind);
  }

  public inferEdgeKind(
    markerStart: string,
    markerEnd: string,
    lineType: LinePatternType | string,
    fallbackKind?: string
  ): string {
    const s = markerStart.replace(/^uml-marker-/, "");
    const e = markerEnd.replace(/^uml-marker-/, "");
    const isDashed = lineType === "dashed" || lineType === "dotted";

    if (s === "diamond-hollow" && (e === "open-arrow" || e === "arrow")) return "uml.directedAggregation";
    if (s === "diamond-filled" && (e === "open-arrow" || e === "arrow")) return "uml.directedComposition";
    if (s === "diamond-hollow" && (e === "none" || !e)) return "uml.aggregation";
    if (s === "diamond-filled" && (e === "none" || !e)) return "uml.composition";
    if ((s === "none" || !s) && (e === "triangle-hollow" || e === "triangle") && isDashed) return "uml.realization";
    if ((s === "none" || !s) && (e === "triangle-hollow" || e === "triangle")) return "uml.generalization";
    if ((s === "none" || !s) && (e === "open-arrow" || e === "arrow") && isDashed) return "uml.dependency";
    if ((s === "none" || !s) && (e === "open-arrow" || e === "arrow")) return "uml.directedAssociation";
    if ((s === "none" || !s) && (e === "none" || !e)) return "uml.association";
    if ((s === "none" || !s) && e === "triangle-filled") return "profile.extension";
    if ((s === "none" || !s) && e === "arrow-filled") return "sequence.syncMessage";
    return fallbackKind ?? "uml.association";
  }

  getEdgeEffectiveStartMarker(edge: DiagramEdge): string {
    if (edge.style?.markerStart !== undefined) {
      return edge.style.markerStart;
    }
    const def = defaultEdgeStyleRegistry.get(edge.kind);
    return def.markerStartId ?? "none";
  }

  getEdgeEffectiveEndMarker(edge: DiagramEdge): string {
    if (edge.style?.markerEnd !== undefined) {
      return edge.style.markerEnd;
    }
    const def = defaultEdgeStyleRegistry.get(edge.kind);
    return def.markerEndId ?? "none";
  }

  getEdgeEffectiveLineType(edge: DiagramEdge): LinePatternType {
    if (edge.style?.lineType) {
      return edge.style.lineType;
    }
    if (edge.style?.strokeDasharray?.includes("2") || edge.style?.strokeDasharray?.includes("3")) {
      return "dotted";
    }
    if (edge.style?.dashed || edge.style?.strokeDasharray || defaultEdgeStyleRegistry.get(edge.kind).strokeDasharray) {
      return "dashed";
    }
    return "solid";
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

  addEdgeWaypoint(edgeId: string, point: Point, index?: number): void {
    const edge = this.diagram.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const current = edge.waypoints ? [...edge.waypoints] : [];
    if (index !== undefined && index >= 0 && index <= current.length) {
      current.splice(index, 0, { ...point });
    } else {
      current.push({ ...point });
    }
    this.updateEdgeWaypoints(edgeId, current);
  }

  removeEdgeWaypoint(edgeId: string, index: number): void {
    const edge = this.diagram.edges.find((e) => e.id === edgeId);
    if (!edge || !edge.waypoints || index < 0 || index >= edge.waypoints.length) return;
    const current = [...edge.waypoints];
    current.splice(index, 1);
    this.updateEdgeWaypoints(edgeId, current.length > 0 ? current : undefined);
  }

  moveEdgeWaypoints(edgeId: string, dx: number, dy: number): void {
    const edge = this.diagram.edges.find((e) => e.id === edgeId);
    if (!edge || !edge.waypoints || edge.waypoints.length === 0) return;
    const moved = edge.waypoints.map((p) => ({
      x: Math.round(p.x + dx),
      y: Math.round(p.y + dy),
    }));
    this.updateEdgeWaypoints(edgeId, moved);
  }

  moveEdges(moves: EdgeMove[]): void {
    if (moves.length === 0) return;
    const cmd = new MoveEdgesCommand(this.diagram, moves);
    this.commandStack.execute(cmd);
  }

  rerouteEdge(edgeId: string): void {
    this.clearEdgeWaypoints(edgeId);
  }

  reverseEdge(edgeId: string): void {
    const edge = this.diagram.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const cmd = new ReverseEdgeCommand(this.diagram, edgeId);
    this.commandStack.execute(cmd);
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

  getGroupColor(groupId: string): string | undefined {
    const group = this.diagram.groups.find((g) => g.id === groupId);
    return group?.color;
  }

  setColorForSelection(color: string | undefined): void {
    const nodes = this.diagram.nodes.filter((n) => this.selectedNodeIds.includes(n.id));
    const edges = this.diagram.edges.filter((e) => this.selectedEdgeIds.includes(e.id));
    
    // Include directly selected groups, or groups whose nodes are selected if no groups are explicitly selected
    const groups = this.diagram.groups.filter((g) =>
      this.selectedGroupIdSet.has(g.id) ||
      (this.selectedGroupIdSet.size === 0 && g.nodeIds.length > 0 && g.nodeIds.every((id) => this.selectedNodeIds.includes(id)))
    );

    if (nodes.length === 0 && edges.length === 0 && groups.length === 0) return;

    const cmd = new SetColorCommand({ nodes, edges, groups }, color);
    this.commandStack.execute(cmd);
  }

  // --- Font Adjustments (Font Size, Weights, Italics) ---

  setNodeFont(nodeId: string | string[], patch: FontStylePatch): void {
    const ids = Array.isArray(nodeId) ? nodeId : [nodeId];
    const nodes = this.diagram.nodes.filter((n) => ids.includes(n.id));
    if (nodes.length === 0) return;
    const cmd = new SetFontCommand({ nodes }, patch);
    this.commandStack.execute(cmd);
  }

  getNodeFont(nodeId: string): FontStyleConfig {
    const node = this.diagram.nodes.find((n) => n.id === nodeId);
    if (!node) return {};
    return getNodeFontStyle(node);
  }

  setEdgeFont(edgeId: string | string[], patch: FontStylePatch): void {
    const ids = Array.isArray(edgeId) ? edgeId : [edgeId];
    const edges = this.diagram.edges.filter((e) => ids.includes(e.id));
    if (edges.length === 0) return;
    const cmd = new SetFontCommand({ edges }, patch);
    this.commandStack.execute(cmd);
  }

  getEdgeFont(edgeId: string): FontStyleConfig {
    const edge = this.diagram.edges.find((e) => e.id === edgeId);
    if (!edge) return {};
    return getEdgeFontStyle(edge);
  }

  setGroupFont(groupId: string | string[], patch: FontStylePatch): void {
    const ids = Array.isArray(groupId) ? groupId : [groupId];
    const groups = this.diagram.groups.filter((g) => ids.includes(g.id));
    if (groups.length === 0) return;
    const cmd = new SetFontCommand({ groups }, patch);
    this.commandStack.execute(cmd);
  }

  getGroupFont(groupId: string): FontStyleConfig {
    const group = this.diagram.groups.find((g) => g.id === groupId);
    if (!group) return {};
    return getGroupFontStyle(group);
  }

  setFontForSelection(patch: FontStylePatch): void {
    if (patch.reset) {
      this.activeFontStyle = {};
    } else {
      if (patch.fontSize !== undefined) this.activeFontStyle.fontSize = patch.fontSize;
      if (patch.bold !== undefined) this.activeFontStyle.bold = patch.bold;
      if (patch.italic !== undefined) this.activeFontStyle.italic = patch.italic;
      if (patch.fontWeight !== undefined) this.activeFontStyle.fontWeight = patch.fontWeight;
      if (patch.fontStyle !== undefined) {
        this.activeFontStyle.fontStyle = patch.fontStyle;
        this.activeFontStyle.italic = patch.fontStyle === "italic";
      }
      if (patch.fontFamily !== undefined) this.activeFontStyle.fontFamily = patch.fontFamily;
    }

    const nodes = this.diagram.nodes.filter((n) => this.selectedNodeIds.includes(n.id));
    const edges = this.diagram.edges.filter((e) => this.selectedEdgeIds.includes(e.id));
    const groups = this.diagram.groups.filter((g) =>
      this.selectedGroupIdSet.has(g.id) ||
      g.nodeIds.some((id) => this.selectedNodeIds.includes(id))
    );

    if (nodes.length === 0 && edges.length === 0 && groups.length === 0) {
      this.notify();
      return;
    }

    const cmd = new SetFontCommand({ nodes, edges, groups }, patch);
    this.commandStack.execute(cmd);
  }

  setFontForAllElements(patch: FontStylePatch): void {
    if (patch.reset) {
      this.activeFontStyle = {};
    } else {
      if (patch.fontSize !== undefined) this.activeFontStyle.fontSize = patch.fontSize;
      if (patch.bold !== undefined) this.activeFontStyle.bold = patch.bold;
      if (patch.italic !== undefined) this.activeFontStyle.italic = patch.italic;
      if (patch.fontWeight !== undefined) this.activeFontStyle.fontWeight = patch.fontWeight;
      if (patch.fontStyle !== undefined) {
        this.activeFontStyle.fontStyle = patch.fontStyle;
        this.activeFontStyle.italic = patch.fontStyle === "italic";
      }
      if (patch.fontFamily !== undefined) this.activeFontStyle.fontFamily = patch.fontFamily;
    }

    const nodes = [...this.diagram.nodes];
    const edges = [...this.diagram.edges];
    const groups = [...this.diagram.groups];

    if (nodes.length === 0 && edges.length === 0 && groups.length === 0) {
      this.notify();
      return;
    }

    const cmd = new SetFontCommand({ nodes, edges, groups }, patch);
    this.commandStack.execute(cmd);
  }

  setFontFamilyForSelection(fontFamily?: string): void {
    this.setFontForSelection({ fontFamily });
  }

  setFontFamilyForAllElements(fontFamily?: string): void {
    this.setFontForAllElements({ fontFamily });
  }

  setFontSizeForSelection(fontSize: number | undefined): void {
    if (fontSize === undefined) {
      this.setFontForSelection({ reset: true });
    } else {
      this.setFontForSelection({ fontSize });
    }
  }

  toggleBoldForSelection(): void {
    const font = this.getSelectionFont();
    this.setFontForSelection({ bold: !font.isBold });
  }

  toggleItalicForSelection(): void {
    const font = this.getSelectionFont();
    this.setFontForSelection({ italic: !font.isItalic });
  }

  adjustFontSizeForSelection(delta: number): void {
    const font = this.getSelectionFont();
    const currentSize = font.fontSize ?? 13;
    const newSize = Math.max(8, Math.min(72, currentSize + delta));
    this.setFontSizeForSelection(newSize);
  }

  resetFontForSelection(): void {
    this.setFontForSelection({ reset: true });
  }

  getSelectionFont(): {
    fontSize?: number;
    isBold: boolean;
    isItalic: boolean;
    bold: boolean;
    italic: boolean;
    fontFamily?: string;
  } {
    const nodes = this.diagram.nodes.filter((n) => this.selectedNodeIds.includes(n.id));
    const edges = this.diagram.edges.filter((e) => this.selectedEdgeIds.includes(e.id));
    const groups = this.diagram.groups.filter((g) =>
      this.selectedGroupIdSet.has(g.id) ||
      g.nodeIds.some((id) => this.selectedNodeIds.includes(id))
    );

    const firstNode = nodes[0];
    const firstEdge = edges[0];
    const firstGroup = groups[0];

    if (firstNode) {
      const f = getNodeFontStyle(firstNode);
      const isBold = Boolean(f.bold);
      const isItalic = Boolean(f.italic);
      return { fontSize: f.fontSize, isBold, isItalic, bold: isBold, italic: isItalic, fontFamily: f.fontFamily };
    }
    if (firstEdge) {
      const f = getEdgeFontStyle(firstEdge);
      const isBold = Boolean(f.bold);
      const isItalic = Boolean(f.italic);
      return { fontSize: f.fontSize, isBold, isItalic, bold: isBold, italic: isItalic, fontFamily: f.fontFamily };
    }
    if (firstGroup) {
      const f = getGroupFontStyle(firstGroup);
      const isBold = Boolean(f.bold);
      const isItalic = Boolean(f.italic);
      return { fontSize: f.fontSize, isBold, isItalic, bold: isBold, italic: isItalic, fontFamily: f.fontFamily };
    }

    const isBold = Boolean(this.activeFontStyle.bold);
    const isItalic = Boolean(this.activeFontStyle.italic);
    return {
      fontSize: this.activeFontStyle.fontSize,
      isBold,
      isItalic,
      bold: isBold,
      italic: isItalic,
      fontFamily: this.activeFontStyle.fontFamily,
    };
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

  // --- Export Helpers (F-024) ---

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
    const dt = this.diagram.diagramType;

    const isClosedShape =
      result.shape === "rectangle" ||
      result.shape === "square" ||
      result.shape === "diamond" ||
      result.shape === "ellipse" ||
      result.shape === "circle" ||
      result.shape === "triangle";

    const sp =
      result.startPoint ??
      (stroke.points && stroke.points.length > 0
        ? stroke.points[0]
        : {
            x: result.bounds.position.x,
            y: result.bounds.position.y,
          });
    const ep =
      result.endPoint ??
      (stroke.points && stroke.points.length > 0
        ? stroke.points[stroke.points.length - 1]
        : {
            x: result.bounds.position.x + result.bounds.size.width,
            y: result.bounds.position.y + result.bounds.size.height,
          });

    // 1. Handdrawn Connection Line between 2 components (Issue #5)
    // If user drew a line or stroke between two components, connect them directly
    if (!isClosedShape && stroke.points && stroke.points.length >= 2) {
      const fromNode = this.findNearestNode(sp, 140);
      const toNode = this.findNearestNode(ep, 140, fromNode?.id);

      if (fromNode && toNode && fromNode.id !== toNode.id) {
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
              edgeKind = this.activeEdgeKind ?? "uml.association";
          }
        }

        // Determine optimal connection sides between the two components
        const fromCenter = {
          x: fromNode.position.x + fromNode.size.width / 2,
          y: fromNode.position.y + fromNode.size.height / 2,
        };
        const toCenter = {
          x: toNode.position.x + toNode.size.width / 2,
          y: toNode.position.y + toNode.size.height / 2,
        };

        const distFromCenter = Math.hypot(sp.x - fromCenter.x, sp.y - fromCenter.y);
        const distToCenter = Math.hypot(ep.x - toCenter.x, ep.y - toCenter.y);

        const fromSide: Side =
          distFromCenter > 20
            ? getFacingSide(fromNode.position, fromNode.size, sp)
            : getFacingSide(fromNode.position, fromNode.size, toCenter);
        const toSide: Side =
          distToCenter > 20
            ? getFacingSide(toNode.position, toNode.size, ep)
            : getFacingSide(toNode.position, toNode.size, fromCenter);

        const fromPort = fromNode.ports?.find((p) => p.side === fromSide);
        const toPort = toNode.ports?.find((p) => p.side === toSide);

        return this.addEdge(fromNode.id, toNode.id, {
          kind: edgeKind,
          fromSide,
          toSide,
          fromPortId: fromPort?.id,
          toPortId: toPort?.id,
        });
      }
    }

    if (result.confidence < confidenceThreshold || result.shape === "none") {
      if (opts.fallbackToFreehand) {
        return this.addFreehandNode(stroke);
      }
      return null;
    }

    // Closed nodes: Rectangle, Square, Diamond, Ellipse, Circle, Triangle
    if (isClosedShape) {
      let nodeKind = "generic.rectangle";
      let title = "";

      if (result.shape === "circle") {
        if (dt === "uml.activity") {
          nodeKind = "activity.initial";
          title = "";
        } else if (dt === "uml.stateMachine" || dt === "uml.state") {
          nodeKind = "state.initial";
          title = "";
        } else {
          nodeKind = "generic.circle";
          title = "";
        }
      } else if (result.shape === "triangle") {
        nodeKind = "generic.triangle";
        title = "";
      } else if (result.shape === "rectangle" || result.shape === "square") {
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
            title = "";
        }
      } else if (result.shape === "diamond") {
        switch (dt) {
          case "uml.stateMachine":
          case "uml.state":
            nodeKind = "state.choice";
            title = "";
            break;
          case "uml.activity":
            nodeKind = "activity.decision";
            title = "Decision";
            break;
          default:
            nodeKind = "generic.diamond";
            title = "";
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
            nodeKind = "uml.usecase";
            title = "Use Case";
            break;
          default:
            nodeKind = "generic.ellipse";
            title = "";
        }
      }

      let width = Math.max(30, Math.round(result.bounds.size.width));
      let height = Math.max(30, Math.round(result.bounds.size.height));
      if (nodeKind === "generic.circle" || result.shape === "square") {
        const side = Math.round((width + height) / 2);
        width = Math.max(30, side);
        height = Math.max(30, side);
      }

      return this.addNode({
        kind: nodeKind,
        position: {
          x: Math.round(result.bounds.position.x),
          y: Math.round(result.bounds.position.y),
        },
        size: {
          width,
          height,
        },
        title,
      });
    }

    if (opts.fallbackToFreehand) {
      return this.addFreehandNode(stroke);
    }

    return null;
  }

  private distanceToNode(pt: Point, node: DiagramNode): number {
    const rx = node.position.x;
    const ry = node.position.y;
    const rw = node.size.width;
    const rh = node.size.height;

    // Inside node bounds -> distance is 0
    if (pt.x >= rx && pt.x <= rx + rw && pt.y >= ry && pt.y <= ry + rh) {
      return 0;
    }

    // Minimum distance from pt to rectangle perimeter
    const clampedX = Math.max(rx, Math.min(rx + rw, pt.x));
    const clampedY = Math.max(ry, Math.min(ry + rh, pt.y));
    return Math.hypot(pt.x - clampedX, pt.y - clampedY);
  }

  private findNearestNode(
    pt: Point,
    maxDist = 120,
    excludeNodeId?: string
  ): DiagramNode | null {
    let bestNode: DiagramNode | null = null;
    let minDist = maxDist;

    // Prefer standard shapes over raw freehand doodles
    for (const node of this.diagram.nodes) {
      if (excludeNodeId && node.id === excludeNodeId) continue;
      if (node.kind === "generic.freehand") continue;

      const d = this.distanceToNode(pt, node);
      if (d < minDist) {
        minDist = d;
        bestNode = node;
      }
    }

    // Fallback: include freehand nodes if no standard shape was found within range
    if (!bestNode) {
      for (const node of this.diagram.nodes) {
        if (excludeNodeId && node.id === excludeNodeId) continue;
        const d = this.distanceToNode(pt, node);
        if (d < minDist) {
          minDist = d;
          bestNode = node;
        }
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
    if (
      !data ||
      ((!data.nodes || data.nodes.length === 0) &&
        (!data.edges || data.edges.length === 0))
    ) {
      return { nodes: [], edges: [] };
    }

    const nodeIdMap = new Map<string, string>();
    const portIdMap = new Map<string, string>();
    const newNodes: DiagramNode[] = [];
    const newEdges: DiagramEdge[] = [];
    const commands: (AddNodeCommand | AddEdgeCommand)[] = [];

    // Remap nodes
    for (const node of data.nodes || []) {
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

    // Remap edges connecting copied nodes, or duplicate selected edges connecting existing nodes
    for (const edge of data.edges || []) {
      const newFromNodeId =
        nodeIdMap.get(edge.fromNodeId) ??
        (this.diagram.nodes.some((n) => n.id === edge.fromNodeId)
          ? edge.fromNodeId
          : undefined);
      const newToNodeId =
        nodeIdMap.get(edge.toNodeId) ??
        (this.diagram.nodes.some((n) => n.id === edge.toNodeId)
          ? edge.toNodeId
          : undefined);

      if (newFromNodeId && newToNodeId) {
        const newEdgeId = `edge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const newFromPortId = edge.fromPortId
          ? (portIdMap.get(edge.fromPortId) ?? edge.fromPortId)
          : undefined;
        const newToPortId = edge.toPortId
          ? (portIdMap.get(edge.toPortId) ?? edge.toPortId)
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
          fromSide: edge.fromSide,
          toSide: edge.toSide,
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
    if (
      !clipboardData ||
      (clipboardData.nodes.length === 0 && clipboardData.edges.length === 0)
    ) {
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
