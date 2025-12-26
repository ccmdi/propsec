import { App, Modal } from "obsidian";
import { SchemaField, CustomType } from "../types";
import { formatTypeDisplay, groupFieldsByName } from "../utils/schema";

interface ResolvedField {
    name: string;
    typeDisplays: string[];  // Formatted type strings like "date" or "string"
    required: boolean;
    warn: boolean;
}

/**
 * Modal showing the computed/resolved view of a custom type
 * Groups union types and shows the effective field definitions
 */
export class TypePreviewModal extends Modal {
    private customType: CustomType;

    constructor(app: App, customType: CustomType) {
        super(app);
        this.customType = customType;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("frontmatter-linter-schema-preview-modal");

        // Title
        contentEl.createEl("h2", { text: this.customType.name });

        // Resolve fields
        const resolvedFields = this.resolveFields(this.customType.fields);

        if (resolvedFields.length === 0) {
            contentEl.createEl("p", {
                text: "No fields defined",
                cls: "frontmatter-linter-preview-empty",
            });
            return;
        }

        // Field list
        const fieldList = contentEl.createEl("div", {
            cls: "frontmatter-linter-preview-fields",
        });

        for (const field of resolvedFields) {
            const fieldEl = fieldList.createEl("div", {
                cls: "frontmatter-linter-preview-field",
            });

            // Field name
            const nameEl = fieldEl.createEl("span", {
                cls: "frontmatter-linter-preview-field-name",
            });
            nameEl.createEl("code", { text: field.name });

            // Colon separator
            fieldEl.createEl("span", { text: ": " });

            // Type(s)
            const typeText = field.typeDisplays.join(" | ");
            fieldEl.createEl("code", {
                text: typeText,
                cls: "frontmatter-linter-preview-field-type",
            });

            // Required/warn badge
            if (field.required) {
                fieldEl.createEl("span", {
                    text: "Required",
                    cls: "frontmatter-linter-preview-badge frontmatter-linter-preview-required",
                });
            } else if (field.warn) {
                fieldEl.createEl("span", {
                    text: "Warn",
                    cls: "frontmatter-linter-preview-badge frontmatter-linter-preview-warn",
                });
            }
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }

    /**
     * Group fields by name and compute the resolved union type
     */
    private resolveFields(fields: SchemaField[]): ResolvedField[] {
        const groups = groupFieldsByName(fields);

        const resolved: ResolvedField[] = [];
        for (const [name, variants] of groups) {
            const typeDisplays = variants.map(v => formatTypeDisplay(v));
            const required = variants.some(v => v.required);
            const warn = !required && variants.some(v => v.warn);

            resolved.push({ name, typeDisplays, required, warn });
        }

        return resolved;
    }
}

