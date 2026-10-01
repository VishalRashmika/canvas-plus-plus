import { Id } from "../types";
import { Point } from "../value-objects/Point";
import { Size } from "../value-objects/Rect";

/** F-010. First-class group container compatible with Obsidian Canvas */
export interface Group {
  readonly id: Id;
  name: string;
  nodeIds: Id[];
  collapsed: boolean;
  color?: string;
  position?: Point;
  size?: Size;
  locked?: boolean;
}

export function createGroup(params: {
  id: Id;
  name: string;
  nodeIds?: Id[];
  collapsed?: boolean;
  color?: string;
  position?: Point;
  size?: Size;
  locked?: boolean;
}): Group {
  return {
    id: params.id,
    name: params.name,
    nodeIds: params.nodeIds ?? [],
    collapsed: params.collapsed ?? false,
    color: params.color,
    position: params.position,
    size: params.size,
    locked: params.locked ?? false,
  };
}
