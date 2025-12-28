import { SchemaField } from "../types";

/**
 * Group schema fields by name, supporting union types.
 * Fields with the same name become variants of a union type.
 */
export function groupFieldsByName(fields: SchemaField[]): Map<string, SchemaField[]> {
    const groups = new Map<string, SchemaField[]>();
    for (const field of fields) {
        const existing = groups.get(field.name) || [];
        existing.push(field);
        groups.set(field.name, existing);
    }
    return groups;
}

/**
 * Clear all constraint-related properties from a field.
 * Used when field type changes.
 */
export function clearFieldConstraints(field: SchemaField): void {
    delete field.stringConstraints;
    delete field.numberConstraints;
    delete field.dateConstraints;
    delete field.arrayConstraints;
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
