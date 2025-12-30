import { App, Modal } from "obsidian";
import { SchemaField, SchemaMapping } from "../types";
import { queryContext } from "../query/context";
import { fileMatchesPropertyFilter } from "../query/matcher";
import { formatTypeDisplay, groupFieldsByName } from "../utils/schema";

interface ResolvedField {
    name: string;
    typeDisplays: string[];  // Formatted type strings like "person[]" or "string"
    required: boolean;
    warn: boolean;
}

/**
 * Modal showing the computed/resolved view of a schema
 * Groups union types and shows the effective field definitions
 */
export class SchemaPreviewModal extends Modal {
    private mapping: SchemaMapping;

    constructor(app: App, mapping: SchemaMapping) {
        super(app);
        this.mapping = mapping;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("propsec-schema-preview-modal");

        // Title
        contentEl.createEl("h2", { text: this.mapping.name });

        // Query info - count matching notes
        if (this.mapping.query) {
            const matchCount = this.countMatchingNotes();
            contentEl.createEl("p", {
                text: `matches ${matchCount} note${matchCount === 1 ? "" : "s"}`,
                cls: "propsec-preview-query",
            });
        }

        // Resolve fields
        const resolvedFields = this.resolveFields(this.mapping.fields);

        if (resolvedFields.length === 0) {
            contentEl.createEl("p", {
                text: "No fields defined",
                cls: "propsec-preview-empty",
            });
            return;
        }

        // Field list
        const fieldList = contentEl.createEl("div", {
            cls: "propsec-preview-fields",
        });

        for (const field of resolvedFields) {
            const fieldEl = fieldList.createEl("div", {
                cls: "propsec-preview-field",
            });

            // Field name
            const nameEl = fieldEl.createEl("span", {
                cls: "propsec-preview-field-name",
            });
            nameEl.createEl("code", { text: field.name });

            // Colon separator
            fieldEl.createEl("span", { text: ": " });

            // Type(s)
            const typeText = field.typeDisplays.join(" | ");
            fieldEl.createEl("code", {
                text: typeText,
                cls: "propsec-preview-field-type",
            });

            // Required/warn badge
            if (field.required) {
                fieldEl.createEl("span", {
                    text: "Required",
                    cls: "propsec-preview-badge propsec-preview-required",
                });
            } else if (field.warn) {
                fieldEl.createEl("span", {
                    text: "Warn",
                    cls: "propsec-preview-badge propsec-preview-warn",
                });
            }
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }

    /**
     * Count how many notes match this schema's query
     * Uses QueryIndex for fast lookup
     */
    private countMatchingNotes(): number {
        const files = queryContext.index.getFilesForQuery(this.mapping.query);
        
        if (this.mapping.propertyFilter) {
            return files.filter(f => 
                fileMatchesPropertyFilter(this.app, f, this.mapping.propertyFilter!)
            ).length;
        }
        
        return files.length;
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
            const warn = !required && variants.some(v => v.warn === true);

            resolved.push({ name, typeDisplays, required, warn });
        }

        return resolved;
    }

}
