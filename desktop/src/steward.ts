import { randomUUID } from "node:crypto";
import { sha256, signReceipt, stableJson, type ReceiptSigner } from "./crypto.js";
import { MeshPolicy } from "./policy.js";
import type {
  MeshReceipt,
  StewardBrief,
  StewardBriefItem,
  StewardBriefKind,
  StewardSourceCandidate,
} from "./types.js";
import { LocalMeshVault } from "./vault.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const ageInDays = (updatedAt: string, now: Date): number => Math.max(0, Math.floor((now.getTime() - new Date(updatedAt).getTime()) / DAY_MS));

const seededOrder = (items: StewardSourceCandidate[], seed: string): StewardSourceCandidate[] => [...items].sort((left, right) => (
  sha256(`${seed}:${left.sourceId}`).localeCompare(sha256(`${seed}:${right.sourceId}`))
));

const uniqueByTitle = (items: StewardSourceCandidate[]): StewardSourceCandidate[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const itemFrom = (source: StewardSourceCandidate, reason: string): StewardBriefItem => ({
  title: source.title,
  reason,
  sourceIds: [source.sourceId],
  topics: source.topics.slice(0, 6),
});

const remixPrompt = (source: StewardSourceCandidate): string => {
  const media = source.tags.includes("local-media") || /image|photo|video|audio/i.test(source.kind);
  if (media) return `Revisit ${source.title}. What story, collection, or new visual could it become with what you know now?`;
  if (/repo|code|project/i.test(`${source.kind} ${source.tags.join(" ")}`)) {
    return `Reopen ${source.title}. Which useful part could become a smaller product, tool, or current workflow?`;
  }
  return `Revisit ${source.title}. Rewrite its strongest idea for your current work, then identify one assumption that has changed.`;
};

export class Steward {
  constructor(
    private readonly vault: LocalMeshVault,
    private readonly policy: MeshPolicy,
    private readonly signer: ReceiptSigner,
  ) {}

  async generate(kind: StewardBriefKind, now = new Date()): Promise<{ brief: StewardBrief; receipt: MeshReceipt }> {
    const isInitial = kind === "initial";
    const [quality, recent, oldest, connections, shadows] = await Promise.all([
      this.vault.qualityReport(),
      this.vault.stewardSources("recent", isInitial || kind === "weekly" ? 12 : 8),
      this.vault.stewardSources("oldest", 40),
      this.vault.stewardConnections(isInitial || kind === "weekly" ? 8 : 5),
      this.vault.memoryShadowSummary(),
    ]);
    const daySeed = now.toISOString().slice(0, 10);
    const resurfacedSources = seededOrder(uniqueByTitle(oldest), `${kind}:${daySeed}`).slice(0, isInitial || kind === "weekly" ? 6 : 3);
    const headlines = uniqueByTitle(recent).slice(0, isInitial || kind === "weekly" ? 7 : 4).map((source) => itemFrom(
      source,
      `Recently active in ${source.connectorId}${source.topics.length ? ` around ${source.topics.slice(0, 3).join(", ")}` : ""}.`,
    ));
    const resurfaced = resurfacedSources.map((source) => ({
      ...itemFrom(source, `Last changed ${ageInDays(source.updatedAt, now)} days ago and worth another look.`),
      ageDays: ageInDays(source.updatedAt, now),
      remixPrompt: remixPrompt(source),
    }));
    const connectionItems = connections.map((connection) => ({
      sourceIds: connection.sourceIds,
      titles: connection.titles,
      labels: connection.labels.slice(0, 6),
      prompt: `Explore why ${connection.titles[0]} and ${connection.titles[1]} both touch ${connection.labels.slice(0, 3).join(", ") || "the same work"}. Is there a workflow or idea hiding between them?`,
    }));
    const questions: StewardBrief["questions"] = [];
    if (headlines[0]) questions.push({
      id: `question_${sha256(`${daySeed}:steward:${headlines[0].sourceIds[0]}`).slice(0, 16)}`,
      title: "What changed?",
      prompt: `What is newly important about ${headlines[0].title}, and what should your future self remember?`,
      perspective: "steward",
      sourceIds: headlines[0].sourceIds,
    });
    if (connectionItems[0]) questions.push({
      id: `question_${sha256(`${daySeed}:builder:${connectionItems[0].sourceIds.join(":")}`).slice(0, 16)}`,
      title: "Build the bridge",
      prompt: connectionItems[0].prompt,
      perspective: "builder",
      sourceIds: connectionItems[0].sourceIds,
    });
    if (resurfaced[0]) questions.push({
      id: `question_${sha256(`${daySeed}:archivist:${resurfaced[0].sourceIds[0]}`).slice(0, 16)}`,
      title: "Still true?",
      prompt: `Does ${resurfaced[0].title} still represent what you believe or want? Preserve, revise, remix, or retire it.`,
      perspective: "archivist",
      sourceIds: resurfaced[0].sourceIds,
    });
    if (headlines[1]) questions.push({
      id: `question_${sha256(`${daySeed}:skeptic:${headlines[1].sourceIds[0]}`).slice(0, 16)}`,
      title: "Challenge the frame",
      prompt: `What evidence would make you change direction on ${headlines[1].title}?`,
      perspective: "skeptic",
      sourceIds: headlines[1].sourceIds,
    });

    const upgrades: StewardBrief["upgrades"] = [];
    if (quality.sources === 0) upgrades.push({
      title: "Connect a first source",
      reason: "The local vault is empty.",
      suggestedNextStep: "Run the Memory Cartographer and approve one folder or app for read-only ingestion.",
    });
    if (quality.connectors.length < 2 && quality.sources > 0) upgrades.push({
      title: "Add another point of view",
      reason: "A weave becomes more useful when it can connect different source types.",
      suggestedNextStep: "Approve one additional read-only source such as email, photos, repositories, or Pieces OS.",
    });
    if (quality.isolatedSources > 0) upgrades.push({
      title: "Reconnect isolated memories",
      reason: `${quality.isolatedSources} sources currently have no relationship edge.`,
      suggestedNextStep: "Open the isolated-source view and add better local tags or approve related context for ingestion.",
    });
    if (quality.edgeDensity > 0.2) upgrades.push({
      title: "Sharpen broad topics",
      reason: "The relationship graph is dense enough that generic terms may be creating weak connections.",
      suggestedNextStep: "Review the most common topics and suppress terms that do not carry useful meaning.",
    });
    const untrusted = quality.taint.find((item) => item.level === "untrusted")?.sources ?? 0;
    if (untrusted > 0) upgrades.push({
      title: "Review source trust",
      reason: `${untrusted} sources remain correctly marked as untrusted imports.`,
      suggestedNextStep: "Verify important sources before using them for high-confidence conclusions.",
    });

    const brief: StewardBrief = {
      schemaVersion: "memory-weaver.steward-brief.v1",
      briefId: `brief_${randomUUID()}`,
      kind,
      generatedAt: now.toISOString(),
      summary: isInitial
        ? `Memory Weaver mapped ${quality.sources} sources across ${quality.connectors.length} connectors, found ${quality.edges} relationships, and detected ${shadows.total} memory shadows.`
        : `${headlines.length} current signals, ${resurfaced.length} resurfaced memories, and ${connectionItems.length} relationships are ready to explore.`,
      sourceCoverage: quality.connectors,
      majorThemes: quality.topTopics,
      shadows,
      headlines,
      resurfaced,
      connections: connectionItems,
      questions,
      upgrades,
      quality,
    };
    await this.vault.saveStewardBrief(brief);

    const unsigned: Omit<MeshReceipt, "signature"> = {
      schemaVersion: "memory-weaver.receipt.v1",
      receiptId: `receipt_${randomUUID()}`,
      action: "brief",
      actor: "steward",
      sourceIds: Array.from(new Set([
        ...headlines.flatMap((item) => item.sourceIds),
        ...resurfaced.flatMap((item) => item.sourceIds),
        ...connectionItems.flatMap((item) => item.sourceIds),
      ])),
      inputHash: sha256(stableJson({ kind, daySeed, quality, permissionSnapshotHash: this.policy.snapshotHash() })),
      outputHash: sha256(stableJson(brief)),
      occurredAt: brief.generatedAt,
      permissionSnapshotHash: this.policy.snapshotHash(),
      warnings: [],
      priorReceiptHash: await this.vault.latestReceiptDigest(),
      signatureAlgorithm: "ed25519",
      signingKeyId: this.signer.keyId,
    };
    const receipt: MeshReceipt = { ...unsigned, signature: signReceipt(unsigned, this.signer) };
    await this.vault.saveReceipt(receipt);
    return { brief, receipt };
  }

  latest(kind?: StewardBriefKind): Promise<StewardBrief | null> {
    return this.vault.latestStewardBrief(kind);
  }
}
