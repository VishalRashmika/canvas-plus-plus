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
      expect(CANVAS_LIGHT_COLOR_PRESETS["1"]).toBe("#c92a3e"); // Pastel Rose / Red
      expect(CANVAS_LIGHT_COLOR_PRESETS["2"]).toBe("#c45e00"); // Pastel Amber / Orange
      expect(CANVAS_LIGHT_COLOR_PRESETS["3"]).toBe("#a17000"); // Pastel Gold / Yellow
      expect(CANVAS_LIGHT_COLOR_PRESETS["4"]).toBe("#12883f"); // Pastel Sage / Green
      expect(CANVAS_LIGHT_COLOR_PRESETS["5"]).toBe("#0a8288"); // Pastel Ocean / Teal
      expect(CANVAS_LIGHT_COLOR_PRESETS["6"]).toBe("#6340c7"); // Pastel Lavender / Purple
    });

    it("should resolve light color presets when theme is specified as 'light'", () => {
      expect(resolveCanvasColorHex("1", "light")).toBe("#c92a3e");
      expect(resolveCanvasColorHex("3", "light")).toBe("#a17000");
      expect(resolveCanvasColorHex("5", "light")).toBe("#0a8288");
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
});
