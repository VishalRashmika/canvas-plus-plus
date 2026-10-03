import { Plugin, TFolder, TFile, Notice } from "obsidian";
import { UmlCanvasView } from "./presentation/views/UmlCanvasView";
import { UmlCanvasSettingTab } from "./presentation/views/UmlCanvasSettingTab";
import {
  UmlCanvasSettings,
  DEFAULT_SETTINGS,
} from "./infrastructure/obsidian/PluginSettings";
import { createDiagram } from "./domain/entities/Diagram";
import { JsonCanvasSerializer } from "./infrastructure/persistence/JsonCanvasSerializer";
import { ObsidianFileSystem } from "./infrastructure/obsidian/ObsidianFileSystem";
import { FileDiagramRepository } from "./infrastructure/persistence/FileDiagramRepository";
import { ApplyExternalPatch } from "./application/use-cases/ApplyExternalPatch";
import { FileWatcherBridge } from "./infrastructure/cli-bridge/FileWatcherBridge";
import { ExportForRAG } from "./application/use-cases/ExportForRAG";

/**
 * Composition root — see docs/01-ARCHITECTURE.md.
 *
 * This is the ONLY file allowed to new up concrete infrastructure classes
 * and wire them into application use-cases, then hand those to presentation
 * views. Domain and application code must never import from "obsidian".
 */

export const VIEW_TYPE_UML_CANVAS = "uml-canvas-view";

export default class CanvasPlusPlusPlugin extends Plugin {
  settings: UmlCanvasSettings = DEFAULT_SETTINGS;
  private serializer = new JsonCanvasSerializer();
  private fileWatcherBridge: FileWatcherBridge | null = null;
  private fs: ObsidianFileSystem | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // F-001: Register custom view for .canvuspp files (supports .canvaspp and legacy .umlcanvas)
    this.registerView(
      VIEW_TYPE_UML_CANVAS,
      (leaf) => new UmlCanvasView(leaf, this)
    );
    this.registerExtensions(["canvuspp", "canvaspp", "umlcanvas"], VIEW_TYPE_UML_CANVAS);

    // Customize File Explorer tag badges to show "CANVAS++"
    this.patchFileExplorerTags();

    // F-090: Register settings tab
    this.addSettingTab(new UmlCanvasSettingTab(this.app, this));

    // F-091: Register ribbon icon
    this.addRibbonIcon("git-fork", "Create UML diagram", async () => {
      await this.createNewDiagramFile(
        this.settings.defaultDiagramType || "uml.class",
        "Untitled UML Diagram"
      );
    });

    // F-091: Register command palette entries
    this.addCommand({
      id: "create-uml-diagram",
      name: "Create UML diagram",
      callback: async () => {
        await this.createNewDiagramFile(
          this.settings.defaultDiagramType || "uml.class",
          "Untitled UML Diagram"
        );
      },
    });

    this.addCommand({
      id: "create-schematic",
      name: "Create schematic",
      callback: async () => {
        await this.createNewDiagramFile("schematic", "Untitled Schematic");
      },
    });

    this.addCommand({
      id: "define-custom-chip",
      name: "Define custom chip",
      checkCallback: (checking: boolean) => {
        const activeView = this.app.workspace.getActiveViewOfType(UmlCanvasView);
        if (activeView && activeView.diagramEditor) {
          if (!checking) {
            activeView.openChipDefinitionModal();
          }
          return true;
        }
        return false;
      },
    });

    // F-084: Register command palette entry to export active diagram for RAG
    this.addCommand({
      id: "export-diagram-for-rag",
      name: "Export active diagram for RAG",
      checkCallback: (checking: boolean) => {
        const activeView = this.app.workspace.getActiveViewOfType(UmlCanvasView);
        if (activeView && activeView.diagramEditor) {
          if (!checking) {
            void this.exportActiveDiagramForRAG(activeView);
          }
          return true;
        }
        return false;
      },
    });

    // Right-click context menu in File Explorer (on folder or file)
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        const targetFolder =
          file instanceof TFolder
            ? file
            : file instanceof TFile && file.parent instanceof TFolder
            ? file.parent
            : undefined;

        menu.addItem((item) => {
          item
            .setTitle("New UML canvas")
            .setIcon("git-fork")
            .onClick(async () => {
              await this.createNewDiagramFile(
                this.settings.defaultDiagramType || "uml.class",
                "Untitled UML Diagram",
                targetFolder
              );
            });
        });

