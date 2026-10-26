import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { defaultShapeRegistry } from "../src/presentation/renderer/ShapeRegistry";

// MockElement for Jest test environment
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
  private _style: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  listeners: Record<string, ((e: any) => void)[]> = {};
  title: string = "";
  disabled: boolean = false;
  value: string = "";
  private _textContent: string = "";
  clientWidth: number = 1000;
  clientHeight: number = 800;
  scrollWidth: number = 1000;
  scrollHeight: number = 800;

  get style(): any {
    return new Proxy(this._style, {
      get: (target, prop: string) => {
        if (typeof prop !== "string") return (target as any)[prop];
        const camel = prop.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
        const kebab = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
        return target[prop] ?? target[camel] ?? target[kebab];
      },
      set: (target, prop: string, value: any) => {
        if (typeof prop !== "string") {
          (target as any)[prop] = value;
          return true;
        }
        const camel = prop.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
        const kebab = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
        target[prop] = String(value);
        target[camel] = String(value);
        target[kebab] = String(value);
        return true;
      },
    });
  }

  set style(val: any) {
    if (typeof val === "object" && val !== null) {
      Object.assign(this._style, val);
    }
  }

  constructor(tagName: string, options?: any) {
    this.tagName = tagName.toUpperCase();
    if (options?.cls) {
      this.classList.add(options.cls);
    }
    if (options?.text) {
      this._textContent = options.text;
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

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((c) => c.textContent).join("");
  }

  set textContent(val: string) {
    this._textContent = val;
    this.children = [];
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

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: MockElement): MockElement {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  insertBefore(newNode: MockElement, referenceNode: MockElement | null): MockElement {
    if (!referenceNode) return this.appendChild(newNode);
    const idx = this.children.indexOf(referenceNode);
    if (idx !== -1) {
      newNode.parentElement = this;
      this.children.splice(idx, 0, newNode);
    } else {
      this.appendChild(newNode);
    }
    return newNode;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") {
      this.classList.classes.clear();
      this.classList.add(...value.split(" "));
    }
  }

  setAttributeNS(_ns: any, name: string, value: string): void {
    this.setAttribute(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  addEventListener(type: string, listener: (e: any) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (e: any) => void): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  dispatch(type: string, event: any = {}): void {
    if (!event.target) event.target = this;
    if (this.listeners[type]) {
      this.listeners[type].forEach((l) => l(event));
    }
  }

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    const parts = selector.split(",").map((s) => s.trim());
    while (curr) {
      for (const part of parts) {
        if (part.startsWith(".") && curr.classList.contains(part.substring(1))) {
          return curr;
        }
        if (part.startsWith("#") && curr.attributes["id"] === part.substring(1)) {
          return curr;
        }
        if (part.toLowerCase() === curr.tagName.toLowerCase()) {
          return curr;
        }
        if (part.startsWith("[") && part.endsWith("]")) {
          const match = part.match(/\[([a-zA-Z0-9_-]+)(?:=([a-zA-Z0-9_-]+|"[^"]*"))?\]/);
          if (match) {
            const attr = match[1];
            const rawVal = match[2]?.replace(/^"|"$/g, "");
            if (rawVal !== undefined) {
              if (curr.getAttribute(attr) === rawVal) return curr;
            } else if (curr.attributes[attr] !== undefined) {
              return curr;
            }
          }
        }
      }
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector: string): MockElement | null {
    for (const child of this.children) {
      if (child.closest(selector)) return child;
      const res = child.querySelector(selector);
      if (res) return res;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const matches: MockElement[] = [];
    for (const child of this.children) {
      if (child.closest(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }

  getBoundingClientRect(): any {
    return {
      top: 0,
      left: 0,
      bottom: this.clientHeight,
      right: this.clientWidth,
      width: this.clientWidth,
      height: this.clientHeight,
      x: 0,
      y: 0,
    };
  }
}

describe("Group Containment and Component Moving (v2.0.7)", () => {
  let editor: DiagramEditor;

  beforeEach(() => {
    (global as any).document = {
      createElement: (tag: string) => new MockElement(tag),
      createElementNS: (_ns: string, tag: string) => new MockElement(tag),
      createTextNode: (txt: string) => new MockElement("text", { text: txt }),
    };
    (global as any).window = {
      addEventListener: (type: string, cb: any) => {
        if (!(global as any).window.listeners) (global as any).window.listeners = {};
        if (!(global as any).window.listeners[type]) (global as any).window.listeners[type] = [];
        (global as any).window.listeners[type].push(cb);
      },
      removeEventListener: (type: string, cb: any) => {
        if ((global as any).window.listeners?.[type]) {
          (global as any).window.listeners[type] = (global as any).window.listeners[type].filter((l: any) => l !== cb);
        }
      },
      dispatch: (type: string, event: any) => {
        (global as any).window.listeners?.[type]?.forEach((cb: any) => cb(event));
      },
    };

    const diagram = createDiagram({
      id: "diag-group-test",
      title: "Group Test",
      diagramType: "general",
    });
    editor = new DiagramEditor(diagram);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("when making a group, dragging & dropping a component inside the group groups it, and moving the group moves the component", () => {
    // 1. User makes a group box
    const group = editor.addGroup({
      name: "Services Group",
      position: { x: 100, y: 100 },
      size: { width: 400, height: 300 },
    });
    expect(group.nodeIds).toEqual([]);

    // 2. User has a component placed outside
    const node = editor.addNode({
      title: "AuthService",
      position: { x: 700, y: 700 },
      size: { width: 120, height: 60 },
    });
    expect(group.nodeIds).not.toContain(node.id);

    // 3. User drags and drops component inside the group (e.g. at x: 200, y: 200)
    editor.moveNodes([
      {
        nodeId: node.id,
        oldPos: { x: 700, y: 700 },
        newPos: { x: 200, y: 200 },
      },
    ]);

    // Component is now properly grouped inside the group
    expect(group.nodeIds).toContain(node.id);

    // 4. User moves the group by delta (x: 50, y: 80)
    editor.moveGroup(group.id, { x: 50, y: 80 });

    // Both the group and the component inside get moved!
    expect(group.position).toEqual({ x: 150, y: 180 });
    expect(node.position).toEqual({ x: 250, y: 280 });
  });

  test("moving multiple components inside a group moves all of them when the group moves", () => {
    const group = editor.addGroup({
      name: "Database Cluster",
      position: { x: 100, y: 100 },
      size: { width: 500, height: 400 },
    });

    const n1 = editor.addNode({ title: "Primary DB", position: { x: 800, y: 100 }, size: { width: 100, height: 60 } });
    const n2 = editor.addNode({ title: "Replica DB", position: { x: 800, y: 200 }, size: { width: 100, height: 60 } });

    // Drag and drop both nodes into the group
    editor.moveNodes([
      { nodeId: n1.id, oldPos: { x: 800, y: 100 }, newPos: { x: 150, y: 150 } },
      { nodeId: n2.id, oldPos: { x: 800, y: 200 }, newPos: { x: 300, y: 150 } },
    ]);

    expect(group.nodeIds).toContain(n1.id);
    expect(group.nodeIds).toContain(n2.id);

    // Move group
    editor.moveGroup(group.id, { x: 100, y: 50 });

    expect(group.position).toEqual({ x: 200, y: 150 });
    expect(n1.position).toEqual({ x: 250, y: 200 });
    expect(n2.position).toEqual({ x: 400, y: 200 });
  });

  test("dragging component out of group removes it from group and subsequent group move leaves it in place", () => {
    const group = editor.addGroup({
      name: "App Group",
      position: { x: 100, y: 100 },
      size: { width: 400, height: 300 },
    });

    const node = editor.addNode({ title: "App", position: { x: 200, y: 200 }, size: { width: 100, height: 60 } });
    expect(group.nodeIds).toContain(node.id);

    // Move component out of the group to (700, 700)
    editor.moveNodes([
      { nodeId: node.id, oldPos: { x: 200, y: 200 }, newPos: { x: 700, y: 700 } },
    ]);
    expect(group.nodeIds).not.toContain(node.id);

    // Moving group does NOT move the component
    editor.moveGroup(group.id, { x: 40, y: 40 });
    expect(group.position).toEqual({ x: 140, y: 140 });
    expect(node.position).toEqual({ x: 700, y: 700 });
  });

  test("adding a new component inside group bounds automatically groups it", () => {
    const group = editor.addGroup({
      name: "UI Container",
      position: { x: 50, y: 50 },
      size: { width: 350, height: 250 },
    });

    const node = editor.addNode({
      title: "Button Component",
      position: { x: 120, y: 120 },
      size: { width: 100, height: 50 },
    });

    expect(group.nodeIds).toContain(node.id);

    editor.moveGroup(group.id, { x: 30, y: 30 });
    expect(node.position).toEqual({ x: 150, y: 150 });
  });

  test("making a group over existing components automatically includes them", () => {
    const node = editor.addNode({
      title: "Existing Node",
      position: { x: 150, y: 150 },
      size: { width: 100, height: 60 },
    });

    const group = editor.addGroup({
      position: { x: 100, y: 100 },
      size: { width: 300, height: 200 },
    });

    expect(group.nodeIds).toContain(node.id);

    editor.moveGroup(group.id, { x: 25, y: 35 });
    expect(node.position).toEqual({ x: 175, y: 185 });
  });

  test("undo and redo cleanly restores group membership and positions", () => {
    const group = editor.addGroup({
      name: "Undo Test",
      position: { x: 100, y: 100 },
      size: { width: 400, height: 300 },
    });

    const node = editor.addNode({
      title: "Test Node",
      position: { x: 700, y: 700 },
      size: { width: 100, height: 60 },
    });

    // Move node into group
    editor.moveNodes([
      { nodeId: node.id, oldPos: { x: 700, y: 700 }, newPos: { x: 150, y: 150 } },
    ]);
    expect(group.nodeIds).toContain(node.id);

    // Move group
    editor.moveGroup(group.id, { x: 50, y: 50 });
    expect(group.position).toEqual({ x: 150, y: 150 });
    expect(node.position).toEqual({ x: 200, y: 200 });

    // Undo group move
    editor.undo();
    expect(group.position).toEqual({ x: 100, y: 100 });
    expect(node.position).toEqual({ x: 150, y: 150 });

    // Undo node move into group
    editor.undo();
    expect(node.position).toEqual({ x: 700, y: 700 });
    expect(group.nodeIds).not.toContain(node.id);

    // Redo node move into group
    editor.redo();
    expect(node.position).toEqual({ x: 150, y: 150 });
    expect(group.nodeIds).toContain(node.id);

    // Redo group move
    editor.redo();
    expect(group.position).toEqual({ x: 150, y: 150 });
    expect(node.position).toEqual({ x: 200, y: 200 });
  });

  test("resizing group dynamically updates group membership", () => {
    const group = editor.addGroup({
      name: "Resize Box",
      position: { x: 100, y: 100 },
      size: { width: 200, height: 200 },
    });

    const outsideNode = editor.addNode({
      title: "Outside Initially",
      position: { x: 350, y: 150 },
      size: { width: 80, height: 60 },
    });
    expect(group.nodeIds).not.toContain(outsideNode.id);

    // Expand group to cover outsideNode (width from 200 to 400)
    editor.resizeGroup(group.id, { x: 100, y: 100 }, { width: 400, height: 200 });
    expect(group.nodeIds).toContain(outsideNode.id);

    // Move group moves the newly covered node
    editor.moveGroup(group.id, { x: 50, y: 50 });
    expect(outsideNode.position).toEqual({ x: 400, y: 200 });
  });

  test("interactive visual drag of group in SvgSceneRenderer moves components inside", () => {
    const group = editor.addGroup({
      name: "Interactive Group",
      position: { x: 100, y: 100 },
      size: { width: 400, height: 300 },
    });

    const node = editor.addNode({
      title: "Child Component",
      position: { x: 600, y: 600 },
      size: { width: 100, height: 60 },
    });

    // Move component into group
    editor.moveNodes([
      { nodeId: node.id, oldPos: { x: 600, y: 600 }, newPos: { x: 150, y: 150 } },
    ]);
    expect(group.nodeIds).toContain(node.id);

    const container = new MockElement("div") as any;
    const renderer = new SvgSceneRenderer(container, editor);
    renderer.render();

    const groupHeader = container.querySelector(".umlcanvas-group-header-bg");
    expect(groupHeader).not.toBeNull();

    // 1. Mouse down on group header at client (120, 110)
    container.querySelector(".umlcanvas-svg")?.dispatch("mousedown", {
      button: 0,
      target: groupHeader,
      clientX: 120,
      clientY: 110,
    });

    // 2. Mouse move by +80px horizontally and +40px vertically
    (window as any).dispatch("mousemove", {
      clientX: 200,
      clientY: 150,
    });

    // During drag, node moved
    expect(node.position.x).toBe(150 + 80);
    expect(node.position.y).toBe(150 + 40);

    // 3. Mouse up to commit
    (window as any).dispatch("mouseup", {
      clientX: 200,
      clientY: 150,
    });

    expect(group.position).toEqual({ x: 180, y: 140 });
    expect(node.position).toEqual({ x: 230, y: 190 });
  });
});
