import { DiagramEditor } from "../../application/use-cases/DiagramEditor";
import { SvgSceneRenderer } from "../renderer/SvgSceneRenderer";
import { ShapeRegistry, ShapeDefinition } from "../renderer/ShapeRegistry";
import { defaultEdgeStyleRegistry, EdgeStyleDefinition } from "../renderer/EdgeStyleRegistry";
import { createDiagramNode } from "../../domain/entities/DiagramNode";
import { ChipInterfaceDefinition } from "../../domain/entities/ChipInterfaceDefinition";
import { defaultCustomChipRegistry } from "../../domain/services/CustomChipRegistry";

export interface ShapeCategory {
  id: string;
  name: string;
  shapeKinds: string[];
}

export const SHAPE_CATEGORIES: ShapeCategory[] = [
  {
    id: "general",
    name: "General Shapes",
    shapeKinds: ["generic.rectangle", "generic.note", "obsidian.note"],
  },
  {
    id: "class",
    name: "Class & Object",
    shapeKinds: [
      "uml.class",
      "uml.interface",
      "uml.abstractClass",
      "uml.enumeration",
      "uml.object",
      "uml.package",
    ],
  },
  {
    id: "usecase",
    name: "Use Case",
    shapeKinds: ["uml.actor", "uml.usecase", "uml.systemBoundary"],
  },
  {
    id: "activity",
    name: "Activity Diagram",
    shapeKinds: [
      "activity.action",
      "activity.initial",
      "activity.final",
      "activity.decision",
      "activity.forkJoin",
      "activity.swimlane",
    ],
  },
  {
    id: "state",
    name: "State Machine",
    shapeKinds: [
      "state.simple",
      "state.initial",
      "state.final",
      "state.composite",
      "state.choice",
      "state.forkJoin",
    ],
  },
  {
    id: "sequence",
    name: "Sequence Diagram",
    shapeKinds: [
      "sequence.lifeline",
      "sequence.activation",
      "interaction.frame",
      "interaction.occurrence",
    ],
  },
  {
    id: "component",
    name: "Component & Composite",
    shapeKinds: [
      "uml.component",
      "uml.lollipop",
      "uml.socket",
      "uml.port",
      "uml.componentPort",
      "uml.compositeClassifier",
      "uml.part",
    ],
  },
  {
    id: "deployment",
    name: "Deployment Diagram",
    shapeKinds: [
      "uml.node3d",
      "uml.device",
      "uml.executionEnvironment",
      "uml.artifact",
    ],
  },
  {
    id: "timing",
    name: "Timing Diagram",
    shapeKinds: ["timing.lane", "timing.stateSegment"],
  },
  {
    id: "profile",
    name: "Profile Diagram",
    shapeKinds: ["uml.stereotype", "uml.metaclass"],
  },
  {
    id: "schematic",
    name: "Schematic & Circuit",
    shapeKinds: [
      "schematic.chip",
      "schematic.junction",
      "schematic.ground",
      "schematic.powerRail",
      "schematic.busTap",
    ],
  },
  {
    id: "customChips",
    name: "Custom Chips",
    shapeKinds: [],
  },
];

export const DEFAULT_PALETTE_WIDTH = 320;
export const MIN_PALETTE_WIDTH = 240;
export const MAX_PALETTE_WIDTH = 800;
export const STORAGE_KEY_PALETTE_WIDTH = "umlcanvas-palette-width";

