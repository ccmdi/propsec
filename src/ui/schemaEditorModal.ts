import { App, Modal, Notice, setIcon, Setting, TFile, TFolder, AbstractInputSuggest } from "obsidian";
import {
    SchemaField,
    SchemaMapping,
    CustomType,
    PropertyCondition,
} from "../types";
import { extractSchemaFromTemplate, getAllFieldTypes } from "../schema/extractor";
import { getOperatorDisplayName, getOperatorsForPropertyType, PROPERTY_OPERATORS, PropertyOperator } from "../operators";
import { validateQuery } from "../query/matcher";
import { FieldEditorModal } from "./fieldEditorModal";

export interface SchemaEditorResult {
    saved: boolean;
    mapping: SchemaMapping;
}

/**
 * Modal for editing a schema mapping
 */
export class SchemaEditorModal extends FieldEditorModal {
    private mapping: SchemaMapping;
    private onSave: (mapping: SchemaMapping) => void;
    private templatesFolder: string;
    private customTypes: CustomType[];
    private enablePropertySuggestions: boolean;

    constructor(
        app: App,
        mapping: SchemaMapping,
        templatesFolder: string,
        customTypes: CustomType[],
        onSave: (mapping: SchemaMapping) => void,
        enablePropertySuggestions: boolean = true
    ) {
        super(app);
        this.mapping = JSON.parse(JSON.stringify(mapping)) as unknown as SchemaMapping;
        this.templatesFolder = templatesFolder;
        this.customTypes = customTypes;
        this.onSave = onSave;
        this.enablePropertySuggestions = enablePropertySuggestions;
    }

    // ========== Abstract Method Implementations ==========

    protected getFields(): SchemaField[] {
        return this.mapping.fields;
    }

    protected setFields(fields: SchemaField[]): void {
        this.mapping.fields = fields;
    }

    protected getAvailableTypes(): string[] {
        const primitives = getAllFieldTypes();
        const customTypeNames = this.customTypes.map(t => t.name);
        return [...primitives, ...customTypeNames];
    }

    protected onFieldDeleted(index: number): void {
        this.mapping.fields.splice(index, 1);
    }

