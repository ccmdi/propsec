import { App, Modal, setIcon, Setting } from "obsidian";
import {
    FieldType,
    SchemaField,
    CustomType,
    isPrimitiveType,
} from "../types";
import { getAllFieldTypes, getTypeDisplayName } from "../schema/extractor";

/**
 * Modal for editing a custom type definition
 */
export class CustomTypeEditorModal extends Modal {
    private customType: CustomType;
    private existingTypes: CustomType[];
    private onSave: (customType: CustomType) => void;
    private fieldsContainer: HTMLElement | null = null;
    private expandedFields: Set<number> = new Set();
    private activeConstraintsSection: HTMLElement | null = null;
    private scrollHandler: (() => void) | null = null;
    private isNew: boolean;

    constructor(
        app: App,
        customType: CustomType | null,
        existingTypes: CustomType[],
        onSave: (customType: CustomType) => void
    ) {
        super(app);
        this.isNew = customType === null;

        // Deep copy or create new
        if (customType) {
            this.customType = JSON.parse(JSON.stringify(customType));
        } else {
            this.customType = {
                id: this.generateId(),
                name: "",
                fields: [],
            };
        }

        this.existingTypes = existingTypes;
        this.onSave = onSave;
    }

    private generateId(): string {
        return `ct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    onOpen(): void {
        const { contentEl } = this;

        contentEl.addClass("frontmatter-linter-schema-editor");

        // Header
        contentEl.createEl("h2", {
            text: this.isNew ? "New Custom Type" : `Edit Custom Type: ${this.customType.name}`
        });

        // Name field
        new Setting(contentEl)
            .setName("Type Name")
            .setDesc("A unique name for this custom type (e.g., 'exercise', 'person')")
            .addText((text) =>
                text
                    .setPlaceholder("e.g., exercise")
                    .setValue(this.customType.name)
                    .onChange((value) => {
                        this.customType.name = value.trim();
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

        // Close constraints overlay on scroll anywhere in modal
        this.scrollHandler = () => {
            if (this.activeConstraintsSection && this.expandedFields.size > 0) {
                this.closeAllExpanded();
            }
        };
        this.containerEl.addEventListener("scroll", this.scrollHandler, true);

        this.renderFields();

        // Add field button
        const buttonsRow = contentEl.createDiv({
            cls: "frontmatter-linter-buttons-row",
        });

        const addFieldBtn = buttonsRow.createEl("button", { text: "+ Add Field" });
        addFieldBtn.addEventListener("click", () => {
            this.customType.fields.push({
                name: "",
                type: "string",
                required: true,
            });
            this.renderFields();
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
            // Validate
            if (!this.customType.name.trim()) {
                alert("Please enter a type name");
                return;
            }

            // Check for duplicate names (excluding self if editing)
            const duplicate = this.existingTypes.find(
                (t) => t.id !== this.customType.id && t.name === this.customType.name
            );
            if (duplicate) {
                alert(`A custom type named "${this.customType.name}" already exists`);
                return;
            }

            // Check for name collision with primitive types
            if (isPrimitiveType(this.customType.name)) {
                alert(`"${this.customType.name}" is a built-in type name. Please choose a different name.`);
                return;
            }

            // Filter out fields with empty names
            this.customType.fields = this.customType.fields.filter(
                (f) => f.name.trim() !== ""
            );

            // Check for circular references
            if (this.hasCircularReference()) {
                alert("Circular reference detected: A custom type cannot reference itself directly or indirectly.");
                return;
            }

            this.onSave(this.customType);
            this.close();
        });
    }

    private hasCircularReference(): boolean {
        // Check if any field in this type references itself or creates a cycle
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const detectCycle = (typeName: string): boolean => {
            visited.add(typeName);
            recursionStack.add(typeName);

            const type = typeName === this.customType.name
                ? this.customType
                : this.existingTypes.find(t => t.name === typeName);

            if (type) {
                for (const field of type.fields) {
                    // Check direct field type
                    if (!isPrimitiveType(field.type)) {
                        if (recursionStack.has(field.type)) {
                            return true; // Cycle detected
                        }
                        if (!visited.has(field.type) && detectCycle(field.type)) {
                            return true;
                        }
                    }

                    // Check array element type
                    if (field.arrayElementType && !isPrimitiveType(field.arrayElementType)) {
                        if (recursionStack.has(field.arrayElementType)) {
                            return true;
                        }
                        if (!visited.has(field.arrayElementType) && detectCycle(field.arrayElementType)) {
                            return true;
                        }
                    }
                }
            }

            recursionStack.delete(typeName);
            return false;
        };

        return detectCycle(this.customType.name);
    }

    private renderFields(): void {
        if (!this.fieldsContainer) return;

        // Remove any existing constraints overlay
        this.removeConstraintsSection();
        this.expandedFields.clear();

        this.fieldsContainer.empty();

        if (this.customType.fields.length === 0) {
            this.fieldsContainer.createEl("p", {
                text: "No fields defined. Add fields to define the structure of this custom type.",
                cls: "frontmatter-linter-no-fields",
            });
            return;
        }

        this.customType.fields.forEach((field, index) => {
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
        this.removeConstraintsSection();
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

    private getAvailableTypes(): string[] {
        // Get all primitive types
        const primitives = getAllFieldTypes();

        // Get other custom types (excluding the one being edited to prevent self-reference)
        const otherCustomTypes = this.existingTypes
            .filter(t => t.id !== this.customType.id)
            .map(t => t.name);

        return [...primitives, ...otherCustomTypes];
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

        // Type select
        const typeSelect = mainRow.createEl("select", {
            cls: "frontmatter-linter-field-type",
        });

        const availableTypes = this.getAvailableTypes();
        for (const type of availableTypes) {
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
            //TODO: ugly, just set one constraint and delete it maybe?
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

        // Warn checkbox with label
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

        // Allow empty checkbox
        const allowEmptyLabel = mainRow.createEl("label", {
            cls: "frontmatter-linter-required-label",
            attr: { title: "Allow null/empty values" },
        });
        const allowEmptyCheckbox = allowEmptyLabel.createEl("input", {
            type: "checkbox",
        });
        allowEmptyCheckbox.checked = field.allowEmpty || false;
        allowEmptyCheckbox.addEventListener("change", (e) => {
            field.allowEmpty = (e.target as HTMLInputElement).checked;
        });
        allowEmptyLabel.appendText(" Null");

        // Expand button
        const hasConstraints = this.typeSupportsConstraints(field.type);
        const expandBtn = mainRow.createEl("button", {
            cls: "frontmatter-linter-icon-btn",
            attr: { title: hasConstraints ? "Toggle constraints" : "No constraints for this type" },
        });
        setIcon(expandBtn, "chevron-right");

        if (hasConstraints) {
            expandBtn.addEventListener("click", () => {
                if (this.expandedFields.has(index)) {
                    this.collapseField(index, card, expandBtn);
                } else {
                    // Close any other expanded field first
                    if (this.expandedFields.size > 0) {
                        this.removeConstraintsSection();
                        const prevIndex = Array.from(this.expandedFields)[0];
                        const prevCard = this.fieldsContainer?.children[prevIndex] as HTMLElement;
                        if (prevCard) {
                            prevCard.removeClass("expanded");
                            const prevBtn = prevCard.querySelector(".frontmatter-linter-icon-btn:not(.frontmatter-linter-delete-btn)");
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
        } else {
            expandBtn.addClass("frontmatter-linter-icon-btn-disabled");
            expandBtn.disabled = true;
        }

        // Delete button
        const deleteBtn = mainRow.createEl("button", {
            cls: "frontmatter-linter-icon-btn frontmatter-linter-delete-btn",
            attr: { title: "Remove field" },
        });
        setIcon(deleteBtn, "x");
        deleteBtn.addEventListener("click", () => {
            this.customType.fields.splice(index, 1);
            this.expandedFields.delete(index);
            this.renderFields();
        });

        return card;
    }

    private typeSupportsConstraints(type: FieldType): boolean {
        // Only primitive types support constraints
        // Custom types have their own internal constraints
        // Object type uses custom types for structure, not constraints
        return isPrimitiveType(type) && ["string", "number", "array"].includes(type);
    }

    private replaceFieldCard(oldCard: HTMLElement, field: SchemaField, index: number): void {
        const temp = document.createElement("div");
        const newCard = this.renderFieldCard(temp, field, index);
        oldCard.replaceWith(newCard);
    }

    private showConstraintsOverlay(card: HTMLElement, field: SchemaField): void {
        const rect = card.getBoundingClientRect();

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
                this.renderArrayTypeConstraints(container, field);
                break;
        }
    }

    private renderArrayTypeConstraints(container: HTMLElement, field: SchemaField): void {
        if (!field.arrayConstraints) {
            field.arrayConstraints = {};
        }

        container.createEl("div", {
            text: "Array Configuration",
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

        // Standard array constraints
        const constraints = field.arrayConstraints;

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

        // Contains
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

        // Pattern
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
