import CanvasPlusPlusPlugin from "../src/main";
import { App, Menu, TFile, TFolder } from "./fakes/MockObsidian";

describe("File Explorer Context Menu Tests", () => {
  let app: App;
  let plugin: CanvasPlusPlusPlugin;
  let fileMenuCallback: ((menu: Menu, file: any) => void) | null = null;
  let filesMenuCallback: ((menu: Menu, files: any[]) => void) | null = null;

  beforeEach(async () => {
    fileMenuCallback = null;
    filesMenuCallback = null;

    app = new App();
    // Intercept workspace.on calls
    app.workspace.on = (name: string, cb: any) => {
      if (name === "file-menu") {
        fileMenuCallback = cb;
      } else if (name === "files-menu") {
        filesMenuCallback = cb;
      }
      return {};
    };

    plugin = new CanvasPlusPlusPlugin(app as any, { id: "canvas-plus-plus", name: "Canvas++" } as any);
    await plugin.onload();
  });

  it("should register file-menu and files-menu event listeners", () => {
    expect(fileMenuCallback).toBeDefined();
    expect(filesMenuCallback).toBeDefined();
  });

  describe("Single selection context menu (file-menu)", () => {
    it("should provide a single 'New Canvas++' option with 'layout-dashboard' icon", () => {
      const menu = new Menu();
      const folder = new TFolder();
      folder.path = "Diagrams";
      folder.name = "Diagrams";

      fileMenuCallback!(menu, folder);

      // Verify there is only one menu item added by the plugin
      expect(menu.items).toHaveLength(1);

      const item = menu.items[0];
      expect(item.title).toBe("New Canvas++");
      expect(item.icon).toBe("layout-dashboard");
    });

    it("should NOT show separate UML Canvas or Schematic Canvas options", () => {
      const menu = new Menu();
      const folder = new TFolder();
      fileMenuCallback!(menu, folder);

      const titles = menu.items.map((i) => i.title.toLowerCase());
      expect(titles).not.toContain("new uml canvas");
      expect(titles).not.toContain("uml canvas");
      expect(titles).not.toContain("new schematic canvas");
      expect(titles).not.toContain("schematic canvas");
      expect(titles.filter((t) => t.includes("schematic"))).toHaveLength(0);
    });

    it("should invoke createNewDiagramFile targeting folder when clicked", async () => {
      const menu = new Menu();
      const folder = new TFolder();
      folder.path = "Projects/Canvas";

      const createSpy = jest.spyOn(plugin, "createNewDiagramFile").mockResolvedValue(undefined as any);

      fileMenuCallback!(menu, folder);

      expect(menu.items).toHaveLength(1);
      const item = menu.items[0];
      await item.onClickHandler?.();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledWith("general", "Untitled Diagram", folder);
    });

    it("should resolve parent folder when right-clicking on a file", async () => {
      const menu = new Menu();
      const parentFolder = new TFolder();
      parentFolder.path = "Notes";
      const file = new TFile();
      file.path = "Notes/MyNote.md";
      file.parent = parentFolder;

      const createSpy = jest.spyOn(plugin, "createNewDiagramFile").mockResolvedValue(undefined as any);

      fileMenuCallback!(menu, file);

      expect(menu.items).toHaveLength(1);
      const item = menu.items[0];
      await item.onClickHandler?.();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledWith("general", "Untitled Diagram", parentFolder);
    });
  });

  describe("Multi-selection context menu (files-menu)", () => {
    it("should provide a single 'New Canvas++' option with 'layout-dashboard' icon", () => {
      const menu = new Menu();
      const folder = new TFolder();
      folder.path = "Work";

      filesMenuCallback!(menu, [folder]);

      expect(menu.items).toHaveLength(1);
      const item = menu.items[0];
      expect(item.title).toBe("New Canvas++");
      expect(item.icon).toBe("layout-dashboard");
    });

    it("should invoke createNewDiagramFile with target folder when clicked", async () => {
      const menu = new Menu();
      const folder = new TFolder();
      folder.path = "Work";

      const createSpy = jest.spyOn(plugin, "createNewDiagramFile").mockResolvedValue(undefined as any);

      filesMenuCallback!(menu, [folder]);

      const item = menu.items[0];
      await item.onClickHandler?.();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledWith("general", "Untitled Diagram", folder);
    });
  });
});
