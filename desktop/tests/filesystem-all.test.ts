import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryWeaverRuntime } from "../src/runtime.js";

test("all-file indexing stores media and secret-bearing files as metadata only", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "memory-weaver-all-files-"));
  const previousHome = process.env.MEMORY_WEAVER_HOME;
  process.env.MEMORY_WEAVER_HOME = path.join(temporary, "runtime");
  let runtime: MemoryWeaverRuntime | undefined;
  try {
    const files = path.join(temporary, "files");
    await mkdir(files, { recursive: true });
    await writeFile(path.join(files, "memory.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]));
    await writeFile(path.join(files, ".env"), "DO_NOT_INDEX_THIS_SECRET=needle-value", "utf8");
    const config = path.join(temporary, "mesh.config.json");
    await writeFile(config, JSON.stringify({
      schemaVersion: "memory-weaver.permissions.v2",
      vaultId: "all-files-test",
      revision: 1,
      revocationEpoch: 0,
      defaultDeny: true,
      localOnly: true,
      networkEgress: "deny",
      connectors: [{
        id: "whole-computer",
        kind: "filesystem",
        enabled: true,
        capabilities: ["discover", "read", "mcp"],
        scopes: [files],
        maxItemBytes: 1024,
        settings: { indexAllFiles: true, maxItemsPerRun: 10 },
        authority: "working",
        sensitivity: "private",
      }],
    }), "utf8");
    runtime = await MemoryWeaverRuntime.open(config);
    const scan = await runtime.scan();
    assert.equal(scan[0]?.ingested, 2);
    const photoMatch = (await runtime.search("memory.jpg", 5, true))[0];
    assert.ok(photoMatch);
    const photo = await runtime.readSource(photoMatch.sourceId, true);
    const photoMetadata = JSON.parse(photo?.content ?? "{}") as Record<string, unknown>;
    assert.equal(photoMetadata.metadataOnly, true);
    assert.equal(photoMetadata.category, "image");
    assert.match(String(photoMetadata.fingerprint), /^[a-f0-9]{64}$/);
    const secretMatch = (await runtime.search(".env", 5, true))[0];
    assert.ok(secretMatch);
    const secret = await runtime.readSource(secretMatch.sourceId, true);
    assert.doesNotMatch(secret?.content ?? "", /needle-value/);
    assert.equal(secret?.metadata.secretContentExcluded, true);
  } finally {
    await runtime?.close();
    if (previousHome === undefined) delete process.env.MEMORY_WEAVER_HOME;
    else process.env.MEMORY_WEAVER_HOME = previousHome;
    await rm(temporary, { recursive: true, force: true });
  }
});
