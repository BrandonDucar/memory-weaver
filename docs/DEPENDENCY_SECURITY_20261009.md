# Dependency Security Reconciliation

Status: partial repair, not production approval. October 9, 2026.

The public README update exposed an already-failing `npm audit --audit-level=high`
gate. The initial root lockfile audit reported 27 findings: 4 moderate, 22 high,
and 1 critical. Earlier workflow runs also failed before the README change.

## Changes

- Next.js and matching ESLint config: 16.2.6 -> 16.4.0.
- React, React DOM, and React server DOM: 19.2.6 -> 19.3.0 together.
- Existing PostCSS override: 8.5.10 -> 8.5.29.
- Compatible transitive refresh through npm without `--force` or lifecycle scripts.
- Desktop companion lockfile refresh within its declared ranges.

No audit suppression, policy downgrade, removed test, source behavior change,
provider call, credential change, or deployment is included.

## Local Verification

Node 26.7.0 on Windows. CI's Node 22 environment remains an independent gate.

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts` | Pass |
| `npm ci --prefix desktop --ignore-scripts` | Pass |
| `npx --no-install tsc --noEmit` | Pass |
| `npm run check --prefix desktop` | Pass |
| `npm run lint` | Pass |
| `npm test` | Build and 6 tests pass |
| `npm test --prefix desktop` | 8 tests pass |
| `npm audit --omit=dev --audit-level=high` | Zero findings in the declared production dependency subset |
| Desktop lockfile audit | Zero findings |
| Full root lockfile audit | 9 high findings remain; zero critical/moderate |
| `git diff --check` | Pass |

The production subset result is not a claim that build tools cannot affect
shipped code. The full security gate is deliberately unchanged and remains red.

## Remaining Chains

- `braces` -> `micromatch` -> `fast-glob` -> Next ESLint and Vite dynamic-import
  tooling. Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- `image-size` through the existing Vinext toolchain:
  https://github.com/advisories/GHSA-5p2g-fcmc-qvqq and
  https://github.com/advisories/GHSA-w3rx-r6r6-pgpr

The nine package findings include dependent-package propagation, not nine
independently reproduced exploits. Exploitability was not assessed here.

The registry's latest `braces` release observed in this run was 3.0.3 and the
advisory range was `*`. Do not claim that an ordinary patch update resolves it.
The audit suggests Vinext 1.1.0 and an ESLint-config downgrade in places; those
are not automatically safe or sufficient fixes. Investigate maintained upstream
repairs and compatibility with the existing Cloudflare/Sites build before changing
framework behavior. No forced downgrade or arbitrary third-party fork is used.

## Merge And Rollback

Keep this patch review-blocked until the remaining full-audit failures have a
reviewed resolution. Do not merge merely because functional tests pass.
Rollback with a reviewed revert of this patch's commit, preserving later work.
The GitHub presentation changes are independent and need not be rolled back.
