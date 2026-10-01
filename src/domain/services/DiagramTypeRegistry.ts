import { DiagramTypeId } from "../types";
import { Diagram } from "../entities/Diagram";
import { DiagramTypeDefinition, ValidationIssue } from "../entities/DiagramTypeDefinition";

/**
 * Cycle detection for generalization edges in class diagrams.
 * Generalization edges go from subclass (fromNodeId) to superclass (toNodeId).
 */
export function detectGeneralizationCycles(diagram: Diagram): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const generalizationEdges = diagram.edges.filter(
    (e) => e.kind === "uml.generalization"
  );

  // Map each child to its parent(s)
  const adj = new Map<string, string[]>();
  const edgeMap = new Map<string, string>(); // `${child}->${parent}` -> edgeId

  for (const edge of generalizationEdges) {
    if (edge.fromNodeId === edge.toNodeId) {
      issues.push({
        severity: "error",
        message: `Self-generalization cycle detected on node "${edge.fromNodeId}"`,
        nodeId: edge.fromNodeId,
        edgeId: edge.id,
      });
      continue;
    }

    const parents = adj.get(edge.fromNodeId) ?? [];
    parents.push(edge.toNodeId);
    adj.set(edge.fromNodeId, parents);
    edgeMap.set(`${edge.fromNodeId}->${edge.toNodeId}`, edge.id);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string, path: string[]): boolean {
    visited.add(nodeId);
    inStack.add(nodeId);
    path.push(nodeId);

    const parents = adj.get(nodeId) ?? [];
    for (const parentId of parents) {
      if (!visited.has(parentId)) {
        if (dfs(parentId, path)) {
          return true;
        }
      } else if (inStack.has(parentId)) {
        // Cycle detected
        const cycleStartIndex = path.indexOf(parentId);
        const cycleNodes = path.slice(cycleStartIndex).concat(parentId);
        const cycleEdgeId = edgeMap.get(`${nodeId}->${parentId}`);

        issues.push({
          severity: "error",
          message: `Generalization cycle detected: ${cycleNodes.join(" -> ")}`,
          nodeId,
          edgeId: cycleEdgeId,
          ruleId: "class.no-generalization-cycles",
        });
        return true;
      }
    }

    path.pop();
    inStack.delete(nodeId);
    return false;
  }

  for (const nodeId of adj.keys()) {
    if (!visited.has(nodeId)) {
      dfs(nodeId, []);
    }
  }

  return issues;
}

export const classDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.class",
  displayName: "Class Diagram",
  allowedNodeKinds: [
    "uml.class",
    "uml.interface",
    "uml.abstractClass",
    "uml.enumeration",
    "generic.rectangle",
    "generic.note",
    "generic.freehand",
  ],
  allowedEdgeKinds: [
    "uml.association",
    "uml.aggregation",
    "uml.composition",
    "uml.generalization",
    "uml.realization",
    "uml.dependency",
  ],
  defaultRouting: "orthogonal",
  axisConstraint: "none",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues = detectGeneralizationCycles(diagram);

    // Warn on interface with attributes (F-040)
    for (const node of diagram.nodes) {
      const isInterface =
        node.kind === "uml.interface" || node.stereotype?.toLowerCase() === "interface";
      if (isInterface && node.compartments) {
        const attrComp = node.compartments.find(
          (c) => c.title.toLowerCase() === "attributes"
        );
        if (attrComp && attrComp.items.length > 0) {
          issues.push({
            severity: "warning",
            message: `Interface '${node.labels[0]?.text || node.id}' should not declare attributes`,
            nodeId: node.id,
            ruleId: "class.interface-no-attributes",
          });
        }
      }
    }

    return issues;
  },
};

export const objectDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.object",
  displayName: "Object Diagram",
  allowedNodeKinds: ["uml.object", "generic.rectangle", "generic.note", "generic.freehand"],
  allowedEdgeKinds: ["uml.link", "uml.dependency"],
  defaultRouting: "orthogonal",
  axisConstraint: "none",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const objectNodes = diagram.nodes.filter((n) => n.kind === "uml.object");

    for (const node of objectNodes) {
      const label = node.labels[0]?.text ?? "";
      // UML 2.5 object instance specification: "name : Class" or ":Class" or "name"
      if (!label.includes(":")) {
        issues.push({
          severity: "info",
          message: `Object instance "${label || node.id}" should ideally follow format "name : Class" or ":Class"`,
          nodeId: node.id,
          ruleId: "object.instance-name-format",
        });
      }
    }

    return issues;
  },
};

