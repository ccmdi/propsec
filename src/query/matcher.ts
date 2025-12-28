import { App, TFile } from "obsidian";
import { PropertyFilter, PropertyCondition } from "../types";
import { buildLowerKeyMap, lookupKey, hasKey, LowerKeyMap } from "../utils/object";
import {
    PropertyOperator,
    getOperatorSymbol,
    getOperatorDisplayName,
    evaluatePropertyOperator,
} from "../operators";

/**
 * Query syntax:
 * - "*" - all files (wildcard)
 * - "folder" - files directly in folder
 * - "folder/*" - files in folder and subfolders
 * - "#tag" - files with tag
 * - "folder/* or #tag" - union of conditions (OR)
 * - "folder/* and #tag" - intersection of conditions (AND)
 * - "folder/* not #draft" - exclusion (files in folder but not with #draft)
 *
 * Precedence (highest to lowest): NOT, AND, OR
 *
 * Examples:
 * - "*" - all markdown files in vault
 * - "Journal/Gym" - only files directly in Journal/Gym/
 * - "Journal/Gym/*" - files in Journal/Gym/ and all subfolders
 * - "#book" - all files with #book tag
 * - "Library/* or #book" - files in Library/ (recursive) OR with #book tag
 * - "Library/* and #book" - files in Library/ (recursive) AND with #book tag
 * - "Library/* not #draft" - files in Library/ excluding those with #draft
 * - "Library/* and #book not #draft" - files in Library/ with #book, excluding #draft
 */

export interface QueryCondition {
    type: "all" | "folder" | "folder_recursive" | "tag";
    value: string;
}

/**
 * A query segment represents one OR branch
 * Within a segment, AND conditions are intersected, NOT conditions are excluded
 */
export interface QuerySegment {
    andConditions: QueryCondition[];
    notConditions: QueryCondition[];
}

/**
 * Parse a single term into a QueryCondition
 */
function parseTerm(term: string): QueryCondition | null {
    const trimmed = term.trim();
    if (!trimmed) return null;

    if (trimmed === "*") {
        return { type: "all", value: "*" };
    } else if (trimmed.startsWith("#")) {
        return { type: "tag", value: trimmed.substring(1) };
    } else if (trimmed.endsWith("/*")) {
        return { type: "folder_recursive", value: trimmed.slice(0, -2).replace(/\/$/, "") };
    } else {
        return { type: "folder", value: trimmed.replace(/\/$/, "") };
    }
}

/**
 * Parse a query string into segments (OR branches)
 * Each segment contains AND conditions and NOT conditions
 */
export function parseQuerySegments(query: string): QuerySegment[] {
    const segments: QuerySegment[] = [];

    // Split by " or " (case insensitive) - lowest precedence
    const orParts = query.split(/\s+or\s+/i);

    for (const orPart of orParts) {
        const trimmed = orPart.trim();
        if (!trimmed) continue;

        const segment: QuerySegment = {
            andConditions: [],
            notConditions: [],
        };

        // split by NOT, first part is ANDs, rest are NOTs
        const notParts = trimmed.split(/\s+not\s+/i);

        // First part contains AND conditions
        const andPart = notParts[0];
        if (andPart) {
            const andTerms = andPart.split(/\s+and\s+/i);
            for (const term of andTerms) {
                const condition = parseTerm(term);
                if (condition) {
                    segment.andConditions.push(condition);
                }
            }
        }

        // Remaining parts are NOT conditions (each can also have ANDs within)
        for (let i = 1; i < notParts.length; i++) {
            // Each NOT part could be a single term or multiple terms ANDed
            // "NOT #draft AND #archived" means exclude files that have BOTH
            const notAndTerms = notParts[i].split(/\s+and\s+/i);
            for (const term of notAndTerms) {
                const condition = parseTerm(term);
                if (condition) {
                    segment.notConditions.push(condition);
                }
            }
        }

        if (segment.andConditions.length > 0) {
            segments.push(segment);
        }
    }

    return segments;
}

