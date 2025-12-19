import { App, TFile } from "obsidian";
import { PropertyFilter, PropertyCondition, PropertyConditionOperator } from "../types";

/**
 * Query syntax:
 * - "*" - all files (wildcard)
 * - "folder" - files directly in folder
 * - "folder/*" - files in folder and subfolders
 * - "#tag" - files with tag
 * - "folder/* or #tag" - union of conditions (OR)
 *
 * Examples:
 * - "*" - all markdown files in vault
 * - "Journal/Gym" - only files directly in Journal/Gym/
 * - "Journal/Gym/*" - files in Journal/Gym/ and all subfolders
 * - "#book" - all files with #book tag
 * - "Library/* or #book" - files in Library/ (recursive) OR with #book tag
 */

interface QueryCondition {
    type: "all" | "folder" | "folder_recursive" | "tag";
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

        if (trimmed === "*") {
            // All files wildcard
            conditions.push({
                type: "all",
                value: "*",
            });
        } else if (trimmed.startsWith("#")) {
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
        case "all":
            return true;
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
    //eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
            case "all":
                return "all files";
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

/**
 * Find a key in an object case-insensitively
 */
function hasKeyCaseInsensitive(obj: Record<string, unknown>, key: string): boolean {
    const lowerKey = key.toLowerCase();
    return Object.keys(obj).some(k => k.toLowerCase() === lowerKey);
}

/**
 * Find a key in an object case-insensitively, return the actual key
 */
function findKeyCaseInsensitive(obj: Record<string, unknown>, key: string): string | undefined {
    //TODO
    const lowerKey = key.toLowerCase();
    for (const k of Object.keys(obj)) {
        if (k.toLowerCase() === lowerKey) {
            return k;
        }
    }
    return undefined;
}

/**
 * Check if a file matches property filters
 * All specified filters must match (AND logic)
 */
export function fileMatchesPropertyFilter(app: App, file: TFile, filter: PropertyFilter): boolean {
    // Check modified date filters
    if (filter.modifiedAfter) {
        const filterDate = new Date(filter.modifiedAfter).getTime();
        if (file.stat.mtime < filterDate) return false;
    }
    if (filter.modifiedBefore) {
        const filterDate = new Date(filter.modifiedBefore).getTime();
        if (file.stat.mtime > filterDate) return false;
    }

    // Check created date filters
    if (filter.createdAfter) {
        const filterDate = new Date(filter.createdAfter).getTime();
        if (file.stat.ctime < filterDate) return false;
    }
    if (filter.createdBefore) {
        const filterDate = new Date(filter.createdBefore).getTime();
        if (file.stat.ctime > filterDate) return false;
    }

    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;

    if (filter.hasProperty) {
        if (!frontmatter || !hasKeyCaseInsensitive(frontmatter, filter.hasProperty)) return false;
    }

    if (filter.notHasProperty) {
        if (frontmatter && hasKeyCaseInsensitive(frontmatter, filter.notHasProperty)) return false;
    }

    // Check property conditions (AND logic - all must match)
    if (filter.conditions && filter.conditions.length > 0) {
        for (const condition of filter.conditions) {
            if (!evaluateCondition(frontmatter, condition)) {
                return false;
            }
        }
    }

    return true;
}

/**
 * Evaluate a single property condition against frontmatter
 */
function evaluateCondition(frontmatter: Record<string, unknown> | undefined, condition: PropertyCondition): boolean {
    const { property, operator, value } = condition;

    // Case-insensitive property lookup
    const actualKey = frontmatter ? findKeyCaseInsensitive(frontmatter, property) : undefined;

    // If no frontmatter or property doesn't exist
    if (!frontmatter || !actualKey) {
        // For "not_equals" and "not_contains", missing property is a match
        return operator === "not_equals" || operator === "not_contains";
    }

    const propValue = frontmatter[actualKey];

    // Handle different operators
    switch (operator) {
        case "equals":
            return String(propValue) === value;

        case "not_equals":
            return String(propValue) !== value;

        case "contains":
            if (Array.isArray(propValue)) {
                return propValue.some(v => String(v) === value);
            }
            return String(propValue).includes(value);

        case "not_contains":
            if (Array.isArray(propValue)) {
                return !propValue.some(v => String(v) === value);
            }
            return !String(propValue).includes(value);

        case "greater_than":
        case "less_than":
        case "greater_or_equal":
        case "less_or_equal":
            return evaluateNumericCondition(propValue, operator, value);

        default:
            return false;
    }
}

/**
 * Evaluate numeric comparison operators
 */
function evaluateNumericCondition(
    propValue: unknown,
    operator: PropertyConditionOperator,
    compareValue: string
): boolean {
    // Try to parse both as numbers
    const numProp = typeof propValue === "number" ? propValue : parseFloat(String(propValue));
    const numCompare = parseFloat(compareValue);

    // If either isn't a valid number, try date comparison
    if (isNaN(numProp) || isNaN(numCompare)) {
        const dateProp = new Date(String(propValue)).getTime();
        const dateCompare = new Date(compareValue).getTime();

        if (!isNaN(dateProp) && !isNaN(dateCompare)) {
            switch (operator) {
                case "greater_than": return dateProp > dateCompare;
                case "less_than": return dateProp < dateCompare;
                case "greater_or_equal": return dateProp >= dateCompare;
                case "less_or_equal": return dateProp <= dateCompare;
            }
        }
        return false;
    }

    switch (operator) {
        case "greater_than": return numProp > numCompare;
        case "less_than": return numProp < numCompare;
        case "greater_or_equal": return numProp >= numCompare;
        case "less_or_equal": return numProp <= numCompare;
        default: return false;
    }
}

/**
 * Describe a property filter in human-readable form
 */
export function describePropertyFilter(filter: PropertyFilter): string {
    const parts: string[] = [];

    if (filter.modifiedAfter) parts.push(`modified after ${filter.modifiedAfter}`);
    if (filter.modifiedBefore) parts.push(`modified before ${filter.modifiedBefore}`);
    if (filter.createdAfter) parts.push(`created after ${filter.createdAfter}`);
    if (filter.createdBefore) parts.push(`created before ${filter.createdBefore}`);
    if (filter.hasProperty) parts.push(`has "${filter.hasProperty}"`);
    if (filter.notHasProperty) parts.push(`no "${filter.notHasProperty}"`);

    if (filter.conditions && filter.conditions.length > 0) {
        for (const cond of filter.conditions) {
            parts.push(`${cond.property} ${getOperatorSymbol(cond.operator)} ${cond.value}`);
        }
    }

    return parts.length > 0 ? parts.join(", ") : "";
}

/**
 * Get a human-readable symbol for an operator
 */
export function getOperatorSymbol(operator: PropertyConditionOperator): string {
    switch (operator) {
        case "equals": return "=";
        case "not_equals": return "!=";
        case "greater_than": return ">";
        case "less_than": return "<";
        case "greater_or_equal": return ">=";
        case "less_or_equal": return "<=";
        case "contains": return "contains";
        case "not_contains": return "!contains";
        default: return "?";
    }
}

/**
 * Get display name for an operator
 */
export function getOperatorDisplayName(operator: PropertyConditionOperator): string {
    switch (operator) {
        case "equals": return "equals";
        case "not_equals": return "not equals";
        case "greater_than": return "greater than";
        case "less_than": return "less than";
        case "greater_or_equal": return ">=";
        case "less_or_equal": return "<=";
        case "contains": return "contains";
        case "not_contains": return "not contains";
        default: return operator;
    }
}
