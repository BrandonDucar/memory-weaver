import { PGlite } from "@electric-sql/pglite";
import { decryptText, encryptText, sha256, stableJson } from "./crypto.js";
import type { MeshReceipt, MeshSearchResult, MeshSource, SourceEnvelope } from "./types.js";

interface RowCount { count: number | string }

export class LocalMeshVault {
  private constructor(
    private readonly db: PGlite,
    private readonly key: Buffer,
  ) {}

  static async open(dataDir: string, key: Buffer): Promise<LocalMeshVault> {
    const db = new PGlite(dataDir);
    await db.waitReady;
    const vault = new LocalMeshVault(db, key);
    await vault.migrate();
    return vault;
  }

  private async migrate(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS connectors (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        permission_snapshot_hash TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        authority TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        taint TEXT NOT NULL,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(connector_id, external_id)
      );
      CREATE TABLE IF NOT EXISTS source_versions (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        content_hash TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(source_id, content_hash)
      );
      CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS source_topics (
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        weight INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(source_id, topic_id)
      );
      CREATE TABLE IF NOT EXISTS memory_edges (
        id TEXT PRIMARY KEY,
        from_source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        to_source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        labels JSONB NOT NULL DEFAULT '[]'::jsonb,
        weight INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        payload JSONB NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sources_connector ON sources(connector_id);
      CREATE INDEX IF NOT EXISTS idx_sources_updated ON sources(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_source_versions_hash ON source_versions(content_hash);
      CREATE INDEX IF NOT EXISTS idx_source_topics_topic ON source_topics(topic_id);
    `);
  }

  async recordConnector(id: string, kind: string, permissionSnapshotHash: string): Promise<void> {
    await this.db.query(
      `INSERT INTO connectors(id, kind, permission_snapshot_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT(id) DO UPDATE SET kind = EXCLUDED.kind, permission_snapshot_hash = EXCLUDED.permission_snapshot_hash, updated_at = now()`,
      [id, kind, permissionSnapshotHash],
    );
  }

  async storeSource(envelope: SourceEnvelope): Promise<{ sourceId: string; versionId: string; contentHash: string; duplicate: boolean }> {
    const sourceId = `src_${sha256(`${envelope.connectorId}:${envelope.externalId}`).slice(0, 24)}`;
    const contentHash = sha256(envelope.content);
    const versionId = `ver_${sha256(`${sourceId}:${contentHash}`).slice(0, 24)}`;
    const duplicateResult = await this.db.query<RowCount>(
      "SELECT count(*)::int AS count FROM source_versions WHERE source_id = $1 AND content_hash = $2",
      [sourceId, contentHash],
    );
    const duplicate = Number(duplicateResult.rows[0]?.count ?? 0) > 0;

    await this.db.query(
      `INSERT INTO sources(id, connector_id, external_id, title, kind, authority, sensitivity, taint, tags, metadata, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::timestamptz)
       ON CONFLICT(connector_id, external_id) DO UPDATE SET
         title = EXCLUDED.title, kind = EXCLUDED.kind, authority = EXCLUDED.authority,
         sensitivity = EXCLUDED.sensitivity, taint = EXCLUDED.taint, tags = EXCLUDED.tags,
         metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at`,
      [
        sourceId,
        envelope.connectorId,
        envelope.externalId,
        envelope.title,
        envelope.kind,
        envelope.authority,
        envelope.sensitivity,
        envelope.taint,
        JSON.stringify(envelope.tags),
        JSON.stringify(envelope.metadata),
        envelope.updatedAt ?? envelope.observedAt,
      ],
    );

    if (!duplicate) {
      const encrypted = encryptText(envelope.content, this.key);
      await this.db.query(
        `INSERT INTO source_versions(id, source_id, content_hash, ciphertext, iv, auth_tag, byte_length, observed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)`,
        [versionId, sourceId, contentHash, encrypted.ciphertext, encrypted.iv, encrypted.tag, Buffer.byteLength(envelope.content), envelope.observedAt],
      );
    }

    return { sourceId, versionId, contentHash, duplicate };
  }

  async replaceTopics(sourceId: string, topics: string[]): Promise<void> {
    await this.db.query("DELETE FROM source_topics WHERE source_id = $1", [sourceId]);
    for (const label of topics) {
      const topicId = `topic_${sha256(label).slice(0, 20)}`;
      await this.db.query(
        "INSERT INTO topics(id, label) VALUES ($1, $2) ON CONFLICT(label) DO NOTHING",
        [topicId, label],
      );
      await this.db.query(
        `INSERT INTO source_topics(source_id, topic_id, weight)
         SELECT $1, id, 1 FROM topics WHERE label = $2
         ON CONFLICT(source_id, topic_id) DO UPDATE SET weight = EXCLUDED.weight`,
        [sourceId, label],
      );
    }
  }

  async rebuildTopology(): Promise<number> {
    await this.db.exec("DELETE FROM memory_edges WHERE kind = 'shared_topic'");
    const pairs = await this.db.query<{ from_source_id: string; to_source_id: string; labels: string[]; weight: number }>(`
      SELECT left_topics.source_id AS from_source_id,
             right_topics.source_id AS to_source_id,
             jsonb_agg(topics.label ORDER BY topics.label) AS labels,
             count(*)::int AS weight
      FROM source_topics left_topics
      JOIN source_topics right_topics
        ON left_topics.topic_id = right_topics.topic_id
       AND left_topics.source_id < right_topics.source_id
      JOIN topics ON topics.id = left_topics.topic_id
      GROUP BY left_topics.source_id, right_topics.source_id
    `);
    for (const pair of pairs.rows) {
      const edgeId = `edge_${sha256(`${pair.from_source_id}:${pair.to_source_id}`).slice(0, 24)}`;
      await this.db.query(
        `INSERT INTO memory_edges(id, from_source_id, to_source_id, kind, labels, weight)
         VALUES ($1,$2,$3,'shared_topic',$4::jsonb,$5)
         ON CONFLICT(id) DO UPDATE SET labels = EXCLUDED.labels, weight = EXCLUDED.weight, updated_at = now()`,
        [edgeId, pair.from_source_id, pair.to_source_id, JSON.stringify(pair.labels), pair.weight],
      );
    }
    return pairs.rows.length;
  }

  async saveReceipt(receipt: MeshReceipt): Promise<void> {
    await this.db.query(
      `INSERT INTO receipts(id, action, actor, payload, occurred_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::timestamptz)
       ON CONFLICT(id) DO NOTHING`,
      [receipt.receiptId, receipt.action, receipt.actor, JSON.stringify(receipt), receipt.occurredAt],
    );
  }

  async latestReceiptDigest(): Promise<string | undefined> {
    const result = await this.db.query<{ payload: MeshReceipt }>("SELECT payload FROM receipts ORDER BY occurred_at DESC, id DESC LIMIT 1");
    return result.rows[0]?.payload ? sha256(stableJson(result.rows[0].payload)) : undefined;
  }

  async search(query: string, limit = 20): Promise<MeshSearchResult[]> {
    const pattern = `%${query.trim().replace(/[%_]/g, "\\$&")}%`;
    const result = await this.db.query<{
      id: string; title: string; connector_id: string; authority: MeshSearchResult["authority"];
      sensitivity: MeshSearchResult["sensitivity"]; taint: MeshSearchResult["taint"]; tags: string[];
      updated_at: string; topics: string[];
    }>(
      `SELECT sources.id, sources.title, sources.connector_id, sources.authority, sources.sensitivity,
              sources.taint, sources.tags, sources.updated_at::text,
              COALESCE(jsonb_agg(DISTINCT topics.label) FILTER (WHERE topics.label IS NOT NULL), '[]'::jsonb) AS topics
       FROM sources
       LEFT JOIN source_topics ON source_topics.source_id = sources.id
       LEFT JOIN topics ON topics.id = source_topics.topic_id
       WHERE sources.title ILIKE $1 OR sources.tags::text ILIKE $1 OR topics.label ILIKE $1
       GROUP BY sources.id
       ORDER BY sources.updated_at DESC
       LIMIT $2`,
      [pattern, Math.max(1, Math.min(limit, 100))],
    );
    return result.rows.map((row) => ({
      sourceId: row.id,
      title: row.title,
      connectorId: row.connector_id,
      authority: row.authority,
      sensitivity: row.sensitivity,
      taint: row.taint,
      topics: Array.isArray(row.topics) ? row.topics : [],
      updatedAt: row.updated_at,
    }));
  }

  async readSource(sourceId: string): Promise<MeshSource | null> {
    const result = await this.db.query<{
      id: string; external_id: string; title: string; connector_id: string; kind: string;
      authority: MeshSource["authority"]; sensitivity: MeshSource["sensitivity"];
      taint: MeshSource["taint"]; tags: string[]; metadata: MeshSource["metadata"];
      updated_at: string; topics: string[]; content_hash: string; ciphertext: string; iv: string; auth_tag: string;
    }>(
      `SELECT sources.id, sources.external_id, sources.title, sources.connector_id, sources.kind,
              sources.authority, sources.sensitivity, sources.taint, sources.tags, sources.metadata,
              sources.updated_at::text,
              COALESCE(jsonb_agg(DISTINCT topics.label) FILTER (WHERE topics.label IS NOT NULL), '[]'::jsonb) AS topics,
              latest.content_hash, latest.ciphertext, latest.iv, latest.auth_tag
       FROM sources
       JOIN LATERAL (
         SELECT content_hash, ciphertext, iv, auth_tag
         FROM source_versions
         WHERE source_versions.source_id = sources.id
         ORDER BY created_at DESC
         LIMIT 1
       ) latest ON true
       LEFT JOIN source_topics ON source_topics.source_id = sources.id
       LEFT JOIN topics ON topics.id = source_topics.topic_id
       WHERE sources.id = $1
       GROUP BY sources.id, latest.content_hash, latest.ciphertext, latest.iv, latest.auth_tag`,
      [sourceId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      sourceId: row.id,
      externalId: row.external_id,
      title: row.title,
      connectorId: row.connector_id,
      kind: row.kind,
      authority: row.authority,
      sensitivity: row.sensitivity,
      taint: row.taint,
      tags: Array.isArray(row.tags) ? row.tags : [],
      metadata: row.metadata ?? {},
      topics: Array.isArray(row.topics) ? row.topics : [],
      updatedAt: row.updated_at,
      contentHash: row.content_hash,
      mimeType: typeof row.metadata?.mimeType === "string" ? row.metadata.mimeType : "text/plain",
      content: decryptText({ ciphertext: row.ciphertext, iv: row.iv, tag: row.auth_tag }, this.key),
    };
  }

  async stats(): Promise<{ sources: number; versions: number; topics: number; edges: number; receipts: number }> {
    const result = await this.db.query<{ sources: number; versions: number; topics: number; edges: number; receipts: number }>(`
      SELECT
        (SELECT count(*)::int FROM sources) AS sources,
        (SELECT count(*)::int FROM source_versions) AS versions,
        (SELECT count(*)::int FROM topics) AS topics,
        (SELECT count(*)::int FROM memory_edges) AS edges,
        (SELECT count(*)::int FROM receipts) AS receipts
    `);
    return result.rows[0] ?? { sources: 0, versions: 0, topics: 0, edges: 0, receipts: 0 };
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
