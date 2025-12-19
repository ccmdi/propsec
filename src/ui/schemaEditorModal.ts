import { App, Modal, Notice, setIcon, Setting, TFile, TFolder, AbstractInputSuggest } from "obsidian";
import {
    FieldType,
    SchemaField,
    SchemaMapping,
    CustomType,
    PropertyCondition,
    PropertyConditionOperator,
} from "../types";
import { extractSchemaFromTemplate, getAllFieldTypes, getTypeDisplayName } from "../schema/extractor";
import { getOperatorDisplayName } from "../query/matcher";

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
    private customTypes: CustomType[];
    private enablePropertySuggestions: boolean;
    private fieldsContainer: HTMLElement | null = null;
    private expandedFields: Set<number> = new Set();
    private activeConstraintsSection: HTMLElement | null = null;
    private scrollHandler: (() => void) | null = null;

    constructor(
        app: App,
        mapping: SchemaMapping,
        templatesFolder: string,
        customTypes: CustomType[],
        onSave: (mapping: SchemaMapping) => void,
        enablePropertySuggestions: boolean = true
    ) {
        super(app);
        // Deep copy the mapping to avoid mutating the original
        this.mapping = JSON.parse(JSON.stringify(mapping)) as SchemaMapping;
        this.templatesFolder = templatesFolder;
        this.customTypes = customTypes;
        this.onSave = onSave;
        this.enablePropertySuggestions = enablePropertySuggestions;
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
                    .setPlaceholder("e.g., Folder/* or #tag")
                    .setValue(this.mapping.query || "")
                    .onChange((value) => {
                        this.mapping.query = value;
                    })
            );

        // Property Filter section (collapsible)
        this.renderPropertyFilterSection(contentEl);

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

        // Close constraints overlay on scroll anywhere in modal to avoid detached state
        this.scrollHandler = () => {
            if (this.activeConstraintsSection && this.expandedFields.size > 0) {
                this.closeAllExpanded();
            }
        };
        this.containerEl.addEventListener("scroll", this.scrollHandler, true);

        this.renderFields();

        // Add field button and import button
        const buttonsRow = contentEl.createDiv({
            cls: "frontmatter-linter-buttons-row",
        });
        
        //eslint-disable-next-line obsidianmd/ui/sentence-case
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
            //eslint-disable-next-line obsidianmd/ui/sentence-case
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

    private closeAllExpanded(): void {
        // Close overlay
        this.removeConstraintsSection();
        // Reset all expanded card states
        for (const index of this.expandedFields) {
            const card = this.fieldsContainer?.children[index] as HTMLElement;
            if (card) {
                card.removeClass("expanded");
                const btn = card.querySelector(".frontmatter-linter-icon-btn");
                if (btn) setIcon(btn as HTMLElement, "chevron-right");
            }
        }
        this.expandedFields.clear();
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
        nameInput.placeholder = "Field name";
        nameInput.addEventListener("input", (e) => {
            field.name = (e.target as HTMLInputElement).value;
        });

        // Property suggestions for field name
        if (this.enablePropertySuggestions) {
            const knownProperties = Object.keys(this.app.metadataTypeManager.properties);
            new PropertySuggest(
                this.app,
                nameInput,
                knownProperties,
                (prop) => this.getPropertyType(prop),
                () => {} // No additional callback needed
            );
        }

        // Type select
        const typeSelect = mainRow.createEl("select", {
            cls: "frontmatter-linter-field-type",
        });
        for (const type of this.getAvailableTypes()) {
            const option = typeSelect.createEl("option", {
                value: type,
                text: getTypeDisplayName(type),
            });
            if (type === field.type) {
                option.selected = true;
            }
        }
        typeSelect.addEventListener("change", (e) => {
            field.type = (e.target as HTMLSelectElement).value;
            // Clear constraints when type changes
            delete field.stringConstraints;
            delete field.numberConstraints;
            delete field.arrayConstraints;
            delete field.objectConstraints;
            delete field.arrayElementType;
            delete field.objectKeyType;
            delete field.objectValueType;
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
        requiredLabel.appendText(" Req");

        // Warn checkbox with label (mutually exclusive with required)
        const warnLabel = mainRow.createEl("label", {
            cls: "frontmatter-linter-required-label",
            attr: { title: "Warn if missing (not an error)" },
        });
        const warnCheckbox = warnLabel.createEl("input", {
            type: "checkbox",
        });
        warnCheckbox.checked = field.warn || false;
        warnLabel.appendText(" Warn");

        // Mutual exclusion handlers
        requiredCheckbox.addEventListener("change", (e) => {
            field.required = (e.target as HTMLInputElement).checked;
            if (field.required) {
                field.warn = false;
                warnCheckbox.checked = false;
            }
        });
        warnCheckbox.addEventListener("change", (e) => {
            field.warn = (e.target as HTMLInputElement).checked;
            if (field.warn) {
                field.required = false;
                requiredCheckbox.checked = false;
            }
        });

        // Expand button for conditions and constraints
        const expandBtn = mainRow.createEl("button", {
            cls: "frontmatter-linter-icon-btn",
            attr: { title: "Configure conditions and constraints" },
        });
        // Show indicator if field has a condition set
        setIcon(expandBtn, "chevron-right");

        expandBtn.addEventListener("click", () => {
            if (this.expandedFields.has(index)) {
                // Collapse: animate out, then clean up
                this.collapseField(index, card, expandBtn, field);
            } else {
                // Close any other expanded field first
                if (this.expandedFields.size > 0) {
                    this.removeConstraintsSection();
                    // Update previous expanded card's icon
                    const prevIndex = Array.from(this.expandedFields)[0];
                    const prevCard = this.fieldsContainer?.children[prevIndex] as HTMLElement;
                    if (prevCard) {
                        prevCard.removeClass("expanded");
                        const prevBtn = prevCard.querySelector(".frontmatter-linter-icon-btn:not(.frontmatter-linter-delete-btn)");
                        const prevField = this.mapping.fields[prevIndex];
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

    private getAvailableTypes(): string[] {
        // Get all primitive types
        const primitives = getAllFieldTypes();

        // Get custom types
        const customTypeNames = this.customTypes.map(t => t.name);

        return [...primitives, ...customTypeNames];
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

    private collapseField(index: number, card: HTMLElement, expandBtn: HTMLElement, field: SchemaField): void {
        const icon = "chevron-right";
        if (this.activeConstraintsSection) {
            this.activeConstraintsSection.addClass("collapsing");
            this.activeConstraintsSection.addEventListener("animationend", () => {
                this.removeConstraintsSection();
                this.expandedFields.delete(index);
                card.removeClass("expanded");
                setIcon(expandBtn, icon);
            }, { once: true });
        } else {
            this.expandedFields.delete(index);
            card.removeClass("expanded");
            setIcon(expandBtn, icon);
        }
    }

    private renderConstraints(container: HTMLElement, field: SchemaField): void {
        // Condition section (applies to all field types)
        this.renderConditionSection(container, field);

        // Type-specific constraints
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
        }
    }

    private renderConditionSection(container: HTMLElement, field: SchemaField): void {
        const section = container.createDiv({ cls: "frontmatter-linter-condition-section" });

        const header = section.createDiv({ cls: "frontmatter-linter-condition-header" });
        header.createEl("span", { text: "Condition", cls: "frontmatter-linter-constraints-title" });

        const hasCondition = !!field.condition;

        if (!hasCondition) {
            const addBtn = header.createEl("button", {
                cls: "frontmatter-linter-add-condition-btn",
                attr: { title: "Add condition" }
            });
            setIcon(addBtn, "plus");
            addBtn.addEventListener("click", () => {
                field.condition = {
                    field: "",
                    operator: "equals",
                    value: "",
                };
                this.rerenderConditionSection(section, field);
            });
        } else {
            this.renderFieldConditionRow(section, field);
        }
    }

    private rerenderConditionSection(section: HTMLElement, field: SchemaField): void {
        section.empty();

        const header = section.createDiv({ cls: "frontmatter-linter-condition-header" });
        header.createEl("span", { text: "Condition", cls: "frontmatter-linter-constraints-title" });

        if (!field.condition) {
            const addBtn = header.createEl("button", {
                cls: "frontmatter-linter-add-condition-btn",
                attr: { title: "Add condition" }
            });
            setIcon(addBtn, "plus");
            addBtn.addEventListener("click", () => {
                field.condition = {
                    field: "",
                    operator: "equals",
                    value: "",
                };
                this.rerenderConditionSection(section, field);
            });
        } else {
            this.renderFieldConditionRow(section, field);
        }
    }

    private renderFieldConditionRow(container: HTMLElement, field: SchemaField): void {
        if (!field.condition) return;

        const desc = container.createEl("div", {
            text: "Only validate this field when:",
            cls: "frontmatter-linter-condition-desc"
        });

        const row = container.createDiv({ cls: "frontmatter-linter-field-condition-row" });

        // Field input
        const fieldInput = row.createEl("input", {
            type: "text",
            placeholder: "field name",
            cls: "frontmatter-linter-condition-field",
        });
        fieldInput.value = field.condition.field;

        // Property suggestions
        if (this.enablePropertySuggestions) {
            const knownProperties = Object.keys(this.app.metadataTypeManager.properties);
            new PropertySuggest(
                this.app,
                fieldInput,
                knownProperties,
                (prop) => this.getPropertyType(prop),
                () => {}
            );
        }

        fieldInput.addEventListener("input", (e) => {
            field.condition!.field = (e.target as HTMLInputElement).value;
        });

        // Operator select
        const operatorSelect = row.createEl("select", { cls: "frontmatter-linter-condition-operator" });
        const operators: PropertyConditionOperator[] = [
            "equals", "not_equals", "contains", "not_contains",
            "greater_than", "less_than", "greater_or_equal", "less_or_equal"
        ];
        for (const op of operators) {
            const option = operatorSelect.createEl("option", {
                value: op,
                text: getOperatorDisplayName(op),
            });
            if (op === field.condition.operator) {
                option.selected = true;
            }
        }
        operatorSelect.addEventListener("change", (e) => {
            field.condition!.operator = (e.target as HTMLSelectElement).value as PropertyConditionOperator;
        });

        // Value input
        const valueInput = row.createEl("input", {
            type: "text",
            placeholder: "value",
            cls: "frontmatter-linter-condition-value",
        });
        valueInput.value = field.condition.value;
        valueInput.addEventListener("input", (e) => {
            field.condition!.value = (e.target as HTMLInputElement).value;
        });

        // Delete button
        const deleteBtn = row.createEl("button", {
            cls: "frontmatter-linter-condition-delete",
            attr: { title: "Remove condition" }
        });
        setIcon(deleteBtn, "x");
        deleteBtn.addEventListener("click", () => {
            delete field.condition;
            const section = container.closest(".frontmatter-linter-condition-section") as HTMLElement;
            if (section) {
                this.rerenderConditionSection(section, field);
            }
        });
    }

    private renderStringConstraints(container: HTMLElement, field: SchemaField): void {
        if (!field.stringConstraints) {
            field.stringConstraints = {};
        }
        const constraints = field.stringConstraints;

        container.createEl("div", {
            text: "String constraints",
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
            text: "Number constraints",
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
            text: "Array configuration",
            cls: "frontmatter-linter-constraints-title",
        });

        const grid = container.createDiv({
            cls: "frontmatter-linter-constraints-grid",
        });

        // Element type selector
        const elementTypeRow = grid.createDiv({ cls: "frontmatter-linter-constraint-row" });
        elementTypeRow.createEl("label", { text: "Element type:" });
        const elementTypeSelect = elementTypeRow.createEl("select");

        // Add "any" option
        const anyOption = elementTypeSelect.createEl("option", {
            value: "",
            text: "(any type)",
        });
        if (!field.arrayElementType) {
            anyOption.selected = true;
        }

        const availableTypes = this.getAvailableTypes();
        for (const type of availableTypes) {
            const option = elementTypeSelect.createEl("option", {
                value: type,
                text: getTypeDisplayName(type),
            });
            if (type === field.arrayElementType) {
                option.selected = true;
            }
        }

        elementTypeSelect.addEventListener("change", (e) => {
            const value = (e.target as HTMLSelectElement).value;
            field.arrayElementType = value || undefined;
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

        // Contains (comma-separated values that must be present)
        const containsRow = grid.createDiv({ cls: "frontmatter-linter-constraint-row" });
        containsRow.createEl("label", { text: "Contains:" });
        const containsInput = containsRow.createEl("input", {
            type: "text",
            placeholder: "value1, value2",
        });
        containsInput.value = constraints.contains?.join(", ") || "";
        containsInput.addEventListener("input", (e) => {
            const val = (e.target as HTMLInputElement).value;
            if (val.trim()) {
                constraints.contains = val.split(",").map((v) => v.trim()).filter((v) => v);
            } else {
                constraints.contains = undefined;
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
            //eslint-disable-next-line @typescript-eslint/no-misused-promises
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

    private renderPropertyFilterSection(container: HTMLElement): void {
        // Initialize filter if not exists
        if (!this.mapping.propertyFilter) {
            this.mapping.propertyFilter = {};
        }
        const filter = this.mapping.propertyFilter;

        // Collapsible section
        const section = container.createDiv({
            cls: "frontmatter-linter-filter-section",
        });

        const header = section.createDiv({
            cls: "frontmatter-linter-filter-header",
        });
        header.createEl("span", { text: "Filter (optional)" });
        const toggleIcon = header.createEl("span", { cls: "frontmatter-linter-filter-toggle" });
        setIcon(toggleIcon, "chevron-right");

        const content = section.createDiv({
            cls: "frontmatter-linter-filter-content frontmatter-linter-hidden",
        });

        // Check if any filter is set
        const hasFilters = filter.modifiedAfter || filter.modifiedBefore ||
            filter.createdAfter || filter.createdBefore ||
            filter.hasProperty || filter.notHasProperty ||
            (filter.conditions && filter.conditions.length > 0);

        if (hasFilters) {
            content.removeClass("frontmatter-linter-hidden");
            setIcon(toggleIcon, "chevron-down");
        }

        header.addEventListener("click", () => {
            const isHidden = content.hasClass("frontmatter-linter-hidden");
            content.toggleClass("frontmatter-linter-hidden", !isHidden);
            setIcon(toggleIcon, isHidden ? "chevron-down" : "chevron-right");
        });

        // Filter fields
        const grid = content.createDiv({ cls: "frontmatter-linter-filter-grid" });

        // Modified after
        const modAfterRow = grid.createDiv({ cls: "frontmatter-linter-filter-row" });
        modAfterRow.createEl("label", { text: "Modified after:" });
        const modAfterInput = modAfterRow.createEl("input", { type: "date" });
        modAfterInput.value = filter.modifiedAfter || "";
        modAfterInput.addEventListener("change", (e) => {
            filter.modifiedAfter = (e.target as HTMLInputElement).value || undefined;
        });

        // Modified before
        const modBeforeRow = grid.createDiv({ cls: "frontmatter-linter-filter-row" });
        modBeforeRow.createEl("label", { text: "Modified before:" });
        const modBeforeInput = modBeforeRow.createEl("input", { type: "date" });
        modBeforeInput.value = filter.modifiedBefore || "";
        modBeforeInput.addEventListener("change", (e) => {
            filter.modifiedBefore = (e.target as HTMLInputElement).value || undefined;
        });

        // Created after
        const createdAfterRow = grid.createDiv({ cls: "frontmatter-linter-filter-row" });
        createdAfterRow.createEl("label", { text: "Created after:" });
        const createdAfterInput = createdAfterRow.createEl("input", { type: "date" });
        createdAfterInput.value = filter.createdAfter || "";
        createdAfterInput.addEventListener("change", (e) => {
            filter.createdAfter = (e.target as HTMLInputElement).value || undefined;
        });

        // Created before
        const createdBeforeRow = grid.createDiv({ cls: "frontmatter-linter-filter-row" });
        createdBeforeRow.createEl("label", { text: "Created before:" });
        const createdBeforeInput = createdBeforeRow.createEl("input", { type: "date" });
        createdBeforeInput.value = filter.createdBefore || "";
        createdBeforeInput.addEventListener("change", (e) => {
            filter.createdBefore = (e.target as HTMLInputElement).value || undefined;
        });

        // Has property
        const hasPropRow = grid.createDiv({ cls: "frontmatter-linter-filter-row" });
        hasPropRow.createEl("label", { text: "Has property:" });
        const hasPropInput = hasPropRow.createEl("input", { type: "text", placeholder: "e.g., status" });
        hasPropInput.value = filter.hasProperty || "";
        hasPropInput.addEventListener("input", (e) => {
            filter.hasProperty = (e.target as HTMLInputElement).value || undefined;
        });

        // Not has property
        const notHasPropRow = grid.createDiv({ cls: "frontmatter-linter-filter-row" });
        notHasPropRow.createEl("label", { text: "Missing property:" });
        const notHasPropInput = notHasPropRow.createEl("input", { type: "text", placeholder: "e.g., draft" });
        notHasPropInput.value = filter.notHasProperty || "";
        notHasPropInput.addEventListener("input", (e) => {
            filter.notHasProperty = (e.target as HTMLInputElement).value || undefined;
        });

        // Property conditions section
        const conditionsSection = content.createDiv({ cls: "frontmatter-linter-conditions-section" });

        const conditionsHeader = conditionsSection.createDiv({ cls: "frontmatter-linter-conditions-header" });
        conditionsHeader.createEl("span", { text: "Property conditions" });
        const addConditionBtn = conditionsHeader.createEl("button", { cls: "frontmatter-linter-add-condition-btn" });
        setIcon(addConditionBtn, "plus");

        const conditionsList = conditionsSection.createDiv({ cls: "frontmatter-linter-conditions-list" });

        // Initialize conditions array if needed
        if (!filter.conditions) {
            filter.conditions = [];
        }

        const renderConditions = () => {
            conditionsList.empty();
            for (let i = 0; i < filter.conditions!.length; i++) {
                this.renderConditionRow(conditionsList, filter.conditions!, i, renderConditions);
            }
        };

        addConditionBtn.addEventListener("click", () => {
            filter.conditions!.push({
                property: "",
                operator: "equals",
                value: "",
            });
            renderConditions();
        });

        renderConditions();
    }

    private renderConditionRow(
        container: HTMLElement,
        conditions: PropertyCondition[],
        index: number,
        onUpdate: () => void
    ): void {
        const condition = conditions[index];
        const row = container.createDiv({ cls: "frontmatter-linter-condition-row" });

        // Property input with Obsidian native suggest
        const propInput = row.createEl("input", {
            type: "text",
            placeholder: "property",
            cls: "frontmatter-linter-condition-property",
        });
        propInput.value = condition.property;

        // Operator select
        const operatorSelect = row.createEl("select", { cls: "frontmatter-linter-condition-operator" });

        const updateOperators = () => {
            const propertyType = this.getPropertyType(condition.property);
            const operators = this.getOperatorsForType(propertyType);

            operatorSelect.empty();
            for (const op of operators) {
                const option = operatorSelect.createEl("option", {
                    value: op,
                    text: getOperatorDisplayName(op),
                });
                if (op === condition.operator) {
                    option.selected = true;
                }
            }

            // If current operator isn't valid for this type, reset to first valid
            if (!operators.includes(condition.operator)) {
                condition.operator = operators[0];
                operatorSelect.value = operators[0];
            }
        };

        updateOperators();

        // Set up property suggest with Obsidian native UI
        const knownProperties = Object.keys(this.app.metadataTypeManager.properties);
        new PropertySuggest(
            this.app,
            propInput,
            knownProperties,
            (prop) => this.getPropertyType(prop),
            () => updateOperators()
        );

        propInput.addEventListener("input", (e) => {
            condition.property = (e.target as HTMLInputElement).value;
            updateOperators();
        });

        operatorSelect.addEventListener("change", (e) => {
            condition.operator = (e.target as HTMLSelectElement).value as PropertyConditionOperator;
        });

        // Value input
        const valueInput = row.createEl("input", {
            type: "text",
            placeholder: "value",
            cls: "frontmatter-linter-condition-value",
        });
        valueInput.value = condition.value;
        valueInput.addEventListener("input", (e) => {
            condition.value = (e.target as HTMLInputElement).value;
        });

        // Delete button
        const deleteBtn = row.createEl("button", { cls: "frontmatter-linter-condition-delete" });
        setIcon(deleteBtn, "x");
        deleteBtn.addEventListener("click", () => {
            conditions.splice(index, 1);
            onUpdate();
        });
    }

    /**
     * Get the Obsidian property type for a property name
     */
    private getPropertyType(propertyName: string): string {
        const propInfo = this.app.metadataTypeManager.properties[propertyName];
        return propInfo?.widget ?? "text";
    }

    /**
     * Get valid operators for a property type
     */
    private getOperatorsForType(propertyType: string): PropertyConditionOperator[] {
        switch (propertyType) {
            case "number":
                return ["equals", "not_equals", "greater_than", "less_than", "greater_or_equal", "less_or_equal"];
            case "checkbox":
                return ["equals", "not_equals"];
            case "date":
            case "datetime":
                return ["equals", "not_equals", "greater_than", "less_than", "greater_or_equal", "less_or_equal"];
            case "tags":
            case "aliases":
            case "multitext":
                return ["contains", "not_contains", "equals", "not_equals"];
            case "text":
            default:
                return ["equals", "not_equals", "contains", "not_contains"];
        }
    }

    onClose(): void {
        // Clean up scroll listener
        if (this.scrollHandler) {
            this.containerEl.removeEventListener("scroll", this.scrollHandler, true);
        }
        this.removeConstraintsSection();
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Inline suggest for property names using Obsidian's native suggest UI
 */
class PropertySuggest extends AbstractInputSuggest<string> {
    private properties: string[];
    private onSelectCallback: (value: string) => void;
    private getType: (prop: string) => string;
    private textInput: HTMLInputElement;

    constructor(
        app: App,
        inputEl: HTMLInputElement,
        properties: string[],
        getType: (prop: string) => string,
        onSelect: (value: string) => void
    ) {
        super(app, inputEl);
        this.textInput = inputEl;
        this.properties = properties;
        this.getType = getType;
        this.onSelectCallback = onSelect;
    }

    getSuggestions(query: string): string[] {
        const lowerQuery = query.toLowerCase();
        return this.properties.filter(prop =>
            prop.toLowerCase().includes(lowerQuery)
        );
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.addClass("frontmatter-linter-property-suggestion");
        el.createSpan({ text: value, cls: "frontmatter-linter-property-name" });
        const propType = this.getType(value);
        el.createSpan({ text: propType, cls: "frontmatter-linter-property-type" });
    }

    selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
        this.textInput.value = value;
        this.textInput.dispatchEvent(new Event("input", { bubbles: true }));
        this.onSelectCallback(value);
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
