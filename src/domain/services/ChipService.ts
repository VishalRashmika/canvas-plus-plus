import { Diagram } from "../entities/Diagram";
import { DiagramNode, createDiagramNode } from "../entities/DiagramNode";
import { Port, createPort } from "../entities/Port";
import {
  ChipInterfaceDefinition,
  createChipInterfaceDefinition,
  isBreakingChange,
} from "../entities/ChipInterfaceDefinition";
import { Point } from "../value-objects/Point";
import { Size } from "../value-objects/Rect";
import { Id, PortDirection, Side } from "../types";
import { ValidationIssue } from "../entities/DiagramTypeDefinition";

export interface PortSpec {
  id?: string;
  name: string;
  direction: PortDirection;
  side?: Side;
  offset?: number;
  dataType?: string;
}

export interface CreateChipInstanceOptions {
  id?: Id;
  size?: Size;
  childDiagramId?: Id;
  metadata?: Record<string, unknown>;
}

export interface PropagationResult {
  updatedNodes: string[];
  brokenEdges: string[];
}

export class ChipService {
  /**
   * Defines a new ChipInterfaceDefinition (F-060).
   */
  createChipInterface(
    id: Id,
    name: string,
    ports: PortSpec[] = []
  ): ChipInterfaceDefinition {
    const defaultPorts = this.distributePortSpecs(ports, id);
    return createChipInterfaceDefinition({
      id,
      name,
      ports: defaultPorts,
    });
  }

  /**
   * Helper to distribute port specifications along the node boundaries.
   * "in" ports are placed on the left side,
   * "out" ports on the right side,
   * "inout" or other ports on the bottom/top.
   */
  distributePortSpecs(portSpecs: PortSpec[], ownerId: string): Port[] {
    const leftSpecs = portSpecs.filter(
      (p) => p.side === "left" || (!p.side && p.direction === "in")
    );
    const rightSpecs = portSpecs.filter(
      (p) => p.side === "right" || (!p.side && p.direction === "out")
    );
    const topSpecs = portSpecs.filter((p) => p.side === "top");
    const bottomSpecs = portSpecs.filter(
      (p) =>
        p.side === "bottom" ||
        (!p.side && p.direction !== "in" && p.direction !== "out")
    );

    const result: Port[] = [];
    const usedIds = new Set<string>();

    const makeUniqueId = (spec: PortSpec, idx: number): string => {
      if (spec.id && !usedIds.has(spec.id)) {
        usedIds.add(spec.id);
        return spec.id;
      }
      const base = spec.name
        ? spec.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")
        : `pin-${idx}`;
      let candidate = `${ownerId}-port-${base}`;
      let counter = 1;
      while (usedIds.has(candidate)) {
        candidate = `${ownerId}-port-${base}-${counter++}`;
      }
      usedIds.add(candidate);
      return candidate;
    };

    // Left
    leftSpecs.forEach((spec, i) => {
      const offset = (i + 1) / (leftSpecs.length + 1);
      result.push(
        createPort({
          id: makeUniqueId(spec, i),
          ownerNodeId: ownerId,
          name: spec.name,
          side: "left",
          offset: spec.offset !== undefined ? spec.offset : offset,
          direction: spec.direction,
          dataType: spec.dataType,
        })
      );
    });

    // Right
    rightSpecs.forEach((spec, i) => {
      const offset = (i + 1) / (rightSpecs.length + 1);
      result.push(
        createPort({
          id: makeUniqueId(spec, i),
          ownerNodeId: ownerId,
          name: spec.name,
          side: "right",
          offset: spec.offset !== undefined ? spec.offset : offset,
          direction: spec.direction,
          dataType: spec.dataType,
        })
      );
    });

    // Top
    topSpecs.forEach((spec, i) => {
      const offset = (i + 1) / (topSpecs.length + 1);
      result.push(
        createPort({
          id: makeUniqueId(spec, i),
          ownerNodeId: ownerId,
          name: spec.name,
          side: "top",
          offset: spec.offset !== undefined ? spec.offset : offset,
          direction: spec.direction,
          dataType: spec.dataType,
        })
      );
    });

    // Bottom
    bottomSpecs.forEach((spec, i) => {
      const offset = (i + 1) / (bottomSpecs.length + 1);
      result.push(
        createPort({
          id: makeUniqueId(spec, i),
          ownerNodeId: ownerId,
          name: spec.name,
          side: "bottom",
          offset: spec.offset !== undefined ? spec.offset : offset,
          direction: spec.direction,
          dataType: spec.dataType,
        })
      );
    });

    return result;
  }

