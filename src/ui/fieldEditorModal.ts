import { App, Modal, setIcon } from "obsidian";
import { FieldType, SchemaField, isPrimitiveType } from "../types";
import { getTypeDisplayName } from "../schema/extractor";
import { clearFieldConstraints } from "../utils/schema";

/**
 * Base class for modals that edit a list of schema fields with expandable constraint overlays.
 * Provides all shared field editing UI including:
 * - Field card rendering (name, type, required/warn, expand/delete)
 * - Constraint rendering (string, number, array)
 * - Expand/collapse state management
 * - Smart overlay positioning
 */
export abstract class FieldEditorModal extends Modal {
    protected fieldsContainer: HTMLElement | null = null;
    protected expandedFields: Set<number> = new Set();
    protected activeConstraintsSection: HTMLElement | null = null;
    protected scrollHandler: (() => void) | null = null;

    constructor(app: App) {
        super(app);
    }

    // ========== Abstract Methods ==========

    /** Get the fields array being edited */
    protected abstract getFields(): SchemaField[];

    /** Set the fields array (used for filtering empty fields on save) */
    protected abstract setFields(fields: SchemaField[]): void;

    /** Get available types for the type dropdown (primitives + custom types) */
    protected abstract getAvailableTypes(): string[];

    /** Called when a field is deleted */
    protected abstract onFieldDeleted(index: number): void;

    /** Called when a new field should be added */
    protected abstract onAddField(): void;

    // ========== Expand/Collapse Management ==========

    protected removeConstraintsSection(): void {
        if (this.activeConstraintsSection) {
            this.activeConstraintsSection.remove();
            this.activeConstraintsSection = null;
        }
    }

    protected closeAllExpanded(): void {
        this.removeConstraintsSection();
        for (const index of this.expandedFields) {
            const card = this.fieldsContainer?.children[index] as HTMLElement;
            if (card) {
                card.removeClass("expanded");
                const btn = card.querySelector(".frontmatter-linter-icon-btn:not(.frontmatter-linter-delete-btn)");
                if (btn) setIcon(btn as HTMLElement, "chevron-right");
            }
        }
        this.expandedFields.clear();
    }

    protected collapseField(index: number, card: HTMLElement, expandBtn: HTMLElement): void {
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

    protected expandField(
        index: number,
        card: HTMLElement,
        expandBtn: HTMLElement,
        showOverlayCallback: () => void
    ): void {
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
        showOverlayCallback();
    }

    // ========== Field Rendering ==========

    protected renderFields(emptyMessage: string = "No fields defined."): void {
        if (!this.fieldsContainer) return;

        this.removeConstraintsSection();
        this.expandedFields.clear();
        this.fieldsContainer.empty();

        const fields = this.getFields();
        if (fields.length === 0) {
            this.fieldsContainer.createEl("p", {
                text: emptyMessage,
                cls: "frontmatter-linter-no-fields",
            });
            return;
        }

        fields.forEach((field, index) => {
            this.renderFieldCard(this.fieldsContainer!, field, index);
        });
    }

    protected renderFieldCard(
        container: HTMLElement,
        field: SchemaField,
        index: number,
        onNameInputCreated?: (input: HTMLInputElement) => void
    ): HTMLElement {
        const card = container.createDiv({
            cls: "frontmatter-linter-field-card",
        });

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

        // Callback for property suggestions
        onNameInputCreated?.(nameInput);

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
            field.type = (e.target as HTMLSelectElement).value;
            clearFieldConstraints(field);
            this.removeConstraintsSection();
            this.expandedFields.delete(index);
            this.replaceFieldCard(card, field, index, onNameInputCreated);
        });

        // Required checkbox
        const requiredLabel = mainRow.createEl("label", {
            cls: "frontmatter-linter-required-label",
        });
        const requiredCheckbox = requiredLabel.createEl("input", {
            type: "checkbox",
        });
        requiredCheckbox.checked = field.required;
        requiredLabel.appendText(" Req");

        // Warn checkbox
        const warnLabel = mainRow.createEl("label", {
            cls: "frontmatter-linter-required-label",
            attr: { title: "Warn if missing (not an error)" },
        });
        const warnCheckbox = warnLabel.createEl("input", {
            type: "checkbox",
        });
        warnCheckbox.checked = field.warn || false;
        warnLabel.appendText(" Warn");

        // Unique checkbox
        const uniqueLabel = mainRow.createEl("label", {
            cls: "frontmatter-linter-required-label",
            attr: { title: "Value must be unique across all files in schema" },
        });
        const uniqueCheckbox = uniqueLabel.createEl("input", {
            type: "checkbox",
        });
        uniqueCheckbox.checked = field.unique || false;
        uniqueLabel.appendText(" Uniq");

        // Mutual exclusion handlers for required/warn
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
        uniqueCheckbox.addEventListener("change", (e) => {
            field.unique = (e.target as HTMLInputElement).checked;
        });

