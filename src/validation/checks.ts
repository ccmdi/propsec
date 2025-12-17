import { FieldType, SchemaField, SchemaMapping, Violation } from "../types";

// Date regex for ISO format YYYY-MM-DD
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Check if a value matches the expected field type
 */
export function checkTypeMatch(value: unknown, expectedType: FieldType): boolean {
    if (value === null || value === undefined) {
        return false;
    }

    switch (expectedType) {
        case "string":
            return typeof value === "string";
        case "number":
            return typeof value === "number";
        case "boolean":
            return typeof value === "boolean";
        case "date":
            // Date can be a string in ISO format or a Date object
            if (typeof value === "string") {
                return ISO_DATE_REGEX.test(value);
            }
            return value instanceof Date;
        case "array":
            return Array.isArray(value);
        case "object":
            return typeof value === "object" && !Array.isArray(value);
        case "unknown":
            // Unknown type accepts anything
            return true;
        default:
            return false;
    }
}

/**
 * Get the actual type of a value as a string for error messages
 */
export function getActualType(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (Array.isArray(value)) return "array";
    if (value instanceof Date) return "date";
    return typeof value;
}

/**
 * Check for missing required fields
 */
export function checkMissingRequired(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string
): Violation[] {
    const violations: Violation[] = [];

    for (const field of schema.fields) {
        if (!field.required) continue;

        const hasField =
            frontmatter !== undefined &&
            Object.prototype.hasOwnProperty.call(frontmatter, field.name) &&
            frontmatter[field.name] !== null &&
            frontmatter[field.name] !== undefined;

        if (!hasField) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: field.name,
                type: "missing_required",
                message: `Missing required field: ${field.name}`,
            });
        }
    }

    return violations;
}

/**
 * Check for type mismatches
 */
export function checkTypeMismatches(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string
): Violation[] {
    const violations: Violation[] = [];

    if (!frontmatter) return violations;

    for (const field of schema.fields) {
        if (!Object.prototype.hasOwnProperty.call(frontmatter, field.name)) {
            continue;
        }

        const value = frontmatter[field.name];

        // Skip null/undefined - these are handled by missing_required check
        // But if allowEmpty is set, null/empty values are valid
        if (value === null || value === undefined) continue;

        // If allowEmpty is set and value is "empty" (empty string, empty array), skip type check
        if (field.allowEmpty) {
            if (value === "" || (Array.isArray(value) && value.length === 0)) {
                continue;
            }
        }

        if (!checkTypeMatch(value, field.type)) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: field.name,
                type: "type_mismatch",
                message: `Type mismatch: ${field.name} (expected ${field.type}, got ${getActualType(value)})`,
                expected: field.type,
                actual: getActualType(value),
            });
        }
    }

    return violations;
}

/**
 * Check for unknown fields (fields in note but not in schema)
 */
export function checkUnknownFields(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string
): Violation[] {
    const violations: Violation[] = [];

    if (!frontmatter) return violations;

    const schemaFieldNames = new Set(schema.fields.map((f) => f.name));

    for (const key of Object.keys(frontmatter)) {
        // Skip internal position field
        if (key === "position") continue;

        if (!schemaFieldNames.has(key)) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: key,
                type: "unknown_field",
                message: `Unknown field: ${key} (not defined in schema)`,
            });
        }
    }

    return violations;
}

/**
 * Check string constraints (pattern, minLength, maxLength)
 */
export function checkStringConstraints(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string
): Violation[] {
    const violations: Violation[] = [];

    if (!frontmatter) return violations;

    for (const field of schema.fields) {
        if (field.type !== "string" || !field.stringConstraints) continue;
        if (!Object.prototype.hasOwnProperty.call(frontmatter, field.name)) continue;

        const value = frontmatter[field.name];
        if (typeof value !== "string") continue;

        const constraints = field.stringConstraints;

        // Check pattern
        if (constraints.pattern) {
            try {
                const regex = new RegExp(constraints.pattern);
                if (!regex.test(value)) {
                    violations.push({
                        filePath,
                        schemaMapping: schema,
                        field: field.name,
                        type: "pattern_mismatch",
                        message: `Pattern mismatch: ${field.name} does not match /${constraints.pattern}/`,
                        expected: constraints.pattern,
                        actual: value,
                    });
                }
            } catch {
                // Invalid regex - skip
            }
        }

        // Check minLength
        if (constraints.minLength !== undefined && value.length < constraints.minLength) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: field.name,
                type: "string_too_short",
                message: `String too short: ${field.name} has ${value.length} chars (min: ${constraints.minLength})`,
                expected: `>= ${constraints.minLength}`,
                actual: String(value.length),
            });
        }

        // Check maxLength
        if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: field.name,
                type: "string_too_long",
                message: `String too long: ${field.name} has ${value.length} chars (max: ${constraints.maxLength})`,
                expected: `<= ${constraints.maxLength}`,
                actual: String(value.length),
            });
        }
    }

    return violations;
}

