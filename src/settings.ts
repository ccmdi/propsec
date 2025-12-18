import { App, PluginSettingTab, Setting, setIcon, Notice } from "obsidian";
import { PropsecSettings, SchemaMapping, CustomType } from "./types";
import { SchemaEditorModal } from "./ui/schemaEditorModal";
import { AddSchemaModal } from "./ui/addSchemaModal";
import { CustomTypeEditorModal } from "./ui/customTypeEditorModal";
import { describePropertyFilter } from "./query/matcher";
import PropsecPlugin from "main";

export class PropsecSettingTab extends PluginSettingTab {
    private settings: PropsecSettings;
    private onSettingsChange: () => Promise<void>;
    private onSchemaChange: (mappingId?: string) => void;

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
                //eslint-disable-next-line obsidianmd/ui/sentence-case
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

        // Types section
        new Setting(containerEl).setName("Types").setHeading();

        // Custom types list
        const customTypesContainer = containerEl.createDiv({
            cls: "frontmatter-linter-custom-types-list",
        });

        if (this.settings.customTypes.length === 0) {
            customTypesContainer.createEl("p", {
                text: "No types defined. Click the button below to add one.",
                cls: "frontmatter-linter-no-types",
            });
        } else {
            for (const customType of this.settings.customTypes) {
                this.renderCustomTypeItem(customTypesContainer, customType);
            }
        }

        // Add Custom Type button
        new Setting(containerEl).addButton((button) =>
            button
                .setButtonText("+ Add Type")
                .setCta()
                .onClick(() => {
                    const modal = new CustomTypeEditorModal(
                        this.app,
                        null,
                        this.settings.customTypes,
                        async (newType) => {
                            this.settings.customTypes.push(newType);
                            await this.onSettingsChange();
                            void this.display(); // Refresh the settings view
                        }
                    );
                    modal.open();
                })
        );

        // Separator
        containerEl.createEl("hr");