        // Expand button
        const hasConstraints = this.typeSupportsConstraints(field.type);
        const expandBtn = mainRow.createEl("button", {
            cls: "frontmatter-linter-icon-btn",
            attr: { title: hasConstraints ? "Configure constraints" : "No constraints for this type" },
        });
        setIcon(expandBtn, "chevron-right");

        if (hasConstraints) {
            expandBtn.addEventListener("click", () => {
                if (this.expandedFields.has(index)) {
                    this.collapseField(index, card, expandBtn);
                } else {
                    this.expandField(index, card, expandBtn, () => {
                        this.showConstraintsOverlay(card, field);
                    });
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
            this.onFieldDeleted(index);
            this.expandedFields.delete(index);
            this.renderFields();
        });

        return card;
    }

    protected replaceFieldCard(
        oldCard: HTMLElement,
        field: SchemaField,
        index: number,
        onNameInputCreated?: (input: HTMLInputElement) => void
    ): void {
        const temp = document.createElement("div");
        const newCard = this.renderFieldCard(temp, field, index, onNameInputCreated);
        oldCard.replaceWith(newCard);
    }

    protected typeSupportsConstraints(type: FieldType): boolean {
        return isPrimitiveType(type) && ["string", "number", "date", "array"].includes(type);
    }

    // ========== Constraints Overlay ==========

    protected showConstraintsOverlay(card: HTMLElement, field: SchemaField): void {
        const rect = card.getBoundingClientRect();

        const section = this.containerEl.createDiv({
            cls: "frontmatter-linter-constraints-section",
        });

        section.style.left = `${rect.left}px`;
        section.style.width = `${rect.width}px`;

        this.renderConstraints(section, field);
        this.activeConstraintsSection = section;

        // Position after render so we know the height, keep on screen
        requestAnimationFrame(() => {
            const sectionRect = section.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const spaceBelow = viewportHeight - rect.bottom - 8;
            const spaceAbove = rect.top - 8;

            if (sectionRect.height <= spaceBelow) {
                section.style.top = `${rect.bottom + 4}px`;
            } else if (sectionRect.height <= spaceAbove) {
                section.style.top = `${rect.top - sectionRect.height - 4}px`;
            } else {
                // Not enough space either way, position at bottom of viewport
                section.style.top = `${Math.max(8, viewportHeight - sectionRect.height - 8)}px`;
                section.style.maxHeight = `${viewportHeight - 16}px`;
                section.addClass("frontmatter-linter-constraints-overflow");
            }
        });
    }

    /** Override this to add content before type-specific constraints (e.g., conditions) */
    protected renderConstraints(container: HTMLElement, field: SchemaField): void {
        switch (field.type) {
            case "string":
                this.renderStringConstraints(container, field);
                break;
            case "number":
                this.renderNumberConstraints(container, field);
                break;
            case "date":
                this.renderDateConstraints(container, field);
                break;
            case "array":
                this.renderArrayConstraints(container, field);
                break;
        }
    }

    protected renderStringConstraints(container: HTMLElement, field: SchemaField): void {
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

    protected renderNumberConstraints(container: HTMLElement, field: SchemaField): void {
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

    protected renderDateConstraints(container: HTMLElement, field: SchemaField): void {
        if (!field.dateConstraints) {
            field.dateConstraints = {};
        }
        const constraints = field.dateConstraints;

        container.createEl("div", {
            text: "Date constraints",
            cls: "frontmatter-linter-constraints-title",
        });

        const grid = container.createDiv({
            cls: "frontmatter-linter-constraints-grid",
        });

        // Min date
        const minRow = grid.createDiv({ cls: "frontmatter-linter-constraint-row" });
        minRow.createEl("label", { text: "Min date:" });
        const minInput = minRow.createEl("input", { type: "date" });
        minInput.value = constraints.min || "";
        minInput.addEventListener("input", (e) => {
            const val = (e.target as HTMLInputElement).value;
            constraints.min = val || undefined;
        });

        // Max date
        const maxRow = grid.createDiv({ cls: "frontmatter-linter-constraint-row" });
        maxRow.createEl("label", { text: "Max date:" });
        const maxInput = maxRow.createEl("input", { type: "date" });
        maxInput.value = constraints.max || "";
        maxInput.addEventListener("input", (e) => {
            const val = (e.target as HTMLInputElement).value;
            constraints.max = val || undefined;
        });
    }

    protected renderArrayConstraints(container: HTMLElement, field: SchemaField): void {
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

    // ========== Cleanup ==========

    protected setupScrollHandler(): void {
        this.scrollHandler = () => {
            if (this.activeConstraintsSection && this.expandedFields.size > 0) {
                this.closeAllExpanded();
            }
        };
        this.containerEl.addEventListener("scroll", this.scrollHandler, true);
    }

    protected cleanupScrollHandler(): void {
        if (this.scrollHandler) {
            this.containerEl.removeEventListener("scroll", this.scrollHandler, true);
        }
        this.removeConstraintsSection();
    }
}
