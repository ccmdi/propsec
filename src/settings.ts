import { App, PluginSettingTab, Setting } from "obsidian";
import { PropsecSettings, SchemaMapping } from "./types";
import { SchemaEditorModal } from "./ui/schemaEditorModal";
import { AddSchemaModal } from "./ui/addSchemaModal";

export class PropsecSettingTab extends PluginSettingTab {
    private settings: PropsecSettings;
    private onSettingsChange: () => Promise<void>;
    private onSchemaChange: (mappingId?: string) => void;

    constructor(
        app: App,
        containerEl: HTMLElement,
        settings: PropsecSettings,
        onSettingsChange: () => Promise<void>,
        onSchemaChange: (mappingId?: string) => void
    ) {
        // Create a minimal plugin-like object for the parent class
        const pluginStub = {
            app,
            manifest: { id: "propsec", name: "propsec" },
        } as any;

        super(app, pluginStub);
        this.containerEl = containerEl;
        this.settings = settings;
        this.onSettingsChange = onSettingsChange;
        this.onSchemaChange = onSchemaChange;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Templates folder setting
        new Setting(containerEl)
            .setName("Templates Folder")
            .setDesc(
                "Folder containing your template files. Auto-detected from core 'Templates' or community 'Templater' plugin if enabled."
            )
            .addText((text) =>
                text
                    .setPlaceholder("Templates")
                    .setValue(this.settings.templatesFolder)
                    .onChange(async (value) => {
                        this.settings.templatesFolder = value;
                        await this.onSettingsChange();
                    })
            );

        // Separator
        containerEl.createEl("hr");

        // Schema Mappings section
        containerEl.createEl("h3", { text: "Schema" });

        // Schema list
        const schemaListContainer = containerEl.createDiv({
            cls: "frontmatter-linter-schema-list",
        });

        if (this.settings.schemaMappings.length === 0) {
            schemaListContainer.createEl("p", {
                text: "No schemas defined. Click the button below to add one.",
                cls: "frontmatter-linter-no-schemas",
            });
        } else {
            for (const mapping of this.settings.schemaMappings) {
                this.renderSchemaMappingItem(schemaListContainer, mapping);
            }
        }

        // Add Schema button
        new Setting(containerEl).addButton((button) =>
            button
                .setButtonText("+ Add Schema")
                .setCta()
                .onClick(() => {
                    const modal = new AddSchemaModal(
                        this.app,
                        this.settings.templatesFolder,
                        async (mapping) => {
                            this.settings.schemaMappings.push(mapping);
                            await this.onSettingsChange();
                            this.onSchemaChange(mapping.id);
                            this.display(); // Refresh the settings view
                        }
                    );
                    modal.open();
                })
        );

        // Separator
        containerEl.createEl("hr");

        // Validation Options section
        containerEl.createEl("h3", { text: "Validation preferences" });

        new Setting(containerEl)
            .setName("Warn on unknown fields")
            .setDesc(
                "Show warning when a note has fields not defined in its schema"
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.settings.warnOnUnknownFields)
                    .onChange(async (value) => {
                        this.settings.warnOnUnknownFields = value;
                        await this.onSettingsChange();
                        this.onSchemaChange();
                    })
            );

        new Setting(containerEl)
            .setName("Validate on file open")
            .setDesc("Automatically validate notes when they are opened")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.settings.validateOnFileOpen)
                    .onChange(async (value) => {
                        this.settings.validateOnFileOpen = value;
                        await this.onSettingsChange();
                    })
            );

        new Setting(containerEl)
            .setName("Validate on file save")
            .setDesc("Automatically validate notes when they are saved")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.settings.validateOnFileSave)
                    .onChange(async (value) => {
                        this.settings.validateOnFileSave = value;
                        await this.onSettingsChange();
                    })
            );

        new Setting(containerEl)
            .setName("Show in status bar")
            .setDesc("Display violation count in the status bar")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.settings.showInStatusBar)
                    .onChange(async (value) => {
                        this.settings.showInStatusBar = value;
                        await this.onSettingsChange();
                    })
            );

        new Setting(containerEl)
            .setName("Color status bar errors")
            .setDesc("Highlight violations in red in the status bar")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.settings.colorStatusBarErrors)
                    .onChange(async (value) => {
                        this.settings.colorStatusBarErrors = value;
                        await this.onSettingsChange();
                    })
            );
    }

    private renderSchemaMappingItem(
        container: HTMLElement,
        mapping: SchemaMapping
    ): void {
        const itemEl = container.createDiv({
            cls: `frontmatter-linter-schema-item ${mapping.enabled ? "" : "frontmatter-linter-schema-disabled"}`,
        });

        // Header row with checkbox, name, and buttons
        const headerRow = itemEl.createDiv({
            cls: "frontmatter-linter-schema-header",
        });

        // Enable/disable checkbox
        const checkbox = headerRow.createEl("input", { type: "checkbox" });
        checkbox.checked = mapping.enabled;
        checkbox.addEventListener("change", async () => {
            mapping.enabled = checkbox.checked;
            await this.onSettingsChange();
            this.onSchemaChange(mapping.id);
            this.display();
        });

        // Schema name
        const nameEl = headerRow.createEl("span", {
            text: mapping.name,
            cls: "frontmatter-linter-schema-name",
        });
        if (!mapping.enabled) {
            nameEl.addClass("frontmatter-linter-schema-name-disabled");
        }

        // Buttons container
        const buttonsEl = headerRow.createDiv({
            cls: "frontmatter-linter-schema-buttons",
        });

        // Edit button
        const editBtn = buttonsEl.createEl("button", { text: "Edit" });
        editBtn.addEventListener("click", () => {
            const modal = new SchemaEditorModal(
                this.app,
                mapping,
                this.settings.templatesFolder,
                async (updatedMapping) => {
                    // Update the mapping in place
                    const index = this.settings.schemaMappings.findIndex(
                        (m) => m.id === mapping.id
                    );
                    if (index >= 0) {
                        this.settings.schemaMappings[index] = updatedMapping;
                        await this.onSettingsChange();
                        this.onSchemaChange(updatedMapping.id);
                        this.display();
                    }
                }
            );
            modal.open();
        });

        // Delete button
        const deleteBtn = buttonsEl.createEl("button", {
            text: "X",
            cls: "frontmatter-linter-delete-btn",
        });
        deleteBtn.addEventListener("click", async () => {
            const index = this.settings.schemaMappings.findIndex(
                (m) => m.id === mapping.id
            );
            if (index >= 0) {
                this.settings.schemaMappings.splice(index, 1);
                await this.onSettingsChange();
                this.onSchemaChange();
                this.display();
            }
        });

        // Info row
        const infoRow = itemEl.createDiv({
            cls: "frontmatter-linter-schema-info",
        });
        infoRow.createEl("span", {
            text: `${mapping.query || "(not set)"}`,
            cls: "frontmatter-linter-schema-query",
        });

        const requiredCount = mapping.fields.filter((f) => f.required).length;
        infoRow.createEl("span", {
            text: `${mapping.fields.length} fields (${requiredCount} required)`,
            cls: "frontmatter-linter-schema-field-count",
        });
    }
}
