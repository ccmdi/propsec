import { FieldType, FieldCondition, SchemaField, SchemaMapping, Violation, ViolationType, isPrimitiveType, DateConstraints, CrossFieldConstraint } from "../types";
import { validationContext } from "./context";
import { buildLowerKeyMap, lookupKey, LowerKeyMap } from "../utils/object";
import { EXCLUDE_FIELDS, ISO_DATE_REGEX } from "../utils/constant";
import { groupFieldsByName } from "../utils/schema";
import {
    getCrossFieldOperatorDisplay,
    compareCrossFieldValues,
    evaluatePropertyOperator,
} from "../operators";

/**
 * Helper to create a violation object with consistent structure
 */
function createViolation(
    filePath: string,
    schema: SchemaMapping,
    field: string,
    type: ViolationType,
    message: string,
    expected?: string,
    actual?: string
): Violation {
    return { filePath, schemaMapping: schema, field, type, message, expected, actual };
}

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
    const schemaFieldNamesLower = new Set(schema.fields.map(f => f.name.toLowerCase()));

    // Build lowercase key map once for O(1) lookups (optimization: O(n) upfront vs O(n²) total)
    const keyMap = frontmatter ? buildLowerKeyMap(frontmatter) : new Map<string, string>();

    // Check each schema field
    for (const [fieldName, variants] of fieldGroups) {
        // O(1) case-insensitive field lookup
        const actualKey = lookupKey(keyMap, fieldName);
        const hasField = actualKey !== undefined;

        const value = hasField ? frontmatter![actualKey] : undefined;

        violations.push(...validateField(value, hasField, variants, fieldName, filePath, schema, frontmatter, keyMap));
    }

    // Check for unknown fields at top level (case-insensitive)
    if (options.checkUnknownFields && frontmatter) {
        for (const key of Object.keys(frontmatter)) {
            if (EXCLUDE_FIELDS.includes(key)) continue;

            if (!schemaFieldNamesLower.has(key.toLowerCase())) {
                violations.push(createViolation(
                    filePath, schema, key, "unknown_field",
                    `Unknown field: ${key} (not defined in schema)`
                ));
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
    schema: SchemaMapping,
    frontmatter: Record<string, unknown> | undefined,
    keyMap: LowerKeyMap
): Violation[] {
    const violations: Violation[] = [];

    // Check field conditions - filter to variants whose conditions are met
    const applicableVariants = variants.filter(v => {
        if (!v.conditions || v.conditions.length === 0) return true;
        const check = v.conditionLogic === "or" ? "some" : "every";
        return v.conditions[check](c => evaluateFieldCondition(c, frontmatter, keyMap));
    });

    // If no variants are applicable (all had conditions, none met), skip this field
    if (applicableVariants.length === 0) {
        return violations;
    }

    // Check required/warned from applicable variants only
    const isRequired = applicableVariants.some(v => v.required);
    const isWarned = !isRequired && applicableVariants.some(v => v.warn === true);

    // Key is missing entirely - required fields must have the key present
    if (!hasField) {
        if (isRequired) {
            violations.push(createViolation(
                filePath, schema, path, "missing_required",
                `Missing required field: ${path}`
            ));
        } else if (isWarned) {
            violations.push(createViolation(
                filePath, schema, path, "missing_warned",
                `Missing recommended field: ${path}`
            ));
        }
        return violations;
    }

    // Key exists - find matching type variant (null is now a type, so null values need a null variant)
    const matchingVariant = findMatchingVariant(value, applicableVariants);

    if (!matchingVariant) {
        const expectedTypes = applicableVariants.map(v => v.type).join(" | ");
        let message = `Type mismatch: ${path} (expected ${expectedTypes}, got ${getActualType(value)})`;

        // Detailed errors for custom type mismatches
        for (const variant of applicableVariants) {
            const customType = validationContext.getCustomType(variant.type);
            if (customType && typeof value === "object" && value !== null && !Array.isArray(value)) {
                const errors = getCustomTypeFieldErrors(value as Record<string, unknown>, customType);
                if (errors.length > 0) {
                    message = `Type mismatch: ${path} (expected ${variant.type}): ${errors.join("; ")}`;
                    break;
                }
            }
        }

        violations.push(createViolation(
            filePath, schema, path,
            isWarned ? "type_mismatch_warned" : "type_mismatch",
            message, expectedTypes, getActualType(value)
        ));
        return violations;
    }

    // Validate value with constraints and recurse into nested structures
    violations.push(...validateValue(value, matchingVariant, path, filePath, schema, frontmatter, keyMap));

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
    schema: SchemaMapping,
    frontmatter?: Record<string, unknown>,
    keyMap?: LowerKeyMap
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

    // Date constraints
    if (field.type === "date" && field.dateConstraints) {
        violations.push(...checkDateConstraints(value, field.dateConstraints, path, filePath, schema));
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

    // Cross-field constraint
    if (field.crossFieldConstraint && frontmatter && keyMap) {
        violations.push(...checkCrossFieldConstraint(value, field.crossFieldConstraint, path, filePath, schema, frontmatter, keyMap));
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

            violations.push(createViolation(
                filePath, schema, elementPath, "type_mismatch",
                message, elementType, getActualType(element)
            ));
        } else if (customType && typeof element === "object" && element !== null && !Array.isArray(element)) {
            // Valid custom type - recurse to check nested fields and unknown fields
            violations.push(...validateCustomTypeObject(element as Record<string, unknown>, customType, elementPath, filePath, schema));
        }
    }

    return violations;
}

/**
 * Validate an object against a custom type definition (recursive)
 * Supports union types via multiple field entries with the same name
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
    const fieldGroups = groupFieldsByName(customType.fields);

    // Check unknown fields in this object
    for (const key of Object.keys(obj)) {
        if (!typeFieldNames.has(key)) {
            violations.push(createViolation(
                filePath, schema, `${path}.${key}`, "unknown_field",
                `Unknown field: ${path}.${key} (not defined in type "${customType.name}")`
            ));
        }
    }

    // Validate each field group (supporting union types)
    for (const [fieldName, variants] of fieldGroups) {
        const hasField = fieldName in obj;
        const value: unknown = hasField ? obj[fieldName] : undefined;
        const fieldPath = `${path}.${fieldName}`;
        
        const isRequired = variants.some(v => v.required);
        const isWarned = !isRequired && variants.some(v => v.warn === true);

        // Check required
        if (!hasField) {
            if (isRequired) {
                violations.push(createViolation(
                    filePath, schema, fieldPath, "missing_required",
                    `Missing required field: ${fieldPath}`
                ));
            } else if (isWarned) {
                violations.push(createViolation(
                    filePath, schema, fieldPath, "missing_warned",
                    `Missing recommended field: ${fieldPath}`
                ));
            }
            continue;
        }

        // Find matching type variant (union support)
        const matchingVariant = variants.find(v => checkTypeMatch(value, v.type));
        
        if (!matchingVariant) {
            const expectedTypes = variants.map(v => v.type).join(" | ");
            violations.push(createViolation(
                filePath, schema, fieldPath,
                isWarned ? "type_mismatch_warned" : "type_mismatch",
                `Type mismatch: ${fieldPath} (expected ${expectedTypes}, got ${getActualType(value)})`,
                expectedTypes, getActualType(value)
            ));
            continue;
        }

        // Recurse with constraints using the matching variant
        violations.push(...validateValue(value, matchingVariant, fieldPath, filePath, schema));
    }

    return violations;
}

// ============ Type Checking ============

function checkTypeMatch(value: unknown, expectedType: FieldType): boolean {
    // Handle null type first - it matches null and undefined values
    if (expectedType === "null") {
        return value === null || value === undefined;
    }

    // For all other types, null/undefined don't match
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
    const fieldGroups = groupFieldsByName(customType.fields);

    for (const [fieldName, variants] of fieldGroups) {
        const hasField = fieldName in obj;
        const isRequired = variants.some(v => v.required);

        // Required fields must have the key present
        if (isRequired && !hasField) return false;

        // If field exists, check if value matches any variant type (union support)
        if (hasField) {
            const value: unknown = obj[fieldName];
            const matchesAny = variants.some(v => checkTypeMatch(value, v.type));
            if (!matchesAny) return false;
        }
    }
    return true;
}

function findMatchingVariant(value: unknown, variants: SchemaField[]): SchemaField | null {
    for (const variant of variants) {
        if (checkTypeMatch(value, variant.type)) return variant;
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
                violations.push(createViolation(
                    filePath, schema, path, "pattern_mismatch",
                    `Pattern mismatch: ${path} does not match /${constraints.pattern}/`,
                    constraints.pattern, value
                ));
            }
        } catch { /* invalid regex */ }
    }

    if (constraints.minLength !== undefined && value.length < constraints.minLength) {
        violations.push(createViolation(
            filePath, schema, path, "string_too_short",
            `String too short: ${path} has ${value.length} chars (min: ${constraints.minLength})`,
            `>= ${constraints.minLength}`, String(value.length)
        ));
    }

    if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
        violations.push(createViolation(
            filePath, schema, path, "string_too_long",
            `String too long: ${path} has ${value.length} chars (max: ${constraints.maxLength})`,
            `<= ${constraints.maxLength}`, String(value.length)
        ));
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
        violations.push(createViolation(
            filePath, schema, path, "number_too_small",
            `Number too small: ${path} is ${value} (min: ${constraints.min})`,
            `>= ${constraints.min}`, String(value)
        ));
    }

    if (constraints.max !== undefined && value > constraints.max) {
        violations.push(createViolation(
            filePath, schema, path, "number_too_large",
            `Number too large: ${path} is ${value} (max: ${constraints.max})`,
            `<= ${constraints.max}`, String(value)
        ));
    }

    return violations;
}

