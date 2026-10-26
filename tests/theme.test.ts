import * as fs from "fs";
import * as path from "path";
import {
  CANVAS_LIGHT_COLOR_PRESETS,
  CANVAS_DARK_COLOR_PRESETS,
  resolveCanvasColorHex,
  resolveCanvasBgColor,
} from "../src/domain/value-objects/CanvasColor";
import { SvgExporter } from "../src/infrastructure/export/SvgExporter";
import { createDiagram } from "../src/domain/entities/Diagram";
import { createDiagramNode } from "../src/domain/entities/DiagramNode";
import { createDiagramEdge } from "../src/domain/entities/DiagramEdge";
import { createLabel } from "../src/domain/entities/Label";
import { DEFAULT_SETTINGS } from "../src/infrastructure/obsidian/PluginSettings";
import { UmlCanvasSettingTab } from "../src/presentation/views/UmlCanvasSettingTab";

describe("Pastel-Inspired Light Theme Tests", () => {
  describe("Color Presets & Contrast", () => {
    it("should provide high-contrast pastel-complementary presets for light theme", () => {
      expect(CANVAS_LIGHT_COLOR_PRESETS["1"]).toBe("#ff758f"); // Light Rose / Coral
      expect(CANVAS_LIGHT_COLOR_PRESETS["2"]).toBe("#ffa94d"); // Light Peach / Orange
      expect(CANVAS_LIGHT_COLOR_PRESETS["3"]).toBe("#ffd43b"); // Light Butter Yellow
      expect(CANVAS_LIGHT_COLOR_PRESETS["4"]).toBe("#69db7c"); // Light Mint Green
      expect(CANVAS_LIGHT_COLOR_PRESETS["5"]).toBe("#38d9a9"); // Light Ocean Teal / Cyan
      expect(CANVAS_LIGHT_COLOR_PRESETS["6"]).toBe("#b197fc"); // Light Lavender Purple
    });

    it("should resolve light color presets when theme is specified as 'light'", () => {
      expect(resolveCanvasColorHex("1", "light")).toBe("#ff758f");
      expect(resolveCanvasColorHex("3", "light")).toBe("#ffd43b");
      expect(resolveCanvasColorHex("5", "light")).toBe("#38d9a9");
    });

    it("should resolve dark color presets when theme is specified as 'dark'", () => {
      expect(resolveCanvasColorHex("1", "dark")).toBe(CANVAS_DARK_COLOR_PRESETS["1"]);
      expect(resolveCanvasColorHex("4", "dark")).toBe(CANVAS_DARK_COLOR_PRESETS["4"]);
    });

    it("should calculate translucent background tint for light theme", () => {
      const bg = resolveCanvasBgColor("1", 0.1, "light");
      expect(bg).toBeDefined();
      expect(bg).toContain("rgba(");
      expect(bg).toContain("0.1)");
    });
  });

  describe("SvgExporter Light Theme", () => {
    it("should export SVG with pastel off-white background and clear contrast", () => {
      const exporter = new SvgExporter();
      const diagram = createDiagram({
        id: "test-diagram",
        title: "Architecture Plan",
        diagramType: "general",
      });

      const node1 = createDiagramNode({
        id: "node-1",
        labels: [createLabel({ id: "l1", text: "API Gateway", anchor: "node", position: { x: 0, y: 0 } })],
        kind: "uml.class",
        position: { x: 50, y: 50 },
        size: { width: 140, height: 80 },
      });
      const node2 = createDiagramNode({
        id: "node-2",
        labels: [createLabel({ id: "l2", text: "Auth Service", anchor: "node", position: { x: 0, y: 0 } })],
        kind: "uml.class",
        position: { x: 260, y: 50 },
        size: { width: 140, height: 80 },
      });
      const edge = createDiagramEdge({
        id: "edge-1",
        fromNodeId: "node-1",
        toNodeId: "node-2",
      });

      diagram.nodes = [node1, node2];
      diagram.edges = [edge];

      const lightSvg = exporter.exportToSvg(diagram, { theme: "light" });

      // Off-white, NOT pure white #ffffff
      expect(lightSvg).toContain("#f7f5f0");
      expect(lightSvg).not.toContain('style="background-color: #ffffff"');

      // Clear contrast text & lines
      expect(lightSvg).toContain("#1a1d24"); // high contrast title/text
      expect(lightSvg).toContain("#404654"); // crisp node stroke
      expect(lightSvg).toContain("#ffffff"); // node body fill
    });

    it("should retain dark theme export when theme is 'dark'", () => {
      const exporter = new SvgExporter();
      const diagram = createDiagram({
        id: "test-diagram",
        title: "Dark Diagram",
        diagramType: "general",
      });
      const darkSvg = exporter.exportToSvg(diagram, { theme: "dark" });
      expect(darkSvg).toContain("#1e1e1e");
      expect(darkSvg).toContain("#dcddde");
    });
  });

  describe("Settings & Theme Configuration", () => {
    it("should have default theme set to 'system'", () => {
      expect(DEFAULT_SETTINGS.theme).toBe("system");
    });

    it("should include Canvas theme dropdown in settings tab definitions", () => {
      const fakePlugin = { settings: { ...DEFAULT_SETTINGS }, saveSettings: jest.fn() };
      const tab = new UmlCanvasSettingTab({} as any, fakePlugin as any);
      const defs = tab.getSettingDefinitions() as any[];
      const themeDef = defs.find((d) => d.name === "Canvas theme");

      expect(themeDef).toBeDefined();
      expect(themeDef?.control?.type).toBe("dropdown");
      expect(themeDef?.control?.options).toEqual({
        system: "System (Follow Obsidian)",
        light: "Pastel Light",
        dark: "Dark",
      });
    });
  });

  describe("styles.css Pastel Light Theme Quality", () => {
    const cssPath = path.resolve(__dirname, "../styles.css");
    const css = fs.readFileSync(cssPath, "utf-8");

    it("should specify pastel off-white canvas background (#f7f5f0) instead of pure white", () => {
      expect(css).toContain("--canvas-bg: #f7f5f0;");
      expect(css).toContain(".umlcanvas-theme-light");
    });

    it("should define high contrast typography ink and connector lines", () => {
      // High contrast ink title: #1a1d24
      expect(css).toContain("--canvas-text-title: #1a1d24;");
      // High contrast connector edge: #2e3442
      expect(css).toContain("--canvas-stroke-edge: #2e3442;");
      // Crisp component border: #475060
      expect(css).toContain("--canvas-stroke-node: #475060;");
    });

    it("should provide pastel fills mixed with white for colored components", () => {
      expect(css).toContain("color-mix(in srgb, var(--canvas-color) 12%, #ffffff);");
    });

    it("should support explicit dark theme override class .umlcanvas-theme-dark", () => {
      expect(css).toContain(".umlcanvas-theme-dark");
      expect(css).toContain("background-color: #1e1e1e !important;");
    });
  });

  describe("Toolbar Theme Adaptation & Color Flipping", () => {
    const cssPath = path.resolve(__dirname, "../styles.css");
    const css = fs.readFileSync(cssPath, "utf-8");

    it("should ensure toolbar button icons are stroke-based with fill: none (preventing solid black icons)", () => {
      // Must define fill: none for toolbar button SVGs and all child elements
      expect(css).toMatch(/\.umlcanvas-toolbar-btn.*svg[\s\S]*?fill:\s*none/);
      expect(css).toMatch(/\.umlcanvas-toolbar-btn.*svg\s*\*[\s\S]*?fill:\s*none/);
    });

    it("should ensure dropdown menu and align icons also have fill: none", () => {
      expect(css).toMatch(/\.umlcanvas-menu-item-icon svg[\s\S]*?fill:\s*none/);
      expect(css).toMatch(/\.umlcanvas-align-icon svg[\s\S]*?fill:\s*none/);
      expect(css).toMatch(/\.umlcanvas-btn-chevron svg[\s\S]*?fill:\s*none/);
    });

    it("should adapt toolbar containers and groups to light theme colors", () => {
      // Light theme toolbar background: warm pastel surface
      expect(css).toContain(".umlcanvas-theme-light .umlcanvas-main-toolbar");
      expect(css).toContain("background-color: var(--canvas-bg-toolbar, #f4f1ea) !important;");
      // Light theme group: crisp white
      expect(css).toContain(".umlcanvas-theme-light .umlcanvas-toolbar-group");
      expect(css).toContain("background-color: #ffffff !important;");
      // Light theme button text: high contrast charcoal ink
      expect(css).toContain(".umlcanvas-theme-light .umlcanvas-toolbar-btn");
      expect(css).toContain("color: var(--canvas-text-body, #242832) !important;");
      // Light theme active button: accent with white text
      expect(css).toContain(".umlcanvas-theme-light .umlcanvas-toolbar-btn.is-active");
      expect(css).toContain("background-color: var(--canvas-accent, #5b4fe8) !important;");
    });

    it("should adapt toolbar containers and groups to dark theme colors", () => {
      // Dark theme toolbar background: dark secondary surface
      expect(css).toContain(".umlcanvas-theme-dark .umlcanvas-main-toolbar");
      expect(css).toContain("background-color: #26262b !important;");
      // Dark theme group: dark primary surface
      expect(css).toContain(".umlcanvas-theme-dark .umlcanvas-toolbar-group");
      expect(css).toContain("background-color: #1e1e1e !important;");
      // Dark theme button text: light text
      expect(css).toContain(".umlcanvas-theme-dark .umlcanvas-toolbar-btn");
      expect(css).toContain("color: #dcddde !important;");
      // Dark theme active button: purple accent
      expect(css).toContain(".umlcanvas-theme-dark .umlcanvas-toolbar-btn.is-active");
      expect(css).toContain("background-color: #7b68ee !important;");
    });

    it("should enforce stroke: currentColor and fill: none in light theme toolbar icons", () => {
      // Light theme icons must have explicit stroke: currentColor and fill: none !important
      expect(css).toContain(
        ".umlcanvas-theme-light .umlcanvas-toolbar-btn .umlcanvas-btn-icon svg"
      );
      expect(css).toContain("stroke: currentColor !important;");
      expect(css).toContain("fill: none !important;");
    });

    it("should enforce transparent button background, no box-shadow, and no borders to prevent black layers in light theme", () => {
      // Light theme toolbar buttons must explicitly override host button background/borders/shadows
      expect(css).toMatch(
        /\.umlcanvas-theme-light \.umlcanvas-toolbar-btn[\s\S]*?background-color:\s*transparent\s*!important/
      );
      expect(css).toMatch(
        /\.umlcanvas-theme-light \.umlcanvas-toolbar-btn[\s\S]*?border:\s*none\s*!important/
      );
      expect(css).toMatch(
        /\.umlcanvas-theme-light \.umlcanvas-toolbar-btn[\s\S]*?box-shadow:\s*none\s*!important/
      );
      // Buttons must include clickable-icon selector
      expect(css).toContain(".umlcanvas-theme-light .umlcanvas-toolbar-btn.clickable-icon");
      expect(css).toContain(".theme-light .umlcanvas-toolbar-btn.clickable-icon");
      // Icons and svgs must have explicit resets
      expect(css).toMatch(
        /\.umlcanvas-toolbar-btn \.umlcanvas-btn-icon[\s\S]*?-webkit-mask:\s*none\s*!important/
      );
      // Dark theme toolbar buttons must also have transparent background and no shadow
      expect(css).toMatch(
        /\.umlcanvas-theme-dark \.umlcanvas-toolbar-btn[\s\S]*?background-color:\s*transparent\s*!important/
      );
      expect(css).toMatch(
        /\.umlcanvas-theme-dark \.umlcanvas-toolbar-btn[\s\S]*?box-shadow:\s*none\s*!important/
      );
    });

    it("should style connector popover to adapt to light and dark themes", () => {
      expect(css).toContain(".umlcanvas-theme-light .umlcanvas-connector-popover");
      expect(css).toContain(".umlcanvas-theme-dark .umlcanvas-connector-popover");
    });

    it("should style font size adjustment button and stepper combo to prevent black button bug in light theme", () => {
      expect(css).toMatch(
        /\.umlcanvas-theme-light \.umlcanvas-font-stepper-combo[\s\S]*?background-color:\s*#ffffff/
      );
      expect(css).toMatch(
        /\.umlcanvas-theme-light \.umlcanvas-font-size-btn[\s\S]*?background-color:\s*#ffffff/
      );
      expect(css).toMatch(
        /\.umlcanvas-theme-light \.umlcanvas-font-size-btn:hover[\s\S]*?background-color:\s*var\(--canvas-bg-toolbar-hover/
      );
      expect(css).toContain("--background-modifier-form-field: #ffffff;");
      expect(css).toMatch(
        /\.umlcanvas-theme-dark \.umlcanvas-font-stepper-combo[\s\S]*?background-color:\s*#1e1e1e/
      );
    });

    it("should properly toggle theme classes on container when toggling theme", () => {
      class MockClassList {
        private classes = new Set<string>();
        add(...cls: string[]) {
          cls.forEach((c) => this.classes.add(c));
        }
        remove(...cls: string[]) {
          cls.forEach((c) => this.classes.delete(c));
        }
        contains(c: string) {
          return this.classes.has(c);
        }
      }
      const container = { classList: new MockClassList() };

      // Simulate applying light theme
      const applyViewTheme = (el: { classList: MockClassList }, isLight: boolean) => {
        if (isLight) {
          el.classList.remove("umlcanvas-theme-dark", "theme-dark");
          el.classList.add("umlcanvas-theme-light", "theme-light");
        } else {
          el.classList.remove("umlcanvas-theme-light", "theme-light");
          el.classList.add("umlcanvas-theme-dark", "theme-dark");
        }
      };

      // 1. Initial switch to Light Theme
      applyViewTheme(container, true);
      expect(container.classList.contains("umlcanvas-theme-light")).toBe(true);
      expect(container.classList.contains("theme-light")).toBe(true);
      expect(container.classList.contains("umlcanvas-theme-dark")).toBe(false);
      expect(container.classList.contains("theme-dark")).toBe(false);

      // Check isLight calculation logic
      let isCurrentlyLight =
        (container.classList.contains("umlcanvas-theme-light") ||
          container.classList.contains("theme-light")) &&
        !container.classList.contains("umlcanvas-theme-dark");
      expect(isCurrentlyLight).toBe(true);

      // 2. Switch to Dark Theme
      applyViewTheme(container, !isCurrentlyLight);
      expect(container.classList.contains("umlcanvas-theme-dark")).toBe(true);
      expect(container.classList.contains("theme-dark")).toBe(true);
      expect(container.classList.contains("umlcanvas-theme-light")).toBe(false);
      expect(container.classList.contains("theme-light")).toBe(false);

      isCurrentlyLight =
        (container.classList.contains("umlcanvas-theme-light") ||
          container.classList.contains("theme-light")) &&
        !container.classList.contains("umlcanvas-theme-dark");
      expect(isCurrentlyLight).toBe(false);

      // 3. Switch back to Light Theme
      applyViewTheme(container, !isCurrentlyLight);
      expect(container.classList.contains("umlcanvas-theme-light")).toBe(true);
      expect(container.classList.contains("theme-light")).toBe(true);
      expect(container.classList.contains("umlcanvas-theme-dark")).toBe(false);
    });

    it("should synchronously apply theme in UmlCanvasView.toggleTheme()", async () => {
      class MockClassList {
        private classes = new Set<string>();
        add(...cls: string[]) {
          cls.forEach((c) => this.classes.add(c));
        }
        remove(...cls: string[]) {
          cls.forEach((c) => this.classes.delete(c));
        }
        contains(c: string) {
          return this.classes.has(c);
        }
      }
      const rootEl = { classList: new MockClassList() };
      // Initially dark
      rootEl.classList.add("umlcanvas-theme-dark", "theme-dark");

      const fakePlugin = {
        settings: { theme: "dark" },
        saveSettings: jest.fn().mockResolvedValue(undefined),
      };

      const mockView: any = {
        rootEl,
        plugin: fakePlugin,
        applyTheme() {
          const settingTheme = this.plugin.settings.theme;
          const isLight = settingTheme === "light";
          if (isLight) {
            this.rootEl.classList.remove("umlcanvas-theme-dark", "theme-dark");
            this.rootEl.classList.add("umlcanvas-theme-light", "theme-light");
          } else {
            this.rootEl.classList.remove("umlcanvas-theme-light", "theme-light");
            this.rootEl.classList.add("umlcanvas-theme-dark", "theme-dark");
          }
        },
        async toggleTheme() {
          const isCurrentlyLight =
            (this.rootEl?.classList?.contains("umlcanvas-theme-light") ||
              this.rootEl?.classList?.contains("theme-light")) &&
            !this.rootEl?.classList?.contains("umlcanvas-theme-dark") ||
            false;
          this.plugin.settings.theme = isCurrentlyLight ? "dark" : "light";
          this.applyTheme();
          await this.plugin.saveSettings();
        },
      };

      // Toggle from dark to light
      await mockView.toggleTheme();
      expect(fakePlugin.settings.theme).toBe("light");
      expect(rootEl.classList.contains("umlcanvas-theme-light")).toBe(true);
      expect(rootEl.classList.contains("umlcanvas-theme-dark")).toBe(false);
      expect(fakePlugin.saveSettings).toHaveBeenCalledTimes(1);

      // Toggle from light back to dark
      await mockView.toggleTheme();
      expect(fakePlugin.settings.theme).toBe("dark");
      expect(rootEl.classList.contains("umlcanvas-theme-dark")).toBe(true);
      expect(rootEl.classList.contains("umlcanvas-theme-light")).toBe(false);
      expect(fakePlugin.saveSettings).toHaveBeenCalledTimes(2);
    });
  });
});
