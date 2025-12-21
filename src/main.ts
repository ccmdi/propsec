import {
    App,
    Plugin,
    PluginSettingTab,
    TFile,
    TAbstractFile,
} from "obsidian";
import {
    PropsecSettings,
    DEFAULT_SETTINGS,
    Violation,
} from "./types";
import { ViolationStore } from "./validation/store";
import { Validator } from "./validation/validator";
import { ValidationCache } from "./validation/cache";
import { StatusBarItem } from "./ui/statusBar";
import { ViolationsModal } from "./ui/violationsModal";
import { ViolationsView, VIOLATIONS_VIEW_TYPE } from "./ui/violationsView";
import { PropsecSettingTab } from "./settings";
import { queryContext } from "./query/context";
import { debug } from "./debug";

export default class PropsecPlugin extends Plugin {
    settings: PropsecSettings;
    private store: ViolationStore;
    private cache: ValidationCache;
    private validator: Validator;
    private statusBarItem: StatusBarItem | null = null;
    private statusBarEl: HTMLElement | null = null;
    private startupComplete: boolean = false;
    private pendingFileChanges: Set<string> = new Set(); // Files changed during startup

    async onload(): Promise<void> {
        await this.loadSettings();

        queryContext.initialize(this.app, this.manifest.id);
        this.store = new ViolationStore();
        this.cache = new ValidationCache(this.app, this.manifest.id, () => this.settings);
        this.validator = new Validator(this.app, this.store, () => this.settings);

        this.validator.hooks = {
            onFileValidated: (file, schemaIds, violations) => {
                this.cache.updateFile(file.path, file.stat.mtime, schemaIds, violations);
            },
            onSchemaValidated: (schema) => {
                this.cache.updateSchemaHash(schema);
            },
            onCleared: () => {
                this.cache.clear();
            },
        };

        this.detectTemplatesFolder();

        // Preload cache: load data IMMEDIATELY
        await this.preloadCache();

        this.registerView(
            VIOLATIONS_VIEW_TYPE,
            (leaf) => new ViolationsView(leaf, this.store)
        );

        this.statusBarEl = this.addStatusBarItem();
        this.statusBarItem = new StatusBarItem(this.statusBarEl, this.store, () => {
            new ViolationsModal(this.app, this.store).open();
        });
        this.updateStatusBarVisibility();
        this.updateStatusBarColoring();
        this.updateStatusBarWarnings();

        this.addCommand({
            id: "validate-all-notes",
            name: "Validate all notes",
            callback: () => {
                void this.validator.validateAll();
            },
        });

        this.addCommand({
            id: "rebuild-and-validate",
            name: "Rebuild index and validate all",
            callback: () => {
                void this.rebuildAndValidate();
            },
        });

        this.addCommand({
            id: "show-violations",
            name: "Show violations modal",
            callback: () => {
                new ViolationsModal(this.app, this.store).open();
            },
        });

        this.addCommand({
            id: "show-violations-sidebar",
            name: "Show violations sidebar",
            callback: () => {
                void this.activateViolationsView();
            },
        });

        this.addCommand({
            id: "validate-current-note",
            name: "Validate current note",
            checkCallback: (checking: boolean) => {
                const file = this.app.workspace.getActiveFile();
                if (file && file.extension === "md") {
                    if (!checking) {
                        this.validator.validateFileAllSchemas(file);
                    }
                    return true;
                }
                return false;
            },
        });

        this.addSettingTab(new PropsecSettingTabWrapper(this.app, this));

        this.registerEvents();

        this.app.workspace.onLayoutReady(() => {
            void this.initializeAndValidate();
        });
    }

