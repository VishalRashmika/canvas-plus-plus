export class Plugin {
  app: any = {};
  manifest: any = {};
  async loadData() { return {}; }
  async saveData(_data: any) {}
  registerView(_type: string, _viewCreator: any) {}
  registerExtensions(_extensions: string[], _viewType: string) {}
  addSettingTab(_tab: any) {}
  addRibbonIcon(_icon: string, _title: string, _callback: any) { return {} as HTMLElement; }
  addCommand(_command: any) { return {}; }
  registerEvent(_ref: any) {}
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: HTMLElement = document.createElement("div");
  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
  }
  display() {}
  hide() {}
  getSettingDefinitions(): any[] { return []; }
  getControlValue(_key: string): any {}
  setControlValue(_key: string, _value: any): any {}
}

export type SettingDefinitionItem<K extends string = string> = any;

export class Setting {
  settingEl: HTMLElement = document.createElement("div");
  constructor(_containerEl: HTMLElement) {}
  setName(_name: string) { return this; }
  setDesc(_desc: string) { return this; }
  addToggle(_cb: any) { return this; }
  addText(_cb: any) { return this; }
  addDropdown(_cb: any) { return this; }
  addButton(_cb: any) { return this; }
}

export class Modal {
  app: any;
  contentEl: HTMLElement = document.createElement("div");
  constructor(app: any) { this.app = app; }
  open() {}
  close() {}
}

export class FuzzySuggestModal<T> {
  app: any;
  constructor(app: any) { this.app = app; }
  open() {}
  close() {}
}

export class TextFileView {
  app: any;
  leaf: any;
  contentEl: HTMLElement = document.createElement("div");
  constructor(leaf: any) { this.leaf = leaf; }
}

export class WorkspaceLeaf {}
export class Menu {}
export class TFile {
  path: string = "";
  basename: string = "";
  extension: string = "";
}
export class TFolder {
  path: string = "";
  name: string = "";
}
export class TAbstractFile {
  path: string = "";
  name: string = "";
}
export class Vault {}
export class Notice {
  constructor(_msg: string) {}
}

export const MarkdownRenderer = {
  renderMarkdown: async () => {},
};

export const Platform = {
  isMacOS: false,
  isMobile: false,
  isDesktop: true,
};

export class App {}

export function setIcon(_parent: HTMLElement, _iconId: string): void {}

export type EventRef = any;

if (typeof HTMLElement !== "undefined") {
  if (!HTMLElement.prototype.setCssStyles) {
    (HTMLElement.prototype as any).setCssStyles = function (styles: any) {
      Object.assign(this.style, styles);
    };
  }
  if (!HTMLElement.prototype.setCssProps) {
    (HTMLElement.prototype as any).setCssProps = function (props: any) {
      for (const [k, v] of Object.entries(props)) {
        this.style.setProperty(k, v as string);
      }
    };
  }
}
if (typeof SVGElement !== "undefined") {
  if (!SVGElement.prototype.setCssStyles) {
    (SVGElement.prototype as any).setCssStyles = function (styles: any) {
      Object.assign(this.style, styles);
    };
  }
  if (!SVGElement.prototype.setCssProps) {
    (SVGElement.prototype as any).setCssProps = function (props: any) {
      for (const [k, v] of Object.entries(props)) {
        this.style.setProperty(k, v as string);
      }
    };
  }
}
