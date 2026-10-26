import { TextFileView, WorkspaceLeaf, Menu, MenuItem, TFile, MarkdownRenderer, Platform, App } from "obsidian";

declare module "obsidian" {
  interface MenuItem {
    setSubmenu?(): Menu;
  }
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
import { ChipDefinitionModal } from "./ChipDefinitionModal";
import { ChipInterfaceDefinition } from "../../domain/entities/ChipInterfaceDefinition";
import { defaultCustomChipRegistry } from "../../domain/services/CustomChipRegistry";
import { Stroke } from "../../domain/services/ShapeRecognizer";
import { wrapTextToLines } from "../../domain/services/TextMeasurement";
import { UmlCanvasSettings } from "../../infrastructure/obsidian/PluginSettings";
import { CANVAS_COLOR_PRESETS } from "../../domain/value-objects/CanvasColor";
import { FONT_SIZE_PRESETS } from "../theme/Typography";

interface AppWithDragManager extends App {
  dragManager?: {
    draggable?: { file?: unknown };
    dragData?: { file?: unknown };
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

    const settings = this.plugin?.settings;

    // Setup debounced autosave via Obsidian's requestSave
    this.autosaveCoordinator = new AutosaveCoordinator(
      this.editor,
      async () => {
        this.requestSave();
      },
      settings?.autosaveDelayMs ?? 1000
    );

    // Setup SVG Renderer
    this.renderer = new SvgSceneRenderer(svgContainer, this.editor, {
      showGrid: settings?.showGrid ?? true,
      enableFreehand: settings?.enableFreehand ?? true,
      autoShapeDetection: settings?.autoShapeDetection ?? true,
      onModeChange: () => {
        if (this.toolbar) {
          this.toolbar.updateToolMode();
        }
      },
      onTransformChange: (t) => {
        if (this.toolbar) {
          this.toolbar.updateZoomLabel(t);
        }
        if (this.minimap) {
          this.minimap.update();
        }
      },
      onStrokeComplete: (stroke, strokeOpts) => {
        if (!this.editor) return;
        const autoDetect = strokeOpts?.autoDetect ?? this.renderer?.isAutoShapeDetection ?? true;
        if (autoDetect) {
          const result = this.editor.snapStrokeToShape(stroke);
          if (result) {
            this.showFreehandEscapeHatch(stroke);
          } else {
            this.editor.keepAsFreehand(stroke);
          }
        } else {
          this.editor.keepAsFreehand(stroke);
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
      onExternalDrop: async (e: DragEvent, canvasPoint: Point) => {
        // 1. Check Obsidian dragManager
        const appWithDrag = this.app as unknown as AppWithDragManager;
        const dragManager = appWithDrag.dragManager;
        let file: TFile | null = null;
        if (dragManager?.draggable?.file instanceof TFile) {
          file = dragManager.draggable.file;
        } else if (dragManager?.dragData?.file instanceof TFile) {
          file = dragManager.dragData.file;
        }

        // 2. Check dataTransfer text for wikilink or path
        if (!file && e.dataTransfer) {
          const text = e.dataTransfer.getData("text/plain") || "";
          const match = text.match(/^\[\[(.*?)\]\]$/);
          const linkPath = match ? match[1].split("|")[0].split("#")[0] : text.trim();
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
                }
              }
            }
          }
        }

        if (file) {
          if (isImageFile(file)) {
            await this.addImageToCanvas({ file, canvasPoint });
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
              if (typeof FileReader !== "undefined") {
                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = reader.result as string;
                  void this.addImageToCanvas({
                    src: dataUrl,
                    title: osFile.name.replace(/\.[^/.]+$/, ""),
                    canvasPoint,
                  });
                };
                reader.readAsDataURL(osFile);
              }
              return true;
            }
          }
        }
        return false;
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
      }
    );

    // Deselect currently selected component(s) when clicking empty canvas space (#9)
    this.rootEl.addEventListener("mousedown", (e: MouseEvent) => {
      if ((e as any)._umlHandled) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(
          ".umlcanvas-toolbar, .umlcanvas-main-toolbar, .umlcanvas-floating-bottom-toolbar, .umlcanvas-menu-dropdown, .umlcanvas-palette-panel, .umlcanvas-minimap, .umlcanvas-color-palette-popover, .umlcanvas-align-popover, .umlcanvas-font-size-popover, .umlcanvas-font-size-dropdown, .umlcanvas-font-family-dropdown, .umlcanvas-connector-popover, .umlcanvas-line-popover, .umlcanvas-breadcrumbs, .umlcanvas-inline-editor, .modal, .menu, [class*='popover'], [class*='dropdown']"
        )
      ) {
        return;
      }
      (e as any)._umlHandled = true;
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

      if (mod && e.key.toLowerCase() === "c" && !isInput) {
        e.preventDefault();
        this.editor?.copySelection();
      } else if (mod && e.key.toLowerCase() === "v" && !isInput) {
        e.preventDefault();
        this.editor?.paste();
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
      }
    });

    // Setup Image Paste listener
    this.rootEl.addEventListener("paste", (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith("image/")) {
            e.preventDefault();
            const blob = item.getAsFile();
            if (blob && typeof FileReader !== "undefined") {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                void this.addImageToCanvas({
                  src: dataUrl,
                  title: "Pasted Photo",
                });
              };
              reader.readAsDataURL(blob);
              return;
            }
          }
        }
      }
    });

    // Load full note content from vault for embedded note cards
    void this.loadVaultNotesContent();
  }

  showFreehandEscapeHatch(stroke: Stroke): void {
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
    toast.createSpan({ text: "Shape recognized" });
    const btn = toast.createEl("button", {
      cls: "umlcanvas-escape-hatch-btn",
      text: "Keep as freehand",
    });

    btn.onclick = (e) => {
      e.stopPropagation();
      if (this.editor) {
        this.editor.undo();
        this.editor.keepAsFreehand(stroke);
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

      menu.addItem((item) => {
        item
          .setTitle("Edit text")
          .setIcon("edit")
          .onClick(() => {
            this.renderer?.startInlineEditor(node);
          });
      });

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

      if (node.kind === "generic.image") {
        menu.addItem((item) => {
          item
            .setTitle("Change image...")
            .setIcon("image")
            .onClick(() => {
              this.openImagePickerModal(node.position);
            });
        });
      }

      const filePath =
        (node.metadata?.filePath as string) ||
        (node.customData?.filePath as string);
      if (filePath) {
        menu.addItem((item) => {
          item
            .setTitle("Open note in Obsidian")
            .setIcon("external-link")
            .onClick(() => {
              void this.app.workspace.openLinkText(filePath, "", false);
            });
        });
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
        item
          .setTitle("Delete group")
          .setIcon("trash")
          .onClick(() => {
            this.editor?.deleteGroup(group.id);
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
              title: "New Node",
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
              name: "New Group",
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
          .setTitle("Paste")
          .setIcon("clipboard")
          .onClick(() => {
            this.editor?.paste();
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

  public openImagePickerModal(canvasPoint?: Point): void {
    const vaultImages = this.app.vault.getFiles().filter((f: TFile) => isImageFile(f));
    if (vaultImages.length > 0) {
      new ImageSuggestModal(this.app, (file: TFile) => {
        void this.addImageToCanvas({ file, canvasPoint });
      }).open();
    } else {
      this.openLocalImageFileDialog(canvasPoint);
    }
  }

  public openLocalImageFileDialog(canvasPoint?: Point): void {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file && typeof FileReader !== "undefined") {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          void this.addImageToCanvas({
            src: dataUrl,
            title: file.name.replace(/\.[^/.]+$/, ""),
            canvasPoint,
          });
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
          src = this.app.vault.getResourcePath(options.file);
        } else {
          src = options.file.path;
        }
      } catch {
        src = options.file.path;
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

  private async loadVaultNotesContent(): Promise<void> {
    if (!this.editor) return;
    const noteNodes = this.editor.diagram.nodes.filter(
      (n) => n.kind === "obsidian.note" || Boolean(n.metadata?.filePath)
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

    const oldBasename = oldPath.split("/").pop()?.replace(/\.md$/, "") ?? "";
    for (const node of matchingNodes) {
      const newLabels = node.labels.map((l) =>
        l.text === oldBasename ? { ...l, text: file.basename } : l
      );
      this.editor.updateNode(node.id, {
        metadata: {
          ...node.metadata,
          filePath: file.path,
        },
        customData: {
          ...node.customData,
          filePath: file.path,
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
