import type { FSWatcher } from "chokidar";
import { loadManifest, resolveRuntimePaths, type RuntimePaths } from "./config.js";
import { BrainSyncConnector } from "./connectors/brainsync.js";
import { FilesystemConnector } from "./connectors/filesystem.js";
import { HttpJsonConnector } from "./connectors/http-json.js";
import { GmailConnector } from "./connectors/gmail.js";
import { PiecesConnector } from "./connectors/pieces.js";
import { loadOrCreateReceiptSigner, loadOrCreateVaultKey, type ReceiptSigner } from "./crypto.js";
import { Gourami } from "./gourami.js";
import { KoiDream } from "./koidream.js";
import { MeshPolicy, PermissionDeniedError } from "./policy.js";
import { Steward } from "./steward.js";
import { ShadowIndex } from "./shadows.js";
import type { ConnectorPermission, ConnectorRunResult, MeshQualityReport, MeshSearchResult, MeshSource, PermissionManifest, StewardBriefKind } from "./types.js";
import { LocalMeshVault } from "./vault.js";

const filesystemKinds = new Set(["filesystem", "obsidian"]);
const httpKinds = new Set(["http-json", "graphiti", "agent"]);

export interface RuntimeStatus {
  vaultId: string;
  localOnly: boolean;
  permissionSnapshotHash: string;
  revoked: boolean;
  vault: Awaited<ReturnType<LocalMeshVault["stats"]>>;
  connectors: Array<{
    id: string;
    kind: string;
    enabled: boolean;
    implemented: boolean;
    capabilities: string[];
    scopes: number;
  }>;
}

export class MemoryWeaverRuntime {
  readonly policy: MeshPolicy;
  readonly koiDream: KoiDream;
  readonly gourami: Gourami;
  readonly steward: Steward;
  readonly shadowIndex: ShadowIndex;
  private readonly watchers: FSWatcher[] = [];
  private configWatcher?: FSWatcher;
  private revoked = false;

  private constructor(
    readonly manifest: PermissionManifest,
    readonly paths: RuntimePaths,
    readonly vault: LocalMeshVault,
    signer: ReceiptSigner,
  ) {
    this.policy = new MeshPolicy(manifest);
    this.koiDream = new KoiDream(vault, this.policy, signer);
    this.gourami = new Gourami(vault, this.policy, signer);
    this.steward = new Steward(vault, this.policy, signer);
    this.shadowIndex = new ShadowIndex(vault);
  }

  static async open(configOverride?: string): Promise<MemoryWeaverRuntime> {
    const paths = resolveRuntimePaths(configOverride);
    const manifest = await loadManifest(paths.config);
    const encryptionKey = await loadOrCreateVaultKey(paths.encryptionKey);
    const signer = await loadOrCreateReceiptSigner(paths.signingKey, paths.signingPublicKey);
    const vault = await LocalMeshVault.open(paths.vault, encryptionKey);
    const runtime = new MemoryWeaverRuntime(manifest, paths, vault, signer);
    await runtime.armRevocationWatcher();
    return runtime;
  }

  private async armRevocationWatcher(): Promise<void> {
    const chokidar = await import("chokidar");
    this.configWatcher = chokidar.default.watch(this.paths.config, { ignoreInitial: true, awaitWriteFinish: true });
    this.configWatcher.on("change", () => {
      this.revoked = true;
      void Promise.all(this.watchers.map((watcher) => watcher.close()));
    });
  }

  private assertActive(): void {
    if (this.revoked) throw new PermissionDeniedError("Permission manifest changed; restart Memory Weaver to load the new revision");
  }

