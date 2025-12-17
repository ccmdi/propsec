import "obsidian";

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
    interface App {
        internalPlugins: InternalPlugins;
        plugins: Plugins;
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