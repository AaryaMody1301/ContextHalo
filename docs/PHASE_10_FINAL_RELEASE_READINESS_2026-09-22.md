# Phase 10 Final Release-Readiness Re-Audit — 2026-09-22

## Baseline

Phase 10 starts from merged Phase 9 `main` at `2914c8873666603aaaf1f4791019258693219ce6`.

Post-merge release evidence:

- release: `v0.8.0-portable.381`
- target commit: `2914c8873666603aaaf1f4791019258693219ce6`
- EXE SHA-256: `b1753e15aab1b72ab0412f5ef6c31c83ef76c0f48099e522dba8808c42f793c7`
- main workflow run: `35694058453`
- build job: passed
- artifact attestation job: passed
- release publication job: passed

The machine-readable status is `docs/PHASE_10_RELEASE_READINESS.json`.

## Current upstream re-check

### Electron

ContextHalo remains on Electron `^44.3.0`. Electron 44.3.0 ships Chromium 152 and Node 24.20.0. The current Electron security checklist still requires context isolation, sandboxing, restrictive navigation/window creation, trusted IPC senders, CSP, safe external URLs, current Electron, custom protocols where practical, and fuse review.

References:

- https://releases.electronjs.org/release/v44.3.0
- https://www.electronjs.org/docs/latest/tutorial/security

The existing Phase 3 trust-boundary tests remain the owning security evidence. Phase 10 does not reopen the custom-protocol migration without a demonstrated regression.

### Gemini

Current Google documentation still describes:

- `gemini-3.8-live` long-session handling through context compression, session resumption, and GoAway;
- `generateContent` as fully supported;
- Interactions as recommended for new development;
- Interactions state storage as enabled by default unless `store=false`.

References:

- https://ai.google.dev/gemini-api/docs/live-api/session-management
- https://ai.google.dev/gemini-api/docs/live-api/best-practices
- https://ai.google.dev/gemini-api/docs/migrate-to-interactions
- https://ai.google.dev/gemini-api/docs/logs-datasets

`@google/genai` 2.23.0 remains the latest observed upstream release. ContextHalo stays on audited 2.22.0 because Phase 2 already evaluated 2.23.0 and found no required transport/wire correction for this application.

### Groq

Groq continues to list `openai/gpt-oss-120b` and `whisper-large-v3-turbo` as production models. Groq explicitly says Preview models are for evaluation and may be discontinued at short notice.

Reference:

- https://console.groq.com/docs/models

ContextHalo therefore retains production chat/transcription defaults and keeps the Groq vision lifecycle visible through the dynamic model catalog rather than pretending Qwen vision is a permanent production contract.

### Local AI

Official whisper.cpp still lists v1.9.4 as latest, at the same commit used by ContextHalo's b5130 runtime.

Reference:

- https://github.com/ggml-org/whisper.cpp/releases

llama.cpp has newer fast-moving pre-release builds beyond ContextHalo's pinned b10964. Phase 10 does not chase those builds solely to claim "latest": the shipped CPU/Vulkan artifacts remain official, immutable, checksum-pinned upstream releases, and no required compatibility/security fix was established.

Reference:

- https://github.com/ggml-org/llama.cpp/releases

### electron-builder

v27 remains a real build-system migration. It requires Node >=22.12 and changes unset toolsets so they resolve to moving `latest` bundles. That is material to reproducibility and stays out of the final readiness PR.

References:

- https://www.electron.build/docs/migration/v27-breaking-changes/
- https://www.electron.build/docs/migration/v26-to-v27/

## Final static repository gate

`scripts/final-readiness-audit.js` verifies the release repository without duplicating every lower-level test:

- every tracked file belongs to an explicit repository/runtime/test/build/documentation class;
- Phase 0 through Phase 9 evidence exists;
- direct production dependencies agree with the lockfile and provenance inventory;
- vendored renderer JavaScript matches recorded blob/version/license/source provenance;
- native runtimes and Whisper models retain immutable revision + SHA-256 provenance;
- production dependency audit, artifact attestation, packaged scale testing, and trusted-IPC documentation remain present;
- Phase 10 records the actual Authenticode state from the built EXE.

Run:

```
node scripts/final-readiness-audit.js
```

This exits nonzero for a static repository regression.

```
node scripts/final-readiness-audit.js --require-final
```

This additionally requires the external/admin/physical blockers to be resolved.

## Authenticode evidence

The pre-Phase-10 workflow inferred signing posture from configuration but did not inspect the exact produced EXE.

Phase 10 adds Windows `Get-AuthenticodeSignature` evidence for the packaged artifact and writes `qa-results/release/authenticode.json`.

Accepted current states:

- `Valid` — signed artifact;
- `NotSigned` — allowed for the current portable/manual channel.

Any other Authenticode state fails CI because it represents an invalid or unverifiable signature condition.

The portable/manual update policy remains unchanged. A future managed installer/update channel still requires trusted Windows signing.

Reference:

- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature

## Phase 10 PR validation evidence

Windows workflow run `35695226484` (run #382) passed the first complete Phase 10 gate:

- 128 JavaScript files validated;
- 325 tests passed / 0 failed;
- real sandboxed Electron behavior/layout smoke passed;
- portable EXE SHA-256: `f3f582ef177875ac4884ed3a2ead4093dfd566dcce0e9e6d9e837374d8a2b384`;
- measured Authenticode state: `NotSigned`;
- packaged identity: `0.8.0-portable.382` / `v0.8.0-portable.382`;
- packaged launches passed at Chromium scale factors 1, 1.25, 1.5 and 2.

The `NotSigned` result is evidence, not an inferred configuration state. It is acceptable for the current manual portable channel; an invalid signature state would fail the workflow. The final post-merge release will have a new run-derived version/hash and will be measured again by the same gate.

## External blockers still open

### 1. Main ruleset is not active

At Phase 10 start:

`GET /repos/AaryaMody1301/ContextHalo/rulesets` returned `[]`.

The Phase 8 desired ruleset exists in the repository, but GitHub Administration permission is required to activate it. Until then, direct pushes are not technically prevented by repository policy.

GitHub documents that required status checks only take effect once the ruleset is created/active and the required check is configured.

Reference:

- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository

### 2. Immutable releases are not active

The latest release `v0.8.0-portable.381` reports:

`immutable: false`

GitHub immutable releases lock release assets/tag after publication and generate release attestation metadata. ContextHalo's publish sequence is already compatible (draft -> attach assets -> publish), but the repository setting still needs Administration-level activation.

Reference:

- https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases

### 3. Physical Phase 9 acceptance is not executed

Every scenario in `docs/PHASE_9_ACCEPTANCE_MATRIX_TEMPLATE.json` remains `not-run`.

Therefore the repository cannot truthfully claim physical Windows 10/11, real 8-hour Gemini, device removal, sleep/wake, multi-monitor, real sharing-app content protection, or Local AI wall-clock acceptance yet.

## Final designation

Phase 10 separates two statements:

**Static repository/release implementation readiness** can pass through PR CI.

**Final clean/release-readiness designation** remains false until:

1. the Phase 8 `main` ruleset is active;
2. immutable releases are enabled and a subsequent release proves `immutable: true`;
3. the Phase 9 physical acceptance matrix has recorded pass/not-applicable evidence for every required scenario.

This prevents the final audit from turning unresolved external work into a documentation-only "pass."
