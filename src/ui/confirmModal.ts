import { App, Modal } from "obsidian";

/**
 * Simple confirmation modal
 */
export class ConfirmModal extends Modal {
    private title: string;
    private message: string;
    private onConfirm: () => void;

    constructor(app: App, title: string, message: string, onConfirm: () => void) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("propsec-confirm-modal");

        contentEl.createEl("h3", { text: this.title });
        contentEl.createEl("p", { text: this.message });

        const buttonRow = contentEl.createDiv({
            cls: "propsec-confirm-buttons",
        });

        const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => {
            this.close();
        });

        const confirmBtn = buttonRow.createEl("button", {
            text: "Delete",
            cls: "mod-warning",
        });
        confirmBtn.addEventListener("click", () => {
            this.onConfirm();
            this.close();
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
