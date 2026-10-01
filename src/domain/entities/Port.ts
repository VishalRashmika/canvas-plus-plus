import { Id, Side, PortDirection } from "../types";

/**
 * A named connection point on a node's boundary. Edges may bind to a
 * specific port instead of a free node-side point (F-007).
 * See docs/02-DOMAIN-MODEL.md.
 */
export interface Port {
  readonly id: Id;
  readonly ownerNodeId: Id;
  name: string;
  side: Side;
  /** 0..1 position along `side`, measured from the side's start corner. */
  offset: number;
  direction: PortDirection;
  /** Free-text label, e.g. "8-bit bus", "Clock", or a UML type name. Not validated. */
  dataType?: string;
}

export function createPort(params: {
  id: Id;
  ownerNodeId: Id;
  name: string;
  side: Side;
  offset: number;
  direction: PortDirection;
  dataType?: string;
}): Port {
  if (params.offset < 0 || params.offset > 1) {
    throw new Error(
      `Port offset must be within [0,1], got ${params.offset} for port "${params.name}"`
    );
  }
  return { ...params };
}
