import type { ConnectorKind } from "./types.js";

export interface ConnectorCatalogEntry {
  id: string;
  label: string;
  category: "files" | "communication" | "knowledge" | "developer" | "agents" | "data" | "media" | "cloud";
  status: "native" | "metadata" | "planned";
  connectorKind?: ConnectorKind;
  reads: string;
  pathSignals?: string[][];
  envSignals?: string[];
  loopback?: { url: string; label: string };
}

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  { id: "documents", label: "Documents", category: "files", status: "native", connectorKind: "filesystem", reads: "Documents and project files", pathSignals: [["Documents"]] },
  { id: "desktop", label: "Desktop", category: "files", status: "native", connectorKind: "filesystem", reads: "Desktop files and working folders", pathSignals: [["Desktop"]] },
  { id: "downloads", label: "Downloads", category: "files", status: "metadata", connectorKind: "filesystem", reads: "Downloaded files with content or metadata classification", pathSignals: [["Downloads"]] },
  { id: "photos", label: "Photos and camera roll", category: "media", status: "metadata", connectorKind: "filesystem", reads: "Photo metadata and local references", pathSignals: [["Pictures"], ["OneDrive", "Pictures"]] },
  { id: "video", label: "Videos", category: "media", status: "metadata", connectorKind: "filesystem", reads: "Video metadata and local references", pathSignals: [["Videos"], ["OneDrive", "Videos"]] },
  { id: "music", label: "Music and audio", category: "media", status: "metadata", connectorKind: "filesystem", reads: "Audio metadata and local references", pathSignals: [["Music"]] },
  { id: "obsidian", label: "Obsidian", category: "knowledge", status: "native", connectorKind: "obsidian", reads: "Markdown vaults and wikilink context", pathSignals: [["Documents", "Obsidian"], ["OneDrive", "Documents", "Obsidian"]] },
  { id: "pieces", label: "Pieces OS", category: "knowledge", status: "native", connectorKind: "pieces", reads: "Local Pieces asset metadata", pathSignals: [["AppData", "Local", "Pieces"]], loopback: { url: "http://127.0.0.1:39300/assets", label: "Pieces OS local API" } },
  { id: "brainsync", label: "BrainSync", category: "agents", status: "native", connectorKind: "brainsync", reads: "Approved BrainSync memory exports", pathSignals: [[".brainsync"], ["AppData", "Local", "BrainSync"]] },
  { id: "codex", label: "Codex", category: "agents", status: "metadata", connectorKind: "filesystem", reads: "Local task history, attachments, and approved agent artifacts", pathSignals: [[".codex"]] },
  { id: "antigravity", label: "Antigravity", category: "agents", status: "metadata", connectorKind: "filesystem", reads: "Local workspaces and agent artifacts", pathSignals: [[".antigravity"]] },
  { id: "goose", label: "Goose", category: "agents", status: "planned", reads: "Approved local Goose sessions and artifacts", pathSignals: [[".config", "goose"], ["AppData", "Roaming", "goose"]] },
  { id: "claude", label: "Claude", category: "agents", status: "planned", reads: "Approved local Claude project history", pathSignals: [[".claude"]] },
  { id: "cursor", label: "Cursor", category: "developer", status: "planned", reads: "Editor history and approved workspace context", pathSignals: [["AppData", "Roaming", "Cursor"]] },
  { id: "windsurf", label: "Windsurf", category: "developer", status: "planned", reads: "Editor history and approved workspace context", pathSignals: [[".codeium"], ["AppData", "Roaming", "Windsurf"]] },
  { id: "ollama", label: "Ollama", category: "agents", status: "planned", reads: "Installed local model inventory", pathSignals: [[".ollama"]], loopback: { url: "http://127.0.0.1:11434/api/tags", label: "Ollama local API" } },
  { id: "gmail", label: "Gmail", category: "communication", status: "native", connectorKind: "gmail", reads: "Messages and attachment metadata through Gmail read-only OAuth", envSignals: ["GMAIL_ACCESS_TOKEN", "GMAIL_REFRESH_TOKEN", "GMAIL_CLIENT_ID"] },
  { id: "mail-archives", label: "Email archives", category: "communication", status: "native", connectorKind: "filesystem", reads: "Local EML and MBOX exports", pathSignals: [["Documents", "Mail"], ["Downloads", "Takeout", "Mail"]] },
  { id: "google-drive", label: "Google Drive", category: "cloud", status: "planned", reads: "Drive files and metadata through read-only OAuth", pathSignals: [["My Drive"]], envSignals: ["GOOGLE_APPLICATION_CREDENTIALS", "GDRIVE_ACCESS_TOKEN"] },
  { id: "onedrive", label: "OneDrive", category: "cloud", status: "native", connectorKind: "filesystem", reads: "Locally synchronized OneDrive files", pathSignals: [["OneDrive"]] },
  { id: "dropbox", label: "Dropbox", category: "cloud", status: "native", connectorKind: "filesystem", reads: "Locally synchronized Dropbox files", pathSignals: [["Dropbox"]] },
  { id: "icloud", label: "iCloud Drive", category: "cloud", status: "native", connectorKind: "filesystem", reads: "Locally synchronized iCloud files", pathSignals: [["iCloudDrive"], ["iCloudDrive"]] },
  { id: "github", label: "GitHub and Git repositories", category: "developer", status: "native", connectorKind: "filesystem", reads: "Local repositories now; remote repositories through a future read-only API lane", envSignals: ["GITHUB_TOKEN", "GH_TOKEN"] },
  { id: "notion", label: "Notion", category: "knowledge", status: "planned", reads: "Pages and databases through read-only OAuth", envSignals: ["NOTION_API_KEY", "NOTION_TOKEN"] },
  { id: "slack", label: "Slack", category: "communication", status: "planned", reads: "Authorized channel history and files", envSignals: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"] },
  { id: "discord", label: "Discord", category: "communication", status: "planned", reads: "Authorized server and channel history", envSignals: ["DISCORD_BOT_TOKEN"] },
  { id: "telegram", label: "Telegram", category: "communication", status: "planned", reads: "Authorized chats or local exports", envSignals: ["TELEGRAM_BOT_TOKEN"] },
  { id: "farcaster", label: "Farcaster", category: "communication", status: "planned", reads: "Casts, channels, and social history", envSignals: ["NEYNAR_API_KEY"] },
  { id: "nostr", label: "Nostr", category: "communication", status: "planned", reads: "Public relay events and approved local history", envSignals: ["NOSTR_RELAYS"] },
  { id: "redis", label: "Redis", category: "data", status: "planned", connectorKind: "redis", reads: "Approved keys and streams", envSignals: ["REDIS_URL"] },
  { id: "nats", label: "NATS and JetStream", category: "data", status: "planned", connectorKind: "nats", reads: "Approved subjects and durable streams", envSignals: ["NATS_URL"], loopback: { url: "http://127.0.0.1:8222/varz", label: "NATS monitoring API" } },
  { id: "kafka", label: "Kafka and Redpanda", category: "data", status: "planned", connectorKind: "kafka", reads: "Approved topics and consumer projections", envSignals: ["KAFKA_BROKERS", "REDPANDA_BROKERS"] },
  { id: "neon", label: "Neon and Postgres", category: "data", status: "planned", connectorKind: "neon", reads: "Approved read-only views", envSignals: ["NEON_DATABASE_URL", "DATABASE_URL", "PGHOST"] },
  { id: "graphiti", label: "Graphiti", category: "knowledge", status: "planned", connectorKind: "graphiti", reads: "Temporal entities and relationships", envSignals: ["GRAPHITI_URL", "NEO4J_URI"] },
  { id: "browser", label: "Browser history and bookmarks", category: "knowledge", status: "planned", reads: "Approved local history, bookmarks, and reading lists", pathSignals: [["AppData", "Local", "Google", "Chrome", "User Data"], ["AppData", "Local", "Microsoft", "Edge", "User Data"], ["AppData", "Roaming", "Mozilla", "Firefox", "Profiles"]] },
  { id: "calendar", label: "Calendars", category: "communication", status: "planned", reads: "Authorized calendars and local ICS exports", pathSignals: [["Documents", "Calendars"]], envSignals: ["GOOGLE_CALENDAR_ACCESS_TOKEN"] },
];
