import { ViolationStore } from "../validation/store";

/**
 * Status bar item that displays violation count
 */
export class StatusBarItem {
    private statusBarEl: HTMLElement;
    private store: ViolationStore;
    private onClick: () => void;
    private colorErrors: boolean = true;

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

        // Initial update
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
     * Update the status bar display
     */
    update(): void {
        const totalViolations = this.store.getTotalViolationCount();
        const fileCount = this.store.getFileCount();

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
