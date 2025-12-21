import "obsidian";

// Build-time constant injected by esbuild
declare const __DEV__: boolean;

declare module "obsidian" {

    interface TemplatesPlugin extends Plugin {
        enabled: boolean;
        instance: {
            options: {
                folder: string;
            }
        }
    }
    interface InternalPlugins {
        plugins: {
            templates: TemplatesPlugin;
        };
    }

    // Obsidian's metadata type system
    // Widget types: "text", "number", "checkbox", "date", "datetime", "tags", "aliases", "multitext"
    interface MetadataTypeManager {
        properties: Record<string, { widget: string, name: string } | undefined>;
    }

    interface App {
        internalPlugins: InternalPlugins;
        plugins: Plugins;
        metadataTypeManager: MetadataTypeManager;
    }

    interface TemplaterPlugin extends Plugin {
        settings: {
            templates_folder: string;
        }
    }
    interface Plugins {
        plugins: {
            "templater-obsidian": TemplaterPlugin;
        };
    }
}