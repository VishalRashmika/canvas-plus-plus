import { DiagramEditor } from "../../application/use-cases/DiagramEditor";
import { SvgSceneRenderer } from "../renderer/SvgSceneRenderer";

export class MinimapView {
  private containerEl: HTMLElement;
  private svgEl: SVGSVGElement;
  private contentGroup: SVGGElement;
  private viewportIndicator: SVGRectElement;
  private isDragging = false;
  private isVisible = true;
  private unsubscribeEditor?: () => void;

  constructor(
    private readonly editor: DiagramEditor,
    private readonly renderer: SvgSceneRenderer,
    parentContainer: HTMLElement
  ) {
    const svgNS = "http://www.w3.org/2000/svg";

    this.containerEl = document.createElement("div");
    this.containerEl.setAttribute("class", "umlcanvas-minimap-container");

    this.svgEl = document.createElementNS(svgNS, "svg");
    this.svgEl.setAttribute("class", "umlcanvas-minimap-svg");
    this.svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");

    this.contentGroup = document.createElementNS(svgNS, "g");
    this.contentGroup.setAttribute("class", "umlcanvas-minimap-content");
    this.svgEl.appendChild(this.contentGroup);

    this.viewportIndicator = document.createElementNS(svgNS, "rect");
    this.viewportIndicator.setAttribute(
      "class",
      "umlcanvas-minimap-viewport-indicator"
    );
    this.svgEl.appendChild(this.viewportIndicator);

    this.containerEl.appendChild(this.svgEl);
    parentContainer.appendChild(this.containerEl);

    this.setupEvents();
    this.unsubscribeEditor = this.editor.subscribe(() => this.update());
    this.update();
  }

  get visible(): boolean {
    return this.isVisible;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.containerEl.style.display = visible ? "block" : "none";
    if (visible) {
      this.update();
    }
  }

  toggle(): void {
    this.setVisible(!this.isVisible);
  }

  update(): void {
    if (!this.isVisible) return;

    const svgNS = "http://www.w3.org/2000/svg";
    const diagram = this.editor.diagram;

    // 1. Calculate diagram bounding box
    let minX = 0;
    let minY = 0;
    let maxX = 800;
    let maxY = 600;

    if (diagram.nodes.length > 0) {
      minX = Infinity;
      minY = Infinity;
      maxX = -Infinity;
      maxY = -Infinity;

      for (const node of diagram.nodes) {
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + node.size.width);
        maxY = Math.max(maxY, node.position.y + node.size.height);
      }

      // Add padding
      const padding = 60;
      minX -= padding;
      minY -= padding;
      maxX += padding;
      maxY += padding;
    }

    const boundsW = Math.max(200, maxX - minX);
    const boundsH = Math.max(150, maxY - minY);

    this.svgEl.setAttribute(
      "viewBox",
      `${minX} ${minY} ${boundsW} ${boundsH}`
    );

    // 2. Render mini edges and nodes
    while (this.contentGroup.firstChild) {
      this.contentGroup.removeChild(this.contentGroup.firstChild);
    }

    const nodeMap = new Map(diagram.nodes.map((n) => [n.id, n]));

    for (const edge of diagram.edges) {
      const from = nodeMap.get(edge.fromNodeId);
      const to = nodeMap.get(edge.toNodeId);
      if (from && to) {
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", String(from.position.x + from.size.width / 2));
        line.setAttribute("y1", String(from.position.y + from.size.height / 2));
        line.setAttribute("x2", String(to.position.x + to.size.width / 2));
        line.setAttribute("y2", String(to.position.y + to.size.height / 2));
        line.setAttribute("class", "umlcanvas-minimap-edge");
        this.contentGroup.appendChild(line);
      }
    }

    for (const node of diagram.nodes) {
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(node.position.x));
      rect.setAttribute("y", String(node.position.y));
      rect.setAttribute("width", String(node.size.width));
      rect.setAttribute("height", String(node.size.height));
      rect.setAttribute("rx", "2");
      rect.setAttribute("ry", "2");
      rect.setAttribute("class", "umlcanvas-minimap-node");
      this.contentGroup.appendChild(rect);
    }

    // 3. Update Camera Indicator
    const transform = this.renderer.currentTransform;
    const viewW = this.renderer.containerWidth;
    const viewH = this.renderer.containerHeight;

    const camX = -transform.panX / transform.zoom;
    const camY = -transform.panY / transform.zoom;
    const camW = viewW / transform.zoom;
    const camH = viewH / transform.zoom;

    this.viewportIndicator.setAttribute("x", String(camX));
    this.viewportIndicator.setAttribute("y", String(camY));
    this.viewportIndicator.setAttribute("width", String(camW));
    this.viewportIndicator.setAttribute("height", String(camH));
  }

  private setupEvents(): void {
    const handlePointer = (e: MouseEvent) => {
      const rect = this.svgEl.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Map click inside minimap to SVG viewBox coordinates
      const viewBox = this.svgEl.viewBox.baseVal;
      if (!viewBox || rect.width === 0 || rect.height === 0) return;

      const scaleX = viewBox.width / rect.width;
      const scaleY = viewBox.height / rect.height;

      const worldX = viewBox.x + clickX * scaleX;
      const worldY = viewBox.y + clickY * scaleY;

      // Center main viewport at (worldX, worldY)
      const transform = this.renderer.currentTransform;
      const viewW = this.renderer.containerWidth;
      const viewH = this.renderer.containerHeight;

      const newPanX = viewW / 2 - worldX * transform.zoom;
      const newPanY = viewH / 2 - worldY * transform.zoom;

      this.renderer.setTransform({
        ...transform,
        panX: newPanX,
        panY: newPanY,
      });
      this.update();
    };

    this.containerEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      handlePointer(e);
    });

    window.addEventListener("mousemove", (e) => {
      if (this.isDragging) {
        handlePointer(e);
      }
    });

    window.addEventListener("mouseup", () => {
      this.isDragging = false;
    });
  }

  destroy(): void {
    if (this.unsubscribeEditor) {
      this.unsubscribeEditor();
    }
    this.containerEl.remove();
  }
}
