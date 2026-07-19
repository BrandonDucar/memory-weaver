# Memory Weaver Local Companion

The local companion is the permissioned KoiDream + Gourami runtime behind Memory Weaver.

- **KoiDream** preserves continuity: source versions, hashes, provenance, redaction, encryption, and receipts.
- **Gourami** builds topology: topics, relationships, routeable context, and the local mesh.
- **Steward** prepares morning, daily, and weekly briefs with headlines, resurfaced memories, alternate viewpoints, remix prompts, and mesh-health suggestions.
- **Memory Cartographer** detects likely sources without opening their contents or granting itself access.

It ingests nothing by default. `discover` may inventory path existence, credential names, repository markers, and known loopback services, but every folder, endpoint, bus topic, database view, or agent must still be explicitly enabled in `mesh.config.json`.

## Safety contract

```text
explicit scope
-> read-only connector
-> untrusted source envelope
-> secret redaction
-> AES-256-GCM local vault
-> deterministic weave
-> signed receipt
```

External writeback is intentionally absent from the capability model. Memory Weaver may write only to its own encrypted vault; it never edits, posts to, acknowledges, or administers a connected source.

## Start

Download the [Windows alpha bundle](https://github.com/BrandonDucar/memory-weaver/releases/tag/memory-weaver-local-v0.1.0-alpha.1), extract it, and run `install.ps1`. The installer creates an empty default-deny manifest; it does not scan the computer.

For source development:

```bash
npm install
npm run build
node dist/index.js init
```

`init` creates `~/.memory-weaver/mesh.config.json` with zero connectors. Add only the sources you want. See `mesh.config.example.json`.

```bash
node dist/index.js scan
node dist/index.js discover
node dist/index.js onboard
node dist/index.js status
node dist/index.js report
node dist/index.js analysis
node dist/index.js shadows
node dist/index.js brief morning
node dist/index.js latest-brief morning
node dist/index.js reindex
node dist/index.js search memory
node dist/index.js watch
node dist/index.js mcp
```

`onboard` turns the passive discovery report into simple yes/no read-only approvals. It refuses to overwrite an existing manifest. After onboarding, run `scan` once and `analysis` to get the first useful weave. Morning, daily, and weekly briefs begin after that baseline.

The Initial Analysis maps source coverage, major themes, strongest relationships, dormant material, quality gaps, and Memory Shadows. A Memory Shadow is evidence of something that is absent or not imported, such as a broken wikilink, a missing local path, or an email attachment reference. Shadows carry confidence and provenance; they never claim missing content was recovered.

The MCP server uses stdio and never opens a network port. It exposes status, search, and source read only. A source must grant both `read` and `mcp` before an MCP client can retrieve its decrypted content. MCP clients cannot trigger connector sync, topology mutation, export, or external effects.

## Connector state

Implemented now:

- Explicit filesystem roots with deep text ingestion and metadata-only indexing for unsupported binaries
- Secret-bearing files are discoverable by metadata but their contents are excluded
- Local photos, video, and audio metadata with stable fingerprints and remix-ready references
- Obsidian vault roots
- BrainSync approved-export roots
- Native Pieces OS metadata ingestion
- Gmail message and attachment-metadata backfill through a user-supplied read-only OAuth token
- Exact read-only HTTP/JSON endpoints for approved APIs
- Encrypted Steward briefs and deterministic resurfacing prompts
- Passive source discovery backed by a connector catalog

Declared behind the same permission contract, with native drivers next:

- Redis Streams
- NATS / JetStream
- Kafka / Redpanda
- Neon read-only views
- Graphiti

Unsupported adapters report their state; they do not fake a successful connection.

Gmail never sends, labels, deletes, archives, or marks mail as read. Its page token is stored only in the encrypted local runtime so large mailboxes can be backfilled over bounded scans.
