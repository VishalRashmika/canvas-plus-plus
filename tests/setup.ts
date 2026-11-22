// Jest test environment setup for Node
const defaultWindow: any = {
  ...globalThis,
  setTimeout: (...args: any[]) => (globalThis as any).setTimeout(...args),
  clearTimeout: (...args: any[]) => (globalThis as any).clearTimeout(...args),
  requestAnimationFrame: (cb: (time: number) => void) => {
    return (globalThis as any).setTimeout(() => cb(Date.now()), 0);
  },
  cancelAnimationFrame: (id: any) => {
    (globalThis as any).clearTimeout(id);
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

let currentWindow: any = defaultWindow;

Object.defineProperty(global, "window", {
  get() {
    return currentWindow;
  },
  set(val) {
    if (val && typeof val === "object") {
      if (!val.setTimeout) {
        val.setTimeout = (...args: any[]) => (globalThis as any).setTimeout(...args);
      }
      if (!val.clearTimeout) {
        val.clearTimeout = (...args: any[]) => (globalThis as any).clearTimeout(...args);
      }
      if (!val.requestAnimationFrame) {
        val.requestAnimationFrame = (cb: (time: number) => void) => {
          return (globalThis as any).setTimeout(() => cb(Date.now()), 0);
        };
      }
      if (!val.cancelAnimationFrame) {
        val.cancelAnimationFrame = (id: any) => {
          (globalThis as any).clearTimeout(id);
        };
      }
    }
    currentWindow = val;
  },
  configurable: true,
});
