/**
 * Benchmark script for propsec-sql validation/query layer
 * Run with: npx tsx src/benchmark.ts
 */

import { validateFrontmatter } from "./validation/validate";
import { validationContext } from "./validation/context";
import { ViolationStore } from "./validation/store";
import { parseQuerySegments, fileMatchesQuery, fileMatchesPropertyFilter } from "./query/matcher";
import { SchemaMapping, SchemaField, CustomType, Violation } from "./types";
import { App, TFile, Vault, MetadataCache } from "obsidian";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

// ============ GC Helper ============

function forceGC(): void {
    if (global.gc) {
        global.gc();
    }
}

// ============ Output Capture ============

const outputLines: string[] = [];

function log(message: string = ""): void {
    console.log(message);
    outputLines.push(message);
}

// ============ Git Info ============

function runGitCommand(cmd: string): string | null {
    try {
        return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    } catch {
        return null;
    }
}

function getGitInfo(): { commit: string; tag: string; branch: string } {
    const commit = runGitCommand("git rev-parse --short HEAD") ?? "unknown";
    const branch = runGitCommand("git rev-parse --abbrev-ref HEAD") ?? "unknown";
    let tag = runGitCommand("git describe --tags --exact-match");
    if (!tag) {
        tag = runGitCommand("git describe --tags --abbrev=0");
        tag = tag ? tag + "+" : "(no tags)";
    }
    return { commit, tag, branch };
}

// ============ Benchmark Utilities ============

interface BenchmarkResult {
    name: string;
    iterations: number;
    totalMs: number;
    avgMs: number;
    opsPerSec: number;
    minMs: number;
    maxMs: number;
}

function benchmark(name: string, fn: () => void, iterations: number = 1000): BenchmarkResult {
    // Warmup
    for (let i = 0; i < Math.min(100, iterations / 10); i++) {
        fn();
    }

    const times: number[] = [];
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
        const iterStart = performance.now();
        fn();
        times.push(performance.now() - iterStart);
    }

    const totalMs = performance.now() - start;
    const avgMs = totalMs / iterations;

    return {
        name,
        iterations,
        totalMs,
        avgMs,
        opsPerSec: Math.round(1000 / avgMs),
        minMs: Math.min(...times),
        maxMs: Math.max(...times),
    };
}

function formatResult(result: BenchmarkResult): string {
    return `${result.name.padEnd(55)} ${result.avgMs.toFixed(4).padStart(10)} ms/op  ${result.opsPerSec.toLocaleString().padStart(10)} ops/sec  (${result.iterations} iters)`;
}

function section(title: string): void {
    log("\n" + "=".repeat(90));
    log(` ${title}`);
    log("=".repeat(90));
}

// ============ Mock Factories ============

function createMockSchema(fieldCount: number, options: { 
    withConstraints?: boolean;
    withConditions?: boolean;
    withCrossField?: boolean;
} = {}): SchemaMapping {
    const fields: SchemaField[] = [];

    for (let i = 0; i < fieldCount; i++) {
        const field: SchemaField = {
            name: `field${i}`,
            type: i % 4 === 0 ? "string" : i % 4 === 1 ? "number" : i % 4 === 2 ? "boolean" : "date",
            required: i % 3 === 0,
            warn: i % 3 === 1,
        };

        if (options.withConstraints) {
            if (field.type === "string") {
                field.stringConstraints = { minLength: 1, maxLength: 100, pattern: "^[a-zA-Z]+" };
            } else if (field.type === "number") {
                field.numberConstraints = { min: 0, max: 1000 };
            } else if (field.type === "date") {
                field.dateConstraints = { min: "2020-01-01", max: "2030-12-31" };
            }
        }

        if (options.withConditions && i > 0 && i % 5 === 0) {
            field.conditions = [{ field: "field0", operator: "equals", value: "active" }];
        }

        if (options.withCrossField && i > 0 && i % 7 === 0) {
            field.crossFieldConstraint = { operator: "less_than", field: `field${i - 1}` };
        }

        fields.push(field);
    }

    return {
        id: "benchmark-schema",
        name: "Benchmark Schema",
        sourceTemplatePath: null,
        query: "test/*",
        enabled: true,
        fields,
    };
}

