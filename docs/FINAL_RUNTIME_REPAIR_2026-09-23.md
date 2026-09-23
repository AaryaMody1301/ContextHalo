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
| Desktop capture and compositor failure cleanup | `scripts/windows-compositor-acceptance.js` | `tests/windows-compositor-acceptance.test.js`; packaged Windows pixel gate |
| Sanitized diagnostic fields | `transportLogger.js` | existing diagnostic redaction tests |
| Current IPC capability map | `preload.js`, `docs/PHASE_3_TRUST_BOUNDARIES.json` | exact capability inventory test |

Removed rather than layered over: obsolete native maximize owner/export in `runtimeHardeningMain.js`, old setup fallback predicates/inline retry branches, unused Gemini error-formatting helpers and generic tool export, duplicate appearance token, stale Search aliases, and incorrect default-Search-on UI fallback. Their callers and behavioral tests were updated with the replacement; no monkey patch, second preload, transport migration workflow or production compatibility shim was introduced.

Model defaults and dependency pins are unchanged. Existing Gemini AUDIO/transcription, thinking omission for Live, compression, cancellation, grounding attribution/retention and thought-signature behavior are preserved. Groq and Local AI routing, credentials, native download provenance, saved History and GPL provenance are not changed. Older dated audits retain their original evidence but are explicitly superseded where their transparency/Search or completion claims conflict with this repair.

## Compositor acceptance in the existing Windows workflow

`scripts/windows-compositor-acceptance.js` runs once on the exact packaged EXE at Chromium scale 1 through the existing Windows acceptance owner. There is no second workflow and no renderer screenshot presented as native proof. The smoke keeps DevTools closed, requires native resizing to stay disabled, temporarily disables capture protection only inside `--ci-smoke-test`, places controlled black/white windows behind ContextHalo, and captures the matching Windows display through Electron's supported `desktopCapturer.getSources({ types: ['screen'] })` path.

The capture source is matched to Electron `screen.Display.id` through `DesktopCapturerSource.display_id`; only a one-display/one-source environment may use the documented empty-`display_id` fallback. Because Electron does not guarantee that a source thumbnail equals the requested `thumbnailSize`, the real thumbnail dimensions are mapped back to the display DIP bounds before cropping. The crop itself is derived from the real `.app-shell` bounding rectangle, with existing shell children hidden so only the root alpha surface is measured.

Alpha samples are 0, 0.25, 0.5, 0.8 and 1 over both black and white controlled backdrops. Every captured frame now contains two independently sampled regions: an app-shell crop and a control crop chosen from visible backdrop space outside the ContextHalo window. The control must first match the requested black/white fixture color; only then is the app crop compared with the expected composition of the dark theme base (`#101010`) and that verified backdrop. This separates a bad fixture/capture from a real alpha failure. Foreground opacity remains covered independently by renderer/appearance tests, so the desktop gate no longer depends on a synthetic marker unrelated to the transparency requirement.

Temporary capture-protection changes, hidden fixture content and backdrop windows are restored in `finally`. Production sessions never run this capture path. Physical Windows 10/11, mixed-monitor DPI, click-through and independent third-party sharing acceptance remain separate external gates.

## Validation and packaged-compositor CI corrections

PR #71 has produced four useful Windows failures, each inspected from its actual workflow logs/artifacts instead of being re-run blindly:

- **Workflow 400 / run 35831847817**, head `b0a31bfb0a5a302f7641f93cb69f798e3167982c`: dependency audit, 139-file syntax validation, **360/360 tests**, real Electron smoke and portable packaging passed. The 100% packaged smoke failed before a pixel assertion because .NET `Graphics.CopyFromScreen` rejected the combined `SRCCOPY | CAPTUREBLT` enum value.
- **Workflow 401 / run 35832956900**, head `67247e96c7ea79b4c537a441a6d7ba6ebf7a10d4`: the GDI replacement executed, 140-file syntax validation, **366/366 tests**, real Electron smoke and packaging passed. The first alpha-0 capture contained only the controlled backdrop, so the synthetic foreground probe was not observed.
- **Workflow 404 / run 35838421337**, head `2b33e803e58a57c5fb87ca634649352f5b133365`: 140-file syntax validation, **366/366 tests**, real Electron smoke and packaging again passed. The uploaded renderer-derived crop was correct but all pixels remained backdrop black, including the marker. This established that changing marker geometry did not solve the display-DC capture boundary.
- **Workflow 407 / run 35839976775**, head `494b6a0645c9282f25813c145c23ffacc678240a`: 140-file syntax validation, **369/369 tests with zero skips**, real Electron smoke and packaging passed. Electron screen capture selected the exact display and sampled the expected app coordinates, but alpha 0 over the requested white fixture still returned black. This run did not independently sample a point outside ContextHalo, so it could not distinguish a backdrop that failed to repaint from a genuinely opaque app surface.

