import assert from "node:assert/strict";
import test from "node:test";
import {
  createDemoWorkspace,
  redactSecrets,
  stableHash,
  weaveSources,
} from "../app/lib/weaver.ts";

test("redacts common credential shapes before weaving", () => {
  const source = "token sk-example_example_example_123456 and ghp_abcdefghijklmnopqrstuvwxyz123456";
  const redacted = redactSecrets(source);
  assert.doesNotMatch(redacted, /sk-example|ghp_/);
  assert.match(redacted, /\[REDACTED\]/);
});

test("produces deterministic graph hashes from stable inputs", () => {
  const workspace = createDemoWorkspace();
  const now = new Date("2026-07-18T20:00:00.000Z");
  const first = weaveSources(workspace.sources, now);
  const second = weaveSources(workspace.sources, now);
  assert.equal(first.receipt.inputHash, second.receipt.inputHash);
  assert.equal(first.receipt.outputHash, second.receipt.outputHash);
  assert.equal(first.topics.length, second.topics.length);
  assert.ok(first.edges.some((edge) => edge.kind === "related"));
});

test("finds stale and orphaned source conditions", () => {
  const workspace = createDemoWorkspace();
  const result = weaveSources(workspace.sources, new Date("2026-07-18T20:00:00.000Z"));
  assert.ok(result.issues.some((issue) => issue.type === "stale"));
  assert.ok(result.issues.some((issue) => issue.type === "orphan"));
  assert.ok(result.issues.some((issue) => issue.type === "conflict"));
  assert.match(stableHash("memory-weaver"), /^fnv1a-[a-f0-9]{8}$/);
});
