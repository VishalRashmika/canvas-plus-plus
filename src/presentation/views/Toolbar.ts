import { setIcon } from "obsidian";
import { DiagramEditor } from "../../application/use-cases/DiagramEditor";
import { SvgSceneRenderer } from "../renderer/SvgSceneRenderer";
import { ViewportTransform } from "../renderer/ViewportMath";
import { EdgeRouting } from "../../domain/types";
import {
  CANVAS_COLOR_PRESETS,
  resolveCanvasColor,
} from "../../domain/value-objects/CanvasColor";

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
  private drawBtn!: HTMLButtonElement;
  private autoShapeBtn!: HTMLButtonElement;
  private rectBtn!: HTMLButtonElement;
  private circleBtn!: HTMLButtonElement;
  private diamondBtn!: HTMLButtonElement;
  private triangleBtn!: HTMLButtonElement;
  private noteBtn!: HTMLButtonElement;
  private vaultNoteBtn?: HTMLButtonElement;
  private imageBtn?: HTMLButtonElement;
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
  private edgeRoutingBtn!: HTMLButtonElement;
  private rerouteBtn!: HTMLButtonElement;
  private reverseBtn!: HTMLButtonElement;

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
  private alignCloseTimer: ReturnType<typeof setTimeout> | null = null;

  // Color Palette Popover
  private colorPaletteEl: HTMLElement | null = null;
  private onWindowClickBound: ((e: MouseEvent) => void) | null = null;

  private freehandEnabled = true;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly editor: DiagramEditor,
    private readonly renderer: SvgSceneRenderer,
    private readonly onSaveRequested?: () => void,
    private readonly onTogglePalette?: () => void,
    private readonly onExportSvg?: () => void,
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
    this.toolbarEl = this.mainToolbarEl;

    // 2. Floating Bottom Toolbar (Excalidraw style)
    this.bottomToolbarEl = this.container.createDiv({
      cls: "umlcanvas-toolbar umlcanvas-floating-bottom-toolbar",
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
      grp.classList.add(...extraClass.split(" "));
    }
    return grp;
  }

  private addDivider(parent: HTMLElement): void {
    parent.createDiv({ cls: "umlcanvas-toolbar-divider" });
  }

  private createButton(
    title: string,
    text: string,
    onClick: () => void,
    iconId?: string,
    extraClass?: string
  ): HTMLButtonElement {
    const btn = createEl("button", {
      cls: "umlcanvas-toolbar-btn",
      title,
      attr: { "aria-label": title },
    });
    if (extraClass) {
      btn.classList.add(extraClass);
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

    btn.addEventListener("click", (e) => {
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

    if (this.renderer.freehandMode) {
      this.renderer.setFreehandMode(false);
      this.updateToolMode();
    }
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
      cls: "umlcanvas-toolbar-btn",
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
    // Group 4: Context-Sensitive Selection Inspector
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
      "palette"
    );
    this.colorIndicatorEl = this.colorBtn.createSpan({
      cls: "umlcanvas-color-indicator",
    });
    this.contextGroup.appendChild(this.colorBtn);

    // Label
    this.labelBtn = this.createButton(
      "Edit Label (Enter / F2)",
      "",
      () => this.editCurrentSelectionLabel(),
      "type"
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
    // Mode Group (Select, Draw, Auto Shape)
    const modeGroup = this.createGroup(this.bottomToolbarEl);

    // Select Tool (V / Esc)
    this.selectBtn = this.createButton(
      "Select & Move (V / Esc)",
      "",
      () => {
        this.renderer.setFreehandMode(false);
        this.updateToolMode();
      },
      "mouse-pointer"
    );
    modeGroup.appendChild(this.selectBtn);

    // Draw Tool (P)
    this.drawBtn = this.createButton(
      "Draw / Freehand (P)",
      "",
      () => {
        const active = !this.renderer.freehandMode;
        this.renderer.setFreehandMode(active);
        if (active && this.renderer.isAutoShapeDetection) {
          this.renderer.setAutoShapeDetection(false);
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
        const active = !this.renderer.isAutoShapeDetection;
        this.renderer.setAutoShapeDetection(active);
        if (active && !this.renderer.freehandMode) {
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
      "Diamond / Decision (D)",
      "",
      () => {
        this.addShapeAtCenter("generic.diamond", "Decision", {
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
      this.edgeRoutingBtn.disabled = !hasSelectedEdges;
      this.edgeRoutingBtn.classList.toggle("is-hidden", !hasSelectedEdges);
      this.rerouteBtn.disabled = !hasSelectedEdges;
      this.rerouteBtn.classList.toggle("is-hidden", !hasSelectedEdges);
      this.reverseBtn.disabled = !hasSelectedEdges;
      this.reverseBtn.classList.toggle("is-hidden", !hasSelectedEdges);
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

  updateToolMode(): void {
    const isFreehand = this.renderer.freehandMode;
    if (this.selectBtn) {
      this.selectBtn.classList.toggle("is-active", !isFreehand);
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
          this.renderer.isAutoShapeDetection
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

    // 3. Export Plain Obsidian .canvas
    addItem("Export Obsidian .canvas", "file-code", () => {
      if (this.onExportCanvas) {
        this.onExportCanvas();
      } else {
        const jsonCanvas = this.editor.exportToJsonCanvas();
        const blob = new Blob([jsonCanvas], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = createEl("a", { href: url });
        a.download = `${this.editor.diagram.title || "diagram"}.canvas`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });

    // 4. Export for AI / Markdown
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
        this.container.classList.contains("umlcanvas-theme-light") ||
        this.container.classList.contains("theme-light");
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

    const btnRect = this.fileBtn.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    const left = Math.max(10, btnRect.left - containerRect.left);
    const top = btnRect.bottom - containerRect.top + 6;
    popover.setCssStyles({ left: `${left}px`, top: `${top}px` });

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
    setTimeout(() => {
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
  toggleConnectorMenu(): void {
    if (this.connectorPopoverEl) {
      this.closeConnectorMenu();
    } else {
      this.openConnectorMenu();
    }
  }

  openConnectorMenu(): void {
    if (this.connectorPopoverEl) return;
    this.closeAllPopovers();

    const popover = createDiv({
      cls: "umlcanvas-menu-dropdown umlcanvas-connector-popover",
    });
    popover.createDiv({ cls: "umlcanvas-menu-header", text: "Connector Style" });

    const styles: Array<{ kind: string; label: string; iconId: string }> = [
      { kind: "uml.association", label: "Association (Line)", iconId: "minus" },
      { kind: "uml.dependency", label: "Dependency (Arrow)", iconId: "arrow-up-right" },
      { kind: "uml.generalization", label: "Generalization (Inherit)", iconId: "triangle" },
      { kind: "uml.aggregation", label: "Aggregation (Hollow Diamond)", iconId: "diamond" },
      { kind: "uml.composition", label: "Composition (Filled Diamond)", iconId: "diamond" },
      { kind: "uml.realization", label: "Realization (Dashed)", iconId: "git-branch" },
      { kind: "uml.link", label: "Plain Link", iconId: "minus" },
    ];

    for (const style of styles) {
      const item = popover.createEl("button", { cls: "umlcanvas-menu-item" });
      if (this.editor.activeEdgeKind === style.kind) {
        item.classList.add("is-active");
      }
      const iconSpan = item.createSpan({ cls: "umlcanvas-menu-item-icon" });
      renderIcon(iconSpan, style.iconId);
      item.createSpan({ cls: "umlcanvas-menu-item-label", text: style.label });

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        this.editor.activeEdgeKind = style.kind;
        for (const edgeId of this.editor.selectedEdgeIds) {
          const edge = this.editor.diagram.edges.find((ed) => ed.id === edgeId);
          if (edge) {
            edge.kind = style.kind;
          }
        }
        this.editor.updateDiagram({ ...this.editor.diagram });
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
    this.lineBtn.classList.add("is-active");

    const btnRect = this.lineBtn.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    const left = Math.max(10, btnRect.left - containerRect.left - 50);
    const bottom = containerRect.bottom - btnRect.top + 8;
    popover.setCssStyles({ left: `${left}px`, bottom: `${bottom}px` });

    this.connectorWinClickBound = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        this.connectorPopoverEl &&
        !this.connectorPopoverEl.contains(target) &&
        target !== this.lineBtn &&
        !this.lineBtn.contains(target)
      ) {
        this.closeConnectorMenu();
      }
    };
    setTimeout(() => {
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
    const activeColor =
      selectedNodes[0]?.style?.color ?? selectedEdges[0]?.style?.color;

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

    const btnRect = this.colorBtn.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    const left = Math.max(10, btnRect.left - containerRect.left);
    const top = btnRect.bottom - containerRect.top + 6;
    popover.setCssStyles({ left: `${left}px`, top: `${top}px` });

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
    setTimeout(() => {
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

    const btnRect = this.alignBtn.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    const left = Math.max(10, btnRect.left - containerRect.left);
    const top = btnRect.bottom - containerRect.top + 6;
    popover.setCssStyles({ left: `${left}px`, top: `${top}px` });

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
    this.alignCloseTimer = setTimeout(() => {
      this.alignCloseTimer = null;
      if (typeof window !== "undefined" && window?.addEventListener && this.alignWinClickBound) {
        window.addEventListener("mousedown", this.alignWinClickBound);
      }
    }, 0);
  }

  closeAlignMenu(): void {
    if (this.alignCloseTimer !== null) {
      clearTimeout(this.alignCloseTimer);
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
