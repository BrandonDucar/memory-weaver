export type SourceKind = "document" | "github" | "conversation" | "web" | "database";

export interface WeaveSource {
  id: string;
  title: string;
  kind: SourceKind;
  content: string;
  origin: string;
  addedAt: string;
  updatedAt: string;
  tags: string[];
  mock?: boolean;
}

export interface WeaveTopic {
  id: string;
  label: string;
  score: number;
  sourceIds: string[];
}

export interface WeaveEdge {
  id: string;
  from: string;
  to: string;
  kind: "mentions" | "related";
  label: string;
  weight: number;
}

export interface WeaveIssue {
  id: string;
  type: "conflict" | "duplicate" | "orphan" | "stale";
  severity: "attention" | "review" | "info";
  title: string;
  detail: string;
  sourceIds: string[];
  suggestion: string;
}

export interface WeaveReceipt {
  id: string;
  generatedAt: string;
  inputHash: string;
  outputHash: string;
  sourceCount: number;
  topicCount: number;
  relationshipCount: number;
  issueCount: number;
  engine: "memory-weaver-browser-v1";
}

export interface WeaveResult {
  version: "1.0";
  generatedAt: string;
  topics: WeaveTopic[];
  edges: WeaveEdge[];
  issues: WeaveIssue[];
  receipt: WeaveReceipt;
}

export interface WeaverWorkspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sources: WeaveSource[];
  result: WeaveResult | null;
  receipts: WeaveReceipt[];
  isDemo?: boolean;
}

const SECRET_PATTERNS = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[opsu]_[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~-]{16,}\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

const TOPIC_PHRASES = [
  "agent gateway",
  "source of truth",
  "portable context",
  "local first",
  "user owned storage",
  "proof drop",
  "implementation receipts",
  "breaking changes",
  "memory fabric",
  "knowledge graph",
  "github",
  "farcaster",
  "fip",
  "migration",
  "capsule",
  "trapper",
  "provenance",
  "receipts",
  "privacy",
  "adoption",
  "consensus",
  "conflict",
  "timeline",
  "notion",
  "slack",
  "discord",
  "telegram",
];

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "because", "before", "being", "between", "both",
  "could", "does", "from", "have", "into", "just", "more", "most", "only", "other", "over",
  "same", "should", "some", "such", "than", "that", "their", "there", "these", "they", "this",
  "through", "under", "very", "what", "when", "where", "which", "while", "will", "with", "would",
  "your", "every", "using", "used", "make", "need", "needs", "work", "working", "system", "project",
]);

const titleCase = (value: string): string => value
  .split(/\s+/)
  .map((word) => word ? word[0].toUpperCase() + word.slice(1) : word)
  .join(" ");

