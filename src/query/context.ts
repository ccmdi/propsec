import { App } from "obsidian";
import { QueryIndex } from "./index";

/**
 * Global query context
 */
class QueryContext {
    private _index: QueryIndex | null = null;

    /**
     * Initialize the context with app and plugin info
     * Must be called once during plugin load
     */
    initialize(app: App, pluginId: string): void {
        this._index = new QueryIndex(app, pluginId);
    }

    /**
     * Get the query index instance
     * Throws if accessed before initialization
     */
    get index(): QueryIndex {
        if (!this._index) {
            throw new Error("QueryContext not initialized - call initialize() first");
        }
        return this._index;
    }

    /**
     * Check if the context has been initialized
     */
    get isInitialized(): boolean {
        return this._index !== null;
    }
}

// Singleton instance
export const queryContext = new QueryContext();

