import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type CanvasPlusPlusPlugin from "../../main";

export class UmlCanvasSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: CanvasPlusPlusPlugin) {
    super(app, plugin);
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Default diagram type",
        desc: "The initial diagram type when creating a new canvas.",
        control: {
          type: "dropdown",
          key: "defaultDiagramType",
          options: {
            "uml.class": "UML Class Diagram",
            "uml.usecase": "UML Use Case Diagram",
            "uml.sequence": "UML Sequence Diagram",
            "schematic": "Schematic / Chip Diagram",
            "generic": "Generic Diagram",
          },
        },
      },
      {
        name: "Default node width",
        desc: "Default width in pixels for newly created nodes.",
        control: {
          type: "number",
          key: "defaultNodeWidth",
          placeholder: "140",
          min: 20,
        },
      },
      {
        name: "Default node height",
        desc: "Default height in pixels for newly created nodes.",
        control: {
          type: "number",
          key: "defaultNodeHeight",
          placeholder: "80",
          min: 20,
        },
      },
      {
        name: "Show grid by default",
        desc: "Display background grid pattern on open canvases.",
        control: {
          type: "toggle",
          key: "showGrid",
        },
      },
      {
        name: "Grid size",
        desc: "Grid dot/cell spacing in pixels.",
        control: {
          type: "number",
          key: "gridSize",
          placeholder: "20",
          min: 5,
        },
      },
      {
        name: "Autosave debounce delay (ms)",
        desc: "Milliseconds to wait after changes before automatically saving to disk.",
        control: {
          type: "number",
          key: "autosaveDelayMs",
          placeholder: "500",
          min: 100,
        },
      },
      {
        name: "Enable Antigravity CLI bridge",
        desc: "Allow external Antigravity agent CLI patches under editPermission scoping.",
        control: {
          type: "toggle",
          key: "enableCliBridge",
        },
      },
      {
        name: "Enable freehand drawing",
        desc: "Allow freehand sketching and shape recognition on the canvas. When disabled, the canvas stays strictly in select/move mode.",
        control: {
          type: "toggle",
          key: "enableFreehand",
        },
      },
    ];
  }

  override getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Default diagram type")
      .setDesc("The initial diagram type when creating a new canvas.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("uml.class", "UML Class Diagram")
          .addOption("uml.usecase", "UML Use Case Diagram")
          .addOption("uml.sequence", "UML Sequence Diagram")
          .addOption("schematic", "Schematic / Chip Diagram")
          .addOption("generic", "Generic Diagram")
          .setValue(this.plugin.settings.defaultDiagramType)
          .onChange(async (value) => {
            this.plugin.settings.defaultDiagramType = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Default node width")
      .setDesc("Default width in pixels for newly created nodes.")
      .addText((text) => {
        text
          .setPlaceholder("140")
          .setValue(String(this.plugin.settings.defaultNodeWidth))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 20) {
              this.plugin.settings.defaultNodeWidth = num;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("Default node height")
      .setDesc("Default height in pixels for newly created nodes.")
      .addText((text) => {
        text
          .setPlaceholder("80")
          .setValue(String(this.plugin.settings.defaultNodeHeight))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 20) {
              this.plugin.settings.defaultNodeHeight = num;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("Show grid by default")
      .setDesc("Display background grid pattern on open canvases.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showGrid)
          .onChange(async (value) => {
            this.plugin.settings.showGrid = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Grid size")
      .setDesc("Grid dot/cell spacing in pixels.")
      .addText((text) => {
        text
          .setPlaceholder("20")
          .setValue(String(this.plugin.settings.gridSize))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 5) {
              this.plugin.settings.gridSize = num;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("Autosave debounce delay (ms)")
      .setDesc("Milliseconds to wait after changes before automatically saving to disk.")
      .addText((text) => {
        text
          .setPlaceholder("500")
          .setValue(String(this.plugin.settings.autosaveDelayMs))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 100) {
              this.plugin.settings.autosaveDelayMs = num;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("Enable Antigravity CLI bridge")
      .setDesc("Allow external Antigravity agent CLI patches under editPermission scoping.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.enableCliBridge)
          .onChange(async (value) => {
            this.plugin.settings.enableCliBridge = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Enable freehand drawing")
      .setDesc(
        "Allow freehand sketching and shape recognition on the canvas. When disabled, the canvas stays strictly in select/move mode."
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.enableFreehand)
          .onChange(async (value) => {
            this.plugin.settings.enableFreehand = value;
            await this.plugin.saveSettings();
          });
      });
  }
}