export const makeId = (prefix: string): string => {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random}`;
};

export const redactSecrets = (content: string): string => SECRET_PATTERNS.reduce(
  (value, pattern) => value.replace(pattern, "[REDACTED]"),
  content,
);

export const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const normalized = (value: string): string => value
  .toLowerCase()
  .replace(/https?:\/\/\S+/g, " ")
  .replace(/[^a-z0-9\s-]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const extractTopics = (source: WeaveSource): string[] => {
  const haystack = normalized(`${source.title} ${source.tags.join(" ")} ${source.content}`);
  const scores = new Map<string, number>();

  for (const phrase of TOPIC_PHRASES) {
    const matches = haystack.match(new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "g"));
    if (matches?.length) scores.set(phrase, matches.length * (phrase.includes(" ") ? 3 : 2));
  }

  for (const token of haystack.split(/\s+/)) {
    if (token.length < 5 || STOP_WORDS.has(token) || /^\d+$/.test(token)) continue;
    scores.set(token, (scores.get(token) ?? 0) + 1);
  }

  return Array.from(scores.entries())
    .filter(([, score]) => score >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([topic]) => topic);
};

const splitSentences = (value: string): string[] => value
  .split(/(?<=[.!?])\s+|\n+/)
  .map((sentence) => sentence.trim())
  .filter((sentence) => sentence.length >= 24 && sentence.length <= 320);

const sentenceSignature = (sentence: string): Set<string> => new Set(
  normalized(sentence)
    .split(/\s+/)
    .filter((token) => token.length > 3 && !STOP_WORDS.has(token) && !["never", "without", "cannot"].includes(token)),
);

const similarity = (left: Set<string>, right: Set<string>): number => {
  const intersection = Array.from(left).filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
};

const isNegative = (sentence: string): boolean => /\b(no|not|never|cannot|without|isn['’]t|don['’]t|won['’]t)\b/i.test(sentence);

const findConflicts = (sources: WeaveSource[]): WeaveIssue[] => {
  const issues: WeaveIssue[] = [];
  for (let leftIndex = 0; leftIndex < sources.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sources.length; rightIndex += 1) {
      const left = sources[leftIndex];
      const right = sources[rightIndex];
      let best: { leftSentence: string; rightSentence: string; score: number } | null = null;

      for (const leftSentence of splitSentences(left.content)) {
        for (const rightSentence of splitSentences(right.content)) {
          if (isNegative(leftSentence) === isNegative(rightSentence)) continue;
          const score = similarity(sentenceSignature(leftSentence), sentenceSignature(rightSentence));
          if (score >= 0.28 && (!best || score > best.score)) {
            best = { leftSentence, rightSentence, score };
          }
        }
      }

      if (best) {
        issues.push({
          id: `issue_conflict_${left.id}_${right.id}`,
          type: "conflict",
          severity: "attention",
          title: `${left.title} conflicts with ${right.title}`,
          detail: `“${best.leftSentence}” versus “${best.rightSentence}”`,
          sourceIds: [left.id, right.id],
          suggestion: "Choose the current claim, mark the older one superseded, and record the decision.",
        });
      }
    }
  }
  return issues.slice(0, 8);
};

export const weaveSources = (incomingSources: WeaveSource[], now = new Date()): WeaveResult => {
  const sources = incomingSources.map((source) => ({
    ...source,
    content: redactSecrets(source.content),
  }));
  const topicSources = new Map<string, Set<string>>();

  for (const source of sources) {
    for (const topic of extractTopics(source)) {
      if (!topicSources.has(topic)) topicSources.set(topic, new Set());
      topicSources.get(topic)?.add(source.id);
    }
  }

  const topics: WeaveTopic[] = Array.from(topicSources.entries())
    .map(([topic, sourceIds]) => ({
      id: `topic_${stableHash(topic).replace("fnv1a-", "")}`,
      label: titleCase(topic),
      score: sourceIds.size,
      sourceIds: Array.from(sourceIds),
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 18);

  const edges: WeaveEdge[] = [];
  for (const topic of topics) {
    for (const sourceId of topic.sourceIds) {
      edges.push({
        id: `edge_${sourceId}_${topic.id}`,
        from: sourceId,
        to: topic.id,
        kind: "mentions",
        label: topic.label,
        weight: topic.score,
      });
    }
  }

  for (let leftIndex = 0; leftIndex < sources.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sources.length; rightIndex += 1) {
      const left = sources[leftIndex];
      const right = sources[rightIndex];
      const shared = topics.filter((topic) => topic.sourceIds.includes(left.id) && topic.sourceIds.includes(right.id));
      if (shared.length) {
        edges.push({
          id: `edge_related_${left.id}_${right.id}`,
          from: left.id,
          to: right.id,
          kind: "related",
          label: shared.slice(0, 3).map((topic) => topic.label).join(", "),
          weight: shared.length,
        });
      }
    }
  }

  const issues: WeaveIssue[] = [...findConflicts(sources)];
  const contentHashes = new Map<string, WeaveSource[]>();
  for (const source of sources) {
    const hash = stableHash(normalized(source.content));
    contentHashes.set(hash, [...(contentHashes.get(hash) ?? []), source]);
  }
  for (const duplicates of contentHashes.values()) {
    if (duplicates.length < 2) continue;
    issues.push({
      id: `issue_duplicate_${duplicates.map((source) => source.id).join("_")}`,
      type: "duplicate",
      severity: "review",
      title: `${duplicates.length} sources contain the same material`,
      detail: duplicates.map((source) => source.title).join(" and "),
      sourceIds: duplicates.map((source) => source.id),
      suggestion: "Keep the highest-authority source and link the remaining copies to it.",
    });
  }

  const relatedSourceIds = new Set(edges.filter((edge) => edge.kind === "related").flatMap((edge) => [edge.from, edge.to]));
  for (const source of sources) {
    if (!relatedSourceIds.has(source.id) && sources.length > 1) {
      issues.push({
        id: `issue_orphan_${source.id}`,
        type: "orphan",
        severity: "info",
        title: `${source.title} is not connected yet`,
        detail: "No meaningful topic overlap was found with the rest of this weave.",
        sourceIds: [source.id],
        suggestion: "Add tags, a related source, or a short context note.",
      });
    }

    const updatedAt = new Date(source.updatedAt);
    const ageDays = (now.getTime() - updatedAt.getTime()) / 86_400_000;
    if (!Number.isNaN(ageDays) && ageDays > 180) {
      issues.push({
        id: `issue_stale_${source.id}`,
        type: "stale",
        severity: "review",
        title: `${source.title} may be stale`,
        detail: `Last updated ${Math.floor(ageDays)} days ago.`,
        sourceIds: [source.id],
        suggestion: "Verify the claim against a current source or mark it historical.",
      });
    }
  }

  const generatedAt = now.toISOString();
  const inputHash = stableHash(JSON.stringify(sources.map(({ id, title, content, updatedAt }) => ({ id, title, content, updatedAt }))));
  const outputHash = stableHash(JSON.stringify({ topics, edges, issues }));
  const receipt: WeaveReceipt = {
    id: makeId("receipt"),
    generatedAt,
    inputHash,
    outputHash,
    sourceCount: sources.length,
    topicCount: topics.length,
    relationshipCount: edges.filter((edge) => edge.kind === "related").length,
    issueCount: issues.length,
    engine: "memory-weaver-browser-v1",
  };

  return {
    version: "1.0",
    generatedAt,
    topics,
    edges,
    issues,
    receipt,
  };
};

const demoSource = (
  id: string,
  title: string,
  kind: SourceKind,
  origin: string,
  updatedAt: string,
  tags: string[],
  content: string,
): WeaveSource => ({
  id,
  title,
  kind,
  origin,
  addedAt: "2026-07-18T16:00:00.000Z",
  updatedAt,
  tags,
  content,
  mock: true,
});

export const createDemoWorkspace = (): WeaverWorkspace => {
  const sources: WeaveSource[] = [
    demoSource(
      "src_product_brief",
      "Warper Keeper product brief",
      "document",
      "Mock brief / product.md",
      "2026-07-18T14:20:00.000Z",
      ["trapper", "portable-context", "privacy"],
      "A Trapper packages an entire working context into a portable object. It contains sources, conversations, tasks, provenance, receipts, a knowledge graph, and update history. Warper Keeper complements GitHub rather than replacing it. User-owned storage should remain the authority, and connector credentials must never be stored by DreamNet.",
    ),
    demoSource(
      "src_github_pr",
      "PR #130 · Memory Fabric foundation",
      "github",
      "Mock GitHub / dream-net#130",
      "2026-07-16T18:42:00.000Z",
      ["memory-fabric", "receipts", "provenance"],
      "The Memory Fabric introduces provenance envelopes, idempotent receipts, source authority, sensitivity, confidence, and selective promotion. The implementation remains feature flagged. Provider selection belongs to API Hopper; memory routing must not become a second model router.",
    ),
    demoSource(
      "src_fip_thread",
      "FIP workspace discussion",
      "conversation",
      "Mock Farcaster thread",
      "2026-07-17T21:05:00.000Z",
      ["farcaster", "fip", "adoption"],
      "Builders want FIP impact reports, implementation receipts, migration status, client compatibility, and an adoption timeline. The Keeper should complement GitHub discussions and make proposal relationships visible without adding governance bureaucracy.",
    ),
    demoSource(
      "src_user_interview",
      "Builder interview · context handoff",
      "conversation",
      "Mock interview notes",
      "2026-07-15T11:40:00.000Z",
      ["github", "trapper", "onboarding"],
      "The builder currently sends twelve GitHub links, three docs, and meeting notes whenever a collaborator joins. They want one Trapper that opens with a project map, current decisions, unresolved conflicts, and a migration checklist.",
    ),
    demoSource(
      "src_architecture",
      "Local-first architecture decision",
      "document",
      "Mock ADR / 004-local-first.md",
      "2026-07-18T09:10:00.000Z",
      ["local-first", "user-owned-storage", "privacy"],
      "Memory Weaver is local first. The cloud database is not the authoritative store for every uploaded source or connector credential. Imported source content remains on the user’s device by default. The hosted shell does not receive connector credentials or source content. Exports are explicit, portable, and include provenance plus a deterministic receipt.",
    ),
    demoSource(
      "src_old_storage_plan",
      "Original cloud storage plan",
      "document",
      "Mock archive / storage-plan-v0.md",
      "2025-10-02T12:00:00.000Z",
      ["storage", "cloud", "authority"],
      "The cloud database is the authoritative store for every uploaded source and connector credential. Users do not need local exports because the hosted workspace is canonical.",
    ),
    demoSource(
      "src_launch_notes",
      "Launch readiness notes",
      "document",
      "Mock meeting / launch-notes.md",
      "2026-07-18T19:25:00.000Z",
      ["migration", "github", "receipts"],
      "Before launch: verify GitHub import, test Markdown ingestion, produce an implementation receipt, export a Trapper, and check that stale or conflicting sources are surfaced before collaborators receive the link.",
    ),
  ];
  const result = weaveSources(sources, new Date("2026-07-18T20:00:00.000Z"));
  return {
    id: "workspace_demo",
    name: "Portable Knowledge Workspace",
    createdAt: "2026-07-18T16:00:00.000Z",
    updatedAt: result.generatedAt,
    sources,
    result,
    receipts: [result.receipt],
    isDemo: true,
  };
};

export const createEmptyWorkspace = (name = "Untitled weave"): WeaverWorkspace => {
  const now = new Date().toISOString();
  return {
    id: makeId("workspace"),
    name,
    createdAt: now,
    updatedAt: now,
    sources: [],
    result: null,
    receipts: [],
  };
};

export const downloadJson = (fileName: string, value: unknown): void => {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const downloadText = (fileName: string, value: string): void => {
  const blob = new Blob([value], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const toCapsuleMarkdown = (workspace: WeaverWorkspace): string => {
  const result = workspace.result;
  return [
    `# Capsule: ${workspace.name}`,
    "",
    "**Type:** KnowledgeCapsule",
    `**Workspace ID:** ${workspace.id}`,
    `**Generated:** ${result?.generatedAt ?? new Date().toISOString()}`,
    `**Receipt:** ${result?.receipt.id ?? "not-yet-woven"}`,
    "",
    "## Sources",
    ...workspace.sources.map((source) => `- **${source.title}** · ${source.kind} · ${source.origin}`),
    "",
    "## Topics",
    ...(result?.topics.map((topic) => `- ${topic.label} (${topic.sourceIds.length} sources)`) ?? ["- Run the weave first."]),
    "",
    "## Friction",
    ...(result?.issues.map((issue) => `- **${issue.type}:** ${issue.title}`) ?? ["- Run the weave first."]),
    "",
    "## Verification",
    `- Input hash: ${result?.receipt.inputHash ?? "pending"}`,
    `- Output hash: ${result?.receipt.outputHash ?? "pending"}`,
    "- Source contents remain in the accompanying .weave.json export.",
    "",
  ].join("\n");
};
