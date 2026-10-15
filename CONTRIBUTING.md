# Contributing

Start with a reproducible issue and agree on substantial changes before building
them. Keep browser and local-companion boundaries explicit. Preserve the
Apache-2.0 license and upstream attribution.

1. Use synthetic or explicitly public test material, never real credentials or
   customer documents.
2. Keep changes focused; explain the affected trust boundary and migration or
   rollback implications.
3. Run the relevant checks from the README. Browser changes require typecheck,
   lint and `npm test`; companion changes require `npm run check --prefix desktop`
   and `npm test --prefix desktop`.
4. Include exact commands, pass/fail results and untested surfaces in the PR.
   A mock, source declaration or local test is not production integration proof.
5. Add negative tests for permissions, redaction, path handling and receipt
   changes. Do not broaden access automatically when a new connector is detected.

Do not submit exploitable vulnerabilities publicly. Follow [SECURITY.md](SECURITY.md).
For setup help, see [SUPPORT.md](SUPPORT.md). Contributions do not grant deployment,
publishing, credential or external-write authority.
