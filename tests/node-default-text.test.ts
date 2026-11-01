import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { defaultShapeRegistry } from "../src/presentation/renderer/ShapeRegistry";
import { Toolbar } from "../src/presentation/views/Toolbar";
import { Point } from "../src/domain/value-objects/Point";

// Mock DOM element for headless Node / Jest environment
class MockElement {
  tagName: string;
  className: string = "";
  classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => {
      cls.forEach((c) => c && c.split(" ").forEach((k) => k && this.classList.classes.add(k)));
      this.className = Array.from(this.classList.classes).join(" ");
    },
    remove: (...cls: string[]) => {
      cls.forEach((c) => c && c.split(" ").forEach((k) => k && this.classList.classes.delete(k)));
      this.className = Array.from(this.classList.classes).join(" ");
    },
    toggle: (c: string, force?: boolean) => {
      const willHave = force !== undefined ? force : !this.classList.contains(c);
      if (willHave) this.classList.add(c);
      else this.classList.remove(c);
      return willHave;
    },
    contains: (c: string) => this.classList.classes.has(c),
  };
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  listeners: Record<string, ((e: any) => void)[]> = {};
  title: string = "";
  disabled: boolean = false;
  value: string = "";
  clientWidth: number = 1000;
  clientHeight: number = 800;

  constructor(tagName: string, options?: any) {
    this.tagName = tagName.toUpperCase();
    if (options?.cls) {
      this.classList.add(options.cls);
    }
    if (options?.text) {
      this.textContent = options.text;
    }
    if (options?.title) {
      this.title = options.title;
    }
    if (options?.value) {
      this.value = options.value;
    }
    if (options?.attr) {
      for (const [k, v] of Object.entries(options.attr)) {
        this.attributes[k] = String(v);
      }
    }
  }

  createDiv(options?: any): MockElement {
    const el = new MockElement("div", options);
    this.appendChild(el);
    return el;
  }

  createSpan(options?: any): MockElement {
    const el = new MockElement("span", options);
    this.appendChild(el);
    return el;
  }

  createEl(tag: string, options?: any): MockElement {
    const el = new MockElement(tag, options);
    this.appendChild(el);
    return el;
  }

  createSvg(tag: string, options?: any): MockElement {
    const el = new MockElement(tag, options);
    this.appendChild(el);
    return el;
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  prepend(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.unshift(child);
    return child;
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        this.parentElement.children.splice(idx, 1);
      }
      this.parentElement = null;
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") {
      this.classList.add(...value.split(" "));
    }
  }

  setAttributeNS(_ns: any, name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") {
      this.classList.add(...value.split(" "));
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  setCssStyles(styles: Record<string, string>): void {
    Object.assign(this.style, styles);
  }

  setCssProps(props: Record<string, string>): void {
    Object.assign(this.style, props);
  }

  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (e: any) => void): void {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
    }
  }

  focus(): void {}
  select(): void {}

  dispatch(event: string, detail: any = {}): void {
    const handlers = [...(this.listeners[event] || [])];
    const evt = {
      stopPropagation: () => {},
      preventDefault: () => {},
      target: this,
      ...detail,
    };
    handlers.forEach((h) => h(evt));
  }

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
    };
  }

  private _textContent: string = "";
  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map((c) => c.textContent).join("");
  }
  set textContent(val: string) {
    this._textContent = val;
    this.children.forEach((c) => (c.parentElement = null));
    this.children = [];
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const check = (el: MockElement) => {
      let matches = false;
      if (selector.startsWith(".")) {
        const cls = selector.slice(1);
        if (el.classList.contains(cls)) matches = true;
      } else if (selector.includes("[") && selector.includes("]")) {
        const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)\*?=["']?([^"'\]]+)["']?\]/);
        if (attrMatch) {
          const attrName = attrMatch[1];
          const val = attrMatch[2];
          const actual = el.getAttribute(attrName) || "";
          if (actual === val || actual.includes(val)) {
            matches = true;
          }
        }
      } else if (selector.toLowerCase() === el.tagName.toLowerCase()) {
        matches = true;
      }
      if (matches) results.push(el);
      el.children.forEach(check);
    };
    this.children.forEach(check);
    return results;
  }

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (selector.startsWith(".")) {
        const classes = selector.split(",").map((s) => s.trim().replace(/^\./, ""));
        for (const cls of classes) {
          if (curr.classList.contains(cls)) return curr;
        }
      }
      curr = curr.parentElement;
    }
    return null;
  }
}

