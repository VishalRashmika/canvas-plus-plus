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
  registerExtensions(extensions: string[], viewType: string) {
    if (!this.app) this.app = {};
    if (!this.app.viewRegistry) {
      this.app.viewRegistry = { typeByExtension: {} };
    }
    for (const ext of extensions) {
      const lower = ext.toLowerCase();
      if (this.app.viewRegistry.typeByExtension[lower]) {
        throw new Error(
          `Extension ${ext} has already been registered to ${this.app.viewRegistry.typeByExtension[lower]}`
        );
      }
      this.app.viewRegistry.typeByExtension[lower] = viewType;
    }
  }
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

export function createMockElement(tagName = "div"): any {
  const el: any = {
    tagName,
    className: "",
    children: [],
    style: {},
    classList: {
      classes: new Set<string>(),
      add: (...cls: string[]) => {
        cls.forEach((c) => c && c.split(" ").forEach((k) => k && el.classList.classes.add(k)));
        el.className = Array.from(el.classList.classes).join(" ");
      },
      remove: (...cls: string[]) => {
        cls.forEach((c) => c && c.split(" ").forEach((k) => k && el.classList.classes.delete(k)));
        el.className = Array.from(el.classList.classes).join(" ");
      },
      contains: (c: string) => el.classList.classes.has(c),
    },
    empty: () => {
      el.children = [];
      el.innerHTML = "";
    },
    createDiv: (opts?: any) => {
      const child = createMockElement("div");
      if (opts?.cls) child.className = opts.cls;
      el.children.push(child);
      return child;
    },
    createEl: (tag: string, opts?: any) => {
      const child = createMockElement(tag);
      if (opts?.cls) child.className = opts.cls;
      el.children.push(child);
      return child;
    },
    appendChild: (child: any) => {
      el.children.push(child);
      return child;
    },
    remove: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  return el;
}

export class TextFileView {
  app: any;
  leaf: any;
  file: TFile | null = null;
  data: string = "";
  contentEl: HTMLElement = typeof document !== "undefined" ? document.createElement("div") : createMockElement("div");
  constructor(leaf: any) {
    this.leaf = leaf;
    this.app = leaf?.app;
  }
  canAcceptExtension(_extension: string): boolean {
    return false;
  }
  async onLoadFile(file: TFile): Promise<void> {
    this.file = file;
    if (this.app?.vault?.read) {
      try {
        this.data = await this.app.vault.read(file);
      } catch {}
    }
    if (typeof (this as any).setViewData === "function") {
      (this as any).setViewData(this.data, true);
    }
  }
  async onClose(): Promise<void> {}
}

export class WorkspaceLeaf {
  view: any;
  async openFile(file: TFile): Promise<void> {
    if (this.view && typeof this.view.canAcceptExtension === "function") {
      if (!this.view.canAcceptExtension(file.extension)) {
        throw new Error(`Failed to open "${file.path || ""}"`);
      }
    }
  }
}
export class MenuItem {
  title: string = "";
  icon: string = "";
  onClickHandler?: () => any;
  submenu?: Menu;
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
  setSubmenu(): Menu {
    const sub = new Menu();
    this.submenu = sub;
    return sub;
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
  viewRegistry: any = {
    typeByExtension: {
      canvas: "canvas",
      md: "markdown",
    },
  };
}

export function setIcon(_parent: HTMLElement, _iconId: string): void {}

export type EventRef = any;

if (typeof HTMLElement !== "undefined") {
  if (!(HTMLElement.prototype as any).empty) {
    (HTMLElement.prototype as any).empty = function () {
      this.innerHTML = "";
    };
  }
  if (!(HTMLElement.prototype as any).createDiv) {
    (HTMLElement.prototype as any).createDiv = function (opts?: any) {
      const div = document.createElement("div");
      if (opts?.cls) div.className = opts.cls;
      this.appendChild(div);
      return div;
    };
  }
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
