# Windows workspace repair validation

Work in progress; not a release-readiness claim. Base: `828e997ade1c05b898c20e422a69bc68b8758334` (main matched the audited commit on 2026-09-08).

## Evidence and limits

- Read AGENTS.md; preserve GPL-3.0, LICENSE/CREDITS, the Electron/Lit stack, all three providers, encryption, settings and history.
- No issue records returned by repository issue search. Reviewed recent PRs 30, 31 and 32; preserve duplicate-start guards, request epochs, typed HTTP requests, capture cleanup and response routing.
- Retrieved source and real Windows renderer screenshots from successful baseline workflow run 33944652752 (build 162). Those are baseline evidence, not real-device acceptance.
- The separately named CONTEXTHALO-AUDIT.md attachment is not accessible in this conversation. User reports are reproduction targets, not proven account/device failures.
- Ponytail was explicitly requested but its skills were not exposed by skill discovery and the plugin directory search returned no entry. Do not claim Ponytail execution or certification.
- Local execution environment: Linux x64, Node 22.16.0. Source check passed. Initial tests: 66 passed, 4 failed due to missing Electron/Google SDK dependencies, not diagnosed application failures. npm installation is blocked by registry DNS errors (EAI_AGAIN). Windows PR CI is the executable validation path.
- No authorized provider keys, physical audio devices, Windows 10/11 desktop, multi-monitor or DPI test devices are available here. Never substitute fabricated screenshots or mocked account results.

## Acceptance required

Search requested/effective state, typed/screenshot/Live scope, structured 429 categories and retry metadata; authentication/unsupported tools; cancellation and repeated actions; startup/capture/reconnect/end cycles; all three providers; audio and display capture modes; theme/background-alpha persistence; keyboard-only HUD at minimum size; 100/125/150/200 percent scaling; independent visual transparency, click-through and capture exclusion; launch the built portable executable.

Implementation and exact validation results will be recorded below. This branch must not merge or publish a release without separate authorization.
