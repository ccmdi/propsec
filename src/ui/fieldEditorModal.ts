import { App, Menu, Modal, setIcon } from "obsidian";
import { Field, groupFieldsByName } from "@propsec/core";
import { getTypeDisplayName } from "../schema/extractor";
import { ruleInput } from "./ruleInput";

/** A field name and every flat-array entry (variant) declared under it. */
interface FieldGroup {
    name: string;
    variants: Field[];
}

/**
 * Base class for modals that edit a list of schema fields.
 * One card per field name; union variants are chips inside that card.
 */
export abstract class FieldEditorModal extends Modal {
    protected fieldsContainer: HTMLElement | null = null;
    protected activeConstraintsSection: HTMLElement | null = null;

    private expandedKey: Field | null = null;
    private expandedCard: HTMLElement | null = null;
    private activeVariants: Map<Field, Field> = new Map();
    private emptyMessage = "No fields defined.";
    private onNameInputCreated?: (input: HTMLInputElement) => void;

    constructor(app: App) {
        super(app);
    }

    // ========== Abstract Methods ==========

    /** Get the fields array being edited */
    protected abstract getFields(): Field[];

    /** Set the fields array */
    protected abstract setFields(fields: Field[]): void;

    /** Get available types for the type menus (primitives + custom types) */
    protected abstract getAvailableTypes(): string[];

    /** Called when a new field should be added */
    protected abstract onAddField(): void;

    // ========== Rendering ==========

    protected renderFields(
        emptyMessage: string = "No fields defined.",
        onNameInputCreated?: (input: HTMLInputElement) => void
    ): void {
        this.emptyMessage = emptyMessage;
        this.onNameInputCreated = onNameInputCreated;
        this.draw();
    }

    private draw(): void {
        if (!this.fieldsContainer) return;

        this.removeConstraintsSection();
        this.expandedCard = null;
        this.fieldsContainer.empty();

        const fields = this.getFields();
        if (fields.length === 0) {
            this.expandedKey = null;
            this.fieldsContainer.createEl("p", {
                text: this.emptyMessage,
                cls: "propsec-no-fields",
            });
            return;
        }

        const groups = this.buildGroups(fields);
        if (this.expandedKey && !groups.some((g) => g.variants[0] === this.expandedKey)) {
            this.expandedKey = null;
        }

        for (const group of groups) {
            this.renderFieldCard(this.fieldsContainer, group);
        }
    }

    private buildGroups(fields: Field[]): FieldGroup[] {
        const named = groupFieldsByName(fields.filter((f) => f.name !== ""));
        const groups: FieldGroup[] = [];
        const seen = new Set<string>();

        for (const field of fields) {
            if (field.name === "") {
                groups.push({ name: "", variants: [field] });
                continue;
            }
            if (seen.has(field.name)) continue;
            seen.add(field.name);
            groups.push({ name: field.name, variants: named.get(field.name) ?? [field] });
        }

        return groups;
    }

    private renderFieldCard(container: HTMLElement, group: FieldGroup): void {
        const card = container.createDiv({ cls: "propsec-field-card" });
        const mainRow = card.createDiv({ cls: "propsec-field-main-row" });

        const expandBtn = mainRow.createEl("button", {
            cls: "propsec-icon-btn propsec-expand-btn",
            attr: { title: "Configure field" },
        });
        setIcon(expandBtn, "chevron-right");
        expandBtn.addEventListener("click", () => {
            if (this.expandedCard === card) {
                this.collapse(card, expandBtn);
            } else {
                this.expand(group, card, expandBtn);
            }
        });

        const nameInput = mainRow.createEl("input", {
            type: "text",
            cls: "propsec-field-name",
        });
        nameInput.value = group.name;
        nameInput.placeholder = "Field name";
        nameInput.addEventListener("input", () => {
            group.name = nameInput.value;
            for (const variant of group.variants) {
                variant.name = nameInput.value;
            }
        });
        this.onNameInputCreated?.(nameInput);

        this.renderTypeChips(mainRow, group, card, expandBtn);
        this.renderGroupToggles(mainRow, group);

        if (group.variants.some((v) => v.when)) {
            const badge = mainRow.createSpan({
                cls: "propsec-condition-badge",
                attr: { title: "Applies only when a rule holds" },
            });
            setIcon(badge, "filter");
        }

        const deleteBtn = mainRow.createEl("button", {
            cls: "propsec-icon-btn propsec-delete-btn",
            attr: { title: "Remove field" },
        });
        setIcon(deleteBtn, "x");
        deleteBtn.addEventListener("click", () => this.removeVariants(group, group.variants));

        if (this.expandedKey === group.variants[0]) {
            this.openSection(group, card, expandBtn);
        }
    }

    // ========== Type Chips ==========

