import { randomUUID } from "node:crypto";
import { sha256, signReceipt, stableJson, type ReceiptSigner } from "./crypto.js";
import { MeshPolicy } from "./policy.js";
import type { MeshReceipt } from "./types.js";
import { LocalMeshVault } from "./vault.js";

export class Gourami {
  constructor(
    private readonly vault: LocalMeshVault,
    private readonly policy: MeshPolicy,
    private readonly signer: ReceiptSigner,
  ) {}

  async weave(sourceIds: string[] = []): Promise<{ edgeCount: number; receipt: MeshReceipt }> {
    const edgeCount = await this.vault.rebuildTopology();
    const unsigned: Omit<MeshReceipt, "signature"> = {
      schemaVersion: "memory-weaver.receipt.v1",
      receiptId: `receipt_${randomUUID()}`,
      action: "weave",
      actor: "gourami",
      sourceIds,
      inputHash: sha256(stableJson({ sourceIds, permissionSnapshotHash: this.policy.snapshotHash() })),
      outputHash: sha256(stableJson({ edgeCount })),
      occurredAt: new Date().toISOString(),
      permissionSnapshotHash: this.policy.snapshotHash(),
      warnings: [],
      priorReceiptHash: await this.vault.latestReceiptDigest(),
      signatureAlgorithm: "ed25519",
      signingKeyId: this.signer.keyId,
    };
    const receipt: MeshReceipt = { ...unsigned, signature: signReceipt(unsigned, this.signer) };
    await this.vault.saveReceipt(receipt);
    return { edgeCount, receipt };
  }
}
