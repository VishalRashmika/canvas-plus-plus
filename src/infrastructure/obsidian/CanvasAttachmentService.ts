import { App, normalizePath, TFile, TFolder } from "obsidian";
import { Size } from "../../domain";

export interface CanvasAttachmentFolderInfo {
  /** The folder where the canvas document lives (empty string for vault root) */
  workingDir: string;
  /** The folder name derived from the canvas document name */
  folderName: string;
  /** Full vault-relative path to the canvas document's attachment directory */
  fullFolderPath: string;
}

export interface SavedImageResult {
  file: TFile | null;
  filePath: string;
  src: string;
  title: string;
  size?: Size;
}

export interface SavedPdfResult {
  file: TFile | null;
  filePath: string;
  src: string;
  title: string;
}

/**
 * Service responsible for managing image attachments for canvas documents.
 * Automatically creates a dedicated subfolder named after the canvas document
 * in its working directory, saves pasted image binaries, and prepares metadata
 * to link them to the visual canvas.
 */
export class CanvasAttachmentService {
  constructor(private readonly app: App) {}

  /**
   * Computes the attachment folder for a canvas document.
   * Creates a dedicated directory named from the canvas document in the document's working directory.
   */
  public getCanvasDocumentFolder(
    file: TFile | null,
    diagramTitle?: string
  ): CanvasAttachmentFolderInfo {
    let workingDir = "";
    if (file) {
      if (file.parent && typeof file.parent.path === "string") {
        const parentPath = file.parent.path;
        workingDir = parentPath === "/" || parentPath === "." ? "" : parentPath;
      } else if (file.path && file.path.includes("/")) {
        workingDir = file.path.substring(0, file.path.lastIndexOf("/"));
      }
    }

    // Determine raw canvas document name without canvas/json extensions
    let rawDocName = "";
    if (file) {
      rawDocName = file.basename || file.name || "";
    }
    if (!rawDocName && diagramTitle) {
      rawDocName = diagramTitle;
    }
    if (!rawDocName) {
      rawDocName = "canvas";
    }

    // Cleanly strip any known canvas extensions that might linger in basename/name
    const cleanDocName =
      rawDocName
        .replace(
          /\.(canvas\+\+|canvasplusplus|canvuspp|canvaspp|canvas|umlcanvas|canvpp|json)$/i,
          ""
        )
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim() || "canvas";

    const normalizedWorkingDir = workingDir ? normalizePath(workingDir) : "";
    const fullFolderPath = normalizedWorkingDir
      ? normalizePath(`${normalizedWorkingDir}/${cleanDocName}`)
      : normalizePath(cleanDocName);

    return {
      workingDir: normalizedWorkingDir,
      folderName: cleanDocName,
      fullFolderPath,
    };
  }

  /**
   * Recursively ensures that the specified folder exists in the vault.
   * If it does not exist, creates it.
   */
  public async ensureFolderExists(folderPath: string): Promise<TFolder | null> {
    const normalized = normalizePath(folderPath);
    if (!normalized || normalized === "/" || normalized === ".") return null;

    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFolder) {
      return existing;
    }
    if (existing instanceof TFile) {
      // Path collides with a file, cannot create directory with exact same name
      return null;
    }

