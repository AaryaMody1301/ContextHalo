# Remaining UI/UX repair and acceptance

## Baseline and verification boundary

Baseline main: `55961a0d09357a04be104141683cff39039d857d`. AGENTS.md was read; recent PR #33 repairs were retained. Local baseline: 55 source files, 92 tests passed. Documentation-only Windows build 175 (run 34213985476) passed before application edits. Baseline screenshots were downloaded from main build 174 (run 34211061546).

Windows CI is Windows Server 2022 x64 (10.0.20348), Electron 43.6.0, application 0.8.0, Node 24. Forced Chromium scaling is NOT physical Windows DPI. Provider replies and failures are controlled fixtures; actual storage, preload, native shortcuts, window operations and renderer are exercised. No authorized real accounts or audio hardware were available. No keys, recordings or private transcripts were added.

Ponytail skill resources were not exposed by the catalog or plugin search. The requested fallback principles were applied, not represented as Ponytail execution: trace callers, fix owners, reuse native controls, remove migrated code and measure separately. No framework/dependency/model changes. LICENSE, CREDITS.md and package manifests are unchanged. No merge or release is authorized.

## Issue-to-implementation map

| Issue | Owning implementation | Observable regression coverage |
| --- | --- | --- |
| Shortcut navigation corrupts settings | CustomizeView.handleKeybindInput: readonly named fields, Tab/Shift+Tab traversal, Escape cancellation, modifier/IME/repeat guards, validation and explicit feedback | ui-shortcuts.test.js; real native keyboard traversal |
| Registration failure can strand HUD | window.js checks boolean registration, validates canonical duplicates, updates only changed actions, rolls back registration and persistence; native tray Show recovery and taskbar-minimize fallback | Refused and occupied accelerators, rollback, reload, actual native hide/restore; no unrelated unregister |
| Stale request errors | ContextHaloApp owns errors by UI session epoch, request ID, operation and sequence; gemini.js supplies request metadata; text and screen retry their own operation | Failure/retry success, overlapping requests, late success/new failure, cooldown, cancellation and end/restart |
| Cramped HUD and scroll jumps | AssistantView native Tools dialog with Transcript/Context/Actions/Knowledge, full-height panel, prominent composer; app has concise status and native Recovery dialog; hidden sidebar no longer reserves compact width; response DOM/scroll retained | 640x320 long answer/error, code/URLs, 28px text, full-width assertion, native modal traversal, streaming and new voice-card reading position |
| Home configuration dominates | MainView start-first readiness, provider/profile near top, first-time editor and collapsible advanced configuration, spaced key/model actions, honest unverified-account copy | Clean/saved/missing/unsaved/loading states, manual models, 1100x800 Start/provider visibility, normal/compact screenshots |
| History failure appears empty | storage.js distinguishes missing/unreadable/directory errors with bounded messages; HistoryView loading/empty/filter/failure/retry states and last-good-list preservation | Directory denial, malformed file, empty directory, retry, failed detail load and race |
| Saved titles missing | Metadata includes sessionPack.title; HistoryView title-first cards and normalized title search, legacy profile/date fallback; bounded mtime/ctime/size metadata cache | Duplicate, non-English, named and untitled sessions; no transcript content in list metadata; cache invalidation |
| Accessibility gaps | Named labels and buttons, native dialogs, consistent focus and navigation in Home/Settings/AI/History/onboarding/Help/Feedback/Knowledge/Practice/Review | Programmatic labels, Chromium accessibility tree, native Tab/Shift+Tab/Enter/Space/Escape and opener restoration |
| Save feedback inconsistent | Existing renderer storage interface serializes checked snapshot writes and read-after-write; per-edit Settings feedback/retry; retained AI draft; guarded onboarding completion | Rejected and explicit-false saves, rapid changes, stale completion, retry/reload and duplicate completion |
| Visual/motion inconsistency | Single Home profile editor and AI instructions editor, links from Settings; shared typography/native palette; coherent theme hydration and readable text tokens; static onboarding replaces continuous canvas | All theme text/surface contrast >=4.5, persistence/alpha, actual light/dark Settings hydration, reduced-motion and closed-view cleanup |

