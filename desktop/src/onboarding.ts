import { rename, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { MemoryCartographer, type DiscoveryCandidate, type DiscoveryReport } from "./cartographer.js";
import { initializeManifest, loadManifest, type RuntimePaths } from "./config.js";
import type { ConnectorPermission, PermissionManifest } from "./types.js";

const safeId = (value: string): string => value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

export const connectorFromCandidate = (candidate: DiscoveryCandidate): ConnectorPermission | null => {
  const kind = candidate.recommended.kind;
  if (!kind || !candidate.recommended.scopes.length) return null;
  const scopes = kind === "pieces" ? candidate.detectedEndpoints
    : kind === "gmail" ? ["https://gmail.googleapis.com/gmail/v1/users/me"]
      : candidate.recommended.scopes;
  if (!scopes.length) return null;
  const credentialRef = kind === "gmail" && candidate.detectedCredentialNames.includes("GMAIL_ACCESS_TOKEN")
    ? "env:GMAIL_ACCESS_TOKEN"
    : undefined;
  if (kind === "gmail" && !credentialRef) return null;
  return {
    id: safeId(candidate.catalogId),
    kind,
    enabled: true,
    capabilities: kind === "filesystem" || kind === "obsidian" ? ["discover", "read"] : ["read"],
    scopes,
    maxItemBytes: kind === "gmail" || kind === "pieces" ? 4 * 1024 * 1024 : 2 * 1024 * 1024,
    authority: "working",
    sensitivity: "private",
    credentialRef,
    settings: kind === "filesystem"
      ? { indexAllFiles: true, maxItemsPerRun: 500, maxDepth: 24, maxBinaryHashBytes: 64 * 1024 * 1024 }
      : kind === "gmail"
        ? { maxItemsPerRun: 100, includeSpamTrash: false, labelIds: [] }
        : { maxItemsPerRun: 500, timeoutMs: 10_000 },
  };
};

export const manifestFromCandidates = (vaultId: string, candidates: DiscoveryCandidate[]): PermissionManifest => ({
  schemaVersion: "memory-weaver.permissions.v2",
  vaultId,
  revision: 1,
  revocationEpoch: 0,
  defaultDeny: true,
  localOnly: !candidates.some((candidate) => candidate.recommended.kind === "gmail"),
  networkEgress: candidates.some((candidate) => candidate.recommended.kind === "gmail") ? "allow-explicit" : "deny",
  connectors: candidates.map(connectorFromCandidate).filter((connector): connector is ConnectorPermission => Boolean(connector)),
});

const writeManifest = async (paths: RuntimePaths, manifest: PermissionManifest): Promise<void> => {
  const temporary = `${paths.config}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, paths.config);
};

const candidateSummary = (candidate: DiscoveryCandidate): string => {
  const locations = candidate.detectedPaths.length + candidate.detectedEndpoints.length;
  return `${candidate.label} (${candidate.support}; ${locations} location${locations === 1 ? "" : "s"})`;
};

export const runGuidedOnboarding = async (paths: RuntimePaths, report?: DiscoveryReport): Promise<{
  manifest: PermissionManifest;
  selected: string[];
}> => {
  await initializeManifest(paths);
  const current = await loadManifest(paths.config);
  if (current.connectors.length) throw new Error("Onboarding will not overwrite an existing connector manifest");
  if (!input.isTTY || !output.isTTY) throw new Error("Guided onboarding requires an interactive terminal; use discover for a read-only JSON inventory");
  const discovery = report ?? await new MemoryCartographer().discover();
  const connectable = discovery.candidates.filter((candidate) => connectorFromCandidate(candidate));
  const prompts = createInterface({ input, output });
  const selected: DiscoveryCandidate[] = [];
  try {
    output.write(`\nMemory Weaver found ${discovery.candidates.length} possible sources. Nothing is connected yet.\n\n`);
    for (const candidate of connectable) {
      const answer = await prompts.question(`Connect ${candidateSummary(candidate)} read-only? [y/N] `);
      if (/^y(?:es)?$/i.test(answer.trim())) selected.push(candidate);
    }
    const vaultAnswer = await prompts.question("\nName this private memory weave [personal-mesh]: ");
    const vaultId = safeId(vaultAnswer.trim() || "personal-mesh") || "personal-mesh";
    const manifest = manifestFromCandidates(vaultId, selected);
    await writeManifest(paths, manifest);
    return { manifest, selected: selected.map((candidate) => candidate.catalogId) };
  } finally {
    prompts.close();
  }
};
