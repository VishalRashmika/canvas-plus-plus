import { setIcon } from "obsidian";
import { DiagramEditor } from "../../application/use-cases/DiagramEditor";
import { SvgSceneRenderer } from "../renderer/SvgSceneRenderer";
import { ViewportTransform } from "../renderer/ViewportMath";
import { EdgeRouting } from "../../domain/types";

import { defaultDiagramTypeRegistry } from "../../domain/services/DiagramTypeRegistry";
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
  private toolbarEl: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private selectBtn!: HTMLButtonElement;
  private drawBtn!: HTMLButtonElement;
  private groupBtn!: HTMLButtonElement;
  private ungroupBtn!: HTMLButtonElement;
  private routingBtn!: HTMLButtonElement;
  private routingTextSpan!: HTMLElement;
  private seqLayoutBtn!: HTMLButtonElement;
  private labelBtn!: HTMLButtonElement;
  private alignBtn!: HTMLButtonElement;
  private alignPopoverEl: HTMLElement | null = null;
  private alignCloseTimer: number | null = null;
  private alignWinClickBound: ((e: MouseEvent) => void) | null = null;
  private duplicateBtn!: HTMLButtonElement;
  private colorBtn!: HTMLButtonElement;
  private colorPaletteEl: HTMLElement | null = null;
  private colorIndicatorEl!: HTMLElement;
  private onWindowClickBound: ((e: MouseEvent) => void) | null = null;
  private typeSelect!: HTMLSelectElement;
  private paletteBtn?: HTMLButtonElement;
  private zoomLabel!: HTMLElement;
  private breadcrumbsEl!: HTMLElement;
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
    private readonly onAddNoteRequested?: () => void
  ) {
    this.freehandEnabled = this.renderer.isFreehandEnabled;

    this.breadcrumbsEl = createDiv({ cls: "umlcanvas-breadcrumbs" });
    this.container.prepend(this.breadcrumbsEl);

    this.toolbarEl = this.container.createDiv({ cls: "umlcanvas-toolbar" });

    this.createControls();
    this.container.appendChild(this.toolbarEl);

    this.unsubscribe = this.editor.subscribe(() => {
      this.updateState();
    });

    this.updateState();
  }

  private createGroup(parentRow: HTMLElement): HTMLElement {
    return parentRow.createDiv({ cls: "umlcanvas-toolbar-group" });
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

    btn.addEventListener("click", onClick);
    return btn;
  }

  private createControls(): void {
    // Row 1: Document, View & File Bar
    const topRow = this.toolbarEl.createDiv({
      cls: "umlcanvas-toolbar-row umlcanvas-toolbar-top-row",
    });

    // Row 2: Tools, Creation & Editing Bar
    const bottomRow = this.toolbarEl.createDiv({
      cls: "umlcanvas-toolbar-row umlcanvas-toolbar-bottom-row",
    });

    // ==========================================
    // ROW 1 - GROUP 1: Document & Shape Library
    // ==========================================
    const docGroup = this.createGroup(topRow);

    // Diagram-Type Switcher (F-054)
    this.typeSelect = docGroup.createEl("select", {
      cls: "umlcanvas-type-select",
      title: "Switch UML Diagram Type",
      attr: { "aria-label": "Switch UML Diagram Type" },
    });

    const allTypes = defaultDiagramTypeRegistry.getAll();
    for (const t of allTypes) {
      const opt = this.typeSelect.createEl("option", {
        value: t.id,
        text: t.displayName,
      });
      if (t.id === this.editor.diagram.diagramType) {
        opt.selected = true;
      }
    }

    this.typeSelect.addEventListener("change", () => {
      this.editor.switchDiagramType(this.typeSelect.value);
    });
    docGroup.appendChild(this.typeSelect);

    // Tool Palette Toggle (F-054)
    if (this.onTogglePalette) {
      this.addDivider(docGroup);
      this.paletteBtn = this.createButton(
        "Toggle Shape Library (All UML & Schematic Types)",
        "Shapes",
        () => {
          this.onTogglePalette!();
        },
        "layout-grid"
      );
      docGroup.appendChild(this.paletteBtn);
    }

    // ==========================================
    // ROW 1 - GROUP 2: Canvas View Options
    // ==========================================
    const canvasGroup = this.createGroup(topRow);

    // Edge Routing Mode Toggle Button (F-005)
    this.routingBtn = canvasGroup.createEl("button", {
      cls: "umlcanvas-toolbar-btn",
      title: "Default Edge Routing: Orthogonal",
      attr: { "aria-label": "Default Edge Routing: Orthogonal" },
    });

    const routingIcon = this.routingBtn.createSpan({ cls: "umlcanvas-btn-icon" });
    renderIcon(routingIcon, "git-branch");

    this.routingTextSpan = this.routingBtn.createSpan({
      cls: "umlcanvas-btn-text",
      text: "Route: Ortho",
    });

    this.routingBtn.addEventListener("click", () => {
      this.cycleRoutingMode();
    });

    this.addDivider(canvasGroup);

    // Toggle Grid
    let gridOn = true;
    const gridBtn = this.createButton(
      "Toggle Grid",
      "Grid",
      () => {
        gridOn = !gridOn;
        this.renderer.setGridVisible(gridOn);
        gridBtn.classList.toggle("is-active", gridOn);
      },
      "grid"
    );
    gridBtn.classList.add("is-active");
    canvasGroup.appendChild(gridBtn);

    // Minimap Toggle (F-011)
    if (this.onToggleMinimap) {
      const minimapBtn = this.createButton(
        "Toggle Minimap (M)",
        "Minimap",
        () => {
          this.onToggleMinimap!();
        },
        "map"
      );
      canvasGroup.appendChild(minimapBtn);
    }

    // ==========================================
    // ROW 1 - GROUP 3: Zoom & Navigation
    // ==========================================
    const zoomGroup = this.createGroup(topRow);

    // Zoom Out
    const zoomOutBtn = this.createButton(
      "Zoom Out (-)",
      "",
      () => {
        this.renderer.zoomOut();
      },
      "zoom-out"
    );
    zoomGroup.appendChild(zoomOutBtn);

    // Zoom Label
    this.zoomLabel = zoomGroup.createSpan({
      cls: "umlcanvas-zoom-label",
      text: "100%",
      title: "Current Zoom",
    });

    // Zoom In
    const zoomInBtn = this.createButton(
      "Zoom In (+)",
      "",
      () => {
        this.renderer.zoomIn();
      },
      "zoom-in"
    );
    zoomGroup.appendChild(zoomInBtn);

    // Reset Zoom
    const resetZoomBtn = this.createButton(
      "Reset Zoom (100%)",
      "1:1",
      () => {
        this.renderer.resetZoom();
      },
      "maximize"
    );
    zoomGroup.appendChild(resetZoomBtn);

    // ==========================================
    // ROW 1 - GROUP 4: Save & Export
    // ==========================================
    const exportGroup = this.createGroup(topRow);

    // Explicit Save Button
    if (this.onSaveRequested) {
      const saveBtn = this.createButton(
        "Save Diagram (Ctrl+S)",
        "Save",
        () => {
          this.onSaveRequested!();
        },
        "save"
      );
      exportGroup.appendChild(saveBtn);
      this.addDivider(exportGroup);
    }

    // Export SVG (F-024)
    const exportSvgBtn = this.createButton(
      "Export Standalone SVG",
      "SVG",
      () => {
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
      },
      "image"
    );
    exportGroup.appendChild(exportSvgBtn);

    // Export .canvas (F-025)
    const exportCanvasBtn = this.createButton(
      "Export to Plain Obsidian .canvas",
      ".canvas",
      () => {
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
      },
      "file-code"
    );
    exportGroup.appendChild(exportCanvasBtn);

    // ==========================================
    // ROW 2 - GROUP 1: Tool Modes
    // ==========================================
    const toolsGroup = this.createGroup(bottomRow);

    // Select Tool (V / Esc)
    this.selectBtn = this.createButton(
      "Select & Move Tool (V / Esc)",
      "Select",
      () => {
        this.renderer.setFreehandMode(false);
        this.updateToolMode();
      },
      "mouse-pointer"
    );
    toolsGroup.appendChild(this.selectBtn);

    // Freehand Draw Tool (P) (F-070, F-071, F-072)
    this.drawBtn = this.createButton(
      "Freehand Draw & Shape Recognition (P)",
      "Draw",
      () => {
        const active = !this.renderer.freehandMode;
        this.renderer.setFreehandMode(active);
        this.updateToolMode();
      },
      "pencil"
    );
    toolsGroup.appendChild(this.drawBtn);

    // ==========================================
    // ROW 2 - GROUP 2: Create Elements
    // ==========================================
    const createGroup = this.createGroup(bottomRow);

    // Add Node Button
    const addNodeBtn = this.createButton(
      "Add Node",
      "+ Node",
      () => {
        const transform = this.renderer.currentTransform;
        const centerScreen = {
          x: this.container.clientWidth / 2,
          y: this.container.clientHeight / 2,
        };
        const canvasX = (centerScreen.x - transform.panX) / transform.zoom;
        const canvasY = (centerScreen.y - transform.panY) / transform.zoom;

        this.editor.addNode({
          position: {
            x: Math.round(canvasX - 70),
            y: Math.round(canvasY - 40),
          },
          title: "New Node",
        });
      },
      "plus"
    );
    createGroup.appendChild(addNodeBtn);

    // Add Note from Vault Button (F-Obsidian-Notes)
    if (this.onAddNoteRequested) {
      const addNoteBtn = this.createButton(
        "Add Note from Vault",
        "+ Note",
        () => {
          this.onAddNoteRequested!();
        },
        "file-text"
      );
      createGroup.appendChild(addNoteBtn);
    }

    // ==========================================
    // ROW 2 - GROUP 3: History & Clipboard
    // ==========================================
    const historyGroup = this.createGroup(bottomRow);

    // Undo Button
    this.undoBtn = this.createButton(
      "Undo (Ctrl+Z)",
      "",
      () => {
        this.editor.undo();
      },
      "undo"
    );
    historyGroup.appendChild(this.undoBtn);

    // Redo Button
    this.redoBtn = this.createButton(
      "Redo (Ctrl+Shift+Z)",
      "",
      () => {
        this.editor.redo();
      },
      "redo"
    );
    historyGroup.appendChild(this.redoBtn);

    this.addDivider(historyGroup);

    // Copy & Paste (F-012)
    const copyBtn = this.createButton(
      "Copy Selection (Ctrl+C)",
      "",
      () => {
        this.editor.copySelection();
      },
      "copy"
    );
    historyGroup.appendChild(copyBtn);

    const pasteBtn = this.createButton(
      "Paste Selection (Ctrl+V)",
      "",
      () => {
        this.editor.paste();
      },
      "clipboard"
    );
    historyGroup.appendChild(pasteBtn);

    this.duplicateBtn = this.createButton(
      "Duplicate Selection (Ctrl+D)",
      "",
      () => {
        this.editor.duplicateSelection();
      },
      "copy-plus"
    );
    historyGroup.appendChild(this.duplicateBtn);

    const deleteBtn = this.createButton(
      "Delete Selection (Del)",
      "",
      () => {
        this.editor.deleteSelection();
      },
      "trash",
      "umlcanvas-toolbar-btn-danger"
    );
    historyGroup.appendChild(deleteBtn);

    // ==========================================
    // ROW 2 - GROUP 4: Styling & Arrangement
    // ==========================================
    const arrangeGroup = this.createGroup(bottomRow);

    // Color Selection Button (Presets 1-6, None, Custom)
    this.colorBtn = this.createButton(
      "Assign Color to Selection (1-6)",
      "Color",
      () => {
        this.toggleColorPalette();
      },
      "palette"
    );
    this.colorIndicatorEl = this.colorBtn.createSpan({
      cls: "umlcanvas-color-indicator",
    });
    arrangeGroup.appendChild(this.colorBtn);

    // Label Selection Button (Enter / F2)
    this.labelBtn = this.createButton(
      "Edit Label (Enter / F2)",
      "Label",
      () => {
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
      },
      "type"
    );
    arrangeGroup.appendChild(this.labelBtn);

    // Auto-Fit Node Size (F-036)
    const autoFitBtn = this.createButton(
      "Auto-fit Node Dimensions to Text",
      "Auto-Fit",
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
    arrangeGroup.appendChild(autoFitBtn);

    // Align & Distribute Nodes Button
    this.alignBtn = this.createButton(
      "Align & Distribute Selected Nodes",
      "Align",
      () => {
        this.toggleAlignMenu();
      },
      "align-center"
    );
    arrangeGroup.appendChild(this.alignBtn);

    // Group Selection Button (F-010)
    this.groupBtn = this.createButton(
      "Group Selection (Ctrl+G)",
      "Group",
      () => {
        this.editor.groupSelection();
      },
      "boxes"
    );
    arrangeGroup.appendChild(this.groupBtn);

    // Ungroup Selection Button (F-010)
    this.ungroupBtn = this.createButton(
      "Ungroup Selection (Ctrl+Shift+G)",
      "Ungroup",
      () => {
        this.editor.ungroupSelection();
      },
      "ungroup"
    );
    arrangeGroup.appendChild(this.ungroupBtn);

    // Sequence Layout Button (F-045)
    this.seqLayoutBtn = this.createButton(
      "Auto-layout Sequence Diagram Chronologically",
      "Seq Layout",
      () => {
        this.editor.layoutSequenceDiagram();
      },
      "git-commit"
    );
    arrangeGroup.appendChild(this.seqLayoutBtn);
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

    const canLabel =
      this.editor.selectedNodeIds.length === 1 ||
      this.editor.selectedEdgeIds.length === 1 ||
      this.editor.selectedGroupIds.length === 1;
    this.labelBtn.disabled = !canLabel;

    const hasSelection =
      this.editor.selectedNodeIds.length > 0 ||
      this.editor.selectedEdgeIds.length > 0 ||
      this.editor.selectedGroupIds.length > 0;
    if (this.colorBtn) {
      this.colorBtn.disabled = !hasSelection;
      if (!hasSelection && this.colorPaletteEl) {
        this.closeColorPalette();
      }

      if (this.colorIndicatorEl) {
        if (!hasSelection) {
          this.colorIndicatorEl.classList.remove("is-visible");
          this.colorBtn.title = "Assign Color to Selection (1-6)";
        } else {
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
        }
      }
    }

    const selectedNodeCount = this.editor.selectedNodeIds.length;
    this.groupBtn.disabled = selectedNodeCount < 2;

    if (this.duplicateBtn) {
      this.duplicateBtn.disabled = !hasSelection;
    }
    if (this.alignBtn) {
      this.alignBtn.disabled = selectedNodeCount < 2;
      if (selectedNodeCount < 2 && this.alignPopoverEl) {
        this.closeAlignMenu();
      }
    }

    const hasGroupedNode = this.editor.selectedNodeIds.some((id) =>
      this.editor.diagram.groups.some((g) => g.nodeIds.includes(id))
    );
    const hasSelectedGroup = this.editor.selectedGroupIds.length > 0;
    this.ungroupBtn.disabled = !hasGroupedNode && !hasSelectedGroup;

    const modeLabels: Record<EdgeRouting, { text: string; title: string }> = {
      orthogonal: { text: "Route: Ortho", title: "Edge Routing: Orthogonal (click to toggle)" },
      straight: { text: "Route: Straight", title: "Edge Routing: Straight (click to toggle)" },
      curved: { text: "Route: Curved", title: "Edge Routing: Curved (click to toggle)" },
    };
    const info = modeLabels[this.editor.defaultRouting] ?? modeLabels.orthogonal;
    if (this.routingTextSpan) {
      this.routingTextSpan.textContent = info.text;
    } else {
      this.routingBtn.textContent = info.text;
    }
    this.routingBtn.title = info.title;
    this.routingBtn.setAttribute("aria-label", info.title);

    if (this.typeSelect) {
      this.typeSelect.value = this.editor.diagram.diagramType;
    }

    if (this.seqLayoutBtn) {
      this.seqLayoutBtn.classList.toggle(
        "is-hidden",
        this.editor.diagram.diagramType !== "uml.sequence"
      );
    }

    // Update Breadcrumbs (F-062)
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
      if (!isFreehand) {
        this.selectBtn.classList.add("is-active");
      } else {
        this.selectBtn.classList.remove("is-active");
      }
    }
    if (this.drawBtn) {
      if (!this.freehandEnabled) {
        this.drawBtn.classList.add("is-hidden");
        this.drawBtn.classList.remove("is-active");
      } else {
        this.drawBtn.classList.remove("is-hidden");
        if (isFreehand) {
          this.drawBtn.classList.add("is-active");
        } else {
          this.drawBtn.classList.remove("is-active");
        }
      }
    }
  }

  setFreehandEnabled(enabled: boolean): void {
    this.freehandEnabled = enabled;
    this.updateToolMode();
  }

  updatePaletteButtonState(isOpen: boolean): void {
    if (this.paletteBtn) {
      if (isOpen) {
        this.paletteBtn.classList.add("is-active");
      } else {
        this.paletteBtn.classList.remove("is-active");
      }
    }
  }

  toggleColorPalette(): void {
    if (this.colorPaletteEl) {
      this.closeColorPalette();
    } else {
      this.openColorPalette();
    }
  }

  openColorPalette(): void {
    if (this.colorPaletteEl) return;

    const popover = createDiv({ cls: "umlcanvas-color-palette-popover" });

    // Row of color swatches
    const row = popover.createDiv({ cls: "umlcanvas-color-swatches-row" });

    // 1. None / Reset button
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

    // Current selection color (if unique)
    const selectedNodes = this.editor.diagram.nodes.filter((n) =>
      this.editor.selectedNodeIds.includes(n.id)
    );
    const selectedEdges = this.editor.diagram.edges.filter((e) =>
      this.editor.selectedEdgeIds.includes(e.id)
    );
    const activeColor =
      selectedNodes[0]?.style?.color ?? selectedEdges[0]?.style?.color;

    // 2. 6 Presets
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

    // 3. Custom color input
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

    // Position popover relative to colorBtn
    this.toolbarEl.appendChild(popover);
    this.colorPaletteEl = popover;
    this.colorBtn.classList.add("is-active");

    const btnRect = this.colorBtn.getBoundingClientRect();
    const toolbarRect = this.toolbarEl.getBoundingClientRect();
    const leftOffset = Math.max(0, btnRect.left - toolbarRect.left);
    popover.setCssStyles({ left: `${leftOffset}px` });

    // Close on outside click
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
    if (typeof window !== "undefined" && window?.addEventListener) {
      window.addEventListener("mousedown", this.onWindowClickBound);
    }
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

  toggleAlignMenu(): void {
    if (this.alignPopoverEl) {
      this.closeAlignMenu();
    } else {
      this.openAlignMenu();
    }
  }

  openAlignMenu(): void {
    if (this.alignPopoverEl) return;
    if (this.colorPaletteEl) this.closeColorPalette();

    const popover = createDiv({ cls: "umlcanvas-align-popover" });

    const createItem = (label: string, iconId: string, action: () => void, disabled?: boolean) => {
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

    // Position popover below alignBtn
    const btnRect = this.alignBtn.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    const left = Math.max(10, btnRect.left - containerRect.left);
    const top = btnRect.bottom - containerRect.top + 6;
    popover.setCssStyles({ left: `${left}px`, top: `${top}px` });

    const onWinClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (popover && !popover.contains(target) && target !== this.alignBtn && !this.alignBtn?.contains(target)) {
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

  destroy(): void {
    this.closeColorPalette();
    this.closeAlignMenu();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.breadcrumbsEl.remove();
    this.toolbarEl.remove();
  }
}
