import { KoiDream } from "../koidream.js";
import { MeshPolicy } from "../policy.js";
import type { ConnectorPermission, ConnectorRunResult, SourceEnvelope } from "../types.js";
import { LocalMeshVault } from "../vault.js";
import { assertExactScope, assertNetworkAllowed, boundedBody, connectorLimit, envValue, timeoutMs } from "./helpers.js";

interface GmailListResponse {
  messages?: Array<{ id?: string; threadId?: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

interface GmailBackfillState {
  nextPageToken?: string;
  lastCompletedAt?: string;
  estimatedMessages?: number;
}

const decodeBase64Url = (value: string | undefined): string => {
  if (!value) return "";
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
};

const headerMap = (part: GmailPart | undefined): Record<string, string> => Object.fromEntries(
  (part?.headers ?? [])
    .filter((header) => typeof header.name === "string" && typeof header.value === "string")
    .map((header) => [header.name!.toLowerCase(), header.value!]),
);

const collectParts = (part: GmailPart | undefined): GmailPart[] => part
  ? [part, ...(part.parts ?? []).flatMap((child) => collectParts(child))]
  : [];

const stripHtml = (value: string): string => value
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ")
  .trim();

const messageContent = (message: GmailMessage): { content: string; attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> } => {
  const headers = headerMap(message.payload);
  const parts = collectParts(message.payload);
  const plain = parts.map((part) => part.mimeType === "text/plain" ? decodeBase64Url(part.body?.data) : "").find(Boolean);
  const html = parts.map((part) => part.mimeType === "text/html" ? decodeBase64Url(part.body?.data) : "").find(Boolean);
  const attachments = parts
    .filter((part) => part.body?.attachmentId)
    .map((part) => ({
      filename: part.filename || "unnamed attachment",
      mimeType: part.mimeType || "application/octet-stream",
      size: Number(part.body?.size ?? 0),
      attachmentId: part.body!.attachmentId!,
    }));
  const body = plain || (html ? stripHtml(html) : "") || message.snippet || "";
  return {
    content: [
      `Subject: ${headers.subject ?? "(no subject)"}`,
      `From: ${headers.from ?? ""}`,
      `To: ${headers.to ?? ""}`,
      headers.cc ? `Cc: ${headers.cc}` : "",
      `Date: ${headers.date ?? ""}`,
      "",
      body,
      attachments.length ? `\nAttachments:\n${attachments.map((attachment) => `- ${attachment.filename} (${attachment.mimeType}, ${attachment.size} bytes)`).join("\n")}` : "",
    ].filter((line) => line !== "").join("\n"),
    attachments,
  };
};

export class GmailConnector {
  constructor(
    readonly permission: ConnectorPermission,
    private readonly policy: MeshPolicy,
    private readonly koiDream: KoiDream,
    private readonly vault: LocalMeshVault,
  ) {}

  async scan(): Promise<ConnectorRunResult> {
    this.policy.require(this.permission.id, "read");
    const result: ConnectorRunResult = { connectorId: this.permission.id, scanned: 0, ingested: 0, duplicates: 0, failed: 0, warnings: [] };
    const token = envValue(this.permission.credentialRef, "Gmail OAuth access token");
    const limit = connectorLimit(this.permission, 100);
    const state = await this.vault.getConnectorState<GmailBackfillState>(this.permission.id, "backfill") ?? {};
    const scope = this.permission.scopes[0];
    if (!scope || this.permission.scopes.length !== 1) throw new Error("Gmail requires one exact API user scope");
    assertExactScope(scope, "Gmail");
    const base = new URL(scope.replace(/\/$/, ""));
    if (base.protocol !== "https:" || base.hostname !== "gmail.googleapis.com" || !base.pathname.endsWith("/users/me")) {
      throw new Error("Gmail scope must be https://gmail.googleapis.com/gmail/v1/users/me");
    }
    assertNetworkAllowed(base, this.policy.manifest.localOnly, this.policy.manifest.networkEgress);
    const headers = { authorization: `Bearer ${token}` };
    let pageToken = state.nextPageToken;
    let remaining = limit;
    let nextPageToken: string | undefined;
    let estimate = state.estimatedMessages;

    while (remaining > 0) {
      const listUrl = new URL(`${base.toString()}/messages`);
      listUrl.searchParams.set("maxResults", String(Math.min(100, remaining)));
      if (pageToken) listUrl.searchParams.set("pageToken", pageToken);
      if (this.permission.settings?.includeSpamTrash === true) listUrl.searchParams.set("includeSpamTrash", "true");
      if (typeof this.permission.settings?.query === "string" && this.permission.settings.query) listUrl.searchParams.set("q", this.permission.settings.query);
      const labelIds = Array.isArray(this.permission.settings?.labelIds) ? this.permission.settings.labelIds : [];
      for (const labelId of labelIds) listUrl.searchParams.append("labelIds", labelId);
      const listResponse = await fetch(listUrl, { headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs(this.permission, 20_000)) });
      if (!listResponse.ok) throw new Error(`Gmail list returned HTTP ${listResponse.status}`);
      const page = JSON.parse(await boundedBody(listResponse, 2 * 1024 * 1024)) as GmailListResponse;
      estimate = page.resultSizeEstimate ?? estimate;
      const messages = page.messages ?? [];
      if (!messages.length) break;

      for (const item of messages) {
        if (!item.id || remaining <= 0) continue;
        remaining -= 1;
        result.scanned += 1;
        try {
          const messageUrl = new URL(`${base.toString()}/messages/${encodeURIComponent(item.id)}`);
          messageUrl.searchParams.set("format", "full");
          const messageResponse = await fetch(messageUrl, { headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs(this.permission, 20_000)) });
          if (!messageResponse.ok) throw new Error(`Gmail message returned HTTP ${messageResponse.status}`);
          const message = JSON.parse(await boundedBody(messageResponse, this.permission.maxItemBytes ?? 4 * 1024 * 1024)) as GmailMessage;
          const messageHeaders = headerMap(message.payload);
          const parsed = messageContent(message);
          const occurredAt = message.internalDate && /^\d+$/.test(message.internalDate)
            ? new Date(Number(message.internalDate)).toISOString()
            : new Date().toISOString();
          const envelope: SourceEnvelope = {
            schemaVersion: "memory-weaver.source.v1",
            connectorId: this.permission.id,
            externalId: item.id,
            title: messageHeaders.subject || "(no subject)",
            kind: "email",
            content: parsed.content,
            mimeType: "message/rfc822",
            observedAt: new Date().toISOString(),
            updatedAt: occurredAt,
            authority: this.permission.authority,
            sensitivity: this.permission.sensitivity,
            taint: "untrusted",
            tags: ["gmail", "email", ...(message.labelIds ?? []).slice(0, 12)],
            metadata: {
              gmailMessageId: item.id,
              threadId: message.threadId ?? item.threadId ?? null,
              from: messageHeaders.from ?? null,
              to: messageHeaders.to ?? null,
              date: messageHeaders.date ?? null,
              attachmentCount: parsed.attachments.length,
              attachments: JSON.stringify(parsed.attachments),
              readOnlyImport: true,
              mimeType: "message/rfc822",
            },
          };
          const ingest = await this.koiDream.ingest(envelope);
          if (ingest.duplicate) result.duplicates += 1;
          else result.ingested += 1;
        } catch (error) {
          result.failed += 1;
          result.warnings.push(`Gmail message ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      nextPageToken = page.nextPageToken;
      if (!nextPageToken || remaining <= 0) break;
      pageToken = nextPageToken;
    }

    await this.vault.setConnectorState(this.permission.id, "backfill", {
      nextPageToken,
      lastCompletedAt: nextPageToken ? state.lastCompletedAt : new Date().toISOString(),
      estimatedMessages: estimate,
    } satisfies GmailBackfillState);
    if (nextPageToken) result.warnings.push("Gmail backfill is incomplete and will continue from the saved page token on the next scan");
    return result;
  }
}
