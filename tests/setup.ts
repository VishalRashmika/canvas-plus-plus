// Jest test environment setup for Node
const defaultWindow: any = {
  ...globalThis,
  setTimeout: setTimeout.bind(globalThis),
  clearTimeout: clearTimeout.bind(globalThis),
  requestAnimationFrame: (cb: (time: number) => void) => {
    return setTimeout(() => cb(Date.now()), 0) as any;
  },
  cancelAnimationFrame: (id: any) => {
    clearTimeout(id);
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
        val.setTimeout = setTimeout.bind(globalThis);
      }
      if (!val.clearTimeout) {
        val.clearTimeout = clearTimeout.bind(globalThis);
      }
      if (!val.requestAnimationFrame) {
        val.requestAnimationFrame = (cb: (time: number) => void) => {
          return setTimeout(() => cb(Date.now()), 0) as any;
        };
      }
      if (!val.cancelAnimationFrame) {
        val.cancelAnimationFrame = (id: any) => {
          clearTimeout(id);
        };
      }
    }
    currentWindow = val;
  },
  configurable: true,
});