// Setup environment mocks
const mockDocument = {
  createElement: (tag: string) => new MockElement(tag),
  createElementNS: (_ns: string, tag: string) => new MockElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {},
};

(global as any).document = mockDocument;
const windowListeners: Record<string, ((e: any) => void)[]> = {};
(global as any).window = {
  addEventListener: (event: string, handler: (e: any) => void) => {
    if (!windowListeners[event]) windowListeners[event] = [];
    windowListeners[event].push(handler);
  },
  removeEventListener: (event: string, handler: (e: any) => void) => {
    if (windowListeners[event]) {
      windowListeners[event] = windowListeners[event].filter((h) => h !== handler);
    }
  },
  dispatch: (event: string, detail: any = {}) => {
    const handlers = [...(windowListeners[event] || [])];
    const evt = { stopPropagation: () => {}, preventDefault: () => {}, ...detail };
    handlers.forEach((h) => h(evt));
  },
  setTimeout: (cb: () => void) => {
    cb();
    return 0;
  },
  clearTimeout: () => {},
};
(global as any).createDiv = (options?: any) => new MockElement("div", options);
(global as any).createSpan = (options?: any) => new MockElement("span", options);
(global as any).createEl = (tag: string, options?: any) => new MockElement(tag, options);

describe("Node and Component Default Texts", () => {
  let editor: DiagramEditor;
  let container: MockElement;
  let renderer: SvgSceneRenderer;

  beforeEach(() => {
    editor = new DiagramEditor(
      createDiagram({
        id: "test-diagram",
        title: "Test Diagram",
        diagramType: "general",
      })
    );
    container = new MockElement("div", { cls: "umlcanvas-container" });
    renderer = new SvgSceneRenderer(container as any, editor);
  });

  afterEach(() => {
    renderer.destroy();
  });

  describe("Double-click on canvas creates a node", () => {
    it("should set title to 'Node' instead of 'New Class' when double clicking empty canvas", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      expect(svgEl).not.toBeNull();

      svgEl?.dispatch("dblclick", {
        clientX: 200,
        clientY: 200,
      });

      expect(editor.diagram.nodes.length).toBe(1);
      const createdNode = editor.diagram.nodes[0];
      expect(createdNode.title).toBe("Node");
      expect(createdNode.labels[0].text).toBe("Node");
      expect(createdNode.title).not.toBe("New Class");
    });

    it("should auto-contain into group with default title 'Node'", () => {
      const group = editor.addGroup({
        position: { x: 50, y: 50 },
        size: { width: 400, height: 300 },
        name: "Group",
      });

      const svgEl = container.querySelector(".umlcanvas-svg");
      // Double click inside group bounds
      svgEl?.dispatch("dblclick", {
        clientX: 150,
        clientY: 150,
      });

      expect(editor.diagram.nodes.length).toBe(1);
      const createdNode = editor.diagram.nodes[0];
      expect(createdNode.title).toBe("Node");
      expect(createdNode.title).not.toBe("New Class");
      expect(group.nodeIds).toContain(createdNode.id);
    });
  });

  describe("DiagramEditor.addNode() default texts for components/shapes", () => {
    it("should default to 'Node' when no title or kind is specified", () => {
      const node = editor.addNode();
      expect(node.title).toBe("Node");
      expect(node.labels[0].text).toBe("Node");
      expect(node.title).not.toBe("New Node");
      expect(node.title).not.toBe("New Class");
    });

    it("should default generic.rectangle to 'Node'", () => {
      const node = editor.addNode({ kind: "generic.rectangle" });
      expect(node.title).toBe("Node");
      expect(node.labels[0].text).toBe("Node");
    });

    it("should default uml.class to 'Class', NOT 'New Class'", () => {
      const node = editor.addNode({ kind: "uml.class" });
      expect(node.title).toBe("Class");
      expect(node.labels[0].text).toBe("Class");
      expect(node.title).not.toBe("New Class");
    });

    it("should default uml.component to 'Component'", () => {
      const node = editor.addNode({ kind: "uml.component" });
      expect(node.title).toBe("Component");
      expect(node.labels[0].text).toBe("Component");
    });

    it("should default uml.package to 'Package'", () => {
      const node = editor.addNode({ kind: "uml.package" });
      expect(node.title).toBe("Package");
    });

    it("should default uml.interface to 'Interface'", () => {
      const node = editor.addNode({ kind: "uml.interface" });
      expect(node.title).toBe("Interface");
    });

    it("should default uml.abstractClass to 'Abstract Class'", () => {
      const node = editor.addNode({ kind: "uml.abstractClass" });
      expect(node.title).toBe("Abstract Class");
    });

    it("should default uml.enumeration to 'Enumeration'", () => {
      const node = editor.addNode({ kind: "uml.enumeration" });
      expect(node.title).toBe("Enumeration");
    });

    it("should default uml.actor to 'Actor'", () => {
      const node = editor.addNode({ kind: "uml.actor" });
      expect(node.title).toBe("Actor");
    });

    it("should default uml.useCase to 'Use Case'", () => {
      const node = editor.addNode({ kind: "uml.useCase" });
      expect(node.title).toBe("Use Case");
    });

    it("should default uml.node3d to 'Node' (not 'Node (3D Box)')", () => {
      const node = editor.addNode({ kind: "uml.node3d" });
      expect(node.title).toBe("Node");
    });

    it("should default uml.device to 'Device'", () => {
      const node = editor.addNode({ kind: "uml.device" });
      expect(node.title).toBe("Device");
    });

    it("should default uml.artifact to 'Artifact'", () => {
      const node = editor.addNode({ kind: "uml.artifact" });
      expect(node.title).toBe("Artifact");
    });

    it("should default activity.action to 'Action'", () => {
      const node = editor.addNode({ kind: "activity.action" });
      expect(node.title).toBe("Action");
    });

    it("should default state.simple to 'State'", () => {
      const node = editor.addNode({ kind: "state.simple" });
      expect(node.title).toBe("State");
    });

    it("should default sequence.lifeline to 'Lifeline'", () => {
      const node = editor.addNode({ kind: "sequence.lifeline" });
      expect(node.title).toBe("Lifeline");
    });

    it("should default generic.stickyNote to 'Sticky Note'", () => {
      const node = editor.addNode({ kind: "generic.stickyNote" });
      expect(node.title).toBe("Sticky Note");
    });

    it("should default generic.circle to 'Circle'", () => {
      const node = editor.addNode({ kind: "generic.circle" });
      expect(node.title).toBe("Circle");
    });

    it("should default generic.diamond to 'Diamond'", () => {
      const node = editor.addNode({ kind: "generic.diamond" });
      expect(node.title).toBe("Diamond");
    });

    it("should default generic.triangle to 'Triangle'", () => {
      const node = editor.addNode({ kind: "generic.triangle" });
      expect(node.title).toBe("Triangle");
    });

    it("should default generic.image to 'Image'", () => {
      const node = editor.addNode({ kind: "generic.image" });
      expect(node.title).toBe("Image");
    });

    it("should default generic.table to empty string", () => {
      const node = editor.addNode({ kind: "generic.table" });
      expect(node.title).toBe("");
    });

    it("should preserve explicit empty title without replacing it with default", () => {
      const node = editor.addNode({ kind: "generic.rectangle", title: "" });
      expect(node.title).toBe("");
    });

    it("should preserve custom title when explicitly provided", () => {
      const node = editor.addNode({ kind: "generic.rectangle", title: "Custom Title" });
      expect(node.title).toBe("Custom Title");
    });
  });

  describe("ShapeRegistry defaultTitle definitions", () => {
    it("generic.rectangle should have defaultTitle 'Node'", () => {
      const def = defaultShapeRegistry.get("generic.rectangle");
      expect(def.defaultTitle).toBe("Node");
    });

    it("uml.class should have defaultTitle 'Class'", () => {
      const def = defaultShapeRegistry.get("uml.class");
      expect(def.defaultTitle).toBe("Class");
    });

    it("uml.node3d should have defaultTitle 'Node'", () => {
      const def = defaultShapeRegistry.get("uml.node3d");
      expect(def.defaultTitle).toBe("Node");
    });

    it("generic.image should have defaultTitle 'Image'", () => {
      const def = defaultShapeRegistry.get("generic.image");
      expect(def.defaultTitle).toBe("Image");
    });

    it("uml.lollipop should have defaultTitle 'Interface'", () => {
      const def = defaultShapeRegistry.get("uml.lollipop");
      expect(def.defaultTitle).toBe("Interface");
    });

    it("uml.socket should have defaultTitle 'Interface'", () => {
      const def = defaultShapeRegistry.get("uml.socket");
      expect(def.defaultTitle).toBe("Interface");
    });
  });

  describe("Drop handling with defaultTitle", () => {
    it("should use defaultTitle when dropping a shape kind", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const dropEvt = {
        dataTransfer: {
          getData: (format: string) => {
            if (format === "application/x-umlcanvas-shape") return "generic.rectangle";
            return "";
          },
        },
        clientX: 300,
        clientY: 200,
      };

      svgEl?.dispatch("drop", dropEvt);

      expect(editor.diagram.nodes.length).toBe(1);
      const droppedNode = editor.diagram.nodes[0];
      expect(droppedNode.title).toBe("Node");
    });

    it("should use defaultTitle when dropping 3D node", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const dropEvt = {
        dataTransfer: {
          getData: (format: string) => {
            if (format === "application/x-umlcanvas-shape") return "uml.node3d";
            return "";
          },
        },
        clientX: 300,
        clientY: 200,
      };

      svgEl?.dispatch("drop", dropEvt);

      expect(editor.diagram.nodes.length).toBe(1);
      const droppedNode = editor.diagram.nodes[0];
      expect(droppedNode.title).toBe("Node");
      expect(droppedNode.title).not.toBe("Node (3D Box)");
    });

    it("should use defaultTitle when dropping via text/plain fallback", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const dropEvt = {
        dataTransfer: {
          getData: (format: string) => {
            if (format === "text/plain") return "uml.component";
            return "";
          },
        },
        clientX: 300,
        clientY: 200,
      };

      svgEl?.dispatch("drop", dropEvt);

      expect(editor.diagram.nodes.length).toBe(1);
      const droppedNode = editor.diagram.nodes[0];
      expect(droppedNode.title).toBe("Component");
    });
  });

  describe("Toolbar shape creation", () => {
    let toolbar: Toolbar;
    beforeEach(() => {
      toolbar = new Toolbar(container as any, editor, renderer);
    });

    it("Rectangle button should create a node titled 'Node'", () => {
      const rectBtn = (toolbar as any).rectBtn;
      expect(rectBtn).toBeDefined();

      if (typeof rectBtn.dispatch === "function") {
        rectBtn.dispatch("click");
      } else if (typeof rectBtn.click === "function") {
        rectBtn.click();
      }
      expect(editor.diagram.nodes.length).toBe(1);
      expect(editor.diagram.nodes[0].title).toBe("Node");
      expect(editor.diagram.nodes[0].title).not.toBe("New Class");
    });

    it("addImageAtCenter should default to 'Image' instead of 'Photo Title'", () => {
      toolbar.addImageAtCenter();
      expect(editor.diagram.nodes.length).toBe(1);
      expect(editor.diagram.nodes[0].title).toBe("Image");
      expect(editor.diagram.nodes[0].title).not.toBe("Photo Title");
    });

    it("addGroupBoxAtCenter should default to 'Group' instead of 'New Group'", () => {
      toolbar.addGroupBoxAtCenter();
      expect(editor.diagram.groups.length).toBe(1);
      expect(editor.diagram.groups[0].name).toBe("Group");
      expect(editor.diagram.groups[0].name).not.toBe("New Group");
    });
  });

  describe("DiagramEditor.addGroup()", () => {
    it("should default name to 'Group', NOT 'New Group'", () => {
      const group = editor.addGroup();
      expect(group.name).toBe("Group");
      expect(group.name).not.toBe("New Group");
    });
  });
});
