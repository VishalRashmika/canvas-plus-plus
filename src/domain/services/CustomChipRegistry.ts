import {
  ChipInterfaceDefinition,
} from "../entities/ChipInterfaceDefinition";
import { defaultChipService } from "./ChipService";

export const DEFAULT_STARTER_CHIPS: ChipInterfaceDefinition[] = [
  defaultChipService.createChipInterface("74ls00", "74LS00 (Quad NAND)", [
    { name: "1A", direction: "in", side: "left" },
    { name: "1B", direction: "in", side: "left" },
    { name: "1Y", direction: "out", side: "right" },
    { name: "2A", direction: "in", side: "left" },
    { name: "2B", direction: "in", side: "left" },
    { name: "2Y", direction: "out", side: "right" },
    { name: "GND", direction: "inout", side: "bottom" },
    { name: "3Y", direction: "out", side: "right" },
    { name: "3A", direction: "in", side: "left" },
    { name: "3B", direction: "in", side: "left" },
    { name: "4Y", direction: "out", side: "right" },
    { name: "4A", direction: "in", side: "left" },
    { name: "4B", direction: "in", side: "left" },
    { name: "VCC", direction: "inout", side: "top" },
  ]),
  defaultChipService.createChipInterface("alu-8bit", "ALU [8-Bit]", [
    { name: "A", direction: "in", side: "left", dataType: "[7:0]" },
    { name: "B", direction: "in", side: "left", dataType: "[7:0]" },
    { name: "OP", direction: "in", side: "left", dataType: "[2:0]" },
    { name: "CLK", direction: "in", side: "top", dataType: "clk" },
    { name: "RST", direction: "in", side: "top" },
    { name: "OUT", direction: "out", side: "right", dataType: "[7:0]" },
    { name: "ZERO", direction: "out", side: "right" },
    { name: "CARRY", direction: "out", side: "right" },
    { name: "OVF", direction: "out", side: "right" },
  ]),
  defaultChipService.createChipInterface("reg-8bit", "Register [8-Bit]", [
    { name: "D", direction: "in", side: "left", dataType: "[7:0]" },
    { name: "CLK", direction: "in", side: "left", dataType: "clk" },
    { name: "EN", direction: "in", side: "left" },
    { name: "RST", direction: "in", side: "top" },
    { name: "Q", direction: "out", side: "right", dataType: "[7:0]" },
  ]),
  defaultChipService.createChipInterface("counter-4bit", "Counter [4-Bit]", [
    { name: "CLK", direction: "in", side: "left", dataType: "clk" },
    { name: "EN", direction: "in", side: "left" },
    { name: "RST", direction: "in", side: "left" },
    { name: "Q", direction: "out", side: "right", dataType: "[3:0]" },
    { name: "TC", direction: "out", side: "right" },
  ]),
];

const STORAGE_KEY = "umlcanvas-custom-chips";

export class CustomChipRegistry {
  private chips = new Map<string, ChipInterfaceDefinition>();
  private listeners = new Set<() => void>();

  constructor(includeDefaults = true) {
    if (includeDefaults) {
      this.resetToDefaults(false);
    }
    this.tryLoadFromStorage();
  }

  register(def: ChipInterfaceDefinition, options?: { overwrite?: boolean }): void {
    if (!options?.overwrite && this.chips.has(def.id)) {
      // Check if definition changed, bump version if needed
      const existing = this.chips.get(def.id)!;
      def.version = Math.max(def.version, existing.version);
    }
    this.chips.set(def.id, def);
    this.trySaveToStorage();
    this.notify();
  }

  unregister(id: string): boolean {
    const deleted = this.chips.delete(id);
    if (deleted) {
      this.trySaveToStorage();
      this.notify();
    }
    return deleted;
  }

  get(id: string): ChipInterfaceDefinition | undefined {
    return this.chips.get(id);
  }

  has(id: string): boolean {
    return this.chips.has(id);
  }

  getAll(): ChipInterfaceDefinition[] {
    return Array.from(this.chips.values());
  }

  clear(): void {
    this.chips.clear();
    this.trySaveToStorage();
    this.notify();
  }

  resetToDefaults(notifyListeners = true): void {
    this.chips.clear();
    for (const chip of DEFAULT_STARTER_CHIPS) {
      this.chips.set(chip.id, {
        ...chip,
        ports: chip.ports.map((p) => ({ ...p })),
      });
    }
    if (notifyListeners) {
      this.trySaveToStorage();
      this.notify();
    }
  }

  load(defs: ChipInterfaceDefinition[], merge = true): void {
    if (!merge) {
      this.chips.clear();
    }
    for (const def of defs) {
      this.chips.set(def.id, def);
    }
    this.trySaveToStorage();
    this.notify();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error("Error in CustomChipRegistry listener", e);
      }
    }
  }

  private tryLoadFromStorage(): void {
    try {
      const holder =
        typeof window !== "undefined"
          ? (window as unknown as {
              app?: {
                loadLocalStorage?(key: string): string | null;
                saveLocalStorage?(key: string, value: string): void;
              };
            })
          : undefined;
      const stored = holder?.app?.loadLocalStorage
        ? holder.app.loadLocalStorage(STORAGE_KEY)
        : null;
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (
              item &&
              typeof item === "object" &&
              "id" in item &&
              typeof (item as Record<string, unknown>).id === "string" &&
              "name" in item &&
              typeof (item as Record<string, unknown>).name === "string" &&
              "ports" in item &&
              Array.isArray((item as Record<string, unknown>).ports)
            ) {
              const chipDef = item as ChipInterfaceDefinition;
              this.chips.set(chipDef.id, chipDef);
            }
          }
        }
      }
    } catch {
      // Storage unavailable or disabled
    }
  }

  private trySaveToStorage(): void {
    try {
      const holder =
        typeof window !== "undefined"
          ? (window as unknown as {
              app?: {
                saveLocalStorage?(key: string, value: string): void;
              };
            })
          : undefined;
      if (holder?.app?.saveLocalStorage) {
        const items = this.getAll();
        holder.app.saveLocalStorage(STORAGE_KEY, JSON.stringify(items));
      }
    } catch {
      // Storage unavailable or quota exceeded
    }
  }
}

export const defaultCustomChipRegistry = new CustomChipRegistry();
