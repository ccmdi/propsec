import { describe, it, expect } from "vitest";
import { parseQuerySegments, describeQuery, evaluatePropertyValue } from "./matcher";

describe("parseQuerySegments", () => {
    describe("basic queries", () => {
        it("parses wildcard query", () => {
            const segments = parseQuerySegments("*");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({ type: "all", value: "*" });
            expect(segments[0].notConditions).toHaveLength(0);
        });

        it("parses folder query", () => {
            const segments = parseQuerySegments("Journal/");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({ type: "folder", value: "Journal" });
        });

        it("parses recursive folder query", () => {
            const segments = parseQuerySegments("Journal/*");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({ type: "folder_recursive", value: "Journal" });
        });

        it("parses tag query", () => {
            const segments = parseQuerySegments("#book");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({ type: "tag", value: "book" });
        });
    });

    describe("OR queries", () => {
        it("parses simple OR query", () => {
            const segments = parseQuerySegments("folder/* or #tag");
            expect(segments).toHaveLength(2);
            expect(segments[0].andConditions[0]).toEqual({ type: "folder_recursive", value: "folder" });
            expect(segments[1].andConditions[0]).toEqual({ type: "tag", value: "tag" });
        });

        it("parses OR with multiple segments", () => {
            const segments = parseQuerySegments("#book or #article or #paper");
            expect(segments).toHaveLength(3);
            expect(segments[0].andConditions[0].value).toBe("book");
            expect(segments[1].andConditions[0].value).toBe("article");
            expect(segments[2].andConditions[0].value).toBe("paper");
        });

        it("is case insensitive for OR", () => {
            const segments = parseQuerySegments("folder/* OR #tag");
            expect(segments).toHaveLength(2);
        });
    });

    describe("AND queries", () => {
        it("parses simple AND query", () => {
            const segments = parseQuerySegments("folder/* and #tag");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(2);
            expect(segments[0].andConditions[0]).toEqual({ type: "folder_recursive", value: "folder" });
            expect(segments[0].andConditions[1]).toEqual({ type: "tag", value: "tag" });
        });

        it("parses multiple AND conditions", () => {
            const segments = parseQuerySegments("folder/* and #book and #fiction");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(3);
        });

        it("is case insensitive for AND", () => {
            const segments = parseQuerySegments("folder/* AND #tag");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(2);
        });
    });

    describe("NOT queries", () => {
        it("parses simple NOT query", () => {
            const segments = parseQuerySegments("folder/* not #draft");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({ type: "folder_recursive", value: "folder" });
            expect(segments[0].notConditions).toHaveLength(1);
            expect(segments[0].notConditions[0]).toEqual({ type: "tag", value: "draft" });
        });

        it("parses multiple NOT conditions", () => {
            const segments = parseQuerySegments("folder/* not #draft not #archived");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(1);
            expect(segments[0].notConditions).toHaveLength(2);
            expect(segments[0].notConditions[0].value).toBe("draft");
            expect(segments[0].notConditions[1].value).toBe("archived");
        });

        it("is case insensitive for NOT", () => {
            const segments = parseQuerySegments("folder/* NOT #draft");
            expect(segments).toHaveLength(1);
            expect(segments[0].notConditions).toHaveLength(1);
        });
    });

    describe("combined AND/NOT queries", () => {
        it("parses AND with NOT", () => {
            const segments = parseQuerySegments("folder/* and #book not #draft");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(2);
            expect(segments[0].andConditions[0]).toEqual({ type: "folder_recursive", value: "folder" });
            expect(segments[0].andConditions[1]).toEqual({ type: "tag", value: "book" });
            expect(segments[0].notConditions).toHaveLength(1);
            expect(segments[0].notConditions[0]).toEqual({ type: "tag", value: "draft" });
        });

        it("parses complex query with AND, NOT, and OR", () => {
            const segments = parseQuerySegments("Library/* and #book not #draft or #article");
            expect(segments).toHaveLength(2);

            // First segment: Library/* AND #book NOT #draft
            expect(segments[0].andConditions).toHaveLength(2);
            expect(segments[0].notConditions).toHaveLength(1);

            // Second segment: #article
            expect(segments[1].andConditions).toHaveLength(1);
            expect(segments[1].andConditions[0].value).toBe("article");
            expect(segments[1].notConditions).toHaveLength(0);
        });
    });

    describe("edge cases", () => {
        it("handles empty query", () => {
            const segments = parseQuerySegments("");
            expect(segments).toHaveLength(0);
        });

        it("handles whitespace-only query", () => {
            const segments = parseQuerySegments("   ");
            expect(segments).toHaveLength(0);
        });

        it("handles extra whitespace", () => {
            const segments = parseQuerySegments("  folder/*   and   #tag  ");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(2);
        });

        it("handles nested folder paths", () => {
            const segments = parseQuerySegments("Library/Books/Fiction/*");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({
                type: "folder_recursive",
                value: "Library/Books/Fiction",
            });
        });

        it("handles nested tags", () => {
            const segments = parseQuerySegments("#book/fiction");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({
                type: "tag",
                value: "book/fiction",
            });
        });
    });
});

