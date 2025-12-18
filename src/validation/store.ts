import { Violation, ValidationState } from "../types";

/**
 * In-memory store for validation violations
 */
export class ViolationStore {
    private state: ValidationState;
    private changeListeners: Array<() => void> = [];

    constructor() {
        this.state = {
            violations: new Map(),
            lastFullValidation: 0,
        };
    }

    /**
     * Set violations for a specific file
     */
    setFileViolations(filePath: string, violations: Violation[]): void {
        if (violations.length === 0) {
            this.state.violations.delete(filePath);
        } else {
            this.state.violations.set(filePath, violations);
        }
        this.notifyListeners();
    }

    /**
     * Remove violations for a specific file
     */
    removeFile(filePath: string): void {
        if (this.state.violations.has(filePath)) {
            this.state.violations.delete(filePath);
            this.notifyListeners();
        }
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
     */
    getTotalViolationCount(): number {
        let count = 0;
        for (const violations of this.state.violations.values()) {
            count += violations.length;
        }
        return count;
    }

    /**
     * Get count of files with violations
     */
    getFileCount(): number {
        return this.state.violations.size;
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
     * Notify all listeners of state change
     */
    private notifyListeners(): void {
        for (const listener of this.changeListeners) {
            listener();
        }
    }
}
