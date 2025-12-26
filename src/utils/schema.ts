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

/**
 * Format a field's type for display.
 * e.g., array with elementType "person" becomes "person[]"
 */
export function formatTypeDisplay(field: SchemaField): string {
    if (field.type === "array" && field.arrayElementType) {
        return `${field.arrayElementType}[]`;
    }
    if (field.type === "object" && field.objectValueType) {
        const keyType = field.objectKeyType || "string";
        return `{ ${keyType}: ${field.objectValueType} }`;
    }
    return field.type;
}
