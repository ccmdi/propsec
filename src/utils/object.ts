/**
 * Find a key in an object case-insensitively.
 * Returns the actual key if found, or undefined.
 */
export function findKeyCaseInsensitive(obj: Record<string, unknown>, key: string): string | undefined {
    const lowerKey = key.toLowerCase();
    for (const k of Object.keys(obj)) {
        if (k.toLowerCase() === lowerKey) {
            return k;
        }
    }
    return undefined;
}

/**
 * Check if an object has a key (case-insensitive).
 */
export function hasKeyCaseInsensitive(obj: Record<string, unknown>, key: string): boolean {
    return findKeyCaseInsensitive(obj, key) !== undefined;
}
