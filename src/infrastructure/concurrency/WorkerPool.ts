import { Point } from "../../domain/value-objects/Point";

export type WorkerTaskType =
  | "SMOOTH_POINTS"
  | "RECOGNIZE_STROKES"
  | "ROUTE_EDGE"
  | "PARSE_CANVAS"
  | "COMPUTE_HASH";

export interface WorkerTaskRequest<T = unknown> {
  id: string;
  type: WorkerTaskType;
  payload: T;
}

export interface WorkerTaskResponse<R = unknown> {
  id: string;
  success: boolean;
  result?: R;
  error?: string;
}

/**
 * Self-contained worker script executed in background Web Worker threads.
 * Uses pure JavaScript math algorithms with zero external dependencies.
 */
const WORKER_SCRIPT_BODY = `
self.onmessage = function(e) {
  var data = e.data;
  var id = data.id;
  var type = data.type;
  var payload = data.payload;

  try {
    var result;
    switch(type) {
      case "SMOOTH_POINTS":
        result = smoothPointsWorker(payload.points, payload.minDistance);
        break;
      case "RECOGNIZE_STROKES":
        result = recognizeStrokesWorker(payload.strokes);
        break;
      case "ROUTE_EDGE":
        result = routeEdgeWorker(payload);
        break;
      case "PARSE_CANVAS":
        result = JSON.parse(payload.jsonString);
        break;
      case "COMPUTE_HASH":
        result = computeFastHashWorker(payload.content);
        break;
      default:
        throw new Error("Unknown task type: " + type);
    }
    self.postMessage({ id: id, success: true, result: result });
  } catch(err) {
    self.postMessage({ id: id, success: false, error: err ? (err.message || String(err)) : "Worker execution error" });
  }
};

function smoothPointsWorker(points, minDistance) {
  if (!points || points.length <= 2) return { points: points || [] };
  var minDist = typeof minDistance === "number" ? minDistance : 1.2;
  var minDistSq = minDist * minDist;

  // 1. Distance filter
  var filtered = [points[0]];
  for (var i = 1; i < points.length - 1; i++) {
    var last = filtered[filtered.length - 1];
    var curr = points[i];
    var dx = curr.x - last.x;
    var dy = curr.y - last.y;
    if (dx * dx + dy * dy >= minDistSq) {
      filtered.push(curr);
    }
  }
  filtered.push(points[points.length - 1]);

  if (filtered.length <= 2) return { points: filtered };

  // 2. Moving average smoothing (0.25, 0.5, 0.25)
  var smoothed = [filtered[0]];
  for (var j = 1; j < filtered.length - 1; j++) {
    var prev = filtered[j - 1];
    var cur = filtered[j];
    var next = filtered[j + 1];
    var sx = Math.round((prev.x * 0.25 + cur.x * 0.5 + next.x * 0.25) * 10) / 10;
    var sy = Math.round((prev.y * 0.25 + cur.y * 0.5 + next.y * 0.25) * 10) / 10;
    smoothed.push({ x: sx, y: sy });
  }
  smoothed.push(filtered[filtered.length - 1]);

  return { points: smoothed };
}

function recognizeStrokesWorker(strokes) {
  if (!strokes || strokes.length === 0) return { text: "", confidence: 0 };
  var totalPoints = 0;
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (var i = 0; i < strokes.length; i++) {
    var pts = strokes[i].points || [];
    totalPoints += pts.length;
    for (var j = 0; j < pts.length; j++) {
      var p = pts[j];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  var width = maxX - minX;
  var height = maxY - minY;
  var aspectRatio = width / (height || 1);

  // Heuristic character analysis in worker thread
  var charGuess = "";
  if (strokes.length === 1 && aspectRatio > 2.8 && height < 15) {
    charGuess = "-";
  } else if (strokes.length === 1 && aspectRatio < 0.35 && height > 20) {
    charGuess = "l";
  } else if (strokes.length === 1 && Math.abs(aspectRatio - 1) < 0.35) {
    charGuess = "o";
  }

  return {
    text: charGuess,
    confidence: charGuess ? 0.85 : 0.4,
    bounds: { x: minX, y: minY, width: width, height: height },
    pointCount: totalPoints
  };
}

function routeEdgeWorker(payload) {
  var s = payload.source;
  var t = payload.target;
  if (!s || !t) return { points: [], svgPath: "" };

  var p1 = s.position || { x: 0, y: 0 };
  var p2 = t.position || { x: 100, y: 100 };
  var midX = Math.round((p1.x + p2.x) / 2);
  var midY = Math.round((p1.y + p2.y) / 2);

  if (payload.routing === "orthogonal") {
    var points = [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2];
    var path = "M " + p1.x + " " + p1.y + " L " + midX + " " + p1.y + " L " + midX + " " + p2.y + " L " + p2.x + " " + p2.y;
    return { points: points, svgPath: path };
  }

  var straightPoints = [p1, p2];
  return { points: straightPoints, svgPath: "M " + p1.x + " " + p1.y + " L " + p2.x + " " + p2.y };
}

function computeFastHashWorker(str) {
  if (typeof str !== "string") str = JSON.stringify(str) || "";
  var hash = 2166136261;
  for (var i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
`;

