import { describe, it, expect } from "vitest";
import { compile } from "@propsec/core";
import { DEFAULT_SETTINGS, readSettings } from "./data";

const LEGACY = {
    templatesFolder: "Templates",
    schemaMappings: [
        {
            id: "book",
            name: "Book",
            sourceTemplatePath: null,
            query: "Books/* or #book",
            enabled: true,
            propertyFilter: { notHasProperty: "draft" },
            fields: [
                { name: "rating", type: "number", required: false, numberConstraints: { max: 5 } },
                { name: "tags", type: "array", required: true, arrayConstraints: { containsPattern: ["^genre/"] } },
            ],
        },
    ],
    customTypes: [],
    warnOnUnknownFields: false,
    allowObsidianProperties: true,
    validateOnFileOpen: false,
    validateOnFileSave: true,
    showInStatusBar: true,
    colorStatusBarErrors: false,
    excludeWarningsFromCount: true,
    enablePropertySuggestions: true,
    globalExclusions: "#archived",
};

describe("readSettings", () => {
    it("converts settings saved before rules existed and keeps preferences", () => {
        const { settings, upgraded } = readSettings(LEGACY);
        expect(upgraded).toBe(true);
        expect(settings.version).toBe(2);
        expect(settings.schemas[0].where).toBe('(file.inFolder("Books") || file.hasTag("book")) && !has(draft)');
        expect(settings.schemas[0].fields.map(f => f.must)).toEqual(["it <= 5", 'it.exists(x, x.matches("^genre/"))']);
        expect(settings.exclude).toBe('file.hasTag("archived")');
        expect(settings.unknownFields).toBe(false);
        expect(settings.templatesFolder).toBe("Templates");
        expect(settings.validateOnFileOpen).toBe(false);
        expect(settings.colorStatusBarErrors).toBe(false);
        expect(settings).not.toHaveProperty("schemaMappings");
        expect(settings).not.toHaveProperty("validateOnFileSave");
        expect(compile(settings).problems).toEqual([]);
    });

    it("reads current settings as they are", () => {
        const { settings, upgraded } = readSettings({ ...DEFAULT_SETTINGS, templatesFolder: "T" });
        expect(upgraded).toBe(false);
        expect(settings.templatesFolder).toBe("T");
    });

    it("starts from defaults with no data", () => {
        expect(readSettings(null)).toEqual({ settings: DEFAULT_SETTINGS, upgraded: false });
    });
});
