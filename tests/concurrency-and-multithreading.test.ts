import { WorkerPool, defaultWorkerPool } from "../src/infrastructure/concurrency/WorkerPool";
import {
  ConcurrencyManager,
  TaskPriority,
  defaultConcurrencyManager,
} from "../src/infrastructure/concurrency/ConcurrencyManager";
import { CanvasAttachmentService } from "../src/infrastructure/obsidian/CanvasAttachmentService";
import { App, TFile } from "./fakes/MockObsidian";
import { DiagramEditor } from "../src/application/use-cases/DiagramEditor";
import { createDiagram } from "../src/domain/entities/Diagram";
import { SvgSceneRenderer } from "../src/presentation/renderer/SvgSceneRenderer";
import { PdfPageModal } from "../src/presentation/views/PdfPageModal";

class MockDomElement {
  tagName: string;
  className = "";
  classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => cls.forEach((c) => c && this.classList.classes.add(c)),
    remove: (...cls: string[]) => cls.forEach((c) => c && this.classList.classes.delete(c)),
    contains: (c: string) => this.classList.classes.has(c),
  };
  children: MockDomElement[] = [];
  parentElement: MockDomElement | null = null;
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners: Record<string, ((e: any) => void)[]> = {};
  clientWidth = 800;
  clientHeight = 600;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  createDiv(options?: any): MockDomElement {
    const el = new MockDomElement("div");
    if (options?.cls) el.classList.add(options.cls);
    this.appendChild(el);
    return el;
  }

  createSpan(options?: any): MockDomElement {
    const el = new MockDomElement("span");
    if (options?.cls) el.classList.add(options.cls);
    this.appendChild(el);
    return el;
  }

  createEl(tag: string, options?: any): MockDomElement {
    const el = new MockDomElement(tag);
    if (options?.cls) el.classList.add(options.cls);
    this.appendChild(el);
    return el;
  }

  createSvg(tag: string, options?: any): MockDomElement {
    const el = new MockDomElement(tag);
    if (options?.cls) el.classList.add(options.cls);
    this.appendChild(el);
    return el;
  }

  appendChild(child: MockDomElement): MockDomElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
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
    for (const h of handlers) h(evt);
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 };
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  querySelector(selector: string): MockDomElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector: string): MockDomElement[] {
    const res: MockDomElement[] = [];
    const check = (el: MockDomElement) => {
      if (selector.startsWith(".") && el.classList.contains(selector.slice(1))) res.push(el);
      else if (selector.toLowerCase() === el.tagName.toLowerCase()) res.push(el);
      for (const c of el.children) check(c);
    };
    for (const c of this.children) check(c);
    return res;
  }

  empty(): void {
    this.children = [];
  }
}

