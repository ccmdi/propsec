// Core type definitions for Frontmatter Linter

// Built-in primitive types
export type PrimitiveFieldType =
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "array"
    | "object"
    | "unknown";

// FieldType can be a primitive or a custom type name
export type FieldType = string;

// Helper function to check if a type is a built-in primitive
export function isPrimitiveType(type: string): type is PrimitiveFieldType {
    return ["string", "number", "boolean", "date", "array", "object", "unknown"].includes(type);
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

export interface ArrayConstraints {
    minItems?: number;
    maxItems?: number;
    contains?: string[];  // Array must contain all these values
}

export interface ObjectConstraints {
    // Top-level only: require specific keys to exist
    requiredKeys?: string[];
}

export interface SchemaField {
    name: string;
    type: FieldType;
    required: boolean;
    // Warn if missing (mutually exclusive with required - either warn or required, not both)
    warn?: boolean;
    // Allow null/empty as valid (for "array OR null" scenarios)
    allowEmpty?: boolean;

    // For arrays: specify what type the elements should be
    arrayElementType?: FieldType;

    // For objects: specify key and value types
    objectKeyType?: FieldType;      // Usually "string"
    objectValueType?: FieldType;    // Can be any type

    // Optional constraints based on type
    stringConstraints?: StringConstraints;
    numberConstraints?: NumberConstraints;
    arrayConstraints?: ArrayConstraints;
    objectConstraints?: ObjectConstraints;
}

// Property filter for fine-grained schema application
export interface PropertyFilter {
    // Filter by file dates
    modifiedAfter?: string;   // ISO date: only files modified after this date
    modifiedBefore?: string;  // ISO date: only files modified before this date
    createdAfter?: string;    // ISO date: only files created after this date
    createdBefore?: string;   // ISO date: only files created before this date
    // Filter by frontmatter property existence/value
    hasProperty?: string;     // Property must exist (any value)
    notHasProperty?: string;  // Property must NOT exist
    propertyEquals?: { key: string; value: string };  // Property must equal value
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
};

export type ViolationType =
    | "missing_required"
    | "missing_warned"
    | "type_mismatch"
    | "unknown_field"
    | "pattern_mismatch"
    | "string_too_short"
    | "string_too_long"
    | "number_too_small"
    | "number_too_large"
    | "array_too_few"
    | "array_too_many"
    | "array_missing_value"
    | "object_missing_key";

export interface Violation {
    filePath: string;
    schemaMapping: SchemaMapping;
    field: string;
    type: ViolationType;
    message: string;
    expected?: string;
    actual?: string;
}

export interface ValidationState {
    violations: Map<string, Violation[]>;
    lastFullValidation: number;
}
