export interface RibbonIconItem {
  icon: string;
  title: string;
  callback: (evt?: any) => any;
  element: HTMLElement;
}

export class Plugin {
  app: any = new App();
  manifest: any = {};
  ribbonIcons: RibbonIconItem[] = [];
  constructor(app?: any, manifest?: any) {
    if (app) this.app = app;
    if (manifest) this.manifest = manifest;
  }
  async loadData() { return {}; }
  async saveData(_data: any) {}
  registerView(_type: string, _viewCreator: any) {}
  registerExtensions(_extensions: string[], _viewType: string) {}
  addSettingTab(_tab: any) {}
  addRibbonIcon(icon: string, title: string, callback: any): HTMLElement {
    const el = (typeof document !== "undefined"
      ? document.createElement("div")
      : {
          setAttribute: () => {},
          getAttribute: () => null,
          classList: { add: () => {}, remove: () => {}, contains: () => false },
          addEventListener: (_ev: string, cb: any) => {
            (el as any).onclick = cb;
          },
          click: () => callback(),
        }) as unknown as HTMLElement;
    const item: RibbonIconItem = { icon, title, callback, element: el };
    this.ribbonIcons.push(item);
    return el;
  }
  addCommand(_command: any) { return {}; }
  registerEvent(_ref: any) {}
  register(_fn: any) {}
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: HTMLElement = typeof document !== "undefined" ? document.createElement("div") : ({} as any);
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
  settingEl: HTMLElement = typeof document !== "undefined" ? document.createElement("div") : ({} as any);
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
  contentEl: HTMLElement = typeof document !== "undefined" ? document.createElement("div") : ({} as any);
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
  contentEl: HTMLElement = typeof document !== "undefined" ? document.createElement("div") : ({} as any);
  constructor(leaf: any) { this.leaf = leaf; }
}

export class WorkspaceLeaf {}
export class MenuItem {
  title: string = "";
  icon: string = "";
  onClickHandler?: () => any;
  setTitle(title: string) {
    this.title = title;
    return this;
  }
  setIcon(icon: string) {
    this.icon = icon;
    return this;
  }
  onClick(cb: () => any) {
    this.onClickHandler = cb;
    return this;
  }
}

export class Menu {
  items: MenuItem[] = [];
  addItem(cb: (item: MenuItem) => any) {
    const item = new MenuItem();
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator() {
    return this;
  }
  showAtMouseEvent(_e: any) {}
}
export class TAbstractFile {
  path: string = "";
  name: string = "";
  parent?: any;
  constructor(path = "", name = "") {
    this.path = path;
    this.name = name || (path ? path.split("/").pop() || "" : "");
  }
}

export class TFolder extends TAbstractFile {
  children?: any[] = [];
  isRoot?(): boolean {
    return this.path === "" || this.path === "/";
  }
}

export class TFile extends TAbstractFile {
  basename: string = "";
  extension: string = "";
  constructor(path = "", basename = "", extension = "") {
    super(path, basename ? (extension ? `${basename}.${extension}` : basename) : "");
    this.basename = basename;
    this.extension = extension;
  }
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

export class App {
  vault: any = {
    _files: new Map<string, any>(),
    on: () => ({}),
    getAbstractFileByPath(path: string) {
      return this._files?.get(path) ?? null;
    },
    create: async (_path: string, _data: string) => ({ path: _path }),
  };
  workspace: any = {
    on: (_name: string, _cb: any) => ({}),
    onLayoutReady: (_cb: any) => {},
    getLeavesOfType: () => [],
    getActiveFile: () => null,
    getActiveViewOfType: () => null,
    getLeaf: () => ({ openFile: async () => {} }),
  };
  fileManager: any = {
    getNewFileParent: () => null,
  };
}

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
