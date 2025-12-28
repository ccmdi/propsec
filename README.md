<p align="center">
  <img src="images/logo.jpg" alt="Propsec Logo">
</p>

# Propsec

Schema enforcement for Obsidian frontmatter. 

Define schemas based on templates or invariants in your vault, add custom reusable types, and more.

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

- `fileNamePattern`: Filter by file name (regex)
- `modifiedAfter` / `modifiedBefore`: Filter by modification date
- `createdAfter` / `createdBefore`: Filter by creation date
- `hasProperty` / `notHasProperty`: Filter by property existence
- `propertyEquals`: Filter by specific property values (property-operator-value list)

Files are matched to schemas in the order of the schemas.

## Field Types

**Primitives:** `string`, `number`, `boolean`, `date`, `array`, `object`, `null`, `unknown`

**Custom Types:** Define reusable types in settings. A custom type is a named group of fields. Use them when multiple schemas share the same structure or you need nested validation.

**Union Types:** Add multiple field entries with the same name but different types. For example, two entries for `status` with types `string` and `null` creates `string | null`.

Fields can be flagged to be **required** (key is required) xor **warn** (soft requirement). There is also a **unique** constraint that prevents duplicate values on that field.

Finally, there are **cross-field constraints** (compare this field's value to another field) and **conditional validation** (only validate this field when another field matches a condition).

## Constraints

Each field type supports optional constraints:

| Type | Constraints |
|------|-------------|
| string | `pattern` (regex), `minLength`, `maxLength` |
| number | `min`, `max` |
| array | `minItems`, `maxItems`, `contains` (required values) |
| date  | `min`, `max` |

## Installation

Copy to `.obsidian/plugins/` or install via BRAT.