function checkDateConstraints(
    value: unknown,
    constraints: DateConstraints,
    path: string,
    filePath: string,
    schema: SchemaMapping
): Violation[] {
    const violations: Violation[] = [];

    // Parse the value as a date
    let dateValue: Date;
    if (value instanceof Date) {
        dateValue = value;
    } else if (typeof value === "string") {
        dateValue = new Date(value);
    } else {
        // Not a valid date format, skip constraint checking (type mismatch handles this)
        return violations;
    }

    // Invalid date
    if (isNaN(dateValue.getTime())) {
        return violations;
    }

    const actualDateStr = dateValue.toISOString().split("T")[0];

    if (constraints.min) {
        const minDate = new Date(constraints.min);
        if (!isNaN(minDate.getTime()) && dateValue < minDate) {
            violations.push(createViolation(
                filePath, schema, path, "date_too_early",
                `Date too early: ${path} is ${actualDateStr} (min: ${constraints.min})`,
                `>= ${constraints.min}`, actualDateStr
            ));
        }
    }

    if (constraints.max) {
        const maxDate = new Date(constraints.max);
        if (!isNaN(maxDate.getTime()) && dateValue > maxDate) {
            violations.push(createViolation(
                filePath, schema, path, "date_too_late",
                `Date too late: ${path} is ${actualDateStr} (max: ${constraints.max})`,
                `<= ${constraints.max}`, actualDateStr
            ));
        }
    }

    return violations;
}

