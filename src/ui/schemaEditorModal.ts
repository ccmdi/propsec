import { App, Modal, Notice, Setting, TFile, TFolder, AbstractInputSuggest } from "obsidian";
import { Field, Schema, TypeDef, PRIMITIVE_TYPES } from "@propsec/core";
import { extractSchemaFromTemplate } from "../schema/extractor";
import { FieldEditorModal } from "./fieldEditorModal";
import { ruleInput } from "./ruleInput";

/**
 * Modal for editing a schema
 */
export class SchemaEditorModal extends FieldEditorModal {
    private schema: Schema;
    private onSave: (schema: Schema) => void;
    private templatesFolder: string;
    private types: TypeDef[];
    private enablePropertySuggestions: boolean;
    private countMatches: (schema: Schema) => number;

    constructor(
        app: App,
        schema: Schema,
        templatesFolder: string,
        types: TypeDef[],
        onSave: (schema: Schema) => void,
        countMatches: (schema: Schema) => number,
        enablePropertySuggestions: boolean = true
    ) {
        super(app);
        this.schema = JSON.parse(JSON.stringify(schema)) as unknown as Schema;
        this.templatesFolder = templatesFolder;
        this.types = types;
        this.onSave = onSave;
        this.countMatches = countMatches;
        this.enablePropertySuggestions = enablePropertySuggestions;
    }

    // ========== Abstract Method Implementations ==========

    protected getFields(): Field[] {
        return this.schema.fields;
    }

    protected setFields(fields: Field[]): void {
        this.schema.fields = fields;
    }

    protected getAvailableTypes(): string[] {
        return [...PRIMITIVE_TYPES, ...this.types.map(t => t.name)];
    }

    protected onAddField(): void {
        this.schema.fields.push({
            name: "",
            type: "string",
            required: true,
        });
        this.doRenderFields();
    }

    // ========== Property Suggestions ==========

    private get suggestCallback(): ((input: HTMLInputElement) => void) | undefined {
        return this.enablePropertySuggestions ? (input) => this.attachPropertySuggest(input) : undefined;
    }

    private doRenderFields(): void {
        this.renderFields(
            "No fields defined. Add fields or import from a template.",
            this.suggestCallback
        );
    }

    private attachPropertySuggest(input: HTMLInputElement): void {
        const knownProperties = Object.keys(this.app.metadataTypeManager.properties);
        new PropertySuggest(
            this.app,
            input,
            knownProperties,
            (prop) => this.getPropertyType(prop),
            () => {},
            (prop) => this.getPropertyDisplayName(prop)
        );
    }

    // ========== Modal Lifecycle ==========

    onOpen(): void {
        const { contentEl } = this;

        contentEl.addClass("propsec-schema-editor");

        contentEl.createEl("h2", { text: `Edit Schema: ${this.schema.name}` });

        new Setting(contentEl)
            .setName("Name")
            .setDesc("A friendly name for this schema")
            .addText((text) =>
                text
                    .setValue(this.schema.name)
                    .onChange((value) => {
                        this.schema.name = value;
                    })
            );

        new Setting(contentEl)
            .setName("Applies to")
            .setDesc("A rule that picks the notes this schema checks");
        ruleInput(this.app, contentEl, {
            context: { slot: "where", properties: this.ruleProperties() },
            value: this.schema.where,
            onChange: (value) => {
                this.schema.where = value;
            },
            preview: () => {
                const count = this.countMatches(this.schema);
                return `Matches ${count} note${count === 1 ? "" : "s"}`;
            },
        });

        contentEl.createEl("hr");

        const fieldsHeader = contentEl.createDiv({
            cls: "propsec-fields-header",
        });
        fieldsHeader.createEl("h3", { text: "Fields" });

        this.fieldsContainer = contentEl.createDiv({
            cls: "propsec-fields-container",
        });

        this.doRenderFields();

        const buttonsRow = contentEl.createDiv({
            cls: "propsec-buttons-row",
        });

        const addFieldBtn = buttonsRow.createEl("button", { text: "Add field" });
        addFieldBtn.addEventListener("click", () => this.onAddField());

        const importBtn = buttonsRow.createEl("button", {
            text: "Import from template...",
        });
        importBtn.addEventListener("click", () => this.showTemplateSelector());

        contentEl.createEl("hr");

        const footerButtons = contentEl.createDiv({
            cls: "propsec-footer-buttons",
        });

        const cancelBtn = footerButtons.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => this.close());

