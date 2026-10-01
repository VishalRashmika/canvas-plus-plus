import { DiagramEditor } from "../../application/use-cases/DiagramEditor";
import { DiagramNode } from "../../domain/entities/DiagramNode";
import { DiagramEdge } from "../../domain/entities/DiagramEdge";
import { Group } from "../../domain/entities/Group";
import { Point, point } from "../../domain/value-objects/Point";
import { Rect, Size, size, rect, rectFromBounds, intersects } from "../../domain/value-objects/Rect";
import { Side } from "../../domain/types";
import { ShapeRegistry, defaultShapeRegistry } from "./ShapeRegistry";
import {
  ViewportTransform,
  screenToCanvas,
  canvasToScreen,
  zoomAtPoint,
  clampZoom,
} from "./ViewportMath";
import { getSidePoint, getRectCenter, getFacingSide } from "./ConnectorGeometry";
import { defaultRoutingService } from "../../domain/services/RoutingService";
import { defaultSnappingService, AlignmentGuides } from "../../domain/services/SnappingService";
import { defaultEdgeStyleRegistry } from "./EdgeStyleRegistry";
import { Stroke, StrokePoint } from "../../domain/services/ShapeRecognizer";
import { resolveCanvasColor, isCanvasColorPreset } from "../../domain/value-objects/CanvasColor";
import { defaultCustomChipRegistry } from "../../domain/services/CustomChipRegistry";

export interface SvgSceneRendererOptions {
  shapeRegistry?: ShapeRegistry;
  showGrid?: boolean;
  initialTransform?: ViewportTransform;
  onTransformChange?: (transform: ViewportTransform) => void;
  onStrokeComplete?: (stroke: Stroke) => void;
  enableVirtualization?: boolean;
  virtualizationThreshold?: number;
  enableFreehand?: boolean;
  onModeChange?: (mode: "select" | "draw") => void;
  onContextMenu?: (
    e: MouseEvent,
    canvasPoint: Point,
    node?: DiagramNode,
    edge?: DiagramEdge,
    group?: Group
  ) => void;
  onNoteOpen?: (filePath: string) => void;
  onChipEdit?: (node: DiagramNode) => void;
  onExternalDrop?: (e: DragEvent, canvasPoint: Point) => boolean | Promise<boolean> | void;
  onRenderMarkdown?: (
    markdown: string,
    el: HTMLElement,
    sourcePath: string
  ) => Promise<void> | void;
}

type DragMode =
  | { type: "none" }
  | { type: "freehand" }
  | { type: "pan"; startClient: Point; startTransform: ViewportTransform }
  | {
      type: "move";
      startClient: Point;
      initialPositions: Map<string, Point>;
      moved: boolean;
      activeGuides?: AlignmentGuides;
    }
  | {
      type: "group-move";
      groupId: string;
      startClient: Point;
      initialGroupPos?: Point;
      initialMemberPositions: Map<string, Point>;
      moved: boolean;
    }
  | {
      type: "resize";
      nodeId: string;
      handle: string;
      startClient: Point;
      initialPosition: Point;
      initialSize: Size;
    }
  | {
      type: "group-resize";
      groupId: string;
      handle: string;
      startClient: Point;
      initialPosition: Point;
      initialSize: Size;
    }
  | {
      type: "edge";
      fromNodeId: string;
      fromPortId?: string;
      fromSide?: Side;
      startPoint: Point;
      currentCanvasPoint: Point;
    }
  | {
      type: "edge-reconnect";
      edgeId: string;
      endpoint: "source" | "target";
      fixedNodeId: string;
      fixedPoint: Point;
      currentPoint: Point;
      hoveredNodeId?: string;
      hoveredSide?: Side;
      hoveredPortId?: string;
    }
  | {
      type: "edge-waypoint";
      edgeId: string;
      waypointIndex: number;
      initialWaypoints: Point[];
    }
  | {
      type: "marquee";
      startCanvas: Point;
      currentCanvas: Point;
    };

const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

export class SvgSceneRenderer {
  private container: HTMLElement;
  private svgEl: SVGSVGElement;
  private viewportEl: SVGGElement;
  private gridRectEl: SVGRectElement;
  private groupsLayerEl: SVGGElement;
  private edgesLayerEl: SVGGElement;
  private nodesLayerEl: SVGGElement;
  private interactionLayerEl: SVGGElement;
  private inlineEditorEl: HTMLInputElement | null = null;
  private defsEl!: SVGDefsElement;
  private markerTemplates = new Map<
    string,
    {
      pathD: string;
      opts: {
        viewBox?: string;
        refX?: string;
        refY?: string;
        width?: string;
        height?: string;
        className?: string;
        fill?: string;
        stroke?: string;
      };
    }
  >();
  private createdMarkerIds = new Set<string>();

  public readonly shapeRegistry: ShapeRegistry;
  private showGrid: boolean;
  private transform: ViewportTransform = { panX: 0, panY: 0, zoom: 1.0 };
  private onTransformChange?: (transform: ViewportTransform) => void;
  private onStrokeComplete?: (stroke: Stroke) => void;

  private isFreehandMode = false;
  private activeStroke: Stroke | null = null;
  private freehandPathEl: SVGPathElement | null = null;
  private enableVirtualization: boolean;
  private virtualizationThreshold: number;
  private enableFreehand: boolean;
  private onModeChange?: (mode: "select" | "draw") => void;

  private dragMode: DragMode = { type: "none" };
  private isSpacePressed = false;
  private unsubscribeEditor: (() => void) | null = null;

  // Bound event listeners for cleanup
  private onWheelBound: (e: WheelEvent) => void;
  private onMouseDownBound: (e: MouseEvent) => void;
  private onMouseMoveBound: (e: MouseEvent) => void;
  private onMouseUpBound: (e: MouseEvent) => void;
  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;
  private onDblClickBound: (e: MouseEvent) => void;
  private onContextMenuBound: (e: MouseEvent) => void;
  private onDragOverBound: (e: DragEvent) => void;
  private onDropBound: (e: DragEvent) => void;
  private onContextMenu?: (
    e: MouseEvent,
    canvasPoint: Point,
    node?: DiagramNode,
    edge?: DiagramEdge,
    group?: Group
  ) => void;
  private onNoteOpen?: (filePath: string) => void;
  private onChipEdit?: (node: DiagramNode) => void;
  private onExternalDrop?: (e: DragEvent, canvasPoint: Point) => boolean | Promise<boolean> | void;
  private onRenderMarkdown?: (
    markdown: string,
    el: HTMLElement,
    sourcePath: string
  ) => Promise<void> | void;

  constructor(
    container: HTMLElement,
    private editor: DiagramEditor,
    options?: SvgSceneRendererOptions
  ) {
    this.container = container;
    this.shapeRegistry = options?.shapeRegistry ?? defaultShapeRegistry;
    this.showGrid = options?.showGrid ?? true;
    this.onTransformChange = options?.onTransformChange;
    this.onStrokeComplete = options?.onStrokeComplete;
    this.enableVirtualization = options?.enableVirtualization ?? false;
    this.virtualizationThreshold = options?.virtualizationThreshold ?? 200;
    this.enableFreehand = options?.enableFreehand ?? true;
    this.onModeChange = options?.onModeChange;
    this.onContextMenu = options?.onContextMenu;
    this.onNoteOpen = options?.onNoteOpen;
    this.onChipEdit = options?.onChipEdit;
    this.onExternalDrop = options?.onExternalDrop;
    this.onRenderMarkdown = options?.onRenderMarkdown;

    if (options?.initialTransform) {
      this.transform = {
        panX: options.initialTransform.panX,
        panY: options.initialTransform.panY,
        zoom: clampZoom(options.initialTransform.zoom),
      };
    }

    const svgNS = "http://www.w3.org/2000/svg";
    this.svgEl = document.createElementNS(svgNS, "svg");
    this.svgEl.setAttribute("class", "umlcanvas-svg");
    this.svgEl.setAttribute("width", "100%");
    this.svgEl.setAttribute("height", "100%");

    this.createDefs();

    this.gridRectEl = document.createElementNS(svgNS, "rect");
    this.gridRectEl.setAttribute("class", "umlcanvas-grid-bg");
    this.gridRectEl.setAttribute("width", "100%");
    this.gridRectEl.setAttribute("height", "100%");
    this.gridRectEl.setAttribute("fill", "url(#umlcanvas-grid-pattern)");
    if (!this.showGrid) {
      this.gridRectEl.style.display = "none";
    }
    this.svgEl.appendChild(this.gridRectEl);

    this.viewportEl = document.createElementNS(svgNS, "g");
    this.viewportEl.setAttribute("class", "umlcanvas-viewport");
    this.svgEl.appendChild(this.viewportEl);

    this.groupsLayerEl = document.createElementNS(svgNS, "g");
    this.groupsLayerEl.setAttribute("class", "umlcanvas-groups-layer");
    this.viewportEl.appendChild(this.groupsLayerEl);

    this.edgesLayerEl = document.createElementNS(svgNS, "g");
    this.edgesLayerEl.setAttribute("class", "umlcanvas-edges-layer");
    this.viewportEl.appendChild(this.edgesLayerEl);

    this.nodesLayerEl = document.createElementNS(svgNS, "g");
    this.nodesLayerEl.setAttribute("class", "umlcanvas-nodes-layer");
    this.viewportEl.appendChild(this.nodesLayerEl);

    this.interactionLayerEl = document.createElementNS(svgNS, "g");
    this.interactionLayerEl.setAttribute("class", "umlcanvas-interaction-layer");
    this.viewportEl.appendChild(this.interactionLayerEl);

    this.container.appendChild(this.svgEl);

    // Bind event handlers
    this.onWheelBound = this.handleWheel.bind(this);
    this.onMouseDownBound = this.handleMouseDown.bind(this);
    this.onMouseMoveBound = this.handleMouseMove.bind(this);
    this.onMouseUpBound = this.handleMouseUp.bind(this);
    this.onKeyDownBound = this.handleKeyDown.bind(this);
    this.onKeyUpBound = this.handleKeyUp.bind(this);
    this.onDblClickBound = this.handleDblClick.bind(this);
    this.onContextMenuBound = this.handleContextMenu.bind(this);
    this.onDragOverBound = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    };
    this.onDropBound = (e: DragEvent) => {
      e.preventDefault();
      const clientPoint = this.getClientCoords(e as unknown as MouseEvent);
      const canvasPoint = screenToCanvas(clientPoint, this.transform);

      // Check custom chip drop
      const chipId = e.dataTransfer?.getData("application/x-umlcanvas-chip-id");
      if (chipId && defaultCustomChipRegistry.has(chipId)) {
        const chipDef = defaultCustomChipRegistry.get(chipId)!;
        const node = this.editor.instantiateChip(chipDef, {
          x: Math.round(canvasPoint.x - 70),
          y: Math.round(canvasPoint.y - 45),
        });
        this.editor.selectNode(node.id, false);
        return;
      }

      const shapeKind = e.dataTransfer?.getData("application/x-umlcanvas-shape");
      if (shapeKind && this.shapeRegistry.has(shapeKind)) {
        const shapeDef = this.shapeRegistry.get(shapeKind);
        const node = this.editor.addNode({
          kind: shapeKind,
          position: {
            x: Math.round(canvasPoint.x - shapeDef.defaultSize.width / 2),
            y: Math.round(canvasPoint.y - shapeDef.defaultSize.height / 2),
          },
          size: { ...shapeDef.defaultSize },
          title: shapeDef.displayName,
        });
        this.editor.selectNode(node.id, false);
        return;
      }

      // Check external drop callback (e.g. dragging a Markdown note from Obsidian file tree)
      if (this.onExternalDrop) {
        const handled = this.onExternalDrop(e, canvasPoint);
        if (handled) return;
      }

      // Fallback: check text/plain for shape kind
      const textPlain = e.dataTransfer?.getData("text/plain");
      if (textPlain && this.shapeRegistry.has(textPlain)) {
        const shapeDef = this.shapeRegistry.get(textPlain);
        const node = this.editor.addNode({
          kind: textPlain,
          position: {
            x: Math.round(canvasPoint.x - shapeDef.defaultSize.width / 2),
            y: Math.round(canvasPoint.y - shapeDef.defaultSize.height / 2),
          },
          size: { ...shapeDef.defaultSize },
          title: shapeDef.displayName,
        });
        this.editor.selectNode(node.id, false);
      }
    };