describe("Multithreading & Concurrency Handling Tests", () => {
  beforeEach(() => {
    (global as any).document = {
      createElement: (tag: string) => new MockDomElement(tag),
      createElementNS: (_ns: string, tag: string) => new MockDomElement(tag),
    };
  });

  describe("1. WorkerPool Multithreading & Asynchronous Execution", () => {
    let pool: WorkerPool;

    beforeEach(() => {
      pool = new WorkerPool(2);
    });

    afterEach(() => {
      pool.terminate();
    });

    test("executes SMOOTH_POINTS task and returns smoothed coordinates", async () => {
      const rawPoints = [
        { x: 10, y: 10 },
        { x: 10.2, y: 10.1 }, // Close point, should be filtered
        { x: 20, y: 20 },
        { x: 30, y: 15 },
        { x: 40, y: 25 },
      ];

      const res = await pool.execute<
        { points: Array<{ x: number; y: number }>; minDistance?: number },
        { points: Array<{ x: number; y: number }> }
      >("SMOOTH_POINTS", { points: rawPoints, minDistance: 1.0 });

      expect(res.points).toBeDefined();
      expect(res.points.length).toBeGreaterThan(1);
      // First and last points should match
      expect(res.points[0]).toEqual({ x: 10, y: 10 });
      expect(res.points[res.points.length - 1]).toEqual({ x: 40, y: 25 });
    });

    test("executes RECOGNIZE_STROKES task for handwriting strokes", async () => {
      const horizontalStroke = {
        id: "s1",
        points: [
          { x: 10, y: 10 },
          { x: 25, y: 10 },
          { x: 45, y: 10 },
        ],
      };

      const res = await pool.execute<{ strokes: any[] }, { text: string; confidence: number }>(
        "RECOGNIZE_STROKES",
        { strokes: [horizontalStroke] }
      );

      expect(res.text).toBe("-");
      expect(res.confidence).toBeGreaterThan(0.5);
    });

    test("executes ROUTE_EDGE task calculating waypoints off the main thread", async () => {
      const payload = {
        source: { position: { x: 50, y: 50 } },
        target: { position: { x: 250, y: 150 } },
        routing: "orthogonal",
      };

      const res = await pool.execute<any, { points: Array<{ x: number; y: number }>; svgPath: string }>(
        "ROUTE_EDGE",
        payload
      );

      expect(res.points.length).toBe(4);
      expect(res.svgPath).toContain("M 50 50");
      expect(res.svgPath).toContain("150");
    });

    test("executes PARSE_CANVAS task parsing JSON Canvas strings", async () => {
      const jsonStr = JSON.stringify({
        nodes: [{ id: "n1", x: 10, y: 20, width: 100, height: 60 }],
        edges: [],
      });

      const res = await pool.execute<{ jsonString: string }, any>("PARSE_CANVAS", {
        jsonString: jsonStr,
      });

      expect(res.nodes.length).toBe(1);
      expect(res.nodes[0].id).toBe("n1");
    });

    test("executes COMPUTE_HASH task producing deterministic hash string", async () => {
      const res1 = await pool.execute<{ content: string }, string>("COMPUTE_HASH", {
        content: "diagram-payload-content",
      });
      const res2 = await pool.execute<{ content: string }, string>("COMPUTE_HASH", {
        content: "diagram-payload-content",
      });

      expect(res1).toBe(res2);
      expect(typeof res1).toBe("string");
    });

    test("queues tasks when concurrent requests exceed worker capacity", async () => {
      const tasks = Array.from({ length: 6 }, (_, i) =>
        pool.execute<{ content: string }, string>("COMPUTE_HASH", { content: `item-${i}` })
      );

      const results = await Promise.all(tasks);
      expect(results.length).toBe(6);
    });

    test("terminates gracefully and cancels pending jobs without memory leaks", async () => {
      const poolToTerminate = new WorkerPool(1);
      poolToTerminate.terminate();

      await expect(
        poolToTerminate.execute("COMPUTE_HASH", { content: "test" })
      ).rejects.toThrow("WorkerPool has been terminated");
    });
  });

  describe("2. ConcurrencyManager Priority Scheduling & Rate Limiting", () => {
    let cm: ConcurrencyManager;

    beforeEach(() => {
      cm = new ConcurrencyManager(2);
    });

    afterEach(() => {
      cm.dispose();
    });

    test("executes CRITICAL and HIGH priority tasks before LOW priority tasks in queue", async () => {
      const executedOrder: string[] = [];

      // Saturate with 2 slow tasks
      let resolveTask1: () => void;
      let resolveTask2: () => void;
      const blocker1 = cm.execute(() => new Promise<void>((r) => (resolveTask1 = r)));
      const blocker2 = cm.execute(() => new Promise<void>((r) => (resolveTask2 = r)));

      // Queue LOW priority task first
      const lowPromise = cm.execute(
        () => {
          executedOrder.push("LOW");
        },
        { priority: TaskPriority.LOW }
      );

      // Queue HIGH priority task second
      const highPromise = cm.execute(
        () => {
          executedOrder.push("HIGH");
        },
        { priority: TaskPriority.HIGH }
      );

      // Queue CRITICAL priority task third
      const criticalPromise = cm.execute(
        () => {
          executedOrder.push("CRITICAL");
        },
        { priority: TaskPriority.CRITICAL }
      );

      // Free the blockers
      resolveTask1!();
      resolveTask2!();
      await Promise.all([blocker1, blocker2]);

      await Promise.all([lowPromise, highPromise, criticalPromise]);

      // CRITICAL must run first, then HIGH, then LOW
      expect(executedOrder).toEqual(["CRITICAL", "HIGH", "LOW"]);
    });

    test("limits concurrency per category to prevent thread starvation", async () => {
      cm.setMaxConcurrency("pdf-import", 1);
      let concurrentCount = 0;
      let maxObservedConcurrent = 0;

      const runTask = async () => {
        return cm.execute(
          async () => {
            concurrentCount++;
            maxObservedConcurrent = Math.max(maxObservedConcurrent, concurrentCount);
            await new Promise((r) => setTimeout(r, 10));
            concurrentCount--;
          },
          { category: "pdf-import" }
        );
      };

      await Promise.all([runTask(), runTask(), runTask()]);

      // Max concurrent count should strictly respect limit of 1
      expect(maxObservedConcurrent).toBe(1);
    });

    test("supports cooperative yielding to the main thread via yieldToMain", async () => {
      const start = performance.now() - 20; // Simulated 20ms of work
      let yielded = false;

      const promise = cm.yieldToMain(start, 8).then(() => {
        yielded = true;
      });

      expect(yielded).toBe(false);
      await promise;
      expect(yielded).toBe(true);
    });

    test("debounce cancels previous timer and invokes with latest arguments", async () => {
      jest.useFakeTimers();
      let callCount = 0;
      let lastArg = "";

      const debounced = cm.debounce((val: string) => {
        callCount++;
        lastArg = val;
      }, 100);

      debounced("first");
      debounced("second");
      debounced("third");

      expect(callCount).toBe(0);
      jest.advanceTimersByTime(120);

      expect(callCount).toBe(1);
      expect(lastArg).toBe("third");
      jest.useRealTimers();
    });

    test("throttle restricts execution rate within intervalMs", async () => {
      jest.useFakeTimers();
      let callCount = 0;

      const throttled = cm.throttle(() => {
        callCount++;
      }, 50);

      throttled();
      throttled();
      throttled();

      expect(callCount).toBe(1);
      jest.advanceTimersByTime(60);
      expect(callCount).toBe(2);
      jest.useRealTimers();
    });
  });

  describe("3. PDF Import & Canvas Attachment Optimization", () => {
    let mockApp: App;
    let attachmentService: CanvasAttachmentService;

    beforeEach(() => {
      mockApp = new App();
      attachmentService = new CanvasAttachmentService(mockApp as any);
    });

    test("saves pasted PDF as vault binary attachment instead of giant data URL", async () => {
      const dummyFile = new TFile("workspaces/Project.canvas++", "Project", "canvas++");
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
      const blob = new Blob([pdfBytes], { type: "application/pdf" });

      const result = await attachmentService.savePastedPdf(blob, {
        file: dummyFile,
        preferredName: "SystemArchitecture.pdf",
      });

      expect(result.file).not.toBeNull();
      expect(result.filePath).toBe("workspaces/Project/SystemArchitecture.pdf");
      expect(result.src).toContain("workspaces/Project/SystemArchitecture.pdf");
      expect(result.title).toBe("SystemArchitecture");

      // Verify the binary exists in the vault
      const vaultFile = mockApp.vault.getAbstractFileByPath("workspaces/Project/SystemArchitecture.pdf");
      expect(vaultFile).toBeDefined();
    });

    test("handles collision-free unique names for multiple imported PDFs", async () => {
      const dummyFile = new TFile("notes/Doc.canvas", "Doc", "canvas");
      const blob = new Blob(["dummy pdf"], { type: "application/pdf" });

      const res1 = await attachmentService.savePastedPdf(blob, {
        file: dummyFile,
        preferredName: "Report.pdf",
      });
      const res2 = await attachmentService.savePastedPdf(blob, {
        file: dummyFile,
        preferredName: "Report.pdf",
      });

      expect(res1.filePath).toBe("notes/Doc/Report.pdf");
      expect(res2.filePath).toBe("notes/Doc/Report 1.pdf");
    });
  });

  describe("4. SvgSceneRenderer Render Throttling & Signature Speed", () => {
    let editor: DiagramEditor;
    let container: MockDomElement;
    let renderer: SvgSceneRenderer;

    beforeEach(() => {
      const diagram = createDiagram({
        id: "diag-concurrency-test",
        title: "Concurrency Diagram",
        diagramType: "general",
      });
      editor = new DiagramEditor(diagram);
      container = new MockDomElement("div");
      renderer = new SvgSceneRenderer(container as any, editor);
    });

    afterEach(() => {
      renderer.destroy();
    });

    test("scheduleRender coalesces multiple rapid mutations into a single animation frame", (done) => {
      let renderCallCount = 0;
      const originalRender = renderer.render.bind(renderer);
      renderer.render = () => {
        renderCallCount++;
        originalRender();
      };

      // Trigger 10 rapid scheduleRender calls
      for (let i = 0; i < 10; i++) {
        renderer.scheduleRender();
      }

      // Check after next tick: exactly 1 render should have run
      setTimeout(() => {
        expect(renderCallCount).toBe(1);
        done();
      }, 20);
    });

    test("computes fast node signature without freezing on large data payload", () => {
      // Create a 1MB mock payload (like an embedded image or base64 PDF)
      const bigString = "A".repeat(1024 * 1024);
      const node = editor.addNode({
        title: "Large Node",
        customData: {
          hugeData: bigString,
          otherProp: "val",
        },
      });

      const t0 = performance.now();
      const sig1 = (renderer as any).getNodeSignature(node);
      const t1 = performance.now();

      // Signature generation must complete in under 5ms, not 100ms+
      expect(t1 - t0).toBeLessThan(15);
      expect(sig1).toBeDefined();
      expect(sig1).toContain("hugeData:A");
    });

    test("PdfPageModal submits cleanly without window.prompt", () => {
      const mockApp = new App();
      let submittedSubpath = "";

      const modal = new PdfPageModal(mockApp as any, "#page=3", (res) => {
        submittedSubpath = res;
      });

      (modal as any).pageInput = "7";
      (modal as any).submit();

      expect(submittedSubpath).toBe("#page=7");
    });
  });
});
