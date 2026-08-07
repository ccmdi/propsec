import { App, Modal, setIcon } from "obsidian";
import { SchemaField, clearFieldConstraints, ComparisonOperator, getComparisonOperatorOptions, CONSTRAINT_GROUPS, ConstraintFieldMeta } from "@propsec/core";
import { getTypeDisplayName } from "../schema/extractor";

/**
 * Base class for modals that edit a list of schema fields with inline expandable constraints.
 */
export abstract class FieldEditorModal extends Modal {
    protected fieldsContainer: HTMLElement | null = null;
    protected expandedFields: Set<number> = new Set();
    protected activeConstraintsSection: HTMLElement | null = null;
    protected fieldCardMap: Map<number, HTMLElement> = new Map();

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
            const card = this.fieldCardMap.get(index);
            if (card) {
                card.removeClass("expanded");
                const btn = card.querySelector(".propsec-icon-btn:not(.propsec-delete-btn)");
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
    ): void {
        // Close any other expanded field first
        if (this.expandedFields.size > 0) {
            this.removeConstraintsSection();
            const prevIndex = Array.from(this.expandedFields)[0];
            const prevCard = this.fieldCardMap.get(prevIndex);
            if (prevCard) {
                prevCard.removeClass("expanded");
                const prevBtn = prevCard.querySelector(".propsec-icon-btn:not(.propsec-delete-btn)");
                if (prevBtn) setIcon(prevBtn as HTMLElement, "chevron-right");
            }
            this.expandedFields.clear();
        }
        // Expand this field
        this.expandedFields.add(index);
        card.addClass("expanded");
        setIcon(expandBtn, "chevron-down");

        const section = card.createDiv({ cls: "propsec-constraints-section" });
        this.renderConstraints(section, this.getFields()[index]);
        this.activeConstraintsSection = section;
    }

    // ========== Field Rendering ==========

    protected renderFields(
        emptyMessage: string = "No fields defined.",
        onNameInputCreated?: (input: HTMLInputElement) => void
    ): void {
        if (!this.fieldsContainer) return;

        this.removeConstraintsSection();
        this.expandedFields.clear();
        this.fieldCardMap.clear();
        this.fieldsContainer.empty();

        const fields = this.getFields();
        if (fields.length === 0) {
            this.fieldsContainer.createEl("p", {
                text: emptyMessage,
                cls: "propsec-no-fields",
            });
            return;
        }

        const groups = this.buildOrderedFieldGroups(fields);

        for (const group of groups) {
            if (group.indices.length === 1) {
                const idx = group.indices[0];
                this.renderFieldCard(this.fieldsContainer, fields[idx], idx, onNameInputCreated);
            } else {
                const wrapper = this.fieldsContainer.createDiv({ cls: "propsec-union-group" });
                wrapper.createDiv({
                    cls: "propsec-union-label",
                    text: group.name,
                });
                for (const idx of group.indices) {
                    this.renderFieldCard(wrapper, fields[idx], idx, onNameInputCreated);
                }
            }
        }
    }

    private buildOrderedFieldGroups(fields: SchemaField[]): { name: string; indices: number[] }[] {
        const groups: { name: string; indices: number[] }[] = [];
        const nameToGroup = new Map<string, { name: string; indices: number[] }>();

        for (let i = 0; i < fields.length; i++) {
            const name = fields[i].name;
            if (name && nameToGroup.has(name)) {
                nameToGroup.get(name)!.indices.push(i);
            } else {
                const group = { name, indices: [i] };
                groups.push(group);
                if (name) nameToGroup.set(name, group);
            }
        }

        return groups;
    }

