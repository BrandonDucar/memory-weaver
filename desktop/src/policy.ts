import path from "node:path";
import { sha256, stableJson } from "./crypto.js";
import type { ConnectorPermission, MeshCapability, PermissionManifest } from "./types.js";

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export class MeshPolicy {
  constructor(readonly manifest: PermissionManifest) {
    if (manifest.schemaVersion !== "memory-weaver.permissions.v2" || manifest.defaultDeny !== true) {
      throw new Error("Memory Weaver requires a versioned default-deny permission manifest");
    }
  }

  snapshotHash(): string {
    return sha256(stableJson(this.manifest));
  }

  connector(connectorId: string): ConnectorPermission {
    const connector = this.manifest.connectors.find((candidate) => candidate.id === connectorId);
    if (!connector || !connector.enabled) throw new PermissionDeniedError(`Connector ${connectorId} is not enabled`);
    return connector;
  }

  require(connectorId: string, capability: MeshCapability): ConnectorPermission {
    const connector = this.connector(connectorId);
    if (!connector.capabilities.includes(capability)) {
      throw new PermissionDeniedError(`${connectorId} does not have ${capability} permission`);
    }
    return connector;
  }

  allows(connectorId: string, capability: MeshCapability): boolean {
    try {
      this.require(connectorId, capability);
      return true;
    } catch (error) {
      if (error instanceof PermissionDeniedError) return false;
      throw error;
    }
  }

  requireFilesystemPath(connectorId: string, candidatePath: string, capability: "discover" | "read" | "watch"): string {
    const connector = this.require(connectorId, capability);
    if (connector.kind !== "filesystem" && connector.kind !== "obsidian" && connector.kind !== "brainsync") {
      throw new PermissionDeniedError(`${connectorId} is not a filesystem-backed connector`);
    }
    const resolved = path.resolve(candidatePath);
    const allowed = connector.scopes.some((scope) => {
      const root = path.resolve(scope);
      const relative = path.relative(root, resolved);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    });
    if (!allowed) throw new PermissionDeniedError(`Path is outside the approved scope for ${connectorId}`);
    return resolved;
  }

  requireWriteback(): never {
    throw new PermissionDeniedError("External writeback is not implemented in this release");
  }
}
