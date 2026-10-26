import { UmlCanvasView } from "../src/presentation/views/UmlCanvasView";
import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { CANVAS_COLOR_PRESETS } from "../src/domain/value-objects/CanvasColor";
import { FONT_SIZE_PRESETS } from "../src/presentation/theme/Typography";

describe("Right-Click Context Menu Grouping Tests", () => {
  let editor: DiagramEditor;
  let view: UmlCanvasView;
  let lastMenu: any = null;
  const obsidianModule = require("obsidian");
  const origShow = obsidianModule.Menu.prototype.showAtMouseEvent;

  beforeEach(() => {
    editor = new DiagramEditor(createDiagram({ id: "diag-test", diagramType: "general" }));
    view = new UmlCanvasView({} as any, { settings: {} } as any);
    (view as any).editor = editor;
    (view as any).renderer = {} as any;

    lastMenu = null;
    obsidianModule.Menu.prototype.showAtMouseEvent = function () {
      lastMenu = this;
    };
  });

  afterEach(() => {
    obsidianModule.Menu.prototype.showAtMouseEvent = origShow;
  });

  it("should group multiple colors under a 'Color' hover submenu instead of listing them in root menu", () => {
    const node = editor.addNode({ position: { x: 50, y: 50 } });
    (view as any).showContextMenu(
      { clientX: 100, clientY: 100 } as any,
      { x: 100, y: 100 },
      node
    );

    expect(lastMenu).not.toBeNull();

    // Verify root menu does NOT list multiple separate color items
    const rootColorPresetItems = lastMenu.items.filter(
      (item: any) => item.title.startsWith("Color: ")
    );
    expect(rootColorPresetItems.length).toBe(0);

    // Verify root menu has a single "Color" item
    const colorMenuItem = lastMenu.items.find((item: any) => item.title === "Color");
    expect(colorMenuItem).toBeDefined();
    expect(colorMenuItem.icon).toBe("palette");

    // Verify the "Color" item has a submenu attached
    expect(colorMenuItem.submenu).toBeDefined();
    const subItems = colorMenuItem.submenu.items;
    expect(subItems.length).toBe(1 + CANVAS_COLOR_PRESETS.length);

    // Default item should have checkmark since node has no color
    const defaultItem = subItems[0];
    expect(defaultItem.title).toContain("Default (None)");
    expect(defaultItem.title).toContain("✓");
    expect(defaultItem.icon).toBe("rotate-ccw");

    // Color presets should be listed in the submenu
    const redPreset = subItems.find((item: any) => item.title.includes("Red (1)"));
    expect(redPreset).toBeDefined();
    expect(redPreset.icon).toBe("palette");

    // Clicking red preset should update color
    redPreset.onClickHandler();
    expect(editor.diagram.nodes.find((n) => n.id === node.id)?.style?.color).toBe("1");

    // Clicking Default should reset color
    defaultItem.onClickHandler();
    expect(editor.diagram.nodes.find((n) => n.id === node.id)?.style?.color).toBeUndefined();
  });

  it("should show sticky note color labels in the 'Color' submenu for sticky notes", () => {
    const stickyNode = editor.addNode({
      kind: "generic.stickyNote",
      position: { x: 50, y: 50 },
    });
    (view as any).showContextMenu(
      { clientX: 100, clientY: 100 } as any,
      { x: 100, y: 100 },
      stickyNode
    );

    expect(lastMenu).not.toBeNull();
    const colorMenuItem = lastMenu.items.find((item: any) => item.title === "Color");
    expect(colorMenuItem).toBeDefined();
    expect(colorMenuItem.submenu).toBeDefined();

    const subItems = colorMenuItem.submenu.items;
    expect(subItems.some((i: any) => i.title.includes("Pink (1)"))).toBe(true);
    expect(subItems.some((i: any) => i.title.includes("Yellow (Classic) (3)"))).toBe(true);
    expect(subItems.some((i: any) => i.title.includes("Green (Mint) (4)"))).toBe(true);
    expect(subItems.some((i: any) => i.title.includes("Blue (Sky) (5)"))).toBe(true);
  });

  it("should mark current color with checkmark in the 'Color' submenu", () => {
    const node = editor.addNode({
      position: { x: 50, y: 50 },
      style: { color: "4" },
    });
    (view as any).showContextMenu(
      { clientX: 100, clientY: 100 } as any,
      { x: 100, y: 100 },
      node
    );

    const colorMenuItem = lastMenu.items.find((item: any) => item.title === "Color");
    const subItems = colorMenuItem.submenu.items;

    const defaultItem = subItems[0];
    expect(defaultItem.title).not.toContain("✓");

    const greenItem = subItems.find((item: any) => item.title.includes("(4)"));
    expect(greenItem.title).toContain("✓");
  });

  it("should group multiple font sizes under a 'Font size' hover submenu instead of listing them in root menu", () => {
    const node = editor.addNode({ position: { x: 50, y: 50 } });
    (view as any).showContextMenu(
      { clientX: 100, clientY: 100 } as any,
      { x: 100, y: 100 },
      node
    );

    expect(lastMenu).not.toBeNull();

    // Verify root menu does NOT list multiple separate font size items
    const rootFontSizeItems = lastMenu.items.filter(
      (item: any) => item.title.startsWith("Font size: ")
    );
    expect(rootFontSizeItems.length).toBe(0);

    // Verify root menu has a single "Font size" item
    const fontSizeMenuItem = lastMenu.items.find((item: any) => item.title === "Font size");
    expect(fontSizeMenuItem).toBeDefined();
    expect(fontSizeMenuItem.icon).toBe("type");

    // Verify the "Font size" item has a submenu attached
    expect(fontSizeMenuItem.submenu).toBeDefined();
    const subItems = fontSizeMenuItem.submenu.items;

    // Check increase / decrease / presets / reset inside submenu
    const increaseItem = subItems.find((i: any) => i.title.includes("Increase (+2px)"));
    expect(increaseItem).toBeDefined();
    expect(increaseItem.icon).toBe("plus");

    const decreaseItem = subItems.find((i: any) => i.title.includes("Decrease (-2px)"));
    expect(decreaseItem).toBeDefined();
    expect(decreaseItem.icon).toBe("minus");

    const smallItem = subItems.find((i: any) => i.title.includes("Small (10px)"));
    expect(smallItem).toBeDefined();

    const normalItem = subItems.find((i: any) => i.title.includes("Normal (13px)"));
    expect(normalItem).toBeDefined();
    expect(normalItem.title).toContain("✓"); // Default 13px has checkmark

    const resetItem = subItems.find((i: any) => i.title.includes("Reset font (13px, normal)"));
    expect(resetItem).toBeDefined();
    expect(resetItem.icon).toBe("rotate-ccw");

    // Test clicking Font size presets in submenu
    smallItem.onClickHandler();
    expect(editor.getNodeFont(node.id).fontSize).toBe(10);

    // Test increase font size
    increaseItem.onClickHandler();
    expect(editor.getNodeFont(node.id).fontSize).toBe(12);

    // Test decrease font size
    decreaseItem.onClickHandler();
    expect(editor.getNodeFont(node.id).fontSize).toBe(10);

    // Test reset font
    resetItem.onClickHandler();
    expect(editor.getNodeFont(node.id).fontSize).toBeUndefined();
    expect(editor.getNodeFont(node.id).fontSize ?? 13).toBe(13);
  });

  it("should keep Bold and Italic toggles easily accessible on the main right-click menu", () => {
    const node = editor.addNode({ position: { x: 50, y: 50 } });
    (view as any).showContextMenu(
      { clientX: 100, clientY: 100 } as any,
      { x: 100, y: 100 },
      node
    );

    const boldItem = lastMenu.items.find((i: any) => i.title.startsWith("Bold:"));
    expect(boldItem).toBeDefined();
    expect(boldItem.title).toContain("Bold: Off");

    const italicItem = lastMenu.items.find((i: any) => i.title.startsWith("Italic:"));
    expect(italicItem).toBeDefined();
    expect(italicItem.title).toContain("Italic: Off");

    // Click Bold toggle
    boldItem.onClickHandler();
    expect(editor.getNodeFont(node.id).bold).toBe(true);

    // Click Italic toggle
    italicItem.onClickHandler();
    expect(editor.getNodeFont(node.id).italic).toBe(true);
  });

  it("should group Color and Font size into submenus for Edge right-click context menu", () => {
    const n1 = editor.addNode({ position: { x: 50, y: 50 } });
    const n2 = editor.addNode({ position: { x: 200, y: 50 } });
    const edge = editor.addEdge(n1.id, n2.id, { kind: "uml.association" });

    (view as any).showContextMenu(
      { clientX: 100, clientY: 100 } as any,
      { x: 100, y: 100 },
      undefined,
      edge
    );

    expect(lastMenu).not.toBeNull();

    // Verify Color submenu
    const colorItem = lastMenu.items.find((i: any) => i.title === "Color");
    expect(colorItem).toBeDefined();
    expect(colorItem.submenu).toBeDefined();
    expect(colorItem.submenu.items.length).toBe(1 + CANVAS_COLOR_PRESETS.length);

    // Verify Font size submenu
    const fontSizeItem = lastMenu.items.find((i: any) => i.title === "Font size");
    expect(fontSizeItem).toBeDefined();
    expect(fontSizeItem.submenu).toBeDefined();
    expect(fontSizeItem.submenu.items.some((i: any) => i.title.includes("Reset font (11px, normal)"))).toBe(true);

    // Verify Style options remain top-level
    const styleItems = lastMenu.items.filter((i: any) => i.title.startsWith("Style:"));
    expect(styleItems.length).toBeGreaterThanOrEqual(8);
  });

  it("should group Color and Font size into submenus for Group right-click context menu", () => {
    const group = editor.addGroup({
      position: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
      name: "Test Group",
    });

    (view as any).showContextMenu(
      { clientX: 50, clientY: 50 } as any,
      { x: 50, y: 50 },
      undefined,
      undefined,
      group
    );

    expect(lastMenu).not.toBeNull();

    // Verify Color submenu
    const colorItem = lastMenu.items.find((i: any) => i.title === "Color");
    expect(colorItem).toBeDefined();
    expect(colorItem.submenu).toBeDefined();
    expect(colorItem.submenu.items.length).toBe(1 + CANVAS_COLOR_PRESETS.length);

    // Verify Font size submenu
    const fontSizeItem = lastMenu.items.find((i: any) => i.title === "Font size");
    expect(fontSizeItem).toBeDefined();
    expect(fontSizeItem.submenu).toBeDefined();
    expect(fontSizeItem.submenu.items.some((i: any) => i.title.includes("Reset font (12px, normal)"))).toBe(true);
  });

  it("should fall back gracefully to adding items directly if setSubmenu is not available", () => {
    // Temporarily remove setSubmenu from MockObsidian's MenuItem prototype
    const origSetSubmenu = obsidianModule.MenuItem.prototype.setSubmenu;
    delete obsidianModule.MenuItem.prototype.setSubmenu;

    try {
      const node = editor.addNode({ position: { x: 50, y: 50 } });
      (view as any).showContextMenu(
        { clientX: 100, clientY: 100 } as any,
        { x: 100, y: 100 },
        node
      );

      expect(lastMenu).not.toBeNull();
      // In fallback mode, Color items are added directly with "Color: " prefix
      const fallbackColorItems = lastMenu.items.filter(
        (i: any) => i.title.startsWith("Color: ")
      );
      expect(fallbackColorItems.length).toBe(1 + CANVAS_COLOR_PRESETS.length);

      // In fallback mode, Font size items are added directly with "Font size: " prefix
      const fallbackFontSizeItems = lastMenu.items.filter(
        (i: any) => i.title.startsWith("Font size: ")
      );
      expect(fallbackFontSizeItems.length).toBeGreaterThan(0);
    } finally {
      obsidianModule.MenuItem.prototype.setSubmenu = origSetSubmenu;
    }
  });
});
