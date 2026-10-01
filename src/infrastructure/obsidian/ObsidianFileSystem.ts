import { Vault, EventRef, TAbstractFile } from "obsidian";
import { FileSystemPort } from "../../application/ports/FileSystemPort";

/**
 * Obsidian Vault adapter implementing FileSystemPort.
 * Encapsulates all Obsidian Vault I/O so application code remains decoupled.
 */
export class ObsidianFileSystem implements FileSystemPort {
  constructor(private readonly vault: Vault) {}

  async readText(path: string): Promise<string> {
    return this.vault.adapter.read(path);
  }

  async writeText(path: string, contents: string): Promise<void> {
    const parts = path.split("/");
    if (parts.length > 1) {
      const dir = parts.slice(0, -1).join("/");
      const exists = await this.vault.adapter.exists(dir);
      if (!exists) {
        await this.vault.adapter.mkdir(dir);
      }
    }
    return this.vault.adapter.write(path, contents);
  }

  async exists(path: string): Promise<boolean> {
    return this.vault.adapter.exists(path);
  }

  async list(directoryPath: string): Promise<string[]> {
    const exists = await this.vault.adapter.exists(directoryPath);
    if (!exists) {
      return [];
    }
    const res = await this.vault.adapter.list(directoryPath);
    return res.files;
  }

  async delete(path: string): Promise<void> {
    const exists = await this.vault.adapter.exists(path);
    if (exists) {
      await this.vault.adapter.remove(path);
    }
  }

  watch(path: string, onChange: () => void): () => void {
    const prefix = path.endsWith("/") ? path : path + "/";
    const checkAndNotify = (file: TAbstractFile) => {
      if (file.path === path || file.path.startsWith(prefix)) {
        onChange();
      }
    };

    const refCreate: EventRef = this.vault.on("create", checkAndNotify);
    const refModify: EventRef = this.vault.on("modify", checkAndNotify);
    const refDelete: EventRef = this.vault.on("delete", checkAndNotify);

    return () => {
      this.vault.offref(refCreate);
      this.vault.offref(refModify);
      this.vault.offref(refDelete);
    };
  }
}
