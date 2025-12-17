import { FieldType, SchemaField, SchemaMapping, Violation, CustomType, isPrimitiveType } from "../types";

// Date regex for ISO format YYYY-MM-DD
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Group schema fields by name (for union type support)
 * Multiple fields with same name = union type
 */
function groupFieldsByName(fields: SchemaField[]): Map<string, SchemaField[]> {
    const groups = new Map<string, SchemaField[]>();
    for (const field of fields) {
        const existing = groups.get(field.name) || [];
        existing.push(field);
        groups.set(field.name, existing);
    }
    return groups;
}

/**
 * Find the matching variant for a value in a union type
 * Returns the first field variant whose type matches the value
 */
function findMatchingVariant(value: unknown, variants: SchemaField[], customTypes: CustomType[]): SchemaField | null {
    for (const variant of variants) {
        if (checkTypeMatch(value, variant.type, customTypes)) {
            return variant;
        }
        // Also check allowEmpty
        if (variant.allowEmpty) {
            if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
                return variant;
            }
        }
    }
    return null;
}

/**
 * Check if a value matches the expected field type
 */
export function checkTypeMatch(value: unknown, expectedType: FieldType, customTypes: CustomType[]): boolean {
    if (value === null || value === undefined) {
        return false;
    }

    // Check if it's a primitive type
    if (isPrimitiveType(expectedType)) {
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

    // Check if it's a custom type
    const customType = customTypes.find(t => t.name === expectedType);
    if (customType) {
        // Value must be an object (not array, not null)
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            return false;
        }
        // Custom type validation: check if value has all required fields with correct types
        return validateCustomType(value as Record<string, unknown>, customType, customTypes);
    }

    return false;
}

/**
 * Validate a value against a custom type definition
 */
function validateCustomType(value: Record<string, unknown>, customType: CustomType, customTypes: CustomType[]): boolean {
    for (const field of customType.fields) {
        const hasField = Object.prototype.hasOwnProperty.call(value, field.name);

        // Required fields must be present
        if (field.required && !hasField) {
            return false;
        }

        // If field is present, validate it
        if (hasField) {
            const fieldValue = value[field.name];
            if (fieldValue === null || fieldValue === undefined) {
                // Null/empty check only fails if field is required and doesn't allow empty
                if (field.required && !field.allowEmpty) {
                    return false;
                }
            } else {
                // Type check applies to ALL present fields, not just required ones
                if (!checkTypeMatch(fieldValue, field.type, customTypes)) {
                    return false;
                }
            }
        }
    }
    return true;
}

/**
 * Get detailed validation errors for a custom type mismatch
 * Returns an array of specific field-level error messages
 */
export function getCustomTypeErrors(value: unknown, customType: CustomType, customTypes: CustomType[]): string[] {
    const errors: string[] = [];

    // Not an object at all
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        errors.push(`expected object, got ${getActualType(value)}`);
        return errors;
    }

    const obj = value as Record<string, unknown>;

    for (const field of customType.fields) {
        const hasField = Object.prototype.hasOwnProperty.call(obj, field.name);
        const fieldValue = hasField ? obj[field.name] : undefined;

        // Check required fields are present
        if (field.required && !hasField) {
            errors.push(`missing required field "${field.name}"`);
            continue;
        }

        // Skip if field not present (and not required)
        if (!hasField) continue;

        // Check null/empty values
        if (fieldValue === null || fieldValue === undefined) {
            if (field.required && !field.allowEmpty) {
                errors.push(`"${field.name}" cannot be null/empty`);
            }
            continue;
        }

        // Check type match for ALL present fields (required or optional)
        if (!checkTypeMatch(fieldValue, field.type, customTypes)) {
            errors.push(`"${field.name}" expected ${field.type}, got ${getActualType(fieldValue)}`);
        }
    }

    return errors;
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
 * Check for missing required/warned fields
 * For union types, field is required if ANY variant is required (warn if any variant warns)
 */
