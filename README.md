# Propsec

A type system for Obsidian to define schemas for your frontmatter.

## Why

Obsidian properties are freeform. Over time, things can break: you change the structure, use an old field, etc. This plugin validates notes against schemas you define. Your notes are untouched, but your vault's consistency becomes easier to manage.

## Setup

1. Open plugin settings
2. Create a schema: click **+ Add Schema**
3. Set a query to target files
4. Add fields: name, type, required/optional
5. Violations appear in the status bar/sidebar

## Schema definition
The query field allows schema matching based on file paths and/or tags:

| Query | Matches |
|-------|---------|
| `Journal` | Files directly in Journal folder |
| `Journal/*` | Files in Journal and all subfolders |
| `#book` | Files with #book tag |
| `Projects/* or #active` | Files matching either condition |

You can also narrow which files a schema applies to with properties:

- `modifiedAfter` / `modifiedBefore`: Filter by modification date
- `createdAfter` / `createdBefore`: Filter by creation date
- `hasProperty` / `notHasProperty`: Filter by property existence
- `propertyEquals`: Filter by specific property values (property-operator-value list)

Files are matched to schemas in the order of the schemas.

## Field Types

**Primitives:** `string`, `number`, `boolean`, `date`, `array`, `object`, `null`, `unknown`

**Custom Types:** Define reusable types in settings. A custom type is a named group of fields. Use them when multiple schemas share the same structure or you need nested validation.[^1]

**Union Types:** Add multiple field entries with the same name but different types. For example, two entries for `status` with types `string` and `null` creates `string | null`.

## Constraints

Each field type supports optional constraints:

| Type | Constraints |
|------|-------------|
| string | `pattern` (regex), `minLength`, `maxLength` |
| number | `min`, `max` |
| array | `minItems`, `maxItems`, `contains` (required values) |

## Field Options

- **Required**: Error if field is missing (key must be present)
- **Warn**: Warning if field is missing (softer than required)

## Validation

The plugin checks for:

- Missing required/warned fields
- Type mismatches
- Constraint violations (length, range, pattern, etc.)
- Unknown fields (fields not in schema) - optional, enabled by default

## Installation

Copy to `.obsidian/plugins/` or install via BRAT.

[^1]: When defining order for custom types, it is purely visual.