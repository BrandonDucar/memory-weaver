import { access, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CONNECTOR_CATALOG, type ConnectorCatalogEntry } from "./catalog.js";

export interface DiscoveryCandidate {
  catalogId: string;
  label: string;
  category: ConnectorCatalogEntry["category"];
  support: ConnectorCatalogEntry["status"];
  reason: string;
  detectedPaths: string[];
  detectedCredentialNames: string[];
  detectedEndpoints: string[];
  recommended: {
    kind?: ConnectorCatalogEntry["connectorKind"];
    capabilities: ["discover", "read"] | ["read"];
    scopes: string[];
  };
  requiresApproval: true;
  sourceContentRead: false;
}

export interface DiscoveryReport {
  schemaVersion: "memory-weaver.discovery.v1";
  generatedAt: string;
  home: string;
  catalogEntries: number;
  candidates: DiscoveryCandidate[];
  note: string;
}

const exists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
};

const probe = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(750) });
    await response.body?.cancel();
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
};

const findGitRepositories = async (roots: string[], max = 30): Promise<string[]> => {
  const repositories: string[] = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 3 || repositories.length >= max || !(await exists(directory))) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isDirectory() && entry.name === ".git")) {
      repositories.push(directory);
      return;
    }
    for (const entry of entries) {
      if (repositories.length >= max) return;
      if (!entry.isDirectory() || entry.isSymbolicLink() || ["AppData", "node_modules", ".git"].includes(entry.name)) continue;
      await walk(path.join(directory, entry.name), depth + 1);
    }
  };
  for (const root of roots) await walk(root, 0);
  return repositories;
};

export class MemoryCartographer {
  constructor(
    private readonly home = os.homedir(),
    private readonly probeLoopback = true,
  ) {}

  async discover(): Promise<DiscoveryReport> {
    const candidates: DiscoveryCandidate[] = [];
    for (const entry of CONNECTOR_CATALOG) {
      const detectedPaths: string[] = [];
      for (const signal of entry.pathSignals ?? []) {
        const candidate = path.join(this.home, ...signal);
        if (await exists(candidate)) detectedPaths.push(candidate);
      }
      const detectedCredentialNames = (entry.envSignals ?? []).filter((name) => Boolean(process.env[name]));
      const detectedEndpoints = this.probeLoopback && entry.loopback && await probe(entry.loopback.url) ? [entry.loopback.url] : [];
      if (!detectedPaths.length && !detectedCredentialNames.length && !detectedEndpoints.length) continue;
      const scopes = entry.id === "gmail" && detectedCredentialNames.includes("GMAIL_ACCESS_TOKEN")
        ? ["https://gmail.googleapis.com/gmail/v1/users/me"]
        : entry.id === "pieces"
          ? detectedEndpoints
          : [...detectedPaths, ...detectedEndpoints];
      candidates.push({
        catalogId: entry.id,
        label: entry.label,
        category: entry.category,
        support: entry.status,
        reason: [
          detectedPaths.length ? `${detectedPaths.length} local path${detectedPaths.length === 1 ? "" : "s"}` : "",
          detectedCredentialNames.length ? `${detectedCredentialNames.length} credential reference${detectedCredentialNames.length === 1 ? "" : "s"}` : "",
          detectedEndpoints.length ? `${entry.loopback?.label ?? "local service"} reachable` : "",
        ].filter(Boolean).join(", "),
        detectedPaths,
        detectedCredentialNames,
        detectedEndpoints,
        recommended: {
          kind: entry.connectorKind,
          capabilities: entry.connectorKind === "pieces" || entry.connectorKind === "gmail" || entry.connectorKind === "brainsync" ? ["read"] : ["discover", "read"],
          scopes,
        },
        requiresApproval: true,
        sourceContentRead: false,
      });
    }

    const repositoryRoots = [this.home, path.join(this.home, "Documents"), path.join(this.home, "Desktop"), path.join(this.home, ".antigravity")];
    const repositories = await findGitRepositories(repositoryRoots);
    if (repositories.length) {
      const existing = candidates.find((candidate) => candidate.catalogId === "github");
      if (existing) {
        existing.detectedPaths.push(...repositories.filter((repository) => !existing.detectedPaths.includes(repository)));
        existing.recommended.scopes = existing.detectedPaths;
        existing.reason = `${existing.detectedPaths.length} local Git repositories or roots detected`;
      } else {
        candidates.push({
          catalogId: "github",
          label: "Git repositories",
          category: "developer",
          support: "native",
          reason: `${repositories.length} local Git repositories detected`,
          detectedPaths: repositories,
          detectedCredentialNames: [],
          detectedEndpoints: [],
          recommended: { kind: "filesystem", capabilities: ["discover", "read"], scopes: repositories },
          requiresApproval: true,
          sourceContentRead: false,
        });
      }
    }

    return {
      schemaVersion: "memory-weaver.discovery.v1",
      generatedAt: new Date().toISOString(),
      home: this.home,
      catalogEntries: CONNECTOR_CATALOG.length,
      candidates: candidates.sort((left, right) => left.category.localeCompare(right.category) || left.label.localeCompare(right.label)),
      note: "Discovery inspected path existence, credential names, repository markers, and known loopback health endpoints only. It did not read source content or grant permissions.",
    };
  }
}
