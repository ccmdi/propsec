import { App, TFile } from "obsidian";
import { CustomType, PropsecSettings, SchemaField, SchemaMapping, Violation, ViolationType } from "../types";
import { debug } from "../debug";

/**
 * Serializable violation (stores schemaId instead of full schema)
 */
interface CachedViolation {
    filePath: string;
    schemaId: string;
    field: string;
    type: ViolationType;
    message: string;
    expected?: string;
    actual?: string;
}

/**
 * Per-file cache entry
 */
interface CachedFileData {
    mtime: number;              // file.stat.mtime when validated
    schemaIds: string[];        // Which schemas matched this file
    violations: CachedViolation[];
}

/**
 * Full cache structure persisted to disk
 */
interface ValidationCacheData {
    version: number;
    schemaHashes: Record<string, string>;  // schemaId → hash
    settingsHash: string;                   // hash of relevant settings
    files: Record<string, CachedFileData>; // filePath → cache data
}

const CACHE_VERSION = 1;

/**
 * Simple string hash function (djb2)
 */
function hashString(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}

/**
 * Get all custom types referenced by a schema's fields (recursively)
 */
function getReferencedCustomTypes(
    fields: SchemaField[],
    allCustomTypes: CustomType[],
    visited: Set<string> = new Set()
): CustomType[] {
    const result: CustomType[] = [];
    const typeMap = new Map(allCustomTypes.map(t => [t.name, t]));

    function collectTypes(fieldList: SchemaField[]): void {
        for (const field of fieldList) {
            // Check field type
            const customType = typeMap.get(field.type);
            if (customType && !visited.has(customType.name)) {
                visited.add(customType.name);
                result.push(customType);
                // Recursively check this custom type's fields
                collectTypes(customType.fields);
            }

            // Check array element type
            if (field.arrayElementType) {
                const arrayCustomType = typeMap.get(field.arrayElementType);
                if (arrayCustomType && !visited.has(arrayCustomType.name)) {
                    visited.add(arrayCustomType.name);
                    result.push(arrayCustomType);
                    collectTypes(arrayCustomType.fields);
                }
            }
        }
    }

    collectTypes(fields);
    return result;
}

/**
 * Hash a schema including its referenced custom types
 */
function hashSchema(schema: SchemaMapping, customTypes: CustomType[]): string {
    const referencedTypes = getReferencedCustomTypes(schema.fields, customTypes);

    const toHash = {
        fields: schema.fields,
        query: schema.query,
        enabled: schema.enabled,
        propertyFilter: schema.propertyFilter,
        // Include full definitions of referenced custom types
        customTypes: referencedTypes.map(t => ({
            name: t.name,
            fields: t.fields
        }))
    };

    return hashString(JSON.stringify(toHash));
}

/**
 * Hash the settings that affect validation
 */
function hashSettings(settings: PropsecSettings): string {
    const toHash = {
        warnOnUnknownFields: settings.warnOnUnknownFields,
        allowObsidianProperties: settings.allowObsidianProperties,
    };
    return hashString(JSON.stringify(toHash));
}

/**
 * Convert a Violation to a CachedViolation (for serialization)
 */
function toCachedViolation(v: Violation): CachedViolation {
    return {
        filePath: v.filePath,
        schemaId: v.schemaMapping.id,
        field: v.field,
        type: v.type,
        message: v.message,
        expected: v.expected,
        actual: v.actual,
    };
}

/**
 * Convert a CachedViolation back to a Violation
 */
function fromCachedViolation(
    cached: CachedViolation,
    schemaMap: Map<string, SchemaMapping>
): Violation | null {
    const schema = schemaMap.get(cached.schemaId);
    if (!schema) return null; // Schema was deleted

    return {
        filePath: cached.filePath,
        schemaMapping: schema,
        field: cached.field,
        type: cached.type,
        message: cached.message,
        expected: cached.expected,
        actual: cached.actual,
    };
}

/**
 * Validation cache manager
 * Persists validation results to disk and intelligently invalidates on changes
 */
export class ValidationCache {
    private app: App;
    private settings: () => PropsecSettings;
    private cachePath: string;
    private data: ValidationCacheData;
    private dirty: boolean = false;
    private saveTimeout: NodeJS.Timeout | null = null;