The current acceptance path keeps Electron `desktopCapturer` but closes that diagnostic gap. The backdrop is now an explicitly opaque HTML surface whose DOM background is updated and allowed two animation frames to commit. A control rectangle is selected in the display work area that cannot intersect the ContextHalo window. The same screen-source thumbnail is used for both the control crop and the app crop. A control mismatch fails as `Backdrop control mismatch`; only a verified control can produce `Desktop alpha mismatch`. Both crops are written as evidence for every alpha/backdrop pair.

Microsoft documents DirectComposition as DWM-owned composition and recommends avoiding reads from a display DC. Electron documents `desktopCapturer` as its screen/window capture API, `DesktopCapturerSource.display_id` as corresponding to `screen.Display.id`, and notes that actual thumbnail size can differ from the requested size. The abandoned PowerShell/GDI `BitBlt`, `CAPTUREBLT` and marker paths are not retained as runtime fallbacks.

Validation of this control-sample correction against the exact workflow-404 source snapshot:

- `npm run check`: **140 JavaScript files passed**.
- Focused appearance, window geometry, Gemini Search recovery, UI recovery, IPC/security and compositor suites: **85 passed, zero failed, zero skipped**.
- The compositor suite now verifies successful black/white control samples, app alpha samples, exact display selection, single-display fallback, control placement outside the app, fixture mismatch, opacity mismatch, empty capture, ambiguous display source, z-order fallback, capture failure and production/DevTools/native-resize guards.
- Critical runtime ownership remains unchanged: the transparent BrowserWindow is natively non-resizable/non-maximizable; app-owned resizing remains the only resize path; legacy `searchState.effective` remains absent; Live and HTTP Search recovery remain separate; no provider/model/API-key fallback was introduced.

These local fixture tests do not certify Windows compositor pixels. The newly pushed head must still pass the normal Windows workflow's packaged 100/125/150/200% launches before native transparency is recorded as verified. No workflow, dependency/model upgrade, duplicate deployment, weakened alpha assertion or forced successful status is introduced.

## Official contract references checked for this correction

- Electron screen capture: https://www.electronjs.org/docs/latest/api/desktop-capturer
- Electron screen-source display mapping: https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source
- Electron display/DIP model: https://www.electronjs.org/docs/latest/api/screen
- Electron transparent windows: https://www.electronjs.org/docs/latest/tutorial/custom-window-styles
- Microsoft DWM drawing/capture guidance: https://learn.microsoft.com/en-us/windows/win32/dwm/bestpractices-ovw
- Microsoft DirectComposition architecture: https://learn.microsoft.com/en-us/windows/win32/directcomp/architecture-and-components
- Gemini 3.8 Live capabilities: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live
- Live Google Search tools: https://ai.google.dev/gemini-api/docs/live-api/tools
- Live compression/resumption: https://ai.google.dev/gemini-api/docs/live-api/session-management
- Gemini limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Search pricing/accounting: https://ai.google.dev/gemini-api/docs/pricing
- HTTP grounding contract: https://ai.google.dev/gemini-api/docs/generate-content/google-search

These sources define platform/provider contracts, not the user's exact Gemini entitlement/quota or physical Windows/GPU behavior.

## Remaining release gates, not silently marked passed

The physical/provider matrix still requires real account Search-on/off comparisons, audio devices, Windows sleep/wake, multi-monitor/physical DPI, third-party capture protection, native CPU/Vulkan inference, interrupted downloads and wall-clock 1h/4h/8h sessions. Its historical `not-run` results remain unchanged.

The connected repository write interface does not grant Administration writes for rulesets or immutable-release settings. The existing Phase 8 policy/applicator is retained; those settings must be applied with appropriate authorization and verified, not bypassed with an Actions token. A passing source suite or an earlier closure document is not evidence that either administrative setting is enabled. Do not publish a final-completion claim until CI and the relevant real acceptance evidence exist.
