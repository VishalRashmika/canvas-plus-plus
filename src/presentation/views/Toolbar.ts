import { setIcon } from "obsidian";
import { DiagramEditor } from "../../application/use-cases/DiagramEditor";
import { SvgSceneRenderer } from "../renderer/SvgSceneRenderer";
import { ViewportTransform } from "../renderer/ViewportMath";
import { EdgeRouting } from "../../domain/types";
import {
  LineEndingType,
  LinePatternType,
} from "../../domain/entities/DiagramEdge";
import {
  CANVAS_COLOR_PRESETS,
  resolveCanvasColor,
} from "../../domain/value-objects/CanvasColor";
import {
  FONT_SIZE_PRESETS,
  FONT_FAMILY_PRESETS,
  getNextFontSize,
} from "../theme/Typography";
import { defaultEdgeStyleRegistry } from "../renderer/EdgeStyleRegistry";
import { Group } from "../../domain/entities/Group";

interface HandledEvent extends Event {
  _umlHandled?: boolean;
}

function markEventHandled(e: Event): void {
  (e as HandledEvent)._umlHandled = true;
}

function renderIcon(parent: HTMLElement, iconId: string): void {
  try {
    setIcon(parent, iconId);
  } catch {
    // Graceful fallback for non-Obsidian environments
  }
}

export class Toolbar {
  public readonly toolbarEl: HTMLElement; // Main toolbar element (retained for backward compatibility)
  private readonly mainToolbarEl: HTMLElement;
  private readonly bottomToolbarEl: HTMLElement;
  private readonly breadcrumbsEl: HTMLElement;

  // History & Clipboard
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private copyBtn!: HTMLButtonElement;
  private pasteBtn!: HTMLButtonElement;

  // Bottom Floating Toolbar Controls
  private selectBtn!: HTMLButtonElement;
  private grabBtn!: HTMLButtonElement;
  private drawBtn!: HTMLButtonElement;
  private autoShapeBtn!: HTMLButtonElement;
  private rectBtn!: HTMLButtonElement;
  private circleBtn!: HTMLButtonElement;
  private diamondBtn!: HTMLButtonElement;
  private triangleBtn!: HTMLButtonElement;
  private noteBtn!: HTMLButtonElement;
  private vaultNoteBtn?: HTMLButtonElement;
  private imageBtn?: HTMLButtonElement;
  private groupBoxBtn!: HTMLButtonElement;
  private lineBtn!: HTMLButtonElement;

  // Context-sensitive Component Controls
  private contextGroup!: HTMLElement;
  private selectionBadgeEl!: HTMLElement;
  private colorBtn!: HTMLButtonElement;
  private colorIndicatorEl!: HTMLElement;
  private labelBtn!: HTMLButtonElement;
  private autoFitBtn!: HTMLButtonElement;
  private alignBtn!: HTMLButtonElement;
  private groupBtn!: HTMLButtonElement;
  private ungroupBtn!: HTMLButtonElement;
  private duplicateBtn!: HTMLButtonElement;
  private deleteBtn!: HTMLButtonElement;
  private seqLayoutBtn!: HTMLButtonElement;
  private edgeStartEndingBtn!: HTMLButtonElement;
  private edgeLineTypeBtn!: HTMLButtonElement;
  private edgeEndEndingBtn!: HTMLButtonElement;
  private edgeRoutingBtn!: HTMLButtonElement;
  private edgeStyleBtn!: HTMLButtonElement;
  private rerouteBtn!: HTMLButtonElement;
  private reverseBtn!: HTMLButtonElement;
  private currentConnectorAnchor: HTMLElement | null = null;

  // Canvas View & Navigation Controls
  private gridBtn!: HTMLButtonElement;
  private minimapBtn?: HTMLButtonElement;
  private routingBtn!: HTMLButtonElement;
  private routingTextSpan!: HTMLElement;
  private zoomLabel!: HTMLElement;

  // Top Right / Library Controls
  private paletteBtn?: HTMLButtonElement;

  // File Menu
  private fileBtn!: HTMLButtonElement;
  private fileMenuPopoverEl: HTMLElement | null = null;
  private fileWinClickBound: ((e: MouseEvent) => void) | null = null;

  // Connector Menu
  private connectorPopoverEl: HTMLElement | null = null;
  private connectorWinClickBound: ((e: MouseEvent) => void) | null = null;

  // Align Popover
  private alignPopoverEl: HTMLElement | null = null;
  private alignWinClickBound: ((e: MouseEvent) => void) | null = null;
  private alignCloseTimer: number | null = null;

  // Color Palette Popover
  private colorPaletteEl: HTMLElement | null = null;
  private onWindowClickBound: ((e: MouseEvent) => void) | null = null;

  // Font Typography Controls (Permanent)
  private typographyGroup!: HTMLElement;
  private fontDecBtn!: HTMLButtonElement;
  private fontSizeBtn!: HTMLButtonElement;
  private fontIncBtn!: HTMLButtonElement;
  private boldBtn!: HTMLButtonElement;
  private italicBtn!: HTMLButtonElement;
  private fontFamilyBtn!: HTMLButtonElement;
  private fontSizePopoverEl: HTMLElement | null = null;
  private fontSizeWinClickBound: ((e: MouseEvent) => void) | null = null;

  // Context Selection Typography Controls (Group 5)
  private contextFontDecBtn!: HTMLButtonElement;
  private contextFontSizeBtn!: HTMLButtonElement;
  private contextFontIncBtn!: HTMLButtonElement;
  private contextBoldBtn!: HTMLButtonElement;
  private contextItalicBtn!: HTMLButtonElement;
  private contextFontFamilyBtn!: HTMLButtonElement;

