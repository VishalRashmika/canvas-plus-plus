import { createHash } from "node:crypto";

export function computeSha256(content: string): string {
  try {
    return createHash("sha256").update(content, "utf8").digest("hex");
  } catch {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = (hash << 5) - hash + content.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}
