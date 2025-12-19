import { App, TFile } from "obsidian";
import { PropsecSettings, SchemaMapping, Violation, OBSIDIAN_NATIVE_PROPERTIES } from "../types";
import { ViolationStore } from "./store";
import { validateFrontmatter } from "./validate";
import { validationContext } from "./context";
import { fileMatchesQuery, fileMatchesPropertyFilter } from "../query/matcher";
import { queryContext } from "../query/context";

const BATCH_SIZE = 50;

function yieldToMain(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Core validation engine for the Frontmatter Linter
 */
export class Validator {
    private app: App;
    private store: ViolationStore;
    private settings: () => PropsecSettings;

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
     * Check if a file matches a schema mapping
     */
    private fileMatchesMapping(file: TFile, mapping: SchemaMapping): boolean {
        if (!mapping.enabled || !mapping.query) return false;
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
    }

    /**
     * Validate all files that match a schema mapping's query
     * Uses QueryIndex for efficient file lookup instead of scanning all files
     */
    async validateMapping(mapping: SchemaMapping): Promise<void> {
        if (!mapping.enabled || !mapping.query) return;

        // Get files that match the query using the index (fast!)
        const candidateFiles = queryContext.index.getFilesForQuery(mapping.query);

        let processed = 0;
        for (const file of candidateFiles) {
            // Apply property filter if present
            if (mapping.propertyFilter && !fileMatchesPropertyFilter(this.app, file, mapping.propertyFilter)) {
                continue;
            }
            this.validateFile(file, mapping);
            processed++;
            if (processed % BATCH_SIZE === 0) {
                await yieldToMain();
            }
        }
    }

    /**
     * Validate all notes across all schema mappings
     */
    async validateAll(): Promise<void> {
        const settings = this.settings();

        // Clear existing violations
        this.store.clear();

        // Validate each mapping
        for (const mapping of settings.schemaMappings) {
            await this.validateMapping(mapping);
        }

        // Update timestamp
        this.store.setLastFullValidation(Date.now());
    }

    /**
     * Re-validate all files affected by a specific schema mapping
     * (used when schema is edited or toggled)
     */
    async revalidateMapping(mappingId: string): Promise<void> {
        // Remove all violations from this schema
        this.store.removeSchemaViolations(mappingId);

        // Re-validate if schema exists and is enabled
        const settings = this.settings();
        const mapping = settings.schemaMappings.find((m) => m.id === mappingId);
        if (mapping) {
            await this.validateMapping(mapping);
        }
    }
}
