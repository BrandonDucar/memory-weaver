import { randomUUID } from "node:crypto";
import { sha256, signReceipt, stableJson, type ReceiptSigner } from "./crypto.js";
import { MeshPolicy } from "./policy.js";
import type { ConnectorRunResult, IngestResult, MeshReceipt, SourceEnvelope } from "./types.js";
import { LocalMeshVault } from "./vault.js";

const SECRET_PATTERNS = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[opsu]_[A-Za-z0-9_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~-]{16,}\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

const STOP_WORDS = new Set(["about", "after", "again", "also", "because", "before", "being", "between", "could", "created", "description", "does", "file", "from", "have", "index", "into", "just", "more", "notes", "only", "other", "should", "some", "status", "than", "that", "their", "there", "these", "they", "this", "through", "title", "under", "updated", "version", "what", "when", "where", "which", "while", "will", "with", "would", "your"]);

export const redactSecrets = (value: string): string => SECRET_PATTERNS.reduce(
  (current, pattern) => current.replace(pattern, "[REDACTED]"),
  value,
);

export const extractTopics = (value: string, limit = 12): string[] => {
  const frequencies = new Map<string, number>();
  for (const token of value.toLowerCase().replace(/https?:\/\/\S+/g, " ").match(/[a-z][a-z0-9-]{3,}/g) ?? []) {
    if (STOP_WORDS.has(token) || /^\d+$/.test(token)) continue;
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  return Array.from(frequencies.entries())
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([topic]) => topic);
};

export class KoiDream {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly vault: LocalMeshVault,
    private readonly policy: MeshPolicy,
    private readonly signer: ReceiptSigner,
  ) {}

  ingest(input: SourceEnvelope): Promise<IngestResult> {
    const operation = this.queue.then(() => this.ingestOnce(input));
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async ingestOnce(input: SourceEnvelope): Promise<IngestResult> {
    const connector = this.policy.require(input.connectorId, "read");
    const maxBytes = connector.maxItemBytes ?? 2 * 1024 * 1024;
    if (Buffer.byteLength(input.content) > maxBytes) throw new Error(`Source exceeds ${maxBytes} byte connector limit`);
    if (input.connectorId !== connector.id) throw new Error("Connector identity mismatch");

    const envelope: SourceEnvelope = {
      ...input,
      content: redactSecrets(input.content),
      authority: connector.authority,
      sensitivity: connector.sensitivity,
      taint: input.taint,
    };
    await this.vault.recordConnector(connector.id, connector.kind, this.policy.snapshotHash());
    const stored = await this.vault.storeSource(envelope);
    const topics = extractTopics(`${envelope.title}\n${envelope.tags.join(" ")}\n${envelope.content}`);
    if (stored.duplicate) return { ...stored, topics };
    await this.vault.replaceTopics(stored.sourceId, topics);

    const unsigned: Omit<MeshReceipt, "signature"> = {
      schemaVersion: "memory-weaver.receipt.v1",
      receiptId: `receipt_${randomUUID()}`,
      action: "ingest",
      actor: "koidream",
      connectorId: connector.id,
      sourceIds: [stored.sourceId],
      inputHash: stored.contentHash,
      outputHash: sha256(stableJson({ sourceId: stored.sourceId, versionId: stored.versionId, topics })),
      occurredAt: new Date().toISOString(),
      permissionSnapshotHash: this.policy.snapshotHash(),
      warnings: [],
      priorReceiptHash: await this.vault.latestReceiptDigest(),
      signatureAlgorithm: "ed25519",
      signingKeyId: this.signer.keyId,
    };
    const receipt: MeshReceipt = { ...unsigned, signature: signReceipt(unsigned, this.signer) };
    await this.vault.saveReceipt(receipt);
    return { ...stored, topics, receipt };
  }

  recordScan(results: ConnectorRunResult[]): Promise<MeshReceipt> {
    const operation = this.queue.then(async () => {
      const summary = results.map((result) => ({
        connectorId: result.connectorId,
        scanned: result.scanned,
        ingested: result.ingested,
        duplicates: result.duplicates,
        failed: result.failed,
        warningCount: result.warnings.length,
      }));
      const unsigned: Omit<MeshReceipt, "signature"> = {
        schemaVersion: "memory-weaver.receipt.v1",
        receiptId: `receipt_${randomUUID()}`,
        action: "scan",
        actor: "koidream",
        sourceIds: [],
        inputHash: sha256(stableJson({ connectors: results.map((result) => result.connectorId), permissionSnapshotHash: this.policy.snapshotHash() })),
        outputHash: sha256(stableJson(summary)),
        occurredAt: new Date().toISOString(),
        permissionSnapshotHash: this.policy.snapshotHash(),
        warnings: results.flatMap((result) => result.warnings).slice(0, 20),
        priorReceiptHash: await this.vault.latestReceiptDigest(),
        signatureAlgorithm: "ed25519",
        signingKeyId: this.signer.keyId,
      };
      const receipt: MeshReceipt = { ...unsigned, signature: signReceipt(unsigned, this.signer) };
      await this.vault.saveReceipt(receipt);
      return receipt;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  reindex(): Promise<{ sources: number; topicAssignments: number; receipt: MeshReceipt }> {
    const operation = this.queue.then(async () => {
      let sources = 0;
      let topicAssignments = 0;
      const warnings: string[] = [];
      for (const sourceId of await this.vault.sourceIds(10_000)) {
        const source = await this.vault.readSource(sourceId);
        if (!source || !this.policy.allows(source.connectorId, "read")) continue;
        const topics = extractTopics(`${source.title}\n${source.tags.join(" ")}\n${source.content}`);
        await this.vault.replaceTopics(sourceId, topics);
        sources += 1;
        topicAssignments += topics.length;
      }
      const unsigned: Omit<MeshReceipt, "signature"> = {
        schemaVersion: "memory-weaver.receipt.v1",
        receiptId: `receipt_${randomUUID()}`,
        action: "reindex",
        actor: "koidream",
        sourceIds: [],
        inputHash: sha256(stableJson({ sources, permissionSnapshotHash: this.policy.snapshotHash() })),
        outputHash: sha256(stableJson({ sources, topicAssignments })),
        occurredAt: new Date().toISOString(),
        permissionSnapshotHash: this.policy.snapshotHash(),
        warnings,
        priorReceiptHash: await this.vault.latestReceiptDigest(),
        signatureAlgorithm: "ed25519",
        signingKeyId: this.signer.keyId,
      };
      const receipt: MeshReceipt = { ...unsigned, signature: signReceipt(unsigned, this.signer) };
      await this.vault.saveReceipt(receipt);
      return { sources, topicAssignments, receipt };
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
