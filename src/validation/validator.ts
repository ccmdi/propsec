import { App, TFile } from "obsidian";
import { PropsecSettings, SchemaMapping, SchemaField, Violation, OBSIDIAN_NATIVE_PROPERTIES } from "../types";
import { ViolationStore } from "./store";
import { validateFrontmatter } from "./validate";
import { validationContext } from "./context";
import { fileMatchesQuery, fileMatchesPropertyFilter } from "../query/matcher";
import { queryContext } from "../query/context";
import { debug } from "../debug";
import { buildLowerKeyMap, lookupKey } from "../utils/object";

const BATCH_SIZE = 50;

function yieldToMain(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Hooks for cache integration (optional, called if set)
 */
export interface ValidatorHooks {
    onFileValidated?: (file: TFile, schemaIds: string[], violations: Violation[]) => void;
    onSchemaValidated?: (schema: SchemaMapping) => void;
    onCleared?: () => void;
}

/**
 * Core validation engine
 */
export class Validator {
    private app: App;
    private store: ViolationStore;
    private settings: () => PropsecSettings;

    hooks: ValidatorHooks = {};

    constructor(
        app: App,
        store: ViolationStore,
        settings: () => PropsecSettings
    ) {
        this.app = app;
        this.store = store;
        this.settings = settings;
    }

    /**
     * Check if a file is excluded by global exclusion rules
     */
    private isFileGloballyExcluded(file: TFile): boolean {
        const exclusions = this.settings().globalExclusions;
        if (!exclusions) return false;
        return fileMatchesQuery(this.app, file, exclusions);
    }

    /**
     * Check if a file matches a schema mapping
     */
    private fileMatchesMapping(file: TFile, mapping: SchemaMapping): boolean {
        if (!mapping.enabled || !mapping.query) return false;
        if (this.isFileGloballyExcluded(file)) return false;
        if (!fileMatchesQuery(this.app, file, mapping.query)) return false;
        if (mapping.propertyFilter && !fileMatchesPropertyFilter(this.app, file, mapping.propertyFilter)) return false;
        return true;
    }

    /**
     * Get all schema mappings that match a file (accumulation model)
     */
    getMatchingSchemas(file: TFile): SchemaMapping[] {
        const settings = this.settings();
        return settings.schemaMappings.filter(m => this.fileMatchesMapping(file, m));
    }

    /**
     * Get the first matching schema (for backwards compatibility)
     */
    getMatchingSchema(file: TFile): SchemaMapping | null {
        const matches = this.getMatchingSchemas(file);
        return matches.length > 0 ? matches[0] : null;
    }

    /**
     * Validate a single file against a specific schema
     * Accumulates violations - doesn't overwrite other schemas' violations
     */
    validateFile(file: TFile, mapping: SchemaMapping): Violation[] {
        const settings = this.settings();
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;

        validationContext.setCustomTypes(settings.customTypes);

        let violations = validateFrontmatter(frontmatter, mapping, file.path, {
            checkUnknownFields: settings.warnOnUnknownFields,
        });

        if (settings.allowObsidianProperties) {
            violations = violations.filter(v =>
                v.type !== "unknown_field" || !OBSIDIAN_NATIVE_PROPERTIES.includes(v.field)
            );
        }

        // Remove old violations from this schema for this file, then add new ones
        this.store.removeFileSchemaViolations(file.path, mapping.id);
        this.store.addFileViolations(file.path, violations);

        return violations;
    }

    /**
     * Validate a single file against ALL matching schemas (accumulation model)
     * Used when a file changes
     */
    validateFileAllSchemas(file: TFile): void {
        // Remove all existing violations for this file
        this.store.removeFile(file.path);

        // Validate against all matching schemas
        const matchingSchemas = this.getMatchingSchemas(file);
        for (const schema of matchingSchemas) {
            this.validateFile(file, schema);
        }

        // Re-validate unique constraints for schemas that have them
        // This is needed because the file's value change might affect other files
        for (const schema of matchingSchemas) {
            if (schema.fields.some(f => f.unique === true)) {
                this.revalidateSchemaUniqueConstraints(schema);
            }
        }

        this.hooks.onFileValidated?.(
            file,
            matchingSchemas.map(s => s.id),
            this.store.getFileViolations(file.path)
        );
    }

    /**
     * Re-validate unique constraints for a schema
     * Clears existing duplicate_value violations and re-checks using incremental approach
     */
    private revalidateSchemaUniqueConstraints(mapping: SchemaMapping): void {
        if (!mapping.enabled || !mapping.query) return;

        const uniqueFields = mapping.fields.filter(f => f.unique === true);
        if (uniqueFields.length === 0) return;

        // Get all files matching this schema
        const candidateFiles = queryContext.index.getFilesForQuery(mapping.query);
        const matchedFiles: TFile[] = [];

        for (const file of candidateFiles) {
            if (this.isFileGloballyExcluded(file)) continue;
            if (mapping.propertyFilter && !fileMatchesPropertyFilter(this.app, file, mapping.propertyFilter)) {
                continue;
            }
            // Remove existing duplicate_value violations for this file/schema
            this.store.removeFileSchemaViolationsByType(file.path, mapping.id, "duplicate_value");
            matchedFiles.push(file);
        }

        // Re-run unique validation using incremental approach
        const seenValues = new Map<string, TFile[]>();
        for (const file of matchedFiles) {
            this.checkUniqueConstraintsIncremental(file, mapping, uniqueFields, seenValues);
        }

        // Fire hooks after all files processed - violations are now complete
        for (const file of matchedFiles) {
            this.hooks.onFileValidated?.(
                file,
                this.getMatchingSchemas(file).map(s => s.id),
                this.store.getFileViolations(file.path)
            );
        }
    }

    /**
     * Validate all files that match a schema mapping's query
     * Uses QueryIndex for efficient file lookup instead of scanning all files
     */
    async validateMapping(mapping: SchemaMapping): Promise<void> {
        if (!mapping.enabled || !mapping.query) return;

        // Get files that match the query using the index (fast!)
        const candidateFiles = queryContext.index.getFilesForQuery(mapping.query);

        // Track unique field values incrementally: "fieldName:normalizedValue" -> files with that value
        const uniqueFields = mapping.fields.filter(f => f.unique === true);
        const seenValues = new Map<string, TFile[]>();

        // Collect all processed files - we fire hooks at the end so duplicate violations are complete
        const processedFiles: TFile[] = [];

        let processed = 0;
        for (const file of candidateFiles) {
            if (this.isFileGloballyExcluded(file)) continue;
            if (mapping.propertyFilter && !fileMatchesPropertyFilter(this.app, file, mapping.propertyFilter)) {
                continue;
            }

            this.validateFile(file, mapping);
            this.checkUniqueConstraintsIncremental(file, mapping, uniqueFields, seenValues);
            processedFiles.push(file);

            processed++;
            if (processed % BATCH_SIZE === 0) {
                await yieldToMain();
            }
        }

        // Fire hooks after all files processed - violations (including duplicates) are now complete
        for (const file of processedFiles) {
            this.hooks.onFileValidated?.(
                file,
                this.getMatchingSchemas(file).map(s => s.id),
                this.store.getFileViolations(file.path)
            );
        }

        this.hooks.onSchemaValidated?.(mapping);
    }

    /**
     * Check unique constraints incrementally as files are processed.
     * Adds duplicate violations to all files with the same value.
     */
    private checkUniqueConstraintsIncremental(
        currentFile: TFile,
        mapping: SchemaMapping,
        uniqueFields: SchemaField[],
        seenValues: Map<string, TFile[]>
    ): void {
        if (uniqueFields.length === 0) return;

        const frontmatter = this.app.metadataCache.getFileCache(currentFile)?.frontmatter;
        if (!frontmatter) return;

        const keyMap = buildLowerKeyMap(frontmatter);

        for (const field of uniqueFields) {
            const actualKey = lookupKey(keyMap, field.name);
            if (!actualKey) continue;

            const value: unknown = frontmatter[actualKey];
            if (value === null || value === undefined) continue;

            const valueStr = this.normalizeValueForUnique(value);
            const mapKey = `${field.name}:${valueStr}`;

            const existingFiles = seenValues.get(mapKey);

            if (!existingFiles) {
                // First occurrence - just track it, no violation
                seenValues.set(mapKey, [currentFile]);
                continue;
            }

            // Duplicate found! Add current file to tracking
            existingFiles.push(currentFile);

            // Update violations for ALL files with this duplicate value
            for (const dupFile of existingFiles) {
                // Remove old violation for this specific field (in case list grew)
                this.store.removeFileSchemaFieldViolationsByType(
                    dupFile.path, mapping.id, field.name, "duplicate_value"
                );

                // Build list of other files (using path for comparison, basename for display)
                const othersExceptThis = existingFiles
                    .filter(f => f.path !== dupFile.path)
                    .map(f => f.basename);

                const violation: Violation = {
                    filePath: dupFile.path,
                    schemaMapping: mapping,
                    field: field.name,
                    type: "duplicate_value",
                    message: `Duplicate value: "${valueStr}" also in: ${othersExceptThis.join(", ")}`,
                    actual: valueStr,
                };
                this.store.addFileViolations(dupFile.path, [violation]);
            }
        }
    }


    /**
     * Normalize a value for unique comparison
     */
    private normalizeValueForUnique(value: unknown): string {
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean") return String(value);
        if (value instanceof Date) return value.toISOString();
        if (Array.isArray(value)) return JSON.stringify(value.sort());
        if (typeof value === "object" && value !== null) return JSON.stringify(value) ?? "";
        return String(value);
    }

    /**
     * Validate all notes across all schema mappings
     */
    async validateAll(): Promise<void> {
        const startTime = performance.now();

        this.store.beginBatch();
        try {
            this.store.clear();
            this.hooks.onCleared?.();

            for (const mapping of this.settings().schemaMappings) {
                await this.validateMapping(mapping);
            }

            this.store.setLastFullValidation(Date.now());
            debug(`Full validation completed in ${(performance.now() - startTime).toFixed(1)}ms`);
        } finally {
            this.store.endBatch();
        }
    }

    /**
     * Re-validate all files affected by a specific schema mapping
     * (used when schema is edited or toggled)
     */
    async revalidateMapping(mappingId: string): Promise<void> {
        // Remove all violations from this schema
        this.store.removeSchemaViolations(mappingId);

        // Re-validate if schema exists and is enabled
        const mapping = this.settings().schemaMappings.find((m) => m.id === mappingId);
        if (mapping) {
            await this.validateMapping(mapping);
        }
    }
}