    private renderTypeChips(
        mainRow: HTMLElement,
        group: FieldGroup,
        card: HTMLElement,
        expandBtn: HTMLElement
    ): void {
        const chipsEl = mainRow.createDiv({ cls: "propsec-type-chips" });
        const visible = this.visibleVariants(group);
        const active = this.getActiveVariant(group);
        const chips: HTMLElement[] = [];

        for (const variant of visible) {
            const chip = chipsEl.createEl("button", {
                cls: "propsec-type-chip",
                text: this.variantLabel(variant),
                attr: { title: "Right-click to change or remove this type" },
            });
            chip.toggleClass("is-active", variant === active);
            chips.push(chip);

            chip.addEventListener("click", () => {
                this.activeVariants.set(group.variants[0], variant);
                chips.forEach((el, i) => el.toggleClass("is-active", visible[i] === variant));
                if (this.expandedCard === card) {
                    this.removeConstraintsSection();
                    this.openSection(group, card, expandBtn);
                }
            });

            chip.addEventListener("contextmenu", (evt) => {
                evt.preventDefault();
                this.showVariantMenu(evt, group, variant);
            });
        }

        const addChip = chipsEl.createEl("button", {
            cls: "propsec-type-chip propsec-type-chip-add",
            text: "+",
            attr: { title: "Add a type this field may hold" },
        });
        addChip.addEventListener("click", (evt) => this.showTypeMenu(evt, group));
    }

    private visibleVariants(group: FieldGroup): Field[] {
        return group.variants;
    }

    private getActiveVariant(group: FieldGroup): Field {
        const visible = this.visibleVariants(group);
        const stored = this.activeVariants.get(group.variants[0]);
        if (stored && visible.includes(stored)) return stored;
        return visible[0] ?? group.variants[0];
    }

    private variantLabel(field: Field): string {
        if (field.type === "array" && field.arrayElementType) {
            return `array<${field.arrayElementType}>`;
        }
        return field.type;
    }

    private unusedTypes(group: FieldGroup, ignore?: Field): string[] {
        const present = new Set(
            this.visibleVariants(group).filter((v) => v !== ignore).map((v) => v.type)
        );
        return this.getAvailableTypes().filter((t) => !present.has(t));
    }

    private showTypeMenu(evt: MouseEvent, group: FieldGroup): void {
        const candidates = this.unusedTypes(group);
        if (candidates.length === 0) return;

        const menu = new Menu();
        for (const type of candidates) {
            menu.addItem((item) => item.setTitle(type).onClick(() => this.addVariant(group, type)));
        }
        menu.showAtMouseEvent(evt);
    }

    private showVariantMenu(evt: MouseEvent, group: FieldGroup, variant: Field): void {
        const menu = new Menu();

        for (const type of this.unusedTypes(group, variant)) {
            menu.addItem((item) =>
                item.setTitle(`Change type to ${type}`).onClick(() => {
                    variant.type = type;
                    delete variant.must;
                    delete variant.arrayElementType;
                    delete variant.objectKeyType;
                    delete variant.objectValueType;
                    this.activeVariants.set(group.variants[0], variant);
                    this.draw();
                })
            );
        }

        if (this.visibleVariants(group).length > 1) {
            menu.addSeparator();
            menu.addItem((item) =>
                item
                    .setTitle("Remove variant")
                    .setIcon("trash")
                    .onClick(() => this.removeVariants(group, [variant]))
            );
        }

        menu.showAtMouseEvent(evt);
    }

    private addVariant(group: FieldGroup, type: string): void {
        const variant: Field = {
            name: group.name,
            type,
            required: type !== "null" && group.variants.some((v) => v.required),
        };
        const fields = this.getFields();
        const last = group.variants[group.variants.length - 1];
        fields.splice(fields.indexOf(last) + 1, 0, variant);
        this.setFields(fields);

        this.activeVariants.set(group.variants[0], variant);
        this.draw();
    }

    private removeVariants(group: FieldGroup, variants: Field[]): void {
        const removed = new Set(variants);
        const remaining = group.variants.filter((v) => !removed.has(v));

        if (this.expandedKey && removed.has(this.expandedKey)) {
            this.expandedKey = remaining[0] ?? null;
        }
        this.activeVariants.delete(group.variants[0]);

        this.setFields(this.getFields().filter((f) => !removed.has(f)));
        this.draw();
    }

    // ========== Group Toggles ==========

