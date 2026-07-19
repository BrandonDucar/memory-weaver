# Memory Weaver Local Companion

The local companion is the permissioned KoiDream + Gourami runtime behind Memory Weaver.

- **KoiDream** preserves continuity: source versions, hashes, provenance, redaction, encryption, and receipts.
- **Gourami** builds topology: topics, relationships, routeable context, and the local mesh.

It discovers nothing by default. Every folder, endpoint, bus topic, database view, or agent must be explicitly enabled in `mesh.config.json`.

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

External writeback is not implemented in this alpha. The permission schema reserves a separate, expiring `writeback` grant so future adapters cannot silently inherit read access as write access.

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
node dist/index.js status
node dist/index.js search memory
node dist/index.js watch
node dist/index.js mcp
```

The MCP server uses stdio and never opens a network port. It exposes status, search, and source read only. A source must grant both `read` and `mcp` before an MCP client can retrieve its decrypted content. MCP clients cannot trigger connector sync, topology mutation, export, or writeback.

## Connector state

Implemented now:

- Explicit filesystem roots
- Obsidian vault roots
- BrainSync approved-export roots
- Exact read-only HTTP/JSON endpoints, including manually configured Pieces or agent endpoints

Declared behind the same permission contract, with native drivers next:

- Redis Streams
- NATS / JetStream
- Kafka / Redpanda
- Neon read-only views
- Graphiti

Unsupported adapters report their state; they do not fake a successful connection.
