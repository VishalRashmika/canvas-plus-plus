import { TextFileView, WorkspaceLeaf, Menu, TFile, MarkdownRenderer, Platform, App } from "obsidian";

declare module "obsidian" {
  interface MenuItem {
    setSubmenu?(): Menu;
  }
}

interface HandledEvent extends Event {
  _umlHandled?: boolean;
}
import type CanvasPlusPlusPlugin from "../../main";
import { VIEW_TYPE_UML_CANVAS } from "../../main";
import { Diagram, createDiagram } from "../../domain/entities/Diagram";
import { DiagramNode } from "../../domain/entities/DiagramNode";
import { DiagramEdge } from "../../domain/entities/DiagramEdge";
import { Group } from "../../domain/entities/Group";
import { Point } from "../../domain/value-objects/Point";
import { Size } from "../../domain/value-objects/Rect";
import { DiagramEditor } from "../../application/use-cases/DiagramEditor";
import { AutosaveCoordinator } from "../../application/use-cases/AutosaveCoordinator";
import { JsonCanvasSerializer } from "../../infrastructure/persistence/JsonCanvasSerializer";
import { defaultJsonCanvasImporter } from "../../infrastructure/persistence/JsonCanvasImporter";
import { SvgSceneRenderer } from "../renderer/SvgSceneRenderer";
import { Toolbar } from "./Toolbar";
import { PalettePanel } from "./PalettePanel";
import { MinimapView } from "./MinimapView";
import { NoteSuggestModal } from "./NoteSuggestModal";
import { ImageSuggestModal, isImageFile } from "./ImageSuggestModal";
import { PdfSuggestModal, isPdfFile } from "./PdfSuggestModal";
import { PdfPageModal } from "./PdfPageModal";
import { ChipDefinitionModal } from "./ChipDefinitionModal";
import { ChipInterfaceDefinition } from "../../domain/entities/ChipInterfaceDefinition";
import { defaultCustomChipRegistry } from "../../domain/services/CustomChipRegistry";
import { Stroke } from "../../domain/services/ShapeRecognizer";
import { wrapTextToLines } from "../../domain/services/TextMeasurement";
import { UmlCanvasSettings } from "../../infrastructure/obsidian/PluginSettings";
import { CanvasAttachmentService } from "../../infrastructure/obsidian/CanvasAttachmentService";
import { CANVAS_COLOR_PRESETS } from "../../domain/value-objects/CanvasColor";
import { FONT_SIZE_PRESETS } from "../theme/Typography";

interface AppWithDragManager extends App {
  dragManager?: {
    draggable?: { file?: unknown; files?: unknown[] };
    dragData?: { file?: unknown; files?: unknown[] };
  };
}

export class UmlCanvasView extends TextFileView {
  private editor: DiagramEditor | null = null;
  private renderer: SvgSceneRenderer | null = null;
  private toolbar: Toolbar | null = null;
  private palette: PalettePanel | null = null;
  private minimap: MinimapView | null = null;
  private autosaveCoordinator: AutosaveCoordinator | null = null;
  private serializer: JsonCanvasSerializer = new JsonCanvasSerializer();
  private rootEl: HTMLElement | null = null;
  private escapeHatchEl: HTMLElement | null = null;
  private escapeHatchTimer: number | null = null;
  private handwritingBuffer: Array<{ stroke: Stroke; nodeId: string }> = [];
  private handwritingCommitTimer: number | null = null;
  private _canvasAttachmentService: CanvasAttachmentService | null = null;
  private _attachmentServiceApp: App | null = null;
  private lastMouseCanvasPos: Point | null = null;

  public get canvasAttachmentService(): CanvasAttachmentService {
    if (
      !this._canvasAttachmentService ||
      this._attachmentServiceApp !== this.app
    ) {
      this._canvasAttachmentService = new CanvasAttachmentService(this.app);
      this._attachmentServiceApp = this.app;
    }
    return this._canvasAttachmentService;
  }

  public set canvasAttachmentService(service: CanvasAttachmentService) {
    this._canvasAttachmentService = service;
    this._attachmentServiceApp = this.app;
  }

  constructor(leaf: WorkspaceLeaf, private readonly plugin: CanvasPlusPlusPlugin) {
    super(leaf);
  }