export const useCaseDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.usecase",
  displayName: "Use Case Diagram",
  allowedNodeKinds: [
    "uml.actor",
    "uml.usecase",
    "uml.systemBoundary",
    "generic.note",
    "generic.freehand",
  ],
  allowedEdgeKinds: [
    "uml.association",
    "uml.include",
    "uml.extend",
    "uml.generalization",
  ],
  defaultRouting: "straight",
  axisConstraint: "none",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const actorNodes = diagram.nodes.filter((n) => n.kind === "uml.actor");

    for (const actor of actorNodes) {
      const isConnected = diagram.edges.some(
        (e) => e.fromNodeId === actor.id || e.toNodeId === actor.id
      );
      if (!isConnected) {
        issues.push({
          severity: "warning",
          message: `Actor "${actor.labels[0]?.text || actor.id}" is not connected to any use case`,
          nodeId: actor.id,
          ruleId: "usecase.actor-must-have-associations",
        });
      }
    }

    return issues;
  },
};

export const activityDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.activity",
  displayName: "Activity Diagram",
  allowedNodeKinds: [
    "activity.action",
    "activity.initial",
    "activity.final",
    "activity.decision",
    "activity.forkJoin",
    "activity.swimlane",
    "generic.note",
    "generic.freehand",
  ],
  allowedEdgeKinds: ["activity.controlFlow", "uml.dependency"],
  defaultRouting: "orthogonal",
  axisConstraint: "none",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Rule 1: Exactly one initial node (warning if 0 or >1)
    const initialNodes = diagram.nodes.filter(
      (n) => n.kind === "activity.initial"
    );
    if (initialNodes.length === 0) {
      issues.push({
        severity: "warning",
        message: "Activity diagram should have an initial node",
        ruleId: "activity.single-initial-node",
      });
    } else if (initialNodes.length > 1) {
      issues.push({
        severity: "warning",
        message: "Activity diagram typically has only one initial node",
        ruleId: "activity.single-initial-node",
      });
    }

    // Rule 2: Decision node must have >=2 outgoing branches
    const decisionNodes = diagram.nodes.filter(
      (n) => n.kind === "activity.decision"
    );
    for (const d of decisionNodes) {
      const outgoing = diagram.edges.filter((e) => e.fromNodeId === d.id);
      if (outgoing.length < 2) {
        issues.push({
          severity: "warning",
          message: `Decision node "${d.labels[0]?.text || d.id}" should have at least 2 outgoing branches`,
          nodeId: d.id,
          ruleId: "activity.decision-outgoing-branches",
        });
      }
    }

    // Rule 3: Final node cannot have outgoing edges
    const finalNodes = diagram.nodes.filter(
      (n) => n.kind === "activity.final"
    );
    for (const f of finalNodes) {
      const outgoing = diagram.edges.filter((e) => e.fromNodeId === f.id);
      if (outgoing.length > 0) {
        issues.push({
          severity: "error",
          message: `Final activity node "${f.labels[0]?.text || f.id}" cannot have outgoing control flows`,
          nodeId: f.id,
          ruleId: "activity.final-no-outgoing",
        });
      }
    }

    return issues;
  },
};

