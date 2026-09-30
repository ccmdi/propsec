import { App, TFile } from "obsidian";
import {
    Schema,
    Violation,
    CompiledSchema,
    FileMeta,
    Program,
    MALFORMED_SCHEMA,
    compile,
    malformedViolation,
} from "@propsec/core";
import { ViolationStore } from "./store";
import { toFileMeta } from "../adapter";
import { debug } from "../debug";
import type { PropsecSettings } from "../data";

const BATCH_SIZE = 50;

function yieldToMain(): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, 0));
}

/**
 * Hooks for cache integration (optional, called if set)
 */
export interface ValidatorHooks {
    onFileValidated?: (file: TFile, schemaIds: string[], violations: Violation[]) => void;
    onSchemaValidated?: (schema: Schema) => void;
    onCleared?: () => void;
}

/**
 * Core validation engine
 */
export class Validator {
    private app: App;
    private store: ViolationStore;
    private settings: () => PropsecSettings;
    private program: Program;

    hooks: ValidatorHooks = {};

    constructor(
        app: App,
        store: ViolationStore,
        settings: () => PropsecSettings
    ) {
        this.app = app;
        this.store = store;
        this.settings = settings;
        this.program = compile(settings());
    }

    /**
     * Recompile the rule program from the current settings
     */
    recompile(): void {
        this.program = compile(this.settings());
    }

    /**
     * Get all compiled schemas that match a file (accumulation model)
     */
    getMatchingSchemas(file: TFile): CompiledSchema[] {
        const meta = toFileMeta(this.app, file);
        return this.program.schemas.filter(s => s.matches(meta));
    }

    /**
     * Files that a schema would apply to, whether or not it is enabled
     */
    filesMatching(candidate: Schema): TFile[] {
        const [schema] = compile({ ...this.settings(), schemas: [{ ...candidate, enabled: true }] }).schemas;
        return this.matchedFiles(schema).map(m => m.file);
    }

    /**
     * Validate a single file against a specific schema
     * Accumulates violations - doesn't overwrite other schemas' violations
     */
    private validateFile(meta: FileMeta, schema: CompiledSchema): void {
        this.store.removeFileSchemaViolations(meta.path, schema.schema.id);
        this.store.addFileViolations(meta.path, schema.check(meta));
    }

    /**
     * Validate a single file against ALL matching schemas (accumulation model)
     * Used when a file changes
     */
    validateFileAllSchemas(file: TFile): void {
        // Remove all existing violations for this file
        this.store.removeFile(file.path);

        const meta = toFileMeta(this.app, file);
        const matchingSchemas = this.program.schemas.filter(s => s.matches(meta));
        for (const schema of matchingSchemas) {
            this.validateFile(meta, schema);
        }

        // Re-validate unique constraints for schemas that have them
        // This is needed because the file's value change might affect other files
        for (const schema of matchingSchemas) {
            if (schema.schema.fields.some(f => f.unique === true)) {
                this.revalidateSchemaUniqueConstraints(schema);
            }
        }

        this.hooks.onFileValidated?.(
            file,
            matchingSchemas.map(s => s.schema.id),
            this.store.getFileViolations(file.path)
        );

        // Re-check malformed frontmatter (added after hook to stay out of cache)
        this.recheckMalformedFrontmatter(file);
    }

    /**
     * Markdown files a schema applies to, paired with their metadata
     */
    private matchedFiles(schema: CompiledSchema): { file: TFile; meta: FileMeta }[] {
        return this.app.vault.getMarkdownFiles()
            .map(file => ({ file, meta: toFileMeta(this.app, file) }))
            .filter(({ meta }) => schema.matches(meta));
    }

    /**
     * Re-validate unique constraints for a schema.
     * Clears existing duplicate_value violations for matched files, then recomputes them.
     */
    private revalidateSchemaUniqueConstraints(schema: CompiledSchema): void {
        const matched = this.matchedFiles(schema);
        for (const { file } of matched) {
            this.store.removeFileSchemaViolationsByType(file.path, schema.schema.id, "duplicate_value");
        }

        this.applyUniqueViolations(schema, matched.map(m => m.meta));

        // Fire hooks after all files processed - violations are now complete
        for (const { file } of matched) {
            this.hooks.onFileValidated?.(
                file,
                this.getMatchingSchemas(file).map(s => s.schema.id),
                this.store.getFileViolations(file.path)
            );
        }
    }

    /**
     * Validate all files that match a schema
     */
    async validateMapping(mappingId: string): Promise<void> {
        const schema = this.program.schemas.find(s => s.schema.id === mappingId);
        if (!schema) return;

        const matched = this.matchedFiles(schema);

        let processed = 0;
        for (const { meta } of matched) {
            // validateFile clears this schema's violations (incl. duplicate_value) for the file.
            this.validateFile(meta, schema);

            processed++;
            if (processed % BATCH_SIZE === 0) {
                await yieldToMain();
            }
        }

        this.applyUniqueViolations(schema, matched.map(m => m.meta));

        // Fire hooks after all files processed - violations (including duplicates) are now complete
        for (const { file } of matched) {
            this.hooks.onFileValidated?.(
                file,
                this.getMatchingSchemas(file).map(s => s.schema.id),
                this.store.getFileViolations(file.path)
            );
        }

        this.hooks.onSchemaValidated?.(schema.schema);
    }

    /**
     * Cross-file unique: callers are responsible for clearing prior duplicate_value violations first.
     */
    private applyUniqueViolations(schema: CompiledSchema, files: FileMeta[]): void {
        for (const violation of schema.duplicates(files)) {
            this.store.addFileViolations(violation.filePath, [violation]);
        }
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

            for (const schema of this.program.schemas) {
                await this.validateMapping(schema.schema.id);
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
        await this.validateMapping(mappingId);
    }

    /**
     * Scan all markdown files for malformed (unparseable) YAML frontmatter.
     * Results are ephemeral -- added to the store but NOT cached to disk.
     */
    async scanMalformedFrontmatter(): Promise<number> {
        this.store.removeSchemaViolations(MALFORMED_SCHEMA.id);

        const files = this.app.vault.getMarkdownFiles();
        let count = 0;
        let processed = 0;

        for (const file of files) {
            if (this.isMalformedFrontmatter(file)) {
                this.store.addFileViolations(file.path, [malformedViolation(file.path)]);
                count++;
            }
            processed++;
            if (processed % BATCH_SIZE === 0) {
                await yieldToMain();
            }
        }

        return count;
    }

    private isMalformedFrontmatter(file: TFile): boolean {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) return false;
        return (cache.sections?.some(s => s.type === "yaml") ?? false) && !cache.frontmatter;
    }

    private recheckMalformedFrontmatter(file: TFile): void {
        this.store.removeFileSchemaViolations(file.path, MALFORMED_SCHEMA.id);
        if (this.isMalformedFrontmatter(file)) {
            this.store.addFileViolations(file.path, [malformedViolation(file.path)]);
        }
    }
}