        menu.addItem((item) => {
          item
            .setTitle("New schematic canvas")
            .setIcon("cpu")
            .onClick(async () => {
              await this.createNewDiagramFile(
                "schematic",
                "Untitled Schematic",
                targetFolder
              );
            });
        });
      })
    );

    // Right-click context menu with multi-select in File Explorer
    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files) => {
        const first = files[0];
        const targetFolder =
          first instanceof TFolder
            ? first
            : first instanceof TFile && first.parent instanceof TFolder
            ? first.parent
            : undefined;

        menu.addItem((item) => {
          item
            .setTitle("New UML canvas")
            .setIcon("git-fork")
            .onClick(async () => {
              await this.createNewDiagramFile(
                this.settings.defaultDiagramType || "uml.class",
                "Untitled UML Diagram",
                targetFolder
              );
            });
        });
      })
    );

    this.fs = new ObsidianFileSystem(this.app.vault);
    const diagramRepo = new FileDiagramRepository(
      this.fs,
      (id) =>
        id.endsWith(".canvuspp") ||
        id.endsWith(".canvaspp") ||
        id.endsWith(".umlcanvas")
          ? id
          : `${id}.canvuspp`,
      this.serializer
    );
    const applyExternalPatch = new ApplyExternalPatch(diagramRepo);

    // F-081: Initialize CLI FileWatcherBridge
    this.fileWatcherBridge = new FileWatcherBridge({
      fs: this.fs,
      patchesDir: ".umlcanvas-patches",
      patchHandler: async (patch) => {
        return applyExternalPatch.apply(patch);
      },
      onHotReload: (diagramId) => {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_UML_CANVAS);
        for (const leaf of leaves) {
          const view = leaf.view as UmlCanvasView;
          if (view && (view.diagramId === diagramId || view.file?.path === diagramId)) {
            void view.reloadFromDisk();
          }
        }
      },
    });

    if (this.settings.enableCliBridge) {
      void this.fileWatcherBridge.start();
    }
  }

  async loadSettings(): Promise<void> {
    const loadedData = (await this.loadData()) as Partial<UmlCanvasSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);

    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_UML_CANVAS);
    for (const leaf of leaves) {
      const view = leaf.view as UmlCanvasView;
      if (view && typeof view.updateSettings === "function") {
        view.updateSettings(this.settings);
      }
    }

    if (this.settings.enableCliBridge) {
      if (this.fileWatcherBridge) {
        void this.fileWatcherBridge.start();
      }
    } else {
      if (this.fileWatcherBridge) {
        this.fileWatcherBridge.stop();
      }
    }
  }

  async createNewDiagramFile(
    diagramType: string,
    defaultNamePrefix = "Untitled Diagram",
    targetFolder?: TFolder | string
  ): Promise<void> {
    // Determine target folder (explicit target, active folder, or root)
    let folderPath = "";
    if (targetFolder instanceof TFolder) {
      folderPath = targetFolder.path === "/" ? "" : targetFolder.path;
    } else if (typeof targetFolder === "string") {
      folderPath = targetFolder === "/" ? "" : targetFolder;
    } else {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && activeFile.parent) {
        folderPath = activeFile.parent.path === "/" ? "" : activeFile.parent.path;
      } else {
        const rootFolder = this.app.fileManager.getNewFileParent("");
        if (rootFolder instanceof TFolder && rootFolder.path !== "/") {
          folderPath = rootFolder.path;
        }
      }
    }

    // Resolve unique file name (.canvuspp extension)
    let fileName = `${defaultNamePrefix}.canvuspp`;
    let counter = 1;
    const makeFullPath = (name: string) =>
      folderPath ? `${folderPath}/${name}` : name;

    while (this.app.vault.getAbstractFileByPath(makeFullPath(fileName))) {
      fileName = `${defaultNamePrefix} ${counter}.canvuspp`;
      counter++;
    }

    const fullPath = makeFullPath(fileName);
    const diagramTitle = fileName.replace(/\.(canvuspp|canvaspp|umlcanvas)$/, "");

    const newDiagram = createDiagram({
      id: `diag-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      diagramType,
      title: diagramTitle,
    });

    const fileContent = this.serializer.serialize(newDiagram, true);
    const createdFile = await this.app.vault.create(fullPath, fileContent);

    // Open file in active or new leaf
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(createdFile);
  }

  async exportActiveDiagramForRAG(view: UmlCanvasView): Promise<void> {
    if (!this.fs) return;
    const editor = view.diagramEditor;
    if (!editor) return;

    try {
      const ragExporter = new ExportForRAG(undefined, this.fs);
      const result = await ragExporter.exportToFile(editor.diagram, {
        ragDir: ".umlcanvas-rag",
      });
      new Notice(`Exported diagram for RAG: ${result.path}`);
    } catch (err) {
      new Notice(`Failed to export diagram for RAG: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private patchFileExplorerTags(): void {
    const updateTags = () => {
      const leaves = this.app.workspace.getLeavesOfType("file-explorer");
      for (const leaf of leaves) {
        const container = leaf.view?.containerEl;
        if (!container) continue;
        const items = container.querySelectorAll<HTMLElement>(".nav-file-title, .tree-item-self");
        items.forEach((titleEl) => {
          const path = (titleEl.getAttribute("data-path") || "").toLowerCase();
          if (
            path.endsWith(".canvuspp") ||
            path.endsWith(".canvaspp") ||
            path.endsWith(".umlcanvas")
          ) {
            const tag = titleEl.querySelector<HTMLElement>(".nav-file-tag");
            if (tag && tag.textContent !== "CANVAS++") {
              tag.textContent = "CANVAS++";
            }
          }
        });
      }
    };

    this.app.workspace.onLayoutReady(() => {
      updateTags();
      const leaves = this.app.workspace.getLeavesOfType("file-explorer");
      for (const leaf of leaves) {
        const container = leaf.view?.containerEl;
        if (container) {
          const observer = new MutationObserver(() => updateTags());
          observer.observe(container, { childList: true, subtree: true });
          this.register(() => observer.disconnect());
        }
      }
    });

    this.registerEvent(this.app.vault.on("create", () => window.setTimeout(updateTags, 50)));
    this.registerEvent(this.app.vault.on("rename", () => window.setTimeout(updateTags, 50)));
    this.registerEvent(this.app.workspace.on("layout-change", () => updateTags()));
  }

  onunload(): void {
    if (this.fileWatcherBridge) {
      this.fileWatcherBridge.stop();
      this.fileWatcherBridge = null;
    }
  }
}