function checkCrossFieldConstraint(
    value: unknown,
    constraint: CrossFieldConstraint,
    path: string,
    filePath: string,
    schema: SchemaMapping,
    frontmatter: Record<string, unknown>,
    keyMap: LowerKeyMap
): Violation[] {
    const violations: Violation[] = [];

    // Get the other field's value (O(1) case-insensitive lookup)
    const otherKey = lookupKey(keyMap, constraint.field);
    if (!otherKey) {
        // Other field doesn't exist, can't compare
        return violations;
    }

    const otherValue = frontmatter[otherKey];
    if (otherValue === null || otherValue === undefined) {
        return violations;
    }

    // Compare based on types
    const result = compareCrossFieldValues(value, otherValue, constraint.operator);

    if (result === false) {
        const operatorDisplay = getCrossFieldOperatorDisplay(constraint.operator);
        violations.push(createViolation(
            filePath, schema, path, "cross_field_violation",
            `Cross-field constraint failed: ${path} must be ${operatorDisplay} ${constraint.field}`,
            `${operatorDisplay} ${constraint.field}`, String(value)
        ));
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
        violations.push(createViolation(
            filePath, schema, path, "array_too_few",
            `Array too small: ${path} has ${value.length} items (min: ${constraints.minItems})`,
            `>= ${constraints.minItems}`, String(value.length)
        ));
    }

    if (constraints.maxItems !== undefined && value.length > constraints.maxItems) {
        violations.push(createViolation(
            filePath, schema, path, "array_too_many",
            `Array too large: ${path} has ${value.length} items (max: ${constraints.maxItems})`,
            `<= ${constraints.maxItems}`, String(value.length)
        ));
    }

    if (constraints.contains && constraints.contains.length > 0) {
        const stringValues = value.map(v => String(v));
        for (const required of constraints.contains) {
            if (!stringValues.includes(required)) {
                violations.push(createViolation(
                    filePath, schema, path, "array_missing_value",
                    `Array missing value: ${path} must contain "${required}"`,
                    required
                ));
            }
        }
    }

    return violations;
}

