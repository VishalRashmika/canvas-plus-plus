import { Id } from "../types";

/** F-010. */
export interface Layer {
  readonly id: Id;
  name: string;
  visible: boolean;
  locked: boolean;
  nodeIds: Id[];
}

export function createLayer(params: {
  id: Id;
  name: string;
  visible?: boolean;
  locked?: boolean;
  nodeIds?: Id[];
}): Layer {
  return {
    id: params.id,
    name: params.name,
    visible: params.visible ?? true,
    locked: params.locked ?? false,
    nodeIds: params.nodeIds ?? [],
  };
}
