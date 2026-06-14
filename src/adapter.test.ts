import { describe, it, expect } from "vitest";
import { toFileMeta } from "./adapter";
import type { App, TFile } from "obsidian";

function makeFile(over: Partial<{
    path: string;
    parentPath: string | null;
    basename: string;
    mtime: number;
    ctime: number;
}> = {}): TFile {
    const parentPath = over.parentPath === undefined ? "Books" : over.parentPath;
    return {
        path: over.path ?? "Books/Dune.md",
        basename: over.basename ?? "Dune",
        parent: parentPath === null ? null : { path: parentPath },
        stat: { mtime: over.mtime ?? 1000, ctime: over.ctime ?? 500 },
    } as unknown as TFile;
}

function makeApp(cache: { frontmatter?: Record<string, unknown>; tags?: { tag: string }[] } | undefined): App {
    return {
        metadataCache: {
            getFileCache: () => cache,
        },
    } as unknown as App;
}

describe("toFileMeta", () => {
    it("maps core file fields", () => {
        const file = makeFile({ path: "Books/Dune.md", basename: "Dune", mtime: 1234, ctime: 567 });
        const fm = { title: "Dune", author: "Herbert" };
        const meta = toFileMeta(makeApp({ frontmatter: fm }), file);

        expect(meta.path).toBe("Books/Dune.md");
        expect(meta.parentPath).toBe("Books");
        expect(meta.basename).toBe("Dune");
        expect(meta.mtime).toBe(1234);
        expect(meta.ctime).toBe(567);
        expect(meta.frontmatter).toBe(fm);
    });

    it("defaults parentPath to empty string when no parent", () => {
        const meta = toFileMeta(makeApp(undefined), makeFile({ parentPath: null }));
        expect(meta.parentPath).toBe("");
        expect(meta.frontmatter).toBeUndefined();
        expect(meta.tags).toEqual([]);
    });

    it("merges frontmatter and inline tags, strips '#', and dedupes", () => {
        const meta = toFileMeta(
            makeApp({
                frontmatter: { tags: ["#book", "fiction"] },
                tags: [{ tag: "#fiction" }, { tag: "#sci-fi" }],
            }),
            makeFile()
        );
        expect([...meta.tags].sort()).toEqual(["book", "fiction", "sci-fi"]);
    });

    it("accepts a single string frontmatter tag", () => {
        const meta = toFileMeta(makeApp({ frontmatter: { tags: "#book" } }), makeFile());
        expect(meta.tags).toEqual(["book"]);
    });
});