function createMockFrontmatter(fieldCount: number, options: {
    valid?: boolean;
    withArrays?: boolean;
    withNested?: boolean;
} = {}): Record<string, unknown> {
    const fm: Record<string, unknown> = {};
    const valid = options.valid !== false;

    for (let i = 0; i < fieldCount; i++) {
        const type = i % 4;
        if (type === 0) {
            fm[`field${i}`] = valid ? "validString" : 123;
        } else if (type === 1) {
            fm[`field${i}`] = valid ? 42 : "not a number";
        } else if (type === 2) {
            fm[`field${i}`] = valid ? true : "not a boolean";
        } else {
            fm[`field${i}`] = valid ? "2024-06-15" : "invalid-date";
        }
    }

    if (options.withArrays) {
        fm.tags = ["tag1", "tag2", "tag3", "tag4", "tag5"];
        fm.items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    }

    if (options.withNested) {
        fm.metadata = { author: "Test", version: 1, active: true };
    }

    return fm;
}

function createMockFile(path: string, tags: string[] = []): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(".md", "") || "",
        extension: "md",
        name: path.split("/").pop() || "",
        parent: { path: path.split("/").slice(0, -1).join("/") || "" },
        stat: { ctime: Date.now(), mtime: Date.now(), size: 1000 },
        vault: {} as Vault,
    } as TFile;
}

function createMockApp(files: TFile[], tagCache: Map<string, string[]>): App {
    return {
        vault: {
            configDir: ".obsidian",
            getMarkdownFiles: () => files,
            getAbstractFileByPath: (path: string) => files.find(f => f.path === path) || null,
        },
        metadataCache: {
            getFileCache: (file: TFile) => {
                const tags = tagCache.get(file.path);
                if (!tags || tags.length === 0) return null;
                return {
                    frontmatter: { tags: tags.filter(t => !t.startsWith("#")) },
                    tags: tags.filter(t => t.startsWith("#")).map(t => ({
                        tag: t,
                        position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } },
                    })),
                };
            },
        },
    } as unknown as App;
}

function createMockViolation(filePath: string, schemaId: string, field: string): Violation {
    return {
        filePath,
        schemaMapping: createMockSchema(1),
        field,
        type: "missing_required",
        message: `Missing required field: ${field}`,
    };
}

// ============ Validation Benchmarks ============

