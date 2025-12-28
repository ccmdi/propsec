/**
 * Centralized operator definitions, metadata, and evaluation functions.
 * This module consolidates all operator-related logic that was previously
 * scattered across types.ts, matcher.ts, validate.ts, and UI components.
 */

// ============ Type Definitions ============

/**
 * Base comparison operators (used for cross-field comparisons)
 */
export type ComparisonOperator =
    | "equals"
    | "not_equals"
    | "greater_than"
    | "less_than"
    | "greater_or_equal"
    | "less_or_equal";

/**
 * Extended operators that include contains/not_contains (used for property conditions)
 */
export type PropertyOperator = ComparisonOperator | "contains" | "not_contains";

// ============ Operator Lists ============

/**
 * All comparison operators (no contains)
 */
export const COMPARISON_OPERATORS: ComparisonOperator[] = [
    "equals",
    "not_equals",
    "greater_than",
    "less_than",
    "greater_or_equal",
    "less_or_equal",
];

/**
 * All property operators (includes contains)
 */
export const PROPERTY_OPERATORS: PropertyOperator[] = [
    ...COMPARISON_OPERATORS,
    "contains",
    "not_contains",
];

// ============ Operator Metadata ============

export interface OperatorInfo {
    value: PropertyOperator;
    label: string;      // UI display label
    symbol: string;     // Short symbol (=, !=, >, etc.)
}

/**
 * Complete metadata for all operators
 */
export const OPERATOR_INFO: Record<PropertyOperator, OperatorInfo> = {
    equals: { value: "equals", label: "equals", symbol: "=" },
    not_equals: { value: "not_equals", label: "not equals", symbol: "!=" },
    greater_than: { value: "greater_than", label: "greater than", symbol: ">" },
    less_than: { value: "less_than", label: "less than", symbol: "<" },
    greater_or_equal: { value: "greater_or_equal", label: ">=", symbol: ">=" },
    less_or_equal: { value: "less_or_equal", label: "<=", symbol: "<=" },
    contains: { value: "contains", label: "contains", symbol: "contains" },
    not_contains: { value: "not_contains", label: "not contains", symbol: "!contains" },
};

/**
 * Get display label for an operator
 */
export function getOperatorDisplayName(operator: PropertyOperator): string {
    return OPERATOR_INFO[operator]?.label ?? operator;
}

/**
 * Get symbol for an operator
 */
export function getOperatorSymbol(operator: PropertyOperator): string {
    return OPERATOR_INFO[operator]?.symbol ?? "?";
}

/**
 * Get cross-field operator display (slightly different wording for error messages)
 */
export function getCrossFieldOperatorDisplay(operator: ComparisonOperator): string {
    switch (operator) {
        case "equals": return "equal to";
        case "not_equals": return "not equal to";
        case "greater_than": return "greater than";
        case "less_than": return "less than";
        case "greater_or_equal": return "greater than or equal to";
        case "less_or_equal": return "less than or equal to";
    }
}

/**
 * Get operator options for UI dropdowns (comparison operators only)
 */
export function getComparisonOperatorOptions(): OperatorInfo[] {
    return COMPARISON_OPERATORS.map(op => OPERATOR_INFO[op]);
}

/**
 * Get operator options for UI dropdowns (all property operators)
 */
export function getPropertyOperatorOptions(): OperatorInfo[] {
    return PROPERTY_OPERATORS.map(op => OPERATOR_INFO[op]);
}

// ============ Operators by Property Type ============

/**
 * Get valid operators for a given Obsidian property type
 */
export function getOperatorsForPropertyType(propertyType: string): PropertyOperator[] {
    switch (propertyType) {
        case "number":
            return ["equals", "not_equals", "greater_than", "less_than", "greater_or_equal", "less_or_equal"];
        case "checkbox":
            return ["equals", "not_equals"];
        case "date":
        case "datetime":
            return ["equals", "not_equals", "greater_than", "less_than", "greater_or_equal", "less_or_equal"];
        case "tags":
        case "aliases":
        case "multitext":
            return ["contains", "not_contains", "equals", "not_equals"];
        case "text":
        default:
            return ["equals", "not_equals", "contains", "not_contains"];
    }
}

