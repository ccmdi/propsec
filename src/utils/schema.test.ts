import { describe, it, expect } from "vitest";
import { groupFieldsByName, clearFieldConstraints, formatTypeDisplay } from "./schema";
import { SchemaField } from "../types";

describe("utils/schema", () => {
    describe("groupFieldsByName", () => {
        it("groups fields by name", () => {
            const fields: SchemaField[] = [
                { name: "title", type: "string", required: true },
                { name: "count", type: "number", required: false },
                { name: "title", type: "null", required: false },
            ];

            const groups = groupFieldsByName(fields);

            expect(groups.size).toBe(2);
            expect(groups.get("title")).toHaveLength(2);
            expect(groups.get("count")).toHaveLength(1);
        });

        it("returns empty map for empty array", () => {
            const groups = groupFieldsByName([]);
            expect(groups.size).toBe(0);
        });

        it("preserves field order within groups", () => {
            const fields: SchemaField[] = [
                { name: "value", type: "string", required: true },
                { name: "value", type: "number", required: false },
                { name: "value", type: "null", required: false },
            ];

            const groups = groupFieldsByName(fields);
            const variants = groups.get("value")!;

            expect(variants[0].type).toBe("string");
            expect(variants[1].type).toBe("number");
            expect(variants[2].type).toBe("null");
        });
    });

    describe("clearFieldConstraints", () => {
        it("clears all constraint properties", () => {
            const field: SchemaField = {
                name: "test",
                type: "string",
                required: true,
                stringConstraints: { minLength: 5 },
                numberConstraints: { min: 0 },
                dateConstraints: { min: "2024-01-01" },
                arrayConstraints: { minItems: 1 },
                arrayElementType: "string",
                objectKeyType: "string",
                objectValueType: "number",
                crossFieldConstraint: { operator: "equals", field: "other" },
            };

            clearFieldConstraints(field);

            expect(field.stringConstraints).toBeUndefined();
            expect(field.numberConstraints).toBeUndefined();
            expect(field.dateConstraints).toBeUndefined();
            expect(field.arrayConstraints).toBeUndefined();
            expect(field.arrayElementType).toBeUndefined();
            expect(field.objectKeyType).toBeUndefined();
            expect(field.objectValueType).toBeUndefined();
            expect(field.crossFieldConstraint).toBeUndefined();
        });

        it("preserves non-constraint properties", () => {
            const field: SchemaField = {
                name: "test",
                type: "string",
                required: true,
                warn: true,
                unique: true,
            };

            clearFieldConstraints(field);

            expect(field.name).toBe("test");
            expect(field.type).toBe("string");
            expect(field.required).toBe(true);
            expect(field.warn).toBe(true);
            expect(field.unique).toBe(true);
        });
    });

    describe("formatTypeDisplay", () => {
        it("returns primitive type as-is", () => {
            expect(formatTypeDisplay({ name: "x", type: "string", required: false })).toBe("string");
            expect(formatTypeDisplay({ name: "x", type: "number", required: false })).toBe("number");
            expect(formatTypeDisplay({ name: "x", type: "date", required: false })).toBe("date");
        });

        it("formats array with element type", () => {
            const field: SchemaField = {
                name: "tags",
                type: "array",
                required: false,
                arrayElementType: "string",
            };
            expect(formatTypeDisplay(field)).toBe("string[]");
        });

        it("formats array with custom element type", () => {
            const field: SchemaField = {
                name: "people",
                type: "array",
                required: false,
                arrayElementType: "person",
            };
            expect(formatTypeDisplay(field)).toBe("person[]");
        });

        it("returns 'array' for array without element type", () => {
            const field: SchemaField = {
                name: "items",
                type: "array",
                required: false,
            };
            expect(formatTypeDisplay(field)).toBe("array");
        });

        it("formats object with key and value types", () => {
            const field: SchemaField = {
                name: "metadata",
                type: "object",
                required: false,
                objectKeyType: "string",
                objectValueType: "number",
            };
            expect(formatTypeDisplay(field)).toBe("{ string: number }");
        });

        it("defaults object key type to string", () => {
            const field: SchemaField = {
                name: "data",
                type: "object",
                required: false,
                objectValueType: "boolean",
            };
            expect(formatTypeDisplay(field)).toBe("{ string: boolean }");
        });

        it("returns 'object' for object without value type", () => {
            const field: SchemaField = {
                name: "meta",
                type: "object",
                required: false,
            };
            expect(formatTypeDisplay(field)).toBe("object");
        });

        it("returns custom type name as-is", () => {
            expect(formatTypeDisplay({ name: "x", type: "person", required: false })).toBe("person");
            expect(formatTypeDisplay({ name: "x", type: "address", required: false })).toBe("address");
        });
    });
});