/**
 * Validate a query string and return any errors
 */
export function validateQuery(query: string): { valid: boolean; error?: string } {
    const trimmed = query.trim();

    // Empty query is invalid
    if (!trimmed) {
        return { valid: false, error: "Query cannot be empty" };
    }

    // Parse and check for valid segments
    const segments = parseQuerySegments(trimmed);

    if (segments.length === 0) {
        return { valid: false, error: "Query must contain at least one valid condition (folder, folder/*, #tag, or *)" };
    }

    // Check each segment has valid conditions
    for (const segment of segments) {
        if (segment.andConditions.length === 0) {
            return { valid: false, error: "Each OR branch must have at least one positive condition" };
        }
    }

    return { valid: true };
}

/**
 * Check if a file matches a query
 * Supports AND, OR, and NOT operators
 */
export function fileMatchesQuery(app: App, file: TFile, query: string): boolean {
    const segments = parseQuerySegments(query);

    if (segments.length === 0) {
        return false;
    }

    // OR logic across segments: match if any segment matches
    for (const segment of segments) {
        if (fileMatchesSegment(app, file, segment)) {
            return true;
        }
    }

    return false;
}

/**
 * Check if a file matches a single query segment
 * All AND conditions must match, no NOT conditions can match
 */
function fileMatchesSegment(app: App, file: TFile, segment: QuerySegment): boolean {
    // All AND conditions must match
    for (const condition of segment.andConditions) {
        if (!matchCondition(app, file, condition)) {
            return false;
        }
    }

    // No NOT conditions can match
    for (const condition of segment.notConditions) {
        if (matchCondition(app, file, condition)) {
            return false;
        }
    }

    return true;
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
 * Get a human-readable description of a single condition
 */
function describeCondition(c: QueryCondition): string {
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
}

/**
 * Get a human-readable description of a query
 */
export function describeQuery(query: string): string {
    const segments = parseQuerySegments(query);

    if (segments.length === 0) {
        return "No conditions";
    }

    const segmentDescriptions = segments.map((segment) => {
        const parts: string[] = [];

        // AND conditions
        if (segment.andConditions.length > 0) {
            const andDescs = segment.andConditions.map(describeCondition);
            parts.push(andDescs.join(" and "));
        }

        // NOT conditions
        if (segment.notConditions.length > 0) {
            const notDescs = segment.notConditions.map(describeCondition);
            parts.push("not " + notDescs.join(" and not "));
        }

        return parts.join(" ");
    });

    return segmentDescriptions.join(" or ");
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

    // Build lowercase key map once for O(1) lookups
    const keyMap = frontmatter ? buildLowerKeyMap(frontmatter) : new Map<string, string>();

    if (filter.hasProperty) {
        if (!frontmatter || !hasKey(keyMap, filter.hasProperty)) return false;
    }

    if (filter.notHasProperty) {
        if (frontmatter && hasKey(keyMap, filter.notHasProperty)) return false;
    }

    // Check property conditions (AND logic - all must match)
    if (filter.conditions && filter.conditions.length > 0) {
        for (const condition of filter.conditions) {
            if (!evaluateCondition(frontmatter, condition, keyMap)) {
                return false;
            }
        }
    }

    return true;
}

/**
 * Evaluate a single property condition against frontmatter
 */
function evaluateCondition(frontmatter: Record<string, unknown> | undefined, condition: PropertyCondition, keyMap: LowerKeyMap): boolean {
    const { property, operator, value } = condition;

    // O(1) case-insensitive property lookup
    const actualKey = lookupKey(keyMap, property);

    // If no frontmatter or property doesn't exist
    if (!frontmatter || !actualKey) {
        // For "not_equals" and "not_contains", missing property is a match
        return operator === "not_equals" || operator === "not_contains";
    }

    const propValue = frontmatter[actualKey];

    // Use centralized operator evaluation
    return evaluatePropertyOperator(propValue, operator, value);
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

