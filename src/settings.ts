import { App, PluginSettingTab, Setting, setIcon, Notice, Platform } from "obsidian";
import { PropsecSettings, SchemaMapping, CustomType } from "./types";
import { SchemaEditorModal } from "./ui/schemaEditorModal";
import { AddSchemaModal } from "./ui/addSchemaModal";
import { CustomTypeEditorModal } from "./ui/customTypeEditorModal";
import { SchemaPreviewModal } from "./ui/schemaPreviewModal";
import { TypePreviewModal } from "./ui/typePreviewModal";
import { ConfirmModal } from "./ui/confirmModal";
import { describePropertyFilter } from "./query/matcher";
import { makeDraggable } from "./ui/draggable";
import { getReferencedCustomTypes } from "./validation/cache";
import PropsecPlugin from "./main";

export class PropsecSettingTab extends PluginSettingTab {
    private settings: PropsecSettings;
    private onSettingsChange: () => Promise<void>;
    private onSchemaChange: (mappingId?: string) => void;
    private customTypesContainer: HTMLElement | null = null;
    private schemaListContainer: HTMLElement | null = null;

    constructor(
        app: App,
        plugin: PropsecPlugin,
        containerEl: HTMLElement,
        settings: PropsecSettings,
        onSettingsChange: () => Promise<void>,
        onSchemaChange: (mappingId?: string) => void
    ) {
        super(app, plugin);
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
            .setName("Templates folder")
            .setDesc(
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Templates and Templater are proper nouns (plugin names)
                "Folder containing your template files. Auto-detected from core Templates or community Templater plugin if enabled."
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

        // Types section
        new Setting(containerEl).setName("Types").setHeading();

        // Custom types list
        this.customTypesContainer = containerEl.createDiv({
            cls: "propsec-custom-types-list",
        });

        if (this.settings.customTypes.length === 0) {
            this.customTypesContainer.createEl("p", {
                text: "No types defined. Click the button below to add one.",
                cls: "propsec-no-types",
            });
        } else {
            this.settings.customTypes.forEach((customType, index) => {
                this.renderCustomTypeItem(this.customTypesContainer!, customType, index);
            });
        }

        // Add Custom Type button
        new Setting(containerEl).addButton((button) =>
            button
                .setButtonText("Add type")
                .setCta()
                .onClick(() => {
                    const modal = new CustomTypeEditorModal(
                        this.app,
                        null,
                        this.settings.customTypes,
                        //eslint-disable-next-line @typescript-eslint/no-misused-promises -- Async callback in event handler
                        async (newType) => {
                            this.settings.customTypes.push(newType);
                            await this.onSettingsChange();
                            if (this.customTypesContainer) {
                                // Remove "no types" placeholder if present
                                this.customTypesContainer.querySelector(".propsec-no-types")?.remove();
                                const newIndex = this.settings.customTypes.length - 1;
                                this.renderCustomTypeItem(this.customTypesContainer, newType, newIndex);
                            }
                        }
                    );
                    modal.open();
                })
        );

        // Separator
        containerEl.createEl("hr");

        // Schema section
        new Setting(containerEl).setName("Schema").setHeading();

        // Schema list
        this.schemaListContainer = containerEl.createDiv({
            cls: "propsec-schema-list",
        });

        if (this.settings.schemaMappings.length === 0) {
            this.schemaListContainer.createEl("p", {
                text: "No schemas defined. Click the button below to add one.",
                cls: "propsec-no-schemas",
            });
        } else {
            this.settings.schemaMappings.forEach((mapping, index) => {
                this.renderSchemaMappingItem(this.schemaListContainer!, mapping, index);
            });
        }

        // Add Schema button
        new Setting(containerEl).addButton((button) =>
            button
                .setButtonText("Add schema")
                .setCta()
                .onClick(() => {
                    const modal = new AddSchemaModal(
                        this.app,
                        this.settings.templatesFolder,
                        this.settings.customTypes,
                        //eslint-disable-next-line @typescript-eslint/no-misused-promises -- Async callback in event handler
                        async (mapping) => {
                            this.settings.schemaMappings.push(mapping);
                            await this.onSettingsChange();
                            this.onSchemaChange(mapping.id);
                            if (this.schemaListContainer) {
                                // Remove "no schemas" placeholder if present
                                this.schemaListContainer.querySelector(".propsec-no-schemas")?.remove();
                                const newIndex = this.settings.schemaMappings.length - 1;
                                this.renderSchemaMappingItem(this.schemaListContainer, mapping, newIndex);
                            }
                        },
                        this.settings.enablePropertySuggestions
                    );
                    modal.open();
                })
        );

        // Separator
        containerEl.createEl("hr");

        // Validation Options section
        new Setting(containerEl).setName("Validation preferences").setHeading();

        new Setting(containerEl)
            .setName("Global exclusions")
            .setDesc("Notes matching this query are excluded from all schemas. Uses same syntax as schema queries (e.g., #status/archived, Templates/*)")
            .addText((text) =>
                text
                    .setPlaceholder("e.g., #status/archived")
                    .setValue(this.settings.globalExclusions)
                    .onChange(async (value) => {
                        this.settings.globalExclusions = value;
                        await this.onSettingsChange();
                        this.onSchemaChange();
                    })
            );

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
            .setName("Allow Obsidian properties")
            .setDesc(
                "Don't warn about Obsidian's native properties (aliases, tags, cssclasses) when checking for unknown fields"
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.settings.allowObsidianProperties)
                    .onChange(async (value) => {
                        this.settings.allowObsidianProperties = value;
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

        new Setting(containerEl)
            .setName("Exclude warnings from count")
            .setDesc("Don't include warnings in the status bar violation count (warnings still appear in the violations panel)")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.settings.excludeWarningsFromCount)
                    .onChange(async (value) => {
                        this.settings.excludeWarningsFromCount = value;
                        await this.onSettingsChange();
                    })
            );

        new Setting(containerEl)
            .setName("Property suggestions")
            .setDesc("Show autocomplete suggestions for field names in the schema editor based on existing properties in your vault")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.settings.enablePropertySuggestions)
                    .onChange(async (value) => {
                        this.settings.enablePropertySuggestions = value;
                        await this.onSettingsChange();
                    })
            );

