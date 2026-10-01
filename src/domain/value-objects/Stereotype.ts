/**
 * UML stereotype, rendered as «name». Every diagram-type component must go
 * through this value object rather than hand-formatting guillemets — see
 * docs/05-UML-DIAGRAM-SPECS.md "Shared rules across all UML types".
 * Pure TypeScript. No obsidian, no DOM.
 */

const OPEN = "\u00AB"; // «
const CLOSE = "\u00BB"; // »

export class Stereotype {
  private constructor(public readonly name: string) {}

  /** Accepts either a bare name ("interface") or a pre-decorated one ("«interface»"). */
  static from(raw: string): Stereotype {
    const trimmed = raw.trim();
    const stripped =
      trimmed.startsWith(OPEN) && trimmed.endsWith(CLOSE)
        ? trimmed.slice(OPEN.length, trimmed.length - CLOSE.length).trim()
        : trimmed;

    if (stripped.length === 0) {
      throw new Error("Stereotype name must not be empty");
    }
    return new Stereotype(stripped);
  }

  /** Renders as «name», the only place this formatting should happen. */
  format(): string {
    return `${OPEN}${this.name}${CLOSE}`;
  }

  toString(): string {
    return this.format();
  }
}