  onload(): void {
    super.onload();
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) {
          void this.handleVaultFileModified(file);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          this.handleVaultFileRenamed(file, oldPath);
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        this.applyTheme();
      })
    );
  }

  getViewType(): string {
    return VIEW_TYPE_UML_CANVAS;
  }

  canAcceptExtension(extension: string): boolean {
    if (!extension || typeof extension !== "string") return false;
    const ext = extension.toLowerCase().replace(/^\./, "").trim();
    return (
      ext === "canvuspp" ||
      ext === "canvaspp" ||
      ext === "canvas" ||
      ext === "canvas++" ||
      ext === "canvasplusplus" ||
      ext === "canvas-plus-plus" ||
      ext === "canvpp" ||
      ext === "canv" ||
      ext === "umlcanvas"
    );
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.file = file;
    let loadedData: string | null = null;
    const vault = this.app?.vault ?? this.plugin?.app?.vault;
    if (vault?.read) {
      try {
        loadedData = await vault.read(file);
        this.data = loadedData;
      } catch (err) {
        console.error(`Error reading Canvas++ file "${file.path}":`, err);
      }
    }
    try {
      await super.onLoadFile(file);
    } catch (err) {
      console.warn(`Error in super.onLoadFile for "${file.path}":`, err);
    }

    // Ensure view is initialized if super.onLoadFile did not initialize it
    if (!this.diagramEditor) {
      this.setViewData(this.data ?? loadedData ?? "", true);
    }
  }

  getDisplayText(): string {
    return this.file ? this.file.basename : "Canvas++";
  }

  getIcon(): string {
    return "git-fork";
  }

  getViewData(): string {
    if (!this.editor) {
      return this.data || "";
    }
    return this.serializer.serialize(this.editor.diagram, true);
  }

  setViewData(data: string, clear: boolean): void {
    if (clear) {
      this.clear();
    }

    let diagram: Diagram;
    const trimmed = (data || "").trim();

    if (!trimmed) {
      // Blank new file
      diagram = createDiagram({
        id: this.file ? this.file.path : `diag-${Date.now()}`,
        diagramType: this.plugin?.settings?.defaultDiagramType || "general",
        title: this.file ? this.file.basename : "New Diagram",
      });
    } else {
      try {
        diagram = this.serializer.deserialize(trimmed);
      } catch (deserErr) {
        // Fallback: try importing as JSON Canvas if file was formatted in plain .canvas format
        try {
          diagram = defaultJsonCanvasImporter.importCanvas(trimmed, {
            diagramId: this.file ? this.file.path : undefined,
            title: this.file ? this.file.basename : undefined,
          });
        } catch (importErr) {
          console.warn("Failed to deserialize or import Canvas++ file, recovering:", deserErr, importErr);
          // Fallback for corrupted/invalid files
          diagram = createDiagram({
            id: this.file ? this.file.path : `diag-${Date.now()}`,
            diagramType: this.plugin?.settings?.defaultDiagramType || "general",
            title: this.file ? this.file.basename : "Recovered Diagram",
          });
        }
      }
    }

    try {
      this.initializeView(diagram);
    } catch (initErr) {
      console.error("Critical error in Canvas++ initializeView:", initErr);
      try {
        const fallbackDiagram = createDiagram({
          id: this.file ? this.file.path : `diag-${Date.now()}`,
          diagramType: "general",
          title: this.file ? this.file.basename : "Recovered Diagram",
        });
        this.initializeView(fallbackDiagram);
      } catch (fatalErr) {
        console.error("Fatal error rendering fallback Canvas++ view:", fatalErr);
        this.contentEl.empty();
        const errorContainer = this.contentEl.createDiv({ cls: "umlcanvas-view-error" });
        errorContainer.createEl("h3", { text: "Canvas++ Document" });
        errorContainer.createEl("p", {
          text: `An error occurred while loading ${this.file?.basename || "diagram"}. Error details: ${String(initErr)}`,
        });
      }
    }
  }

  clear(): void {
    if (this.autosaveCoordinator) {
      this.autosaveCoordinator.dispose();
      this.autosaveCoordinator = null;
    }
    if (this.toolbar) {
      this.toolbar.destroy();
      this.toolbar = null;
    }
    if (this.palette) {
      this.palette.destroy();
      this.palette = null;
    }
    if (this.minimap) {
      this.minimap.destroy();
      this.minimap = null;
    }
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    if (this.escapeHatchEl) {
      this.escapeHatchEl.remove();
      this.escapeHatchEl = null;
    }
    if (this.escapeHatchTimer !== null) {
      window.clearTimeout(this.escapeHatchTimer);
      this.escapeHatchTimer = null;
    }
    if (this.handwritingCommitTimer !== null) {
      window.clearTimeout(this.handwritingCommitTimer);
      this.handwritingCommitTimer = null;
    }
    this.handwritingBuffer = [];
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
    this.editor = null;
    this.contentEl.empty();
  }

  private initializeView(diagram: Diagram): void {
    this.contentEl.empty();

    this.rootEl = this.contentEl.createDiv({ cls: "umlcanvas-view-container" });
    this.applyTheme();
    const svgContainer = this.rootEl.createDiv({ cls: "umlcanvas-svg-container" });

    this.editor = new DiagramEditor(diagram);

    // Resolve resource paths for vault PDFs and images before initial render
    this.resolveVaultResourcePaths();

    const settings = this.plugin?.settings;

    // Setup debounced autosave via Obsidian's requestSave
    this.autosaveCoordinator = new AutosaveCoordinator(
      this.editor,
      async () => {
        if (typeof this.requestSave === "function") {
          this.requestSave();
        }
      },
      settings?.autosaveDelayMs ?? 1000
    );

    // Setup SVG Renderer
    this.renderer = new SvgSceneRenderer(svgContainer, this.editor, {
      showGrid: settings?.showGrid ?? true,
      enableFreehand: settings?.enableFreehand ?? true,
      autoShapeDetection: settings?.autoShapeDetection ?? true,
      onModeChange: (mode) => {
        if (mode !== "handwrite") {
          this.flushHandwritingBuffer();
        }
        if (this.toolbar) {
          this.toolbar.updateToolMode();
        }
      },
      onTransformChange: (t) => {
        if (this.toolbar) {
          this.toolbar.updateZoomLabel(t);
        }
        if (this.minimap) {
          this.minimap.updateViewport();
        }
      },
      onStrokeComplete: (stroke, strokeOpts) => {
        if (!this.editor) return;
        const isHandwrite =
          strokeOpts?.handwritingText ?? this.renderer?.isHandwritingTextMode ?? false;
        if (isHandwrite) {
          this.handleHandwrittenStroke(stroke);
          return;
        }
        const autoDetect = strokeOpts?.autoDetect ?? this.renderer?.isAutoShapeDetection ?? true;
        if (autoDetect) {
          const emptyConn = this.editor.detectStrokeToEmptySpace(stroke);
          if (emptyConn && this.renderer) {
            const startPt = emptyConn.fromNode.position;
            const clientPoint = this.renderer.canvasToScreenPoint(emptyConn.endPoint);
            this.renderer.openArrowAttachmentPopup({
              fromNodeId: emptyConn.fromNode.id,
              dropCanvasPoint: emptyConn.endPoint,
              dropClientPoint: clientPoint,
              startPoint: startPt,
            });
            return;
          }

          const result = this.editor.snapStrokeToShape(stroke, {
            select: false,
            fallbackToFreehand: true,
          });
          if (result) {
            const isText = (result as DiagramNode).kind === "generic.text";
            const isFreehand = (result as DiagramNode).kind === "generic.freehand";
            if (!isFreehand) {
              this.showFreehandEscapeHatch(
                stroke,
                isText ? "Handwriting recognized" : "Shape recognized"
              );
            }
          } else {
            this.editor.keepAsFreehand(stroke, { select: false });
          }
        } else {
          this.editor.keepAsFreehand(stroke, { select: false });
        }
        if (this.editor.hasSelection) {
          this.editor.clearSelection();
        }
      },
      onContextMenu: (e, canvasPoint, node, edge, group) => {
        this.showContextMenu(e, canvasPoint, node, edge, group);
      },
      onNoteOpen: (filePath: string) => {
        void this.app.workspace.openLinkText(filePath, this.file?.path ?? "", false);
      },
      onRenderMarkdown: async (markdown: string, el: HTMLElement, sourcePath: string) => {
        try {
          el.textContent = "";
          await MarkdownRenderer.render(this.app, markdown, el, sourcePath, this);
        } catch (e) {
          console.error("Failed to render note markdown:", e);
        }
      },
      onChipEdit: (node) => {
        this.openChipDefinitionModal({ existingNode: node });
      },
      onPdfPick: (node) => {
        this.openPdfPickerModal(node.position, node.id);
      },
      onPdfChangePage: (node) => {
        this.promptChangePdfPage(node);
      },
      onExternalDrop: (e: DragEvent, canvasPoint: Point) => this.handleExternalDrop(e, canvasPoint),
      onPasteRequested: (canvasPoint?: Point) => void this.pasteFromClipboardOrEditor(canvasPoint),
      onOpenVaultNote: (cb) => {
        new NoteSuggestModal(this.app, (file: TFile) => {
          cb(file);
        }).open();
      },
      onOpenVaultImage: (cb) => {
        const vaultImages = this.app.vault.getFiles().filter((f: TFile) => isImageFile(f));
        if (vaultImages.length > 0) {
          new ImageSuggestModal(this.app, (file: TFile) => {
            let src = file.path;
            try {
              if (typeof this.app.vault.getResourcePath === "function") {
                src = this.app.vault.getResourcePath(file);
              }
            } catch {
              src = file.path;
            }
            cb({ path: file.path, src });
          }).open();
        } else {
          cb({ path: "", src: "" });
        }
      },
    });

    // Setup Minimap (F-011)
    this.minimap = new MinimapView(this.editor, this.renderer, this.rootEl);

    // Setup Palette Panel (F-054, F-060)
    this.palette = new PalettePanel(
      this.rootEl,
      this.editor,
      this.renderer,
      this.renderer.shapeRegistry,
      (isOpen) => {
        this.toolbar?.updatePaletteButtonState(isOpen);
      },
      (existingChip) => {
        this.openChipDefinitionModal({ initialDefinition: existingChip });
      },
      this.app
    );

    // Setup Toolbar
    this.toolbar = new Toolbar(
      this.rootEl,
      this.editor,
      this.renderer,
      () => {
        void this.save();
      },
      () => {
        this.palette?.toggle();
      },
      undefined,
      undefined,
      undefined,
      () => {
        this.minimap?.toggle();
      },
      () => {
        this.openNotePickerModal();
      },
      () => {
        void this.toggleTheme();
      },
      () => {
        this.openImagePickerModal();
      },
      () => {
        this.openPdfPickerModal();
      },
      () => {
        void this.pasteFromClipboardOrEditor();
      }
    );

    // Track cursor canvas position for accurate pasting (#5)
    this.rootEl.addEventListener("mousemove", (e: MouseEvent) => {
      if (this.renderer && this.rootEl) {
        const rect = this.rootEl.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        const clientY = e.clientY - rect.top;
        const transform = this.renderer.currentTransform;
        this.lastMouseCanvasPos = {
          x: Math.round((clientX - transform.panX) / transform.zoom),
          y: Math.round((clientY - transform.panY) / transform.zoom),
        };
      }
    });

    // Deselect currently selected component(s) when clicking empty canvas space (#9)
    this.rootEl.addEventListener("mousedown", (e: MouseEvent) => {
      if ((e as HandledEvent)._umlHandled) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(
          ".umlcanvas-toolbar, .umlcanvas-main-toolbar, .umlcanvas-floating-bottom-toolbar, .umlcanvas-menu-dropdown, .umlcanvas-palette-panel, .umlcanvas-palette-toggle-tab, .umlcanvas-minimap, .umlcanvas-color-palette-popover, .umlcanvas-align-popover, .umlcanvas-font-size-popover, .umlcanvas-font-size-dropdown, .umlcanvas-font-family-dropdown, .umlcanvas-connector-popover, .umlcanvas-line-popover, .umlcanvas-breadcrumbs, .umlcanvas-inline-editor, .modal, .menu, [class*='popover'], [class*='dropdown']"
        )
      ) {
        return;
      }
      (e as HandledEvent)._umlHandled = true;
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
        this.editor?.clearSelection();
      }
    });

    // Setup Copy / Paste (F-012) and Minimap (F-011) shortcuts
    this.rootEl.addEventListener("keydown", (e: KeyboardEvent) => {
      const isMac = Platform.isMacOS;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable || Boolean(target.closest(".umlcanvas-inline-editor")));

      if (e.key === "Escape") {
        if (this.palette?.isOpen) {
          e.preventDefault();
          e.stopPropagation();
          this.palette.close();
          return;
        }
      }

      if ((e.key === "Delete" || e.key === "Backspace") && !isInput) {
        e.preventDefault();
        this.editor?.deleteSelection();
        return;
      }

      if (mod && e.key.toLowerCase() === "c" && !isInput) {
        e.preventDefault();
        this.editor?.copySelection();
      } else if (mod && e.key.toLowerCase() === "v" && !isInput) {
        e.preventDefault();
        void this.pasteFromClipboardOrEditor(this.lastMouseCanvasPos ?? undefined);
      } else if (mod && e.key.toLowerCase() === "b" && !isInput) {
        e.preventDefault();
        this.editor?.toggleBoldForSelection();
      } else if (mod && e.key.toLowerCase() === "i" && !isInput) {
        e.preventDefault();
        this.editor?.toggleItalicForSelection();
      } else if (mod && e.key === "[" && !isInput) {
        e.preventDefault();
        this.editor?.adjustFontSizeForSelection(-2);
      } else if (mod && e.key === "]" && !isInput) {
        e.preventDefault();
        this.editor?.adjustFontSizeForSelection(2);
      } else if (!mod && (e.key === "m" || e.key === "M") && !isInput) {
        e.preventDefault();
        this.minimap?.toggle();
      } else if (e.shiftKey && (e.key === "E" || e.key === "e") && !isInput) {
        e.preventDefault();
        this.editor?.enhanceSelection();
      }
    });

    // Setup Image & PDF Paste listener
    this.rootEl.addEventListener("paste", (e: ClipboardEvent) => this.handlePaste(e));

    // Load full note content from vault for embedded note cards
    void this.loadVaultNotesContent();
    // Resolve resource paths for vault PDFs and images
    this.resolveVaultResourcePaths();
  }

  showFreehandEscapeHatch(stroke: Stroke, message = "Shape recognized"): void {
    if (this.escapeHatchEl) {
      this.escapeHatchEl.remove();
      this.escapeHatchEl = null;
    }
    if (this.escapeHatchTimer !== null) {
      window.clearTimeout(this.escapeHatchTimer);
      this.escapeHatchTimer = null;
    }

    if (!this.rootEl) return;

    const toast = this.rootEl.createDiv({ cls: "umlcanvas-escape-hatch-toast" });
    toast.createSpan({ text: message });
    const btn = toast.createEl("button", {
      cls: "umlcanvas-escape-hatch-btn",
      text: "Keep as freehand",
    });

    btn.onclick = (e) => {
      e.stopPropagation();
      if (this.editor) {
        this.editor.undo();
        this.editor.keepAsFreehand(stroke, { select: false });
        if (this.editor.hasSelection) {
          this.editor.clearSelection();
        }
      }
      toast.remove();
      this.escapeHatchEl = null;
    };

    this.escapeHatchEl = toast;

    this.escapeHatchTimer = window.setTimeout(() => {
      if (this.escapeHatchEl === toast) {
        toast.remove();
        this.escapeHatchEl = null;
      }
    }, 5000);
  }

  public handleHandwrittenStroke(stroke: Stroke): void {
    if (!this.editor) return;
    const tempNode = this.editor.keepAsFreehand(stroke, { select: false });
    this.handwritingBuffer.push({ stroke, nodeId: tempNode.id });

    if (this.handwritingCommitTimer !== null) {
      window.clearTimeout(this.handwritingCommitTimer);
    }

    this.handwritingCommitTimer = window.setTimeout(() => {
      this.flushHandwritingBuffer();
    }, 700);
  }

  public flushHandwritingBuffer(): DiagramNode | null {
    if (this.handwritingCommitTimer !== null) {
      window.clearTimeout(this.handwritingCommitTimer);
      this.handwritingCommitTimer = null;
    }
    if (!this.editor || this.handwritingBuffer.length === 0) return null;

    const items = [...this.handwritingBuffer];
    this.handwritingBuffer = [];

    // Remove the temporary freehand nodes
    for (const item of items) {
      this.editor.deleteNode(item.nodeId);
    }

    // Recognize handwritten strokes into lowercase text
    const textNode = this.editor.handwriteTextFromStrokes(
      items.map((i) => i.stroke),
      { select: false, appendToNearby: true }
    );

    if (textNode) {
      this.showFreehandEscapeHatch(
        items[0].stroke,
        `Handwriting recognized: ${textNode.title}`
      );
    }

    if (this.editor.hasSelection) {
      this.editor.clearSelection();
    }

    return textNode;
  }

  get diagramEditor(): DiagramEditor | null {
    return this.editor;
  }

  get diagramId(): string | undefined {
    return this.editor?.diagram.id;
  }

  async reloadFromDisk(): Promise<void> {
    if (!this.file || !this.editor) return;
    try {
      const content = await this.app.vault.read(this.file);
      const updatedDiagram = this.serializer.deserialize(content);
      this.editor.updateDiagram(updatedDiagram);
    } catch (e) {
      console.error("Failed to hot reload diagram", e);
    }
  }

  updateSettings(settings: UmlCanvasSettings): void {
    this.applyTheme();
    if (this.renderer) {
      this.renderer.setEnableFreehand(settings.enableFreehand);
      this.renderer.setAutoShapeDetection(settings.autoShapeDetection ?? true);
      this.renderer.setGridVisible(settings.showGrid);
    }
    if (this.toolbar) {
      this.toolbar.setFreehandEnabled(settings.enableFreehand);
      this.toolbar.updateToolMode();
    }
  }

  public applyTheme(): void {
    if (!this.rootEl) return;
    const settingTheme = this.plugin?.settings?.theme ?? "system";
    let isLight = false;

    if (settingTheme === "light") {
      isLight = true;
    } else if (settingTheme === "dark") {
      isLight = false;
    } else {
      // "system": match Obsidian theme
      const bodyHasLight =
        typeof document !== "undefined" &&
        document.body?.classList?.contains("theme-light");
      isLight = Boolean(bodyHasLight);
    }

    if (isLight) {
      this.rootEl.classList.remove("umlcanvas-theme-dark", "theme-dark");
      this.rootEl.classList.add("umlcanvas-theme-light", "theme-light");
    } else {
      this.rootEl.classList.remove("umlcanvas-theme-light", "theme-light");
      this.rootEl.classList.add("umlcanvas-theme-dark", "theme-dark");
    }
  }

  public async toggleTheme(): Promise<void> {
    const isCurrentlyLight =
      (this.rootEl?.classList?.contains("umlcanvas-theme-light") ||
        this.rootEl?.classList?.contains("theme-light")) &&
      !this.rootEl?.classList?.contains("umlcanvas-theme-dark") ||
      false;
    if (this.plugin?.settings) {
      this.plugin.settings.theme = isCurrentlyLight ? "dark" : "light";
    }
    this.applyTheme();
    if (this.plugin?.saveSettings) {
      await this.plugin.saveSettings();
    }
  }

  private addColorSubmenu(
    menu: Menu,
    currentColor: string | undefined,
    onSelectColor: (colorId: string | undefined) => void,
    isStickyOrNote?: boolean
  ): void {
    menu.addItem((item) => {
      item.setTitle("Color").setIcon("palette");
      const subMenu = item.setSubmenu ? item.setSubmenu() : null;
      const targetMenu: Menu = subMenu ?? menu;
      const prefix = subMenu ? "" : "Color: ";

      const isDefault = !currentColor;
      targetMenu.addItem((subItem) => {
        subItem
          .setTitle(`${prefix}Default (None)${isDefault ? " ✓" : ""}`)
          .setIcon("rotate-ccw")
          .onClick(() => {
            onSelectColor(undefined);
          });
      });

      for (const preset of CANVAS_COLOR_PRESETS) {
        let label = preset.label;
        if (isStickyOrNote) {
          const stickyLabels: Record<string, string> = {
            "1": "Pink",
            "2": "Orange",
            "3": "Yellow (Classic)",
            "4": "Green (Mint)",
            "5": "Blue (Sky)",
            "6": "Purple",
          };
          label = stickyLabels[preset.id] ?? preset.label;
        }
        const isCurrent = currentColor === preset.id;
        targetMenu.addItem((subItem) => {
          subItem
            .setTitle(`${prefix}${label} (${preset.id})${isCurrent ? " ✓" : ""}`)
            .setIcon("palette")
            .onClick(() => {
              onSelectColor(preset.id);
            });
        });
      }
    });
  }

  private addFontSizeSubmenu(
    menu: Menu,
    currentFontSize: number | undefined,
    defaultSize: number,
    onAdjustSize: (delta: number) => void,
    onSetSize: (size: number) => void,
    onResetFont: () => void
  ): void {
    menu.addItem((item) => {
      item.setTitle("Font size").setIcon("type");
      const subMenu = item.setSubmenu ? item.setSubmenu() : null;
      const targetMenu: Menu = subMenu ?? menu;
      const prefix = subMenu ? "" : "Font size: ";

      targetMenu.addItem((subItem) => {
        subItem
          .setTitle(`${prefix}Increase (+2px) [Ctrl+]]`)
          .setIcon("plus")
          .onClick(() => {
            onAdjustSize(2);
          });
      });

      targetMenu.addItem((subItem) => {
        subItem
          .setTitle(`${prefix}Decrease (-2px) [Ctrl+[]`)
          .setIcon("minus")
          .onClick(() => {
            onAdjustSize(-2);
          });
      });

      if (subMenu) {
        subMenu.addSeparator();
      }

      for (const preset of FONT_SIZE_PRESETS) {
        const isCurrent = (currentFontSize ?? defaultSize) === preset.size;
        targetMenu.addItem((subItem) => {
          subItem
            .setTitle(`${prefix}${preset.label} (${preset.size}px)${isCurrent ? " ✓" : ""}`)
            .setIcon("type")
            .onClick(() => {
              onSetSize(preset.size);
            });
        });
      }

      if (subMenu) {
        subMenu.addSeparator();
      }

      targetMenu.addItem((subItem) => {
        subItem
          .setTitle(`Reset font (${defaultSize}px, normal)`)
          .setIcon("rotate-ccw")
          .onClick(() => {
            onResetFont();
          });
      });
    });
  }

  private showContextMenu(
    e: MouseEvent,
    canvasPoint: Point,
    node?: DiagramNode,
    edge?: DiagramEdge,
    group?: Group
  ): void {
    const menu = new Menu();

    if (node) {
      if (!this.editor?.isNodeSelected(node.id)) {
        this.editor?.selectNode(node.id, false);
      }

      if (
        node.kind === "generic.freehand" ||
        this.editor?.selectedNodeIds.some((id) => {
          const n = this.editor?.diagram.nodes.find((item) => item.id === id);
          return n?.kind === "generic.freehand";
        })
      ) {
        menu.addItem((item) => {
          item
            .setTitle("Enhance handdrawn note")
            .setIcon("wand-2")
            .onClick(() => {
              this.editor?.enhanceHanddrawnSelection();
            });
        });
        menu.addSeparator();
      }

      if (node.kind === "schematic.chip") {
        menu.addItem((item) => {
          item
            .setTitle("Edit chip interface...")
            .setIcon("cpu")
            .onClick(() => {
              this.openChipDefinitionModal({ existingNode: node });
            });
        });
      }

      if (node.kind === "generic.table") {
        const rows = Math.max(1, (node.customData?.rows as number) || 3);
        const cols = Math.max(1, (node.customData?.cols as number) || 3);
        const relX = canvasPoint.x - node.position.x;
        const relY = canvasPoint.y - node.position.y;
        const colW = node.size.width / cols;
        const rowH = node.size.height / rows;
        const clickR = Math.max(0, Math.min(rows - 1, Math.floor(relY / rowH)));
        const clickC = Math.max(0, Math.min(cols - 1, Math.floor(relX / colW)));

        menu.addItem((item) => {
          item
            .setTitle(`Edit cell (${clickR + 1}, ${clickC + 1})`)
            .setIcon("edit")
            .onClick(() => {
              if (this.renderer?.activeInlineEditor) {
                this.renderer.commitInlineEditor();
              }
              this.renderer?.startInlineEditor(node, { row: clickR, col: clickC });
            });
        });

        menu.addItem((item) => {
          item
            .setTitle("Add row above")
            .setIcon("arrow-up")
            .onClick(() => {
              if (this.renderer?.activeInlineEditor) {
                this.renderer.commitInlineEditor();
              }
              this.editor?.addTableRow(node.id, clickR);
            });
        });

        menu.addItem((item) => {
          item
            .setTitle("Add row below")
            .setIcon("arrow-down")
            .onClick(() => {
              if (this.renderer?.activeInlineEditor) {
                this.renderer.commitInlineEditor();
              }
              this.editor?.addTableRow(node.id, clickR + 1);
            });
        });

        if (rows > 1) {
          menu.addItem((item) => {
            item
              .setTitle(`Delete row (${clickR + 1})`)
              .setIcon("trash")
              .onClick(() => {
                if (this.renderer?.activeInlineEditor) {
                  this.renderer.commitInlineEditor();
                }
                this.editor?.deleteTableRow(node.id, clickR);
              });
          });
        }

        menu.addItem((item) => {
          item
            .setTitle("Add column left")
            .setIcon("arrow-left")
            .onClick(() => {
              if (this.renderer?.activeInlineEditor) {
                this.renderer.commitInlineEditor();
              }
              this.editor?.addTableColumn(node.id, clickC);
            });
        });

        menu.addItem((item) => {
          item
            .setTitle("Add column right")
            .setIcon("arrow-right")
            .onClick(() => {
              if (this.renderer?.activeInlineEditor) {
                this.renderer.commitInlineEditor();
              }
              this.editor?.addTableColumn(node.id, clickC + 1);
            });
        });

        if (cols > 1) {
          menu.addItem((item) => {
            item
              .setTitle(`Delete column (${clickC + 1})`)
              .setIcon("trash")
              .onClick(() => {
                if (this.renderer?.activeInlineEditor) {
                  this.renderer.commitInlineEditor();
                }
                this.editor?.deleteTableColumn(node.id, clickC);
              });
          });
        }
      } else {
        menu.addItem((item) => {
          item
            .setTitle("Edit text")
            .setIcon("edit")
            .onClick(() => {
              this.renderer?.startInlineEditor(node);
            });
        });
      }

      menu.addItem((item) => {
        item
          .setTitle("Auto-fit size")
          .setIcon("scaling")
          .onClick(() => {
            this.editor?.autoResizeNode(node.id);
          });
      });

      const isLocked = this.editor?.isNodeLocked(node.id) ?? false;
      menu.addItem((item) => {
        item
          .setTitle(isLocked ? "Unlock node" : "Lock node")
          .setIcon(isLocked ? "unlock" : "lock")
          .onClick(() => {
            this.editor?.toggleNodeLock(node.id);
          });
      });

      const hasFreehand =
        node.kind === "generic.freehand" ||
        (this.editor?.selectedNodeIds.some(
          (id) => this.editor?.diagram.nodes.find((n) => n.id === id)?.kind === "generic.freehand"
        ) ?? false);

      if (hasFreehand) {
        menu.addItem((item) => {
          item
            .setTitle("Enhance handwriting to text (Sparkles)")
            .setIcon("sparkles")
            .onClick(() => {
              this.editor?.enhanceSelection();
            });
        });
      }

      if (node.kind === "generic.image") {
        menu.addItem((item) => {
          item
            .setTitle("Change image...")
            .setIcon("image")
            .onClick(() => {
              this.openImagePickerModal(node.position, node.id);
            });
        });
      }

      if (node.kind === "generic.pdf") {
        menu.addItem((item) => {
          item
            .setTitle("Change PDF document...")
            .setIcon("file-text")
            .onClick(() => {
              this.openPdfPickerModal(node.position, node.id);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle("Set target page (subpath)...")
            .setIcon("file-text")
            .onClick(() => {
              this.promptChangePdfPage(node);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle("Edit title...")
            .setIcon("pencil")
            .onClick(() => {
              this.renderer?.startInlineEditor(node);
            });
        });
      }

      const filePath =
        (node.metadata?.filePath as string) ||
        (node.customData?.filePath as string);
      if (filePath) {
        const subpath =
          (node.metadata?.subpath as string) ||
          (node.customData?.subpath as string) ||
          "";
        const fullTarget = filePath + (subpath ? (subpath.startsWith("#") ? subpath : "#" + subpath) : "");
        menu.addItem((item) => {
          item
            .setTitle(node.kind === "generic.pdf" ? "Open PDF in Obsidian" : "Open note in Obsidian")
            .setIcon("external-link")
            .onClick(() => {
              void this.app.workspace.openLinkText(fullTarget, "", false);
            });
        });
        if (node.kind === "generic.pdf") {
          menu.addItem((item) => {
            item
              .setTitle("Open PDF in new tab")
              .setIcon("external-link")
              .onClick(() => {
                void this.app.workspace.openLinkText(fullTarget, "", true);
              });
          });
        }
      }

      if (node.kind === "obsidian.note") {
        const isFit = (node.customData?.scaleMode ?? "fit") === "fit";
        menu.addItem((item) => {
          item
            .setTitle(isFit ? "Scale: 100% (Original size)" : "Scale: Fit content to card")
            .setIcon("scaling")
            .onClick(() => {
              this.renderer?.toggleNoteScaleMode(node.id);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle("Scale: Zoom in (+15%)")
            .setIcon("zoom-in")
            .onClick(() => {
              this.renderer?.adjustNoteScale(node.id, 0.15);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle("Scale: Zoom out (−15%)")
            .setIcon("zoom-out")
            .onClick(() => {
              this.renderer?.adjustNoteScale(node.id, -0.15);
            });
        });
      }

      menu.addSeparator();

      this.addColorSubmenu(
        menu,
        node.style?.color,
        (colorId) => this.editor?.setColorForSelection(colorId),
        node.kind === "generic.stickyNote" || node.kind === "generic.note"
      );

      menu.addSeparator();

      const nodeFont = this.editor?.getNodeFont(node.id) ?? {};
      menu.addItem((item) => {
        item
          .setTitle(nodeFont.bold ? "Bold: On (Ctrl+B) ✓" : "Bold: Off (Ctrl+B)")
          .setIcon("bold")
          .onClick(() => {
            this.editor?.toggleBoldForSelection();
          });
      });

      menu.addItem((item) => {
        item
          .setTitle(nodeFont.italic ? "Italic: On (Ctrl+I) ✓" : "Italic: Off (Ctrl+I)")
          .setIcon("italic")
          .onClick(() => {
            this.editor?.toggleItalicForSelection();
          });
      });

      this.addFontSizeSubmenu(
        menu,
        nodeFont.fontSize,
        13,
        (delta) => this.editor?.adjustFontSizeForSelection(delta),
        (size) => this.editor?.setFontSizeForSelection(size),
        () => this.editor?.resetFontForSelection()
      );

      menu.addSeparator();

      menu.addItem((item) => {
        item
          .setTitle("Copy")
          .setIcon("copy")
          .onClick(() => {
            this.editor?.copySelection();
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Duplicate (Ctrl+D)")
          .setIcon("copy-plus")
          .onClick(() => {
            this.editor?.duplicateSelection();
          });
      });

      if ((this.editor?.selectedNodeIds.length ?? 0) >= 2) {
        menu.addSeparator();

        menu.addItem((item) => {
          item
            .setTitle("Align Left")
            .setIcon("align-left")
            .onClick(() => {
              this.editor?.alignNodes("left");
            });
        });

        menu.addItem((item) => {
          item
            .setTitle("Align Center")
            .setIcon("align-center")
            .onClick(() => {
              this.editor?.alignNodes("center");
            });
        });

        menu.addItem((item) => {
          item
            .setTitle("Align Right")
            .setIcon("align-right")
            .onClick(() => {
              this.editor?.alignNodes("right");
            });
        });

        menu.addItem((item) => {
          item
            .setTitle("Align Top")
            .setIcon("arrow-up")
            .onClick(() => {
              this.editor?.alignNodes("top");
            });
        });

        menu.addItem((item) => {
          item
            .setTitle("Align Middle")
            .setIcon("minus")
            .onClick(() => {
              this.editor?.alignNodes("middle");
            });
        });

        menu.addItem((item) => {
          item
            .setTitle("Align Bottom")
            .setIcon("arrow-down")
            .onClick(() => {
              this.editor?.alignNodes("bottom");
            });
        });

        if ((this.editor?.selectedNodeIds.length ?? 0) >= 3) {
          menu.addSeparator();

          menu.addItem((item) => {
            item
              .setTitle("Distribute Horizontally")
              .setIcon("more-horizontal")
              .onClick(() => {
                this.editor?.distributeNodes("horizontal");
              });
          });

          menu.addItem((item) => {
            item
              .setTitle("Distribute Vertically")
              .setIcon("more-vertical")
              .onClick(() => {
                this.editor?.distributeNodes("vertical");
              });
          });
        }

        menu.addSeparator();

        menu.addItem((item) => {
          item
            .setTitle("Match Width")
            .setIcon("maximize-2")
            .onClick(() => {
              this.editor?.matchNodeSizes("width");
            });
        });

        menu.addItem((item) => {
          item
            .setTitle("Match Height")
            .setIcon("maximize-2")
            .onClick(() => {
              this.editor?.matchNodeSizes("height");
            });
        });
      }

      menu.addItem((item) => {
        item
          .setTitle("Delete")
          .setIcon("trash")
          .onClick(() => {
            this.editor?.deleteSelection();
          });
      });
    } else if (edge) {
      if (!this.editor?.isEdgeSelected(edge.id)) {
        this.editor?.selectEdge(edge.id, false);
      }

      const hasLabel =
        edge.labels && edge.labels.length > 0 && edge.labels[0].text.trim().length > 0;
      menu.addItem((item) => {
        item
          .setTitle(hasLabel ? "Edit line label" : "Add line label")
          .setIcon("tag")
          .onClick(() => {
            this.renderer?.startEdgeInlineEditor(edge, canvasPoint);
          });
      });

      if (hasLabel) {
        menu.addItem((item) => {
          item
            .setTitle("Clear line label")
            .setIcon("x")
            .onClick(() => {
              this.editor?.updateEdgeLabel(edge.id, "");
            });
        });
      }

      menu.addItem((item) => {
        item
          .setTitle("Add bend point here")
          .setIcon("plus")
          .onClick(() => {
            this.editor?.addEdgeWaypoint(edge.id, canvasPoint);
          });
      });

      if (edge.waypoints && edge.waypoints.length > 0) {
        menu.addItem((item) => {
          item
            .setTitle("Clear bend points")
            .setIcon("rotate-ccw")
            .onClick(() => {
              this.editor?.clearEdgeWaypoints(edge.id);
            });
        });
      }

      menu.addItem((item) => {
        item
          .setTitle("Reroute line (Auto)")
          .setIcon("refresh-cw")
          .onClick(() => {
            this.editor?.rerouteEdge(edge.id);
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Reverse line direction")
          .setIcon("arrow-left-right")
          .onClick(() => {
            this.editor?.reverseEdge(edge.id);
          });
      });

      menu.addSeparator();

      menu.addItem((item) => {
        item
          .setTitle(`Routing: Orthogonal${edge.routing === "orthogonal" ? " ✓" : ""}`)
          .setIcon("git-commit")
          .onClick(() => {
            this.editor?.updateEdgeRouting(edge.id, "orthogonal");
          });
      });

      menu.addItem((item) => {
        item
          .setTitle(`Routing: Straight${edge.routing === "straight" ? " ✓" : ""}`)
          .setIcon("minus")
          .onClick(() => {
            this.editor?.updateEdgeRouting(edge.id, "straight");
          });
      });

      menu.addItem((item) => {
        item
          .setTitle(`Routing: Curved${edge.routing === "curved" ? " ✓" : ""}`)
          .setIcon("corner-up-right")
          .onClick(() => {
            this.editor?.updateEdgeRouting(edge.id, "curved");
          });
      });

      menu.addSeparator();

      const connectorStyles: Array<{ kind: string; label: string; icon: string }> = [
        { kind: "uml.association", label: "Association (Line)", icon: "minus" },
        { kind: "uml.directedAssociation", label: "Directed Association (Arrow)", icon: "arrow-up-right" },
        { kind: "uml.aggregation", label: "Aggregation (Hollow Diamond)", icon: "diamond" },
        { kind: "uml.composition", label: "Composition (Filled Diamond)", icon: "diamond" },
        { kind: "uml.generalization", label: "Generalization (Inherit)", icon: "triangle" },
        { kind: "uml.realization", label: "Realization (Dashed)", icon: "git-branch" },
        { kind: "uml.dependency", label: "Dependency (Arrow)", icon: "arrow-up-right" },
        { kind: "uml.directedAggregation", label: "Directed Aggregation", icon: "diamond" },
        { kind: "uml.directedComposition", label: "Directed Composition", icon: "diamond" },
        { kind: "uml.link", label: "Plain Link", icon: "minus" },
      ];

      for (const cs of connectorStyles) {
        menu.addItem((item) => {
          const isCurrent = edge.kind === cs.kind;
          item
            .setTitle(`Style: ${cs.label}${isCurrent ? " ✓" : ""}`)
            .setIcon(cs.icon)
            .onClick(() => {
              this.editor?.updateEdgeKind(edge.id, cs.kind);
              if (this.editor) {
                this.editor.activeEdgeKind = cs.kind;
              }
            });
        });
      }

      menu.addSeparator();

      this.addColorSubmenu(
        menu,
        edge.style?.color,
        (colorId) => this.editor?.setColorForSelection(colorId),
        false
      );

      menu.addSeparator();

      const edgeFont = this.editor?.getEdgeFont(edge.id) ?? {};
      menu.addItem((item) => {
        item
          .setTitle(edgeFont.bold ? "Bold: On (Ctrl+B) ✓" : "Bold: Off (Ctrl+B)")
          .setIcon("bold")
          .onClick(() => {
            this.editor?.toggleBoldForSelection();
          });
      });

      menu.addItem((item) => {
        item
          .setTitle(edgeFont.italic ? "Italic: On (Ctrl+I) ✓" : "Italic: Off (Ctrl+I)")
          .setIcon("italic")
          .onClick(() => {
            this.editor?.toggleItalicForSelection();
          });
      });

      this.addFontSizeSubmenu(
        menu,
        edgeFont.fontSize,
        11,
        (delta) => this.editor?.adjustFontSizeForSelection(delta),
        (size) => this.editor?.setFontSizeForSelection(size),
        () => this.editor?.resetFontForSelection()
      );

      menu.addSeparator();

      menu.addItem((item) => {
        item
          .setTitle("Duplicate (Ctrl+D)")
          .setIcon("copy-plus")
          .onClick(() => {
            this.editor?.duplicateSelection();
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Delete line")
          .setIcon("trash")
          .onClick(() => {
            this.editor?.deleteEdge(edge.id);
          });
      });
    } else if (group) {
      if (!this.editor?.isGroupSelected(group.id)) {
        this.editor?.selectGroup(group.id, false);
      }

      menu.addItem((item) => {
        item
          .setTitle("Rename group")
          .setIcon("edit")
          .onClick(() => {
            this.renderer?.startGroupInlineEditor(group);
          });
      });

      menu.addItem((item) => {
        item
          .setTitle(group.collapsed ? "Expand group" : "Collapse group")
          .setIcon(group.collapsed ? "maximize-2" : "minimize-2")
          .onClick(() => {
            this.editor?.toggleGroupCollapse(group.id);
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Select all member nodes")
          .setIcon("check-square")
          .onClick(() => {
            this.editor?.selectGroupMembers(group.id);
          });
      });

      const isLocked = group.locked ?? false;
      menu.addItem((item) => {
        item
          .setTitle(isLocked ? "Unlock group" : "Lock group")
          .setIcon(isLocked ? "unlock" : "lock")
          .onClick(() => {
            this.editor?.toggleGroupLock(group.id);
          });
      });

      menu.addSeparator();

      this.addColorSubmenu(
        menu,
        group.color,
        (colorId) => this.editor?.setColorForSelection(colorId),
        false
      );

      menu.addSeparator();

      const groupFont = this.editor?.getGroupFont(group.id) ?? {};
      menu.addItem((item) => {
        item
          .setTitle(groupFont.bold ? "Bold: On (Ctrl+B) ✓" : "Bold: Off (Ctrl+B)")
          .setIcon("bold")
          .onClick(() => {
            this.editor?.toggleBoldForSelection();
          });
      });

      menu.addItem((item) => {
        item
          .setTitle(groupFont.italic ? "Italic: On (Ctrl+I) ✓" : "Italic: Off (Ctrl+I)")
          .setIcon("italic")
          .onClick(() => {
            this.editor?.toggleItalicForSelection();
          });
      });

      this.addFontSizeSubmenu(
        menu,
        groupFont.fontSize,
        12,
        (delta) => this.editor?.adjustFontSizeForSelection(delta),
        (size) => this.editor?.setFontSizeForSelection(size),
        () => this.editor?.resetFontForSelection()
      );

      menu.addSeparator();

      menu.addItem((item) => {
        item
          .setTitle("Ungroup (Ctrl+Shift+G)")
          .setIcon("ungroup")
          .onClick(() => {
            this.editor?.ungroupSelection();
          });
      });

      menu.addItem((item) => {
        const selectedCount = this.editor?.selectedGroupIds.length ?? 1;
        item
          .setTitle(selectedCount > 1 ? `Delete ${selectedCount} groups` : "Delete group")
          .setIcon("trash")
          .onClick(() => {
            if (this.editor && this.editor.selectedGroupIds.includes(group.id) && this.editor.selectedGroupIds.length > 1) {
              this.editor.deleteSelection();
            } else {
              this.editor?.deleteGroup(group.id);
            }
          });
      });
    } else {
      menu.addItem((item) => {
        item
          .setTitle("Add node here")
          .setIcon("plus-circle")
          .onClick(() => {
            this.editor?.addNode({
              position: {
                x: Math.round(canvasPoint.x - 70),
                y: Math.round(canvasPoint.y - 40),
              },
              title: "Node",
            });
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Add group box here")
          .setIcon("boxes")
          .onClick(() => {
            this.editor?.addGroup({
              position: {
                x: Math.round(canvasPoint.x - 150),
                y: Math.round(canvasPoint.y - 100),
              },
              size: { width: 300, height: 200 },
              name: "Group",
            });
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Define custom chip...")
          .setIcon("cpu")
          .onClick(() => {
            this.openChipDefinitionModal({ placementPoint: canvasPoint });
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Add note from vault...")
          .setIcon("file-text")
          .onClick(() => {
            this.openNotePickerModal(canvasPoint);
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Add sticky note")
          .setIcon("sticky-note")
          .onClick(() => {
            this.addStickyNoteToCanvas({ canvasPoint });
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Insert image (photo frame)...")
          .setIcon("image")
          .onClick(() => {
            this.openImagePickerModal(canvasPoint);
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Insert PDF document...")
          .setIcon("file-text")
          .onClick(() => {
            this.openPdfPickerModal(canvasPoint);
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Paste")
          .setIcon("clipboard")
          .onClick(() => {
            void this.pasteFromClipboardOrEditor(canvasPoint);
          });
      });

      menu.addSeparator();

      menu.addItem((item) => {
        item
          .setTitle("Reset zoom (1:1)")
          .setIcon("maximize-2")
          .onClick(() => {
            this.renderer?.resetZoom();
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Toggle grid")
          .setIcon("grid")
          .onClick(() => {
            if (this.renderer) {
              this.renderer.setGridVisible(!this.renderer.isGridVisible);
            }
          });
      });

      if (this.minimap) {
        menu.addItem((item) => {
          item
            .setTitle("Toggle minimap")
            .setIcon("map")
            .onClick(() => {
              this.minimap?.toggle();
            });
        });
      }
    }

    menu.showAtMouseEvent(e);
  }

  public openNotePickerModal(canvasPoint?: Point): void {
    new NoteSuggestModal(this.app, (file: TFile) => {
      void this.addNoteToCanvas(file, canvasPoint);
    }).open();
  }

  public openImagePickerModal(canvasPoint?: Point, targetNodeId?: string): void {
    const vaultImages = this.app.vault.getFiles().filter((f: TFile) => isImageFile(f));
    if (vaultImages.length > 0) {
      new ImageSuggestModal(this.app, (file: TFile) => {
        if (targetNodeId && this.editor) {
          let src = file.path;
          try {
            if (typeof this.app.vault.getResourcePath === "function") {
              src = this.app.vault.getResourcePath(file);
            }
          } catch {
            src = file.path;
          }
          const existing = this.editor.diagram.nodes.find((n) => n.id === targetNodeId);
          this.editor.updateNode(targetNodeId, {
            title: file.basename,
            metadata: { ...existing?.metadata, filePath: file.path, src },
            customData: { ...existing?.customData, filePath: file.path, src },
          });
        } else {
          void this.addImageToCanvas({ file, canvasPoint });
        }
      }).open();
    } else {
      this.openLocalImageFileDialog(canvasPoint, targetNodeId);
    }
  }

  public openLocalImageFileDialog(canvasPoint?: Point, targetNodeId?: string): void {
    if (typeof document === "undefined") return;
    const input = createEl("input", {
      type: "file",
      cls: "umlcanvas-file-input-hidden",
    });
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file && typeof FileReader !== "undefined") {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          if (targetNodeId && this.editor) {
            const existing = this.editor.diagram.nodes.find((n) => n.id === targetNodeId);
            this.editor.updateNode(targetNodeId, {
              title: file.name.replace(/\.[^/.]+$/, ""),
              metadata: { ...existing?.metadata, filePath: file.name, src: dataUrl },
              customData: { ...existing?.customData, filePath: file.name, src: dataUrl },
            });
          } else {
            void this.addImageToCanvas({
              src: dataUrl,
              title: file.name.replace(/\.[^/.]+$/, ""),
              canvasPoint,
            });
          }
        };
        reader.readAsDataURL(file);
      }
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  public async addImageToCanvas(options: {
    file?: TFile;
    filePath?: string;
    src?: string;
    title?: string;
    canvasPoint?: Point;
    size?: Size;
  }): Promise<DiagramNode | null> {
    if (!this.editor) return null;

    let targetPoint = options.canvasPoint;
    if (!targetPoint) {
      const transform = this.renderer?.currentTransform ?? { panX: 0, panY: 0, zoom: 1 };
      const centerScreen = {
        x: (this.rootEl?.clientWidth ?? 800) / 2,
        y: (this.rootEl?.clientHeight ?? 600) / 2,
      };
      targetPoint = {
        x: Math.round((centerScreen.x - transform.panX) / transform.zoom - 110),
        y: Math.round((centerScreen.y - transform.panY) / transform.zoom - 130),
      };
    }

    let src = options.src || "";
    const filePath = options.filePath || (options.file ? options.file.path : "");
    const title = options.title || (options.file ? options.file.basename : "Photo");

    if (options.file) {
      try {
        if (typeof this.app.vault.getResourcePath === "function") {
          const resPath = this.app.vault.getResourcePath(options.file);
          if (resPath) src = resPath;
        } else if (!src) {
          src = options.file.path;
        }
      } catch {
        if (!src) src = options.file.path;
      }
    }

    const imageNode = this.editor.addNode({
      kind: "generic.image",
      title,
      position: targetPoint,
      size: options.size ?? { width: 220, height: 260 },
      metadata: {
        filePath,
        src,
      },
      customData: {
        filePath,
        src,
      },
    });

    this.editor.selectNode(imageNode.id, false);
    return imageNode;
  }

  public openPdfPickerModal(canvasPoint?: Point, targetNodeId?: string): void {
    const vaultPdfs = this.app.vault.getFiles().filter((f: TFile) => isPdfFile(f));
    if (vaultPdfs.length > 0) {
      new PdfSuggestModal(this.app, (file: TFile) => {
        if (targetNodeId) {
          void this.updatePdfNodeWithFile(targetNodeId, file);
        } else {
          void this.addPdfToCanvas({ file, canvasPoint });
        }
      }).open();
    } else {
      this.openLocalPdfFileDialog(canvasPoint, targetNodeId);
    }
  }

  public openLocalPdfFileDialog(canvasPoint?: Point, targetNodeId?: string): void {
    if (typeof document === "undefined") return;
    const input = createEl("input", {
      type: "file",
      cls: "umlcanvas-file-input-hidden",
    });
    input.accept = "application/pdf,.pdf";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) {
        void (async () => {
          try {
            const saved = await this.canvasAttachmentService.savePastedPdf(file, {
              file: this.file,
              diagramTitle: this.editor?.diagram?.title,
              preferredName: file.name,
            });
            if (targetNodeId && this.editor) {
              const existing = this.editor.diagram.nodes.find((n) => n.id === targetNodeId);
              this.editor.updateNode(targetNodeId, {
                title: saved.title,
                metadata: {
                  ...existing?.metadata,
                  filePath: saved.filePath,
                  src: saved.src,
                },
                customData: {
                  ...existing?.customData,
                  filePath: saved.filePath,
                  src: saved.src,
                },
              });
            } else {
              await this.addPdfToCanvas({
                file: saved.file ?? undefined,
                filePath: saved.filePath,
                src: saved.src,
                title: saved.title,
                canvasPoint,
              });
            }
          } catch {
            if (typeof FileReader !== "undefined") {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                if (targetNodeId && this.editor) {
                  const existing = this.editor.diagram.nodes.find((n) => n.id === targetNodeId);
                  this.editor.updateNode(targetNodeId, {
                    title: file.name.replace(/\.[^/.]+$/, ""),
                    metadata: {
                      ...existing?.metadata,
                      filePath: file.name,
                      src: dataUrl,
                    },
                    customData: {
                      ...existing?.customData,
                      filePath: file.name,
                      src: dataUrl,
                    },
                  });
                } else {
                  void this.addPdfToCanvas({
                    src: dataUrl,
                    title: file.name.replace(/\.[^/.]+$/, ""),
                    canvasPoint,
                  });
                }
              };
              reader.readAsDataURL(file);
            }
          }
        })();
      }
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  public async updatePdfNodeWithFile(nodeId: string, file: TFile): Promise<void> {
    if (!this.editor) return;
    const existing = this.editor.diagram.nodes.find((n) => n.id === nodeId);
    if (!existing) return;

    let src = file.path;
    try {
      if (typeof this.app.vault.getResourcePath === "function") {
        src = this.app.vault.getResourcePath(file);
      }
    } catch {
      src = file.path;
    }

    const newLabels = existing.labels && existing.labels.length > 0
      ? [{ ...existing.labels[0], text: file.basename }]
      : [{ id: `${nodeId}-label-0`, text: file.basename, anchor: "node" as const, position: { x: 0, y: 0 } }];

    this.editor.updateNode(nodeId, {
      labels: newLabels,
      metadata: {
        ...existing.metadata,
        filePath: file.path,
        src,
      },
      customData: {
        ...existing.customData,
        filePath: file.path,
        src,
      },
    });
  }

  public promptChangePdfPage(node: DiagramNode, directSubpath?: string): void {
    if (!this.editor) return;
    const currentSubpath =
      (node.metadata?.subpath as string) ||
      (node.customData?.subpath as string) ||
      "";

    const applyPage = (subpath: string) => {
      if (!this.editor) return;
      const trimmed = subpath.trim();
      let cleanSubpath = "";
      if (trimmed) {
        cleanSubpath = /^\d+$/.test(trimmed)
          ? `#page=${trimmed}`
          : (trimmed.startsWith("#") ? trimmed : `#${trimmed}`);
      }
      const src = (node.customData?.src as string) || (node.metadata?.src as string) || "";
      const cleanSrc = src ? src.split("#")[0] : "";
      const newSrc = cleanSrc ? (cleanSubpath ? `${cleanSrc}${cleanSubpath}` : cleanSrc) : src;

      this.editor.updateNode(node.id, {
        metadata: { ...node.metadata, subpath: cleanSubpath, ...(newSrc ? { src: newSrc } : {}) },
        customData: { ...node.customData, subpath: cleanSubpath, ...(newSrc ? { src: newSrc } : {}) },
      });
    };

    if (directSubpath !== undefined) {
      applyPage(directSubpath);
      return;
    }

    const win = typeof window !== "undefined" ? (window as unknown as { prompt?: (msg?: string, def?: string) => string | null }) : null;
    if (win && typeof win.prompt === "function") {
      const match = currentSubpath.match(/page=(\d+)/i);
      const currentPage = match ? match[1] : (currentSubpath ? currentSubpath.replace(/^#/, "") : "1");
      const pageStr = win.prompt("Enter target page number (e.g. 5) or subpath (e.g. #page=5):", currentPage);
      if (pageStr === null) return;
      applyPage(pageStr.trim());
      return;
    }

    try {
      new PdfPageModal(this.app, currentSubpath, (newSubpath) => {
        applyPage(newSubpath);
      }).open();
    } catch {
      applyPage("");
    }
  }

  public async addPdfToCanvas(options: {
    file?: TFile;
    filePath?: string;
    src?: string;
    title?: string;
    subpath?: string;
    canvasPoint?: Point;
    size?: Size;
  }): Promise<DiagramNode | null> {
    if (!this.editor) return null;

    let targetPoint = options.canvasPoint;
    if (!targetPoint) {
      const transform = this.renderer?.currentTransform ?? { panX: 0, panY: 0, zoom: 1 };
      const centerScreen = {
        x: (this.rootEl?.clientWidth ?? 800) / 2,
        y: (this.rootEl?.clientHeight ?? 600) / 2,
      };
      targetPoint = {
        x: Math.round((centerScreen.x - transform.panX) / transform.zoom - 170),
        y: Math.round((centerScreen.y - transform.panY) / transform.zoom - 220),
      };
    }

    let filePath = options.filePath || (options.file ? options.file.path : "");
    let title = options.title || (options.file ? options.file.basename : (filePath ? filePath.split(/[?#]/)[0].split("/").pop()?.replace(/\.pdf$/i, "") : "Document"));
    const subpath = options.subpath || "";
    let src = options.src || "";

    // Resolve file if filePath provided without file
    let targetFile = options.file;
    if (!targetFile && filePath && !filePath.startsWith("data:") && !filePath.startsWith("http")) {
      const cleanPath = filePath.split(/[?#]/)[0];
      const byPath = this.app.vault.getAbstractFileByPath(cleanPath);
      if (byPath instanceof TFile) {
        targetFile = byPath;
        filePath = byPath.path;
      } else {
        const dest = this.app.metadataCache?.getFirstLinkpathDest?.(cleanPath, this.file?.path ?? "");
        if (dest instanceof TFile) {
          targetFile = dest;
          filePath = dest.path;
        }
      }
    }

    if (targetFile) {
      try {
        if (typeof this.app.vault.getResourcePath === "function") {
          src = this.app.vault.getResourcePath(targetFile);
        } else {
          src = targetFile.path;
        }
      } catch {
        src = targetFile.path;
      }
      if (!options.title) {
        title = targetFile.basename;
      }
    }

    const pdfNode = this.editor.addNode({
      kind: "generic.pdf",
      title,
      position: targetPoint,
      size: options.size ?? { width: 340, height: 440 },
      metadata: {
        filePath,
        src,
        subpath,
      },
      customData: {
        filePath,
        src,
        subpath,
      },
    });

    this.editor.selectNode(pdfNode.id, false);
    return pdfNode;
  }

  public async handleExternalDrop(e: DragEvent, canvasPoint: Point): Promise<boolean> {
    // 1. Check Obsidian dragManager
    const appWithDrag = this.app as unknown as AppWithDragManager;
    const dragManager = appWithDrag.dragManager;
    let file: TFile | null = null;
    if (dragManager?.draggable?.file instanceof TFile) {
      file = dragManager.draggable.file;
    } else if (dragManager?.dragData?.file instanceof TFile) {
      file = dragManager.dragData.file;
    } else if (Array.isArray(dragManager?.draggable?.files) && dragManager.draggable.files[0] instanceof TFile) {
      file = dragManager.draggable.files[0];
    } else if (Array.isArray(dragManager?.dragData?.files) && dragManager.dragData.files[0] instanceof TFile) {
      file = dragManager.dragData.files[0];
    }

    // 2. Check dataTransfer text for wikilink or path
    let subpath: string | undefined = undefined;
    if (!file && e.dataTransfer) {
      const text = e.dataTransfer.getData("text/plain") || "";
      const match = text.trim().match(/^!?\[\[(.*?)\]\]$/);
      const rawMatch = match ? match[1] : text.trim();
      const subpathMatch = rawMatch.match(/(#[^|]+)/);
      if (subpathMatch) {
        subpath = subpathMatch[1];
      }
      const linkPath = rawMatch.split("|")[0].split("#")[0].trim();
      if (linkPath) {
        const dest = this.app.metadataCache.getFirstLinkpathDest(linkPath, this.file?.path ?? "");
        if (dest instanceof TFile) {
          file = dest;
        } else {
          const byPath = this.app.vault.getAbstractFileByPath(linkPath);
          if (byPath instanceof TFile) {
            file = byPath;
          } else {
            const byPathMd = this.app.vault.getAbstractFileByPath(linkPath + ".md");
            if (byPathMd instanceof TFile) {
              file = byPathMd;
            } else {
              const byPathPdf = this.app.vault.getAbstractFileByPath(
                linkPath.toLowerCase().endsWith(".pdf") ? linkPath : linkPath + ".pdf"
              );
              if (byPathPdf instanceof TFile) {
                file = byPathPdf;
              }
            }
          }
        }
      }
    }

    if (file) {
      if (isImageFile(file)) {
        await this.addImageToCanvas({ file, canvasPoint });
      } else if (isPdfFile(file)) {
        await this.addPdfToCanvas({ file, canvasPoint, subpath });
      } else {
        await this.addNoteToCanvas(file, canvasPoint);
      }
      return true;
    }

    // 3. Check dataTransfer files from OS file manager
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const osFile = e.dataTransfer.files[i];
        if (osFile.type.startsWith("image/") || isImageFile(osFile.name)) {
          void this.handlePastedImageBlob(osFile, canvasPoint);
          return true;
        } else if (osFile.type === "application/pdf" || isPdfFile(osFile.name)) {
          void (async () => {
            try {
              const saved = await this.canvasAttachmentService.savePastedPdf(osFile, {
                file: this.file,
                diagramTitle: this.editor?.diagram?.title,
                preferredName: osFile.name,
              });
              await this.addPdfToCanvas({
                file: saved.file ?? undefined,
                filePath: saved.filePath,
                src: saved.src,
                title: saved.title,
                canvasPoint,
              });
            } catch {
              if (typeof FileReader !== "undefined") {
                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = reader.result as string;
                  void this.addPdfToCanvas({
                    src: dataUrl,
                    title: osFile.name.replace(/\.[^/.]+$/, ""),
                    canvasPoint,
                  });
                };
                reader.readAsDataURL(osFile);
              }
            }
          })();
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Automatically saves a pasted image blob to the canvas document's dedicated directory
   * inside its working directory and links the resulting image node onto the canvas (#5).
   */
  public async handlePastedImageBlob(
    blob: Blob,
    canvasPoint?: Point
  ): Promise<DiagramNode | null> {
    const rawBlobName =
      "name" in blob && typeof (blob as { name: unknown }).name === "string"
        ? (blob as { name: string }).name
        : undefined;
    try {
      const saved = await this.canvasAttachmentService.savePastedImage(blob, {
        file: this.file,
        diagramTitle: this.editor?.diagram?.title,
        preferredName: rawBlobName,
      });

      return await this.addImageToCanvas({
        file: saved.file ?? undefined,
        filePath: saved.filePath,
        src: saved.src,
        title: saved.title,
        canvasPoint,
        size: saved.size,
      });
    } catch (err) {
      console.warn(
        "[Canvas++] Failed to save pasted image into canvas directory, falling back to data URL:",
        err
      );
      if (typeof FileReader !== "undefined") {
        return new Promise<DiagramNode | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            void this.addImageToCanvas({
              src: dataUrl,
              title: rawBlobName?.replace(/\.[^/.]+$/, "") || "Image",
              canvasPoint,
            }).then(resolve);
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      }
      return null;
    }
  }

  /**
   * Reads from system clipboard (images, files) or falls back to canvas editor selection paste.
   */
  public async pasteFromClipboardOrEditor(canvasPoint?: Point): Promise<void> {
    const targetPoint = canvasPoint ?? this.lastMouseCanvasPos ?? undefined;

    // 1. Check system clipboard if navigator.clipboard is available
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.read === "function"
    ) {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((t) => t.startsWith("image/"));
          if (imageType) {
            const blob = await item.getType(imageType);
            if (blob) {
              await this.handlePastedImageBlob(blob, targetPoint);
              return;
            }
          }
        }
      } catch {
        // Permission denied or clipboard format not accessible, proceed to internal paste
      }
    }

    // 2. Fallback to diagram selection paste
    if (this.editor?.canPaste) {
      this.editor.paste(targetPoint);
    }
  }

  public handlePaste(e: ClipboardEvent): void {
    const transform = this.renderer?.currentTransform ?? { panX: 0, panY: 0, zoom: 1 };
    const centerScreen = {
      x: (this.rootEl?.clientWidth ?? 800) / 2,
      y: (this.rootEl?.clientHeight ?? 600) / 2,
    };
    const basePoint = this.lastMouseCanvasPos ?? {
      x: Math.round((centerScreen.x - transform.panX) / transform.zoom - 110),
      y: Math.round((centerScreen.y - transform.panY) / transform.zoom - 130),
    };

    // 1. Check binary items (blobs from clipboard)
    const imageBlobs: Blob[] = [];
    const pdfBlobs: Blob[] = [];

    const items = e.clipboardData?.items;
    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) imageBlobs.push(blob);
        } else if (item.type === "application/pdf") {
          const blob = item.getAsFile();
          if (blob) pdfBlobs.push(blob);
        }
      }
    }

    // Also check clipboardData.files if items was empty
    if (
      imageBlobs.length === 0 &&
      pdfBlobs.length === 0 &&
      e.clipboardData?.files &&
      e.clipboardData.files.length > 0
    ) {
      for (let i = 0; i < e.clipboardData.files.length; i++) {
        const file = e.clipboardData.files[i];
        if (file.type.startsWith("image/") || isImageFile(file.name)) {
          imageBlobs.push(file);
        } else if (file.type === "application/pdf" || isPdfFile(file.name)) {
          pdfBlobs.push(file);
        }
      }
    }

    if (imageBlobs.length > 0) {
      e.preventDefault();
      void (async () => {
        let offset = 0;
        for (const blob of imageBlobs) {
          const pt = { x: basePoint.x + offset, y: basePoint.y + offset };
          await this.handlePastedImageBlob(blob, pt);
          offset += 40;
        }
      })();
      return;
    }

    if (pdfBlobs.length > 0) {
      e.preventDefault();
      let offset = 0;
      for (const blob of pdfBlobs) {
        const pt = { x: basePoint.x + offset, y: basePoint.y + offset };
        const rawPdfName =
          "name" in blob && typeof (blob as { name: unknown }).name === "string"
            ? (blob as { name: string }).name
            : undefined;
        void (async () => {
          try {
            const saved = await this.canvasAttachmentService.savePastedPdf(blob, {
              file: this.file,
              diagramTitle: this.editor?.diagram?.title,
              preferredName: rawPdfName,
            });
            await this.addPdfToCanvas({
              file: saved.file ?? undefined,
              filePath: saved.filePath,
              src: saved.src,
              title: saved.title,
              canvasPoint: pt,
            });
          } catch {
            if (typeof FileReader !== "undefined") {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                void this.addPdfToCanvas({
                  src: dataUrl,
                  title: rawPdfName?.replace(/\.[^/.]+$/, "") || "Document",
                  canvasPoint: pt,
                });
              };
              reader.readAsDataURL(blob);
            }
          }
        })();
        offset += 40;
      }
      return;
    }

    // 2. Check text from clipboard for base64 data URL, PDF or image link/path
    const text = e.clipboardData?.getData("text/plain")?.trim();
    if (text) {
      if (text.startsWith("data:image/")) {
        e.preventDefault();
        const blob = this.canvasAttachmentService.dataUrlToBlob(text);
        if (blob) {
          void this.handlePastedImageBlob(blob, basePoint);
          return;
        }
      }

      const match = text.match(/^!?\[\[(.*?)\]\]$/);
      const rawContent = match ? match[1] : text;
      const subpathMatch = rawContent.match(/(#[^|]+)/);
      const subpath = subpathMatch ? subpathMatch[1] : undefined;
      const linkPath = rawContent.split("|")[0].split("#")[0].trim();

      if (isPdfFile(linkPath)) {
        e.preventDefault();
        let file = this.app.metadataCache?.getFirstLinkpathDest(linkPath, this.file?.path ?? "");
        if (!(file instanceof TFile)) {
          const byPath = this.app.vault.getAbstractFileByPath(linkPath);
          if (byPath instanceof TFile) file = byPath;
        }
        if (file instanceof TFile) {
          void this.addPdfToCanvas({ file, subpath, canvasPoint: basePoint });
        } else if (
          linkPath.startsWith("http://") ||
          linkPath.startsWith("https://") ||
          linkPath.startsWith("data:")
        ) {
          void this.addPdfToCanvas({
            src: linkPath,
            subpath,
            title: linkPath.split("/").pop()?.replace(/\.pdf$/i, ""),
            canvasPoint: basePoint,
          });
        } else {
          void this.addPdfToCanvas({ filePath: linkPath, subpath, canvasPoint: basePoint });
        }
        return;
      } else if (isImageFile(linkPath)) {
        e.preventDefault();
        let file = this.app.metadataCache?.getFirstLinkpathDest(linkPath, this.file?.path ?? "");
        if (!(file instanceof TFile)) {
          const byPath = this.app.vault.getAbstractFileByPath(linkPath);
          if (byPath instanceof TFile) file = byPath;
        }
        if (file instanceof TFile) {
          void this.addImageToCanvas({ file, canvasPoint: basePoint });
        } else if (
          linkPath.startsWith("http://") ||
          linkPath.startsWith("https://") ||
          linkPath.startsWith("data:")
        ) {
          void this.addImageToCanvas({
            src: linkPath,
            title: linkPath.split("/").pop()?.replace(/\.[^/.]+$/, ""),
            canvasPoint: basePoint,
          });
        } else {
          void this.addImageToCanvas({ filePath: linkPath, canvasPoint: basePoint });
        }
        return;
      }
    }

    // 3. Fallback: if user copied internal nodes in canvas editor, paste them
    if (this.editor?.canPaste) {
      e.preventDefault();
      this.editor.paste(basePoint);
    }
  }

  public addStickyNoteToCanvas(options?: {
    text?: string;
    color?: string;
    canvasPoint?: Point;
    size?: Size;
  }): DiagramNode | null {
    if (!this.editor) return null;

    let targetPoint = options?.canvasPoint;
    if (!targetPoint) {
      const transform = this.renderer?.currentTransform ?? { panX: 0, panY: 0, zoom: 1 };
      const centerScreen = {
        x: (this.rootEl?.clientWidth ?? 800) / 2,
        y: (this.rootEl?.clientHeight ?? 600) / 2,
      };
      targetPoint = {
        x: Math.round((centerScreen.x - transform.panX) / transform.zoom - 90),
        y: Math.round((centerScreen.y - transform.panY) / transform.zoom - 70),
      };
    }

    const initialText = options?.text ?? "Sticky Note";
    const initialW = options?.size?.width ?? 180;
    const initialH = options?.size?.height ?? 140;
    const wrapped = wrapTextToLines(initialText, Math.max(40, initialW - 24), 13 * 0.58);
    const neededH = Math.max(initialH, 26 + 13 + Math.max(1, wrapped.length) * Math.round(13 * 1.38) + 12);

    const stickyNode = this.editor.addNode({
      kind: "generic.stickyNote",
      title: initialText,
      position: targetPoint,
      size: { width: initialW, height: neededH },
      style: {
        color: options?.color ?? "3",
      },
    });

    this.editor.selectNode(stickyNode.id, false);
    if (this.renderer) {
      this.renderer.startInlineEditor(stickyNode);
    }
    return stickyNode;
  }

  public async addNoteToCanvas(file: TFile, canvasPoint?: Point): Promise<DiagramNode | null> {
    if (!this.editor) return null;

    let targetPoint = canvasPoint;
    if (!targetPoint) {
      const transform = this.renderer?.currentTransform ?? { panX: 0, panY: 0, zoom: 1 };
      const centerScreen = {
        x: (this.rootEl?.clientWidth ?? 800) / 2,
        y: (this.rootEl?.clientHeight ?? 600) / 2,
      };
      targetPoint = {
        x: Math.round((centerScreen.x - transform.panX) / transform.zoom - 170),
        y: Math.round((centerScreen.y - transform.panY) / transform.zoom - 120),
      };
    }

    let content = "";
    let snippet = "";
    try {
      content = await this.app.vault.read(file);
      snippet = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("---"))
        .slice(0, 5)
        .join("\n");
    } catch {
      content = "";
      snippet = "";
    }

    const noteNode = this.editor.addNode({
      kind: "obsidian.note",
      title: file.basename,
      position: targetPoint,
      size: { width: 340, height: 240 },
      metadata: {
        filePath: file.path,
      },
      customData: {
        filePath: file.path,
        content,
        snippet,
        scaleMode: "fit",
        scale: 1.0,
      },
    });

    this.editor.selectNode(noteNode.id, false);
    return noteNode;
  }

  private resolveVaultResourcePaths(): void {
    if (!this.editor) return;
    const resourceNodes = this.editor.diagram.nodes.filter(
      (n) =>
        (n.kind === "generic.pdf" || n.kind === "generic.image") &&
        Boolean(n.metadata?.filePath || n.customData?.filePath)
    );
    for (const node of resourceNodes) {
      const rawPath =
        (node.metadata?.filePath as string) ||
        (node.customData?.filePath as string);
      if (!rawPath) continue;

      const cleanPath = rawPath.split(/[?#]/)[0];
      let file = this.app.vault.getAbstractFileByPath(cleanPath);
      if (!(file instanceof TFile)) {
        const normalized = cleanPath.replace(/\\/g, "/").replace(/^\.\//, "");
        file = this.app.vault.getAbstractFileByPath(normalized);
      }
      if (!(file instanceof TFile) && this.app.metadataCache?.getFirstLinkpathDest) {
        file = this.app.metadataCache.getFirstLinkpathDest(cleanPath, this.file?.path ?? "");
      }
      if (!(file instanceof TFile) && typeof this.app.vault.getFiles === "function") {
        const files = this.app.vault.getFiles();
        file = files.find((f: TFile) => f.path === cleanPath || f.name === cleanPath || f.basename === cleanPath.replace(/\.[^/.]+$/, "")) ?? null;
      }

      if (file instanceof TFile) {
        let src = "";
        try {
          if (typeof this.app.vault.getResourcePath === "function") {
            src = this.app.vault.getResourcePath(file);
          } else {
            src = file.path;
          }
        } catch {
          src = file.path;
        }

        if (src && (node.customData?.src !== src || node.metadata?.src !== src)) {
          const currentTitle = node.labels[0]?.text ?? "";
          const newTitle = (!currentTitle || currentTitle === "Document" || currentTitle === "Photo") ? file.basename : currentTitle;
          this.editor.updateNode(node.id, {
            title: newTitle,
            metadata: {
              ...node.metadata,
              filePath: file.path,
              src,
            },
            customData: {
              ...node.customData,
              filePath: file.path,
              src,
            },
          });
        }
      }
    }
  }

  private async loadVaultNotesContent(): Promise<void> {
    if (!this.editor) return;
    const noteNodes = this.editor.diagram.nodes.filter(
      (n) =>
        (n.kind === "obsidian.note" || Boolean(n.metadata?.filePath)) &&
        n.kind !== "generic.pdf" &&
        n.kind !== "generic.image"
    );
    if (noteNodes.length === 0) return;

    for (const node of noteNodes) {
      const filePath =
        (node.metadata?.filePath as string) ||
        (node.customData?.filePath as string);
      if (!filePath) continue;

      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        try {
          const content = await this.app.vault.read(file);
          const snippet = content
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !l.startsWith("---"))
            .slice(0, 5)
            .join("\n");

          const currentContent = node.customData?.content;
          if (currentContent !== content || !node.customData?.snippet) {
            this.editor.updateNode(node.id, {
              customData: {
                ...node.customData,
                filePath: file.path,
                content,
                snippet,
                scaleMode: node.customData?.scaleMode ?? "fit",
              },
            });
          }
        } catch {
          // Ignore read errors
        }
      }
    }
  }

  private async handleVaultFileModified(file: TFile): Promise<void> {
    if (!this.editor) return;
    const matchingNodes = this.editor.diagram.nodes.filter(
      (n) =>
        n.metadata?.filePath === file.path ||
        n.customData?.filePath === file.path
    );
    if (matchingNodes.length === 0) return;

    try {
      const content = await this.app.vault.read(file);
      const snippet = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("---"))
        .slice(0, 5)
        .join("\n");

      for (const node of matchingNodes) {
        this.editor.updateNode(node.id, {
          customData: {
            ...node.customData,
            filePath: file.path,
            content,
            snippet,
          },
        });
      }
    } catch {
      // Ignore read errors
    }
  }

  private handleVaultFileRenamed(file: TFile, oldPath: string): void {
    if (!this.editor) return;
    const matchingNodes = this.editor.diagram.nodes.filter(
      (n) =>
        n.metadata?.filePath === oldPath ||
        n.customData?.filePath === oldPath
    );
    if (matchingNodes.length === 0) return;

    const oldBasename = oldPath.split("/").pop()?.replace(/\.[^/.]+$/, "") ?? "";
    for (const node of matchingNodes) {
      const newLabels = node.labels.map((l) =>
        l.text === oldBasename ? { ...l, text: file.basename } : l
      );
      let newSrc = node.customData?.src;
      if (typeof this.app.vault.getResourcePath === "function") {
        try {
          newSrc = this.app.vault.getResourcePath(file);
        } catch (err) {
          void err;
        }
      }
      this.editor.updateNode(node.id, {
        metadata: {
          ...node.metadata,
          filePath: file.path,
          ...(newSrc ? { src: newSrc } : {}),
        },
        customData: {
          ...node.customData,
          filePath: file.path,
          ...(newSrc ? { src: newSrc } : {}),
        },
        labels: newLabels,
      });
    }
  }

  openChipDefinitionModal(options?: {
    initialDefinition?: ChipInterfaceDefinition;
    existingNode?: DiagramNode;
    placementPoint?: Point;
  }): void {
    if (!this.editor) return;

    let multipleInstancesCount = 1;
    if (options?.existingNode?.metadata?.chipInterfaceId) {
      const chipId = options.existingNode.metadata.chipInterfaceId;
      multipleInstancesCount = this.editor.diagram.nodes.filter(
        (n) => n.kind === "schematic.chip" && n.metadata?.chipInterfaceId === chipId
      ).length;
    }

    const modal = new ChipDefinitionModal(this.app, {
      initialDefinition: options?.initialDefinition,
      existingNode: options?.existingNode,
      multipleInstancesCount,
      onSave: (definition, saveOptions) => {
        if (!this.editor) return;

        if (saveOptions.saveToLibrary) {
          defaultCustomChipRegistry.register(definition);
        }

        if (options?.existingNode) {
          this.editor.updateChipNode(
            options.existingNode.id,
            definition,
            saveOptions.propagateToInstances
          );
        } else {
          let pos: Point;
          if (options?.placementPoint) {
            pos = options.placementPoint;
          } else {
            const transform = this.renderer?.currentTransform ?? { panX: 0, panY: 0, zoom: 1 };
            const centerScreen = {
              x: (this.rootEl?.clientWidth ?? 800) / 2,
              y: (this.rootEl?.clientHeight ?? 600) / 2,
            };
            pos = {
              x: Math.round((centerScreen.x - transform.panX) / transform.zoom - 70),
              y: Math.round((centerScreen.y - transform.panY) / transform.zoom - 45),
            };
          }
          this.editor.instantiateChip(definition, pos);
        }

        this.requestSave();
      },
    });

    modal.open();
  }

  async onClose(): Promise<void> {
    await super.onClose();
    this.clear();
  }
}
