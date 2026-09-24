# Phase 6 Architecture Audit — 2026-09-21

> Historical evidence at the recorded commit, not a current completion certificate. The current transparency/Search implementation and outstanding acceptance gates are documented in [Final runtime repair (September 23)](FINAL_RUNTIME_REPAIR_2026-09-23.md). Earlier native-resize, Search-state and blanket quota statements are superseded there; recorded test results are not retroactively changed.

## Baseline

Phase 6 starts from merged Phase 5 `main` at `aa86deb30935b60db37c89566c16454e63497044`.

This phase is structural only. Provider models, API schemas, retry budgets, cancellation semantics, credential formats, capture behavior, user-data paths and UI behavior must remain unchanged.

## Research decisions

Lit recommends composition to manage complexity and identifies state-owning, single-purpose units with well-defined APIs as good decomposition candidates. Reactive controllers are also intended to encapsulate state/behavior owned by a host. ContextHalo therefore separates state owners before considering further component proliferation.

Current ESLint is 10.11.0. ESLint 10 requires Node 20.19+, 22.13+ or 24+, so it is compatible with ContextHalo's declared Node floor. The repository does not currently lock ESLint, however. Phase 6 does not introduce an ephemeral `npx` download or an unlocked dependency; a future ESLint adoption must pin the package and generated lockfile in a tooling-only change.

References:
- https://lit.dev/docs/composition/component-composition/
- https://lit.dev/docs/composition/controllers/
- https://eslint.org/blog/2026/09/eslint-v10.11.0-released/
- https://eslint.org/docs/latest/use/migrate-to-10.0.0

## Ownership changes

### Renderer

Before Phase 6, `src/utils/renderer.js` owned capture/audio resources, serialized persistence, preference caching, provider initialization, theme state and appearance application.

Phase 6 keeps capture/audio/provider dispatch in `renderer.js` and extracts:

- `rendererStorage.js` — serialized renderer persistence plus preference cache;
- `rendererTheme.js` — appearance/theme state and CSS token application.

The public `window.contextHalo.storage` and `window.contextHalo.theme` contracts are unchanged. The real renderer fixture loads these owners explicitly, so existing capture, appearance and persistence tests still execute the extracted code.

Measured branch sizes:
- `renderer.js`: about 42 KB -> 31 KB;
- `rendererStorage.js`: about 3.9 KB;
- `rendererTheme.js`: about 9.9 KB.

### Application shell

`ContextHaloApp.js` remains the owner of session lifecycle, provider/capture state, request ownership, navigation and rendering composition.

Phase 6 extracts:

- `ContextHaloAppStyles.js` — the app-shell style surface;
- `responseStateRenderer.js` — response-card identity/indexing, concurrent stream routing and follow-latest policy.

The class keeps the existing `addNewResponse` and `updateCurrentResponse` methods as compatibility delegates for IPC, smoke tests and component callers.

Measured branch sizes:
- `ContextHaloApp.js`: about 78 KB -> 56 KB;
- `ContextHaloAppStyles.js`: about 20.6 KB;
- `responseStateRenderer.js`: about 1.7 KB.

### Provider coordinator

The initial plan called for evaluating `gemini.js`, not blindly splitting it. The repository already had dedicated owners for Live reliability/runtime/supervision, request deadlines, request cancellation, SSE parsing, Groq reasoning policy and screen reliability.

Phase 6 therefore leaves those working state machines intact and extracts only the pure failure-classification policy:

- `geminiFailure.js` — bounded provider-error parsing, safe diagnostic classification, retryability and user-safe messages.

`gemini.js` continues to export `classifyGeminiFailure`, so existing tests and callers are unchanged.

Measured branch sizes:
- `gemini.js`: about 86 KB -> 77 KB;
- `geminiFailure.js`: about 9.9 KB.

### Windows smoke

The original smoke file mixed two execution contexts: code injected into the sandboxed renderer and native Electron keyboard/accessibility/layout acceptance.

Phase 6 separates:
- `renderer-behavior-smoke.js` — end-to-end sandboxed renderer behavior plus installer;
- `windows-acceptance.js` — native keyboard input, accessibility tree, real window/layout/appearance acceptance.

The portable package explicitly includes both files. The end-to-end smoke remains the release gate; focused Node suites remain the primary owners for security, persistence, provider contracts and other deterministic behaviors.

Measured branch sizes:
- `renderer-behavior-smoke.js`: about 54 KB -> 35 KB;
- `windows-acceptance.js`: about 19.7 KB.

## Validation improvements

`scripts/check-source.js` previously syntax-checked only runtime source plus preload. Phase 6 expands that deterministic validation to all JavaScript under `src`, `tests` and `scripts`, plus `preload.js`. This catches broken test fixtures before the test runner begins.

`tests/phase6-architecture.test.js` locks the new ownership boundaries so future changes cannot silently move persistence/theme/response/failure policy back into the large coordinators.

## Explicit non-changes

Phase 6 does not:
- change Gemini, Groq or Local model IDs;
- change provider API fields or endpoints;
- change Search behavior;
- change retry/cooldown/deadline values;
- change credential storage;
- change Local AI binaries/models/download provenance;
- change the UI design;
- add updater/signing/governance work;
- add an unpinned lint dependency.

## Exit evidence

Phase 6 is complete only when the normal Windows workflow passes:
- expanded source/test/script syntax validation;
- all Node regression tests, including architecture ownership tests;
- real sandboxed Electron behavior/layout smoke;
- portable Windows EXE build and checksum;
- packaged launch at 100/125/150/200% Chromium scale.

Physical Windows/provider/device acceptance remains Phase 9 and is not claimed by CI.
