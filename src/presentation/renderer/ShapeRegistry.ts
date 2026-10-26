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
  getTrianglePerimeterIntersection,
} from "./ConnectorGeometry";
import {
  estimateMarkdownContentHeight,
  wrapTextToLines,
} from "../../domain/services/TextMeasurement";
import { applyFontToSvgElement, getNodeFontStyle, FontStyleConfig } from "../theme/Typography";

export interface AppendMultilineTextOptions {
  className?: string;
  textAnchor?: "middle" | "start" | "end";
  dominantBaseline?: string;
}

export function appendMultilineText(
  parentGroup: SVGElement,
  title: string,
  cx: number,
  cy: number,
  nodeFont: FontStyleConfig,
  svgNS = "http://www.w3.org/2000/svg",
  options?: AppendMultilineTextOptions
): SVGElement {
  const text = document.createElementNS(svgNS, "text") as SVGElement;
  text.setAttribute("x", String(cx));
  text.setAttribute("y", String(cy));
  const anchor = options?.textAnchor ?? "middle";
  text.setAttribute("text-anchor", anchor);
  text.setAttribute("class", options?.className ?? "umlcanvas-node-title");
  applyFontToSvgElement(text, nodeFont);

  const lines = (title ?? "").split(/\r?\n/);
  if (lines.length <= 1) {
    text.setAttribute("dominant-baseline", options?.dominantBaseline ?? "central");
    text.textContent = title ?? "";
  } else {
    text.setAttribute("dominant-baseline", options?.dominantBaseline ?? "central");
    const baseFontSize = nodeFont.fontSize ?? 13;
    const lineHeight = Math.round(baseFontSize * 1.35);
    const startY = cy - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((lineText, idx) => {
      const tspan = document.createElementNS(svgNS, "tspan");
      tspan.setAttribute("x", String(cx));
      tspan.setAttribute("y", String(startY + idx * lineHeight));
      tspan.setAttribute("dominant-baseline", options?.dominantBaseline ?? "central");
      tspan.setAttribute("text-anchor", anchor);
      tspan.textContent = lineText || " ";
      applyFontToSvgElement(tspan as SVGElement, nodeFont);
      text.appendChild(tspan);
    });
  }

  parentGroup.appendChild(text);
  return text;
}

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
    this.register(this.createGenericStickyNoteShape());
    this.register(this.createGenericImageShape());
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

    // Common Shapes (General-purpose)
    this.register(this.createGenericCircleShape());
    this.register(this.createGenericEllipseShape());
    this.register(this.createGenericTriangleShape());
    this.register(this.createDiamondShape("generic.diamond", "Diamond"));
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
          appendMultilineText(
            group,
            title,
            node.size.width / 2,
            node.size.height / 2,
            getNodeFontStyle(node),
            svgNS
          );
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

        const nodeFont = getNodeFontStyle(node);
        let currentY = 12;
        if (hasStereo) {
          const stereoText = document.createElementNS(svgNS, "text");
          stereoText.setAttribute("x", String(node.size.width / 2));
          stereoText.setAttribute("y", String(currentY));
          stereoText.setAttribute("dominant-baseline", "central");
          stereoText.setAttribute("text-anchor", "middle");
          stereoText.setAttribute("class", "umlcanvas-node-stereotype");
          stereoText.textContent = `«${effectiveStereo}»`;
          const stFontSize = nodeFont.fontSize ? Math.max(8, Math.round(nodeFont.fontSize * 0.77)) : undefined;
          applyFontToSvgElement(stereoText, {
            ...nodeFont,
            fontSize: stFontSize,
            italic: nodeFont.italic !== undefined ? nodeFont.italic : true,
          });
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
          const taggedFontSize = nodeFont.fontSize ? Math.max(8, Math.round(nodeFont.fontSize * 0.7)) : undefined;
          applyFontToSvgElement(taggedText, { ...nodeFont, fontSize: taggedFontSize });
          group.appendChild(taggedText);
          currentY += 12;
        }

        // Class Name
        const title = node.labels[0]?.text ?? "";
        const baseFontSize = nodeFont.fontSize ?? 13;
        const lineHeight = Math.round(baseFontSize * 1.35);
        const lines = title.split(/\r?\n/);
        const titleBlockHeight = Math.max(1, lines.length) * lineHeight;
        let actualHeaderHeight = hasStereo || hasTagged ? 46 : 32;
        if (lines.length > 1 || baseFontSize > 14) {
          actualHeaderHeight = Math.max(actualHeaderHeight, currentY + titleBlockHeight + 10);
        }
        const titleCenterY = lines.length > 1 ? currentY + (titleBlockHeight - lineHeight) / 2 : currentY;

        if (title) {
          appendMultilineText(
            group,
            title,
            node.size.width / 2,
            titleCenterY,
            nodeFont,
            svgNS,
            {
              className:
                node.stereotype === "interface" || node.stereotype === "abstract"
                  ? "umlcanvas-node-title umlcanvas-class-title umlcanvas-italic"
                  : "umlcanvas-node-title umlcanvas-class-title",
            }
          );
        }

        // Header divider line
        if (node.size.height > actualHeaderHeight) {
          const line = document.createElementNS(svgNS, "line");
          line.setAttribute("x1", "0");
          line.setAttribute("y1", String(actualHeaderHeight));
          line.setAttribute("x2", String(node.size.width));
          line.setAttribute("y2", String(actualHeaderHeight));
          line.setAttribute("class", "umlcanvas-compartment-divider");
          group.appendChild(line);
        }

        // Compartments rendering (F-032)
        if (node.compartments && node.compartments.length > 0) {
          let compY = actualHeaderHeight;
          const compFontSize = nodeFont.fontSize ? Math.max(9, Math.round(nodeFont.fontSize * 0.85)) : undefined;
          const compLineHeight = compFontSize ? Math.round(compFontSize * 1.5) : 18;

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
              compY += compLineHeight;
              if (compY > node.size.height) break;

              const itemText = document.createElementNS(svgNS, "text");
              itemText.setAttribute("x", "10");
              itemText.setAttribute("y", String(compY - 5));
              itemText.setAttribute("class", "umlcanvas-compartment-item");
              applyFontToSvgElement(itemText, { ...nodeFont, fontSize: compFontSize });

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
        const nodeFont = getNodeFontStyle(node);
        const baseFontSize = nodeFont.fontSize ?? 13;
        const lineHeight = Math.round(baseFontSize * 1.35);
        const lines = titleText.split(/\r?\n/);
        const titleBlockHeight = Math.max(1, lines.length) * lineHeight;
        const actualHeaderHeight = lines.length > 1 || baseFontSize > 14
          ? Math.max(32, headerY + titleBlockHeight + 6)
          : 32;
        const titleCenterY = lines.length > 1 ? headerY + (titleBlockHeight - lineHeight) / 2 : headerY;

        appendMultilineText(
          group,
          titleText,
          node.size.width / 2,
          titleCenterY,
          nodeFont,
          svgNS,
          {
            className: "umlcanvas-node-title umlcanvas-object-title",
          }
        );

        // Header divider
        const divLine = document.createElementNS(svgNS, "line");
        divLine.setAttribute("x1", "0");
        divLine.setAttribute("y1", String(actualHeaderHeight));
        divLine.setAttribute("x2", String(node.size.width));
        divLine.setAttribute("y2", String(actualHeaderHeight));
        divLine.setAttribute("class", "umlcanvas-compartment-divider");
        group.appendChild(divLine);

        // Slots / attributes
        let currentY = actualHeaderHeight;
        const compFontSize = nodeFont.fontSize ? Math.max(9, Math.round(nodeFont.fontSize * 0.85)) : undefined;
        const compLineHeight = compFontSize ? Math.round(compFontSize * 1.5) : 18;

        if (node.compartments && node.compartments.length > 0) {
          for (const comp of node.compartments) {
            for (const item of comp.items) {
              currentY += compLineHeight;
              if (currentY > node.size.height) break;

              const itemText = document.createElementNS(svgNS, "text");
              itemText.setAttribute("x", "10");
              itemText.setAttribute("y", String(currentY - 4));
              itemText.setAttribute("class", "umlcanvas-compartment-item");
              itemText.textContent = item.text;
              applyFontToSvgElement(itemText, { ...nodeFont, fontSize: compFontSize });
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
        appendMultilineText(
          group,
          label,
          cx,
          86,
          getNodeFontStyle(node),
          svgNS,
          {
            className: "umlcanvas-actor-label",
          }
        );

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
        appendMultilineText(
          group,
          title,
          rx,
          ry,
          getNodeFontStyle(node),
          svgNS,
          {
            className: "umlcanvas-node-title umlcanvas-usecase-title",
          }
        );

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
        appendMultilineText(
          group,
          title,
          14,
          22,
          getNodeFontStyle(node),
          svgNS,
          {
            className: "umlcanvas-system-boundary-title",
            textAnchor: "start",
          }
        );

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

        // ClipPath to guarantee note text never overflows paper boundaries
        const clipId = `umlcanvas-clip-note-${node.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        const defs = document.createElementNS(svgNS, "defs");
        const clipPath = document.createElementNS(svgNS, "clipPath");
        clipPath.setAttribute("id", clipId);
        const clipPathEl = document.createElementNS(svgNS, "path");
        clipPathEl.setAttribute(
          "d",
          `M 0 0 L ${w - fold} 0 L ${w} ${fold} L ${w} ${h} L 0 ${h} Z`
        );
        clipPath.appendChild(clipPathEl);
        defs.appendChild(clipPath);
        group.appendChild(defs);

        const textGroup = document.createElementNS(svgNS, "g");
        textGroup.setAttribute("clip-path", `url(#${clipId})`);

        const textContent = node.labels[0]?.text ?? "Note";
        const nodeFont = getNodeFontStyle(node);
        const fontSize = nodeFont.fontSize ?? 11;
        const lineSpacing = Math.round(fontSize * 1.38);
        const availableW = Math.max(40, w - 20);
        const charWidth = Math.max(5, fontSize * 0.58);
        const lines = wrapTextToLines(textContent, availableW, charWidth);
        let lineY = 14 + fontSize;
        const maxLineY = h - 6;

        for (let i = 0; i < lines.length; i++) {
          if (lineY > maxLineY) break;
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", "10");
          text.setAttribute("y", String(lineY));
          text.setAttribute("class", "umlcanvas-note-text");
          text.textContent = lines[i] || " ";
          applyFontToSvgElement(text, nodeFont);
          textGroup.appendChild(text);
          lineY += lineSpacing;
        }
        group.appendChild(textGroup);

        return group;
      },
    };
  }

  private createGenericStickyNoteShape(): ShapeDefinition {
    return {
      kind: "generic.stickyNote",
      displayName: "Sticky Note",
      defaultSize: { width: 180, height: 140 },
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
        group.setAttribute("class", "umlcanvas-shape-sticky");

        const w = node.size.width;
        const h = node.size.height;
        const stripH = 22;

        // 1. Sticky note paper body rect
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
            ? "umlcanvas-sticky-body umlcanvas-node-selected"
            : "umlcanvas-sticky-body"
        );
        if (node.style?.fillColor) {
          rect.setAttribute("fill", node.style.fillColor);
        }
        if (node.style?.strokeColor) {
          rect.setAttribute("stroke", node.style.strokeColor);
        }
        group.appendChild(rect);

        // 2. Adhesive strip along top edge
        const strip = document.createElementNS(svgNS, "path");
        strip.setAttribute(
          "d",
          `M 0 4 A 4 4 0 0 1 4 0 L ${w - 4} 0 A 4 4 0 0 1 ${w} 4 L ${w} ${stripH} L 0 ${stripH} Z`
        );
        strip.setAttribute("class", "umlcanvas-sticky-strip");
        group.appendChild(strip);

        // 3. Multiline text pad lines with ClipPath ensuring no overflow outside paper
        const clipId = `umlcanvas-clip-sticky-${node.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        const defs = document.createElementNS(svgNS, "defs");
        const clipPath = document.createElementNS(svgNS, "clipPath");
        clipPath.setAttribute("id", clipId);
        const clipRect = document.createElementNS(svgNS, "rect");
        clipRect.setAttribute("x", "0");
        clipRect.setAttribute("y", "0");
        clipRect.setAttribute("width", String(w));
        clipRect.setAttribute("height", String(h));
        clipRect.setAttribute("rx", "4");
        clipRect.setAttribute("ry", "4");
        clipPath.appendChild(clipRect);
        defs.appendChild(clipPath);
        group.appendChild(defs);

        const textGroup = document.createElementNS(svgNS, "g");
        textGroup.setAttribute("clip-path", `url(#${clipId})`);

        const nodeFont = getNodeFontStyle(node);
        const fontSize = nodeFont.fontSize ?? 13;
        const lineSpacing = Math.round(fontSize * 1.38);
        const textContent = node.labels[0]?.text ?? "";

        if (!textContent) {
          const placeholder = document.createElementNS(svgNS, "text");
          placeholder.setAttribute("x", "12");
          placeholder.setAttribute("y", String(28 + fontSize));
          placeholder.setAttribute("class", "umlcanvas-sticky-placeholder");
          placeholder.textContent = "Type a note...";
          applyFontToSvgElement(placeholder, nodeFont);
          textGroup.appendChild(placeholder);
        } else {
          const availableW = Math.max(40, w - 24);
          const boldMultiplier = nodeFont.bold ? 1.1 : 1.0;
          const charWidth = Math.max(5, fontSize * 0.58 * boldMultiplier);
          const lines = wrapTextToLines(textContent, availableW, charWidth);
          let lineY = 26 + fontSize;
          const maxLineY = h - 6;

          for (let i = 0; i < lines.length; i++) {
            if (lineY > maxLineY) break;
            const textEl = document.createElementNS(svgNS, "text");
            textEl.setAttribute("x", "12");
            textEl.setAttribute("y", String(lineY));
            textEl.setAttribute("class", "umlcanvas-sticky-text");
            textEl.textContent = lines[i] || " ";
            applyFontToSvgElement(textEl, nodeFont);
            textGroup.appendChild(textEl);
            lineY += lineSpacing;
          }
        }
        group.appendChild(textGroup);

        return group;
      },
    };
  }

  private createGenericImageShape(): ShapeDefinition {
    return {
      kind: "generic.image",
      displayName: "Photo Frame Image",
      defaultSize: { width: 220, height: 260 },
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
        group.setAttribute("class", "umlcanvas-shape-image");

        const w = node.size.width;
        const h = node.size.height;
        const pad = 10;
        const titleAreaH = 38;
        const imgW = Math.max(20, w - pad * 2);
        const imgH = Math.max(20, h - pad * 2 - titleAreaH);

        // 1. Photo frame outer card / box (Polaroid / photo-frame style)
        const frameRect = document.createElementNS(svgNS, "rect");
        frameRect.setAttribute("x", "0");
        frameRect.setAttribute("y", "0");
        frameRect.setAttribute("width", String(w));
        frameRect.setAttribute("height", String(h));
        frameRect.setAttribute("rx", "6");
        frameRect.setAttribute("ry", "6");
        frameRect.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-photo-frame-body umlcanvas-node-selected"
            : "umlcanvas-photo-frame-body"
        );
        if (node.style?.fillColor) {
          frameRect.setAttribute("fill", node.style.fillColor);
        }
        if (node.style?.strokeColor) {
          frameRect.setAttribute("stroke", node.style.strokeColor);
        }
        group.appendChild(frameRect);

        // 2. Photo viewport / mat / inner border
        const photoMat = document.createElementNS(svgNS, "rect");
        photoMat.setAttribute("x", String(pad));
        photoMat.setAttribute("y", String(pad));
        photoMat.setAttribute("width", String(imgW));
        photoMat.setAttribute("height", String(imgH));
        photoMat.setAttribute("rx", "3");
        photoMat.setAttribute("ry", "3");
        photoMat.setAttribute("class", "umlcanvas-photo-mat");
        group.appendChild(photoMat);

        // 3. Image element (if src or filePath is available)
        const src =
          (node.customData?.src as string) ||
          (node.metadata?.src as string) ||
          (node.customData?.filePath as string) ||
          (node.metadata?.filePath as string) ||
          "";

        if (src) {
          const img = document.createElementNS(svgNS, "image");
          img.setAttribute("x", String(pad));
          img.setAttribute("y", String(pad));
          img.setAttribute("width", String(imgW));
          img.setAttribute("height", String(imgH));
          img.setAttribute("preserveAspectRatio", "xMidYMid slice");
          img.setAttributeNS("http://www.w3.org/1999/xlink", "href", src);
          img.setAttribute("href", src);
          img.setAttribute("class", "umlcanvas-photo-img");
          group.appendChild(img);
        } else {
          // Placeholder icon when no image src is present yet
          const placeholderGroup = document.createElementNS(svgNS, "g");
          placeholderGroup.setAttribute("class", "umlcanvas-photo-placeholder");

          const cx = pad + imgW / 2;
          const cy = pad + imgH / 2;
          const iconPath = document.createElementNS(svgNS, "path");
          iconPath.setAttribute(
            "d",
            `M ${cx - 16} ${cy - 12} h 32 a 3 3 0 0 1 3 3 v 24 a 3 3 0 0 1 -3 3 h -32 a 3 3 0 0 1 -3 -3 v -24 a 3 3 0 0 1 3 -3 z`
          );
          iconPath.setAttribute("fill", "none");
          iconPath.setAttribute("stroke", "currentColor");
          iconPath.setAttribute("stroke-width", "1.5");
          placeholderGroup.appendChild(iconPath);

          const circle = document.createElementNS(svgNS, "circle");
          circle.setAttribute("cx", String(cx - 6));
          circle.setAttribute("cy", String(cy - 2));
          circle.setAttribute("r", "2.5");
          circle.setAttribute("fill", "currentColor");
          placeholderGroup.appendChild(circle);

          const hill = document.createElementNS(svgNS, "path");
          hill.setAttribute(
            "d",
            `M ${cx - 13} ${cy + 15} l 8 -8 l 6 6 l 7 -7 l 11 9`
          );
          hill.setAttribute("fill", "none");
          hill.setAttribute("stroke", "currentColor");
          hill.setAttribute("stroke-width", "1.5");
          placeholderGroup.appendChild(hill);

          const hint = document.createElementNS(svgNS, "text");
          hint.setAttribute("x", String(cx));
          hint.setAttribute("y", String(cy + 24));
          hint.setAttribute("text-anchor", "middle");
          hint.setAttribute("class", "umlcanvas-photo-placeholder-text");
          hint.textContent = "Drop or click image";
          placeholderGroup.appendChild(hint);

          group.appendChild(placeholderGroup);
        }

        // 4. Title inside the frame (Polaroid / photo-frame caption style)
        const title = node.labels[0]?.text ?? "";
        const titleY = h - titleAreaH / 2 + 5;
        appendMultilineText(
          group,
          title || "Add title...",
          w / 2,
          titleY,
          getNodeFontStyle(node),
          svgNS,
          {
            className:
              "umlcanvas-node-title umlcanvas-photo-frame-title" +
              (!title ? " umlcanvas-placeholder-text" : ""),
          }
        );

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
        const bodyH = Math.max(10, h - headerH);

        const scaleInfo = calculateNoteContentScale(node, w, h);
        const scale = scaleInfo.effectiveScale;

        group.setAttribute("data-scale", String(scale));
        group.setAttribute("data-scale-mode", scaleInfo.scaleMode);

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
        const rightMargin = w >= 260 ? 135 : (w >= 180 ? 95 : 30);
        const maxChars = Math.max(8, Math.floor((w - rightMargin) / 7.5));
        titleText.textContent = title.length > maxChars ? `${title.slice(0, maxChars - 2)}…` : title;
        titleText.setAttribute("title", rawTitle);
        applyFontToSvgElement(titleText, getNodeFontStyle(node));
        group.appendChild(titleText);

        // 6a. Clickable Open Icon in Header (↗)
        const openIcon = document.createElementNS(svgNS, "text");
        openIcon.setAttribute("x", String(w - 20));
        openIcon.setAttribute("y", "21");
        openIcon.setAttribute("class", "umlcanvas-obsidian-note-open-btn");
        const noteFilePath =
          (node.metadata?.filePath as string) || (node.customData?.filePath as string) || "";
        openIcon.setAttribute("data-file-path", noteFilePath);
        openIcon.textContent = "↗";
        openIcon.setAttribute("title", "Open note in Obsidian");
        group.appendChild(openIcon);

        // 6b-6e. Scalability controls in Header (for quick scale / fit manipulation)
        if (w >= 180) {
          // Fit Toggle Button
          const fitBtn = document.createElementNS(svgNS, "text");
          fitBtn.setAttribute("x", String(w - 46));
          fitBtn.setAttribute("y", "21");
          fitBtn.setAttribute(
            "class",
            scaleInfo.scaleMode === "fit"
              ? "umlcanvas-obsidian-note-scale-btn is-active"
              : "umlcanvas-obsidian-note-scale-btn"
          );
          fitBtn.setAttribute("data-action", "toggle-fit");
          fitBtn.setAttribute(
            "title",
            scaleInfo.scaleMode === "fit" ? "Fit mode active (click for 100%)" : "Scale to fit card"
          );
          fitBtn.textContent = "Fit";
          group.appendChild(fitBtn);

          // Zoom In (+)
          const zoomInBtn = document.createElementNS(svgNS, "text");
          zoomInBtn.setAttribute("x", String(w - 68));
          zoomInBtn.setAttribute("y", "21");
          zoomInBtn.setAttribute("class", "umlcanvas-obsidian-note-zoom-in-btn");
          zoomInBtn.setAttribute("title", "Zoom in note content");
          zoomInBtn.textContent = "+";
          group.appendChild(zoomInBtn);

          // Zoom Out (−)
          const zoomOutBtn = document.createElementNS(svgNS, "text");
          zoomOutBtn.setAttribute("x", String(w - 86));
          zoomOutBtn.setAttribute("y", "21");
          zoomOutBtn.setAttribute("class", "umlcanvas-obsidian-note-zoom-out-btn");
          zoomOutBtn.setAttribute("title", "Zoom out note content");
          zoomOutBtn.textContent = "−";
          group.appendChild(zoomOutBtn);

          if (w >= 260) {
            // Scale Badge / Indicator
            const scaleBadge = document.createElementNS(svgNS, "text");
            scaleBadge.setAttribute("x", String(w - 126));
            scaleBadge.setAttribute("y", "21");
            scaleBadge.setAttribute("class", "umlcanvas-obsidian-note-scale-badge");
            scaleBadge.setAttribute("title", "Current scale (click to toggle Fit / 100%)");
            scaleBadge.textContent = `${Math.round(scale * 100)}%`;
            group.appendChild(scaleBadge);
          }
        }

        // 7. Rich HTML Markdown Body via foreignObject (for browser / Obsidian interactive view)
        const foreign = document.createElementNS(svgNS, "foreignObject");
        foreign.setAttribute("x", "0");
        foreign.setAttribute("y", String(headerH));
        foreign.setAttribute("width", String(w));
        foreign.setAttribute("height", String(bodyH));
        foreign.setAttribute("class", "umlcanvas-obsidian-note-foreign");

        const containerDiv = safeCreateDiv({
          cls: "umlcanvas-obsidian-note-container",
        });

        const scalerDiv = safeCreateDiv({
          cls: "umlcanvas-obsidian-note-scale-wrapper",
        });
        const scalerWidthPct = Math.round((100 / scale) * 100) / 100;
        const scalerMinHeightPx = Math.round((bodyH / scale) * 100) / 100;
        scalerDiv.style.transform = `scale(${scale})`;
        scalerDiv.style.width = `${scalerWidthPct}%`;
        scalerDiv.style.minHeight = `${scalerMinHeightPx}px`;

        const bodyDiv = safeCreateDiv({
          cls: "umlcanvas-obsidian-note-body markdown-rendered markdown-preview-view umlcanvas-scrollable",
        });

        const fullMarkdown =
          (node.customData?.content as string) ||
          (node.customData?.snippet as string) ||
          "";
        if (fullMarkdown) {
          renderMarkdownFallback(fullMarkdown, bodyDiv);
        } else {
          const placeholder = safeCreateDiv({
            cls: "umlcanvas-obsidian-note-body-placeholder",
            text: "Vault Note (connect to diagram)",
          });
          bodyDiv.appendChild(placeholder);
        }

        scalerDiv.appendChild(bodyDiv);
        containerDiv.appendChild(scalerDiv);
        foreign.appendChild(containerDiv);
        group.appendChild(foreign);

        // 8. SVG Fallback elements (for headless Jest tests and SVG-only exporters)
        const fallbackGroup = document.createElementNS(svgNS, "g");
        fallbackGroup.setAttribute("class", "umlcanvas-obsidian-note-svg-fallback");
        fallbackGroup.setAttribute("data-scale", String(scale));
        fallbackGroup.setAttribute("data-scale-mode", scaleInfo.scaleMode);

        const fullText =
          (node.customData?.content as string) ||
          (node.customData?.snippet as string) ||
          "";
        if (fullText) {
          const clean = fullText.replace(/^---[\s\S]*?---\r?\n?/, "").trim();
          const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
          const scaledLineSpacing = Math.max(10, Math.round(18 * scale));
          const scaledFontSize = Math.max(8, Math.round(12 * scale));

          for (let i = 0; i < lines.length; i++) {
            const lineY = headerH + 16 + i * scaledLineSpacing;
            if (lineY > h - 8 && scaleInfo.scaleMode !== "fit") break;
            const lineText = document.createElementNS(svgNS, "text");
            lineText.setAttribute("x", "12");
            lineText.setAttribute("y", String(lineY));
            lineText.setAttribute("font-size", String(scaledFontSize));
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
        appendMultilineText(
          group,
          title,
          node.size.width / 2,
          node.size.height / 2,
          getNodeFontStyle(node),
          svgNS,
          {
            className: "umlcanvas-node-title",
          }
        );

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
          appendMultilineText(
            group,
            title,
            w / 2,
            h / 2,
            getNodeFontStyle(node),
            svgNS
          );
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
        appendMultilineText(
          group,
          title,
          node.size.width / 2,
          20,
          getNodeFontStyle(node),
          svgNS,
          {
            className: "umlcanvas-group-title",
          }
        );

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
        const nodeFont = getNodeFontStyle(node);
        const baseFontSize = nodeFont.fontSize ?? 13;
        const lineHeight = Math.round(baseFontSize * 1.35);
        const lines = title.split(/\r?\n/);
        const titleBlockHeight = Math.max(1, lines.length) * lineHeight;
        const actualHeaderHeight = lines.length > 1 || baseFontSize > 14
          ? Math.max(32, 20 + titleBlockHeight + 6)
          : 32;
        const titleCenterY = lines.length > 1 ? 20 + (titleBlockHeight - lineHeight) / 2 : 20;

        appendMultilineText(
          group,
          title,
          node.size.width / 2,
          titleCenterY,
          nodeFont,
          svgNS,
          {
            className: "umlcanvas-node-title",
          }
        );

        let currentY = actualHeaderHeight;
        if (node.compartments && node.compartments.length > 0) {
          const compFontSize = nodeFont.fontSize ? Math.max(9, Math.round(nodeFont.fontSize * 0.85)) : undefined;
          const compLineHeight = compFontSize ? Math.round(compFontSize * 1.5) : 16;

          const line = document.createElementNS(svgNS, "line");
          line.setAttribute("x1", "0");
          line.setAttribute("y1", String(currentY));
          line.setAttribute("x2", String(node.size.width));
          line.setAttribute("y2", String(currentY));
          line.setAttribute("class", "umlcanvas-compartment-divider");
          group.appendChild(line);

          for (const comp of node.compartments) {
            for (const item of comp.items) {
              currentY += compLineHeight;
              const itemText = document.createElementNS(svgNS, "text");
              itemText.setAttribute("x", "12");
              itemText.setAttribute("y", String(currentY));
              itemText.setAttribute("class", "umlcanvas-compartment-item");
              itemText.textContent = item.visibility
                ? `${item.visibility} ${item.text}`
                : item.text;
              applyFontToSvgElement(itemText, { ...nodeFont, fontSize: compFontSize });
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
        appendMultilineText(
          group,
          title,
          14,
          22,
          getNodeFontStyle(node),
          svgNS,
          {
            className: "umlcanvas-node-title",
            textAnchor: "start",
          }
        );

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
            ? node.metadata.lifelineLength
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
        appendMultilineText(
          group,
          title,
          cx,
          headerH / 2 + 4,
          getNodeFontStyle(node),
          svgNS,
          {
            className: "umlcanvas-node-title",
          }
        );

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
        const nodeFont = getNodeFontStyle(node);
        const stText = document.createElementNS(svgNS, "text");
        stText.setAttribute("x", String(w / 2));
        stText.setAttribute("y", "26");
        stText.setAttribute("text-anchor", "middle");
        stText.setAttribute("class", "umlcanvas-node-stereotype");
        stText.textContent = `«${node.stereotype || "component"}»`;
        const stFontSize = nodeFont.fontSize ? Math.max(8, Math.round(nodeFont.fontSize * 0.77)) : undefined;
        applyFontToSvgElement(stText, {
          ...nodeFont,
          fontSize: stFontSize,
          italic: nodeFont.italic !== undefined ? nodeFont.italic : true,
        });
        group.appendChild(stText);

        // Title
        const title = node.labels[0]?.text ?? "Component";
        appendMultilineText(
          group,
          title,
          w / 2,
          48,
          nodeFont,
          svgNS,
          {
            className: "umlcanvas-node-title",
          }
        );

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
          appendMultilineText(
            group,
            title,
            cx,
            node.size.height + 14,
            getNodeFontStyle(node),
            svgNS,
            {
              className: "umlcanvas-node-title",
            }
          );
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
          appendMultilineText(
            group,
            title,
            cx,
            node.size.height + 14,
            getNodeFontStyle(node),
            svgNS,
            {
              className: "umlcanvas-node-title",
            }
          );
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
          appendMultilineText(
            group,
            title,
            node.size.width / 2,
            node.size.height + 12,
            getNodeFontStyle(node),
            svgNS,
            {
              className: "umlcanvas-port-label",
            }
          );
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
        const nodeFont = getNodeFontStyle(node);
        const st = node.stereotype || defStereotype;
        const stText = document.createElementNS(svgNS, "text");
        stText.setAttribute("x", String((w - d) / 2));
        stText.setAttribute("y", String(d + 20));
        stText.setAttribute("text-anchor", "middle");
        stText.setAttribute("class", "umlcanvas-node-stereotype");
        stText.textContent = `«${st}»`;
        const stFontSize = nodeFont.fontSize ? Math.max(8, Math.round(nodeFont.fontSize * 0.77)) : undefined;
        applyFontToSvgElement(stText, {
          ...nodeFont,
          fontSize: stFontSize,
          italic: nodeFont.italic !== undefined ? nodeFont.italic : true,
        });
        group.appendChild(stText);

        // Title
        const title = node.labels[0]?.text ?? "Node";
        appendMultilineText(
          group,
          title,
          (w - d) / 2,
          d + 42,
          nodeFont,
          svgNS,
          {
            className: "umlcanvas-node-title",
          }
        );

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
        const nodeFont = getNodeFontStyle(node);
        const stText = document.createElementNS(svgNS, "text");
        stText.setAttribute("x", String(w / 2));
        stText.setAttribute("y", "24");
        stText.setAttribute("text-anchor", "middle");
        stText.setAttribute("class", "umlcanvas-node-stereotype");
        stText.textContent = `«${node.stereotype || "artifact"}»`;
        const stFontSize = nodeFont.fontSize ? Math.max(8, Math.round(nodeFont.fontSize * 0.77)) : undefined;
        applyFontToSvgElement(stText, {
          ...nodeFont,
          fontSize: stFontSize,
          italic: nodeFont.italic !== undefined ? nodeFont.italic : true,
        });
        group.appendChild(stText);

        // Title
        const title = node.labels[0]?.text ?? "Artifact";
        appendMultilineText(
          group,
          title,
          w / 2,
          46,
          nodeFont,
          svgNS,
          {
            className: "umlcanvas-node-title",
          }
        );

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
        appendMultilineText(
          group,
          node.labels[0]?.text ?? "Classifier",
          headerW / 2,
          h / 2 + 4,
          getNodeFontStyle(node),
          svgNS,
          {
            className: "umlcanvas-node-title",
          }
        );

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
        appendMultilineText(
          group,
          title,
          w / 2,
          h / 2 + 4,
          getNodeFontStyle(node),
          svgNS,
          {
            className: "umlcanvas-timing-segment-text",
          }
        );

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
        const nodeFont = getNodeFontStyle(node);
        appendMultilineText(
          group,
          title,
          w / 2,
          h / 2 + 4,
          nodeFont,
          svgNS,
          {
            className: "umlcanvas-chip-title",
          }
        );

        const pinFontSize = nodeFont.fontSize ? Math.max(7, Math.round(nodeFont.fontSize * 0.7)) : undefined;

        // Render port pin stubs and pin labels
        for (const port of node.ports) {
          const pinLine = document.createElementNS(svgNS, "line");
          const pinText = document.createElementNS(svgNS, "text");
          pinText.setAttribute("class", "umlcanvas-chip-port-label");
          applyFontToSvgElement(pinText, { ...nodeFont, fontSize: pinFontSize });

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
          appendMultilineText(
            group,
            title,
            w / 2,
            tabH + 24,
            getNodeFontStyle(node),
            svgNS,
            {
              className: "umlcanvas-node-title",
            }
          );
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
          appendMultilineText(
            group,
            title,
            node.size.width / 2,
            22,
            getNodeFontStyle(node),
            svgNS,
            {
              className: "umlcanvas-node-title",
            }
          );
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
          appendMultilineText(
            group,
            title,
            node.size.width / 2,
            node.size.height / 2 + 5,
            getNodeFontStyle(node),
            svgNS,
            {
              className: "umlcanvas-node-title",
            }
          );
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

        const nodeFont = getNodeFontStyle(node);
        const tabText = document.createElementNS(svgNS, "text");
        tabText.setAttribute("x", String(tabW / 2));
        tabText.setAttribute("y", "15");
        tabText.setAttribute("text-anchor", "middle");
        tabText.setAttribute("class", "umlcanvas-interaction-tab-text");
        tabText.textContent = "sd";
        const tabFontSize = nodeFont.fontSize ? Math.max(8, Math.round(nodeFont.fontSize * 0.77)) : undefined;
        applyFontToSvgElement(tabText, { ...nodeFont, fontSize: tabFontSize });
        group.appendChild(tabText);

        const title = node.labels[0]?.text;
        if (title) {
          appendMultilineText(
            group,
            title,
            tabW + 16,
            16,
            nodeFont,
            svgNS,
            {
              className: "umlcanvas-node-title",
              textAnchor: "start",
            }
          );
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

        const nodeFont = getNodeFontStyle(node);
        const refText = document.createElementNS(svgNS, "text");
        refText.setAttribute("x", "8");
        refText.setAttribute("y", "18");
        refText.setAttribute("class", "umlcanvas-node-st");
        refText.textContent = "ref";
        const refFontSize = nodeFont.fontSize ? Math.max(8, Math.round(nodeFont.fontSize * 0.77)) : undefined;
        applyFontToSvgElement(refText, { ...nodeFont, fontSize: refFontSize });
        group.appendChild(refText);

        const title = node.labels[0]?.text;
        if (title) {
          appendMultilineText(
            group,
            title,
            node.size.width / 2,
            node.size.height / 2 + 5,
            nodeFont,
            svgNS,
            {
              className: "umlcanvas-node-title",
            }
          );
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
        appendMultilineText(
          group,
          title,
          cx,
          10,
          getNodeFontStyle(node),
          svgNS,
          {
            className: "umlcanvas-schematic-label",
          }
        );

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
        return [];
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

        // Generous stroke hitbox along the path for easy selecting and moving without blocking empty canvas inside bounding box
        const hitbox = document.createElementNS(svgNS, "path");
        hitbox.setAttribute("d", pathData);
        hitbox.setAttribute("fill", "none");
        hitbox.setAttribute("stroke", "transparent");
        hitbox.setAttribute("stroke-width", "16");
        hitbox.setAttribute("stroke-linecap", "round");
        hitbox.setAttribute("stroke-linejoin", "round");
        hitbox.setAttribute("class", "umlcanvas-freehand-hitbox");
        group.appendChild(hitbox);

        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", pathData);
        path.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-freehand-path umlcanvas-node-selected"
            : "umlcanvas-freehand-path"
        );
        path.setAttribute("fill", "none");
        const strokeColor = node.style?.strokeColor || node.style?.color || "currentColor";
        path.setAttribute("stroke", strokeColor);
        path.setAttribute("stroke-width", String(node.style?.strokeWidth || 2));
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        group.appendChild(path);

        return group;
      },
    };
  }

  private createGenericCircleShape(): ShapeDefinition {
    return {
      kind: "generic.circle",
      displayName: "Circle",
      defaultSize: { width: 80, height: 80 },
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
        group.setAttribute("class", "umlcanvas-shape-circle");

        const cx = node.size.width / 2;
        const cy = node.size.height / 2;
        const r = Math.min(node.size.width, node.size.height) / 2;

        const circle = document.createElementNS(svgNS, "circle");
        circle.setAttribute("cx", String(cx));
        circle.setAttribute("cy", String(cy));
        circle.setAttribute("r", String(r));
        circle.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-circle-body umlcanvas-node-selected"
            : "umlcanvas-node-body umlcanvas-circle-body"
        );
        if (node.style?.fillColor) circle.setAttribute("fill", node.style.fillColor);
        if (node.style?.strokeColor) circle.setAttribute("stroke", node.style.strokeColor);
        if (node.style?.strokeWidth) circle.setAttribute("stroke-width", String(node.style.strokeWidth));
        group.appendChild(circle);

        const title = node.labels[0]?.text ?? "";
        if (title) {
          appendMultilineText(
            group,
            title,
            cx,
            cy,
            getNodeFontStyle(node),
            svgNS
          );
        }

        return group;
      },
    };
  }

  private createGenericEllipseShape(): ShapeDefinition {
    return {
      kind: "generic.ellipse",
      displayName: "Ellipse",
      defaultSize: { width: 120, height: 70 },
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
        group.setAttribute("class", "umlcanvas-shape-ellipse");

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
            ? "umlcanvas-node-body umlcanvas-ellipse-body umlcanvas-node-selected"
            : "umlcanvas-node-body umlcanvas-ellipse-body"
        );
        if (node.style?.fillColor) ellipse.setAttribute("fill", node.style.fillColor);
        if (node.style?.strokeColor) ellipse.setAttribute("stroke", node.style.strokeColor);
        if (node.style?.strokeWidth) ellipse.setAttribute("stroke-width", String(node.style.strokeWidth));
        group.appendChild(ellipse);

        const title = node.labels[0]?.text ?? "";
        if (title) {
          appendMultilineText(
            group,
            title,
            rx,
            ry,
            getNodeFontStyle(node),
            svgNS
          );
        }

        return group;
      },
    };
  }

  private createGenericTriangleShape(): ShapeDefinition {
    return {
      kind: "generic.triangle",
      displayName: "Triangle",
      defaultSize: { width: 90, height: 80 },
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
        return getTrianglePerimeterIntersection(
          { position: node.position, size: node.size },
          targetPoint
        );
      },
      renderSvg(node: DiagramNode, context: RenderContext): SVGElement {
        const svgNS = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "umlcanvas-shape-triangle");

        const w = node.size.width;
        const h = node.size.height;
        const points = `${w / 2},0 ${w},${h} 0,${h}`;

        const poly = document.createElementNS(svgNS, "polygon");
        poly.setAttribute("points", points);
        poly.setAttribute(
          "class",
          context.isSelected
            ? "umlcanvas-node-body umlcanvas-triangle-body umlcanvas-node-selected"
            : "umlcanvas-node-body umlcanvas-triangle-body"
        );
        if (node.style?.fillColor) poly.setAttribute("fill", node.style.fillColor);
        if (node.style?.strokeColor) poly.setAttribute("stroke", node.style.strokeColor);
        if (node.style?.strokeWidth) poly.setAttribute("stroke-width", String(node.style.strokeWidth));
        group.appendChild(poly);

        const title = node.labels[0]?.text ?? "";
        if (title) {
          appendMultilineText(
            group,
            title,
            w / 2,
            (h * 2) / 3,
            getNodeFontStyle(node),
            svgNS
          );
        }

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
      parent.createSpan({ text: text.substring(lastIndex, match.index) });
    }

    if (match[1]) {
      const inner = match[2];
      const parts = inner.split("|");
      const target = parts[0];
      const alias = parts[1] || target;
      parent.createEl("a", {
        cls: "internal-link",
        attr: { "data-href": target },
        text: alias,
      });
    } else if (match[3]) {
      const linkText = match[4];
      const url = match[5];
      parent.createEl("a", {
        cls: "external-link",
        attr: { href: url },
        text: linkText,
      });
    } else if (match[6]) {
      parent.createEl("code", { text: match[7] });
    } else if (match[8]) {
      parent.createEl("strong", { text: match[8] });
    } else if (match[9]) {
      parent.createEl("em", { text: match[9] });
    }

    lastIndex = pattern.lastIndex;
  }

  if (!matchedAny) {
    parent.textContent = text;
  } else if (lastIndex < text.length) {
    parent.createSpan({ text: text.substring(lastIndex) });
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
        const pre = container.createEl("pre");
        pre.createEl("code", { text: codeBuffer.join("\n") });
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
        currentList = container.createEl("ul");
      }
      const li = currentList.createEl("li");
      const taskMatch = listMatch[2].match(/^\[([ xX])\]\s+(.*)$/);
      if (taskMatch) {
        li.className = "task-list-item" + (taskMatch[1].toLowerCase() === "x" ? " is-checked" : "");
        const checkbox = li.createEl("input", {
          type: "checkbox",
          attr: { disabled: "true" },
        });
        if (taskMatch[1].toLowerCase() === "x") {
          checkbox.checked = true;
        }
        appendInlineTokens(taskMatch[2], li);
      } else {
        appendInlineTokens(listMatch[2], li);
      }
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
      const h = container.createEl(`h${level}` as keyof HTMLElementTagNameMap, {
        cls: `umlcanvas-note-h${level}`,
      });
      appendInlineTokens(headingMatch[2], h);
      continue;
    }

    if (line.startsWith(">")) {
      const bq = container.createEl("blockquote");
      appendInlineTokens(line.replace(/^>\s*/, ""), bq);
      continue;
    }

    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      container.createEl("hr");
      continue;
    }

    const p = container.createEl("p");
    appendInlineTokens(line, p);
  }

  if (inCodeBlock && codeBuffer.length > 0) {
    const pre = container.createEl("pre");
    pre.createEl("code", { text: codeBuffer.join("\n") });
  }
}

