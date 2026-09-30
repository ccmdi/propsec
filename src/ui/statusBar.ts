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
    private compact: boolean = true;
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
            this.renderLoading();
        } else {
            this.update();
        }
    }

    /**
     * Show the checking state: a spinning icon in compact mode, a spinner otherwise
     */
    private renderLoading(): void {
        this.isLoading = true;
        this.statusBarEl.empty();
        this.statusBarEl.removeClass("propsec-ok");
        this.statusBarEl.removeClass("propsec-error");
        this.statusBarEl.addClass("propsec-loading");
        this.setTooltip("Checking frontmatter…");

        const spinnerEl = this.statusBarEl.createSpan({ cls: "propsec-spinner" });
        setIcon(spinnerEl, this.compact ? "list-todo" : "loader-2");
        spinnerEl.toggleClass("is-compact", this.compact);
    }

    /**
     * Show loading spinner, preserving current width
     */
    private showLoading(): void {
        this.lastWidth = this.statusBarEl.offsetWidth;
        // Set fixed width via CSS custom property to prevent layout shift
        this.statusBarEl.style.setProperty("--loading-width", `${this.lastWidth}px`);
        this.renderLoading();
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
     * Set whether to show an icon and count instead of a sentence
     */
    setCompact(compact: boolean): void {
        this.compact = compact;
        this.update();
    }

    private setTooltip(text: string | null): void {
        if (this.compact && text) {
            this.statusBarEl.setAttr("aria-label", text);
            this.statusBarEl.setAttr("data-tooltip-position", "top");
        } else {
            this.statusBarEl.removeAttribute("aria-label");
        }
    }

    /**
     * Update the status bar display
     */
    update(): void {
        if (this.isLoading) return;

        const totalViolations = this.store.getTotalViolationCount(this.excludeWarnings);
        const fileCount = this.store.getFileCount(this.excludeWarnings);
        const violations = `${totalViolations} violation${totalViolations === 1 ? "" : "s"}`;
        const text = totalViolations === 0 ? "Frontmatter OK"
            : fileCount === 1 ? violations
            : `${violations} in ${fileCount} files`;

        this.statusBarEl.empty();
        this.statusBarEl.toggleClass("propsec-ok", totalViolations === 0);
        this.statusBarEl.toggleClass("propsec-error", totalViolations > 0 && this.colorErrors);
        this.setTooltip(text);

        if (!this.compact) {
            this.statusBarEl.setText(text);
            return;
        }
        const iconEl = this.statusBarEl.createSpan({ cls: "propsec-status-icon" });
        setIcon(iconEl, totalViolations === 0 ? "list-checks" : "list-x");
        if (totalViolations > 0) {
            this.statusBarEl.createSpan({ text: String(totalViolations), cls: "propsec-status-count" });
        }
    }

    /**
     * Clean up when the plugin is unloaded
     */
    destroy(): void {
        this.statusBarEl.removeEventListener("click", this.onClick);
    }
}
