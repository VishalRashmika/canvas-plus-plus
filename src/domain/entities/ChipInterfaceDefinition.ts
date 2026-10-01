import { Id } from "../types";
import { Port } from "./Port";

/**
 * The PUBLIC contract of a schematic "chip" — a named list of ports.
 * Editing this and choosing to propagate resyncs every instance node's
 * ports; version bumps on any breaking change (port removed/renamed/
 * direction changed). See docs/06-SCHEMATIC-CHIP-SPEC.md.
 */
export interface ChipInterfaceDefinition {
  readonly id: Id;
  name: string;
  ports: Port[];
  version: number;
}

export function createChipInterfaceDefinition(params: {
  id: Id;
  name: string;
  ports?: Port[];
}): ChipInterfaceDefinition {
  return {
    id: params.id,
    name: params.name,
    ports: params.ports ?? [],
    version: 1,
  };
}

/**
 * A change is "breaking" (must bump `version`) if it removes a port,
 * renames one, or changes its direction. Adding a new port is non-breaking.
 * See docs/06-SCHEMATIC-CHIP-SPEC.md "Editing workflow".
 */
export function isBreakingChange(
  previous: ChipInterfaceDefinition,
  next: ChipInterfaceDefinition
): boolean {
  const prevById = new Map(previous.ports.map((p) => [p.id, p]));
  for (const prevPort of prevById.values()) {
    const nextPort = next.ports.find((p) => p.id === prevPort.id);
    if (!nextPort) return true; // removed
    if (nextPort.name !== prevPort.name) return true; // renamed
    if (nextPort.direction !== prevPort.direction) return true; // direction changed
  }
  return false;
}
