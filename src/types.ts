// Core type definitions for Frontmatter Linter

export type FieldType =
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "array"
    | "object"
    | "unknown";

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
    // Allow null/empty as valid (for "array OR null" scenarios)
    allowEmpty?: boolean;
    // Optional constraints based on type
    stringConstraints?: StringConstraints;
    numberConstraints?: NumberConstraints;
    arrayConstraints?: ArrayConstraints;
    objectConstraints?: ObjectConstraints;
}

export interface SchemaMapping {
    id: string;
    name: string;
    sourceTemplatePath: string | null;
    // Query syntax: "folder", "folder/*", "#tag", "folder/* or #tag"
    query: string;
    enabled: boolean;
    fields: SchemaField[];
}

export interface PropsecSettings {
    templatesFolder: string;
    schemaMappings: SchemaMapping[];
    warnOnUnknownFields: boolean;
    validateOnFileOpen: boolean;
    validateOnFileSave: boolean;
    showInStatusBar: boolean;
    colorStatusBarErrors: boolean;
}

export const DEFAULT_SETTINGS: PropsecSettings = {
    templatesFolder: "",
    schemaMappings: [],
    warnOnUnknownFields: true,
    validateOnFileOpen: true,
    validateOnFileSave: true,
    showInStatusBar: true,
    colorStatusBarErrors: true,
};

export type ViolationType =
    | "missing_required"
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
