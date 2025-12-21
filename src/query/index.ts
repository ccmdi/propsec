import { App, TFile, TFolder, TAbstractFile, Notice } from "obsidian";
import { parseQuery } from "./matcher";
import { debug } from "../debug";

/**
 * Tag index structure persisted to disk
 */
interface TagIndexData {
    version: number;
    // tag (without #) -> array of file paths
    tags: Record<string, string[]>;
}

const INDEX_VERSION = 1;

/**
 * Query index for efficient file lookups
 * - Folder queries: use vault folder traversal
 * - Tag queries: use persisted tag index
 */
export class QueryIndex {
    private app: App;
    private tagIndex: Map<string, Set<string>> = new Map();
    private indexPath: string;
    private dirty: boolean = false;
    private saveTimeout: NodeJS.Timeout | null = null;

    constructor(app: App, pluginId: string) {
        this.app = app;
        this.indexPath = `${pluginId}/tags-index.json`;
    }

    /**
     * Initialize the index - load from disk or build fresh
     */
    async initialize(): Promise<void> {
        const loaded = await this.loadFromDisk();
        if (!loaded) {
            await this.buildFullIndex();
        }
    }

    /**
     * Load index from disk
     */
    private async loadFromDisk(): Promise<boolean> {
        try {
            const data = await this.app.vault.adapter.read(
                this.app.vault.configDir + "/plugins/" + this.indexPath
            );
            const parsed = JSON.parse(data) as TagIndexData;
            
            if (parsed.version !== INDEX_VERSION) {
                return false;
            }

            this.tagIndex.clear();
            for (const [tag, files] of Object.entries(parsed.tags)) {
                this.tagIndex.set(tag, new Set(files));
            }

            debug(`Loaded tag index with ${this.tagIndex.size} tags`);
            return true;
        } catch {
            // File doesn't exist or is corrupted
            return false;
        }
    }

    /**
     * Save index to disk (debounced)
     */
    private scheduleSave(): void {
        this.dirty = true;
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(() => {
            void this.saveToDisk();
        }, 1000);
    }

    /**
     * Save index to disk immediately
     */
    async saveToDisk(): Promise<void> {
        if (!this.dirty) return;

        const data: TagIndexData = {
            version: INDEX_VERSION,
            tags: {},
        };

        for (const [tag, files] of this.tagIndex) {
            data.tags[tag] = Array.from(files);
        }

        try {
            const path = this.app.vault.configDir + "/plugins/" + this.indexPath;
            await this.app.vault.adapter.write(path, JSON.stringify(data));
            this.dirty = false;
        } catch (e) {
            console.error("Propsec: Failed to save tag index", e);
        }
    }

    /**
     * Build the full tag index from scratch
     */
    async buildFullIndex(): Promise<void> {
        const start = Date.now();

        this.tagIndex.clear();
        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            const tags = this.getFileTags(file);
            for (const tag of tags) {
                this.addFileToTag(tag, file.path);
            }
        }

        this.dirty = true;
        await this.saveToDisk();