export class PalettePanel {
  private panelEl: HTMLElement;
  private resizeHandleEl: HTMLElement;
  private toggleTabEl: HTMLElement;
  private contentEl: HTMLElement;
  private searchInput: HTMLInputElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private customChipUnsubscribe: (() => void) | null = null;
  private collapsedCategories = new Set<string>();
  private isOpenState = false;
  private currentWidth: number = DEFAULT_PALETTE_WIDTH;
  private isResizing = false;
  private startX = 0;
  private startWidth = 0;
  private boundOnMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundOnMouseUp: ((e: MouseEvent) => void) | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly editor: DiagramEditor,
    private readonly renderer: SvgSceneRenderer,
    private readonly shapeRegistry: ShapeRegistry,
    private readonly onToggleChange?: (isOpen: boolean) => void,
    private readonly onDefineChip?: (existingChip?: ChipInterfaceDefinition) => void
  ) {
    // Load saved width from localStorage if present
    this.currentWidth = this.loadSavedWidth();

    // 1. Right side drawer container
    this.panelEl = document.createElement("div");
    this.panelEl.className = "umlcanvas-palette-panel is-collapsed";
    this.panelEl.style.width = `${this.currentWidth}px`;

    // 1b. Left edge resize handle
    this.resizeHandleEl = document.createElement("div");
    this.resizeHandleEl.className = "umlcanvas-palette-resize-handle";
    this.resizeHandleEl.title = "Drag to adjust panel width";
    this.initResizeHandle();
    this.panelEl.appendChild(this.resizeHandleEl);

    // 2. Floating toggle tab on the right edge
    this.toggleTabEl = document.createElement("div");
    this.toggleTabEl.className = "umlcanvas-palette-toggle-tab";
    this.toggleTabEl.title = "Open Shape Library";
    this.toggleTabEl.innerHTML = `<span>‹</span><span class="umlcanvas-palette-tab-text">Shapes</span>`;
    this.toggleTabEl.addEventListener("click", () => {
      this.toggle(true);
    });

    this.container.appendChild(this.toggleTabEl);
    this.container.appendChild(this.panelEl);

    // Default: expand category matching current diagram type, collapse others
    this.initDefaultExpandedState();

    this.createHeader();
    this.createSearch();

    this.contentEl = document.createElement("div");
    this.contentEl.className = "umlcanvas-palette-content";
    this.panelEl.appendChild(this.contentEl);

    this.render();

    this.unsubscribe = this.editor.subscribe(() => {
      this.updateActiveSelection();
    });

    this.customChipUnsubscribe = defaultCustomChipRegistry.onChange(() => {
      this.render();
    });
  }

  private initDefaultExpandedState(): void {
    const activeType = this.editor.diagram.diagramType;
    for (const cat of SHAPE_CATEGORIES) {
      const isCurrent =
        (activeType === "uml.class" && cat.id === "class") ||
        (activeType === "uml.object" && cat.id === "class") ||
        (activeType === "uml.usecase" && cat.id === "usecase") ||
        (activeType === "uml.activity" && cat.id === "activity") ||
        (activeType === "uml.state" && cat.id === "state") ||
        (activeType === "uml.sequence" && cat.id === "sequence") ||
        (activeType === "uml.component" && cat.id === "component") ||
        (activeType === "uml.deployment" && cat.id === "deployment") ||
        (activeType === "uml.package" && cat.id === "class") ||
        (activeType === "uml.composite" && cat.id === "component") ||
        (activeType === "uml.timing" && cat.id === "timing") ||
        (activeType === "uml.profile" && cat.id === "profile") ||
        (activeType === "schematic" && cat.id === "schematic");

      if (!isCurrent && cat.id !== "general") {
        this.collapsedCategories.add(cat.id);
      }
    }
    this.collapsedCategories.add("connectors");
    if (activeType !== "schematic") {
      this.collapsedCategories.add("customChips");
    }
  }

  private createHeader(): void {
    const header = document.createElement("div");
    header.className = "umlcanvas-palette-header-bar";

    const title = document.createElement("div");
    title.className = "umlcanvas-palette-title";
    title.innerHTML = `<span>Shape Library</span>`;

    const closeBtn = document.createElement("button");
    closeBtn.className = "umlcanvas-palette-close-btn";
    closeBtn.title = "Close Shape Library";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => {
      this.toggle(false);
    });

    header.appendChild(title);
    header.appendChild(closeBtn);
    this.panelEl.appendChild(header);
  }

  private createSearch(): void {
    const container = document.createElement("div");
    container.className = "umlcanvas-palette-search-container";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Search shapes...";
    input.className = "umlcanvas-palette-search-input";
    input.addEventListener("input", () => {
      this.filterShapes(input.value.trim().toLowerCase());
    });

    this.searchInput = input;
    container.appendChild(input);
    this.panelEl.appendChild(container);
  }

  render(): void {
    this.contentEl.innerHTML = "";

    // 1. Render each shape category
    for (const cat of SHAPE_CATEGORIES) {
      if (cat.id === "customChips") {
        const customChips = defaultCustomChipRegistry.getAll();
        const chipsCatEl = this.renderCustomChipsCategory(customChips);
        this.contentEl.appendChild(chipsCatEl);
        continue;
      }
      const validShapes: ShapeDefinition[] = [];
      for (const kind of cat.shapeKinds) {
        if (this.shapeRegistry.has(kind)) {
          validShapes.push(this.shapeRegistry.get(kind));
        }
      }
      if (validShapes.length > 0) {
        const catEl = this.renderCategory(cat.id, cat.name, validShapes);
        this.contentEl.appendChild(catEl);
      }
    }

    // 2. Extra shapes not explicitly categorized
    const categorizedKinds = new Set(SHAPE_CATEGORIES.flatMap((c) => c.shapeKinds));
    const extraShapes = this.shapeRegistry
      .list()
      .filter((s) => !categorizedKinds.has(s.kind) && s.kind !== "generic.freehand");

    if (extraShapes.length > 0) {
      const catEl = this.renderCategory("other", "Other Shapes", extraShapes);
      this.contentEl.appendChild(catEl);
    }

    // 3. Connectors & Lines Category
    const edgeStyles = defaultEdgeStyleRegistry.getAll();
    const edgesCatEl = this.renderEdgesCategory("connectors", "Connectors & Lines", edgeStyles);
    this.contentEl.appendChild(edgesCatEl);

    this.updateActiveSelection();
  }

  private renderCategory(
    id: string,
    name: string,
    shapes: ShapeDefinition[]
  ): HTMLElement {
    const catEl = document.createElement("div");
    catEl.className = "umlcanvas-palette-category";
    catEl.setAttribute("data-category-id", id);
    if (this.collapsedCategories.has(id)) {
      catEl.classList.add("is-collapsed");
    }

    // Category Header
    const header = document.createElement("div");
    header.className = "umlcanvas-palette-category-header";
    header.title = `Click to toggle ${name}`;

    const left = document.createElement("div");
    left.className = "umlcanvas-palette-category-left";

    const chevron = document.createElement("span");
    chevron.className = "umlcanvas-palette-category-chevron";
    chevron.textContent = this.collapsedCategories.has(id) ? "▶" : "▼";

    const titleSpan = document.createElement("span");
    titleSpan.textContent = name;

    left.appendChild(chevron);
    left.appendChild(titleSpan);

    const countSpan = document.createElement("span");
    countSpan.className = "umlcanvas-palette-category-count";
    countSpan.textContent = String(shapes.length);

    header.appendChild(left);
    header.appendChild(countSpan);

    header.addEventListener("click", () => {
      const isCurrentlyCollapsed = this.collapsedCategories.has(id);
      if (isCurrentlyCollapsed) {
        this.collapsedCategories.delete(id);
        catEl.classList.remove("is-collapsed");
        chevron.textContent = "▼";
      } else {
        this.collapsedCategories.add(id);
        catEl.classList.add("is-collapsed");
        chevron.textContent = "▶";
      }
    });

    catEl.appendChild(header);

    // Body (Grid of Shape Tiles)
    const body = document.createElement("div");
    body.className = "umlcanvas-palette-category-body";

    for (const shapeDef of shapes) {
      const tile = this.renderShapeTile(shapeDef);
      body.appendChild(tile);
    }

    catEl.appendChild(body);
    return catEl;
  }

  private renderShapeTile(shapeDef: ShapeDefinition): HTMLElement {
    const tile = document.createElement("div");
    tile.className = "umlcanvas-shape-tile";
    tile.setAttribute("data-shape-kind", shapeDef.kind);
    tile.title = `${shapeDef.displayName} (${shapeDef.kind})\nClick to add, or drag onto canvas`;
    tile.draggable = true;

    tile.addEventListener("dragstart", (e) => {
      if (e.dataTransfer) {
        e.dataTransfer.setData("application/x-umlcanvas-shape", shapeDef.kind);
        e.dataTransfer.setData("text/plain", shapeDef.kind);
        e.dataTransfer.effectAllowed = "copy";
      }
    });

    tile.addEventListener("click", () => {
      this.addNodeOfKind(shapeDef.kind);
    });

    // SVG Preview
    const previewContainer = document.createElement("div");
    previewContainer.className = "umlcanvas-shape-tile-preview";

    const svgNS = "http://www.w3.org/2000/svg";
    const previewSvg = document.createElementNS(svgNS, "svg");
    const w = shapeDef.defaultSize.width || 100;
    const h = shapeDef.defaultSize.height || 60;
    const pad = 4;
    previewSvg.setAttribute("viewBox", `${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`);
    previewSvg.setAttribute("width", "100%");
    previewSvg.setAttribute("height", "100%");
    previewSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    previewSvg.setAttribute("class", "umlcanvas-shape-preview-svg");

    try {
      const dummyNode = createDiagramNode({
        id: "preview",
        kind: shapeDef.kind,
        position: { x: 0, y: 0 },
        size: { width: w, height: h },
      });
      const rendered = shapeDef.renderSvg(dummyNode, { isSelected: false });
      previewSvg.appendChild(rendered);
    } catch {
      const fallbackRect = document.createElementNS(svgNS, "rect");
      fallbackRect.setAttribute("x", "0");
      fallbackRect.setAttribute("y", "0");
      fallbackRect.setAttribute("width", String(w));
      fallbackRect.setAttribute("height", String(h));
      fallbackRect.setAttribute("fill", "var(--background-primary)");
      fallbackRect.setAttribute("stroke", "var(--text-muted)");
      fallbackRect.setAttribute("stroke-width", "1.5");
      previewSvg.appendChild(fallbackRect);
    }

    previewContainer.appendChild(previewSvg);
    tile.appendChild(previewContainer);

    const label = document.createElement("div");
    label.className = "umlcanvas-shape-tile-label";
    label.textContent = shapeDef.displayName;
    tile.appendChild(label);

    return tile;
  }

  private renderEdgesCategory(
    id: string,
    name: string,
    edgeStyles: EdgeStyleDefinition[]
  ): HTMLElement {
    const catEl = document.createElement("div");
    catEl.className = "umlcanvas-palette-category";
    catEl.setAttribute("data-category-id", id);
    if (this.collapsedCategories.has(id)) {
      catEl.classList.add("is-collapsed");
    }

    const header = document.createElement("div");
    header.className = "umlcanvas-palette-category-header";
    header.title = `Click to toggle ${name}`;

    const left = document.createElement("div");
    left.className = "umlcanvas-palette-category-left";

    const chevron = document.createElement("span");
    chevron.className = "umlcanvas-palette-category-chevron";
    chevron.textContent = this.collapsedCategories.has(id) ? "▶" : "▼";

    const titleSpan = document.createElement("span");
    titleSpan.textContent = name;

    left.appendChild(chevron);
    left.appendChild(titleSpan);

    const countSpan = document.createElement("span");
    countSpan.className = "umlcanvas-palette-category-count";
    countSpan.textContent = String(edgeStyles.length);

    header.appendChild(left);
    header.appendChild(countSpan);

    header.addEventListener("click", () => {
      const isCurrentlyCollapsed = this.collapsedCategories.has(id);
      if (isCurrentlyCollapsed) {
        this.collapsedCategories.delete(id);
        catEl.classList.remove("is-collapsed");
        chevron.textContent = "▼";
      } else {
        this.collapsedCategories.add(id);
        catEl.classList.add("is-collapsed");
        chevron.textContent = "▶";
      }
    });

    catEl.appendChild(header);

    const body = document.createElement("div");
    body.className = "umlcanvas-palette-category-body";

    for (const style of edgeStyles) {
      const tile = document.createElement("div");
      tile.className = "umlcanvas-edge-tile";
      tile.setAttribute("data-edge-kind", style.kind);
      tile.title = `Connector: ${style.displayName}\nClick to set active connector type`;
      if (this.editor.activeEdgeKind === style.kind) {
        tile.classList.add("is-active");
      }

      tile.addEventListener("click", () => {
        this.editor.activeEdgeKind = style.kind;
        for (const edgeId of this.editor.selectedEdgeIds) {
          const edge = this.editor.diagram.edges.find((e) => e.id === edgeId);
          if (edge) {
            edge.kind = style.kind;
          }
        }
        this.updateActiveSelection();
      });

      const previewContainer = document.createElement("div");
      previewContainer.className = "umlcanvas-edge-tile-preview";

      const svgNS = "http://www.w3.org/2000/svg";
      const previewSvg = document.createElementNS(svgNS, "svg");
      previewSvg.setAttribute("viewBox", "0 0 50 20");
      previewSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      previewSvg.setAttribute("class", "umlcanvas-edge-preview-svg");

      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", "5");
      line.setAttribute("y1", "10");
      line.setAttribute("x2", "45");
      line.setAttribute("y2", "10");
      line.setAttribute("stroke", "var(--text-normal)");
      line.setAttribute("stroke-width", "1.5");
      if (style.strokeDasharray) {
        line.setAttribute("stroke-dasharray", style.strokeDasharray);
      }
      previewSvg.appendChild(line);

      previewContainer.appendChild(previewSvg);
      tile.appendChild(previewContainer);

      const label = document.createElement("div");
      label.className = "umlcanvas-shape-tile-label";
      label.textContent = style.displayName;
      tile.appendChild(label);

      body.appendChild(tile);
    }

    catEl.appendChild(body);
    return catEl;
  }

  private renderCustomChipsCategory(chips: ChipInterfaceDefinition[]): HTMLElement {
    const catEl = document.createElement("div");
    catEl.className = "umlcanvas-palette-category";
    catEl.setAttribute("data-category-id", "customChips");
    if (this.collapsedCategories.has("customChips")) {
      catEl.classList.add("is-collapsed");
    }

    const header = document.createElement("div");
    header.className = "umlcanvas-palette-category-header";
    header.title = "Click to toggle Custom Chips";

    const left = document.createElement("div");
    left.className = "umlcanvas-palette-category-left";

    const chevron = document.createElement("span");
    chevron.className = "umlcanvas-palette-category-chevron";
    chevron.textContent = this.collapsedCategories.has("customChips") ? "▶" : "▼";

    const titleSpan = document.createElement("span");
    titleSpan.textContent = "Custom Chips";

    left.appendChild(chevron);
    left.appendChild(titleSpan);

    const rightWrapper = document.createElement("div");
    rightWrapper.className = "umlcanvas-palette-category-right";

    const countSpan = document.createElement("span");
    countSpan.className = "umlcanvas-palette-category-count";
    countSpan.textContent = String(chips.length);
    rightWrapper.appendChild(countSpan);

    if (this.onDefineChip) {
      const addBtn = document.createElement("button");
      addBtn.className = "umlcanvas-palette-cat-add-btn";
      addBtn.title = "Define New Custom Chip...";
      addBtn.textContent = "+";
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onDefineChip?.();
      });
      rightWrapper.appendChild(addBtn);
    }

    header.appendChild(left);
    header.appendChild(rightWrapper);

    header.addEventListener("click", () => {
      const isCurrentlyCollapsed = this.collapsedCategories.has("customChips");
      if (isCurrentlyCollapsed) {
        this.collapsedCategories.delete("customChips");
        catEl.classList.remove("is-collapsed");
        chevron.textContent = "▼";
      } else {
        this.collapsedCategories.add("customChips");
        catEl.classList.add("is-collapsed");
        chevron.textContent = "▶";
      }
    });

    catEl.appendChild(header);

    const body = document.createElement("div");
    body.className = "umlcanvas-palette-category-body";

    // "+ Define New Chip" tile
    const newChipTile = document.createElement("div");
    newChipTile.className = "umlcanvas-shape-tile umlcanvas-tile-add-chip";
    newChipTile.title = "Click to define a custom IC chip interface with pins";

    const addPreviewContainer = document.createElement("div");
    addPreviewContainer.className = "umlcanvas-shape-tile-preview umlcanvas-add-chip-preview";

    const svgNS = "http://www.w3.org/2000/svg";
    const addSvg = document.createElementNS(svgNS, "svg");
    addSvg.setAttribute("viewBox", "0 0 40 40");
    addSvg.setAttribute("width", "100%");
    addSvg.setAttribute("height", "100%");
    addSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    addSvg.setAttribute("class", "umlcanvas-shape-preview-svg");
    const plusText = document.createElementNS(svgNS, "text");
    plusText.setAttribute("x", "20");
    plusText.setAttribute("y", "26");
    plusText.setAttribute("text-anchor", "middle");
    plusText.setAttribute("font-size", "24");
    plusText.setAttribute("font-weight", "bold");
    plusText.setAttribute("fill", "var(--text-accent)");
    plusText.textContent = "+";
    addSvg.appendChild(plusText);
    addPreviewContainer.appendChild(addSvg);
    newChipTile.appendChild(addPreviewContainer);

    const addLabel = document.createElement("div");
    addLabel.className = "umlcanvas-shape-tile-label";
    addLabel.textContent = "+ Define Chip";
    newChipTile.appendChild(addLabel);

    newChipTile.addEventListener("click", () => {
      this.onDefineChip?.();
    });
    body.appendChild(newChipTile);

    // Tiles for each custom chip
    for (const chip of chips) {
      const tile = this.renderCustomChipTile(chip);
      body.appendChild(tile);
    }

    catEl.appendChild(body);
    return catEl;
  }

  private renderCustomChipTile(chip: ChipInterfaceDefinition): HTMLElement {
    const tile = document.createElement("div");
    tile.className = "umlcanvas-shape-tile umlcanvas-chip-tile";
    tile.setAttribute("data-chip-id", chip.id);
    tile.setAttribute("data-shape-kind", "schematic.chip");
    tile.title = `${chip.name} (${chip.ports.length} pins)\nClick to add, or drag onto canvas`;
    tile.draggable = true;

    tile.addEventListener("dragstart", (e) => {
      if (e.dataTransfer) {
        e.dataTransfer.setData("application/x-umlcanvas-chip-id", chip.id);
        e.dataTransfer.setData("application/x-umlcanvas-shape", "schematic.chip");
        e.dataTransfer.setData("text/plain", chip.name);
        e.dataTransfer.effectAllowed = "copy";
      }
    });

    tile.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".umlcanvas-tile-action-btn")) return;

      const transform = this.renderer.currentTransform;
      const centerScreen = {
        x: this.container.clientWidth / 2,
        y: this.container.clientHeight / 2,
      };
      const canvasX = (centerScreen.x - transform.panX) / transform.zoom;
      const canvasY = (centerScreen.y - transform.panY) / transform.zoom;

      const node = this.editor.instantiateChip(chip, {
        x: Math.round(canvasX - 70),
        y: Math.round(canvasY - 45),
      });
      this.editor.selectNode(node.id, false);
    });

    // Preview
    const previewContainer = document.createElement("div");
    previewContainer.className = "umlcanvas-shape-tile-preview";

    const svgNS = "http://www.w3.org/2000/svg";
    const previewSvg = document.createElementNS(svgNS, "svg");
    const w = 140;
    const h = Math.max(80, (chip.ports.length + 1) * 20);
    const pad = 8;
    previewSvg.setAttribute("viewBox", `${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`);
    previewSvg.setAttribute("width", "100%");
    previewSvg.setAttribute("height", "100%");
    previewSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    previewSvg.setAttribute("class", "umlcanvas-shape-preview-svg");

    try {
      const dummyNode = createDiagramNode({
        id: "preview-" + chip.id,
        kind: "schematic.chip",
        position: { x: 0, y: 0 },
        size: { width: w, height: h },
        ports: chip.ports.map((p) => ({ ...p, ownerNodeId: "preview-" + chip.id })),
        labels: [{ id: "l1", text: chip.name, anchor: "node", position: { x: 0, y: 0 } }],
      });
      const rendered = this.shapeRegistry.get("schematic.chip").renderSvg(dummyNode, { isSelected: false });
      previewSvg.appendChild(rendered);
    } catch {
      const fallbackRect = document.createElementNS(svgNS, "rect");
      fallbackRect.setAttribute("x", "0");
      fallbackRect.setAttribute("y", "0");
      fallbackRect.setAttribute("width", String(w));
      fallbackRect.setAttribute("height", String(h));
      fallbackRect.setAttribute("fill", "var(--background-primary)");
      fallbackRect.setAttribute("stroke", "var(--text-muted)");
      fallbackRect.setAttribute("stroke-width", "1.5");
      previewSvg.appendChild(fallbackRect);
    }

    previewContainer.appendChild(previewSvg);
    tile.appendChild(previewContainer);

    // Label & pin count
    const labelContainer = document.createElement("div");
    labelContainer.className = "umlcanvas-chip-tile-footer";

    const label = document.createElement("div");
    label.className = "umlcanvas-shape-tile-label";
    label.textContent = chip.name;
    labelContainer.appendChild(label);

    const pinCount = document.createElement("span");
    pinCount.className = "umlcanvas-chip-tile-pins";
    pinCount.textContent = `${chip.ports.length} pins`;
    labelContainer.appendChild(pinCount);

    tile.appendChild(labelContainer);

    // Hover Action Buttons: Edit and Delete
    const actionsBar = document.createElement("div");
    actionsBar.className = "umlcanvas-chip-tile-actions";

    if (this.onDefineChip) {
      const editBtn = document.createElement("button");
      editBtn.className = "umlcanvas-tile-action-btn";
      editBtn.title = `Edit interface for ${chip.name}`;
      editBtn.textContent = "✎";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onDefineChip?.(chip);
      });
      actionsBar.appendChild(editBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.className = "umlcanvas-tile-action-btn is-danger";
    delBtn.title = `Delete ${chip.name} from library`;
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      defaultCustomChipRegistry.unregister(chip.id);
    });
    actionsBar.appendChild(delBtn);

    tile.appendChild(actionsBar);

    return tile;
  }

  private filterShapes(query: string): void {
    const categories = this.contentEl.querySelectorAll<HTMLElement>(".umlcanvas-palette-category");

    categories.forEach((catEl) => {
      const tiles = catEl.querySelectorAll<HTMLElement>(".umlcanvas-shape-tile, .umlcanvas-edge-tile");
      if (!query) {
        catEl.style.display = "";
        tiles.forEach((t) => (t.style.display = ""));
        const catId = catEl.getAttribute("data-category-id");
        if (catId && this.collapsedCategories.has(catId)) {
          catEl.classList.add("is-collapsed");
        } else {
          catEl.classList.remove("is-collapsed");
        }
        const chevron = catEl.querySelector(".umlcanvas-palette-category-chevron");
        if (chevron) {
          chevron.textContent = catEl.classList.contains("is-collapsed") ? "▶" : "▼";
        }
        return;
      }

      let matchCount = 0;
      tiles.forEach((tile) => {
        const text = (tile.textContent || "").toLowerCase();
        const kind = (tile.getAttribute("data-shape-kind") || tile.getAttribute("data-edge-kind") || "").toLowerCase();
        if (text.includes(query) || kind.includes(query)) {
          tile.style.display = "";
          matchCount++;
        } else {
          tile.style.display = "none";
        }
      });

      if (matchCount > 0) {
        catEl.style.display = "";
        catEl.classList.remove("is-collapsed");
        const chevron = catEl.querySelector(".umlcanvas-palette-category-chevron");
        if (chevron) chevron.textContent = "▼";
      } else {
        catEl.style.display = "none";
      }
    });
  }

  private addNodeOfKind(kind: string): void {
    const transform = this.renderer.currentTransform;
    const centerScreen = {
      x: this.container.clientWidth / 2,
      y: this.container.clientHeight / 2,
    };
    const canvasX = (centerScreen.x - transform.panX) / transform.zoom;
    const canvasY = (centerScreen.y - transform.panY) / transform.zoom;
    const shapeDef = this.shapeRegistry.get(kind);

    const node = this.editor.addNode({
      kind,
      position: {
        x: Math.round(canvasX - shapeDef.defaultSize.width / 2),
        y: Math.round(canvasY - shapeDef.defaultSize.height / 2),
      },
      size: { ...shapeDef.defaultSize },
      title: shapeDef.displayName,
    });
    this.editor.selectNode(node.id, false);
  }

  private updateActiveSelection(): void {
    const edgeTiles = this.contentEl.querySelectorAll<HTMLElement>(".umlcanvas-edge-tile");
    edgeTiles.forEach((tile) => {
      const k = tile.getAttribute("data-edge-kind");
      if (k === this.editor.activeEdgeKind) {
        tile.classList.add("is-active");
      } else {
        tile.classList.remove("is-active");
      }
    });
  }

  toggle(visible?: boolean): void {
    if (visible === undefined) {
      this.isOpenState = !this.isOpenState;
    } else {
      this.isOpenState = visible;
    }

    if (this.isOpenState) {
      this.panelEl.classList.remove("is-collapsed");
      this.toggleTabEl.style.display = "none";
      if (this.searchInput) {
        setTimeout(() => this.searchInput?.focus(), 100);
      }
    } else {
      this.panelEl.classList.add("is-collapsed");
      this.toggleTabEl.style.display = "flex";
    }

    this.onToggleChange?.(this.isOpenState);
  }

  get isOpen(): boolean {
    return this.isOpenState;
  }

  private initResizeHandle(): void {
    this.resizeHandleEl.addEventListener("mousedown", (e: unknown) => {
      const mouseEvent = e as MouseEvent;
      if (typeof mouseEvent.preventDefault === "function") {
        mouseEvent.preventDefault();
      }
      if (typeof mouseEvent.stopPropagation === "function") {
        mouseEvent.stopPropagation();
      }
      this.startResizing(mouseEvent.clientX ?? 0);
    });
  }

  public startResizing(clientX: number): void {
    this.isResizing = true;
    this.startX = clientX;
    this.startWidth = this.currentWidth;

    this.panelEl.classList.add("is-resizing");
    this.resizeHandleEl.classList.add("is-resizing");
    if (typeof document !== "undefined" && document.body && document.body.style) {
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    }

    this.boundOnMouseMove = (e: MouseEvent) => {
      if (!this.isResizing) return;
      const currentClientX = e.clientX ?? 0;
      const delta = this.startX - currentClientX;
      this.applyWidth(this.startWidth + delta);
    };

    this.boundOnMouseUp = () => {
      this.stopResizing();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("mousemove", this.boundOnMouseMove as EventListener);
      window.addEventListener("mouseup", this.boundOnMouseUp as EventListener);
    }
  }

  public stopResizing(): void {
    if (!this.isResizing) return;
    this.isResizing = false;

    this.panelEl.classList.remove("is-resizing");
    this.resizeHandleEl.classList.remove("is-resizing");
    if (typeof document !== "undefined" && document.body && document.body.style) {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    if (typeof window !== "undefined") {
      if (this.boundOnMouseMove) {
        window.removeEventListener("mousemove", this.boundOnMouseMove as EventListener);
        this.boundOnMouseMove = null;
      }
      if (this.boundOnMouseUp) {
        window.removeEventListener("mouseup", this.boundOnMouseUp as EventListener);
        this.boundOnMouseUp = null;
      }
    }

    this.saveWidth(this.currentWidth);
  }

  public setWidth(width: number): void {
    this.applyWidth(width);
    this.saveWidth(this.currentWidth);
  }

  public getWidth(): number {
    return this.currentWidth;
  }

  private applyWidth(width: number): void {
    const maxWidth = this.getMaxWidth();
    const clamped = Math.max(MIN_PALETTE_WIDTH, Math.min(maxWidth, width));
    this.currentWidth = clamped;
    this.panelEl.style.width = `${clamped}px`;
  }

  private getMaxWidth(): number {
    const containerWidth =
      this.container.clientWidth ||
      (typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1200);
    return Math.max(MIN_PALETTE_WIDTH, Math.min(MAX_PALETTE_WIDTH, Math.round(containerWidth * 0.85)));
  }

  private loadSavedWidth(): number {
    try {
      if (typeof localStorage !== "undefined" && localStorage) {
        const saved = localStorage.getItem(STORAGE_KEY_PALETTE_WIDTH);
        if (saved) {
          const parsed = parseInt(saved, 10);
          if (!isNaN(parsed) && parsed >= MIN_PALETTE_WIDTH && parsed <= MAX_PALETTE_WIDTH) {
            return parsed;
          }
        }
      }
    } catch {
      // Ignore localStorage errors in sandbox
    }
    return DEFAULT_PALETTE_WIDTH;
  }

  private saveWidth(width: number): void {
    try {
      if (typeof localStorage !== "undefined" && localStorage) {
        localStorage.setItem(STORAGE_KEY_PALETTE_WIDTH, String(Math.round(width)));
      }
    } catch {
      // Ignore localStorage errors in sandbox
    }
  }

  destroy(): void {
    if (this.isResizing) {
      this.stopResizing();
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.customChipUnsubscribe) {
      this.customChipUnsubscribe();
      this.customChipUnsubscribe = null;
    }
    this.toggleTabEl.remove();
    this.panelEl.remove();
  }
}
