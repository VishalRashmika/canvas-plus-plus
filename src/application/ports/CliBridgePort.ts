import { Id } from "../../domain/types";
import { DiagramNode } from "../../domain/entities/DiagramNode";
import { DiagramEdge } from "../../domain/entities/DiagramEdge";

/**
 * Mirrors the patch file format in docs/08-CLI-INTEGRATION-SPEC.md.
 * Kept here (application layer) because validating/applying a patch is a
 * use-case concern; only the mechanism of *how* a patch file arrives is
 * infrastructure (FileWatcherBridge).
 */
export type PatchOperation =
  | { op: "addNode"; node: DiagramNode }
  | { op: "updateNode"; nodeId: Id; changes: Partial<DiagramNode> }
  | { op: "deleteNode"; nodeId: Id }
  | { op: "addEdge"; edge: DiagramEdge }
  | { op: "updateEdge"; edgeId: Id; changes: Partial<DiagramEdge> }
  | { op: "deleteEdge"; edgeId: Id };

export interface DiagramPatch {
  targetDiagramId: Id;
  baseSchemaVersion: number;
  expectedFileHash: string;
  operations: PatchOperation[];
}

export type PatchRejectionReason =
  | "stale-base"
  | "permission-denied"
  | "invalid-schema"
  | "unknown-target";

export interface PatchResult {
  accepted: boolean;
  reason?: PatchRejectionReason;
  /** Populated when reason is "permission-denied" — the ids that blocked it. */
  offendingIds?: Id[];
}

/**
 * Port for whatever mechanism delivers external patches (file-watcher in
 * v1, potentially a socket later — see docs/08-CLI-INTEGRATION-SPEC.md).
 * Infrastructure implements this; the ApplyExternalPatch use-case consumes
 * it plus DiagramRepository.
 */
export interface CliBridgePort {
  /** Registers a handler invoked whenever a new patch file is detected. */
  onPatchReceived(handler: (patch: DiagramPatch) => Promise<PatchResult>): void;
  /** Called after a patch is processed, to clean up / mark rejected on disk. */
  acknowledge(patch: DiagramPatch, result: PatchResult): Promise<void>;
}
