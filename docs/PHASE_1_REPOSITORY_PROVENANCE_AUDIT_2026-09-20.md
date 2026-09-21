# Phase 1 repository cleanliness and provenance audit — 2026-09-20

Phase 1 audits repository ownership, packaged contents and third-party provenance against the Phase 0 functional baseline. It deliberately does not upgrade provider APIs, Electron, native runtimes, vendored UI libraries, model defaults or updater architecture.

## Baseline

- Repository: `AaryaMody1301/ContextHalo`
- Phase 1 audit baseline: `main` at `8b7b28e312d33c45ee9e3ca5909804ebb9e3b1ad`
- Frozen functional baseline: `37c96f6bb17702a04ecfcb8d39e5687de8c6beff`
- Tracked files at audit start: **146**
- Open PRs/issues at audit start: **0 / 0**
- Supported release target: Windows 10/11 x64

## File ownership inventory

Every tracked file at the start of Phase 1 was assigned to one repository owner class. The machine-readable file-by-file inventory is `docs/PHASE_1_FILE_INVENTORY.json`.

| Owner class | Count at audit start | Purpose |
| --- | ---: | --- |
| Runtime source | 55 | Electron main/renderer/provider/capture/storage/application code |
| Runtime preload | 1 | Sandboxed main-window bridge |
| Runtime vendored/brand assets | 10 | Lit, Marked, highlight.js, icon and onboarding art |
| Runtime validation helper | 1 | Packaged Electron behavior/layout smoke |
| Tests | 46 | Node regression coverage and test helpers |
| Audit documentation | 9 | Dated compatibility/reliability/repair evidence |
| Repository documentation | 6 | README, contribution/security/support/agent guidance |
| License/provenance | 2 | GPL license and derivative attribution |
| Repository governance | 5 | Issue/PR templates and Dependabot |
| CI workflows | 2 | Windows build/release and repository maintenance |
| Development maintenance | 2 | Source checker and release/branch retention script |
| Development config | 5 | Editor/environment/formatting/ignore configuration |
| Build/dependency metadata | 2 | package manifest and lockfile |

## Deletion review

No tracked file is deleted in Phase 1.

That is intentional:

- `scripts/check-source.js` is owned by `npm run check`.
- `scripts/repository-maintenance.js` is owned by the maintenance workflow.
- `scripts/renderer-behavior-smoke.js` is required both before packaging and by the packaged `--ci-smoke-test` launch path.
- `src/utils/phase4Main.js` and `src/utils/phase4Renderer.js` are active imports, despite their historical names.
- Gemini 2.x/2.5 identifiers that remain in tracked source/tests are migration or regression fixtures rather than selectable defaults.
- Historical audit documents preserve release evidence and are not treated as duplicate implementation.
- Tests are intentionally retained; top-level `tests/*.test.js` files are executed by the current test command, while `tests/helpers/*` are fixtures imported by those tests.

Phase 1 therefore follows the rule “prove references before deletion” by making no speculative removal.

## Packaged application surface

Before Phase 1, electron-builder started from `**/*` and then excluded selected directories. electron-builder already applies default ignores, but the broad include still allowed repository-only files and maintenance scripts to be candidates for ASAR inclusion.

Phase 1 changes the application file list to an allowlist:

- `src/**/*`
- `preload.js`
- `scripts/renderer-behavior-smoke.js`
- `LICENSE`
- `CREDITS.md`
- `THIRD_PARTY_NOTICES.md`

`package.json` and production `node_modules` remain included by electron-builder's documented package rules. The packaged smoke helper remains because the release workflow launches the built EXE with `--ci-smoke-test`.

The allowlist excludes repository governance, development configuration, maintenance-only scripts, historical audit documents, tests and contributor documentation from the application ASAR without changing runtime ownership.

## Third-party provenance

Phase 1 adds:

- `THIRD_PARTY_NOTICES.md` for the human-readable distribution/provenance index;
- `docs/THIRD_PARTY_PROVENANCE.json` for exact production npm package resolution plus vendored/native/model provenance;
- contributor rules requiring version, source, license and digest/revision updates when vendored or native artifacts change.

Key findings carried forward:

1. The official llama.cpp Vulkan archive is checksum pinned.
2. Legacy CPU llama/Whisper executables are checksum pinned but still come from the historical upstream release; complete independent build provenance remains unresolved.
3. Hugging Face model/projector downloads verify content but still resolve through mutable `main`; full commit pinning belongs to the Local AI supply-chain phase.
4. Vendored Lit/Marked/highlight.js assets retain license headers but are outside Dependabot, so their upgrades require explicit review.
5. The current release workflow publishes on every successful `main` push, including documentation-only changes. Release-channel policy is intentionally deferred to the governance/release phase.

## Deferred findings

These are recorded but not changed here because mixing them into repository cleanup would weaken the validation boundary:

- Electron 44.x point update evaluation.
- @google/genai point update evaluation.
- IPC sender-frame consistency hardening.
- async safeStorage migration.
- custom application protocol instead of `file://`.
- Gemini/Groq API/model policy changes.
- native runtime replacement and Hugging Face commit pinning.
- vendored UI dependency upgrades.
- large-module structural refactors.
- installer/updater/signing work.
- branch protection, immutable releases and release-on-change policy.

## Phase 1 exit criteria

Phase 1 is complete when:

- every tracked baseline file has an owner class in the file inventory;
- no file is removed without a proven owner/reference decision;
- the portable package uses an explicit runtime allowlist rather than a repository-wide include;
- GPL derivative attribution and third-party notices are retained in the package;
- direct/transitive production npm provenance and vendored/native/model provenance are recorded;
- contributor guidance requires provenance updates for new vendored/native/model dependencies;
- source checks, regression tests, real Electron smoke, portable build and packaged scale smokes remain green.

No provider behavior, model default, credential format, user-data path, history format or Local AI runtime selection is intentionally changed by Phase 1.