export function checkMissingRequired(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string,
    customTypes: CustomType[]
): Violation[] {
    const violations: Violation[] = [];
    const fieldGroups = groupFieldsByName(schema.fields);
    const checkedFields = new Set<string>();

    for (const [fieldName, variants] of fieldGroups) {
        if (checkedFields.has(fieldName)) continue;
        checkedFields.add(fieldName);

        // Field is required if any variant is required
        const isRequired = variants.some(v => v.required);
        // Field triggers warning if any variant has warn flag (and not required)
        const isWarned = !isRequired && variants.some(v => v.warn);

        if (!isRequired && !isWarned) continue;

        // Check if any variant allows empty
        const anyAllowsEmpty = variants.some(v => v.allowEmpty);

        const hasField =
            frontmatter !== undefined &&
            Object.prototype.hasOwnProperty.call(frontmatter, fieldName);

        const value = hasField ? frontmatter![fieldName] : undefined;
        const isEmpty = value === null || value === undefined;

        if (isEmpty && !anyAllowsEmpty) {
            if (isRequired) {
                violations.push({
                    filePath,
                    schemaMapping: schema,
                    field: fieldName,
                    type: "missing_required",
                    message: `Missing required field: ${fieldName}`,
                });
            } else if (isWarned) {
                violations.push({
                    filePath,
                    schemaMapping: schema,
                    field: fieldName,
                    type: "missing_warned",
                    message: `Missing recommended field: ${fieldName}`,
                });
            }
        }
    }

    return violations;
}

/**
 * Check for type mismatches
 * For union types (multiple fields with same name), value must match at least one variant
 */
export function checkTypeMismatches(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string,
    customTypes: CustomType[]
): Violation[] {
    const violations: Violation[] = [];

    if (!frontmatter) return violations;

    const fieldGroups = groupFieldsByName(schema.fields);
    const checkedFields = new Set<string>();

    for (const [fieldName, variants] of fieldGroups) {
        if (checkedFields.has(fieldName)) continue;
        checkedFields.add(fieldName);

        if (!Object.prototype.hasOwnProperty.call(frontmatter, fieldName)) {
            continue;
        }

        const value = frontmatter[fieldName];

        // Skip null/undefined - handled by missing_required
        if (value === null || value === undefined) continue;

        // Check if value matches any variant
        const matchingVariant = findMatchingVariant(value, variants, customTypes);

        if (!matchingVariant) {
            // Build expected types string for error message
            const expectedTypes = variants.map(v => v.type).join(" | ");

            // Check if any variant is a custom type and provide detailed errors
            let detailedMessage = `Type mismatch: ${fieldName} (expected ${expectedTypes}, got ${getActualType(value)})`;

            // If expecting a custom type and we got an object, show specific field errors
            for (const variant of variants) {
                const customType = customTypes.find(t => t.name === variant.type);
                if (customType && typeof value === "object" && value !== null && !Array.isArray(value)) {
                    const fieldErrors = getCustomTypeErrors(value, customType, customTypes);
                    if (fieldErrors.length > 0) {
                        detailedMessage = `Type mismatch: ${fieldName} (expected ${variant.type}): ${fieldErrors.join("; ")}`;
                        break;
                    }
                }
            }

            violations.push({
                filePath,
                schemaMapping: schema,
                field: fieldName,
                type: "type_mismatch",
                message: detailedMessage,
                expected: expectedTypes,
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
    filePath: string,
    customTypes: CustomType[]
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
 * For union types, only applies constraints from the matching variant
 */
export function checkStringConstraints(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string,
    customTypes: CustomType[]
): Violation[] {
    const violations: Violation[] = [];

    if (!frontmatter) return violations;

    const fieldGroups = groupFieldsByName(schema.fields);

    for (const [fieldName, variants] of fieldGroups) {
        if (!Object.prototype.hasOwnProperty.call(frontmatter, fieldName)) continue;

        const value = frontmatter[fieldName];
        if (typeof value !== "string") continue;

        // Find the matching string variant
        const matchingVariant = variants.find(v => v.type === "string" && checkTypeMatch(value, v.type, customTypes));
        if (!matchingVariant || !matchingVariant.stringConstraints) continue;

        const constraints = matchingVariant.stringConstraints;

        // Check pattern
        if (constraints.pattern) {
            try {
                const regex = new RegExp(constraints.pattern);
                if (!regex.test(value)) {
                    violations.push({
                        filePath,
                        schemaMapping: schema,
                        field: fieldName,
                        type: "pattern_mismatch",
                        message: `Pattern mismatch: ${fieldName} does not match /${constraints.pattern}/`,
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
                field: fieldName,
                type: "string_too_short",
                message: `String too short: ${fieldName} has ${value.length} chars (min: ${constraints.minLength})`,
                expected: `>= ${constraints.minLength}`,
                actual: String(value.length),
            });
        }

        // Check maxLength
        if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: fieldName,
                type: "string_too_long",
                message: `String too long: ${fieldName} has ${value.length} chars (max: ${constraints.maxLength})`,
                expected: `<= ${constraints.maxLength}`,
                actual: String(value.length),
            });
        }
    }

    return violations;
}

/**
 * Check number constraints (min, max)
 * For union types, only applies constraints from the matching variant
 */
export function checkNumberConstraints(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string,
    customTypes: CustomType[]
): Violation[] {
    const violations: Violation[] = [];

    if (!frontmatter) return violations;

    const fieldGroups = groupFieldsByName(schema.fields);

    for (const [fieldName, variants] of fieldGroups) {
        if (!Object.prototype.hasOwnProperty.call(frontmatter, fieldName)) continue;

        const value = frontmatter[fieldName];
        if (typeof value !== "number") continue;

        // Find the matching number variant
        const matchingVariant = variants.find(v => v.type === "number" && checkTypeMatch(value, v.type, customTypes));
        if (!matchingVariant || !matchingVariant.numberConstraints) continue;

        const constraints = matchingVariant.numberConstraints;

        // Check min
        if (constraints.min !== undefined && value < constraints.min) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: fieldName,
                type: "number_too_small",
                message: `Number too small: ${fieldName} is ${value} (min: ${constraints.min})`,
                expected: `>= ${constraints.min}`,
                actual: String(value),
            });
        }

        // Check max
        if (constraints.max !== undefined && value > constraints.max) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: fieldName,
                type: "number_too_large",
                message: `Number too large: ${fieldName} is ${value} (max: ${constraints.max})`,
                expected: `<= ${constraints.max}`,
                actual: String(value),
            });
        }
    }

    return violations;
}