        // Schema Mappings section
        new Setting(containerEl).setName("Schema").setHeading();

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
            this.settings.schemaMappings.forEach((mapping, index) => {
                this.renderSchemaMappingItem(schemaListContainer, mapping, index);
            });
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
                        this.settings.customTypes,
                        async (mapping) => {
                            this.settings.schemaMappings.push(mapping);
                            await this.onSettingsChange();
                            this.onSchemaChange(mapping.id);
                            void this.display(); // Refresh the settings view
                        }
                    );
                    modal.open();
                })
        );

        // Separator
        containerEl.createEl("hr");

        // Validation Options section
        new Setting(containerEl).setName("Validation preferences").setHeading();

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
    }

    private renderSchemaMappingItem(
        container: HTMLElement,
        mapping: SchemaMapping,
        index: number
    ): void {
        const itemEl = container.createDiv({
            cls: `frontmatter-linter-schema-item ${mapping.enabled ? "" : "frontmatter-linter-schema-disabled"}`,
        });

        // Make item draggable
        itemEl.draggable = true;
        itemEl.dataset.index = String(index);

        itemEl.addEventListener("dragstart", (e) => {
            itemEl.addClass("dragging");
            e.dataTransfer?.setData("text/plain", String(index));
        });

        itemEl.addEventListener("dragend", () => {
            itemEl.removeClass("dragging");
            // Remove drag-over from all items
            container.querySelectorAll(".drag-over").forEach(el => el.removeClass("drag-over"));
        });

        itemEl.addEventListener("dragover", (e) => {
            e.preventDefault();
            itemEl.addClass("drag-over");
        });

        itemEl.addEventListener("dragleave", () => {
            itemEl.removeClass("drag-over");
        });

        itemEl.addEventListener("drop", async (e) => {
            e.preventDefault();
            itemEl.removeClass("drag-over");
            const fromIndex = parseInt(e.dataTransfer?.getData("text/plain") || "-1");
            const toIndex = index;
            if (fromIndex >= 0 && fromIndex !== toIndex) {
                // Reorder
                const [moved] = this.settings.schemaMappings.splice(fromIndex, 1);
                this.settings.schemaMappings.splice(toIndex, 0, moved);
                await this.onSettingsChange();
                this.onSchemaChange();
                void this.display();
            }
        });

        // Header row with drag handle, checkbox, name, and buttons
        const headerRow = itemEl.createDiv({
            cls: "frontmatter-linter-schema-header",
        });

        // Drag handle
        const dragHandle = headerRow.createDiv({
            cls: "frontmatter-linter-drag-handle",
        });
        setIcon(dragHandle, "grip-vertical");

        // Enable/disable checkbox
        const checkbox = headerRow.createEl("input", { type: "checkbox" });
        checkbox.checked = mapping.enabled;
        checkbox.addEventListener("change", async () => {
            mapping.enabled = checkbox.checked;
            await this.onSettingsChange();
            this.onSchemaChange(mapping.id);
            void this.display();
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
                this.settings.customTypes,
                async (updatedMapping) => {
                    // Update the mapping in place
                    const idx = this.settings.schemaMappings.findIndex(
                        (m) => m.id === mapping.id
                    );
                    if (idx >= 0) {
                        this.settings.schemaMappings[idx] = updatedMapping;
                        await this.onSettingsChange();
                        this.onSchemaChange(updatedMapping.id);
                        void this.display();
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
            const idx = this.settings.schemaMappings.findIndex(
                (m) => m.id === mapping.id
            );
            if (idx >= 0) {
                this.settings.schemaMappings.splice(idx, 1);
                await this.onSettingsChange();
                this.onSchemaChange();
                void this.display();
            }
        });

        // Info row
        const infoRow = itemEl.createDiv({
            cls: "frontmatter-linter-schema-info",
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
            cls: "frontmatter-linter-schema-query",
        });

        const requiredCount = mapping.fields.filter((f) => f.required).length;
        infoRow.createEl("span", {
            text: `${mapping.fields.length} fields (${requiredCount} required)`,
            cls: "frontmatter-linter-schema-field-count",
        });
    }

    private renderCustomTypeItem(
        container: HTMLElement,
        customType: CustomType
    ): void {
        const itemEl = container.createDiv({
            cls: "frontmatter-linter-custom-type-item",
        });

        // Header row with name and buttons
        const headerRow = itemEl.createDiv({
            cls: "frontmatter-linter-custom-type-header",
        });

        // Type name
        headerRow.createEl("span", {
            text: customType.name,
            cls: "frontmatter-linter-custom-type-name",
        });

        // Buttons container
        const buttonsEl = headerRow.createDiv({
            cls: "frontmatter-linter-custom-type-buttons",
        });

        // Edit button
        const editBtn = buttonsEl.createEl("button", { text: "Edit" });
        editBtn.addEventListener("click", () => {
            const modal = new CustomTypeEditorModal(
                this.app,
                customType,
                this.settings.customTypes,
                async (updatedType) => {
                    // Update the custom type in place
                    const index = this.settings.customTypes.findIndex(
                        (t) => t.id === customType.id
                    );
                    if (index >= 0) {
                        this.settings.customTypes[index] = updatedType;
                        await this.onSettingsChange();
                        void this.display();
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
            // Check if any schema is using this type
            const usedInSchemas = this.settings.schemaMappings.filter((mapping) =>
                mapping.fields.some((field) => field.type === customType.name)
            );

            if (usedInSchemas.length > 0) {
                const schemaNames = usedInSchemas.map((m) => m.name).join(", ");
                new Notice(
                    `Cannot delete type "${customType.name}" because it is used in the following schemas: ${schemaNames}`
                );
                return;
            }

            const index = this.settings.customTypes.findIndex(
                (t) => t.id === customType.id
            );
            if (index >= 0) {
                this.settings.customTypes.splice(index, 1);
                await this.onSettingsChange();
                void this.display();
            }
        });

        // Info row
        const infoRow = itemEl.createDiv({
            cls: "frontmatter-linter-custom-type-info",
        });
        infoRow.createEl("span", {
            text: `${customType.fields.length} fields`,
            cls: "frontmatter-linter-custom-type-field-count",
        });
    }
}