function runValidationBenchmarks(): void {
    section("VALIDATION BENCHMARKS");

    const results: BenchmarkResult[] = [];

    // Field count scaling analysis
    log("\n--- Field Count Scaling (to analyze O(n) vs O(n²)) ---");
    const fieldCounts = [5, 10, 20, 30, 40, 50, 75, 100];
    const scalingResults: { fields: number; ms: number; opsPerSec: number }[] = [];
    
    for (const count of fieldCounts) {
        const schema = createMockSchema(count);
        const fm = createMockFrontmatter(count, { valid: true });
        const iterations = Math.max(500, Math.floor(10000 / count));
        const result = benchmark(`validateFrontmatter: ${count} fields`, () => {
            validateFrontmatter(fm, schema, "test.md", { checkUnknownFields: true });
        }, iterations);
        results.push(result);
        scalingResults.push({ fields: count, ms: result.avgMs, opsPerSec: result.opsPerSec });
    }

    // Print scaling analysis
    log("\n--- Scaling Analysis ---");
    log("Fields".padEnd(10) + "Time (ms)".padStart(12) + "Ratio vs 10".padStart(14) + "Expected O(n)".padStart(16) + "Expected O(n²)".padStart(16));
    const baseline = scalingResults.find(r => r.fields === 10)!;
    for (const r of scalingResults) {
        const ratio = r.ms / baseline.ms;
        const expectedLinear = r.fields / 10;
        const expectedQuadratic = (r.fields / 10) ** 2;
        log(
            `${r.fields}`.padEnd(10) +
            `${r.ms.toFixed(4)}`.padStart(12) +
            `${ratio.toFixed(2)}x`.padStart(14) +
            `${expectedLinear.toFixed(2)}x`.padStart(16) +
            `${expectedQuadratic.toFixed(2)}x`.padStart(16)
        );
    }

    log("\n--- Feature Overhead ---");

    // With constraints
    {
        const schema = createMockSchema(20, { withConstraints: true });
        const fm = createMockFrontmatter(20, { valid: true });
        results.push(benchmark("validateFrontmatter: 20 fields + constraints", () => {
            validateFrontmatter(fm, schema, "test.md", { checkUnknownFields: true });
        }, 5000));
    }

    // With conditions
    {
        const schema = createMockSchema(20, { withConditions: true });
        const fm = createMockFrontmatter(20, { valid: true });
        fm.field0 = "active"; // Activate conditions
        results.push(benchmark("validateFrontmatter: 20 fields + conditions", () => {
            validateFrontmatter(fm, schema, "test.md", { checkUnknownFields: true });
        }, 5000));
    }

    // With cross-field constraints
    {
        const schema = createMockSchema(20, { withCrossField: true });
        const fm = createMockFrontmatter(20, { valid: true });
        results.push(benchmark("validateFrontmatter: 20 fields + cross-field", () => {
            validateFrontmatter(fm, schema, "test.md", { checkUnknownFields: true });
        }, 5000));
    }

    // Invalid frontmatter (type mismatches)
    {
        const schema = createMockSchema(20);
        const fm = createMockFrontmatter(20, { valid: false });
        results.push(benchmark("validateFrontmatter: 20 fields (invalid)", () => {
            validateFrontmatter(fm, schema, "test.md", { checkUnknownFields: true });
        }, 5000));
    }

    // Unknown fields check
    {
        const schema = createMockSchema(10);
        const fm = createMockFrontmatter(10, { valid: true });
        // Add extra unknown fields
        for (let i = 0; i < 20; i++) {
            fm[`unknown${i}`] = `value${i}`;
        }
        results.push(benchmark("validateFrontmatter: 10 fields + 20 unknown", () => {
            validateFrontmatter(fm, schema, "test.md", { checkUnknownFields: true });
        }, 5000));
    }

    // Custom types
    {
        const customType: CustomType = {
            id: "person",
            name: "Person",
            fields: [
                { name: "name", type: "string", required: true },
                { name: "age", type: "number", required: false },
                { name: "email", type: "string", required: false, stringConstraints: { pattern: "^[^@]+@[^@]+$" } },
            ],
        };
        validationContext.setCustomTypes([customType]);

        const schema: SchemaMapping = {
            id: "test",
            name: "Test",
            sourceTemplatePath: null,
            query: "*",
            enabled: true,
            fields: [
                { name: "author", type: "Person", required: true },
                { name: "reviewers", type: "array", required: false, arrayElementType: "Person" },
            ],
        };
        const fm = {
            author: { name: "John", age: 30, email: "john@example.com" },
            reviewers: [
                { name: "Alice", age: 25 },
                { name: "Bob", email: "bob@test.com" },
            ],
        };
        results.push(benchmark("validateFrontmatter: custom types + arrays", () => {
            validateFrontmatter(fm, schema, "test.md", { checkUnknownFields: true });
        }, 5000));

        validationContext.setCustomTypes([]);
    }

    log("\n--- All Results ---");
    results.forEach(r => log(formatResult(r)));
}

// ============ Query Matcher Benchmarks ============

