# Propsec Codebase Audit Report

**Date:** December 27, 2025
**Version:** 0.4.0
**Auditor:** Automated Code Audit

---

## Executive Summary

Propsec is an Obsidian plugin that provides schema enforcement for frontmatter properties. The codebase demonstrates **strong architecture and performance engineering** with sophisticated caching, batching, and indexing systems. However, there are notable gaps in **accessibility, responsive design, and test coverage**.

### Overall Grades

| Category | Grade | Score |
|----------|-------|-------|
| **Performance** | A | 92/100 |
| **Feature Completeness** | A- | 88/100 |
| **Code Quality** | A | 94/100 |
| **Accessibility** | D | 35/100 |
| **Responsive Design** | D | 40/100 |
| **Test Coverage** | C | 65/100 |
| **Documentation** | B | 78/100 |

---

## 1. Performance Audit

### 1.1 Caching Systems (Excellent)

The codebase implements three sophisticated caching mechanisms:

#### Validation Cache (`src/validation/cache.ts`)
- **Persistent disk-based cache** with schema/settings hashing
- **Smart invalidation**: Only revalidates files when their mtime changes
- **Hash function**: djb2 algorithm for O(1) cache key generation
- **Debounced saves**: 2000ms debounce prevents excessive disk I/O

```typescript
// Lines 42-48: Efficient hash function
function hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return hash >>> 0;
}
```

#### Query Index (`src/query/index.ts`)
- **Two-level index structure**: Tag-to-files and file-to-tags maps
- **O(1) lookups** via reverse index pattern
- **Persisted to disk** with 1000ms debounce
- **Efficient set operations**: Intersection, subtraction, union for query matching

#### Case-Insensitive Lookup (`src/utils/object.ts`)
- **O(n) preprocessing** once per frontmatter object
- **O(1) subsequent lookups** via lowercase key map
- Avoids O(n²) worst-case for case-insensitive matching

### 1.2 Batch Processing (Excellent)

#### Validator Batching (`src/validation/validator.ts`)
- **Batch size**: 50 files per batch
- **Cooperative yielding**: `setTimeout(0)` releases main thread
- Prevents UI freezing during large vault validation

```typescript
// Lines 11-15
const BATCH_SIZE = 50;
async function yieldToMain(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}
```

#### Store Notification Batching (`src/validation/store.ts`)
- **Batch depth tracking** for nested operations
- **Coalesced notifications** via `queueMicrotask()`
- Prevents redundant UI updates during bulk operations

### 1.3 UI Virtualization (Good)

#### Violations View (`src/ui/violationsView.ts`)
- **Incremental rendering**: 20 files initially, 20 more per scroll
- **IntersectionObserver**: Efficient scroll detection with 100px margin
- Prevents DOM bloat for large violation sets

```typescript
// Lines 10-11
const INITIAL_RENDER_COUNT = 20;
const LOAD_MORE_COUNT = 20;
```

### 1.4 Bundle Optimization (Good)

#### ESBuild Configuration (`esbuild.config.mjs`)
- **Tree shaking** enabled for production builds
- **Minification** in production mode
- **External dependencies** properly excluded (Obsidian internals)
- **SCSS compression** in production

### 1.5 Memory Management (Good)

Proper cleanup patterns implemented:
- `src/ui/violationsView.ts:76-82` - IntersectionObserver disconnect
- `src/ui/statusBar.ts:131-133` - Click listener removal
- `src/ui/fieldEditorModal.ts:644-646` - Scroll handler cleanup
- `src/main.ts:222-231` - Plugin unload with cache flush

### 1.6 Performance Issues Identified

| Issue | Location | Severity | Description |
|-------|----------|----------|-------------|
| No worker threads | Validation | Low | Large vault validation runs on main thread |
| No LRU eviction | Query index | Low | Index grows unbounded |
| Console.error only | Cache failures | Medium | Silent failures without user notification |

---

## 2. Feature Completeness Audit

### 2.1 Core Features (Complete)

#### Schema Definition System
- Query syntax: `Folder`, `Folder/*`, `#tag`, `Folder/* or #tag`
- Property filters: `modifiedAfter`, `modifiedBefore`, `createdAfter`, `createdBefore`
- Property conditions: `hasProperty`, `notHasProperty`, `propertyEquals`
- Enable/disable individual schemas

