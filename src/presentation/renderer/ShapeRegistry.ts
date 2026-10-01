import { DiagramNode } from "../../domain/entities/DiagramNode";
import { Port } from "../../domain/entities/Port";
import { Point } from "../../domain/value-objects/Point";
import { Size } from "../../domain/value-objects/Rect";
import { Side } from "../../domain/types";
import {
  getRectPerimeterIntersection,
  getEllipsePerimeterIntersection,
  getDiamondPerimeterIntersection,
  getCirclePerimeterIntersection,
} from "./ConnectorGeometry";

export interface RenderContext {
  isSelected: boolean;
  isHovered?: boolean;
}

export interface ShapeDefinition {
  kind: string;
  displayName: string;
  defaultSize: Size;
  getPorts(node: DiagramNode): Port[];
  getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point;
  renderSvg(node: DiagramNode, context: RenderContext): SVGElement;
}

export class ShapeRegistry {
  private shapes = new Map<string, ShapeDefinition>();
  private defaultShape: ShapeDefinition;

  constructor() {
    this.defaultShape = this.createDefaultRectangle();
    this.register(this.defaultShape);
    this.register(this.createUmlClassShape());
    this.register(
      this.createUmlClassShape({
        kind: "uml.interface",
        displayName: "Interface",
        defaultStereotype: "interface",
      })
    );
    this.register(
      this.createUmlClassShape({
        kind: "uml.abstractClass",
        displayName: "Abstract Class",
        defaultStereotype: "abstract",
      })
    );
    this.register(
      this.createUmlClassShape({
        kind: "uml.enumeration",
        displayName: "Enumeration",
        defaultStereotype: "enumeration",
      })
    );
    this.register(this.createUmlObjectShape());
    this.register(this.createUmlActorShape());
    this.register(this.createUmlUseCaseShape());
    this.register(this.createUmlSystemBoundaryShape());
    this.register(this.createGenericNoteShape());
    this.register(this.createObsidianNoteShape());

    // --- Phase 3 Behavioral Shapes ---
    // Activity Diagram
    this.register(this.createActivityInitialShape());
    this.register(this.createActivityFinalShape());
    this.register(this.createActivityActionShape());
    this.register(this.createActivityDecisionShape());
    this.register(this.createActivityForkJoinShape());
    this.register(this.createActivitySwimlaneShape());

    // State Machine Diagram
    this.register(this.createStateInitialShape());
    this.register(this.createStateFinalShape());
    this.register(this.createStateSimpleShape());
    this.register(this.createStateCompositeShape());
    this.register(this.createStateChoiceShape());
    this.register(this.createStateForkJoinShape());

    // Sequence Diagram
    this.register(this.createSequenceLifelineShape());
    this.register(this.createSequenceActivationShape());

    // --- Phase 4 Shapes ---
    // Component Diagram
    this.register(this.createUmlComponentShape());
    this.register(this.createUmlLollipopShape());
    this.register(this.createUmlSocketShape());
    this.register(this.createUmlComponentPortShape());

    // Deployment Diagram
    this.register(this.createUmlNode3dShape());
    this.register(
      this.createUmlNode3dShape({
        kind: "uml.device",
        displayName: "Device",
        defaultStereotype: "device",
      })
    );
    this.register(
      this.createUmlNode3dShape({
        kind: "uml.executionEnvironment",
        displayName: "Execution Environment",
        defaultStereotype: "executionEnvironment",
      })
    );
    this.register(this.createUmlArtifactShape());

    // Timing Diagram
    this.register(this.createTimingLaneShape());
    this.register(this.createTimingStateSegmentShape());

    // Schematic Diagram
    this.register(this.createSchematicChipShape());

    // --- Phase 5 Shapes ---
    // Package Diagram
    this.register(this.createUmlPackageShape());

    // Composite Structure Diagram
    this.register(this.createUmlCompositeClassifierShape());
    this.register(this.createUmlPartShape());

    // Interaction Overview Diagram
    this.register(this.createInteractionFrameShape());
    this.register(this.createInteractionOccurrenceShape());

    // Profile Diagram
    this.register(this.createUmlStereotypeShape());
    this.register(this.createUmlMetaclassShape());

    // Schematic Symbols Library
    this.register(this.createSchematicJunctionShape());
    this.register(this.createSchematicGroundShape());
    this.register(this.createSchematicPowerRailShape());
    this.register(this.createSchematicBusTapShape());

    // Freehand Stroke (F-073)
    this.register(this.createGenericFreehandShape());
  }

  register(shape: ShapeDefinition): void {
    this.shapes.set(shape.kind, shape);
  }

  get(kind: string): ShapeDefinition {
    return this.shapes.get(kind) ?? this.defaultShape;
  }

  has(kind: string): boolean {
    return this.shapes.has(kind);
  }

  list(): ShapeDefinition[] {
    return Array.from(this.shapes.values());
  }

