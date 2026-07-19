import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { KoiDream } from "../koidream.js";
import { MeshPolicy } from "../policy.js";
import type { ConnectorPermission, ConnectorRunResult, SourceEnvelope } from "../types.js";

const DEFAULT_EXTENSIONS = [".md", ".mdx", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".csv", ".html", ".xml"];
const IGNORED_SEGMENTS = new Set([".git", ".idea", ".next", ".turbo", ".venv", "dist", "node_modules", "target", "vendor"]);

const mimeFor = (extension: string): string => ({
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".md": "text/markdown",
  ".mdx": "text/markdown",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".csv": "text/csv",
  ".html": "text/html",
  ".xml": "application/xml",
}[extension] ?? "text/plain");

const containsIgnoredSegment = (candidate: string): boolean => candidate.split(path.sep).some((segment) => IGNORED_SEGMENTS.has(segment));

export class FilesystemConnector {
  constructor(
    readonly permission: ConnectorPermission,
    private readonly policy: MeshPolicy,
    private readonly koiDream: KoiDream,
  ) {}

  private extensions(): Set<string> {
    return new Set((this.permission.extensions?.length ? this.permission.extensions : DEFAULT_EXTENSIONS).map((item) => item.toLowerCase()));
  }

  private async canonicalPath(candidate: string, capability: "discover" | "read" | "watch"): Promise<string> {
    const resolved = this.policy.requireFilesystemPath(this.permission.id, candidate, capability);
    const linkState = await lstat(resolved);
    if (linkState.isSymbolicLink()) throw new Error("Symbolic links and junction roots are not allowed");
    const canonical = await realpath(resolved);
    this.policy.requireFilesystemPath(this.permission.id, canonical, capability);
    return canonical;
  }

  private async listFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (IGNORED_SEGMENTS.has(entry.name) || entry.isSymbolicLink()) continue;
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(candidate);
        else if (entry.isFile() && this.extensions().has(path.extname(entry.name).toLowerCase())) files.push(candidate);
      }
    };
    await walk(root);
    return files;
  }

  private async envelope(filePath: string): Promise<SourceEnvelope> {
    const resolved = await this.canonicalPath(filePath, "read");
    const handle = await open(resolved, "r");
    const details = await handle.stat();
    if (!details.isFile()) {
      await handle.close();
      throw new Error("Source is not a regular file");
    }
    const maxBytes = this.permission.maxItemBytes ?? 2 * 1024 * 1024;
    if (details.size > maxBytes) {
      await handle.close();
      throw new Error(`File exceeds ${maxBytes} bytes`);
    }
    const extension = path.extname(resolved).toLowerCase();
    const mimeType = mimeFor(extension);
    let content: string;
    try {
      content = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
    return {
      schemaVersion: "memory-weaver.source.v1",
      connectorId: this.permission.id,
      externalId: resolved,
      title: path.basename(resolved),
      kind: extension.slice(1) || "text",
      content,
      mimeType,
      observedAt: new Date().toISOString(),
      updatedAt: details.mtime.toISOString(),
      authority: this.permission.authority,
      sensitivity: this.permission.sensitivity,
      taint: "untrusted",
      tags: [this.permission.kind, "local-file"],
      metadata: { path: resolved, bytes: details.size, mimeType },
    };
  }

  async scan(): Promise<ConnectorRunResult> {
    this.policy.require(this.permission.id, "discover");
    const result: ConnectorRunResult = { connectorId: this.permission.id, scanned: 0, ingested: 0, duplicates: 0, failed: 0, warnings: [] };
    const maxItems = Number(this.permission.settings?.maxItemsPerRun ?? 500);
    for (const scope of this.permission.scopes) {
      const root = await this.canonicalPath(scope, "discover");
      try {
        for (const filePath of await this.listFiles(root)) {
          if (result.scanned >= maxItems) {
            result.warnings.push(`Scan stopped at the configured ${maxItems} item limit`);
            return result;
          }
          result.scanned += 1;
          try {
            const ingest = await this.koiDream.ingest(await this.envelope(filePath));
            if (ingest.duplicate) result.duplicates += 1;
            else result.ingested += 1;
          } catch (error) {
            result.failed += 1;
            result.warnings.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch (error) {
        result.failed += 1;
        result.warnings.push(`${root}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return result;
  }

  async watch(onError: (error: Error) => void): Promise<FSWatcher> {
    this.policy.require(this.permission.id, "watch");
    const roots = await Promise.all(this.permission.scopes.map((scope) => this.canonicalPath(scope, "watch")));
    const watcher = chokidar.watch(roots, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (candidate) => containsIgnoredSegment(String(candidate)),
      awaitWriteFinish: { stabilityThreshold: 750, pollInterval: 100 },
    });
    const ingest = (candidate: string): void => {
      if (!this.extensions().has(path.extname(candidate).toLowerCase())) return;
      void this.envelope(candidate)
        .then((envelope) => this.koiDream.ingest(envelope))
        .catch((error) => onError(error instanceof Error ? error : new Error(String(error))));
    };
    watcher.on("add", ingest).on("change", ingest).on("error", (error) => onError(error instanceof Error ? error : new Error(String(error))));
    return watcher;
  }
}
