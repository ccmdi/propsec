import { App, Modal, Notice, setIcon } from "obsidian";
import { SchemaField, CustomType, SchemaMapping } from "../types";
import { formatTypeDisplay, groupFieldsByName } from "../utils/schema";
import { getReferencedCustomTypes } from "../validation/cache";
import { queryContext } from "../query/context";
import { fileMatchesPropertyFilter } from "../query/matcher";

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
    private schemaMappings: SchemaMapping[];
    private customTypes: CustomType[];

    constructor(app: App, customType: CustomType, schemaMappings: SchemaMapping[], customTypes: CustomType[]) {
        super(app);
        this.customType = customType;
        this.schemaMappings = schemaMappings;
        this.customTypes = customTypes;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("propsec-schema-preview-modal");

        // Title
        contentEl.createEl("h2", { text: this.customType.name });

        // Action row with copy button and usage stats
        const actionRow = contentEl.createDiv({ cls: "propsec-preview-query-row" });
        const copyBtn = actionRow.createEl("button", {
            cls: "propsec-preview-copy-btn clickable-icon",
            attr: { "aria-label": "Copy type as JSON" },
        });
        setIcon(copyBtn, "copy");
        copyBtn.addEventListener("click", () => {
            void this.copyTypeToClipboard();
        });

        const { schemaCount, noteCount } = this.countUsage();
        if (schemaCount > 0) {
            actionRow.createEl("span", {
                text: `used in ${schemaCount} schema${schemaCount === 1 ? "" : "s"}, ${noteCount} note${noteCount === 1 ? "" : "s"}`,
                cls: "propsec-preview-query",
            });
        } else {
            actionRow.createEl("span", {
                text: "not used in any schema",
                cls: "propsec-preview-query",
            });
        }

        // Resolve fields
        const resolvedFields = this.resolveFields(this.customType.fields);

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

    private async copyTypeToClipboard(): Promise<void> {
        const json = JSON.stringify(this.customType, null, 2);
        await navigator.clipboard.writeText(json);
        new Notice("Type copied to clipboard");
    }

    private countUsage(): { schemaCount: number; noteCount: number } {
        const schemasUsingType = this.schemaMappings.filter(schema => {
            const referencedTypes = getReferencedCustomTypes(schema.fields, this.customTypes);
            return referencedTypes.some(t => t.name === this.customType.name);
        });

        const uniqueFiles = new Set<string>();
        for (const schema of schemasUsingType) {
            if (!schema.query) continue;
            const files = queryContext.index.getFilesForQuery(schema.query);
            if (schema.propertyFilter) {
                for (const f of files) {
                    if (fileMatchesPropertyFilter(this.app, f, schema.propertyFilter!)) {
                        uniqueFiles.add(f.path);
                    }
                }
            } else {
                for (const f of files) {
                    uniqueFiles.add(f.path);
                }
            }
        }

        return { schemaCount: schemasUsingType.length, noteCount: uniqueFiles.size };
    }
}

