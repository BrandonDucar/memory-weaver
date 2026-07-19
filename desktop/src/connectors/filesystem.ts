import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { KoiDream } from "../koidream.js";
import { MeshPolicy } from "../policy.js";
import type { ConnectorPermission, ConnectorRunResult, SourceEnvelope } from "../types.js";

const DEFAULT_EXTENSIONS = [".md", ".mdx", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".csv", ".html", ".xml", ".eml"];
const TEXT_EXTENSIONS = new Set([
  ...DEFAULT_EXTENSIONS,
  ".c", ".cc", ".conf", ".cpp", ".css", ".go", ".h", ".hpp", ".ini", ".java", ".js", ".jsx", ".kt", ".log",
  ".php", ".properties", ".ps1", ".py", ".rb", ".rs", ".scss", ".sh", ".sql", ".swift", ".toml", ".ts", ".tsx",
]);
const IMAGE_EXTENSIONS = new Set([".avif", ".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".webm"]);
const AUDIO_EXTENSIONS = new Set([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav"]);
const DOCUMENT_EXTENSIONS = new Set([".doc", ".docx", ".epub", ".odt", ".pdf", ".ppt", ".pptx", ".rtf", ".xls", ".xlsx"]);
const ARCHIVE_EXTENSIONS = new Set([".7z", ".bz2", ".gz", ".rar", ".tar", ".tgz", ".zip"]);
const IGNORED_SEGMENTS = new Set([".git", ".idea", ".next", ".turbo", ".venv", "__pycache__", "cache", "code cache", "dist", "node_modules", "target", "temp", "tmp", "vendor"]);
const SECRET_SEGMENTS = new Set([".aws", ".azure", ".gnupg", ".ssh"]);
const SECRET_BASENAMES = new Set([".env", ".npmrc", ".pypirc", "credentials", "id_dsa", "id_ed25519", "id_rsa", "known_hosts"]);

const mimeFor = (extension: string): string => ({
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".md": "text/markdown",
  ".mdx": "text/markdown",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".csv": "text/csv",
  ".html": "text/html",
  ".xml": "application/xml",
  ".eml": "message/rfc822",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
}[extension] ?? (TEXT_EXTENSIONS.has(extension) ? "text/plain" : "application/octet-stream"));

const containsIgnoredSegment = (candidate: string): boolean => candidate.split(path.sep).some((segment) => IGNORED_SEGMENTS.has(segment.toLowerCase()));
const containsSecretSegment = (candidate: string): boolean => candidate.split(path.sep).some((segment) => SECRET_SEGMENTS.has(segment.toLowerCase()));

const categoryFor = (extension: string): "text" | "image" | "video" | "audio" | "document" | "archive" | "email" | "file" => {
  if (extension === ".eml" || extension === ".mbox") return "email";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "file";
};

const hashFile = async (filePath: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  createReadStream(filePath).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
});

export class FilesystemConnector {
  constructor(
    readonly permission: ConnectorPermission,
    private readonly policy: MeshPolicy,
    private readonly koiDream: KoiDream,
  ) {}

  private extensions(): Set<string> {
    return new Set((this.permission.extensions?.length ? this.permission.extensions : DEFAULT_EXTENSIONS).map((item) => item.toLowerCase()));
  }

  private indexAllFiles(): boolean {
    return this.permission.settings?.indexAllFiles === true;
  }

  private async canonicalPath(candidate: string, capability: "discover" | "read" | "watch"): Promise<string> {
    const resolved = this.policy.requireFilesystemPath(this.permission.id, candidate, capability);
    const linkState = await lstat(resolved);
    if (linkState.isSymbolicLink()) throw new Error("Symbolic links and junction roots are not allowed");
    const canonical = await realpath(resolved);
    this.policy.requireFilesystemPath(this.permission.id, canonical, capability);
    return canonical;
  }

  private async listFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const maxDepth = Number(this.permission.settings?.maxDepth ?? 24);
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (IGNORED_SEGMENTS.has(entry.name.toLowerCase()) || entry.isSymbolicLink()) continue;
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(candidate, depth + 1);
        else if (entry.isFile() && (this.indexAllFiles() || this.extensions().has(path.extname(entry.name).toLowerCase()))) files.push(candidate);
      }
    };
    await walk(root, 0);
    return files;
  }

  private async envelope(filePath: string): Promise<SourceEnvelope> {
    const resolved = await this.canonicalPath(filePath, "read");
    const handle = await open(resolved, "r");
    const details = await handle.stat();
    if (!details.isFile()) {
      await handle.close();
      throw new Error("Source is not a regular file");
    }
    const maxBytes = this.permission.maxItemBytes ?? 2 * 1024 * 1024;
    const extension = path.extname(resolved).toLowerCase();
    const mimeType = mimeFor(extension);
    const category = categoryFor(extension);
    const secretBearing = containsSecretSegment(resolved)
      || SECRET_BASENAMES.has(path.basename(resolved).toLowerCase())
      || [".key", ".p12", ".pfx", ".pem", ".kdbx"].includes(extension);
    const readable = TEXT_EXTENSIONS.has(extension) && !secretBearing && details.size <= maxBytes;
    let content: string;
    try {
      if (readable) {
        content = await handle.readFile("utf8");
      } else {
        const maxHashBytes = Number(this.permission.settings?.maxBinaryHashBytes ?? 64 * 1024 * 1024);
        const fingerprint = details.size <= maxHashBytes
          ? await hashFile(resolved)
          : createHash("sha256").update(`${resolved}:${details.size}:${details.mtimeMs}`).digest("hex");
        content = JSON.stringify({
          path: resolved,
          filename: path.basename(resolved),
          extension: extension || null,
          category,
          mimeType,
          bytes: details.size,
          createdAt: details.birthtime.toISOString(),
          modifiedAt: details.mtime.toISOString(),
          fingerprint,
          fingerprintMode: details.size <= maxHashBytes ? "sha256" : "size-mtime",
          metadataOnly: true,
          secretContentExcluded: secretBearing,
        }, null, 2);
      }
    } finally {
      await handle.close();
    }
    const tags = [this.permission.kind, "local-file", category];
    if (["image", "video", "audio"].includes(category)) tags.push("local-media");
    if (category === "image") tags.push("camera-roll-candidate");
    if (!readable) tags.push("metadata-only");
    if (secretBearing) tags.push("secret-content-excluded");
    return {
      schemaVersion: "memory-weaver.source.v1",
      connectorId: this.permission.id,
      externalId: resolved,
      title: path.basename(resolved),
      kind: readable ? extension.slice(1) || "text" : `${category}-metadata`,
      content,
      mimeType,
      observedAt: new Date().toISOString(),
      updatedAt: details.mtime.toISOString(),
      authority: this.permission.authority,
      sensitivity: this.permission.sensitivity,
      taint: "untrusted",
      tags,
      metadata: { path: resolved, bytes: details.size, mimeType, category, metadataOnly: !readable, secretContentExcluded: secretBearing },
    };
  }

  async scan(): Promise<ConnectorRunResult> {
    this.policy.require(this.permission.id, "discover");
    const result: ConnectorRunResult = { connectorId: this.permission.id, scanned: 0, ingested: 0, duplicates: 0, failed: 0, warnings: [] };
    const maxItems = Number(this.permission.settings?.maxItemsPerRun ?? 500);
    for (const scope of this.permission.scopes) {
      const root = await this.canonicalPath(scope, "discover");
      try {
        for (const filePath of await this.listFiles(root)) {
          if (result.scanned >= maxItems) {
            result.warnings.push(`Scan stopped at the configured ${maxItems} item limit`);
            return result;
          }
          result.scanned += 1;
          try {
            const ingest = await this.koiDream.ingest(await this.envelope(filePath));
            if (ingest.duplicate) result.duplicates += 1;
            else result.ingested += 1;
          } catch (error) {
            result.failed += 1;
            result.warnings.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch (error) {
        result.failed += 1;
        result.warnings.push(`${root}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return result;
  }

  async watch(onError: (error: Error) => void): Promise<FSWatcher> {
    this.policy.require(this.permission.id, "watch");
    const roots = await Promise.all(this.permission.scopes.map((scope) => this.canonicalPath(scope, "watch")));
    const watcher = chokidar.watch(roots, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (candidate) => containsIgnoredSegment(String(candidate)),
      awaitWriteFinish: { stabilityThreshold: 750, pollInterval: 100 },
    });
    const ingest = (candidate: string): void => {
      if (!this.indexAllFiles() && !this.extensions().has(path.extname(candidate).toLowerCase())) return;
      void this.envelope(candidate)
        .then((envelope) => this.koiDream.ingest(envelope))
        .catch((error) => onError(error instanceof Error ? error : new Error(String(error))));
    };
    watcher.on("add", ingest).on("change", ingest).on("error", (error) => onError(error instanceof Error ? error : new Error(String(error))));
    return watcher;
  }
}
