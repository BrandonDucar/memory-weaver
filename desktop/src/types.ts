export type ConnectorKind =
  | "filesystem"
  | "pieces"
  | "brainsync"
  | "gmail"
  | "redis"
  | "kafka"
  | "nats"
  | "neon"
  | "graphiti"
  | "obsidian"
  | "agent"
  | "http-json";

export type MeshCapability =
  | "discover"
  | "read"
  | "watch"
  | "subscribe"
  | "search"
  | "weave"
  | "export"
  | "mcp";

export type MemoryAuthority = "ephemeral" | "working" | "approved" | "canonical";
export type MemorySensitivity = "public" | "internal" | "private" | "restricted";
export type TaintLevel = "untrusted" | "selected" | "verified" | "quarantined";

export interface ConnectorPermission {
  id: string;
  kind: ConnectorKind;
  enabled: boolean;
  capabilities: MeshCapability[];
  scopes: string[];
  extensions?: string[];
  maxItemBytes?: number;
  authority: MemoryAuthority;
  sensitivity: MemorySensitivity;
  credentialRef?: string;
  settings?: Record<string, string | number | boolean | string[]>;
}

export interface PermissionManifest {
  schemaVersion: "memory-weaver.permissions.v2";
  vaultId: string;
  revision: number;
  revocationEpoch: number;
  defaultDeny: true;
  localOnly: boolean;
  networkEgress: "deny" | "allow-explicit";
  connectors: ConnectorPermission[];
}

export interface SourceEnvelope {
  schemaVersion: "memory-weaver.source.v1";
  connectorId: string;
  externalId: string;
  title: string;
  kind: string;
  content: string;
  mimeType: string;
  observedAt: string;
  updatedAt?: string;
  authority: MemoryAuthority;
  sensitivity: MemorySensitivity;
  taint: TaintLevel;
  tags: string[];
  metadata: Record<string, string | number | boolean | null>;
}

export interface IngestResult {
  sourceId: string;
  versionId: string;
  contentHash: string;
  duplicate: boolean;
  topics: string[];
  receipt?: MeshReceipt;
}

export interface MeshReceipt {
  schemaVersion: "memory-weaver.receipt.v1";
  receiptId: string;
  action: "ingest" | "scan" | "reindex" | "weave" | "brief" | "search" | "export" | "permission-change";
  actor: "koidream" | "gourami" | "steward" | "operator" | "mcp-client";
  connectorId?: string;
  sourceIds: string[];
  inputHash: string;
  outputHash: string;
  occurredAt: string;
  permissionSnapshotHash: string;
  warnings: string[];
  priorReceiptHash?: string;
  signatureAlgorithm: "ed25519";
  signingKeyId: string;
  signature: string;
}

export interface MeshSearchResult {
  sourceId: string;
  title: string;
  connectorId: string;
  authority: MemoryAuthority;
  sensitivity: MemorySensitivity;
  taint: TaintLevel;
  topics: string[];
  updatedAt: string;
}

export interface MeshSource extends MeshSearchResult {
  externalId: string;
  kind: string;
  content: string;
  mimeType: string;
  tags: string[];
  metadata: Record<string, string | number | boolean | null>;
  contentHash: string;
}

export interface ConnectorRunResult {
  connectorId: string;
  scanned: number;
  ingested: number;
  duplicates: number;
  failed: number;
  warnings: string[];
}

export interface MeshQualityReport {
  generatedAt: string;
  sources: number;
  edges: number;
  isolatedSources: number;
  edgeDensity: number;
  connectors: Array<{ connectorId: string; sources: number }>;
  taint: Array<{ level: TaintLevel; sources: number }>;
  topTopics: Array<{ label: string; sources: number }>;
  mostConnected: Array<{ sourceId: string; title: string; connections: number }>;
}

export type StewardBriefKind = "initial" | "morning" | "daily" | "weekly";

export type MemoryShadowKind = "broken-link" | "missing-path" | "referenced-attachment";

export interface MemoryShadow {
  shadowId: string;
  kind: MemoryShadowKind;
  label: string;
  reference: string;
  confidence: "high" | "medium" | "low";
  evidenceSourceIds: string[];
  explanation: string;
  observedAt: string;
}

export interface StewardBriefItem {
  title: string;
  reason: string;
  sourceIds: string[];
  topics: string[];
}

export interface StewardBrief {
  schemaVersion: "memory-weaver.steward-brief.v1";
  briefId: string;
  kind: StewardBriefKind;
  generatedAt: string;
  summary: string;
  sourceCoverage: Array<{ connectorId: string; sources: number }>;
  majorThemes: Array<{ label: string; sources: number }>;
  shadows: {
    total: number;
    byKind: Array<{ kind: MemoryShadowKind; count: number }>;
    samples: MemoryShadow[];
  };
  headlines: StewardBriefItem[];
  resurfaced: Array<StewardBriefItem & {
    ageDays: number;
    remixPrompt: string;
  }>;
  connections: Array<{
    sourceIds: string[];
    titles: string[];
    labels: string[];
    prompt: string;
  }>;
  questions: Array<{
    id: string;
    title: string;
    prompt: string;
    perspective: "steward" | "builder" | "archivist" | "skeptic";
    sourceIds: string[];
  }>;
  upgrades: Array<{
    title: string;
    reason: string;
    suggestedNextStep: string;
  }>;
  quality: MeshQualityReport;
}

export interface StewardSourceCandidate {
  sourceId: string;
  title: string;
  connectorId: string;
  kind: string;
  updatedAt: string;
  topics: string[];
  tags: string[];
}

export interface StewardConnectionCandidate {
  sourceIds: [string, string];
  titles: [string, string];
  labels: string[];
  weight: number;
}
