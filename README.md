# Frontmatter Linter

A type system for Obsidian frontmatter. Define schemas, associate them with folders or tags, and get instant feedback when notes violate their expected structure.

## What it does

Obsidian properties are freeform. Over time, inconsistencies creep in: typos in field names, wrong types, missing required fields. This plugin lets you define schemas and validates notes against them automatically. No modifications to your notes, just validation.

## Usage

1. Open plugin settings
2. Click "Add Schema Mapping"
3. Either import fields from an existing template file or start from scratch
4. Define your fields: name, type (string/number/boolean/date/array/object), and whether it's required
5. Set a query to target files: `Journal/Gym/*` for recursive folder matching, `Journal/Gym` for direct only, `#book` for tags, or combine them with `or`
6. Violations show in the status bar (click to see details) or use the sidebar view

## Query syntax

- `folder` - files directly in that folder
- `folder/*` - files in folder and all subfolders
- `#tag` - files with that tag
- `folder/* or #tag` - union (match either condition)

## Validation

The plugin checks:
- **Missing required fields** - fields marked as required that don't exist in the note
- **Type mismatches** - when a value doesn't match the expected type
- **Unknown fields** - fields in the note that aren't defined in the schema (optional warning)

For string, number, array, and object fields, you can also set constraints (min/max length, min/max value, required keys, etc.).

## Commands

- **Validate All Notes** - run validation across all mapped folders
- **Validate Current Note** - validate just the active note
- **Show Violations (Modal)** - open a modal with all current violations
- **Show Violations (Sidebar)** - open the violations panel in the right sidebar

## Installation

Copy the plugin folder to your vault's `.obsidian/plugins/` directory, or install via BRAT.

## Development

```bash
npm install
npm run dev
```
