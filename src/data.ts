import { readConfig, OBSIDIAN_NATIVE_PROPERTIES, type Config } from "@propsec/core";

export interface PropsecSettings extends Config {
    version: 2;
    templatesFolder: string;
    validateOnFileOpen: boolean;
    showInStatusBar: boolean;
    colorStatusBarErrors: boolean;
    excludeWarningsFromCount: boolean;  // Don't count warnings in status bar violation count
    enablePropertySuggestions: boolean;  // Show property autocomplete in schema editor
    rulesInWords: boolean;
    compactStatusBar: boolean;
}

export const DEFAULT_SETTINGS: PropsecSettings = {
    version: 2,
    templatesFolder: "",
    schemas: [],
    types: [],
    unknownFields: true,
    openFields: [...OBSIDIAN_NATIVE_PROPERTIES],
    validateOnFileOpen: true,
    showInStatusBar: true,
    colorStatusBarErrors: true,
    excludeWarningsFromCount: true,
    enablePropertySuggestions: true,
    rulesInWords: true,
    compactStatusBar: true,
};

const HOST_PREFERENCES = [
    "templatesFolder",
    "validateOnFileOpen",
    "showInStatusBar",
    "colorStatusBarErrors",
    "excludeWarningsFromCount",
    "enablePropertySuggestions",
] as const;

/**
 * Settings from stored plugin data. Data saved before rules existed
 * (it has `schemaMappings`) is converted, and `upgraded` says so.
 */
export function readSettings(data: unknown): { settings: PropsecSettings; upgraded: boolean } {
    const stored = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    if (!Array.isArray(stored.schemaMappings)) {
        return { settings: { ...DEFAULT_SETTINGS, ...(stored as Partial<PropsecSettings>), version: 2 }, upgraded: false };
    }

    const settings: PropsecSettings = { ...DEFAULT_SETTINGS, ...readConfig(stored), version: 2 };
    for (const key of HOST_PREFERENCES) {
        if (typeof stored[key] === typeof DEFAULT_SETTINGS[key]) (settings as unknown as Record<string, unknown>)[key] = stored[key];
    }
    return { settings, upgraded: true };
}