// ============ Comparison Functions ============

/**
 * Compare two numbers using the given operator
 */
export function compareNumbers(a: number, b: number, operator: ComparisonOperator): boolean {
    switch (operator) {
        case "equals": return a === b;
        case "not_equals": return a !== b;
        case "greater_than": return a > b;
        case "less_than": return a < b;
        case "greater_or_equal": return a >= b;
        case "less_or_equal": return a <= b;
    }
}

/**
 * Compare two dates (as timestamps) using the given operator
 */
export function compareDates(a: number, b: number, operator: ComparisonOperator): boolean {
    return compareNumbers(a, b, operator);
}

/**
 * Compare two strings using the given operator
 */
export function compareStrings(a: string, b: string, operator: ComparisonOperator): boolean {
    switch (operator) {
        case "equals": return a === b;
        case "not_equals": return a !== b;
        case "greater_than": return a > b;
        case "less_than": return a < b;
        case "greater_or_equal": return a >= b;
        case "less_or_equal": return a <= b;
    }
}

/**
 * Evaluate a property operator against a value and comparison value.
 * Handles equals, not_equals, contains, not_contains, and numeric comparisons.
 */
export function evaluatePropertyOperator(
    propValue: unknown,
    operator: PropertyOperator,
    compareValue: string
): boolean {
    // Handle contains/not_contains operators
    if (operator === "contains") {
        if (Array.isArray(propValue)) {
            return propValue.some(v => String(v) === compareValue);
        }
        return String(propValue).includes(compareValue);
    }

    if (operator === "not_contains") {
        if (Array.isArray(propValue)) {
            return !propValue.some(v => String(v) === compareValue);
        }
        return !String(propValue).includes(compareValue);
    }

    // Handle equals/not_equals as string comparison
    if (operator === "equals") {
        return String(propValue) === compareValue;
    }

    if (operator === "not_equals") {
        return String(propValue) !== compareValue;
    }

    // Handle numeric comparison operators
    return evaluateNumericComparison(propValue, operator, compareValue);
}

/**
 * Evaluate numeric comparison operators (>, <, >=, <=).
 * Falls back to date comparison if numeric parsing fails.
 */
export function evaluateNumericComparison(
    propValue: unknown,
    operator: ComparisonOperator,
    compareValue: string
): boolean {
    // Try to parse both as numbers
    const numProp = typeof propValue === "number" ? propValue : parseFloat(String(propValue));
    const numCompare = parseFloat(compareValue);

    // If either isn't a valid number, try date comparison
    if (isNaN(numProp) || isNaN(numCompare)) {
        const dateProp = new Date(String(propValue)).getTime();
        const dateCompare = new Date(compareValue).getTime();

        if (!isNaN(dateProp) && !isNaN(dateCompare)) {
            return compareNumbers(dateProp, dateCompare, operator);
        }
        return false;
    }

    return compareNumbers(numProp, numCompare, operator);
}

// ============ Cross-Field Comparison ============

/**
 * Compare two values for cross-field constraints.
 * Attempts numeric comparison first, then date, then string.
 */
export function compareCrossFieldValues(
    value: unknown,
    otherValue: unknown,
    operator: ComparisonOperator
): boolean | null {
    // Try numeric comparison first
    const numA = toNumber(value);
    const numB = toNumber(otherValue);

    if (numA !== null && numB !== null) {
        return compareNumbers(numA, numB, operator);
    }

    // Try date comparison
    const dateA = toDate(value);
    const dateB = toDate(otherValue);

    if (dateA !== null && dateB !== null) {
        return compareDates(dateA.getTime(), dateB.getTime(), operator);
    }

    // Fall back to string comparison
    return compareStrings(String(value), String(otherValue), operator);
}

// ============ Value Conversion Helpers ============

function toNumber(value: unknown): number | null {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        // Only treat as number if the entire string is a valid number
        // This prevents date strings like "2024-12-31" from being parsed as 2024
        const trimmed = value.trim();
        if (trimmed === "" || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
            return null;
        }
        const num = parseFloat(trimmed);
        return isNaN(num) ? null : num;
    }
    return null;
}

function toDate(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === "string") {
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date;
    }
    return null;
}