Paths above are under src/components/views, src/components/app, src/utils or src/storage.js as appropriate. Focused tests are tests/ui-{shortcuts,request-recovery,history,save-feedback}.test.js. The existing scripts/renderer-behavior-smoke.js owns native verification; CI logic was removed from src/index.js, not duplicated in another runtime layer.

## Validation protocol and evidence

Local final source check: 55 files. Local final suite: 127 passed, 0 failed, 0 skipped. Existing 92 tests are retained; assertions were not weakened. The real source renderer and exact built portable EXE use the same sandboxed smoke workflow. The portable executable is launched at Chromium scale factors 1, 1.25, 1.5 and 2, with explicit process deadlines, packaged/platform assertions and SHA256SUMS.txt.

Build 179 (run 34218161967, head 8559de1758e67b1161cc26f747e689653c650954) passed 124 tests, source renderer and four portable launches. Its actual screenshots exposed a compact hidden-sidebar width conflict and a light-theme fixture/hydration mismatch. These were repaired rather than accepting that green run. The subsequent source revision also preserves readers when a new background voice card arrives. Final acceptance results are recorded in PR #34 with the tested head, merge-ref commit, run, executable checksum and downloaded artifacts; build 179 is not the final repair's acceptance result.

Evidence files in ContextHalo-Behavior-Evidence:

- outcome.json: exact tested commit/platform/version/packaged result.
- checks.json: behavior, actual geometry, keyboard, accessibility controls, renderer errors and scale interpretation.
- main.png and customize.png: matching baseline native window size (1024x728 on this runner).
- home-1100x800.png: explicit virtual default viewport, distinct from physical display size.
- home-{light,dark}-{clean,saved,normal,compact}.png and settings-{light,dark}-{normal,compact}.png.
- hud-minimum-{expanded,tools,actions,recovery,error-details,large-text}.png.
- hud-{light,dark}-{0.25,0.5,0.8,1}.png, workspace screenshots and onboarding-reduced-motion.png.
- portable-{1,1.25,1.5,2}/ repeats evidence from the actual EXE. At 200% the runner's work area may clamp the HUD below 640 logical pixels; record actual geometry rather than claiming physical 640px/DPI acceptance.

Screenshots are actual Electron capturePage results, not redesign mockups or fabricated desktop composites. Native desktop visibility through the HUD must still be tested separately.

## Measured changes versus baseline (LF-normalized)

- Runtime (src + preload): 1,432 lines added / 1,656 removed; net -224.
- Unit tests: 487 added / 2 removed; net +485.
- Existing Windows smoke harness: 421 added / 11 removed; net +410.
- Dependencies and package manifests: 0 changes.
- This documentation is counted separately. Temporary checksum-verified transfer workflows were removed; final Windows workflow and permissions are unchanged.

Runtime reduction includes moving CI-only orchestration from src/index.js into the existing test harness; it is not presented as 224 lines of functionality deleted. The generic provider abstraction, state library and runtime monkey-patch approach were not introduced.

## Externally blocked live acceptance

Physical Windows 10 and 11 machines; 100/125/150/200% OS DPI and monitor changes; actual desktop compositor transparency over light/dark desktops; independent click-through/capture exclusion in sharing software; real microphone, loopback and mixed capture including stopped hardware; authorized Gemini/Groq model/quota/tool behavior and downloaded Local AI inference; actual screen-reader/Windows assistive-technology testing. Controlled mocks and accessibility-tree checks do not establish those results. No paid settings, model selections or accounts were silently changed.

## Official references consulted

- https://www.electronjs.org/docs/latest/api/global-shortcut (registration result and occupied accelerators)
- https://www.electronjs.org/docs/latest/api/tray (native restoration entry point)
- https://www.w3.org/WAI/WCAG22/Techniques/html/H102 (native dialog focus, inert background and Escape)