    private renderGroupToggles(mainRow: HTMLElement, group: FieldGroup): void {
        const flags = mainRow.createDiv({ cls: "propsec-field-flags" });

        const requiredBtn = flags.createEl("button", {
            cls: "propsec-flag-btn propsec-flag-required",
            attr: { title: "Required: field must be present in matching files" },
        });
        setIcon(requiredBtn, "circle-alert");

        const warnBtn = flags.createEl("button", {
            cls: "propsec-flag-btn propsec-flag-warn",
            attr: { title: "Warn only: report failures as soft warnings instead of errors" },
        });
        setIcon(warnBtn, "alert-triangle");

        const sync = () => {
            requiredBtn.toggleClass("is-on", group.variants.some((v) => v.required));
            warnBtn.toggleClass("is-on", group.variants.some((v) => v.warn === true));
        };
        sync();

        requiredBtn.addEventListener("click", () => {
            const enable = !group.variants.some((v) => v.required);
            for (const variant of group.variants) {
                variant.required = enable && variant.type !== "null";
                if (enable) delete variant.warn;
            }
            sync();
        });

        warnBtn.addEventListener("click", () => {
            const enable = !group.variants.some((v) => v.warn === true);
            for (const variant of group.variants) {
                if (enable) {
                    variant.warn = true;
                    variant.required = false;
                } else {
                    delete variant.warn;
                }
            }
            sync();
        });
    }

    // ========== Expand / Collapse ==========

    protected removeConstraintsSection(): void {
        if (this.activeConstraintsSection) {
            this.activeConstraintsSection.remove();
            this.activeConstraintsSection = null;
        }
    }

    private expand(group: FieldGroup, card: HTMLElement, expandBtn: HTMLElement): void {
        if (this.expandedCard && this.expandedCard !== card) {
            this.removeConstraintsSection();
            this.expandedCard.removeClass("expanded");
            const prevBtn = this.expandedCard.querySelector(".propsec-expand-btn");
            if (prevBtn) setIcon(prevBtn as HTMLElement, "chevron-right");
        }
        this.openSection(group, card, expandBtn);
    }

    private openSection(group: FieldGroup, card: HTMLElement, expandBtn: HTMLElement): void {
        this.expandedKey = group.variants[0];
        this.expandedCard = card;
        card.addClass("expanded");
        setIcon(expandBtn, "chevron-down");

        const section = card.createDiv({ cls: "propsec-constraints-section" });
        this.activeConstraintsSection = section;
        this.renderConstraints(section, this.getActiveVariant(group));
    }

    private collapse(card: HTMLElement, expandBtn: HTMLElement): void {
        this.expandedKey = null;
        this.expandedCard = null;

        const finish = () => {
            this.removeConstraintsSection();
            card.removeClass("expanded");
            setIcon(expandBtn, "chevron-right");
        };

        if (this.activeConstraintsSection) {
            this.activeConstraintsSection.addClass("collapsing");
            this.activeConstraintsSection.addEventListener("animationend", finish, { once: true });
        } else {
            finish();
        }
    }

    // ========== Rules Rendering ==========

    /** Property names offered while writing rules: this editor's fields plus every property in the vault */
    protected ruleProperties(): string[] {
        const names = new Set(this.getFields().map((f) => f.name).filter((n) => n !== ""));
        for (const name of Object.keys(this.app.metadataTypeManager.properties)) names.add(name);
        return [...names];
    }

    private renderConstraints(container: HTMLElement, field: Field): void {
        const grid = container.createDiv({ cls: "propsec-constraints-grid" });

        if (field.type === "array") {
            this.renderElementTypeRow(grid, field);
        }

        const uniqueRow = grid.createDiv({ cls: "propsec-constraint-row" });
        uniqueRow.createEl("label", { text: "Unique across files:" });
        const uniqueInput = uniqueRow.createEl("input", { type: "checkbox" });
        uniqueInput.checked = field.unique === true;
        uniqueInput.addEventListener("change", () => {
            if (uniqueInput.checked) {
                field.unique = true;
            } else {
                delete field.unique;
            }
        });

        const properties = this.ruleProperties();

        container.createDiv({ text: "Value must", cls: "propsec-constraints-title" });
        ruleInput(this.app, container, {
            context: { slot: "must", type: field.type, properties },
            value: field.must ?? "",
            onChange: (value) => {
                if (value.trim()) field.must = value;
                else delete field.must;
            },
        });

        container.createDiv({ text: "Applies when", cls: "propsec-constraints-title" });
        ruleInput(this.app, container, {
            context: { slot: "when", properties },
            value: field.when ?? "",
            onChange: (value) => {
                if (value.trim()) field.when = value;
                else delete field.when;
            },
        });
    }

    private renderElementTypeRow(grid: HTMLElement, field: Field): void {
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
            field.arrayElementType = (e.target as HTMLSelectElement).value || undefined;
            const chip = this.expandedCard?.querySelector(".propsec-type-chip.is-active");
            if (chip) (chip as HTMLElement).setText(this.variantLabel(field));
        });
    }
}
