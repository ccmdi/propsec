import { FieldType, SchemaField, SchemaMapping, Violation, isPrimitiveType } from "../types";
import { validationContext } from "./context";

// Date regex for ISO format YYYY-MM-DD
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Main entry point: validate frontmatter against a schema
 */
export function validateFrontmatter(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string,
    options: { checkUnknownFields: boolean }
): Violation[] {
    const violations: Violation[] = [];
    const fieldGroups = groupFieldsByName(schema.fields);
    const schemaFieldNames = new Set(schema.fields.map(f => f.name));

    // Check each schema field
    for (const [fieldName, variants] of fieldGroups) {
        const hasField = frontmatter !== undefined &&
            Object.prototype.hasOwnProperty.call(frontmatter, fieldName);
        const value = hasField ? frontmatter![fieldName] : undefined;

        violations.push(...validateField(value, hasField, variants, fieldName, filePath, schema));
    }

    // Check for unknown fields at top level
    if (options.checkUnknownFields && frontmatter) {
        for (const key of Object.keys(frontmatter)) {
            if (key === "position") continue; // Skip Obsidian internal field

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
    }

    return violations;
}

/**
 * Validate a single field (which may have union type variants)
 */
function validateField(
    value: unknown,
    hasField: boolean,
    variants: SchemaField[],
    path: string,
    filePath: string,
    schema: SchemaMapping
): Violation[] {
    const violations: Violation[] = [];

    // Check required/warned
    const isRequired = variants.some(v => v.required);
    const isWarned = !isRequired && variants.some(v => v.warn);
    const anyAllowsEmpty = variants.some(v => v.allowEmpty);
    const isEmpty = value === null || value === undefined;

    if (isEmpty && !anyAllowsEmpty) {
        if (isRequired) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: path,
                type: "missing_required",
                message: `Missing required field: ${path}`,
            });
            return violations;
        } else if (isWarned) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: path,
                type: "missing_warned",
                message: `Missing recommended field: ${path}`,
            });
            return violations;
        }
    }

    // If no value, nothing more to check
    if (!hasField || isEmpty) return violations;

    // Find matching variant
    const matchingVariant = findMatchingVariant(value, variants);

    if (!matchingVariant) {
        const expectedTypes = variants.map(v => v.type).join(" | ");
        let message = `Type mismatch: ${path} (expected ${expectedTypes}, got ${getActualType(value)})`;

        // Detailed errors for custom type mismatches
        for (const variant of variants) {
            const customType = validationContext.getCustomType(variant.type);
            if (customType && typeof value === "object" && value !== null && !Array.isArray(value)) {
                const errors = getCustomTypeFieldErrors(value as Record<string, unknown>, customType);
                if (errors.length > 0) {
                    message = `Type mismatch: ${path} (expected ${variant.type}): ${errors.join("; ")}`;
                    break;
                }
            }
        }

        violations.push({
            filePath,
            schemaMapping: schema,
            field: path,
            type: "type_mismatch",
            message,
            expected: expectedTypes,
            actual: getActualType(value),
        });
        return violations;
    }

    // Validate value with constraints and recurse into nested structures
    violations.push(...validateValue(value, matchingVariant, path, filePath, schema));

    return violations;
}

/**
 * Validate a value against its field definition (type + constraints + recursion)
 */
function validateValue(
    value: unknown,
    field: SchemaField,
    path: string,
    filePath: string,
    schema: SchemaMapping
): Violation[] {
    const violations: Violation[] = [];

    // String constraints
    if (field.type === "string" && typeof value === "string" && field.stringConstraints) {
        violations.push(...checkStringConstraints(value, field.stringConstraints, path, filePath, schema));
    }

    // Number constraints
    if (field.type === "number" && typeof value === "number" && field.numberConstraints) {
        violations.push(...checkNumberConstraints(value, field.numberConstraints, path, filePath, schema));
    }

    // Array: check constraints + recurse into elements
    if (field.type === "array" && Array.isArray(value)) {
        violations.push(...checkArrayConstraints(value, field, path, filePath, schema));

        // Recurse into array elements
        if (field.arrayElementType) {
            violations.push(...validateArrayElements(value, field.arrayElementType, path, filePath, schema));
        }
    }

    // Custom type: recurse into object fields
    const customType = validationContext.getCustomType(field.type);
    if (customType && typeof value === "object" && value !== null && !Array.isArray(value)) {
        violations.push(...validateCustomTypeObject(value as Record<string, unknown>, customType, path, filePath, schema));
    }

    return violations;
}

/**
 * Validate array elements against element type
 */
