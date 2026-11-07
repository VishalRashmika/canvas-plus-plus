import { DiagramEditor } from "../../application/use-cases/DiagramEditor";
import { getDescendantGroups } from "../../application/commands/DiagramCommands";
import { DiagramNode } from "../../domain/entities/DiagramNode";
import { DiagramEdge, EdgeStyle } from "../../domain/entities/DiagramEdge";
import { Group } from "../../domain/entities/Group";
import { Point, point } from "../../domain/value-objects/Point";
import { Rect, Size, rect, rectFromBounds, intersects, contains, center } from "../../domain/value-objects/Rect";
import { Side } from "../../domain/types";
import { ShapeRegistry, defaultShapeRegistry, getTableDataFromNode, safeCreateEl, safeCreateDiv } from "./ShapeRegistry";
import {
  estimateMarkdownContentHeight,
  wrapTextToLines,
} from "../../domain/services/TextMeasurement";
import {
  ViewportTransform,
  screenToCanvas,
  canvasToScreen,
  zoomAtPoint,
  clampZoom,
} from "./ViewportMath";
import { getSidePoint, getRectCenter, getFacingSide } from "./ConnectorGeometry";
import { defaultRoutingService, RoutingResult } from "../../domain/services/RoutingService";
import { defaultSnappingService, AlignmentGuides } from "../../domain/services/SnappingService";
import { defaultEdgeStyleRegistry, EdgeStyleDefinition } from "./EdgeStyleRegistry";
import {
  ArrowAttachmentPopup,
  ArrowAttachmentItem,
  DEFAULT_ATTACHMENT_ITEMS,
} from "../views/ArrowAttachmentPopup";

export interface ArrowAttachmentContext {
  fromNodeId: string;
  fromPortId?: string;
  fromSide?: Side;
  dropCanvasPoint: Point;
  dropClientPoint: Point;
  startPoint: Point;
}
import { Stroke, StrokePoint } from "../../domain/services/ShapeRecognizer";
import { pointsToSmoothSvgPath, smoothPoints } from "../../domain/services/FreehandSmoother";
import { resolveCanvasColor, isCanvasColorPreset } from "../../domain/value-objects/CanvasColor";
import { defaultCustomChipRegistry } from "../../domain/services/CustomChipRegistry";
import {
  applyFontToSvgElement,
  getNodeFontStyle,
  getEdgeFontStyle,
  getGroupFontStyle,
} from "../theme/Typography";

interface HandledMouseEvent extends MouseEvent {
  _umlHandled?: boolean;
}

export interface SvgSceneRendererOptions {
  shapeRegistry?: ShapeRegistry;
  showGrid?: boolean;
  initialTransform?: ViewportTransform;
  onTransformChange?: (transform: ViewportTransform) => void;
  onStrokeComplete?: (stroke: Stroke, options?: { autoDetect?: boolean; handwritingText?: boolean }) => void;
  enableVirtualization?: boolean;
  virtualizationThreshold?: number;
  enableFreehand?: boolean;
  autoShapeDetection?: boolean;
  onModeChange?: (mode: "select" | "draw" | "grab" | "handwrite") => void;
  onContextMenu?: (
    e: MouseEvent,
    canvasPoint: Point,
    node?: DiagramNode,
    edge?: DiagramEdge,
    group?: Group
  ) => void;
  onNoteOpen?: (filePath: string) => void;
  onPdfPick?: (node: DiagramNode) => void;
  onPdfChangePage?: (node: DiagramNode) => void;
  onChipEdit?: (node: DiagramNode) => void;
  onPasteRequested?: (canvasPoint?: Point) => void;
  onExternalDrop?: (e: DragEvent, canvasPoint: Point) => boolean | Promise<boolean> | void;
  onRenderMarkdown?: (
    markdown: string,
    el: HTMLElement,
    sourcePath: string
  ) => Promise<void> | void;
  onOpenVaultNote?: (callback: (noteFile: VaultFileLike) => void) => void;
  onOpenVaultImage?: (callback: (imageFileOrUrl: VaultImageLike | string) => void) => void;
}

export interface VaultFileLike {
  path: string;
  name?: string;
  basename?: string;
  extension?: string;
}

