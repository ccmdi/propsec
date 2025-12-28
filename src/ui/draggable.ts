/**
 * Makes an element draggable within a container for reordering.
 * Dragging is only initiated when starting from the drag handle.
 *
 * @param itemEl - The element to make draggable
 * @param container - The parent container holding all draggable items
 * @param index - The current index of this item
 * @param onReorder - Callback when item is dropped at a new position
 * @param handleSelector - CSS selector for the drag handle (default: ".propsec-drag-handle")
 */
export function makeDraggable(
    itemEl: HTMLElement,
    container: HTMLElement,
    index: number,
    onReorder: (fromIndex: number, toIndex: number) => void,
    handleSelector = ".propsec-drag-handle"
): void {
    itemEl.dataset.index = String(index);

    // Only enable dragging when mousedown on handle
    itemEl.addEventListener("mousedown", (e) => {
        const handle = itemEl.querySelector(handleSelector);
        if (handle && (e.target === handle || handle.contains(e.target as Node))) {
            itemEl.draggable = true;
        } else {
            itemEl.draggable = false;
        }
    });

    itemEl.addEventListener("dragstart", (e) => {
        itemEl.addClass("dragging");
        e.dataTransfer?.setData("text/plain", String(index));
    });

    itemEl.addEventListener("dragend", () => {
        itemEl.removeClass("dragging");
        itemEl.draggable = false;
        container
            .querySelectorAll(".drag-over")
            .forEach((el) => el.removeClass("drag-over"));
    });

    itemEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        itemEl.addClass("drag-over");
    });

    itemEl.addEventListener("dragleave", () => {
        itemEl.removeClass("drag-over");
    });

    itemEl.addEventListener("drop", (e) => {
        e.preventDefault();
        itemEl.removeClass("drag-over");
        const fromIndex = parseInt(
            e.dataTransfer?.getData("text/plain") || "-1"
        );
        const toIndex = index;
        if (fromIndex >= 0 && fromIndex !== toIndex) {
            onReorder(fromIndex, toIndex);
        }
    });
}
