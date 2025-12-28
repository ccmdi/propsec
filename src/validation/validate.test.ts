import { describe, it, expect, beforeEach } from "vitest";
import { validateFrontmatter } from "./validate";
import { validationContext } from "./context";
import { SchemaMapping, SchemaField } from "../types";

// Helper to create a minimal schema mapping
function createSchema(fields: SchemaField[], query = "test/*"): SchemaMapping {
    return {
        id: "test-schema",
        name: "Test Schema",
        sourceTemplatePath: null,
        query,
        enabled: true,
        fields,
    };
}

// Helper to create a field
function field(
    name: string,
    type: string,
    options: Partial<SchemaField> = {}
): SchemaField {
    return {
        name,
        type,
        required: false,
        ...options,
    };
}

describe("validateFrontmatter", () => {
    beforeEach(() => {
        validationContext.setCustomTypes([]);
    });

    describe("primitive types", () => {
        it("validates string type", () => {
            const schema = createSchema([field("title", "string", { required: true })]);

            expect(validateFrontmatter({ title: "Hello" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            expect(validateFrontmatter({ title: 123 }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
        });

        it("validates number type", () => {
            const schema = createSchema([field("count", "number", { required: true })]);

            expect(validateFrontmatter({ count: 42 }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            expect(validateFrontmatter({ count: "42" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
        });

        it("validates boolean type", () => {
            const schema = createSchema([field("active", "boolean", { required: true })]);

            expect(validateFrontmatter({ active: true }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            expect(validateFrontmatter({ active: "true" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
        });

        it("validates date type (ISO format)", () => {
            const schema = createSchema([field("created", "date", { required: true })]);

            expect(validateFrontmatter({ created: "2024-01-15" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            expect(validateFrontmatter({ created: "January 15, 2024" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
        });

        it("validates array type", () => {
            const schema = createSchema([field("tags", "array", { required: true })]);

            expect(validateFrontmatter({ tags: ["a", "b"] }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            expect(validateFrontmatter({ tags: "not-array" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
        });

        it("validates null type", () => {
            const schema = createSchema([field("empty", "null", { required: true })]);

            expect(validateFrontmatter({ empty: null }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            expect(validateFrontmatter({ empty: "not null" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
        });

        it("validates unknown type (accepts anything)", () => {
            const schema = createSchema([field("data", "unknown", { required: true })]);

            expect(validateFrontmatter({ data: "string" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ data: 123 }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ data: { nested: true } }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });
    });

    describe("required and warn fields", () => {
        it("reports missing required field", () => {
            const schema = createSchema([field("title", "string", { required: true })]);

            const violations = validateFrontmatter({}, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("missing_required");
        });

        it("reports missing warned field", () => {
            const schema = createSchema([field("title", "string", { warn: true })]);

            const violations = validateFrontmatter({}, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("missing_warned");
        });

        it("does not report missing optional field", () => {
            const schema = createSchema([field("title", "string")]);

            expect(validateFrontmatter({}, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });
    });

    describe("union types (schema fields)", () => {
        it("accepts value matching any variant", () => {
            const schema = createSchema([
                field("value", "string"),
                field("value", "number"),
            ]);

            expect(validateFrontmatter({ value: "hello" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ value: 42 }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });

        it("rejects value not matching any variant", () => {
            const schema = createSchema([
                field("value", "string"),
                field("value", "number"),
            ]);

            const violations = validateFrontmatter({ value: true }, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("type_mismatch");
            expect(violations[0].expected).toBe("string | number");
        });

        it("is required if ANY variant is required", () => {
            const schema = createSchema([
                field("value", "string", { required: true }),
                field("value", "null"),
            ]);

            const violations = validateFrontmatter({}, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("missing_required");
        });

        it("is warned if no variant is required but any has warn", () => {
            const schema = createSchema([
                field("value", "string", { warn: true }),
                field("value", "null"),
            ]);

            const violations = validateFrontmatter({}, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("missing_warned");
        });

        it("nullable string pattern: string | null", () => {
            const schema = createSchema([
                field("name", "string"),
                field("name", "null"),
            ]);

            expect(validateFrontmatter({ name: "Alice" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ name: null }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ name: 123 }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
        });
    });

    describe("custom types", () => {
        beforeEach(() => {
            validationContext.setCustomTypes([
                {
                    id: "person-type",
                    name: "person",
                    fields: [
                        { name: "name", type: "string", required: true },
                        { name: "age", type: "number", required: false },
                    ],
                },
            ]);
        });

        it("validates object against custom type", () => {
            const schema = createSchema([field("author", "person", { required: true })]);

            expect(validateFrontmatter(
                { author: { name: "Alice", age: 30 } },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);
        });

        it("reports missing required field in custom type", () => {
            const schema = createSchema([field("author", "person", { required: true })]);

            const violations = validateFrontmatter(
                { author: { age: 30 } }, // missing name
                schema, "test.md", { checkUnknownFields: false }
            );
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("type_mismatch");
        });

        it("reports type mismatch in custom type field", () => {
            const schema = createSchema([field("author", "person", { required: true })]);

            const violations = validateFrontmatter(
                { author: { name: 123 } }, // name should be string
                schema, "test.md", { checkUnknownFields: false }
            );
            expect(violations).toHaveLength(1);
        });
    });

    describe("union types in custom types", () => {
        beforeEach(() => {
            validationContext.setCustomTypes([
                {
                    id: "flexible-type",
                    name: "flexible",
                    fields: [
                        { name: "value", type: "string", required: false },
                        { name: "value", type: "number", required: false },
                    ],
                },
            ]);
        });

        it("accepts value matching any variant in custom type", () => {
            const schema = createSchema([field("data", "flexible", { required: true })]);

            expect(validateFrontmatter(
                { data: { value: "hello" } },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);

            expect(validateFrontmatter(
                { data: { value: 42 } },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);
        });

        it("rejects value not matching any variant in custom type", () => {
            const schema = createSchema([field("data", "flexible", { required: true })]);

            const violations = validateFrontmatter(
                { data: { value: true } }, // boolean not allowed
                schema, "test.md", { checkUnknownFields: false }
            );
            expect(violations.length).toBeGreaterThan(0);
        });

        it("handles nullable fields in custom types", () => {
            validationContext.setCustomTypes([
                {
                    id: "nullable-type",
                    name: "nullable",
                    fields: [
                        { name: "optional", type: "string", required: false },
                        { name: "optional", type: "null", required: false },
                    ],
                },
            ]);

            const schema = createSchema([field("data", "nullable", { required: true })]);

            expect(validateFrontmatter(
                { data: { optional: "hello" } },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);

            expect(validateFrontmatter(
                { data: { optional: null } },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);
        });
    });

    describe("array element types", () => {
        it("validates array elements against element type", () => {
            const schema = createSchema([
                field("numbers", "array", { required: true, arrayElementType: "number" }),
            ]);

            expect(validateFrontmatter({ numbers: [1, 2, 3] }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            const violations = validateFrontmatter({ numbers: [1, "two", 3] }, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].field).toContain("[1]");
        });

        it("validates array of custom types", () => {
            validationContext.setCustomTypes([
                {
                    id: "tag-type",
                    name: "tag",
                    fields: [{ name: "label", type: "string", required: true }],
                },
            ]);

            const schema = createSchema([
                field("tags", "array", { required: true, arrayElementType: "tag" }),
            ]);

            expect(validateFrontmatter(
                { tags: [{ label: "a" }, { label: "b" }] },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);

            const violations = validateFrontmatter(
                { tags: [{ label: "a" }, { wrong: "b" }] },
                schema, "test.md", { checkUnknownFields: false }
            );
            expect(violations.length).toBeGreaterThan(0);
        });
    });

    describe("constraints", () => {
        it("validates string minLength", () => {
            const schema = createSchema([
                field("title", "string", {
                    required: true,
                    stringConstraints: { minLength: 5 },
                }),
            ]);

            expect(validateFrontmatter({ title: "Hello World" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            const violations = validateFrontmatter({ title: "Hi" }, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("string_too_short");
        });

        it("validates string maxLength", () => {
            const schema = createSchema([
                field("code", "string", {
                    required: true,
                    stringConstraints: { maxLength: 3 },
                }),
            ]);

            expect(validateFrontmatter({ code: "ABC" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            const violations = validateFrontmatter({ code: "ABCD" }, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("string_too_long");
        });

        it("validates string pattern", () => {
            const schema = createSchema([
                field("email", "string", {
                    required: true,
                    stringConstraints: { pattern: "^[^@]+@[^@]+$" },
                }),
            ]);

            expect(validateFrontmatter({ email: "test@example.com" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            const violations = validateFrontmatter({ email: "invalid" }, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("pattern_mismatch");
        });

        it("validates number min", () => {
            const schema = createSchema([
                field("age", "number", {
                    required: true,
                    numberConstraints: { min: 0 },
                }),
            ]);

            expect(validateFrontmatter({ age: 25 }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            const violations = validateFrontmatter({ age: -1 }, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("number_too_small");
        });

        it("validates number max", () => {
            const schema = createSchema([
                field("rating", "number", {
                    required: true,
                    numberConstraints: { max: 5 },
                }),
            ]);

            expect(validateFrontmatter({ rating: 4 }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            const violations = validateFrontmatter({ rating: 6 }, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("number_too_large");
        });

        it("validates array minItems", () => {
            const schema = createSchema([
                field("tags", "array", {
                    required: true,
                    arrayConstraints: { minItems: 2 },
                }),
            ]);

            expect(validateFrontmatter({ tags: ["a", "b"] }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            const violations = validateFrontmatter({ tags: ["a"] }, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("array_too_few");
        });

        it("validates array maxItems", () => {
            const schema = createSchema([
                field("tags", "array", {
                    required: true,
                    arrayConstraints: { maxItems: 3 },
                }),
            ]);

            expect(validateFrontmatter({ tags: ["a", "b", "c"] }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            const violations = validateFrontmatter({ tags: ["a", "b", "c", "d"] }, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("array_too_many");
        });

        it("validates array contains", () => {
            const schema = createSchema([
                field("tags", "array", {
                    required: true,
                    arrayConstraints: { contains: ["important"] },
                }),
            ]);

            expect(validateFrontmatter({ tags: ["important", "other"] }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            const violations = validateFrontmatter({ tags: ["other"] }, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("array_missing_value");
        });

        it("validates date min constraint", () => {
            const schema = createSchema([
                field("published", "date", {
                    required: true,
                    dateConstraints: { min: "2024-01-01" },
                }),
            ]);

            expect(validateFrontmatter({ published: "2024-06-15" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            const violations = validateFrontmatter({ published: "2023-12-31" }, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("date_too_early");
        });

        it("validates date max constraint", () => {
            const schema = createSchema([
                field("deadline", "date", {
                    required: true,
                    dateConstraints: { max: "2024-12-31" },
                }),
            ]);

            expect(validateFrontmatter({ deadline: "2024-06-15" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            const violations = validateFrontmatter({ deadline: "2025-01-01" }, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("date_too_late");
        });

        it("validates date min and max constraints together", () => {
            const schema = createSchema([
                field("event", "date", {
                    required: true,
                    dateConstraints: { min: "2024-01-01", max: "2024-12-31" },
                }),
            ]);

            // Within range
            expect(validateFrontmatter({ event: "2024-06-15" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            // Before min
            expect(validateFrontmatter({ event: "2023-06-15" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);

            // After max
            expect(validateFrontmatter({ event: "2025-06-15" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
        });
    });

    describe("unknown fields", () => {
        it("reports unknown fields when enabled", () => {
            const schema = createSchema([field("title", "string")]);

            const violations = validateFrontmatter(
                { title: "Hello", unknown: "field" },
                schema, "test.md", { checkUnknownFields: true }
            );
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("unknown_field");
            expect(violations[0].field).toBe("unknown");
        });

        it("ignores unknown fields when disabled", () => {
            const schema = createSchema([field("title", "string")]);

            expect(validateFrontmatter(
                { title: "Hello", unknown: "field" },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);
        });

        it("reports unknown fields in custom types", () => {
            validationContext.setCustomTypes([
                {
                    id: "person-type",
                    name: "person",
                    fields: [{ name: "name", type: "string", required: true }],
                },
            ]);

            const schema = createSchema([field("author", "person", { required: true })]);

            // Unknown fields in custom types are always reported
            const violations = validateFrontmatter(
                { author: { name: "Alice", unknown: "field" } },
                schema, "test.md", { checkUnknownFields: false }
            );
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("unknown_field");
        });
    });

    describe("case insensitivity", () => {
        it("matches field names case-insensitively", () => {
            const schema = createSchema([field("Title", "string", { required: true })]);

            expect(validateFrontmatter({ title: "Hello" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ TITLE: "Hello" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });
    });

    describe("cross-field constraints", () => {
        it("validates endDate greater than startDate", () => {
            const schema = createSchema([
                field("startDate", "date", { required: true }),
                field("endDate", "date", {
                    required: true,
                    crossFieldConstraint: { operator: "greater_than", field: "startDate" },
                }),
            ]);

            // endDate > startDate - valid
            expect(validateFrontmatter(
                { startDate: "2024-01-01", endDate: "2024-12-31" },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);

            // endDate < startDate - invalid
            const violations = validateFrontmatter(
                { startDate: "2024-12-31", endDate: "2024-01-01" },
                schema, "test.md", { checkUnknownFields: false }
            );
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("cross_field_violation");
        });

        it("validates number greater_or_equal constraint", () => {
            const schema = createSchema([
                field("minValue", "number", { required: true }),
                field("maxValue", "number", {
                    required: true,
                    crossFieldConstraint: { operator: "greater_or_equal", field: "minValue" },
                }),
            ]);

            // maxValue >= minValue - valid
            expect(validateFrontmatter(
                { minValue: 10, maxValue: 20 },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);

            // Equal values - valid
            expect(validateFrontmatter(
                { minValue: 10, maxValue: 10 },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);

            // maxValue < minValue - invalid
            const violations = validateFrontmatter(
                { minValue: 20, maxValue: 10 },
                schema, "test.md", { checkUnknownFields: false }
            );
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("cross_field_violation");
        });

        it("validates string equals constraint", () => {
            const schema = createSchema([
                field("password", "string", { required: true }),
                field("confirmPassword", "string", {
                    required: true,
                    crossFieldConstraint: { operator: "equals", field: "password" },
                }),
            ]);

            // Matching passwords - valid
            expect(validateFrontmatter(
                { password: "secret123", confirmPassword: "secret123" },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);

            // Non-matching - invalid
            const violations = validateFrontmatter(
                { password: "secret123", confirmPassword: "different" },
                schema, "test.md", { checkUnknownFields: false }
            );
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("cross_field_violation");
        });

        it("validates not_equals constraint", () => {
            const schema = createSchema([
                field("oldValue", "string", { required: true }),
                field("newValue", "string", {
                    required: true,
                    crossFieldConstraint: { operator: "not_equals", field: "oldValue" },
                }),
            ]);

            // Different values - valid
            expect(validateFrontmatter(
                { oldValue: "abc", newValue: "xyz" },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);

            // Same values - invalid
            const violations = validateFrontmatter(
                { oldValue: "abc", newValue: "abc" },
                schema, "test.md", { checkUnknownFields: false }
            );
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("cross_field_violation");
        });

        it("skips validation when other field is missing", () => {
            const schema = createSchema([
                field("startDate", "date"),
                field("endDate", "date", {
                    required: true,
                    crossFieldConstraint: { operator: "greater_than", field: "startDate" },
                }),
            ]);

            // startDate missing - should not trigger cross-field violation
            expect(validateFrontmatter(
                { endDate: "2024-01-01" },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);
        });

        it("validates less_than constraint", () => {
            const schema = createSchema([
                field("max", "number", { required: true }),
                field("current", "number", {
                    required: true,
                    crossFieldConstraint: { operator: "less_than", field: "max" },
                }),
            ]);

            // current < max - valid
            expect(validateFrontmatter(
                { max: 100, current: 50 },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);

            // current >= max - invalid
            const violations = validateFrontmatter(
                { max: 100, current: 100 },
                schema, "test.md", { checkUnknownFields: false }
            );
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("cross_field_violation");
        });

        it("handles case-insensitive field reference", () => {
            const schema = createSchema([
                field("StartDate", "date", { required: true }),
                field("endDate", "date", {
                    required: true,
                    crossFieldConstraint: { operator: "greater_than", field: "startdate" }, // lowercase reference
                }),
            ]);

            // Should still find the field case-insensitively
            expect(validateFrontmatter(
                { StartDate: "2024-01-01", endDate: "2024-12-31" },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);
        });
    });

    describe("edge cases", () => {
        it('"true" string is not boolean', () => {
            const schema = createSchema([field("flag", "boolean", { required: true })]);

            expect(validateFrontmatter({ flag: true }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ flag: "true" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
        });

        it('"true" string matches string type', () => {
            const schema = createSchema([field("value", "string", { required: true })]);

            expect(validateFrontmatter({ value: "true" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ value: "false" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });

        it('"123" string is not number', () => {
            const schema = createSchema([field("count", "number", { required: true })]);

            expect(validateFrontmatter({ count: 123 }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ count: "123" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
        });

        it("0 is number, not falsy", () => {
            const schema = createSchema([field("count", "number", { required: true })]);

            expect(validateFrontmatter({ count: 0 }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });

        it("empty string is valid string", () => {
            const schema = createSchema([field("title", "string", { required: true })]);

            expect(validateFrontmatter({ title: "" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });

        it("empty string is not null", () => {
            const schema = createSchema([field("value", "null", { required: true })]);

            expect(validateFrontmatter({ value: "" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
        });

        it("empty array is valid array", () => {
            const schema = createSchema([field("tags", "array", { required: true })]);

            expect(validateFrontmatter({ tags: [] }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });

        it("empty object is valid object", () => {
            const schema = createSchema([field("meta", "object", { required: true })]);

            expect(validateFrontmatter({ meta: {} }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });

        it("null is not undefined (missing field)", () => {
            const schema = createSchema([
                field("value", "null"),
                field("value", "string"),
            ]);

            // null matches null type
            expect(validateFrontmatter({ value: null }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            // missing field is different from null field
            const schemaRequired = createSchema([field("value", "null", { required: true })]);
            expect(validateFrontmatter({}, schemaRequired, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1); // missing_required, not a null value
        });

        it("whitespace-only string is valid string", () => {
            const schema = createSchema([field("title", "string", { required: true })]);

            expect(validateFrontmatter({ title: "   " }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });

        it("unicode strings are valid", () => {
            const schema = createSchema([field("title", "string", { required: true })]);

            expect(validateFrontmatter({ title: "Hello" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ title: "Привет мир" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });

        it("negative numbers are valid numbers", () => {
            const schema = createSchema([field("temp", "number", { required: true })]);

            expect(validateFrontmatter({ temp: -40 }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });

        it("float numbers are valid numbers", () => {
            const schema = createSchema([field("price", "number", { required: true })]);

            expect(validateFrontmatter({ price: 19.99 }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });

        it("NaN is technically a number (typeof NaN === 'number')", () => {
            const schema = createSchema([field("value", "number", { required: true })]);

            // Note: NaN passes because typeof NaN === "number" in JavaScript
            // This is documented behavior - YAML/frontmatter rarely produces NaN anyway
            expect(validateFrontmatter({ value: NaN }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });

        it("Infinity is a valid number", () => {
            const schema = createSchema([field("value", "number", { required: true })]);

            expect(validateFrontmatter({ value: Infinity }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });

        it("array with null elements", () => {
            const schema = createSchema([
                field("items", "array", { required: true, arrayElementType: "null" }),
            ]);

            expect(validateFrontmatter({ items: [null, null] }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });

        it("array with mixed types fails if element type specified", () => {
            const schema = createSchema([
                field("items", "array", { required: true, arrayElementType: "string" }),
            ]);

            const violations = validateFrontmatter({ items: ["a", 1, "b"] }, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].field).toContain("[1]");
        });

        it("deeply nested custom types", () => {
            validationContext.setCustomTypes([
                {
                    id: "inner",
                    name: "inner",
                    fields: [{ name: "value", type: "string", required: true }],
                },
                {
                    id: "outer",
                    name: "outer",
                    fields: [{ name: "nested", type: "inner", required: true }],
                },
            ]);

            const schema = createSchema([field("data", "outer", { required: true })]);

            expect(validateFrontmatter(
                { data: { nested: { value: "hello" } } },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);

            const violations = validateFrontmatter(
                { data: { nested: { value: 123 } } }, // wrong type deep inside
                schema, "test.md", { checkUnknownFields: false }
            );
            expect(violations.length).toBeGreaterThan(0);
        });

        it("date must be ISO format YYYY-MM-DD", () => {
            const schema = createSchema([field("created", "date", { required: true })]);

            // Valid ISO dates
            expect(validateFrontmatter({ created: "2024-01-15" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ created: "2024-12-31" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            // Invalid formats
            expect(validateFrontmatter({ created: "01-15-2024" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
            expect(validateFrontmatter({ created: "2024/01/15" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
            expect(validateFrontmatter({ created: "Jan 15, 2024" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
        });

        it("constraint on matching union variant is applied", () => {
            const schema = createSchema([
                field("value", "string", { stringConstraints: { minLength: 5 } }),
                field("value", "number"),
            ]);

            // String must meet constraint
            expect(validateFrontmatter({ value: "hello" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ value: "hi" }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);

            // Number has no constraint
            expect(validateFrontmatter({ value: 1 }, schema, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
        });
    });

    describe("field conditions", () => {
        it("validates field only when condition is met", () => {
            const schema = createSchema([
                field("type", "string", { required: true }),
                field("url", "string", {
                    required: true,
                    conditions: [{ field: "type", operator: "equals", value: "link" }],
                }),
            ]);

            // When type is "link", url is required
            expect(validateFrontmatter(
                { type: "link", url: "https://example.com" },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);

            expect(validateFrontmatter(
                { type: "link" }, // missing url
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(1);

            // When type is NOT "link", url is not required
            expect(validateFrontmatter(
                { type: "note" }, // no url needed
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);
        });

        it("supports multiple conditions (AND logic)", () => {
            const schema = createSchema([
                field("type", "string", { required: true }),
                field("status", "string", { required: true }),
                field("deadline", "date", {
                    required: true,
                    conditions: [
                        { field: "type", operator: "equals", value: "task" },
                        { field: "status", operator: "not_equals", value: "done" },
                    ],
                }),
            ]);

            // Both conditions met - deadline required
            expect(validateFrontmatter(
                { type: "task", status: "pending" }, // missing deadline
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(1);

            // Only one condition met - deadline not required
            expect(validateFrontmatter(
                { type: "task", status: "done" }, // done tasks don't need deadline
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);

            expect(validateFrontmatter(
                { type: "note", status: "pending" }, // not a task
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);
        });

        it("supports contains operator for arrays", () => {
            const schema = createSchema([
                field("tags", "array", { required: true }),
                field("isbn", "string", {
                    required: true,
                    conditions: [{ field: "tags", operator: "contains", value: "book" }],
                }),
            ]);

            // Has "book" tag - isbn required
            expect(validateFrontmatter(
                { tags: ["book", "fiction"] }, // missing isbn
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(1);

            // No "book" tag - isbn not required
            expect(validateFrontmatter(
                { tags: ["article"] },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);
        });

        it("supports numeric comparison operators", () => {
            const schema = createSchema([
                field("priority", "number", { required: true }),
                field("assignee", "string", {
                    required: true,
                    conditions: [{ field: "priority", operator: "greater_than", value: "5" }],
                }),
            ]);

            // High priority - assignee required
            expect(validateFrontmatter(
                { priority: 8 }, // missing assignee
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(1);

            // Low priority - assignee not required
            expect(validateFrontmatter(
                { priority: 3 },
                schema, "test.md", { checkUnknownFields: false }
            )).toHaveLength(0);
        });
    });

    describe("undefined and empty frontmatter", () => {
        it("handles undefined frontmatter", () => {
            const schema = createSchema([field("title", "string", { required: true })]);

            const violations = validateFrontmatter(undefined, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("missing_required");
        });

        it("handles empty object frontmatter", () => {
            const schema = createSchema([field("title", "string", { required: true })]);

            const violations = validateFrontmatter({}, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("missing_required");
        });
    });

    describe("violation messages", () => {
        it("includes field path in nested violations", () => {
            validationContext.setCustomTypes([
                {
                    id: "address",
                    name: "address",
                    fields: [
                        { name: "city", type: "string", required: true },
                        { name: "zip", type: "number", required: true },
                    ],
                },
            ]);

            const schema = createSchema([field("location", "address", { required: true })]);

            const violations = validateFrontmatter(
                { location: { city: "NYC", zip: "not-a-number" } },
                schema, "test.md", { checkUnknownFields: false }
            );

            expect(violations.length).toBeGreaterThan(0);
            expect(violations[0].field).toContain("location");
        });

        it("includes array index in element violations", () => {
            const schema = createSchema([
                field("scores", "array", { required: true, arrayElementType: "number" }),
            ]);

            const violations = validateFrontmatter(
                { scores: [10, 20, "thirty", 40] },
                schema, "test.md", { checkUnknownFields: false }
            );

            expect(violations).toHaveLength(1);
            expect(violations[0].field).toBe("scores[2]");
        });
    });

    describe("multiple violations", () => {
        it("reports all violations, not just first", () => {
            const schema = createSchema([
                field("title", "string", { required: true }),
                field("count", "number", { required: true }),
                field("active", "boolean", { required: true }),
            ]);

            const violations = validateFrontmatter({}, schema, "test.md", { checkUnknownFields: false });
            expect(violations).toHaveLength(3);
        });

        it("reports multiple constraint violations", () => {
            const schema = createSchema([
                field("code", "string", {
                    required: true,
                    stringConstraints: { minLength: 5, pattern: "^[A-Z]+$" },
                }),
            ]);

            // Too short AND wrong pattern
            const violations = validateFrontmatter(
                { code: "ab" },
                schema, "test.md", { checkUnknownFields: false }
            );
            expect(violations).toHaveLength(2);
        });
    });

    describe("nested custom types", () => {
        beforeEach(() => {
            validationContext.setCustomTypes([
                {
                    id: "street",
                    name: "street",
                    fields: [
                        { name: "name", type: "string", required: true },
                        { name: "number", type: "number", required: true },
                    ],
                },
                {
                    id: "address",
                    name: "address",
                    fields: [
                        { name: "street", type: "street", required: true },
                        { name: "city", type: "string", required: true },
                        { name: "zip", type: "string", required: false },
                    ],
                },
                {
                    id: "person",
                    name: "person",
                    fields: [
                        { name: "name", type: "string", required: true },
                        { name: "address", type: "address", required: false },
                    ],
                },
            ]);
        });

        it("validates 3 levels deep", () => {
            const schema = createSchema([field("author", "person", { required: true })]);

            // Valid 3-level nesting
            expect(validateFrontmatter({
                author: {
                    name: "Alice",
                    address: {
                        city: "NYC",
                        street: { name: "Broadway", number: 123 },
                    },
                },
            }, schema, "test.md", { checkUnknownFields: false })).toHaveLength(0);
        });

        it("reports error with nested type name in message", () => {
            const schema = createSchema([field("author", "person", { required: true })]);

            const violations = validateFrontmatter({
                author: {
                    name: "Alice",
                    address: {
                        city: "NYC",
                        street: { name: "Broadway", number: "not-a-number" },
                    },
                },
            }, schema, "test.md", { checkUnknownFields: false });

            expect(violations.length).toBeGreaterThan(0);
            // Error is at parent level, message shows which nested type failed
            expect(violations[0].field).toBe("author");
            expect(violations[0].message).toContain("address");
        });

        it("reports missing required field in nested type", () => {
            const schema = createSchema([field("author", "person", { required: true })]);

            const violations = validateFrontmatter({
                author: {
                    name: "Alice",
                    address: {
                        city: "NYC",
                        street: { name: "Broadway" }, // missing number
                    },
                },
            }, schema, "test.md", { checkUnknownFields: false });

            expect(violations.length).toBeGreaterThan(0);
        });

        it("reports unknown field in nested type", () => {
            const schema = createSchema([field("author", "person", { required: true })]);

            const violations = validateFrontmatter({
                author: {
                    name: "Alice",
                    address: {
                        city: "NYC",
                        street: { name: "Broadway", number: 123, unknown: "field" },
                    },
                },
            }, schema, "test.md", { checkUnknownFields: false });

            expect(violations).toHaveLength(1);
            expect(violations[0].type).toBe("unknown_field");
            expect(violations[0].field).toContain("unknown");
        });

        it("handles array of nested custom types", () => {
            const schema = createSchema([
                field("addresses", "array", { required: true, arrayElementType: "address" }),
            ]);

            // Valid array of addresses
            expect(validateFrontmatter({
                addresses: [
                    { city: "NYC", street: { name: "Broadway", number: 1 } },
                    { city: "LA", street: { name: "Sunset", number: 2 } },
                ],
            }, schema, "test.md", { checkUnknownFields: false })).toHaveLength(0);

            // Invalid element in array
            const violations = validateFrontmatter({
                addresses: [
                    { city: "NYC", street: { name: "Broadway", number: 1 } },
                    { city: "LA", street: { name: "Sunset", number: "bad" } },
                ],
            }, schema, "test.md", { checkUnknownFields: false });

            expect(violations.length).toBeGreaterThan(0);
            expect(violations[0].field).toContain("[1]");
        });

        it("validates optional nested types only when present", () => {
            const schema = createSchema([field("author", "person", { required: true })]);

            // address is optional, so this should pass
            expect(validateFrontmatter({
                author: { name: "Alice" },
            }, schema, "test.md", { checkUnknownFields: false })).toHaveLength(0);

            // But if address is present, it must be valid
            const violations = validateFrontmatter({
                author: {
                    name: "Alice",
                    address: { city: "NYC" }, // missing required street
                },
            }, schema, "test.md", { checkUnknownFields: false });

            expect(violations.length).toBeGreaterThan(0);
        });

        it("handles union types within nested custom types", () => {
            validationContext.setCustomTypes([
                {
                    id: "contact",
                    name: "contact",
                    fields: [
                        { name: "value", type: "string", required: true },
                        { name: "value", type: "number", required: true }, // phone can be string or number
                    ],
                },
                {
                    id: "profile",
                    name: "profile",
                    fields: [
                        { name: "name", type: "string", required: true },
                        { name: "contact", type: "contact", required: true },
                    ],
                },
            ]);

            const schema = createSchema([field("user", "profile", { required: true })]);

            // String value works
            expect(validateFrontmatter({
                user: { name: "Alice", contact: { value: "alice@example.com" } },
            }, schema, "test.md", { checkUnknownFields: false })).toHaveLength(0);

            // Number value works
            expect(validateFrontmatter({
                user: { name: "Alice", contact: { value: 5551234 } },
            }, schema, "test.md", { checkUnknownFields: false })).toHaveLength(0);

            // Boolean fails
            const violations = validateFrontmatter({
                user: { name: "Alice", contact: { value: true } },
            }, schema, "test.md", { checkUnknownFields: false });
            expect(violations.length).toBeGreaterThan(0);
        });
    });

    describe("consistency: schema vs custom type union handling", () => {
        it("behaves consistently for unions at schema level and custom type level", () => {
            // Schema-level union
            const schemaWithUnion = createSchema([
                field("value", "string"),
                field("value", "number"),
            ]);

            // Custom type with same union
            validationContext.setCustomTypes([
                {
                    id: "union-type",
                    name: "unionContainer",
                    fields: [
                        { name: "value", type: "string", required: false },
                        { name: "value", type: "number", required: false },
                    ],
                },
            ]);
            const schemaWithCustomType = createSchema([field("container", "unionContainer", { required: true })]);

            // String should work in both
            expect(validateFrontmatter({ value: "hello" }, schemaWithUnion, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ container: { value: "hello" } }, schemaWithCustomType, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            // Number should work in both
            expect(validateFrontmatter({ value: 42 }, schemaWithUnion, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);
            expect(validateFrontmatter({ container: { value: 42 } }, schemaWithCustomType, "test.md", { checkUnknownFields: false }))
                .toHaveLength(0);

            // Boolean should fail in both
            expect(validateFrontmatter({ value: true }, schemaWithUnion, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
            expect(validateFrontmatter({ container: { value: true } }, schemaWithCustomType, "test.md", { checkUnknownFields: false }))
                .toHaveLength(1);
        });
    });
});
