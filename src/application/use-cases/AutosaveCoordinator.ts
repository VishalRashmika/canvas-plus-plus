import { Diagram } from "../../domain/entities/Diagram";
import { DiagramEditor } from "./DiagramEditor";

export class AutosaveCoordinator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private isSaving = false;
  private pendingSaveAfterCurrent = false;

  constructor(
    private readonly editor: DiagramEditor,
    private readonly saveFn: (diagram: Diagram) => Promise<void>,
    private readonly delayMs = 500
  ) {
    this.unsubscribe = this.editor.subscribe(() => {
      if (this.editor.isDirty) {
        this.scheduleAutosave();
      }
    });
  }

  get isTimerPending(): boolean {
    return this.timer !== null;
  }

  scheduleAutosave(): void {
    this.cancelPendingTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.performSave();
    }, this.delayMs);
  }

  async saveExplicitly(): Promise<void> {
    this.cancelPendingTimer();
    await this.performSave();
  }

  private async performSave(): Promise<void> {
    if (this.isSaving) {
      this.pendingSaveAfterCurrent = true;
      return;
    }

    this.isSaving = true;
    try {
      await this.saveFn(this.editor.diagram);
      this.editor.markClean();
    } finally {
      this.isSaving = false;
      if (this.pendingSaveAfterCurrent) {
        this.pendingSaveAfterCurrent = false;
        void this.performSave();
      }
    }
  }

  private cancelPendingTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.cancelPendingTimer();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
