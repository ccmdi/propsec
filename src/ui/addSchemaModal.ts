import { App, Modal, TFile, TFolder } from "obsidian";
import { SchemaMapping, SchemaField, CustomType } from "../types";
import { extractSchemaFromTemplate } from "../schema/extractor";
import { SchemaEditorModal } from "./schemaEditorModal";
import { generateUUID } from "../utils/id";

/**
 * Modal for creating a new schema mapping
 */
export class AddSchemaModal extends Modal {
    private templatesFolder: string;
    private customTypes: CustomType[];
    private onSave: (mapping: SchemaMapping) => void;
    private enablePropertySuggestions: boolean;
    private selectedTemplate: TFile | null = null;
    private mode: "template" | "scratch" = "template";

    constructor(
        app: App,
        templatesFolder: string,
        customTypes: CustomType[],
        onSave: (mapping: SchemaMapping) => void,
        enablePropertySuggestions: boolean = true
    ) {
        super(app);
        this.templatesFolder = templatesFolder;
        this.customTypes = customTypes;
        this.onSave = onSave;
        this.enablePropertySuggestions = enablePropertySuggestions;
    }

    onOpen(): void {
        const { contentEl } = this;

        contentEl.addClass("frontmatter-linter-add-schema-modal");

        contentEl.createEl("h2", { text: "Add schema" });
        contentEl.createEl("p", { text: "How do you want to create this schema?" });

        // Option 1: Start from template
        const templateOption = contentEl.createDiv({
            cls: "frontmatter-linter-option frontmatter-linter-option-selected",
        });

        const templateRadio = templateOption.createEl("input", {
            type: "radio",
            attr: { name: "schema-mode", value: "template", checked: true },
        });
        templateRadio.id = "mode-template";

        const templateLabel = templateOption.createEl("label");
        templateLabel.setAttribute("for", "mode-template");
        templateLabel.createEl("strong", { text: "Start from a template" });
        templateLabel.createEl("br");
        templateLabel.createEl("span", {
            text: "Import fields from an existing template file",
            cls: "frontmatter-linter-option-desc",
        });

        // Template selector
        const templateSelector = templateOption.createDiv({
            cls: "frontmatter-linter-template-selector",
        });
        const templateSelect = templateSelector.createEl("select", {
            cls: "frontmatter-linter-template-select",
        });

        // Default option
        templateSelect.createEl("option", {
            text: "Select template...",
            value: "",
        });

        // Populate with template files
        const templateFiles = this.getTemplateFiles();
        for (const file of templateFiles) {
            templateSelect.createEl("option", {
                text: file.path,
                value: file.path,
            });
        }

        templateSelect.addEventListener("change", (e) => {
            const path = (e.target as HTMLSelectElement).value;
            if (path) {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    this.selectedTemplate = file;
                }
            } else {
                this.selectedTemplate = null;
            }
        });

        // Option 2: Start from scratch
        const scratchOption = contentEl.createDiv({
            cls: "frontmatter-linter-option",
        });

        const scratchRadio = scratchOption.createEl("input", {
            type: "radio",
            attr: { name: "schema-mode", value: "scratch" },
        });
        scratchRadio.id = "mode-scratch";

        const scratchLabel = scratchOption.createEl("label");
        scratchLabel.setAttribute("for", "mode-scratch");
        scratchLabel.createEl("strong", { text: "Start from scratch" });
        scratchLabel.createEl("br");
        scratchLabel.createEl("span", {
            text: "Create an empty schema and add fields manually",
            cls: "frontmatter-linter-option-desc",
        });

        // Radio change handlers
        templateRadio.addEventListener("change", () => {
            if (templateRadio.checked) {
                this.mode = "template";
                templateOption.addClass("frontmatter-linter-option-selected");
                scratchOption.removeClass("frontmatter-linter-option-selected");
                templateSelector.removeClass("frontmatter-linter-hidden");
            }
        });

        scratchRadio.addEventListener("change", () => {
            if (scratchRadio.checked) {
                this.mode = "scratch";
                scratchOption.addClass("frontmatter-linter-option-selected");
                templateOption.removeClass("frontmatter-linter-option-selected");
                templateSelector.addClass("frontmatter-linter-hidden");
            }
        });

        // Footer buttons
        const footer = contentEl.createDiv({
            cls: "frontmatter-linter-footer-buttons",
        });

        const cancelBtn = footer.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => {
            this.close();
        });

        const nextBtn = footer.createEl("button", {
            text: "Next",
            cls: "mod-cta",
        });
        //eslint-disable-next-line @typescript-eslint/no-misused-promises
        nextBtn.addEventListener("click", async () => {
            await this.proceedToEditor();
        });
    }

    private getTemplateFiles(): TFile[] {
        const templatesFolder = this.app.vault.getAbstractFileByPath(
            this.templatesFolder
        );

        if (!templatesFolder || !(templatesFolder instanceof TFolder)) {
            return [];
        }

        return this.getFilesRecursive(templatesFolder);
    }

    private getFilesRecursive(folder: TFolder): TFile[] {
        const files: TFile[] = [];
        for (const child of folder.children) {
            if (child instanceof TFile && child.extension === "md") {
                files.push(child);
            } else if (child instanceof TFolder) {
                files.push(...this.getFilesRecursive(child));
            }
        }
        return files;
    }

    private async proceedToEditor(): Promise<void> {
        let fields: SchemaField[] = [];
        let sourceTemplatePath: string | null = null;
        let defaultName = "New Schema";

        if (this.mode === "template") {
            if (!this.selectedTemplate) {
                // Show error
                return;
            }
            fields = await extractSchemaFromTemplate(this.app, this.selectedTemplate);
            sourceTemplatePath = this.selectedTemplate.path;
            // Use template file name (without extension) as default schema name
            defaultName = this.selectedTemplate.basename;
        }

        // Create new mapping with UUID
        const newMapping: SchemaMapping = {
            id: generateUUID(),
            name: defaultName,
            sourceTemplatePath,
            query: "",
            enabled: true,
            fields,
        };

        // Close this modal and open the editor
        this.close();

        const editorModal = new SchemaEditorModal(
            this.app,
            newMapping,
            this.templatesFolder,
            this.customTypes,
            (mapping) => {
                this.onSave(mapping);
            },
            this.enablePropertySuggestions
        );
        editorModal.open();
    }


    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
