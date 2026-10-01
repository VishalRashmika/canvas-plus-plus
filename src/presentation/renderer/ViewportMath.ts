import { Point } from "../../domain/value-objects/Point";

export interface ViewportTransform {
  panX: number;
  panY: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1; // 10%
export const MAX_ZOOM = 4.0; // 400%

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Converts screen/viewport pixel coordinates into canvas world coordinates.
 */
export function screenToCanvas(
  screenPoint: Point,
  transform: ViewportTransform
): Point {
  return {
    x: (screenPoint.x - transform.panX) / transform.zoom,
    y: (screenPoint.y - transform.panY) / transform.zoom,
  };
}

/**
 * Converts canvas world coordinates into screen/viewport pixel coordinates.
 */
export function canvasToScreen(
  canvasPoint: Point,
  transform: ViewportTransform
): Point {
  return {
    x: canvasPoint.x * transform.zoom + transform.panX,
    y: canvasPoint.y * transform.zoom + transform.panY,
  };
}

/**
 * Calculates new pan and zoom such that the world coordinate under the cursor
 * remains invariant after zooming.
 */
export function zoomAtPoint(
  cursorScreenPoint: Point,
  currentTransform: ViewportTransform,
  zoomFactor: number
): ViewportTransform {
  const newZoom = clampZoom(currentTransform.zoom * zoomFactor);
  if (newZoom === currentTransform.zoom) {
    return currentTransform;
  }

  // World coordinate before zoom
  const worldPoint = screenToCanvas(cursorScreenPoint, currentTransform);

  // New pan so worldPoint projects to the same screen point
  const newPanX = cursorScreenPoint.x - worldPoint.x * newZoom;
  const newPanY = cursorScreenPoint.y - worldPoint.y * newZoom;

  return {
    panX: newPanX,
    panY: newPanY,
    zoom: newZoom,
  };
}
