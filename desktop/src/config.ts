import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { PermissionManifest } from "./types.js";

const connectorSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["filesystem", "pieces", "brainsync", "redis", "kafka", "nats", "neon", "graphiti", "obsidian", "agent", "http-json"]),
  enabled: z.boolean(),
  capabilities: z.array(z.enum(["discover", "read", "watch", "subscribe", "search", "weave", "export", "mcp", "writeback"])),
  scopes: z.array(z.string()),
  extensions: z.array(z.string()).optional(),
  maxItemBytes: z.number().int().positive().optional(),
  authority: z.enum(["ephemeral", "working", "approved", "canonical"]),
  sensitivity: z.enum(["public", "internal", "private", "restricted"]),
  credentialRef: z.string().optional(),
  settings: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).optional(),
});

const manifestSchema = z.object({
  schemaVersion: z.literal("memory-weaver.permissions.v2"),
  vaultId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  revocationEpoch: z.number().int().nonnegative(),
  defaultDeny: z.literal(true),
  localOnly: z.boolean(),
  networkEgress: z.enum(["deny", "allow-explicit"]),
  connectors: z.array(connectorSchema),
});

export interface RuntimePaths {
  home: string;
  config: string;
  vault: string;
  encryptionKey: string;
  signingKey: string;
  signingPublicKey: string;
}

export const resolveRuntimePaths = (configOverride?: string): RuntimePaths => {
  const home = path.resolve(process.env.MEMORY_WEAVER_HOME ?? path.join(os.homedir(), ".memory-weaver"));
  return {
    home,
    config: path.resolve(configOverride ?? path.join(home, "mesh.config.json")),
    vault: path.join(home, "vault"),
    encryptionKey: path.join(home, "vault.key"),
    signingKey: path.join(home, "receipt-signing.pem"),
    signingPublicKey: path.join(home, "receipt-signing.pub.pem"),
  };
};

export const loadManifest = async (configPath: string): Promise<PermissionManifest> => {
  const raw = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  return manifestSchema.parse(raw) as PermissionManifest;
};

export const initializeManifest = async (paths: RuntimePaths): Promise<"created" | "exists"> => {
  await mkdir(paths.home, { recursive: true });
  try {
    await writeFile(paths.config, JSON.stringify({
      schemaVersion: "memory-weaver.permissions.v2",
      vaultId: "personal-mesh",
      revision: 1,
      revocationEpoch: 0,
      defaultDeny: true,
      localOnly: true,
      networkEgress: "deny",
      connectors: [],
    }, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    return "created";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") return "exists";
    throw error;
  }
};
