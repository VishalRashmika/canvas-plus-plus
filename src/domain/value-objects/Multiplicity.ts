/**
 * UML multiplicity, e.g. "1", "0..1", "1..*", "*", "3..5".
 * Pure TypeScript. No obsidian, no DOM.
 */

const UNBOUNDED = "*";

export class Multiplicity {
  private constructor(
    public readonly lower: number,
    /** Upper bound, or the literal string "*" for unbounded. */
    public readonly upper: number | "*"
  ) {}

  static parse(raw: string): Multiplicity {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new Error("Multiplicity string must not be empty");
    }

    if (trimmed === UNBOUNDED) {
      return new Multiplicity(0, "*");
    }

    if (trimmed.includes("..")) {
      const [lowerRaw, upperRaw] = trimmed.split("..");
      const lower = Multiplicity.parseBound(lowerRaw);
      if (typeof lower !== "number") {
        throw new Error(
          `Multiplicity lower bound cannot be unbounded: "${raw}"`
        );
      }
      const upper = Multiplicity.parseBound(upperRaw);
      if (typeof upper === "number" && upper < lower) {
        throw new Error(
          `Multiplicity upper bound is less than lower bound: "${raw}"`
        );
      }
      return new Multiplicity(lower, upper);
    }

    // Single exact number, e.g. "3" means "3..3".
    const exact = Multiplicity.parseBound(trimmed);
    if (typeof exact !== "number") {
      throw new Error(`Invalid multiplicity: "${raw}"`);
    }
    return new Multiplicity(exact, exact);
  }

  private static parseBound(raw: string): number | "*" {
    const trimmed = raw.trim();
    if (trimmed === UNBOUNDED) return "*";
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`Invalid multiplicity bound: "${raw}"`);
    }
    return n;
  }

  isUnbounded(): boolean {
    return this.upper === "*";
  }

  toString(): string {
    if (this.lower === this.upper) return `${this.lower}`;
    return `${this.lower}..${this.upper}`;
  }
}
