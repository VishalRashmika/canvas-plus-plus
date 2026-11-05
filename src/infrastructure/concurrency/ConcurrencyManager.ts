export enum TaskPriority {
  CRITICAL = 1,
  HIGH = 2,
  NORMAL = 3,
  LOW = 4,
}

export interface TaskOptions {
  priority?: TaskPriority;
  category?: string;
  signal?: AbortSignal;
}

interface QueuedTask<T = unknown> {
  id: string;
  fn: () => Promise<T> | T;
  priority: TaskPriority;
  category: string;
  resolve: (res: T) => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
}

/**
 * Concurrency manager and cooperative task scheduler.
 * Enforces task prioritization, concurrency rate-limiting, and time-slicing
 * so that heavy background operations never freeze the main UI thread.
 */
export class ConcurrencyManager {
  private queue: QueuedTask[] = [];
  private runningByCategory = new Map<string, number>();
  private defaultMaxConcurrentByCategory = new Map<string, number>([
    ["default", 4],
    ["io", 2],
    ["pdf", 2],
    ["image", 2],
    ["recognition", 2],
    ["autosave", 1],
  ]);

  private scheduledFrames = new Map<string, number>();
  private isDisposed = false;

  constructor(maxConcurrent?: number) {
    if (typeof maxConcurrent === "number" && maxConcurrent > 0) {
      this.defaultMaxConcurrentByCategory.set("default", maxConcurrent);
    }
  }

  public setMaxConcurrency(category: string, max: number): void {
    if (max > 0) {
      this.defaultMaxConcurrentByCategory.set(category, max);
    }
  }

  public getMaxConcurrency(category = "default"): number {
    return (
      this.defaultMaxConcurrentByCategory.get(category) ??
      this.defaultMaxConcurrentByCategory.get("default") ??
      4
    );
  }

  /**
   * Enqueues a task for execution according to its priority and category concurrency limit.
   */
  public execute<T>(
    fn: () => Promise<T> | T,
    options?: TaskOptions
  ): Promise<T> {
    if (this.isDisposed) {
      return Promise.reject(new Error("ConcurrencyManager is disposed"));
    }

    const priority = options?.priority ?? TaskPriority.NORMAL;
    const category = options?.category ?? "default";
    const signal = options?.signal;

    if (signal?.aborted) {
      return Promise.reject(new Error("Task was aborted before execution"));
    }

    return new Promise<T>((resolve, reject) => {
      const task: QueuedTask<T> = {
        id: `c-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        fn,
        priority,
        category,
        resolve,
        reject,
        signal,
      };

      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            const idx = this.queue.indexOf(task as QueuedTask);
            if (idx !== -1) {
              this.queue.splice(idx, 1);
              reject(new Error("Task was aborted"));
            }
          },
          { once: true }
        );
      }

      this.enqueueTask(task as QueuedTask);
      this.drainQueue();
    });
  }

  private enqueueTask(task: QueuedTask): void {
    // Priority order: CRITICAL (1) > HIGH (2) > NORMAL (3) > LOW (4)
    let insertIdx = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      if (task.priority < this.queue[i].priority) {
        insertIdx = i;
        break;
      }
    }
    this.queue.splice(insertIdx, 0, task);
  }

  private drainQueue(): void {
    if (this.isDisposed || this.queue.length === 0) return;

    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];
      const category = task.category;
      const currentRunning = this.runningByCategory.get(category) ?? 0;
      const maxConcurrent = this.getMaxConcurrency(category);

      if (currentRunning < maxConcurrent) {
        // Run this task
        this.queue.splice(i, 1);
        i--;

        this.runningByCategory.set(category, currentRunning + 1);

        void (async () => {
          try {
            if (task.signal?.aborted) {
              task.reject(new Error("Task aborted"));
              return;
            }
            const res = await task.fn();
            task.resolve(res);
          } catch (err) {
            task.reject(err);
          } finally {
            const active = this.runningByCategory.get(category) ?? 1;
            this.runningByCategory.set(category, Math.max(0, active - 1));
            this.drainQueue();
          }
        })();
      }
    }
  }

  /**
   * Cooperative yield to the main thread.
   * If a continuous computational loop has executed for longer than `timeLimitMs`,
   * yields control to allow UI renders, touch events, and gestures to run smoothly.
   */
  public async yieldToMain(startTime?: number, timeLimitMs = 8): Promise<void> {
    const start = startTime ?? performance.now();
    if (performance.now() - start < timeLimitMs) {
      return;
    }

    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    } else {
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    }
  }

  /**
   * Schedules a visual UI update on the next animation frame, coalescing rapid calls.
   */
  public scheduleAnimationFrame(key: string, callback: () => void): void {
    if (this.isDisposed) return;

    if (this.scheduledFrames.has(key)) {
      return; // Already scheduled for this frame
    }

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      const frameId = window.requestAnimationFrame(() => {
        this.scheduledFrames.delete(key);
        if (!this.isDisposed) {
          callback();
        }
      });
      this.scheduledFrames.set(key, frameId);
    } else {
      queueMicrotask(() => {
        this.scheduledFrames.delete(key);
        if (!this.isDisposed) {
          callback();
        }
      });
    }
  }

  public cancelAnimationFrame(key: string): void {
    const frameId = this.scheduledFrames.get(key);
    if (frameId !== undefined) {
      if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameId);
      }
      this.scheduledFrames.delete(key);
    }
  }

  /**
   * Creates a debounced function that delays invocation until delayMs has elapsed.
   */
  public debounce<Args extends unknown[]>(
    fn: (...args: Args) => void,
    delayMs = 150
  ): { (...args: Args): void; cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const debounced = (...args: Args) => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!this.isDisposed) {
          fn(...args);
        }
      }, delayMs);
    };

    debounced.cancel = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    return debounced;
  }

  /**
   * Creates a throttled function that invokes at most once per intervalMs.
   */
  public throttle<Args extends unknown[]>(
    fn: (...args: Args) => void,
    intervalMs = 16
  ): { (...args: Args): void; cancel: () => void } {
    let lastTime = -Infinity;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: Args | null = null;

    const throttled = (...args: Args) => {
      const now = performance.now();
      lastArgs = args;

      if (now - lastTime >= intervalMs) {
        lastTime = now;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        fn(...args);
      } else if (timer === null) {
        const remaining = intervalMs - (now - lastTime);
        timer = setTimeout(() => {
          timer = null;
          lastTime = performance.now();
          if (lastArgs && !this.isDisposed) {
            fn(...lastArgs);
          }
        }, remaining);
      }
    };

    throttled.cancel = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    return throttled;
  }

  public dispose(): void {
    this.isDisposed = true;

    for (const frameId of this.scheduledFrames.values()) {
      if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameId);
      }
    }
    this.scheduledFrames.clear();

    for (const task of this.queue) {
      task.reject(new Error("ConcurrencyManager disposed"));
    }
    this.queue = [];
    this.runningByCategory.clear();
  }
}

/** Global singleton concurrency manager */
export const defaultConcurrencyManager = new ConcurrencyManager();
