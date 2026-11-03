import {
  roundCoord,
  filterClosePoints,
  smoothPoints,
  pointsToSmoothSvgPath,
} from "../src/domain/services/FreehandSmoother";
import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";

// Headless MockElement for testing renderer & DOM events
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
    contains: (c: string) => this.classList.classes.has(c),
  };
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  listeners: Record<string, ((e: any) => void)[]> = {};

  constructor(tagName: string, options?: any) {
    this.tagName = tagName.toUpperCase();
    if (options?.cls) this.classList.add(options.cls);
    if (options?.text) this.textContent = options.text;
    if (options?.attr) {
      for (const [k, v] of Object.entries(options.attr)) {
        this.attributes[k] = String(v);
      }
    }
  }

  createSvg(tag: string, options?: any): MockElement {
    const el = new MockElement(tag, options);
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

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") this.classList.add(...value.split(" "));
  }

  setAttributeNS(_ns: any, name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "class") this.classList.add(...value.split(" "));
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
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

  dispatch(event: string, detail: any = {}): void {
    const handlers = [...(this.listeners[event] || [])];
    const evt = { stopPropagation: () => {}, preventDefault: () => {}, target: this, ...detail };
    handlers.forEach((h) => h(evt));
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 };
  }

  private _textContent: string = "";
  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map((c) => c.textContent).join("");
  }
  set textContent(val: string) {
    this._textContent = val;
    if (val === "") this.children = [];
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const check = (el: MockElement) => {
      let matches = false;
      if (selector.startsWith(".")) {
        const classes = selector.split(".").filter(Boolean);
        if (classes.every((c) => el.classList.contains(c))) matches = true;
      } else if (selector.includes("[") && selector.includes("]")) {
        const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)\*?=["']?([^"'\]]+)["']?\]/);
        if (attrMatch) {
          const val = attrMatch[2];
          const actual = el.getAttribute(attrMatch[1]) || "";
          if (actual === val || actual.includes(val)) matches = true;
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

// Global mocks
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
};

