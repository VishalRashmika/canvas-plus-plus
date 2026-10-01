/**
 * Trivial abstraction over "now", so use-cases that timestamp things
 * (patch files, autosave debouncing) are deterministic in tests.
 */
export interface ClockPort {
  nowIso(): string;
  nowMillis(): number;
}