#### Type System
- **Primitives**: string, number, boolean, date, array, object, null, unknown
- **Custom Types**: Reusable nested type definitions
- **Union Types**: Multiple variants per field (e.g., `string | null`)

#### Field Properties
- `required` - Mandatory field presence
- `warn` - Soft requirement (warnings only)
- `unique` - Uniqueness constraint across files
- `conditions` - Conditional validation

#### Constraints
- **String**: pattern (regex), minLength, maxLength
- **Number**: min, max
- **Date**: min, max (ISO format YYYY-MM-DD)
- **Array**: minItems, maxItems, contains
- **Cross-field**: Compare field values against other fields

### 2.2 UI Components (11 Total - Complete)

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| StatusBarItem | `src/ui/statusBar.ts` | 133 | Complete |
| ViolationsView | `src/ui/violationsView.ts` | 413 | Complete |
| ViolationsModal | `src/ui/violationsModal.ts` | ~300 | Complete |
| SchemaEditorModal | `src/ui/schemaEditorModal.ts` | ~700 | Complete |
| AddSchemaModal | `src/ui/addSchemaModal.ts` | ~250 | Complete |
| FieldEditorModal | `src/ui/fieldEditorModal.ts` | ~700 | Complete |
| CustomTypeEditorModal | `src/ui/customTypeEditorModal.ts` | ~400 | Complete |
| SchemaPreviewModal | `src/ui/schemaPreviewModal.ts` | ~150 | Complete |
| TypePreviewModal | `src/ui/typePreviewModal.ts` | ~100 | Complete |
| ConfirmModal | `src/ui/confirmModal.ts` | ~50 | Complete |
| Draggable | `src/ui/draggable.ts` | ~100 | Complete |

### 2.3 Commands (6 Total - Complete)

1. `validate-all-notes` - Validate all notes
2. `rebuild-and-validate` - Rebuild index and validate all
3. `show-violations` - Show violations modal
4. `show-violations-sidebar` - Show violations sidebar
5. `validate-current-note` - Validate current note
6. Settings tab integration

### 2.4 Settings (23 Total - Complete)

All settings properly persisted and functional with UI controls.

### 2.5 TODO/Incomplete Items

| Location | Line | Issue | Priority |
|----------|------|-------|----------|
| `src/settings.ts` | 350, 483 | "Replace item instead of re-rendering everything" | Low |
| `src/types.ts` | 77 | `//TODO discrim union` - Discriminated union for required XOR warn | Medium |
| `src/validation/validate.ts` | 749 | "evaluateCondition is similar" - Code deduplication | Low |

**Only 4 TODOs found** - Indicates mature, production-ready codebase.

---

## 3. Accessibility Audit

### 3.1 Current State (Poor)

Only **2 explicit aria-labels** found across the entire UI:
- `src/ui/violationsView.ts:165` - Filter tab tooltips
- `src/ui/violationsModal.ts:68` - Tab tooltips

### 3.2 Missing Accessibility Features

| Feature | Status | Impact |
|---------|--------|--------|
| Keyboard navigation | Missing | Users can't navigate without mouse |
| Aria-live regions | Missing | Screen readers won't announce updates |
| Focus trap in modals | Missing | Focus escapes during modal interaction |
| Aria-describedby | Missing | No association between labels and descriptions |
| Skip links | Missing | Can't skip to main content |
| High contrast mode | Missing | Poor visibility in high contrast |

### 3.3 Recommendations

1. Add `role="dialog"` and `aria-modal="true"` to all modals
2. Implement keyboard navigation (Tab, Arrow keys, Escape)
3. Add `aria-live="polite"` to violation count updates
4. Link inputs to their help text with `aria-describedby`
5. Target **15+ aria-labels** minimum

---

## 4. Responsive Design Audit

### 4.1 Current State (Poor)

No CSS media queries found. Fixed minimum widths may cause issues on mobile:
- Modal min-width: 450-500px
- Schema editor: Fixed layout

### 4.2 Issues

| Issue | Impact |
|-------|--------|
| No media queries | Breaks on screens < 500px |
| Fixed min-widths | Horizontal scroll on mobile |
| No touch-friendly targets | Small buttons hard to tap |
| No mobile menu | Settings inaccessible on phone |

### 4.3 Recommendations

1. Add breakpoint at 768px for tablet
2. Add breakpoint at 480px for mobile
3. Increase touch targets to 44x44px minimum
4. Make modal widths responsive (90vw max)

---

