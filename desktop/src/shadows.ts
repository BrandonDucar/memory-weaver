import { access } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./crypto.js";
import type { MemoryShadow, MemoryShadowKind, MeshSource } from "./types.js";
import { LocalMeshVault } from "./vault.js";

const exists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
};

const normalizedTitle = (value: string): string => path.basename(value).replace(/\.[^.]+$/, "").trim().toLowerCase();

export class ShadowIndex {
  constructor(private readonly vault: LocalMeshVault) {}

  async scan(limit = 2000): Promise<MemoryShadow[]> {
    const sources = (await Promise.all((await this.vault.sourceIds(limit)).map((sourceId) => this.vault.readSource(sourceId))))
      .filter((source): source is MeshSource => Boolean(source));
    const knownTitles = new Set(sources.map((source) => normalizedTitle(source.title)));
    const found = new Map<string, MemoryShadow>();
    const observedAt = new Date().toISOString();

    const remember = (
      kind: MemoryShadowKind,
      label: string,
      reference: string,
      sourceId: string,
      confidence: MemoryShadow["confidence"],
      explanation: string,
    ): void => {
      const key = `${kind}:${reference.toLowerCase()}`;
      const existing = found.get(key);
      if (existing) {
        if (!existing.evidenceSourceIds.includes(sourceId)) existing.evidenceSourceIds.push(sourceId);
        return;
      }
      found.set(key, {
        shadowId: `shadow_${sha256(key).slice(0, 24)}`,
        kind,
        label,
        reference,
        confidence,
        evidenceSourceIds: [sourceId],
        explanation,
        observedAt,
      });
    };

    for (const source of sources) {
      for (const match of source.content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
        const reference = match[1]?.trim();
        if (reference && !knownTitles.has(normalizedTitle(reference))) {
          remember("broken-link", reference, reference, source.sourceId, "medium", "A wikilink names an item that is not present in the approved source vault.");
        }
      }
      for (const match of source.content.matchAll(/\]\(([^)]+)\)/g)) {
        const raw = match[1]?.trim().replace(/^<|>$/g, "");
        if (!raw || /^(?:https?:|mailto:|#)/i.test(raw)) continue;
        const sourcePath = typeof source.metadata.path === "string" ? source.metadata.path : undefined;
        let decoded = raw;
        try {
          decoded = decodeURIComponent(raw);
        } catch {
          // Keep the literal reference if it is not valid URL encoding.
        }
        const candidate = path.isAbsolute(decoded) ? decoded : sourcePath ? path.resolve(path.dirname(sourcePath), decoded) : undefined;
        if (candidate && !(await exists(candidate))) {
          remember("missing-path", path.basename(candidate), candidate, source.sourceId, "high", "A source points to a local path that is no longer present at that location.");
        }
      }
      const attachmentCount = Number(source.metadata.attachmentCount ?? 0);
      if (source.kind === "email" && attachmentCount > 0 && typeof source.metadata.attachments === "string") {
        try {
          const attachments = JSON.parse(source.metadata.attachments) as Array<{ filename?: string; attachmentId?: string }>;
          for (const attachment of attachments) {
            if (!attachment.filename || !attachment.attachmentId) continue;
            remember("referenced-attachment", attachment.filename, attachment.attachmentId, source.sourceId, "high", "The email references an attachment whose content has not been copied into Memory Weaver.");
          }
        } catch {
          // Malformed connector metadata is not promoted into a shadow.
        }
      }
    }
    const shadows = Array.from(found.values()).slice(0, 2000);
    await this.vault.replaceMemoryShadows(shadows);
    return shadows;
  }
}
