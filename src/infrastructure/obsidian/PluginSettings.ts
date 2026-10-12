export interface UmlCanvasSettings {
  defaultNodeWidth: number;
  defaultNodeHeight: number;
  showGrid: boolean;
  gridSize: number;
  defaultDiagramType: string;
  autosaveDelayMs: number;
  enableCliBridge: boolean;
  enableFreehand: boolean;
  autoShapeDetection: boolean;
  theme?: "system" | "light" | "dark";
}

export const DEFAULT_SETTINGS: UmlCanvasSettings = {
  defaultNodeWidth: 140,
  defaultNodeHeight: 80,
  showGrid: true,
  gridSize: 20,
  defaultDiagramType: "general",
  autosaveDelayMs: 500,
  enableCliBridge: true,
  enableFreehand: true,
  autoShapeDetection: true,
  theme: "system",
};
