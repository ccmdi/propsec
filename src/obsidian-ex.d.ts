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

    type PropertyWidgetType =
        | 'aliases'
        | 'checkbox'
        | 'date'
        | 'datetime'
        | 'multitext'
        | 'number'
        | 'tags'
        | 'text'
        | string;
    interface MetadataTypeManager {
        properties: Record<string, { widget: PropertyWidgetType, name: string } | undefined>;
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