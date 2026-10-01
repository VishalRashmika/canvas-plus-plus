import { App, FuzzySuggestModal, TFile } from "obsidian";

/**
 * Obsidian fuzzy search modal for selecting vault markdown notes to place onto the UML canvas.
 */
export class NoteSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onSelect: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder("Type note title to add to canvas...");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onSelect(file);
  }
}