        // Export section (desktop only - File System Access API not available on mobile)
        if (Platform.isDesktop) {
            containerEl.createEl("hr");

            new Setting(containerEl).setName("Export").setHeading();

            new Setting(containerEl)
                .setName("Export all schemas")
                .setDesc("Save all types and schemas to a JSON file")
                .addButton((button) =>
                    button
                        .setButtonText("Export")
                        .onClick(() => {
                            void this.exportSchemas();
                        })
                );
        }
    }

    private async exportSchemas(): Promise<void> {
        const exportData = {
            customTypes: this.settings.customTypes,
            schemaMappings: this.settings.schemaMappings,
        };
        const json = JSON.stringify(exportData, null, 2);

        try {
            // File System Access API (showSaveFilePicker)
            const showSaveFilePicker = (window as unknown as {
                showSaveFilePicker: (options: {
                    suggestedName: string;
                    types: { description: string; accept: Record<string, string[]> }[];
                }) => Promise<FileSystemFileHandle>;
            }).showSaveFilePicker;

            const handle = await showSaveFilePicker({
                suggestedName: "propsec-schemas.json",
                types: [{
                    description: "JSON",
                    accept: { "application/json": [".json"] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(json);
            await writable.close();
            new Notice("Schemas exported successfully");
        } catch (e) {
            if ((e as Error).name !== "AbortError") {
                new Notice("Failed to export schemas");
            }
        }
    }

    private renderSchemaMappingItem(
        container: HTMLElement,
        mapping: SchemaMapping,
        index: number
    ): void {
        const itemEl = container.createDiv({
            cls: `propsec-schema-item ${mapping.enabled ? "" : "propsec-schema-disabled"}`,
        });

        //eslint-disable-next-line @typescript-eslint/no-misused-promises -- Async callback in event handler
        makeDraggable(itemEl, container, index, async (fromIndex, toIndex) => {
            const [moved] = this.settings.schemaMappings.splice(fromIndex, 1);
            this.settings.schemaMappings.splice(toIndex, 0, moved);
            await this.onSettingsChange();
            this.onSchemaChange();
            void this.display();
        });

        // Header row with drag handle, checkbox, name, and buttons
        const headerRow = itemEl.createDiv({
            cls: "propsec-schema-header",
        });

        // Drag handle
        const dragHandle = headerRow.createDiv({
            cls: "propsec-drag-handle",
        });
        setIcon(dragHandle, "grip-vertical");

        // Enable/disable checkbox
        const checkbox = headerRow.createEl("input", { type: "checkbox" });
        checkbox.checked = mapping.enabled;
        //eslint-disable-next-line @typescript-eslint/no-misused-promises -- Async callback in event handler
        checkbox.addEventListener("change", async () => {
            mapping.enabled = checkbox.checked;
            await this.onSettingsChange();
            this.onSchemaChange(mapping.id);
            itemEl.toggleClass("propsec-schema-disabled", !mapping.enabled);
            itemEl.querySelector(".propsec-schema-name")?.toggleClass("propsec-schema-name-disabled", !mapping.enabled);
        });

        // Schema name
        const nameEl = headerRow.createEl("span", {
            text: mapping.name,
            cls: "propsec-schema-name",
        });
        if (!mapping.enabled) {
            nameEl.addClass("propsec-schema-name-disabled");
        }

        // Buttons container
        const buttonsEl = headerRow.createDiv({
            cls: "propsec-schema-buttons",
        });

        // Preview button
        const previewBtn = buttonsEl.createEl("button", {
            attr: { title: "Preview resolved schema" },
        });
        setIcon(previewBtn, "eye");
        previewBtn.addEventListener("click", () => {
            const modal = new SchemaPreviewModal(this.app, mapping);
            modal.open();
        });

        // Edit button
        const editBtn = buttonsEl.createEl("button");
        setIcon(editBtn, "pencil");
        editBtn.addEventListener("click", () => {
            const modal = new SchemaEditorModal(
                this.app,
                mapping,
                this.settings.templatesFolder,
                this.settings.customTypes,
                //eslint-disable-next-line @typescript-eslint/no-misused-promises -- Async callback in event handler
                async (updatedMapping) => {
                    // Update the mapping in place
                    const idx = this.settings.schemaMappings.findIndex(
                        (m) => m.id === mapping.id
                    );
                    if (idx >= 0) {
                        this.settings.schemaMappings[idx] = updatedMapping;
                        await this.onSettingsChange();
                        this.onSchemaChange(updatedMapping.id);
                        // Replace item instead of re-rendering everything TODO function
                        const temp = document.createElement("div");
                        this.renderSchemaMappingItem(temp, updatedMapping, idx);
                        itemEl.replaceWith(temp.firstChild!);
                    }
                },
                this.settings.enablePropertySuggestions
            );
            modal.open();
        });

        // Delete button
        const deleteBtn = buttonsEl.createEl("button", {
            cls: "propsec-delete-btn",
        });
        setIcon(deleteBtn, "x");
        deleteBtn.addEventListener("click", () => {
            const confirmModal = new ConfirmModal(
                this.app,
                "Delete schema",
                `Are you sure you want to delete "${mapping.name}"?`,
                //eslint-disable-next-line @typescript-eslint/no-misused-promises -- Async callback in event handler
                async () => {
                    const idx = this.settings.schemaMappings.findIndex(
                        (m) => m.id === mapping.id
                    );
                    if (idx >= 0) {
                        this.settings.schemaMappings.splice(idx, 1);
                        await this.onSettingsChange();
                        this.onSchemaChange();
                        itemEl.remove();
                        if (this.settings.schemaMappings.length === 0) {
                            container.createEl("p", {
                                text: "No schemas defined. Click the button below to add one.",
                                cls: "propsec-no-schemas",
                            });
                        }
                    }
                }
            );
            confirmModal.open();
        });

        // Info row
        const infoRow = itemEl.createDiv({
            cls: "propsec-schema-info",
        });

        // Query info
        let queryText = mapping.query || "(no query)";
        if (mapping.propertyFilter) {
            const filterDesc = describePropertyFilter(mapping.propertyFilter);
            if (filterDesc) {
                queryText += ` [${filterDesc}]`;
            }
        }
        infoRow.createEl("span", {
            text: queryText,
            cls: "propsec-schema-query",
        });

        const requiredCount = mapping.fields.filter((f) => f.required).length;
        infoRow.createEl("span", {
            text: `${mapping.fields.length} fields (${requiredCount} required)`,
            cls: "propsec-schema-field-count",
        });
    }

    private renderCustomTypeItem(
        container: HTMLElement,
        customType: CustomType,
        index: number
    ): void {
        const itemEl = container.createDiv({
            cls: "propsec-custom-type-item",
        });

        //eslint-disable-next-line @typescript-eslint/no-misused-promises -- Async callback in event handler
        makeDraggable(itemEl, container, index, async (fromIndex, toIndex) => {
            const [moved] = this.settings.customTypes.splice(fromIndex, 1);
            this.settings.customTypes.splice(toIndex, 0, moved);
            await this.onSettingsChange();
            void this.display();
        });

        // Header row with drag handle, name and buttons
        const headerRow = itemEl.createDiv({
            cls: "propsec-custom-type-header",
        });

        // Drag handle
        const dragHandle = headerRow.createDiv({
            cls: "propsec-drag-handle",
        });
        setIcon(dragHandle, "grip-vertical");

        // Type name
        headerRow.createEl("span", {
            text: customType.name,
            cls: "propsec-custom-type-name",
        });

        // Buttons container
        const buttonsEl = headerRow.createDiv({
            cls: "propsec-custom-type-buttons",
        });

        // Preview button
        const previewBtn = buttonsEl.createEl("button", {
            attr: { title: "Preview resolved type" },
        });
        setIcon(previewBtn, "eye");
        previewBtn.addEventListener("click", () => {
            new TypePreviewModal(this.app, customType, this.settings.schemaMappings, this.settings.customTypes).open();
        });

        // Edit button
        const editBtn = buttonsEl.createEl("button");
        setIcon(editBtn, "pencil");
        editBtn.addEventListener("click", () => {
            const modal = new CustomTypeEditorModal(
                this.app,
                customType,
                this.settings.customTypes,
                //eslint-disable-next-line @typescript-eslint/no-misused-promises -- Async callback in event handler
                async (updatedType) => {
                    // Update the custom type in place
                    const idx = this.settings.customTypes.findIndex(
                        (t) => t.id === customType.id
                    );
                    if (idx >= 0) {
                        this.settings.customTypes[idx] = updatedType;
                        await this.onSettingsChange();
                        // Replace item instead of re-rendering everything TODO function
                        const temp = document.createElement("div");
                        this.renderCustomTypeItem(temp, updatedType, idx);
                        itemEl.replaceWith(temp.firstChild!);

                        // Revalidate schemas using this custom type
                        for (const schema of this.settings.schemaMappings) {
                            const referencedTypes = getReferencedCustomTypes(schema.fields, this.settings.customTypes);
                            if (referencedTypes.some((t) => t.name === updatedType.name)) {
                                this.onSchemaChange(schema.id);
                            }
                        }
                    }
                }
            );
            modal.open();
        });

        // Delete button
        const deleteBtn = buttonsEl.createEl("button", {
            cls: "propsec-delete-btn",
        });
        setIcon(deleteBtn, "x");
        deleteBtn.addEventListener("click", () => {
            // Check if any schema is using this type
            const usedInSchemas = this.settings.schemaMappings.filter((mapping) => {
                const referencedTypes = getReferencedCustomTypes(mapping.fields, this.settings.customTypes);
                return referencedTypes.some((t) => t.name === customType.name);
            });

            if (usedInSchemas.length > 0) {
                const schemaNames = usedInSchemas.map((m) => m.name).join(", ");
                new Notice(
                    `Cannot delete type "${customType.name}" because it is used in the following schemas: ${schemaNames}`
                );
                return;
            }

            const confirmModal = new ConfirmModal(
                this.app,
                "Delete type",
                `Are you sure you want to delete "${customType.name}"?`,
                //eslint-disable-next-line @typescript-eslint/no-misused-promises -- Async callback in event handler
                async () => {
                    const index = this.settings.customTypes.findIndex(
                        (t) => t.id === customType.id
                    );
                    if (index >= 0) {
                        this.settings.customTypes.splice(index, 1);
                        await this.onSettingsChange();
                        itemEl.remove();
                        if (this.settings.customTypes.length === 0) {
                            container.createEl("p", {
                                text: "No types defined. Click the button below to add one.",
                                cls: "propsec-no-types",
                            });
                        }
                    }
                }
            );
            confirmModal.open();
        });

        // Info row
        const infoRow = itemEl.createDiv({
            cls: "propsec-custom-type-info",
        });
        infoRow.createEl("span", {
            text: `${customType.fields.length} fields`,
            cls: "propsec-custom-type-field-count",
        });
    }
}
