import { App, Notice, Setting } from "obsidian";
import { SchemaField, CustomType, isPrimitiveType } from "../types";
import { getAllFieldTypes } from "../schema/extractor";
import { generatePrefixedId } from "../utils/id";
import { FieldEditorModal } from "./fieldEditorModal";

/**
 * Modal for editing a custom type definition
 */
export class CustomTypeEditorModal extends FieldEditorModal {
    private customType: CustomType;
    private existingTypes: CustomType[];
    private onSave: (customType: CustomType) => void;
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
            this.customType = JSON.parse(JSON.stringify(customType)) as unknown as CustomType;
        } else {
            this.customType = {
                id: generatePrefixedId("ct"),
                name: "",
                fields: [],
            };
        }

        this.existingTypes = existingTypes;
        this.onSave = onSave;
    }

    // ========== Abstract Method Implementations ==========

    protected getFields(): SchemaField[] {
        return this.customType.fields;
    }

    protected setFields(fields: SchemaField[]): void {
        this.customType.fields = fields;
    }

    protected getAvailableTypes(): string[] {
        const primitives = getAllFieldTypes();
        // Exclude self to prevent direct self-reference
        const otherCustomTypes = this.existingTypes
            .filter(t => t.id !== this.customType.id)
            .map(t => t.name);
        return [...primitives, ...otherCustomTypes];
    }

    protected onFieldDeleted(index: number): void {
        this.customType.fields.splice(index, 1);
    }

    protected onAddField(): void {
        this.customType.fields.push({
            name: "",
            type: "string",
            required: true,
        });
        this.renderFields("No fields defined. Add fields to define the structure of this custom type.");
    }

    // ========== Modal Lifecycle ==========

    onOpen(): void {
        const { contentEl } = this;

        contentEl.addClass("propsec-schema-editor");

        // Header
        contentEl.createEl("h2", {
            text: this.isNew ? "New Custom Type" : `Edit Custom Type: ${this.customType.name}`
        });

        // Name field
        new Setting(contentEl)
            .setName("Type name")
            .setDesc("A unique name for this custom type (e.g., 'exercise', 'person')")
            .addText((text) =>
                text
                    .setPlaceholder("Type name")
                    .setValue(this.customType.name)
                    .onChange((value) => {
                        this.customType.name = value.trim();
                    })
            );

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

        this.setupScrollHandler();
        this.renderFields("No fields defined. Add fields to define the structure of this custom type.");

        // Add field button
        const buttonsRow = contentEl.createDiv({
            cls: "propsec-buttons-row",
        });

        const addFieldBtn = buttonsRow.createEl("button", { text: "Add field" });
        addFieldBtn.addEventListener("click", () => this.onAddField());

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
        saveBtn.addEventListener("click", () => this.handleSave());
    }

    private handleSave(): void {
        if (!this.customType.name.trim()) {
            new Notice("Please enter a type name");
            return;
        }

        const duplicate = this.existingTypes.find(
            (t) => t.id !== this.customType.id && t.name === this.customType.name
        );
        if (duplicate) {
            new Notice(`A custom type named "${this.customType.name}" already exists`);
            return;
        }

        if (isPrimitiveType(this.customType.name)) {
            new Notice(`"${this.customType.name}" is a built-in type name. Please choose a different name.`);
            return;
        }

        this.customType.fields = this.customType.fields.filter(
            (f) => f.name.trim() !== ""
        );

        if (this.hasCircularReference()) {
            new Notice("Circular reference detected: a custom type cannot reference itself directly or indirectly.");
            return;
        }

        this.onSave(this.customType);
        this.close();
    }

    private hasCircularReference(): boolean {
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
                            return true;
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

    onClose(): void {
        this.cleanupScrollHandler();
        const { contentEl } = this;
        contentEl.empty();
    }
}
