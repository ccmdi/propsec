import { App, TFile, TFolder } from "obsidian";
import { FrontmatterLinterSettings, SchemaMapping, Violation } from "../types";
import { ViolationStore } from "./store";
import {
    checkMissingRequired,
    checkTypeMismatches,
    checkUnknownFields,
    checkStringConstraints,
    checkNumberConstraints,
    checkArrayConstraints,
    checkObjectConstraints,
} from "./checks";
import { fileMatchesQuery } from "../query/matcher";

/**
 * Core validation engine for the Frontmatter Linter
 */
export class Validator {
    private app: App;
    private store: ViolationStore;
    private settings: () => FrontmatterLinterSettings;

    constructor(
        app: App,
        store: ViolationStore,
        settings: () => FrontmatterLinterSettings
    ) {
        this.app = app;
        this.store = store;
        this.settings = settings;
    }

    /**
     * Check if a file matches any schema mapping
     */
    getMatchingSchema(file: TFile): SchemaMapping | null {
        const settings = this.settings();

        for (const mapping of settings.schemaMappings) {
            if (!mapping.enabled) continue;
            if (!mapping.query) continue;

            if (fileMatchesQuery(this.app, file, mapping.query)) {
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

        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const violations: Violation[] = [];

        // Check for missing required fields
        violations.push(...checkMissingRequired(frontmatter, schema, file.path));

        // Check for type mismatches
        violations.push(...checkTypeMismatches(frontmatter, schema, file.path));

        // Check for unknown fields (if enabled)
        if (this.settings().warnOnUnknownFields) {
            violations.push(...checkUnknownFields(frontmatter, schema, file.path));
        }

        // Check constraints
        violations.push(...checkStringConstraints(frontmatter, schema, file.path));
        violations.push(...checkNumberConstraints(frontmatter, schema, file.path));
        violations.push(...checkArrayConstraints(frontmatter, schema, file.path));
        violations.push(...checkObjectConstraints(frontmatter, schema, file.path));

        // Update store
        this.store.setFileViolations(file.path, violations);

        return violations;
    }

    /**
     * Validate all files that match a schema mapping's query
     */
    validateMapping(mapping: SchemaMapping): void {
        if (!mapping.enabled) return;
        if (!mapping.query) return;

        // Get all markdown files in the vault
        const allFiles = this.app.vault.getMarkdownFiles();

        for (const file of allFiles) {
            if (fileMatchesQuery(this.app, file, mapping.query)) {
                this.validateFile(file, mapping);
            }
        }
    }

    /**
     * Validate all notes across all schema mappings
     */
    validateAll(): void {
        const settings = this.settings();

        // Clear existing violations
        this.store.clear();

        // Validate each mapping
        for (const mapping of settings.schemaMappings) {
            this.validateMapping(mapping);
        }

        // Update timestamp
        this.store.setLastFullValidation(Date.now());
    }

    /**
     * Re-validate all files affected by a specific schema mapping
     * (used when schema is edited)
     */
    revalidateMapping(mappingId: string): void {
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
            this.validateMapping(mapping);
        }
    }
}
