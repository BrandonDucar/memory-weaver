import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryWeaverRuntime } from "../src/runtime.js";

test("KoiDream and Gourami persist, redact, dedupe, and weave approved files", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "memory-weaver-test-"));
  const previousHome = process.env.MEMORY_WEAVER_HOME;
  process.env.MEMORY_WEAVER_HOME = path.join(temporary, "runtime");
  try {
    const notes = path.join(temporary, "notes");
    await mkdir(notes, { recursive: true });
    await writeFile(path.join(notes, "alpha.md"), "# Alpha\nmesh memory mesh memory\nRelated: [[Lost Note]]\nsk-testsecret0123456789012345", "utf8");
    await writeFile(path.join(notes, "beta.md"), "# Beta\nmesh topology mesh topology", "utf8");
    const config = path.join(temporary, "mesh.config.json");
    await writeFile(config, JSON.stringify({
      schemaVersion: "memory-weaver.permissions.v2",
      vaultId: "test-mesh",
      revision: 1,
      revocationEpoch: 0,
      defaultDeny: true,
      localOnly: true,
      networkEgress: "deny",
      connectors: [{
        id: "notes",
        kind: "filesystem",
        enabled: true,
        capabilities: ["discover", "read", "mcp"],
        scopes: [notes],
        extensions: [".md"],
        authority: "working",
        sensitivity: "private",
      }],
    }), "utf8");

    let runtime = await MemoryWeaverRuntime.open(config);
    const first = await runtime.scan();
    assert.equal(first[0]?.ingested, 2);
    assert.equal((await runtime.status()).vault.edges, 1);
    assert.equal((await runtime.status()).vault.receipts, 4);
    const report = await runtime.report();
    assert.equal(report.sources, 2);
    assert.equal(report.edges, 1);
    assert.equal(report.isolatedSources, 0);
    assert.equal(report.topTopics[0]?.label, "mesh");
    const matches = await runtime.search("mesh", 10, true);
    assert.equal(matches.length, 2);
    const alpha = matches.find((item) => item.title === "alpha.md");
    assert.ok(alpha);
    const source = await runtime.readSource(alpha.sourceId, true);
    assert.match(source?.content ?? "", /\[REDACTED\]/);
    assert.doesNotMatch(source?.content ?? "", /sk-testsecret/);
    assert.equal(first[0]?.warnings.length, 0);

    const initialAnalysis = await runtime.initialAnalysis();
    assert.equal(initialAnalysis.brief.kind, "initial");
    assert.equal(initialAnalysis.receipt.actor, "steward");
    assert.ok(initialAnalysis.brief.headlines.length > 0);
    assert.ok(initialAnalysis.brief.questions.length > 0);
    assert.equal(initialAnalysis.brief.shadows.total, 1);
    assert.equal(initialAnalysis.brief.shadows.samples[0]?.label, "Lost Note");
    assert.equal((await runtime.latestBrief("initial"))?.briefId, initialAnalysis.brief.briefId);

    const second = await runtime.scan();
    assert.equal(second[0]?.duplicates, 2);
    assert.equal((await runtime.status()).vault.versions, 2);
    assert.equal((await runtime.status()).vault.receipts, 6);
    await runtime.close();

    runtime = await MemoryWeaverRuntime.open(config);
    assert.equal((await runtime.status()).vault.sources, 2);
    assert.equal((await runtime.status()).vault.versions, 2);
    await runtime.close();
    const encryptionKey = await readFile(path.join(temporary, "runtime", "vault.key"), "utf8");
    const signingKey = await readFile(path.join(temporary, "runtime", "receipt-signing.pem"), "utf8");
    const signingPublicKey = await readFile(path.join(temporary, "runtime", "receipt-signing.pub.pem"), "utf8");
    assert.ok(encryptionKey.trim().length > 30);
    assert.match(signingKey, /PRIVATE KEY/);
    assert.match(signingPublicKey, /PUBLIC KEY/);
  } finally {
    if (previousHome === undefined) delete process.env.MEMORY_WEAVER_HOME;
    else process.env.MEMORY_WEAVER_HOME = previousHome;
    await rm(temporary, { recursive: true, force: true });
  }
});