function runQueryMatcherBenchmarks(): void {
    section("QUERY MATCHER BENCHMARKS");

    const results: BenchmarkResult[] = [];

    // Parse simple queries
    results.push(benchmark("parseQuerySegments: simple folder", () => {
        parseQuerySegments("Library/*");
    }, 50000));

    results.push(benchmark("parseQuerySegments: simple tag", () => {
        parseQuerySegments("#book");
    }, 50000));

    // Parse complex queries
    results.push(benchmark("parseQuerySegments: AND query", () => {
        parseQuerySegments("Library/* and #book and #fiction");
    }, 20000));

    results.push(benchmark("parseQuerySegments: OR query", () => {
        parseQuerySegments("#book or #article or #paper");
    }, 20000));

    results.push(benchmark("parseQuerySegments: complex AND/OR/NOT", () => {
        parseQuerySegments("Library/* and #book not #draft or Notes/* and #article not #archive");
    }, 10000));

    // File matching
    {
        const tagCache = new Map([
            ["Library/book1.md", ["book", "fiction"]],
            ["Library/book2.md", ["book", "nonfiction", "draft"]],
            ["Notes/note1.md", ["article"]],
        ]);
        const files = [
            createMockFile("Library/book1.md"),
            createMockFile("Library/book2.md"),
            createMockFile("Notes/note1.md"),
        ];
        const app = createMockApp(files, tagCache);

        results.push(benchmark("fileMatchesQuery: simple tag", () => {
            fileMatchesQuery(app, files[0], "#book");
        }, 20000));

        results.push(benchmark("fileMatchesQuery: folder recursive", () => {
            fileMatchesQuery(app, files[0], "Library/*");
        }, 20000));

        results.push(benchmark("fileMatchesQuery: AND query", () => {
            fileMatchesQuery(app, files[0], "Library/* and #book");
        }, 10000));

        results.push(benchmark("fileMatchesQuery: complex NOT", () => {
            fileMatchesQuery(app, files[1], "Library/* not #draft");
        }, 10000));
    }

    // Property filter matching
    {
        const app = createMockApp([], new Map());
        const file = createMockFile("test.md");
        file.stat = { ctime: Date.now() - 86400000, mtime: Date.now(), size: 1000 };

        results.push(benchmark("fileMatchesPropertyFilter: date filter", () => {
            fileMatchesPropertyFilter(app, file, {
                modifiedAfter: "2024-01-01",
                modifiedBefore: "2025-12-31",
            });
        }, 20000));
    }

    results.forEach(r => log(formatResult(r)));
}

// ============ Violation Store Benchmarks ============