export interface VaultImageLike {
  path?: string;
  src?: string;
  name?: string;
  basename?: string;
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
      wasAlreadySingleSelected?: boolean;
      clickedNodeId?: string;
      clickedCell?: { row: number; col: number };
    }
  | {
      type: "group-move";
      groupId: string;
      startClient: Point;
      initialGroupPos?: Point;
      initialGroupPositions?: Map<string, Point>;
      initialMemberPositions: Map<string, Point>;
      moved: boolean;
      wasAlreadySingleSelected?: boolean;
      isTitleClick?: boolean;
    }
  | {
      type: "resize";
      nodeId: string;
      handle: string;
      startClient: Point;
      initialPosition: Point;
      initialSize: Size;
      initialPoints?: Point[];
      initialPathData?: string;
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
      originalWaypointsBeforeInsert?: Point[];
    }
  | {
      type: "edge-move";
      edgeId: string;
      startClient: Point;
      startCanvas: Point;
      initialWaypointsMap: Map<string, Point[] | undefined>;
      moved: boolean;
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
  private bgRectEl!: SVGRectElement;
  private gridRectEl: SVGRectElement;
  private groupsLayerEl: SVGGElement;
  private edgesLayerEl: SVGGElement;
  private nodesLayerEl: SVGGElement;
  private interactionLayerEl: SVGGElement;
  private inlineEditorEl: HTMLInputElement | HTMLTextAreaElement | null = null;
  private editingNodeId: string | null = null;
  private editingGroupId: string | null = null;
  private editingCellRow?: number;
  private editingCellCol?: number;
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
  private onStrokeComplete?: (stroke: Stroke, options?: { autoDetect?: boolean; handwritingText?: boolean }) => void;

  private isFreehandMode = false;
  private autoShapeDetection = true;
  private handwritingTextMode = false;
  private activeStroke: Stroke | null = null;
  private freehandPathEl: SVGPathElement | null = null;
  private cachedContainerRect: { left: number; top: number; width: number; height: number } | null = null;
  private enableVirtualization: boolean;
  private virtualizationThreshold: number;
  private enableFreehand: boolean;
  private onModeChange?: (mode: "select" | "draw" | "grab" | "handwrite") => void;

  private isGrabMode = false;

  private dragMode: DragMode = { type: "none" };
  private isSpacePressed = false;
  private unsubscribeEditor: (() => void) | null = null;
  private hoveredTableNodeId?: string;
  private lastTableButtonActionTime = 0;

  // High-performance retained DOM maps and route cache
  private nodeElements = new Map<string, SVGGElement>();
  private nodeSignatures = new Map<string, string>();
  private edgeElements = new Map<string, SVGGElement>();
  private edgeSignatures = new Map<string, string>();
  private edgeRouteCache = new Map<string, { key: string; result: RoutingResult }>();
  private groupElements = new Map<string, SVGGElement>();
  private groupSignatures = new Map<string, string>();
  private lastVirtualizationCenter: Point | null = null;
  private onWindowResizeBound: () => void;

  // Bound event listeners for cleanup
  private onWheelBound: (e: WheelEvent) => void;
  private onMouseDownBound: (e: MouseEvent) => void;
  private onMouseMoveBound: (e: MouseEvent) => void;
  private onMouseUpBound: (e: MouseEvent) => void;
  private onMouseLeaveBound: (e: MouseEvent) => void;
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
  private onPdfPick?: (node: DiagramNode) => void;
  private onPdfChangePage?: (node: DiagramNode) => void;
  private onChipEdit?: (node: DiagramNode) => void;
  private onPasteRequested?: (canvasPoint?: Point) => void;
  private onExternalDrop?: (e: DragEvent, canvasPoint: Point) => boolean | Promise<boolean> | void;
  private lastMouseCanvasPos: Point | null = null;
  private onRenderMarkdown?: (
    markdown: string,
    el: HTMLElement,
    sourcePath: string
  ) => Promise<void> | void;
  private arrowAttachmentPopup: ArrowAttachmentPopup | null = null;
  private arrowAttachmentState: ArrowAttachmentContext | null = null;
  private onOpenVaultNote?: (callback: (noteFile: VaultFileLike) => void) => void;
  private onOpenVaultImage?: (callback: (imageFileOrUrl: VaultImageLike | string) => void) => void;

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
    this.autoShapeDetection = options?.autoShapeDetection ?? true;
    this.enableVirtualization = options?.enableVirtualization ?? false;
    this.virtualizationThreshold = options?.virtualizationThreshold ?? 200;
    this.enableFreehand = options?.enableFreehand ?? true;
    this.onModeChange = options?.onModeChange;
    this.onContextMenu = options?.onContextMenu;
    this.onNoteOpen = options?.onNoteOpen;
    this.onPdfPick = options?.onPdfPick;
    this.onPdfChangePage = options?.onPdfChangePage;
    this.onChipEdit = options?.onChipEdit;
    this.onOpenVaultNote = options?.onOpenVaultNote;
    this.onOpenVaultImage = options?.onOpenVaultImage;
    this.onPasteRequested = options?.onPasteRequested;
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

    this.bgRectEl = document.createElementNS(svgNS, "rect");
    this.bgRectEl.setAttribute("class", "umlcanvas-bg");
    this.bgRectEl.setAttribute("width", "100%");
    this.bgRectEl.setAttribute("height", "100%");
    this.bgRectEl.setAttribute("fill", "transparent");
    this.bgRectEl.setAttribute("pointer-events", "all");
    this.svgEl.appendChild(this.bgRectEl);

    this.gridRectEl = document.createElementNS(svgNS, "rect");
    this.gridRectEl.setAttribute("class", "umlcanvas-grid-bg");
    this.gridRectEl.setAttribute("width", "100%");
    this.gridRectEl.setAttribute("height", "100%");
    this.gridRectEl.setAttribute("fill", "url(#umlcanvas-grid-pattern)");
    this.gridRectEl.setAttribute("pointer-events", "none");
    if (!this.showGrid) {
      this.gridRectEl.classList.add("is-hidden");
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
    this.onMouseLeaveBound = this.handleMouseLeave.bind(this);
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
      const clientPoint = this.getClientCoords(e);
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
          title: shapeDef.defaultTitle ?? shapeDef.displayName,
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
          title: shapeDef.defaultTitle ?? shapeDef.displayName,
        });
        this.editor.selectNode(node.id, false);
      }
    };

    this.svgEl.addEventListener("wheel", this.onWheelBound, { passive: false });
    this.svgEl.addEventListener("mousedown", this.onMouseDownBound);
    this.container.addEventListener("mousedown", this.onMouseDownBound);
    window.addEventListener("mousemove", this.onMouseMoveBound);
    window.addEventListener("mouseup", this.onMouseUpBound);
    window.addEventListener("keydown", this.onKeyDownBound);
    window.addEventListener("keyup", this.onKeyUpBound);
    this.svgEl.addEventListener("dblclick", this.onDblClickBound);
    this.svgEl.addEventListener("contextmenu", this.onContextMenuBound);
    this.svgEl.addEventListener("dragover", this.onDragOverBound);
    this.svgEl.addEventListener("drop", this.onDropBound);
    this.svgEl.addEventListener("mouseleave", this.onMouseLeaveBound);

    this.onWindowResizeBound = () => {
      this.cachedContainerRect = null;
    };
    window.addEventListener("resize", this.onWindowResizeBound);

    this.unsubscribeEditor = this.editor.subscribe(() => {
      this.render();
    });

    this.updateViewportTransform();
    this.render();
  }

  private renderScheduled = false;
  private animationFrameId: number | null = null;

  /**
   * Schedules a render on the next animation frame, coalescing rapid state mutations
   * to ensure 60-120fps buttery smooth performance without redundant DOM diffing.
   */
  public scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      this.animationFrameId = window.requestAnimationFrame(() => {
        this.renderScheduled = false;
        this.animationFrameId = null;
        this.render();
      });
    } else {
      queueMicrotask(() => {
        this.renderScheduled = false;
        this.render();
      });
    }
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
      const last = this.lastVirtualizationCenter;
      const dx = last ? Math.abs(this.transform.panX - last.x) : Infinity;
      const dy = last ? Math.abs(this.transform.panY - last.y) : Infinity;
      if (dx > 120 || dy > 120) {
        this.lastVirtualizationCenter = { x: this.transform.panX, y: this.transform.panY };
        this.render();
      }
    }
  }

  public getVisibleCanvasRect(margin = 200): Rect {
    const width =
      this.container.clientWidth ||
      this.cachedContainerRect?.width ||
      (typeof this.container.getBoundingClientRect === "function"
        ? this.container.getBoundingClientRect().width
        : 0) ||
      800;
    const height =
      this.container.clientHeight ||
      this.cachedContainerRect?.height ||
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
    this.gridRectEl.classList.toggle("is-hidden", !visible);
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
    if (active && this.isGrabMode) {
      this.isGrabMode = false;
      this.container.classList.remove("umlcanvas-grab-mode");
    }
    if (active && this.editor.hasSelection) {
      this.editor.clearSelection();
    }
    this.isFreehandMode = active;
    if (!active) {
      this.handwritingTextMode = false;
    }
    if (active) {
      this.container.classList.add("umlcanvas-freehand-mode");
    } else {
      this.container.classList.remove("umlcanvas-freehand-mode");
    }
    this.onModeChange?.(
      active
        ? this.handwritingTextMode
          ? "handwrite"
          : "draw"
        : this.isGrabMode
        ? "grab"
        : "select"
    );
  }

  get freehandMode(): boolean {
    return this.isFreehandMode;
  }

  setGrabMode(active: boolean): void {
    if (active && this.isFreehandMode) {
      this.isFreehandMode = false;
      this.handwritingTextMode = false;
      this.container.classList.remove("umlcanvas-freehand-mode");
    }
    this.isGrabMode = active;
    if (active) {
      this.container.classList.add("umlcanvas-grab-mode");
    } else {
      this.container.classList.remove("umlcanvas-grab-mode");
    }
    this.onModeChange?.(
      active
        ? "grab"
        : this.isFreehandMode
        ? this.handwritingTextMode
          ? "handwrite"
          : "draw"
        : "select"
    );
  }

  get grabMode(): boolean {
    return this.isGrabMode;
  }

  setAutoShapeDetection(active: boolean): void {
    this.autoShapeDetection = active;
    if (active) {
      this.handwritingTextMode = false;
      if (this.isGrabMode) {
        this.isGrabMode = false;
        this.container.classList.remove("umlcanvas-grab-mode");
      }
    }
    this.onModeChange?.(
      this.isGrabMode
        ? "grab"
        : this.isFreehandMode
        ? this.handwritingTextMode
          ? "handwrite"
          : "draw"
        : "select"
    );
  }

  get isAutoShapeDetection(): boolean {
    return this.autoShapeDetection;
  }

  setHandwritingTextMode(active: boolean): void {
    this.handwritingTextMode = active;
    if (active) {
      this.autoShapeDetection = false;
      if (this.isGrabMode) {
        this.isGrabMode = false;
        this.container.classList.remove("umlcanvas-grab-mode");
      }
    }
    this.onModeChange?.(
      this.isGrabMode
        ? "grab"
        : this.isFreehandMode
        ? this.handwritingTextMode
          ? "handwrite"
          : "draw"
        : "select"
    );
  }

  get isHandwritingTextMode(): boolean {
    return this.handwritingTextMode;
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
    this.defsEl = document.createElementNS(svgNS, "defs");
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
      p.setAttribute("stroke-width", "1.5");
      p.setAttribute("stroke-linejoin", "round");
      p.setAttribute("stroke-linecap", "round");
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
      viewBox: "0 0 10 10",
      refX: "10",
      refY: "5",
      width: "8",
      height: "8",
      className: "umlcanvas-marker-triangle-hollow",
      fill: "var(--background-primary)",
      stroke: "currentColor",
    });

    // 4. Hollow diamond (aggregation)
    registerMarker("uml-marker-diamond-hollow", "M 0 5 L 6 1 L 12 5 L 6 9 Z", {
      viewBox: "0 0 12 10",
      refX: "12",
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
      refX: "12",
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

    // 8. Hollow circle (interface lollipop / socket / mapping)
    registerMarker("uml-marker-circle-hollow", "M 1 5 A 4 4 0 1 1 9 5 A 4 4 0 1 1 1 5 Z", {
      viewBox: "0 0 10 10",
      refX: "9",
      refY: "5",
      width: "8",
      height: "8",
      className: "umlcanvas-marker-circle-hollow",
      fill: "var(--background-primary)",
      stroke: "currentColor",
    });

    // 9. Filled circle (junction / dot endpoint)
    registerMarker("uml-marker-circle-filled", "M 1 5 A 4 4 0 1 1 9 5 A 4 4 0 1 1 1 5 Z", {
      viewBox: "0 0 10 10",
      refX: "9",
      refY: "5",
      width: "8",
      height: "8",
      className: "umlcanvas-marker-circle-filled",
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
    p.setAttribute("stroke-width", "1.5");
    p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("stroke-linecap", "round");

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

  private normalizeMarkerId(markerId?: string): string | undefined {
    if (!markerId || markerId === "none") return undefined;
    if (markerId.startsWith("uml-marker-")) return markerId;
    switch (markerId) {
      case "arrow-open":
      case "open-arrow":
        return "uml-marker-open-arrow";
      case "arrow-filled":
      case "arrow":
      case "arrow-head":
        return "uml-marker-arrow-head";
      case "triangle-hollow":
      case "triangle":
      case "hollow-triangle":
        return "uml-marker-triangle-hollow";
      case "triangle-filled":
      case "filled-triangle":
        return "uml-marker-triangle-filled";
      case "diamond-hollow":
      case "diamond":
      case "hollow-diamond":
        return "uml-marker-diamond-hollow";
      case "diamond-filled":
      case "filled-diamond":
        return "uml-marker-diamond-filled";
      case "circle-hollow":
      case "circle":
      case "hollow-circle":
        return "uml-marker-circle-hollow";
      case "circle-filled":
      case "filled-circle":
      case "dot":
        return "uml-marker-circle-filled";
      case "stop":
      case "timing-stop":
        return "uml-marker-timing-stop";
      default:
        return markerId;
    }
  }

  private resolveStrokeDasharray(
    edgeStyle?: EdgeStyle,
    styleDef?: EdgeStyleDefinition
  ): string | undefined {
    if (edgeStyle?.strokeDasharray !== undefined && edgeStyle.strokeDasharray !== "") {
      if (edgeStyle.strokeDasharray === "solid" || edgeStyle.strokeDasharray === "none") {
        return undefined;
      }
      return edgeStyle.strokeDasharray;
    }

    if (edgeStyle?.lineType !== undefined) {
      switch (edgeStyle.lineType) {
        case "solid":
          return undefined;
        case "dashed":
          return "6 4";
        case "dotted":
          return "2 3";
        case "dash-dot":
          return "8 3 2 3";
        case "long-dash":
          return "12 4";
      }
    }

    if (edgeStyle?.dashed !== undefined) {
      return edgeStyle.dashed ? "6 4" : undefined;
    }

    return styleDef?.strokeDasharray;
  }

  private updateViewportTransform(): void {
    this.viewportEl.setAttribute(
      "transform",
      `translate(${this.transform.panX}, ${this.transform.panY}) scale(${this.transform.zoom})`
    );
    if (this.inlineEditorEl) {
      this.updateInlineEditorPosition();
    }
    if (this.onTransformChange) {
      this.onTransformChange(this.transform);
    }
  }

  // --- Rendering ---

  render(): void {
    if (
      this.animationFrameId !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.renderScheduled = false;

    this.renderGroups();
    this.renderEdges();
    this.renderNodes();
    this.renderInteractions();
    if (this.inlineEditorEl) {
      this.updateInlineEditorPosition();
    }
  }

  public getGroupBounds(group: Group): Rect {
    return this.editor.getGroupBounds(group);
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

    const visibleRect = this.isVirtualizationActive()
      ? this.getVisibleCanvasRect()
      : null;

    const diagramGroupMap = new Map<string, Group>(
      this.editor.diagram.groups.map((g) => [g.id, g])
    );

    const existingChildren = Array.from(this.groupsLayerEl.children ?? []) as SVGGElement[];
    const domGroupMap = new Map<string, SVGGElement>();
    for (const child of existingChildren) {
      const groupId = child.getAttribute("data-group-id");
      if (groupId) {
        domGroupMap.set(groupId, child);
        if (!this.groupElements.has(groupId)) {
          this.groupElements.set(groupId, child);
        }
      } else {
        this.safeRemove(child);
      }
    }

    for (const [groupId, childEl] of domGroupMap.entries()) {
      const grp = diagramGroupMap.get(groupId);
      if (!grp) {
        this.safeRemove(childEl);
        this.groupElements.delete(groupId);
        this.groupSignatures.delete(groupId);
      }
    }

    const sortedGroups = [...this.editor.diagram.groups].sort((a, b) => {
      const boundsA = this.getGroupBounds(a);
      const boundsB = this.getGroupBounds(b);
      const areaA = boundsA.size.width * boundsA.size.height;
      const areaB = boundsB.size.width * boundsB.size.height;
      return areaB - areaA;
    });

    for (const group of sortedGroups) {
      const bounds = this.getGroupBounds(group);
      const gx = bounds.position.x;
      const gy = bounds.position.y;
      const gw = bounds.size.width;
      const gh = bounds.size.height;

      if (
        visibleRect &&
        !intersects(visibleRect, bounds)
      ) {
        const existingEl = this.groupElements.get(group.id);
        if (existingEl) {
          this.safeRemove(existingEl);
          this.groupElements.delete(group.id);
          this.groupSignatures.delete(group.id);
        }
        continue;
      }

      const isSelected = this.editor.isGroupSelected(group.id);
      const isCollapsed = group.collapsed;
      const isLocked = group.locked ?? false;
      const groupSignature = `${gx},${gy},${gw},${gh}|${group.name ?? ""}|${group.color ?? ""}|${isSelected}|${isCollapsed}|${isLocked}|${this.editingGroupId === group.id}|${group.nodeIds.length}`;

      const existingEl = this.groupElements.get(group.id);
      const previousSignature = this.groupSignatures.get(group.id);

      if (existingEl && (existingEl.parentElement as unknown) === this.groupsLayerEl && groupSignature === previousSignature) {
        continue;
      }

      const groupEl = this.renderGroupElement(group, bounds, svgNS);
      this.replaceOrAppend(this.groupsLayerEl, groupEl, existingEl);
      this.groupElements.set(group.id, groupEl);
      this.groupSignatures.set(group.id, groupSignature);
    }
  }

  private renderGroupElement(group: Group, bounds: Rect, svgNS: string): SVGGElement {
    const gx = bounds.position.x;
    const gy = bounds.position.y;
    const gw = bounds.size.width;
    const gh = bounds.size.height;
    const isSelected = this.editor.isGroupSelected(group.id);
    const isCollapsed = group.collapsed;
    const isLocked = group.locked ?? false;

    const groupEl = document.createElementNS(svgNS, "g") as SVGGElement;
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
    if (this.editingGroupId === group.id) {
      groupEl.classList.add("umlcanvas-group-editing");
    }

    if (group.color) {
      groupEl.setAttribute("data-color", group.color);
      const resolvedColor = resolveCanvasColor(group.color);
      if (resolvedColor) {
        const styledEl = groupEl as unknown as HTMLElement;
        if (typeof (groupEl as { setCssProps?: (props: Record<string, string>) => void }).setCssProps === "function") {
          (groupEl as { setCssProps: (props: Record<string, string>) => void }).setCssProps({ "--canvas-color": resolvedColor });
        }
        if (styledEl.style && typeof styledEl.style.setProperty === "function") {
          styledEl.style.setProperty("--canvas-color", resolvedColor);
        } else if (styledEl.style) {
          styledEl.style["--canvas-color" as unknown as number] = resolvedColor;
        }
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

      const groupFont = getGroupFontStyle(group);
      const badgeFontSize = groupFont.fontSize ? Math.max(8, Math.round(groupFont.fontSize * 0.85)) : undefined;

      const title = document.createElementNS(svgNS, "text");
      title.setAttribute("x", String(gx + 26));
      title.setAttribute("y", String(gy + 22));
      title.setAttribute("class", "umlcanvas-group-title");
      title.setAttribute("data-group-id", group.id);
      title.textContent = group.name;
      applyFontToSvgElement(title as SVGElement, groupFont);
      groupEl.appendChild(title);

      const badge = document.createElementNS(svgNS, "text");
      badge.setAttribute("x", String(gx + cardW - 28));
      badge.setAttribute("y", String(gy + 22));
      badge.setAttribute("text-anchor", "end");
      badge.setAttribute("class", "umlcanvas-group-badge");
      badge.textContent = `(${group.nodeIds.length})`;
      applyFontToSvgElement(badge as SVGElement, { ...groupFont, fontSize: badgeFontSize, bold: false });
      groupEl.appendChild(badge);

      const colorDot = document.createElementNS(svgNS, "circle");
      colorDot.setAttribute("cx", String(gx + cardW - 14));
      colorDot.setAttribute("cy", String(gy + 17));
      colorDot.setAttribute("r", "5");
      colorDot.setAttribute("class", "umlcanvas-group-color-dot");
      colorDot.setAttribute("data-group-id", group.id);
      const resolvedCollapsedDotColor = group.color ? (resolveCanvasColor(group.color) ?? group.color) : "var(--interactive-accent)";
      colorDot.setAttribute("fill", resolvedCollapsedDotColor);
      groupEl.appendChild(colorDot);
    } else {
      const rectEl = document.createElementNS(svgNS, "rect");
      rectEl.setAttribute("x", String(gx));
      rectEl.setAttribute("y", String(gy));
      rectEl.setAttribute("width", String(gw));
      rectEl.setAttribute("height", String(gh));
      rectEl.setAttribute("rx", "6");
      rectEl.setAttribute("ry", "6");
      rectEl.setAttribute("class", "umlcanvas-group-box");
      rectEl.setAttribute("pointer-events", "stroke");
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

      const groupFont = getGroupFontStyle(group);
      const badgeFontSize = groupFont.fontSize ? Math.max(8, Math.round(groupFont.fontSize * 0.85)) : undefined;

      const title = document.createElementNS(svgNS, "text");
      title.setAttribute("x", String(gx + 26));
      title.setAttribute("y", String(gy + 18));
      title.setAttribute("class", "umlcanvas-group-title");
      title.setAttribute("data-group-id", group.id);
      title.textContent = group.name;
      applyFontToSvgElement(title as SVGElement, groupFont);
      groupEl.appendChild(title);

      const badge = document.createElementNS(svgNS, "text");
      badge.setAttribute("x", String(gx + gw - 32));
      badge.setAttribute("y", String(gy + 18));
      badge.setAttribute("text-anchor", "end");
      badge.setAttribute("class", "umlcanvas-group-badge");
      badge.textContent = `${group.nodeIds.length} items`;
      applyFontToSvgElement(badge as SVGElement, { ...groupFont, fontSize: badgeFontSize, bold: false });
      groupEl.appendChild(badge);

      const colorDot = document.createElementNS(svgNS, "circle");
      colorDot.setAttribute("cx", String(gx + gw - 16));
      colorDot.setAttribute("cy", String(gy + 14));
      colorDot.setAttribute("r", "5");
      colorDot.setAttribute("class", "umlcanvas-group-color-dot");
      colorDot.setAttribute("data-group-id", group.id);
      const resolvedExpandedDotColor = group.color ? (resolveCanvasColor(group.color) ?? group.color) : "var(--interactive-accent)";
      colorDot.setAttribute("fill", resolvedExpandedDotColor);
      groupEl.appendChild(colorDot);

      if (isLocked) {
        const lockIcon = document.createElementNS(svgNS, "text");
        lockIcon.setAttribute("x", String(gx + gw - 84));
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

    return groupEl;
  }

  private renderEdges(): void {
    const svgNS = "http://www.w3.org/2000/svg";

    const visibleNodes = this.editor.diagram.nodes.filter((n) =>
      this.editor.isNodeVisible(n.id)
    );
    const nodeMap = new Map<string, DiagramNode>(
      visibleNodes.map((n) => [n.id, n])
    );

    const visibleRect = this.isVirtualizationActive()
      ? this.getVisibleCanvasRect()
      : null;

    const diagramEdgeMap = new Map<string, DiagramEdge>(
      this.editor.diagram.edges.map((e) => [e.id, e])
    );

    const existingChildren = Array.from(this.edgesLayerEl.children ?? []) as SVGGElement[];
    const domEdgeMap = new Map<string, SVGGElement>();
    for (const child of existingChildren) {
      const edgeId = child.getAttribute("data-edge-id");
      if (edgeId) {
        domEdgeMap.set(edgeId, child);
        if (!this.edgeElements.has(edgeId)) {
          this.edgeElements.set(edgeId, child);
        }
      } else {
        this.safeRemove(child);
      }
    }

    // Clean up DOM: Remove edges that no longer exist in the diagram
    for (const [edgeId, childEl] of domEdgeMap.entries()) {
      const edge = diagramEdgeMap.get(edgeId);
      if (!edge) {
        this.safeRemove(childEl);
        this.edgeElements.delete(edgeId);
        this.edgeSignatures.delete(edgeId);
        this.edgeRouteCache.delete(edgeId);
      }
    }

    for (const edge of this.editor.diagram.edges) {
      const fromNode = nodeMap.get(edge.fromNodeId);
      const toNode = edge.toNodeId ? nodeMap.get(edge.toNodeId) : undefined;
      if (!fromNode || (!toNode && !edge.toPoint)) {
        const existingEl = this.edgeElements.get(edge.id);
        if (existingEl) {
          this.safeRemove(existingEl);
          this.edgeElements.delete(edge.id);
          this.edgeSignatures.delete(edge.id);
          this.edgeRouteCache.delete(edge.id);
        }
        continue;
      }

      const targetX = toNode ? toNode.position.x : edge.toPoint!.x;
      const targetY = toNode ? toNode.position.y : edge.toPoint!.y;
      const targetW = toNode ? toNode.size.width : 0;
      const targetH = toNode ? toNode.size.height : 0;

      if (visibleRect) {
        const minX = Math.min(fromNode.position.x, targetX);
        const minY = Math.min(fromNode.position.y, targetY);
        const maxX = Math.max(
          fromNode.position.x + fromNode.size.width,
          targetX + targetW
        );
        const maxY = Math.max(
          fromNode.position.y + fromNode.size.height,
          targetY + targetH
        );
        const edgeBounds = rectFromBounds(minX, minY, maxX - minX, maxY - minY);
        if (!intersects(visibleRect, edgeBounds)) {
          const existingEl = this.edgeElements.get(edge.id);
          if (existingEl) {
            this.safeRemove(existingEl);
            this.edgeElements.delete(edge.id);
            this.edgeSignatures.delete(edge.id);
          }
          continue;
        }
      }

      const fromPort = fromNode.ports?.find((p) => p.id === edge.fromPortId);
      const toPort = toNode?.ports?.find((p) => p.id === edge.toPortId);

      const fromSide = fromPort?.side ?? edge.fromSide;
      const toSide = toPort?.side ?? edge.toSide;

      const targetBoundary = toNode
        ? {
            id: toNode.id,
            position: toNode.position,
            size: toNode.size,
            side: toSide,
            portOffset: toPort?.offset,
            kind: toNode.kind,
          }
        : {
            position: edge.toPoint!,
            size: { width: 0, height: 0 },
            side: toSide,
          };

      const routeKey = `${fromNode.id}:${fromNode.position.x},${fromNode.position.y},${fromNode.size.width},${fromNode.size.height},${fromSide},${fromPort?.offset}|${toNode?.id ?? "pt"}:${targetX},${targetY},${targetW},${targetH},${toSide},${toPort?.offset}|${edge.routing}|${JSON.stringify(edge.waypoints)}`;

      let routingResult: RoutingResult;
      const cached = this.edgeRouteCache.get(edge.id);
      if (cached && cached.key === routeKey) {
        routingResult = cached.result;
      } else {
        routingResult = defaultRoutingService.route(
          {
            id: fromNode.id,
            position: fromNode.position,
            size: fromNode.size,
            side: fromSide,
            portOffset: fromPort?.offset,
            kind: fromNode.kind,
          },
          targetBoundary,
          {
            routing: edge.routing,
            obstacles: visibleNodes,
            manualWaypoints: edge.waypoints,
          }
        );
        this.edgeRouteCache.set(edge.id, { key: routeKey, result: routingResult });
      }

      const isSelected = this.editor.isEdgeSelected(edge.id);
      const displayLabel =
        edge.labels && edge.labels.length > 0
          ? edge.labels[0].text
          : undefined;
      const edgeSignature = `${routeKey}|${edge.kind}|${JSON.stringify(edge.style)}|${displayLabel}|${edge.multiplicitySource ?? ""}|${edge.multiplicityTarget ?? ""}|${isSelected}`;

      const existingEl = this.edgeElements.get(edge.id);
      const previousSignature = this.edgeSignatures.get(edge.id);

      if (existingEl && (existingEl.parentElement as unknown) === this.edgesLayerEl && edgeSignature === previousSignature) {
        continue;
      }

      const edgeGroup = this.renderEdgeGroup(edge, routingResult, svgNS);
      this.replaceOrAppend(this.edgesLayerEl, edgeGroup, existingEl);
      this.edgeElements.set(edge.id, edgeGroup);
      this.edgeSignatures.set(edge.id, edgeSignature);
    }
  }

  private renderEdgeGroup(
    edge: DiagramEdge,
    routingResult: RoutingResult,
    svgNS: string
  ): SVGGElement {
    const edgeGroup = document.createElementNS(svgNS, "g") as SVGGElement;
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

    let rawMarkerEndId: string | undefined;
    if (edge.style?.markerEnd !== undefined) {
      rawMarkerEndId =
        edge.style.markerEnd === "none" || !edge.style.markerEnd
          ? undefined
          : this.normalizeMarkerId(edge.style.markerEnd);
    } else {
      rawMarkerEndId = styleDef.markerEndId;
    }

    let rawMarkerStartId: string | undefined;
    if (edge.style?.markerStart !== undefined) {
      rawMarkerStartId =
        edge.style.markerStart === "none" || !edge.style.markerStart
          ? undefined
          : this.normalizeMarkerId(edge.style.markerStart);
    } else {
      rawMarkerStartId = styleDef.markerStartId;
    }

    let markerEndId = rawMarkerEndId;
    let markerStartId = rawMarkerStartId;

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

    const strokeDasharray = this.resolveStrokeDasharray(edge.style, styleDef);
    if (strokeDasharray) {
      path.setAttribute("stroke-dasharray", strokeDasharray);
    }
    if (edge.style?.color) {
      edgeGroup.setAttribute("data-color", edge.style.color);
      const resolvedColor = resolveCanvasColor(edge.style.color);
      if (resolvedColor) {
        edgeGroup.setCssProps({ "--canvas-color": resolvedColor, color: resolvedColor });
        path.setAttribute("stroke", resolvedColor);
      }
      if (isCanvasColorPreset(edge.style.color)) {
        edgeGroup.classList.add(`is-color-${edge.style.color}`);
      } else {
        edgeGroup.classList.add("has-custom-color");
      }
    } else if (edge.style?.strokeColor) {
      path.setAttribute("stroke", edge.style.strokeColor);
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

      const edgeFont = getEdgeFontStyle(edge);
      const fontSize = edgeFont.fontSize ?? 11;
      const padX = 6;
      const textLen = displayLabel.length;
      const charWidth = fontSize * 0.6;
      const bgWidth = Math.max(24, Math.round(textLen * charWidth + padX * 2));
      const bgHeight = Math.max(18, Math.round(fontSize * 1.5));

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
      applyFontToSvgElement(text as SVGElement, edgeFont);
      labelGroup.appendChild(text);

      edgeGroup.appendChild(labelGroup);
    }

    // Multiplicity annotations (F-034)
    if (routingResult.points.length >= 2) {
      const startPt = routingResult.points[0];
      const secondPt = routingResult.points[1];
      const endPt = routingResult.points[routingResult.points.length - 1];
      const beforeEndPt = routingResult.points[routingResult.points.length - 2];
      const edgeFont = getEdgeFontStyle(edge);
      const multFontSize = edgeFont.fontSize ? Math.max(8, Math.round(edgeFont.fontSize * 0.85)) : undefined;

      if (edge.multiplicitySource) {
        const sText = document.createElementNS(svgNS, "text");
        const dirX = Math.sign(secondPt.x - startPt.x);
        const dirY = Math.sign(secondPt.y - startPt.y);
        sText.setAttribute("x", String(startPt.x + (dirX !== 0 ? dirX * 18 : 10)));
        sText.setAttribute("y", String(startPt.y + (dirY !== 0 ? dirY * 18 : -8)));
        sText.setAttribute("class", "umlcanvas-edge-multiplicity umlcanvas-multiplicity-source");
        sText.textContent = edge.multiplicitySource;
        applyFontToSvgElement(sText as SVGElement, { ...edgeFont, fontSize: multFontSize });
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
        applyFontToSvgElement(tText as SVGElement, { ...edgeFont, fontSize: multFontSize });
        edgeGroup.appendChild(tText);
      }
    }

    return edgeGroup;
  }

  private replaceOrAppend(parent: Element, newEl: Element, oldEl?: Element | null): void {
    if (oldEl && ((oldEl.parentElement as unknown) === parent || !oldEl.parentElement)) {
      const p = parent as unknown as Node;
      if (typeof p.replaceChild === "function") {
        p.replaceChild(newEl, oldEl);
        return;
      }
      this.safeRemove(oldEl);
    }
    parent.appendChild(newEl);
  }

  private safeRemove(el: Element | null | undefined): void {
    if (!el) return;
    if (typeof el.remove === "function") {
      el.remove();
    } else if (el.parentElement) {
      const p = el.parentElement as unknown as Node;
      if (typeof p.removeChild === "function") {
        p.removeChild(el);
      }
    }
  }

  private renderNodes(): void {
    const svgNS = "http://www.w3.org/2000/svg";

    const visibleRect = this.isVirtualizationActive()
      ? this.getVisibleCanvasRect()
      : null;

    const diagramNodeMap = new Map<string, DiagramNode>(
      this.editor.diagram.nodes.map((n) => [n.id, n])
    );
    const existingChildren = Array.from(this.nodesLayerEl.children ?? []) as SVGGElement[];
    const domNodeMap = new Map<string, SVGGElement>();

    for (const child of existingChildren) {
      const nodeId = child.getAttribute("data-node-id");
      if (nodeId) {
        domNodeMap.set(nodeId, child);
        if (!this.nodeElements.has(nodeId)) {
          this.nodeElements.set(nodeId, child);
        }
      } else {
        this.safeRemove(child);
      }
    }

    // Clean up DOM:
    // Remove nodes that are no longer in the diagram, or are hidden/virtualized out.
    for (const [nodeId, childEl] of domNodeMap.entries()) {
      const node = diagramNodeMap.get(nodeId);
      const isVisible =
        node &&
        this.editor.isNodeVisible(nodeId) &&
        (!visibleRect || intersects(visibleRect, rect(node.position, node.size)));

      if (!node || !isVisible) {
        this.safeRemove(childEl);
        this.nodeElements.delete(nodeId);
        this.nodeSignatures.delete(nodeId);
      }
    }

    for (const node of this.editor.diagram.nodes) {
      if (!this.editor.isNodeVisible(node.id)) {
        continue;
      }

      if (visibleRect && !intersects(visibleRect, rect(node.position, node.size))) {
        continue;
      }

      const existingEl = this.nodeElements.get(node.id);

      if (node.kind === "generic.pdf") {
        if (existingEl && (existingEl.parentElement as unknown) === this.nodesLayerEl) {
          this.updateExistingPdfNode(existingEl, node, svgNS);
          continue;
        } else {
          const nodeGroup = this.renderNodeGroup(node, svgNS);
          this.nodesLayerEl.appendChild(nodeGroup);
          this.nodeElements.set(node.id, nodeGroup);
          this.nodeSignatures.set(node.id, this.getNodeSignature(node));
          continue;
        }
      }

      const currentSignature = this.getNodeSignature(node);
      const previousSignature = this.nodeSignatures.get(node.id);

      if (existingEl && (existingEl.parentElement as unknown) === this.nodesLayerEl && currentSignature === previousSignature) {
        const posStr = `translate(${node.position.x}, ${node.position.y})`;
        if (existingEl.getAttribute("transform") !== posStr) {
          existingEl.setAttribute("transform", posStr);
        }
        const isLocked = this.editor.isNodeLocked(node.id);
        if (typeof existingEl.classList?.toggle === "function") {
          existingEl.classList.toggle("umlcanvas-node-locked", isLocked);
          existingEl.classList.toggle("umlcanvas-node-editing", this.editingNodeId === node.id);
        } else if (existingEl.classList) {
          if (isLocked) existingEl.classList.add("umlcanvas-node-locked");
          else existingEl.classList.remove("umlcanvas-node-locked");
          if (this.editingNodeId === node.id) existingEl.classList.add("umlcanvas-node-editing");
          else existingEl.classList.remove("umlcanvas-node-editing");
        }
        continue;
      }

      const nodeGroup = this.renderNodeGroup(node, svgNS);
      this.replaceOrAppend(this.nodesLayerEl, nodeGroup, existingEl);
      this.nodeElements.set(node.id, nodeGroup);
      this.nodeSignatures.set(node.id, currentSignature);
    }
  }

  private getNodeSignature(node: DiagramNode): string {
    const isSelected = this.editor.isNodeSelected(node.id);
    const isLocked = this.editor.isNodeLocked(node.id);
    const isEditing = this.editingNodeId === node.id;
    const labelsStr = (node.labels ?? [])
      .map(
        (l) =>
          `${l.text}|${l.style?.fontSize}|${l.style?.bold}|${l.style?.italic}|${l.style?.fontFamily}|${l.style?.color}`
      )
      .join("~");
    const styleStr = node.style
      ? `${node.style.color}|${node.style.fillColor}|${node.style.strokeColor}|${node.style.strokeWidth}|${node.style.cornerRadius}|${node.style.fontSize}|${node.style.fontFamily}`
      : "";
    const portsStr = (node.ports ?? [])
      .map((p) => `${p.id}:${p.side}:${p.offset}:${p.name}`)
      .join(";");
    const compartmentsStr = (node.compartments ?? [])
      .map((c) => {
        const itemStrs = (c.items ?? []).map((it) => (typeof it === "string" ? it : JSON.stringify(it)));
        return `${c.title}:${itemStrs.join(",")}`;
      })
      .join(";");

    let customStr = "";
    if (node.customData) {
      if (node.kind === "generic.freehand") {
        const pathDataStr = typeof node.customData.pathData === "string" ? node.customData.pathData : "";
        const pointsLen = Array.isArray(node.customData.points) ? node.customData.points.length : 0;
        customStr = `${pathDataStr.slice(0, 40)}#${pathDataStr.length}:${pointsLen}`;
      } else {
        const keys = Object.keys(node.customData).sort();
        const parts: string[] = [];
        for (const k of keys) {
          const val = node.customData[k];
          if (typeof val === "string") {
            if (val.length > 80) {
              parts.push(`${k}:${val.slice(0, 32)}..${val.length}`);
            } else {
              parts.push(`${k}:${val}`);
            }
          } else if (typeof val === "number" || typeof val === "boolean") {
            parts.push(`${k}:${val}`);
          } else if (val && typeof val === "object") {
            try {
              parts.push(`${k}:${JSON.stringify(val).slice(0, 64)}`);
            } catch {
              parts.push(`${k}:obj`);
            }
          }
        }
        customStr = parts.join(",");
      }
    }

    const filePathStr = typeof node.metadata?.filePath === "string" ? node.metadata.filePath : "";
    const subpathStr = typeof node.metadata?.subpath === "string" ? node.metadata.subpath : "";
    const metaStr = `${filePathStr}|${subpathStr}`;

    return `${node.kind}|${node.size.width}x${node.size.height}|${labelsStr}|${styleStr}|${portsStr}|${compartmentsStr}|${node.stereotype ?? ""}|${customStr}|${metaStr}|${isSelected}|${isLocked}|${isEditing}`;
  }

  public getNodeElement(id: string): SVGGElement | null {
    const el = this.nodeElements.get(id);
    if (el && (el.parentElement as unknown) === this.nodesLayerEl) return el;
    return this.nodesLayerEl.querySelector(`[data-node-id="${id}"]`);
  }

  public getEdgeElement(id: string): SVGGElement | null {
    const el = this.edgeElements.get(id);
    if (el && (el.parentElement as unknown) === this.edgesLayerEl) return el;
    return this.edgesLayerEl.querySelector(`[data-edge-id="${id}"]`);
  }

  public getGroupElement(id: string): SVGGElement | null {
    const el = this.groupElements.get(id);
    if (el && (el.parentElement as unknown) === this.groupsLayerEl) return el;
    return this.groupsLayerEl.querySelector(`[data-group-id="${id}"]`);
  }

  private renderNodeGroup(node: DiagramNode, svgNS: string): SVGGElement {
    const nodeGroup = document.createElementNS(svgNS, "g") as SVGGElement;
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
    if (this.editingNodeId === node.id) {
      nodeGroup.classList.add("umlcanvas-node-editing");
    }

    if (node.style?.color) {
      nodeGroup.setAttribute("data-color", node.style.color);
      const resolvedColor = resolveCanvasColor(node.style.color);
      if (resolvedColor) {
        const obsEl = nodeGroup as unknown as { setCssProps?: (props: Record<string, string>) => void };
        if (typeof obsEl.setCssProps === "function") {
          obsEl.setCssProps({ "--canvas-color": resolvedColor });
        } else if (nodeGroup.style && typeof nodeGroup.style.setProperty === "function") {
          nodeGroup.style.setProperty("--canvas-color", resolvedColor);
        }
      }
      if (isCanvasColorPreset(node.style.color)) {
        nodeGroup.classList.add(`is-color-${node.style.color}`);
      } else {
        nodeGroup.classList.add("has-custom-color");
      }
    } else if (node.style?.strokeColor) {
      nodeGroup.setAttribute("data-color", node.style.strokeColor);
      const obsEl = nodeGroup as unknown as { setCssProps?: (props: Record<string, string>) => void };
      if (typeof obsEl.setCssProps === "function") {
        obsEl.setCssProps({ "--canvas-color": node.style.strokeColor });
      } else if (nodeGroup.style && typeof nodeGroup.style.setProperty === "function") {
        nodeGroup.style.setProperty("--canvas-color", node.style.strokeColor);
      }
      nodeGroup.classList.add("has-custom-color");
    }

    // Transparent hitbox covering node boundary for reliable grabbing & moving
    // Note: generic.freehand uses a stroked path hitbox so empty space inside the bounding box can be clicked through and deselected
    if (node.kind !== "generic.freehand") {
      const hitbox = document.createElementNS(svgNS, "rect");
      hitbox.setAttribute("x", "0");
      hitbox.setAttribute("y", "0");
      hitbox.setAttribute("width", String(node.size.width));
      hitbox.setAttribute("height", String(node.size.height));
      hitbox.setAttribute("fill", "transparent");
      hitbox.setAttribute("class", "umlcanvas-node-hitbox");
      nodeGroup.appendChild(hitbox);
    }

    const shapeDef = this.shapeRegistry.get(node.kind);
    const renderedShape = shapeDef.renderSvg(node, { isSelected });
    nodeGroup.appendChild(renderedShape);

    // Render markdown for obsidian note embeds
    if (node.kind === "obsidian.note" || (node.metadata?.filePath && node.kind !== "generic.image" && node.kind !== "generic.pdf")) {
      const bodyEl = renderedShape.querySelector<HTMLElement>(
        ".umlcanvas-obsidian-note-body"
      );
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
          const renderPromise = this.onRenderMarkdown(markdown, bodyEl, filePath);
          const onComplete = () => {
            if (node.customData?.scaleMode === "fit" && bodyEl.scrollHeight > 0) {
              const actualH = bodyEl.scrollHeight;
              const prevH = typeof node.customData.contentHeight === "number" ? node.customData.contentHeight : 0;
              if (!prevH || Math.abs(prevH - actualH) > 30) {
                node.customData.contentHeight = actualH;
                const scaler = renderedShape.querySelector<HTMLElement>(".umlcanvas-obsidian-note-scale-wrapper");
                if (scaler) {
                  const bodyH = Math.max(10, node.size.height - 32);
                  const newScale = Math.round(Math.max(0.15, Math.min(1.0, bodyH / actualH)) * 100) / 100;
                  scaler.style.transform = `scale(${newScale})`;
                  scaler.style.width = `${Math.round((100 / newScale) * 100) / 100}%`;
                  scaler.style.minHeight = `${Math.round((bodyH / newScale) * 100) / 100}px`;
                  renderedShape.setAttribute("data-scale", String(newScale));
                  const badge = renderedShape.querySelector<SVGTextElement>(".umlcanvas-obsidian-note-scale-badge");
                  if (badge) badge.textContent = `${Math.round(newScale * 100)}%`;
                }
              }
            }
          };
          if (renderPromise instanceof Promise) {
            void renderPromise.then(onComplete);
          } else {
            onComplete();
          }
        }
      }
    }

    // Render ports & port handles (F-007, F-031)
    const ports = shapeDef.getPorts(node);
    for (const port of ports) {
      const pt = getSidePoint({ x: 0, y: 0 }, node.size, port.side, port.offset, node.kind);
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

    return nodeGroup;
  }

  private updateExistingPdfNode(
    nodeGroup: SVGGElement,
    node: DiagramNode,
    svgNS: string
  ): void {
    const isSelected = this.editor.isNodeSelected(node.id);
    const isLocked = this.editor.isNodeLocked(node.id);

    // 1. Position transform
    nodeGroup.setAttribute(
      "transform",
      `translate(${node.position.x}, ${node.position.y})`
    );

    // 2. Locked & Editing classes
    if (isLocked) {
      nodeGroup.classList.add("umlcanvas-node-locked");
    } else {
      nodeGroup.classList.remove("umlcanvas-node-locked");
    }
    if (this.editingNodeId === node.id) {
      nodeGroup.classList.add("umlcanvas-node-editing");
    } else {
      nodeGroup.classList.remove("umlcanvas-node-editing");
    }

    // 3. Styling / color
    if (node.style?.color) {
      nodeGroup.setAttribute("data-color", node.style.color);
      const resolvedColor = resolveCanvasColor(node.style.color);
      if (resolvedColor) {
        const obsEl = nodeGroup as unknown as { setCssProps?: (props: Record<string, string>) => void };
        if (typeof obsEl.setCssProps === "function") {
          obsEl.setCssProps({ "--canvas-color": resolvedColor });
        } else if (nodeGroup.style && typeof nodeGroup.style.setProperty === "function") {
          nodeGroup.style.setProperty("--canvas-color", resolvedColor);
        }
      }
      if (isCanvasColorPreset(node.style.color)) {
        nodeGroup.classList.add(`is-color-${node.style.color}`);
      } else {
        nodeGroup.classList.add("has-custom-color");
      }
    } else if (node.style?.strokeColor) {
      nodeGroup.setAttribute("data-color", node.style.strokeColor);
      const obsEl = nodeGroup as unknown as { setCssProps?: (props: Record<string, string>) => void };
      if (typeof obsEl.setCssProps === "function") {
        obsEl.setCssProps({ "--canvas-color": node.style.strokeColor });
      } else if (nodeGroup.style && typeof nodeGroup.style.setProperty === "function") {
        nodeGroup.style.setProperty("--canvas-color", node.style.strokeColor);
      }
      nodeGroup.classList.add("has-custom-color");
    } else {
      nodeGroup.classList.remove("has-custom-color");
    }

    const w = node.size.width;
    const h = node.size.height;
    const r = 8;
    const headerH = 32;
    const bodyH = Math.max(10, h - headerH);

    // 4. Hitbox
    const hitbox = nodeGroup.querySelector<SVGRectElement>(".umlcanvas-node-hitbox");
    if (hitbox) {
      hitbox.setAttribute("width", String(w));
      hitbox.setAttribute("height", String(h));
    }

    // 5. Card container / background rect
    const bgRect = nodeGroup.querySelector<SVGRectElement>(".umlcanvas-pdf-card");
    if (bgRect) {
      bgRect.setAttribute("width", String(w));
      bgRect.setAttribute("height", String(h));
      if (isSelected) {
        bgRect.classList.add("umlcanvas-node-selected");
      } else {
        bgRect.classList.remove("umlcanvas-node-selected");
      }
      if (node.style?.fillColor) {
        bgRect.setAttribute("fill", node.style.fillColor);
      }
      if (node.style?.strokeColor) {
        bgRect.setAttribute("stroke", node.style.strokeColor);
      }
    }

    // 6. Header background path
    const headerRect = nodeGroup.querySelector<SVGPathElement>(".umlcanvas-pdf-header-bg");
    if (headerRect) {
      headerRect.setAttribute(
        "d",
        `M 0 ${r} A ${r} ${r} 0 0 1 ${r} 0 L ${w - r} 0 A ${r} ${r} 0 0 1 ${w} ${r} L ${w} ${headerH} L 0 ${headerH} Z`
      );
    }

    // 7. Header separator line
    const sepLine = nodeGroup.querySelector<SVGLineElement>(".umlcanvas-pdf-header-sep");
    if (sepLine) {
      sepLine.setAttribute("x2", String(w));
    }

    // 8. Title text
    const rawTitle = node.labels[0]?.text || (node.metadata?.filePath as string) || "PDF Document";
    const title = rawTitle.replace(/\.pdf$/i, "");
    const subpath =
      (node.metadata?.subpath as string) || (node.customData?.subpath as string) || "";
    const rightMargin = subpath ? (w >= 240 ? 80 : 35) : 30;
    const maxChars = Math.max(8, Math.floor((w - rightMargin) / 7.5));
    const titleText = nodeGroup.querySelector<SVGTextElement>(".umlcanvas-pdf-title");
    if (titleText) {
      titleText.textContent = title.length > maxChars ? `${title.slice(0, maxChars - 2)}…` : title;
      titleText.setAttribute("title", rawTitle);
      applyFontToSvgElement(titleText, getNodeFontStyle(node));
    }

    // 9. Subpath / Page badge
    let pageBadge: SVGTextElement | null = nodeGroup.querySelector(".umlcanvas-pdf-page-badge");
    if (subpath && w >= 220) {
      const pageMatch = subpath.match(/page=(\d+)/i);
      const badgeText = pageMatch ? `p. ${pageMatch[1]}` : subpath.replace(/^#/, "");
      if (!pageBadge) {
        pageBadge = document.createElementNS(svgNS, "text") as unknown as SVGTextElement;
        pageBadge.setAttribute("class", "umlcanvas-pdf-page-badge");
        const shape = nodeGroup.querySelector(".umlcanvas-shape-pdf");
        if (shape && pageBadge) {
          shape.appendChild(pageBadge);
        }
      }
      if (pageBadge) {
        pageBadge.setAttribute("x", String(w - 38));
        pageBadge.setAttribute("y", "21");
        pageBadge.textContent = badgeText;
        pageBadge.setAttribute("title", `Target: ${subpath}`);
      }
    } else if (pageBadge) {
      this.safeRemove(pageBadge);
    }

    // 10. Clickable Open Icon in Header (↗)
    const openIcon = nodeGroup.querySelector<SVGTextElement>(".umlcanvas-pdf-open-btn");
    if (openIcon) {
      openIcon.setAttribute("x", String(w - 20));
      const pdfFilePath =
        (node.metadata?.filePath as string) || (node.customData?.filePath as string) || "";
      const targetPathWithSubpath = subpath
        ? `${pdfFilePath}${subpath.startsWith("#") ? subpath : "#" + subpath}`
        : pdfFilePath;
      openIcon.setAttribute("data-file-path", targetPathWithSubpath);
    }

    // 11. ForeignObject dimensions
    const foreign = nodeGroup.querySelector<SVGForeignObjectElement>(".umlcanvas-pdf-foreign");
    if (foreign) {
      foreign.setAttribute("width", String(w));
      foreign.setAttribute("height", String(bodyH));
    }

    // 12. Fallback SVG elements
    const pageW = Math.round(w * 0.72);
    const pageH = Math.round(bodyH * 0.78);
    const pageX = Math.round((w - pageW) / 2);
    const pageY = Math.round(headerH + (bodyH - pageH) / 2);

    const fallbackPage = nodeGroup.querySelector<SVGRectElement>(".umlcanvas-pdf-fallback-page");
    if (fallbackPage) {
      fallbackPage.setAttribute("x", String(pageX));
      fallbackPage.setAttribute("y", String(pageY));
      fallbackPage.setAttribute("width", String(pageW));
      fallbackPage.setAttribute("height", String(pageH));
    }
    const fallbackTitle = nodeGroup.querySelector<SVGTextElement>(".umlcanvas-pdf-fallback-text");
    if (fallbackTitle) {
      fallbackTitle.setAttribute("x", String(w / 2));
      fallbackTitle.setAttribute("y", String(pageY + pageH / 2));
      fallbackTitle.textContent = `${title}.pdf`;
    }

    // 13. Rich HTML PDF Body via foreignObject (loads PDF via iframe or embed)
    // ONLY update iframe src if target URL has ACTUALLY changed.
    // If it hasn't changed, never touch or reassign src to prevent reloading the PDF!
    const src =
      (node.customData?.src as string) ||
      (node.metadata?.src as string) ||
      (node.customData?.filePath as string) ||
      (node.metadata?.filePath as string) ||
      "";

    let fullSrc = src;
    if (src && subpath) {
      if (src.includes("#")) {
        fullSrc = `${src.split("#")[0]}${subpath.startsWith("#") ? subpath : "#" + subpath}`;
      } else {
        fullSrc = `${src}${subpath.startsWith("#") ? subpath : "#" + subpath}`;
      }
    }

    const iframe = nodeGroup.querySelector<HTMLIFrameElement>(".umlcanvas-pdf-frame");
    const placeholder = nodeGroup.querySelector<HTMLElement>(".umlcanvas-pdf-placeholder");

    if (fullSrc) {
      if (iframe) {
        const currentSrc = iframe.getAttribute("data-pdf-src") || iframe.getAttribute("src");
        if (currentSrc !== fullSrc) {
          iframe.setAttribute("data-pdf-src", fullSrc);
          iframe.setAttribute("src", fullSrc);
        }
      } else {
        const containerDiv = nodeGroup.querySelector<HTMLElement>(".umlcanvas-pdf-container");
        if (containerDiv) {
          if (placeholder) this.safeRemove(placeholder);
          const newIframe = safeCreateEl("iframe", {
            cls: "umlcanvas-pdf-frame",
            attr: {
              src: fullSrc,
              type: "application/pdf",
              frameborder: "0",
              title: title || "PDF Document",
              "data-pdf-src": fullSrc,
            },
          });
          containerDiv.appendChild(newIframe);
        }
      }
    } else if (!iframe && !placeholder) {
      const containerDiv = nodeGroup.querySelector<HTMLElement>(".umlcanvas-pdf-container");
      if (containerDiv) {
        const newPlaceholder = safeCreateDiv({
          cls: "umlcanvas-pdf-placeholder",
          text: "PDF Document (drop or select file)",
        });
        containerDiv.appendChild(newPlaceholder);
      }
    }

    // 14. Port handles: recreate port handles if size changed
    const oldHandles = Array.from(nodeGroup.querySelectorAll(".umlcanvas-port-handle"));
    for (const p of oldHandles) this.safeRemove(p);
    const oldLabels = Array.from(nodeGroup.querySelectorAll(".umlcanvas-port-label"));
    for (const p of oldLabels) this.safeRemove(p);

    const shapeDef = this.shapeRegistry.get(node.kind);
    const ports = shapeDef.getPorts(node);
    for (const port of ports) {
      const pt = getSidePoint({ x: 0, y: 0 }, node.size, port.side, port.offset, node.kind);
      const handle = document.createElementNS(svgNS, "circle");
      handle.setAttribute("cx", String(pt.x));
      handle.setAttribute("cy", String(pt.y));
      handle.setAttribute("r", "5");
      handle.setAttribute("class", "umlcanvas-port-handle");
      handle.setAttribute("data-port-id", port.id);
      handle.setAttribute("data-side", port.side);
      nodeGroup.appendChild(handle);

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
  }

  private renderInteractions(): void {
    const svgNS = "http://www.w3.org/2000/svg";
    this.interactionLayerEl.textContent = "";

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
      outline.setAttribute("pointer-events", "none");
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

    // On-canvas interactive table controls for selected or hovered generic.table
    const tableNodesForControls = new Set<DiagramNode>();
    for (const node of selectedNodes) {
      if (node.kind === "generic.table" && selectedNodes.length === 1 && !this.editor.isNodeLocked(node.id)) {
        tableNodesForControls.add(node);
      }
    }
    if (this.hoveredTableNodeId && this.editor.selectedNodeIds.length <= 1) {
      const hNode = this.editor.diagram.nodes.find((n) => n.id === this.hoveredTableNodeId);
      if (hNode && hNode.kind === "generic.table" && !this.editor.isNodeLocked(hNode.id) && this.editor.isNodeVisible(hNode.id)) {
        tableNodesForControls.add(hNode);
      }
    }

    for (const tableNode of tableNodesForControls) {
      this.renderTableControls(tableNode);
    }

    // Selection handles for selected edges (F-007, line editing & reconnecting)
    for (const edgeId of this.editor.selectedEdgeIds) {
      const edge = this.editor.diagram.edges.find((e) => e.id === edgeId);
      if (!edge) continue;
      const fromNode = this.editor.diagram.nodes.find((n) => n.id === edge.fromNodeId);
      const toNode = edge.toNodeId
        ? this.editor.diagram.nodes.find((n) => n.id === edge.toNodeId)
        : undefined;
      if (!fromNode || (!toNode && !edge.toPoint)) continue;

      const fromPort = fromNode.ports?.find((p) => p.id === edge.fromPortId);
      const toPort = toNode?.ports?.find((p) => p.id === edge.toPortId);
      const fromSide = fromPort?.side ?? edge.fromSide;
      const toSide = toPort?.side ?? edge.toSide;

      const targetBoundary = toNode
        ? {
            id: toNode.id,
            position: toNode.position,
            size: toNode.size,
            side: toSide,
            portOffset: toPort?.offset,
            kind: toNode.kind,
          }
        : {
            position: edge.toPoint!,
            size: { width: 0, height: 0 },
            side: toSide,
          };

      const routingResult = defaultRoutingService.route(
        {
          id: fromNode.id,
          position: fromNode.position,
          size: fromNode.size,
          side: fromSide,
          portOffset: fromPort?.offset,
          kind: fromNode.kind,
        },
        targetBoundary,
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
            wpHandle.setAttribute("r", "5.5");
            wpHandle.setAttribute(
              "class",
              "umlcanvas-edge-handle umlcanvas-edge-waypoint-handle"
            );
            wpHandle.setAttribute("data-edge-id", edge.id);
            wpHandle.setAttribute("data-waypoint-index", String(idx));
            wpHandle.setAttribute("title", "Drag to adjust bend point (Double-click or Alt+click to remove)");
            this.interactionLayerEl.appendChild(wpHandle);
          });
        }

        // Virtual midpoint handles on segments to allow inserting waypoints
        for (let i = 0; i < routingResult.points.length - 1; i++) {
          const pA = routingResult.points[i];
          const pB = routingResult.points[i + 1];
          const segDist = Math.hypot(pB.x - pA.x, pB.y - pA.y);
          if (segDist >= 20) {
            const midX = Math.round((pA.x + pB.x) / 2);
            const midY = Math.round((pA.y + pB.y) / 2);
            const midHandle = document.createElementNS(svgNS, "circle");
            midHandle.setAttribute("cx", String(midX));
            midHandle.setAttribute("cy", String(midY));
            midHandle.setAttribute("r", "4.5");
            midHandle.setAttribute(
              "class",
              "umlcanvas-edge-handle umlcanvas-edge-midpoint-handle"
            );
            midHandle.setAttribute("data-edge-id", edge.id);
            midHandle.setAttribute("data-midpoint-x", String(midX));
            midHandle.setAttribute("data-midpoint-y", String(midY));
            midHandle.setAttribute("title", "Drag to add a bend point");
            this.interactionLayerEl.appendChild(midHandle);
          }
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
      const activeKind = this.editor.activeEdgeKind ?? "uml.association";
      const activeStyle = defaultEdgeStyleRegistry.get(activeKind);
      const previewMarkerEnd =
        this.editor.defaultMarkerEnd !== undefined
          ? this.editor.defaultMarkerEnd === "none"
            ? undefined
            : this.normalizeMarkerId(this.editor.defaultMarkerEnd)
          : activeStyle.markerEndId;
      const previewMarkerStart =
        this.editor.defaultMarkerStart !== undefined
          ? this.editor.defaultMarkerStart === "none"
            ? undefined
            : this.normalizeMarkerId(this.editor.defaultMarkerStart)
          : activeStyle.markerStartId;
      const previewDash = this.resolveStrokeDasharray(
        { lineType: this.editor.defaultLineType },
        activeStyle
      );
      if (previewMarkerEnd) {
        line.setAttribute("marker-end", `url(#${previewMarkerEnd})`);
      }
      if (previewMarkerStart) {
        line.setAttribute("marker-start", `url(#${previewMarkerStart})`);
      }
      if (previewDash) {
        line.setAttribute("stroke-dasharray", previewDash);
      }
      this.interactionLayerEl.appendChild(line);
    }

    // Arrow attachment preview line (when popup is open)
    if (this.arrowAttachmentState) {
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", String(this.arrowAttachmentState.startPoint.x));
      line.setAttribute("y1", String(this.arrowAttachmentState.startPoint.y));
      line.setAttribute("x2", String(this.arrowAttachmentState.dropCanvasPoint.x));
      line.setAttribute("y2", String(this.arrowAttachmentState.dropCanvasPoint.y));
      line.setAttribute("class", "umlcanvas-edge-preview-line");
      const activeKind = this.editor.activeEdgeKind ?? "uml.association";
      const activeStyle = defaultEdgeStyleRegistry.get(activeKind);
      const previewMarkerEnd =
        this.editor.defaultMarkerEnd !== undefined
          ? this.editor.defaultMarkerEnd === "none"
            ? undefined
            : this.normalizeMarkerId(this.editor.defaultMarkerEnd)
          : activeStyle.markerEndId ?? "open-arrow";
      if (previewMarkerEnd) {
        line.setAttribute("marker-end", `url(#${previewMarkerEnd})`);
      }
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
      const edge = this.editor.diagram.edges.find((ed) => ed.id === reconnectState.edgeId);
      const activeStyle = edge ? defaultEdgeStyleRegistry.get(edge.kind) : undefined;
      const reconnectMarkerEnd =
        edge?.style?.markerEnd !== undefined
          ? edge.style.markerEnd === "none"
            ? undefined
            : this.normalizeMarkerId(edge.style.markerEnd)
          : activeStyle?.markerEndId;
      const reconnectMarkerStart =
        edge?.style?.markerStart !== undefined
          ? edge.style.markerStart === "none"
            ? undefined
            : this.normalizeMarkerId(edge.style.markerStart)
          : activeStyle?.markerStartId;
      const reconnectDash = edge
        ? this.resolveStrokeDasharray(edge.style, activeStyle)
        : activeStyle?.strokeDasharray;
      if (reconnectMarkerEnd) {
        line.setAttribute("marker-end", `url(#${reconnectMarkerEnd})`);
      }
      if (reconnectMarkerStart) {
        line.setAttribute("marker-start", `url(#${reconnectMarkerStart})`);
      }
      if (reconnectDash) {
        line.setAttribute("stroke-dasharray", reconnectDash);
      }
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

  private renderTableControls(node: DiagramNode): void {
    const svgNS = "http://www.w3.org/2000/svg";
    const rows = Math.max(1, (node.customData?.rows as number) || 3);
    const cols = Math.max(1, (node.customData?.cols as number) || 3);

    // Add Column (+) button at right border
    const addColG = document.createElementNS(svgNS, "g");
    addColG.setAttribute("class", "umlcanvas-table-canvas-btn umlcanvas-table-add-col-btn");
    addColG.setAttribute("data-node-id", node.id);
    addColG.setAttribute("title", "Add Column");
    const addColCx = node.position.x + node.size.width + 16;
    const addColCy = cols > 1
      ? node.position.y + node.size.height / 2 - 14
      : node.position.y + node.size.height / 2;
    addColG.style.transformOrigin = `${addColCx}px ${addColCy}px`;

    const addColHitbox = document.createElementNS(svgNS, "circle");
    addColHitbox.setAttribute("cx", String(addColCx));
    addColHitbox.setAttribute("cy", String(addColCy));
    addColHitbox.setAttribute("r", "16");
    addColHitbox.setAttribute("class", "umlcanvas-table-btn-hitbox");
    addColG.appendChild(addColHitbox);

    const addColCircle = document.createElementNS(svgNS, "circle");
    addColCircle.setAttribute("cx", String(addColCx));
    addColCircle.setAttribute("cy", String(addColCy));
    addColCircle.setAttribute("r", "11");
    addColCircle.setAttribute("class", "umlcanvas-table-btn-circle");
    addColG.appendChild(addColCircle);

    const addColText = document.createElementNS(svgNS, "text");
    addColText.setAttribute("x", String(addColCx));
    addColText.setAttribute("y", String(addColCy));
    addColText.setAttribute("text-anchor", "middle");
    addColText.setAttribute("dominant-baseline", "central");
    addColText.setAttribute("class", "umlcanvas-table-btn-text");
    addColText.textContent = "+";
    addColG.appendChild(addColText);

    this.interactionLayerEl.appendChild(addColG);

    // Delete Column (-) button at right border (only if cols > 1)
    if (cols > 1) {
      const delColG = document.createElementNS(svgNS, "g");
      delColG.setAttribute("class", "umlcanvas-table-canvas-btn umlcanvas-table-del-col-btn");
      delColG.setAttribute("data-node-id", node.id);
      delColG.setAttribute("title", "Delete Column");
      const delColCx = node.position.x + node.size.width + 16;
      const delColCy = node.position.y + node.size.height / 2 + 14;
      delColG.style.transformOrigin = `${delColCx}px ${delColCy}px`;

      const delColHitbox = document.createElementNS(svgNS, "circle");
      delColHitbox.setAttribute("cx", String(delColCx));
      delColHitbox.setAttribute("cy", String(delColCy));
      delColHitbox.setAttribute("r", "16");
      delColHitbox.setAttribute("class", "umlcanvas-table-btn-hitbox");
      delColG.appendChild(delColHitbox);

      const delColCircle = document.createElementNS(svgNS, "circle");
      delColCircle.setAttribute("cx", String(delColCx));
      delColCircle.setAttribute("cy", String(delColCy));
      delColCircle.setAttribute("r", "11");
      delColCircle.setAttribute("class", "umlcanvas-table-btn-circle is-delete");
      delColG.appendChild(delColCircle);

      const delColText = document.createElementNS(svgNS, "text");
      delColText.setAttribute("x", String(delColCx));
      delColText.setAttribute("y", String(delColCy));
      delColText.setAttribute("text-anchor", "middle");
      delColText.setAttribute("dominant-baseline", "central");
      delColText.setAttribute("class", "umlcanvas-table-btn-text");
      delColText.textContent = "−";
      delColG.appendChild(delColText);

      this.interactionLayerEl.appendChild(delColG);
    }

    // Add Row (+) button at bottom border
    const addRowG = document.createElementNS(svgNS, "g");
    addRowG.setAttribute("class", "umlcanvas-table-canvas-btn umlcanvas-table-add-row-btn");
    addRowG.setAttribute("data-node-id", node.id);
    addRowG.setAttribute("title", "Add Row");
    const addRowCx = rows > 1
      ? node.position.x + node.size.width / 2 - 14
      : node.position.x + node.size.width / 2;
    const addRowCy = node.position.y + node.size.height + 16;
    addRowG.style.transformOrigin = `${addRowCx}px ${addRowCy}px`;

    const addRowHitbox = document.createElementNS(svgNS, "circle");
    addRowHitbox.setAttribute("cx", String(addRowCx));
    addRowHitbox.setAttribute("cy", String(addRowCy));
    addRowHitbox.setAttribute("r", "16");
    addRowHitbox.setAttribute("class", "umlcanvas-table-btn-hitbox");
    addRowG.appendChild(addRowHitbox);

    const addRowCircle = document.createElementNS(svgNS, "circle");
    addRowCircle.setAttribute("cx", String(addRowCx));
    addRowCircle.setAttribute("cy", String(addRowCy));
    addRowCircle.setAttribute("r", "11");
    addRowCircle.setAttribute("class", "umlcanvas-table-btn-circle");
    addRowG.appendChild(addRowCircle);

    const addRowText = document.createElementNS(svgNS, "text");
    addRowText.setAttribute("x", String(addRowCx));
    addRowText.setAttribute("y", String(addRowCy));
    addRowText.setAttribute("text-anchor", "middle");
    addRowText.setAttribute("dominant-baseline", "central");
    addRowText.setAttribute("class", "umlcanvas-table-btn-text");
    addRowText.textContent = "+";
    addRowG.appendChild(addRowText);

    this.interactionLayerEl.appendChild(addRowG);

    // Delete Row (-) button at bottom border (only if rows > 1)
    if (rows > 1) {
      const delRowG = document.createElementNS(svgNS, "g");
      delRowG.setAttribute("class", "umlcanvas-table-canvas-btn umlcanvas-table-del-row-btn");
      delRowG.setAttribute("data-node-id", node.id);
      delRowG.setAttribute("title", "Delete Row");
      const delRowCx = node.position.x + node.size.width / 2 + 14;
      const delRowCy = node.position.y + node.size.height + 16;
      delRowG.style.transformOrigin = `${delRowCx}px ${delRowCy}px`;

      const delRowHitbox = document.createElementNS(svgNS, "circle");
      delRowHitbox.setAttribute("cx", String(delRowCx));
      delRowHitbox.setAttribute("cy", String(delRowCy));
      delRowHitbox.setAttribute("r", "16");
      delRowHitbox.setAttribute("class", "umlcanvas-table-btn-hitbox");
      delRowG.appendChild(delRowHitbox);

      const delRowCircle = document.createElementNS(svgNS, "circle");
      delRowCircle.setAttribute("cx", String(delRowCx));
      delRowCircle.setAttribute("cy", String(delRowCy));
      delRowCircle.setAttribute("r", "11");
      delRowCircle.setAttribute("class", "umlcanvas-table-btn-circle is-delete");
      delRowG.appendChild(delRowCircle);

      const delRowText = document.createElementNS(svgNS, "text");
      delRowText.setAttribute("x", String(delRowCx));
      delRowText.setAttribute("y", String(delRowCy));
      delRowText.setAttribute("text-anchor", "middle");
      delRowText.setAttribute("dominant-baseline", "central");
      delRowText.setAttribute("class", "umlcanvas-table-btn-text");
      delRowText.textContent = "−";
      delRowG.appendChild(delRowText);

      this.interactionLayerEl.appendChild(delRowG);
    }
  }

  // --- Event Handling ---

  private getClientCoords(e: MouseEvent): Point {
    if (!this.cachedContainerRect) {
      if (typeof this.container.getBoundingClientRect === "function") {
        this.cachedContainerRect = this.container.getBoundingClientRect();
      } else {
        this.cachedContainerRect = {
          left: 0,
          top: 0,
          width: this.container.clientWidth || 800,
          height: this.container.clientHeight || 600,
        };
      }
    }
    return {
      x: e.clientX - this.cachedContainerRect.left,
      y: e.clientY - this.cachedContainerRect.top,
    };
  }

  private handleWheel(e: WheelEvent): void {
    const target = e.target as HTMLElement | null;
    const scrollable = target?.closest?.(
      ".umlcanvas-obsidian-note-body, .umlcanvas-scrollable, .umlcanvas-obsidian-note-container, .umlcanvas-pdf-container, .umlcanvas-pdf-frame"
    ) as HTMLElement | null;
    if (scrollable) {
      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const nodeEl = target?.closest?.(".umlcanvas-node");
        const nodeId = nodeEl?.getAttribute("data-node-id");
        if (nodeId) {
          const delta = e.deltaY < 0 ? 0.1 : -0.1;
          this.adjustNoteScale(nodeId, delta);
          return;
        }
      }
      if (!e.ctrlKey && !e.metaKey) {
        return;
      }
    }

    e.preventDefault();
    const cursor = this.getClientCoords(e);
    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.setTransform(zoomAtPoint(cursor, this.transform, zoomFactor));
  }

  private handleMouseDown(e: MouseEvent): void {
    if ((e as HandledMouseEvent)._umlHandled) return;

    const target = e.target as Element | null;
    if (
      target &&
      typeof target.closest === "function" &&
      target.closest(
        ".umlcanvas-main-toolbar, .umlcanvas-floating-bottom-toolbar, .umlcanvas-toolbar, .umlcanvas-menu-dropdown, .umlcanvas-palette-panel, .umlcanvas-palette-toggle-tab, .umlcanvas-minimap, .umlcanvas-color-palette-popover, .umlcanvas-align-popover, .umlcanvas-font-size-popover, .umlcanvas-font-size-dropdown, .umlcanvas-font-family-dropdown, .umlcanvas-connector-popover, .umlcanvas-line-popover, .umlcanvas-breadcrumbs, .umlcanvas-inline-editor, .modal, .menu, [class*='popover'], [class*='dropdown']"
      )
    ) {
      return;
    }

    (e as HandledMouseEvent)._umlHandled = true;

    // Table Action Buttons (+ / − for Rows and Columns) - handled first for smooth, immediate responsiveness
    const tableAddCol = target?.closest(".umlcanvas-table-add-col-btn");
    const tableDelCol = target?.closest(".umlcanvas-table-del-col-btn");
    const tableAddRow = target?.closest(".umlcanvas-table-add-row-btn");
    const tableDelRow = target?.closest(".umlcanvas-table-del-row-btn");

    if (tableAddCol || tableDelCol || tableAddRow || tableDelRow) {
      e.stopPropagation();
      e.preventDefault();
      if (this.inlineEditorEl) {
        this.commitInlineEditor();
      }
      this.lastTableButtonActionTime = Date.now();
      if (tableAddCol) {
        const nodeId = tableAddCol.getAttribute("data-node-id");
        if (nodeId) {
          this.editor.addTableColumn(nodeId);
          if (!this.editor.isNodeSelected(nodeId)) {
            this.editor.selectNode(nodeId, false);
          }
        }
      } else if (tableDelCol) {
        const nodeId = tableDelCol.getAttribute("data-node-id");
        if (nodeId) {
          this.editor.deleteTableColumn(nodeId);
          if (!this.editor.isNodeSelected(nodeId)) {
            this.editor.selectNode(nodeId, false);
          }
        }
      } else if (tableAddRow) {
        const nodeId = tableAddRow.getAttribute("data-node-id");
        if (nodeId) {
          this.editor.addTableRow(nodeId);
          if (!this.editor.isNodeSelected(nodeId)) {
            this.editor.selectNode(nodeId, false);
          }
        }
      } else if (tableDelRow) {
        const nodeId = tableDelRow.getAttribute("data-node-id");
        if (nodeId) {
          this.editor.deleteTableRow(nodeId);
          if (!this.editor.isNodeSelected(nodeId)) {
            this.editor.selectNode(nodeId, false);
          }
        }
      }
      return;
    }

    // Detect if click landed on a table cell before commitInlineEditor potentially re-renders
    const preCellEl = target?.closest(".umlcanvas-table-cell");
    const preCellRow = preCellEl?.getAttribute("data-row");
    const preCellCol = preCellEl?.getAttribute("data-col");
    const preNodeEl = target?.closest(".umlcanvas-node");
    const preNodeId = preNodeEl?.getAttribute("data-node-id");

    if (this.inlineEditorEl) {
      this.commitInlineEditor();
    }

    const clientPoint = this.getClientCoords(e);
    const canvasPoint = screenToCanvas(clientPoint, this.transform);

    // Pan via middle button or spacebar + left click or grab tool + left click
    if (e.button === 1 || (e.button === 0 && (this.isSpacePressed || this.isGrabMode))) {
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

    // Freehand / Hand-drawing mode: Start drawing stroke across canvas (F-070, F-071)
    if (this.isFreehandMode && this.enableFreehand && !this.isSpacePressed) {
      e.preventDefault();
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey && this.editor.hasSelection) {
        this.editor.clearSelection();
      }
      this.cachedContainerRect =
        typeof this.container.getBoundingClientRect === "function"
          ? this.container.getBoundingClientRect()
          : null;
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

      const path = this.viewportEl.createSvg("path", {
        cls: "umlcanvas-freehand-stroke",
        attr: { d: `M ${canvasPoint.x},${canvasPoint.y} L ${canvasPoint.x},${canvasPoint.y}` },
      });
      this.freehandPathEl = path;

      this.dragMode = { type: "freehand" };
      return;
    }

    if (!target) return;

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

    // Edge midpoint handle click -> insert waypoint and start moving it
    if (target.classList.contains("umlcanvas-edge-midpoint-handle")) {
      const edgeId = target.getAttribute("data-edge-id")!;
      const mx = parseFloat(target.getAttribute("data-midpoint-x")!);
      const my = parseFloat(target.getAttribute("data-midpoint-y")!);
      const edge = this.editor.diagram.edges.find((ed) => ed.id === edgeId);
      if (edge) {
        const originalWaypointsBeforeInsert = edge.waypoints
          ? edge.waypoints.map((p) => ({ ...p }))
          : undefined;
        const newPt = { x: mx, y: my };
        const currentWaypoints = edge.waypoints ? [...edge.waypoints] : [];
        const insertIndex = this.findWaypointInsertIndex(edge, newPt);
        currentWaypoints.splice(insertIndex, 0, newPt);
        edge.waypoints = currentWaypoints;

        this.dragMode = {
          type: "edge-waypoint",
          edgeId,
          waypointIndex: insertIndex,
          initialWaypoints: currentWaypoints.map((p) => ({ ...p })),
          originalWaypointsBeforeInsert,
        };
        this.render();
        return;
      }
    }

    // Edge waypoint handle click -> start moving waypoint (or Alt+click to remove)
    if (target.classList.contains("umlcanvas-edge-waypoint-handle")) {
      const edgeId = target.getAttribute("data-edge-id")!;
      const waypointIndex = parseInt(target.getAttribute("data-waypoint-index")!, 10);
      const edge = this.editor.diagram.edges.find((ed) => ed.id === edgeId);
      if (edge && edge.waypoints && edge.waypoints[waypointIndex]) {
        if (e.altKey) {
          this.editor.removeEdgeWaypoint(edgeId, waypointIndex);
          return;
        }
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
            port?.offset ?? 0.5,
            node.kind
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
        this.container.classList.add("umlcanvas-resizing");
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
          initialPoints:
            node.kind === "generic.freehand" && node.customData?.points
              ? (JSON.parse(JSON.stringify(node.customData.points)) as Point[])
              : undefined,
          initialPathData:
            node.kind === "generic.freehand" && typeof node.customData?.pathData === "string"
              ? node.customData.pathData
              : undefined,
        };
        this.container.classList.add("umlcanvas-resizing");
        return;
      }
    }

    // Edge click -> Select and prepare to move/reroute the line
    const edgeEl = target.closest(".umlcanvas-edge");
    if (edgeEl) {
      const edgeId = edgeEl.getAttribute("data-edge-id");
      if (edgeId) {
        const isMulti = e.shiftKey || e.metaKey || e.ctrlKey;
        if (isMulti) {
          this.editor.toggleEdgeSelection(edgeId);
        } else if (!this.editor.isEdgeSelected(edgeId)) {
          this.editor.selectEdge(edgeId, false);
        }

        if (this.editor.isEdgeSelected(edgeId)) {
          const initialWaypointsMap = new Map<string, Point[] | undefined>();
          for (const id of this.editor.selectedEdgeIds) {
            const ed = this.editor.diagram.edges.find((e) => e.id === id);
            if (ed) {
              initialWaypointsMap.set(
                id,
                ed.waypoints ? ed.waypoints.map((p) => ({ ...p })) : undefined
              );
            }
          }

          this.dragMode = {
            type: "edge-move",
            edgeId,
            startClient: clientPoint,
            startCanvas: canvasPoint,
            initialWaypointsMap,
            moved: false,
          };
        }
        return;
      }
    }

    // Click on note or PDF open button
    const openBtn = target.closest(
      ".umlcanvas-obsidian-note-open-btn, .umlcanvas-pdf-open-btn"
    );
    if (openBtn) {
      e.stopPropagation();
      const filePath = openBtn.getAttribute("data-file-path");
      if (filePath && this.onNoteOpen) {
        this.onNoteOpen(filePath);
        return;
      }
    }

    // Click on PDF page badge in header (to change target page)
    const pdfPageBadge = target.closest(".umlcanvas-pdf-page-badge");
    if (pdfPageBadge) {
      e.stopPropagation();
      const nodeEl = target.closest(".umlcanvas-node");
      const nodeId = nodeEl?.getAttribute("data-node-id");
      const node = nodeId ? this.editor.diagram.nodes.find((n) => n.id === nodeId) : null;
      if (node && this.onPdfChangePage) {
        this.onPdfChangePage(node);
        return;
      }
    }

    // Click on note scale controls (F-Obsidian-Notes-Scalability)
    const scaleBtn = target.closest(".umlcanvas-obsidian-note-scale-btn");
    if (scaleBtn) {
      e.stopPropagation();
      const nodeEl = target.closest(".umlcanvas-node");
      const nodeId = nodeEl?.getAttribute("data-node-id");
      if (nodeId) {
        this.toggleNoteScaleMode(nodeId);
        return;
      }
    }

    const zoomInBtn = target.closest(".umlcanvas-obsidian-note-zoom-in-btn");
    if (zoomInBtn) {
      e.stopPropagation();
      const nodeEl = target.closest(".umlcanvas-node");
      const nodeId = nodeEl?.getAttribute("data-node-id");
      if (nodeId) {
        this.adjustNoteScale(nodeId, 0.15);
        return;
      }
    }

    const zoomOutBtn = target.closest(".umlcanvas-obsidian-note-zoom-out-btn");
    if (zoomOutBtn) {
      e.stopPropagation();
      const nodeEl = target.closest(".umlcanvas-node");
      const nodeId = nodeEl?.getAttribute("data-node-id");
      if (nodeId) {
        this.adjustNoteScale(nodeId, -0.15);
        return;
      }
    }

    const scaleBadge = target.closest(".umlcanvas-obsidian-note-scale-badge");
    if (scaleBadge) {
      e.stopPropagation();
      const nodeEl = target.closest(".umlcanvas-node");
      const nodeId = nodeEl?.getAttribute("data-node-id");
      if (nodeId) {
        this.toggleNoteScaleMode(nodeId);
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
    let nodeEl = target ? target.closest<SVGGElement>(".umlcanvas-node") : null;
    let nodeId = nodeEl?.getAttribute("data-node-id") ?? preNodeId;
    if (nodeId) {
      if (!nodeEl) {
        nodeEl = this.nodesLayerEl.querySelector<SVGGElement>(`[data-node-id="${nodeId}"]`);
      }
      if (this.editor.isNodeLocked(nodeId)) {
        return;
      }

      const isMulti = e.shiftKey || e.metaKey || e.ctrlKey;
      const wasAlreadySingleSelected =
        !isMulti &&
        this.editor.selectedNodeIds.length === 1 &&
        this.editor.selectedNodeIds[0] === nodeId;

      if (isMulti) {
        this.editor.toggleNodeSelection(nodeId);
      } else if (!this.editor.isNodeSelected(nodeId)) {
        this.editor.selectNode(nodeId, false);
      }

      // Calculate clicked table cell if applicable
      let clickedCell: { row: number; col: number } | undefined = undefined;
      const clickedNode = this.editor.diagram.nodes.find((n) => n.id === nodeId);
      if (clickedNode && clickedNode.kind === "generic.table") {
        const rows = Math.max(1, (clickedNode.customData?.rows as number) || 3);
        const cols = Math.max(1, (clickedNode.customData?.cols as number) || 3);
        if (preCellRow !== null && preCellRow !== undefined && preCellCol !== null && preCellCol !== undefined) {
          clickedCell = {
            row: Math.max(0, Math.min(rows - 1, parseInt(preCellRow, 10))),
            col: Math.max(0, Math.min(cols - 1, parseInt(preCellCol, 10))),
          };
        } else {
          const cellEl = target ? target.closest(".umlcanvas-table-cell") : null;
          if (cellEl) {
            const r = parseInt(cellEl.getAttribute("data-row") || "0", 10);
            const c = parseInt(cellEl.getAttribute("data-col") || "0", 10);
            clickedCell = { row: r, col: c };
          } else {
            const relX = canvasPoint.x - clickedNode.position.x;
            const relY = canvasPoint.y - clickedNode.position.y;
            if (
              relX >= 0 &&
              relX <= clickedNode.size.width &&
              relY >= 0 &&
              relY <= clickedNode.size.height
            ) {
              const colW = clickedNode.size.width / cols;
              const rowH = clickedNode.size.height / rows;
              const r = Math.max(0, Math.min(rows - 1, Math.floor(relY / rowH)));
              const c = Math.max(0, Math.min(cols - 1, Math.floor(relX / colW)));
              clickedCell = { row: r, col: c };
            }
          }
        }
      }

        // If clicking on PDF placeholder (no PDF loaded yet), prompt to pick file
        if (target.closest(".umlcanvas-pdf-placeholder")) {
          if (clickedNode && clickedNode.kind === "generic.pdf" && this.onPdfPick) {
            this.onPdfPick(clickedNode);
            return;
          }
        }

        // If clicking inside the scrollable note body or PDF container, allow text selection and internal interactions without initiating card dragging
        if (
          target.closest(
            ".umlcanvas-obsidian-note-body, .umlcanvas-pdf-container, .umlcanvas-pdf-frame"
          )
        ) {
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
              clickedCell,
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
          wasAlreadySingleSelected,
          clickedNodeId: nodeId,
          clickedCell,
        };
        this.container.classList.add("umlcanvas-moving");
        return;
      }

    // Group Color Dot click -> Cycle color preset
    const colorDot = target.closest(".umlcanvas-group-color-dot");
    if (colorDot) {
      const groupId = colorDot.getAttribute("data-group-id");
      if (groupId) {
        const group = this.editor.diagram.groups.find((g) => g.id === groupId);
        if (group) {
          this.editor.selectGroup(groupId, false);
          const presets = ["1", "2", "3", "4", "5", "6"];
          const curIdx = group.color ? presets.indexOf(group.color) : -1;
          const nextColor = curIdx === -1 ? "1" : (curIdx === presets.length - 1 ? undefined : presets[curIdx + 1]);
          this.editor.setGroupColor(groupId, nextColor);
          return;
        }
      }
    }

    // Group click -> Select & start move
    const groupTarget = target.closest(
      ".umlcanvas-group-header-bg, .umlcanvas-group-title, .umlcanvas-group-badge, .umlcanvas-group-collapsed-card, .umlcanvas-group-box, .umlcanvas-group, .umlcanvas-group-color-dot"
    );
    if (groupTarget) {
      const groupId = groupTarget.getAttribute("data-group-id");
      if (groupId) {
        const group = this.editor.diagram.groups.find((g) => g.id === groupId);
        if (group) {
          const isMulti = e.shiftKey || e.metaKey || e.ctrlKey;
          const wasAlreadySingleSelected =
            !isMulti &&
            this.editor.selectedGroupIds.length === 1 &&
            this.editor.selectedGroupIds[0] === groupId;
          const isTitleClick = !!target.closest(".umlcanvas-group-title");

          if (isMulti) {
            this.editor.toggleGroupSelection(groupId);
          } else if (!this.editor.isGroupSelected(groupId)) {
            this.editor.selectGroup(groupId, false);
          }

          if (!group.locked) {
            const descendants = getDescendantGroups(this.editor.diagram, group);
            const allMovedGroupIds = new Set<string>([group.id, ...descendants.map((dg) => dg.id)]);

            if (group.position && group.size) {
              const groupBounds = rect(group.position, group.size);
              for (const node of this.editor.diagram.nodes) {
                const nodeCenter = center(rect(node.position, node.size));
                if (contains(groupBounds, nodeCenter) || contains(groupBounds, node.position)) {
                  const alreadyInMovedGroup = Array.from(allMovedGroupIds).some((gid) => {
                    const g = this.editor.diagram.groups.find((grp) => grp.id === gid);
                    return g && g.nodeIds.includes(node.id);
                  });
                  if (!alreadyInMovedGroup) {
                    const otherSmallerOutsideGroup = this.editor.diagram.groups.find(
                      (og) =>
                        !allMovedGroupIds.has(og.id) &&
                        og.position &&
                        og.size &&
                        (contains(rect(og.position, og.size), nodeCenter) || contains(rect(og.position, og.size), node.position)) &&
                        og.size.width * og.size.height < group.size!.width * group.size!.height
                    );
                    if (!otherSmallerOutsideGroup) {
                      group.nodeIds.push(node.id);
                    }
                  }
                }
              }
            }

            const initialGroupPositions = new Map<string, Point>();
            if (group.position) {
              initialGroupPositions.set(group.id, { ...group.position });
            }
            for (const dg of descendants) {
              if (dg.position) {
                initialGroupPositions.set(dg.id, { ...dg.position });
              }
            }

            const initialMemberPositions = new Map<string, Point>();
            const allNodeIds = new Set<string>();
            for (const nid of group.nodeIds) allNodeIds.add(nid);
            for (const dg of descendants) {
              for (const nid of dg.nodeIds) allNodeIds.add(nid);
            }
            for (const nid of allNodeIds) {
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
              initialGroupPositions,
              initialMemberPositions,
              moved: false,
              wasAlreadySingleSelected,
              isTitleClick: isTitleClick && !isMulti,
            };
            this.container.classList.add("umlcanvas-moving");
          }
          return;
        }
      }
    }

    // Empty canvas background click -> deselect and start marquee
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
      this.editor.clearSelection();
    }

    this.dragMode = {
      type: "marquee",
      startCanvas: canvasPoint,
      currentCanvas: canvasPoint,
    };
  }

  public get lastMouseCanvasPosition(): Point | undefined {
    return this.lastMouseCanvasPos ? { ...this.lastMouseCanvasPos } : undefined;
  }

  private handleMouseMove(e: MouseEvent): void {
    const clientPoint = this.getClientCoords(e);
    const canvasPoint = screenToCanvas(clientPoint, this.transform);
    this.lastMouseCanvasPos = canvasPoint;

    if (
      this.dragMode.type === "freehand" &&
      this.activeStroke &&
      this.freehandPathEl
    ) {
      const pointerEvt = e as unknown as { getCoalescedEvents?: () => MouseEvent[] };
      const rawEvents: MouseEvent[] =
        typeof pointerEvt.getCoalescedEvents === "function"
          ? pointerEvt.getCoalescedEvents()
          : [e];

      let added = false;
      for (const evt of rawEvents) {
        const clientPt = this.getClientCoords(evt);
        const pt = screenToCanvas(clientPt, this.transform);
        const pts = this.activeStroke.points;
        const lastPt = pts[pts.length - 1];

        // Skip sub-pixel jitter points (distance < 1.2px)
        const dx = pt.x - lastPt.x;
        const dy = pt.y - lastPt.y;
        if (dx * dx + dy * dy >= 1.44) {
          pts.push({
            x: pt.x,
            y: pt.y,
            pressure: (evt as unknown as PointerEvent).pressure ?? 0.5,
            time: Date.now(),
          });
          added = true;
        }
      }

      if (added || this.activeStroke.points.length <= 2) {
        const d = pointsToSmoothSvgPath(this.activeStroke.points);
        this.freehandPathEl.setAttribute("d", d);
      }
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
          const nodeEl = this.nodeElements.get(id);
          if (nodeEl) {
            nodeEl.setAttribute(
              "transform",
              `translate(${node.position.x}, ${node.position.y})`
            );
          }
        }
      }

      moveState.activeGuides = activeGuides;

      this.renderEdges();
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
            const nodeEl = this.nodeElements.get(id);
            if (nodeEl) {
              nodeEl.setAttribute(
                "transform",
                `translate(${node.position.x}, ${node.position.y})`
              );
            }
          }
        }
        if (moveState.initialGroupPositions) {
          for (const [gid, initialPos] of moveState.initialGroupPositions.entries()) {
            const grp = this.editor.diagram.groups.find((g) => g.id === gid);
            if (grp && grp.position) {
              grp.position = {
                x: Math.round(initialPos.x + dx),
                y: Math.round(initialPos.y + dy),
              };
            }
          }
        } else if (moveState.initialGroupPos) {
          const group = this.editor.diagram.groups.find((g) => g.id === moveState.groupId);
          if (group && group.position) {
            group.position = {
              x: Math.round(moveState.initialGroupPos.x + dx),
              y: Math.round(moveState.initialGroupPos.y + dy),
            };
          }
        }
        this.renderGroups();
        this.renderEdges();
        this.renderInteractions();
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

      const isCardNode = node.kind === "generic.pdf" || node.kind === "obsidian.note";
      const minW = isCardNode ? 140 : 60;
      const minH = isCardNode ? 100 : 40;

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

      if (node.kind === "generic.freehand" && node.customData && resizeState.initialPoints) {
        const initPts = resizeState.initialPoints;
        const initSize = resizeState.initialSize;
        if (initSize.width > 0 && initSize.height > 0) {
          const sx = newW / initSize.width;
          const sy = newH / initSize.height;
          const scaledPoints = initPts.map((p) => ({
            x: Math.round(p.x * sx * 10) / 10,
            y: Math.round(p.y * sy * 10) / 10,
          }));
          node.customData.points = scaledPoints;
          let newPathData: string;
          if (scaledPoints.length <= 3) {
            newPathData = scaledPoints.reduce(
              (acc, p, i) => `${acc}${i === 0 ? "M" : " L"} ${p.x},${p.y}`,
              ""
            );
          } else {
            newPathData = pointsToSmoothSvgPath(smoothPoints(scaledPoints));
          }
          if (
            newPathData.startsWith("M") &&
            !newPathData.includes("L") &&
            !newPathData.includes("l") &&
            !newPathData.includes("Z") &&
            !newPathData.includes("z") &&
            !newPathData.includes("Q") &&
            !newPathData.includes("q") &&
            !newPathData.includes("C") &&
            !newPathData.includes("c")
          ) {
            const coords = newPathData.substring(1).trim().split(/[ ,]+/);
            if (coords.length >= 2) {
              newPathData = `${newPathData} L ${coords[0]},${coords[1]}`;
            }
          }
          node.customData.pathData = newPathData;
        }
      }

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

      this.renderGroups();
      this.renderInteractions();
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
              const pt = getSidePoint(node.position, node.size, p.side, p.offset, node.kind);
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

    if (this.dragMode.type === "edge-move") {
      const moveState = this.dragMode;
      const dx = canvasPoint.x - moveState.startCanvas.x;
      const dy = canvasPoint.y - moveState.startCanvas.y;

      if (!moveState.moved && Math.hypot(dx, dy) > 2) {
        moveState.moved = true;
        this.container.classList.add("umlcanvas-moving");
      }

      if (moveState.moved) {
        for (const [edgeId, initWps] of moveState.initialWaypointsMap.entries()) {
          const edge = this.editor.diagram.edges.find((e) => e.id === edgeId);
          if (!edge) continue;

          if (initWps && initWps.length > 0) {
            edge.waypoints = initWps.map((p) => ({
              x: Math.round(p.x + dx),
              y: Math.round(p.y + dy),
            }));
          } else {
            const center = this.getEdgeCenter(edge);
            edge.waypoints = [
              {
                x: Math.round(center.x + dx),
                y: Math.round(center.y + dy),
              },
            ];
          }
        }
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

    if (
      this.dragMode.type === "none" &&
      !this.isFreehandMode &&
      !this.isGrabMode &&
      !this.isSpacePressed &&
      this.editor.selectedNodeIds.length <= 1
    ) {
      const hasTables = this.editor.diagram.nodes.some(
        (n) => n.kind === "generic.table"
      );
      if (hasTables) {
        let hoveredTableId: string | undefined;
        for (const node of this.editor.diagram.nodes) {
          if (node.kind === "generic.table" && this.editor.isNodeVisible(node.id) && !this.editor.isNodeLocked(node.id)) {
            const pad = 24;
            if (
              canvasPoint.x >= node.position.x - pad &&
              canvasPoint.x <= node.position.x + node.size.width + 40 &&
              canvasPoint.y >= node.position.y - pad &&
              canvasPoint.y <= node.position.y + node.size.height + 40
            ) {
              hoveredTableId = node.id;
              break;
            }
          }
        }
        if (hoveredTableId !== this.hoveredTableNodeId) {
          this.hoveredTableNodeId = hoveredTableId;
          this.renderInteractions();
        }
      } else if (this.hoveredTableNodeId) {
        this.hoveredTableNodeId = undefined;
        this.renderInteractions();
      }
    }
  }

  private handleMouseLeave(): void {
    this.cachedContainerRect = null;
    if (this.hoveredTableNodeId) {
      this.hoveredTableNodeId = undefined;
      this.renderInteractions();
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    const clientPoint = this.getClientCoords(e);
    const canvasPoint = screenToCanvas(clientPoint, this.transform);

    if (this.dragMode.type === "freehand") {
      this.cachedContainerRect = null;
      if (this.freehandPathEl) {
        this.freehandPathEl.remove();
        this.freehandPathEl = null;
      }
      if (this.activeStroke) {
        const stroke = this.activeStroke;
        this.activeStroke = null;

        // Ensure final point is captured if movement occurred
        const lastPt = stroke.points[stroke.points.length - 1];
        const dx = canvasPoint.x - lastPt.x;
        const dy = canvasPoint.y - lastPt.y;
        if (dx * dx + dy * dy >= 1.44) {
          stroke.points.push({
            x: canvasPoint.x,
            y: canvasPoint.y,
            pressure: (e as unknown as PointerEvent).pressure ?? 0.5,
            time: Date.now(),
          });
        }

        const shiftKeyHeld = Boolean(e.shiftKey);
        const effectiveAutoDetect = shiftKeyHeld ? !this.autoShapeDetection : this.autoShapeDetection;
        const isNormalDraw = !effectiveAutoDetect && !this.handwritingTextMode;

        // Discard micro-strokes / accidental clicks
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

        // In normal draw mode (not enhance/shape mode and not handwriting text mode),
        // we explicitly support short drawings, single-tap dots, and small marks.
        // In shape detection mode, micro-strokes (< 15px or < 4 points) are discarded as accidental clicks.
        const isMicroStroke = isNormalDraw
          ? stroke.points.length === 0
          : this.handwritingTextMode
          ? stroke.points.length < 2 || (width < 3 && height < 3)
          : stroke.points.length < 4 || (width < 15 && height < 15);

        if (!isMicroStroke) {
          if (stroke.points.length === 1) {
            stroke.points.push({ ...stroke.points[0] });
          }

          if (this.onStrokeComplete) {
            this.onStrokeComplete(stroke, {
              autoDetect: effectiveAutoDetect,
              handwritingText: this.handwritingTextMode,
            });
          } else {
            if (this.handwritingTextMode) {
              this.editor.handwriteTextFromStrokes([stroke]);
            } else if (effectiveAutoDetect) {
              this.editor.snapStrokeToShape(stroke, { select: false, fallbackToFreehand: true });
            } else {
              this.editor.keepAsFreehand(stroke, { select: false });
            }
          }
          if (this.editor.hasSelection) {
            this.editor.clearSelection();
          }
          this.renderInteractions();
        } else if (isMicroStroke) {
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey && this.editor.hasSelection) {
            this.editor.clearSelection();
          }
          this.renderInteractions();
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
      const moveState = this.dragMode;
      this.container.classList.remove("umlcanvas-moving");
      if (moveState.moved) {
        const moves: Array<{ nodeId: string; oldPos: Point; newPos: Point }> = [];
        for (const [id, initialPos] of moveState.initialPositions.entries()) {
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
      } else if (
        (moveState.wasAlreadySingleSelected || (moveState.clickedCell !== undefined && moveState.clickedNodeId)) &&
        moveState.clickedNodeId
      ) {
        const node = this.editor.diagram.nodes.find(
          (n) => n.id === moveState.clickedNodeId
        );
        if (
          node &&
          !this.editor.isNodeLocked(node.id) &&
          node.kind !== "obsidian.note" &&
          (node.kind !== "generic.pdf" || Boolean((e.target as HTMLElement | null)?.closest(".umlcanvas-pdf-title"))) &&
          node.kind !== "schematic.chip" &&
          node.kind !== "generic.freehand"
        ) {
          if (node.kind === "generic.table") {
            if (Date.now() - this.lastTableButtonActionTime < 350) {
              this.dragMode = { type: "none" };
              this.renderInteractions();
              return;
            }
            let r = 0;
            let c = 0;
            if (moveState.clickedCell) {
              r = moveState.clickedCell.row;
              c = moveState.clickedCell.col;
            } else {
              const cellEl = (e.target as HTMLElement | null)?.closest(".umlcanvas-table-cell");
              r = cellEl ? parseInt(cellEl.getAttribute("data-row") || "0", 10) : 0;
              c = cellEl ? parseInt(cellEl.getAttribute("data-col") || "0", 10) : 0;
            }
            this.dragMode = { type: "none" };
            this.renderInteractions();
            this.startInlineEditor(node, { row: r, col: c });
            return;
          }
          this.dragMode = { type: "none" };
          this.renderInteractions();
          this.startInlineEditor(node);
          return;
        }
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
        if (moveState.initialGroupPositions) {
          for (const [gid, initPos] of moveState.initialGroupPositions.entries()) {
            const grp = this.editor.diagram.groups.find((g) => g.id === gid);
            if (grp && grp.position) {
              grp.position = { ...initPos };
            }
          }
        } else if (moveState.initialGroupPos) {
          const group = this.editor.diagram.groups.find((g) => g.id === moveState.groupId);
          if (group && group.position) {
            group.position = { ...moveState.initialGroupPos };
          }
        }
        this.editor.moveGroup(moveState.groupId, {
          x: Math.round(dx),
          y: Math.round(dy),
        });
        this.dragMode = { type: "none" };
        this.render();
        return;
      } else if (
        (moveState.wasAlreadySingleSelected || moveState.isTitleClick) &&
        moveState.groupId
      ) {
        const group = this.editor.diagram.groups.find(
          (g) => g.id === moveState.groupId
        );
        if (group && !group.locked) {
          this.dragMode = { type: "none" };
          this.renderInteractions();
          this.startGroupInlineEditor(group);
          return;
        }
      }
      this.dragMode = { type: "none" };
      this.renderInteractions();
      return;
    }

    if (this.dragMode.type === "resize") {
      const resizeState = this.dragMode;
      const node = this.editor.diagram.nodes.find((n) => n.id === resizeState.nodeId);
      if (node) {
        this.editor.resizeNode(
          node.id,
          {
            position: resizeState.initialPosition,
            size: resizeState.initialSize,
            customData:
              node.kind === "generic.freehand" && resizeState.initialPoints
                ? {
                    points: resizeState.initialPoints,
                    pathData: resizeState.initialPathData,
                  }
                : undefined,
          },
          {
            position: { ...node.position },
            size: { ...node.size },
            customData:
              node.kind === "generic.freehand" && node.customData
                ? {
                    points: node.customData.points,
                    pathData: node.customData.pathData,
                  }
                : undefined,
          }
        );
      }
      this.container.classList.remove("umlcanvas-resizing");
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
      this.container.classList.remove("umlcanvas-resizing");
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
        this.dragMode = { type: "none" };
        this.renderInteractions();
        return;
      }

      const edgeDrag = this.dragMode;
      this.dragMode = { type: "none" };
      this.renderInteractions();

      const dx = edgeDrag.currentCanvasPoint.x - edgeDrag.startPoint.x;
      const dy = edgeDrag.currentCanvasPoint.y - edgeDrag.startPoint.y;
      const dist = Math.hypot(dx, dy);

      if (dist >= 10) {
        this.openArrowAttachmentPopup({
          fromNodeId: edgeDrag.fromNodeId,
          fromPortId: edgeDrag.fromPortId,
          fromSide: edgeDrag.fromSide,
          dropCanvasPoint: edgeDrag.currentCanvasPoint,
          dropClientPoint: clientPoint,
          startPoint: edgeDrag.startPoint,
        });
      }
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
      } else if (reconnectState.endpoint === "target") {
        this.editor.reconnectEdge(
          reconnectState.edgeId,
          reconnectState.endpoint,
          {
            point: canvasPoint,
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
        if ("originalWaypointsBeforeInsert" in waypointState) {
          edge.waypoints = waypointState.originalWaypointsBeforeInsert
            ? waypointState.originalWaypointsBeforeInsert.map((p) => ({ ...p }))
            : undefined;
        } else {
          edge.waypoints = waypointState.initialWaypoints.map((p) => ({ ...p }));
        }
        this.editor.updateEdgeWaypoints(edge.id, finalWaypoints);
      }
      this.render();
      return;
    }

    if (this.dragMode.type === "edge-move") {
      const moveState = this.dragMode;
      this.container.classList.remove("umlcanvas-moving");
      this.dragMode = { type: "none" };

      if (moveState.moved) {
        const moves: Array<{ edgeId: string; oldWaypoints?: Point[]; newWaypoints?: Point[] }> = [];
        for (const [edgeId, initWps] of moveState.initialWaypointsMap.entries()) {
          const edge = this.editor.diagram.edges.find((e) => e.id === edgeId);
          if (edge) {
            const finalWps = edge.waypoints ? edge.waypoints.map((p) => ({ ...p })) : undefined;
            edge.waypoints = initWps ? initWps.map((p) => ({ ...p })) : undefined;
            moves.push({
              edgeId,
              oldWaypoints: initWps,
              newWaypoints: finalWps,
            });
          }
        }
        if (moves.length > 0) {
          this.editor.moveEdges(moves);
        }
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
    if (this.isGrabMode) return;
    const clientPoint = this.getClientCoords(e);
    const canvasPoint = screenToCanvas(clientPoint, this.transform);
    const target = e.target as Element;

    if (
      (target && typeof target.closest === "function" && target.closest(".umlcanvas-table-canvas-btn")) ||
      Date.now() - this.lastTableButtonActionTime < 350
    ) {
      return;
    }

    // Double-click on waypoint handle -> remove waypoint
    if (target.classList.contains("umlcanvas-edge-waypoint-handle")) {
      const edgeId = target.getAttribute("data-edge-id")!;
      const waypointIndex = parseInt(target.getAttribute("data-waypoint-index")!, 10);
      this.editor.removeEdgeWaypoint(edgeId, waypointIndex);
      return;
    }

    // Double-click on edge endpoint handle for dangling edges -> reopen attachment popup
    if (target.classList.contains("umlcanvas-edge-endpoint-handle")) {
      const edgeId = target.getAttribute("data-edge-id")!;
      const endpoint = target.getAttribute("data-endpoint");
      if (endpoint === "target") {
        const edge = this.editor.diagram.edges.find((e) => e.id === edgeId);
        if (edge && edge.toPoint && !edge.toNodeId) {
          const fromNode = this.editor.diagram.nodes.find((n) => n.id === edge.fromNodeId);
          if (fromNode) {
            this.openArrowAttachmentPopup({
              fromNodeId: edge.fromNodeId,
              fromPortId: edge.fromPortId,
              fromSide: edge.fromSide,
              dropCanvasPoint: { ...edge.toPoint },
              dropClientPoint: clientPoint,
              startPoint: fromNode.position,
            });
            return;
          }
        }
      }
    }

    // Double-click on resize handle -> auto-resize node (F-Obsidian-Notes-Scalability)
    const resizeHandle = target.closest(".umlcanvas-resize-handle");
    if (resizeHandle) {
      const nodeId = resizeHandle.getAttribute("data-node-id");
      if (nodeId) {
        this.editor.autoResizeNode(nodeId);
        return;
      }
    }

    // Double-click on group header, title, card, or box -> rename group
    const groupHeader = target.closest(
      ".umlcanvas-group-header-bg, .umlcanvas-group-title, .umlcanvas-group-collapsed-card, .umlcanvas-group-box, .umlcanvas-group"
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
          if (target && target.closest(".umlcanvas-pdf-title")) {
            this.startInlineEditor(node);
            return;
          }
          if (
            (node.kind === "obsidian.note" ||
              node.kind === "generic.pdf" ||
              (node.metadata?.filePath && node.kind !== "generic.image"))
          ) {
            const filePath =
              (node.metadata?.filePath as string) ||
              (node.customData?.filePath as string);
            if (filePath && this.onNoteOpen) {
              const subpath =
                (node.metadata?.subpath as string) ||
                (node.customData?.subpath as string) ||
                "";
              const fullTarget = filePath + (subpath ? (subpath.startsWith("#") ? subpath : "#" + subpath) : "");
              this.onNoteOpen(fullTarget);
              return;
            } else if (!filePath && node.kind === "generic.pdf" && this.onPdfPick) {
              this.onPdfPick(node);
              return;
            }
          }
          if (node.kind === "schematic.chip" && this.onChipEdit) {
            this.onChipEdit(node);
            return;
          }
          if (node.kind === "generic.table") {
            const rows = Math.max(1, (node.customData?.rows as number) || 3);
            const cols = Math.max(1, (node.customData?.cols as number) || 3);
            const cellEl = target ? target.closest(".umlcanvas-table-cell") : null;
            let r = 0;
            let c = 0;
            if (cellEl) {
              r = parseInt(cellEl.getAttribute("data-row") || "0", 10);
              c = parseInt(cellEl.getAttribute("data-col") || "0", 10);
            } else {
              const clientPoint = this.getClientCoords(e);
              const canvasPoint = screenToCanvas(clientPoint, this.transform);
              const relX = canvasPoint.x - node.position.x;
              const relY = canvasPoint.y - node.position.y;
              const colW = node.size.width / cols;
              const rowH = node.size.height / rows;
              r = Math.max(0, Math.min(rows - 1, Math.floor(relY / rowH)));
              c = Math.max(0, Math.min(cols - 1, Math.floor(relX / colW)));
            }
            this.startInlineEditor(node, { row: r, col: c });
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
    const newNode = this.editor.addNode({
      position: {
        x: Math.round(canvasPoint.x - 80),
        y: Math.round(canvasPoint.y - 50),
      },
      title: "Node",
    });

    // Auto-containment: if double-clicked inside an expanded group, add to group
    if (newNode) {
      let targetGroup: Group | null = null;
      let minArea = Infinity;
      for (const group of this.editor.diagram.groups) {
        if (group.collapsed) continue;
        const bounds = this.getGroupBounds(group);
        if (
          canvasPoint.x >= bounds.position.x &&
          canvasPoint.x <= bounds.position.x + bounds.size.width &&
          canvasPoint.y >= bounds.position.y &&
          canvasPoint.y <= bounds.position.y + bounds.size.height
        ) {
          const area = bounds.size.width * bounds.size.height;
          if (area < minArea) {
            minArea = area;
            targetGroup = group;
          }
        }
      }
      if (targetGroup) {
        this.editor.addNodesToGroup(targetGroup.id, [newNode.id]);
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

  public getNodeInPlaceEditorBounds(
    node: DiagramNode,
    customText?: string
  ): {
    x: number;
    y: number;
    width: number;
    height: number;
    textAlign: "center" | "left" | "right";
  } {
    let inPlaceX = node.position.x;
    let inPlaceY = node.position.y;
    let inPlaceW = node.size.width;
    let inPlaceH = node.size.height;
    let textAlign: "center" | "left" | "right" = "center";

    const textToMeasure =
      customText !== undefined
        ? customText
        : this.inlineEditorEl &&
          this.inlineEditorEl.getAttribute("data-node-id") === node.id
        ? this.inlineEditorEl.value
        : node.labels[0]?.text ?? "";

    const lines = textToMeasure.split(/\r?\n/);
    const lineCount = Math.max(1, lines.length);

    const nodeFont = getNodeFontStyle(node);
    const baseFontSize = nodeFont.fontSize ?? 13;
    const lineHeight = Math.round(baseFontSize * 1.35);
    // Ensure content height accommodates font size and lines with vertical padding
    const contentH = Math.max(24, lineCount * lineHeight + 8);

    if (
      node.kind.startsWith("uml.class") ||
      node.kind === "uml.interface" ||
      node.kind === "uml.abstractClass" ||
      node.kind === "uml.enumeration" ||
      node.kind === "uml.object"
    ) {
      const stereoH = node.stereotype ? 14 : 0;
      const taggedH =
        node.taggedValues && Object.keys(node.taggedValues).length > 0 ? 12 : 0;
      inPlaceX = node.position.x + 8;
      inPlaceY = node.position.y + 4 + stereoH + taggedH;
      inPlaceW = Math.max(40, node.size.width - 16);
      inPlaceH = Math.max(28, contentH);
      textAlign = "center";
    } else if (node.kind === "uml.actor") {
      inPlaceH = Math.max(24, contentH);
      inPlaceX = node.position.x + 4;
      inPlaceY = node.position.y + Math.max(0, node.size.height - inPlaceH - 4);
      inPlaceW = Math.max(40, node.size.width - 8);
      textAlign = "center";
    } else if (node.kind === "generic.note") {
      inPlaceX = node.position.x + 10;
      inPlaceY = node.position.y + 10;
      inPlaceW = Math.max(40, node.size.width - 24);
      inPlaceH = Math.max(node.size.height - 20, contentH);
      textAlign = "left";
    } else if (node.kind === "generic.stickyNote") {
      inPlaceX = node.position.x + 10;
      inPlaceY = node.position.y + 24;
      inPlaceW = Math.max(40, node.size.width - 20);
      inPlaceH = Math.max(26, node.size.height - 32);
      textAlign = "left";
    } else if (node.kind === "generic.image") {
      inPlaceH = Math.max(28, contentH);
      inPlaceX = node.position.x + 8;
      inPlaceY = node.position.y + Math.max(0, node.size.height - inPlaceH - 10);
      inPlaceW = Math.max(40, node.size.width - 16);
      textAlign = "center";
    } else if (node.kind === "generic.pdf") {
      inPlaceH = 24;
      inPlaceX = node.position.x + 30;
      inPlaceY = node.position.y + 4;
      inPlaceW = Math.max(40, node.size.width - 60);
      textAlign = "left";
    } else if (node.kind === "generic.table") {
      const rows = Math.max(1, (node.customData?.rows as number) || 3);
      const cols = Math.max(1, (node.customData?.cols as number) || 3);
      const colW = node.size.width / cols;
      const rowH = node.size.height / rows;

      const rAttr = this.inlineEditorEl?.getAttribute("data-cell-row");
      const cAttr = this.inlineEditorEl?.getAttribute("data-cell-col");
      const r = rAttr !== null && rAttr !== undefined ? parseInt(rAttr, 10) : (this.editingCellRow ?? 0);
      const c = cAttr !== null && cAttr !== undefined ? parseInt(cAttr, 10) : (this.editingCellCol ?? 0);

      inPlaceX = node.position.x + c * colW + 4;
      inPlaceY = node.position.y + r * rowH + 4;
      inPlaceW = Math.max(20, colW - 8);
      inPlaceH = Math.max(20, rowH - 8);
      textAlign = "center";
    } else if (node.kind === "generic.text") {
      inPlaceX = node.position.x + 2;
      inPlaceY = node.position.y + 2;
      inPlaceW = Math.max(40, node.size.width - 4);
      inPlaceH = Math.max(24, contentH, node.size.height - 4);
      textAlign = "left";
    } else {
      // General shapes: vertically and horizontally centered in node
      inPlaceX = node.position.x + 8;
      inPlaceW = Math.max(40, node.size.width - 16);
      if (contentH <= node.size.height - 12) {
        inPlaceY = node.position.y + Math.max(6, (node.size.height - contentH) / 2);
        inPlaceH = Math.max(24, contentH);
      } else {
        inPlaceY = node.position.y + (node.size.height - contentH) / 2;
        inPlaceH = contentH;
      }
      textAlign = "center";
    }

    if (nodeFont.fontSize !== undefined && nodeFont.fontSize > 13) {
      if (node.kind !== "generic.stickyNote" && node.kind !== "generic.table") {
        const maxLineChars = lines.reduce((max, l) => Math.max(max, l.length), 0);
        const estimatedW = Math.ceil(maxLineChars * baseFontSize * 0.65 + 24);
        if (estimatedW > inPlaceW) {
          const extraW = estimatedW - inPlaceW;
          if (textAlign === "center") {
            inPlaceX -= extraW / 2;
          }
          inPlaceW = estimatedW;
        }
      }
    }

    return {
      x: inPlaceX,
      y: inPlaceY,
      width: inPlaceW,
      height: inPlaceH,
      textAlign,
    };
  }

  public updateInlineEditorPosition(): void {
    if (!this.inlineEditorEl) return;

    const nodeId = this.inlineEditorEl.getAttribute("data-node-id");
    if (nodeId) {
      const node = this.editor.diagram.nodes.find((n) => n.id === nodeId);
      if (node) {
        const bounds = this.getNodeInPlaceEditorBounds(
          node,
          this.inlineEditorEl.value
        );
        const screenPos = canvasToScreen({ x: bounds.x, y: bounds.y }, this.transform);
        const screenW = bounds.width * this.transform.zoom;
        const screenH = bounds.height * this.transform.zoom;
        const nodeFont = getNodeFontStyle(node);
        const baseFontSize = nodeFont.fontSize ?? 13;
        const fontSize = Math.max(10, Math.round(baseFontSize * this.transform.zoom));
        const lineHeight = Math.round(fontSize * 1.35);

        const styles: Record<string, string> = {
          left: `${screenPos.x}px`,
          top: `${screenPos.y}px`,
          width: `${screenW}px`,
          height: `${screenH}px`,
          fontSize: `${fontSize}px`,
          lineHeight: `${lineHeight}px`,
          textAlign: bounds.textAlign,
        };
        if (node.kind === "generic.table") {
          const cols = Math.max(1, (node.customData?.cols as number) || 3);
          const colW = node.size.width / cols;
          const availableW = Math.max(16, colW - 16);
          const isHdr = (this.editingCellRow ?? 0) === 0 && node.customData?.hasHeaderRow !== false;
          const charW = Math.max(4.5, fontSize * 0.58 * (nodeFont.bold || isHdr ? 1.1 : 1.0));
          const wrapped = wrapTextToLines(this.inlineEditorEl.value || "", availableW, charW);
          const textLines = Math.max(1, wrapped.length);
          const totalTextH = textLines * lineHeight;
          const padTop = Math.max(2, Math.floor((screenH - totalTextH) / 2));
          styles.paddingTop = `${padTop}px`;
        }
        styles.fontWeight = nodeFont.bold ? "bold" : "normal";
        styles.fontStyle = nodeFont.italic ? "italic" : "normal";
        if (nodeFont.fontFamily) {
          styles.fontFamily = nodeFont.fontFamily;
        } else {
          styles.fontFamily = "";
        }
        this.inlineEditorEl.setCssStyles(styles);
      }
      return;
    }

    const edgeId = this.inlineEditorEl.getAttribute("data-edge-id");
    if (edgeId) {
      const edge = this.editor.diagram.edges.find((ed) => ed.id === edgeId);
      if (edge) {
        const centerCanvas = this.getEdgeCenter(edge);
        const screenPos = canvasToScreen(centerCanvas, this.transform);
        const width = Math.max(120, 140 * this.transform.zoom);
        const edgeFont = getEdgeFontStyle(edge);
        const baseFontSize = edgeFont.fontSize ?? 11;
        const fontSize = Math.max(10, Math.round(baseFontSize * this.transform.zoom));
        const styles: Record<string, string> = {
          left: `${screenPos.x - width / 2}px`,
          top: `${screenPos.y - 14 * this.transform.zoom}px`,
          width: `${width}px`,
          fontSize: `${fontSize}px`,
        };
        styles.fontWeight = edgeFont.bold ? "bold" : "normal";
        styles.fontStyle = edgeFont.italic ? "italic" : "normal";
        if (edgeFont.fontFamily) {
          styles.fontFamily = edgeFont.fontFamily;
        } else {
          styles.fontFamily = "";
        }
        this.inlineEditorEl.setCssStyles(styles);
      }
      return;
    }

    const groupId = this.inlineEditorEl.getAttribute("data-group-id");
    if (groupId) {
      const group = this.editor.diagram.groups.find((g) => g.id === groupId);
      if (group) {
        const bounds = this.getGroupBounds(group);
        const screenPos = canvasToScreen(
          { x: bounds.position.x + 24, y: bounds.position.y + 4 },
          this.transform
        );
        const width = Math.max(
          120,
          Math.min(240, (bounds.size.width - 40) * this.transform.zoom)
        );
        const groupFont = getGroupFontStyle(group);
        const baseFontSize = groupFont.fontSize ?? 12;
        const fontSize = Math.max(10, Math.round(baseFontSize * this.transform.zoom));
        const styles: Record<string, string> = {
          left: `${screenPos.x}px`,
          top: `${screenPos.y}px`,
          width: `${width}px`,
          fontSize: `${fontSize}px`,
        };
        styles.fontWeight = groupFont.bold ? "bold" : "normal";
        styles.fontStyle = groupFont.italic ? "italic" : "normal";
        if (groupFont.fontFamily) {
          styles.fontFamily = groupFont.fontFamily;
        } else {
          styles.fontFamily = "";
        }
        this.inlineEditorEl.setCssStyles(styles);
      }
      return;
    }
  }

  private adjustInlineEditorHeight(): void {
    if (!this.inlineEditorEl) return;
    const nodeId = this.inlineEditorEl.getAttribute("data-node-id");
    if (!nodeId) return;
    const node = this.editor.diagram.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    if (node.kind === "generic.stickyNote" || node.kind === "generic.note") {
      const newText = this.inlineEditorEl.value;
      const nodeFont = getNodeFontStyle(node);
      const fontSize = nodeFont.fontSize ?? (node.kind === "generic.note" ? 11 : 13);
      const boldMultiplier = nodeFont.bold ? 1.1 : 1.0;
      const charWidth = Math.max(5, fontSize * 0.58 * boldMultiplier);
      const availableW = Math.max(40, node.size.width - (node.kind === "generic.stickyNote" ? 24 : 20));
      const wrapped = wrapTextToLines(newText, availableW, charWidth);
      const topOffset = node.kind === "generic.stickyNote" ? (26 + fontSize) : (14 + fontSize);
      const neededH = topOffset + Math.max(1, wrapped.length) * Math.round(fontSize * 1.38) + 12;
      if (neededH > node.size.height) {
        node.size = {
          width: node.size.width,
          height: Math.round(neededH),
        };
        this.renderNodes();
        this.renderInteractions();
      }
    } else if (node.kind === "generic.table") {
      const newText = this.inlineEditorEl.value;
      const rows = Math.max(1, (node.customData?.rows as number) || 3);
      const cols = Math.max(1, (node.customData?.cols as number) || 3);
      const colWidth = node.size.width / cols;
      const nodeFont = getNodeFontStyle(node);
      const fontSize = Math.max(10, (nodeFont.fontSize ?? 12) - (rows > 4 ? 2 : 0));
      const lineH = Math.round(fontSize * 1.35);
      const availableW = Math.max(16, colWidth - 16);
      const isHdr = (this.editingCellRow ?? 0) === 0 && node.customData?.hasHeaderRow !== false;
      const charWidth = Math.max(4.5, fontSize * 0.58 * (nodeFont.bold || isHdr ? 1.1 : 1.0));
      const wrapped = wrapTextToLines(newText, availableW, charWidth);
      const neededRowH = Math.max(1, wrapped.length) * lineH + 16;
      const neededTableH = Math.max(node.size.height, rows * neededRowH);
      if (neededTableH > node.size.height) {
        node.size = {
          width: node.size.width,
          height: Math.round(neededTableH),
        };
        this.renderNodes();
        this.renderInteractions();
      }
    }

    this.updateInlineEditorPosition();
  }

  public startInlineEditor(
    node: DiagramNode,
    cell?: { row: number; col: number }
  ): void {
    if (this.inlineEditorEl) {
      if (
        this.editingNodeId === node.id &&
        (node.kind !== "generic.table" ||
          (this.editingCellRow === cell?.row && this.editingCellCol === cell?.col))
      ) {
        this.inlineEditorEl.focus();
        return;
      }
      this.commitInlineEditor();
    }

    if (!this.editor.isNodeSelected(node.id)) {
      this.editor.selectNode(node.id, false);
    }

    this.editingNodeId = node.id;
    if (node.kind === "generic.table") {
      const rows = Math.max(1, (node.customData?.rows as number) || 3);
      const cols = Math.max(1, (node.customData?.cols as number) || 3);
      this.editingCellRow = Math.max(0, Math.min(rows - 1, cell?.row ?? 0));
      this.editingCellCol = Math.max(0, Math.min(cols - 1, cell?.col ?? 0));
    } else {
      this.editingCellRow = undefined;
      this.editingCellCol = undefined;
    }

    const nodeEl = this.nodesLayerEl.querySelector<SVGGElement>(
      `[data-node-id="${node.id}"]`
    );
    if (nodeEl) {
      nodeEl.classList.add("umlcanvas-node-editing");
      if (node.kind === "generic.table") {
        const cellEls = nodeEl.querySelectorAll(".umlcanvas-table-cell");
        cellEls.forEach((el) => {
          const r = parseInt(el.getAttribute("data-row") || "0", 10);
          const c = parseInt(el.getAttribute("data-col") || "0", 10);
          if (r === this.editingCellRow && c === this.editingCellCol) {
            el.classList.add("is-editing");
          } else {
            el.classList.remove("is-editing");
          }
        });
      }
    }

    let currentText = node.labels[0]?.text ?? "";
    if (node.kind === "generic.table") {
      const cells = (node.customData?.cells as string[][]) || [];
      currentText = cells[this.editingCellRow ?? 0]?.[this.editingCellCol ?? 0] ?? "";
    }

    if (node.kind === "generic.stickyNote" || node.kind === "generic.note") {
      const nodeFont = getNodeFontStyle(node);
      const fontSize = nodeFont.fontSize ?? (node.kind === "generic.note" ? 11 : 13);
      const boldMultiplier = nodeFont.bold ? 1.1 : 1.0;
      const charWidth = Math.max(5, fontSize * 0.58 * boldMultiplier);
      const availableW = Math.max(40, node.size.width - (node.kind === "generic.stickyNote" ? 24 : 20));
      const wrapped = wrapTextToLines(currentText, availableW, charWidth);
      const topOffset = node.kind === "generic.stickyNote" ? (26 + fontSize) : (14 + fontSize);
      const neededH = topOffset + Math.max(1, wrapped.length) * Math.round(fontSize * 1.38) + 12;
      if (neededH > node.size.height) {
        node.size = {
          width: node.size.width,
          height: Math.round(neededH),
        };
        this.renderNodes();
        this.renderInteractions();
      }
    }

    const bounds = this.getNodeInPlaceEditorBounds(node, currentText);
    const screenPos = canvasToScreen({ x: bounds.x, y: bounds.y }, this.transform);
    const screenW = bounds.width * this.transform.zoom;
    const screenH = bounds.height * this.transform.zoom;
    const nodeFont = getNodeFontStyle(node);
    const baseFontSize = nodeFont.fontSize ?? 13;
    const fontSize = Math.max(10, Math.round(baseFontSize * this.transform.zoom));
    const lineHeight = Math.round(fontSize * 1.35);

    const textarea = this.container.createEl("textarea", {
      cls: "umlcanvas-inline-editor umlcanvas-node-inline-editor",
      attr: {
        "data-node-id": node.id,
        "data-node-kind": node.kind,
        rows: "1",
        spellcheck: "false",
      },
    });
    if (node.kind === "generic.table") {
      textarea.setAttribute("data-cell-row", String(this.editingCellRow ?? 0));
      textarea.setAttribute("data-cell-col", String(this.editingCellCol ?? 0));
    }
    textarea.value = currentText;

    const styles: Record<string, string> = {
      left: `${screenPos.x}px`,
      top: `${screenPos.y}px`,
      width: `${screenW}px`,
      height: `${screenH}px`,
      fontSize: `${fontSize}px`,
      lineHeight: `${lineHeight}px`,
      textAlign: bounds.textAlign,
    };
    if (node.kind === "generic.table") {
      const cols = Math.max(1, (node.customData?.cols as number) || 3);
      const colW = node.size.width / cols;
      const availableW = Math.max(16, colW - 16);
      const isHdr = (this.editingCellRow ?? 0) === 0 && node.customData?.hasHeaderRow !== false;
      const charW = Math.max(4.5, fontSize * 0.58 * (nodeFont.bold || isHdr ? 1.1 : 1.0));
      const wrapped = wrapTextToLines(currentText || "", availableW, charW);
      const textLines = Math.max(1, wrapped.length);
      const totalTextH = textLines * lineHeight;
      const padTop = Math.max(2, Math.floor((screenH - totalTextH) / 2));
      styles.paddingTop = `${padTop}px`;
    }
    styles.fontWeight = nodeFont.bold ? "bold" : "normal";
    styles.fontStyle = nodeFont.italic ? "italic" : "normal";
    if (nodeFont.fontFamily) {
      styles.fontFamily = nodeFont.fontFamily;
    }
    textarea.setCssStyles(styles);

    textarea.addEventListener("keydown", (e: KeyboardEvent) => {
      e.stopPropagation();

      if (node.kind === "generic.table") {
        const rows = Math.max(1, (node.customData?.rows as number) || 3);
        const cols = Math.max(1, (node.customData?.cols as number) || 3);
        const r = this.editingCellRow ?? 0;
        const c = this.editingCellCol ?? 0;

        if (e.key === "Tab") {
          e.preventDefault();
          this.commitInlineEditor();
          if (!e.shiftKey && r === rows - 1 && c === cols - 1) {
            // Auto-expand table by appending a new row on Tab from the last cell
            this.editor.addTableRow(node.id);
            this.startInlineEditor(node, { row: rows, col: 0 });
            return;
          }
          const nextC = e.shiftKey ? (c > 0 ? c - 1 : cols - 1) : (c + 1 < cols ? c + 1 : 0);
          const nextR = e.shiftKey
            ? (c > 0 ? r : (r > 0 ? r - 1 : rows - 1))
            : (c + 1 < cols ? r : (r + 1 < rows ? r + 1 : 0));
          this.startInlineEditor(node, { row: nextR, col: nextC });
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this.commitInlineEditor();
          const nextR = r + 1 < rows ? r + 1 : 0;
          this.startInlineEditor(node, { row: nextR, col: c });
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        this.editor.toggleBoldForSelection();
        this.adjustInlineEditorHeight();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        this.editor.toggleItalicForSelection();
        this.adjustInlineEditorHeight();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "[") {
        e.preventDefault();
        this.editor.adjustFontSizeForSelection(-2);
        this.adjustInlineEditorHeight();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "]") {
        e.preventDefault();
        this.editor.adjustFontSizeForSelection(2);
        this.adjustInlineEditorHeight();
        return;
      }
      if (e.key === "Enter") {
        if (e.shiftKey) {
          // Shift+Enter inserts a newline for multiline in-place editing
          return;
        }
        // Enter, Ctrl+Enter, or Cmd+Enter commits the edit
        e.preventDefault();
        this.commitInlineEditor();
      } else if (e.key === "Escape") {
        e.preventDefault();
        // Native Obsidian canvas: Escape commits edited card content and returns to selection
        this.commitInlineEditor();
      }
    });

    textarea.addEventListener("blur", () => {
      this.commitInlineEditor();
    });

    textarea.addEventListener("input", () => {
      this.adjustInlineEditorHeight();
    });

    textarea.addEventListener("mousedown", (e: MouseEvent) => {
      e.stopPropagation();
    });
    textarea.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
    });
    textarea.addEventListener("dblclick", (e: MouseEvent) => {
      e.stopPropagation();
    });
    textarea.addEventListener("wheel", (e: WheelEvent) => {
      e.stopPropagation();
    });

    textarea.focus();
    if (typeof textarea.select === "function") {
      textarea.select();
    }
    this.inlineEditorEl = textarea;
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
        kind: fromNode.kind,
      },
      {
        id: toNode.id,
        position: toNode.position,
        size: toNode.size,
        side: toSide,
        portOffset: toPort?.offset,
        kind: toNode.kind,
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

  public findWaypointInsertIndex(edge: DiagramEdge, pt: Point): number {
    if (!edge.waypoints || edge.waypoints.length === 0) {
      return 0;
    }

    const fromNode = this.editor.diagram.nodes.find((n) => n.id === edge.fromNodeId);
    const toNode = this.editor.diagram.nodes.find((n) => n.id === edge.toNodeId);
    if (!fromNode || !toNode) {
      return edge.waypoints.length;
    }

    const fromPort = fromNode.ports?.find((p) => p.id === edge.fromPortId);
    const toPort = toNode.ports?.find((p) => p.id === edge.toPortId);
    const fromSide = fromPort?.side ?? edge.fromSide;
    const toSide = toPort?.side ?? edge.toSide;

    const fromPt = getSidePoint(
      fromNode.position,
      fromNode.size,
      fromSide ?? getFacingSide(fromNode.position, fromNode.size, getRectCenter(toNode.position, toNode.size)),
      fromPort?.offset ?? 0.5,
      fromNode.kind
    );
    const toPt = getSidePoint(
      toNode.position,
      toNode.size,
      toSide ?? getFacingSide(toNode.position, toNode.size, getRectCenter(fromNode.position, fromNode.size)),
      toPort?.offset ?? 0.5,
      toNode.kind
    );

    const fullPoints = [fromPt, ...edge.waypoints, toPt];
    let bestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < fullPoints.length - 1; i++) {
      const pA = fullPoints[i];
      const pB = fullPoints[i + 1];
      const dist = this.pointToSegmentDistance(pt, pA, pB);
      if (dist < minDistance) {
        minDistance = dist;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  private pointToSegmentDistance(p: Point, a: Point, b: Point): number {
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
  }

  public startEdgeInlineEditor(edge: DiagramEdge, atPoint?: Point): void {
    if (this.inlineEditorEl) {
      this.commitInlineEditor();
    }

    if (!this.editor.isEdgeSelected(edge.id)) {
      this.editor.selectEdge(edge.id, false);
    }

    const centerCanvas = atPoint ?? this.getEdgeCenter(edge);
    const screenPos = canvasToScreen(centerCanvas, this.transform);

    const width = Math.max(120, 140 * this.transform.zoom);
    const edgeFont = getEdgeFontStyle(edge);
    const baseFontSize = edgeFont.fontSize ?? 11;
    const fontSize = Math.max(10, Math.round(baseFontSize * this.transform.zoom));
    const input = this.container.createEl("input", {
      type: "text",
      value: edge.labels && edge.labels.length > 0 ? edge.labels[0].text : "",
      placeholder: "Line label...",
      cls: "umlcanvas-inline-editor umlcanvas-edge-inline-editor",
      attr: { "data-edge-id": edge.id },
    });
    const edgeStyles: Record<string, string> = {
      left: `${screenPos.x - width / 2}px`,
      top: `${screenPos.y - 14 * this.transform.zoom}px`,
      width: `${width}px`,
      fontSize: `${fontSize}px`,
    };
    edgeStyles.fontWeight = edgeFont.bold ? "bold" : "normal";
    edgeStyles.fontStyle = edgeFont.italic ? "italic" : "normal";
    if (edgeFont.fontFamily) {
      edgeStyles.fontFamily = edgeFont.fontFamily;
    }
    input.setCssStyles(edgeStyles);

    input.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        this.editor.toggleBoldForSelection();
        this.updateInlineEditorPosition();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        this.editor.toggleItalicForSelection();
        this.updateInlineEditorPosition();
        return;
      }
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

    input.focus();
    if (typeof input.select === "function") {
      input.select();
    }
    this.inlineEditorEl = input;
  }

  public startGroupInlineEditor(group: Group, atPoint?: Point): void {
    if (this.inlineEditorEl) {
      if (this.editingGroupId === group.id) {
        this.inlineEditorEl.focus();
        return;
      }
      this.commitInlineEditor();
    }

    if (!this.editor.isGroupSelected(group.id)) {
      this.editor.selectGroup(group.id, false);
    }

    this.editingGroupId = group.id;
    const groupEl = this.groupsLayerEl.querySelector<SVGGElement>(
      `[data-group-id="${group.id}"]`
    );
    if (groupEl) {
      groupEl.classList.add("umlcanvas-group-editing");
    }

    const bounds = this.getGroupBounds(group);
    const canvasPos = atPoint ?? { x: bounds.position.x + 24, y: bounds.position.y + 4 };
    const screenPos = canvasToScreen(canvasPos, this.transform);

    const width = Math.max(120, Math.min(240, (bounds.size.width - 40) * this.transform.zoom));
    const groupFont = getGroupFontStyle(group);
    const baseFontSize = groupFont.fontSize ?? 12;
    const fontSize = Math.max(10, Math.round(baseFontSize * this.transform.zoom));

    const input = this.container.createEl("input", {
      type: "text",
      value: group.name,
      placeholder: "Group title...",
      cls: "umlcanvas-inline-editor umlcanvas-group-inline-editor",
      attr: { "data-group-id": group.id },
    });
    const groupStyles: Record<string, string> = {
      left: `${screenPos.x}px`,
      top: `${screenPos.y}px`,
      width: `${width}px`,
      fontSize: `${fontSize}px`,
    };
    groupStyles.fontWeight = groupFont.bold ? "bold" : "normal";
    groupStyles.fontStyle = groupFont.italic ? "italic" : "normal";
    if (groupFont.fontFamily) {
      groupStyles.fontFamily = groupFont.fontFamily;
    }
    input.setCssStyles(groupStyles);

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        this.editor.toggleBoldForSelection();
        const updatedFont = getGroupFontStyle(group);
        input.setCssStyles({ fontWeight: updatedFont.bold ? "bold" : "normal" });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        this.editor.toggleItalicForSelection();
        const updatedFont = getGroupFontStyle(group);
        input.setCssStyles({ fontStyle: updatedFont.italic ? "italic" : "normal" });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        this.commitInlineEditor();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.commitInlineEditor();
      }
    });

    input.addEventListener("blur", () => {
      this.commitInlineEditor();
    });

    input.addEventListener("mousedown", (e: MouseEvent) => {
      e.stopPropagation();
    });
    input.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
    });
    input.addEventListener("dblclick", (e: MouseEvent) => {
      e.stopPropagation();
    });
    input.addEventListener("wheel", (e: WheelEvent) => {
      e.stopPropagation();
    });

    input.focus();
    if (typeof input.select === "function") {
      input.select();
    }
    this.inlineEditorEl = input;
  }

  public commitInlineEditor(): void {
    if (!this.inlineEditorEl) return;
    const nodeId = this.inlineEditorEl.getAttribute("data-node-id");
    const edgeId = this.inlineEditorEl.getAttribute("data-edge-id");
    const groupId = this.inlineEditorEl.getAttribute("data-group-id");
    const cellRowAttr = this.inlineEditorEl.getAttribute("data-cell-row");
    const cellColAttr = this.inlineEditorEl.getAttribute("data-cell-col");
    const r = cellRowAttr !== null && cellRowAttr !== "" ? parseInt(cellRowAttr, 10) : (this.editingCellRow ?? 0);
    const c = cellColAttr !== null && cellColAttr !== "" ? parseInt(cellColAttr, 10) : (this.editingCellCol ?? 0);
    const newText = this.inlineEditorEl.value.trim();

    this.cleanupInlineEditor();

    if (nodeId) {
      const node = this.editor.diagram.nodes.find((n) => n.id === nodeId);
      if (node) {
        if (node.kind === "generic.table") {
          this.editor.updateTableCell(node.id, r, c, newText);
          const tableData = getTableDataFromNode(node);
          const rows = Math.max(1, tableData.rows || 3);
          const cols = Math.max(1, tableData.cols || 3);
          const colWidth = node.size.width / cols;
          const nodeFont = getNodeFontStyle(node);
          const fontSize = Math.max(10, (nodeFont.fontSize ?? 12) - (rows > 4 ? 2 : 0));
          const lineH = Math.round(fontSize * 1.35);
          const availableW = Math.max(16, colWidth - 16);

          const cells = tableData.cells || [];
          let maxNeededRowH = 0;
          for (let rowIdx = 0; rowIdx < rows; rowIdx++) {
            let maxLinesInRow = 1;
            for (let colIdx = 0; colIdx < cols; colIdx++) {
              let text = cells[rowIdx]?.[colIdx] ?? "";
              if (!text && rowIdx === 0 && tableData.headers?.[colIdx]) {
                text = tableData.headers[colIdx];
              }
              if (text) {
                const isHdr = rowIdx === 0 && tableData.hasHeaderRow !== false;
                const cellCharW = Math.max(4.5, fontSize * 0.58 * (nodeFont.bold || isHdr ? 1.1 : 1.0));
                const cellLines = wrapTextToLines(text, availableW, cellCharW);
                if (cellLines.length > maxLinesInRow) {
                  maxLinesInRow = cellLines.length;
                }
              }
            }
            const neededForThisRow = maxLinesInRow * lineH + 16;
            if (neededForThisRow > maxNeededRowH) {
              maxNeededRowH = neededForThisRow;
            }
          }

          const neededTableH = Math.max(node.size.height, rows * maxNeededRowH);
          if (neededTableH > node.size.height) {
            node.size = {
              width: node.size.width,
              height: Math.round(neededTableH),
            };
          }

          this.renderNodes();
          this.renderInteractions();
          return;
        }

        const nodeFont = getNodeFontStyle(node);
        const fontSize = nodeFont.fontSize ?? (node.kind === "generic.note" ? 11 : 13);
        const boldMultiplier = nodeFont.bold ? 1.1 : 1.0;
        const charWidth = Math.max(5, fontSize * 0.58 * boldMultiplier);
        const lines = newText.split(/\r?\n/);
        const lineSpacing = Math.round(fontSize * 1.35);

        if (node.kind === "generic.text") {
          const maxLineLen = lines.reduce((max, l) => Math.max(max, l.length), 1);
          const neededW = Math.max(50, Math.round(maxLineLen * charWidth + 24));
          const neededH = Math.max(30, Math.round(lines.length * lineSpacing + 16));
          node.size = {
            width: neededW,
            height: neededH,
          };
        } else if (node.kind === "generic.stickyNote" || node.kind === "generic.note") {
          const availableW = Math.max(40, node.size.width - (node.kind === "generic.stickyNote" ? 24 : 20));
          const wrapped = wrapTextToLines(newText, availableW, charWidth);
          const topOffset = node.kind === "generic.stickyNote" ? (26 + fontSize) : (14 + fontSize);
          const neededH = topOffset + Math.max(1, wrapped.length) * Math.round(fontSize * 1.38) + 12;
          if (neededH > node.size.height) {
            node.size = {
              width: node.size.width,
              height: Math.round(neededH),
            };
          }
        } else if (lines.length > 1 || fontSize > 14) {
          const neededH = Math.max(node.size.height, lines.length * lineSpacing + 28);
          if (neededH > node.size.height) {
            node.size = {
              width: node.size.width,
              height: Math.round(neededH),
            };
          }
        }
      }
      this.editor.updateNodeLabel(nodeId, newText);
    } else if (edgeId) {
      this.editor.updateEdgeLabel(edgeId, newText);
    } else if (groupId && newText) {
      this.editor.renameGroup(groupId, newText);
    }
  }

  public cancelInlineEditor(): void {
    this.cleanupInlineEditor();
    this.render();
  }

  public cleanupInlineEditor(): void {
    if (this.nodesLayerEl) {
      const editingCells = this.nodesLayerEl.querySelectorAll(".is-editing");
      editingCells.forEach((el) => el.classList.remove("is-editing"));
      const editingNodes = this.nodesLayerEl.querySelectorAll(".umlcanvas-node-editing");
      editingNodes.forEach((el) => el.classList.remove("umlcanvas-node-editing"));
    }
    this.editingNodeId = null;
    this.editingCellRow = undefined;
    this.editingCellCol = undefined;
    if (this.editingGroupId) {
      const groupEl = this.groupsLayerEl.querySelector<SVGGElement>(
        `[data-group-id="${this.editingGroupId}"]`
      );
      if (groupEl) {
        groupEl.classList.remove("umlcanvas-group-editing");
      }
      this.editingGroupId = null;
    }
    if (this.inlineEditorEl) {
      this.inlineEditorEl.remove();
      this.inlineEditorEl = null;
    }
  }

  public get activeEditingNodeId(): string | null {
    return this.editingNodeId;
  }

  public get activeEditingGroupId(): string | null {
    return this.editingGroupId;
  }

  public get activeInlineEditor(): HTMLInputElement | HTMLTextAreaElement | null {
    return this.inlineEditorEl;
  }

  public get activeEditingCell(): { row: number; col: number } | null {
    if (this.editingCellRow !== undefined && this.editingCellCol !== undefined) {
      return { row: this.editingCellRow, col: this.editingCellCol };
    }
    return null;
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
          this.startInlineEditor(
            node,
            node.kind === "generic.table" ? { row: 0, col: 0 } : undefined
          );
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

    // Bold toggle: Ctrl+B / Cmd+B
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      if (hasSelection) {
        e.preventDefault();
        this.editor.toggleBoldForSelection();
        return;
      }
    }

    // Italic toggle: Ctrl+I / Cmd+I
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
      if (hasSelection) {
        e.preventDefault();
        this.editor.toggleItalicForSelection();
        return;
      }
    }

    // Font size increase: Ctrl+] / Cmd+] or Ctrl+= / Cmd+=
    if ((e.ctrlKey || e.metaKey) && (e.key === "]" || e.key === "}" || e.key === "=" || e.key === "+")) {
      if (hasSelection) {
        e.preventDefault();
        this.editor.adjustFontSizeForSelection(2);
        return;
      }
    }

    // Font size decrease: Ctrl+[ / Cmd+[ or Ctrl+- / Cmd+-
    if ((e.ctrlKey || e.metaKey) && (e.key === "[" || e.key === "{" || e.key === "-")) {
      if (hasSelection) {
        e.preventDefault();
        this.editor.adjustFontSizeForSelection(-2);
        return;
      }
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
      if (this.onPasteRequested) {
        e.preventDefault();
        this.onPasteRequested(this.lastMouseCanvasPos ?? undefined);
        return;
      }
      e.preventDefault();
      this.editor.paste(this.lastMouseCanvasPos ?? undefined);
      return;
    }

    // Arrow keys nudge selected nodes or edges
    if (
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight"
    ) {
      const step = e.shiftKey ? 20 : 5;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;

      if (this.editor.selectedNodeIds.length > 0) {
        e.preventDefault();
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
      } else if (this.editor.selectedEdgeIds.length > 0) {
        e.preventDefault();
        const moves: Array<{ edgeId: string; oldWaypoints?: Point[]; newWaypoints?: Point[] }> = [];
        for (const edgeId of this.editor.selectedEdgeIds) {
          const edge = this.editor.diagram.edges.find((e) => e.id === edgeId);
          if (!edge) continue;
          const oldWps = edge.waypoints ? edge.waypoints.map((p) => ({ ...p })) : undefined;
          let newWps: Point[];
          if (oldWps && oldWps.length > 0) {
            newWps = oldWps.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          } else {
            const center = this.getEdgeCenter(edge);
            newWps = [{ x: center.x + dx, y: center.y + dy }];
          }
          moves.push({ edgeId: edge.id, oldWaypoints: oldWps, newWaypoints: newWps });
        }
        if (moves.length > 0) {
          this.editor.moveEdges(moves);
        }
      } else if (this.editor.selectedGroupIds.length > 0) {
        e.preventDefault();
        const selectedGroupIds = this.editor.selectedGroupIds;
        const topLevelSelectedGroupIds = selectedGroupIds.filter((gid) => {
          const g = this.editor.diagram.groups.find((group) => group.id === gid);
          if (!g) return false;
          return !selectedGroupIds.some((otherId) => {
            if (otherId === gid) return false;
            const otherG = this.editor.diagram.groups.find((group) => group.id === otherId);
            if (!otherG) return false;
            return getDescendantGroups(this.editor.diagram, otherG).some((dg) => dg.id === gid);
          });
        });
        for (const groupId of topLevelSelectedGroupIds) {
          const group = this.editor.diagram.groups.find((g) => g.id === groupId);
          if (group && !group.locked) {
            this.editor.moveGroup(groupId, { x: dx, y: dy });
          }
        }
        return;
      }
    }

    // Group Box tool shortcut: G (without Ctrl/Cmd: add standalone group box at center if no selection)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "g" && !this.freehandMode) {
      if (this.editor.selectedNodeIds.length === 0 && this.editor.selectedGroupIds.length === 0 && this.editor.selectedEdgeIds.length === 0) {
        e.preventDefault();
        const centerCanvas = screenToCanvas(
          { x: this.container.clientWidth / 2, y: this.container.clientHeight / 2 },
          this.transform
        );
        this.editor.addGroup({
          name: "Group",
          position: {
            x: Math.round(centerCanvas.x - 160),
            y: Math.round(centerCanvas.y - 110),
          },
          size: { width: 320, height: 220 },
        });
        return;
      }
    }

    // Escape: dismiss arrow attachment popup, exit grab mode or freehand mode or deselect
    if (e.key === "Escape") {
      if (this.arrowAttachmentState) {
        e.preventDefault();
        this.dismissArrowAttachmentPopupToEmptySpace();
        return;
      }
      if (this.isGrabMode) {
        e.preventDefault();
        this.setGrabMode(false);
        return;
      }
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
      if (this.isFreehandMode || this.isGrabMode) {
        e.preventDefault();
        this.setFreehandMode(false);
        this.setGrabMode(false);
        return;
      }
    }

    // Grab tool shortcut: H
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "h") {
      e.preventDefault();
      this.setGrabMode(!this.isGrabMode);
      return;
    }

    // Connector / Line tool shortcut: L (connect 2 selected nodes)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "l") {
      if (this.editor.selectedNodeIds.length === 2) {
        e.preventDefault();
        const [fromId, toId] = this.editor.selectedNodeIds;
        this.editor.addEdge(fromId, toId, {
          kind: this.editor.activeEdgeKind,
          routing: this.editor.defaultRouting,
        });
        return;
      }
    }

    // Draw tool shortcut: P (toggle Draw mode) or Shift+P (toggle Auto Shape detection)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "p" && this.enableFreehand) {
      if (e.shiftKey) {
        e.preventDefault();
        const isAutoShapeActive = this.isFreehandMode && this.autoShapeDetection;
        if (isAutoShapeActive) {
          this.setFreehandMode(false);
        } else {
          this.setAutoShapeDetection(true);
          this.setFreehandMode(true);
        }
        return;
      } else {
        e.preventDefault();
        const isDrawActive = this.isFreehandMode && !this.autoShapeDetection && !this.handwritingTextMode;
        if (isDrawActive) {
          this.setFreehandMode(false);
        } else {
          this.setAutoShapeDetection(false);
          this.setHandwritingTextMode(false);
          this.setFreehandMode(true);
        }
        return;
      }
    }

    // Handwrite Text tool shortcut: W or Shift+W (toggle Handwrite Text mode)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "w" && this.enableFreehand) {
      e.preventDefault();
      const isHandwriteActive = this.isFreehandMode && this.handwritingTextMode;
      if (isHandwriteActive) {
        this.setFreehandMode(false);
        this.setHandwritingTextMode(false);
      } else {
        this.setAutoShapeDetection(false);
        this.setHandwritingTextMode(true);
        this.setFreehandMode(true);
      }
      return;
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (e.code === "Space") {
      this.isSpacePressed = false;
      this.container.classList.remove("umlcanvas-space-pressed");
    }
  }

  public toggleNoteScaleMode(nodeId: string): void {
    const node = this.editor.diagram.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const currentMode = node.customData?.scaleMode ?? "fit";
    const nextMode = currentMode === "fit" ? "custom" : "fit";
    const nextScale = nextMode === "custom" ? 1.0 : undefined;
    this.editor.updateNode(nodeId, {
      customData: {
        ...node.customData,
        scaleMode: nextMode,
        ...(nextScale !== undefined ? { scale: nextScale } : {}),
      },
    });
  }

  public adjustNoteScale(nodeId: string, delta: number): void {
    const node = this.editor.diagram.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const currentScale =
      typeof node.customData?.scale === "number"
        ? node.customData.scale
        : (node.customData?.scaleMode === "fit" ? this.getNoteFitScale(node) : 1.0);
    const newScale = Math.round(Math.max(0.15, Math.min(3.0, currentScale + delta)) * 100) / 100;
    this.editor.updateNode(nodeId, {
      customData: {
        ...node.customData,
        scaleMode: "custom",
        scale: newScale,
      },
    });
  }

  public getNoteFitScale(node: DiagramNode): number {
    const bodyHeight = Math.max(10, node.size.height - 32);
    const markdown =
      (node.customData?.content as string) ||
      (node.customData?.snippet as string) ||
      "";
    const estHeight =
      typeof node.customData?.contentHeight === "number" && node.customData.contentHeight > 0
        ? node.customData.contentHeight
        : estimateMarkdownContentHeight(markdown, node.size.width);
    if (estHeight <= bodyHeight) return 1.0;
    return Math.round(Math.max(0.15, Math.min(1.0, bodyHeight / estHeight)) * 100) / 100;
  }

  public canvasToScreenPoint(pt: Point): Point {
    return canvasToScreen(pt, this.transform);
  }

  public openArrowAttachmentPopup(context: ArrowAttachmentContext): ArrowAttachmentPopup {
    this.closeArrowAttachmentPopup();
    this.arrowAttachmentState = context;
    this.renderInteractions();

    const screenPos = canvasToScreen(context.dropCanvasPoint, this.transform);

    const popup = new ArrowAttachmentPopup({
      container: this.container,
      position: screenPos,
      canvasPoint: context.dropCanvasPoint,
      fromNodeId: context.fromNodeId,
      fromPortId: context.fromPortId,
      fromSide: context.fromSide,
      startPoint: context.startPoint,
      onSelect: (item) => {
        this.attachShapeToArrow(item);
      },
      onDismissToEmpty: () => {
        this.dismissArrowAttachmentPopupToEmptySpace();
      },
      onOpenVaultNote: this.onOpenVaultNote
        ? () => {
            this.onOpenVaultNote?.((file: VaultFileLike) => {
              const item = DEFAULT_ATTACHMENT_ITEMS.find((it) => it.id === "vault-note")!;
              const res = this.attachShapeToArrow(item);
              if (res && file) {
                this.editor.updateNode(res.node.id, {
                  title: file.basename ?? file.name ?? "Note",
                  metadata: { filePath: file.path },
                  customData: { filePath: file.path },
                });
              }
            });
          }
        : undefined,
      onOpenVaultImage: this.onOpenVaultImage
        ? () => {
            this.onOpenVaultImage?.((img: VaultImageLike | string) => {
              const item = DEFAULT_ATTACHMENT_ITEMS.find((it) => it.id === "image")!;
              const res = this.attachShapeToArrow(item);
              if (res && img) {
                const src = typeof img === "string" ? img : (img.src || img.path || "");
                this.editor.updateNode(res.node.id, {
                  metadata: { src },
                  customData: { src },
                });
              }
            });
          }
        : undefined,
    });

    popup.open();
    this.arrowAttachmentPopup = popup;
    return popup;
  }

  public closeArrowAttachmentPopup(): void {
    if (this.arrowAttachmentPopup) {
      const p = this.arrowAttachmentPopup;
      this.arrowAttachmentPopup = null;
      p.close();
    }
    this.arrowAttachmentState = null;
    this.renderInteractions();
  }

  public isArrowAttachmentPopupOpen(): boolean {
    return Boolean(this.arrowAttachmentPopup && this.arrowAttachmentPopup.isOpen);
  }

  public getArrowAttachmentPopup(): ArrowAttachmentPopup | null {
    return this.arrowAttachmentPopup;
  }

  public dismissArrowAttachmentPopupToEmptySpace(): DiagramEdge | null {
    if (!this.arrowAttachmentState) return null;
    const ctx = this.arrowAttachmentState;
    this.closeArrowAttachmentPopup();

    const edge = this.editor.addEdge(ctx.fromNodeId, "", {
      fromPortId: ctx.fromPortId,
      fromSide: ctx.fromSide,
      toPoint: ctx.dropCanvasPoint,
      kind: this.editor.activeEdgeKind,
      routing: this.editor.defaultRouting,
    });

    this.editor.clearSelection();
    this.editor.selectEdge(edge.id, false);
    this.render();
    return edge;
  }

  public attachShapeToArrow(
    itemOrId: ArrowAttachmentItem | string
  ): { node: DiagramNode; edge: DiagramEdge } | null {
    if (!this.arrowAttachmentState) return null;
    const ctx = this.arrowAttachmentState;
    this.closeArrowAttachmentPopup();

    let item: ArrowAttachmentItem | undefined;
    if (typeof itemOrId === "string") {
      item = DEFAULT_ATTACHMENT_ITEMS.find((it) => it.id === itemOrId || it.kind === itemOrId);
      if (!item) {
        item = {
          id: itemOrId,
          kind: itemOrId,
          label: itemOrId,
          title: itemOrId,
          description: "",
          defaultSize: { width: 140, height: 80 },
        };
      }
    } else {
      item = itemOrId;
    }

    const dx = ctx.dropCanvasPoint.x - ctx.startPoint.x;
    const dy = ctx.dropCanvasPoint.y - ctx.startPoint.y;
    const w = item.defaultSize.width;
    const h = item.defaultSize.height;

    let toSide: Side;
    let posX = ctx.dropCanvasPoint.x;
    let posY = ctx.dropCanvasPoint.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) {
        toSide = "left";
        posX = Math.round(ctx.dropCanvasPoint.x);
        posY = Math.round(ctx.dropCanvasPoint.y - h / 2);
      } else {
        toSide = "right";
        posX = Math.round(ctx.dropCanvasPoint.x - w);
        posY = Math.round(ctx.dropCanvasPoint.y - h / 2);
      }
    } else {
      if (dy >= 0) {
        toSide = "top";
        posX = Math.round(ctx.dropCanvasPoint.x - w / 2);
        posY = Math.round(ctx.dropCanvasPoint.y);
      } else {
        toSide = "bottom";
        posX = Math.round(ctx.dropCanvasPoint.x - w / 2);
        posY = Math.round(ctx.dropCanvasPoint.y - h);
      }
    }

    const nodeParams: {
      kind: string;
      title: string;
      position: Point;
      size: Size;
      style?: { color?: string };
      customData?: Record<string, unknown>;
    } = {
      kind: item.kind,
      title: item.title,
      position: { x: posX, y: posY },
      size: { width: w, height: h },
    };
    if (item.color) {
      nodeParams.style = { color: item.color };
    }
    if (item.customData) {
      nodeParams.customData = JSON.parse(JSON.stringify(item.customData)) as Record<string, unknown>;
    }

    const newNode = this.editor.addNode(nodeParams);

    const edge = this.editor.addEdge(ctx.fromNodeId, newNode.id, {
      fromPortId: ctx.fromPortId,
      fromSide: ctx.fromSide,
      toSide,
      kind: this.editor.activeEdgeKind,
      routing: this.editor.defaultRouting,
    });

    if (item.id === "vault-note" && this.onOpenVaultNote) {
      this.onOpenVaultNote((file: VaultFileLike) => {
        if (file) {
          this.editor.updateNode(newNode.id, {
            title: file.basename ?? file.name ?? "Note",
            metadata: { filePath: file.path },
            customData: { filePath: file.path },
          });
        }
      });
    }

    if (item.id === "image" && this.onOpenVaultImage) {
      this.onOpenVaultImage((img: VaultImageLike | string) => {
        if (img) {
          const src = typeof img === "string" ? img : (img.src || img.path || "");
          this.editor.updateNode(newNode.id, {
            metadata: { src },
            customData: { src },
          });
        }
      });
    }

    this.editor.clearSelection();
    this.editor.selectNode(newNode.id, false);
    this.render();

    // Start inline editor for instant typing!
    if (item.kind === "generic.table") {
      this.startInlineEditor(newNode, { row: 0, col: 0 });
    } else if (
      item.kind === "generic.rectangle" ||
      item.kind === "generic.stickyNote" ||
      item.kind === "generic.text" ||
      item.kind === "uml.class"
    ) {
      this.startInlineEditor(newNode);
    }

    return { node: newNode, edge };
  }

  destroy(): void {
    if (
      this.animationFrameId !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.renderScheduled = false;

    this.closeArrowAttachmentPopup();
    this.cleanupInlineEditor();

    this.container.classList.remove("umlcanvas-moving");
    this.container.classList.remove("umlcanvas-freehand-mode");
    this.container.classList.remove("umlcanvas-grab-mode");
    this.container.classList.remove("umlcanvas-space-pressed");
    this.container.classList.remove("umlcanvas-panning");

    this.svgEl.removeEventListener("wheel", this.onWheelBound);
    this.svgEl.removeEventListener("mousedown", this.onMouseDownBound);
    this.container.removeEventListener("mousedown", this.onMouseDownBound);
    window.removeEventListener("mousemove", this.onMouseMoveBound);
    window.removeEventListener("mouseup", this.onMouseUpBound);
    window.removeEventListener("keydown", this.onKeyDownBound);
    window.removeEventListener("keyup", this.onKeyUpBound);
    this.svgEl.removeEventListener("dblclick", this.onDblClickBound);
    this.svgEl.removeEventListener("contextmenu", this.onContextMenuBound);
    this.svgEl.removeEventListener("dragover", this.onDragOverBound);
    this.svgEl.removeEventListener("drop", this.onDropBound);
    this.svgEl.removeEventListener("mouseleave", this.onMouseLeaveBound);
    if (this.onWindowResizeBound) {
      window.removeEventListener("resize", this.onWindowResizeBound);
    }

    if (this.unsubscribeEditor) {
      this.unsubscribeEditor();
      this.unsubscribeEditor = null;
    }

    this.nodeElements.clear();
    this.nodeSignatures.clear();
    this.edgeElements.clear();
    this.edgeSignatures.clear();
    this.edgeRouteCache.clear();
    this.groupElements.clear();
    this.groupSignatures.clear();
    this.lastVirtualizationCenter = null;
    this.cachedContainerRect = null;

    this.markerTemplates.clear();
    this.createdMarkerIds.clear();

    this.svgEl.remove();
  }
}