export const stateMachineDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.state",
  displayName: "State Machine Diagram",
  allowedNodeKinds: [
    "state.simple",
    "state.initial",
    "state.final",
    "state.composite",
    "state.choice",
    "state.forkJoin",
    "generic.note",
    "generic.freehand",
  ],
  allowedEdgeKinds: ["state.transition", "uml.dependency"],
  defaultRouting: "orthogonal",
  axisConstraint: "none",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Rule 1: Initial pseudostate transitions
    const initialNodes = diagram.nodes.filter(
      (n) => n.kind === "state.initial"
    );
    for (const init of initialNodes) {
      const incoming = diagram.edges.filter((e) => e.toNodeId === init.id);
      if (incoming.length > 0) {
        issues.push({
          severity: "error",
          message: `Initial state "${init.labels[0]?.text || init.id}" cannot have incoming transitions`,
          nodeId: init.id,
          ruleId: "state.initial-no-incoming",
        });
      }
      const outgoing = diagram.edges.filter((e) => e.fromNodeId === init.id);
      if (outgoing.length > 1) {
        issues.push({
          severity: "warning",
          message: `Initial state "${init.labels[0]?.text || init.id}" should have at most one outgoing transition`,
          nodeId: init.id,
          ruleId: "state.initial-single-outgoing",
        });
      }
    }

    // Rule 2: Final state cannot have outgoing transitions
    const finalNodes = diagram.nodes.filter((n) => n.kind === "state.final");
    for (const f of finalNodes) {
      const outgoing = diagram.edges.filter((e) => e.fromNodeId === f.id);
      if (outgoing.length > 0) {
        issues.push({
          severity: "error",
          message: `Final state "${f.labels[0]?.text || f.id}" cannot have outgoing transitions`,
          nodeId: f.id,
          ruleId: "state.final-no-outgoing",
        });
      }
    }

    return issues;
  },
};

export const sequenceDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.sequence",
  displayName: "Sequence Diagram",
  allowedNodeKinds: [
    "sequence.lifeline",
    "sequence.activation",
    "generic.note",
    "generic.freehand",
  ],
  allowedEdgeKinds: [
    "sequence.syncMessage",
    "sequence.asyncMessage",
    "sequence.replyMessage",
    "sequence.createMessage",
  ],
  defaultRouting: "straight",
  axisConstraint: "vertical-lifelines",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lifelines = diagram.nodes.filter((n) => n.kind === "sequence.lifeline");

    if (lifelines.length < 2) {
      issues.push({
        severity: "info",
        message: "Sequence diagram typically has at least 2 lifelines",
        ruleId: "sequence.minimum-lifelines",
      });
    }

    return issues;
  },
};

export const communicationDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.communication",
  displayName: "Communication Diagram",
  allowedNodeKinds: ["uml.object", "generic.rectangle", "generic.note", "generic.freehand"],
  allowedEdgeKinds: ["communication.message", "uml.link", "uml.dependency"],
  defaultRouting: "straight",
  axisConstraint: "none",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const objectNodes = diagram.nodes.filter((n) => n.kind === "uml.object");

    // Rule 1: Check for unconnected objects
    for (const obj of objectNodes) {
      const isConnected = diagram.edges.some(
        (e) => e.fromNodeId === obj.id || e.toNodeId === obj.id
      );
      if (!isConnected) {
        issues.push({
          severity: "warning",
          message: `Object "${obj.labels[0]?.text || obj.id}" is not connected to any communication path`,
          nodeId: obj.id,
          ruleId: "communication.unconnected-node",
        });
      }
    }

    // Rule 2: Message sequence number notation
    const messageEdges = diagram.edges.filter(
      (e) => e.kind === "communication.message"
    );
    const seqPattern = /^\d+(\.\d+)*\s*:/;
    for (const edge of messageEdges) {
      const hasSeqLabel = edge.labels.some((l) => seqPattern.test(l.text.trim()));
      if (!hasSeqLabel && edge.sequenceOrder === undefined) {
        issues.push({
          severity: "info",
          message: `Message edge "${edge.id}" should include a sequence number (e.g. "1: message()" or "1.1: step()")`,
          edgeId: edge.id,
          ruleId: "communication.message-sequence-number",
        });
      }
    }

    return issues;
  },
};

export const timingDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.timing",
  displayName: "Timing Diagram",
  allowedNodeKinds: ["timing.lane", "timing.stateSegment", "generic.note", "generic.freehand"],
  allowedEdgeKinds: ["timing.constraint", "uml.dependency"],
  defaultRouting: "straight",
  axisConstraint: "horizontal-time",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lanes = diagram.nodes.filter((n) => n.kind === "timing.lane");

    if (lanes.length === 0) {
      issues.push({
        severity: "warning",
        message: "Timing diagram should have at least one timing lane",
        ruleId: "timing.has-lanes",
      });
    }

    const constraints = diagram.edges.filter((e) => e.kind === "timing.constraint");
    for (const c of constraints) {
      if (c.labels.length === 0 || !c.labels[0].text.trim()) {
        issues.push({
          severity: "warning",
          message: `Timing constraint edge "${c.id}" should have a duration label (e.g. "{t < 50ms}")`,
          edgeId: c.id,
          ruleId: "timing.constraint-duration-label",
        });
      }
    }

    return issues;
  },
};

