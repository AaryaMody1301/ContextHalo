# v0.9 Phase 0 — baseline and reproducibility (2026-11-24)

Status: **in progress**. No production code, dependencies, workflows or releases changed.

## Frozen baseline

- Main: `2c5c8484e2de2d1774f48abe843666c3766aa65b` (2026-10-13), tree `a7a541d931079f57ad0802aa5d934814a4920dc7`.
- Application 0.8.0; [v0.8.0-portable.442](https://github.com/AaryaMody1301/ContextHalo/releases/tag/v0.8.0-portable.442), target matches main; release is not immutable.
- EXE: 110581006 bytes; GitHub-reported SHA-256 `7cc9cef7803565b9f5c541982d88ae40620487792e4a6697a041e5acd83c9260` (not independently downloaded/hashed).
- Locked Electron 44.7.0, Google GenAI 2.28.0, Marked 18.1.0, Electron Builder 26.17.0.
- [Windows build 442](https://github.com/AaryaMody1301/ContextHalo/actions/runs/38385269850) succeeded on the frozen commit: lockfile verification, npm ci, production audit, source validation, regression tests, Electron smoke, packaging, checksum, four-scale launch, attestation and publishing recorded success. Historical, not rerun.
- [Build 458](https://github.com/AaryaMody1301/ContextHalo/actions/runs/44094101896) failed before recorded steps; root cause not established. Rulesets API returned an empty list.

## Fresh isolated execution

Linux x64, Node 22.16.0, npm 10.9.2. GitHub DNS resolution prevented cloning; npm registry DNS also failed. Two application modules were retrieved via GitHub and copied into an isolated workspace; exact Git blob hashes verified:

| File | Blob |
| --- | --- |
| src/utils/knowledgeCore.js | f9f04f83b2812bdde9ffe26998ed84a67a1ef3e8 |
| src/utils/practiceCore.js | 3e9688872fab93c97debeab888e32dee007dffad |

Both source modules and the opt-in probe passed node --check. No real data, credentials or external calls were used.

| Finding | Expected | Observed |
| --- | --- | --- |
| BUG-01 correct cloze answer (transactions) | score 1, strong | score 0.11, retry |
| BUG-02 session review includes persisted ai_response | true | false |

Run `node scripts/phase0-baseline.js` from the repository root. Exit 1 is expected on the baseline because the assertions specify desired behavior. The probe is outside the regular tests/*.test.js glob. Transfer assertions to permanent regression tests alongside fixes.

## Retrieval microbenchmark

Synthetic database documents, 100 repeated paragraphs per document; 5 warm-up queries, 30 timed queries per corpus, Intel Xeon Platinum 8573C, Linux x64, Node 22.16.0. Nearest-rank percentiles. Only in-memory ranking and result construction are timed; excludes disk IO, corpus construction, IPC, Electron and inference.

| Documents | Chunks | Run 1 median/P95 ms | Run 2 median/P95 ms |
| --- | --- | --- | --- |
| 10 | 70 | 0.75 / 3.23 | 0.55 / 1.38 |
| 100 | 700 | 4.24 / 15.05 | 4.06 / 7.79 |
| 500 | 3500 | 19.58 / 22.61 | 19.64 / 25.10 |

Repeat with the same host and workload before/after changes. Do not extrapolate to Windows end-to-end performance.

## Remaining gates

- [ ] Fresh full checkout at the frozen commit; npm ci, npm run check, npm test; record logs, pass/fail/skip counts and exit codes.
- [ ] Reproduce remaining audit findings using isolated fixtures: 501st import, corrupt index, destructive deletion UI, selective cache retention, rapid capture-source changes, stale transcript writes, bounded update response and provider cache.
- [ ] Windows Electron smoke and portable build with frozen dependencies; record startup, idle CPU/RAM, event-loop latency, disk-backed retrieval, IPC/persistence overhead and request preparation.
- [ ] Validate all four providers with authorized accounts/hardware or record explicit blocked reasons; no paid quota, real private data or secrets. Separate local CPU/Vulkan from cloud latency.
- [ ] Phase 1 CI failure diagnosis; do not infer a source failure from a pre-step failure.

Run on a clean Windows checkout (not a tree containing uncommitted user changes):

    git checkout --detach 2c5c8484e2de2d1774f48abe843666c3766aa65b
    npm ci
    npm run check
    npm test

Use existing Windows workflow and physical acceptance matrix. Do not merge or release a production change solely on this partial baseline.

References: [npm ci](https://docs.npmjs.com/cli/v10/commands/npm-ci), [Node performance hooks](https://nodejs.org/api/perf_hooks.html), [Electron automated testing](https://www.electronjs.org/docs/latest/tutorial/automated-testing).