function runViolationStoreBenchmarks(): void {
    section("VIOLATION STORE BENCHMARKS");

    const results: BenchmarkResult[] = [];

    // Add violations
    {
        results.push(benchmark("ViolationStore.addFileViolations: single", () => {
            const store = new ViolationStore();
            store.addFileViolations("test.md", [createMockViolation("test.md", "s1", "field1")]);
        }, 10000));
    }

    // Add many violations to same file
    {
        const violations = Array.from({ length: 20 }, (_, i) =>
            createMockViolation("test.md", "s1", `field${i}`)
        );
        results.push(benchmark("ViolationStore.addFileViolations: 20 violations", () => {
            const store = new ViolationStore();
            store.addFileViolations("test.md", violations);
        }, 5000));
    }

    // Get file violations
    {
        const store = new ViolationStore();
        for (let i = 0; i < 100; i++) {
            store.addFileViolations(`file${i}.md`, [createMockViolation(`file${i}.md`, "s1", "field1")]);
        }
        results.push(benchmark("ViolationStore.getFileViolations: 100 files", () => {
            store.getFileViolations("file50.md");
        }, 50000));
    }

    // Get total count
    {
        const store = new ViolationStore();
        for (let i = 0; i < 100; i++) {
            store.addFileViolations(`file${i}.md`, Array.from({ length: 5 }, (_, j) =>
                createMockViolation(`file${i}.md`, "s1", `field${j}`)
            ));
        }
        results.push(benchmark("ViolationStore.getTotalViolationCount: 500 violations", () => {
            store.getTotalViolationCount();
        }, 10000));

        results.push(benchmark("ViolationStore.getTotalViolationCount: exclude warnings", () => {
            store.getTotalViolationCount(true);
        }, 10000));
    }

    // Filter violations
    {
        const store = new ViolationStore();
        for (let i = 0; i < 50; i++) {
            const violations: Violation[] = [];
            for (let j = 0; j < 10; j++) {
                const v = createMockViolation(`file${i}.md`, "s1", `field${j}`);
                v.type = j % 2 === 0 ? "missing_required" : "missing_warned";
                violations.push(v);
            }
            store.addFileViolations(`file${i}.md`, violations);
        }
        results.push(benchmark("ViolationStore.getFilteredViolations: errors", () => {
            store.getFilteredViolations("errors");
        }, 5000));

        results.push(benchmark("ViolationStore.getFilteredViolations: warnings", () => {
            store.getFilteredViolations("warnings");
        }, 5000));
    }

    // Remove operations
    {
        results.push(benchmark("ViolationStore.removeFile", () => {
            const store = new ViolationStore();
            for (let i = 0; i < 50; i++) {
                store.addFileViolations(`file${i}.md`, [createMockViolation(`file${i}.md`, "s1", "field1")]);
            }
            store.removeFile("file25.md");
        }, 2000));
    }

    // Remove schema violations (worst case: need to scan all)
    {
        results.push(benchmark("ViolationStore.removeSchemaViolations: 50 files", () => {
            const store = new ViolationStore();
            for (let i = 0; i < 50; i++) {
                store.addFileViolations(`file${i}.md`, [
                    createMockViolation(`file${i}.md`, "schema-1", "field1"),
                    createMockViolation(`file${i}.md`, "schema-2", "field2"),
                ]);
            }
            store.removeSchemaViolations("schema-1");
        }, 1000));
    }

    // Batch operations
    {
        const violations = Array.from({ length: 100 }, (_, i) =>
            createMockViolation(`file${i}.md`, "s1", "field1")
        );
        results.push(benchmark("ViolationStore: batch add 100 files", () => {
            const store = new ViolationStore();
            store.beginBatch();
            for (const v of violations) {
                store.addFileViolations(v.filePath, [v]);
            }
            store.endBatch();
        }, 1000));
    }

    results.forEach(r => log(formatResult(r)));
}

// ============ Bulk Operation Benchmarks ============

function runBulkBenchmarks(): void {
    section("BULK OPERATION BENCHMARKS");

    const results: BenchmarkResult[] = [];

    // Validate many files
    {
        const schema = createMockSchema(15);
        const frontmatters = Array.from({ length: 100 }, () =>
            createMockFrontmatter(15, { valid: true })
        );
        results.push(benchmark("Bulk validate: 100 files x 15 fields", () => {
            for (let i = 0; i < frontmatters.length; i++) {
                validateFrontmatter(frontmatters[i], schema, `file${i}.md`, { checkUnknownFields: true });
            }
        }, 100));
    }

    // Match many files against query
    {
        const tagCache = new Map<string, string[]>();
        const files: TFile[] = [];
        for (let i = 0; i < 500; i++) {
            const path = `folder${i % 10}/file${i}.md`;
            files.push(createMockFile(path));
            tagCache.set(path, [`tag${i % 5}`, i % 3 === 0 ? "special" : "normal"]);
        }
        const app = createMockApp(files, tagCache);

        results.push(benchmark("Bulk query match: 500 files x simple", () => {
            for (const file of files) {
                fileMatchesQuery(app, file, "#special");
            }
        }, 50));

        results.push(benchmark("Bulk query match: 500 files x complex", () => {
            for (const file of files) {
                fileMatchesQuery(app, file, "folder1/* and #tag1 not #special or folder2/* and #tag2");
            }
        }, 50));
    }

    results.forEach(r => log(formatResult(r)));
}

