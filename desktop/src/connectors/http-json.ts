import { KoiDream } from "../koidream.js";
import { MeshPolicy } from "../policy.js";
import type { ConnectorPermission, ConnectorRunResult, SourceEnvelope } from "../types.js";

const credentialFrom = (reference?: string): string | undefined => {
  if (!reference) return undefined;
  if (!reference.startsWith("env:")) throw new Error("Only env: credential references are supported in the alpha");
  const value = process.env[reference.slice(4)];
  if (!value) throw new Error(`Credential ${reference} is not available`);
  return value;
};

export class HttpJsonConnector {
  constructor(
    readonly permission: ConnectorPermission,
    private readonly policy: MeshPolicy,
    private readonly koiDream: KoiDream,
  ) {}

  async scan(): Promise<ConnectorRunResult> {
    this.policy.require(this.permission.id, "read");
    const result: ConnectorRunResult = { connectorId: this.permission.id, scanned: 0, ingested: 0, duplicates: 0, failed: 0, warnings: [] };
    const credential = credentialFrom(this.permission.credentialRef);
    for (const scope of this.permission.scopes) {
      result.scanned += 1;
      try {
        const url = new URL(scope);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP(S) endpoints are supported");
        if (url.username || url.password) throw new Error("Credentials must not be embedded in endpoint URLs");
        const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname.toLowerCase());
        if ((this.policy.manifest.localOnly || this.policy.manifest.networkEgress === "deny") && !loopback) {
          throw new Error("The permission manifest denies non-loopback network egress");
        }
        const response = await fetch(url, {
          headers: credential ? { authorization: `Bearer ${credential}` } : undefined,
          redirect: "error",
          signal: AbortSignal.timeout(Number(this.permission.settings?.timeoutMs ?? 10_000)),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const maxBytes = this.permission.maxItemBytes ?? 2 * 1024 * 1024;
        const declaredLength = Number(response.headers.get("content-length") ?? 0);
        if (declaredLength > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte connector limit`);
        if (!response.body) throw new Error("Response body is unavailable");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new Error(`Response exceeds ${maxBytes} byte connector limit`);
          }
          chunks.push(value);
        }
        const joined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          joined.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const content = new TextDecoder().decode(joined);
        const envelope: SourceEnvelope = {
          schemaVersion: "memory-weaver.source.v1",
          connectorId: this.permission.id,
          externalId: url.toString(),
          title: String(this.permission.settings?.title ?? `${this.permission.id} snapshot`),
          kind: "json",
          content,
          mimeType: response.headers.get("content-type") ?? "application/json",
          observedAt: new Date().toISOString(),
          authority: this.permission.authority,
          sensitivity: this.permission.sensitivity,
          taint: "untrusted",
          tags: [this.permission.kind, "approved-endpoint"],
          metadata: { endpoint: url.origin, status: response.status, mimeType: response.headers.get("content-type") ?? "application/json" },
        };
        const ingest = await this.koiDream.ingest(envelope);
        if (ingest.duplicate) result.duplicates += 1;
        else result.ingested += 1;
      } catch (error) {
        result.failed += 1;
        result.warnings.push(`${scope}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return result;
  }
}
