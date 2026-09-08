# Windows workspace repair: evidence and acceptance scope

Repair branch: `fix/windows-workspace-search-recovery`; draft PR #33. Do not merge or publish without separate authorization.

## Baseline and provenance

The repository's `main` matched audited commit `828e997ade1c05b898c20e422a69bc68b8758334` when work began. `AGENTS.md`, startup/HTML overrides, provider/capture/session paths and recent reliability changes were inspected. Existing request epochs, duplicate-start guards, IPC validation, cancellation, encrypted credential storage and GPL provenance remain. `package.json`, `package-lock.json`, `LICENSE` and `CREDITS.md` are unchanged.

A fresh documentation-only Windows baseline ran at Actions run **34200641270** before application changes: locked installation and production dependency audit passed, source validation checked 59 JavaScript files, all **81 tests** passed, the existing sandboxed renderer smoke passed, and the portable EXE built. Its source matched the audited application. `main.png`, `customize.png`, `assistant.png` and `checks.json` are genuine baseline renderer artifacts, not design mockups.

The local Linux baseline could not install dependencies because container network/DNS access failed. Its incomplete local test result is not evidence of a Windows application failure; the fresh Windows baseline supplies the complete comparison.

## Implemented changes and owners

| Finding | Implementation and evidence |
| --- | --- |
| Fixed HUD layers compounded opacity; theme changes lost saved alpha | `renderer.js` preserves alpha, including zero; Customize labels it HUD background opacity. App/Assistant own theme-aware surfaces; `windowModeController.js` removes HUD material without fading foreground text, preserves bounds and clamps display changes. Appearance tests cover stored alpha, theme reload and separate native privacy controls. |
| Interview controls and secondary panels crowded the answer | Native End/Hide buttons, explicit provider/capture/Search status, bounded errors, a multiline composer, copy/navigation in one row, collapsible transcript/context/knowledge controls, focus styles and native dialogs in the owning Lit components. Real renderer assertions require a usable answer area and reachable controls. |
| Search fallback silently changed effective behavior and typed requests restored the preference | `gemini.js` owns requested/effective session Search across Live, typed and screenshot calls; explicit continue-without-Search keeps the preference for later sessions. Prompt/tool configuration and the persistent indicator follow the session state. No catch-all immediate no-Search retry remains. |
| 429 categories and overlapping retries were conflated | `classifyGeminiFailure` separates authentication, permission, unsupported tools/models, quota exhaustion, ambiguous 429, short-term throttling and transient failures. `runGeminiRequest` owns at most two attempts; SDK retries are disabled. Provider delay, deadline, cancellation and account/model cooldowns are respected. Unknown or exhausted quota is not automatically retried. |
| Grounding information was discarded | `GroundingSources.js`, response metadata and history retain safe source links and provider Search suggestions in a scriptless isolated frame. Source links use the validated external-link IPC. |
| Start, partial failure, reconnect and End competed | `ContextHaloApp.js` owns lifecycle/readiness/epochs; `renderer.js` owns capture resources; `sessionRequests.js` owns request cancellation. Failed sends preserve drafts. Failed final saves retain context in memory and block another session until saved. Analyze reports a full-response wait and supports cancellation rather than pretending to stream. |
| Capture could leak late streams or switch to an unrelated display | Tracks, contexts, processors, timers and late permission results are cleaned up. Microphone/speaker/mixed modes and degraded mixed input are tested. An explicitly selected missing window/display now denies capture rather than silently selecting another screen. |
| Groq and Local AI request history initialized from itself | Corrected history snapshots in `gemini.js` and `localai.js`; deterministic provider tests exercise text/vision, successful-turn commits and cancellation. Concurrent marker actions share the initial history read and cannot cross a session epoch. |
| Runtime wrapping and reinjection obscured ownership | Shared native provider forms replace repeated rendering. Transcript/context/workspace controls render in their owners. Five superseded patch files were removed after migrating behavior. See `TEST_MIGRATION.json` for replaced filename/CSS/monkey-patch assertions. |

## Verified caller paths

