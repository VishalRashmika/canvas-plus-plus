export interface UmlCanvasSettings {
  defaultNodeWidth: number;
  defaultNodeHeight: number;
  showGrid: boolean;
  gridSize: number;
  defaultDiagramType: string;
  autosaveDelayMs: number;
  enableCliBridge: boolean;
  enableFreehand: boolean;
}

export const DEFAULT_SETTINGS: UmlCanvasSettings = {
  defaultNodeWidth: 140,
  defaultNodeHeight: 80,
  showGrid: true,
  gridSize: 20,
  defaultDiagramType: "uml.class",
  autosaveDelayMs: 500,
  enableCliBridge: true,
  enableFreehand: true,
};