    protected onAddField(): void {
        this.mapping.fields.push({
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

    protected override hasExpandableContent(): boolean {
        return true;
    }

    protected override renderConstraints(container: HTMLElement, field: SchemaField): void {
        // Add condition section before type-specific constraints
        this.renderConditionSection(container, field);
        // Then render type-specific constraints from base class
        super.renderConstraints(container, field);
    }

    // ========== Modal Lifecycle ==========

    onOpen(): void {
        const { contentEl } = this;

        contentEl.addClass("propsec-schema-editor");

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

        // Query field with validation
        const querySetting = new Setting(contentEl)
            .setName("Query")
            .setDesc("Match files by folder or tag. Examples: folder, folder/*, #tag, folder/* or #tag");

        const queryErrorEl = contentEl.createDiv({ cls: "propsec-query-error" });

        querySetting.addText((text) =>
            text
                .setPlaceholder("e.g., Folder/* or #tag")
                .setValue(this.mapping.query || "")
                .onChange((value) => {
                    this.mapping.query = value;
                    // Validate and show/hide error
                    if (value.trim()) {
                        const result = validateQuery(value);
                        if (!result.valid) {
                            queryErrorEl.setText(result.error || "Invalid query");
                            queryErrorEl.removeClass("propsec-hidden");
                            text.inputEl.addClass("propsec-input-error");
                        } else {
                            queryErrorEl.addClass("propsec-hidden");
                            text.inputEl.removeClass("propsec-input-error");
                        }
                    } else {
                        queryErrorEl.addClass("propsec-hidden");
                        text.inputEl.removeClass("propsec-input-error");
                    }
                })
        );

        // Property Filter section
        this.renderPropertyFilterSection(contentEl);

        // Separator
        contentEl.createEl("hr");

        // Fields section header
        const fieldsHeader = contentEl.createDiv({
            cls: "propsec-fields-header",
        });
        fieldsHeader.createEl("h3", { text: "Fields" });

        // Fields container
        this.fieldsContainer = contentEl.createDiv({
            cls: "propsec-fields-container",
        });

        this.doRenderFields();

        // Add field button and import button
        const buttonsRow = contentEl.createDiv({
            cls: "propsec-buttons-row",
        });

        const addFieldBtn = buttonsRow.createEl("button", { text: "Add field" });
        addFieldBtn.addEventListener("click", () => this.onAddField());

        const importBtn = buttonsRow.createEl("button", {
            text: "Import from template...",
        });
        importBtn.addEventListener("click", () => this.showTemplateSelector());

        // Separator
        contentEl.createEl("hr");

        // Save/Cancel buttons
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
            this.mapping.fields = this.mapping.fields.filter(
                (f) => f.name.trim() !== ""
            );
            this.onSave(this.mapping);
            this.close();
        });
    }

    onClose(): void {
        this.removeConstraintsSection();
        const { contentEl } = this;
        contentEl.empty();
    }

    // ========== Field Conditions (Schema-specific) ==========

    private renderConditionSection(container: HTMLElement, field: SchemaField): void {
        const section = container.createDiv({ cls: "propsec-condition-section" });
        this.renderConditionSectionContent(section, field);
    }

    private renderConditionSectionContent(section: HTMLElement, field: SchemaField): void {
        section.empty();

        const header = section.createDiv({ cls: "propsec-condition-header" });
        header.createEl("span", { text: "Conditions", cls: "propsec-constraints-title" });

        const addBtn = header.createEl("button", {
            cls: "propsec-add-condition-btn",
            attr: { title: "Add condition" }
        });
        setIcon(addBtn, "plus");
        addBtn.addEventListener("click", () => {
            if (!field.conditions) field.conditions = [];
            field.conditions.push({ field: "", operator: "equals", value: "" });
            this.renderConditionSectionContent(section, field);
        });

        if (field.conditions && field.conditions.length > 0) {
            const desc = section.createDiv({ cls: "propsec-condition-desc" });
            desc.appendText("Only validate when ");
            const logicSelect = desc.createEl("select", { cls: "propsec-condition-logic" });
            logicSelect.createEl("option", { value: "and", text: "all" });
            logicSelect.createEl("option", { value: "or", text: "any" });
            logicSelect.value = field.conditionLogic || "and";
            logicSelect.addEventListener("change", () => {
                field.conditionLogic = logicSelect.value as "and" | "or";
            });
            desc.appendText(" conditions match:");

            const list = section.createDiv({ cls: "propsec-conditions-list" });
            for (let i = 0; i < field.conditions.length; i++) {
                this.renderFieldConditionRow(list, field, i, section);
            }
        }
    }

    private renderFieldConditionRow(container: HTMLElement, field: SchemaField, index: number, section: HTMLElement): void {
        const condition = field.conditions![index];
        const row = container.createDiv({ cls: "propsec-field-condition-row" });

        // Field input
        const fieldInput = row.createEl("input", {
            type: "text",
            placeholder: "field",
            cls: "propsec-condition-field",
        });
        fieldInput.value = condition.field;

        if (this.enablePropertySuggestions) {
            this.attachPropertySuggest(fieldInput);
        }

        fieldInput.addEventListener("input", (e) => {
            condition.field = (e.target as HTMLInputElement).value;
        });

        // Operator select
        const operatorSelect = row.createEl("select", { cls: "propsec-condition-operator" });
        for (const op of PROPERTY_OPERATORS) {
            const option = operatorSelect.createEl("option", { value: op, text: getOperatorDisplayName(op) });
            if (op === condition.operator) option.selected = true;
        }

        // Value input
        const valueInput = row.createEl("input", {
            type: "text",
            placeholder: "value",
            cls: "propsec-condition-value",
        });
        valueInput.value = condition.value;
        valueInput.addEventListener("input", (e) => {
            condition.value = (e.target as HTMLInputElement).value;
        });

        const isExistenceOp = (op: string) => op === "exists" || op === "not_exists";
        valueInput.toggleClass("propsec-hidden", isExistenceOp(condition.operator));

        operatorSelect.addEventListener("change", (e) => {
            condition.operator = (e.target as HTMLSelectElement).value as PropertyOperator;
            valueInput.toggleClass("propsec-hidden", isExistenceOp(condition.operator));
        });

        // Delete button
        const deleteBtn = row.createEl("button", {
            cls: "propsec-condition-delete",
            attr: { title: "Remove condition" }
        });
        setIcon(deleteBtn, "x");
        deleteBtn.addEventListener("click", () => {
            field.conditions!.splice(index, 1);
            if (field.conditions!.length === 0) delete field.conditions;
            this.renderConditionSectionContent(section, field);
        });
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
                const existingNames = new Set(this.mapping.fields.map((f) => f.name));
                for (const newField of fields) {
                    if (!existingNames.has(newField.name)) {
                        this.mapping.fields.push(newField);
                    }
                }
                this.mapping.sourceTemplatePath = file.path;
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

    // ========== Property Filter Section ==========

    private renderPropertyFilterSection(container: HTMLElement): void {
        if (!this.mapping.propertyFilter) {
            this.mapping.propertyFilter = {};
        }
        const filter = this.mapping.propertyFilter;

        const section = container.createDiv({
            cls: "propsec-filter-section",
        });

        const header = section.createDiv({
            cls: "propsec-filter-header",
        });
        header.createEl("span", { text: "Filter (optional)" });
        const toggleIcon = header.createEl("span", { cls: "propsec-filter-toggle" });
        setIcon(toggleIcon, "chevron-right");

        const content = section.createDiv({
            cls: "propsec-filter-content propsec-hidden",
        });

        const hasFilters = filter.fileNamePattern ||
            filter.modifiedAfter || filter.modifiedBefore ||
            filter.createdAfter || filter.createdBefore ||
            filter.hasProperty || filter.notHasProperty ||
            (filter.conditions && filter.conditions.length > 0);

        if (hasFilters) {
            content.removeClass("propsec-hidden");
            setIcon(toggleIcon, "chevron-down");
        }

        header.addEventListener("click", () => {
            const isHidden = content.hasClass("propsec-hidden");
            content.toggleClass("propsec-hidden", !isHidden);
            setIcon(toggleIcon, isHidden ? "chevron-down" : "chevron-right");
        });

        const grid = content.createDiv({ cls: "propsec-filter-grid" });

        // File name pattern (regex)
        const fileNameRow = grid.createDiv({ cls: "propsec-filter-row" });
        fileNameRow.createEl("label", { text: "File name matches:" });
        const fileNameInput = fileNameRow.createEl("input", { type: "text", placeholder: "e.g., ^Project-.+" });
        fileNameInput.value = filter.fileNamePattern || "";
        fileNameInput.addEventListener("input", (e) => {
            filter.fileNamePattern = (e.target as HTMLInputElement).value || undefined;
        });

        // Date filters
        this.createDateFilterRow(grid, "Modified after:", filter.modifiedAfter, (v) => filter.modifiedAfter = v);
        this.createDateFilterRow(grid, "Modified before:", filter.modifiedBefore, (v) => filter.modifiedBefore = v);
        this.createDateFilterRow(grid, "Created after:", filter.createdAfter, (v) => filter.createdAfter = v);
        this.createDateFilterRow(grid, "Created before:", filter.createdBefore, (v) => filter.createdBefore = v);

        // Has property
        const hasPropRow = grid.createDiv({ cls: "propsec-filter-row" });
        hasPropRow.createEl("label", { text: "Has property:" });
        const hasPropInput = hasPropRow.createEl("input", { type: "text", placeholder: "e.g., status" });
        hasPropInput.value = filter.hasProperty || "";
        hasPropInput.addEventListener("input", (e) => {
            filter.hasProperty = (e.target as HTMLInputElement).value || undefined;
        });
        this.attachPropertySuggest(hasPropInput);

        // Missing property
        const notHasPropRow = grid.createDiv({ cls: "propsec-filter-row" });
        notHasPropRow.createEl("label", { text: "Missing property:" });
        const notHasPropInput = notHasPropRow.createEl("input", { type: "text", placeholder: "e.g., draft" });
        notHasPropInput.value = filter.notHasProperty || "";
        notHasPropInput.addEventListener("input", (e) => {
            filter.notHasProperty = (e.target as HTMLInputElement).value || undefined;
        });
        this.attachPropertySuggest(notHasPropInput);

        // Property conditions
        const conditionsSection = content.createDiv({ cls: "propsec-conditions-section" });
        const conditionsHeader = conditionsSection.createDiv({ cls: "propsec-conditions-header" });
        conditionsHeader.createEl("span", { text: "Property conditions" });
        const addConditionBtn = conditionsHeader.createEl("button", { cls: "propsec-add-condition-btn" });
        setIcon(addConditionBtn, "plus");

        const conditionsList = conditionsSection.createDiv({ cls: "propsec-conditions-list" });

        if (!filter.conditions) {
            filter.conditions = [];
        }

        const renderConditions = () => {
            conditionsList.empty();
            for (let i = 0; i < filter.conditions!.length; i++) {
                this.renderPropertyConditionRow(conditionsList, filter.conditions!, i, renderConditions);
            }
        };

        addConditionBtn.addEventListener("click", () => {
            filter.conditions!.push({ property: "", operator: "equals", value: "" });
            renderConditions();
        });

        renderConditions();
    }

    private createDateFilterRow(
        grid: HTMLElement,
        label: string,
        value: string | undefined,
        onChange: (value: string | undefined) => void
    ): void {
        const row = grid.createDiv({ cls: "propsec-filter-row" });
        row.createEl("label", { text: label });
        const input = row.createEl("input", { type: "date" });
        input.value = value || "";
        input.addEventListener("change", (e) => {
            onChange((e.target as HTMLInputElement).value || undefined);
        });
    }

    private renderPropertyConditionRow(
        container: HTMLElement,
        conditions: PropertyCondition[],
        index: number,
        onUpdate: () => void
    ): void {
        const condition = conditions[index];
        const row = container.createDiv({ cls: "propsec-condition-row" });

        // Property input
        const propInput = row.createEl("input", {
            type: "text",
            placeholder: "property",
            cls: "propsec-condition-property",
        });
        propInput.value = condition.property;

        // Operator select
        const operatorSelect = row.createEl("select", { cls: "propsec-condition-operator" });

        const updateOperators = () => {
            const propertyType = this.getPropertyType(condition.property);
            const operators = getOperatorsForPropertyType(propertyType);

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

            if (!operators.includes(condition.operator)) {
                condition.operator = operators[0];
                operatorSelect.value = operators[0];
            }
        };

        updateOperators();

        // Property suggest
        const knownProperties = Object.keys(this.app.metadataTypeManager.properties);
        new PropertySuggest(
            this.app,
            propInput,
            knownProperties,
            (prop) => this.getPropertyType(prop),
            () => updateOperators(),
            (prop) => this.getPropertyDisplayName(prop)
        );

        propInput.addEventListener("input", (e) => {
            condition.property = (e.target as HTMLInputElement).value;
            updateOperators();
        });

        // Value input
        const valueInput = row.createEl("input", {
            type: "text",
            placeholder: "value",
            cls: "propsec-condition-value",
        });
        valueInput.value = condition.value;
        valueInput.addEventListener("input", (e) => {
            condition.value = (e.target as HTMLInputElement).value;
        });

        const isExistenceOp = (op: string) => op === "exists" || op === "not_exists";
        valueInput.toggleClass("propsec-hidden", isExistenceOp(condition.operator));

        operatorSelect.addEventListener("change", (e) => {
            condition.operator = (e.target as HTMLSelectElement).value as PropertyOperator;
            valueInput.toggleClass("propsec-hidden", isExistenceOp(condition.operator));
        });

        // Delete button
        const deleteBtn = row.createEl("button", { cls: "propsec-condition-delete" });
        setIcon(deleteBtn, "x");
        deleteBtn.addEventListener("click", () => {
            conditions.splice(index, 1);
            onUpdate();
        });
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

        const list = contentEl.createEl("div", {
            cls: "propsec-template-list",
        });

        for (const file of this.files) {
            const item = list.createEl("div", {
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
