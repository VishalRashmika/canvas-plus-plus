import { App, Modal, Setting } from "obsidian";

/**
 * Modal dialog for entering or changing the target page number or subpath
 * of an embedded PDF document on the visual canvas.
 * Complies with the Obsidian plugin deployment checklist by replacing window.prompt.
 */
export class PdfPageModal extends Modal {
  private pageInput = "";

  constructor(
    app: App,
    private readonly currentSubpath: string,
    private readonly onSubmit: (newSubpath: string) => void
  ) {
    super(app);
    const match = currentSubpath.match(/page=(\d+)/i);
    this.pageInput = match ? match[1] : (currentSubpath ? currentSubpath.replace(/^#/, "") : "1");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Go to page", cls: "umlcanvas-modal-title" });

    new Setting(contentEl)
      .setName("Page number or subpath")
      .setDesc("Enter a page number (e.g. 5) or subpath (e.g. #page=5)")
      .addText((text) => {
        text.setValue(this.pageInput);
        text.onChange((val) => {
          this.pageInput = val;
        });
        text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.submit();
          }
        });
        setTimeout(() => text.inputEl.focus(), 50);
      });

    new Setting(contentEl)
      .addButton((btn) => {
        btn
          .setButtonText("Apply")
          .setCta()
          .onClick(() => this.submit());
      })
      .addButton((btn) => {
        btn
          .setButtonText("Clear page")
          .onClick(() => {
            this.onSubmit("");
            this.close();
          });
      })
      .addButton((btn) => {
        btn.setButtonText("Cancel").onClick(() => this.close());
      });
  }

  private submit(): void {
    const trimmed = this.pageInput.trim();
    if (!trimmed) {
      this.onSubmit("");
    } else if (/^\d+$/.test(trimmed)) {
      this.onSubmit(`#page=${trimmed}`);
    } else {
      this.onSubmit(trimmed.startsWith("#") ? trimmed : `#${trimmed}`);
    }
    this.close();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