        const saveBtn = footerButtons.createEl("button", {
            text: "Save",
            cls: "mod-cta",
        });
        saveBtn.addEventListener("click", () => {
            this.schema.fields = this.schema.fields.filter(
                (f) => f.name.trim() !== ""
            );
            this.onSave(this.schema);
            this.close();
        });
    }

    onClose(): void {
        this.removeConstraintsSection();
        const { contentEl } = this;
        contentEl.empty();
    }

    // ========== Template Import ==========

    private showTemplateSelector(): void {
        const templatesFolder = this.app.vault.getAbstractFileByPath(this.templatesFolder);

        if (!templatesFolder || !(templatesFolder instanceof TFolder)) {
            new Notice(`Templates folder "${this.templatesFolder}" not found. Check your settings.`);
            return;
        }

        const templateFiles = this.getTemplateFiles(templatesFolder);

        if (templateFiles.length === 0) {
            new Notice("No template files found in templates folder.");
            return;
        }

        const modal = new TemplateSelectorModal(
            this.app,
            templateFiles,
            (file) => {
                const fields = extractSchemaFromTemplate(this.app, file);
                const existingNames = new Set(this.schema.fields.map((f) => f.name));
                for (const newField of fields) {
                    if (!existingNames.has(newField.name)) {
                        this.schema.fields.push(newField);
                    }
                }
                this.doRenderFields();
            }
        );
        void modal.open();
    }

    private getTemplateFiles(folder: TFolder): TFile[] {
        const files: TFile[] = [];
        for (const child of folder.children) {
            if (child instanceof TFile && child.extension === "md") {
                files.push(child);
            } else if (child instanceof TFolder) {
                files.push(...this.getTemplateFiles(child));
            }
        }
        return files;
    }

    private getPropertyType(propertyName: string): string {
        const propInfo = this.app.metadataTypeManager.properties[propertyName];
        return propInfo?.widget ?? "text";
    }

    private getPropertyDisplayName(propertyKey: string): string {
        const propInfo = this.app.metadataTypeManager.properties[propertyKey];
        return propInfo?.name ?? propertyKey;
    }

}

/**
 * Inline suggest for property names using Obsidian's native suggest UI
 */
class PropertySuggest extends AbstractInputSuggest<string> {
    private properties: string[];
    private onSelectCallback: (value: string) => void;
    private getType: (prop: string) => string;
    private getDisplayName: (prop: string) => string;
    private textInput: HTMLInputElement;

    constructor(
        app: App,
        inputEl: HTMLInputElement,
        properties: string[],
        getType: (prop: string) => string,
        onSelect: (value: string) => void,
        getDisplayName?: (prop: string) => string
    ) {
        super(app, inputEl);
        this.textInput = inputEl;
        this.properties = properties;
        this.getType = getType;
        this.onSelectCallback = onSelect;
        this.getDisplayName = getDisplayName || ((prop) => prop);
    }

    getSuggestions(query: string): string[] {
        const lowerQuery = query.toLowerCase();
        return this.properties.filter(prop =>
            prop.toLowerCase().includes(lowerQuery)
        );
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.addClass("propsec-property-suggestion");
        const displayName = this.getDisplayName(value);
        el.createSpan({ text: displayName, cls: "propsec-property-name" });
        const propType = this.getType(value);
        el.createSpan({ text: propType, cls: "propsec-property-type" });
    }

    selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
        const displayName = this.getDisplayName(value);
        this.textInput.value = displayName;
        this.textInput.dispatchEvent(new Event("input", { bubbles: true }));
        this.onSelectCallback(displayName);
        this.close();
    }
}

/**
 * Simple modal for selecting a template file
 */
class TemplateSelectorModal extends Modal {
    private files: TFile[];
    private onSelect: (file: TFile) => void;

    constructor(app: App, files: TFile[], onSelect: (file: TFile) => void) {
        super(app);
        this.files = files;
        this.onSelect = onSelect;
    }

    onOpen(): void {
        const { contentEl } = this;

        contentEl.createEl("h3", { text: "Select template" });

        const list = contentEl.createDiv({
            cls: "propsec-template-list",
        });

        for (const file of this.files) {
            const item = list.createDiv({
                cls: "propsec-template-item",
            });
            item.setText(file.basename);
            item.addEventListener("click", () => {
                this.onSelect(file);
                this.close();
            });
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
