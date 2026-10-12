import { App, FuzzySuggestModal, TFile } from "obsidian";

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
  "avif",
]);

export function isImageFile(fileOrExt: string | TFile): boolean {
  const ext =
    typeof fileOrExt === "string"
      ? fileOrExt.split(".").pop()?.toLowerCase() ?? ""
      : fileOrExt.extension?.toLowerCase() ?? "";
  return SUPPORTED_IMAGE_EXTENSIONS.has(ext);
}

/**
 * Obsidian fuzzy search modal for selecting vault images to place onto the canvas
 * with a photo frame and editable title.
 */
export class ImageSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onSelect: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder("Search vault images to insert (e.g. .png, .jpg, .svg)...");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file: TFile) => isImageFile(file));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onSelect(file);
  }
}
