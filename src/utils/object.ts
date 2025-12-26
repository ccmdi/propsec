/**
 * A pre-built map for O(1) case-insensitive key lookups.
 * Maps lowercase key -> actual key in the object.
 */
export type LowerKeyMap = Map<string, string>;

/**
 * Build a lowercase key map for an object.
 * Call once, then use lookupKey for O(1) lookups.
 */
export function buildLowerKeyMap(obj: Record<string, unknown>): LowerKeyMap {
    const map = new Map<string, string>();
    for (const key of Object.keys(obj)) {
        map.set(key.toLowerCase(), key);
    }
    return map;
}

/**
 * O(1) case-insensitive key lookup using a pre-built map.
 */
export function lookupKey(map: LowerKeyMap, key: string): string | undefined {
    return map.get(key.toLowerCase());
}

/**
 * O(1) check if a key exists (case-insensitive) using a pre-built map.
 */
export function hasKey(map: LowerKeyMap, key: string): boolean {
    return map.has(key.toLowerCase());
}