import { TextFileView, WorkspaceLeaf, Menu, TFile, MarkdownRenderer, Platform, App } from "obsidian";
import type CanvasPlusPlusPlugin from "../../main";
import { VIEW_TYPE_UML_CANVAS } from "../../main";
import { Diagram, createDiagram } from "../../domain/entities/Diagram";
import { DiagramNode } from "../../domain/entities/DiagramNode";
import { DiagramEdge } from "../../domain/entities/DiagramEdge";
import { Group } from "../../domain/entities/Group";
import { Point } from "../../domain/value-objects/Point";
import { DiagramEditor } from "../../application/use-cases/DiagramEditor";
import { AutosaveCoordinator } from "../../application/use-cases/AutosaveCoordinator";
import { JsonCanvasSerializer } from "../../infrastructure/persistence/JsonCanvasSerializer";
import { SvgSceneRenderer } from "../renderer/SvgSceneRenderer";
import { Toolbar } from "./Toolbar";
import { PalettePanel } from "./PalettePanel";
import { MinimapView } from "./MinimapView";
import { NoteSuggestModal } from "./NoteSuggestModal";
import { ChipDefinitionModal } from "./ChipDefinitionModal";
import { ChipInterfaceDefinition } from "../../domain/entities/ChipInterfaceDefinition";
import { defaultCustomChipRegistry } from "../../domain/services/CustomChipRegistry";
import { Stroke } from "../../domain/services/ShapeRecognizer";
import { UmlCanvasSettings } from "../../infrastructure/obsidian/PluginSettings";
import { CANVAS_COLOR_PRESETS } from "../../domain/value-objects/CanvasColor";

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
  }

  getViewType(): string {
    return VIEW_TYPE_UML_CANVAS;
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
        diagramType: this.plugin.settings.defaultDiagramType || "uml.class",
        title: this.file ? this.file.basename : "New Diagram",
      });
    } else {
      try {
        diagram = this.serializer.deserialize(trimmed);
      } catch {
        // Fallback for corrupted/invalid files
        diagram = createDiagram({
          id: this.file ? this.file.path : `diag-${Date.now()}`,
          diagramType: this.plugin.settings.defaultDiagramType || "uml.class",
          title: this.file ? this.file.basename : "Recovered Diagram",
        });
      }
    }

    this.initializeView(diagram);
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
    const svgContainer = this.rootEl.createDiv({ cls: "umlcanvas-svg-container" });

    this.editor = new DiagramEditor(diagram);

    // Setup debounced autosave via Obsidian's requestSave
    this.autosaveCoordinator = new AutosaveCoordinator(
      this.editor,
      async () => {
        this.requestSave();
      },
      this.plugin.settings.autosaveDelayMs
    );

    // Setup SVG Renderer
    this.renderer = new SvgSceneRenderer(svgContainer, this.editor, {
      showGrid: this.plugin.settings.showGrid,
      enableFreehand: this.plugin.settings.enableFreehand,
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
      onStrokeComplete: (stroke) => {
        if (!this.editor) return;
        const result = this.editor.snapStrokeToShape(stroke);
        if (result) {
          this.showFreehandEscapeHatch(stroke);
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
          await this.addNoteToCanvas(file, canvasPoint);
          return true;
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
      }
    );

    // Setup Copy / Paste (F-012) and Minimap (F-011) shortcuts
    this.rootEl.addEventListener("keydown", (e: KeyboardEvent) => {
      const isMac = Platform.isMacOS;
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        this.editor?.copySelection();
      } else if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        this.editor?.paste();
      } else if (!mod && (e.key === "m" || e.key === "M")) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          e.preventDefault();
          this.minimap?.toggle();
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
    if (this.renderer) {
      this.renderer.setEnableFreehand(settings.enableFreehand);
      this.renderer.setGridVisible(settings.showGrid);
    }
    if (this.toolbar) {
      this.toolbar.setFreehandEnabled(settings.enableFreehand);
    }
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

      menu.addSeparator();

      menu.addItem((item) => {
        item
          .setTitle("Color: Default (None)")
          .setIcon("rotate-ccw")
          .onClick(() => {
            this.editor?.setColorForSelection(undefined);
          });
      });

      for (const preset of CANVAS_COLOR_PRESETS) {
        menu.addItem((item) => {
          item
            .setTitle(`Color: ${preset.label} (${preset.id})`)
            .setIcon("palette")
            .onClick(() => {
              this.editor?.setColorForSelection(preset.id);
            });
        });
      }

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

      menu.addItem((item) => {
        item
          .setTitle("Color: Default (None)")
          .setIcon("rotate-ccw")
          .onClick(() => {
            this.editor?.setColorForSelection(undefined);
          });
      });

      for (const preset of CANVAS_COLOR_PRESETS) {
        menu.addItem((item) => {
          item
            .setTitle(`Color: ${preset.label} (${preset.id})`)
            .setIcon("palette")
            .onClick(() => {
              this.editor?.setColorForSelection(preset.id);
            });
        });
      }

      menu.addSeparator();

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

      menu.addItem((item) => {
        item
          .setTitle("Color: Default (None)")
          .setIcon("rotate-ccw")
          .onClick(() => {
            this.editor?.setColorForSelection(undefined);
          });
      });

      for (const preset of CANVAS_COLOR_PRESETS) {
        menu.addItem((item) => {
          item
            .setTitle(`Color: ${preset.label} (${preset.id})`)
            .setIcon("palette")
            .onClick(() => {
              this.editor?.setColorForSelection(preset.id);
            });
        });
      }

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
    this.clear();
    await super.onClose();
  }
}
