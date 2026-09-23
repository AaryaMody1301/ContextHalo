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

`windows-compositor-acceptance.js` runs once, on the exact packaged EXE at Chromium scale 1, through the existing Windows acceptance owner. There is no extra workflow or repeated four-scale compositor job. It keeps DevTools closed, checks native resizing is disabled, places black/white fixture backgrounds behind the real app shell, and captures a cropped desktop region using Windows GDI rather than `webContents.capturePage()`.

Alpha samples are 0, 0.25, 0.5, 0.8 and 1. The probe checks the root blend and an opaque foreground marker, saves cropped PNGs, and writes `compositor.json` plus its result in the existing `checks.json`. A compositor mismatch fails the normal packaged smoke rather than being reported as a pass.

Temporary capture-protection changes and fixture surfaces are allowed only in the isolated `--ci-smoke-test` profile and are restored in `finally`. No account or real user content is loaded. Production capture protection is unchanged. This automated fixture is not a substitute for physical Windows 10/11, mixed-monitor DPI, click-through or third-party sharing acceptance.

## Validation and packaged-compositor CI correction

PR #71's first Windows run, [35831847817 / workflow 400](https://github.com/AaryaMody1301/ContextHalo/actions/runs/35831847817), tested merge commit `2dc96d33a9bee77a0fe6293bf673ba1d6305b647` with PR head `b0a31bfb0a5a302f7641f93cb69f798e3167982c`. The job ran on Windows Server 2022 (10.0.20348), Electron 44.3.0, Node 24.21.0.

The recorded run passed production dependency audit (zero vulnerabilities), syntax validation (139 JavaScript files), the full regression suite (**360 passed, zero failed, zero skipped**), the real sandboxed Electron renderer smoke, and portable EXE packaging/checksum. It then failed at the first packaged launch (100% scale), before a compositor pixel comparison could run:

`Graphics.CopyFromScreen: InvalidEnumArgumentException: CopyPixelOperation value 1087111200`

That value is `SRCCOPY | CAPTUREBLT`. Windows PowerShell's .NET Framework `CopyFromScreen` wrapper rejects the combined enumeration value. The failure is in the acceptance capture call, not evidence that desktop transparency passed or failed.

The correction replaces that wrapper with the documented native GDI `BitBlt` call, retaining both flags as a DWORD so layered transparent windows remain captured. The desktop and destination device contexts are released in paired `finally` blocks, Graphics/Bitmap resources are disposed, native errors remain fatal, and the destination HDC is released before PNG encoding. The bitmap explicitly uses opaque 24-bit RGB because this is a capture of the already-composited desktop, not an alpha texture.

All five opacity samples, black/white backgrounds, foreground checks, pixel tolerances, ten-second capture deadline, production/smoke guards and failure propagation are unchanged. The obsolete `CopyFromScreen`/enum-cast executable path is removed rather than retained as a fallback. No workflow, runtime provider, dependency, feature branch history or previously discussed transparency/Search implementation is replaced by this correction.

The checked-out failing-run source artifact has SHA-256 `ab660f3dd13a2bf084a3bef877dcfedfda86a97852318efed096ea4647f1e053`. Validation of the corrected source in the Linux editing environment:

- `npm run check`: **140 JavaScript files passed**.
- Focused compositor, final-runtime, appearance, window geometry, Gemini recovery, UI-request recovery and Electron-security suites: **65 passed, zero failed, zero skipped**.
- The six new compositor tests exercise the actual JavaScript acceptance owner with explicit native-boundary fixtures: native call/flag contract, capture error, incorrect opacity, faded foreground, empty image, and production/platform/DevTools/native-resize guards. They also verify failure evidence and capture-protection/theme/fixture cleanup.
- These fixture tests do **not** execute Windows GDI or certify compositor pixels. Native execution of the correction and packaged 100/125/150/200% launches remain the existing Windows PR workflow's responsibility. The previous run's 360-test result is historical evidence, not a new CI pass.

No new workflow, duplicate deployment, weakened assertion or forced successful status is introduced. The same PR branch receives the correction in one push, and the normal Windows workflow remains the merge gate.

### Workflow 401 follow-up

PR run [35832956900 / workflow 401](https://github.com/AaryaMody1301/ContextHalo/actions/runs/35832956900) confirmed the native GDI correction executed: source validation passed for **140 JavaScript files**, the complete regression suite passed **366/366 with zero skips**, the real Electron smoke passed, and the portable EXE built and checksummed. The 100% packaged compositor gate then failed on the first alpha-0/black sample with `Foreground faded or fixture window was not composited on top`.

The uploaded behavior evidence was inspected rather than weakening the assertion. `compositor-0-0.png` is a 100x24 image whose 2,400 pixels are all RGB 0,0,0. This means the desktop capture itself succeeded and the transparent surface correctly revealed the black fixture at alpha 0, but the intended opaque foreground probe was not present in that captured region. The previous probe was appended as a sibling of the real app shell and the crop/sample locations were hard-coded.

The follow-up correction puts the opaque RGB(224,224,224) probe **inside the real `.app-shell`**, hides existing shell children while explicitly exempting the probe, reads its actual `getBoundingClientRect()`, and derives both the desktop crop and surface/foreground sample coordinates from that renderer geometry. The acceptance no longer assumes fixed marker/crop alignment. Failing capture records are written to `compositor.json` before assertions so future native failures retain the observed pixels and rectangle. Alpha thresholds, the opaque-foreground requirement, GDI `SRCCOPY | CAPTUREBLT`, production guards, cleanup and the existing Windows workflow remain unchanged.

Validation of this follow-up against the exact workflow-401 source artifact:
- `npm run check`: **140 JavaScript files passed**.
- Focused transparency, geometry, Gemini Search recovery, UI recovery and security suites: **66 passed, zero failed, 7 installed-SDK tests skipped because the source artifact does not contain installed dependencies**.
- The compositor-specific suite: **6 passed, zero failed, zero skipped**.
- Native Windows pixel acceptance is not claimed until the newly pushed head runs through the normal Windows workflow.

## Remaining release gates, not silently marked passed

The physical/provider matrix still requires real account Search-on/off comparisons, audio devices, Windows sleep/wake, multi-monitor/physical DPI, third-party capture protection, native CPU/Vulkan inference, interrupted downloads and wall-clock 1h/4h/8h sessions. Its historical `not-run` results remain unchanged.

The connected repository write interface does not grant Administration writes for rulesets or immutable-release settings. The existing Phase 8 policy/applicator is retained; those settings must be applied with appropriate authorization and verified, not bypassed with an Actions token. A passing source suite or an earlier closure document is not evidence that either administrative setting is enabled. Do not publish a final-completion claim until CI and the relevant real acceptance evidence exist.

## Official contract references checked

- Windows GDI BitBlt and layered capture: https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-bitblt
- .NET CopyFromScreen enumeration validation: https://learn.microsoft.com/en-us/dotnet/api/system.drawing.graphics.copyfromscreen
- Graphics HDC ownership: https://learn.microsoft.com/en-us/windows/win32/api/gdiplusgraphics/nf-gdiplusgraphics-graphics-gethdc
- Desktop DC release: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-releasedc
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
