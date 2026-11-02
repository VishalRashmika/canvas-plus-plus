import { DiagramNode, createDiagramNode } from "../entities/DiagramNode";
import { DiagramEdge, createDiagramEdge } from "../entities/DiagramEdge";
import { createLabel } from "../entities/Label";
import { Point } from "../value-objects/Point";
import { defaultShapeRecognizer, Stroke, StrokePoint } from "./ShapeRecognizer";
import { defaultHandwritingRecognizer } from "./HandwritingRecognizer";
import { Side } from "../types";
import { getFacingSide } from "./Geometry";

export interface EnhanceResult {
  nodesToRemove: DiagramNode[];
  nodesToAdd: DiagramNode[];
  edgesToAdd: DiagramEdge[];
  summary: {
    containersCreated: number;
    tablesCreated: number;
    textNodesCreated: number;
    arrowsCreated: number;
  };
}

interface FreehandStrokeItem {
  node: DiagramNode;
  stroke: Stroke;
  points: StrokePoint[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number };
  center: Point;
  consumed: boolean;
}

export class HanddrawnNoteEnhancer {
  /**
   * Convenience method to enhance a collection of raw Stroke objects.
   */
  public enhanceStrokes(
    strokes: Stroke[],
    allDiagramNodes: DiagramNode[] = [],
    diagramType = "general"
  ): {
    containers: DiagramNode[];
    tables: DiagramNode[];
    textNotes: DiagramNode[];
    edges: DiagramEdge[];
    summary: EnhanceResult["summary"];
  } {
    const freehandNodes: DiagramNode[] = strokes.map((s) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of s.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      if (s.points.length === 0) {
        minX = 0; maxX = 100; minY = 0; maxY = 60;
      }
      const relPoints = s.points.map((p) => ({
        x: p.x - minX,
        y: p.y - minY,
        pressure: p.pressure,
        time: p.time,
      }));
      return createDiagramNode({
        id: s.id,
        kind: "generic.freehand",
        position: { x: minX, y: minY },
        size: { width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) },
        customData: { points: relPoints, originalStrokeId: s.id },
      });
    });

    const res = this.enhance(freehandNodes, [...allDiagramNodes, ...freehandNodes], diagramType);
    return {
      containers: res.nodesToAdd.filter((n) => n.kind !== "generic.table" && n.kind !== "generic.text"),
      tables: res.nodesToAdd.filter((n) => n.kind === "generic.table"),
      textNotes: res.nodesToAdd.filter((n) => n.kind === "generic.text"),
      edges: res.edgesToAdd,
      summary: res.summary,
    };
  }

  /**
   * Enhances a collection of handdrawn freehand strokes and elements into standard,
   * properly typed and structured notes, boxes, tables, standalone text, and connected arrows.
   */
  public enhance(
    selectedNodes: DiagramNode[],
    allDiagramNodes: DiagramNode[] = [],
    diagramType = "general"
  ): EnhanceResult {
    const freehandNodes = selectedNodes.filter((n) => n.kind === "generic.freehand");
    if (freehandNodes.length === 0) {
      return {
        nodesToRemove: [],
        nodesToAdd: [],
        edgesToAdd: [],
        summary: { containersCreated: 0, tablesCreated: 0, textNodesCreated: 0, arrowsCreated: 0 },
      };
    }

    // 1. Extract strokes in global canvas coordinates
    const items: FreehandStrokeItem[] = freehandNodes.map((n) => {
      const rawPoints: StrokePoint[] = Array.isArray(n.customData?.points)
        ? (n.customData?.points as StrokePoint[])
        : [];

      const canvasPoints: StrokePoint[] = rawPoints.map((p) => ({
        x: n.position.x + p.x,
        y: n.position.y + p.y,
        pressure: p.pressure,
        time: p.time,
      }));

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of canvasPoints) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }

      if (canvasPoints.length === 0) {
        minX = n.position.x;
        maxX = n.position.x + n.size.width;
        minY = n.position.y;
        maxY = n.position.y + n.size.height;
      }

      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);

      return {
        node: n,
        stroke: { id: n.id, points: canvasPoints },
        points: canvasPoints,
        bounds: { minX, maxX, minY, maxY, width, height },
        center: { x: minX + width / 2, y: minY + height / 2 },
        consumed: false,
      };
    });

    const nodesToAdd: DiagramNode[] = [];
    const edgesToAdd: DiagramEdge[] = [];
    let tablesCreated = 0;
    let containersCreated = 0;
    let textNodesCreated = 0;
    let arrowsCreated = 0;

    // Existing nodes in diagram that are NOT being removed
    const survivingDiagramNodes = allDiagramNodes.filter(
      (dNode) => !freehandNodes.some((f) => f.id === dNode.id)
    );

    // ----------------------------------------------------
    // STEP 2: Detect Handdrawn Tables
    // Pattern: An outer bounding box with horizontal and/or vertical divider lines inside
    // ----------------------------------------------------
    for (let i = 0; i < items.length; i++) {
      const outerCandidate = items[i];
      if (outerCandidate.consumed) continue;

      const outerRecog = defaultShapeRecognizer.recognize(outerCandidate.stroke);
      const isBox =
        (outerRecog.shape === "rectangle" || outerRecog.shape === "square") &&
        outerCandidate.bounds.width >= 70 &&
        outerCandidate.bounds.height >= 40;

      if (!isBox) continue;

      // Look for internal divider lines inside this candidate box
      const innerHorizontalDividers: FreehandStrokeItem[] = [];
      const innerVerticalDividers: FreehandStrokeItem[] = [];
      const innerTextItems: FreehandStrokeItem[] = [];

      for (let j = 0; j < items.length; j++) {
        if (i === j) continue;
        const sub = items[j];
        if (sub.consumed) continue;

        // Must be inside outerCandidate box bounds (with 10px margin)
        const isInside =
          sub.center.x >= outerCandidate.bounds.minX - 10 &&
          sub.center.x <= outerCandidate.bounds.maxX + 10 &&
          sub.center.y >= outerCandidate.bounds.minY - 10 &&
          sub.center.y <= outerCandidate.bounds.maxY + 10;

        if (!isInside) continue;

        const subRecog = defaultShapeRecognizer.recognize(sub.stroke);
        const subStraightness =
          sub.points.length >= 2
            ? Math.hypot(
                sub.points[sub.points.length - 1].x - sub.points[0].x,
                sub.points[sub.points.length - 1].y - sub.points[0].y
              ) /
              sub.points.reduce((len, p, idx, arr) => {
                if (idx === 0) return 0;
                return len + Math.hypot(p.x - arr[idx - 1].x, p.y - arr[idx - 1].y);
              }, 0)
            : 0;

        // Horizontal divider: wide, short height, spans at least 40% of table width
        const isHorizontalLine =
          (subRecog.shape === "line" || subStraightness >= 0.6) &&
          sub.bounds.width >= outerCandidate.bounds.width * 0.4 &&
          sub.bounds.width > sub.bounds.height * 2.5 &&
          sub.center.y > outerCandidate.bounds.minY + 8 &&
          sub.center.y < outerCandidate.bounds.maxY - 8;

        // Vertical divider: tall, thin width, spans at least 40% of table height
        const isVerticalLine =
          (subRecog.shape === "line" || subStraightness >= 0.6) &&
          sub.bounds.height >= outerCandidate.bounds.height * 0.4 &&
          sub.bounds.height > sub.bounds.width * 2.5 &&
          sub.center.x > outerCandidate.bounds.minX + 8 &&
          sub.center.x < outerCandidate.bounds.maxX - 8;

        if (isHorizontalLine) {
          innerHorizontalDividers.push(sub);
        } else if (isVerticalLine) {
          innerVerticalDividers.push(sub);
        } else {
          innerTextItems.push(sub);
        }
      }

      // If at least 1 horizontal or 1 vertical divider is present, it's a table!
      if (innerHorizontalDividers.length >= 1 || innerVerticalDividers.length >= 1) {
        outerCandidate.consumed = true;
        innerHorizontalDividers.forEach((d) => (d.consumed = true));
        innerVerticalDividers.forEach((d) => (d.consumed = true));

        // Sort dividers by position to determine cell grid
        const sortedYDividers = innerHorizontalDividers
          .map((d) => d.center.y)
          .sort((a, b) => a - b);
        const sortedXDividers = innerVerticalDividers
          .map((d) => d.center.x)
          .sort((a, b) => a - b);

        const rowBoundaries = [
          outerCandidate.bounds.minY,
          ...sortedYDividers,
          outerCandidate.bounds.maxY,
        ];
        const colBoundaries = [
          outerCandidate.bounds.minX,
          ...sortedXDividers,
          outerCandidate.bounds.maxX,
        ];

        const numRows = rowBoundaries.length - 1;
        const numCols = colBoundaries.length - 1;

        // Initialize empty cell matrix
        const cells: string[][] = Array.from({ length: numRows }, () =>
          Array.from({ length: numCols }, () => "")
        );

        // Map text strokes to corresponding cell
        for (const textItem of innerTextItems) {
          const cx = textItem.center.x;
          const cy = textItem.center.y;

          // Find row index
          let rIdx = 0;
          for (let r = 0; r < numRows; r++) {
            if (cy >= rowBoundaries[r] && cy <= rowBoundaries[r + 1]) {
              rIdx = r;
              break;
            }
          }

          // Find col index
          let cIdx = 0;
          for (let c = 0; c < numCols; c++) {
            if (cx >= colBoundaries[c] && cx <= colBoundaries[c + 1]) {
              cIdx = c;
              break;
            }
          }

          textItem.consumed = true;
          const recognizedCellText = defaultHandwritingRecognizer.recognizeStrokes([textItem.stroke]);
          if (recognizedCellText) {
            cells[rIdx][cIdx] = cells[rIdx][cIdx]
              ? `${cells[rIdx][cIdx]} ${recognizedCellText}`
              : recognizedCellText;
          }
        }

        // Fill empty cells with sensible defaults if nothing handwritten was inside
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numCols; c++) {
            if (!cells[r][c]) {
              cells[r][c] = r === 0 ? `Header ${c + 1}` : `Row ${r}, Col ${c + 1}`;
            }
          }
        }

        const tableNode = createDiagramNode({
          id: `table-${Date.now()}-${tablesCreated}`,
          kind: "generic.table",
          position: {
            x: Math.round(outerCandidate.bounds.minX),
            y: Math.round(outerCandidate.bounds.minY),
          },
          size: {
            width: Math.max(120, Math.round(outerCandidate.bounds.width)),
            height: Math.max(60, Math.round(outerCandidate.bounds.height)),
          },
          customData: {
            rows: numRows,
            cols: numCols,
            cells,
            hasHeaderRow: true,
          },
        });

        nodesToAdd.push(tableNode);
        tablesCreated++;
      }
    }

    // ----------------------------------------------------
    // STEP 3: Detect Handdrawn Shapes (Boxes, Circles, Ellipses, Diamonds, Triangles)
    // ----------------------------------------------------
    interface RecognizedContainer {
      node: DiagramNode;
      item: FreehandStrokeItem;
    }
    const recognizedContainers: RecognizedContainer[] = [];

    for (const item of items) {
      if (item.consumed) continue;

      const recog = defaultShapeRecognizer.recognize(item.stroke);
      const isClosedShape =
        recog.shape === "rectangle" ||
        recog.shape === "square" ||
        recog.shape === "circle" ||
        recog.shape === "ellipse" ||
        recog.shape === "diamond" ||
        recog.shape === "triangle";

      if (isClosedShape && item.bounds.width >= 30 && item.bounds.height >= 20) {
        let shapeKind = "generic.rectangle";
        let defaultTitle = "";

        if (recog.shape === "circle") {
          shapeKind = "generic.circle";
        } else if (recog.shape === "ellipse") {
          shapeKind = "generic.ellipse";
        } else if (recog.shape === "diamond") {
          shapeKind = "generic.diamond";
        } else if (recog.shape === "triangle") {
          shapeKind = "generic.triangle";
        } else {
          // Rectangle / Square
          switch (diagramType) {
            case "uml.class":
              shapeKind = "uml.class";
              defaultTitle = "Class";
              break;
            case "uml.component":
              shapeKind = "uml.component";
              defaultTitle = "Component";
              break;
            case "uml.package":
              shapeKind = "uml.package";
              defaultTitle = "Package";
              break;
            default:
              shapeKind = "generic.rectangle";
              defaultTitle = "";
          }
        }

        const containerNode = createDiagramNode({
          id: `node-${Date.now()}-${containersCreated}`,
          kind: shapeKind,
          position: {
            x: Math.round(item.bounds.minX),
            y: Math.round(item.bounds.minY),
          },
          size: {
            width: Math.max(40, Math.round(item.bounds.width)),
            height: Math.max(30, Math.round(item.bounds.height)),
          },
          labels: defaultTitle
            ? [createLabel({ id: `lbl-${Date.now()}`, text: defaultTitle, anchor: "node", position: { x: 0, y: 0 } })]
            : [],
        });

        item.consumed = true;
        recognizedContainers.push({ node: containerNode, item });
        nodesToAdd.push(containerNode);
        containersCreated++;
      }
    }

    // ----------------------------------------------------
    // STEP 4: Associate Handwritten Text Inside Containers
    // ----------------------------------------------------
    for (const container of recognizedContainers) {
      const cBounds = container.item.bounds;
      const enclosedTextStrokes: Stroke[] = [];

      for (const item of items) {
        if (item.consumed) continue;

        // Check if stroke center lies inside container bounds (with slight tolerance)
        const isInside =
          item.center.x >= cBounds.minX &&
          item.center.x <= cBounds.maxX &&
          item.center.y >= cBounds.minY &&
          item.center.y <= cBounds.maxY;

        if (isInside) {
          item.consumed = true;
          enclosedTextStrokes.push(item.stroke);
        }
      }

      if (enclosedTextStrokes.length > 0) {
        const recognizedText = defaultHandwritingRecognizer.recognizeStrokes(enclosedTextStrokes);
        if (recognizedText) {
          container.node.labels = [
            createLabel({
              id: `${container.node.id}-title`,
              text: recognizedText,
              anchor: "node",
              position: { x: 0, y: 0 },
            }),
          ];
        }
      }
    }

    // All available nodes that arrows can connect to (newly created + existing surviving nodes)
    const allAvailableNodes = [...survivingDiagramNodes, ...nodesToAdd];

    // ----------------------------------------------------
    // STEP 5: Detect Handdrawn Arrows and Connectors
    // ----------------------------------------------------
    for (const item of items) {
      if (item.consumed) continue;

      const pts = item.points;
      if (pts.length < 2) continue;

      const recog = defaultShapeRecognizer.recognize(item.stroke);
      const isArrow = recog.shape === "arrow";
      const isLine = recog.shape === "line";

      const startPt = pts[0];
      const endPt = pts[pts.length - 1];
      const straightDist = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);

      // A genuine arrow or connector must span a meaningful distance and not be a tiny letter stroke
      const isTinyStroke = straightDist < 35 && item.bounds.width < 35 && item.bounds.height < 35;
      if (isTinyStroke && !isArrow) {
        continue;
      }

      if ((isArrow || isLine || straightDist > 35) && allAvailableNodes.length >= 2) {
        // Find closest fromNode near startPt and toNode near endPt
        const fromNode = this.findNearestContainerNode(startPt, allAvailableNodes, 65);
        const toNode = this.findNearestContainerNode(endPt, allAvailableNodes, 65, fromNode?.id);

        if (fromNode && toNode && fromNode.id !== toNode.id) {
          item.consumed = true;

          const fromSide: Side = getFacingSide(fromNode.position, fromNode.size, startPt);
          const toSide: Side = getFacingSide(toNode.position, toNode.size, endPt);

          const fromPort = fromNode.ports?.find((p) => p.side === fromSide);
          const toPort = toNode.ports?.find((p) => p.side === toSide);

          const edge = createDiagramEdge({
            id: `edge-${Date.now()}-${arrowsCreated}`,
            fromNodeId: fromNode.id,
            toNodeId: toNode.id,
            fromSide,
            toSide,
            fromPortId: fromPort?.id,
            toPortId: toPort?.id,
            kind: isArrow ? "uml.dependency" : "uml.association",
            style: {
              markerEnd: "arrow",
            },
          });

          edgesToAdd.push(edge);
          arrowsCreated++;
        }
      }
    }

    // ----------------------------------------------------
    // STEP 6: Standalone Handwritten Text (Direct Text on Canvas)
    // ----------------------------------------------------
    const remainingTextItems = items.filter((it) => !it.consumed);
    if (remainingTextItems.length > 0) {
      // Cluster remaining strokes into text blocks based on proximity
      const clusters = this.clusterRemainingStrokes(remainingTextItems);

      for (const cluster of clusters) {
        cluster.forEach((it) => (it.consumed = true));

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const it of cluster) {
          if (it.bounds.minX < minX) minX = it.bounds.minX;
          if (it.bounds.maxX > maxX) maxX = it.bounds.maxX;
          if (it.bounds.minY < minY) minY = it.bounds.minY;
          if (it.bounds.maxY > maxY) maxY = it.bounds.maxY;
        }

        const clusterStrokes = cluster.map((it) => it.stroke);
        const recognizedText = defaultHandwritingRecognizer.recognizeStrokes(clusterStrokes);

        const textNode = createDiagramNode({
          id: `text-${Date.now()}-${textNodesCreated}`,
          kind: "generic.text",
          position: {
            x: Math.round(minX),
            y: Math.round(minY),
          },
          size: {
            width: Math.max(90, Math.round(maxX - minX + 24)),
            height: Math.max(34, Math.round(maxY - minY + 14)),
          },
          labels: [
            createLabel({
              id: `text-lbl-${Date.now()}-${textNodesCreated}`,
              text: recognizedText || "Text",
              anchor: "node",
              position: { x: 0, y: 0 },
            }),
          ],
        });

        nodesToAdd.push(textNode);
        textNodesCreated++;
      }
    }

    // Collect all freehand nodes that have been consumed
    const consumedNodes = items.filter((it) => it.consumed).map((it) => it.node);

    return {
      nodesToRemove: consumedNodes,
      nodesToAdd,
      edgesToAdd,
      summary: {
        containersCreated,
        tablesCreated,
        textNodesCreated,
        arrowsCreated,
      },
    };
  }

  private findNearestContainerNode(
    pt: Point,
    nodes: DiagramNode[],
    maxDist = 160,
    excludeNodeId?: string
  ): DiagramNode | null {
    let bestNode: DiagramNode | null = null;
    let minDist = maxDist;

    for (const node of nodes) {
      if (excludeNodeId && node.id === excludeNodeId) continue;
      if (node.kind === "generic.freehand") continue;

      const rx = node.position.x;
      const ry = node.position.y;
      const rw = node.size.width;
      const rh = node.size.height;

      // Distance from point to rectangle boundary
      const clampedX = Math.max(rx, Math.min(rx + rw, pt.x));
      const clampedY = Math.max(ry, Math.min(ry + rh, pt.y));
      const d = Math.hypot(pt.x - clampedX, pt.y - clampedY);

      if (d < minDist) {
        minDist = d;
        bestNode = node;
      }
    }

    return bestNode;
  }

  /**
   * Clusters leftover freehand strokes into coherent text blocks by spatial distance.
   */
  private clusterRemainingStrokes(items: FreehandStrokeItem[]): FreehandStrokeItem[][] {
    if (items.length === 0) return [];
    if (items.length === 1) return [[items[0]]];

    const clusters: FreehandStrokeItem[][] = [];
    const unvisited = new Set(items);

    while (unvisited.size > 0) {
      const current = unvisited.values().next().value;
      if (!current) break;
      unvisited.delete(current);
      const cluster: FreehandStrokeItem[] = [current];

      // BFS to grow cluster
      const queue: FreehandStrokeItem[] = [current];
      while (queue.length > 0) {
        const item = queue.shift()!;
        for (const candidate of Array.from(unvisited)) {
          // Check horizontal and vertical distance
          const dx = Math.max(
            0,
            Math.max(item.bounds.minX, candidate.bounds.minX) -
              Math.min(item.bounds.maxX, candidate.bounds.maxX)
          );
          const dy = Math.max(
            0,
            Math.max(item.bounds.minY, candidate.bounds.minY) -
              Math.min(item.bounds.maxY, candidate.bounds.maxY)
          );

          // If strokes are within reasonable reading proximity (horizontal <= 45px, vertical <= 30px)
          if (dx <= 45 && dy <= 30) {
            unvisited.delete(candidate);
            cluster.push(candidate);
            queue.push(candidate);
          }
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }
}

export const defaultHanddrawnNoteEnhancer = new HanddrawnNoteEnhancer();
