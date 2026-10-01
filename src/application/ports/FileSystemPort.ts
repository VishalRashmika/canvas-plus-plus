/**
 * Minimal file-system abstraction the application layer needs (reading/
 * writing raw text, listing a directory, watching for changes). Backed by
 * Obsidian's Vault API in infrastructure/obsidian, but application code
 * never imports "obsidian" directly. See docs/01-ARCHITECTURE.md.
 */
export interface FileSystemPort {
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(directoryPath: string): Promise<string[]>;
  delete(path: string): Promise<void>;
  /** Returns an unsubscribe function. */
  watch(path: string, onChange: () => void): () => void;
}
