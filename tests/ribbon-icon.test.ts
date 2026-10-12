import CanvasPlusPlusPlugin from "../src/main";
import { App, TFile, TFolder } from "./fakes/MockObsidian";

describe("Obsidian Left Sidebar Ribbon Icon Tests", () => {
  let app: App;
  let plugin: CanvasPlusPlusPlugin;

  beforeEach(async () => {
    app = new App();
    plugin = new CanvasPlusPlusPlugin(app as any, { id: "canvas-plus-plus", name: "Canvas++" } as any);
    await plugin.onload();
  });

  describe("Ribbon Icon Registration", () => {
    it("should register a ribbon icon in Obsidian's left sidebar", () => {
      expect((plugin as any).ribbonIcons).toHaveLength(1);
    });

    it("should use 'layout-dashboard' icon to match native Obsidian canvas", () => {
      const ribbon = (plugin as any).ribbonIcons[0];
      expect(ribbon.icon).toBe("layout-dashboard");
    });

    it("should have a title creating new Canvas++ documents", () => {
      const ribbon = (plugin as any).ribbonIcons[0];
      expect(ribbon.title).toBe("Create new Canvas++");
    });

    it("should assign ribbonIconEl on the plugin instance", () => {
      expect(plugin.ribbonIconEl).toBeDefined();
    });
  });

  describe("Directory Resolution when Clicked", () => {
    it("should create new Canvas++ in the selected directory when a folder is selected via selectedFolder", async () => {
      const folder = new TFolder();
      folder.path = "Diagrams";
      folder.name = "Diagrams";

      const fileExplorerView = {
        selectedFolder: folder,
      };

      app.workspace.getLeavesOfType = (type: string) => {
        if (type === "file-explorer") {
          return [{ view: fileExplorerView }];
        }
        return [];
      };

      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue({ path: "Diagrams/Untitled Diagram.canvuspp" });
      const openFileSpy = jest.fn();
      app.workspace.getLeaf = () => ({ openFile: openFileSpy });

      const ribbon = (plugin as any).ribbonIcons[0];
      await ribbon.callback();

      expect(createSpy).toHaveBeenCalledWith(
        "Diagrams/Untitled Diagram.canvuspp",
        expect.any(String)
      );
      expect(openFileSpy).toHaveBeenCalledWith({ path: "Diagrams/Untitled Diagram.canvuspp" });
    });

    it("should create new Canvas++ in the selected directory when a folder is selected via selectedDirectory", async () => {
      const folder = new TFolder();
      folder.path = "Projects/Canvas";
      folder.name = "Canvas";

      const fileExplorerView = {
        selectedDirectory: folder,
      };

      app.workspace.getLeavesOfType = (type: string) => {
        if (type === "file-explorer") {
          return [{ view: fileExplorerView }];
        }
        return [];
      };

      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue({ path: "Projects/Canvas/Untitled Diagram.canvuspp" });

      const ribbon = (plugin as any).ribbonIcons[0];
      await ribbon.callback();

      expect(createSpy).toHaveBeenCalledWith(
        "Projects/Canvas/Untitled Diagram.canvuspp",
        expect.any(String)
      );
    });

    it("should create new Canvas++ in the selected directory when a folder path string is provided", async () => {
      const folder = new TFolder();
      folder.path = "Work/Architecture";
      folder.name = "Architecture";
      app.vault._files.set("Work/Architecture", folder);

      const fileExplorerView = {
        selectedFolder: "Work/Architecture",
      };

      app.workspace.getLeavesOfType = (type: string) => {
        if (type === "file-explorer") {
          return [{ view: fileExplorerView }];
        }
        return [];
      };

      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue({ path: "Work/Architecture/Untitled Diagram.canvuspp" });

      const ribbon = (plugin as any).ribbonIcons[0];
      await ribbon.callback();

      expect(createSpy).toHaveBeenCalledWith(
        "Work/Architecture/Untitled Diagram.canvuspp",
        expect.any(String)
      );
    });

    it("should resolve selected directory from selectedItems Set containing a TFolder", async () => {
      const folder = new TFolder();
      folder.path = "Deep/Nested/Folder";
      folder.name = "Folder";

      const fileExplorerView = {
        selectedItems: new Set([{ file: folder }]),
      };

      app.workspace.getLeavesOfType = (type: string) => {
        if (type === "file-explorer") {
          return [{ view: fileExplorerView }];
        }
        return [];
      };

      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue({ path: "Deep/Nested/Folder/Untitled Diagram.canvuspp" });

      const ribbon = (plugin as any).ribbonIcons[0];
      await ribbon.callback();

      expect(createSpy).toHaveBeenCalledWith(
        "Deep/Nested/Folder/Untitled Diagram.canvuspp",
        expect.any(String)
      );
    });

    it("should resolve selected directory from tree.focusedItem", async () => {
      const folder = new TFolder();
      folder.path = "Team/Sprint";
      folder.name = "Sprint";

      const fileExplorerView = {
        tree: {
          focusedItem: { file: folder },
        },
      };

      app.workspace.getLeavesOfType = (type: string) => {
        if (type === "file-explorer") {
          return [{ view: fileExplorerView }];
        }
        return [];
      };

      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue({ path: "Team/Sprint/Untitled Diagram.canvuspp" });

      const ribbon = (plugin as any).ribbonIcons[0];
      await ribbon.callback();

      expect(createSpy).toHaveBeenCalledWith(
        "Team/Sprint/Untitled Diagram.canvuspp",
        expect.any(String)
      );
    });

    it("should resolve selected directory from fileItems map with focused item", async () => {
      const folder = new TFolder();
      folder.path = "Client/Proposals";
      folder.name = "Proposals";

      const fileExplorerView = {
        fileItems: {
          "Client/Proposals": {
            isFocused: true,
            file: folder,
          },
        },
      };

      app.workspace.getLeavesOfType = (type: string) => {
        if (type === "file-explorer") {
          return [{ view: fileExplorerView }];
        }
        return [];
      };

      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue({ path: "Client/Proposals/Untitled Diagram.canvuspp" });

      const ribbon = (plugin as any).ribbonIcons[0];
      await ribbon.callback();

      expect(createSpy).toHaveBeenCalledWith(
        "Client/Proposals/Untitled Diagram.canvuspp",
        expect.any(String)
      );
    });

    it("should resolve selected directory from DOM with active folder element", async () => {
      const folder = new TFolder();
      folder.path = "ActiveFromDOM";
      folder.name = "ActiveFromDOM";
      app.vault._files.set("ActiveFromDOM", folder);

      const mockEl = {
        getAttribute: (attr: string) => (attr === "data-path" ? "ActiveFromDOM" : null),
        querySelector: () => null,
      };

      const fileExplorerView = {
        containerEl: {
          querySelectorAll: () => [mockEl],
        },
      };

      app.workspace.getLeavesOfType = (type: string) => {
        if (type === "file-explorer") {
          return [{ view: fileExplorerView }];
        }
        return [];
      };

      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue({ path: "ActiveFromDOM/Untitled Diagram.canvuspp" });

      const ribbon = (plugin as any).ribbonIcons[0];
      await ribbon.callback();

      expect(createSpy).toHaveBeenCalledWith(
        "ActiveFromDOM/Untitled Diagram.canvuspp",
        expect.any(String)
      );
    });
  });

  describe("Fallback to Root Directory", () => {
    it("should create new Canvas++ in the root directory if NO directory is selected", async () => {
      // Empty file explorer view with no selected folder
      const fileExplorerView = {
        selectedFolder: null,
        selectedDirectory: null,
      };

      app.workspace.getLeavesOfType = (type: string) => {
        if (type === "file-explorer") {
          return [{ view: fileExplorerView }];
        }
        return [];
      };

      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue({ path: "Untitled Diagram.canvuspp" });

      const ribbon = (plugin as any).ribbonIcons[0];
      await ribbon.callback();

      expect(createSpy).toHaveBeenCalledWith(
        "Untitled Diagram.canvuspp",
        expect.any(String)
      );
    });

    it("should create in the root directory if an active file is open but NO directory is selected in File Explorer", async () => {
      // An active note is open in a subfolder
      const parentFolder = new TFolder();
      parentFolder.path = "DailyNotes";
      parentFolder.name = "DailyNotes";

      const activeFile = new TFile();
      activeFile.path = "DailyNotes/2026-10-11.md";
      activeFile.basename = "2026-10-11";
      activeFile.extension = "md";
      activeFile.parent = parentFolder;

      app.workspace.getActiveFile = () => activeFile;

      // But NO directory is selected in File Explorer
      const fileExplorerView = {
        selectedFolder: null,
        selectedDirectory: null,
      };

      app.workspace.getLeavesOfType = (type: string) => {
        if (type === "file-explorer") {
          return [{ view: fileExplorerView }];
        }
        return [];
      };

      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue({ path: "Untitled Diagram.canvuspp" });

      const ribbon = (plugin as any).ribbonIcons[0];
      await ribbon.callback();

      // Must be created in the root directory, NOT inside DailyNotes
      expect(createSpy).toHaveBeenCalledWith(
        "Untitled Diagram.canvuspp",
        expect.any(String)
      );
    });

    it("should create in root directory if a file (not folder) is selected in File Explorer", async () => {
      const selectedFile = new TFile();
      selectedFile.path = "Notes/Article.md";
      selectedFile.basename = "Article";
      selectedFile.extension = "md";

      const fileExplorerView = {
        selectedFile: selectedFile,
      };

      app.workspace.getLeavesOfType = (type: string) => {
        if (type === "file-explorer") {
          return [{ view: fileExplorerView }];
        }
        return [];
      };

      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue({ path: "Untitled Diagram.canvuspp" });

      const ribbon = (plugin as any).ribbonIcons[0];
      await ribbon.callback();

      expect(createSpy).toHaveBeenCalledWith(
        "Untitled Diagram.canvuspp",
        expect.any(String)
      );
    });

    it("should create in root directory if selected directory is the root folder '/'", async () => {
      const rootFolder = new TFolder();
      rootFolder.path = "/";
      rootFolder.name = "/";

      const fileExplorerView = {
        selectedFolder: rootFolder,
      };

      app.workspace.getLeavesOfType = (type: string) => {
        if (type === "file-explorer") {
          return [{ view: fileExplorerView }];
        }
        return [];
      };

      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue({ path: "Untitled Diagram.canvuspp" });

      const ribbon = (plugin as any).ribbonIcons[0];
      await ribbon.callback();

      expect(createSpy).toHaveBeenCalledWith(
        "Untitled Diagram.canvuspp",
        expect.any(String)
      );
    });

    it("should create in root directory if no file-explorer leaves exist", async () => {
      app.workspace.getLeavesOfType = () => [];

      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue({ path: "Untitled Diagram.canvuspp" });

      const ribbon = (plugin as any).ribbonIcons[0];
      await ribbon.callback();

      expect(createSpy).toHaveBeenCalledWith(
        "Untitled Diagram.canvuspp",
        expect.any(String)
      );
    });
  });

  describe("Unique File Naming", () => {
    it("should increment filename counter if untitled diagram already exists in destination folder", async () => {
      const folder = new TFolder();
      folder.path = "Projects";
      folder.name = "Projects";

      const fileExplorerView = {
        selectedFolder: folder,
      };

      app.workspace.getLeavesOfType = (type: string) => {
        if (type === "file-explorer") {
          return [{ view: fileExplorerView }];
        }
        return [];
      };

      // Pretend 'Projects/Untitled Diagram.canvuspp' already exists
      app.vault.getAbstractFileByPath = (path: string) => {
        if (path === "Projects/Untitled Diagram.canvuspp") {
          return new TFile();
        }
        return null;
      };

      const createSpy = jest.spyOn(app.vault, "create").mockResolvedValue({ path: "Projects/Untitled Diagram 1.canvuspp" });

      const ribbon = (plugin as any).ribbonIcons[0];
      await ribbon.callback();

      expect(createSpy).toHaveBeenCalledWith(
        "Projects/Untitled Diagram 1.canvuspp",
        expect.any(String)
      );
    });
  });
});