function validateArrayElements(
    arr: unknown[],
    elementType: FieldType,
    path: string,
    filePath: string,
    schema: SchemaMapping
): Violation[] {
    const violations: Violation[] = [];
    const customType = validationContext.getCustomType(elementType);

    for (let i = 0; i < arr.length; i++) {
        const element = arr[i];
        const elementPath = `${path}[${i}]`;

        if (!checkTypeMatch(element, elementType)) {
            let message = `Array element type mismatch: ${elementPath} (expected ${elementType}, got ${getActualType(element)})`;

            if (customType && typeof element === "object" && element !== null && !Array.isArray(element)) {
                const errors = getCustomTypeFieldErrors(element as Record<string, unknown>, customType);
                if (errors.length > 0) {
                    message = `Array element type mismatch: ${elementPath} (expected ${elementType}): ${errors.join("; ")}`;
                }
            }

            violations.push({
                filePath,
                schemaMapping: schema,
                field: elementPath,
                type: "type_mismatch",
                message,
                expected: elementType,
                actual: getActualType(element),
            });
        } else if (customType && typeof element === "object" && element !== null && !Array.isArray(element)) {
            // Valid custom type - recurse to check nested fields and unknown fields
            violations.push(...validateCustomTypeObject(element as Record<string, unknown>, customType, elementPath, filePath, schema));
        }
    }

    return violations;
}

/**
 * Validate an object against a custom type definition (recursive)
 */
function validateCustomTypeObject(
    obj: Record<string, unknown>,
    customType: { name: string; fields: SchemaField[] },
    path: string,
    filePath: string,
    schema: SchemaMapping
): Violation[] {
    const violations: Violation[] = [];
    const typeFieldNames = new Set(customType.fields.map(f => f.name));

    // Check unknown fields in this object
    for (const key of Object.keys(obj)) {
        if (!typeFieldNames.has(key)) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: `${path}.${key}`,
                type: "unknown_field",
                message: `Unknown field: ${path}.${key} (not defined in type "${customType.name}")`,
            });
        }
    }

    // Validate each field in the custom type
    for (const field of customType.fields) {
        const hasField = Object.prototype.hasOwnProperty.call(obj, field.name);
        const value = hasField ? obj[field.name] : undefined;
        const fieldPath = `${path}.${field.name}`;

        // Check required
        if (field.required && !hasField) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: fieldPath,
                type: "missing_required",
                message: `Missing required field: ${fieldPath}`,
            });
            continue;
        }

        if (!hasField) continue;

        // Check null/empty
        if (value === null || value === undefined) {
            if (field.required && !field.allowEmpty) {
                violations.push({
                    filePath,
                    schemaMapping: schema,
                    field: fieldPath,
                    type: "missing_required",
                    message: `Field cannot be null/empty: ${fieldPath}`,
                });
            }
            continue;
        }

        // Check type
        if (!checkTypeMatch(value, field.type)) {
            violations.push({
                filePath,
                schemaMapping: schema,
                field: fieldPath,
                type: "type_mismatch",
                message: `Type mismatch: ${fieldPath} (expected ${field.type}, got ${getActualType(value)})`,
                expected: field.type,
                actual: getActualType(value),
            });
            continue;
        }

        // Recurse with constraints
        violations.push(...validateValue(value, field, fieldPath, filePath, schema));
    }

    return violations;
}

// ============ Type Checking ============

function checkTypeMatch(value: unknown, expectedType: FieldType): boolean {
    if (value === null || value === undefined) return false;

    if (isPrimitiveType(expectedType)) {
        switch (expectedType) {
            case "string": return typeof value === "string";
            case "number": return typeof value === "number";
            case "boolean": return typeof value === "boolean";
            case "date":
                if (typeof value === "string") return ISO_DATE_REGEX.test(value);
                return value instanceof Date;
            case "array": return Array.isArray(value);
            case "object": return typeof value === "object" && !Array.isArray(value);
            case "unknown": return true;
            default: return false;
        }
    }

    // Custom type
    const customType = validationContext.getCustomType(expectedType);
    if (customType) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
        return validateCustomTypeMatch(value as Record<string, unknown>, customType);
    }

    return false;
}

function validateCustomTypeMatch(obj: Record<string, unknown>, customType: { fields: SchemaField[] }): boolean {
    for (const field of customType.fields) {
        const hasField = Object.prototype.hasOwnProperty.call(obj, field.name);

        if (field.required && !hasField) return false;

        if (hasField) {
            const value = obj[field.name];
            if (value === null || value === undefined) {
                if (field.required && !field.allowEmpty) return false;
            } else {
                if (!checkTypeMatch(value, field.type)) return false;
            }
        }
    }
    return true;
}

function findMatchingVariant(value: unknown, variants: SchemaField[]): SchemaField | null {
    for (const variant of variants) {
        if (checkTypeMatch(value, variant.type)) return variant;
        if (variant.allowEmpty) {
            if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
                return variant;
            }
        }
    }
    return null;
}

// ============ Constraint Checking ============