    this.svgEl.addEventListener("wheel", this.onWheelBound, { passive: false });
    this.svgEl.addEventListener("mousedown", this.onMouseDownBound);
    window.addEventListener("mousemove", this.onMouseMoveBound);
    window.addEventListener("mouseup", this.onMouseUpBound);
    window.addEventListener("keydown", this.onKeyDownBound);
    window.addEventListener("keyup", this.onKeyUpBound);
    this.svgEl.addEventListener("dblclick", this.onDblClickBound);
    this.svgEl.addEventListener("contextmenu", this.onContextMenuBound);
    this.svgEl.addEventListener("dragover", this.onDragOverBound);
    this.svgEl.addEventListener("drop", this.onDropBound);

    this.unsubscribeEditor = this.editor.subscribe(() => {
      this.render();
    });

    this.updateViewportTransform();
    this.render();
  }

  get currentTransform(): ViewportTransform {
    return { ...this.transform };
  }

  setTransform(newTransform: ViewportTransform): void {
    this.transform = {
      panX: newTransform.panX,
      panY: newTransform.panY,
      zoom: clampZoom(newTransform.zoom),
    };
    this.updateViewportTransform();
    if (this.isVirtualizationActive()) {
      this.render();
    }
  }

  public getVisibleCanvasRect(margin = 200): Rect {
    const width =
      this.container.clientWidth ||
      (typeof this.container.getBoundingClientRect === "function"
        ? this.container.getBoundingClientRect().width
        : 0) ||
      800;
    const height =
      this.container.clientHeight ||
      (typeof this.container.getBoundingClientRect === "function"
        ? this.container.getBoundingClientRect().height
        : 0) ||
      600;
    const p1 = screenToCanvas({ x: 0, y: 0 }, this.transform);
    const p2 = screenToCanvas({ x: width, y: height }, this.transform);
    const minX = Math.min(p1.x, p2.x) - margin;
    const minY = Math.min(p1.y, p2.y) - margin;
    const maxX = Math.max(p1.x, p2.x) + margin;
    const maxY = Math.max(p1.y, p2.y) + margin;
    return rectFromBounds(minX, minY, maxX - minX, maxY - minY);
  }

  public isVirtualizationActive(): boolean {
    return (
      this.enableVirtualization ||
      this.editor.diagram.nodes.length >= this.virtualizationThreshold
    );
  }

  public setVirtualization(enabled: boolean, threshold?: number): void {
    this.enableVirtualization = enabled;
    if (threshold !== undefined) {
      this.virtualizationThreshold = threshold;
    }
    this.render();
  }

  public get isVirtualizationEnabled(): boolean {
    return this.enableVirtualization;
  }

  public get activeVirtualizationThreshold(): number {
    return this.virtualizationThreshold;
  }

  setGridVisible(visible: boolean): void {
    this.showGrid = visible;
    this.gridRectEl.style.display = visible ? "block" : "none";
  }

  get isGridVisible(): boolean {
    return this.showGrid;
  }

  get containerWidth(): number {
    return this.container.clientWidth || 800;
  }

  get containerHeight(): number {
    return this.container.clientHeight || 600;
  }

  setEnableFreehand(enabled: boolean): void {
    this.enableFreehand = enabled;
    if (!enabled && this.isFreehandMode) {
      this.setFreehandMode(false);
    }
  }

  get isFreehandEnabled(): boolean {
    return this.enableFreehand;
  }

  setFreehandMode(active: boolean): void {
    if (active && !this.enableFreehand) {
      return;
    }
    this.isFreehandMode = active;
    if (active) {
      this.container.classList.add("umlcanvas-freehand-mode");
    } else {
      this.container.classList.remove("umlcanvas-freehand-mode");
    }
    this.onModeChange?.(active ? "draw" : "select");
  }

  get freehandMode(): boolean {
    return this.isFreehandMode;
  }

  zoomIn(): void {
    const centerScreen = {
      x: this.container.clientWidth / 2,
      y: this.container.clientHeight / 2,
    };
    this.setTransform(zoomAtPoint(centerScreen, this.transform, 1.2));
  }

  zoomOut(): void {
    const centerScreen = {
      x: this.container.clientWidth / 2,
      y: this.container.clientHeight / 2,
    };
    this.setTransform(zoomAtPoint(centerScreen, this.transform, 1 / 1.2));
  }

  resetZoom(): void {
    this.setTransform({
      panX: 0,
      panY: 0,
      zoom: 1.0,
    });
  }

  private createDefs(): void {
    const svgNS = "http://www.w3.org/2000/svg";
    this.defsEl = document.createElementNS(svgNS, "defs") as SVGDefsElement;
    this.markerTemplates.clear();
    this.createdMarkerIds.clear();

    // Grid pattern
    const pattern = document.createElementNS(svgNS, "pattern");
    pattern.setAttribute("id", "umlcanvas-grid-pattern");
    pattern.setAttribute("width", "20");
    pattern.setAttribute("height", "20");
    pattern.setAttribute("patternUnits", "userSpaceOnUse");

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", "10");
    circle.setAttribute("cy", "10");
    circle.setAttribute("r", "1");
    circle.setAttribute("class", "umlcanvas-grid-dot");
    pattern.appendChild(circle);
    this.defsEl.appendChild(pattern);

    // Helper to register template and create marker
    const registerMarker = (
      id: string,
      pathD: string,
      opts: {
        viewBox?: string;
        refX?: string;
        refY?: string;
        width?: string;
        height?: string;
        className?: string;
        fill?: string;
        stroke?: string;
      }
    ) => {
      this.markerTemplates.set(id, { pathD, opts });

      const m = document.createElementNS(svgNS, "marker");
      m.setAttribute("id", id);
      m.setAttribute("viewBox", opts.viewBox ?? "0 0 10 10");
      m.setAttribute("refX", opts.refX ?? "10");
      m.setAttribute("refY", opts.refY ?? "5");
      m.setAttribute("markerWidth", opts.width ?? "6");
      m.setAttribute("markerHeight", opts.height ?? "6");
      m.setAttribute("orient", "auto-start-reverse");

      const p = document.createElementNS(svgNS, "path");
      p.setAttribute("d", pathD);
      if (opts.className) p.setAttribute("class", opts.className);
      if (opts.fill) p.setAttribute("fill", opts.fill);
      if (opts.stroke) p.setAttribute("stroke", opts.stroke);
      m.appendChild(p);
      this.defsEl.appendChild(m);
      this.createdMarkerIds.add(id);
    };

    // 1. Standard filled arrow (generic / association directed)
    registerMarker("umlcanvas-arrow-end", "M 0 1 L 10 5 L 0 9 z", {
      className: "umlcanvas-arrow-head",
      fill: "currentColor",
      stroke: "currentColor",
    });
    registerMarker("uml-marker-arrow-filled", "M 0 1 L 10 5 L 0 9 z", {
      className: "umlcanvas-arrow-head",
      fill: "currentColor",
      stroke: "currentColor",
    });

    // 2. Open arrow (dependency, include, extend)
    registerMarker("uml-marker-open-arrow", "M 1 1 L 9 5 L 1 9", {
      className: "umlcanvas-marker-open-arrow",
      fill: "none",
      stroke: "currentColor",
    });

    // 3. Hollow triangle (generalization, realization)
    registerMarker("uml-marker-triangle-hollow", "M 0 1 L 10 5 L 0 9 Z", {
      className: "umlcanvas-marker-triangle-hollow",
      fill: "var(--background-primary)",
      stroke: "currentColor",
    });

    // 4. Hollow diamond (aggregation)
    registerMarker("uml-marker-diamond-hollow", "M 0 5 L 6 1 L 12 5 L 6 9 Z", {
      viewBox: "0 0 12 10",
      refX: "0",
      refY: "5",
      width: "8",
      height: "6",
      className: "umlcanvas-marker-diamond-hollow",
      fill: "var(--background-primary)",
      stroke: "currentColor",
    });

    // 5. Filled diamond (composition)
    registerMarker("uml-marker-diamond-filled", "M 0 5 L 6 1 L 12 5 L 6 9 Z", {
      viewBox: "0 0 12 10",
      refX: "0",
      refY: "5",
      width: "8",
      height: "6",
      className: "umlcanvas-marker-diamond-filled",
      fill: "currentColor",
      stroke: "currentColor",
    });

    // 6. Timing constraint stop bar
    registerMarker("uml-marker-timing-stop", "M 1 0 L 1 10", {
      viewBox: "0 0 2 10",
      refX: "1",
      refY: "5",
      width: "3",
      height: "10",
      className: "umlcanvas-marker-timing-stop",
      fill: "none",
      stroke: "currentColor",
    });

    // 7. Filled triangle (profile extension)
    registerMarker("uml-marker-triangle-filled", "M 0 1 L 10 5 L 0 9 Z", {
      viewBox: "0 0 10 10",
      refX: "10",
      refY: "5",
      width: "8",
      height: "8",
      className: "umlcanvas-marker-triangle-filled",
      fill: "currentColor",
      stroke: "currentColor",
    });

    this.svgEl.appendChild(this.defsEl);
  }

  private getOrCreateColoredMarker(
    baseMarkerId: string,
    color: string,
    isSelected: boolean
  ): string {
    const template = this.markerTemplates.get(baseMarkerId);
    if (!template || !this.defsEl) return baseMarkerId;

    let targetId: string;
    let colorVal: string;

    if (isSelected) {
      targetId = `${baseMarkerId}--selected`;
      colorVal = "var(--interactive-accent)";
    } else {
      const colorKey = isCanvasColorPreset(color)
        ? color
        : color.replace(/[^a-zA-Z0-9_-]/g, "_");
      targetId = `${baseMarkerId}--color-${colorKey}`;
      colorVal = resolveCanvasColor(color) ?? color;
    }

    if (this.createdMarkerIds.has(targetId)) {
      return targetId;
    }

    const svgNS = "http://www.w3.org/2000/svg";
    const m = document.createElementNS(svgNS, "marker");
    m.setAttribute("id", targetId);
    m.setAttribute("viewBox", template.opts.viewBox ?? "0 0 10 10");
    m.setAttribute("refX", template.opts.refX ?? "10");
    m.setAttribute("refY", template.opts.refY ?? "5");
    m.setAttribute("markerWidth", template.opts.width ?? "6");
    m.setAttribute("markerHeight", template.opts.height ?? "6");
    m.setAttribute("orient", "auto-start-reverse");

    const p = document.createElementNS(svgNS, "path");
    p.setAttribute("d", template.pathD);
    if (template.opts.className) p.setAttribute("class", template.opts.className);

    // Apply color depending on marker type
    if (template.opts.fill === "none") {
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", colorVal);
    } else if (template.opts.fill === "var(--background-primary)") {
      p.setAttribute("fill", "var(--background-primary)");
      p.setAttribute("stroke", colorVal);
    } else {
      p.setAttribute("fill", colorVal);
      p.setAttribute("stroke", colorVal);
    }

    this.defsEl.appendChild(m);
    m.appendChild(p);
    this.createdMarkerIds.add(targetId);

    return targetId;
  }

  private updateViewportTransform(): void {
    this.viewportEl.setAttribute(
      "transform",
      `translate(${this.transform.panX}, ${this.transform.panY}) scale(${this.transform.zoom})`
    );
    if (this.onTransformChange) {
      this.onTransformChange(this.transform);
    }
  }

  // --- Rendering ---

  render(): void {
    this.renderGroups();
    this.renderEdges();
    this.renderNodes();
    this.renderInteractions();
  }

  public getGroupBounds(group: Group): Rect {
    if (group.position && group.size) {
      return rect(group.position, group.size);
    }

    const nodeMap = new Map<string, DiagramNode>(
      this.editor.diagram.nodes.map((n) => [n.id, n])
    );
    const memberNodes = group.nodeIds
      .map((id) => nodeMap.get(id))
      .filter((n): n is DiagramNode => n !== undefined && this.editor.isNodeVisible(n.id));

    if (memberNodes.length === 0) {
      return rect(group.position ?? point(100, 100), group.size ?? size(240, 140));
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of memberNodes) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + n.size.width);
      maxY = Math.max(maxY, n.position.y + n.size.height);
    }

    const padding = 16;
    const headerHeight = 28;
    const gx = minX - padding;
    const gy = minY - padding - headerHeight;
    const gw = maxX - minX + padding * 2;
    const gh = maxY - minY + padding * 2 + headerHeight;

    return rect(point(Math.round(gx), Math.round(gy)), size(Math.round(gw), Math.round(gh)));
  }

  private renderGroupResizeHandles(groupEl: SVGGElement, group: Group, bounds: Rect): void {
    const svgNS = "http://www.w3.org/2000/svg";
    const { position, size } = bounds;
    const x = position.x;
    const y = position.y;
    const w = size.width;
    const h = size.height;

    const handlePositions: Record<string, Point> = {
      nw: { x, y },
      n: { x: x + w / 2, y },
      ne: { x: x + w, y },
      e: { x: x + w, y: y + h / 2 },
      se: { x: x + w, y: y + h },
      s: { x: x + w / 2, y: y + h },
      sw: { x, y: y + h },
      w: { x, y: y + h / 2 },
    };

    for (const handle of RESIZE_HANDLES) {
      const pos = handlePositions[handle];
      const handleEl = document.createElementNS(svgNS, "rect");
      handleEl.setAttribute("x", String(pos.x - 4));
      handleEl.setAttribute("y", String(pos.y - 4));
      handleEl.setAttribute("width", "8");
      handleEl.setAttribute("height", "8");
      handleEl.setAttribute("class", `umlcanvas-group-resize-handle handle-${handle}`);
      handleEl.setAttribute("data-group-id", group.id);
      handleEl.setAttribute("data-handle", handle);
      groupEl.appendChild(handleEl);
    }
  }

  private renderGroups(): void {
    const svgNS = "http://www.w3.org/2000/svg";
    this.groupsLayerEl.innerHTML = "";

    const visibleRect = this.isVirtualizationActive()
      ? this.getVisibleCanvasRect()
      : null;

    for (const group of this.editor.diagram.groups) {
      const bounds = this.getGroupBounds(group);
      const gx = bounds.position.x;
      const gy = bounds.position.y;
      const gw = bounds.size.width;
      const gh = bounds.size.height;

      if (
        visibleRect &&
        !intersects(visibleRect, bounds)
      ) {
        continue;
      }

      const isSelected = this.editor.isGroupSelected(group.id);
      const isCollapsed = group.collapsed;
      const isLocked = group.locked ?? false;

      const groupEl = document.createElementNS(svgNS, "g");
      groupEl.setAttribute("class", "umlcanvas-group");
      groupEl.setAttribute("data-group-id", group.id);

      if (isSelected) {
        groupEl.classList.add("is-selected");
      }
      if (isCollapsed) {
        groupEl.classList.add("is-collapsed");
      }
      if (isLocked) {
        groupEl.classList.add("is-locked");
      }

      if (group.color) {
        groupEl.setAttribute("data-color", group.color);
        const resolvedColor = resolveCanvasColor(group.color);
        if (resolvedColor) {
          groupEl.style.setProperty("--canvas-color", resolvedColor);
        }
        if (isCanvasColorPreset(group.color)) {
          groupEl.classList.add(`is-color-${group.color}`);
        } else {
          groupEl.classList.add("has-custom-color");
        }
      }

      if (isCollapsed) {
        const cardW = Math.max(180, Math.min(gw, 260));
        const cardH = 34;

        const bgRect = document.createElementNS(svgNS, "rect");
        bgRect.setAttribute("x", String(gx));
        bgRect.setAttribute("y", String(gy));
        bgRect.setAttribute("width", String(cardW));
        bgRect.setAttribute("height", String(cardH));
        bgRect.setAttribute("rx", "6");
        bgRect.setAttribute("ry", "6");
        bgRect.setAttribute("class", "umlcanvas-group-collapsed-card");
        bgRect.setAttribute("data-group-id", group.id);
        groupEl.appendChild(bgRect);

        const toggle = document.createElementNS(svgNS, "text");
        toggle.setAttribute("x", String(gx + 10));
        toggle.setAttribute("y", String(gy + 22));
        toggle.setAttribute("class", "umlcanvas-group-collapse-btn");
        toggle.setAttribute("data-group-id", group.id);
        toggle.textContent = "▶";
        groupEl.appendChild(toggle);

        const title = document.createElementNS(svgNS, "text");
        title.setAttribute("x", String(gx + 26));
        title.setAttribute("y", String(gy + 22));
        title.setAttribute("class", "umlcanvas-group-title");
        title.setAttribute("data-group-id", group.id);
        title.textContent = group.name;
        groupEl.appendChild(title);

        const badge = document.createElementNS(svgNS, "text");
        badge.setAttribute("x", String(gx + cardW - 10));
        badge.setAttribute("y", String(gy + 22));
        badge.setAttribute("text-anchor", "end");
        badge.setAttribute("class", "umlcanvas-group-badge");
        badge.textContent = `(${group.nodeIds.length})`;
        groupEl.appendChild(badge);
      } else {
        const rectEl = document.createElementNS(svgNS, "rect");
        rectEl.setAttribute("x", String(gx));
        rectEl.setAttribute("y", String(gy));
        rectEl.setAttribute("width", String(gw));
        rectEl.setAttribute("height", String(gh));
        rectEl.setAttribute("rx", "6");
        rectEl.setAttribute("ry", "6");
        rectEl.setAttribute("class", "umlcanvas-group-box");
        rectEl.setAttribute("data-group-id", group.id);
        groupEl.appendChild(rectEl);

        const headerH = 28;
        const headerBg = document.createElementNS(svgNS, "rect");
        headerBg.setAttribute("x", String(gx));
        headerBg.setAttribute("y", String(gy));
        headerBg.setAttribute("width", String(gw));
        headerBg.setAttribute("height", String(headerH));
        headerBg.setAttribute("rx", "6");
        headerBg.setAttribute("ry", "6");
        headerBg.setAttribute("class", "umlcanvas-group-header-bg");
        headerBg.setAttribute("data-group-id", group.id);
        groupEl.appendChild(headerBg);

        const toggle = document.createElementNS(svgNS, "text");
        toggle.setAttribute("x", String(gx + 10));
        toggle.setAttribute("y", String(gy + 18));
        toggle.setAttribute("class", "umlcanvas-group-collapse-btn");
        toggle.setAttribute("data-group-id", group.id);
        toggle.textContent = "▼";
        groupEl.appendChild(toggle);

        const title = document.createElementNS(svgNS, "text");
        title.setAttribute("x", String(gx + 26));
        title.setAttribute("y", String(gy + 18));
        title.setAttribute("class", "umlcanvas-group-title");
        title.setAttribute("data-group-id", group.id);
        title.textContent = group.name;
        groupEl.appendChild(title);

        const badge = document.createElementNS(svgNS, "text");
        badge.setAttribute("x", String(gx + gw - 12));
        badge.setAttribute("y", String(gy + 18));
        badge.setAttribute("text-anchor", "end");
        badge.setAttribute("class", "umlcanvas-group-badge");
        badge.textContent = `${group.nodeIds.length} items`;
        groupEl.appendChild(badge);

        if (isLocked) {
          const lockIcon = document.createElementNS(svgNS, "text");
          lockIcon.setAttribute("x", String(gx + gw - 64));
          lockIcon.setAttribute("y", String(gy + 18));
          lockIcon.setAttribute("text-anchor", "end");
          lockIcon.setAttribute("class", "umlcanvas-group-lock-icon");
          lockIcon.textContent = "🔒";
          groupEl.appendChild(lockIcon);
        }

        if (isSelected && !isLocked) {
          this.renderGroupResizeHandles(groupEl, group, bounds);
        }
      }

      this.groupsLayerEl.appendChild(groupEl);
    }
  }

  private renderEdges(): void {
    const svgNS = "http://www.w3.org/2000/svg";
    this.edgesLayerEl.innerHTML = "";

    const visibleNodes = this.editor.diagram.nodes.filter((n) =>
      this.editor.isNodeVisible(n.id)
    );
    const nodeMap = new Map<string, DiagramNode>(
      visibleNodes.map((n) => [n.id, n])
    );

    const visibleRect = this.isVirtualizationActive()
      ? this.getVisibleCanvasRect()
      : null;

    for (const edge of this.editor.diagram.edges) {
      const fromNode = nodeMap.get(edge.fromNodeId);
      const toNode = nodeMap.get(edge.toNodeId);
      if (!fromNode || !toNode) continue;

      if (visibleRect) {
        const minX = Math.min(fromNode.position.x, toNode.position.x);
        const minY = Math.min(fromNode.position.y, toNode.position.y);
        const maxX = Math.max(
          fromNode.position.x + fromNode.size.width,
          toNode.position.x + toNode.size.width
        );
        const maxY = Math.max(
          fromNode.position.y + fromNode.size.height,
          toNode.position.y + toNode.size.height
        );
        const edgeBounds = rectFromBounds(minX, minY, maxX - minX, maxY - minY);
        if (!intersects(visibleRect, edgeBounds)) {
          continue;
        }
      }

      // Look up specific ports if defined
      const fromPort = fromNode.ports.find((p) => p.id === edge.fromPortId);
      const toPort = toNode.ports.find((p) => p.id === edge.toPortId);

      const fromSide = fromPort?.side ?? edge.fromSide;
      const toSide = toPort?.side ?? edge.toSide;

      // Calculate edge route (supports straight & orthogonal with obstacle avoidance)
      const routingResult = defaultRoutingService.route(
        {
          id: fromNode.id,
          position: fromNode.position,
          size: fromNode.size,
          side: fromSide,
          portOffset: fromPort?.offset,
        },
        {
          id: toNode.id,
          position: toNode.position,
          size: toNode.size,
          side: toSide,
          portOffset: toPort?.offset,
        },
        {
          routing: edge.routing,
          obstacles: visibleNodes,
          manualWaypoints: edge.waypoints,
        }
      );

      const edgeGroup = document.createElementNS(svgNS, "g");
      edgeGroup.setAttribute("class", "umlcanvas-edge");
      edgeGroup.setAttribute("data-edge-id", edge.id);

      const isSelected = this.editor.isEdgeSelected(edge.id);
      const styleDef = defaultEdgeStyleRegistry.get(edge.kind);

      // Hitbox path
      const hitPath = document.createElementNS(svgNS, "path");
      hitPath.setAttribute("d", routingResult.svgPath);
      hitPath.setAttribute("class", "umlcanvas-edge-hitbox");
      edgeGroup.appendChild(hitPath);

      if (isSelected) {
        edgeGroup.classList.add("umlcanvas-edge-selected");
      }

      // Visible path
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", routingResult.svgPath);
      path.setAttribute(
        "class",
        isSelected
          ? "umlcanvas-edge-line umlcanvas-edge-selected"
          : "umlcanvas-edge-line"
      );

      const customStroke = edge.style?.color ?? edge.style?.strokeColor;
      let markerEndId = styleDef.markerEndId;
      let markerStartId = styleDef.markerStartId;

      if (isSelected) {
        if (markerEndId) markerEndId = this.getOrCreateColoredMarker(markerEndId, "", true);
        if (markerStartId) markerStartId = this.getOrCreateColoredMarker(markerStartId, "", true);
      } else if (customStroke) {
        if (markerEndId) markerEndId = this.getOrCreateColoredMarker(markerEndId, customStroke, false);
        if (markerStartId) markerStartId = this.getOrCreateColoredMarker(markerStartId, customStroke, false);
      }

      if (markerEndId) {
        path.setAttribute("marker-end", `url(#${markerEndId})`);
      }
      if (markerStartId) {
        path.setAttribute("marker-start", `url(#${markerStartId})`);
      }

      if (edge.style?.dashed || styleDef.strokeDasharray) {
        path.setAttribute("stroke-dasharray", styleDef.strokeDasharray ?? "4 4");
      }
      if (edge.style?.color) {
        edgeGroup.setAttribute("data-color", edge.style.color);
        const resolvedColor = resolveCanvasColor(edge.style.color);
        if (resolvedColor) {
          edgeGroup.style.setProperty("--canvas-color", resolvedColor);
          path.setAttribute("stroke", resolvedColor);
          path.style.stroke = resolvedColor;
          edgeGroup.style.setProperty("color", resolvedColor);
        }
        if (isCanvasColorPreset(edge.style.color)) {
          edgeGroup.classList.add(`is-color-${edge.style.color}`);
        } else {
          edgeGroup.classList.add("has-custom-color");
        }
      } else if (edge.style?.strokeColor) {
        path.setAttribute("stroke", edge.style.strokeColor);
        path.style.stroke = edge.style.strokeColor;
      }
      if (isSelected) {
        path.style.stroke = "var(--interactive-accent)";
      }
      if (edge.style?.strokeWidth || styleDef.strokeWidth) {
        path.setAttribute(
          "stroke-width",
          String(edge.style?.strokeWidth ?? styleDef.strokeWidth)
        );
      }

      edgeGroup.appendChild(path);

      // Edge labels (F-031) or default stereotype (e.g. «include», «extend»)
      const displayLabel =
        edge.labels && edge.labels.length > 0
          ? edge.labels[0].text
          : styleDef.defaultStereotype
          ? `«${styleDef.defaultStereotype}»`
          : undefined;

      const tooltipText = displayLabel
        ? `Line (${edge.kind}): "${displayLabel}"\nDouble-click or press Enter to edit label`
        : `Line (${edge.kind})\nDouble-click or press Enter to add label`;
      edgeGroup.setAttribute("title", tooltipText);

      if (displayLabel && routingResult.points.length >= 2) {
        const midIdx = Math.floor(routingResult.points.length / 2);
        const p1 = routingResult.points[midIdx - 1] ?? routingResult.points[0];
        const p2 = routingResult.points[midIdx] ?? routingResult.points[1];
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        const labelGroup = document.createElementNS(svgNS, "g");
        labelGroup.setAttribute("class", "umlcanvas-edge-label-group");
        labelGroup.setAttribute("data-edge-id", edge.id);

        const padX = 6;
        const textLen = displayLabel.length;
        const bgWidth = Math.max(24, textLen * 7 + padX * 2);
        const bgHeight = 18;

        const bgRect = document.createElementNS(svgNS, "rect");
        bgRect.setAttribute("x", String(Math.round(midX - bgWidth / 2)));
        bgRect.setAttribute("y", String(Math.round(midY - bgHeight / 2)));
        bgRect.setAttribute("width", String(bgWidth));
        bgRect.setAttribute("height", String(bgHeight));
        bgRect.setAttribute("rx", "4");
        bgRect.setAttribute("ry", "4");
        bgRect.setAttribute("class", "umlcanvas-edge-label-bg");
        labelGroup.appendChild(bgRect);

        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", String(midX));
        text.setAttribute("y", String(midY));
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "central");
        text.setAttribute("class", "umlcanvas-edge-label");
        text.textContent = displayLabel;
        labelGroup.appendChild(text);

        edgeGroup.appendChild(labelGroup);
      }

      // Multiplicity annotations (F-034)
      if (routingResult.points.length >= 2) {
        const startPt = routingResult.points[0];
        const secondPt = routingResult.points[1];
        const endPt = routingResult.points[routingResult.points.length - 1];
        const beforeEndPt = routingResult.points[routingResult.points.length - 2];

        if (edge.multiplicitySource) {
          const sText = document.createElementNS(svgNS, "text");
          const dirX = Math.sign(secondPt.x - startPt.x);
          const dirY = Math.sign(secondPt.y - startPt.y);
          sText.setAttribute("x", String(startPt.x + (dirX !== 0 ? dirX * 18 : 10)));
          sText.setAttribute("y", String(startPt.y + (dirY !== 0 ? dirY * 18 : -8)));
          sText.setAttribute("class", "umlcanvas-edge-multiplicity umlcanvas-multiplicity-source");
          sText.textContent = edge.multiplicitySource;
          edgeGroup.appendChild(sText);
        }

        if (edge.multiplicityTarget) {
          const tText = document.createElementNS(svgNS, "text");
          const dirX = Math.sign(endPt.x - beforeEndPt.x);
          const dirY = Math.sign(endPt.y - beforeEndPt.y);
          tText.setAttribute("x", String(endPt.x - (dirX !== 0 ? dirX * 22 : 12)));
          tText.setAttribute("y", String(endPt.y - (dirY !== 0 ? dirY * 22 : 8)));
          tText.setAttribute("class", "umlcanvas-edge-multiplicity umlcanvas-multiplicity-target");
          tText.textContent = edge.multiplicityTarget;
          edgeGroup.appendChild(tText);
        }
      }

      this.edgesLayerEl.appendChild(edgeGroup);
    }
  }

  private renderNodes(): void {
    const svgNS = "http://www.w3.org/2000/svg";
    this.nodesLayerEl.innerHTML = "";

    const visibleRect = this.isVirtualizationActive()
      ? this.getVisibleCanvasRect()
      : null;

    for (const node of this.editor.diagram.nodes) {
      if (!this.editor.isNodeVisible(node.id)) {
        continue;
      }

      if (visibleRect && !intersects(visibleRect, rect(node.position, node.size))) {
        continue;
      }

      const nodeGroup = document.createElementNS(svgNS, "g");
      nodeGroup.setAttribute("class", "umlcanvas-node");
      nodeGroup.setAttribute("data-node-id", node.id);
      nodeGroup.setAttribute(
        "transform",
        `translate(${node.position.x}, ${node.position.y})`
      );

      const isSelected = this.editor.isNodeSelected(node.id);
      const isLocked = this.editor.isNodeLocked(node.id);
      if (isLocked) {
        nodeGroup.classList.add("umlcanvas-node-locked");
      }

      if (node.style?.color) {
        nodeGroup.setAttribute("data-color", node.style.color);
        const resolvedColor = resolveCanvasColor(node.style.color);
        if (resolvedColor) {
          nodeGroup.style.setProperty("--canvas-color", resolvedColor);
        }
        if (isCanvasColorPreset(node.style.color)) {
          nodeGroup.classList.add(`is-color-${node.style.color}`);
        } else {
          nodeGroup.classList.add("has-custom-color");
        }
      } else if (node.style?.strokeColor) {
        nodeGroup.setAttribute("data-color", node.style.strokeColor);
        nodeGroup.style.setProperty("--canvas-color", node.style.strokeColor);
        nodeGroup.classList.add("has-custom-color");
      }

      // Transparent hitbox covering node boundary for reliable grabbing & moving
      const hitbox = document.createElementNS(svgNS, "rect");
      hitbox.setAttribute("x", "0");
      hitbox.setAttribute("y", "0");
      hitbox.setAttribute("width", String(node.size.width));
      hitbox.setAttribute("height", String(node.size.height));
      hitbox.setAttribute("fill", "transparent");
      hitbox.setAttribute("class", "umlcanvas-node-hitbox");
      nodeGroup.appendChild(hitbox);

      const shapeDef = this.shapeRegistry.get(node.kind);
      const renderedShape = shapeDef.renderSvg(node, { isSelected });
      nodeGroup.appendChild(renderedShape);

      // Render markdown for obsidian note embeds
      if (node.kind === "obsidian.note" || node.metadata?.filePath) {
        const bodyEl = renderedShape.querySelector(
          ".umlcanvas-obsidian-note-body"
        ) as HTMLElement | null;
        if (bodyEl && this.onRenderMarkdown) {
          const filePath =
            (node.metadata?.filePath as string) ||
            (node.customData?.filePath as string) ||
            "";
          const markdown =
            (node.customData?.content as string) ||
            (node.customData?.snippet as string) ||
            "";
          if (markdown) {
            void this.onRenderMarkdown(markdown, bodyEl, filePath);
          }
        }
      }

      // Render ports & port handles (F-007, F-031)
      const ports = shapeDef.getPorts(node);
      for (const port of ports) {
        const pt = getSidePoint({ x: 0, y: 0 }, node.size, port.side, port.offset);
        const handle = document.createElementNS(svgNS, "circle");
        handle.setAttribute("cx", String(pt.x));
        handle.setAttribute("cy", String(pt.y));
        handle.setAttribute("r", "5");
        handle.setAttribute("class", "umlcanvas-port-handle");
        handle.setAttribute("data-port-id", port.id);
        handle.setAttribute("data-side", port.side);
        nodeGroup.appendChild(handle);

        // Named port label (F-031)
        if (port.name && !["top", "right", "bottom", "left"].includes(port.name)) {
          const pLabel = document.createElementNS(svgNS, "text");
          let lx = pt.x;
          let ly = pt.y;
          let anchor = "middle";

          if (port.side === "left") {
            lx += 8;
            anchor = "start";
          } else if (port.side === "right") {
            lx -= 8;
            anchor = "end";
          } else if (port.side === "top") {
            ly += 12;
          } else {
            ly -= 6;
          }

          pLabel.setAttribute("x", String(lx));
          pLabel.setAttribute("y", String(ly));
          pLabel.setAttribute("text-anchor", anchor);
          pLabel.setAttribute("class", "umlcanvas-port-label");
          pLabel.textContent = port.name;
          nodeGroup.appendChild(pLabel);
        }
      }

      this.nodesLayerEl.appendChild(nodeGroup);
    }
  }

  private renderInteractions(): void {
    const svgNS = "http://www.w3.org/2000/svg";
    this.interactionLayerEl.innerHTML = "";

    // Active Alignment Guides (F-009)
    if (this.dragMode.type === "move" && this.dragMode.activeGuides) {
      for (const vx of this.dragMode.activeGuides.verticalLines) {
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", String(vx));
        line.setAttribute("y1", "-10000");
        line.setAttribute("x2", String(vx));
        line.setAttribute("y2", "10000");
        line.setAttribute("class", "umlcanvas-guide-line");
        this.interactionLayerEl.appendChild(line);
      }

      for (const hy of this.dragMode.activeGuides.horizontalLines) {
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", "-10000");
        line.setAttribute("y1", String(hy));
        line.setAttribute("x2", "10000");
        line.setAttribute("y2", String(hy));
        line.setAttribute("class", "umlcanvas-guide-line");
        this.interactionLayerEl.appendChild(line);
      }
    }

    // Selection highlights & resize handles for selected nodes
    const selectedNodes = this.editor.diagram.nodes.filter(
      (n) => this.editor.isNodeSelected(n.id) && this.editor.isNodeVisible(n.id)
    );

    for (const node of selectedNodes) {
      const outline = document.createElementNS(svgNS, "rect");
      outline.setAttribute("x", String(node.position.x - 2));
      outline.setAttribute("y", String(node.position.y - 2));
      outline.setAttribute("width", String(node.size.width + 4));
      outline.setAttribute("height", String(node.size.height + 4));
      outline.setAttribute("class", "umlcanvas-selection-outline");
      this.interactionLayerEl.appendChild(outline);

      // If single node selected and not locked, show resize handles
      if (selectedNodes.length === 1 && !this.editor.isNodeLocked(node.id)) {
        for (const h of RESIZE_HANDLES) {
          const pt = this.getResizeHandlePosition(node, h);
          const handle = document.createElementNS(svgNS, "rect");
          handle.setAttribute("x", String(pt.x - 4));
          handle.setAttribute("y", String(pt.y - 4));
          handle.setAttribute("width", "8");
          handle.setAttribute("height", "8");
          handle.setAttribute("class", `umlcanvas-resize-handle handle-${h}`);
          handle.setAttribute("data-handle", h);
          this.interactionLayerEl.appendChild(handle);
        }
      }
    }

    // Selection handles for selected edges (F-007, line editing & reconnecting)
    for (const edgeId of this.editor.selectedEdgeIds) {
      const edge = this.editor.diagram.edges.find((e) => e.id === edgeId);
      if (!edge) continue;
      const fromNode = this.editor.diagram.nodes.find((n) => n.id === edge.fromNodeId);
      const toNode = this.editor.diagram.nodes.find((n) => n.id === edge.toNodeId);
      if (!fromNode || !toNode) continue;

      const fromPort = fromNode.ports?.find((p) => p.id === edge.fromPortId);
      const toPort = toNode.ports?.find((p) => p.id === edge.toPortId);
      const fromSide = fromPort?.side ?? edge.fromSide;
      const toSide = toPort?.side ?? edge.toSide;

      const routingResult = defaultRoutingService.route(
        {
          id: fromNode.id,
          position: fromNode.position,
          size: fromNode.size,
          side: fromSide,
          portOffset: fromPort?.offset,
        },
        {
          id: toNode.id,
          position: toNode.position,
          size: toNode.size,
          side: toSide,
          portOffset: toPort?.offset,
        },
        {
          routing: edge.routing,
          manualWaypoints: edge.waypoints,
        }
      );

      if (routingResult.points.length >= 2) {
        const startPt = routingResult.points[0];
        const endPt = routingResult.points[routingResult.points.length - 1];

        // Source handle (start of line)
        const sourceHandle = document.createElementNS(svgNS, "circle");
        sourceHandle.setAttribute("cx", String(startPt.x));
        sourceHandle.setAttribute("cy", String(startPt.y));
        sourceHandle.setAttribute("r", "6");
        sourceHandle.setAttribute(
          "class",
          "umlcanvas-edge-handle umlcanvas-edge-endpoint-handle handle-source"
        );
        sourceHandle.setAttribute("data-edge-id", edge.id);
        sourceHandle.setAttribute("data-endpoint", "source");
        sourceHandle.setAttribute("title", "Drag to reconnect start of line to a shape");
        this.interactionLayerEl.appendChild(sourceHandle);

        // Target handle (end of line)
        const targetHandle = document.createElementNS(svgNS, "circle");
        targetHandle.setAttribute("cx", String(endPt.x));
        targetHandle.setAttribute("cy", String(endPt.y));
        targetHandle.setAttribute("r", "6");
        targetHandle.setAttribute(
          "class",
          "umlcanvas-edge-handle umlcanvas-edge-endpoint-handle handle-target"
        );
        targetHandle.setAttribute("data-edge-id", edge.id);
        targetHandle.setAttribute("data-endpoint", "target");
        targetHandle.setAttribute("title", "Drag to reconnect end of line to a shape");
        this.interactionLayerEl.appendChild(targetHandle);

        // Waypoint handles (if waypoints exist)
        if (edge.waypoints) {
          edge.waypoints.forEach((wp, idx) => {
            const wpHandle = document.createElementNS(svgNS, "circle");
            wpHandle.setAttribute("cx", String(wp.x));
            wpHandle.setAttribute("cy", String(wp.y));
            wpHandle.setAttribute("r", "5");
            wpHandle.setAttribute(
              "class",
              "umlcanvas-edge-handle umlcanvas-edge-waypoint-handle"
            );
            wpHandle.setAttribute("data-edge-id", edge.id);
            wpHandle.setAttribute("data-waypoint-index", String(idx));
            wpHandle.setAttribute("title", "Drag to adjust bend point");
            this.interactionLayerEl.appendChild(wpHandle);
          });
        }
      }
    }

    // Edge drawing preview
    if (this.dragMode.type === "edge") {
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", String(this.dragMode.startPoint.x));
      line.setAttribute("y1", String(this.dragMode.startPoint.y));
      line.setAttribute("x2", String(this.dragMode.currentCanvasPoint.x));
      line.setAttribute("y2", String(this.dragMode.currentCanvasPoint.y));
      line.setAttribute("class", "umlcanvas-edge-preview-line");
      line.setAttribute("marker-end", "url(#umlcanvas-arrow-end)");
      this.interactionLayerEl.appendChild(line);
    }

    // Edge reconnect preview
    if (this.dragMode.type === "edge-reconnect") {
      const reconnectState = this.dragMode;
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", String(reconnectState.fixedPoint.x));
      line.setAttribute("y1", String(reconnectState.fixedPoint.y));
      line.setAttribute("x2", String(reconnectState.currentPoint.x));
      line.setAttribute("y2", String(reconnectState.currentPoint.y));
      line.setAttribute(
        "class",
        "umlcanvas-edge-preview-line umlcanvas-edge-reconnect-line"
      );
      line.setAttribute("marker-end", "url(#umlcanvas-arrow-end)");
      this.interactionLayerEl.appendChild(line);

      // If hovering a target candidate node, highlight it
      if (reconnectState.hoveredNodeId) {
        const hoveredNode = this.editor.diagram.nodes.find(
          (n) => n.id === reconnectState.hoveredNodeId
        );
        if (hoveredNode) {
          const highlight = document.createElementNS(svgNS, "rect");
          highlight.setAttribute("x", String(hoveredNode.position.x - 4));
          highlight.setAttribute("y", String(hoveredNode.position.y - 4));
          highlight.setAttribute("width", String(hoveredNode.size.width + 8));
          highlight.setAttribute("height", String(hoveredNode.size.height + 8));
          highlight.setAttribute("class", "umlcanvas-snap-highlight");
          highlight.setAttribute("rx", "4");
          highlight.setAttribute("ry", "4");
          this.interactionLayerEl.appendChild(highlight);
        }
      }
    }

    // Marquee selection preview
    if (this.dragMode.type === "marquee") {
      const minX = Math.min(this.dragMode.startCanvas.x, this.dragMode.currentCanvas.x);
      const minY = Math.min(this.dragMode.startCanvas.y, this.dragMode.currentCanvas.y);
      const w = Math.abs(this.dragMode.currentCanvas.x - this.dragMode.startCanvas.x);
      const h = Math.abs(this.dragMode.currentCanvas.y - this.dragMode.startCanvas.y);

      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(minX));
      rect.setAttribute("y", String(minY));
      rect.setAttribute("width", String(w));
      rect.setAttribute("height", String(h));
      rect.setAttribute("class", "umlcanvas-marquee-rect");
      this.interactionLayerEl.appendChild(rect);
    }
  }

  private getResizeHandlePosition(node: DiagramNode, handle: string): Point {
    const x = node.position.x;
    const y = node.position.y;
    const w = node.size.width;
    const h = node.size.height;

    switch (handle) {
      case "nw":
        return { x, y };
      case "n":
        return { x: x + w / 2, y };
      case "ne":
        return { x: x + w, y };
      case "e":
        return { x: x + w, y: y + h / 2 };
      case "se":
        return { x: x + w, y: y + h };
      case "s":
        return { x: x + w / 2, y: y + h };
      case "sw":
        return { x, y: y + h };
      case "w":
        return { x, y: y + h / 2 };
      default:
        return { x, y };
    }
  }

  // --- Event Handling ---

  private getClientCoords(e: MouseEvent): Point {
    const rect = this.container.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private handleWheel(e: WheelEvent): void {
    const target = e.target as HTMLElement | null;
    const scrollable = target?.closest?.(
      ".umlcanvas-obsidian-note-body, .umlcanvas-scrollable"
    ) as HTMLElement | null;
    if (scrollable && !e.ctrlKey && !e.metaKey) {
      return;
    }

    e.preventDefault();
    const cursor = this.getClientCoords(e);
    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.setTransform(zoomAtPoint(cursor, this.transform, zoomFactor));
  }

  private handleMouseDown(e: MouseEvent): void {
    if (this.inlineEditorEl) {
      this.commitInlineEditor();
    }

    const clientPoint = this.getClientCoords(e);
    const canvasPoint = screenToCanvas(clientPoint, this.transform);

    // Pan via middle button or spacebar + left click
    if (e.button === 1 || (e.button === 0 && this.isSpacePressed)) {
      e.preventDefault();
      this.dragMode = {
        type: "pan",
        startClient: clientPoint,
        startTransform: { ...this.transform },
      };
      this.container.classList.add("umlcanvas-panning");
      return;
    }

    if (e.button !== 0) return;

    const target = e.target as Element;

    // Edge endpoint handle click -> start reconnecting (F-007)
    if (target.classList.contains("umlcanvas-edge-endpoint-handle")) {
      const edgeId = target.getAttribute("data-edge-id")!;
      const endpoint = target.getAttribute("data-endpoint")! as "source" | "target";
      const edge = this.editor.diagram.edges.find((ed) => ed.id === edgeId);
      if (edge) {
        const fixedNodeId = endpoint === "source" ? edge.toNodeId : edge.fromNodeId;
        const fixedNode = this.editor.diagram.nodes.find((n) => n.id === fixedNodeId);
        const fixedPoint = fixedNode
          ? getRectCenter(fixedNode.position, fixedNode.size)
          : canvasPoint;

        this.dragMode = {
          type: "edge-reconnect",
          edgeId,
          endpoint,
          fixedNodeId,
          fixedPoint,
          currentPoint: canvasPoint,
        };
        this.renderInteractions();
        return;
      }
    }

    // Edge waypoint handle click -> start moving waypoint
    if (target.classList.contains("umlcanvas-edge-waypoint-handle")) {
      const edgeId = target.getAttribute("data-edge-id")!;
      const waypointIndex = parseInt(target.getAttribute("data-waypoint-index")!, 10);
      const edge = this.editor.diagram.edges.find((ed) => ed.id === edgeId);
      if (edge && edge.waypoints && edge.waypoints[waypointIndex]) {
        this.dragMode = {
          type: "edge-waypoint",
          edgeId,
          waypointIndex,
          initialWaypoints: edge.waypoints.map((p) => ({ ...p })),
        };
        return;
      }
    }

    // Port handle click -> start edge drawing (F-007)
    if (target.classList.contains("umlcanvas-port-handle")) {
      const nodeEl = target.closest(".umlcanvas-node");
      const nodeId = nodeEl?.getAttribute("data-node-id");
      const portId = target.getAttribute("data-port-id") ?? undefined;
      const side = target.getAttribute("data-side") as Side;
      if (nodeId) {
        const node = this.editor.diagram.nodes.find((n) => n.id === nodeId);
        if (node) {
          const port = node.ports.find((p) => p.id === portId);
          const startPt = getSidePoint(
            node.position,
            node.size,
            side,
            port?.offset ?? 0.5
          );
          this.dragMode = {
            type: "edge",
            fromNodeId: nodeId,
            fromPortId: portId,
            fromSide: side,
            startPoint: startPt,
            currentCanvasPoint: canvasPoint,
          };
          this.renderInteractions();
          return;
        }
      }
    }

    // Group collapse button click
    const groupCollapseBtn = target.closest(".umlcanvas-group-collapse-btn");
    if (groupCollapseBtn) {
      e.stopPropagation();
      const groupId = groupCollapseBtn.getAttribute("data-group-id");
      if (groupId) {
        this.editor.toggleGroupCollapse(groupId);
        return;
      }
    }

    // Group resize handle click
    if (target.classList.contains("umlcanvas-group-resize-handle")) {
      const groupId = target.getAttribute("data-group-id");
      const handle = target.getAttribute("data-handle")!;
      const group = this.editor.diagram.groups.find((g) => g.id === groupId);
      if (group && !group.locked) {
        const bounds = this.getGroupBounds(group);
        this.dragMode = {
          type: "group-resize",
          groupId: group.id,
          handle,
          startClient: clientPoint,
          initialPosition: { ...bounds.position },
          initialSize: { ...bounds.size },
        };
        return;
      }
    }

    // Resize handle click
    if (target.classList.contains("umlcanvas-resize-handle")) {
      const handle = target.getAttribute("data-handle")!;
      const selectedId = this.editor.selectedNodeIds[0];
      const node = this.editor.diagram.nodes.find((n) => n.id === selectedId);
      if (node && !this.editor.isNodeLocked(node.id)) {
        this.dragMode = {
          type: "resize",
          nodeId: node.id,
          handle,
          startClient: clientPoint,
          initialPosition: { ...node.position },
          initialSize: { ...node.size },
        };
        return;
      }
    }

    // Edge click
    const edgeEl = target.closest(".umlcanvas-edge");
    if (edgeEl) {
      const edgeId = edgeEl.getAttribute("data-edge-id");
      if (edgeId) {
        this.editor.selectEdge(edgeId, e.shiftKey || e.metaKey || e.ctrlKey);
        return;
      }
    }

    // Click on note open button (F-Obsidian-Notes)
    const openBtn = target.closest(".umlcanvas-obsidian-note-open-btn");
    if (openBtn) {
      e.stopPropagation();
      const filePath = openBtn.getAttribute("data-file-path");
      if (filePath && this.onNoteOpen) {
        this.onNoteOpen(filePath);
        return;
      }
    }

    // Click on link inside note body (internal link [[...]] or markdown link)
    const noteLink = target.closest(
      ".umlcanvas-obsidian-note-body a, .umlcanvas-obsidian-note-body .internal-link"
    );
    if (noteLink) {
      e.stopPropagation();
      e.preventDefault();
      const href = noteLink.getAttribute("data-href") || noteLink.getAttribute("href");
      if (href && this.onNoteOpen) {
        this.onNoteOpen(href);
        return;
      }
    }

    // Node click -> Select & start move
    const nodeEl = target.closest(".umlcanvas-node");
    if (nodeEl) {
      const nodeId = nodeEl.getAttribute("data-node-id");
      if (nodeId) {
        if (this.editor.isNodeLocked(nodeId)) {
          return;
        }

        const isMulti = e.shiftKey || e.metaKey || e.ctrlKey;
        if (isMulti) {
          this.editor.toggleNodeSelection(nodeId);
        } else if (!this.editor.isNodeSelected(nodeId)) {
          this.editor.selectNode(nodeId, false);
        }

        // If clicking inside the scrollable note body, allow text selection and internal interactions without initiating card dragging
        if (target.closest(".umlcanvas-obsidian-note-body")) {
          return;
        }

        if (e.altKey) {
          const dupResult = this.editor.duplicateSelection({ x: 0, y: 0 });
          if (dupResult.nodes.length > 0) {
            const initialPositions = new Map<string, Point>();
            for (const n of dupResult.nodes) {
              initialPositions.set(n.id, { ...n.position });
            }
            this.dragMode = {
              type: "move",
              startClient: clientPoint,
              initialPositions,
              moved: true,
            };
            this.container.classList.add("umlcanvas-moving");
            return;
          }
        }

        const initialPositions = new Map<string, Point>();
        for (const id of this.editor.selectedNodeIds) {
          const n = this.editor.diagram.nodes.find((nd) => nd.id === id);
          if (n && !this.editor.isNodeLocked(n.id)) {
            initialPositions.set(id, { ...n.position });
          }
        }

        this.dragMode = {
          type: "move",
          startClient: clientPoint,
          initialPositions,
          moved: false,
        };
        this.container.classList.add("umlcanvas-moving");
        return;
      }
    }

    // Group click -> Select & start move
    const groupTarget = target.closest(
      ".umlcanvas-group-header-bg, .umlcanvas-group-title, .umlcanvas-group-badge, .umlcanvas-group-collapsed-card, .umlcanvas-group-box"
    );
    if (groupTarget) {
      const groupId = groupTarget.getAttribute("data-group-id");
      if (groupId) {
        const group = this.editor.diagram.groups.find((g) => g.id === groupId);
        if (group) {
          const isMulti = e.shiftKey || e.metaKey || e.ctrlKey;
          if (isMulti) {
            this.editor.toggleGroupSelection(groupId);
          } else if (!this.editor.isGroupSelected(groupId)) {
            this.editor.selectGroup(groupId, false);
          }

          if (!group.locked) {
            const initialMemberPositions = new Map<string, Point>();
            for (const nid of group.nodeIds) {
              const n = this.editor.diagram.nodes.find((nd) => nd.id === nid);
              if (n) {
                initialMemberPositions.set(nid, { ...n.position });
              }
            }
            this.dragMode = {
              type: "group-move",
              groupId: group.id,
              startClient: clientPoint,
              initialGroupPos: group.position ? { ...group.position } : undefined,
              initialMemberPositions,
              moved: false,
            };
            this.container.classList.add("umlcanvas-moving");
          }
          return;
        }
      }
    }

    // Empty canvas background click:
    // If in Freehand mode, draw stroke (F-070)
    if (this.isFreehandMode && this.enableFreehand && !this.isSpacePressed) {
      e.preventDefault();
      const initialPoint: StrokePoint = {
        x: canvasPoint.x,
        y: canvasPoint.y,
        pressure: (e as unknown as PointerEvent).pressure ?? 0.5,
        time: Date.now(),
      };
      this.activeStroke = {
        id: `stroke-${Date.now()}`,
        points: [initialPoint],
      };

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${canvasPoint.x},${canvasPoint.y}`);
      path.setAttribute("class", "umlcanvas-freehand-stroke");
      this.freehandPathEl = path;
      this.viewportEl.appendChild(path);

      this.dragMode = { type: "freehand" };
      return;
    }

    // Canvas background click -> marquee
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
      this.editor.clearSelection();
    }

    this.dragMode = {
      type: "marquee",
      startCanvas: canvasPoint,
      currentCanvas: canvasPoint,
    };
  }

  private handleMouseMove(e: MouseEvent): void {
    const clientPoint = this.getClientCoords(e);
    const canvasPoint = screenToCanvas(clientPoint, this.transform);

    if (
      this.dragMode.type === "freehand" &&
      this.activeStroke &&
      this.freehandPathEl
    ) {
      this.activeStroke.points.push({
        x: canvasPoint.x,
        y: canvasPoint.y,
        pressure: (e as unknown as PointerEvent).pressure ?? 0.5,
        time: Date.now(),
      });
      const d = this.activeStroke.points
        .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x},${pt.y}`)
        .join(" ");
      this.freehandPathEl.setAttribute("d", d);
      return;
    }

    if (this.dragMode.type === "pan") {
      const dx = clientPoint.x - this.dragMode.startClient.x;
      const dy = clientPoint.y - this.dragMode.startClient.y;
      this.setTransform({
        panX: this.dragMode.startTransform.panX + dx,
        panY: this.dragMode.startTransform.panY + dy,
        zoom: this.dragMode.startTransform.zoom,
      });
      return;
    }

    if (this.dragMode.type === "move") {
      const moveState = this.dragMode;
      const dx = (clientPoint.x - moveState.startClient.x) / this.transform.zoom;
      const dy = (clientPoint.y - moveState.startClient.y) / this.transform.zoom;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        moveState.moved = true;
      }

      // Snapping (F-009)
      const otherNodes = this.editor.diagram.nodes.filter(
        (n) => !moveState.initialPositions.has(n.id) && this.editor.isNodeVisible(n.id)
      );

      // Single node moving alignment guides
      let activeGuides: AlignmentGuides | undefined = undefined;
      const primaryId = this.editor.selectedNodeIds[0];
      const initialPrimaryPos = moveState.initialPositions.get(primaryId);
      const primaryNode = this.editor.diagram.nodes.find((n) => n.id === primaryId);

      let snapOffsetX = 0;
      let snapOffsetY = 0;

      if (primaryNode && initialPrimaryPos && moveState.initialPositions.size === 1) {
        const rawPos = point(initialPrimaryPos.x + dx, initialPrimaryPos.y + dy);
        const snapRes = defaultSnappingService.snapToGuides(
          { position: rawPos, size: primaryNode.size },
          otherNodes
        );
        snapOffsetX = snapRes.snappedPosition.x - rawPos.x;
        snapOffsetY = snapRes.snappedPosition.y - rawPos.y;
        activeGuides = snapRes.guides;
      }

      for (const [id, initialPos] of moveState.initialPositions.entries()) {
        const node = this.editor.diagram.nodes.find((n) => n.id === id);
        if (node) {
          node.position = {
            x: Math.round(initialPos.x + dx + snapOffsetX),
            y: Math.round(initialPos.y + dy + snapOffsetY),
          };
        }
      }

      moveState.activeGuides = activeGuides;

      this.renderEdges();
      this.renderNodes();
      this.renderInteractions();
      return;
    }

    if (this.dragMode.type === "group-move") {
      const moveState = this.dragMode;
      const dx = (clientPoint.x - moveState.startClient.x) / this.transform.zoom;
      const dy = (clientPoint.y - moveState.startClient.y) / this.transform.zoom;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        moveState.moved = true;
      }

      if (moveState.moved) {
        for (const [id, initialPos] of moveState.initialMemberPositions.entries()) {
          const node = this.editor.diagram.nodes.find((n) => n.id === id);
          if (node) {
            node.position = {
              x: Math.round(initialPos.x + dx),
              y: Math.round(initialPos.y + dy),
            };
          }
        }
        if (moveState.initialGroupPos) {
          const group = this.editor.diagram.groups.find((g) => g.id === moveState.groupId);
          if (group) {
            group.position = {
              x: Math.round(moveState.initialGroupPos.x + dx),
              y: Math.round(moveState.initialGroupPos.y + dy),
            };
          }
        }
        this.render();
      }
      return;
    }

    if (this.dragMode.type === "resize") {
      const dx = (clientPoint.x - this.dragMode.startClient.x) / this.transform.zoom;
      const dy = (clientPoint.y - this.dragMode.startClient.y) / this.transform.zoom;

      const resizeState = this.dragMode;
      const node = this.editor.diagram.nodes.find((n) => n.id === resizeState.nodeId);
      if (!node) return;

      const { initialPosition: pos, initialSize: size, handle } = resizeState;
      let newX = pos.x;
      let newY = pos.y;
      let newW = size.width;
      let newH = size.height;

      const minW = 60;
      const minH = 40;

      if (handle.includes("e")) newW = Math.max(minW, size.width + dx);
      if (handle.includes("s")) newH = Math.max(minH, size.height + dy);
      if (handle.includes("w")) {
        const possibleW = size.width - dx;
        if (possibleW >= minW) {
          newX = pos.x + dx;
          newW = possibleW;
        }
      }
      if (handle.includes("n")) {
        const possibleH = size.height - dy;
        if (possibleH >= minH) {
          newY = pos.y + dy;
          newH = possibleH;
        }
      }

      node.position = { x: Math.round(newX), y: Math.round(newY) };
      node.size = { width: Math.round(newW), height: Math.round(newH) };

      this.renderEdges();
      this.renderNodes();
      this.renderInteractions();
      return;
    }

    if (this.dragMode.type === "group-resize") {
      const resizeState = this.dragMode;
      const dx = (clientPoint.x - resizeState.startClient.x) / this.transform.zoom;
      const dy = (clientPoint.y - resizeState.startClient.y) / this.transform.zoom;

      const group = this.editor.diagram.groups.find((g) => g.id === resizeState.groupId);
      if (!group) return;

      const { initialPosition: pos, initialSize: size, handle } = resizeState;
      let newX = pos.x;
      let newY = pos.y;
      let newW = size.width;
      let newH = size.height;

      const minW = 100;
      const minH = 60;

      if (handle.includes("e")) newW = Math.max(minW, size.width + dx);
      if (handle.includes("s")) newH = Math.max(minH, size.height + dy);
      if (handle.includes("w")) {
        const possibleW = size.width - dx;
        if (possibleW >= minW) {
          newX = pos.x + dx;
          newW = possibleW;
        }
      }
      if (handle.includes("n")) {
        const possibleH = size.height - dy;
        if (possibleH >= minH) {
          newY = pos.y + dy;
          newH = possibleH;
        }
      }

      group.position = { x: Math.round(newX), y: Math.round(newY) };
      group.size = { width: Math.round(newW), height: Math.round(newH) };

      this.render();
      return;
    }

    if (this.dragMode.type === "edge") {
      this.dragMode.currentCanvasPoint = canvasPoint;
      this.renderInteractions();
      return;
    }

    if (this.dragMode.type === "edge-reconnect") {
      this.dragMode.currentPoint = canvasPoint;

      let hoveredNodeId: string | undefined;
      let hoveredSide: Side | undefined;
      let hoveredPortId: string | undefined;

      for (const node of this.editor.diagram.nodes) {
        if (!this.editor.isNodeVisible(node.id)) continue;
        if (node.id === this.dragMode.fixedNodeId) continue;
        const pad = 12;
        if (
          canvasPoint.x >= node.position.x - pad &&
          canvasPoint.x <= node.position.x + node.size.width + pad &&
          canvasPoint.y >= node.position.y - pad &&
          canvasPoint.y <= node.position.y + node.size.height + pad
        ) {
          hoveredNodeId = node.id;
          hoveredSide = getFacingSide(node.position, node.size, canvasPoint);

          if (node.ports && node.ports.length > 0) {
            for (const p of node.ports) {
              const pt = getSidePoint(node.position, node.size, p.side, p.offset);
              if (Math.hypot(canvasPoint.x - pt.x, canvasPoint.y - pt.y) < 16) {
                hoveredPortId = p.id;
                hoveredSide = p.side;
                break;
              }
            }
          }
          break;
        }
      }

      this.dragMode.hoveredNodeId = hoveredNodeId;
      this.dragMode.hoveredSide = hoveredSide;
      this.dragMode.hoveredPortId = hoveredPortId;

      this.renderInteractions();
      return;
    }

    if (this.dragMode.type === "edge-waypoint") {
      const wpState = this.dragMode;
      const edge = this.editor.diagram.edges.find((ed) => ed.id === wpState.edgeId);
      if (edge && edge.waypoints && edge.waypoints[wpState.waypointIndex]) {
        edge.waypoints[wpState.waypointIndex] = {
          x: Math.round(canvasPoint.x),
          y: Math.round(canvasPoint.y),
        };
        this.renderEdges();
        this.renderInteractions();
      }
      return;
    }

    if (this.dragMode.type === "marquee") {
      this.dragMode.currentCanvas = canvasPoint;
      this.renderInteractions();
      return;
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    const clientPoint = this.getClientCoords(e);

    if (this.dragMode.type === "freehand") {
      if (this.freehandPathEl) {
        this.freehandPathEl.remove();
        this.freehandPathEl = null;
      }
      if (this.activeStroke) {
        const stroke = this.activeStroke;
        this.activeStroke = null;

        // Discard micro-strokes / accidental clicks (< 15px bounding box or < 4 points)
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const pt of stroke.points) {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        }
        const width = maxX - minX;
        const height = maxY - minY;
        const isMicroStroke = stroke.points.length < 4 || (width < 15 && height < 15);

        if (!isMicroStroke && this.onStrokeComplete) {
          this.onStrokeComplete(stroke);
        }
      }
      this.dragMode = { type: "none" };
      return;
    }

    if (this.dragMode.type === "pan") {
      this.container.classList.remove("umlcanvas-panning");
      this.dragMode = { type: "none" };
      return;
    }

    if (this.dragMode.type === "move") {
      this.container.classList.remove("umlcanvas-moving");
      if (this.dragMode.moved) {
        const moves: Array<{ nodeId: string; oldPos: Point; newPos: Point }> = [];
        for (const [id, initialPos] of this.dragMode.initialPositions.entries()) {
          const node = this.editor.diagram.nodes.find((n) => n.id === id);
          if (node) {
            moves.push({
              nodeId: id,
              oldPos: initialPos,
              newPos: { ...node.position },
            });
          }
        }
        this.editor.moveNodes(moves);
      }
      this.dragMode = { type: "none" };
      this.renderInteractions();
      return;
    }

    if (this.dragMode.type === "group-move") {
      const moveState = this.dragMode;
      this.container.classList.remove("umlcanvas-moving");
      if (moveState.moved) {
        const dx = (clientPoint.x - moveState.startClient.x) / this.transform.zoom;
        const dy = (clientPoint.y - moveState.startClient.y) / this.transform.zoom;

        // Restore initial positions first so the command applies delta cleanly
        for (const [nid, initPos] of moveState.initialMemberPositions.entries()) {
          const node = this.editor.diagram.nodes.find((n) => n.id === nid);
          if (node) {
            node.position = { ...initPos };
          }
        }
        if (moveState.initialGroupPos) {
          const group = this.editor.diagram.groups.find((g) => g.id === moveState.groupId);
          if (group) {
            group.position = { ...moveState.initialGroupPos };
          }
        }
        this.editor.moveGroup(moveState.groupId, {
          x: Math.round(dx),
          y: Math.round(dy),
        });
      }
      this.dragMode = { type: "none" };
      this.render();
      return;
    }

    if (this.dragMode.type === "resize") {
      const resizeState = this.dragMode;
      const node = this.editor.diagram.nodes.find((n) => n.id === resizeState.nodeId);
      if (node) {
        this.editor.resizeNode(
          node.id,
          { position: resizeState.initialPosition, size: resizeState.initialSize },
          { position: { ...node.position }, size: { ...node.size } }
        );
      }
      this.dragMode = { type: "none" };
      return;
    }

    if (this.dragMode.type === "group-resize") {
      const resizeState = this.dragMode;
      const group = this.editor.diagram.groups.find((g) => g.id === resizeState.groupId);
      if (group && group.position && group.size) {
        const finalPos = { ...group.position };
        const finalSize = { ...group.size };
        group.position = { ...resizeState.initialPosition };
        group.size = { ...resizeState.initialSize };
        this.editor.resizeGroup(resizeState.groupId, finalPos, finalSize);
      }
      this.dragMode = { type: "none" };
      this.render();
      return;
    }

    if (this.dragMode.type === "edge") {
      const elem = typeof document !== "undefined" && document.elementFromPoint
        ? document.elementFromPoint(e.clientX, e.clientY)
        : null;
      const targetNodeEl = elem?.closest(".umlcanvas-node");
      const targetNodeId = targetNodeEl?.getAttribute("data-node-id");

      if (targetNodeId && targetNodeId !== this.dragMode.fromNodeId) {
        const targetPortId = elem?.getAttribute("data-port-id") ?? undefined;
        const targetSide = elem?.getAttribute("data-side") as Side | undefined;

        this.editor.addEdge(this.dragMode.fromNodeId, targetNodeId, {
          fromPortId: this.dragMode.fromPortId,
          fromSide: this.dragMode.fromSide,
          toPortId: targetPortId,
          toSide: targetSide,
          kind: this.editor.activeEdgeKind,
          routing: this.editor.defaultRouting,
        });
      }

      this.dragMode = { type: "none" };
      this.renderInteractions();
      return;
    }

    if (this.dragMode.type === "edge-reconnect") {
      const reconnectState = this.dragMode;
      this.dragMode = { type: "none" };

      const elem = typeof document !== "undefined" && document.elementFromPoint
        ? document.elementFromPoint(e.clientX, e.clientY)
        : null;
      const targetNodeEl = elem?.closest(".umlcanvas-node");
      const targetNodeId = targetNodeEl?.getAttribute("data-node-id") ?? reconnectState.hoveredNodeId;

      if (targetNodeId && targetNodeId !== reconnectState.fixedNodeId) {
        const targetPortId = elem?.getAttribute("data-port-id") ?? reconnectState.hoveredPortId;
        const targetSide = (elem?.getAttribute("data-side") as Side) ?? reconnectState.hoveredSide;

        this.editor.reconnectEdge(
          reconnectState.edgeId,
          reconnectState.endpoint,
          {
            nodeId: targetNodeId,
            portId: targetPortId,
            side: targetSide,
          }
        );
      }
      this.render();
      return;
    }

    if (this.dragMode.type === "edge-waypoint") {
      const waypointState = this.dragMode;
      this.dragMode = { type: "none" };
      const edge = this.editor.diagram.edges.find((ed) => ed.id === waypointState.edgeId);
      if (edge && edge.waypoints) {
        const finalWaypoints = edge.waypoints.map((p) => ({ ...p }));
        edge.waypoints = waypointState.initialWaypoints.map((p) => ({ ...p }));
        this.editor.updateEdgeWaypoints(edge.id, finalWaypoints);
      }
      this.render();
      return;
    }

    if (this.dragMode.type === "marquee") {
      const minX = Math.min(this.dragMode.startCanvas.x, this.dragMode.currentCanvas.x);
      const minY = Math.min(this.dragMode.startCanvas.y, this.dragMode.currentCanvas.y);
      const w = Math.abs(this.dragMode.currentCanvas.x - this.dragMode.startCanvas.x);
      const h = Math.abs(this.dragMode.currentCanvas.y - this.dragMode.startCanvas.y);

      if (w > 5 || h > 5) {
        this.editor.selectArea(rectFromBounds(minX, minY, w, h));
      }

      this.dragMode = { type: "none" };
      this.renderInteractions();
      return;
    }
  }

  private handleDblClick(e: MouseEvent): void {
    const target = e.target as Element;

    // Double-click on group header or title -> rename group
    const groupHeader = target.closest(
      ".umlcanvas-group-header-bg, .umlcanvas-group-title, .umlcanvas-group-collapsed-card"
    );
    if (groupHeader) {
      const groupId = groupHeader.getAttribute("data-group-id");
      if (groupId) {
        const group = this.editor.diagram.groups.find((g) => g.id === groupId);
        if (group && !group.locked) {
          this.startGroupInlineEditor(group);
          return;
        }
      }
    }

    const nodeEl = target.closest(".umlcanvas-node");

    if (nodeEl) {
      const nodeId = nodeEl.getAttribute("data-node-id");
      if (nodeId) {
        const node = this.editor.diagram.nodes.find((n) => n.id === nodeId);
        if (node && !this.editor.isNodeLocked(node.id)) {
          if (node.kind === "obsidian.note" || node.metadata?.filePath) {
            const filePath =
              (node.metadata?.filePath as string) ||
              (node.customData?.filePath as string);
            if (filePath && this.onNoteOpen) {
              this.onNoteOpen(filePath);
              return;
            }
          }
          if (node.kind === "schematic.chip" && this.onChipEdit) {
            this.onChipEdit(node);
            return;
          }
          this.startInlineEditor(node);
          return;
        }
      }
    }

    // Double-click on edge or edge label -> start edge label editor
    const edgeEl = target.closest(".umlcanvas-edge");
    if (edgeEl) {
      const edgeId = edgeEl.getAttribute("data-edge-id");
      if (edgeId) {
        const edge = this.editor.diagram.edges.find((ed) => ed.id === edgeId);
        if (edge) {
          this.editor.selectEdge(edge.id, false);
          const clientPoint = this.getClientCoords(e);
          const canvasPoint = screenToCanvas(clientPoint, this.transform);
          this.startEdgeInlineEditor(edge, canvasPoint);
          return;
        }
      }
    }

    // Double-click empty canvas -> Add node
    const clientPoint = this.getClientCoords(e);
    const canvasPoint = screenToCanvas(clientPoint, this.transform);
    const newNode = this.editor.addNode({
      position: {
        x: Math.round(canvasPoint.x - 80),
        y: Math.round(canvasPoint.y - 50),
      },
      title: "New Class",
    });

    // Auto-containment: if double-clicked inside an expanded group, add to group
    if (newNode) {
      for (const group of this.editor.diagram.groups) {
        if (group.collapsed) continue;
        const bounds = this.getGroupBounds(group);
        if (
          canvasPoint.x >= bounds.position.x &&
          canvasPoint.x <= bounds.position.x + bounds.size.width &&
          canvasPoint.y >= bounds.position.y &&
          canvasPoint.y <= bounds.position.y + bounds.size.height
        ) {
          this.editor.addNodesToGroup(group.id, [newNode.id]);
          break;
        }
      }
    }
  }

  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const clientPoint = this.getClientCoords(e);
    const canvasPoint = screenToCanvas(clientPoint, this.transform);

    const target = e.target as Element;
    const nodeEl = target.closest(".umlcanvas-node");
    const nodeId = nodeEl?.getAttribute("data-node-id");
    const node = nodeId ? this.editor.diagram.nodes.find((n) => n.id === nodeId) : undefined;

    const edgeEl = target.closest(".umlcanvas-edge");
    const edgeId = edgeEl?.getAttribute("data-edge-id");
    const edge = edgeId ? this.editor.diagram.edges.find((ed) => ed.id === edgeId) : undefined;

    const groupEl = target.closest(
      ".umlcanvas-group, .umlcanvas-group-box, .umlcanvas-group-header-bg, .umlcanvas-group-title, .umlcanvas-group-collapsed-card"
    );
    const groupId = groupEl?.getAttribute("data-group-id");
    let group = groupId ? this.editor.diagram.groups.find((g) => g.id === groupId) : undefined;
    if (!node && !edge && !group) {
      for (const g of this.editor.diagram.groups) {
        const bounds = this.getGroupBounds(g);
        if (
          canvasPoint.x >= bounds.position.x &&
          canvasPoint.x <= bounds.position.x + bounds.size.width &&
          canvasPoint.y >= bounds.position.y &&
          canvasPoint.y <= bounds.position.y + bounds.size.height
        ) {
          group = g;
          break;
        }
      }
    }

    if (group && !node && !edge && !this.editor.isGroupSelected(group.id)) {
      this.editor.selectGroup(group.id, false);
    }

    if (this.onContextMenu) {
      this.onContextMenu(e, canvasPoint, node, edge, group);
    }
  }

  public startInlineEditor(node: DiagramNode): void {
    if (this.inlineEditorEl) {
      this.commitInlineEditor();
    }

    const screenPos = canvasToScreen(node.position, this.transform);
    const screenWidth = node.size.width * this.transform.zoom;

    const input = document.createElement("input");
    input.type = "text";
    input.value = node.labels[0]?.text ?? "";
    input.className = "umlcanvas-inline-editor";
    input.style.left = `${screenPos.x}px`;
    input.style.top = `${screenPos.y + 6 * this.transform.zoom}px`;
    input.style.width = `${screenWidth}px`;
    input.setAttribute("data-node-id", node.id);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.commitInlineEditor();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancelInlineEditor();
      }
    });

    input.addEventListener("blur", () => {
      this.commitInlineEditor();
    });

    this.container.appendChild(input);
    input.focus();
    if (typeof input.select === "function") {
      input.select();
    }
    this.inlineEditorEl = input;
  }

  public getEdgeCenter(edge: DiagramEdge): Point {
    const fromNode = this.editor.diagram.nodes.find((n) => n.id === edge.fromNodeId);
    const toNode = this.editor.diagram.nodes.find((n) => n.id === edge.toNodeId);
    if (!fromNode || !toNode) {
      return { x: 0, y: 0 };
    }

    const fromPort = fromNode.ports?.find((p) => p.id === edge.fromPortId);
    const toPort = toNode.ports?.find((p) => p.id === edge.toPortId);

    const fromSide = fromPort?.side ?? edge.fromSide;
    const toSide = toPort?.side ?? edge.toSide;

    const visibleNodes = this.editor.diagram.nodes.filter((n) =>
      this.editor.isNodeVisible(n.id)
    );

    const routingResult = defaultRoutingService.route(
      {
        id: fromNode.id,
        position: fromNode.position,
        size: fromNode.size,
        side: fromSide,
        portOffset: fromPort?.offset,
      },
      {
        id: toNode.id,
        position: toNode.position,
        size: toNode.size,
        side: toSide,
        portOffset: toPort?.offset,
      },
      {
        routing: edge.routing,
        obstacles: visibleNodes,
        manualWaypoints: edge.waypoints,
      }
    );

    if (routingResult.points.length >= 2) {
      const midIdx = Math.floor(routingResult.points.length / 2);
      const p1 = routingResult.points[midIdx - 1] ?? routingResult.points[0];
      const p2 = routingResult.points[midIdx] ?? routingResult.points[1];
      return {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
      };
    }

    return {
      x: (fromNode.position.x + toNode.position.x) / 2,
      y: (fromNode.position.y + toNode.position.y) / 2,
    };
  }

  public startEdgeInlineEditor(edge: DiagramEdge, atPoint?: Point): void {
    if (this.inlineEditorEl) {
      this.commitInlineEditor();
    }

    const centerCanvas = atPoint ?? this.getEdgeCenter(edge);
    const screenPos = canvasToScreen(centerCanvas, this.transform);

    const input = document.createElement("input");
    input.type = "text";
    input.value = edge.labels && edge.labels.length > 0 ? edge.labels[0].text : "";
    input.placeholder = "Line label...";
    input.className = "umlcanvas-inline-editor umlcanvas-edge-inline-editor";

    const width = Math.max(120, 140 * this.transform.zoom);
    input.style.left = `${screenPos.x - width / 2}px`;
    input.style.top = `${screenPos.y - 14 * this.transform.zoom}px`;
    input.style.width = `${width}px`;
    input.setAttribute("data-edge-id", edge.id);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.commitInlineEditor();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancelInlineEditor();
      }
    });

    input.addEventListener("blur", () => {
      this.commitInlineEditor();
    });

    this.container.appendChild(input);
    input.focus();
    if (typeof input.select === "function") {
      input.select();
    }
    this.inlineEditorEl = input;
  }

  public startGroupInlineEditor(group: Group, atPoint?: Point): void {
    if (this.inlineEditorEl) {
      this.commitInlineEditor();
    }

    const bounds = this.getGroupBounds(group);
    const canvasPos = atPoint ?? { x: bounds.position.x + 24, y: bounds.position.y + 4 };
    const screenPos = canvasToScreen(canvasPos, this.transform);

    const input = document.createElement("input");
    input.type = "text";
    input.value = group.name;
    input.placeholder = "Group title...";
    input.className = "umlcanvas-inline-editor umlcanvas-group-inline-editor";

    const width = Math.max(120, Math.min(240, (bounds.size.width - 40) * this.transform.zoom));
    input.style.left = `${screenPos.x}px`;
    input.style.top = `${screenPos.y}px`;
    input.style.width = `${width}px`;
    input.setAttribute("data-group-id", group.id);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.commitInlineEditor();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancelInlineEditor();
      }
    });

    input.addEventListener("blur", () => {
      this.commitInlineEditor();
    });

    this.container.appendChild(input);
    input.focus();
    if (typeof input.select === "function") {
      input.select();
    }
    this.inlineEditorEl = input;
  }

  private commitInlineEditor(): void {
    if (!this.inlineEditorEl) return;
    const nodeId = this.inlineEditorEl.getAttribute("data-node-id");
    const edgeId = this.inlineEditorEl.getAttribute("data-edge-id");
    const groupId = this.inlineEditorEl.getAttribute("data-group-id");
    const newText = this.inlineEditorEl.value.trim();

    if (nodeId && newText) {
      this.editor.updateNodeLabel(nodeId, newText);
    } else if (edgeId) {
      this.editor.updateEdgeLabel(edgeId, newText);
    } else if (groupId && newText) {
      this.editor.renameGroup(groupId, newText);
    }

    this.cleanupInlineEditor();
  }

  private cancelInlineEditor(): void {
    this.cleanupInlineEditor();
  }

  private cleanupInlineEditor(): void {
    if (this.inlineEditorEl) {
      this.inlineEditorEl.remove();
      this.inlineEditorEl = null;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.code === "Space" && !this.inlineEditorEl) {
      this.isSpacePressed = true;
      this.container.classList.add("umlcanvas-space-pressed");
    }

    if (this.inlineEditorEl) return;

    // Edit label on selected node, edge, or group (Enter or F2)
    if (e.key === "Enter" || e.key === "F2") {
      if (this.editor.selectedNodeIds.length === 1) {
        const node = this.editor.diagram.nodes.find(
          (n) => n.id === this.editor.selectedNodeIds[0]
        );
        if (node && !this.editor.isNodeLocked(node.id)) {
          e.preventDefault();
          this.startInlineEditor(node);
          return;
        }
      } else if (this.editor.selectedEdgeIds.length === 1) {
        const edge = this.editor.diagram.edges.find(
          (ed) => ed.id === this.editor.selectedEdgeIds[0]
        );
        if (edge) {
          e.preventDefault();
          this.startEdgeInlineEditor(edge);
          return;
        }
      } else if (this.editor.selectedGroupIds.length === 1) {
        const group = this.editor.diagram.groups.find(
          (g) => g.id === this.editor.selectedGroupIds[0]
        );
        if (group && !group.locked) {
          e.preventDefault();
          this.startGroupInlineEditor(group);
          return;
        }
      }
    }

    // Delete / Backspace
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.editor.deleteSelection();
      return;
    }

    // Color shortcuts: Alt+1 to Alt+6 (or 1 to 6 when selection exists), Alt+0 to clear
    const hasSelection =
      this.editor.selectedNodeIds.length > 0 ||
      this.editor.selectedEdgeIds.length > 0 ||
      this.editor.selectedGroupIds.length > 0;
    if (hasSelection && !e.ctrlKey && !e.metaKey) {
      if (["1", "2", "3", "4", "5", "6"].includes(e.key) && (e.altKey || !this.freehandMode)) {
        e.preventDefault();
        this.editor.setColorForSelection(e.key);
        return;
      }
      if (e.altKey && e.key === "0") {
        e.preventDefault();
        this.editor.setColorForSelection(undefined);
        return;
      }
    }

    // Group: Ctrl+G / Cmd+G
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g" && !e.shiftKey) {
      e.preventDefault();
      this.editor.groupSelection();
      return;
    }

    // Ungroup: Ctrl+Shift+G / Cmd+Shift+G
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g" && e.shiftKey) {
      e.preventDefault();
      this.editor.ungroupSelection();
      return;
    }

    // Undo: Ctrl+Z or Cmd+Z
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      this.editor.undo();
      return;
    }

    // Redo: Ctrl+Shift+Z, Cmd+Shift+Z, or Ctrl+Y
    if (
      ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z") ||
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y")
    ) {
      e.preventDefault();
      this.editor.redo();
      return;
    }

    // Select All: Ctrl+A / Cmd+A
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      this.editor.selectAll();
      return;
    }

    // Duplicate Selection: Ctrl+D / Cmd+D
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      this.editor.duplicateSelection();
      return;
    }

    // Copy: Ctrl+C / Cmd+C
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      this.editor.copySelection();
      return;
    }

    // Paste: Ctrl+V / Cmd+V
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      this.editor.paste();
      return;
    }

    // Arrow keys nudge selected nodes
    if (
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight"
    ) {
      if (this.editor.selectedNodeIds.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 20 : 5;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const moves: Array<{ nodeId: string; oldPos: Point; newPos: Point }> = [];
        for (const id of this.editor.selectedNodeIds) {
          const node = this.editor.diagram.nodes.find((n) => n.id === id);
          if (node && !this.editor.isNodeLocked(node.id)) {
            moves.push({
              nodeId: id,
              oldPos: { ...node.position },
              newPos: { x: node.position.x + dx, y: node.position.y + dy },
            });
          }
        }
        if (moves.length > 0) {
          this.editor.moveNodes(moves);
        }
        return;
      }
    }

    // Escape: exit freehand mode or deselect
    if (e.key === "Escape") {
      if (this.isFreehandMode) {
        e.preventDefault();
        this.setFreehandMode(false);
        return;
      }
      if (
        this.editor.selectedNodeIds.length > 0 ||
        this.editor.selectedEdgeIds.length > 0 ||
        this.editor.selectedGroupIds.length > 0
      ) {
        e.preventDefault();
        this.editor.clearSelection();
        return;
      }
    }

    // Select tool shortcut: V
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "v") {
      if (this.isFreehandMode) {
        e.preventDefault();
        this.setFreehandMode(false);
        return;
      }
    }

    // Draw tool shortcut: P
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "p" && this.enableFreehand) {
      if (!this.isFreehandMode) {
        e.preventDefault();
        this.setFreehandMode(true);
        return;
      }
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (e.code === "Space") {
      this.isSpacePressed = false;
      this.container.classList.remove("umlcanvas-space-pressed");
    }
  }

  destroy(): void {
    this.cleanupInlineEditor();

    this.container.classList.remove("umlcanvas-moving");
    this.container.classList.remove("umlcanvas-freehand-mode");
    this.container.classList.remove("umlcanvas-space-pressed");
    this.container.classList.remove("umlcanvas-panning");

    this.svgEl.removeEventListener("wheel", this.onWheelBound);
    this.svgEl.removeEventListener("mousedown", this.onMouseDownBound);
    window.removeEventListener("mousemove", this.onMouseMoveBound);
    window.removeEventListener("mouseup", this.onMouseUpBound);
    window.removeEventListener("keydown", this.onKeyDownBound);
    window.removeEventListener("keyup", this.onKeyUpBound);
    this.svgEl.removeEventListener("dblclick", this.onDblClickBound);
    this.svgEl.removeEventListener("contextmenu", this.onContextMenuBound);
    this.svgEl.removeEventListener("dragover", this.onDragOverBound);
    this.svgEl.removeEventListener("drop", this.onDropBound);

    if (this.unsubscribeEditor) {
      this.unsubscribeEditor();
      this.unsubscribeEditor = null;
    }

    this.markerTemplates.clear();
    this.createdMarkerIds.clear();

    this.svgEl.remove();
  }
}
