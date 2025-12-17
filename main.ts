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
} from "./src/types";
import { ViolationStore } from "./src/validation/store";
import { Validator } from "./src/validation/validator";
import { StatusBarItem } from "./src/ui/statusBar";
import { ViolationsModal } from "./src/ui/violationsModal";
import { ViolationsView, VIOLATIONS_VIEW_TYPE } from "./src/ui/violationsView";
import { PropsecSettingTab } from "./src/settings";

export default class PropsecPlugin extends Plugin {
    settings: PropsecSettings;
    private store: ViolationStore;
    private validator: Validator;
    private statusBarItem: StatusBarItem | null = null;
    private statusBarEl: HTMLElement | null = null;

    async onload(): Promise<void> {
        await this.loadSettings();

        // Initialize store and validator
        this.store = new ViolationStore();
        this.validator = new Validator(
            this.app,
            this.store,
            () => this.settings
        );

        // Auto-detect templates folder from core Templates plugin
        this.detectTemplatesFolder();

        // Register violations view
        this.registerView(
            VIOLATIONS_VIEW_TYPE,
            (leaf) => new ViolationsView(leaf, this.store)
        );

        // Set up status bar
        this.statusBarEl = this.addStatusBarItem();
        this.statusBarItem = new StatusBarItem(this.statusBarEl, this.store, () => {
            new ViolationsModal(this.app, this.store).open();
        });
        this.updateStatusBarVisibility();
        this.updateStatusBarColoring();

        // Register commands
        this.addCommand({
            id: "validate-all-notes",
            name: "Validate all notes",
            callback: () => {
                this.validator.validateAll();
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
                        const mapping = this.validator.getMatchingSchema(file);
                        if (mapping) {
                            this.validator.validateFile(file, mapping);
                        }
                    }
                    return true;
                }
                return false;
            },
        });

        // Register settings tab
        this.addSettingTab(new PropsecSettingTabWrapper(this.app, this));

        // Register event handlers
        this.registerEvents();

        // Initial validation on plugin load
        // Delay to ensure metadata cache is ready
        this.app.workspace.onLayoutReady(() => {
            this.validator.validateAll();
        });
    }

    onunload(): void {
        if (this.statusBarItem) {
            this.statusBarItem.destroy();
        }
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<PropsecSettings>);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    private detectTemplatesFolder(): void {
        // Skip if user has already set a templates folder
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

    private registerEvents(): void {
        // Validate on metadata cache changes (file save, frontmatter edit)
        this.registerEvent(
            this.app.metadataCache.on("changed", (file: TFile) => {
                if (file.extension !== "md") return;

                const mapping = this.validator.getMatchingSchema(file);
                if (mapping) {
                    this.validator.validateFile(file, mapping);
                } else {
                    // File no longer matches any schema, remove its violations
                    this.store.removeFile(file.path);
                }
            })
        );

        // Handle file rename
        this.registerEvent(
            this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
                if (!(file instanceof TFile) || file.extension !== "md") return;

                // Update violation store path
                this.store.renameFile(oldPath, file.path);

                // Wait for metadata cache to update before re-validating
                let handled = false;
                const revalidate = () => {
                    if (handled) return;
                    handled = true;
                    this.app.metadataCache.off("changed", onCacheUpdate);
                    const mapping = this.validator.getMatchingSchema(file);
                    if (mapping) {
                        this.validator.validateFile(file, mapping);
                    } else {
                        this.store.removeFile(file.path);
                    }
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
                this.store.removeFile(file.path);
            })
        );

        // Validate on file open (optional)
        this.registerEvent(
            this.app.workspace.on("file-open", (file: TFile | null) => {
                if (!this.settings.validateOnFileOpen) return;
                if (!file || file.extension !== "md") return;

                const mapping = this.validator.getMatchingSchema(file);
                if (mapping) {
                    this.validator.validateFile(file, mapping);
                } else {
                    // File no longer matches any schema, remove its violations
                    this.store.removeFile(file.path);
                }
            })
        );
    }

    /**
     * Re-validate when schema changes
     */
    onSchemaChange(mappingId?: string): void {
        if (mappingId) {
            this.validator.revalidateMapping(mappingId);
        } else {
            this.validator.validateAll();
        }
    }

    /**
     * Called when any setting changes
     */
    onSettingsChange(): void {
        this.updateStatusBarVisibility();
        this.updateStatusBarColoring();
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
