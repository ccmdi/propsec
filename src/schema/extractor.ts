import { App, TFile } from "obsidian";
import { FieldType, Field, ISO_DATE_REGEX } from "@propsec/core";
import "../obsidian-ex.d.ts";

/**
 * Map Obsidian's metadata type names to our FieldType
 */
function mapObsidianType(obsidianType: string | null): FieldType | null {
    if (!obsidianType) return null;

    switch (obsidianType) {
        case "text":
            return "string";
        case "number":
            return "number";
        case "checkbox":
            return "boolean";
        case "date":
        case "datetime":
            return "date";
        case "tags":
        case "aliases":
        case "multitext":
            return "array";
        default:
            return null;
    }
}

/**
 * Infer the FieldType from a frontmatter value
 */
export function inferFieldType(value: unknown): FieldType {
    if (value === null || value === undefined) {
        return "unknown";
    }

    if (typeof value === "string") {
        if (ISO_DATE_REGEX.test(value)) {
            return "date";
        }
        return "string";
    }

    if (typeof value === "number") {
        return "number";
    }

    if (typeof value === "boolean") {
        return "boolean";
    }

    if (Array.isArray(value)) {
        return "array";
    }

    if (typeof value === "object") {
        return "object";
    }

    return "unknown";
}

/**
 * Infer FieldType with Obsidian metadata fallback for empty values
 */
export function inferFieldTypeWithObsidian(app: App, key: string, value: unknown): FieldType {
    // First try to infer from actual value
    const inferredType = inferFieldType(value);

    if (inferredType !== "unknown") {
        return inferredType;
    }

    // Fall back to Obsidian's registered type for this property
    const obsidianType = app.metadataTypeManager?.properties?.[key]?.widget;
    const mappedType = mapObsidianType(obsidianType ?? null);

    return mappedType ?? "unknown";
}

/**
 * Extract schema fields from a template file's frontmatter
 * All fields default to required=true
 * Uses Obsidian's metadata type system as fallback for empty values
 */
export function extractSchemaFromTemplate(
    app: App,
    templateFile: TFile
): Field[] {
    const frontmatter = app.metadataCache.getFileCache(templateFile)?.frontmatter;

    if (!frontmatter) {
        return [];
    }

    const fields: Field[] = [];

    for (const [key, value] of Object.entries(frontmatter)) {
        fields.push({
            name: key,
            type: inferFieldTypeWithObsidian(app, key, value),
            required: true, // Default to required
        });
        // A property left empty in the template may stay empty in notes
        if (value === null || value === undefined) {
            fields.push({ name: key, type: "null", required: true });
        }
    }

    return fields;
}

/**
 * Get a human-readable type name for display
 * For custom types, returns the type name as-is
 */
export function getTypeDisplayName(type: FieldType): string {
    switch (type) {
        case "string":
            return "String";
        case "number":
            return "Number";
        case "boolean":
            return "Boolean";
        case "date":
            return "Date";
        case "array":
            return "Array";
        case "object":
            return "Object";
        case "null":
            return "Null";
        case "unknown":
            return "Unknown";
        default:
            // Custom type - return the name as-is
            return type;
    }
}
