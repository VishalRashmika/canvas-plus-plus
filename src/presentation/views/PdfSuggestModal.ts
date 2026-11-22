import { App, FuzzySuggestModal, TFile } from "obsidian";

/**
 * Checks if a given file, filename, or link represents a PDF document.
 * Handles subpaths (#page=1), query strings (?v=1), and case-insensitive extensions (.PDF).
 */
export function isPdfFile(fileOrExt: string | TFile | { path?: string; name?: string; extension?: string }): boolean {
  if (!fileOrExt) return false;
  if (typeof fileOrExt === "string") {
    const clean = fileOrExt.split(/[?#]/)[0].trim();
    const ext = clean.split(".").pop()?.toLowerCase() ?? "";
    return ext === "pdf";
  }
  if (fileOrExt.extension) {
    const cleanExt = fileOrExt.extension.split(/[?#]/)[0].toLowerCase().trim();
    if (cleanExt === "pdf") return true;
  }
  const rawPath = fileOrExt.path || fileOrExt.name || "";
  if (rawPath) {
    const clean = rawPath.split(/[?#]/)[0].trim();
    const ext = clean.split(".").pop()?.toLowerCase() ?? "";
    return ext === "pdf";
  }
  return false;
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
