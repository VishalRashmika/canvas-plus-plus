import { App, FuzzySuggestModal, TFile } from "obsidian";

/**
 * Checks if a given file or filename represents a PDF document.
 */
export function isPdfFile(fileOrExt: string | TFile): boolean {
  const ext =
    typeof fileOrExt === "string"
      ? fileOrExt.split(".").pop()?.toLowerCase() ?? ""
      : fileOrExt.extension?.toLowerCase() ?? "";
  return ext === "pdf";
}

/**
 * Obsidian fuzzy search modal for selecting vault PDF documents to place onto the canvas
 * as embedded interactive PDF viewer cards.
 */
export class PdfSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onSelect: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder("Search vault PDF documents to insert (e.g. .pdf)...");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file: TFile) => isPdfFile(file));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onSelect(file);
  }
}
