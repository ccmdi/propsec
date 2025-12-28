import { App, Modal, TFile, setIcon } from "obsidian";
import { Violation, ViolationFilter, isWarningViolation } from "../types";
import { ViolationStore } from "../validation/store";
import { getViolationIcon } from "../utils/violation";

/**
 * Modal displaying all frontmatter violations
 */
export class ViolationsModal extends Modal {
    private store: ViolationStore;
    private searchQuery: string = "";
    private filter: ViolationFilter = "errors";
    private container: HTMLElement | null = null;

    constructor(app: App, store: ViolationStore) {
        super(app);
        this.store = store;
    }

    onOpen(): void {
        const { contentEl } = this;

        contentEl.addClass("propsec-violations-modal");

        // Header
        contentEl.createEl("h2", { text: "Schema violations" });

        // Filter tabs
        const filterContainer = contentEl.createDiv({
            cls: "propsec-filter-tabs",
        });
        this.renderFilterTabs(filterContainer);

        // Search bar
        const searchContainer = contentEl.createDiv({
            cls: "propsec-search-container",
        });
        const searchInput = searchContainer.createEl("input", {
            type: "text",
            placeholder: "Search violations...",
            cls: "propsec-search-input",
        });
        searchInput.addEventListener("input", (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
            this.renderViolations();
        });

        // Create scrollable container
        this.container = contentEl.createDiv({
            cls: "propsec-violations-container",
        });

        this.renderViolations();
    }

    private renderFilterTabs(container: HTMLElement): void {
        container.empty();

        const tabs: Array<{ value: ViolationFilter; icon: string; tooltip: string }> = [
            { value: "all", icon: "list", tooltip: "All" },
            { value: "errors", icon: "alert-circle", tooltip: "Errors" },
            { value: "warnings", icon: "alert-triangle", tooltip: "Warnings" },
        ];

        for (const tab of tabs) {
            const tabEl = container.createEl("button", {
                cls: `propsec-filter-tab ${this.filter === tab.value ? "active" : ""}`,
                attr: { "aria-label": tab.tooltip, title: tab.tooltip },
            });
            setIcon(tabEl, tab.icon);
            tabEl.addEventListener("click", () => {
                this.filter = tab.value;
                this.renderFilterTabs(container);
                this.renderViolations();
            });
        }
    }

    private renderViolations(): void {
        if (!this.container) return;
        this.container.empty();

        const violations = this.store.getFilteredViolations(this.filter);

        if (violations.size === 0) {
            const emptyMessage = this.filter === "all"
                ? "No violations found. All notes match their schemas."
                : this.filter === "errors"
                    ? "No errors found."
                    : "No warnings found.";
            this.container.createEl("p", {
                text: emptyMessage,
                cls: "propsec-no-violations",
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
                cls: "propsec-no-violations",
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
            cls: "propsec-file-section",
        });

        // File header with clickable path
        const fileHeader = fileSection.createDiv({
            cls: "propsec-file-header",
        });

        const fileLink = fileHeader.createEl("a", {
            text: filePath.replace(/\.md$/, ""),
            cls: "propsec-file-link",
        });

        //eslint-disable-next-line @typescript-eslint/no-misused-promises
        fileLink.addEventListener("click", async (e) => {
            e.preventDefault();
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.app.workspace.getLeaf().openFile(file);
                this.close();
            }
        });

        // Group violations by schema
        const bySchema = new Map<string, Violation[]>();
        for (const v of violations) {
            const schemaId = v.schemaMapping.id;
            if (!bySchema.has(schemaId)) {
                bySchema.set(schemaId, []);
            }
            bySchema.get(schemaId)!.push(v);
        }

        // Render each schema's violations
        for (const [, schemaViolations] of bySchema) {
            const schemaName = schemaViolations[0].schemaMapping.name;
            
            const schemaGroup = fileSection.createDiv({
                cls: "propsec-schema-group",
            });
            
            schemaGroup.createEl("span", {
                text: schemaName,
                cls: "propsec-schema-badge",
            });

            const violationList = schemaGroup.createEl("ul", {
                cls: "propsec-violation-list",
            });

            for (const violation of schemaViolations) {
                const isWarning = isWarningViolation(violation);
                const item = violationList.createEl("li", {
                    cls: `propsec-violation-item propsec-${violation.type} ${isWarning ? "propsec-warning" : "propsec-error-item"}`,
                });

                // Icon based on violation type
                const icon = getViolationIcon(violation.type);
                item.createEl("span", {
                    text: icon + " ",
                    cls: "propsec-violation-icon",
                });

                item.createEl("span", {
                    text: violation.message,
                    cls: "propsec-violation-message",
                });
            }
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
