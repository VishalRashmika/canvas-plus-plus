// Pure TypeScript barrel export. No obsidian, no DOM.

export * from "./types";

export * from "./value-objects/Point";
export * from "./value-objects/Rect";
export * from "./value-objects/Multiplicity";
export * from "./value-objects/Stereotype";

export * from "./entities/Port";
export * from "./entities/Label";
export * from "./entities/Compartment";
export * from "./entities/DiagramNode";
export * from "./entities/DiagramEdge";
export * from "./entities/Layer";
export * from "./entities/Group";
export * from "./entities/Diagram";
export * from "./entities/ChipInterfaceDefinition";
export * from "./entities/DiagramTypeDefinition";
export * from "./services/ChipService";
export * from "./services/CustomChipRegistry";
export * from "./services/ShapeRecognizer";