  private freehandEnabled = true;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly editor: DiagramEditor,
    private readonly renderer: SvgSceneRenderer,
    private readonly onSaveRequested?: () => void,
    private readonly onTogglePalette?: () => void,
    private readonly onExportSvg?: () => void,
    /** @deprecated Removed export to Obsidian Canvas */
    private readonly onExportCanvas?: () => void,
    private readonly onNavigateBreadcrumb?: (index: number) => void,
    private readonly onToggleMinimap?: () => void,
    private readonly onAddNoteRequested?: () => void,
    private readonly onToggleTheme?: () => void,
    private readonly onAddImageRequested?: () => void
  ) {
    this.freehandEnabled = this.renderer.isFreehandEnabled;

    this.breadcrumbsEl = createDiv({ cls: "umlcanvas-breadcrumbs" });
    this.container.prepend(this.breadcrumbsEl);

    // 1. Main Toolbar at the top
    this.mainToolbarEl = this.container.createDiv({
      cls: "umlcanvas-toolbar umlcanvas-main-toolbar",
    });
    this.mainToolbarEl.addEventListener("mousedown", (e) => {
      markEventHandled(e);
      e.stopPropagation();
    });
    this.toolbarEl = this.mainToolbarEl;

    // 2. Floating Bottom Toolbar (Excalidraw style)
    this.bottomToolbarEl = this.container.createDiv({
      cls: "umlcanvas-toolbar umlcanvas-floating-bottom-toolbar",
    });
    this.bottomToolbarEl.addEventListener("mousedown", (e) => {
      markEventHandled(e);
      e.stopPropagation();
    });

    this.createMainControls();
    this.createBottomControls();

    this.unsubscribe = this.editor.subscribe(() => {
      this.updateState();
    });

    this.updateState();
  }

  private createGroup(parent: HTMLElement, extraClass?: string): HTMLElement {
    const grp = parent.createDiv({ cls: "umlcanvas-toolbar-group" });
    if (extraClass) {
      const classes = extraClass.split(/\s+/).filter(Boolean);
      if (classes.length > 0) {
        grp.classList.add(...classes);
      }
    }
    return grp;
  }

  private addDivider(parent: HTMLElement): void {
    parent.createDiv({ cls: "umlcanvas-toolbar-divider" });
  }

  private positionPopover(
    popover: HTMLElement,
    anchorEl: HTMLElement,
    offsetY = 6,
    defaultWidth = 240
  ): void {
    const btnRect = anchorEl ? anchorEl.getBoundingClientRect() : { left: 10, bottom: 10 };
    const containerRect = this.container.getBoundingClientRect();
    const popoverWidth = popover.offsetWidth || defaultWidth;
    const maxLeft = Math.max(10, containerRect.width - popoverWidth - 10);
    const left = Math.min(Math.max(10, btnRect.left - containerRect.left), maxLeft);
    const top = btnRect.bottom - containerRect.top + offsetY;
    popover.setCssStyles({ left: `${left}px`, top: `${top}px` });
  }

  private createButton(
    title: string,
    text: string,
    onClick: () => void,
    iconId?: string,
    extraClass?: string
  ): HTMLButtonElement {
    const btn = createEl("button", {
      cls: "umlcanvas-toolbar-btn clickable-icon",
      title,
      attr: { "aria-label": title },
    });
    if (extraClass) {
      const classes = extraClass.split(/\s+/).filter(Boolean);
      if (classes.length > 0) {
        btn.classList.add(...classes);
      }
    }
    if (!text && iconId) {
      btn.classList.add("is-icon-only");
    }

    if (iconId) {
      const iconSpan = btn.createSpan({ cls: "umlcanvas-btn-icon" });
      renderIcon(iconSpan, iconId);
    }

    if (text) {
      btn.createSpan({ cls: "umlcanvas-btn-text", text });
    }

    btn.addEventListener("mousedown", (e) => {
      markEventHandled(e);
      e.stopPropagation();
    });

    btn.addEventListener("click", (e) => {
      markEventHandled(e);
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private addShapeAtCenter(
    kind: string,
    title: string,
    defaultSize?: { width: number; height: number }
  ): void {
    const transform = this.renderer.currentTransform;
    const centerScreen = {
      x: this.container.clientWidth / 2,
      y: this.container.clientHeight / 2,
    };
    const canvasX = (centerScreen.x - transform.panX) / transform.zoom;
    const canvasY = (centerScreen.y - transform.panY) / transform.zoom;

    const size = defaultSize ?? { width: 140, height: 80 };
    this.editor.addNode({
      kind,
      position: {
        x: Math.round(canvasX - size.width / 2),
        y: Math.round(canvasY - size.height / 2),
      },
      size,
      title,
    });

    if (this.renderer.grabMode && typeof this.renderer.setGrabMode === "function") {
      this.renderer.setGrabMode(false);
      this.updateToolMode();
    }
    if (this.renderer.freehandMode) {
      this.renderer.setFreehandMode(false);
      this.updateToolMode();
    }
  }

  public addStickyNoteAtCenter(color = "3", title = "Sticky Note"): void {
    const transform = this.renderer.currentTransform;
    const centerScreen = {
      x: this.container.clientWidth / 2,
      y: this.container.clientHeight / 2,
    };
    const canvasX = (centerScreen.x - transform.panX) / transform.zoom;
    const canvasY = (centerScreen.y - transform.panY) / transform.zoom;

    const size = { width: 180, height: 140 };
    const node = this.editor.addNode({
      kind: "generic.stickyNote",
      title,
      position: {
        x: Math.round(canvasX - size.width / 2),
        y: Math.round(canvasY - size.height / 2),
      },
      size,
      style: { color },
    });

    if (this.renderer.grabMode && typeof this.renderer.setGrabMode === "function") {
      this.renderer.setGrabMode(false);
      this.updateToolMode();
    }
    if (this.renderer.freehandMode) {
      this.renderer.setFreehandMode(false);
      this.updateToolMode();
    }

    if (node && typeof this.renderer.startInlineEditor === "function") {
      this.renderer.startInlineEditor(node);
    }
  }

  public addImageAtCenter(src = "", title = "Photo Title"): void {
    const transform = this.renderer.currentTransform;
    const centerScreen = {
      x: this.container.clientWidth / 2,
      y: this.container.clientHeight / 2,
    };
    const canvasX = (centerScreen.x - transform.panX) / transform.zoom;
    const canvasY = (centerScreen.y - transform.panY) / transform.zoom;

    const size = { width: 220, height: 260 };
    this.editor.addNode({
      kind: "generic.image",
      title,
      position: {
        x: Math.round(canvasX - size.width / 2),
        y: Math.round(canvasY - size.height / 2),
      },
      size,
      metadata: { src },
      customData: { src },
    });

    if (this.renderer.grabMode && typeof this.renderer.setGrabMode === "function") {
      this.renderer.setGrabMode(false);
      this.updateToolMode();
    }
    if (this.renderer.freehandMode) {
      this.renderer.setFreehandMode(false);
      this.updateToolMode();
    }
  }

  public addGroupBoxAtCenter(color?: string, name = "Group"): Group {
    const transform = this.renderer.currentTransform;
    const centerScreen = {
      x: this.container.clientWidth / 2,
      y: this.container.clientHeight / 2,
    };
    const canvasX = (centerScreen.x - transform.panX) / transform.zoom;
    const canvasY = (centerScreen.y - transform.panY) / transform.zoom;

    const size = { width: 320, height: 220 };
    const group = this.editor.addGroup({
      name,
      color,
      position: {
        x: Math.round(canvasX - size.width / 2),
        y: Math.round(canvasY - size.height / 2),
      },
      size,
    });

    if (this.renderer.grabMode && typeof this.renderer.setGrabMode === "function") {
      this.renderer.setGrabMode(false);
      this.updateToolMode();
    }
    if (this.renderer.freehandMode) {
      this.renderer.setFreehandMode(false);
      this.updateToolMode();
    }
    return group;
  }

  private handleLineButtonClick(): void {
    if (this.editor.selectedNodeIds.length === 2) {
      const [fromId, toId] = this.editor.selectedNodeIds;
      this.editor.addEdge(fromId, toId, {
        kind: this.editor.activeEdgeKind,
        routing: this.editor.defaultRouting,
      });
    } else {
      this.toggleConnectorMenu();
    }
  }

  private createMainControls(): void {
    // ----------------------------------------
    // Group 1: File Menu (Save, Export, Notes)
    // ----------------------------------------
    const fileGroup = this.createGroup(this.mainToolbarEl);
    this.fileBtn = this.createButton(
      "File Menu (Save, Export, Notes)",
      "File",
      () => this.toggleFileMenu(),
      "file",
      "umlcanvas-menu-trigger"
    );
    const chevronSpan = this.fileBtn.createSpan({ cls: "umlcanvas-btn-chevron" });
    renderIcon(chevronSpan, "chevron-down");
    fileGroup.appendChild(this.fileBtn);

    // ----------------------------------------
    // Group 2: Edit & History (Undo, Redo, Copy, Paste)
    // ----------------------------------------
    const editGroup = this.createGroup(this.mainToolbarEl);
    this.undoBtn = this.createButton(
      "Undo (Ctrl+Z)",
      "",
      () => this.editor.undo(),
      "undo"
    );
    editGroup.appendChild(this.undoBtn);

    this.redoBtn = this.createButton(
      "Redo (Ctrl+Shift+Z)",
      "",
      () => this.editor.redo(),
      "redo"
    );
    editGroup.appendChild(this.redoBtn);

    this.addDivider(editGroup);

    this.copyBtn = this.createButton(
      "Copy Selection (Ctrl+C)",
      "",
      () => this.editor.copySelection(),
      "copy"
    );
    editGroup.appendChild(this.copyBtn);

    this.pasteBtn = this.createButton(
      "Paste Selection (Ctrl+V)",
      "",
      () => this.editor.paste(),
      "clipboard"
    );
    editGroup.appendChild(this.pasteBtn);

    // ----------------------------------------
    // Group 3: View & Canvas Controls (Route, Grid, Minimap, Zoom)
    // ----------------------------------------
    const viewGroup = this.createGroup(this.mainToolbarEl);

    // Edge Routing Mode Toggle
    this.routingBtn = viewGroup.createEl("button", {
      cls: "umlcanvas-toolbar-btn clickable-icon",
      title: "Default Edge Routing: Orthogonal",
      attr: { "aria-label": "Default Edge Routing: Orthogonal" },
    });
    const routingIcon = this.routingBtn.createSpan({ cls: "umlcanvas-btn-icon" });
    renderIcon(routingIcon, "git-branch");
    this.routingTextSpan = this.routingBtn.createSpan({
      cls: "umlcanvas-btn-text",
      text: "Ortho",
    });
    this.routingBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.cycleRoutingMode();
    });

    // Toggle Grid
    let gridOn = true;
    this.gridBtn = this.createButton(
      "Toggle Grid",
      "",
      () => {
        gridOn = !gridOn;
        this.renderer.setGridVisible(gridOn);
        this.gridBtn.classList.toggle("is-active", gridOn);
      },
      "grid"
    );
    this.gridBtn.classList.add("is-active");
    viewGroup.appendChild(this.gridBtn);

    // Toggle Minimap (F-011)
    if (this.onToggleMinimap) {
      this.minimapBtn = this.createButton(
        "Toggle Minimap (M)",
        "",
        () => {
          this.onToggleMinimap!();
        },
        "map"
      );
      viewGroup.appendChild(this.minimapBtn);
    }

    this.addDivider(viewGroup);

    // Zoom Out
    const zoomOutBtn = this.createButton(
      "Zoom Out (-)",
      "",
      () => this.renderer.zoomOut(),
      "zoom-out"
    );
    viewGroup.appendChild(zoomOutBtn);

    // Zoom Label
    this.zoomLabel = viewGroup.createSpan({
      cls: "umlcanvas-zoom-label",
      text: "100%",
      title: "Current Zoom (Click to Reset 100%)",
    });
    this.zoomLabel.addEventListener("click", (e) => {
      e.stopPropagation();
      this.renderer.resetZoom();
    });

    // Zoom In
    const zoomInBtn = this.createButton(
      "Zoom In (+)",
      "",
      () => this.renderer.zoomIn(),
      "zoom-in"
    );
    viewGroup.appendChild(zoomInBtn);

    // Reset Zoom (1:1)
    const resetZoomBtn = this.createButton(
      "Reset Zoom (100%)",
      "",
      () => this.renderer.resetZoom(),
      "maximize"
    );
    viewGroup.appendChild(resetZoomBtn);

    // ----------------------------------------
    // Group 4: Typography Controls (Permanent)
    // ----------------------------------------
    this.typographyGroup = this.createGroup(
      this.mainToolbarEl,
      "umlcanvas-typography-group"
    );

    // Common Font Size Stepper combo: [ − ] [ 13px ] [ + ]
    const fontStepper = this.typographyGroup.createDiv({
      cls: "umlcanvas-font-stepper-combo",
    });

    // 1. Step Down Button
    this.fontDecBtn = this.createButton(
      "Decrease Font Size (-2px) [Ctrl+[]",
      "−",
      () => {
        this.stepFontSize(-1);
      },
      undefined,
      "umlcanvas-font-step-btn umlcanvas-font-dec-btn"
    );
    fontStepper.appendChild(this.fontDecBtn);

    // 2. Font Size Display & Menu Button
    this.fontSizeBtn = this.createButton(
      "Font Size & Typography (Ctrl+[, Ctrl+])",
      "13px",
      () => this.toggleFontSizeMenu(),
      undefined,
      "umlcanvas-font-size-btn"
    );
    fontStepper.appendChild(this.fontSizeBtn);

    // 3. Step Up Button
    this.fontIncBtn = this.createButton(
      "Increase Font Size (+2px) [Ctrl+]]",
      "+",
      () => {
        this.stepFontSize(1);
      },
      undefined,
      "umlcanvas-font-step-btn umlcanvas-font-inc-btn"
    );
    fontStepper.appendChild(this.fontIncBtn);

    // Bold Button
    this.boldBtn = this.createButton(
      "Bold (Ctrl+B)",
      "B",
      () => this.toggleBold(),
      undefined,
      "umlcanvas-bold-btn"
    );
    this.typographyGroup.appendChild(this.boldBtn);

    // Italic Button
    this.italicBtn = this.createButton(
      "Italic (Ctrl+I)",
      "I",
      () => this.toggleItalic(),
      undefined,
      "umlcanvas-italic-btn"
    );
    this.typographyGroup.appendChild(this.italicBtn);

    // Font Family Indicator / Quick Selector
    this.fontFamilyBtn = this.createButton(
      "Font Style / Family (Sans, Mono, Handwritten, Serif)",
      "Sans",
      () => this.toggleFontSizeMenu(),
      undefined,
      "umlcanvas-font-family-btn"
    );
    this.typographyGroup.appendChild(this.fontFamilyBtn);

    // ----------------------------------------
    // Group 5: Context-Sensitive Selection Inspector
    // (Only appears when a component is selected)
    // ----------------------------------------
    this.contextGroup = this.createGroup(
      this.mainToolbarEl,
      "umlcanvas-context-group is-hidden"
    );

    this.selectionBadgeEl = this.contextGroup.createSpan({
      cls: "umlcanvas-selection-badge",
      text: "Selected",
    });

    this.addDivider(this.contextGroup);

    // Color
    this.colorBtn = this.createButton(
      "Assign Color to Selection (1-6)",
      "",
      () => this.toggleColorPalette(),
      "palette",
      "umlcanvas-color-btn"
    );
    this.colorIndicatorEl = this.colorBtn.createSpan({
      cls: "umlcanvas-color-indicator",
    });
    this.contextGroup.appendChild(this.colorBtn);

    // Context Typography Controls: [ − ] [ 13px ] [ + ] [ B ] [ I ] [ Sans ]
    const contextFontStepper = this.contextGroup.createDiv({
      cls: "umlcanvas-font-stepper-combo umlcanvas-context-font-stepper",
    });

    this.contextFontDecBtn = this.createButton(
      "Decrease Font Size (-2px) [Ctrl+[]",
      "−",
      () => {
        this.stepFontSize(-1);
      },
      undefined,
      "umlcanvas-font-step-btn umlcanvas-font-dec-btn"
    );
    contextFontStepper.appendChild(this.contextFontDecBtn);

    this.contextFontSizeBtn = this.createButton(
      "Font Size & Typography (Ctrl+[, Ctrl+])",
      "13px",
      () => this.toggleFontSizeMenu(this.contextFontSizeBtn),
      "type",
      "umlcanvas-font-size-btn umlcanvas-context-font-size-btn"
    );
    contextFontStepper.appendChild(this.contextFontSizeBtn);

    this.contextFontIncBtn = this.createButton(
      "Increase Font Size (+2px) [Ctrl+]]",
      "+",
      () => {
        this.stepFontSize(1);
      },
      undefined,
      "umlcanvas-font-step-btn umlcanvas-font-inc-btn"
    );
    contextFontStepper.appendChild(this.contextFontIncBtn);

    this.contextBoldBtn = this.createButton(
      "Bold (Ctrl+B)",
      "B",
      () => this.toggleBold(),
      undefined,
      "umlcanvas-bold-btn umlcanvas-context-bold-btn"
    );
    this.contextGroup.appendChild(this.contextBoldBtn);

    this.contextItalicBtn = this.createButton(
      "Italic (Ctrl+I)",
      "I",
      () => this.toggleItalic(),
      undefined,
      "umlcanvas-italic-btn umlcanvas-context-italic-btn"
    );
    this.contextGroup.appendChild(this.contextItalicBtn);

    this.contextFontFamilyBtn = this.createButton(
      "Font Style / Family (Sans, Mono, Handwritten, Serif)",
      "Sans",
      () => this.toggleFontSizeMenu(this.contextFontFamilyBtn),
      undefined,
      "umlcanvas-font-family-btn umlcanvas-context-font-family-btn"
    );
    this.contextGroup.appendChild(this.contextFontFamilyBtn);

    this.addDivider(this.contextGroup);

    // Label
    this.labelBtn = this.createButton(
      "Edit Text / Label (Enter / F2)",
      "",
      () => this.editCurrentSelectionLabel(),
      "edit-3"
    );
    this.contextGroup.appendChild(this.labelBtn);

    // Auto-fit Node Dimensions
    this.autoFitBtn = this.createButton(
      "Auto-fit Node Dimensions to Text",
      "",
      () => {
        if (this.editor.selectedNodeIds.length > 0) {
          for (const id of this.editor.selectedNodeIds) {
            this.editor.autoResizeNode(id);
          }
        } else {
          this.editor.autoResizeAllNodes();
        }
      },
      "scaling"
    );
    this.contextGroup.appendChild(this.autoFitBtn);

    // Align & Distribute
    this.alignBtn = this.createButton(
      "Align & Distribute Selected Nodes",
      "",
      () => this.toggleAlignMenu(),
      "align-center"
    );
    this.contextGroup.appendChild(this.alignBtn);

    // Group
    this.groupBtn = this.createButton(
      "Group Selection (Ctrl+G)",
      "",
      () => this.editor.groupSelection(),
      "boxes"
    );
    this.contextGroup.appendChild(this.groupBtn);

    // Ungroup
    this.ungroupBtn = this.createButton(
      "Ungroup Selection (Ctrl+Shift+G)",
      "",
      () => this.editor.ungroupSelection(),
      "ungroup"
    );
    this.contextGroup.appendChild(this.ungroupBtn);

    // Duplicate
    this.duplicateBtn = this.createButton(
      "Duplicate Selection (Ctrl+D)",
      "",
      () => this.editor.duplicateSelection(),
      "copy-plus"
    );
    this.contextGroup.appendChild(this.duplicateBtn);

    // Delete
    this.deleteBtn = this.createButton(
      "Delete Selection (Del)",
      "",
      () => this.editor.deleteSelection(),
      "trash",
      "umlcanvas-toolbar-btn-danger"
    );
    this.contextGroup.appendChild(this.deleteBtn);

    // Sequence Layout
    this.seqLayoutBtn = this.createButton(
      "Auto-layout Sequence Diagram Chronologically",
      "",
      () => this.editor.layoutSequenceDiagram(),
      "git-commit"
    );
    this.contextGroup.appendChild(this.seqLayoutBtn);

    // Start Line Ending Button
    this.edgeStartEndingBtn = this.createButton(
      "Start Line Ending (click to change)",
      "Start",
      () => {
        this.toggleConnectorMenu(this.edgeStartEndingBtn);
      },
      undefined,
      "umlcanvas-edge-start-btn"
    );
    this.contextGroup.appendChild(this.edgeStartEndingBtn);

    // Line Type / Pattern Button
    this.edgeLineTypeBtn = this.createButton(
      "Line Type (Solid, Dashed, Dotted...)",
      "Solid",
      () => {
        this.toggleConnectorMenu(this.edgeLineTypeBtn);
      },
      undefined,
      "umlcanvas-edge-linetype-btn"
    );
    this.contextGroup.appendChild(this.edgeLineTypeBtn);

    // End Line Ending Button
    this.edgeEndEndingBtn = this.createButton(
      "End Line Ending (click to change)",
      "End",
      () => {
        this.toggleConnectorMenu(this.edgeEndEndingBtn);
      },
      undefined,
      "umlcanvas-edge-end-btn"
    );
    this.contextGroup.appendChild(this.edgeEndEndingBtn);

    // Change Line Routing (Orthogonal / Straight / Curved)
    this.edgeRoutingBtn = this.createButton(
      "Change Line Routing (Orthogonal / Straight / Curved)",
      "",
      () => {
        if (this.editor.selectedEdgeIds.length > 0) {
          const modes: EdgeRouting[] = ["orthogonal", "straight", "curved"];
          const firstEdge = this.editor.diagram.edges.find(
            (e) => e.id === this.editor.selectedEdgeIds[0]
          );
          const currentMode = firstEdge ? firstEdge.routing : "orthogonal";
          const nextMode = modes[(modes.indexOf(currentMode) + 1) % modes.length];
          for (const id of this.editor.selectedEdgeIds) {
            this.editor.updateEdgeRouting(id, nextMode);
          }
        }
      },
      "git-branch"
    );
    this.contextGroup.appendChild(this.edgeRoutingBtn);

    // Connector Style Button (UML connector types)
    this.edgeStyleBtn = this.createButton(
      "Connector Style (click to change)",
      "Style",
      () => {
        this.toggleConnectorMenu(this.edgeStyleBtn);
      },
      "diamond",
      "umlcanvas-edge-style-btn"
    );
    this.contextGroup.appendChild(this.edgeStyleBtn);

    // Reroute Line / Reset Bend Points
    this.rerouteBtn = this.createButton(
      "Reroute Line / Reset Bend Points",
      "",
      () => {
        for (const id of this.editor.selectedEdgeIds) {
          this.editor.rerouteEdge(id);
        }
      },
      "refresh-cw"
    );
    this.contextGroup.appendChild(this.rerouteBtn);

    // Reverse Line Direction
    this.reverseBtn = this.createButton(
      "Reverse Line Direction",
      "",
      () => {
        for (const id of this.editor.selectedEdgeIds) {
          this.editor.reverseEdge(id);
        }
      },
      "arrow-left-right"
    );
    this.contextGroup.appendChild(this.reverseBtn);

    // ----------------------------------------
    // Group 5: Shape Library (Maintains location on the right)
    // ----------------------------------------
    if (this.onTogglePalette) {
      const libGroup = this.createGroup(this.mainToolbarEl);
      this.paletteBtn = this.createButton(
        "Toggle Shape Library",
        "Shapes",
        () => {
          this.onTogglePalette!();
        },
        "layout-grid"
      );
      libGroup.appendChild(this.paletteBtn);
    }
  }

  private createBottomControls(): void {
    // Mode Group (Select, Grab, Draw, Auto Shape)
    const modeGroup = this.createGroup(this.bottomToolbarEl);

    // Select Tool (V / Esc)
    this.selectBtn = this.createButton(
      "Select & Move (V / Esc)",
      "",
      () => {
        if (typeof this.renderer.setGrabMode === "function") {
          this.renderer.setGrabMode(false);
        }
        this.renderer.setFreehandMode(false);
        this.updateToolMode();
      },
      "mouse-pointer"
    );
    modeGroup.appendChild(this.selectBtn);

    // Grab / Hand Tool (H)
    this.grabBtn = this.createButton(
      "Grab / Move Canvas (H)",
      "",
      () => {
        const active = !this.renderer.grabMode;
        if (active && typeof this.renderer.setFreehandMode === "function") {
          this.renderer.setFreehandMode(false);
        }
        if (typeof this.renderer.setGrabMode === "function") {
          this.renderer.setGrabMode(active);
        }
        this.updateToolMode();
      },
      "hand"
    );
    modeGroup.appendChild(this.grabBtn);

    // Draw Tool (P)
    this.drawBtn = this.createButton(
      "Draw / Freehand (P)",
      "",
      () => {
        if (typeof this.renderer.setGrabMode === "function") {
          this.renderer.setGrabMode(false);
        }
        const isDrawActive = this.renderer.freehandMode && !this.renderer.isAutoShapeDetection;
        if (isDrawActive) {
          this.renderer.setFreehandMode(false);
        } else {
          this.renderer.setAutoShapeDetection(false);
          this.renderer.setFreehandMode(true);
        }
        this.updateToolMode();
      },
      "pencil"
    );
    modeGroup.appendChild(this.drawBtn);

    // Auto Shape Detection (Shift+P)
    this.autoShapeBtn = this.createButton(
      "Auto Shape Recognition (Shift+P) - Automatically recognize common shapes",
      "",
      () => {
        if (typeof this.renderer.setGrabMode === "function") {
          this.renderer.setGrabMode(false);
        }
        const isAutoShapeActive = this.renderer.freehandMode && this.renderer.isAutoShapeDetection;
        if (isAutoShapeActive) {
          this.renderer.setFreehandMode(false);
        } else {
          this.renderer.setAutoShapeDetection(true);
          this.renderer.setFreehandMode(true);
        }
        this.updateToolMode();
      },
      "sparkles"
    );
    modeGroup.appendChild(this.autoShapeBtn);

    this.addDivider(this.bottomToolbarEl);

    // Shape Creation Group
    const shapeGroup = this.createGroup(this.bottomToolbarEl);

    // Rectangle
    this.rectBtn = this.createButton(
      "Rectangle (R)",
      "",
      () => {
        this.addShapeAtCenter("generic.rectangle", "Rectangle", {
          width: 140,
          height: 80,
        });
      },
      "square"
    );
    shapeGroup.appendChild(this.rectBtn);

    // Circle
    this.circleBtn = this.createButton(
      "Circle / Ellipse (O)",
      "",
      () => {
        this.addShapeAtCenter("generic.circle", "Circle", {
          width: 90,
          height: 90,
        });
      },
      "circle"
    );
    shapeGroup.appendChild(this.circleBtn);

    // Diamond
    this.diamondBtn = this.createButton(
      "Diamond (D)",
      "",
      () => {
        this.addShapeAtCenter("generic.diamond", "Diamond", {
          width: 110,
          height: 90,
        });
      },
      "diamond"
    );
    shapeGroup.appendChild(this.diamondBtn);

    // Triangle
    this.triangleBtn = this.createButton(
      "Triangle (T)",
      "",
      () => {
        this.addShapeAtCenter("generic.triangle", "Triangle", {
          width: 100,
          height: 90,
        });
      },
      "triangle"
    );
    shapeGroup.appendChild(this.triangleBtn);

    // Note Card
    this.noteBtn = this.createButton(
      "Sticky Note Card (N)",
      "",
      () => {
        this.addStickyNoteAtCenter();
      },
      "sticky-note"
    );
    shapeGroup.appendChild(this.noteBtn);

    // Image (Photo Frame)
    this.imageBtn = this.createButton(
      "Insert Image (Photo Frame)",
      "",
      () => {
        if (this.onAddImageRequested) {
          this.onAddImageRequested();
        } else {
          this.addImageAtCenter();
        }
      },
      "image"
    );
    shapeGroup.appendChild(this.imageBtn);

    // Vault Note
    if (this.onAddNoteRequested) {
      this.vaultNoteBtn = this.createButton(
        "Insert Note from Vault",
        "",
        () => {
          this.onAddNoteRequested!();
        },
        "file-text"
      );
      shapeGroup.appendChild(this.vaultNoteBtn);
    }

    // Group Box
    this.groupBoxBtn = this.createButton(
      "Group Box (G) - Add standalone group box",
      "",
      () => {
        this.addGroupBoxAtCenter();
      },
      "boxes"
    );
    shapeGroup.appendChild(this.groupBoxBtn);

    this.addDivider(this.bottomToolbarEl);

    // Line / Connector Group
    const lineGroup = this.createGroup(this.bottomToolbarEl);

    this.lineBtn = this.createButton(
      "Connector / Line (L) - Connect 2 selected nodes or select style",
      "",
      () => {
        this.handleLineButtonClick();
      },
      "arrow-up-right"
    );
    lineGroup.appendChild(this.lineBtn);
  }

  private editCurrentSelectionLabel(): void {
    if (this.editor.selectedNodeIds.length === 1) {
      const node = this.editor.diagram.nodes.find(
        (n) => n.id === this.editor.selectedNodeIds[0]
      );
      if (node) {
        this.renderer.startInlineEditor(node);
      }
    } else if (this.editor.selectedEdgeIds.length === 1) {
      const edge = this.editor.diagram.edges.find(
        (ed) => ed.id === this.editor.selectedEdgeIds[0]
      );
      if (edge) {
        this.renderer.startEdgeInlineEditor(edge);
      }
    } else if (this.editor.selectedGroupIds.length === 1) {
      const group = this.editor.diagram.groups.find(
        (g) => g.id === this.editor.selectedGroupIds[0]
      );
      if (group && !group.locked) {
        this.renderer.startGroupInlineEditor(group);
      }
    }
  }

  updateZoomLabel(transform: ViewportTransform): void {
    const pct = Math.round(transform.zoom * 100);
    this.zoomLabel.textContent = `${pct}%`;
  }

  private cycleRoutingMode(): void {
    const modes: EdgeRouting[] = ["orthogonal", "straight", "curved"];
    const currentIdx = modes.indexOf(this.editor.defaultRouting);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    this.editor.defaultRouting = nextMode;

    const selectedEdges = this.editor.selectedEdgeIds;
    if (selectedEdges.length > 0) {
      for (const edgeId of selectedEdges) {
        this.editor.updateEdgeRouting(edgeId, nextMode);
      }
    }
    this.updateState();
  }

  private updateState(): void {
    this.undoBtn.disabled = !this.editor.canUndo;
    this.redoBtn.disabled = !this.editor.canRedo;

    const selectedNodeCount = this.editor.selectedNodeIds.length;
    const selectedEdgeCount = this.editor.selectedEdgeIds.length;
    const selectedGroupCount = this.editor.selectedGroupIds.length;
    const totalSelected = selectedNodeCount + selectedEdgeCount + selectedGroupCount;
    const hasSelection = totalSelected > 0;

    // Typography state (Always active and synchronized across Group 4 and Group 5)
    const currentFont = this.editor.getSelectionFont();
    const isBoldActive = Boolean(currentFont.isBold || currentFont.bold);
    const isItalicActive = Boolean(currentFont.isItalic || currentFont.italic);
    const curSize = currentFont.fontSize ?? 13;
    const matching = FONT_FAMILY_PRESETS.find(
      (p) => p.fontFamily === currentFont.fontFamily || p.id === currentFont.fontFamily
    );
    const famName = matching ? matching.label.split(" ")[0] : "Sans";

    // Permanent controls (Group 4)
    if (this.boldBtn) {
      this.boldBtn.classList.toggle("is-active", isBoldActive);
    }
    if (this.italicBtn) {
      this.italicBtn.classList.toggle("is-active", isItalicActive);
    }
    if (this.fontSizeBtn) {
      const textSpan = this.fontSizeBtn.querySelector(".umlcanvas-btn-text");
      if (textSpan) {
        textSpan.textContent = `${curSize}px`;
      }
      this.fontSizeBtn.title = `Font Size (${curSize}px)`;
    }
    if (this.fontFamilyBtn) {
      const textSpan = this.fontFamilyBtn.querySelector(".umlcanvas-btn-text");
      if (textSpan) {
        textSpan.textContent = famName;
      }
      this.fontFamilyBtn.title = `Font Family: ${matching?.label ?? "Sans (Default)"}`;
    }

    // Context selection controls (Group 5)
    if (this.contextBoldBtn) {
      this.contextBoldBtn.classList.toggle("is-active", isBoldActive);
    }
    if (this.contextItalicBtn) {
      this.contextItalicBtn.classList.toggle("is-active", isItalicActive);
    }
    if (this.contextFontSizeBtn) {
      const textSpan = this.contextFontSizeBtn.querySelector(".umlcanvas-btn-text");
      if (textSpan) {
        textSpan.textContent = `${curSize}px`;
      }
      this.contextFontSizeBtn.title = `Font Size & Typography (${curSize}px)`;
    }
    if (this.contextFontFamilyBtn) {
      const textSpan = this.contextFontFamilyBtn.querySelector(".umlcanvas-btn-text");
      if (textSpan) {
        textSpan.textContent = famName;
      }
      this.contextFontFamilyBtn.title = `Font Family: ${matching?.label ?? "Sans (Default)"}`;
    }

    // Context-sensitive group visibility
    if (!hasSelection) {
      this.contextGroup.classList.add("is-hidden");
      if (this.colorPaletteEl) this.closeColorPalette();
      if (this.alignPopoverEl) this.closeAlignMenu();
    } else {
      this.contextGroup.classList.remove("is-hidden");

      // Selection badge
      if (selectedNodeCount === 1 && totalSelected === 1) {
        this.selectionBadgeEl.textContent = "1 Node";
      } else if (selectedNodeCount > 1 && totalSelected === selectedNodeCount) {
        this.selectionBadgeEl.textContent = `${selectedNodeCount} Nodes`;
      } else if (selectedEdgeCount === 1 && totalSelected === 1) {
        this.selectionBadgeEl.textContent = "1 Edge";
      } else if (selectedEdgeCount > 1 && totalSelected === selectedEdgeCount) {
        this.selectionBadgeEl.textContent = `${selectedEdgeCount} Edges`;
      } else if (selectedGroupCount === 1 && totalSelected === 1) {
        this.selectionBadgeEl.textContent = "1 Group";
      } else {
        this.selectionBadgeEl.textContent = `${totalSelected} Items`;
      }

      // Label button (single item selected)
      const canLabel = totalSelected === 1;
      this.labelBtn.disabled = !canLabel;
      this.labelBtn.classList.toggle("is-hidden", !canLabel);

      // Auto-fit button (node selected)
      this.autoFitBtn.disabled = selectedNodeCount === 0;
      this.autoFitBtn.classList.toggle("is-hidden", selectedNodeCount === 0);

      // Align & Distribute (2+ nodes selected)
      this.alignBtn.disabled = selectedNodeCount < 2;
      this.alignBtn.classList.toggle("is-hidden", selectedNodeCount < 2);
      if (selectedNodeCount < 2 && this.alignPopoverEl) {
        this.closeAlignMenu();
      }

      // Group (2+ nodes selected)
      this.groupBtn.disabled = selectedNodeCount < 2;
      this.groupBtn.classList.toggle("is-hidden", selectedNodeCount < 2);

      // Ungroup (grouped node or group selected)
      const hasGroupedNode = this.editor.selectedNodeIds.some((id) =>
        this.editor.diagram.groups.some((g) => g.nodeIds.includes(id))
      );
      const canUngroup = hasGroupedNode || selectedGroupCount > 0;
      this.ungroupBtn.disabled = !canUngroup;
      this.ungroupBtn.classList.toggle("is-hidden", !canUngroup);

      // Color indicator & button
      const selectedNodes = this.editor.diagram.nodes.filter((n) =>
        this.editor.selectedNodeIds.includes(n.id)
      );
      const selectedEdges = this.editor.diagram.edges.filter((e) =>
        this.editor.selectedEdgeIds.includes(e.id)
      );
      const selectedGroups = this.editor.diagram.groups.filter((g) =>
        this.editor.selectedGroupIds.includes(g.id)
      );
      const firstColor =
        selectedNodes[0]?.style?.color ??
        selectedEdges[0]?.style?.color ??
        selectedGroups[0]?.color;

      if (firstColor) {
        this.colorIndicatorEl.classList.add("is-visible");
        const resolved = resolveCanvasColor(firstColor);
        this.colorIndicatorEl.setCssStyles({ backgroundColor: resolved ?? firstColor });
        const preset = CANVAS_COLOR_PRESETS.find((p) => p.id === firstColor);
        this.colorBtn.title = `Assign Color to Selection (Current: ${
          preset ? preset.label : firstColor
        })`;
      } else {
        this.colorIndicatorEl.classList.remove("is-visible");
        this.colorBtn.title = "Assign Color to Selection (1-6)";
      }

      // Sequence layout button
      const isSeq =
        this.editor.diagram.diagramType === "uml.sequence" ||
        this.editor.diagram.nodes.some((n) => n.kind.startsWith("sequence."));
      this.seqLayoutBtn.classList.toggle("is-hidden", !isSeq);

      // Line manipulation buttons (only shown when edges are selected)
      const hasSelectedEdges = selectedEdgeCount > 0;
      this.edgeStartEndingBtn.disabled = !hasSelectedEdges;
      this.edgeStartEndingBtn.classList.toggle("is-hidden", !hasSelectedEdges);
      this.edgeLineTypeBtn.disabled = !hasSelectedEdges;
      this.edgeLineTypeBtn.classList.toggle("is-hidden", !hasSelectedEdges);
      this.edgeEndEndingBtn.disabled = !hasSelectedEdges;
      this.edgeEndEndingBtn.classList.toggle("is-hidden", !hasSelectedEdges);
      this.edgeRoutingBtn.disabled = !hasSelectedEdges;
      this.edgeRoutingBtn.classList.toggle("is-hidden", !hasSelectedEdges);
      this.edgeStyleBtn.disabled = !hasSelectedEdges;
      this.edgeStyleBtn.classList.toggle("is-hidden", !hasSelectedEdges);
      this.rerouteBtn.disabled = !hasSelectedEdges;
      this.rerouteBtn.classList.toggle("is-hidden", !hasSelectedEdges);
      this.reverseBtn.disabled = !hasSelectedEdges;
      this.reverseBtn.classList.toggle("is-hidden", !hasSelectedEdges);

      if (hasSelectedEdges) {
        const firstEdge = selectedEdges[0];
        const styleDef = firstEdge ? defaultEdgeStyleRegistry.get(firstEdge.kind) : undefined;
        const styleName = styleDef ? styleDef.displayName : "Style";
        const textSpan = this.edgeStyleBtn.querySelector(".umlcanvas-btn-text");
        if (textSpan) {
          textSpan.textContent = styleName;
        }
        this.edgeStyleBtn.title = `Connector Style: ${styleName} (click to change)`;

        const startMarker = firstEdge ? this.editor.getEdgeEffectiveStartMarker(firstEdge) : "none";
        const endMarker = firstEdge ? this.editor.getEdgeEffectiveEndMarker(firstEdge) : "none";
        const lineType = firstEdge ? this.editor.getEdgeEffectiveLineType(firstEdge) : "solid";

        const startLabel = this.formatMarkerLabel(startMarker);
        const endLabel = this.formatMarkerLabel(endMarker);
        const typeLabel = this.formatLineTypeLabel(lineType);

        const startTextSpan = this.edgeStartEndingBtn.querySelector(".umlcanvas-btn-text");
        if (startTextSpan) startTextSpan.textContent = `Start: ${startLabel}`;
        this.edgeStartEndingBtn.title = `Start Line Ending: ${startLabel} (click to change)`;

        const typeTextSpan = this.edgeLineTypeBtn.querySelector(".umlcanvas-btn-text");
        if (typeTextSpan) typeTextSpan.textContent = typeLabel;
        this.edgeLineTypeBtn.title = `Line Type: ${typeLabel} (click to change)`;

        const endTextSpan = this.edgeEndEndingBtn.querySelector(".umlcanvas-btn-text");
        if (endTextSpan) endTextSpan.textContent = `End: ${endLabel}`;
        this.edgeEndEndingBtn.title = `End Line Ending: ${endLabel} (click to change)`;

        const routingName = firstEdge.routing.charAt(0).toUpperCase() + firstEdge.routing.slice(1);
        this.edgeRoutingBtn.title = `Change Line Routing: ${routingName} (Orthogonal / Straight / Curved)`;
      }
    }

    // Routing mode text/title
    const modeLabels: Record<EdgeRouting, { text: string; title: string }> = {
      orthogonal: { text: "Ortho", title: "Edge Routing: Orthogonal (click to toggle)" },
      straight: { text: "Straight", title: "Edge Routing: Straight (click to toggle)" },
      curved: { text: "Curved", title: "Edge Routing: Curved (click to toggle)" },
    };
    const info = modeLabels[this.editor.defaultRouting] ?? modeLabels.orthogonal;
    if (this.routingTextSpan) {
      this.routingTextSpan.textContent = info.text;
    }
    this.routingBtn.title = info.title;
    this.routingBtn.setAttribute("aria-label", info.title);

    // Breadcrumbs
    if (this.editor.breadcrumbs.length > 0) {
      this.breadcrumbsEl.classList.add("is-visible");
      this.breadcrumbsEl.textContent = "";
      this.editor.breadcrumbs.forEach((crumb, idx) => {
        const link = this.breadcrumbsEl.createEl("a", {
          cls: "umlcanvas-breadcrumb-item",
          text: crumb.title,
        });
        link.addEventListener("click", () => {
          if (this.onNavigateBreadcrumb) {
            this.onNavigateBreadcrumb(idx);
          }
        });

        this.breadcrumbsEl.createSpan({
          cls: "umlcanvas-breadcrumb-separator",
          text: " / ",
        });
      });

      this.breadcrumbsEl.createSpan({
        cls: "umlcanvas-breadcrumb-item is-current",
        text: this.editor.diagram.title || "Diagram",
      });
    } else {
      this.breadcrumbsEl.classList.remove("is-visible");
    }

    this.updateToolMode();
  }

  private formatMarkerLabel(markerId: string): string {
    const norm = markerId.replace(/^uml-marker-/, "");
    switch (norm) {
      case "none":
        return "None";
      case "arrow-open":
      case "open-arrow":
        return "Open Arrow";
      case "arrow-filled":
      case "arrow":
      case "arrow-head":
        return "Filled Arrow";
      case "triangle-hollow":
      case "triangle":
      case "hollow-triangle":
        return "Hollow Triangle";
      case "triangle-filled":
      case "filled-triangle":
        return "Filled Triangle";
      case "diamond-hollow":
      case "diamond":
      case "hollow-diamond":
        return "Hollow Diamond";
      case "diamond-filled":
      case "filled-diamond":
        return "Filled Diamond";
      case "circle-hollow":
      case "circle":
      case "hollow-circle":
        return "Hollow Circle";
      case "circle-filled":
      case "filled-circle":
      case "dot":
        return "Filled Circle";
      case "stop":
      case "timing-stop":
        return "Stop Bar";
      default:
        return norm;
    }
  }

  private formatLineTypeLabel(lineType: LinePatternType): string {
    switch (lineType) {
      case "solid":
        return "Solid";
      case "dashed":
        return "Dashed";
      case "dotted":
        return "Dotted";
      case "dash-dot":
        return "Dash-Dot";
      case "long-dash":
        return "Long-Dash";
      default:
        return "Solid";
    }
  }

  updateToolMode(): void {
    const isFreehand = this.renderer.freehandMode;
    const isGrab = Boolean(this.renderer.grabMode);
    if (this.selectBtn) {
      this.selectBtn.classList.toggle("is-active", !isFreehand && !isGrab);
    }
    if (this.grabBtn) {
      this.grabBtn.classList.toggle("is-active", isGrab);
    }
    if (this.drawBtn) {
      if (!this.freehandEnabled) {
        this.drawBtn.classList.add("is-hidden");
        this.drawBtn.classList.remove("is-active");
      } else {
        this.drawBtn.classList.remove("is-hidden");
        this.drawBtn.classList.toggle(
          "is-active",
          isFreehand && !this.renderer.isAutoShapeDetection
        );
      }
    }
    if (this.autoShapeBtn) {
      if (!this.freehandEnabled) {
        this.autoShapeBtn.classList.add("is-hidden");
        this.autoShapeBtn.classList.remove("is-active");
      } else {
        this.autoShapeBtn.classList.remove("is-hidden");
        this.autoShapeBtn.classList.toggle(
          "is-active",
          isFreehand && this.renderer.isAutoShapeDetection
        );
      }
    }
  }

  setFreehandEnabled(enabled: boolean): void {
    this.freehandEnabled = enabled;
    this.updateToolMode();
  }

  updatePaletteButtonState(isOpen: boolean): void {
    if (this.paletteBtn) {
      this.paletteBtn.classList.toggle("is-active", isOpen);
    }
  }

  closeAllPopovers(): void {
    this.closeFileMenu();
    this.closeConnectorMenu();
    this.closeColorPalette();
    this.closeAlignMenu();
    this.closeFontSizeMenu();
  }

  // ==========================================
  // File Menu Dropdown
  // ==========================================
  toggleFileMenu(): void {
    if (this.fileMenuPopoverEl) {
      this.closeFileMenu();
    } else {
      this.openFileMenu();
    }
  }

  openFileMenu(): void {
    if (this.fileMenuPopoverEl) return;
    this.closeAllPopovers();

    const popover = createDiv({ cls: "umlcanvas-menu-dropdown umlcanvas-file-menu-dropdown" });

    const addItem = (
      label: string,
      iconId: string,
      action: () => void,
      shortcut?: string
    ) => {
      const item = popover.createEl("button", { cls: "umlcanvas-menu-item" });
      const iconSpan = item.createSpan({ cls: "umlcanvas-menu-item-icon" });
      renderIcon(iconSpan, iconId);
      item.createSpan({ cls: "umlcanvas-menu-item-label", text: label });
      if (shortcut) {
        item.createSpan({ cls: "umlcanvas-menu-item-shortcut", text: shortcut });
      }
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        action();
        this.closeFileMenu();
      });
    };

    const addDivider = () => {
      popover.createDiv({ cls: "umlcanvas-menu-divider" });
    };

    // 1. Save
    addItem(
      "Save Diagram",
      "save",
      () => {
        if (this.onSaveRequested) {
          this.onSaveRequested();
        } else {
          this.editor.markClean();
        }
      },
      "Ctrl+S"
    );

    addDivider();

    // 2. Export Standalone SVG
    addItem("Export Standalone SVG", "image", () => {
      if (this.onExportSvg) {
        this.onExportSvg();
      } else {
        const svgContent = this.editor.exportToSvg();
        const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = createEl("a", { href: url });
        a.download = `${this.editor.diagram.title || "diagram"}.svg`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });

    // 3. Export for AI / Markdown
    addItem("Export for LLM / Markdown", "sparkles", () => {
      const md = this.editor.exportForRAG();
      if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
        void navigator.clipboard.writeText(md);
      }
    });

    // 5. Notes & Images Options
    addDivider();
    addItem("Insert Sticky Note", "sticky-note", () => {
      this.addStickyNoteAtCenter();
    });
    addItem("Insert Image (Photo Frame)...", "image", () => {
      if (this.onAddImageRequested) {
        this.onAddImageRequested();
      } else {
        this.addImageAtCenter();
      }
    });
    if (this.onAddNoteRequested) {
      addItem("Insert Note from Vault...", "file-text", () => {
        this.onAddNoteRequested!();
      });
    }

    // 6. Theme Toggle Option
    if (this.onToggleTheme) {
      addDivider();
      const isLightNow =
        (this.container.classList.contains("umlcanvas-theme-light") ||
          this.container.classList.contains("theme-light")) &&
        !this.container.classList.contains("umlcanvas-theme-dark");
      addItem(
        isLightNow ? "Switch to Dark Theme" : "Switch to Pastel Light Theme",
        isLightNow ? "moon" : "sun",
        () => {
          this.onToggleTheme!();
        }
      );
    }

    this.container.appendChild(popover);
    this.fileMenuPopoverEl = popover;
    this.fileBtn.classList.add("is-active");

    this.positionPopover(popover, this.fileBtn, 6, 220);

    this.fileWinClickBound = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        this.fileMenuPopoverEl &&
        !this.fileMenuPopoverEl.contains(target) &&
        target !== this.fileBtn &&
        !this.fileBtn.contains(target)
      ) {
        this.closeFileMenu();
      }
    };
    window.setTimeout(() => {
      if (typeof window !== "undefined" && window?.addEventListener && this.fileWinClickBound) {
        window.addEventListener("mousedown", this.fileWinClickBound);
      }
    }, 0);
  }

  closeFileMenu(): void {
    if (this.fileWinClickBound) {
      if (typeof window !== "undefined" && window?.removeEventListener) {
        window.removeEventListener("mousedown", this.fileWinClickBound);
      }
      this.fileWinClickBound = null;
    }
    if (this.fileMenuPopoverEl) {
      this.fileMenuPopoverEl.remove();
      this.fileMenuPopoverEl = null;
    }
    if (this.fileBtn) {
      this.fileBtn.classList.remove("is-active");
    }
  }

  // ==========================================
  // Connector Style Popover
  // ==========================================
  // ==========================================
  // Connector Style Popover
  // ==========================================
  toggleConnectorMenu(anchorEl?: HTMLElement): void {
    if (this.connectorPopoverEl) {
      this.closeConnectorMenu();
    } else {
      this.openConnectorMenu(anchorEl);
    }
  }

  openConnectorMenu(anchorEl?: HTMLElement): void {
    if (this.connectorPopoverEl) return;
    this.closeAllPopovers();

    const anchor =
      anchorEl ??
      (this.editor.selectedEdgeIds.length > 0 && this.edgeStyleBtn && !this.edgeStyleBtn.classList.contains("is-hidden")
        ? this.edgeStyleBtn
        : this.lineBtn);
    this.currentConnectorAnchor = anchor;

    const popover = createDiv({
      cls: "umlcanvas-menu-dropdown umlcanvas-connector-popover umlcanvas-line-popover",
    });
    popover.addEventListener("mousedown", (e) => e.stopPropagation());
    popover.createDiv({ cls: "umlcanvas-menu-header", text: "Line & Connector Settings" });

    const firstSelectedEdge =
      this.editor.selectedEdgeIds.length > 0
        ? this.editor.diagram.edges.find((ed) => ed.id === this.editor.selectedEdgeIds[0])
        : undefined;

    const activeStart = firstSelectedEdge
      ? this.editor.getEdgeEffectiveStartMarker(firstSelectedEdge)
      : (this.editor.defaultMarkerStart ?? "none");

    const activeEnd = firstSelectedEdge
      ? this.editor.getEdgeEffectiveEndMarker(firstSelectedEdge)
      : (this.editor.defaultMarkerEnd ?? (this.editor.activeEdgeKind ? (defaultEdgeStyleRegistry.get(this.editor.activeEdgeKind).markerEndId ?? "none") : "none"));

    const activeLineType = firstSelectedEdge
      ? this.editor.getEdgeEffectiveLineType(firstSelectedEdge)
      : (this.editor.defaultLineType ?? "solid");

    const activeRouting = firstSelectedEdge
      ? firstSelectedEdge.routing
      : this.editor.defaultRouting;

    const currentKind = firstSelectedEdge
      ? firstSelectedEdge.kind
      : this.editor.activeEdgeKind;

    const markerOptions: Array<{ id: LineEndingType; label: string; iconId: string }> = [
      { id: "none", label: "None", iconId: "minus" },
      { id: "arrow-open", label: "Open Arrow", iconId: "arrow-up-right" },
      { id: "arrow-filled", label: "Filled Arrow", iconId: "arrow-up-right" },
      { id: "triangle-hollow", label: "Hollow Triangle", iconId: "triangle" },
      { id: "triangle-filled", label: "Filled Triangle", iconId: "triangle" },
      { id: "diamond-hollow", label: "Hollow Diamond", iconId: "diamond" },
      { id: "diamond-filled", label: "Filled Diamond", iconId: "diamond" },
      { id: "circle-hollow", label: "Hollow Circle", iconId: "circle" },
      { id: "circle-filled", label: "Filled Circle", iconId: "circle" },
      { id: "stop", label: "Stop Bar", iconId: "pause" },
    ];

    const isMarkerMatch = (current: string, target: string) => {
      const c = current.replace(/^uml-marker-/, "");
      const t = target.replace(/^uml-marker-/, "");
      if (c === t) return true;
      if (t === "none" && (!c || c === "none")) return true;
      if (t === "arrow-open" && c === "open-arrow") return true;
      if (t === "open-arrow" && c === "arrow-open") return true;
      if (t === "arrow-filled" && (c === "arrow-head" || c === "arrow")) return true;
      if (t === "stop" && c === "timing-stop") return true;
      if (t === "triangle-hollow" && c === "triangle") return true;
      if (t === "diamond-hollow" && c === "diamond") return true;
      if (t === "circle-hollow" && c === "circle") return true;
      if (t === "circle-filled" && (c === "dot" || c === "filled-circle")) return true;
      return false;
    };

    // 1. Start Ending
    popover.createDiv({ cls: "umlcanvas-line-section-title", text: "Start Ending" });
    const startGrid = popover.createDiv({ cls: "umlcanvas-line-marker-grid" });
    for (const opt of markerOptions) {
      const isSelectedStart = isMarkerMatch(activeStart, opt.id);
      const btn = startGrid.createEl("button", {
        cls: `umlcanvas-line-opt-btn umlcanvas-start-marker-opt${isSelectedStart ? " is-active" : ""}`,
      });
      const iconSpan = btn.createSpan({ cls: "umlcanvas-line-opt-icon" });
      renderIcon(iconSpan, opt.iconId);
      btn.createSpan({ text: opt.label });
      btn.title = `Start Ending: ${opt.label}`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.editor.defaultMarkerStart = opt.id;
        for (const edgeId of this.editor.selectedEdgeIds) {
          this.editor.setEdgeMarkerStart(edgeId, opt.id);
        }
        this.updateState();
        startGrid.querySelectorAll(".umlcanvas-start-marker-opt").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
      });
    }

    // 2. Line Type
    popover.createDiv({ cls: "umlcanvas-line-section-title", text: "Line Type" });
    const typeRow = popover.createDiv({ cls: "umlcanvas-line-type-row" });
    const lineTypes: Array<{ id: LinePatternType; label: string }> = [
      { id: "solid", label: "Solid" },
      { id: "dashed", label: "Dashed" },
      { id: "dotted", label: "Dotted" },
      { id: "dash-dot", label: "Dash-Dot" },
      { id: "long-dash", label: "Long-Dash" },
    ];
    for (const pat of lineTypes) {
      const isSelectedType = activeLineType === pat.id;
      const btn = typeRow.createEl("button", {
        cls: `umlcanvas-line-opt-btn umlcanvas-linetype-opt${isSelectedType ? " is-active" : ""}`,
      });
      btn.createSpan({ text: pat.label });
      btn.title = `Line Type: ${pat.label}`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.editor.defaultLineType = pat.id;
        for (const edgeId of this.editor.selectedEdgeIds) {
          this.editor.setEdgeLineType(edgeId, pat.id);
        }
        this.updateState();
        typeRow.querySelectorAll(".umlcanvas-linetype-opt").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
      });
    }

    // 3. End Ending
    popover.createDiv({ cls: "umlcanvas-line-section-title", text: "End Ending" });
    const endGrid = popover.createDiv({ cls: "umlcanvas-line-marker-grid" });
    for (const opt of markerOptions) {
      const isSelectedEnd = isMarkerMatch(activeEnd, opt.id);
      const btn = endGrid.createEl("button", {
        cls: `umlcanvas-line-opt-btn umlcanvas-end-marker-opt${isSelectedEnd ? " is-active" : ""}`,
      });
      const iconSpan = btn.createSpan({ cls: "umlcanvas-line-opt-icon" });
      renderIcon(iconSpan, opt.iconId);
      btn.createSpan({ text: opt.label });
      btn.title = `End Ending: ${opt.label}`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.editor.defaultMarkerEnd = opt.id;
        for (const edgeId of this.editor.selectedEdgeIds) {
          this.editor.setEdgeMarkerEnd(edgeId, opt.id);
        }
        this.updateState();
        endGrid.querySelectorAll(".umlcanvas-end-marker-opt").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
      });
    }

    // 4. Routing
    popover.createDiv({ cls: "umlcanvas-line-section-title", text: "Routing" });
    const routeRow = popover.createDiv({ cls: "umlcanvas-line-type-row" });
    const routingOptions: Array<{ id: EdgeRouting; label: string; iconId: string }> = [
      { id: "orthogonal", label: "Orthogonal", iconId: "git-branch" },
      { id: "straight", label: "Straight", iconId: "minus" },
      { id: "curved", label: "Curved", iconId: "activity" },
    ];
    for (const r of routingOptions) {
      const isSelectedRoute = activeRouting === r.id;
      const btn = routeRow.createEl("button", {
        cls: `umlcanvas-line-opt-btn umlcanvas-routing-opt${isSelectedRoute ? " is-active" : ""}`,
      });
      const iconSpan = btn.createSpan({ cls: "umlcanvas-line-opt-icon" });
      renderIcon(iconSpan, r.iconId);
      btn.createSpan({ text: r.label });
      btn.title = `Routing: ${r.label}`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.editor.defaultRouting = r.id;
        for (const edgeId of this.editor.selectedEdgeIds) {
          this.editor.updateEdgeRouting(edgeId, r.id);
        }
        this.updateState();
        routeRow.querySelectorAll(".umlcanvas-routing-opt").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
      });
    }

    // 5. UML Class Diagram Presets
    popover.createDiv({ cls: "umlcanvas-menu-divider" });
    popover.createDiv({ cls: "umlcanvas-line-section-title", text: "UML Class Diagram Presets" });

    const styles: Array<{ kind: string; label: string; iconId: string }> = [
      { kind: "uml.association", label: "Association (Line)", iconId: "minus" },
      { kind: "uml.directedAssociation", label: "Directed Association (Arrow)", iconId: "arrow-up-right" },
      { kind: "uml.aggregation", label: "Aggregation (Hollow Diamond)", iconId: "diamond" },
      { kind: "uml.composition", label: "Composition (Filled Diamond)", iconId: "diamond" },
      { kind: "uml.generalization", label: "Generalization (Inherit)", iconId: "triangle" },
      { kind: "uml.realization", label: "Realization (Dashed)", iconId: "git-branch" },
      { kind: "uml.dependency", label: "Dependency (Arrow)", iconId: "arrow-up-right" },
      { kind: "uml.directedAggregation", label: "Directed Aggregation (Diamond + Arrow)", iconId: "diamond" },
      { kind: "uml.directedComposition", label: "Directed Composition (Diamond + Arrow)", iconId: "diamond" },
      { kind: "uml.link", label: "Plain Link", iconId: "minus" },
    ];

    for (const style of styles) {
      const item = popover.createEl("button", { cls: "umlcanvas-menu-item" });
      if (currentKind === style.kind) {
        item.classList.add("is-active");
      }
      const iconSpan = item.createSpan({ cls: "umlcanvas-menu-item-icon" });
      renderIcon(iconSpan, style.iconId);
      item.createSpan({ cls: "umlcanvas-menu-item-label", text: style.label });

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        this.editor.activeEdgeKind = style.kind;
        const def = defaultEdgeStyleRegistry.get(style.kind);
        this.editor.defaultMarkerStart = def.markerStartId ?? "none";
        this.editor.defaultMarkerEnd = def.markerEndId ?? "none";
        this.editor.defaultLineType = def.strokeDasharray ? "dashed" : "solid";
        for (const edgeId of this.editor.selectedEdgeIds) {
          this.editor.updateEdgeKind(edgeId, style.kind);
        }
        this.closeConnectorMenu();
      });
    }

    // 6. Actions (when an edge is selected)
    if (this.editor.selectedEdgeIds.length > 0) {
      popover.createDiv({ cls: "umlcanvas-menu-divider" });
      popover.createDiv({ cls: "umlcanvas-line-section-title", text: "Line Actions" });
      const actionsRow = popover.createDiv({ cls: "umlcanvas-line-type-row" });

      const revBtn = actionsRow.createEl("button", { cls: "umlcanvas-line-opt-btn" });
      const revIcon = revBtn.createSpan({ cls: "umlcanvas-line-opt-icon" });
      renderIcon(revIcon, "arrow-left-right");
      revBtn.createSpan({ text: "Reverse Direction" });
      revBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        for (const id of this.editor.selectedEdgeIds) {
          this.editor.reverseEdge(id);
        }
        this.closeConnectorMenu();
      });

      const rerouteActionBtn = actionsRow.createEl("button", { cls: "umlcanvas-line-opt-btn" });
      const rerouteIcon = rerouteActionBtn.createSpan({ cls: "umlcanvas-line-opt-icon" });
      renderIcon(rerouteIcon, "refresh-cw");
      rerouteActionBtn.createSpan({ text: "Reset Bend Points" });
      rerouteActionBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        for (const id of this.editor.selectedEdgeIds) {
          this.editor.rerouteEdge(id);
        }
        this.closeConnectorMenu();
      });
    }

    popover.createDiv({ cls: "umlcanvas-menu-divider" });
    popover.createDiv({
      cls: "umlcanvas-menu-tip",
      text: "Tip: Select 2 nodes to connect directly, or drag from any node port.",
    });

    this.container.appendChild(popover);
    this.connectorPopoverEl = popover;
    if (anchor) {
      anchor.classList.add("is-active");
    }

    const btnRect = anchor ? anchor.getBoundingClientRect() : { left: 10, top: 10, right: 10, bottom: 10 };
    const containerRect = this.container.getBoundingClientRect();
    const isTopToolbar = anchor && this.mainToolbarEl && (this.mainToolbarEl === anchor || this.mainToolbarEl.contains(anchor));

    const popoverWidth = popover.offsetWidth || 300;
    const maxLeft = Math.max(10, containerRect.width - popoverWidth - 10);

    if (isTopToolbar) {
      const left = Math.min(Math.max(10, btnRect.left - containerRect.left), maxLeft);
      const top = btnRect.bottom - containerRect.top + 8;
      popover.setCssStyles({ left: `${left}px`, top: `${top}px`, bottom: "auto" });
    } else {
      const left = Math.min(Math.max(10, btnRect.left - containerRect.left - 50), maxLeft);
      const bottom = containerRect.bottom - btnRect.top + 8;
      popover.setCssStyles({ left: `${left}px`, bottom: `${bottom}px`, top: "auto" });
    }

    this.connectorWinClickBound = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const insidePopover =
        this.connectorPopoverEl &&
        (this.connectorPopoverEl === target ||
          (typeof this.connectorPopoverEl.contains === "function" &&
            this.connectorPopoverEl.contains(target)));
      const insideAnchor =
        anchor &&
        (anchor === target ||
          (typeof anchor.contains === "function" && anchor.contains(target)));

      if (!insidePopover && !insideAnchor) {
        this.closeConnectorMenu();
      }
    };
    window.setTimeout(() => {
      if (typeof window !== "undefined" && window?.addEventListener && this.connectorWinClickBound) {
        window.addEventListener("mousedown", this.connectorWinClickBound);
      }
    }, 0);
  }

  closeConnectorMenu(): void {
    if (this.connectorWinClickBound) {
      if (typeof window !== "undefined" && window?.removeEventListener) {
        window.removeEventListener("mousedown", this.connectorWinClickBound);
      }
      this.connectorWinClickBound = null;
    }
    if (this.connectorPopoverEl) {
      this.connectorPopoverEl.remove();
      this.connectorPopoverEl = null;
    }
    if (this.currentConnectorAnchor) {
      this.currentConnectorAnchor.classList.remove("is-active");
      this.currentConnectorAnchor = null;
    }
    if (this.lineBtn) {
      this.lineBtn.classList.remove("is-active");
    }
  }

  // ==========================================
  // Color Palette Popover
  // ==========================================
  toggleColorPalette(): void {
    if (this.colorPaletteEl) {
      this.closeColorPalette();
    } else {
      this.openColorPalette();
    }
  }

  openColorPalette(): void {
    if (this.colorPaletteEl) return;
    this.closeAllPopovers();

    const popover = createDiv({ cls: "umlcanvas-color-palette-popover" });
    popover.addEventListener("mousedown", (e) => e.stopPropagation());
    const row = popover.createDiv({ cls: "umlcanvas-color-swatches-row" });

    // None / Reset button
    const noneBtn = row.createEl("button", {
      cls: "umlcanvas-color-swatch is-none",
      title: "Default / No color (Alt+0)",
      attr: { "aria-label": "Default / No color" },
    });
    const noneIcon = noneBtn.createSpan({
      cls: "umlcanvas-color-swatch-none-icon",
    });
    renderIcon(noneIcon, "ban");
    noneBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.editor.setColorForSelection(undefined);
      this.closeColorPalette();
    });

    const selectedNodes = this.editor.diagram.nodes.filter((n) =>
      this.editor.selectedNodeIds.includes(n.id)
    );
    const selectedEdges = this.editor.diagram.edges.filter((e) =>
      this.editor.selectedEdgeIds.includes(e.id)
    );
    const selectedGroups = this.editor.diagram.groups.filter((g) =>
      this.editor.selectedGroupIds.includes(g.id)
    );
    const activeColor =
      selectedNodes[0]?.style?.color ??
      selectedEdges[0]?.style?.color ??
      selectedGroups[0]?.color;

    // 6 Presets
    for (const preset of CANVAS_COLOR_PRESETS) {
      const swatch = row.createEl("button", {
        cls: `umlcanvas-color-swatch is-preset-${preset.id}`,
        title: `${preset.label} (${preset.id}) [Alt+${preset.id}]`,
        text: preset.id,
      });
      if (activeColor === preset.id) {
        swatch.classList.add("is-active");
      }
      swatch.addEventListener("click", (e) => {
        e.stopPropagation();
        this.editor.setColorForSelection(preset.id);
        this.closeColorPalette();
      });
    }

    // Custom color input
    const customLabel = row.createEl("label", {
      cls: "umlcanvas-color-swatch is-custom",
      title: "Custom Color...",
    });

    const customInput = customLabel.createEl("input", {
      type: "color",
      cls: "umlcanvas-color-custom-input",
      value:
        activeColor && activeColor.startsWith("#") ? activeColor : "#7b68ee",
    });
    customInput.addEventListener("input", (e) => {
      e.stopPropagation();
      this.editor.setColorForSelection(customInput.value);
    });
    customInput.addEventListener("change", (e) => {
      e.stopPropagation();
      this.editor.setColorForSelection(customInput.value);
      this.closeColorPalette();
    });

    const customIcon = customLabel.createSpan({
      cls: "umlcanvas-color-swatch-custom-icon",
    });
    renderIcon(customIcon, "pipette");

    popover.appendChild(row);

    this.container.appendChild(popover);
    this.colorPaletteEl = popover;
    this.colorBtn.classList.add("is-active");

    this.positionPopover(popover, this.colorBtn, 6, 260);

    this.onWindowClickBound = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        this.colorPaletteEl &&
        !this.colorPaletteEl.contains(target) &&
        target !== this.colorBtn &&
        !this.colorBtn.contains(target)
      ) {
        this.closeColorPalette();
      }
    };
    window.setTimeout(() => {
      if (typeof window !== "undefined" && window?.addEventListener && this.onWindowClickBound) {
        window.addEventListener("mousedown", this.onWindowClickBound);
      }
    }, 0);
  }

  closeColorPalette(): void {
    if (this.colorPaletteEl) {
      this.colorPaletteEl.remove();
      this.colorPaletteEl = null;
    }
    if (this.colorBtn) {
      this.colorBtn.classList.remove("is-active");
    }
    if (this.onWindowClickBound) {
      if (typeof window !== "undefined" && window?.removeEventListener) {
        window.removeEventListener("mousedown", this.onWindowClickBound);
      }
      this.onWindowClickBound = null;
    }
  }

  // ==========================================
  // Align & Distribute Menu
  // ==========================================
  toggleAlignMenu(): void {
    if (this.alignPopoverEl) {
      this.closeAlignMenu();
    } else {
      this.openAlignMenu();
    }
  }

  openAlignMenu(): void {
    if (this.alignPopoverEl) return;
    this.closeAllPopovers();

    const popover = createDiv({ cls: "umlcanvas-align-popover" });
    popover.addEventListener("mousedown", (e) => e.stopPropagation());

    const createItem = (
      label: string,
      iconId: string,
      action: () => void,
      disabled?: boolean
    ) => {
      const btn = popover.createEl("button", { cls: "umlcanvas-align-item" });
      if (disabled) {
        btn.disabled = true;
      }
      const iconSpan = btn.createSpan({ cls: "umlcanvas-align-icon" });
      renderIcon(iconSpan, iconId);

      btn.createSpan({ cls: "umlcanvas-align-label", text: label });

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        action();
        this.closeAlignMenu();
      });
    };

    const addSeparator = () => {
      popover.createDiv({ cls: "umlcanvas-align-separator" });
    };

    // Alignment Options
    createItem("Align Left", "align-left", () => this.editor.alignNodes("left"));
    createItem("Align Center", "align-center", () => this.editor.alignNodes("center"));
    createItem("Align Right", "align-right", () => this.editor.alignNodes("right"));
    addSeparator();
    createItem("Align Top", "arrow-up", () => this.editor.alignNodes("top"));
    createItem("Align Middle", "minus", () => this.editor.alignNodes("middle"));
    createItem("Align Bottom", "arrow-down", () => this.editor.alignNodes("bottom"));
    addSeparator();

    // Distribution Options (disabled if < 3 nodes)
    const canDistribute = this.editor.selectedNodeIds.length >= 3;
    createItem(
      "Distribute Horizontally",
      "more-horizontal",
      () => this.editor.distributeNodes("horizontal"),
      !canDistribute
    );
    createItem(
      "Distribute Vertically",
      "more-vertical",
      () => this.editor.distributeNodes("vertical"),
      !canDistribute
    );
    addSeparator();

    // Size Matching Options
    createItem("Match Width", "scaling", () => this.editor.matchNodeSizes("width"));
    createItem("Match Height", "scaling", () => this.editor.matchNodeSizes("height"));
    createItem("Match Both", "maximize-2", () => this.editor.matchNodeSizes("both"));

    this.container.appendChild(popover);
    this.alignPopoverEl = popover;
    if (this.alignBtn) {
      this.alignBtn.classList.add("is-active");
    }

    this.positionPopover(popover, this.alignBtn, 6, 240);

    const onWinClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        popover &&
        !popover.contains(target) &&
        target !== this.alignBtn &&
        !this.alignBtn?.contains(target)
      ) {
        this.closeAlignMenu();
      }
    };
    this.alignWinClickBound = onWinClick;
    this.alignCloseTimer = window.setTimeout(() => {
      this.alignCloseTimer = null;
      if (typeof window !== "undefined" && window?.addEventListener && this.alignWinClickBound) {
        window.addEventListener("mousedown", this.alignWinClickBound);
      }
    }, 0);
  }

  closeAlignMenu(): void {
    if (this.alignCloseTimer !== null) {
      window.clearTimeout(this.alignCloseTimer);
      this.alignCloseTimer = null;
    }
    if (this.alignWinClickBound) {
      if (typeof window !== "undefined" && window?.removeEventListener) {
        window.removeEventListener("mousedown", this.alignWinClickBound);
      }
      this.alignWinClickBound = null;
    }
    if (this.alignPopoverEl) {
      this.alignPopoverEl.remove();
      this.alignPopoverEl = null;
    }
    if (this.alignBtn) {
      this.alignBtn.classList.remove("is-active");
    }
  }

  stepFontSize(direction: 1 | -1): void {
    if (this.renderer.activeInlineEditor && this.renderer.activeEditingNodeId) {
      if (!this.editor.isNodeSelected(this.renderer.activeEditingNodeId)) {
        this.editor.selectNode(this.renderer.activeEditingNodeId, false);
      }
    }
    const currentFont = this.editor.getSelectionFont();
    const currentSize = currentFont.fontSize ?? 13;
    const newSize = getNextFontSize(currentSize, direction);
    this.editor.setFontSizeForSelection(newSize);
    if (this.renderer.activeInlineEditor) {
      this.renderer.updateInlineEditorPosition();
    }
  }

  toggleBold(): void {
    if (this.renderer.activeInlineEditor && this.renderer.activeEditingNodeId) {
      if (!this.editor.isNodeSelected(this.renderer.activeEditingNodeId)) {
        this.editor.selectNode(this.renderer.activeEditingNodeId, false);
      }
    }
    this.editor.toggleBoldForSelection();
    if (this.renderer.activeInlineEditor) {
      this.renderer.updateInlineEditorPosition();
    }
  }

  toggleItalic(): void {
    if (this.renderer.activeInlineEditor && this.renderer.activeEditingNodeId) {
      if (!this.editor.isNodeSelected(this.renderer.activeEditingNodeId)) {
        this.editor.selectNode(this.renderer.activeEditingNodeId, false);
      }
    }
    this.editor.toggleItalicForSelection();
    if (this.renderer.activeInlineEditor) {
      this.renderer.updateInlineEditorPosition();
    }
  }

  // ==========================================
  // Font Size Popover Menu
  // ==========================================
  toggleFontSizeMenu(anchorEl?: HTMLElement): void {
    if (this.fontSizePopoverEl) {
      this.closeFontSizeMenu();
    } else {
      this.openFontSizeMenu(anchorEl);
    }
  }

  openFontSizeMenu(anchorEl?: HTMLElement): void {
    if (this.fontSizePopoverEl) return;
    this.closeAllPopovers();

    const popover = createDiv({ cls: "umlcanvas-font-size-popover" });
    popover.addEventListener("mousedown", (e) => {
      markEventHandled(e);
      e.stopPropagation();
    });
    const currentFont = this.editor.getSelectionFont();
    const currentSize = currentFont.fontSize ?? 13;

    // 1. Header / Stepper row
    const stepperRow = popover.createDiv({ cls: "umlcanvas-font-stepper-row" });

    const decBtn = stepperRow.createEl("button", {
      cls: "umlcanvas-font-step-btn",
      text: "A−",
      title: "Decrease Font Size (-2px) [Ctrl+[]",
      attr: { "aria-label": "Decrease Font Size" },
    });
    decBtn.addEventListener("mousedown", (e) => {
      markEventHandled(e);
      e.stopPropagation();
      e.preventDefault();
    });

    const sizeDisplay = stepperRow.createSpan({
      cls: "umlcanvas-font-size-display",
      text: `${currentSize}px`,
    });

    decBtn.addEventListener("click", (e) => {
      markEventHandled(e);
      e.stopPropagation();
      this.stepFontSize(-1);
      const f = this.editor.getSelectionFont();
      sizeDisplay.textContent = `${f.fontSize ?? 13}px`;
    });

    const incBtn = stepperRow.createEl("button", {
      cls: "umlcanvas-font-step-btn",
      text: "A+",
      title: "Increase Font Size (+2px) [Ctrl+]]",
      attr: { "aria-label": "Increase Font Size" },
    });
    incBtn.addEventListener("mousedown", (e) => {
      markEventHandled(e);
      e.stopPropagation();
      e.preventDefault();
    });
    incBtn.addEventListener("click", (e) => {
      markEventHandled(e);
      e.stopPropagation();
      this.stepFontSize(1);
      const f = this.editor.getSelectionFont();
      sizeDisplay.textContent = `${f.fontSize ?? 13}px`;
    });

    // 2. Font Style Quick Row (Bold & Italic pills)
    const styleRow = popover.createDiv({ cls: "umlcanvas-font-style-row" });
    const popoverBoldBtn = styleRow.createEl("button", {
      cls: "umlcanvas-font-pill-btn",
      text: "Bold (Ctrl+B)",
      title: "Toggle Bold Style",
    });
    if (currentFont.isBold || currentFont.bold) popoverBoldBtn.classList.add("is-active");
    popoverBoldBtn.addEventListener("mousedown", (e) => {
      markEventHandled(e);
      e.stopPropagation();
      e.preventDefault();
    });
    popoverBoldBtn.addEventListener("click", (e) => {
      markEventHandled(e);
      e.stopPropagation();
      this.editor.toggleBoldForSelection();
      const f = this.editor.getSelectionFont();
      popoverBoldBtn.classList.toggle("is-active", Boolean(f.isBold || f.bold));
    });

    const popoverItalicBtn = styleRow.createEl("button", {
      cls: "umlcanvas-font-pill-btn",
      text: "Italic (Ctrl+I)",
      title: "Toggle Italic Style",
    });
    if (currentFont.isItalic || currentFont.italic) popoverItalicBtn.classList.add("is-active");
    popoverItalicBtn.addEventListener("mousedown", (e) => {
      markEventHandled(e);
      e.stopPropagation();
      e.preventDefault();
    });
    popoverItalicBtn.addEventListener("click", (e) => {
      markEventHandled(e);
      e.stopPropagation();
      this.editor.toggleItalicForSelection();
      const f = this.editor.getSelectionFont();
      popoverItalicBtn.classList.toggle("is-active", Boolean(f.isItalic || f.italic));
    });

    // 3. Font Family Section
    const familySection = popover.createDiv({ cls: "umlcanvas-font-section" });
    familySection.createSpan({ cls: "umlcanvas-font-section-title", text: "Font Style & Family" });
    const familyRow = familySection.createDiv({ cls: "umlcanvas-font-family-row" });
    for (const preset of FONT_FAMILY_PRESETS) {
      const famBtn = familyRow.createEl("button", {
        cls: "umlcanvas-font-family-item",
        text: preset.label,
        title: preset.label,
      });
      famBtn.style.fontFamily = preset.fontFamily;
      const isCurrentFamily = currentFont.fontFamily
        ? currentFont.fontFamily === preset.fontFamily || currentFont.fontFamily === preset.id
        : preset.id === "sans";
      if (isCurrentFamily) {
        famBtn.classList.add("is-active");
      }
      famBtn.addEventListener("mousedown", (e) => {
        markEventHandled(e);
        e.stopPropagation();
        e.preventDefault();
      });
      famBtn.addEventListener("click", (e) => {
        markEventHandled(e);
        e.stopPropagation();
        this.editor.setFontFamilyForSelection(preset.fontFamily);
        this.closeFontSizeMenu();
      });
    }

    // 4. Preset options list
    const sizeSection = popover.createDiv({ cls: "umlcanvas-font-section" });
    sizeSection.createSpan({ cls: "umlcanvas-font-section-title", text: "Font Size Presets" });
    const presetsList = sizeSection.createDiv({ cls: "umlcanvas-font-presets-list" });
    for (const preset of FONT_SIZE_PRESETS) {
      const presetBtn = presetsList.createEl("button", {
        cls: "umlcanvas-font-preset-btn",
        title: `${preset.label} (${preset.size}px)`,
        attr: { "aria-label": `${preset.label} (${preset.size}px)` },
      });
      if (currentSize === preset.size) {
        presetBtn.classList.add("is-active");
      }
      presetBtn.createSpan({
        cls: "umlcanvas-font-preset-label",
        text: preset.label,
      });
      presetBtn.createSpan({
        cls: "umlcanvas-font-preset-size",
        text: `${preset.size}px`,
      });

      presetBtn.addEventListener("mousedown", (e) => {
        markEventHandled(e);
        e.stopPropagation();
        e.preventDefault();
      });
      presetBtn.addEventListener("click", (e) => {
        markEventHandled(e);
        e.stopPropagation();
        this.editor.setFontSizeForSelection(preset.size);
        this.closeFontSizeMenu();
      });
    }

    // 5. Actions row
    const actionsRow = popover.createDiv({ cls: "umlcanvas-font-actions-row" });
    const applyAllBtn = actionsRow.createEl("button", {
      cls: "umlcanvas-font-apply-all-btn",
      text: "Apply to All Canvas Elements",
      title: "Apply current typography settings across all elements on canvas",
      attr: { "aria-label": "Apply to All Canvas Elements" },
    });
    applyAllBtn.addEventListener("mousedown", (e) => {
      markEventHandled(e);
      e.stopPropagation();
      e.preventDefault();
    });
    applyAllBtn.addEventListener("click", (e) => {
      markEventHandled(e);
      e.stopPropagation();
      const f = this.editor.getSelectionFont();
      this.editor.setFontForAllElements({
        fontSize: f.fontSize,
        bold: Boolean(f.isBold || f.bold),
        italic: Boolean(f.isItalic || f.italic),
        fontFamily: f.fontFamily,
      });
      this.closeFontSizeMenu();
    });

    const resetBtn = actionsRow.createEl("button", {
      cls: "umlcanvas-font-reset-btn",
      text: "Reset Typography",
      title: "Reset font to default (13px, normal weight & style)",
      attr: { "aria-label": "Reset Typography" },
    });
    resetBtn.addEventListener("mousedown", (e) => {
      markEventHandled(e);
      e.stopPropagation();
      e.preventDefault();
    });
    resetBtn.addEventListener("click", (e) => {
      markEventHandled(e);
      e.stopPropagation();
      this.editor.resetFontForSelection();
      this.closeFontSizeMenu();
    });

    this.container.appendChild(popover);
    this.fontSizePopoverEl = popover;

    const anchor = anchorEl || this.fontSizeBtn;
    if (anchor === this.contextFontSizeBtn || anchor === this.contextFontFamilyBtn) {
      if (this.contextFontSizeBtn) this.contextFontSizeBtn.classList.add("is-active");
      if (this.contextFontFamilyBtn) this.contextFontFamilyBtn.classList.add("is-active");
    } else {
      if (this.fontSizeBtn) this.fontSizeBtn.classList.add("is-active");
      if (this.fontFamilyBtn) this.fontFamilyBtn.classList.add("is-active");
    }

    this.positionPopover(popover, anchor, 6, 260);

    this.fontSizeWinClickBound = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        this.fontSizePopoverEl &&
        !this.fontSizePopoverEl.contains(target) &&
        target !== this.fontSizeBtn &&
        !this.fontSizeBtn?.contains(target) &&
        target !== this.fontFamilyBtn &&
        !this.fontFamilyBtn?.contains(target) &&
        target !== this.contextFontSizeBtn &&
        !this.contextFontSizeBtn?.contains(target) &&
        target !== this.contextFontFamilyBtn &&
        !this.contextFontFamilyBtn?.contains(target)
      ) {
        this.closeFontSizeMenu();
      }
    };
    window.setTimeout(() => {
      if (typeof window !== "undefined" && window?.addEventListener && this.fontSizeWinClickBound) {
        window.addEventListener("mousedown", this.fontSizeWinClickBound);
      }
    }, 0);
  }

  closeFontSizeMenu(): void {
    if (this.fontSizePopoverEl) {
      this.fontSizePopoverEl.remove();
      this.fontSizePopoverEl = null;
    }
    if (this.fontSizeBtn) {
      this.fontSizeBtn.classList.remove("is-active");
    }
    if (this.fontFamilyBtn) {
      this.fontFamilyBtn.classList.remove("is-active");
    }
    if (this.contextFontSizeBtn) {
      this.contextFontSizeBtn.classList.remove("is-active");
    }
    if (this.contextFontFamilyBtn) {
      this.contextFontFamilyBtn.classList.remove("is-active");
    }
    if (this.fontSizeWinClickBound) {
      if (typeof window !== "undefined" && window?.removeEventListener) {
        window.removeEventListener("mousedown", this.fontSizeWinClickBound);
      }
      this.fontSizeWinClickBound = null;
    }
  }

  destroy(): void {
    this.closeAllPopovers();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.breadcrumbsEl.remove();
    this.mainToolbarEl.remove();
    this.bottomToolbarEl.remove();
  }
}
