import { App, TFile } from "obsidian";
import type { FileMeta } from "@propsec/core";

export function toFileMeta(app: App, file: TFile): FileMeta {
  const cache = app.metadataCache.getFileCache(file);
  const tags: string[] = [];
  const fm = cache?.frontmatter?.tags as string | string[] | undefined;
  if (fm) for (const t of (Array.isArray(fm) ? fm : [fm])) tags.push(String(t).replace(/^#/, ""));
  if (cache?.tags) for (const t of cache.tags) tags.push(t.tag.replace(/^#/, ""));
  return {
    path: file.path,
    parentPath: file.parent && !file.parent.isRoot() ? file.parent.path : "",
    basename: file.basename,
    mtime: file.stat.mtime,
    ctime: file.stat.ctime,
    frontmatter: cache?.frontmatter,
    tags: [...new Set(tags)],
  };
}