Startup is `index.js -> createWindow -> preload -> index.html -> ContextHaloApp/renderer`. `index.html` now loads the owner module and renderer, not stacked HUD/form/lifecycle overrides. Header, Home and shortcut Start/End paths converge on App lifecycle methods. Composer and quick requests use the same text path; Analyze button, region action and keyboard shortcut converge on the cancellable screen-analysis owner. Preferences, Live setup, HTTP text/image calls and reconnect share Gemini's session Search policy. Context, knowledge and response-style augmentation remain in ordinary provider calls. Windows display-media selection has one owner; non-Windows hardening is retained.

## Validation interpretation

Local source validation passes for 55 JavaScript files; **92 behavioral tests** pass. The Windows workflow repeats both commands with locked dependencies, runs the real sandboxed renderer, builds the portable executable with publishing disabled, then launches that executable at Chromium device scales 1, 1.25, 1.5 and 2. Every launch must write a successful `outcome.json` reporting `packaged: true`, `win32`, `x64`, app/Electron/OS versions and the tested commit. A successful build alone does not satisfy the workflow. Exact final run outcome, checksum and artifacts are recorded on PR #33 and in the delivered evidence package; inspect those rather than treating this scope document as a passed device matrix.

The first repaired run, **34205730711**, passed source tests and the real renderer and launched the package successfully at 100%, 125% and 150%. At 200%, its 512x364 logical desktop exposed an answer-area failure. The response toolbar and narrow composer layout were corrected without reducing that assertion. The next run, **34206577658**, reached the new keyboard check and exposed an incomplete synthetic native Enter event sequence in the harness; the missing character event was added without changing native control behavior.

The renderer workflow checks normal/compact navigation, real storage/knowledge/practice/review IPC, response isolation and HTML safety, draft retention, grounding links and attribution, saved alpha reload, independent Search status, minimum HUD layout with long errors and expanded secondary panels, and native Tab/Enter input. Light/dark theme images cover alpha 0.25, 0.5, 0.8 and 1. Unit tests additionally cover zero alpha, lifecycle faults, the three providers, controlled 429/auth/tool failures, retry metadata, repeated actions, pending cancellation, reconnect, three audio modes, stopped capture, monitor/region selection and repeated cycles.

CI uses **Windows Server 2022 (10.0.20348), x64, Electron 43.6.0, app 0.8.0, Node 24**. Forced Chromium scale is not physical Windows DPI testing. Provider replies/devices are controlled fixtures; storage and renderer/native IPC are real. Renderer captures do not prove desktop compositor transparency, click-through or exclusion from third-party capture.

## External acceptance still required

No authorized real provider account, microphone/speaker device or physical Windows 10/11 workstation was available. Actual project quota categories/reset behavior, live Search results, device audio, Windows permission dialogs, physical 100/125/150/200% DPI, mixed-monitor changes, light/dark desktop compositing, click-through and third-party capture exclusion remain unverified. These must be tested independently; turning Search off does not bypass a project's model quota. Full keyboard-only and assistive-technology acceptance also exceeds the automated key/focus checks.

The named `CONTEXTHALO-AUDIT.md` attachment and Ponytail audit/full implementation skills were not exposed in this session despite file/plugin lookup. User reports were treated as reproduction targets, not account/device proof. Simplification measurements are manual repository diffs, not fabricated Ponytail output.

## Simplification measurement

Compared with the audited source snapshot, runtime files (`src/**` and `preload.js`) have **3,256 additions, 5,788 deletions: net -2,532 lines**. Tests add a net 311 lines; the renderer behavior script adds a net 34. Documentation/workflow changes are excluded from this runtime figure. Five superseded runtime patch files are deleted; package/dependency changes are zero. Tests are not counted as deleted functionality: 31 obsolete representation-coupled assertions have explicit behavioral replacements in `TEST_MIGRATION.json`.

## Official compatibility references checked

- https://ai.google.dev/gemini-api/docs/live-api/tools : Google Search is supported with Gemini 3.1 Flash Live; Live was not categorically declared unsupported.
- https://ai.google.dev/gemini-api/docs/google-search : HTTP grounding and Search suggestion/source metadata requirements.
- https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpRetryOptions.html : SDK attempt limits.
- https://www.electronjs.org/docs/latest/tutorial/custom-window-styles : transparent-window limitations and platform material behavior.

Configured defaults remain Gemini `gemini-3.1-flash-live-preview` and `gemini-3.8-flash`; manual model selections are preserved. Catalog discovery remains advisory and does not silently switch the user's model or provider.