        new Notice(`Propsec: Built tag index in ${Date.now() - start}ms (${this.tagIndex.size} tags, ${files.length} files)`);
    }

    /**
     * Update index for a single file
     */
    updateFile(file: TFile): void {
        const filePath = file.path;
        const newTags = this.getFileTags(file);

        // Remove file from all tags it was in
        for (const [tag, files] of this.tagIndex) {
            if (files.has(filePath)) {
                files.delete(filePath);
                if (files.size === 0) {
                    this.tagIndex.delete(tag);
                }
            }
        }

        // Add file to its current tags
        for (const tag of newTags) {
            this.addFileToTag(tag, filePath);
        }

        this.scheduleSave();
    }

    /**
     * Remove a file from the index
     */
    removeFile(filePath: string): void {
        for (const [tag, files] of this.tagIndex) {
            if (files.has(filePath)) {
                files.delete(filePath);
                if (files.size === 0) {
                    this.tagIndex.delete(tag);
                }
            }
        }
        this.scheduleSave();
    }

    /**
     * Handle file rename
     */
    renameFile(oldPath: string, newPath: string): void {
        for (const files of this.tagIndex.values()) {
            if (files.has(oldPath)) {
                files.delete(oldPath);
                files.add(newPath);
            }
        }
        this.scheduleSave();
    }

    /**
     * Get all tags for a file
     */
    private getFileTags(file: TFile): string[] {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) return [];

        const tags: string[] = [];

        // Frontmatter tags
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const frontmatterTags = cache.frontmatter?.tags;
        if (frontmatterTags) {
            const tagsArray = Array.isArray(frontmatterTags)
                ? frontmatterTags
                : [frontmatterTags];
            for (const t of tagsArray) {
                tags.push(String(t).replace(/^#/, ""));
            }
        }

        // Inline tags
        if (cache.tags) {
            for (const tagCache of cache.tags) {
                tags.push(tagCache.tag.replace(/^#/, ""));
            }
        }

        return tags;
    }

    /**
     * Add a file to a tag's set
     */
    private addFileToTag(tag: string, filePath: string): void {
        if (!this.tagIndex.has(tag)) {
            this.tagIndex.set(tag, new Set());
        }
        this.tagIndex.get(tag)!.add(filePath);
    }

    /**
     * Get files matching a query
     */
    getFilesForQuery(query: string): TFile[] {
        const conditions = parseQuery(query);
        if (conditions.length === 0) return [];

        const matchingPaths = new Set<string>();

        for (const condition of conditions) {
            let paths: Set<string>;

            switch (condition.type) {
                case "all":
                    paths = this.getAllMarkdownFiles();
                    break;
                case "folder":
                    paths = this.getFilesInFolder(condition.value, false);
                    break;
                case "folder_recursive":
                    paths = this.getFilesInFolder(condition.value, true);
                    break;
                case "tag":
                    paths = this.getFilesWithTag(condition.value);
                    break;
                default:
                    continue;
            }

            for (const path of paths) {
                matchingPaths.add(path);
            }
        }

        // Convert paths to TFiles
        const files: TFile[] = [];
        for (const path of matchingPaths) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                files.push(file);
            }
        }

        return files;
    }

    /**
     * Get all markdown files in the vault
     */
    private getAllMarkdownFiles(): Set<string> {
        const result = new Set<string>();
        for (const file of this.app.vault.getMarkdownFiles()) {
            result.add(file.path);
        }
        return result;
    }

    /**
     * Get files in a folder (using vault traversal, not full scan)
     */
    private getFilesInFolder(folderPath: string, recursive: boolean): Set<string> {
        const result = new Set<string>();
        const folder = this.app.vault.getAbstractFileByPath(folderPath);

        if (!(folder instanceof TFolder)) {
            return result;
        }

        if (recursive) {
            // Use Vault.recurseChildren for recursive traversal
            const recurse = (item: TAbstractFile) => {
                if (item instanceof TFile && item.extension === "md") {
                    result.add(item.path);
                } else if (item instanceof TFolder) {
                    for (const child of item.children) {
                        recurse(child);
                    }
                }
            };
            recurse(folder);
        } else {
            // Direct children only
            for (const child of folder.children) {
                if (child instanceof TFile && child.extension === "md") {
                    result.add(child.path);
                }
            }
        }

        return result;
    }

    /**
     * Get files with a specific tag (O(1) lookup + nested tag support)
     */
    private getFilesWithTag(tag: string): Set<string> {
        const result = new Set<string>();

        // Exact match
        const exact = this.tagIndex.get(tag);
        if (exact) {
            for (const path of exact) {
                result.add(path);
            }
        }

        // Nested tags (e.g., tag "book" should match "book/fiction")
        for (const [indexedTag, files] of this.tagIndex) {
            if (indexedTag.startsWith(tag + "/")) {
                for (const path of files) {
                    result.add(path);
                }
            }
        }

        return result;
    }
}