export const componentDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.component",
  displayName: "Component Diagram",
  allowedNodeKinds: [
    "uml.component",
    "uml.lollipop",
    "uml.socket",
    "uml.componentPort",
    "uml.interface",
    "generic.note",
    "generic.freehand",
  ],
  allowedEdgeKinds: [
    "uml.assembly",
    "uml.delegation",
    "uml.dependency",
    "uml.realization",
  ],
  defaultRouting: "orthogonal",
  axisConstraint: "none",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const interfaces = diagram.nodes.filter(
      (n) => n.kind === "uml.lollipop" || n.kind === "uml.socket"
    );

    for (const iface of interfaces) {
      const isConnected = diagram.edges.some(
        (e) => e.fromNodeId === iface.id || e.toNodeId === iface.id
      );
      if (!isConnected) {
        issues.push({
          severity: "warning",
          message: `Interface "${iface.labels[0]?.text || iface.id}" is not connected to any component or port`,
          nodeId: iface.id,
          ruleId: "component.unconnected-interface",
        });
      }
    }

    const components = diagram.nodes.filter((n) => n.kind === "uml.component");
    for (const comp of components) {
      if (!comp.labels[0]?.text?.trim()) {
        issues.push({
          severity: "info",
          message: `Component node "${comp.id}" has no name`,
          nodeId: comp.id,
          ruleId: "component.missing-name",
        });
      }
    }

    return issues;
  },
};

export const deploymentDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.deployment",
  displayName: "Deployment Diagram",
  allowedNodeKinds: [
    "uml.node3d",
    "uml.artifact",
    "uml.device",
    "uml.executionEnvironment",
    "generic.note",
    "generic.freehand",
  ],
  allowedEdgeKinds: [
    "deployment.communicationPath",
    "uml.dependency",
    "uml.manifest",
  ],
  defaultRouting: "orthogonal",
  axisConstraint: "none",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const commPaths = diagram.edges.filter(
      (e) => e.kind === "deployment.communicationPath"
    );

    const nodeMap = new Map(diagram.nodes.map((n) => [n.id, n]));
    for (const edge of commPaths) {
      const fromNode = nodeMap.get(edge.fromNodeId);
      const toNode = nodeMap.get(edge.toNodeId);

      if (fromNode?.kind === "uml.artifact" || toNode?.kind === "uml.artifact") {
        issues.push({
          severity: "warning",
          message: `Communication path should connect deployment nodes or devices, not standalone artifacts`,
          edgeId: edge.id,
          ruleId: "deployment.communication-path-endpoints",
        });
      }
    }

    return issues;
  },
};

