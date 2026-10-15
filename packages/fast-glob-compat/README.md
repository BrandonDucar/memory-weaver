# Build Glob Compatibility Adapter

This is an intentionally limited adapter, not a complete fork or replacement of
fast-glob's public API. It delegates matching and traversal to the maintained
`tinyglobby` library, which does not depend on `micromatch` or `braces`.

Why it exists: GHSA-vfj7-8cjw-p6xm affects the latest upstream `braces` release.
Memory Weaver's build dependency graph reaches it through two inspected callers:

- `@next/eslint-plugin-next/dist/utils/get-root-dirs.js`: `globSync(pattern, {onlyDirectories: true})`.
- `vite-plugin-dynamic-import/dist/index.{js,mjs}`: `default.sync(patterns, {cwd})`.

An npm override routes those calls to this private workspace, named `fast-glob`
with an explicit `-dreamnet.1` version suffix to satisfy the callers' import name.
This is DreamNet adapter code, not an upstream fast-glob release, and cannot be
published to npm (`private: true`). No advisory is dismissed or ignored,
no lint rule is removed, and no vulnerable upstream parser is copied or renamed.
The actual dependency chain is replaced. Async/default and sync/named calls are
supported; uncommon fast-glob APIs are deliberately not claimed.

The root workspace declaration and override make `npm ci` use this same local
module for both transitive callers on Windows and Linux. Keep the adapter source
with the lockfile; no npm registry copy of this DreamNet version exists.

Following the [official migration guide](https://superchupu.dev/tinyglobby/migration),
`expandDirectories` is always false. We do not approximate incompatible `deep`,
filesystem-adapter, object-mode, buffer or stream behavior. Unsupported options
throw instead of silently returning different results. Changes to either caller
must be reviewed against this small contract and its tests.

Pattern arrays and ignore arrays are limited to 256 entries. Each pattern is
limited to 4,096 characters and 128 grouping delimiters. These build-time limits
reject pathological expressions before matching. They are not a filesystem
sandbox or permission grant: build tools retain the operator's filesystem scope.

The integration tests cover default/sync/named/async calls, multi-extension
imports, directory roots, exclusion and hidden-file behavior, unsupported modes,
complexity rejection, and the absence of the old parser in the resolved graph.
The real build and unchanged ESLint configuration must also pass before release.