    constructor(app: App, pluginId: string, settings: () => PropsecSettings) {
        this.app = app;
        this.settings = settings;
        this.cachePath = `${app.vault.configDir}/plugins/${pluginId}/validation-cache.json`;
        this.data = this.emptyCache();
    }

    private emptyCache(): ValidationCacheData {
        return {
            version: CACHE_VERSION,
            schemaHashes: {},
            settingsHash: "",
            files: {},
        };
    }

    /**
     * Load cache from disk
     */
    async load(): Promise<boolean> {
        try {
            const startTime = performance.now();
            const raw = await this.app.vault.adapter.read(this.cachePath);
            const readTime = performance.now();

            const parsed = JSON.parse(raw) as ValidationCacheData;
            const parseTime = performance.now();

            if (parsed.version !== CACHE_VERSION) {
                debug("Cache version mismatch, starting fresh");
                return false;
            }

            this.data = parsed;
            const fileCount = Object.keys(this.data.files).length;
            debug(`Loaded cache: ${fileCount} files, read=${(readTime - startTime).toFixed(1)}ms, parse=${(parseTime - readTime).toFixed(1)}ms`);
            return true;
        } catch {
            // File doesn't exist or is corrupted
            return false;
        }
    }

    /**
     * Save cache to disk (debounced)
     */
    private scheduleSave(): void {
        this.dirty = true;
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(() => {
            void this.saveToDisk();
        }, 2000);
    }

    /**
     * Save cache to disk immediately
     */
    async saveToDisk(): Promise<void> {
        if (!this.dirty) return;

        try {
            await this.app.vault.adapter.write(
                this.cachePath,
                JSON.stringify(this.data)
            );
            this.dirty = false;
            debug("Propsec: Saved validation cache");
        } catch (e) {
            console.error("Propsec: Failed to save validation cache", e);
        }
    }

    /**
     * Force save on plugin unload
     */
    async flush(): Promise<void> {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        await this.saveToDisk();
    }

    /**
     * Load cached violations optimistically (for preload before vault is ready).
     * Does NOT check mtimes or file existence - just loads what's cached.
     */
    loadCachedViolations(): Violation[] {
        const settings = this.settings();
        const schemaMap = new Map(settings.schemaMappings.map(s => [s.id, s]));

        const violations: Violation[] = [];
        for (const fileData of Object.values(this.data.files)) {
            for (const cached of fileData.violations) {
                const v = fromCachedViolation(cached, schemaMap);
                if (v) violations.push(v);
            }
        }
        return violations;
    }

    /**
     * Determine what needs to be revalidated based on current settings vs cached state.
     * Call this AFTER vault is ready (e.g., on layout ready).
     */
    analyzeCache(): {
        filesToRevalidate: Set<string>;
        schemasToRevalidate: Set<string>;
        fullRevalidationNeeded: boolean;
    } {
        const settings = this.settings();
        const currentSettingsHash = hashSettings(settings);
        const schemaMap = new Map(settings.schemaMappings.map(s => [s.id, s]));

        // Check if global settings changed
        if (this.data.settingsHash !== currentSettingsHash) {
            debug("Settings changed, full revalidation needed");
            this.data = this.emptyCache();
            this.data.settingsHash = currentSettingsHash;
            return {
                filesToRevalidate: new Set(),
                schemasToRevalidate: new Set(),
                fullRevalidationNeeded: true,
            };
        }

        // Find schemas with changed hashes
        const invalidSchemaIds = new Set<string>();
        const currentSchemaHashes: Record<string, string> = {};

        for (const schema of settings.schemaMappings) {
            const currentHash = hashSchema(schema, settings.customTypes);
            currentSchemaHashes[schema.id] = currentHash;

            if (this.data.schemaHashes[schema.id] !== currentHash) {
                invalidSchemaIds.add(schema.id);
                debug(`Propsec: Schema "${schema.name}" changed, will revalidate`);
            }
        }

        // Check for deleted schemas
        for (const cachedSchemaId of Object.keys(this.data.schemaHashes)) {
            if (!schemaMap.has(cachedSchemaId)) {
                invalidSchemaIds.add(cachedSchemaId);
                debug(`Propsec: Schema ${cachedSchemaId} deleted`);
            }
        }

        // Update stored hashes
        this.data.schemaHashes = currentSchemaHashes;
        this.dirty = true;

        // Process cached files - check which need revalidation
        const filesToRevalidate = new Set<string>();
        const filesToRemove: string[] = [];

        for (const [filePath, fileData] of Object.entries(this.data.files)) {
            // Check if file still exists and mtime matches
            const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
            if (!(abstractFile instanceof TFile)) {
                // File was deleted
                filesToRemove.push(filePath);
                continue;
            }
            if (abstractFile.stat.mtime !== fileData.mtime) {
                // File was modified externally
                filesToRevalidate.add(filePath);
                filesToRemove.push(filePath);
                continue;
            }

            // Check if any of this file's schemas are invalidated
            if (fileData.schemaIds.some(id => invalidSchemaIds.has(id))) {
                filesToRevalidate.add(filePath);
                filesToRemove.push(filePath);
            }
        }

        // Clean up invalidated entries
        for (const filePath of filesToRemove) {
            delete this.data.files[filePath];
        }

        this.scheduleSave();

        return {
            filesToRevalidate,
            schemasToRevalidate: invalidSchemaIds,
            fullRevalidationNeeded: false,
        };
    }

