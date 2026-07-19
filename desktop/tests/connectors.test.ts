import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryWeaverRuntime } from "../src/runtime.js";

test("native Pieces metadata and BrainSync approved exports ingest without raw app data", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "memory-weaver-connectors-"));
  const previousHome = process.env.MEMORY_WEAVER_HOME;
  process.env.MEMORY_WEAVER_HOME = path.join(temporary, "runtime");
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ iterable: [{
      id: "piece-1",
      name: "Memory Fabric notes",
      updated: { value: "2026-07-19T00:00:00.000Z" },
      formats: { iterable: [{ classification: { generic: "CODE", specific: "md" }, role: "BOTH", raw: "must-not-leak" }] },
    }] }));
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port");
    const exports = path.join(temporary, "brainsync-exports");
    await mkdir(exports, { recursive: true });
    await writeFile(path.join(exports, "daily.approved.json"), JSON.stringify({
      schemaVersion: "memory-weaver.brainsync-export.v1",
      exportId: "daily-1",
      approvedAt: "2026-07-19T00:00:00.000Z",
      entries: [{ id: "entry-1", title: "Approved context", content: "memory fabric memory fabric", sourceRef: "brainsync:entry-1", tags: ["memory"] }],
    }), "utf8");
    const config = path.join(temporary, "mesh.config.json");
    await writeFile(config, JSON.stringify({
      schemaVersion: "memory-weaver.permissions.v2",
      vaultId: "connector-test",
      revision: 1,
      revocationEpoch: 0,
      defaultDeny: true,
      localOnly: true,
      networkEgress: "deny",
      connectors: [
        {
          id: "pieces",
          kind: "pieces",
          enabled: true,
          capabilities: ["read"],
          scopes: [`http://127.0.0.1:${address.port}/assets`],
          authority: "working",
          sensitivity: "private",
        },
        {
          id: "brainsync",
          kind: "brainsync",
          enabled: true,
          capabilities: ["read"],
          scopes: [exports],
          authority: "approved",
          sensitivity: "private",
        },
      ],
    }), "utf8");

    const runtime = await MemoryWeaverRuntime.open(config);
    const runs = await runtime.scan();
    assert.equal(runs.find((run) => run.connectorId === "pieces")?.ingested, 1);
    assert.equal(runs.find((run) => run.connectorId === "brainsync")?.ingested, 1);
    assert.equal((await runtime.status()).vault.sources, 2);
    const pieces = (await runtime.search("Memory Fabric"))[0];
    assert.ok(pieces);
    const source = await runtime.readSource(pieces.sourceId);
    assert.doesNotMatch(source?.content ?? "", /must-not-leak/);
    assert.match(source?.content ?? "", /metadataOnly|formats/);
    await runtime.close();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousHome === undefined) delete process.env.MEMORY_WEAVER_HOME;
    else process.env.MEMORY_WEAVER_HOME = previousHome;
    await rm(temporary, { recursive: true, force: true });
  }
});

test("BrainSync rejects raw or unapproved state files", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "memory-weaver-brainsync-reject-"));
  const previousHome = process.env.MEMORY_WEAVER_HOME;
  process.env.MEMORY_WEAVER_HOME = path.join(temporary, "runtime");
  try {
    const rawState = path.join(temporary, "shared-context.json");
    await writeFile(rawState, JSON.stringify({ v: 1, entries: [{ id: "opaque", data: "ciphertext" }] }), "utf8");
    const config = path.join(temporary, "mesh.config.json");
    await writeFile(config, JSON.stringify({
      schemaVersion: "memory-weaver.permissions.v2",
      vaultId: "reject-test",
      revision: 1,
      revocationEpoch: 0,
      defaultDeny: true,
      localOnly: true,
      networkEgress: "deny",
      connectors: [{ id: "brainsync", kind: "brainsync", enabled: true, capabilities: ["read"], scopes: [rawState], authority: "approved", sensitivity: "private" }],
    }), "utf8");
    const runtime = await MemoryWeaverRuntime.open(config);
    const [run] = await runtime.scan();
    assert.equal(run.ingested, 0);
    assert.equal(run.failed, 1);
    assert.match(run.warnings.join(" "), /schemaVersion|Invalid literal/i);
    assert.equal((await runtime.status()).vault.sources, 0);
    await runtime.close();
  } finally {
    if (previousHome === undefined) delete process.env.MEMORY_WEAVER_HOME;
    else process.env.MEMORY_WEAVER_HOME = previousHome;
    await rm(temporary, { recursive: true, force: true });
  }
});
