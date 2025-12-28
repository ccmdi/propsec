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

        this.statusBarEl.addClass("mod-clickable");
        this.statusBarEl.addEventListener("click", this.onClick);

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
     * Show initial loading state
     */
    private showInitialLoading(): void {
        this.isLoading = true;
        this.statusBarEl.empty();
        this.statusBarEl.addClass("propsec-loading");

        const spinnerEl = this.statusBarEl.createSpan({ cls: "propsec-spinner" });
        setIcon(spinnerEl, "loader-2");
    }

    /**
     * Show loading spinner, preserving current width
     */
    private showLoading(): void {
        this.isLoading = true;
        this.lastWidth = this.statusBarEl.offsetWidth;

        this.statusBarEl.empty();
        this.statusBarEl.removeClass("propsec-ok");
        this.statusBarEl.removeClass("propsec-error");
        this.statusBarEl.addClass("propsec-loading");

        // Set fixed width via CSS custom property to prevent layout shift
        this.statusBarEl.style.setProperty("--loading-width", `${this.lastWidth}px`);

        const spinnerEl = this.statusBarEl.createSpan({ cls: "propsec-spinner" });
        setIcon(spinnerEl, "loader-2");
    }

    /**
     * Hide loading spinner and update display
     */
    private hideLoading(): void {
        this.isLoading = false;
        this.statusBarEl.removeClass("propsec-loading");
        this.statusBarEl.style.removeProperty("--loading-width");
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
            this.statusBarEl.removeClass("propsec-error");
            this.statusBarEl.addClass("propsec-ok");
        } else {
            const text =
                fileCount === 1
                    ? `${totalViolations} violation${totalViolations === 1 ? "" : "s"}`
                    : `${totalViolations} violation${totalViolations === 1 ? "" : "s"} in ${fileCount} files`;
            this.statusBarEl.setText(text);
            this.statusBarEl.removeClass("propsec-ok");
            if (this.colorErrors) {
                this.statusBarEl.addClass("propsec-error");
            } else {
                this.statusBarEl.removeClass("propsec-error");
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