export interface NoteScaleInfo {
  scale: number;
  scaleMode: "fit" | "custom" | "none";
  effectiveScale: number;
  isScaled: boolean;
  contentHeight: number;
}

export function calculateNoteContentScale(
  node: DiagramNode,
  width: number,
  height: number
): NoteScaleInfo {
  const headerH = 32;
  const availableBodyH = Math.max(10, height - headerH);
  const customMode = (node.customData?.scaleMode as "fit" | "custom" | "none") ?? "fit";
  const explicitScale =
    typeof node.customData?.scale === "number" ? node.customData.scale : undefined;

  const content =
    (node.customData?.content as string) ||
    (node.customData?.snippet as string) ||
    "";
  const contentHeight =
    typeof node.customData?.contentHeight === "number" && node.customData.contentHeight > 0
      ? node.customData.contentHeight
      : estimateMarkdownContentHeight(content, width);

  let effectiveScale = 1.0;
  if (customMode === "custom" && explicitScale !== undefined) {
    effectiveScale = Math.max(0.15, Math.min(3.0, explicitScale));
  } else if (customMode === "fit") {
    if (contentHeight > availableBodyH) {
      effectiveScale = Math.max(0.15, Math.min(1.0, availableBodyH / contentHeight));
    } else {
      effectiveScale = 1.0;
    }
  } else {
    effectiveScale = 1.0;
  }

  effectiveScale = Math.round(effectiveScale * 100) / 100;
  const isScaled = Math.abs(effectiveScale - 1.0) > 0.02;

  return {
    scale: effectiveScale,
    scaleMode: customMode,
    effectiveScale,
    isScaled,
    contentHeight,
  };
}

function safeCreateDiv(options?: { cls?: string; text?: string; attr?: Record<string, string | number | boolean> }): HTMLDivElement {
  if (typeof createDiv === "function") {
    return createDiv(options);
  }
  if (typeof document !== "undefined") {
    const div = document.createElementNS("http://www.w3.org/1999/xhtml", "div") as unknown as HTMLDivElement;
    if (options?.cls) {
      div.className = options.cls;
      if (div.classList && typeof div.classList.add === "function") {
        div.classList.add(...options.cls.split(" ").filter(Boolean));
      }
    }
    if (options?.text) div.textContent = options.text;
    if (options?.attr) {
      for (const [k, v] of Object.entries(options.attr)) {
        div.setAttribute(k, String(v));
      }
    }
    return div;
  }
  return {
    className: options?.cls || "",
    textContent: options?.text || "",
    style: {} as CSSStyleDeclaration,
    appendChild: (child: Node) => child,
    createDiv: (childOpts?: unknown) => safeCreateDiv(childOpts as { cls?: string; text?: string }),
    createEl: () => ({} as HTMLElement),
  } as unknown as HTMLDivElement;
}
