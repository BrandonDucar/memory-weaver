import { KoiDream } from "../koidream.js";
import { MeshPolicy } from "../policy.js";
import type { ConnectorPermission, ConnectorRunResult, SourceEnvelope } from "../types.js";
import { assertNetworkAllowed, boundedBody, connectorLimit, timeoutMs } from "./helpers.js";

interface PiecesAsset {
  id?: unknown;
  name?: unknown;
  created?: { value?: unknown };
  updated?: { value?: unknown };
  formats?: { iterable?: Array<{
    classification?: { generic?: unknown; specific?: unknown };
    role?: unknown;
    application?: { name?: unknown; id?: unknown };
  }> };
}

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;

export class PiecesConnector {
  constructor(
    readonly permission: ConnectorPermission,
    private readonly policy: MeshPolicy,
    private readonly koiDream: KoiDream,
  ) {}

  async scan(): Promise<ConnectorRunResult> {
    this.policy.require(this.permission.id, "read");
    const result: ConnectorRunResult = { connectorId: this.permission.id, scanned: 0, ingested: 0, duplicates: 0, failed: 0, warnings: [] };
    const limit = connectorLimit(this.permission);
    for (const scope of this.permission.scopes) {
      try {
        const url = new URL(scope);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Pieces requires an exact HTTP(S) assets endpoint");
        assertNetworkAllowed(url, this.policy.manifest.localOnly, this.policy.manifest.networkEgress);
        const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs(this.permission)) });
        if (!response.ok) throw new Error(`Pieces returned HTTP ${response.status}`);
        const raw = JSON.parse(await boundedBody(response, this.permission.maxItemBytes ?? 4 * 1024 * 1024)) as { iterable?: PiecesAsset[] } | PiecesAsset[];
        const assets = (Array.isArray(raw) ? raw : raw.iterable ?? []).slice(0, limit);
        if (!assets.length) result.warnings.push(`${url}: no assets were returned`);
        for (const asset of assets) {
          result.scanned += 1;
          const id = text(asset.id);
          if (!id) {
            result.failed += 1;
            result.warnings.push("Pieces asset skipped because it had no stable id");
            continue;
          }
          const formats = (asset.formats?.iterable ?? []).slice(0, 12).map((format) => ({
            generic: text(format.classification?.generic),
            specific: text(format.classification?.specific),
            role: text(format.role),
            application: text(format.application?.name),
            applicationId: text(format.application?.id),
          }));
          const safeMetadata = {
            id,
            name: text(asset.name) ?? `Pieces asset ${id.slice(0, 8)}`,
            createdAt: text(asset.created?.value),
            updatedAt: text(asset.updated?.value),
            formats,
          };
          const envelope: SourceEnvelope = {
            schemaVersion: "memory-weaver.source.v1",
            connectorId: this.permission.id,
            externalId: id,
            title: safeMetadata.name,
            kind: "pieces-asset-metadata",
            content: JSON.stringify(safeMetadata, null, 2),
            mimeType: "application/json",
            observedAt: new Date().toISOString(),
            updatedAt: safeMetadata.updatedAt,
            authority: this.permission.authority,
            sensitivity: this.permission.sensitivity,
            taint: "untrusted",
            tags: ["pieces", ...formats.flatMap((format) => [format.generic, format.specific]).filter((item): item is string => Boolean(item)).slice(0, 8)],
            metadata: { piecesAssetId: id, metadataOnly: true, mimeType: "application/json" },
          };
          const ingest = await this.koiDream.ingest(envelope);
          if (ingest.duplicate) result.duplicates += 1;
          else result.ingested += 1;
        }
      } catch (error) {
        result.failed += 1;
        result.warnings.push(`${scope}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return result;
  }
}