    // Ensure parent folder exists first if nested
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash !== -1) {
      const parentPath = normalized.substring(0, lastSlash);
      await this.ensureFolderExists(parentPath);
    }

    try {
      if (typeof this.app.vault.createFolder === "function") {
        return await this.app.vault.createFolder(normalized);
      } else if (this.app.vault.adapter?.mkdir) {
        await this.app.vault.adapter.mkdir(normalized);
        const created = this.app.vault.getAbstractFileByPath(normalized);
        if (created instanceof TFolder) {
          return created;
        }
      }
    } catch {
      // If folder already exists concurrently, recover gracefully
      const check = this.app.vault.getAbstractFileByPath(normalized);
      if (check instanceof TFolder) {
        return check;
      }
    }
    return null;
  }

  /**
   * Generates a collision-free filename and path inside the target folder.
   */
  public getUniqueImageFilePath(
    folderPath: string,
    mimeType?: string,
    originalName?: string
  ): { fileName: string; fullFilePath: string } {
    const ext = this.getImageExtension(mimeType, originalName);
    let baseName = "";

    if (
      originalName &&
      !/^image\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(originalName) &&
      originalName !== "blob" &&
      originalName !== "clipboard.png"
    ) {
      baseName = originalName
        .replace(/\.[^/.]+$/, "")
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim();
    }

    if (!baseName) {
      baseName = `Pasted image ${this.formatTimestamp()}`;
    }

    let fileName = `${baseName}.${ext}`;
    let fullFilePath = normalizePath(`${folderPath}/${fileName}`);

    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(fullFilePath)) {
      fileName = `${baseName} ${counter}.${ext}`;
      fullFilePath = normalizePath(`${folderPath}/${fileName}`);
      counter++;
    }

    return { fileName, fullFilePath };
  }

  /**
   * Saves a pasted image Blob/File into the canvas document's dedicated directory.
   */
  public async savePastedImage(
    blob: Blob,
    options: {
      file: TFile | null;
      diagramTitle?: string;
      preferredName?: string;
    }
  ): Promise<SavedImageResult> {
    const folderInfo = this.getCanvasDocumentFolder(options.file, options.diagramTitle);
    await this.ensureFolderExists(folderInfo.fullFolderPath);

    const rawName =
      "name" in blob && typeof (blob as { name: unknown }).name === "string"
        ? (blob as { name: string }).name
        : undefined;

    const { fileName, fullFilePath } = this.getUniqueImageFilePath(
      folderInfo.fullFolderPath,
      blob.type,
      options.preferredName || rawName
    );

    const arrayBuffer = await this.blobToArrayBuffer(blob);

    let createdFile: TFile | null = null;
    if (typeof this.app.vault.createBinary === "function") {
      createdFile = await this.app.vault.createBinary(fullFilePath, arrayBuffer);
    } else if (this.app.vault.adapter?.writeBinary) {
      await this.app.vault.adapter.writeBinary(fullFilePath, arrayBuffer);
      const fetched = this.app.vault.getAbstractFileByPath(fullFilePath);
      if (fetched instanceof TFile) createdFile = fetched;
    } else if (typeof this.app.vault.create === "function") {
      const textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
      const strData = textDecoder ? textDecoder.decode(arrayBuffer) : "";
      createdFile = await this.app.vault.create(fullFilePath, strData);
    }

    const file =
      createdFile ?? (this.app.vault.getAbstractFileByPath(fullFilePath) as TFile | null);

    let src = "";
    if (file && typeof this.app.vault.getResourcePath === "function") {
      try {
        src = this.app.vault.getResourcePath(file);
      } catch {
        src = fullFilePath;
      }
    }
    if (!src) {
      src = fullFilePath;
    }

    // Try measuring natural image dimensions to calculate ideal photo frame dimensions
    const dims = await this.measureImageDimensions(blob);
    let size: Size | undefined = undefined;
    if (dims && dims.width > 0 && dims.height > 0) {
      const aspect = dims.width / dims.height;
      let targetW = 260;
      if (aspect > 1.4) targetW = 320;
      else if (aspect < 0.7) targetW = 200;
      const imgH = Math.round((targetW - 20) / aspect);
      const totalH = Math.max(140, Math.min(600, imgH + 58));
      size = { width: targetW, height: totalH };
    }

    return {
      file,
      filePath: fullFilePath,
      src,
      title: fileName.replace(/\.[^/.]+$/, ""),
      size,
    };
  }

  /**
   * Generates a collision-free filename and path for PDF documents inside the target folder.
   */
  public getUniquePdfFilePath(
    folderPath: string,
    originalName?: string
  ): { fileName: string; fullFilePath: string } {
    let baseName = "";

    if (
      originalName &&
      !/^document\.pdf$/i.test(originalName) &&
      originalName !== "blob" &&
      originalName !== "clipboard.pdf"
    ) {
      baseName = originalName
        .replace(/\.[^/.]+$/, "")
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim();
    }

    if (!baseName) {
      baseName = `Document ${this.formatTimestamp()}`;
    }

    let fileName = `${baseName}.pdf`;
    let fullFilePath = normalizePath(`${folderPath}/${fileName}`);

    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(fullFilePath)) {
      fileName = `${baseName} ${counter}.pdf`;
      fullFilePath = normalizePath(`${folderPath}/${fileName}`);
      counter++;
    }

    return { fileName, fullFilePath };
  }

  /**
   * Saves a pasted or imported PDF Blob/File into the canvas document's dedicated directory.
   * Prevents large base64 data URLs from bloating the document and freezing the main thread.
   */
  public async savePastedPdf(
    blob: Blob,
    options: {
      file: TFile | null;
      diagramTitle?: string;
      preferredName?: string;
    }
  ): Promise<SavedPdfResult> {
    const folderInfo = this.getCanvasDocumentFolder(options.file, options.diagramTitle);
    await this.ensureFolderExists(folderInfo.fullFolderPath);

    const rawName =
      "name" in blob && typeof (blob as { name: unknown }).name === "string"
        ? (blob as { name: string }).name
        : undefined;

    const { fileName, fullFilePath } = this.getUniquePdfFilePath(
      folderInfo.fullFolderPath,
      options.preferredName || rawName
    );

    const arrayBuffer = await this.blobToArrayBuffer(blob);

    let createdFile: TFile | null = null;
    if (typeof this.app.vault.createBinary === "function") {
      createdFile = await this.app.vault.createBinary(fullFilePath, arrayBuffer);
    } else if (this.app.vault.adapter?.writeBinary) {
      await this.app.vault.adapter.writeBinary(fullFilePath, arrayBuffer);
      const fetched = this.app.vault.getAbstractFileByPath(fullFilePath);
      if (fetched instanceof TFile) createdFile = fetched;
    } else if (typeof this.app.vault.create === "function") {
      const textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
      const strData = textDecoder ? textDecoder.decode(arrayBuffer) : "";
      createdFile = await this.app.vault.create(fullFilePath, strData);
    }

    const file =
      createdFile ?? (this.app.vault.getAbstractFileByPath(fullFilePath) as TFile | null);

    let src = "";
    if (file && typeof this.app.vault.getResourcePath === "function") {
      try {
        src = this.app.vault.getResourcePath(file);
      } catch {
        src = fullFilePath;
      }
    }
    if (!src) {
      src = fullFilePath;
    }

    return {
      file,
      filePath: fullFilePath,
      src,
      title: fileName.replace(/\.[^/.]+$/, ""),
    };
  }

  /**
   * Helper to convert base64 data URL to Blob if pasted as plain text
   */
  public dataUrlToBlob(dataUrl: string): Blob | null {
    try {
      const parts = dataUrl.split(",");
      if (parts.length < 2) return null;
      const match = parts[0].match(/:(.*?);/);
      const mime = match ? match[1] : "image/png";
      const byteString =
        typeof atob !== "undefined"
          ? atob(parts[1])
          : Buffer.from(parts[1], "base64").toString("binary");
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      return new Blob([ab], { type: mime });
    } catch {
      return null;
    }
  }

  /**
   * Converts a Blob to an ArrayBuffer in any environment.
   */
  public async blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    if (typeof blob.arrayBuffer === "function") {
      return await blob.arrayBuffer();
    }
    return new Promise((resolve, reject) => {
      if (typeof FileReader === "undefined") {
        reject(new Error("FileReader is not available"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () =>
        reject(reader.error || new Error("Failed to read image blob"));
      reader.readAsArrayBuffer(blob);
    });
  }

  /**
   * Measures image dimensions to retain aspect ratio when placing onto canvas.
   */
  public async measureImageDimensions(
    blob: Blob
  ): Promise<{ width: number; height: number } | null> {
    if (typeof Image === "undefined") return null;
    return new Promise((resolve) => {
      try {
        if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(url);
            resolve({
              width: img.naturalWidth || img.width,
              height: img.naturalHeight || img.height,
            });
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
          };
          img.src = url;
        } else if (typeof FileReader !== "undefined") {
          const reader = new FileReader();
          reader.onload = () => {
            const img = new Image();
            img.onload = () => {
              resolve({
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height,
              });
            };
            img.onerror = () => resolve(null);
            img.src = reader.result as string;
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });
  }

  private getImageExtension(mimeType?: string, fileName?: string): string {
    if (fileName && fileName.includes(".")) {
      const ext = fileName.split(".").pop()?.toLowerCase();
      if (
        ext &&
        ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(ext)
      ) {
        return ext === "jpeg" ? "jpg" : ext;
      }
    }
    if (mimeType) {
      const lower = mimeType.toLowerCase();
      if (lower.includes("png")) return "png";
      if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
      if (lower.includes("gif")) return "gif";
      if (lower.includes("webp")) return "webp";
      if (lower.includes("svg")) return "svg";
      if (lower.includes("bmp")) return "bmp";
      if (lower.includes("avif")) return "avif";
    }
    return "png";
  }

  private formatTimestamp(date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const h = pad(date.getHours());
    const min = pad(date.getMinutes());
    const s = pad(date.getSeconds());
    return `${y}${m}${d}${h}${min}${s}`;
  }
}
