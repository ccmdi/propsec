import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "node_modules/**",
      "main.js",
      "benchmarks/**",
      ".claude/**",
    ],
  },

  {
    files: ["*.config.mjs", "*.config.js", "*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
  },

  ...obsidianmd.configs.recommended,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ["*.mjs"],
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
    },
  },
]);
