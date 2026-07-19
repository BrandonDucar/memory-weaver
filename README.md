# Memory Weaver

![Memory Weaver](public/og.png)

Memory Weaver turns user-owned documents, repositories, conversations, and exports into a portable knowledge weave with source provenance, relationship threads, maintenance findings, and deterministic receipts.

It is the local-first knowledge preparation layer for [Warper Keeper](https://github.com/BrandonDucar) and the broader DreamNet public toolchain. It also works as a standalone application.

## What works today

- Populated product demo that shows a finished weave
- Local Markdown, text, CSV, and JSON ingestion
- Public and private GitHub repository import from the browser
- Deterministic topic and relationship extraction
- Duplicate, stale, orphan, and contradiction checks
- Searchable source vault with provenance
- Local receipt ledger with stable input and output hashes
- Portable `.weave.json`, `capsule.md`, and `trapper.json` exports
- Optional OpenAI-compatible endpoint connection check
- Installable web-app manifest and offline shell
- No account, hosted database, or DreamNet backend required

## Privacy boundary

The current release stores workspaces in browser storage. Files are processed in the browser. GitHub and model credentials are held in component memory for the active tab and are sent only to the endpoint the user chooses.

Memory Weaver does not claim end-to-end encryption, zero-knowledge processing, or hosted OAuth. A future desktop release will add an encrypted PGLite vault, OS-keychain credential references, local Ollama, filesystem watchers, and a loopback-only MCP server.

## Product contract

```text
Selected sources
→ secret redaction
→ deterministic normalization
→ topic and relationship weave
→ friction checks
→ local receipt
→ Capsule / Trapper / archive export
```

DreamLoops define bounded behavior. Capsules carry reusable capability. Trappers carry working context. Memory Weaver prepares and verifies the context those objects can transport.

## Development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Verification:

```bash
npx tsc --noEmit
npm run lint
npm test
npm audit
```

## Current status

Public alpha. The deterministic engine and export contracts are usable now. Hosted collaboration, encrypted desktop storage, background refresh, write-capable connectors, and cloud acceleration are deliberately not part of this release.

## Roadmap

1. IndexedDB capacity and encrypted local export
2. Desktop shell with PGLite and OS keychain support
3. Read-only Notion, Drive, Slack, Discord, and Telegram adapters
4. Warper Keeper Source Bridge import/export
5. Local Ollama enrichment and scoped local MCP
6. Optional Graphiti projection without moving source bodies

## License

Apache License 2.0. See [LICENSE](LICENSE).
