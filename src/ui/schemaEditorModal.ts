import { App, Modal, Notice, setIcon, Setting, TFile, TFolder } from "obsidian";
import {
    FieldType,
    SchemaField,
    SchemaMapping,
    StringConstraints,
    NumberConstraints,
    ArrayConstraints,
    ObjectConstraints,
} from "../types";
import { extractSchemaFromTemplate, getAllFieldTypes, getTypeDisplayName } from "../schema/extractor";

export interface SchemaEditorResult {
    saved: boolean;
    mapping: SchemaMapping;
}

/**
 * Modal for editing a schema mapping
 */
export class SchemaEditorModal extends Modal {
    private mapping: SchemaMapping;
    private onSave: (mapping: SchemaMapping) => void;
    private templatesFolder: string;
    private fieldsContainer: HTMLElement | null = null;
    private expandedFields: Set<number> = new Set();
    private activeConstraintsSection: HTMLElement | null = null;

    constructor(
        app: App,
        mapping: SchemaMapping,
        templatesFolder: string,
        onSave: (mapping: SchemaMapping) => void
    ) {
        super(app);
        // Deep copy the mapping to avoid mutating the original
        this.mapping = JSON.parse(JSON.stringify(mapping));
        this.templatesFolder = templatesFolder;
        this.onSave = onSave;
    }

    onOpen(): void {
        const { contentEl } = this;

        contentEl.addClass("frontmatter-linter-schema-editor");

        // Header
        contentEl.createEl("h2", { text: `Edit Schema: ${this.mapping.name}` });

        // Name field
        new Setting(contentEl)
            .setName("Name")
            .setDesc("A friendly name for this schema")
            .addText((text) =>
                text
                    .setValue(this.mapping.name)
                    .onChange((value) => {
                        this.mapping.name = value;
                    })
            );

        // Query field
        new Setting(contentEl)
            .setName("Query")
            .setDesc("Match files by folder or tag. Examples: folder, folder/*, #tag, folder/* or #tag")
            .addText((text) =>
                text
                    .setPlaceholder("e.g., Journal/Gym/* or #gym")
                    .setValue(this.mapping.query || "")
                    .onChange((value) => {
                        this.mapping.query = value;
                    })
            );

        // Separator
        contentEl.createEl("hr");

        // Fields section header
        const fieldsHeader = contentEl.createDiv({
            cls: "frontmatter-linter-fields-header",
        });
        fieldsHeader.createEl("h3", { text: "Fields" });

        // Fields container
        this.fieldsContainer = contentEl.createDiv({
            cls: "frontmatter-linter-fields-container",
        });

        this.renderFields();

        // Add field button and import button
        const buttonsRow = contentEl.createDiv({
            cls: "frontmatter-linter-buttons-row",
        });

        const addFieldBtn = buttonsRow.createEl("button", { text: "+ Add Field" });
        addFieldBtn.addEventListener("click", () => {
            this.mapping.fields.push({
                name: "",
                type: "string",
                required: true,
            });
            this.renderFields();
        });

        const importBtn = buttonsRow.createEl("button", {
            text: "Import from Template...",
        });
        importBtn.addEventListener("click", () => {
            this.showTemplateSelector();
        });

        // Separator
        contentEl.createEl("hr");

        // Save/Cancel buttons
        const footerButtons = contentEl.createDiv({
            cls: "frontmatter-linter-footer-buttons",
        });

        const cancelBtn = footerButtons.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => {
            this.close();
        });