  private createDefaultRectangle(): ShapeDefinition {
    return {
      kind: "generic.rectangle",
      displayName: "Rectangle",
      defaultSize: { width: 140, height: 80 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) {
          return node.ports;
        }
        // Default 4 cardinal ports
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-rect");

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute("rx", String(node.style?.cornerRadius ?? 4));
        rect.setAttribute("ry", String(node.style?.cornerRadius ?? 4));
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );

        if (node.style?.fillColor) {
          rect.setAttribute("fill", node.style.fillColor);
        }
        if (node.style?.strokeColor) {
          rect.setAttribute("stroke", node.style.strokeColor);
        }
        if (node.style?.strokeWidth) {
          rect.setAttribute("stroke-width", String(node.style.strokeWidth));
        }

        group.appendChild(rect);

        // Label
        const title = node.labels[0]?.text ?? "";
        if (title) {
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", String(node.size.width / 2));
          text.setAttribute("y", String(node.size.height / 2));
          text.setAttribute("dominant-baseline", "central");
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("class", "umlcanvas-node-title");
          text.textContent = title;
          group.appendChild(text);
        }

        return group;
      },
    };
  }

  private createUmlClassShape(options?: {
    kind?: string;
    displayName?: string;
    defaultStereotype?: string;
  }): ShapeDefinition {
    const kind = options?.kind ?? "uml.class";
    const displayName = options?.displayName ?? "Class";
    return {
      kind,
      displayName,
      defaultSize: { width: 160, height: 100 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) {
          return node.ports;
        }
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-uml-class");

        // Main outer rect
        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute("rx", "2");
        rect.setAttribute("ry", "2");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(rect);

        // Header section height
        const effectiveStereo = node.stereotype ?? options?.defaultStereotype;
        const hasStereo = Boolean(effectiveStereo);
        const hasTagged = Boolean(
          node.taggedValues && Object.keys(node.taggedValues).length > 0
        );
        const headerHeight = hasStereo || hasTagged ? 46 : 32;

        let currentY = 12;
        if (hasStereo) {
          const stereoText = document.createElementNS(svgNS, "text");
          stereoText.setAttribute("x", String(node.size.width / 2));
          stereoText.setAttribute("y", String(currentY));
          stereoText.setAttribute("dominant-baseline", "central");
          stereoText.setAttribute("text-anchor", "middle");
          stereoText.setAttribute("class", "umlcanvas-node-stereotype");
          stereoText.textContent = `«${effectiveStereo}»`;
          group.appendChild(stereoText);
          currentY += 14;
        }

        if (hasTagged && node.taggedValues) {
          const taggedStr = Object.entries(node.taggedValues)
            .map(([k, v]) => `${k}="${v}"`)
            .join(", ");
          const taggedText = document.createElementNS(svgNS, "text");
          taggedText.setAttribute("x", String(node.size.width / 2));
          taggedText.setAttribute("y", String(currentY));
          taggedText.setAttribute("dominant-baseline", "central");
          taggedText.setAttribute("text-anchor", "middle");
          taggedText.setAttribute("class", "umlcanvas-node-tagged-values");
          taggedText.textContent = `{ ${taggedStr} }`;
          group.appendChild(taggedText);
          currentY += 12;
        }

        // Class Name
        const title = node.labels[0]?.text ?? "";
        if (title) {
          const titleText = document.createElementNS(svgNS, "text");
          titleText.setAttribute("x", String(node.size.width / 2));
          titleText.setAttribute("y", String(currentY));
          titleText.setAttribute("dominant-baseline", "central");
          titleText.setAttribute("text-anchor", "middle");
          titleText.setAttribute(
            "class",
            node.stereotype === "interface" || node.stereotype === "abstract"
              ? "umlcanvas-node-title umlcanvas-class-title umlcanvas-italic"
              : "umlcanvas-node-title umlcanvas-class-title"
          );
          titleText.textContent = title;
          group.appendChild(titleText);
        }

        // Header divider line
        if (node.size.height > headerHeight) {
          const line = document.createElementNS(svgNS, "line");
          line.setAttribute("x1", "0");
          line.setAttribute("y1", String(headerHeight));
          line.setAttribute("x2", String(node.size.width));
          line.setAttribute("y2", String(headerHeight));
          line.setAttribute("class", "umlcanvas-compartment-divider");
          group.appendChild(line);
        }

        // Compartments rendering (F-032)
        if (node.compartments && node.compartments.length > 0) {
          let compY = headerHeight;
          const lineHeight = 18;

          for (let cIdx = 0; cIdx < node.compartments.length; cIdx++) {
            const comp = node.compartments[cIdx];
            if (cIdx > 0 && compY < node.size.height) {
              // Divider between compartments
              const divLine = document.createElementNS(svgNS, "line");
              divLine.setAttribute("x1", "0");
              divLine.setAttribute("y1", String(compY));
              divLine.setAttribute("x2", String(node.size.width));
              divLine.setAttribute("y2", String(compY));
              divLine.setAttribute("class", "umlcanvas-compartment-divider");
              group.appendChild(divLine);
            }

            for (const item of comp.items) {
              compY += lineHeight;
              if (compY > node.size.height) break;

              const itemText = document.createElementNS(svgNS, "text");
              itemText.setAttribute("x", "10");
              itemText.setAttribute("y", String(compY - 5));
              itemText.setAttribute("class", "umlcanvas-compartment-item");

              // Visibility marker span
              const visSpan = document.createElementNS(svgNS, "tspan");
              visSpan.setAttribute("class", `umlcanvas-visibility-${item.visibility}`);
              visSpan.textContent = `${item.visibility} `;
              itemText.appendChild(visSpan);

              // Content span
              const contentSpan = document.createElementNS(svgNS, "tspan");
              contentSpan.textContent = item.text;
              itemText.appendChild(contentSpan);

              group.appendChild(itemText);
            }
          }
        }

        return group;
      },
    };
  }

  private createUmlObjectShape(): ShapeDefinition {
    return {
      kind: "uml.object",
      displayName: "Object",
      defaultSize: { width: 150, height: 90 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-uml-object");

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute("rx", "2");
        rect.setAttribute("ry", "2");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(rect);

        // Header text (instance: Class, underlined per UML spec)
        const headerY = 22;
        const titleText = node.labels[0]?.text ?? "instance: Class";
        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", String(node.size.width / 2));
        text.setAttribute("y", String(headerY));
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "umlcanvas-node-title umlcanvas-object-title");
        text.textContent = titleText;
        group.appendChild(text);

        // Header divider
        const divLine = document.createElementNS(svgNS, "line");
        divLine.setAttribute("x1", "0");
        divLine.setAttribute("y1", "32");
        divLine.setAttribute("x2", String(node.size.width));
        divLine.setAttribute("y2", "32");
        divLine.setAttribute("class", "umlcanvas-compartment-divider");
        group.appendChild(divLine);

        // Slots / attributes
        let currentY = 32;
        const lineHeight = 18;

        if (node.compartments && node.compartments.length > 0) {
          for (const comp of node.compartments) {
            for (const item of comp.items) {
              currentY += lineHeight;
              if (currentY > node.size.height) break;

              const itemText = document.createElementNS(svgNS, "text");
              itemText.setAttribute("x", "10");
              itemText.setAttribute("y", String(currentY - 4));
              itemText.setAttribute("class", "umlcanvas-compartment-item");
              itemText.textContent = item.text;
              group.appendChild(itemText);
            }
          }
        }

        return group;
      },
    };
  }

  private createUmlActorShape(): ShapeDefinition {
    return {
      kind: "uml.actor",
      displayName: "Actor",
      defaultSize: { width: 60, height: 90 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-uml-actor");

        const cx = node.size.width / 2;

        // Hitbox background
        const hitRect = document.createElementNS(svgNS, "rect");
        hitRect.setAttribute("x", "0");
        hitRect.setAttribute("y", "0");
        hitRect.setAttribute("width", String(node.size.width));
        hitRect.setAttribute("height", String(node.size.height));
        hitRect.setAttribute("fill", "transparent");
        group.appendChild(hitRect);

        const strokeClass = context.isSelected
          ? "umlcanvas-actor-glyph umlcanvas-node-selected"
          : "umlcanvas-actor-glyph";

        // Head (circle)
        const head = document.createElementNS(svgNS, "circle");
        head.setAttribute("cx", String(cx));
        head.setAttribute("cy", "18");
        head.setAttribute("r", "10");
        head.setAttribute("class", strokeClass);
        group.appendChild(head);

        // Spine
        const spine = document.createElementNS(svgNS, "line");
        spine.setAttribute("x1", String(cx));
        spine.setAttribute("y1", "28");
        spine.setAttribute("x2", String(cx));
        spine.setAttribute("y2", "52");
        spine.setAttribute("class", strokeClass);
        group.appendChild(spine);

        // Arms
        const arms = document.createElementNS(svgNS, "line");
        arms.setAttribute("x1", String(cx - 18));
        arms.setAttribute("y1", "36");
        arms.setAttribute("x2", String(cx + 18));
        arms.setAttribute("y2", "36");
        arms.setAttribute("class", strokeClass);
        group.appendChild(arms);

        // Left Leg
        const leftLeg = document.createElementNS(svgNS, "line");
        leftLeg.setAttribute("x1", String(cx));
        leftLeg.setAttribute("y1", "52");
        leftLeg.setAttribute("x2", String(cx - 14));
        leftLeg.setAttribute("y2", "72");
        leftLeg.setAttribute("class", strokeClass);
        group.appendChild(leftLeg);

        // Right Leg
        const rightLeg = document.createElementNS(svgNS, "line");
        rightLeg.setAttribute("x1", String(cx));
        rightLeg.setAttribute("y1", "52");
        rightLeg.setAttribute("x2", String(cx + 14));
        rightLeg.setAttribute("y2", "72");
        rightLeg.setAttribute("class", strokeClass);
        group.appendChild(rightLeg);

        // Actor Name label below glyph
        const label = node.labels[0]?.text ?? "Actor";
        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", String(cx));
        text.setAttribute("y", "86");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "umlcanvas-actor-label");
        text.textContent = label;
        group.appendChild(text);

        return group;
      },
    };
  }

  private createUmlUseCaseShape(): ShapeDefinition {
    return {
      kind: "uml.usecase",
      displayName: "Use Case",
      defaultSize: { width: 140, height: 70 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getEllipsePerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-uml-usecase");

        const rx = node.size.width / 2;
        const ry = node.size.height / 2;

        const ellipse = document.createElementNS(svgNS, "ellipse");
        ellipse.setAttribute("cx", String(rx));
        ellipse.setAttribute("cy", String(ry));
        ellipse.setAttribute("rx", String(rx));
        ellipse.setAttribute("ry", String(ry));
        ellipse.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(ellipse);

        // Centered title text
        const title = node.labels[0]?.text ?? "Use Case";
        const lines = title.split("\n");
        const startY = ry - ((lines.length - 1) * 16) / 2 + 4;

        for (let i = 0; i < lines.length; i++) {
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", String(rx));
          text.setAttribute("y", String(startY + i * 16));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("class", "umlcanvas-node-title umlcanvas-usecase-title");
          text.textContent = lines[i];
          group.appendChild(text);
        }

        return group;
      },
    };
  }

  private createUmlSystemBoundaryShape(): ShapeDefinition {
    return {
      kind: "uml.systemBoundary",
      displayName: "System Boundary",
      defaultSize: { width: 340, height: 260 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-system-boundary");

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute("rx", "4");
        rect.setAttribute("ry", "4");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-system-boundary-box umlcanvas-node-selected"
            : "umlcanvas-system-boundary-box"
        );
        group.appendChild(rect);

        const title = node.labels[0]?.text ?? "System Boundary";
        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", "14");
        text.setAttribute("y", "22");
        text.setAttribute("class", "umlcanvas-system-boundary-title");
        text.textContent = title;
        group.appendChild(text);

        return group;
      },
    };
  }

  private createGenericNoteShape(): ShapeDefinition {
    return {
      kind: "generic.note",
      displayName: "Note",
      defaultSize: { width: 130, height: 80 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-note");

        const w = node.size.width;
        const h = node.size.height;
        const fold = 14;

        // Folded-corner main polygon
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute(
          "d",
          `M 0 0 L ${w - fold} 0 L ${w} ${fold} L ${w} ${h} L 0 ${h} Z`
        );
        path.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-note-body umlcanvas-node-selected"
            : "umlcanvas-note-body"
        );
        group.appendChild(path);

        // Folded flap triangle
        const foldPath = document.createElementNS(svgNS, "path");
        foldPath.setAttribute(
          "d",
          `M ${w - fold} 0 L ${w - fold} ${fold} L ${w} ${fold} Z`
        );
        foldPath.setAttribute("class", "umlcanvas-note-fold");
        group.appendChild(foldPath);

        const textContent = node.labels[0]?.text ?? "Note";
        const lines = textContent.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", "10");
          text.setAttribute("y", String(22 + i * 16));
          text.setAttribute("class", "umlcanvas-note-text");
          text.textContent = lines[i];
          group.appendChild(text);
        }

        return group;
      },
    };
  }

  private createObsidianNoteShape(): ShapeDefinition {
    return {
      kind: "obsidian.note",
      displayName: "Vault Note",
      defaultSize: { width: 340, height: 240 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-obsidian-note");

        const w = node.size.width;
        const h = node.size.height;
        const r = 8;
        const headerH = 32;

        // 1. Card container / background rect
        const bgRect = document.createElementNS(svgNS, "rect");
        bgRect.setAttribute("x", "0");
        bgRect.setAttribute("y", "0");
        bgRect.setAttribute("width", String(w));
        bgRect.setAttribute("height", String(h));
        bgRect.setAttribute("rx", String(r));
        bgRect.setAttribute("ry", String(r));
        bgRect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-obsidian-note-card umlcanvas-node-selected"
            : "umlcanvas-obsidian-note-card"
        );
        group.appendChild(bgRect);

        // 2. Header background rect
        const headerRect = document.createElementNS(svgNS, "path");
        headerRect.setAttribute(
          "d",
          `M 0 ${r} A ${r} ${r} 0 0 1 ${r} 0 L ${w - r} 0 A ${r} ${r} 0 0 1 ${w} ${r} L ${w} ${headerH} L 0 ${headerH} Z`
        );
        headerRect.setAttribute("class", "umlcanvas-obsidian-note-header-bg");
        group.appendChild(headerRect);

        // 3. Header separator line
        const sepLine = document.createElementNS(svgNS, "line");
        sepLine.setAttribute("x1", "0");
        sepLine.setAttribute("y1", String(headerH));
        sepLine.setAttribute("x2", String(w));
        sepLine.setAttribute("y2", String(headerH));
        sepLine.setAttribute("class", "umlcanvas-obsidian-note-header-sep");
        group.appendChild(sepLine);

        // 4. File / Note Icon (Lucide vector file-text icon, no emojis)
        const iconGroup = document.createElementNS(svgNS, "g");
        iconGroup.setAttribute("class", "umlcanvas-obsidian-note-icon");
        iconGroup.setAttribute("transform", "translate(10, 8)");

        const iconPath = document.createElementNS(svgNS, "path");
        iconPath.setAttribute(
          "d",
          "M9 2H3.5A1.5 1.5 0 0 0 2 3.5v11A1.5 1.5 0 0 0 3.5 16h7a1.5 1.5 0 0 0 1.5-1.5V5L9 2z"
        );
        iconPath.setAttribute("fill", "none");
        iconPath.setAttribute("stroke", "currentColor");
        iconPath.setAttribute("stroke-width", "1.2");
        iconPath.setAttribute("stroke-linejoin", "round");
        iconGroup.appendChild(iconPath);

        const iconFold = document.createElementNS(svgNS, "polyline");
        iconFold.setAttribute("points", "8.5 2 8.5 5.5 12 5.5");
        iconFold.setAttribute("fill", "none");
        iconFold.setAttribute("stroke", "currentColor");
        iconFold.setAttribute("stroke-width", "1.2");
        iconFold.setAttribute("stroke-linejoin", "round");
        iconGroup.appendChild(iconFold);

        const iconLine1 = document.createElementNS(svgNS, "line");
        iconLine1.setAttribute("x1", "4.5");
        iconLine1.setAttribute("y1", "8.5");
        iconLine1.setAttribute("x2", "8");
        iconLine1.setAttribute("y2", "8.5");
        iconLine1.setAttribute("stroke", "currentColor");
        iconLine1.setAttribute("stroke-width", "1.1");
        iconGroup.appendChild(iconLine1);

        const iconLine2 = document.createElementNS(svgNS, "line");
        iconLine2.setAttribute("x1", "4.5");
        iconLine2.setAttribute("y1", "11");
        iconLine2.setAttribute("x2", "9.5");
        iconLine2.setAttribute("y2", "11");
        iconLine2.setAttribute("stroke", "currentColor");
        iconLine2.setAttribute("stroke-width", "1.1");
        iconGroup.appendChild(iconLine2);

        group.appendChild(iconGroup);

        // 5. Title Text
        const titleText = document.createElementNS(svgNS, "text");
        titleText.setAttribute("x", "30");
        titleText.setAttribute("y", "21");
        titleText.setAttribute("class", "umlcanvas-obsidian-note-title");
        const rawTitle = node.labels[0]?.text || (node.metadata?.filePath as string) || "Vault Note";
        const title = rawTitle.replace(/\.md$/, "");
        const maxChars = Math.max(12, Math.floor((w - 65) / 8));
        titleText.textContent = title.length > maxChars ? `${title.slice(0, maxChars - 2)}…` : title;
        titleText.setAttribute("title", rawTitle);
        group.appendChild(titleText);

        // 6. Clickable Open Icon in Header (↗)
        const openIcon = document.createElementNS(svgNS, "text");
        openIcon.setAttribute("x", String(w - 22));
        openIcon.setAttribute("y", "21");
        openIcon.setAttribute("class", "umlcanvas-obsidian-note-open-btn");
        const noteFilePath =
          (node.metadata?.filePath as string) || (node.customData?.filePath as string) || "";
        openIcon.setAttribute("data-file-path", noteFilePath);
        openIcon.textContent = "↗";
        openIcon.setAttribute("title", "Open note in Obsidian");
        group.appendChild(openIcon);

        // 7. Rich HTML Markdown Body via foreignObject (for browser / Obsidian interactive view)
        const foreign = document.createElementNS(svgNS, "foreignObject");
        foreign.setAttribute("x", "0");
        foreign.setAttribute("y", String(headerH));
        foreign.setAttribute("width", String(w));
        foreign.setAttribute("height", String(Math.max(10, h - headerH)));
        foreign.setAttribute("class", "umlcanvas-obsidian-note-foreign");

        const bodyDiv = document.createElement("div");
        bodyDiv.setAttribute(
          "class",
          "umlcanvas-obsidian-note-body markdown-rendered markdown-preview-view umlcanvas-scrollable"
        );
        bodyDiv.setAttribute(
          "style",
          "width: 100%; height: 100%; box-sizing: border-box; overflow-y: auto; overflow-x: hidden; padding: 10px 14px;"
        );

        const fullMarkdown =
          (node.customData?.content as string) ||
          (node.customData?.snippet as string) ||
          "";
        if (fullMarkdown) {
          renderMarkdownFallback(fullMarkdown, bodyDiv);
        } else {
          const placeholder = document.createElement("div");
          placeholder.setAttribute("class", "umlcanvas-obsidian-note-body-placeholder");
          placeholder.textContent = "Vault Note (connect to diagram)";
          bodyDiv.appendChild(placeholder);
        }
        foreign.appendChild(bodyDiv);
        group.appendChild(foreign);

        // 8. SVG Fallback elements (for headless Jest tests and SVG-only exporters)
        const fallbackGroup = document.createElementNS(svgNS, "g");
        fallbackGroup.setAttribute("class", "umlcanvas-obsidian-note-svg-fallback");
        fallbackGroup.setAttribute("style", "display: none; opacity: 0; pointer-events: none;");

        const snippet =
          (node.customData?.snippet as string) ||
          (node.customData?.content as string) ||
          "";
        if (snippet) {
          const lines = snippet.split("\n").slice(0, 5);
          for (let i = 0; i < lines.length; i++) {
            const lineText = document.createElementNS(svgNS, "text");
            lineText.setAttribute("x", "12");
            lineText.setAttribute("y", String(headerH + 20 + i * 18));
            lineText.setAttribute("class", "umlcanvas-obsidian-note-body-line");
            lineText.textContent = lines[i];
            fallbackGroup.appendChild(lineText);
          }
        } else {
          const placeholder = document.createElementNS(svgNS, "text");
          placeholder.setAttribute("x", "12");
          placeholder.setAttribute("y", String(headerH + 24));
          placeholder.setAttribute("class", "umlcanvas-obsidian-note-body-placeholder");
          placeholder.textContent = "Vault Note (connect to diagram)";
          fallbackGroup.appendChild(placeholder);
        }
        group.appendChild(fallbackGroup);

        return group;
      },
    };
  }

  private createActivityInitialShape(): ShapeDefinition {
    return {
      kind: "activity.initial",
      displayName: "Initial Node",
      defaultSize: { width: 24, height: 24 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "out",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getCirclePerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-activity-initial");

        const r = Math.min(node.size.width, node.size.height) / 2;
        const circle = document.createElementNS(svgNS, "circle");
        circle.setAttribute("cx", String(node.size.width / 2));
        circle.setAttribute("cy", String(node.size.height / 2));
        circle.setAttribute("r", String(r));
        circle.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-activity-initial-body umlcanvas-node-selected"
            : "umlcanvas-activity-initial-body"
        );
        group.appendChild(circle);
        return group;
      },
    };
  }

  private createActivityFinalShape(): ShapeDefinition {
    return {
      kind: "activity.final",
      displayName: "Final Node",
      defaultSize: { width: 26, height: 26 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "in",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getCirclePerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-activity-final");

        const cx = node.size.width / 2;
        const cy = node.size.height / 2;
        const rOuter = Math.min(node.size.width, node.size.height) / 2 - 1;
        const rInner = Math.max(2, rOuter - 4);

        const outerCircle = document.createElementNS(svgNS, "circle");
        outerCircle.setAttribute("cx", String(cx));
        outerCircle.setAttribute("cy", String(cy));
        outerCircle.setAttribute("r", String(rOuter));
        outerCircle.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-activity-final-outer umlcanvas-node-selected"
            : "umlcanvas-activity-final-outer"
        );
        group.appendChild(outerCircle);

        const innerCircle = document.createElementNS(svgNS, "circle");
        innerCircle.setAttribute("cx", String(cx));
        innerCircle.setAttribute("cy", String(cy));
        innerCircle.setAttribute("r", String(rInner));
        innerCircle.setAttribute("class", "umlcanvas-activity-final-inner");
        group.appendChild(innerCircle);

        return group;
      },
    };
  }

  private createActivityActionShape(): ShapeDefinition {
    return {
      kind: "activity.action",
      displayName: "Action",
      defaultSize: { width: 140, height: 60 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-activity-action");

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute("rx", "14");
        rect.setAttribute("ry", "14");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-activity-action-body umlcanvas-node-selected"
            : "umlcanvas-node-body umlcanvas-activity-action-body"
        );
        group.appendChild(rect);

        const title = node.labels[0]?.text ?? "Action";
        const lines = title.split("\n");
        const startY = node.size.height / 2 - ((lines.length - 1) * 16) / 2 + 4;

        for (let i = 0; i < lines.length; i++) {
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", String(node.size.width / 2));
          text.setAttribute("y", String(startY + i * 16));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("class", "umlcanvas-node-title");
          text.textContent = lines[i];
          group.appendChild(text);
        }

        return group;
      },
    };
  }

  private createActivityDecisionShape(): ShapeDefinition {
    return this.createDiamondShape("activity.decision", "Decision / Merge");
  }

  private createStateChoiceShape(): ShapeDefinition {
    return this.createDiamondShape("state.choice", "Choice Pseudostate");
  }

  private createDiamondShape(kind: string, displayName: string): ShapeDefinition {
    return {
      kind,
      displayName,
      defaultSize: { width: 60, height: 60 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getDiamondPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-diamond");

        const w = node.size.width;
        const h = node.size.height;
        const points = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;

        const poly = document.createElementNS(svgNS, "polygon");
        poly.setAttribute("points", points);
        poly.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-diamond-body umlcanvas-node-selected"
            : "umlcanvas-node-body umlcanvas-diamond-body"
        );
        group.appendChild(poly);

        const title = node.labels[0]?.text ?? "";
        if (title) {
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", String(w / 2));
          text.setAttribute("y", String(h / 2 + 4));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("class", "umlcanvas-node-title");
          text.textContent = title;
          group.appendChild(text);
        }

        return group;
      },
    };
  }

  private createActivityForkJoinShape(): ShapeDefinition {
    return this.createForkJoinShape("activity.forkJoin", "Fork / Join");
  }

  private createStateForkJoinShape(): ShapeDefinition {
    return this.createForkJoinShape("state.forkJoin", "Fork / Join");
  }

  private createForkJoinShape(kind: string, displayName: string): ShapeDefinition {
    return {
      kind,
      displayName,
      defaultSize: { width: 100, height: 8 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const isHorizontal = node.size.width >= node.size.height;
        if (isHorizontal) {
          return [
            { id: `${node.id}-port-top-1`, ownerNodeId: node.id, name: "top-1", side: "top", offset: 0.25, direction: "inout" },
            { id: `${node.id}-port-top-2`, ownerNodeId: node.id, name: "top-2", side: "top", offset: 0.5, direction: "inout" },
            { id: `${node.id}-port-top-3`, ownerNodeId: node.id, name: "top-3", side: "top", offset: 0.75, direction: "inout" },
            { id: `${node.id}-port-bottom-1`, ownerNodeId: node.id, name: "bottom-1", side: "bottom", offset: 0.25, direction: "inout" },
            { id: `${node.id}-port-bottom-2`, ownerNodeId: node.id, name: "bottom-2", side: "bottom", offset: 0.5, direction: "inout" },
            { id: `${node.id}-port-bottom-3`, ownerNodeId: node.id, name: "bottom-3", side: "bottom", offset: 0.75, direction: "inout" },
          ];
        }
        return [
          { id: `${node.id}-port-left-1`, ownerNodeId: node.id, name: "left-1", side: "left", offset: 0.25, direction: "inout" },
          { id: `${node.id}-port-left-2`, ownerNodeId: node.id, name: "left-2", side: "left", offset: 0.5, direction: "inout" },
          { id: `${node.id}-port-left-3`, ownerNodeId: node.id, name: "left-3", side: "left", offset: 0.75, direction: "inout" },
          { id: `${node.id}-port-right-1`, ownerNodeId: node.id, name: "right-1", side: "right", offset: 0.25, direction: "inout" },
          { id: `${node.id}-port-right-2`, ownerNodeId: node.id, name: "right-2", side: "right", offset: 0.5, direction: "inout" },
          { id: `${node.id}-port-right-3`, ownerNodeId: node.id, name: "right-3", side: "right", offset: 0.75, direction: "inout" },
        ];
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-forkjoin");

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute("rx", "2");
        rect.setAttribute("ry", "2");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-forkjoin-body umlcanvas-node-selected"
            : "umlcanvas-forkjoin-body"
        );
        group.appendChild(rect);
        return group;
      },
    };
  }

  private createActivitySwimlaneShape(): ShapeDefinition {
    return {
      kind: "activity.swimlane",
      displayName: "Swimlane",
      defaultSize: { width: 260, height: 480 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-swimlane");

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-swimlane-body umlcanvas-node-selected"
            : "umlcanvas-swimlane-body"
        );
        group.appendChild(rect);

        const headerRect = document.createElementNS(svgNS, "rect");
        headerRect.setAttribute("x", "0");
        headerRect.setAttribute("y", "0");
        headerRect.setAttribute("width", String(node.size.width));
        headerRect.setAttribute("height", "32");
        headerRect.setAttribute("class", "umlcanvas-swimlane-header");
        group.appendChild(headerRect);

        const title = node.labels[0]?.text ?? "Swimlane";
        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", String(node.size.width / 2));
        text.setAttribute("y", "20");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "umlcanvas-group-title");
        text.textContent = title;
        group.appendChild(text);

        return group;
      },
    };
  }

  private createStateInitialShape(): ShapeDefinition {
    return {
      ...this.createActivityInitialShape(),
      kind: "state.initial",
      displayName: "Initial State",
    };
  }

  private createStateFinalShape(): ShapeDefinition {
    return {
      ...this.createActivityFinalShape(),
      kind: "state.final",
      displayName: "Final State",
    };
  }

  private createStateSimpleShape(): ShapeDefinition {
    return {
      kind: "state.simple",
      displayName: "State",
      defaultSize: { width: 150, height: 80 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-state-simple");

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute("rx", "10");
        rect.setAttribute("ry", "10");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-state-body umlcanvas-node-selected"
            : "umlcanvas-node-body umlcanvas-state-body"
        );
        group.appendChild(rect);

        const title = node.labels[0]?.text ?? "State";
        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", String(node.size.width / 2));
        text.setAttribute("y", "20");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "umlcanvas-node-title");
        text.textContent = title;
        group.appendChild(text);

        let currentY = 32;
        if (node.compartments && node.compartments.length > 0) {
          const line = document.createElementNS(svgNS, "line");
          line.setAttribute("x1", "0");
          line.setAttribute("y1", String(currentY));
          line.setAttribute("x2", String(node.size.width));
          line.setAttribute("y2", String(currentY));
          line.setAttribute("class", "umlcanvas-compartment-divider");
          group.appendChild(line);

          for (const comp of node.compartments) {
            for (const item of comp.items) {
              currentY += 16;
              const itemText = document.createElementNS(svgNS, "text");
              itemText.setAttribute("x", "12");
              itemText.setAttribute("y", String(currentY));
              itemText.setAttribute("class", "umlcanvas-compartment-item");
              itemText.textContent = item.visibility
                ? `${item.visibility} ${item.text}`
                : item.text;
              group.appendChild(itemText);
            }
          }
        }

        return group;
      },
    };
  }

  private createStateCompositeShape(): ShapeDefinition {
    return {
      kind: "state.composite",
      displayName: "Composite State",
      defaultSize: { width: 320, height: 220 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-state-composite");

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute("rx", "12");
        rect.setAttribute("ry", "12");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-state-composite-body umlcanvas-node-selected"
            : "umlcanvas-node-body umlcanvas-state-composite-body"
        );
        group.appendChild(rect);

        const title = node.labels[0]?.text ?? "Composite State";
        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", "14");
        text.setAttribute("y", "22");
        text.setAttribute("class", "umlcanvas-node-title");
        text.textContent = title;
        group.appendChild(text);

        return group;
      },
    };
  }

  private createSequenceLifelineShape(): ShapeDefinition {
    return {
      kind: "sequence.lifeline",
      displayName: "Lifeline",
      defaultSize: { width: 130, height: 48 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        const cx = node.position.x + node.size.width / 2;
        if (targetPoint.y > node.position.y + node.size.height) {
          return { x: Math.round(cx), y: Math.round(targetPoint.y) };
        }
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-sequence-lifeline");

        const cx = node.size.width / 2;
        const headerH = node.size.height;
        const lifelineLength =
          typeof node.metadata?.lifelineLength === "number"
            ? (node.metadata.lifelineLength as number)
            : 450;

        // Vertical dashed lifeline stem
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", String(cx));
        line.setAttribute("y1", String(headerH));
        line.setAttribute("x2", String(cx));
        line.setAttribute("y2", String(lifelineLength));
        line.setAttribute("class", "umlcanvas-sequence-stem");
        group.appendChild(line);

        // Header rectangle
        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(headerH));
        rect.setAttribute("rx", "2");
        rect.setAttribute("ry", "2");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(rect);

        // Header text
        const title = node.labels[0]?.text ?? "Lifeline";
        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", String(cx));
        text.setAttribute("y", String(headerH / 2 + 4));
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "umlcanvas-node-title");
        text.textContent = title;
        group.appendChild(text);

        return group;
      },
    };
  }

  private createSequenceActivationShape(): ShapeDefinition {
    return {
      kind: "sequence.activation",
      displayName: "Activation",
      defaultSize: { width: 14, height: 80 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        return [
          { id: `${node.id}-port-left`, ownerNodeId: node.id, name: "left", side: "left", offset: 0.5, direction: "inout" },
          { id: `${node.id}-port-right`, ownerNodeId: node.id, name: "right", side: "right", offset: 0.5, direction: "inout" },
          { id: `${node.id}-port-top`, ownerNodeId: node.id, name: "top", side: "top", offset: 0.5, direction: "inout" },
          { id: `${node.id}-port-bottom`, ownerNodeId: node.id, name: "bottom", side: "bottom", offset: 0.5, direction: "inout" },
        ];
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-sequence-activation");

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-sequence-activation-body umlcanvas-node-selected"
            : "umlcanvas-sequence-activation-body"
        );
        group.appendChild(rect);

        return group;
      },
    };
  }

  private createUmlComponentShape(): ShapeDefinition {
    return {
      kind: "uml.component",
      displayName: "Component",
      defaultSize: { width: 140, height: 80 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-component");

        const w = node.size.width;
        const h = node.size.height;

        // Base box
        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(w));
        rect.setAttribute("height", String(h));
        rect.setAttribute("rx", "2");
        rect.setAttribute("ry", "2");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(rect);

        // Component Icon Glyph in top-right corner
        const iconGroup = document.createElementNS(svgNS, "g");
        iconGroup.setAttribute("class", "umlcanvas-component-icon");
        const iconX = w - 24;
        const iconY = 8;
        const baseBox = document.createElementNS(svgNS, "rect");
        baseBox.setAttribute("x", String(iconX));
        baseBox.setAttribute("y", String(iconY));
        baseBox.setAttribute("width", "16");
        baseBox.setAttribute("height", "18");
        baseBox.setAttribute("class", "umlcanvas-component-icon-box");
        iconGroup.appendChild(baseBox);

        // Two tabs
        const tab1 = document.createElementNS(svgNS, "rect");
        tab1.setAttribute("x", String(iconX - 4));
        tab1.setAttribute("y", String(iconY + 3));
        tab1.setAttribute("width", "7");
        tab1.setAttribute("height", "4");
        tab1.setAttribute("class", "umlcanvas-component-icon-tab");
        iconGroup.appendChild(tab1);

        const tab2 = document.createElementNS(svgNS, "rect");
        tab2.setAttribute("x", String(iconX - 4));
        tab2.setAttribute("y", String(iconY + 11));
        tab2.setAttribute("width", "7");
        tab2.setAttribute("height", "4");
        tab2.setAttribute("class", "umlcanvas-component-icon-tab");
        iconGroup.appendChild(tab2);

        group.appendChild(iconGroup);

        // Stereotype
        const stText = document.createElementNS(svgNS, "text");
        stText.setAttribute("x", String(w / 2));
        stText.setAttribute("y", "26");
        stText.setAttribute("text-anchor", "middle");
        stText.setAttribute("class", "umlcanvas-node-stereotype");
        stText.textContent = `«${node.stereotype || "component"}»`;
        group.appendChild(stText);

        // Title
        const titleText = document.createElementNS(svgNS, "text");
        titleText.setAttribute("x", String(w / 2));
        titleText.setAttribute("y", "48");
        titleText.setAttribute("text-anchor", "middle");
        titleText.setAttribute("class", "umlcanvas-node-title");
        titleText.textContent = node.labels[0]?.text ?? "Component";
        group.appendChild(titleText);

        return group;
      },
    };
  }

  private createUmlLollipopShape(): ShapeDefinition {
    return {
      kind: "uml.lollipop",
      displayName: "Interface (Provided)",
      defaultSize: { width: 28, height: 28 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getCirclePerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-lollipop");

        const cx = node.size.width / 2;
        const cy = node.size.height / 2;
        const r = Math.min(cx, cy) - 2;

        const circle = document.createElementNS(svgNS, "circle");
        circle.setAttribute("cx", String(cx));
        circle.setAttribute("cy", String(cy));
        circle.setAttribute("r", String(Math.max(4, r)));
        circle.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-lollipop-body umlcanvas-node-selected"
            : "umlcanvas-lollipop-body"
        );
        group.appendChild(circle);

        const title = node.labels[0]?.text;
        if (title) {
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", String(cx));
          text.setAttribute("y", String(node.size.height + 14));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("class", "umlcanvas-node-title");
          text.textContent = title;
          group.appendChild(text);
        }

        return group;
      },
    };
  }

  private createUmlSocketShape(): ShapeDefinition {
    return {
      kind: "uml.socket",
      displayName: "Interface (Required)",
      defaultSize: { width: 28, height: 28 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getCirclePerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-socket");

        const cx = node.size.width / 2;
        const cy = node.size.height / 2;
        const r = Math.min(cx, cy) - 2;

        const path = document.createElementNS(svgNS, "path");
        path.setAttribute(
          "d",
          `M ${cx},${cy - r} A ${r},${r} 0 0,0 ${cx},${cy + r}`
        );
        path.setAttribute("fill", "none");
        path.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-socket-body umlcanvas-node-selected"
            : "umlcanvas-socket-body"
        );
        group.appendChild(path);

        const title = node.labels[0]?.text;
        if (title) {
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", String(cx));
          text.setAttribute("y", String(node.size.height + 14));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("class", "umlcanvas-node-title");
          text.textContent = title;
          group.appendChild(text);
        }

        return group;
      },
    };
  }

  private createUmlComponentPortShape(): ShapeDefinition {
    return {
      kind: "uml.componentPort",
      displayName: "Port",
      defaultSize: { width: 16, height: 16 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        return [
          { id: `${node.id}-port-center`, ownerNodeId: node.id, name: "center", side: "top", offset: 0.5, direction: "inout" },
        ];
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-component-port");

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(rect);

        const title = node.labels[0]?.text;
        if (title) {
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", String(node.size.width / 2));
          text.setAttribute("y", String(node.size.height + 12));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("class", "umlcanvas-port-label");
          text.textContent = title;
          group.appendChild(text);
        }

        return group;
      },
    };
  }

  private createUmlNode3dShape(options?: {
    kind?: string;
    displayName?: string;
    defaultStereotype?: string;
  }): ShapeDefinition {
    const kind = options?.kind ?? "uml.node3d";
    const displayName = options?.displayName ?? "Node (3D Box)";
    const defStereotype = options?.defaultStereotype ?? "device";

    return {
      kind,
      displayName,
      defaultSize: { width: 160, height: 110 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-node3d");

        const w = node.size.width;
        const h = node.size.height;
        const d = 14;

        // Top face (parallelogram)
        const topFace = document.createElementNS(svgNS, "polygon");
        topFace.setAttribute("points", `0,${d} ${d},0 ${w},0 ${w - d},${d}`);
        topFace.setAttribute("class", "umlcanvas-node3d-top");
        group.appendChild(topFace);

        // Right face (parallelogram)
        const rightFace = document.createElementNS(svgNS, "polygon");
        rightFace.setAttribute(
          "points",
          `${w - d},${d} ${w},0 ${w},${h - d} ${w - d},${h}`
        );
        rightFace.setAttribute("class", "umlcanvas-node3d-side");
        group.appendChild(rightFace);

        // Front face (main rectangle)
        const frontFace = document.createElementNS(svgNS, "rect");
        frontFace.setAttribute("x", "0");
        frontFace.setAttribute("y", String(d));
        frontFace.setAttribute("width", String(w - d));
        frontFace.setAttribute("height", String(h - d));
        frontFace.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(frontFace);

        // Stereotype
        const st = node.stereotype || defStereotype;
        const stText = document.createElementNS(svgNS, "text");
        stText.setAttribute("x", String((w - d) / 2));
        stText.setAttribute("y", String(d + 20));
        stText.setAttribute("text-anchor", "middle");
        stText.setAttribute("class", "umlcanvas-node-stereotype");
        stText.textContent = `«${st}»`;
        group.appendChild(stText);

        // Title
        const title = node.labels[0]?.text ?? "Node";
        const titleText = document.createElementNS(svgNS, "text");
        titleText.setAttribute("x", String((w - d) / 2));
        titleText.setAttribute("y", String(d + 42));
        titleText.setAttribute("text-anchor", "middle");
        titleText.setAttribute("class", "umlcanvas-node-title");
        titleText.textContent = title;
        group.appendChild(titleText);

        return group;
      },
    };
  }

  private createUmlArtifactShape(): ShapeDefinition {
    return {
      kind: "uml.artifact",
      displayName: "Artifact",
      defaultSize: { width: 130, height: 75 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-artifact");

        const w = node.size.width;
        const h = node.size.height;

        // Base rect
        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(w));
        rect.setAttribute("height", String(h));
        rect.setAttribute("rx", "2");
        rect.setAttribute("ry", "2");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(rect);

        // Document folded-corner glyph in top right
        const iconGroup = document.createElementNS(svgNS, "g");
        iconGroup.setAttribute("class", "umlcanvas-artifact-icon");
        const docX = w - 24;
        const docY = 8;
        const docPath = document.createElementNS(svgNS, "path");
        docPath.setAttribute(
          "d",
          `M ${docX},${docY} L ${docX + 10},${docY} L ${docX + 16},${docY + 6} L ${docX + 16},${docY + 20} L ${docX},${docY + 20} Z`
        );
        docPath.setAttribute("class", "umlcanvas-artifact-icon-doc");
        iconGroup.appendChild(docPath);

        const foldPath = document.createElementNS(svgNS, "path");
        foldPath.setAttribute(
          "d",
          `M ${docX + 10},${docY} L ${docX + 10},${docY + 6} L ${docX + 16},${docY + 6}`
        );
        foldPath.setAttribute("class", "umlcanvas-artifact-icon-fold");
        iconGroup.appendChild(foldPath);

        group.appendChild(iconGroup);

        // Stereotype
        const stText = document.createElementNS(svgNS, "text");
        stText.setAttribute("x", String(w / 2));
        stText.setAttribute("y", "24");
        stText.setAttribute("text-anchor", "middle");
        stText.setAttribute("class", "umlcanvas-node-stereotype");
        stText.textContent = `«${node.stereotype || "artifact"}»`;
        group.appendChild(stText);

        // Title
        const titleText = document.createElementNS(svgNS, "text");
        titleText.setAttribute("x", String(w / 2));
        titleText.setAttribute("y", "46");
        titleText.setAttribute("text-anchor", "middle");
        titleText.setAttribute("class", "umlcanvas-node-title");
        titleText.textContent = node.labels[0]?.text ?? "Artifact";
        group.appendChild(titleText);

        return group;
      },
    };
  }

  private createTimingLaneShape(): ShapeDefinition {
    return {
      kind: "timing.lane",
      displayName: "Timing Lane",
      defaultSize: { width: 500, height: 80 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-timing-lane");

        const w = node.size.width;
        const h = node.size.height;
        const headerW = 110;

        // Background
        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(w));
        rect.setAttribute("height", String(h));
        rect.setAttribute("rx", "2");
        rect.setAttribute("ry", "2");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(rect);

        // Header vertical divider
        const divLine = document.createElementNS(svgNS, "line");
        divLine.setAttribute("x1", String(headerW));
        divLine.setAttribute("y1", "0");
        divLine.setAttribute("x2", String(headerW));
        divLine.setAttribute("y2", String(h));
        divLine.setAttribute("class", "umlcanvas-timing-divider");
        group.appendChild(divLine);

        // Header text (Classifier name)
        const headerText = document.createElementNS(svgNS, "text");
        headerText.setAttribute("x", String(headerW / 2));
        headerText.setAttribute("y", String(h / 2 + 4));
        headerText.setAttribute("text-anchor", "middle");
        headerText.setAttribute("class", "umlcanvas-node-title");
        headerText.textContent = node.labels[0]?.text ?? "Classifier";
        group.appendChild(headerText);

        // Timeline guide lines (dashed horizontal)
        const g1 = document.createElementNS(svgNS, "line");
        g1.setAttribute("x1", String(headerW));
        g1.setAttribute("y1", String(h * 0.33));
        g1.setAttribute("x2", String(w));
        g1.setAttribute("y2", String(h * 0.33));
        g1.setAttribute("class", "umlcanvas-timing-guideline");
        group.appendChild(g1);

        const g2 = document.createElementNS(svgNS, "line");
        g2.setAttribute("x1", String(headerW));
        g2.setAttribute("y1", String(h * 0.67));
        g2.setAttribute("x2", String(w));
        g2.setAttribute("y2", String(h * 0.67));
        g2.setAttribute("class", "umlcanvas-timing-guideline");
        group.appendChild(g2);

        return group;
      },
    };
  }

  private createTimingStateSegmentShape(): ShapeDefinition {
    return {
      kind: "timing.stateSegment",
      displayName: "State Segment",
      defaultSize: { width: 120, height: 26 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        return [
          { id: `${node.id}-port-left`, ownerNodeId: node.id, name: "left", side: "left", offset: 0.5, direction: "inout" },
          { id: `${node.id}-port-right`, ownerNodeId: node.id, name: "right", side: "right", offset: 0.5, direction: "inout" },
          { id: `${node.id}-port-top`, ownerNodeId: node.id, name: "top", side: "top", offset: 0.5, direction: "inout" },
          { id: `${node.id}-port-bottom`, ownerNodeId: node.id, name: "bottom", side: "bottom", offset: 0.5, direction: "inout" },
        ];
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-timing-segment");

        const w = node.size.width;
        const h = node.size.height;

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(w));
        rect.setAttribute("height", String(h));
        rect.setAttribute("rx", "3");
        rect.setAttribute("ry", "3");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-timing-segment-body umlcanvas-node-selected"
            : "umlcanvas-timing-segment-body"
        );
        group.appendChild(rect);

        const title = node.labels[0]?.text ?? "State";
        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", String(w / 2));
        text.setAttribute("y", String(h / 2 + 4));
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "umlcanvas-timing-segment-text");
        text.textContent = title;
        group.appendChild(text);

        return group;
      },
    };
  }

  private createSchematicChipShape(): ShapeDefinition {
    return {
      kind: "schematic.chip",
      displayName: "Chip",
      defaultSize: { width: 140, height: 90 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-schematic-chip");

        const w = node.size.width;
        const h = node.size.height;

        // Chip IC body
        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(w));
        rect.setAttribute("height", String(h));
        rect.setAttribute("rx", "4");
        rect.setAttribute("ry", "4");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-chip-body umlcanvas-node-selected"
            : "umlcanvas-chip-body"
        );
        group.appendChild(rect);

        // Chip orientation notch at top center
        const notch = document.createElementNS(svgNS, "path");
        notch.setAttribute(
          "d",
          `M ${w / 2 - 8},0 A 8,8 0 0,0 ${w / 2 + 8},0`
        );
        notch.setAttribute("class", "umlcanvas-chip-notch");
        group.appendChild(notch);

        // Centered chip title
        const title = node.labels[0]?.text ?? "Chip";
        const titleText = document.createElementNS(svgNS, "text");
        titleText.setAttribute("x", String(w / 2));
        titleText.setAttribute("y", String(h / 2 + 4));
        titleText.setAttribute("text-anchor", "middle");
        titleText.setAttribute("class", "umlcanvas-chip-title");
        titleText.textContent = title;
        group.appendChild(titleText);

        // Render port pin stubs and pin labels
        for (const port of node.ports) {
          const pinLine = document.createElementNS(svgNS, "line");
          const pinText = document.createElementNS(svgNS, "text");
          pinText.setAttribute("class", "umlcanvas-chip-port-label");

          const portLabel = port.dataType ? `${port.name} [${port.dataType}]` : port.name;

          if (port.side === "left") {
            const py = h * port.offset;
            pinLine.setAttribute("x1", "-6");
            pinLine.setAttribute("y1", String(py));
            pinLine.setAttribute("x2", "0");
            pinLine.setAttribute("y2", String(py));
            pinLine.setAttribute("class", "umlcanvas-chip-pin");
            group.appendChild(pinLine);

            pinText.setAttribute("x", "6");
            pinText.setAttribute("y", String(py + 3.5));
            pinText.setAttribute("text-anchor", "start");
            const arrow = port.direction === "out" ? "◀ " : port.direction === "inout" ? "◀▶ " : "▶ ";
            pinText.textContent = `${arrow}${portLabel}`;
            group.appendChild(pinText);
          } else if (port.side === "right") {
            const py = h * port.offset;
            pinLine.setAttribute("x1", String(w));
            pinLine.setAttribute("y1", String(py));
            pinLine.setAttribute("x2", String(w + 6));
            pinLine.setAttribute("y2", String(py));
            pinLine.setAttribute("class", "umlcanvas-chip-pin");
            group.appendChild(pinLine);

            pinText.setAttribute("x", String(w - 6));
            pinText.setAttribute("y", String(py + 3.5));
            pinText.setAttribute("text-anchor", "end");
            const arrow = port.direction === "in" ? " ◀" : port.direction === "inout" ? " ◀▶" : " ▶";
            pinText.textContent = `${portLabel}${arrow}`;
            group.appendChild(pinText);
          } else if (port.side === "top") {
            const px = w * port.offset;
            pinLine.setAttribute("x1", String(px));
            pinLine.setAttribute("y1", "-6");
            pinLine.setAttribute("x2", String(px));
            pinLine.setAttribute("y2", "0");
            pinLine.setAttribute("class", "umlcanvas-chip-pin");
            group.appendChild(pinLine);

            pinText.setAttribute("x", String(px));
            pinText.setAttribute("y", "12");
            pinText.setAttribute("text-anchor", "middle");
            pinText.textContent = portLabel;
            group.appendChild(pinText);
          } else if (port.side === "bottom") {
            const px = w * port.offset;
            pinLine.setAttribute("x1", String(px));
            pinLine.setAttribute("y1", String(h));
            pinLine.setAttribute("x2", String(px));
            pinLine.setAttribute("y2", String(h + 6));
            pinLine.setAttribute("class", "umlcanvas-chip-pin");
            group.appendChild(pinLine);

            pinText.setAttribute("x", String(px));
            pinText.setAttribute("y", String(h - 6));
            pinText.setAttribute("text-anchor", "middle");
            pinText.textContent = portLabel;
            group.appendChild(pinText);
          }
        }

        // Nested child diagram drill-down indicator (F-062)
        if (node.childDiagramId) {
          const badgeGroup = document.createElementNS(svgNS, "g");
          badgeGroup.setAttribute("class", "umlcanvas-chip-drill-indicator");
          const badgeRect = document.createElementNS(svgNS, "rect");
          badgeRect.setAttribute("x", String(w - 22));
          badgeRect.setAttribute("y", "6");
          badgeRect.setAttribute("width", "16");
          badgeRect.setAttribute("height", "16");
          badgeRect.setAttribute("rx", "3");
          badgeRect.setAttribute("class", "umlcanvas-chip-drill-badge");
          badgeGroup.appendChild(badgeRect);

          const badgeIcon = document.createElementNS(svgNS, "text");
          badgeIcon.setAttribute("x", String(w - 14));
          badgeIcon.setAttribute("y", "18");
          badgeIcon.setAttribute("text-anchor", "middle");
          badgeIcon.setAttribute("class", "umlcanvas-chip-drill-icon");
          badgeIcon.textContent = "⤢";
          badgeGroup.appendChild(badgeIcon);

          group.appendChild(badgeGroup);
        }

        return group;
      },
    };
  }

  private getDefaultPorts(node: DiagramNode): Port[] {
    if (node.ports && node.ports.length > 0) {
      return node.ports;
    }
    const sides: Side[] = ["top", "right", "bottom", "left"];
    return sides.map((side) => ({
      id: `${node.id}-port-${side}`,
      ownerNodeId: node.id,
      name: side,
      side,
      offset: 0.5,
      direction: "inout",
    }));
  }

  private createUmlPackageShape(): ShapeDefinition {
    return {
      kind: "uml.package",
      displayName: "Package",
      defaultSize: { width: 180, height: 120 },
      getPorts: (node: DiagramNode): Port[] => this.getDefaultPorts(node),
      getBoundaryPoint: (node: DiagramNode, targetPoint: Point): Point =>
        getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        ),
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-package");

        const w = node.size.width;
        const h = node.size.height;
        const tabW = Math.min(80, w * 0.45);
        const tabH = 22;

        const tab = document.createElementNS(svgNS, "rect");
        tab.setAttribute("x", "0");
        tab.setAttribute("y", "0");
        tab.setAttribute("width", String(tabW));
        tab.setAttribute("height", String(tabH));
        tab.setAttribute("class", "umlcanvas-package-tab");
        group.appendChild(tab);

        const body = document.createElementNS(svgNS, "rect");
        body.setAttribute("x", "0");
        body.setAttribute("y", String(tabH));
        body.setAttribute("width", String(w));
        body.setAttribute("height", String(h - tabH));
        body.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(body);

        const title = node.labels[0]?.text;
        if (title) {
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", String(w / 2));
          text.setAttribute("y", String(tabH + 24));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("class", "umlcanvas-node-title");
          text.textContent = title;
          group.appendChild(text);
        }

        return group;
      },
    };
  }

  private createUmlCompositeClassifierShape(): ShapeDefinition {
    return {
      kind: "uml.compositeClassifier",
      displayName: "Composite Classifier",
      defaultSize: { width: 280, height: 180 },
      getPorts: (node: DiagramNode): Port[] => this.getDefaultPorts(node),
      getBoundaryPoint: (node: DiagramNode, targetPoint: Point): Point =>
        getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        ),
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-composite-classifier");

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute("rx", "8");
        rect.setAttribute("ry", "8");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(rect);

        const headerLine = document.createElementNS(svgNS, "line");
        headerLine.setAttribute("x1", "0");
        headerLine.setAttribute("y1", "34");
        headerLine.setAttribute("x2", String(node.size.width));
        headerLine.setAttribute("y2", "34");
        headerLine.setAttribute("class", "umlcanvas-compartment-divider");
        group.appendChild(headerLine);

        const title = node.labels[0]?.text;
        if (title) {
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", String(node.size.width / 2));
          text.setAttribute("y", "22");
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("class", "umlcanvas-node-title");
          text.textContent = title;
          group.appendChild(text);
        }

        return group;
      },
    };
  }

  private createUmlPartShape(): ShapeDefinition {
    return {
      kind: "uml.part",
      displayName: "Part",
      defaultSize: { width: 110, height: 60 },
      getPorts: (node: DiagramNode): Port[] => this.getDefaultPorts(node),
      getBoundaryPoint: (node: DiagramNode, targetPoint: Point): Point =>
        getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        ),
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-part");

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute("rx", "2");
        rect.setAttribute("ry", "2");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(rect);

        const title = node.labels[0]?.text;
        if (title) {
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", String(node.size.width / 2));
          text.setAttribute("y", String(node.size.height / 2 + 5));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("class", "umlcanvas-node-title");
          text.textContent = title;
          group.appendChild(text);
        }

        return group;
      },
    };
  }

  private createInteractionFrameShape(): ShapeDefinition {
    return {
      kind: "interaction.frame",
      displayName: "Interaction Frame",
      defaultSize: { width: 240, height: 160 },
      getPorts: (node: DiagramNode): Port[] => this.getDefaultPorts(node),
      getBoundaryPoint: (node: DiagramNode, targetPoint: Point): Point =>
        getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        ),
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-interaction-frame");

        const w = node.size.width;
        const h = node.size.height;
        const tabW = Math.min(80, w * 0.4);
        const tabH = 22;

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(w));
        rect.setAttribute("height", String(h));
        rect.setAttribute("rx", "2");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(rect);

        const tabPath = document.createElementNS(svgNS, "path");
        tabPath.setAttribute(
          "d",
          `M 0,0 L ${tabW},0 L ${tabW + 8},${tabH / 2} L ${tabW},${tabH} L 0,${tabH} Z`
        );
        tabPath.setAttribute("class", "umlcanvas-interaction-tab");
        group.appendChild(tabPath);

        const tabText = document.createElementNS(svgNS, "text");
        tabText.setAttribute("x", String(tabW / 2));
        tabText.setAttribute("y", "15");
        tabText.setAttribute("text-anchor", "middle");
        tabText.setAttribute("class", "umlcanvas-interaction-tab-text");
        tabText.textContent = "sd";
        group.appendChild(tabText);

        const title = node.labels[0]?.text;
        if (title) {
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", String(tabW + 16));
          text.setAttribute("y", "16");
          text.setAttribute("class", "umlcanvas-node-title");
          text.textContent = title;
          group.appendChild(text);
        }

        if (node.childDiagramId) {
          const badgeGroup = document.createElementNS(svgNS, "g");
          badgeGroup.setAttribute("class", "umlcanvas-chip-drill-indicator");
          const badgeRect = document.createElementNS(svgNS, "rect");
          badgeRect.setAttribute("x", String(w - 22));
          badgeRect.setAttribute("y", "6");
          badgeRect.setAttribute("width", "16");
          badgeRect.setAttribute("height", "16");
          badgeRect.setAttribute("rx", "3");
          badgeRect.setAttribute("class", "umlcanvas-chip-drill-badge");
          badgeGroup.appendChild(badgeRect);

          const badgeIcon = document.createElementNS(svgNS, "text");
          badgeIcon.setAttribute("x", String(w - 14));
          badgeIcon.setAttribute("y", "18");
          badgeIcon.setAttribute("text-anchor", "middle");
          badgeIcon.setAttribute("class", "umlcanvas-chip-drill-icon");
          badgeIcon.textContent = "⤢";
          badgeGroup.appendChild(badgeIcon);

          group.appendChild(badgeGroup);
        }

        return group;
      },
    };
  }

  private createInteractionOccurrenceShape(): ShapeDefinition {
    return {
      kind: "interaction.occurrence",
      displayName: "Interaction Occurrence",
      defaultSize: { width: 140, height: 70 },
      getPorts: (node: DiagramNode): Port[] => this.getDefaultPorts(node),
      getBoundaryPoint: (node: DiagramNode, targetPoint: Point): Point =>
        getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        ),
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-interaction-occurrence");

        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(node.size.width));
        rect.setAttribute("height", String(node.size.height));
        rect.setAttribute("rx", "4");
        rect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-node-selected"
            : "umlcanvas-node-body"
        );
        group.appendChild(rect);

        const refText = document.createElementNS(svgNS, "text");
        refText.setAttribute("x", "8");
        refText.setAttribute("y", "18");
        refText.setAttribute("class", "umlcanvas-node-st");
        refText.textContent = "ref";
        group.appendChild(refText);

        const title = node.labels[0]?.text;
        if (title) {
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", String(node.size.width / 2));
          text.setAttribute("y", String(node.size.height / 2 + 5));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("class", "umlcanvas-node-title");
          text.textContent = title;
          group.appendChild(text);
        }

        return group;
      },
    };
  }

  private createUmlStereotypeShape(): ShapeDefinition {
    return this.createUmlClassShape({
      kind: "uml.stereotype",
      displayName: "Stereotype",
      defaultStereotype: "stereotype",
    });
  }

  private createUmlMetaclassShape(): ShapeDefinition {
    return this.createUmlClassShape({
      kind: "uml.metaclass",
      displayName: "Metaclass",
      defaultStereotype: "metaclass",
    });
  }

  private createSchematicJunctionShape(): ShapeDefinition {
    return {
      kind: "schematic.junction",
      displayName: "Junction Dot",
      defaultSize: { width: 14, height: 14 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        return [
          { id: `${node.id}-top`, ownerNodeId: node.id, name: "top", side: "top", offset: 0.5, direction: "inout" },
          { id: `${node.id}-right`, ownerNodeId: node.id, name: "right", side: "right", offset: 0.5, direction: "inout" },
          { id: `${node.id}-bottom`, ownerNodeId: node.id, name: "bottom", side: "bottom", offset: 0.5, direction: "inout" },
          { id: `${node.id}-left`, ownerNodeId: node.id, name: "left", side: "left", offset: 0.5, direction: "inout" },
        ];
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getCirclePerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-schematic-junction");

        const cx = node.size.width / 2;
        const cy = node.size.height / 2;
        const circle = document.createElementNS(svgNS, "circle");
        circle.setAttribute("cx", String(cx));
        circle.setAttribute("cy", String(cy));
        circle.setAttribute("r", "5");
        circle.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-schematic-junction-dot umlcanvas-node-selected"
            : "umlcanvas-schematic-junction-dot"
        );
        group.appendChild(circle);

        return group;
      },
    };
  }

  private createSchematicGroundShape(): ShapeDefinition {
    return {
      kind: "schematic.ground",
      displayName: "Ground",
      defaultSize: { width: 30, height: 30 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        return [
          { id: `${node.id}-top`, ownerNodeId: node.id, name: "top", side: "top", offset: 0.5, direction: "in" },
        ];
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-schematic-ground");

        const cx = node.size.width / 2;

        const stem = document.createElementNS(svgNS, "line");
        stem.setAttribute("x1", String(cx));
        stem.setAttribute("y1", "0");
        stem.setAttribute("x2", String(cx));
        stem.setAttribute("y2", "12");
        stem.setAttribute("class", "umlcanvas-schematic-line");
        group.appendChild(stem);

        const l1 = document.createElementNS(svgNS, "line");
        l1.setAttribute("x1", String(cx - 12));
        l1.setAttribute("y1", "12");
        l1.setAttribute("x2", String(cx + 12));
        l1.setAttribute("y2", "12");
        l1.setAttribute("class", "umlcanvas-schematic-line");
        group.appendChild(l1);

        const l2 = document.createElementNS(svgNS, "line");
        l2.setAttribute("x1", String(cx - 7));
        l2.setAttribute("y1", "18");
        l2.setAttribute("x2", String(cx + 7));
        l2.setAttribute("y2", "18");
        l2.setAttribute("class", "umlcanvas-schematic-line");
        group.appendChild(l2);

        const l3 = document.createElementNS(svgNS, "line");
        l3.setAttribute("x1", String(cx - 3));
        l3.setAttribute("y1", "24");
        l3.setAttribute("x2", String(cx + 3));
        l3.setAttribute("y2", "24");
        l3.setAttribute("class", "umlcanvas-schematic-line");
        group.appendChild(l3);

        return group;
      },
    };
  }

  private createSchematicPowerRailShape(): ShapeDefinition {
    return {
      kind: "schematic.powerRail",
      displayName: "Power Rail",
      defaultSize: { width: 40, height: 36 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        return [
          { id: `${node.id}-bottom`, ownerNodeId: node.id, name: "bottom", side: "bottom", offset: 0.5, direction: "out" },
        ];
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-schematic-power");

        const cx = node.size.width / 2;

        const stem = document.createElementNS(svgNS, "line");
        stem.setAttribute("x1", String(cx));
        stem.setAttribute("y1", String(node.size.height));
        stem.setAttribute("x2", String(cx));
        stem.setAttribute("y2", "16");
        stem.setAttribute("class", "umlcanvas-schematic-line");
        group.appendChild(stem);

        const bar = document.createElementNS(svgNS, "line");
        bar.setAttribute("x1", String(cx - 12));
        bar.setAttribute("y1", "16");
        bar.setAttribute("x2", String(cx + 12));
        bar.setAttribute("y2", "16");
        bar.setAttribute("class", "umlcanvas-schematic-line");
        group.appendChild(bar);

        const title = node.labels[0]?.text || "VCC";
        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", String(cx));
        text.setAttribute("y", "10");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "umlcanvas-schematic-label");
        text.textContent = title;
        group.appendChild(text);

        return group;
      },
    };
  }

  private createSchematicBusTapShape(): ShapeDefinition {
    return {
      kind: "schematic.busTap",
      displayName: "Bus Tap",
      defaultSize: { width: 24, height: 24 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        return [
          { id: `${node.id}-in`, ownerNodeId: node.id, name: "in", side: "left", offset: 0.5, direction: "in" },
          { id: `${node.id}-out`, ownerNodeId: node.id, name: "out", side: "right", offset: 0.5, direction: "out" },
          { id: `${node.id}-tap`, ownerNodeId: node.id, name: "tap", side: "bottom", offset: 0.5, direction: "out" },
        ];
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-schematic-bus-tap");

        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", "M 0,12 L 12,12 L 24,24");
        path.setAttribute("fill", "none");
        path.setAttribute("class", "umlcanvas-schematic-line");
        path.setAttribute("stroke-width", "2");
        group.appendChild(path);

        return group;
      },
    };
  }

  private createGenericFreehandShape(): ShapeDefinition {
    return {
      kind: "generic.freehand",
      displayName: "Freehand Stroke",
      defaultSize: { width: 100, height: 60 },
      getPorts(node: DiagramNode): Port[] {
        if (node.ports && node.ports.length > 0) return node.ports;
        const sides: Side[] = ["top", "right", "bottom", "left"];
        return sides.map((side) => ({
          id: `${node.id}-port-${side}`,
          ownerNodeId: node.id,
          name: side,
          side,
          offset: 0.5,
          direction: "inout",
        }));
      },
      getBoundaryPoint(node: DiagramNode, targetPoint: Point): Point {
        return getRectPerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-freehand");

        const pathData = (node.customData?.pathData as string) || "";
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", pathData);
        path.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-freehand-path umlcanvas-node-selected"
            : "umlcanvas-freehand-path"
        );
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "currentColor");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        group.appendChild(path);

        return group;
      },
    };
  }
}

