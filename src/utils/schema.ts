import { SchemaField } from "../types";

/**
 * Clear all constraint-related properties from a field.
 * Used when field type changes.
 */
export function clearFieldConstraints(field: SchemaField): void {
    delete field.stringConstraints;
    delete field.numberConstraints;
    delete field.dateConstraints;
    delete field.arrayConstraints;
    delete field.objectConstraints;
    delete field.arrayElementType;
    delete field.objectKeyType;
    delete field.objectValueType;
    delete field.crossFieldConstraint;
}