    protected renderFieldCard(
        container: HTMLElement,
        field: SchemaField,
        index: number,
        onNameInputCreated?: (input: HTMLInputElement) => void
    ): HTMLElement {
        const card = container.createDiv({
            cls: "propsec-field-card",
        });
        this.fieldCardMap.set(index, card);

        const mainRow = card.createDiv({
            cls: "propsec-field-main-row",
        });

        // Name input
        const nameInput = mainRow.createEl("input", {
            type: "text",
            cls: "propsec-field-name",
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
            cls: "propsec-field-type",
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
            cls: "propsec-required-label",
        });
        const requiredCheckbox = requiredLabel.createEl("input", {
            type: "checkbox",
        });
        requiredCheckbox.checked = field.required;
        requiredLabel.appendText(" Req");

        // Warn checkbox
        const warnLabel = mainRow.createEl("label", {
            cls: "propsec-required-label",
            attr: { title: "Warn if missing (not an error)" },
        });
        const warnCheckbox = warnLabel.createEl("input", {
            type: "checkbox",
        });
        warnCheckbox.checked = field.warn || false;
        warnLabel.appendText(" Warn");

        // Unique checkbox
        const uniqueLabel = mainRow.createEl("label", {
            cls: "propsec-required-label",
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

        // Condition badge
        if (field.conditions && field.conditions.length > 0) {
            const badge = mainRow.createSpan({
                cls: "propsec-condition-badge",
                attr: { title: `${field.conditions.length} condition(s)` },
            });
            setIcon(badge, "filter");
        }

        // Expand button
        const expandBtn = mainRow.createEl("button", {
            cls: `propsec-icon-btn${this.hasExpandableContent(field) ? "" : " propsec-icon-btn-disabled"}`,
            attr: { title: "Configure constraints" },
        });
        setIcon(expandBtn, "chevron-right");

        if (this.hasExpandableContent(field)) {
            expandBtn.addEventListener("click", () => {
                if (this.expandedFields.has(index)) {
                    this.collapseField(index, card, expandBtn);
                } else {
                    this.expandField(index, card, expandBtn);
                }
            });
        }

        // Delete button
        const deleteBtn = mainRow.createEl("button", {
            cls: "propsec-icon-btn propsec-delete-btn",
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
        const temp = activeDocument.createElement("div");
        const newCard = this.renderFieldCard(temp, field, index, onNameInputCreated);
        oldCard.replaceWith(newCard);
    }

    // ========== Constraints Rendering ==========

    protected hasExpandableContent(field: SchemaField): boolean {
        return CONSTRAINT_GROUPS.some((g) => g.appliesTo === field.type);
    }


    protected renderConstraints(container: HTMLElement, field: SchemaField): void {
        const group = CONSTRAINT_GROUPS.find((g) => g.appliesTo === field.type);
        if (!group) return;

        const record = field as unknown as Record<string, Record<string, unknown>>;
        if (!record[group.key]) {
            record[group.key] = {};
        }
        const constraints = record[group.key];

        container.createDiv({
            text: group.title,
            cls: "propsec-constraints-title",
        });

        const grid = container.createDiv({
            cls: "propsec-constraints-grid",
        });

        if (field.type === "array") {
            this.renderElementTypeRow(grid, field);
        }

        for (const meta of group.fields) {
            this.renderConstraintRow(grid, constraints, meta);
        }

        if (field.type !== "array") {
            this.renderCrossFieldConstraint(container, field);
        }
    }

    private renderConstraintRow(grid: HTMLElement, constraints: Record<string, unknown>, meta: ConstraintFieldMeta): void {
        const row = grid.createDiv({ cls: "propsec-constraint-row" });
        row.createEl("label", { text: meta.label });

        if (meta.input === "boolean") {
            const input = row.createEl("input", { type: "checkbox" });
            input.checked = (constraints[meta.key] as boolean | undefined) ?? false;
            input.addEventListener("change", () => {
                constraints[meta.key] = input.checked || undefined;
            });
            return;
        }

        const inputType = meta.input === "integer" || meta.input === "number" ? "number"
            : meta.input === "date" ? "date"
            : "text";
        const input = row.createEl("input", {
            type: inputType,
            ...(meta.placeholder ? { placeholder: meta.placeholder } : {}),
            ...(meta.input === "integer" ? { attr: { min: "0" } } : {}),
        });
        input.value = this.formatConstraintValue(constraints[meta.key], meta);
        input.addEventListener("input", () => {
            constraints[meta.key] = this.parseConstraintValue(input.value, meta);
        });
    }

    private formatConstraintValue(value: unknown, meta: ConstraintFieldMeta): string {
        if (value === undefined || value === null) return "";
        if (meta.input === "string-list") return (value as string[]).join(", ");
        return String(value);
    }

    private parseConstraintValue(raw: string, meta: ConstraintFieldMeta): unknown {
        switch (meta.input) {
            case "integer":
                return raw ? parseInt(raw, 10) : undefined;
            case "number":
                return raw ? parseFloat(raw) : undefined;
            case "string-list": {
                const items = raw.split(",").map((v) => v.trim()).filter((v) => v !== "");
                return items.length > 0 ? items : undefined;
            }
            default:
                return raw || undefined;
        }
    }

    private renderElementTypeRow(grid: HTMLElement, field: SchemaField): void {
        const elementTypeRow = grid.createDiv({ cls: "propsec-constraint-row" });
        elementTypeRow.createEl("label", { text: "Element type:" });
        const elementTypeSelect = elementTypeRow.createEl("select");

        const anyOption = elementTypeSelect.createEl("option", {
            value: "",
            text: "(any type)",
        });
        if (!field.arrayElementType) {
            anyOption.selected = true;
        }

        for (const type of this.getAvailableTypes()) {
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
    }

    protected renderCrossFieldConstraint(container: HTMLElement, field: SchemaField): void {
        container.createDiv({
            text: "Compare to another field",
            cls: "propsec-constraints-title",
        });

        const grid = container.createDiv({
            cls: "propsec-constraints-grid",
        });

        // Operator select
        const operatorRow = grid.createDiv({ cls: "propsec-constraint-row" });
        operatorRow.createEl("label", { text: "Must be:" });
        const operatorSelect = operatorRow.createEl("select");

        // Add empty option
        const emptyOption = operatorSelect.createEl("option", {
            value: "",
            text: "(none)",
        });
        if (!field.crossFieldConstraint) {
            emptyOption.selected = true;
        }

        for (const op of getComparisonOperatorOptions()) {
            const option = operatorSelect.createEl("option", {
                value: op.value,
                text: op.label,
            });
            if (field.crossFieldConstraint?.operator === op.value) {
                option.selected = true;
            }
        }

        // Field name input
        const fieldRow = grid.createDiv({ cls: "propsec-constraint-row" });
        fieldRow.createEl("label", { text: "Field:" });
        const fieldInput = fieldRow.createEl("input", {
            type: "text",
            placeholder: "other field name",
        });
        fieldInput.value = field.crossFieldConstraint?.field || "";

        // Update handlers
        const updateConstraint = () => {
            const operator = operatorSelect.value as ComparisonOperator | "";
            const fieldName = fieldInput.value.trim();

            if (operator && fieldName) {
                field.crossFieldConstraint = {
                    operator: operator,
                    field: fieldName,
                };
            } else {
                delete field.crossFieldConstraint;
            }
        };

        operatorSelect.addEventListener("change", updateConstraint);
        fieldInput.addEventListener("input", updateConstraint);
    }

}
