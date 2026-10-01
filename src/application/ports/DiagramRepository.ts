import { Diagram } from "../../domain/entities/Diagram";
import { Id } from "../../domain/types";

/**
 * Application-layer port for loading/saving diagrams. Implemented in
 * infrastructure/persistence (and backed by infrastructure/obsidian for
 * actual vault I/O) — application code depends only on this interface.
 * See docs/01-ARCHITECTURE.md.
 */
export interface DiagramRepository {
  load(id: Id): Promise<Diagram>;
  save(diagram: Diagram): Promise<void>;
  exists(id: Id): Promise<boolean>;
  delete(id: Id): Promise<void>;
}