/**
 * Check array constraints (minItems, maxItems, contains) and element types
 * For union types, only applies constraints from the matching variant
 */
export function checkArrayConstraints(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string,
    customTypes: CustomType[]
): Violation[] {
    const violations: Violation[] = [];

    if (!frontmatter) return violations;

    const fieldGroups = groupFieldsByName(schema.fields);

    for (const [fieldName, variants] of fieldGroups) {
        if (!Object.prototype.hasOwnProperty.call(frontmatter, fieldName)) continue;

        const value = frontmatter[fieldName];
        if (!Array.isArray(value)) continue;

        // Find the matching array variant
        const matchingVariant = variants.find(v => v.type === "array" && checkTypeMatch(value, v.type, customTypes));
        if (!matchingVariant) continue;

        // Check element types if specified
        if (matchingVariant.arrayElementType) {
            for (let i = 0; i < value.length; i++) {
                const element = value[i];
                if (!checkTypeMatch(element, matchingVariant.arrayElementType, customTypes)) {
                    violations.push({
                        filePath,
                        schemaMapping: schema,
                        field: fieldName,
                        type: "type_mismatch",
                        message: `Array element type mismatch: ${fieldName}[${i}] (expected ${matchingVariant.arrayElementType}, got ${getActualType(element)})`,
                        expected: matchingVariant.arrayElementType,
                        actual: getActualType(element),
                    });
                }
            }
        }

        if (!matchingVariant.arrayConstraints) continue;

        const constraints = matchingVariant.arrayConstraints;

        // Check minItems
        if (constraints.minItems !== undefined && value.length < constraints.minItems) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: fieldName,
                type: "array_too_few",
                message: `Array too small: ${fieldName} has ${value.length} items (min: ${constraints.minItems})`,
                expected: `>= ${constraints.minItems}`,
                actual: String(value.length),
            });
        }

        // Check maxItems
        if (constraints.maxItems !== undefined && value.length > constraints.maxItems) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: fieldName,
                type: "array_too_many",
                message: `Array too large: ${fieldName} has ${value.length} items (max: ${constraints.maxItems})`,
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
                        field: fieldName,
                        type: "array_missing_value",
                        message: `Array missing value: ${fieldName} must contain "${required}"`,
                        expected: required,
                    });
                }
            }
        }
    }

    return violations;
}

/**
 * Check object constraints
 * Note: Structured objects should use custom types instead of object constraints
 * This function is kept for backwards compatibility but doesn't do much now
 */
export function checkObjectConstraints(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string,
    customTypes: CustomType[]
): Violation[] {
    // Object structure validation is handled by custom types
    // This function is kept for API compatibility
    return [];
}
