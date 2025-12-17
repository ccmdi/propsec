import { App, Modal, TFile } from "obsidian";
import { Violation } from "../types";
import { ViolationStore } from "../validation/store";

/**
 * Modal displaying all frontmatter violations
 */
export class ViolationsModal extends Modal {
    private store: ViolationStore;
    private searchQuery: string = "";
    private container: HTMLElement | null = null;

    constructor(app: App, store: ViolationStore) {
        super(app);
        this.store = store;
    }

    onOpen(): void {
        const { contentEl } = this;

        contentEl.addClass("frontmatter-linter-violations-modal");

        // Header
        contentEl.createEl("h2", { text: "Schema Violations" });

        // Search bar
        const searchContainer = contentEl.createDiv({
            cls: "frontmatter-linter-search-container",
        });
        const searchInput = searchContainer.createEl("input", {
            type: "text",
            placeholder: "Search violations...",
            cls: "frontmatter-linter-search-input",
        });
        searchInput.addEventListener("input", (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
            this.renderViolations();
        });

        // Create scrollable container
        this.container = contentEl.createDiv({
            cls: "frontmatter-linter-violations-container",
        });

        this.renderViolations();
    }

    private renderViolations(): void {
        if (!this.container) return;
        this.container.empty();

        const violations = this.store.getAllViolations();

        if (violations.size === 0) {
            this.container.createEl("p", {
                text: "No violations found. All notes match their schemas.",
                cls: "frontmatter-linter-no-violations",
            });
            return;
        }

        // Filter and display violations by file
        let hasResults = false;
        for (const [filePath, fileViolations] of violations) {
            const filtered = this.filterViolations(filePath, fileViolations);
            if (filtered.length > 0) {
                hasResults = true;
                this.renderFileViolations(this.container, filePath, filtered);
            }
        }

        if (!hasResults && this.searchQuery) {
            this.container.createEl("p", {
                text: "No violations match your search.",
                cls: "frontmatter-linter-no-violations",
            });
        }
    }

    private filterViolations(filePath: string, violations: Violation[]): Violation[] {
        if (!this.searchQuery) return violations;

        const query = this.searchQuery;
        // Check if file path matches
        if (filePath.toLowerCase().includes(query)) {
            return violations;
        }
        // Filter individual violations
        return violations.filter(v =>
            v.field.toLowerCase().includes(query) ||
            v.message.toLowerCase().includes(query) ||
            v.schemaMapping.name.toLowerCase().includes(query)
        );
    }

    private renderFileViolations(
        container: HTMLElement,
        filePath: string,
        violations: Violation[]
    ): void {
        const fileSection = container.createDiv({
            cls: "frontmatter-linter-file-section",
        });

        // File header with clickable path
        const fileHeader = fileSection.createDiv({
            cls: "frontmatter-linter-file-header",
        });

        const fileLink = fileHeader.createEl("a", {
            text: filePath,
            cls: "frontmatter-linter-file-link",
        });

        fileLink.addEventListener("click", async (e) => {
            e.preventDefault();
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.app.workspace.getLeaf().openFile(file);
                this.close();
            }
        });

        // Schema name badge
        const schemaName = violations[0]?.schemaMapping.name || "Unknown";
        fileHeader.createEl("span", {
            text: `(${schemaName} schema)`,
            cls: "frontmatter-linter-schema-badge",
        });

        // List violations for this file
        const violationList = fileSection.createEl("ul", {
            cls: "frontmatter-linter-violation-list",
        });

        for (const violation of violations) {
            const item = violationList.createEl("li", {
                cls: `frontmatter-linter-violation-item frontmatter-linter-${violation.type}`,
            });

            // Icon based on violation type
            const icon = this.getViolationIcon(violation.type);
            item.createEl("span", {
                text: icon + " ",
                cls: "frontmatter-linter-violation-icon",
            });

            item.createEl("span", {
                text: violation.message,
                cls: "frontmatter-linter-violation-message",
            });
        }
    }

    private getViolationIcon(type: string): string {
        switch (type) {
            case "missing_required":
                return "!";
            case "missing_warned":
                return "*";
            case "type_mismatch":
                return "~";
            case "unknown_field":
                return "?";
            default:
                return "-";
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