// ============ Helpers ============

function getActualType(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (Array.isArray(value)) return "array";
    if (value instanceof Date) return "date";
    return typeof value;
}

function getCustomTypeFieldErrors(obj: Record<string, unknown>, customType: { name: string; fields: SchemaField[] }): string[] {
    const errors: string[] = [];
    const fieldGroups = groupFieldsByName(customType.fields);

    for (const [fieldName, variants] of fieldGroups) {
        const hasField = fieldName in obj;
        const value: unknown = hasField ? obj[fieldName] : undefined;
        const isRequired = variants.some(v => v.required);

        // Required fields must have the key present
        if (isRequired && !hasField) {
            errors.push(`missing required field "${fieldName}"`);
            continue;
        }

        if (!hasField) continue;

        // Check type against all variants (union support)
        const matchesAny = variants.some(v => checkTypeMatch(value, v.type));
        if (!matchesAny) {
            const expectedTypes = variants.map(v => v.type).join(" | ");
            errors.push(`"${fieldName}" expected ${expectedTypes}, got ${getActualType(value)}`);
        }
    }

    return errors;
}

/**
 * Evaluate a field condition against frontmatter values
 */
function evaluateFieldCondition(
    condition: FieldCondition,
    frontmatter: Record<string, unknown> | undefined,
    keyMap: LowerKeyMap
): boolean {
    if (!frontmatter) {
        return condition.operator === "not_exists";
    }

    // O(1) case-insensitive lookup
    const actualKey = lookupKey(keyMap, condition.field);

    // Handle exists/not_exists before value resolution
    if (condition.operator === "exists") return actualKey !== undefined;
    if (condition.operator === "not_exists") return actualKey === undefined;

    const fieldValue = actualKey ? frontmatter[actualKey] : undefined;

    // Handle missing field - convert to empty string for comparison
    if (fieldValue === null || fieldValue === undefined) {
        return evaluatePropertyOperator("", condition.operator, condition.value);
    }

    // Handle objects specially - stringify for comparison
    if (typeof fieldValue === "object" && !Array.isArray(fieldValue)) {
        return evaluatePropertyOperator(JSON.stringify(fieldValue), condition.operator, condition.value);
    }

    return evaluatePropertyOperator(fieldValue, condition.operator, condition.value);
}