  /**
   * Instantiates a chip interface as a black-box node on a schematic diagram (F-061).
   */
  createChipInstanceNode(
    interfaceDef: ChipInterfaceDefinition,
    position: Point,
    options?: CreateChipInstanceOptions
  ): DiagramNode {
    const nodeId = options?.id ?? `chip-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const leftCount = interfaceDef.ports.filter((p) => p.side === "left").length;
    const rightCount = interfaceDef.ports.filter((p) => p.side === "right").length;
    const topCount = interfaceDef.ports.filter((p) => p.side === "top").length;
    const bottomCount = interfaceDef.ports.filter((p) => p.side === "bottom").length;

    const maxVertical = Math.max(leftCount, rightCount, 1);
    const maxHorizontal = Math.max(topCount, bottomCount, 1);

    const maxLeftLabelLen = Math.max(
      0,
      ...interfaceDef.ports
        .filter((p) => p.side === "left")
        .map((p) => (p.name + (p.dataType ? ` [${p.dataType}]` : "")).length)
    );
    const maxRightLabelLen = Math.max(
      0,
      ...interfaceDef.ports
        .filter((p) => p.side === "right")
        .map((p) => (p.name + (p.dataType ? ` [${p.dataType}]` : "")).length)
    );
    const titleLen = interfaceDef.name.length;
    const estimatedWidthNeeded = Math.max(
      140,
      (maxHorizontal + 1) * 36,
      (maxLeftLabelLen + maxRightLabelLen) * 7.5 + titleLen * 7 + 40
    );

    const calculatedHeight = Math.max(80, (maxVertical + 1) * 26);
    const calculatedWidth = Math.round(estimatedWidthNeeded);
    const size: Size = options?.size ?? { width: calculatedWidth, height: calculatedHeight };

    // Clone and bind ports to the instance node
    const instancePorts: Port[] = interfaceDef.ports.map((p) => ({
      ...p,
      id: `${nodeId}-port-${p.id}`,
      ownerNodeId: nodeId,
    }));

    return createDiagramNode({
      id: nodeId,
      kind: "schematic.chip",
      position,
      size,
      ports: instancePorts,
      labels: [
        {
          id: `label-${nodeId}`,
          text: interfaceDef.name,
          anchor: "node",
          position: { x: 0, y: 0 },
        },
      ],
      childDiagramId: options?.childDiagramId,
      metadata: {
        ...(options?.metadata ?? {}),
        chipInterfaceId: interfaceDef.id,
        chipInterfaceVersion: interfaceDef.version,
      },
    });
  }

  /**
   * Propagates interface changes to all chip instance nodes in a diagram (F-063).
   * Synchronizes ports, handles version bumps on breaking changes, and preserves
   * connected wires while flagging broken connections.
   */
  propagateChipInterface(
    diagram: Diagram,
    updatedInterface: ChipInterfaceDefinition,
    previousInterface?: ChipInterfaceDefinition
  ): PropagationResult {
    const updatedNodes: string[] = [];
    const brokenEdges: string[] = [];

    // Check breaking change to increment version if not already bumped
    if (previousInterface && isBreakingChange(previousInterface, updatedInterface)) {
      if (updatedInterface.version <= previousInterface.version) {
        updatedInterface.version = previousInterface.version + 1;
      }
    }

    const instanceNodes = diagram.nodes.filter(
      (n) => n.kind === "schematic.chip" && n.metadata?.chipInterfaceId === updatedInterface.id
    );

    for (const node of instanceNodes) {
      updatedNodes.push(node.id);
      node.metadata.chipInterfaceVersion = updatedInterface.version;
      node.labels[0].text = updatedInterface.name;

      // Keep a record of existing ports to preserve wire bindings
      const existingPorts = node.ports;
      const newPorts: Port[] = [];

      for (const ifacePort of updatedInterface.ports) {
        const expectedInstancePortId = `${node.id}-port-${ifacePort.id}`;
        const existing = existingPorts.find(
          (p) => p.id === expectedInstancePortId || p.name === ifacePort.name
        );

        if (existing) {
          existing.name = ifacePort.name;
          existing.side = ifacePort.side;
          existing.offset = ifacePort.offset;
          existing.direction = ifacePort.direction;
          existing.dataType = ifacePort.dataType;
          newPorts.push(existing);
        } else {
          newPorts.push({
            ...ifacePort,
            id: expectedInstancePortId,
            ownerNodeId: node.id,
          });
        }
      }

      node.ports = newPorts;
      // Adjust node height if port count expanded
      const minHeight = Math.max(80, (newPorts.length + 1) * 24);
      if (node.size.height < minHeight) {
        node.size = { width: node.size.width, height: minHeight };
      }
    }

    // Identify wires connected to now-removed ports without deleting them (F-063)
    const issues = this.validateChipConnections(diagram);
    for (const issue of issues) {
      if (issue.ruleId === "schematic.broken-port-connection" && issue.edgeId) {
        brokenEdges.push(issue.edgeId);
      }
    }

    return {
      updatedNodes,
      brokenEdges,
    };
  }

  /**
   * Validates schematic chip connections and flags broken wires (F-063).
   */
  validateChipConnections(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const nodeMap = new Map(diagram.nodes.map((n) => [n.id, n]));

    for (const edge of diagram.edges) {
      if (edge.fromPortId) {
        const fromNode = nodeMap.get(edge.fromNodeId);
        if (fromNode) {
          const port = fromNode.ports.find((p) => p.id === edge.fromPortId);
          if (!port) {
            issues.push({
              severity: "error",
              message: `Wire connected to missing or removed port "${edge.fromPortId}" on chip "${fromNode.labels[0]?.text || fromNode.id}"`,
              nodeId: fromNode.id,
              edgeId: edge.id,
              ruleId: "schematic.broken-port-connection",
            });
          }
        }
      }

      if (edge.toPortId) {
        const toNode = nodeMap.get(edge.toNodeId);
        if (toNode) {
          const port = toNode.ports.find((p) => p.id === edge.toPortId);
          if (!port) {
            issues.push({
              severity: "error",
              message: `Wire connected to missing or removed port "${edge.toPortId}" on chip "${toNode.labels[0]?.text || toNode.id}"`,
              nodeId: toNode.id,
              edgeId: edge.id,
              ruleId: "schematic.broken-port-connection",
            });
          }
        }
      }
    }

    return issues;
  }
}

export const defaultChipService = new ChipService();
