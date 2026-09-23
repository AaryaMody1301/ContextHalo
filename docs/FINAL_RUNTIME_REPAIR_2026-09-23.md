# Final runtime repair - September 23, 2026

Baseline: `a236c19e2f87fdb493b65c21393ebefc13ef7a6c` (merged PR #70).
This is the current source/behavior map for the final repair, not another development phase and not a certificate of physical Windows or account acceptance.

## Windows transparency and geometry

Electron documents that transparent windows must not enable native resizing, that DevTools disables transparency, and that Windows native maximize is unsupported for these windows. ContextHalo now creates its transparent frameless window with `resizable:false`, `maximizable:false`, `thickFrame:false`, an alpha-zero native background, and no native shadow. No later path enables native resizing or calls native maximize.

The implementation retains one renderer, not the two-window design considered in the preliminary plan. Recreating or duplicating the renderer would introduce separate session, capture, shortcut, permission and IPC ownership. Keeping one native window avoids that change while removing the unsupported native geometry behavior.

App-owned edge/corner handles report gestures through trusted IPC. Main samples the Windows cursor in Electron device-independent pixels and clamps geometry to the originating work area; renderer-supplied coordinates are never accepted. The bottom-right handle supports Arrow keys (10 DIP) and Shift+Arrow (40 DIP). Workspace fit/restore uses `setBounds`, preserves restoration bounds through HUD transitions, and never toggles the native resize flag. Hidden/blurred/ended gestures cannot continue resizing. Fractional-DPI rounding preserves opposite edges. Normal and HUD geometry remain separately persisted and monitor-clamped.

One `--window-background` alpha token controls the window surface. The obsolete `--hud-background` alias is removed. Text and controls remain opaque; opaque workspace chrome/cards are intentional. No native window opacity is used, and GPU acceleration is not globally disabled.

## Search setup diagnosis and recovery

`RESOURCE_EXHAUSTED`, a generic quota message or WebSocket 1011 alone does not identify a particular project/model quota. Classification now retains sanitized request route, Search-attached context and an evidence-based quota scope (`model`, `search` or `unknown`). A known base-model quota is not bypassed by disabling Search. Authentication and permission failures are not probed.

An eligible Search-enabled Live **setup** failure receives at most one Search-off control inside the existing abortable request budget. It uses the same account and model, honors provider retry delay, and preserves compression and the other supported setup fields. On reconnect, a Search-off control must start fresh instead of resuming a Search-enabled handle; bounded local context is restored through the existing initial-history contract. Successful ordinary resumption still avoids duplicate history replay.

Only a successful control commits the Live fallback. It establishes that a no-Search connection is available, not whether the underlying cause was tool quota, entitlement or a temporary provider condition. Session details explicitly retain that uncertainty. A failed quota control is terminal for this attempt; it cannot trigger another control, a core-configuration retry, or false successful Search attribution. Existing bounded core-configuration compatibility recovery remains available for its non-quota cases.

Search state has one canonical representation: `requested`, `liveEffective`, `httpEffective`, `status`, `liveReason`, `httpReason`. The old `effective` property is removed from runtime callers, fixtures and smoke checks. Live fallback never changes HTTP Search or the saved preference. Search-scoped cooldowns remain route-specific; named model failures and failed no-Search controls retain model-scoped cooldowns.

Text/screen requests are never silently resent without Search. The explicit **Retry request without Search** action checks the failed request and session epoch, changes only HTTP Search, and retries the retained request without reconnecting Live. The earlier action incorrectly reused Live recovery. The new IPC is in both the sandboxed preload allowlist and the machine-readable trust inventory.

## Source ownership and regression map

| Responsibility | Owner | Evidence |
| --- | --- | --- |
| Native options, trusted window IPC, lifecycle cleanup | `src/utils/window.js` | `tests/final-runtime-repair.test.js`, security boundary tests |
| DIP resize, fit/restore, monitor clamping, persistence | `src/utils/windowModeController.js` | final repair, appearance and Windows HUD tests |
| Pointer/keyboard resize controls | `src/components/WindowResizeHandles.js` | bounded in-flight IPC and pointer cleanup tests |
| Appearance token and HUD surface | `rendererTheme.js`, `ContextHaloAppStyles.js` | appearance/save tests; packaged compositor gate |
| Failure scope and single setup control | `geminiFailure.js`, `geminiSetupRecovery.js` | final repair and installed-SDK loopback tests |
| Provider/reconnect/cooldown ownership | `gemini.js` | recovery, service, production wiring and request tests |
| Route-specific request recovery and disclosure | `ContextHaloApp.js`, `MainView.js`, `CustomizeView.js` | UI request recovery and final repair tests |
| Sanitized diagnostic fields | `transportLogger.js` | existing diagnostic redaction tests |
| Current IPC capability map | `preload.js`, `docs/PHASE_3_TRUST_BOUNDARIES.json` | exact capability inventory test |

Removed rather than layered over: obsolete native maximize owner/export in `runtimeHardeningMain.js`, old setup fallback predicates/inline retry branches, unused Gemini error-formatting helpers and generic tool export, duplicate appearance token, stale Search aliases, and incorrect default-Search-on UI fallback. Their callers and behavioral tests were updated with the replacement; no monkey patch, second preload, transport migration workflow or production compatibility shim was introduced.

Model defaults and dependency pins are unchanged. Existing Gemini AUDIO/transcription, thinking omission for Live, compression, cancellation, grounding attribution/retention and thought-signature behavior are preserved. Groq and Local AI routing, credentials, native download provenance, saved History and GPL provenance are not changed. Older dated audits retain their original evidence but are explicitly superseded where their transparency/Search or completion claims conflict with this repair.

## Compositor acceptance in the existing Windows workflow

`windows-compositor-acceptance.js` runs once, on the exact packaged EXE at Chromium scale 1, through the existing Windows acceptance owner. There is no extra workflow or repeated four-scale compositor job. It keeps DevTools closed, checks native resizing is disabled, places black/white fixture backgrounds behind the real app shell, and captures a cropped desktop region using Windows GDI rather than `webContents.capturePage()`.

Alpha samples are 0, 0.25, 0.5, 0.8 and 1. The probe checks the root blend and an opaque foreground marker, saves cropped PNGs, and writes `compositor.json` plus its result in the existing `checks.json`. A compositor mismatch fails the normal packaged smoke rather than being reported as a pass.

Temporary capture-protection changes and fixture surfaces are allowed only in the isolated `--ci-smoke-test` profile and are restored in `finally`. No account or real user content is loaded. Production capture protection is unchanged. This automated fixture is not a substitute for physical Windows 10/11, mixed-monitor DPI, click-through or third-party sharing acceptance.

## Validation performed for this repair

Source was obtained from the successful current-main Actions source artifact and checked against its recorded digest. Hidden workflow files and installed dependencies are not present in that source snapshot, so environment-dependent checks remain owned by the normal GitHub Windows workflow.

- `npm run check`: 139 JavaScript files pass.
- Focused final repair suite: 86 passed, 0 failed, 0 skipped.
- Broad dependency-independent run: 327 tests total; 317 passed, 0 failed, 10 installed-SDK/Electron tests skipped because those dependencies are not present in the source snapshot.
- Existing full-suite checks that require hidden `.github` files or installed Marked are not represented as local passes. Their assertions were not removed or weakened.
- The new actual-desktop compositor gate and packaged Electron launches are implemented but not claimed as passed until the Windows PR workflow records them.
- No physical Windows/account acceptance result is claimed.

The full Windows workflow remains the merge gate. It installs the lockfile, audits production dependencies, runs all tests, executes the real renderer, packages/checksums the EXE and tests the package at the existing four scales. This repair does not add a duplicate workflow or manually substitute fixture results for physical/account acceptance.

## Remaining release gates, not silently marked passed

The physical/provider matrix still requires real account Search-on/off comparisons, audio devices, Windows sleep/wake, multi-monitor/physical DPI, third-party capture protection, native CPU/Vulkan inference, interrupted downloads and wall-clock 1h/4h/8h sessions. Its historical `not-run` results remain unchanged.

The connected repository write interface does not grant Administration writes for rulesets or immutable-release settings. The existing Phase 8 policy/applicator is retained; those settings must be applied with appropriate authorization and verified, not bypassed with an Actions token. A passing source suite or an earlier closure document is not evidence that either administrative setting is enabled. Do not publish a final-completion claim until CI and the relevant real acceptance evidence exist.

## Official contract references checked

- Electron transparent windows: https://www.electronjs.org/docs/latest/tutorial/custom-window-styles
- Electron native geometry: https://www.electronjs.org/docs/latest/api/base-window
- Electron DIP/physical conversion: https://www.electronjs.org/docs/latest/api/screen
- Gemini 3.8 Live capabilities: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live
- Live Google Search tools: https://ai.google.dev/gemini-api/docs/live-api/tools
- Live compression/resumption: https://ai.google.dev/gemini-api/docs/live-api/session-management
- Gemini limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Search pricing/accounting: https://ai.google.dev/gemini-api/docs/pricing
- HTTP grounding contract: https://ai.google.dev/gemini-api/docs/generate-content/google-search

These sources describe platform/provider contracts, not the user's project entitlement, exact quota or Windows GPU/compositor behavior.
