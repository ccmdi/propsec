import { setIcon } from "obsidian";
import { ViolationStore } from "../validation/store";

/**
 * Status bar item that displays violation count
 */
export class StatusBarItem {
    private statusBarEl: HTMLElement;
    private store: ViolationStore;
    private onClick: () => void;
    private colorErrors: boolean = true;
    private excludeWarnings: boolean = true;
    private lastWidth: number = 0;
    private isLoading: boolean = false;

    constructor(
        statusBarEl: HTMLElement,
        store: ViolationStore,
        onClick: () => void
    ) {
        this.statusBarEl = statusBarEl;
        this.store = store;
        this.onClick = onClick;

        // Set up click handler
        this.statusBarEl.addClass("mod-clickable");
        this.statusBarEl.addEventListener("click", this.onClick);

        // Subscribe to store changes
        this.store.onChange(() => this.update());

        this.store.onBatchStart(() => this.showLoading());
        this.store.onBatchEnd(() => this.hideLoading());

        if (this.store.getLastFullValidation() === 0) {
            this.showInitialLoading();
        } else {
            this.update();
        }
    }

    /**
     * Show initial loading state (no width preservation since there's no prior content)
     */
    private showInitialLoading(): void {
        this.isLoading = true;
        this.statusBarEl.empty();
        this.statusBarEl.addClass("frontmatter-linter-loading");

        const spinnerEl = this.statusBarEl.createSpan({ cls: "frontmatter-linter-spinner" });
        setIcon(spinnerEl, "loader-2");
    }

    /**
     * Show loading spinner, preserving current width
     */
    private showLoading(): void {
        this.isLoading = true;
        // Capture current width before changing content
        this.lastWidth = this.statusBarEl.offsetWidth;

        this.statusBarEl.empty();
        this.statusBarEl.removeClass("frontmatter-linter-ok");
        this.statusBarEl.removeClass("frontmatter-linter-error");
        this.statusBarEl.addClass("frontmatter-linter-loading");

        // Set fixed width to prevent layout shift
        this.statusBarEl.style.width = `${this.lastWidth}px`;

        // Add spinner icon
        const spinnerEl = this.statusBarEl.createSpan({ cls: "frontmatter-linter-spinner" });
        setIcon(spinnerEl, "loader-2");
    }

    /**
     * Hide loading spinner and update display
     */
    private hideLoading(): void {
        this.isLoading = false;
        this.statusBarEl.removeClass("frontmatter-linter-loading");
        this.statusBarEl.style.width = "";
        this.update();
    }

    /**
     * Set whether to color the status bar red when there are violations
     */
    setColorErrors(colorErrors: boolean): void {
        this.colorErrors = colorErrors;
        this.update();
    }

    /**
     * Set whether to exclude warnings from the violation count
     */
    setExcludeWarnings(excludeWarnings: boolean): void {
        this.excludeWarnings = excludeWarnings;
        this.update();
    }

    /**
     * Update the status bar display
     */
    update(): void {
        if (this.isLoading) return;

        const totalViolations = this.store.getTotalViolationCount(this.excludeWarnings);
        const fileCount = this.store.getFileCount(this.excludeWarnings);

        // Clear existing content
        this.statusBarEl.empty();

        if (totalViolations === 0) {
            this.statusBarEl.setText("Frontmatter OK");
            this.statusBarEl.removeClass("frontmatter-linter-error");
            this.statusBarEl.addClass("frontmatter-linter-ok");
        } else {
            const text =
                fileCount === 1
                    ? `${totalViolations} violation${totalViolations === 1 ? "" : "s"}`
                    : `${totalViolations} violation${totalViolations === 1 ? "" : "s"} in ${fileCount} files`;
            this.statusBarEl.setText(text);
            this.statusBarEl.removeClass("frontmatter-linter-ok");
            if (this.colorErrors) {
                this.statusBarEl.addClass("frontmatter-linter-error");
            } else {
                this.statusBarEl.removeClass("frontmatter-linter-error");
            }
        }
    }

    /**
     * Clean up when the plugin is unloaded
     */
    destroy(): void {
        this.statusBarEl.removeEventListener("click", this.onClick);
    }
}