  private implemented(permission: ConnectorPermission): boolean {
    return filesystemKinds.has(permission.kind)
      || permission.kind === "brainsync"
      || permission.kind === "gmail"
      || permission.kind === "pieces"
      || (httpKinds.has(permission.kind) && permission.scopes.every((scope) => /^https?:\/\//i.test(scope)));
  }

  async status(): Promise<RuntimeStatus> {
    return {
      vaultId: this.manifest.vaultId,
      localOnly: this.manifest.localOnly,
      permissionSnapshotHash: this.policy.snapshotHash(),
      revoked: this.revoked,
      vault: await this.vault.stats(),
      connectors: this.manifest.connectors.map((connector) => ({
        id: connector.id,
        kind: connector.kind,
        enabled: connector.enabled,
        implemented: this.implemented(connector),
        capabilities: connector.capabilities,
        scopes: connector.scopes.length,
      })),
    };
  }

  async scan(connectorId?: string): Promise<ConnectorRunResult[]> {
    this.assertActive();
    const selected = this.manifest.connectors.filter((connector) => connector.enabled && (!connectorId || connector.id === connectorId));
    if (connectorId && selected.length === 0) throw new PermissionDeniedError(`Connector ${connectorId} is not enabled`);
    const results: ConnectorRunResult[] = [];
    for (const connector of selected) {
      if (filesystemKinds.has(connector.kind)) {
        results.push(await new FilesystemConnector(connector, this.policy, this.koiDream).scan());
      } else if (connector.kind === "brainsync") {
        results.push(await new BrainSyncConnector(connector, this.policy, this.koiDream).scan());
      } else if (connector.kind === "pieces") {
        results.push(await new PiecesConnector(connector, this.policy, this.koiDream).scan());
      } else if (connector.kind === "gmail") {
        results.push(await new GmailConnector(connector, this.policy, this.koiDream, this.vault).scan());
      } else if (httpKinds.has(connector.kind) && connector.scopes.every((scope) => /^https?:\/\//i.test(scope))) {
        results.push(await new HttpJsonConnector(connector, this.policy, this.koiDream).scan());
      } else {
        results.push({
          connectorId: connector.id,
          scanned: 0,
          ingested: 0,
          duplicates: 0,
          failed: 0,
          warnings: [`${connector.kind} adapter is declared but not installed in this alpha`],
        });
      }
    }
    await this.koiDream.recordScan(results);
    if (results.some((result) => result.ingested > 0)) await this.gourami.weave();
    return results;
  }

  async watch(onError: (error: Error) => void): Promise<number> {
    this.assertActive();
    for (const connector of this.manifest.connectors.filter((candidate) => candidate.enabled && filesystemKinds.has(candidate.kind) && candidate.capabilities.includes("watch"))) {
      this.watchers.push(await new FilesystemConnector(connector, this.policy, this.koiDream).watch(onError));
    }
    return this.watchers.length;
  }

  async search(query: string, limit = 20, mcpOnly = false): Promise<MeshSearchResult[]> {
    this.assertActive();
    const results = await this.vault.search(query, limit);
    return mcpOnly ? results.filter((result) => this.policy.allows(result.connectorId, "mcp")) : results;
  }

  async readSource(sourceId: string, mcpOnly = false): Promise<MeshSource | null> {
    this.assertActive();
    const source = await this.vault.readSource(sourceId);
    if (!source) return null;
    this.policy.require(source.connectorId, "read");
    if (mcpOnly) this.policy.require(source.connectorId, "mcp");
    return source;
  }

  async weave(): Promise<Awaited<ReturnType<Gourami["weave"]>>> {
    this.assertActive();
    return this.gourami.weave();
  }

  async reindex(): Promise<{ reindex: Awaited<ReturnType<KoiDream["reindex"]>>; weave: Awaited<ReturnType<Gourami["weave"]>> }> {
    this.assertActive();
    const reindex = await this.koiDream.reindex();
    const weave = await this.gourami.weave();
    return { reindex, weave };
  }

  async report(): Promise<MeshQualityReport> {
    this.assertActive();
    return this.vault.qualityReport();
  }

  async brief(kind: StewardBriefKind): Promise<Awaited<ReturnType<Steward["generate"]>>> {
    this.assertActive();
    return this.steward.generate(kind);
  }

  async latestBrief(kind?: StewardBriefKind): Promise<Awaited<ReturnType<Steward["latest"]>>> {
    this.assertActive();
    return this.steward.latest(kind);
  }

  async initialAnalysis(): Promise<Awaited<ReturnType<Steward["generate"]>>> {
    this.assertActive();
    await this.shadowIndex.scan();
    return this.steward.generate("initial");
  }

  async shadows(): Promise<Awaited<ReturnType<ShadowIndex["scan"]>>> {
    this.assertActive();
    return this.shadowIndex.scan();
  }

  async close(): Promise<void> {
    await Promise.all(this.watchers.map((watcher) => watcher.close()));
    await this.configWatcher?.close();
    await this.vault.close();
  }
}
