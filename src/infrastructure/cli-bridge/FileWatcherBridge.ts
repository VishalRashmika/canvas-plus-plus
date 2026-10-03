import {
  CliBridgePort,
  DiagramPatch,
  PatchResult,
  PatchOperation,
} from "../../application/ports/CliBridgePort";
import { FileSystemPort } from "../../application/ports/FileSystemPort";
import { Id } from "../../domain/types";

export interface FileWatcherBridgeOptions {
  fs: FileSystemPort;
  patchesDir?: string;
  patchHandler?: (patch: DiagramPatch) => Promise<PatchResult>;
  onHotReload?: (diagramId: Id) => void;
}

export class FileWatcherBridge implements CliBridgePort {
  private readonly fs: FileSystemPort;
  private readonly patchesDir: string;
  private patchHandler?: (patch: DiagramPatch) => Promise<PatchResult>;
  private readonly reloadListeners = new Set<(diagramId: Id) => void>();
  private readonly pendingPatches = new Map<DiagramPatch, string>();
  private unsubscribeWatcher: (() => void) | null = null;
  private isProcessing = false;
  private hasQueuedRun = false;

  constructor(options: FileWatcherBridgeOptions) {
    this.fs = options.fs;
    this.patchesDir = options.patchesDir ?? ".umlcanvas-patches";
    if (options.patchHandler) {
      this.patchHandler = options.patchHandler;
    }
    if (options.onHotReload) {
      this.reloadListeners.add(options.onHotReload);
    }
  }

  onPatchReceived(handler: (patch: DiagramPatch) => Promise<PatchResult>): void {
    this.patchHandler = handler;
  }

  onHotReload(listener: (diagramId: Id) => void): () => void {
    this.reloadListeners.add(listener);
    return () => {
      this.reloadListeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.unsubscribeWatcher) {
      return;
    }

    this.unsubscribeWatcher = this.fs.watch(this.patchesDir, () => {
      void this.processPendingPatches();
    });

    await this.processPendingPatches();
  }

  stop(): void {
    if (this.unsubscribeWatcher) {
      this.unsubscribeWatcher();
      this.unsubscribeWatcher = null;
    }
  }

  get isRunning(): boolean {
    return this.unsubscribeWatcher !== null;
  }

  async processPendingPatches(): Promise<void> {
    if (this.isProcessing) {
      this.hasQueuedRun = true;
      return;
    }

    this.isProcessing = true;
    try {
      let files: string[] = [];
      try {
        files = await this.fs.list(this.patchesDir);
      } catch {
        files = [];
      }

      const patchFiles = files.filter((f) => f.endsWith(".patch.json"));
      patchFiles.sort();

      for (const filePath of patchFiles) {
        if (!(await this.fs.exists(filePath))) {
          continue;
        }
        await this.processPatchFile(filePath);
      }
    } finally {
      this.isProcessing = false;
      if (this.hasQueuedRun) {
        this.hasQueuedRun = false;
        await this.processPendingPatches();
      }
    }
  }

  private async processPatchFile(filePath: string): Promise<void> {
    let content: string;
    try {
      content = await this.fs.readText(filePath);
    } catch {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      await this.writeRejected(filePath, null, {
        accepted: false,
        reason: "invalid-schema",
      });
      await this.fs.delete(filePath);
      return;
    }

    if (!this.isValidPatch(parsed)) {
      await this.writeRejected(filePath, parsed, {
        accepted: false,
        reason: "invalid-schema",
      });
      await this.fs.delete(filePath);
      return;
    }

    const patch = parsed;
    this.pendingPatches.set(patch, filePath);

    if (this.patchHandler) {
      try {
        const result = await this.patchHandler(patch);
        await this.acknowledge(patch, result, filePath);
      } catch {
        await this.acknowledge(
          patch,
          { accepted: false, reason: "invalid-schema" },
          filePath
        );
      }
    }
  }

  async acknowledge(
    patch: DiagramPatch,
    result: PatchResult,
    explicitPath?: string
  ): Promise<void> {
    const filePath = explicitPath ?? this.pendingPatches.get(patch);
    this.pendingPatches.delete(patch);

    if (result.accepted) {
      if (filePath && (await this.fs.exists(filePath))) {
        await this.fs.delete(filePath);
      }
      this.notifyHotReload(patch.targetDiagramId);
    } else {
      if (filePath && (await this.fs.exists(filePath))) {
        await this.writeRejected(filePath, patch, result);
        await this.fs.delete(filePath);
      }
    }
  }

  private async writeRejected(
    originalPath: string,
    patch: unknown,
    result: PatchResult
  ): Promise<void> {
    const rejectedPath = originalPath.endsWith(".patch.json")
      ? originalPath.replace(/\.patch\.json$/, ".rejected.json")
      : `${originalPath}.rejected.json`;

    const rejectionPayload = {
      rejectedAt: new Date().toISOString(),
      result,
      patch,
    };

    await this.fs.writeText(
      rejectedPath,
      JSON.stringify(rejectionPayload, null, 2)
    );
  }

  private notifyHotReload(diagramId: Id): void {
    for (const listener of this.reloadListeners) {
      try {
        listener(diagramId);
      } catch (err) {
        console.error("Error in hot reload listener:", err);
      }
    }
  }

  private isValidPatch(obj: unknown): obj is DiagramPatch {
    if (!obj || typeof obj !== "object") return false;
    const candidate = obj as Partial<DiagramPatch>;

    if (
      typeof candidate.targetDiagramId !== "string" ||
      candidate.targetDiagramId.trim().length === 0
    ) {
      return false;
    }

    if (typeof candidate.baseSchemaVersion !== "number") {
      return false;
    }

    if (typeof candidate.expectedFileHash !== "string") {
      return false;
    }

    if (!Array.isArray(candidate.operations)) {
      return false;
    }

    for (const op of candidate.operations) {
      if (!this.isValidOperation(op)) {
        return false;
      }
    }

    return true;
  }

  private isValidOperation(op: unknown): op is PatchOperation {
    if (!op || typeof op !== "object") return false;
    const o = op as Partial<PatchOperation>;

    switch (o.op) {
      case "addNode":
        return Boolean(o.node && typeof o.node.id === "string" && typeof o.node.kind === "string");
      case "updateNode":
        return Boolean(o.nodeId && typeof o.changes === "object");
      case "deleteNode":
        return Boolean(typeof o.nodeId === "string");
      case "addEdge":
        return Boolean(
          o.edge &&
            typeof o.edge.id === "string" &&
            typeof o.edge.fromNodeId === "string" &&
            typeof o.edge.toNodeId === "string"
        );
      case "updateEdge":
        return Boolean(o.edgeId && typeof o.changes === "object");
      case "deleteEdge":
        return Boolean(typeof o.edgeId === "string");
      default:
        return false;
    }
  }
}
