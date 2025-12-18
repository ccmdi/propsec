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
     * Check if a file matches any schema mapping
     */
    getMatchingSchema(file: TFile): SchemaMapping | null {
        const settings = this.settings();

        for (const mapping of settings.schemaMappings) {
            if (this.fileMatchesMapping(file, mapping)) {
                return mapping;
            }
        }
        return null;
    }

    /**
     * Validate a single file against its schema mapping
     */
    validateFile(file: TFile, mapping?: SchemaMapping): Violation[] {
        const schema = mapping || this.getMatchingSchema(file);

        if (!schema) {
            // File doesn't match any schema, clear any existing violations
            this.store.removeFile(file.path);
            return [];
        }

        const settings = this.settings();
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;

        validationContext.setCustomTypes(settings.customTypes);

        let violations = validateFrontmatter(frontmatter, schema, file.path, {
            checkUnknownFields: settings.warnOnUnknownFields,
        });

        if (settings.allowObsidianProperties) {
            violations = violations.filter(v =>
                v.type !== "unknown_field" || !OBSIDIAN_NATIVE_PROPERTIES.includes(v.field)
            );
        }

        // Update store
        this.store.setFileViolations(file.path, violations);

        return violations;
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
     * (used when schema is edited)
     */
    async revalidateMapping(mappingId: string): Promise<void> {
        const settings = this.settings();
        const mapping = settings.schemaMappings.find((m) => m.id === mappingId);

        if (mapping) {
            // Clear violations for files that were in this mapping
            const allViolations = this.store.getAllViolations();
            for (const [filePath, violations] of allViolations) {
                if (violations.some((v) => v.schemaMapping.id === mappingId)) {
                    this.store.removeFile(filePath);
                }
            }

            // Re-validate
            await this.validateMapping(mapping);
        }
    }
}
