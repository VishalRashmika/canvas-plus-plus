import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { DiagramNode } from "../src/domain/entities/DiagramNode";
import { Group } from "../src/domain/entities/Group";

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

describe("Native Obsidian Canvas Inline Node Name Editing", () => {
  let editor: DiagramEditor;
  let container: MockElement;
  let renderer: SvgSceneRenderer;
  let rectNode: DiagramNode;
  let classNode: DiagramNode;
  let noteNode: DiagramNode;

  beforeEach(() => {
    editor = new DiagramEditor(
      createDiagram({ id: "diag-inline", title: "Inline Test", diagramType: "general" })
    );

    rectNode = editor.addNode({
      kind: "generic.rectangle",
      title: "My Service",
      position: { x: 100, y: 100 },
      size: { width: 140, height: 80 },
    });

    classNode = editor.addNode({
      kind: "uml.class",
      title: "UserService",
      position: { x: 300, y: 100 },
      size: { width: 160, height: 90 },
    });

    noteNode = editor.addNode({
      kind: "generic.note",
      title: "Design note",
      position: { x: 500, y: 100 },
      size: { width: 130, height: 80 },
    });

    container = new MockElement("div", { cls: "umlcanvas-view-container" });
    renderer = new SvgSceneRenderer(container as any, editor);
  });

  describe("In-Place Inline Editor Creation", () => {
    it("should create a textarea instead of a popup input box", () => {
      renderer.startInlineEditor(rectNode);

      const activeEditor = renderer.activeInlineEditor;
      expect(activeEditor).not.toBeNull();
      expect(activeEditor?.tagName).toBe("TEXTAREA");
      expect(activeEditor?.classList.contains("umlcanvas-node-inline-editor")).toBe(true);
      expect(activeEditor?.classList.contains("umlcanvas-inline-editor")).toBe(true);
      expect(activeEditor?.value).toBe("My Service");
    });

    it("should mark the node with umlcanvas-node-editing class to hide static labels", () => {
      renderer.startInlineEditor(rectNode);

      expect(renderer.activeEditingNodeId).toBe(rectNode.id);
      const nodeEl = container.querySelector(`[data-node-id="${rectNode.id}"]`);
      expect(nodeEl).not.toBeNull();
      expect(nodeEl?.classList.contains("umlcanvas-node-editing")).toBe(true);
    });

    it("should calculate in-place bounds centered on the node for rectangle shapes", () => {
      const bounds = renderer.getNodeInPlaceEditorBounds(rectNode);
      expect(bounds.x).toBe(rectNode.position.x + 8);
      expect(bounds.width).toBe(rectNode.size.width - 16);
      expect(bounds.textAlign).toBe("center");
      // Vertically centered inside the node
      expect(bounds.y).toBeGreaterThan(rectNode.position.y);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(rectNode.position.y + rectNode.size.height);
    });

    it("should calculate header in-place bounds for UML class shapes", () => {
      const bounds = renderer.getNodeInPlaceEditorBounds(classNode);
      expect(bounds.x).toBe(classNode.position.x + 8);
      expect(bounds.width).toBe(classNode.size.width - 16);
      expect(bounds.textAlign).toBe("center");
      expect(bounds.y).toBe(classNode.position.y + 4);
    });

    it("should calculate left-aligned in-place bounds for note shapes", () => {
      const bounds = renderer.getNodeInPlaceEditorBounds(noteNode);
      expect(bounds.x).toBe(noteNode.position.x + 10);
      expect(bounds.y).toBe(noteNode.position.y + 10);
      expect(bounds.textAlign).toBe("left");
    });
  });

  describe("Committing and Canceling In-Place Edits", () => {
    it("should commit the new node label when commitInlineEditor is called", () => {
      renderer.startInlineEditor(rectNode);

      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "Updated Service Name";
      renderer.commitInlineEditor();

      expect(rectNode.labels[0].text).toBe("Updated Service Name");
      expect(renderer.activeInlineEditor).toBeNull();
      expect(renderer.activeEditingNodeId).toBeNull();

      const nodeEl = container.querySelector(`[data-node-id="${rectNode.id}"]`);
      expect(nodeEl?.classList.contains("umlcanvas-node-editing")).toBe(false);
    });

    it("should commit on Enter key without shift", () => {
      renderer.startInlineEditor(rectNode);
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "AuthService";

      activeEditor.dispatch("keydown", { key: "Enter", shiftKey: false });

      expect(rectNode.labels[0].text).toBe("AuthService");
      expect(renderer.activeInlineEditor).toBeNull();
    });

    it("should allow multiline editing when Shift+Enter is pressed", () => {
      renderer.startInlineEditor(rectNode);
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "Line 1";

      // Shift+Enter should NOT commit
      activeEditor.dispatch("keydown", { key: "Enter", shiftKey: true });
      expect(renderer.activeInlineEditor).not.toBeNull();

      // Now add line 2 and commit with Enter
      activeEditor.value = "Line 1\nLine 2";
      activeEditor.dispatch("keydown", { key: "Enter", shiftKey: false });
      expect(rectNode.labels[0].text).toBe("Line 1\nLine 2");
      expect(renderer.activeInlineEditor).toBeNull();
    });

    it("should commit on Escape key (native Obsidian canvas behavior)", () => {
      renderer.startInlineEditor(rectNode);
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "EscapeSavedName";

      activeEditor.dispatch("keydown", { key: "Escape" });

      expect(rectNode.labels[0].text).toBe("EscapeSavedName");
      expect(renderer.activeInlineEditor).toBeNull();
    });

    it("should commit on blur event", () => {
      renderer.startInlineEditor(rectNode);
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "BlurredName";

      activeEditor.dispatch("blur");

      expect(rectNode.labels[0].text).toBe("BlurredName");
      expect(renderer.activeInlineEditor).toBeNull();
    });

    it("should cancel without updating label when cancelInlineEditor is called", () => {
      renderer.startInlineEditor(rectNode);
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "DiscardedText";

      renderer.cancelInlineEditor();

      expect(rectNode.labels[0].text).toBe("My Service");
      expect(renderer.activeInlineEditor).toBeNull();
      expect(renderer.activeEditingNodeId).toBeNull();
    });
  });

  describe("Pan and Zoom Position Synchronization", () => {
    it("should update in-place editor position when viewport transform changes", () => {
      renderer.startInlineEditor(rectNode);
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;

      const initialLeft = activeEditor.style.left;
      const initialTop = activeEditor.style.top;

      // Pan the canvas
      renderer.setTransform({ panX: 100, panY: 50, zoom: 1.0 });

      expect(activeEditor.style.left).not.toBe(initialLeft);
      expect(activeEditor.style.top).not.toBe(initialTop);

      // Zoom the canvas
      renderer.setTransform({ panX: 0, panY: 0, zoom: 2.0 });
      const bounds = renderer.getNodeInPlaceEditorBounds(rectNode);
      expect(activeEditor.style.width).toBe(`${bounds.width * 2}px`);
      expect(activeEditor.style.fontSize).toBe(`${13 * 2}px`);
    });
  });

  describe("Interaction Triggers", () => {
    it("should not open multiple concurrent editors, committing the previous one", () => {
      renderer.startInlineEditor(rectNode);
      const activeEditor1 = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor1.value = "ServiceOne";

      renderer.startInlineEditor(classNode);

      expect(rectNode.labels[0].text).toBe("ServiceOne");
      expect(renderer.activeEditingNodeId).toBe(classNode.id);
      expect(renderer.activeInlineEditor?.value).toBe("UserService");
    });

    it("should focus existing editor if startInlineEditor is called for same node", () => {
      renderer.startInlineEditor(rectNode);
      const initialEditor = renderer.activeInlineEditor;

      renderer.startInlineEditor(rectNode);
      expect(renderer.activeInlineEditor).toBe(initialEditor);
    });

    it("should start in-place editor when double-clicking on a node", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const nodeEl = container.querySelector(`[data-node-id="${rectNode.id}"]`);
      expect(svgEl).not.toBeNull();
      expect(nodeEl).not.toBeNull();

      svgEl?.dispatch("dblclick", {
        target: nodeEl,
        clientX: 120,
        clientY: 120,
      });

      expect(renderer.activeEditingNodeId).toBe(rectNode.id);
      expect(renderer.activeInlineEditor?.tagName).toBe("TEXTAREA");
      expect(renderer.activeInlineEditor?.value).toBe("My Service");
    });

    it("should start in-place editor when clicking an already-selected node without dragging", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const nodeEl = container.querySelector(`[data-node-id="${rectNode.id}"]`);
      expect(svgEl).not.toBeNull();

      // First click: selects the node
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: nodeEl,
        clientX: 120,
        clientY: 120,
      });
      (window as any).dispatch("mouseup", {
        clientX: 120,
        clientY: 120,
      });
      expect(editor.isNodeSelected(rectNode.id)).toBe(true);
      expect(renderer.activeInlineEditor).toBeNull();

      // Second click on the already-selected node: starts in-place editor
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: nodeEl,
        clientX: 120,
        clientY: 120,
      });
      (window as any).dispatch("mouseup", {
        clientX: 120,
        clientY: 120,
      });
      expect(renderer.activeEditingNodeId).toBe(rectNode.id);
      expect(renderer.activeInlineEditor).not.toBeNull();
    });

    it("should move the node and NOT enter inline edit when dragging an already-selected node", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const nodeEl = container.querySelector(`[data-node-id="${rectNode.id}"]`);

      // Ensure node is selected
      editor.selectNode(rectNode.id, false);

      // Mouse down to start move
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: nodeEl,
        clientX: 120,
        clientY: 120,
      });

      // Mouse move 30px
      (window as any).dispatch("mousemove", {
        clientX: 150,
        clientY: 150,
      });

      // Mouse up to complete drag
      (window as any).dispatch("mouseup", {
        clientX: 150,
        clientY: 150,
      });

      // Inline editor should NOT have opened
      expect(renderer.activeInlineEditor).toBeNull();
      // Node position should have changed
      expect(rectNode.position.x).toBe(130);
      expect(rectNode.position.y).toBe(130);
    });

    it("should adjust editor height when typing multiline text", () => {
      renderer.startInlineEditor(rectNode);
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      const initialH = activeEditor.style.height;

      activeEditor.value = "Line 1\nLine 2\nLine 3\nLine 4";
      activeEditor.dispatch("input");

      expect(activeEditor.style.height).not.toBe(initialH);
    });
  });

  describe("Group Name Inline Editing", () => {
    let group: Group;

    beforeEach(() => {
      editor.selectNode(rectNode.id, false);
      editor.selectNode(classNode.id, true);
      group = editor.groupSelection("Services Group")!;
      editor.clearSelection();
      renderer.render();
    });

    it("should start group inline editor and hide static group title", () => {
      renderer.startGroupInlineEditor(group);

      const activeEditor = renderer.activeInlineEditor;
      expect(activeEditor).not.toBeNull();
      expect(activeEditor?.tagName).toBe("INPUT");
      expect(activeEditor?.classList.contains("umlcanvas-group-inline-editor")).toBe(true);
      expect(activeEditor?.value).toBe("Services Group");

      expect(renderer.activeEditingGroupId).toBe(group.id);
      const groupEl = container.querySelector(`[data-group-id="${group.id}"]`);
      expect(groupEl?.classList.contains("umlcanvas-group-editing")).toBe(true);
    });

    it("should commit edited group name on Enter key", () => {
      renderer.startGroupInlineEditor(group);
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "New Services Name";

      activeEditor.dispatch("keydown", { key: "Enter" });

      expect(group.name).toBe("New Services Name");
      expect(renderer.activeInlineEditor).toBeNull();
      expect(renderer.activeEditingGroupId).toBeNull();

      const groupEl = container.querySelector(`[data-group-id="${group.id}"]`);
      expect(groupEl?.classList.contains("umlcanvas-group-editing")).toBe(false);
    });

    it("should commit edited group name on Escape key", () => {
      renderer.startGroupInlineEditor(group);
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "Escape Group Name";

      activeEditor.dispatch("keydown", { key: "Escape" });

      expect(group.name).toBe("Escape Group Name");
      expect(renderer.activeInlineEditor).toBeNull();
    });

    it("should commit edited group name on blur event", () => {
      renderer.startGroupInlineEditor(group);
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "Blurred Group Name";

      activeEditor.dispatch("blur");

      expect(group.name).toBe("Blurred Group Name");
      expect(renderer.activeInlineEditor).toBeNull();
    });

    it("should not rename if text is empty when committing", () => {
      renderer.startGroupInlineEditor(group);
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;
      activeEditor.value = "   ";

      activeEditor.dispatch("keydown", { key: "Enter" });

      expect(group.name).toBe("Services Group");
    });

    it("should isolate events on input element so canvas is not clicked or panned", () => {
      renderer.startGroupInlineEditor(group);
      const activeEditor = renderer.activeInlineEditor as unknown as MockElement;

      // Mouse down on input should not dismiss or start dragging
      activeEditor.dispatch("mousedown", { clientX: 100, clientY: 100 });
      expect(renderer.activeInlineEditor).not.toBeNull();
      expect(renderer.activeEditingGroupId).toBe(group.id);
    });

    it("should start group inline editor when double-clicking group title or header", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const titleEl = container.querySelector(".umlcanvas-group-title");
      expect(svgEl).not.toBeNull();
      expect(titleEl).not.toBeNull();

      svgEl?.dispatch("dblclick", {
        target: titleEl,
        clientX: 100,
        clientY: 100,
      });

      expect(renderer.activeEditingGroupId).toBe(group.id);
      expect(renderer.activeInlineEditor?.value).toBe("Services Group");
    });

    it("should start group inline editor when clicking an already-selected group", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const headerEl = container.querySelector(".umlcanvas-group-header-bg");
      expect(svgEl).not.toBeNull();
      expect(headerEl).not.toBeNull();

      // First click: selects the group
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: headerEl,
        clientX: 100,
        clientY: 100,
      });
      (window as any).dispatch("mouseup", {
        clientX: 100,
        clientY: 100,
      });
      expect(editor.isGroupSelected(group.id)).toBe(true);
      expect(renderer.activeInlineEditor).toBeNull();

      // Second click on already-selected group: enters inline editor
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: headerEl,
        clientX: 100,
        clientY: 100,
      });
      (window as any).dispatch("mouseup", {
        clientX: 100,
        clientY: 100,
      });
      expect(renderer.activeEditingGroupId).toBe(group.id);
      expect(renderer.activeInlineEditor).not.toBeNull();
    });

    it("should start group inline editor when clicking group title directly", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const titleEl = container.querySelector(".umlcanvas-group-title");
      expect(svgEl).not.toBeNull();
      expect(titleEl).not.toBeNull();

      svgEl?.dispatch("mousedown", {
        button: 0,
        target: titleEl,
        clientX: 100,
        clientY: 100,
      });
      (window as any).dispatch("mouseup", {
        clientX: 100,
        clientY: 100,
      });

      expect(renderer.activeEditingGroupId).toBe(group.id);
      expect(renderer.activeInlineEditor).not.toBeNull();
    });

    it("should move the group and NOT enter inline edit when dragging a group", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const headerEl = container.querySelector(".umlcanvas-group-header-bg");
      editor.selectGroup(group.id, false);

      svgEl?.dispatch("mousedown", {
        button: 0,
        target: headerEl,
        clientX: 100,
        clientY: 100,
      });
      (window as any).dispatch("mousemove", {
        clientX: 140,
        clientY: 140,
      });
      (window as any).dispatch("mouseup", {
        clientX: 140,
        clientY: 140,
      });

      expect(renderer.activeInlineEditor).toBeNull();
    });
  });
});