## 5. Test Coverage Audit

### 5.1 Current State

| Metric | Value |
|--------|-------|
| Test files | 2 |
| Test cases | 145 |
| Lines tested | ~1,562 |
| Coverage estimate | 25% |

### 5.2 Well-Tested Areas

**Validation Logic** (`src/validation/validate.test.ts` - 1,364 lines, 102 tests)
- All primitive types
- Required/warned fields
- Union types
- Custom types (nested, arrays, unions)
- All constraint types
- Field conditions
- Cross-field constraints
- Unknown field detection

**Query Matching** (`src/query/matcher.test.ts` - 198 lines, 43 tests)
- Path matching (folders, wildcards, tags)
- OR/AND/NOT operators
- Tag hierarchy matching

### 5.3 Untested Areas (Critical Gaps)

| Area | Risk Level | Files |
|------|------------|-------|
| UI Components | High | All `src/ui/*.ts` |
| Cache Management | High | `src/validation/cache.ts` |
| Plugin Lifecycle | Medium | `src/main.ts` |
| File Event Handlers | Medium | `src/main.ts` |
| Template Extraction | Medium | `src/schema/extractor.ts` |
| Validator Class | Medium | `src/validation/validator.ts` |
| Integration Tests | High | None exist |

### 5.4 Recommendations

1. Add UI component tests using Obsidian testing helpers
2. Add cache persistence tests (load/save/invalidation)
3. Add integration tests for full validation flow
4. Target 80% coverage minimum

---

## 6. Code Quality Audit

### 6.1 Architecture (Excellent)

Clean separation of concerns:
```
src/
├── main.ts              # Plugin lifecycle
├── types.ts             # Type definitions
├── settings.ts          # Settings UI
├── query/               # Query matching system
├── validation/          # Validation engine
├── ui/                  # UI components
└── utils/               # Utility functions
```

### 6.2 Type Safety (Excellent)

- TypeScript strict mode enabled
- Comprehensive interface definitions
- Proper type guards for union types

### 6.3 Error Handling (Good)

- 22 try-catch blocks covering critical paths
- Validation errors converted to violations (not thrown)
- Silent failures with console.error (could be improved)

### 6.4 Code Smells

| Issue | Location | Severity |
|-------|----------|----------|
| Large files | `fieldEditorModal.ts` (700+ lines) | Low |
| Similar code | `evaluateCondition` patterns | Low |
| Magic numbers | Debounce timeouts hardcoded | Low |

---

## 7. Security Audit

### 7.1 Input Validation (Good)

- Regex patterns wrapped in try-catch
- User input sanitized before use in queries
- No SQL injection risks (no database)

### 7.2 No Security Issues Found

The plugin operates entirely within Obsidian's sandbox with no:
- Network requests
- External data fetching
- Command execution
- File system access outside vault

---

## 8. Recommendations Summary

### Critical (Do First)

1. **Increase test coverage** to 80%+ with UI and integration tests
2. **Add keyboard navigation** for accessibility compliance
3. **Add aria-labels** and screen reader support

### Important (Do Soon)

4. **Add responsive breakpoints** for mobile support
5. **Surface cache/index failures** to users via Notices
6. **Extract constants** for magic numbers (debounce timers)

### Nice to Have

7. **Add worker threads** for large vault validation
8. **Implement LRU cache eviction** for memory management
9. **Add JSDoc comments** to public APIs
10. **Deduplicate condition evaluation** code

---

## 9. Metrics Summary

| Metric | Value |
|--------|-------|
| Total TypeScript Files | 32 |
| Total Lines of Code | ~7,567 |
| Test Lines | ~1,562 |
| UI Components | 11 |
| Commands | 6 |
| Settings | 23 |
| TODO Comments | 4 |
| Try-Catch Blocks | 22 |
| Aria-Labels | 2 |
| Media Queries | 0 |

---

## Conclusion

Propsec is a **well-engineered, production-ready Obsidian plugin** with sophisticated performance optimizations and a comprehensive feature set. The main areas for improvement are:

1. **Accessibility** - Currently non-compliant with WCAG guidelines
2. **Responsive design** - Not usable on mobile devices
3. **Test coverage** - Only 25% covered, high-risk areas untested

The codebase demonstrates strong architectural decisions and clean code practices. With the recommended improvements, particularly in accessibility and testing, this would be an exemplary Obsidian plugin.

---

*End of Audit Report*