describe("describeQuery", () => {
    it("describes simple queries", () => {
        expect(describeQuery("*")).toBe("all files");
        expect(describeQuery("folder/")).toBe("in folder/");
        expect(describeQuery("folder/*")).toBe("in folder/ (recursive)");
        expect(describeQuery("#book")).toBe("tagged #book");
    });

    it("describes OR queries", () => {
        expect(describeQuery("folder/* or #tag")).toBe("in folder/ (recursive) or tagged #tag");
    });

    it("describes AND queries", () => {
        expect(describeQuery("folder/* and #tag")).toBe("in folder/ (recursive) and tagged #tag");
    });

    it("describes NOT queries", () => {
        const desc = describeQuery("folder/* not #draft");
        expect(desc).toContain("in folder/ (recursive)");
        expect(desc).toContain("not");
        expect(desc).toContain("tagged #draft");
    });

    it("describes combined queries", () => {
        const desc = describeQuery("Library/* and #book not #draft or #article");
        expect(desc).toContain("in Library/ (recursive)");
        expect(desc).toContain("tagged #book");
        expect(desc).toContain("not");
        expect(desc).toContain("tagged #draft");
        expect(desc).toContain("or");
        expect(desc).toContain("tagged #article");
    });
});

describe("evaluatePropertyValue", () => {
    describe("string operators", () => {
        it("equals matches exact string", () => {
            expect(evaluatePropertyValue("2024-09-20", "equals", "2024-09-20")).toBe(true);
            expect(evaluatePropertyValue("2024-09-20", "equals", "2024-09-21")).toBe(false);
        });

        it("not_equals matches non-matching string", () => {
            expect(evaluatePropertyValue("2024-09-20", "not_equals", "2024-09-21")).toBe(true);
            expect(evaluatePropertyValue("2024-09-20", "not_equals", "2024-09-20")).toBe(false);
        });

        it("contains matches substring", () => {
            expect(evaluatePropertyValue("2024-09-20", "contains", "09")).toBe(true);
            expect(evaluatePropertyValue("2024-09-20", "contains", "10")).toBe(false);
            expect(evaluatePropertyValue("meeting-notes", "contains", "meeting")).toBe(true);
        });

        it("not_contains matches when substring absent", () => {
            expect(evaluatePropertyValue("2024-09-20", "not_contains", "10")).toBe(true);
            expect(evaluatePropertyValue("2024-09-20", "not_contains", "09")).toBe(false);
        });
    });

    describe("date comparison for $filename use case", () => {
        it("greater_than compares dates lexicographically (ISO format)", () => {
            // ISO date format (YYYY-MM-DD) sorts correctly as strings
            expect(evaluatePropertyValue("2024-09-21", "greater_than", "2024-09-20")).toBe(true);
            expect(evaluatePropertyValue("2024-09-20", "greater_than", "2024-09-20")).toBe(false);
            expect(evaluatePropertyValue("2024-09-19", "greater_than", "2024-09-20")).toBe(false);
        });

        it("less_than compares dates", () => {
            expect(evaluatePropertyValue("2024-09-19", "less_than", "2024-09-20")).toBe(true);
            expect(evaluatePropertyValue("2024-09-20", "less_than", "2024-09-20")).toBe(false);
            expect(evaluatePropertyValue("2024-09-21", "less_than", "2024-09-20")).toBe(false);
        });

        it("greater_or_equal compares dates", () => {
            expect(evaluatePropertyValue("2024-09-21", "greater_or_equal", "2024-09-20")).toBe(true);
            expect(evaluatePropertyValue("2024-09-20", "greater_or_equal", "2024-09-20")).toBe(true);
            expect(evaluatePropertyValue("2024-09-19", "greater_or_equal", "2024-09-20")).toBe(false);
        });

        it("less_or_equal compares dates", () => {
            expect(evaluatePropertyValue("2024-09-19", "less_or_equal", "2024-09-20")).toBe(true);
            expect(evaluatePropertyValue("2024-09-20", "less_or_equal", "2024-09-20")).toBe(true);
            expect(evaluatePropertyValue("2024-09-21", "less_or_equal", "2024-09-20")).toBe(false);
        });
    });

    describe("numeric comparison", () => {
        it("compares numbers correctly", () => {
            expect(evaluatePropertyValue(10, "greater_than", "5")).toBe(true);
            expect(evaluatePropertyValue(5, "greater_than", "10")).toBe(false);
            expect(evaluatePropertyValue(10, "less_than", "20")).toBe(true);
        });
    });

    describe("array handling", () => {
        it("contains checks array membership", () => {
            expect(evaluatePropertyValue(["a", "b", "c"], "contains", "b")).toBe(true);
            expect(evaluatePropertyValue(["a", "b", "c"], "contains", "d")).toBe(false);
        });

        it("not_contains checks array non-membership", () => {
            expect(evaluatePropertyValue(["a", "b", "c"], "not_contains", "d")).toBe(true);
            expect(evaluatePropertyValue(["a", "b", "c"], "not_contains", "b")).toBe(false);
        });
    });
});
