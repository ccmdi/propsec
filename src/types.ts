// Core type definitions for Frontmatter Linter

// Import operator types from centralized module
import type {
    ComparisonOperator,
    PropertyOperator,
} from "./operators";

// Built-in primitive types
export type PrimitiveFieldType =
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "array"
    | "object"
    | "null"
    | "unknown";

// FieldType can be a primitive or a custom type name
export type FieldType = string;

// Helper function to check if a type is a built-in primitive
export function isPrimitiveType(type: string): type is PrimitiveFieldType {
    return ["string", "number", "boolean", "date", "array", "object", "null", "unknown"].includes(type);
}

// Type definition - user-defined reusable types
export interface CustomType {
    id: string;        // UUID for stable references
    name: string;      // Type name (e.g., "exercise", "person")
    fields: SchemaField[];  // Schema-like field definitions
}

// Constraint types for different field types
export interface StringConstraints {
    pattern?: string;      // Regex pattern
    minLength?: number;
    maxLength?: number;
}

export interface NumberConstraints {
    min?: number;
    max?: number;
}

export interface DateConstraints {
    min?: string;  // ISO date string YYYY-MM-DD
    max?: string;  // ISO date string YYYY-MM-DD
}

// Cross-field constraint: compare this field's value to another field's value
export interface CrossFieldConstraint {
    operator: ComparisonOperator;
    field: string;  // The other field to compare against
}

export interface ArrayConstraints {
    minItems?: number;
    maxItems?: number;
    contains?: string[];  // Array must contain all these values
}

export interface SchemaField {
    name: string;
    type: FieldType;
    required: boolean;
    // Warn if missing (mutually exclusive with required - either warn or required, not both)
    //TODO discrim union
    warn?: boolean;
    // Value must be unique across all files matching the schema
    unique?: boolean;

    // Conditional validation: only validate this field if ALL conditions are met
    conditions?: FieldCondition[];

    // For arrays: specify what type the elements should be
    arrayElementType?: FieldType;

    // For objects: specify key and value types
    objectKeyType?: FieldType;      // Usually "string"
    objectValueType?: FieldType;    // Can be any type

    // Optional constraints based on type
    stringConstraints?: StringConstraints;
    numberConstraints?: NumberConstraints;
    dateConstraints?: DateConstraints;
    arrayConstraints?: ArrayConstraints;

    // Cross-field constraint: compare this field to another field
    crossFieldConstraint?: CrossFieldConstraint;
}

// A single property condition
export interface PropertyCondition {
    property: string;
    operator: PropertyOperator;
    value: string;
}

// Condition for when a field should be validated (e.g., "if type=book then isbn is required")
export interface FieldCondition {
    field: string;  // The field to check (e.g., "type")
    operator: PropertyOperator;
    value: string;  // The value to compare (e.g., "book")
}

// Property filter for fine-grained schema application
export interface PropertyFilter {
    // Filter by file name
    fileNamePattern?: string; // Regex pattern to match against file name (without extension)
    // Filter by file dates
    modifiedAfter?: string;   // ISO date: only files modified after this date
    modifiedBefore?: string;  // ISO date: only files modified before this date
    createdAfter?: string;    // ISO date: only files created after this date
    createdBefore?: string;   // ISO date: only files created before this date
    // Filter by frontmatter property existence/value
    hasProperty?: string;     // Property must exist (any value)
    notHasProperty?: string;  // Property must NOT exist
    // Multiple property conditions (AND logic)
    conditions?: PropertyCondition[];
}

export interface SchemaMapping {
    id: string;
    name: string;
    sourceTemplatePath: string | null;
    // Query syntax: "folder", "folder/*", "#tag", "folder/* or #tag"
    query: string;
    enabled: boolean;
    fields: SchemaField[];
    // Optional property-based filter for fine-grained control
    propertyFilter?: PropertyFilter;
}

export interface PropsecSettings {
    templatesFolder: string;
    schemaMappings: SchemaMapping[];
    customTypes: CustomType[];  // User-defined reusable types
    warnOnUnknownFields: boolean;
    allowObsidianProperties: boolean;  // Don't warn about aliases, tags, cssclasses
    validateOnFileOpen: boolean;
    validateOnFileSave: boolean;
    showInStatusBar: boolean;
    colorStatusBarErrors: boolean;
    excludeWarningsFromCount: boolean;  // Don't count warnings in status bar violation count
    enablePropertySuggestions: boolean;  // Show property autocomplete in schema editor
}

// Obsidian's reserved frontmatter keys
export const OBSIDIAN_NATIVE_PROPERTIES = ["aliases", "tags", "cssclasses", "cssclass"];

export const DEFAULT_SETTINGS: PropsecSettings = {
    templatesFolder: "",
    schemaMappings: [],
    customTypes: [],
    warnOnUnknownFields: true,
    allowObsidianProperties: true,
    validateOnFileOpen: true,
    validateOnFileSave: true,
    showInStatusBar: true,
    colorStatusBarErrors: true,
    excludeWarningsFromCount: true,
    enablePropertySuggestions: true,
};

export type ViolationType =
    | "missing_required"
    | "missing_warned"
    | "type_mismatch"
    | "type_mismatch_warned"
    | "unknown_field"
    | "pattern_mismatch"
    | "string_too_short"
    | "string_too_long"
    | "number_too_small"
    | "number_too_large"
    | "date_too_early"
    | "date_too_late"
    | "array_too_few"
    | "array_too_many"
    | "array_missing_value"
    | "object_missing_key"
    | "duplicate_value"
    | "cross_field_violation";

export interface Violation {
    filePath: string;
    schemaMapping: SchemaMapping;
    field: string;
    type: ViolationType;
    message: string;
    expected?: string;
    actual?: string;
}

// Warning types are violations that are informational rather than errors
export const WARNING_VIOLATION_TYPES: ViolationType[] = [
    "missing_warned",
    "type_mismatch_warned",
    "unknown_field",
];

/**
 * Check if a violation is a warning (vs an error)
 */
export function isWarningViolation(violation: Violation): boolean {
    return WARNING_VIOLATION_TYPES.includes(violation.type);
}

// Filter type for violation views
export type ViolationFilter = "all" | "errors" | "warnings";

export interface ValidationState {
    violations: Map<string, Violation[]>;
    lastFullValidation: number;
}