interface FallbackStroke {
  points: Point[];
}

interface FallbackRoutePayload {
  source?: { position?: Point };
  target?: { position?: Point };
  routing?: string;
}

interface ActiveWorker {
  worker: Worker;
  busy: boolean;
  activeTaskId: string | null;
}

interface PendingTask<R = unknown> {
  request: WorkerTaskRequest;
  resolve: (res: R) => void;
  reject: (err: Error) => void;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Multithreaded background worker pool for CPU-intensive tasks.
 * Spawns a pool of isolated Web Workers to keep Obsidian's UI thread buttery smooth.
 * Automatically falls back to asynchronous microtask execution in test or headless environments.
 */
export class WorkerPool {
  private workers: ActiveWorker[] = [];
  private taskQueue: PendingTask[] = [];
  private pendingCallbacks = new Map<
    string,
    {
      resolve: (res: any) => void;
      reject: (err: Error) => void;
      workerIndex?: number;
      timeoutTimer?: ReturnType<typeof setTimeout>;
    }
  >();

  private workerBlobUrl: string | null = null;
  private isTerminated = false;
  private readonly maxWorkers: number;

  constructor(maxWorkers?: number) {
    if (typeof maxWorkers === "number" && maxWorkers > 0) {
      this.maxWorkers = maxWorkers;
    } else if (
      typeof navigator !== "undefined" &&
      typeof navigator.hardwareConcurrency === "number" &&
      navigator.hardwareConcurrency > 0
    ) {
      this.maxWorkers = Math.min(4, Math.max(1, navigator.hardwareConcurrency - 1));
    } else {
      this.maxWorkers = 2;
    }

    this.initWorkers();
  }

  public get poolSize(): number {
    return this.workers.length;
  }

  public get pendingTaskCount(): number {
    return this.taskQueue.length + this.pendingCallbacks.size;
  }

  private initWorkers(): void {
    if (
      typeof Worker === "undefined" ||
      typeof Blob === "undefined" ||
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      // Headless / Jest Node environment: workers not supported natively, fallback is used
      return;
    }

    try {
      const blob = new Blob([WORKER_SCRIPT_BODY], { type: "application/javascript" });
      this.workerBlobUrl = URL.createObjectURL(blob);

      for (let i = 0; i < this.maxWorkers; i++) {
        try {
          const w = new Worker(this.workerBlobUrl);
          const activeWorker: ActiveWorker = {
            worker: w,
            busy: false,
            activeTaskId: null,
          };

          const workerIdx = i;
          w.onmessage = (event: MessageEvent<WorkerTaskResponse>) => {
            this.handleWorkerMessage(workerIdx, event.data);
          };

          w.onerror = (err) => {
            this.handleWorkerError(workerIdx, err);
          };

          this.workers.push(activeWorker);
        } catch {
          // If individual worker instantiation is blocked (CSP/sandbox), skip
          break;
        }
      }
    } catch {
      // Worker creation not permitted
    }
  }

  /**
   * Executes a task on an available background worker thread.
   * If workers are busy, the task is queued and dispatched as soon as a worker frees up.
   * If Web Workers are unavailable, runs safely on the asynchronous fallback loop.
   */
  public execute<T = unknown, R = unknown>(
    type: WorkerTaskType,
    payload: T,
    options?: { timeoutMs?: number }
  ): Promise<R> {
    if (this.isTerminated) {
      return Promise.reject(new Error("WorkerPool has been terminated"));
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const request: WorkerTaskRequest<T> = { id: taskId, type, payload };

    // If no active Web Workers are available, run on asynchronous task fallback
    if (this.workers.length === 0) {
      return this.runFallback<T, R>(request);
    }

    return new Promise<R>((resolve, reject) => {
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      const timeoutMs = options?.timeoutMs ?? 20000;
      if (timeoutMs > 0 && typeof setTimeout !== "undefined") {
        timeoutTimer = setTimeout(() => {
          this.pendingCallbacks.delete(taskId);
          // Free busy worker if this task was currently running
          const workerEntry = this.workers.find((w) => w.activeTaskId === taskId);
          if (workerEntry) {
            workerEntry.busy = false;
            workerEntry.activeTaskId = null;
            this.drainQueue();
          }
          reject(new Error(`Worker task timed out after ${timeoutMs}ms: ${type}`));
        }, timeoutMs);
      }

      const pendingTask: PendingTask<R> = {
        request,
        resolve,
        reject: (err) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          reject(err);
        },
        timeoutTimer,
      };

      const idleWorkerIdx = this.workers.findIndex((w) => !w.busy);
      if (idleWorkerIdx !== -1) {
        this.dispatchToWorker(idleWorkerIdx, pendingTask);
      } else {
        this.taskQueue.push(pendingTask as PendingTask);
      }
    });
  }