    /**
     * Preload cached violations into store before views open.
     * This prevents the empty state flash on startup.
     * Does NOT check mtimes (vault not ready yet) - just loads optimistically.
     */
    private async preloadCache(): Promise<void> {
        const cacheLoaded = await this.cache.load();
        if (!cacheLoaded) return;

        // Load all cached violations optimistically (vault not ready for mtime checks)
        const violations = this.cache.loadCachedViolations();

        // Group by file and add to store
        const violationsByFile = new Map<string, Violation[]>();
        for (const v of violations) {
            const arr = violationsByFile.get(v.filePath) || [];
            arr.push(v);
            violationsByFile.set(v.filePath, arr);
        }
        for (const [filePath, fileViolations] of violationsByFile) {
            this.store.addFileViolations(filePath, fileViolations);
        }

        debug(`Preloaded ${violations.length} cached violations`);
    }

    private async initializeAndValidate(): Promise<void> {
        await queryContext.index.initialize();

        const startTime = performance.now();

        // Now vault is ready - analyze what needs revalidation
        const analysis = this.cache.analyzeCache();

        this.store.beginBatch();
        try {
            if (analysis.fullRevalidationNeeded) {
                // Settings changed - full validation needed
                this.store.clear();
                await this.validator.validateAll();
            } else {
                // Remove stale violations for files that need revalidation
                for (const filePath of analysis.filesToRevalidate) {
                    this.store.removeFile(filePath);
                }

                // Revalidate changed schemas
                for (const schemaId of analysis.schemasToRevalidate) {
                    const mapping = this.settings.schemaMappings.find(m => m.id === schemaId);
                    if (mapping) {
                        await this.validator.validateMapping(mapping);
                    }
                }

                // Revalidate modified files
                for (const filePath of analysis.filesToRevalidate) {
                    const file = this.app.vault.getAbstractFileByPath(filePath);
                    if (file instanceof TFile) {
                        this.validator.validateFileAllSchemas(file);
                    }
                }

                this.store.setLastFullValidation(Date.now());
            }
        } finally {
            this.store.endBatch();
        }

        debug(`Startup validation completed in ${(performance.now() - startTime).toFixed(1)}ms`);
        this.startupComplete = true;

        // Process any file changes that occurred during startup
        if (this.pendingFileChanges.size > 0) {
            debug(`Processing ${this.pendingFileChanges.size} file changes queued during startup`);
            for (const path of this.pendingFileChanges) {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    this.validator.validateFileAllSchemas(file);
                }
            }
            this.pendingFileChanges.clear();
        }
    }

    /**
     * Force rebuild the tag index and re-validate everything
     */
    private async rebuildAndValidate(): Promise<void> {
        await queryContext.index.buildFullIndex();
        await this.validator.validateAll();
    }

    onunload(): void {
        if (this.statusBarItem) {
            this.statusBarItem.destroy();
        }
        // Save tag index on unload
        if (queryContext.isInitialized) {
            void queryContext.index.saveToDisk();
        }
        // Flush validation cache
        void this.cache.flush();
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<PropsecSettings>);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    private detectTemplatesFolder(): void {
        if (this.settings.templatesFolder) return;

        const coreTemplates = this.app.internalPlugins.plugins.templates;
        if (coreTemplates.enabled && coreTemplates.instance.options.folder) {
            this.settings.templatesFolder = coreTemplates.instance.options.folder;
            return;
        }

        const templater = this.app.plugins.plugins["templater-obsidian"];
        if (templater.settings.templates_folder) {
            this.settings.templatesFolder = templater.settings.templates_folder;
        }
    }

    private updateStatusBarVisibility(): void {
        if (this.statusBarEl) {
            this.statusBarEl.style.display = this.settings.showInStatusBar ? "" : "none";
        }
    }

    private updateStatusBarColoring(): void {
        if (this.statusBarItem) {
            this.statusBarItem.setColorErrors(this.settings.colorStatusBarErrors);
        }
    }

    private updateStatusBarWarnings(): void {
        if (this.statusBarItem) {
            this.statusBarItem.setExcludeWarnings(this.settings.excludeWarningsFromCount);
        }
    }

    private registerEvents(): void {
        // Validate on metadata cache changes (file save, frontmatter edit)
        // Also update tag index
        this.registerEvent(
            this.app.metadataCache.on("changed", (file: TFile) => {
                if (file.extension !== "md") return;

                // Always update tag index
                queryContext.index.updateFile(file);

                // Queue changes during startup, process after
                if (!this.startupComplete) {
                    this.pendingFileChanges.add(file.path);
                    return;
                }

                // Validate against all matching schemas (accumulation model)
                this.validator.validateFileAllSchemas(file);
            })
        );

        // Handle file rename
        this.registerEvent(
            this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
                if (!(file instanceof TFile) || file.extension !== "md") return;

                queryContext.index.renameFile(oldPath, file.path);

                // Update violation store path
                this.store.renameFile(oldPath, file.path);

                // Update validation cache path
                this.cache.renameFile(oldPath, file.path);

                // Wait for metadata cache to update before re-validating
                let handled = false;
                const revalidate = () => {
                    if (handled) return;
                    handled = true;
                    this.app.metadataCache.off("changed", onCacheUpdate);
                    this.validator.validateFileAllSchemas(file);
                };
                const onCacheUpdate = (updatedFile: TFile) => {
                    if (updatedFile.path === file.path) {
                        revalidate();
                    }
                };
                this.app.metadataCache.on("changed", onCacheUpdate);

                // Fallback timeout in case cache event doesn't fire (e.g., no frontmatter)
                setTimeout(revalidate, 500);
            })
        );

        // Handle file delete
        this.registerEvent(
            this.app.vault.on("delete", (file: TAbstractFile) => {
                if (!(file instanceof TFile)) return;
                // Update tag index
                queryContext.index.removeFile(file.path);
                this.store.removeFile(file.path);
                // Update validation cache
                this.cache.removeFile(file.path);
            })
        );

        // Validate on file open (optional)
        this.registerEvent(
            this.app.workspace.on("file-open", (file: TFile | null) => {
                if (!this.startupComplete) return; // Skip until initial validation done
                if (!this.settings.validateOnFileOpen) return;
                if (!file || file.extension !== "md") return;

                this.validator.validateFileAllSchemas(file);
            })
        );
    }

    /**
     * Re-validate when schema changes
     */
    onSchemaChange(mappingId?: string): void {
        if (mappingId) {
            // Invalidate cache for this schema before revalidating
            this.cache.invalidateSchema(mappingId);
            void this.validator.revalidateMapping(mappingId);
        } else {
            void this.validator.validateAll();
        }
    }

    /**
     * Called when any setting changes
     */
    onSettingsChange(): void {
        this.updateStatusBarVisibility();
        this.updateStatusBarColoring();
        this.updateStatusBarWarnings();
    }

    /**
     * Open the violations view in the right sidebar
     */
    async activateViolationsView(): Promise<void> {
        const { workspace } = this.app;

        let leaf = workspace.getLeavesOfType(VIOLATIONS_VIEW_TYPE)[0];

        if (!leaf) {
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                await rightLeaf.setViewState({
                    type: VIOLATIONS_VIEW_TYPE,
                    active: true,
                });
                leaf = rightLeaf;
            }
        }

        if (leaf) {
            await workspace.revealLeaf(leaf);
        }
    }
}

/**
 * Settings tab wrapper
 */
class PropsecSettingTabWrapper extends PluginSettingTab {
    plugin: PropsecPlugin;
    private settingsTab: PropsecSettingTab | null = null;

    constructor(app: App, plugin: PropsecPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        this.settingsTab = new PropsecSettingTab(
            this.app,
            this.plugin,
            this.containerEl,
            this.plugin.settings,
            async () => {
                await this.plugin.saveSettings();
                this.plugin.onSettingsChange();
            },
            (mappingId?: string) => {
                this.plugin.onSchemaChange(mappingId);
            }
        );
        this.settingsTab.display();
    }
}
