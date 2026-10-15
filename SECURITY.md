# Security Policy

## Report Privately

Use [GitHub private vulnerability reporting](https://github.com/BrandonDucar/memory-weaver/security/advisories/new).
Private reporting is enabled for this repository. Do not put exploit details,
tokens, imported documents, mailbox contents, vault keys or unredacted logs in
public issues. If GitHub does not offer the private form, ask for a confidential
contact method without including the vulnerability itself.

Include the affected commit or release, browser/local-companion surface, minimal
synthetic reproduction, expected boundary and observed behavior. State whether
data left the device or a connected source was modified. Never send real keys or
customer data as proof. No response-time or remediation SLA is promised.

## Supported Versions

Memory Weaver is an alpha, not a hardened production credential manager. Security
fixes target the current `main` branch. Previously published local-companion
alpha bundles are not automatically rebuilt and have no backport guarantee. Use an exact commit or
release tag when reporting; browser and local-companion behavior differ.

Review the verification workflow for the exact source commit before use. It
retains dependency audits for both the app and companion. Passing functional
tests or enabling private reporting does not clear a failing audit; dependency
repair is a separate release gate, not a reason to disable the audit. No known
advisories at one check does not establish that software has no vulnerabilities.

## Security Boundaries

- Browser workspaces use browser storage. The selected GitHub/model endpoint
  receives the requests you explicitly make; this is not zero-knowledge hosting.
- The companion ingests only approved sources. Discovery is not ingestion
  permission, and source text cannot authorize tools or external actions.
- Connectors are read-only. MCP retrieval requires both read and MCP permission.
- Companion vault encryption does not protect a compromised device or a stolen
  vault key. OS-keychain integration and signed installers remain future work.
- Browser receipt hashes are non-cryptographic FNV-1a change identifiers, not
  signatures. Companion Ed25519 signatures bind records to a local key, not an
  independently authenticated publisher or a claim's truth.

Permission bypasses, vault/plaintext disclosure, path escapes, credential leaks,
unexpected external writes and receipt-integrity failures are in scope. Use
ordinary issues for non-sensitive bugs, installation help and feature requests.

See [support](SUPPORT.md) and [contribution guidance](CONTRIBUTING.md).
