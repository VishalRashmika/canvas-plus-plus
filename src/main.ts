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

  ribbonIconEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register custom view for all Canvas++ files (.canvas++, .canvuspp, .canvaspp, etc.)
    this.registerView(
      VIEW_TYPE_UML_CANVAS,
      (leaf) => new UmlCanvasView(leaf, this)
    );
    const supportedExtensions = [
      "canvas++",
      "canvuspp",
      "canvaspp",
      "canvasplusplus",
      "canvas-plus-plus",
      "canvpp",
      "canv",
      "umlcanvas",
    ];

    for (const ext of supportedExtensions) {
      try {
        this.registerExtensions([ext], VIEW_TYPE_UML_CANVAS);
      } catch (err) {
        console.warn(`[Canvas++] Could not register extension .${ext}:`, err);
      }
    }

    // Attempt to register 'canvas' only if not already claimed by Obsidian core or another plugin
    try {
      const viewRegistry = (this.app as any)?.viewRegistry;
      const isCanvasClaimed = Boolean(
        viewRegistry?.typeByExtension && viewRegistry.typeByExtension["canvas"]
      );
      if (!isCanvasClaimed) {
        this.registerExtensions(["canvas"], VIEW_TYPE_UML_CANVAS);
      }
    } catch (err) {
      console.warn("[Canvas++] Could not register extension .canvas:", err);
    }

    // Customize File Explorer tag badges to show "CANVAS++"
    this.patchFileExplorerTags();

    // F-090: Register settings tab
    this.addSettingTab(new UmlCanvasSettingTab(this.app, this));

    // Register ribbon icon for Canvas++ in Obsidian's left sidebar
    this.ribbonIconEl = this.addRibbonIcon(
      "layout-dashboard",
      "Create new Canvas++",
      async () => {
        const selectedDir = this.getSelectedDirectory();
        await this.createNewDiagramFile(
          this.settings.defaultDiagramType || "general",
          "Untitled Diagram",
          selectedDir ?? undefined
        );
      }
    );

    // F-091: Register command palette entries
    this.addCommand({
      id: "create-canvas-plus-plus",
      name: "Create Canvas++",
      callback: async () => {
        await this.createNewDiagramFile(
          this.settings.defaultDiagramType || "general",
          "Untitled Diagram"
        );
      },
    });

    this.addCommand({
      id: "create-diagram",
      name: "Create diagram",
      callback: async () => {
        await this.createNewDiagramFile(
          this.settings.defaultDiagramType || "general",
          "Untitled Diagram"
        );
      },
    });

    this.addCommand({
      id: "create-uml-diagram",
      name: "Create UML diagram",
      callback: async () => {
        await this.createNewDiagramFile(
          this.settings.defaultDiagramType || "general",
          "Untitled Diagram"
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

    // Register command palette entry to toggle canvas theme (Light / Dark)
    this.addCommand({
      id: "toggle-canvas-theme",
      name: "Toggle canvas theme (Light / Dark)",
      callback: async () => {
        let isCurrentlyLight = this.settings.theme === "light";
        if (this.settings.theme === "system") {
          isCurrentlyLight =
            typeof document !== "undefined" &&
            Boolean(document.body?.classList?.contains("theme-light"));
        }
        const nextTheme = isCurrentlyLight ? "dark" : "light";
        this.settings.theme = nextTheme;
        await this.saveSettings();
        new Notice(`Canvas++ theme set to ${nextTheme === "light" ? "Pastel Light" : "Dark"}`);
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
            .setTitle("New Canvas++")
            .setIcon("layout-dashboard")
            .onClick(async () => {
              await this.createNewDiagramFile(
                this.settings.defaultDiagramType || "general",
                "Untitled Diagram",
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
            .setTitle("New Canvas++")
            .setIcon("layout-dashboard")
            .onClick(async () => {
              await this.createNewDiagramFile(
                this.settings.defaultDiagramType || "general",
                "Untitled Diagram",
                targetFolder
              );
            });
        });
      })
    );

    this.fs = new ObsidianFileSystem(this.app.vault);
    const diagramRepo = new FileDiagramRepository(
      this.fs,
      (id) => {
        const lower = id.toLowerCase();
        if (
          lower.endsWith(".canvuspp") ||
          lower.endsWith(".canvaspp") ||
          lower.endsWith(".canvas") ||
          lower.endsWith(".canvas++") ||
          lower.endsWith(".canvasplusplus") ||
          lower.endsWith(".canvas-plus-plus") ||
          lower.endsWith(".canvpp") ||
          lower.endsWith(".canv") ||
          lower.endsWith(".umlcanvas")
        ) {
          return id;
        }
        return `${id}.canvuspp`;
      },
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
    try {
      const loadedData = (await this.loadData()) as Partial<UmlCanvasSettings> | null;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData ?? {});
    } catch (err) {
      console.warn("[Canvas++] Failed to load settings, using defaults:", err);
      this.settings = Object.assign({}, DEFAULT_SETTINGS);
    }
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

  getSelectedDirectory(): TFolder | null {
    const isFolder = (obj: any): obj is TFolder => {
      if (!obj) return false;
      if (obj instanceof TFolder) return true;
      if (obj instanceof TFile) return false;
      if (typeof obj.extension === "string" && obj.extension.length > 0) return false;
      if (
        obj.children !== undefined ||
        obj.constructor?.name === "TFolder" ||
        typeof obj.isRoot === "function"
      ) {
        return true;
      }
      return false;
    };

    const resolveFolderFromPath = (path: string): TFolder | null => {
      if (typeof path !== "string") return null;
      const cleanPath = path === "/" ? "" : path.replace(/\/+$/, "");
      const abstractFile = this.app.vault.getAbstractFileByPath(cleanPath || "/");
      if (isFolder(abstractFile)) return abstractFile;
      const fileWithoutSlash = this.app.vault.getAbstractFileByPath(cleanPath);
      if (isFolder(fileWithoutSlash)) return fileWithoutSlash;
      const folder = new TFolder();
      folder.path = cleanPath;
      folder.name = cleanPath.split("/").pop() || "";
      return folder;
    };

    // 1. Check workspace leaves for 'file-explorer'
    const leaves = this.app.workspace.getLeavesOfType("file-explorer");
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (!view) continue;

      // 1a. Explicit selectedDirectory or selectedFolder property on view
      if (isFolder(view.selectedDirectory)) return view.selectedDirectory;
      if (isFolder(view.selectedFolder)) return view.selectedFolder;
      if (typeof view.selectedDirectory === "string") {
        const folder = resolveFolderFromPath(view.selectedDirectory);
        if (folder) return folder;
      }
      if (typeof view.selectedFolder === "string") {
        const folder = resolveFolderFromPath(view.selectedFolder);
        if (folder) return folder;
      }

      // 1b. view.selectedFile (if it is a folder)
      if (isFolder(view.selectedFile)) {
        return view.selectedFile;
      }

      // 1c. view.selectedFiles or view.tree?.selectedFiles
      const selectedFiles = view.selectedFiles || (view.tree && view.tree.selectedFiles);
      if (Array.isArray(selectedFiles) && selectedFiles.length > 0) {
        for (const item of selectedFiles) {
          const file = isFolder(item) ? item : item?.file;
          if (isFolder(file)) return file;
        }
      }

      // 1d. view.selectedItems (Set or Array)
      if (view.selectedItems) {
        const items =
          view.selectedItems instanceof Set
            ? Array.from(view.selectedItems)
            : Array.isArray(view.selectedItems)
            ? view.selectedItems
            : [];
        for (const item of items) {
          const file = isFolder(item) ? item : (item as any)?.file;
          if (isFolder(file)) return file;
        }
      }

      // 1e. view.tree (focusedItem / selectedItem / activeItem)
      if (view.tree) {
        const treeItem =
          view.tree.focusedItem || view.tree.selectedItem || view.tree.activeItem;
        if (treeItem) {
          const file = isFolder(treeItem) ? treeItem : treeItem?.file;
          if (isFolder(file)) return file;
        }
      }

      // 1f. view.activeItem (if folder or has .file as folder)
      if (isFolder(view.activeItem)) {
        return view.activeItem;
      }
      if (isFolder(view.activeItem?.file)) {
        return view.activeItem.file;
      }

      // 1g. view.fileItems (Map or Record)
      if (view.fileItems) {
        const items =
          view.fileItems instanceof Map
            ? Array.from(view.fileItems.values())
            : typeof view.fileItems === "object"
            ? Object.values(view.fileItems)
            : [];
        for (const item of items as any[]) {
          if (item?.isFocused || item?.isSelected || item?.selected || item?.active) {
            const file = isFolder(item) ? item : item?.file;
            if (isFolder(file)) return file;
          }
        }
      }

      // 1h. DOM container inspection
      if (view.containerEl && typeof view.containerEl.querySelectorAll === "function") {
        const activeEls = view.containerEl.querySelectorAll(
          ".nav-folder.is-active, .nav-folder.is-selected, .nav-folder-title.is-active, .nav-folder-title.is-selected, .tree-item.is-selected, .tree-item-self.is-selected, .tree-item-self.is-active"
        );
        for (const el of Array.from(activeEls) as HTMLElement[]) {
          let dataPath = el.getAttribute("data-path");
          if (!dataPath) {
            const titleEl = el.querySelector(".nav-folder-title, .tree-item-self, [data-path]");
            if (titleEl) {
              dataPath = titleEl.getAttribute("data-path");
            }
          }
          if (dataPath) {
            const file = this.app.vault.getAbstractFileByPath(dataPath);
            if (isFolder(file)) {
              return file;
            }
          }
        }
      }
    }

    // 2. Fallback: app.workspace properties (e.g. if set by mocks or plugins)
    const ws = this.app.workspace as any;
    if (isFolder(ws.selectedDirectory)) return ws.selectedDirectory;
    if (isFolder(ws.selectedFolder)) return ws.selectedFolder;

    return null;
  }

  async createNewDiagramFile(
    diagramType = "general",
    defaultNamePrefix = "Untitled Diagram",
    targetFolder?: TFolder | string | null
  ): Promise<void> {
    // Determine target folder (explicit target, selected directory, or root)
    let folderPath = "";
    if (targetFolder instanceof TFolder) {
      folderPath = targetFolder.path === "/" ? "" : targetFolder.path;
    } else if (typeof targetFolder === "string" && targetFolder !== "/") {
      folderPath = targetFolder;
    } else if (targetFolder === "/") {
      folderPath = "";
    } else if (targetFolder === null) {
      folderPath = "";
    } else {
      const selectedDir = this.getSelectedDirectory();
      if (selectedDir) {
        folderPath = selectedDir.path === "/" ? "" : selectedDir.path;
      } else {
        folderPath = "";
      }
    }

    if (folderPath) {
      folderPath = folderPath.replace(/\/+$/, "");
      if (folderPath === "/") {
        folderPath = "";
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
    const diagramTitle = fileName.replace(
      /\.(canvuspp|canvaspp|canvas\+\+|canvasplusplus|canvas-plus-plus|canvpp|canv|canvas|umlcanvas)$/i,
      ""
    );

    const newDiagram = createDiagram({
      id: `diag-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      diagramType,
      title: diagramTitle,
    });

    const fileContent = this.serializer.serialize(newDiagram, true);
    const createdFile = await this.app.vault.create(fullPath, fileContent);

    // Open file in active or new leaf
    const leaf =
      this.app.workspace.getLeaf(false) ??
      (typeof this.app.workspace.getLeaf === "function" ? this.app.workspace.getLeaf(true) : null);
    const fileToOpen =
      createdFile instanceof TFile
        ? createdFile
        : (this.app.vault.getAbstractFileByPath(fullPath) as TFile | null) ?? createdFile;
    if (leaf && typeof leaf.openFile === "function") {
      try {
        await leaf.openFile(fileToOpen);
      } catch (err) {
        console.error("Failed to open file in active leaf, trying new leaf:", err);
        try {
          const freshLeaf = this.app.workspace.getLeaf(true);
          if (freshLeaf && typeof freshLeaf.openFile === "function") {
            await freshLeaf.openFile(fileToOpen);
          }
        } catch (leafErr) {
          console.error("Fallback getLeaf(true) also failed:", leafErr);
        }
      }
    }
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
      try {
        const leaves = this.app?.workspace?.getLeavesOfType?.("file-explorer") ?? [];
        for (const leaf of leaves) {
          const container = leaf.view?.containerEl;
          if (!container) continue;
          const items = container.querySelectorAll<HTMLElement>(".nav-file-title, .tree-item-self");
          items.forEach((titleEl) => {
            const path = (titleEl.getAttribute("data-path") || "").toLowerCase();
            if (
              path.endsWith(".canvuspp") ||
              path.endsWith(".canvaspp") ||
              path.endsWith(".canvas") ||
              path.endsWith(".canvas++") ||
              path.endsWith(".canvasplusplus") ||
              path.endsWith(".canvas-plus-plus") ||
              path.endsWith(".canvpp") ||
              path.endsWith(".canv") ||
              path.endsWith(".umlcanvas")
            ) {
              const tag = titleEl.querySelector<HTMLElement>(".nav-file-tag");
              if (tag && tag.textContent !== "CANVAS++") {
                tag.textContent = "CANVAS++";
              }
            }
          });
        }
      } catch (err) {
        console.warn("[Canvas++] Error updating file explorer tags:", err);
      }
    };

    try {
      if (this.app?.workspace?.onLayoutReady) {
        this.app.workspace.onLayoutReady(() => {
          updateTags();
          try {
            const leaves = this.app.workspace.getLeavesOfType("file-explorer");
            for (const leaf of leaves) {
              const container = leaf.view?.containerEl;
              if (container && typeof MutationObserver !== "undefined") {
                const observer = new MutationObserver(() => updateTags());
                observer.observe(container, { childList: true, subtree: true });
                this.register(() => observer.disconnect());
              }
            }
          } catch (err) {
            console.warn("[Canvas++] Error setting up MutationObserver for file explorer tags:", err);
          }
        });
      }

      if (this.app?.vault?.on) {
        this.registerEvent(this.app.vault.on("create", () => setTimeout(updateTags, 50)));
        this.registerEvent(this.app.vault.on("rename", () => setTimeout(updateTags, 50)));
      }
      if (this.app?.workspace?.on) {
        this.registerEvent(this.app.workspace.on("layout-change", () => updateTags()));
      }
    } catch (err) {
      console.warn("[Canvas++] Error registering layout events:", err);
    }
  }

  onunload(): void {
    if (this.fileWatcherBridge) {
      try {
        this.fileWatcherBridge.stop();
      } catch (err) {
        console.warn("[Canvas++] Error stopping fileWatcherBridge:", err);
      }
      this.fileWatcherBridge = null;
    }
  }
}
