import { ItemView, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import { Violation, ViolationFilter, isWarningViolation } from "../types";
import { ViolationStore } from "../validation/store";

export const VIOLATIONS_VIEW_TYPE = "frontmatter-linter-violations";

/**
 * Sidebar view displaying frontmatter violations
 */
export class ViolationsView extends ItemView {
    private store: ViolationStore;
    private changeListener: () => void;
    private searchQuery: string = "";
    private filter: ViolationFilter = "all";
    private listContainer: HTMLElement | null = null;
    private summaryEl: HTMLElement | null = null;
    private filterContainer: HTMLElement | null = null;

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
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("frontmatter-linter-violations-view");

        // Nav header with filter buttons and search (sibling to view-content, not inside)
        let navHeader = this.containerEl.querySelector(".nav-header") as HTMLElement;
        if (!navHeader) {
            navHeader = createDiv({ cls: "nav-header" });
            this.containerEl.insertBefore(navHeader, container);
        }
        navHeader.empty();

        // Filter buttons
        this.filterContainer = navHeader.createDiv({ cls: "nav-buttons-container" });
        this.renderFilterButtons();

        // Search bar in header (using native Obsidian search-input-container style)
        const searchContainer = navHeader.createDiv({ cls: "search-input-container" });
        const searchInput = searchContainer.createEl("input", {
            type: "search",
            attr: { enterkeyhint: "search", spellcheck: "false" },
            placeholder: "Search...",
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

    private renderFilterButtons(): void {
        if (!this.filterContainer) return;
        this.filterContainer.empty();

        const filters: Array<{ value: ViolationFilter; icon: string; tooltip: string }> = [
            { value: "all", icon: "list", tooltip: "All" },
            { value: "errors", icon: "alert-circle", tooltip: "Errors" },
            { value: "warnings", icon: "alert-triangle", tooltip: "Warnings" },
        ];

        for (const filterDef of filters) {
            const btn = this.filterContainer.createDiv({
                cls: `clickable-icon nav-action-button${this.filter === filterDef.value ? " is-active" : ""}`,
                attr: { "aria-label": filterDef.tooltip },
            });
            setIcon(btn, filterDef.icon);
            btn.addEventListener("click", () => {
                this.filter = filterDef.value;
                this.renderFilterButtons();
                this.renderList();
            });
        }
    }

    private renderList(): void {
        if (!this.listContainer || !this.summaryEl) return;
        this.listContainer.empty();

        const violations = this.store.getFilteredViolations(this.filter);

        if (violations.size === 0) {
            this.summaryEl.empty();
            const emptyState = this.listContainer.createDiv({
                cls: "frontmatter-linter-view-empty",
            });
            const emptyTitle = this.filter === "all"
                ? "No violations"
                : this.filter === "errors"
                    ? "No errors"
                    : "No warnings";
            const emptyDesc = this.filter === "all"
                ? "All notes match their schemas"
                : this.filter === "errors"
                    ? "No errors found"
                    : "No warnings found";
            emptyState.createEl("div", {
                text: emptyTitle,
                cls: "frontmatter-linter-view-empty-title",
            });
            emptyState.createEl("div", {
                text: emptyDesc,
                cls: "frontmatter-linter-view-empty-desc",
            });
            return;
        }

        // Summary - show counts based on filter
        let summaryText: string;
        if (this.filter === "all") {
            const errorCount = this.store.getErrorCount();
            const warningCount = this.store.getWarningCount();
            summaryText = `${errorCount} error${errorCount !== 1 ? "s" : ""}, ${warningCount} warning${warningCount !== 1 ? "s" : ""}`;
        } else {
            let count = 0;
            for (const fileViolations of violations.values()) {
                count += fileViolations.length;
            }
            const label = this.filter === "errors" ? "error" : "warning";
            summaryText = `${count} ${label}${count !== 1 ? "s" : ""}`;
        }
        this.summaryEl.setText(summaryText);

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
            const isWarning = isWarningViolation(violation);
            const item = violationsList.createDiv({
                cls: `frontmatter-linter-view-item frontmatter-linter-view-${violation.type} ${isWarning ? "frontmatter-linter-warning" : "frontmatter-linter-error-item"}`,
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
