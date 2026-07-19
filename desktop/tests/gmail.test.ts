import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryWeaverRuntime } from "../src/runtime.js";

const encoded = (value: string): string => Buffer.from(value).toString("base64url");

test("Gmail adapter performs read-only incremental message backfill", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "memory-weaver-gmail-"));
  const previousHome = process.env.MEMORY_WEAVER_HOME;
  const previousToken = process.env.TEST_GMAIL_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.MEMORY_WEAVER_HOME = path.join(temporary, "runtime");
  process.env.TEST_GMAIL_TOKEN = "local-test-token";
  const calls: Array<{ url: string; method: string }> = [];
  let runtime: MemoryWeaverRuntime | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.includes("/messages?") && !url.includes("pageToken=")) {
      return Response.json({ messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "page-2", resultSizeEstimate: 2 });
    }
    if (url.includes("/messages?") && url.includes("pageToken=page-2")) {
      return Response.json({ messages: [{ id: "m2", threadId: "t2" }], resultSizeEstimate: 2 });
    }
    const id = url.includes("/m2?") ? "m2" : "m1";
    return Response.json({
      id,
      threadId: id === "m1" ? "t1" : "t2",
      labelIds: ["INBOX"],
      internalDate: "1784428800000",
      snippet: `Snippet ${id}`,
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Subject", value: `Subject ${id}` },
          { name: "From", value: "sender@example.com" },
          { name: "To", value: "owner@example.com" },
        ],
        body: { data: encoded(`Message body ${id}`), size: 15 },
      },
    });
  }) as typeof fetch;
  try {
    const config = path.join(temporary, "mesh.config.json");
    await writeFile(config, JSON.stringify({
      schemaVersion: "memory-weaver.permissions.v2",
      vaultId: "gmail-test",
      revision: 1,
      revocationEpoch: 0,
      defaultDeny: true,
      localOnly: false,
      networkEgress: "allow-explicit",
      connectors: [{
        id: "gmail",
        kind: "gmail",
        enabled: true,
        capabilities: ["read", "mcp"],
        scopes: ["https://gmail.googleapis.com/gmail/v1/users/me"],
        credentialRef: "env:TEST_GMAIL_TOKEN",
        maxItemBytes: 1048576,
        settings: { maxItemsPerRun: 1 },
        authority: "working",
        sensitivity: "private",
      }],
    }), "utf8");
    runtime = await MemoryWeaverRuntime.open(config);
    const first = await runtime.scan();
    assert.equal(first[0]?.ingested, 1);
    assert.match(first[0]?.warnings[0] ?? "", /backfill is incomplete/);
    const second = await runtime.scan();
    assert.equal(second[0]?.ingested, 1);
    assert.equal((await runtime.search("Subject", 10, true)).length, 2);
    assert.ok(calls.every((call) => call.method === "GET"));
    assert.ok(calls.some((call) => call.url.includes("pageToken=page-2")));
  } finally {
    await runtime?.close();
    globalThis.fetch = previousFetch;
    if (previousHome === undefined) delete process.env.MEMORY_WEAVER_HOME;
    else process.env.MEMORY_WEAVER_HOME = previousHome;
    if (previousToken === undefined) delete process.env.TEST_GMAIL_TOKEN;
    else process.env.TEST_GMAIL_TOKEN = previousToken;
    await rm(temporary, { recursive: true, force: true });
  }
});