function checkStringConstraints(
    value: string,
    constraints: { pattern?: string; minLength?: number; maxLength?: number },
    path: string,
    filePath: string,
    schema: SchemaMapping
): Violation[] {
    const violations: Violation[] = [];

    if (constraints.pattern) {
        try {
            if (!new RegExp(constraints.pattern).test(value)) {
                violations.push({
                    filePath, schemaMapping: schema, field: path,
                    type: "pattern_mismatch",
                    message: `Pattern mismatch: ${path} does not match /${constraints.pattern}/`,
                    expected: constraints.pattern, actual: value,
                });
            }
        } catch { /* invalid regex */ }
    }

    if (constraints.minLength !== undefined && value.length < constraints.minLength) {
        violations.push({
            filePath, schemaMapping: schema, field: path,
            type: "string_too_short",
            message: `String too short: ${path} has ${value.length} chars (min: ${constraints.minLength})`,
            expected: `>= ${constraints.minLength}`, actual: String(value.length),
        });
    }

    if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
        violations.push({
            filePath, schemaMapping: schema, field: path,
            type: "string_too_long",
            message: `String too long: ${path} has ${value.length} chars (max: ${constraints.maxLength})`,
            expected: `<= ${constraints.maxLength}`, actual: String(value.length),
        });
    }

    return violations;
}

function checkNumberConstraints(
    value: number,
    constraints: { min?: number; max?: number },
    path: string,
    filePath: string,
    schema: SchemaMapping
): Violation[] {
    const violations: Violation[] = [];

    if (constraints.min !== undefined && value < constraints.min) {
        violations.push({
            filePath, schemaMapping: schema, field: path,
            type: "number_too_small",
            message: `Number too small: ${path} is ${value} (min: ${constraints.min})`,
            expected: `>= ${constraints.min}`, actual: String(value),
        });
    }

    if (constraints.max !== undefined && value > constraints.max) {
        violations.push({
            filePath, schemaMapping: schema, field: path,
            type: "number_too_large",
            message: `Number too large: ${path} is ${value} (max: ${constraints.max})`,
            expected: `<= ${constraints.max}`, actual: String(value),
        });
    }

    return violations;
}

function checkArrayConstraints(
    value: unknown[],
    field: SchemaField,
    path: string,
    filePath: string,
    schema: SchemaMapping
): Violation[] {
    const violations: Violation[] = [];
    const constraints = field.arrayConstraints;
    if (!constraints) return violations;

    if (constraints.minItems !== undefined && value.length < constraints.minItems) {
        violations.push({
            filePath, schemaMapping: schema, field: path,
            type: "array_too_few",
            message: `Array too small: ${path} has ${value.length} items (min: ${constraints.minItems})`,
            expected: `>= ${constraints.minItems}`, actual: String(value.length),
        });
    }

    if (constraints.maxItems !== undefined && value.length > constraints.maxItems) {
        violations.push({
            filePath, schemaMapping: schema, field: path,
            type: "array_too_many",
            message: `Array too large: ${path} has ${value.length} items (max: ${constraints.maxItems})`,
            expected: `<= ${constraints.maxItems}`, actual: String(value.length),
        });
    }

    if (constraints.contains && constraints.contains.length > 0) {
        const stringValues = value.map(v => String(v));
        for (const required of constraints.contains) {
            if (!stringValues.includes(required)) {
                violations.push({
                    filePath, schemaMapping: schema, field: path,
                    type: "array_missing_value",
                    message: `Array missing value: ${path} must contain "${required}"`,
                    expected: required,
                });
            }
        }
    }

    return violations;
}

// ============ Helpers ============

function groupFieldsByName(fields: SchemaField[]): Map<string, SchemaField[]> {
    const groups = new Map<string, SchemaField[]>();
    for (const field of fields) {
        const existing = groups.get(field.name) || [];
        existing.push(field);
        groups.set(field.name, existing);
    }
    return groups;
}

function getActualType(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (Array.isArray(value)) return "array";
    if (value instanceof Date) return "date";
    return typeof value;
}

function getCustomTypeFieldErrors(obj: Record<string, unknown>, customType: { name: string; fields: SchemaField[] }): string[] {
    const errors: string[] = [];

    for (const field of customType.fields) {
        const hasField = Object.prototype.hasOwnProperty.call(obj, field.name);
        const value = hasField ? obj[field.name] : undefined;

        if (field.required && !hasField) {
            errors.push(`missing required field "${field.name}"`);
            continue;
        }

        if (!hasField) continue;

        if (value === null || value === undefined) {
            if (field.required && !field.allowEmpty) {
                errors.push(`"${field.name}" cannot be null/empty`);
            }
            continue;
        }

        if (!checkTypeMatch(value, field.type)) {
            errors.push(`"${field.name}" expected ${field.type}, got ${getActualType(value)}`);
        }
    }

    return errors;
}