describe("FreehandSmoother & Smooth Drawing Tool", () => {
  describe("roundCoord", () => {
    it("should round numbers to 1 decimal place by default", () => {
      expect(roundCoord(12.3456)).toBe(12.3);
      expect(roundCoord(12.36)).toBe(12.4);
      expect(roundCoord(0)).toBe(0);
      expect(roundCoord(-45.678)).toBe(-45.7);
    });

    it("should support custom decimal places", () => {
      expect(roundCoord(12.3456, 2)).toBe(12.35);
      expect(roundCoord(12.3456, 0)).toBe(12);
    });
  });

  describe("filterClosePoints", () => {
    it("should return identical array for <= 2 points", () => {
      expect(filterClosePoints([])).toEqual([]);
      expect(filterClosePoints([{ x: 10, y: 10 }])).toEqual([{ x: 10, y: 10 }]);
      expect(
        filterClosePoints([
          { x: 10, y: 10 },
          { x: 10.2, y: 10.2 },
        ])
      ).toEqual([
        { x: 10, y: 10 },
        { x: 10.2, y: 10.2 },
      ]);
    });

    it("should remove intermediate points that are closer than minDistance", () => {
      const points = [
        { x: 0, y: 0 },
        { x: 0.2, y: 0.1 }, // too close to (0, 0), skip
        { x: 0.4, y: 0.3 }, // too close to (0, 0), skip
        { x: 5, y: 5 },     // far enough, keep
        { x: 5.1, y: 5.1 }, // too close to (5, 5), skip
        { x: 20, y: 20 },   // final point, always keep
      ];

      const filtered = filterClosePoints(points, 2.0);
      expect(filtered.length).toBe(3);
      expect(filtered[0]).toEqual({ x: 0, y: 0 });
      expect(filtered[1]).toEqual({ x: 5, y: 5 });
      expect(filtered[2]).toEqual({ x: 20, y: 20 });
    });
  });

  describe("smoothPoints", () => {
    it("should return original points unmodified for <= 3 points", () => {
      const single = [{ x: 5, y: 5 }];
      expect(smoothPoints(single)).toEqual(single);

      const pair = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ];
      expect(smoothPoints(pair)).toEqual(pair);

      const trio = [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
      ];
      expect(smoothPoints(trio)).toEqual(trio);
    });

    it("should preserve first and last points exactly", () => {
      const pts = [
        { x: 10, y: 20 },
        { x: 15, y: 35 },
        { x: 25, y: 40 },
        { x: 35, y: 55 },
        { x: 50, y: 70 },
      ];
      const smoothed = smoothPoints(pts);
      expect(smoothed[0]).toEqual(pts[0]);
      expect(smoothed[smoothed.length - 1]).toEqual(pts[pts.length - 1]);
    });

    it("should preserve collinear straight line points", () => {
      // Points along y = 2x
      const linePts = [
        { x: 0, y: 0 },
        { x: 10, y: 20 },
        { x: 20, y: 40 },
        { x: 30, y: 60 },
        { x: 40, y: 80 },
      ];
      const smoothed = smoothPoints(linePts);
      smoothed.forEach((pt, i) => {
        expect(pt.x).toBeCloseTo(linePts[i].x, 1);
        expect(pt.y).toBeCloseTo(linePts[i].y, 1);
      });
    });

    it("should attenuate random high-frequency mouse jitter on curves", () => {
      const noisyWavy = [
        { x: 0, y: 0 },
        { x: 10, y: 28 }, // spike up
        { x: 20, y: 14 }, // dip down
        { x: 30, y: 38 }, // spike up
        { x: 40, y: 28 }, // dip down
        { x: 50, y: 50 },
      ];
      const smoothed = smoothPoints(noisyWavy);
      // Smoothed interior points should be softened compared to raw spike values
      expect(smoothed[1].y).toBeLessThan(28);
      expect(smoothed[1].y).toBeGreaterThan(14);
      expect(smoothed[3].y).toBeLessThan(38);
      expect(smoothed[3].y).toBeGreaterThan(28);
    });
  });

  describe("pointsToSmoothSvgPath", () => {
    it("should return empty string for 0 points", () => {
      expect(pointsToSmoothSvgPath([])).toBe("");
    });

    it("should return valid dot path (M x,y L x,y) for 1 point", () => {
      expect(pointsToSmoothSvgPath([{ x: 25, y: 40 }])).toBe("M 25,40 L 25,40");
    });

    it("should return straight line path for 2 points", () => {
      expect(
        pointsToSmoothSvgPath([
          { x: 0, y: 0 },
          { x: 15, y: 25 },
        ])
      ).toBe("M 0,0 L 15,25");
    });

    it("should return 3-point line path for 3 points for backwards compatibility", () => {
      expect(
        pointsToSmoothSvgPath([
          { x: 0, y: 0 },
          { x: 2, y: 6 },
          { x: 5, y: 8 },
        ])
      ).toBe("M 0,0 L 2,6 L 5,8");
    });

    it("should generate smooth quadratic Bezier spline (Q commands) for 4+ points", () => {
      const wavy = [
        { x: 0, y: 0 },
        { x: 20, y: 30 },
        { x: 50, y: 40 },
        { x: 80, y: 20 },
        { x: 110, y: 0 },
      ];
      const pathStr = pointsToSmoothSvgPath(wavy);

      expect(pathStr.startsWith("M 0,0")).toBe(true);
      expect(pathStr).toContain("Q");
      expect(pathStr.endsWith("L 110,0")).toBe(true);

      // Verify that intermediate curve points are formatted with quadratic Bezier commands
      const qCount = (pathStr.match(/Q/g) || []).length;
      expect(qCount).toBe(wavy.length - 2); // 3 quadratic curves for 5 points
    });

    it("should render continuous curvy line without segmented straight polygon facets", () => {
      // 10 points along a sine curve
      const sineCurve = [];
      for (let i = 0; i <= 9; i++) {
        sineCurve.push({ x: i * 20, y: Math.round(Math.sin((i / 9) * Math.PI) * 50) });
      }

      const pathStr = pointsToSmoothSvgPath(sineCurve);
      expect(pathStr).toContain("Q");
      const qMatches = pathStr.match(/Q\s+[\d.-]+,[\d.-]+\s+[\d.-]+,[\d.-]+/g);
      expect(qMatches).not.toBeNull();
      expect(qMatches!.length).toBe(sineCurve.length - 2);
    });
  });

  describe("End-to-End Freehand Drawing with SvgSceneRenderer", () => {
    let editor: DiagramEditor;
    let container: MockElement;
    let renderer: SvgSceneRenderer;

    beforeEach(() => {
      editor = new DiagramEditor(createDiagram({ id: "diag-smooth-test", diagramType: "general" }));
      container = new MockElement("div", { cls: "umlcanvas-svg-container" });
      renderer = new SvgSceneRenderer(container as any, editor, {
        enableFreehand: true,
        autoShapeDetection: false,
      });
      renderer.setFreehandMode(true);
    });

    afterEach(() => {
      renderer.destroy();
    });

    it("drawing a continuous curvy line creates a generic.freehand node with smooth quadratic Bezier curves", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");

      // Draw a continuous S-curve with 8 points
      svgEl?.dispatch("mousedown", { button: 0, target: bgRect, clientX: 100, clientY: 100 });

      const curvePoints = [
        { clientX: 120, clientY: 140 },
        { clientX: 150, clientY: 170 },
        { clientX: 190, clientY: 160 },
        { clientX: 230, clientY: 120 },
        { clientX: 270, clientY: 90 },
        { clientX: 310, clientY: 110 },
        { clientX: 340, clientY: 150 },
      ];

      for (const pt of curvePoints) {
        (global as any).window.dispatch("mousemove", pt);
      }

      (global as any).window.dispatch("mouseup", { clientX: 340, clientY: 150 });

      expect(editor.diagram.nodes.length).toBe(1);
      const freehandNode = editor.diagram.nodes[0];
      expect(freehandNode.kind).toBe("generic.freehand");

      const pathData = freehandNode.customData?.pathData as string;
      expect(pathData).toBeDefined();
      expect(pathData.startsWith("M")).toBe(true);
      // Contains quadratic curves rather than only raw L straight lines!
      expect(pathData).toContain("Q");

      const qCount = (pathData.match(/Q/g) || []).length;
      expect(qCount).toBeGreaterThanOrEqual(4);
    });

    it("updates live preview element with smooth curve during mouse drag", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");

      svgEl?.dispatch("mousedown", { button: 0, target: bgRect, clientX: 50, clientY: 50 });

      (global as any).window.dispatch("mousemove", { clientX: 70, clientY: 80 });
      (global as any).window.dispatch("mousemove", { clientX: 100, clientY: 100 });
      (global as any).window.dispatch("mousemove", { clientX: 140, clientY: 90 });
      (global as any).window.dispatch("mousemove", { clientX: 180, clientY: 60 });

      const previewEl = container.querySelector(".umlcanvas-freehand-stroke");
      expect(previewEl).not.toBeNull();
      const previewD = previewEl?.getAttribute("d");
      expect(previewD).toContain("Q");

      (global as any).window.dispatch("mouseup", { clientX: 180, clientY: 60 });
      expect(container.querySelector(".umlcanvas-freehand-stroke")).toBeNull();
    });

    it("resizing a freehand node maintains smooth quadratic Bezier curve pathData", () => {
      const stroke = {
        id: "stroke-resizing",
        points: [
          { x: 100, y: 100 },
          { x: 130, y: 140 },
          { x: 170, y: 160 },
          { x: 210, y: 130 },
          { x: 250, y: 100 },
        ],
      };
      const node = editor.addFreehandNode(stroke);
      expect(node.customData?.pathData).toContain("Q");

      editor.selectNode(node.id, false);
      const seHandle = container.querySelector(".umlcanvas-resize-handle.handle-se");
      expect(seHandle).not.toBeNull();

      const svgEl = container.querySelector(".umlcanvas-svg");
      svgEl?.dispatch("mousedown", {
        button: 0,
        target: seHandle,
        clientX: node.position.x + node.size.width,
        clientY: node.position.y + node.size.height,
      });

      (global as any).window.dispatch("mousemove", {
        clientX: node.position.x + node.size.width + 60,
        clientY: node.position.y + node.size.height + 40,
      });

      (global as any).window.dispatch("mouseup", {
        clientX: node.position.x + node.size.width + 60,
        clientY: node.position.y + node.size.height + 40,
      });

      expect(node.customData?.pathData).toContain("Q");
    });

    it("caches container bounding box during drawing to prevent layout thrashing and reflow lag", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");

      let getBoundingClientRectCallCount = 0;
      const originalGetBoundingClientRect = container.getBoundingClientRect;
      container.getBoundingClientRect = () => {
        getBoundingClientRectCallCount++;
        return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } as any;
      };

      svgEl?.dispatch("mousedown", { button: 0, target: bgRect, clientX: 100, clientY: 100 });

      // 50 mousemove events dispatched in rapid succession
      for (let i = 1; i <= 50; i++) {
        (global as any).window.dispatch("mousemove", { clientX: 100 + i * 3, clientY: 100 + i * 2 });
      }

      (global as any).window.dispatch("mouseup", { clientX: 250, clientY: 200 });

      // In the old unoptimized version, getBoundingClientRect was called on EVERY mousemove (50+ times).
      // With cachedContainerRect during the drag, it should only be called once at mousedown!
      expect(getBoundingClientRectCallCount).toBeLessThanOrEqual(2);

      container.getBoundingClientRect = originalGetBoundingClientRect;
    });

    it("supports coalesced events when available on the event for high-fidelity curve capture", () => {
      const svgEl = container.querySelector(".umlcanvas-svg");
      const bgRect = container.querySelector(".umlcanvas-bg");

      svgEl?.dispatch("mousedown", { button: 0, target: bgRect, clientX: 50, clientY: 50 });

      // Simulate a pointer event that bundles 3 coalesced events from hardware digitizer
      const coalescedEvent = {
        clientX: 120,
        clientY: 90,
        getCoalescedEvents: () => [
          { clientX: 70, clientY: 70 },
          { clientX: 95, clientY: 85 },
          { clientX: 120, clientY: 90 },
        ],
      };

      (global as any).window.dispatch("mousemove", coalescedEvent);
      (global as any).window.dispatch("mouseup", { clientX: 120, clientY: 90 });

      const node = editor.diagram.nodes[0];
      // All intermediate coalesced points should be captured in node.customData.points
      const pts = node.customData?.points as any[];
      expect(pts.length).toBeGreaterThanOrEqual(4);
    });
  });
});