export const schematicDiagramDefinition: DiagramTypeDefinition = {
  id: "schematic",
  displayName: "Schematic Diagram",
  allowedNodeKinds: [
    "schematic.chip",
    "schematic.junction",
    "schematic.ground",
    "schematic.powerRail",
    "schematic.busTap",
    "generic.rectangle",
    "generic.note",
    "generic.freehand",
  ],
  allowedEdgeKinds: ["schematic.wire", "schematic.bus", "generic.edge"],
  defaultRouting: "orthogonal",
  axisConstraint: "none",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const nodeMap = new Map(diagram.nodes.map((n) => [n.id, n]));

    for (const edge of diagram.edges) {
      if (edge.fromPortId) {
        const fromNode = nodeMap.get(edge.fromNodeId);
        if (fromNode) {
          const hasPort = fromNode.ports.some((p) => p.id === edge.fromPortId);
          if (!hasPort) {
            issues.push({
              severity: "error",
              message: `Wire connected to non-existent or removed port "${edge.fromPortId}" on node "${fromNode.labels[0]?.text || fromNode.id}"`,
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
          const hasPort = toNode.ports.some((p) => p.id === edge.toPortId);
          if (!hasPort) {
            issues.push({
              severity: "error",
              message: `Wire connected to non-existent or removed port "${edge.toPortId}" on node "${toNode.labels[0]?.text || toNode.id}"`,
              nodeId: toNode.id,
              edgeId: edge.id,
              ruleId: "schematic.broken-port-connection",
            });
          }
        }
      }
    }

    // F-065: Bus syntax and fan-out validation
    const busDefinitions = new Map<string, { high: number; low: number }>();
    const busRegex = /^([A-Za-z0-9_]+)\[(\d+):(\d+)\]$/;
    const sliceRegex = /^([A-Za-z0-9_]+)\[(\d+)\]$/;

    for (const edge of diagram.edges) {
      if (edge.kind === "schematic.bus") {
        for (const label of edge.labels) {
          const match = busRegex.exec(label.text.trim());
          if (match) {
            const [, busName, hStr, lStr] = match;
            const high = parseInt(hStr, 10);
            const low = parseInt(lStr, 10);
            if (high < low) {
              issues.push({
                severity: "error",
                message: `Bus "${label.text}" has high bit index ${high} less than low bit index ${low}`,
                edgeId: edge.id,
                ruleId: "schematic.invalid-bus-label",
              });
            } else {
              busDefinitions.set(busName, { high, low });
            }
          } else if (label.text.trim().length > 0) {
            issues.push({
              severity: "warning",
              message: `Bus label "${label.text}" does not follow standard BUS_NAME[H:L] syntax (e.g. DATA[7:0])`,
              edgeId: edge.id,
              ruleId: "schematic.invalid-bus-label",
            });
          }
        }
      }
    }

    // Validate wire tap slice labels against declared buses
    for (const edge of diagram.edges) {
      if (edge.kind === "schematic.wire") {
        for (const label of edge.labels) {
          const match = sliceRegex.exec(label.text.trim());
          if (match) {
            const [, busName, idxStr] = match;
            const idx = parseInt(idxStr, 10);
            const bus = busDefinitions.get(busName);
            if (bus && (idx < bus.low || idx > bus.high)) {
              issues.push({
                severity: "warning",
                message: `Wire tap slice "${label.text}" is outside bus range [${bus.high}:${bus.low}]`,
                edgeId: edge.id,
                ruleId: "schematic.bus-slice-out-of-bounds",
              });
            }
          }
        }
      }
    }

    return issues;
  },
};

/**
 * Cycle detection for package dependency edges.
 */
export function detectPackageDependencyCycles(diagram: Diagram): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const dependencyKinds = new Set([
    "package.dependency",
    "package.import",
    "package.merge",
    "package.access",
    "uml.dependency",
  ]);

  const packageEdges = diagram.edges.filter((e) => dependencyKinds.has(e.kind));
  const adj = new Map<string, string[]>();
  const edgeMap = new Map<string, string>();

  for (const edge of packageEdges) {
    if (edge.fromNodeId === edge.toNodeId) {
      issues.push({
        severity: "error",
        message: `Package "${edge.fromNodeId}" has a self-dependency cycle`,
        nodeId: edge.fromNodeId,
        edgeId: edge.id,
        ruleId: "package.no-dependency-cycles",
      });
      continue;
    }

    const targets = adj.get(edge.fromNodeId) ?? [];
    targets.push(edge.toNodeId);
    adj.set(edge.fromNodeId, targets);
    edgeMap.set(`${edge.fromNodeId}->${edge.toNodeId}`, edge.id);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string, path: string[]): boolean {
    visited.add(nodeId);
    inStack.add(nodeId);
    path.push(nodeId);

    const neighbors = adj.get(nodeId) ?? [];
    for (const neighborId of neighbors) {
      if (!visited.has(neighborId)) {
        if (dfs(neighborId, path)) return true;
      } else if (inStack.has(neighborId)) {
        const cycleStartIndex = path.indexOf(neighborId);
        const cycleNodes = path.slice(cycleStartIndex).concat(neighborId);
        const cycleEdgeId = edgeMap.get(`${nodeId}->${neighborId}`);

        issues.push({
          severity: "error",
          message: `Package dependency cycle detected: ${cycleNodes.join(" -> ")}`,
          nodeId,
          edgeId: cycleEdgeId,
          ruleId: "package.no-dependency-cycles",
        });
        return true;
      }
    }

    path.pop();
    inStack.delete(nodeId);
    return false;
  }

  for (const nodeId of adj.keys()) {
    if (!visited.has(nodeId)) {
      dfs(nodeId, []);
    }
  }

  return issues;
}

export const packageDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.package",
  displayName: "Package Diagram",
  allowedNodeKinds: [
    "uml.package",
    "uml.class",
    "uml.interface",
    "generic.rectangle",
    "generic.note",
    "generic.freehand",
  ],
  allowedEdgeKinds: [
    "package.dependency",
    "package.import",
    "package.merge",
    "package.access",
    "uml.generalization",
    "generic.edge",
  ],
  defaultRouting: "orthogonal",
  axisConstraint: "none",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Cycle detection
    issues.push(...detectPackageDependencyCycles(diagram));

    // Empty package title check
    for (const node of diagram.nodes) {
      if (node.kind === "uml.package") {
        const title = node.labels[0]?.text?.trim();
        if (!title) {
          issues.push({
            severity: "warning",
            message: "Package has an empty title",
            nodeId: node.id,
            ruleId: "package.empty-name",
          });
        }
      }
    }

    return issues;
  },
};