  private dispatchToWorker<R>(workerIdx: number, task: PendingTask<R>): void {
    const workerEntry = this.workers[workerIdx];
    if (!workerEntry) return;

    workerEntry.busy = true;
    workerEntry.activeTaskId = task.request.id;

    this.pendingCallbacks.set(task.request.id, {
      resolve: task.resolve,
      reject: task.reject,
      workerIndex: workerIdx,
      timeoutTimer: task.timeoutTimer,
    });

    try {
      workerEntry.worker.postMessage(task.request);
    } catch (err) {
      this.pendingCallbacks.delete(task.request.id);
      workerEntry.busy = false;
      workerEntry.activeTaskId = null;
      task.reject(err instanceof Error ? err : new Error(String(err)));
      this.drainQueue();
    }
  }

  private handleWorkerMessage(workerIdx: number, response: WorkerTaskResponse): void {
    const workerEntry = this.workers[workerIdx];
    if (workerEntry) {
      workerEntry.busy = false;
      workerEntry.activeTaskId = null;
    }

    const callback = this.pendingCallbacks.get(response.id);
    if (callback) {
      this.pendingCallbacks.delete(response.id);
      if (callback.timeoutTimer) {
        clearTimeout(callback.timeoutTimer);
      }

      if (response.success) {
        callback.resolve(response.result);
      } else {
        callback.reject(new Error(response.error || "Worker task failed"));
      }
    }

    this.drainQueue();
  }

  private handleWorkerError(workerIdx: number, err: ErrorEvent): void {
    const workerEntry = this.workers[workerIdx];
    const taskId = workerEntry?.activeTaskId;

    if (workerEntry) {
      workerEntry.busy = false;
      workerEntry.activeTaskId = null;
    }

    if (taskId) {
      const callback = this.pendingCallbacks.get(taskId);
      if (callback) {
        this.pendingCallbacks.delete(taskId);
        if (callback.timeoutTimer) clearTimeout(callback.timeoutTimer);
        callback.reject(new Error(err.message || "Worker error occurred"));
      }
    }

    this.drainQueue();
  }

  private drainQueue(): void {
    if (this.isTerminated || this.taskQueue.length === 0) return;

    const idleWorkerIdx = this.workers.findIndex((w) => !w.busy);
    if (idleWorkerIdx !== -1) {
      const nextTask = this.taskQueue.shift();
      if (nextTask) {
        this.dispatchToWorker(idleWorkerIdx, nextTask);
      }
    }
  }