/**
 * Check number constraints (min, max)
 */
export function checkNumberConstraints(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string
): Violation[] {
    const violations: Violation[] = [];

    if (!frontmatter) return violations;

    for (const field of schema.fields) {
        if (field.type !== "number" || !field.numberConstraints) continue;
        if (!Object.prototype.hasOwnProperty.call(frontmatter, field.name)) continue;

        const value = frontmatter[field.name];
        if (typeof value !== "number") continue;

        const constraints = field.numberConstraints;

        // Check min
        if (constraints.min !== undefined && value < constraints.min) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: field.name,
                type: "number_too_small",
                message: `Number too small: ${field.name} is ${value} (min: ${constraints.min})`,
                expected: `>= ${constraints.min}`,
                actual: String(value),
            });
        }

        // Check max
        if (constraints.max !== undefined && value > constraints.max) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: field.name,
                type: "number_too_large",
                message: `Number too large: ${field.name} is ${value} (max: ${constraints.max})`,
                expected: `<= ${constraints.max}`,
                actual: String(value),
            });
        }
    }

    return violations;
}

/**
 * Check array constraints (minItems, maxItems, contains)
 */
export function checkArrayConstraints(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string
): Violation[] {
    const violations: Violation[] = [];

    if (!frontmatter) return violations;

    for (const field of schema.fields) {
        if (field.type !== "array" || !field.arrayConstraints) continue;
        if (!Object.prototype.hasOwnProperty.call(frontmatter, field.name)) continue;

        const value = frontmatter[field.name];
        if (!Array.isArray(value)) continue;

        const constraints = field.arrayConstraints;

        // Check minItems
        if (constraints.minItems !== undefined && value.length < constraints.minItems) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: field.name,
                type: "array_too_few",
                message: `Array too small: ${field.name} has ${value.length} items (min: ${constraints.minItems})`,
                expected: `>= ${constraints.minItems}`,
                actual: String(value.length),
            });
        }

        // Check maxItems
        if (constraints.maxItems !== undefined && value.length > constraints.maxItems) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: field.name,
                type: "array_too_many",
                message: `Array too large: ${field.name} has ${value.length} items (max: ${constraints.maxItems})`,
                expected: `<= ${constraints.maxItems}`,
                actual: String(value.length),
            });
        }

        // Check contains
        if (constraints.contains && constraints.contains.length > 0) {
            const stringValues = value.map((v) => String(v));
            for (const required of constraints.contains) {
                if (!stringValues.includes(required)) {
                    violations.push({
                        filePath,
                        schemaMapping: schema,
                        field: field.name,
                        type: "array_missing_value",
                        message: `Array missing value: ${field.name} must contain "${required}"`,
                        expected: required,
                    });
                }
            }
        }
    }

    return violations;
}

/**
 * Check object constraints (requiredKeys)
 */
export function checkObjectConstraints(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string
): Violation[] {
    const violations: Violation[] = [];

    if (!frontmatter) return violations;

    for (const field of schema.fields) {
        if (field.type !== "object" || !field.objectConstraints) continue;
        if (!Object.prototype.hasOwnProperty.call(frontmatter, field.name)) continue;

        const value = frontmatter[field.name];
        if (typeof value !== "object" || value === null || Array.isArray(value)) continue;

        const constraints = field.objectConstraints;
        const obj = value as Record<string, unknown>;

        // Check requiredKeys
        if (constraints.requiredKeys) {
            for (const requiredKey of constraints.requiredKeys) {
                if (!Object.prototype.hasOwnProperty.call(obj, requiredKey)) {
                    violations.push({
                        filePath,
                        schemaMapping: schema,
                        field: field.name,
                        type: "object_missing_key",
                        message: `Object missing key: ${field.name} is missing required key "${requiredKey}"`,
                        expected: requiredKey,
                    });
                }
            }
        }
    }

    return violations;
}
