// Jest test environment setup for Node
const defaultWindow: any = {
  ...globalThis,
  setTimeout: setTimeout.bind(globalThis),
  clearTimeout: clearTimeout.bind(globalThis),
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
    }
    currentWindow = val;
  },
  configurable: true,
});
