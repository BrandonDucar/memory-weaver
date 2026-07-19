import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { MeshPolicy, PermissionDeniedError } from "../src/policy.js";
import type { PermissionManifest } from "../src/types.js";

const root = path.resolve("test-fixtures", "approved");
const manifest: PermissionManifest = {
  schemaVersion: "memory-weaver.permissions.v2",
  vaultId: "test-vault",
  revision: 1,
  revocationEpoch: 0,
  defaultDeny: true,
  localOnly: true,
  networkEgress: "deny",
  connectors: [{
    id: "notes",
    kind: "filesystem",
    enabled: true,
    capabilities: ["discover", "read"],
    scopes: [root],
    authority: "working",
    sensitivity: "private",
  }],
};

test("default-deny policy confines reads to approved roots", () => {
  const policy = new MeshPolicy(manifest);
  assert.equal(policy.requireFilesystemPath("notes", path.join(root, "inside.md"), "read"), path.join(root, "inside.md"));
  assert.throws(() => policy.requireFilesystemPath("notes", path.resolve("outside.md"), "read"), PermissionDeniedError);
  assert.throws(() => policy.require("notes", "writeback"), PermissionDeniedError);
  assert.equal(policy.allows("notes", "mcp"), false);
});

test("writeback remains unavailable even when a connector requests it", () => {
  const policy = new MeshPolicy({
    ...manifest,
    connectors: [{ ...manifest.connectors[0], capabilities: ["read", "writeback"], scopes: ["approved-target"] }],
  });
  assert.throws(() => policy.requireWriteback(), PermissionDeniedError);
});