export const compositeDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.composite",
  displayName: "Composite Structure Diagram",
  allowedNodeKinds: [
    "uml.compositeClassifier",
    "uml.part",
    "uml.port",
    "uml.lollipop",
    "uml.socket",
    "generic.rectangle",
    "generic.note",
    "generic.freehand",
  ],
  allowedEdgeKinds: [
    "composite.connector",
    "uml.assembly",
    "uml.delegation",
    "uml.dependency",
    "generic.edge",
  ],
  defaultRouting: "orthogonal",
  axisConstraint: "none",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const classifiers = diagram.nodes.filter((n) => n.kind === "uml.compositeClassifier");

    for (const cls of classifiers) {
      // Check if classifier has any internal parts or ports
      const hasPartsOrPorts = diagram.nodes.some(
        (n) =>
          (n.kind === "uml.part" || n.kind === "uml.port") &&
          n.position.x >= cls.position.x &&
          n.position.y >= cls.position.y &&
          n.position.x + n.size.width <= cls.position.x + cls.size.width + 10 &&
          n.position.y + n.size.height <= cls.position.y + cls.size.height + 10
      );

      if (!hasPartsOrPorts && cls.ports.length === 0) {
        issues.push({
          severity: "info",
          message: `Composite classifier "${cls.labels[0]?.text || cls.id}" has no internal parts or boundary ports`,
          nodeId: cls.id,
          ruleId: "composite.empty-classifier",
        });
      }
    }

    return issues;
  },
};

export const interactionOverviewDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.interactionOverview",
  displayName: "Interaction Overview Diagram",
  allowedNodeKinds: [
    "activity.initial",
    "activity.final",
    "activity.decision",
    "activity.forkJoin",
    "interaction.frame",
    "interaction.occurrence",
    "generic.rectangle",
    "generic.note",
    "generic.freehand",
  ],
  allowedEdgeKinds: ["activity.controlFlow", "generic.edge"],
  defaultRouting: "orthogonal",
  axisConstraint: "none",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const initialNodes = diagram.nodes.filter((n) => n.kind === "activity.initial");

    if (initialNodes.length === 0) {
      issues.push({
        severity: "warning",
        message: "Interaction overview diagram has no initial node",
        ruleId: "interactionOverview.initial-node-count",
      });
    } else if (initialNodes.length > 1) {
      issues.push({
        severity: "warning",
        message: `Interaction overview diagram has ${initialNodes.length} initial nodes; UML recommends exactly one`,
        ruleId: "interactionOverview.initial-node-count",
      });
    }

    const decisionNodes = diagram.nodes.filter((n) => n.kind === "activity.decision");
    for (const d of decisionNodes) {
      const outgoing = diagram.edges.filter((e) => e.fromNodeId === d.id);
      if (outgoing.length < 2) {
        issues.push({
          severity: "warning",
          message: `Decision node has ${outgoing.length} outgoing control flow(s); standard UML requires at least 2 branches`,
          nodeId: d.id,
          ruleId: "interactionOverview.decision-branches",
        });
      }
    }

    return issues;
  },
};

