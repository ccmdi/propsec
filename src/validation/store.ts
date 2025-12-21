import { Violation, ValidationState, isWarningViolation, ViolationFilter } from "../types";

/**
 * In-memory store for validation violations
 */
export class ViolationStore {
    private state: ValidationState;
    private changeListeners: Array<() => void> = [];
    private batchStartListeners: Array<() => void> = [];
    private batchEndListeners: Array<() => void> = [];
    private batchDepth: number = 0;
    private batchHasChanges: boolean = false;
    
    // Microtask-based notification coalescing
    private notificationPending: boolean = false;

    constructor() {
        this.state = {
            violations: new Map(),
            lastFullValidation: 0,
        };
    }

    /**
     * Begin a batch update - notifications are suppressed until endBatch()
     */
    beginBatch(): void {
        const wasZero = this.batchDepth === 0;
        this.batchDepth++;
        if (wasZero) {
            for (const listener of this.batchStartListeners) {
                listener();
            }
        }
    }

    /**
     * End a batch update - notify listeners if there were changes
     */
    endBatch(): void {
        if (this.batchDepth > 0) {
            this.batchDepth--;
            if (this.batchDepth === 0) {
                for (const listener of this.batchEndListeners) {
                    listener();
                }
                if (this.batchHasChanges) {
                    this.batchHasChanges = false;
                    this.notifyListeners();
                }
            }
        }
    }

    /**
     * Check if currently in a batch update
     */
    isBatching(): boolean {
        return this.batchDepth > 0;
    }

    /**
     * Register a listener for batch start
     */
    onBatchStart(listener: () => void): void {
        this.batchStartListeners.push(listener);
    }

    /**
     * Register a listener for batch end
     */
    onBatchEnd(listener: () => void): void {
        this.batchEndListeners.push(listener);
    }

    /**
     * Add violations for a specific file (accumulates with existing)
     */
    addFileViolations(filePath: string, violations: Violation[]): void {
        if (violations.length === 0) return;
        
        const existing = this.state.violations.get(filePath) || [];
        this.state.violations.set(filePath, [...existing, ...violations]);
        this.notifyListeners();
    }

    /**
     * Remove all violations for a specific file
     */
    removeFile(filePath: string): void {
        if (this.state.violations.has(filePath)) {
            this.state.violations.delete(filePath);
            this.notifyListeners();
        }
    }

    /**
     * Remove all violations from a specific schema - O(files with violations * violations per file)
     */
    removeSchemaViolations(schemaId: string): void {
        let changed = false;
        for (const [filePath, violations] of this.state.violations) {
            const filtered = violations.filter(v => v.schemaMapping.id !== schemaId);
            if (filtered.length !== violations.length) {
                changed = true;
                if (filtered.length === 0) {
                    this.state.violations.delete(filePath);
                } else {
                    this.state.violations.set(filePath, filtered);
                }
            }
        }
        if (changed) {
            this.notifyListeners();
        }
    }

    /**
     * Remove violations for a specific file from a specific schema
     */
    removeFileSchemaViolations(filePath: string, schemaId: string): void {
        const violations = this.state.violations.get(filePath);
        if (!violations) return;
        
        const filtered = violations.filter(v => v.schemaMapping.id !== schemaId);
        if (filtered.length === violations.length) return; // No change
        
        if (filtered.length === 0) {
            this.state.violations.delete(filePath);
        } else {
            this.state.violations.set(filePath, filtered);
        }
        this.notifyListeners();
    }

    /**
     * Update file path when a file is renamed
     */
    renameFile(oldPath: string, newPath: string): void {
        if (this.state.violations.has(oldPath)) {
            const violations = this.state.violations.get(oldPath)!;
            // Update the filePath in each violation
            const updatedViolations = violations.map((v) => ({
                ...v,
                filePath: newPath,
            }));
            this.state.violations.delete(oldPath);
            this.state.violations.set(newPath, updatedViolations);
            this.notifyListeners();
        }
    }

    /**
     * Clear all violations
     */
    clear(): void {
        this.state.violations.clear();
        this.notifyListeners();
    }

    /**
     * Get violations for a specific file
     */
    getFileViolations(filePath: string): Violation[] {
        return this.state.violations.get(filePath) || [];
    }

    /**
     * Get all violations
     */
    getAllViolations(): Map<string, Violation[]> {
        return new Map(this.state.violations);
    }

    /**
     * Get total violation count
     * @param excludeWarnings If true, only count errors (not warnings)
     */
    getTotalViolationCount(excludeWarnings: boolean = false): number {
        let count = 0;
        for (const violations of this.state.violations.values()) {
            if (excludeWarnings) {
                count += violations.filter(v => !isWarningViolation(v)).length;
            } else {
                count += violations.length;
            }
        }
        return count;
    }

    /**
     * Get error count (violations that are not warnings)
     */
    getErrorCount(): number {
        return this.getTotalViolationCount(true);
    }

    /**
     * Get warning count
     */
    getWarningCount(): number {
        let count = 0;
        for (const violations of this.state.violations.values()) {
            count += violations.filter(v => isWarningViolation(v)).length;
        }
        return count;
    }

    /**
     * Get violations filtered by type
     */
    getFilteredViolations(filter: ViolationFilter): Map<string, Violation[]> {
        if (filter === "all") {
            return new Map(this.state.violations);
        }

        const filtered = new Map<string, Violation[]>();
        for (const [filePath, violations] of this.state.violations) {
            const filteredViolations = violations.filter(v => {
                const isWarning = isWarningViolation(v);
                return filter === "warnings" ? isWarning : !isWarning;
            });
            if (filteredViolations.length > 0) {
                filtered.set(filePath, filteredViolations);
            }
        }
        return filtered;
    }

    /**
     * Get count of files with violations
     * @param excludeWarnings If true, only count files that have at least one error (not just warnings)
     */
    getFileCount(excludeWarnings: boolean = false): number {
        if (!excludeWarnings) {
            return this.state.violations.size;
        }
        let count = 0;
        for (const violations of this.state.violations.values()) {
            if (violations.some(v => !isWarningViolation(v))) {
                count++;
            }
        }
        return count;
    }

    /**
     * Update the last full validation timestamp
     */
    setLastFullValidation(timestamp: number): void {
        this.state.lastFullValidation = timestamp;
    }

    /**
     * Get the last full validation timestamp
     */
    getLastFullValidation(): number {
        return this.state.lastFullValidation;
    }

    /**
     * Register a listener for state changes
     */
    onChange(listener: () => void): void {
        this.changeListeners.push(listener);
    }

    /**
     * Remove a change listener
     */
    offChange(listener: () => void): void {
        const index = this.changeListeners.indexOf(listener);
        if (index > -1) {
            this.changeListeners.splice(index, 1);
        }
    }

    /**
     * Notify all listeners of state change.
     * Uses microtask scheduling to coalesce multiple rapid changes into a single notification.
     */
    private notifyListeners(): void {
        if (this.batchDepth > 0) {
            this.batchHasChanges = true;
            return;
        }
        
        // Coalesce notifications within the same microtask
        if (this.notificationPending) return;
        this.notificationPending = true;
        
        queueMicrotask(() => {
            this.notificationPending = false;
            for (const listener of this.changeListeners) {
                listener();
            }
        });
    }
}
