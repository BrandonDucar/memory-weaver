import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { KoiDream } from "../koidream.js";
import { MeshPolicy } from "../policy.js";
import type { ConnectorPermission, ConnectorRunResult, SourceEnvelope } from "../types.js";
import { connectorLimit } from "./helpers.js";

const exportSchema = z.object({
  schemaVersion: z.literal("memory-weaver.brainsync-export.v1"),
  exportId: z.string().min(1),
  approvedAt: z.string().datetime(),
  entries: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    content: z.string(),
    sourceRef: z.string().min(1),
    updatedAt: z.string().datetime().optional(),
    tags: z.array(z.string()).max(30).default([]),
  })),
});

export class BrainSyncConnector {
  constructor(
    readonly permission: ConnectorPermission,
    private readonly policy: MeshPolicy,
    private readonly koiDream: KoiDream,
  ) {}

  private async canonical(candidate: string): Promise<string> {
    const resolved = this.policy.requireFilesystemPath(this.permission.id, candidate, "read");
    if ((await lstat(resolved)).isSymbolicLink()) throw new Error("BrainSync export scopes cannot be links or junctions");
    const canonical = await realpath(resolved);
    this.policy.requireFilesystemPath(this.permission.id, canonical, "read");
    return canonical;
  }

  private async filesFor(scope: string): Promise<string[]> {
    const canonical = await this.canonical(scope);
    const details = await stat(canonical);
    if (details.isFile()) return [canonical];
    if (!details.isDirectory()) return [];
    const files: string[] = [];
    for (const entry of await readdir(canonical, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".approved.json")) files.push(path.join(canonical, entry.name));
    }
    return files;
  }

  async scan(): Promise<ConnectorRunResult> {
    this.policy.require(this.permission.id, "read");
    const result: ConnectorRunResult = { connectorId: this.permission.id, scanned: 0, ingested: 0, duplicates: 0, failed: 0, warnings: [] };
    const limit = connectorLimit(this.permission, 500);
    for (const scope of this.permission.scopes) {
      try {
        for (const filePath of await this.filesFor(scope)) {
          const approvedPath = await this.canonical(filePath);
          const details = await stat(approvedPath);
          const maxBytes = this.permission.maxItemBytes ?? 2 * 1024 * 1024;
          if (details.size > maxBytes) throw new Error(`${approvedPath} exceeds the ${maxBytes} byte limit`);
          const approved = exportSchema.parse(JSON.parse(await readFile(approvedPath, "utf8")) as unknown);
          for (const entry of approved.entries) {
            if (result.scanned >= limit) {
              result.warnings.push(`BrainSync import stopped at the configured ${limit} item limit`);
              return result;
            }
            result.scanned += 1;
            const envelope: SourceEnvelope = {
              schemaVersion: "memory-weaver.source.v1",
              connectorId: this.permission.id,
              externalId: `${approved.exportId}:${entry.id}`,
              title: entry.title,
              kind: "brainsync-approved-export",
              content: entry.content,
              mimeType: "text/plain",
              observedAt: new Date().toISOString(),
              updatedAt: entry.updatedAt ?? approved.approvedAt,
              authority: this.permission.authority,
              sensitivity: this.permission.sensitivity,
              taint: "selected",
              tags: ["brainsync", "approved-export", ...entry.tags],
              metadata: { exportId: approved.exportId, sourceRef: entry.sourceRef, approvedAt: approved.approvedAt, mimeType: "text/plain" },
            };
            const ingest = await this.koiDream.ingest(envelope);
            if (ingest.duplicate) result.duplicates += 1;
            else result.ingested += 1;
          }
        }
      } catch (error) {
        result.failed += 1;
        result.warnings.push(`${scope}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return result;
  }
}
