import { Visibility } from "../types";

/**
 * One line inside a Class/Object diagram compartment, e.g.
 * "+ name: String" (attribute) or "- submit(): void" (method).
 * See docs/05-UML-DIAGRAM-SPECS.md "Class Diagram".
 */
export interface CompartmentItem {
  visibility?: Visibility;
  /** Raw text after the visibility marker, e.g. "name: Type" or "submit(): void", or slot "attr = val". */
  text: string;
}

/**
 * A titled group of items inside a class/object box, e.g. "attributes",
 * "methods", or "slots". `title` is a free string so custom compartments (Profile
 * diagrams, F-053) are possible.
 */
export interface Compartment {
  title: string;
  items: CompartmentItem[];
}

export function formatCompartmentItem(item: CompartmentItem): string {
  return item.visibility ? `${item.visibility} ${item.text}` : item.text;
}