export const profileDiagramDefinition: DiagramTypeDefinition = {
  id: "uml.profile",
  displayName: "Profile Diagram",
  allowedNodeKinds: [
    "uml.stereotype",
    "uml.metaclass",
    "uml.enumeration",
    "generic.rectangle",
    "generic.note",
    "generic.freehand",
  ],
  allowedEdgeKinds: [
    "profile.extension",
    "uml.generalization",
    "uml.dependency",
    "generic.edge",
  ],
  defaultRouting: "orthogonal",
  axisConstraint: "none",
  validate(diagram: Diagram): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const nodeMap = new Map(diagram.nodes.map((n) => [n.id, n]));

    for (const edge of diagram.edges) {
      if (edge.kind === "profile.extension") {
        const from = nodeMap.get(edge.fromNodeId);
        const to = nodeMap.get(edge.toNodeId);

        if (from && from.kind !== "uml.stereotype") {
          issues.push({
            severity: "error",
            message: `Extension edge must originate from a «stereotype» node, but starts from "${from.kind}"`,
            nodeId: from.id,
            edgeId: edge.id,
            ruleId: "profile.extension-source-target",
          });
        }
        if (to && to.kind !== "uml.metaclass") {
          issues.push({
            severity: "error",
            message: `Extension edge must target a «metaclass» node, but ends at "${to.kind}"`,
            nodeId: to.id,
            edgeId: edge.id,
            ruleId: "profile.extension-source-target",
          });
        }
      }
    }

    // Generalization cycles among stereotypes
    const generalizationEdges = diagram.edges.filter((e) => e.kind === "uml.generalization");
    const adj = new Map<string, string[]>();
    for (const edge of generalizationEdges) {
      const targets = adj.get(edge.fromNodeId) ?? [];
      targets.push(edge.toNodeId);
      adj.set(edge.fromNodeId, targets);
    }
    const visited = new Set<string>();
    const inStack = new Set<string>();
    function dfs(nodeId: string, path: string[]): boolean {
      visited.add(nodeId);
      inStack.add(nodeId);
      path.push(nodeId);
      for (const next of adj.get(nodeId) ?? []) {
        if (!visited.has(next)) {
          if (dfs(next, path)) return true;
        } else if (inStack.has(next)) {
          issues.push({
            severity: "error",
            message: `Stereotype generalization cycle detected: ${path.slice(path.indexOf(next)).concat(next).join(" -> ")}`,
            nodeId,
            ruleId: "profile.no-generalization-cycles",
          });
          return true;
        }
      }
      path.pop();
      inStack.delete(nodeId);
      return false;
    }
    for (const id of adj.keys()) {
      if (!visited.has(id)) dfs(id, []);
    }

    return issues;
  },
};

export class DiagramTypeRegistry {
  private definitions = new Map<DiagramTypeId, DiagramTypeDefinition>();

  constructor() {
    this.register(classDiagramDefinition);
    this.register(objectDiagramDefinition);
    this.register(useCaseDiagramDefinition);
    this.register(activityDiagramDefinition);
    this.register(stateMachineDiagramDefinition);
    this.register(sequenceDiagramDefinition);
    this.register(communicationDiagramDefinition);
    this.register(timingDiagramDefinition);
    this.register(componentDiagramDefinition);
    this.register(deploymentDiagramDefinition);
    this.register(schematicDiagramDefinition);
    this.register(packageDiagramDefinition);
    this.register(compositeDiagramDefinition);
    this.register(interactionOverviewDiagramDefinition);
    this.register(profileDiagramDefinition);
  }

  register(def: DiagramTypeDefinition): void {
    this.definitions.set(def.id, def);
  }

  get(id: DiagramTypeId): DiagramTypeDefinition | undefined {
    return this.definitions.get(id);
  }

  getAll(): DiagramTypeDefinition[] {
    return Array.from(this.definitions.values());
  }

  has(id: DiagramTypeId): boolean {
    return this.definitions.has(id);
  }
}

export const defaultDiagramTypeRegistry = new DiagramTypeRegistry();