  /**
   * Pure JS fallback executed asynchronously via queueMicrotask/Promise.
   * Ensures seamless operation in environments where Web Workers are unavailable.
   */
  private runFallback<T, R>(request: WorkerTaskRequest<T>): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      // Execute asynchronously on the next microtask turn to avoid blocking callstack
      queueMicrotask(() => {
        try {
          const { type, payload } = request;
          let result: unknown;
          switch (type) {
            case "SMOOTH_POINTS": {
              const p = payload as { points: Point[]; minDistance?: number };
              result = this.smoothPointsFallback(p.points, p.minDistance);
              break;
            }
            case "RECOGNIZE_STROKES": {
              const p = payload as { strokes: FallbackStroke[] };
              result = this.recognizeStrokesFallback(p.strokes);
              break;
            }
            case "ROUTE_EDGE": {
              result = this.routeEdgeFallback(payload as FallbackRoutePayload);
              break;
            }
            case "PARSE_CANVAS": {
              const p = payload as { jsonString: string };
              result = JSON.parse(p.jsonString);
              break;
            }
            case "COMPUTE_HASH": {
              const p = payload as { content: string };
              result = this.computeHashFallback(p.content);
              break;
            }
            default: {
              const unhandledType: string = String(type);
              throw new Error(`Unsupported task type in fallback: ${unhandledType}`);
            }
          }
          resolve(result as R);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  private smoothPointsFallback(points: Point[], minDistance = 1.2): { points: Point[] } {
    if (!points || points.length <= 2) return { points: points || [] };
    const minDistSq = minDistance * minDistance;
    const filtered: Point[] = [points[0]];

    for (let i = 1; i < points.length - 1; i++) {
      const last = filtered[filtered.length - 1];
      const curr = points[i];
      const dx = curr.x - last.x;
      const dy = curr.y - last.y;
      if (dx * dx + dy * dy >= minDistSq) {
        filtered.push(curr);
      }
    }
    filtered.push(points[points.length - 1]);

    if (filtered.length <= 2) return { points: filtered };

    const smoothed: Point[] = [filtered[0]];
    for (let j = 1; j < filtered.length - 1; j++) {
      const prev = filtered[j - 1];
      const cur = filtered[j];
      const next = filtered[j + 1];
      const sx = Math.round((prev.x * 0.25 + cur.x * 0.5 + next.x * 0.25) * 10) / 10;
      const sy = Math.round((prev.y * 0.25 + cur.y * 0.5 + next.y * 0.25) * 10) / 10;
      smoothed.push({ x: sx, y: sy });
    }
    smoothed.push(filtered[filtered.length - 1]);

    return { points: smoothed };
  }

  private recognizeStrokesFallback(strokes: FallbackStroke[]): {
    text: string;
    confidence: number;
    bounds: { x: number; y: number; width: number; height: number };
    pointCount: number;
  } {
    if (!strokes || strokes.length === 0) {
      return { text: "", confidence: 0, bounds: { x: 0, y: 0, width: 0, height: 0 }, pointCount: 0 };
    }
    let totalPoints = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const stroke of strokes) {
      const pts = stroke.points || [];
      totalPoints += pts.length;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const aspectRatio = width / (height || 1);

    let charGuess = "";
    if (strokes.length === 1 && aspectRatio > 2.8 && height < 15) {
      charGuess = "-";
    } else if (strokes.length === 1 && aspectRatio < 0.35 && height > 20) {
      charGuess = "l";
    } else if (strokes.length === 1 && Math.abs(aspectRatio - 1) < 0.35) {
      charGuess = "o";
    }

    return {
      text: charGuess,
      confidence: charGuess ? 0.85 : 0.4,
      bounds: { x: minX, y: minY, width, height },
      pointCount: totalPoints,
    };
  }

  private routeEdgeFallback(payload: FallbackRoutePayload): { points: Point[]; svgPath: string } {
    const s = payload.source;
    const t = payload.target;
    if (!s || !t) return { points: [], svgPath: "" };

    const p1: Point = s.position || { x: 0, y: 0 };
    const p2: Point = t.position || { x: 100, y: 100 };
    const midX = Math.round((p1.x + p2.x) / 2);

    if (payload.routing === "orthogonal") {
      const points: Point[] = [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2];
      const path = `M ${p1.x} ${p1.y} L ${midX} ${p1.y} L ${midX} ${p2.y} L ${p2.x} ${p2.y}`;
      return { points, svgPath: path };
    }

    const points: Point[] = [p1, p2];
    return { points, svgPath: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}` };
  }

  private computeHashFallback(str: string): string {
    if (typeof str !== "string") str = JSON.stringify(str) || "";
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  /**
   * Cleans up all background workers, aborts pending jobs, and revokes Blob URLs.
   * Required by Obsidian deployment guidelines to prevent leaks upon plugin unload.
   */
  public terminate(): void {
    this.isTerminated = true;

    for (const entry of this.workers) {
      try {
        entry.worker.terminate();
      } catch {
        // ignore
      }
    }
    this.workers = [];

    if (this.workerBlobUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      try {
        URL.revokeObjectURL(this.workerBlobUrl);
      } catch {
        // ignore
      }
      this.workerBlobUrl = null;
    }

    // Cancel all queued and pending callbacks
    for (const [taskId, cb] of this.pendingCallbacks.entries()) {
      if (cb.timeoutTimer) clearTimeout(cb.timeoutTimer);
      cb.reject(new Error(`WorkerPool terminated: task ${taskId} cancelled`));
    }
    this.pendingCallbacks.clear();

    for (const task of this.taskQueue) {
      task.reject(new Error("WorkerPool terminated"));
    }
    this.taskQueue = [];
  }

  public dispose(): void {
    this.terminate();
  }
}

/** Global singleton worker pool */
export const defaultWorkerPool = new WorkerPool();
