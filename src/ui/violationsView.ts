import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { Violation } from "../types";
import { ViolationStore } from "../validation/store";

export const VIOLATIONS_VIEW_TYPE = "frontmatter-linter-violations";

/**
 * Sidebar view displaying frontmatter violations
 */
export class ViolationsView extends ItemView {
    private store: ViolationStore;
    private changeListener: () => void;
    private searchQuery: string = "";
    private listContainer: HTMLElement | null = null;
    private summaryEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, store: ViolationStore) {
        super(leaf);
        this.store = store;
        this.changeListener = () => this.renderList();
    }

    getViewType(): string {
        return VIOLATIONS_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Schema violations";
    }

    getIcon(): string {
        return "alert-triangle";
    }

    async onOpen(): Promise<void> {
        this.store.onChange(this.changeListener);
        this.render();
    }

    async onClose(): Promise<void> {
        this.store.offChange(this.changeListener);
    }

    private render(): void {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("frontmatter-linter-violations-view");

        // Search bar
        const searchContainer = container.createDiv({
            cls: "frontmatter-linter-view-search",
        });
        const searchInput = searchContainer.createEl("input", {
            type: "text",
            placeholder: "Search...",
            cls: "frontmatter-linter-view-search-input",
        });
        searchInput.value = this.searchQuery;
        searchInput.addEventListener("input", (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
            this.renderList();
        });

        // Summary
        this.summaryEl = container.createDiv({
            cls: "frontmatter-linter-view-summary",
        });

        // Violations list container
        this.listContainer = container.createDiv({
            cls: "frontmatter-linter-view-list",
        });

        this.renderList();
    }

    private renderList(): void {
        if (!this.listContainer || !this.summaryEl) return;
        this.listContainer.empty();

        const violations = this.store.getAllViolations();

        if (violations.size === 0) {
            this.summaryEl.empty();
            const emptyState = this.listContainer.createDiv({
                cls: "frontmatter-linter-view-empty",
            });
            emptyState.createEl("div", {
                text: "No violations",
                cls: "frontmatter-linter-view-empty-title",
            });
            emptyState.createEl("div", {
                text: "All notes match their schemas",
                cls: "frontmatter-linter-view-empty-desc",
            });
            return;
        }

        // Summary
        const totalViolations = this.store.getTotalViolationCount();
        const fileCount = this.store.getFileCount();
        this.summaryEl.setText(
            `${totalViolations} violation${totalViolations !== 1 ? "s" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""}`
        );

        // Filter and render
        let hasResults = false;
        for (const [filePath, fileViolations] of violations) {
            const filtered = this.filterViolations(filePath, fileViolations);
            if (filtered.length > 0) {
                hasResults = true;
                this.renderFileSection(this.listContainer, filePath, filtered);
            }
        }

        if (!hasResults && this.searchQuery) {
            this.listContainer.createEl("p", {
                text: "No violations match your search.",
                cls: "frontmatter-linter-view-no-results",
            });
        }
    }

    private filterViolations(filePath: string, violations: Violation[]): Violation[] {
        if (!this.searchQuery) return violations;

        const query = this.searchQuery;
        if (filePath.toLowerCase().includes(query)) {
            return violations;
        }
        return violations.filter(v =>
            v.field.toLowerCase().includes(query) ||
            v.message.toLowerCase().includes(query) ||
            v.schemaMapping.name.toLowerCase().includes(query)
        );
    }

    private renderFileSection(
        container: HTMLElement,
        filePath: string,
        violations: Violation[]
    ): void {
        const section = container.createDiv({
            cls: "frontmatter-linter-view-file",
        });

        // File header
        const header = section.createDiv({
            cls: "frontmatter-linter-view-file-header",
        });

        const fileLink = header.createEl("a", {
            cls: "frontmatter-linter-view-file-link",
        });

        // Show just the filename, with full path on hover
        const fileName = filePath.split("/").pop() || filePath;
        fileLink.setText(fileName);
        fileLink.setAttr("title", filePath);

        const openFile = async (e: MouseEvent, newTab: boolean) => {
            e.preventDefault();
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                const leaf = newTab
                    ? this.app.workspace.getLeaf('tab')
                    : this.app.workspace.getLeaf(false);
                await leaf.openFile(file);
            }
        };

        //eslint-disable-next-line @typescript-eslint/no-misused-promises
        fileLink.addEventListener("click", async (e) => await openFile(e, false));
        //eslint-disable-next-line @typescript-eslint/no-misused-promises
        fileLink.addEventListener("auxclick", async (e) => {
            if (e.button === 1) {
                await openFile(e, true);
            }
        });

        // Schema badge
        const schemaName = violations[0]?.schemaMapping.name || "Unknown";
        header.createEl("span", {
            text: schemaName,
            cls: "frontmatter-linter-view-schema",
        });

        // Violations
        const violationsList = section.createDiv({
            cls: "frontmatter-linter-view-violations",
        });

        for (const violation of violations) {
            const item = violationsList.createDiv({
                cls: `frontmatter-linter-view-item frontmatter-linter-view-${violation.type}`,
            });

            const icon = this.getViolationIcon(violation.type);
            item.createEl("span", {
                text: icon,
                cls: "frontmatter-linter-view-icon",
            });

            item.createEl("span", {
                text: violation.message,
                cls: "frontmatter-linter-view-message",
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
}
