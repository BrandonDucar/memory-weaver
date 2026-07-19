export type ConnectorKind =
  | "filesystem"
  | "pieces"
  | "brainsync"
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
  | "mcp"
  | "writeback";

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
  receipt: MeshReceipt;
}

export interface MeshReceipt {
  schemaVersion: "memory-weaver.receipt.v1";
  receiptId: string;
  action: "ingest" | "weave" | "search" | "export" | "permission-change";
  actor: "koidream" | "gourami" | "operator" | "mcp-client";
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