    /**
     * Check if a file's cache entry is still valid (mtime matches)
     */
    isFileValid(filePath: string, currentMtime: number): boolean {
        const cached = this.data.files[filePath];
        return cached !== undefined && cached.mtime === currentMtime;
    }

    /**
     * Get cached violations for a file (if valid)
     */
    getFileViolations(
        filePath: string,
        currentMtime: number,
        schemaMap: Map<string, SchemaMapping>
    ): Violation[] | null {
        const cached = this.data.files[filePath];
        if (!cached || cached.mtime !== currentMtime) {
            return null;
        }

        const violations: Violation[] = [];
        for (const cv of cached.violations) {
            const v = fromCachedViolation(cv, schemaMap);
            if (v) violations.push(v);
        }
        return violations;
    }

    /**
     * Update cache for a file after validation
     */
    updateFile(
        filePath: string,
        mtime: number,
        schemaIds: string[],
        violations: Violation[]
    ): void {
        this.data.files[filePath] = {
            mtime,
            schemaIds,
            violations: violations.map(toCachedViolation),
        };
        this.scheduleSave();
    }

    /**
     * Remove a file from cache (on delete)
     */
    removeFile(filePath: string): void {
        if (this.data.files[filePath]) {
            delete this.data.files[filePath];
            this.scheduleSave();
        }
    }

    /**
     * Update file path in cache (on rename)
     */
    renameFile(oldPath: string, newPath: string): void {
        if (this.data.files[oldPath]) {
            const data = this.data.files[oldPath];
            // Update filePath in violations
            data.violations = data.violations.map(v => ({
                ...v,
                filePath: newPath,
            }));
            this.data.files[newPath] = data;
            delete this.data.files[oldPath];
            this.scheduleSave();
        }
    }

    /**
     * Invalidate all files that matched a specific schema
     * Used when a schema is edited
     */
    invalidateSchema(schemaId: string): string[] {
        const invalidatedFiles: string[] = [];

        for (const [filePath, fileData] of Object.entries(this.data.files)) {
            if (fileData.schemaIds.includes(schemaId)) {
                invalidatedFiles.push(filePath);
                delete this.data.files[filePath];
            }
        }

        if (invalidatedFiles.length > 0) {
            this.scheduleSave();
        }

        return invalidatedFiles;
    }

    /**
     * Update the hash for a schema (after revalidation)
     */
    updateSchemaHash(schema: SchemaMapping): void {
        this.data.schemaHashes[schema.id] = hashSchema(schema, this.settings().customTypes);
        this.scheduleSave();
    }

    /**
     * Clear entire cache, preserving settings hash
     */
    clear(): void {
        this.data = this.emptyCache();
        this.data.settingsHash = hashSettings(this.settings());
        this.scheduleSave();
    }

    /**
     * Get cache statistics for debugging
     */
    getStats(): { fileCount: number; schemaCount: number } {
        return {
            fileCount: Object.keys(this.data.files).length,
            schemaCount: Object.keys(this.data.schemaHashes).length,
        };
    }
}
