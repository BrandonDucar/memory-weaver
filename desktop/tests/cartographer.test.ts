import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryCartographer } from "../src/cartographer.js";
import { manifestFromCandidates } from "../src/onboarding.js";

test("Memory Cartographer discovers candidates without reading or approving content", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "memory-weaver-cartographer-"));
  const previousToken = process.env.GMAIL_ACCESS_TOKEN;
  process.env.GMAIL_ACCESS_TOKEN = "discovery-only-placeholder";
  try {
    await mkdir(path.join(home, "Documents", "sample-project", ".git"), { recursive: true });
    await mkdir(path.join(home, "Pictures", "Camera Roll"), { recursive: true });
    await mkdir(path.join(home, ".codex"), { recursive: true });
    const report = await new MemoryCartographer(home, false).discover();
    assert.equal(report.schemaVersion, "memory-weaver.discovery.v1");
    assert.ok(report.catalogEntries > 25);
    assert.ok(report.candidates.some((candidate) => candidate.catalogId === "photos"));
    assert.ok(report.candidates.some((candidate) => candidate.catalogId === "codex"));
    assert.ok(report.candidates.some((candidate) => candidate.catalogId === "github" && candidate.detectedPaths.some((item) => item.endsWith("sample-project"))));
    const gmail = report.candidates.find((candidate) => candidate.catalogId === "gmail");
    assert.deepEqual(gmail?.detectedCredentialNames, ["GMAIL_ACCESS_TOKEN"]);
    assert.ok(report.candidates.every((candidate) => candidate.requiresApproval && !candidate.sourceContentRead));
    const selected = report.candidates.filter((candidate) => ["photos", "gmail"].includes(candidate.catalogId));
    const manifest = manifestFromCandidates("first-weave", selected);
    assert.equal(manifest.connectors.length, 2);
    assert.equal(manifest.localOnly, false);
    assert.equal(manifest.networkEgress, "allow-explicit");
    assert.ok(manifest.connectors.every((connector) => !connector.capabilities.includes("mcp")));
    assert.deepEqual(manifest.connectors.find((connector) => connector.kind === "gmail")?.credentialRef, "env:GMAIL_ACCESS_TOKEN");
  } finally {
    if (previousToken === undefined) delete process.env.GMAIL_ACCESS_TOKEN;
    else process.env.GMAIL_ACCESS_TOKEN = previousToken;
    await rm(home, { recursive: true, force: true });
  }
});
