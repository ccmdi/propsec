import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "node_modules/**",
      "main.js",
      "benchmarks/**",
      "lib/**",
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
    files: ["*.mjs", "vitest.config.ts"],
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
    },
  },
]);