        const saveBtn = footerButtons.createEl("button", {
            text: "Save",
            cls: "mod-cta",
        });
        saveBtn.addEventListener("click", () => {
            // Filter out fields with empty names
            this.mapping.fields = this.mapping.fields.filter(
                (f) => f.name.trim() !== ""
            );
            this.onSave(this.mapping);
            this.close();
        });
    }

    private renderFields(): void {
        if (!this.fieldsContainer) return;

        // Remove any existing constraints overlay
        this.removeConstraintsSection();
        this.expandedFields.clear();

        this.fieldsContainer.empty();

        if (this.mapping.fields.length === 0) {
            this.fieldsContainer.createEl("p", {
                text: "No fields defined. Add fields or import from a template.",
                cls: "frontmatter-linter-no-fields",
            });
            return;
        }

        this.mapping.fields.forEach((field, index) => {
            this.renderFieldCard(this.fieldsContainer!, field, index);
        });
    }

    private removeConstraintsSection(): void {
        if (this.activeConstraintsSection) {
            this.activeConstraintsSection.remove();
            this.activeConstraintsSection = null;
        }
    }

    private renderFieldCard(
        container: HTMLElement,
        field: SchemaField,
        index: number
    ): HTMLElement {
        const card = container.createDiv({
            cls: "frontmatter-linter-field-card",
        });

        // Main row: name, type, required, expand, delete
        const mainRow = card.createDiv({
            cls: "frontmatter-linter-field-main-row",
        });

        // Name input
        const nameInput = mainRow.createEl("input", {
            type: "text",
            cls: "frontmatter-linter-field-name",
        });
        nameInput.value = field.name;
        nameInput.placeholder = "field_name";
        nameInput.addEventListener("input", (e) => {
            field.name = (e.target as HTMLInputElement).value;
        });

        // Type select
        const typeSelect = mainRow.createEl("select", {
            cls: "frontmatter-linter-field-type",
        });
        for (const type of getAllFieldTypes()) {
            const option = typeSelect.createEl("option", {
                value: type,
                text: getTypeDisplayName(type),
            });
            if (type === field.type) {
                option.selected = true;
            }
        }
        typeSelect.addEventListener("change", (e) => {
            field.type = (e.target as HTMLSelectElement).value as FieldType;
            // Clear constraints when type changes
            delete field.stringConstraints;
            delete field.numberConstraints;
            delete field.arrayConstraints;
            delete field.objectConstraints;
            // Close any open overlay and replace just this card
            this.removeConstraintsSection();
            this.expandedFields.delete(index);
            this.replaceFieldCard(card, field, index);
        });

        // Required checkbox with label
        const requiredLabel = mainRow.createEl("label", {
            cls: "frontmatter-linter-required-label",
        });
        const requiredCheckbox = requiredLabel.createEl("input", {
            type: "checkbox",
        });
        requiredCheckbox.checked = field.required;
        requiredCheckbox.addEventListener("change", (e) => {
            field.required = (e.target as HTMLInputElement).checked;
        });
        requiredLabel.appendText(" Req");

        // Expand button (only if type supports constraints)
        const hasConstraints = this.typeSupportsConstraints(field.type);
        if (hasConstraints) {
            const expandBtn = mainRow.createEl("button", {
                cls: "frontmatter-linter-icon-btn",
                attr: { title: "Toggle constraints" },
            });
            setIcon(expandBtn, "chevron-right");
            expandBtn.addEventListener("click", () => {
                if (this.expandedFields.has(index)) {
                    // Collapse: animate out, then clean up
                    this.collapseField(index, card, expandBtn);
                } else {
                    // Close any other expanded field first
                    if (this.expandedFields.size > 0) {
                        this.removeConstraintsSection();
                        // Update previous expanded card's icon
                        const prevIndex = Array.from(this.expandedFields)[0];
                        const prevCard = this.fieldsContainer?.children[prevIndex] as HTMLElement;
                        if (prevCard) {
                            prevCard.removeClass("expanded");
                            const prevBtn = prevCard.querySelector(".frontmatter-linter-icon-btn");
                            if (prevBtn) setIcon(prevBtn as HTMLElement, "chevron-right");
                        }
                        this.expandedFields.clear();
                    }
                    // Expand this field
                    this.expandedFields.add(index);
                    card.addClass("expanded");
                    setIcon(expandBtn, "chevron-down");
                    this.showConstraintsOverlay(card, field);
                }
            });
        }

        // Delete button
        const deleteBtn = mainRow.createEl("button", {
            cls: "frontmatter-linter-icon-btn frontmatter-linter-delete-btn",
            attr: { title: "Remove field" },
        });
        setIcon(deleteBtn, "x");
        deleteBtn.addEventListener("click", () => {
            this.mapping.fields.splice(index, 1);
            this.expandedFields.delete(index);
            this.renderFields();
        });

        return card;
    }

    private typeSupportsConstraints(type: FieldType): boolean {
        return ["string", "number", "array", "object"].includes(type);
    }

    private replaceFieldCard(oldCard: HTMLElement, field: SchemaField, index: number): void {
        // Create a temporary container to render the new card
        const temp = document.createElement("div");
        const newCard = this.renderFieldCard(temp, field, index);
        // Replace old card with new one
        oldCard.replaceWith(newCard);
    }

    private showConstraintsOverlay(card: HTMLElement, field: SchemaField): void {
        const rect = card.getBoundingClientRect();

        // Append to modal container so focus stays within modal
        const section = this.containerEl.createDiv({
            cls: "frontmatter-linter-constraints-section",
        });

        section.style.top = `${rect.bottom + 4}px`;
        section.style.left = `${rect.left}px`;
        section.style.width = `${rect.width}px`;

        this.renderConstraints(section, field);
        this.activeConstraintsSection = section;
    }

    private collapseField(index: number, card: HTMLElement, expandBtn: HTMLElement): void {
        if (this.activeConstraintsSection) {
            this.activeConstraintsSection.addClass("collapsing");
            this.activeConstraintsSection.addEventListener("animationend", () => {
                this.removeConstraintsSection();
                this.expandedFields.delete(index);
                card.removeClass("expanded");
                setIcon(expandBtn, "chevron-right");
            }, { once: true });
        } else {
            this.expandedFields.delete(index);
            card.removeClass("expanded");
            setIcon(expandBtn, "chevron-right");
        }
    }

    private renderConstraints(container: HTMLElement, field: SchemaField): void {
        switch (field.type) {
            case "string":
                this.renderStringConstraints(container, field);
                break;
            case "number":
                this.renderNumberConstraints(container, field);
                break;
            case "array":
                this.renderArrayConstraints(container, field);
                break;
            case "object":
                this.renderObjectConstraints(container, field);
                break;
        }
    }

    private renderStringConstraints(container: HTMLElement, field: SchemaField): void {
        if (!field.stringConstraints) {
            field.stringConstraints = {};
        }
        const constraints = field.stringConstraints;

        container.createEl("div", {
            text: "String Constraints",
            cls: "frontmatter-linter-constraints-title",
        });

        const grid = container.createDiv({
            cls: "frontmatter-linter-constraints-grid",
        });

        // Pattern (regex)
        const patternRow = grid.createDiv({ cls: "frontmatter-linter-constraint-row" });
        patternRow.createEl("label", { text: "Pattern (regex):" });
        const patternInput = patternRow.createEl("input", {
            type: "text",
            placeholder: "e.g., ^[A-Z].*",
        });
        patternInput.value = constraints.pattern || "";
        patternInput.addEventListener("input", (e) => {
            const val = (e.target as HTMLInputElement).value;
            constraints.pattern = val || undefined;
        });

        // Min length
        const minLenRow = grid.createDiv({ cls: "frontmatter-linter-constraint-row" });
        minLenRow.createEl("label", { text: "Min length:" });
        const minLenInput = minLenRow.createEl("input", {
            type: "number",
            attr: { min: "0" },
        });
        minLenInput.value = constraints.minLength !== undefined ? String(constraints.minLength) : "";
        minLenInput.addEventListener("input", (e) => {
            const val = (e.target as HTMLInputElement).value;
            constraints.minLength = val ? parseInt(val, 10) : undefined;
        });

        // Max length
        const maxLenRow = grid.createDiv({ cls: "frontmatter-linter-constraint-row" });
        maxLenRow.createEl("label", { text: "Max length:" });
        const maxLenInput = maxLenRow.createEl("input", {
            type: "number",
            attr: { min: "0" },
        });
        maxLenInput.value = constraints.maxLength !== undefined ? String(constraints.maxLength) : "";
        maxLenInput.addEventListener("input", (e) => {
            const val = (e.target as HTMLInputElement).value;
            constraints.maxLength = val ? parseInt(val, 10) : undefined;
        });
    }

    private renderNumberConstraints(container: HTMLElement, field: SchemaField): void {
        if (!field.numberConstraints) {
            field.numberConstraints = {};
        }
        const constraints = field.numberConstraints;

        container.createEl("div", {
            text: "Number Constraints",
            cls: "frontmatter-linter-constraints-title",
        });

        const grid = container.createDiv({
            cls: "frontmatter-linter-constraints-grid",
        });

        // Min
        const minRow = grid.createDiv({ cls: "frontmatter-linter-constraint-row" });
        minRow.createEl("label", { text: "Min value:" });
        const minInput = minRow.createEl("input", { type: "number" });
        minInput.value = constraints.min !== undefined ? String(constraints.min) : "";
        minInput.addEventListener("input", (e) => {
            const val = (e.target as HTMLInputElement).value;
            constraints.min = val ? parseFloat(val) : undefined;
        });

        // Max
        const maxRow = grid.createDiv({ cls: "frontmatter-linter-constraint-row" });
        maxRow.createEl("label", { text: "Max value:" });
        const maxInput = maxRow.createEl("input", { type: "number" });
        maxInput.value = constraints.max !== undefined ? String(constraints.max) : "";
        maxInput.addEventListener("input", (e) => {
            const val = (e.target as HTMLInputElement).value;
            constraints.max = val ? parseFloat(val) : undefined;
        });
    }

    private renderArrayConstraints(container: HTMLElement, field: SchemaField): void {
        if (!field.arrayConstraints) {
            field.arrayConstraints = {};
        }
        const constraints = field.arrayConstraints;

        container.createEl("div", {
            text: "Array Constraints",
            cls: "frontmatter-linter-constraints-title",
        });

        const grid = container.createDiv({
            cls: "frontmatter-linter-constraints-grid",
        });

        // Min items
        const minRow = grid.createDiv({ cls: "frontmatter-linter-constraint-row" });
        minRow.createEl("label", { text: "Min items:" });
        const minInput = minRow.createEl("input", {
            type: "number",
            attr: { min: "0" },
        });
        minInput.value = constraints.minItems !== undefined ? String(constraints.minItems) : "";
        minInput.addEventListener("input", (e) => {
            const val = (e.target as HTMLInputElement).value;
            constraints.minItems = val ? parseInt(val, 10) : undefined;
        });

        // Max items
        const maxRow = grid.createDiv({ cls: "frontmatter-linter-constraint-row" });
        maxRow.createEl("label", { text: "Max items:" });
        const maxInput = maxRow.createEl("input", {
            type: "number",
            attr: { min: "0" },
        });
        maxInput.value = constraints.maxItems !== undefined ? String(constraints.maxItems) : "";
        maxInput.addEventListener("input", (e) => {
            const val = (e.target as HTMLInputElement).value;
            constraints.maxItems = val ? parseInt(val, 10) : undefined;
        });
    }

    private renderObjectConstraints(container: HTMLElement, field: SchemaField): void {
        if (!field.objectConstraints) {
            field.objectConstraints = {};
        }
        const constraints = field.objectConstraints;

        container.createEl("div", {
            text: "Object Constraints",
            cls: "frontmatter-linter-constraints-title",
        });

        const grid = container.createDiv({
            cls: "frontmatter-linter-constraints-grid",
        });

        // Required keys (comma-separated)
        const keysRow = grid.createDiv({ cls: "frontmatter-linter-constraint-row" });
        keysRow.createEl("label", { text: "Required keys:" });
        const keysInput = keysRow.createEl("input", {
            type: "text",
            placeholder: "key1, key2, key3",
        });
        keysInput.value = constraints.requiredKeys?.join(", ") || "";
        keysInput.addEventListener("input", (e) => {
            const val = (e.target as HTMLInputElement).value;
            if (val.trim()) {
                constraints.requiredKeys = val.split(",").map((k) => k.trim()).filter((k) => k);
            } else {
                constraints.requiredKeys = undefined;
            }
        });
    }

    private showTemplateSelector(): void {
        // Get template files from templates folder
        const templatesFolder = this.app.vault.getAbstractFileByPath(
            this.templatesFolder
        );

        if (!templatesFolder || !(templatesFolder instanceof TFolder)) {
            new Notice(`Templates folder "${this.templatesFolder}" not found. Check your settings.`);
            return;
        }

        const templateFiles = this.getTemplateFiles(templatesFolder);

        if (templateFiles.length === 0) {
            new Notice("No template files found in templates folder.");
            return;
        }

        // Create a simple dropdown modal
        const modal = new TemplateSelectorModal(
            this.app,
            templateFiles,
            async (file) => {
                const fields = await extractSchemaFromTemplate(this.app, file);
                // Merge with existing fields (add new ones, don't overwrite)
                const existingNames = new Set(this.mapping.fields.map((f) => f.name));
                for (const newField of fields) {
                    if (!existingNames.has(newField.name)) {
                        this.mapping.fields.push(newField);
                    }
                }
                this.mapping.sourceTemplatePath = file.path;
                this.renderFields();
            }
        );
        modal.open();
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

    onClose(): void {
        this.removeConstraintsSection();
        const { contentEl } = this;
        contentEl.empty();
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

        contentEl.createEl("h3", { text: "Select Template" });

        const list = contentEl.createEl("div", {
            cls: "frontmatter-linter-template-list",
        });

        for (const file of this.files) {
            const item = list.createEl("div", {
                cls: "frontmatter-linter-template-item",
            });
            item.setText(file.path);
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