export const defaultShapeRegistry = new ShapeRegistry();

function appendInlineTokens(text: string, parent: HTMLElement): void {
  const pattern = /(!?\[\[(.*?)\]\])|(\[(.*?)\]\((.*?)\))|(`([^`]+)`)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let matchedAny = false;

  while ((match = pattern.exec(text)) !== null) {
    matchedAny = true;
    if (match.index > lastIndex) {
      const span = document.createElement("span");
      span.textContent = text.substring(lastIndex, match.index);
      parent.appendChild(span);
    }

    if (match[1]) {
      const inner = match[2];
      const parts = inner.split("|");
      const target = parts[0];
      const alias = parts[1] || target;
      const a = document.createElement("a");
      a.className = "internal-link";
      a.setAttribute("data-href", target);
      a.textContent = alias;
      parent.appendChild(a);
    } else if (match[3]) {
      const linkText = match[4];
      const url = match[5];
      const a = document.createElement("a");
      a.className = "external-link";
      a.setAttribute("href", url);
      a.textContent = linkText;
      parent.appendChild(a);
    } else if (match[6]) {
      const code = document.createElement("code");
      code.textContent = match[7];
      parent.appendChild(code);
    } else if (match[8]) {
      const strong = document.createElement("strong");
      strong.textContent = match[8];
      parent.appendChild(strong);
    } else if (match[9]) {
      const em = document.createElement("em");
      em.textContent = match[9];
      parent.appendChild(em);
    }

    lastIndex = pattern.lastIndex;
  }

  if (!matchedAny) {
    parent.textContent = text;
  } else if (lastIndex < text.length) {
    const span = document.createElement("span");
    span.textContent = text.substring(lastIndex);
    parent.appendChild(span);
  }
}

function renderMarkdownFallback(markdown: string, container: HTMLElement): void {
  const clean = markdown.replace(/^---[\s\S]*?---\r?\n?/, "").trim();
  if (!clean) return;

  const lines = clean.split(/\r?\n/);
  let currentList: HTMLElement | null = null;
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = codeBuffer.join("\n");
        pre.appendChild(code);
        container.appendChild(pre);
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    const listMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (listMatch) {
      if (!currentList) {
        currentList = document.createElement("ul");
        container.appendChild(currentList);
      }
      const li = document.createElement("li");
      const taskMatch = listMatch[2].match(/^\[([ xX])\]\s+(.*)$/);
      if (taskMatch) {
        li.className = "task-list-item" + (taskMatch[1].toLowerCase() === "x" ? " is-checked" : "");
        const checkbox = document.createElement("input");
        checkbox.setAttribute("type", "checkbox");
        checkbox.setAttribute("disabled", "true");
        if (taskMatch[1].toLowerCase() === "x") {
          checkbox.setAttribute("checked", "true");
        }
        li.appendChild(checkbox);
        appendInlineTokens(taskMatch[2], li);
      } else {
        appendInlineTokens(listMatch[2], li);
      }
      currentList.appendChild(li);
      continue;
    } else {
      currentList = null;
    }

    if (line.trim().length === 0) {
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const h = document.createElement(`h${level}`);
      h.className = `umlcanvas-note-h${level}`;
      appendInlineTokens(headingMatch[2], h);
      container.appendChild(h);
      continue;
    }

    if (line.startsWith(">")) {
      const bq = document.createElement("blockquote");
      appendInlineTokens(line.replace(/^>\s*/, ""), bq);
      container.appendChild(bq);
      continue;
    }

    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      const hr = document.createElement("hr");
      container.appendChild(hr);
      continue;
    }

    const p = document.createElement("p");
    appendInlineTokens(line, p);
    container.appendChild(p);
  }

  if (inCodeBlock && codeBuffer.length > 0) {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = codeBuffer.join("\n");
    pre.appendChild(code);
    container.appendChild(pre);
  }
}