// ============ Memory Benchmarks ============

/**
 * Measure memory by creating objects in a function, holding reference, and comparing.
 * Forces GC before measurement to get consistent baseline.
 */
function measureMemory<T>(label: string, createFn: () => T): T {
    // Force GC to get clean baseline (requires --expose-gc flag)
    forceGC();

    const before = process.memoryUsage?.()?.heapUsed ?? 0;
    const result = createFn();

    // Force GC again to ensure we're measuring retained memory
    forceGC();

    const after = process.memoryUsage?.()?.heapUsed ?? 0;
    const deltaKB = (after - before) / 1024;

    // If negative (GC collected other stuff), show as ~0 or note uncertainty
    if (deltaKB < 0) {
        log(`${label}: <measurement uncertain, run with --expose-gc>`);
    } else {
        log(`${label}: ~${deltaKB.toFixed(0)} KB`);
    }

    return result;
}

function runMemoryBenchmarks(): void {
    section("MEMORY USAGE ESTIMATES");

    if (!global.gc) {
        log("Note: Run with 'node --expose-gc' for accurate memory measurements");
        log("");
    }

    // ViolationStore memory with many violations
    // Hold reference to prevent GC during measurement
    const store = measureMemory("ViolationStore with 10,000 violations", () => {
        const s = new ViolationStore();
        for (let i = 0; i < 1000; i++) {
            s.addFileViolations(`file${i}.md`, Array.from({ length: 10 }, (_, j) =>
                createMockViolation(`file${i}.md`, "s1", `field${j}`)
            ));
        }
        return s;
    });

    // Schema memory - hold reference
    const schemas = measureMemory("100 schemas with 30 fields each", () => {
        const arr: SchemaMapping[] = [];
        for (let i = 0; i < 100; i++) {
            arr.push(createMockSchema(30, { withConstraints: true, withConditions: true }));
        }
        return arr;
    });

    // Prevent unused variable warnings and keep references alive
    void store;
    void schemas;
}

// ============ Save Results ============

