import { App, TFile } from "obsidian";

/**
 * Query syntax:
 * - "folder" - files directly in folder
 * - "folder/*" - files in folder and subfolders
 * - "#tag" - files with tag
 * - "folder/* or #tag" - union of conditions (OR)
 *
 * Examples:
 * - "Journal/Gym" - only files directly in Journal/Gym/
 * - "Journal/Gym/*" - files in Journal/Gym/ and all subfolders
 * - "#book" - all files with #book tag
 * - "Library/* or #book" - files in Library/ (recursive) OR with #book tag
 */

interface QueryCondition {
    type: "folder" | "folder_recursive" | "tag";
    value: string;
}

/**
 * Parse a query string into conditions
 */
export function parseQuery(query: string): QueryCondition[] {
    const conditions: QueryCondition[] = [];

    // Split by " or " (case insensitive)
    const parts = query.split(/\s+or\s+/i);

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("#")) {
            // Tag query
            conditions.push({
                type: "tag",
                value: trimmed.substring(1), // Remove #
            });
        } else if (trimmed.endsWith("/*")) {
            // Recursive folder query
            conditions.push({
                type: "folder_recursive",
                value: trimmed.slice(0, -2).replace(/\/$/, ""), // Remove /* and trailing /
            });
        } else {
            // Direct folder query
            conditions.push({
                type: "folder",
                value: trimmed.replace(/\/$/, ""), // Remove trailing /
            });
        }
    }

    return conditions;
}

/**
 * Check if a file matches a query
 */
export function fileMatchesQuery(app: App, file: TFile, query: string): boolean {
    const conditions = parseQuery(query);

    if (conditions.length === 0) {
        return false;
    }

    // OR logic: match if any condition is true
    for (const condition of conditions) {
        if (matchCondition(app, file, condition)) {
            return true;
        }
    }

    return false;
}

/**
 * Check if a file matches a single condition
 */
function matchCondition(app: App, file: TFile, condition: QueryCondition): boolean {
    switch (condition.type) {
        case "folder":
            return matchFolder(file, condition.value, false);
        case "folder_recursive":
            return matchFolder(file, condition.value, true);
        case "tag":
            return matchTag(app, file, condition.value);
        default:
            return false;
    }
}

/**
 * Check if file is in a folder
 */
function matchFolder(file: TFile, folder: string, recursive: boolean): boolean {
    // Normalize paths to use forward slashes
    const normalizedFolder = folder.replace(/\\/g, "/");
    const filePath = file.path.replace(/\\/g, "/");

    if (recursive) {
        // File is in folder or any subfolder
        return filePath.startsWith(normalizedFolder + "/");
    } else {
        // File is directly in folder
        const fileDir = file.parent?.path.replace(/\\/g, "/") || "";
        return fileDir === normalizedFolder;
    }
}

/**
 * Check if file has a specific tag
 */
function matchTag(app: App, file: TFile, tag: string): boolean {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) return false;

    // Check tags in frontmatter
    const frontmatterTags = cache.frontmatter?.tags;
    if (frontmatterTags) {
        const tagsArray = Array.isArray(frontmatterTags)
            ? frontmatterTags
            : [frontmatterTags];
        for (const t of tagsArray) {
            const normalizedTag = String(t).replace(/^#/, "");
            if (normalizedTag === tag || normalizedTag.startsWith(tag + "/")) {
                return true;
            }
        }
    }

    // Check inline tags
    if (cache.tags) {
        for (const tagCache of cache.tags) {
            const normalizedTag = tagCache.tag.replace(/^#/, "");
            if (normalizedTag === tag || normalizedTag.startsWith(tag + "/")) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Get a human-readable description of a query
 */
export function describeQuery(query: string): string {
    const conditions = parseQuery(query);

    if (conditions.length === 0) {
        return "No conditions";
    }

    const descriptions = conditions.map((c) => {
        switch (c.type) {
            case "folder":
                return `in ${c.value}/`;
            case "folder_recursive":
                return `in ${c.value}/ (recursive)`;
            case "tag":
                return `tagged #${c.value}`;
            default:
                return "unknown";
        }
    });

    return descriptions.join(" or ");
}
