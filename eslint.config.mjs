import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "main.js",
      "src/benchmark.ts",
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
  ...tseslint.configs.recommended,

  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    }
  },
);