function saveResults(gitInfo: { commit: string; tag: string; branch: string }): void {
    const benchmarkDir = join(process.cwd(), "benchmarks");

    if (!existsSync(benchmarkDir)) {
        mkdirSync(benchmarkDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `benchmark-${timestamp}-${gitInfo.commit}.txt`;
    const filepath = join(benchmarkDir, filename);

    writeFileSync(filepath, outputLines.join("\n"), "utf-8");
    console.log(`\n Results saved to: ${filepath}`);
}

// ============ Comparison to Previous Run ============

interface ParsedMetric {
    name: string;
    avgMs: number;
    opsPerSec: number;
}

function parseMetricsFromFile(content: string): ParsedMetric[] {
    const metrics: ParsedMetric[] = [];
    // Match lines like: "validateFrontmatter: 20 fields      0.0532 ms/op      18,797 ops/sec  (5000 iters)"
    const regex = /^(.+?)\s+([\d.]+)\s+ms\/op\s+([\d,]+)\s+ops\/sec/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
        metrics.push({
            name: match[1].trim(),
            avgMs: parseFloat(match[2]),
            opsPerSec: parseInt(match[3].replace(/,/g, ""), 10),
        });
    }
    return metrics;
}

function findPreviousBenchmark(currentCommit: string): { filepath: string; commit: string; content: string } | null {
    const benchmarkDir = join(process.cwd(), "benchmarks");
    if (!existsSync(benchmarkDir)) return null;

    const files = readdirSync(benchmarkDir)
        .filter(f => f.startsWith("benchmark-") && f.endsWith(".txt"))
        .sort()
        .reverse(); // Most recent first

    for (const file of files) {
        // Extract commit from filename: benchmark-TIMESTAMP-COMMIT.txt
        const match = file.match(/benchmark-.+-([a-f0-9]+)\.txt$/);
        if (match && match[1] !== currentCommit) {
            const filepath = join(benchmarkDir, file);
            const content = readFileSync(filepath, "utf-8");
            return { filepath, commit: match[1], content };
        }
    }
    return null;
}

function compareWithPrevious(currentCommit: string): void {
    const previous = findPreviousBenchmark(currentCommit);
    if (!previous) {
        log("\nNo previous benchmark from a different commit found for comparison.");
        return;
    }

    section("COMPARISON TO PREVIOUS COMMIT");
    log(`Comparing: ${currentCommit} (current) vs ${previous.commit} (previous)`);
    log(`Previous file: ${previous.filepath}`);
    log("");

    const currentContent = outputLines.join("\n");
    const currentMetrics = parseMetricsFromFile(currentContent);
    const previousMetrics = parseMetricsFromFile(previous.content);

    // Create lookup map for previous metrics
    const prevMap = new Map(previousMetrics.map(m => [m.name, m]));

    // Key benchmarks to highlight
    const keyBenchmarks = [
        "validateFrontmatter: 20 fields",
        "validateFrontmatter: 20 fields + constraints",
        "Bulk validate: 100 files x 15 fields",
        "ViolationStore.addFileViolations: 20 violations",
        "ViolationStore: batch add 100 files",
        "fileMatchesQuery: AND query",
    ];

    let totalCurrentOps = 0;
    let totalPrevOps = 0;
    let matchedCount = 0;

    log("Benchmark".padEnd(55) + "Current".padStart(12) + "Previous".padStart(12) + "Change".padStart(10));
    log("-".repeat(89));

    for (const current of currentMetrics) {
        const prev = prevMap.get(current.name);
        if (!prev) continue;

        const isKey = keyBenchmarks.some(k => current.name.includes(k));
        const changePercent = ((current.opsPerSec - prev.opsPerSec) / prev.opsPerSec) * 100;
        const changeStr = changePercent >= 0
            ? `+${changePercent.toFixed(1)}%`
            : `${changePercent.toFixed(1)}%`;
        const indicator = changePercent > 5 ? " FASTER" : changePercent < -5 ? " SLOWER" : "";

        if (isKey) {
            log(
                current.name.substring(0, 54).padEnd(55) +
                `${current.opsPerSec.toLocaleString()}`.padStart(12) +
                `${prev.opsPerSec.toLocaleString()}`.padStart(12) +
                changeStr.padStart(10) +
                indicator
            );
        }

        totalCurrentOps += current.opsPerSec;
        totalPrevOps += prev.opsPerSec;
        matchedCount++;
    }

    if (matchedCount > 0) {
        log("-".repeat(89));
        const overallChange = ((totalCurrentOps - totalPrevOps) / totalPrevOps) * 100;
        const overallStr = overallChange >= 0 ? `+${overallChange.toFixed(1)}%` : `${overallChange.toFixed(1)}%`;
        log(`OVERALL (${matchedCount} benchmarks)`.padEnd(55) + overallStr.padStart(34));
    }
}

// ============ Main ============

async function main(): Promise<void> {
    const gitInfo = getGitInfo();

    log("\n PROPSEC BENCHMARKS");
    log("=".repeat(90));
    log(`Date:    ${new Date().toISOString()}`);
    log(`Node:    ${process.version}`);
    log(`Platform: ${process.platform} ${process.arch}`);
    log(`Git:     ${gitInfo.branch} @ ${gitInfo.commit} (${gitInfo.tag})`);

    runValidationBenchmarks();
    runQueryMatcherBenchmarks();
    runViolationStoreBenchmarks();
    runBulkBenchmarks();
    runMemoryBenchmarks();

    // Compare with previous commit's benchmark
    compareWithPrevious(gitInfo.commit);

    log("\n" + "=".repeat(90));
    log(" BENCHMARK COMPLETE");
    log("=".repeat(90) + "\n");

    saveResults(gitInfo);
}

main().catch(console.error);
