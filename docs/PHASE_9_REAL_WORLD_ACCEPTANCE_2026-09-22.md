# Phase 9 Real-World Reliability and Performance Acceptance — 2026-09-22

## Baseline

Phase 9 starts from merged Phase 8 `main` at `18696754aaa7451687267119d9b8f6e5020f10a6`.

Baseline release at phase start:

- `v0.8.0-portable.375`
- target commit: `18696754aaa7451687267119d9b8f6e5020f10a6`
- Windows x64 portable EXE + checksum published

The Phase 8 repository-admin settings were still not active at the start of Phase 9: the repository ruleset list was empty and the latest release reported `immutable: false`. That is a separate repository-administration item; this phase does not falsely treat it as runtime acceptance.

## What automated tests can and cannot prove

Existing CI already covers:

- 60 virtual minutes / 36,000 Gemini Live audio chunks;
- controlled Live connection rotations;
- context compression/resumption/GoAway behavior;
- typed and screen requests during reconnects;
- bounded capture audio dispatch queues;
- capture track recovery fixtures;
- Local AI request cancellation and process cleanup fixtures;
- real sandboxed Electron UI behavior;
- the packaged Windows portable EXE at Chromium scale factors 1, 1.25, 1.5 and 2.

Those checks are necessary but do not establish:

- physical Windows 10/11 device behavior;
- real microphone/loopback device removal and recovery;
- wall-clock 1h/4h/8h memory trends;
- actual provider account latency/quota behavior;
- sleep/wake behavior on a physical PC;
- real multi-monitor capture;
- physical Windows DPI coordinate accuracy;
- capture-protection behavior in a real meeting/sharing application;
- Local AI CPU/Vulkan stability on representative hardware.

Phase 9 therefore adds evidence collection without replacing the physical gate.

## Current upstream guidance used for this phase

Electron exposes app-wide per-process CPU/memory through `app.getAppMetrics()`. CPU values are interval averages and process memory values are reported in KB.

- https://www.electronjs.org/docs/latest/api/app
- https://www.electronjs.org/docs/latest/api/structures/process-metric
- https://www.electronjs.org/docs/latest/api/structures/memory-info
- https://www.electronjs.org/docs/latest/api/structures/cpu-usage

Electron's `powerMonitor` exposes Windows suspend/resume, lock/unlock, battery/AC, and speed-limit events. Renderer and child-process failure are exposed through `render-process-gone` and `child-process-gone`.

- https://www.electronjs.org/docs/latest/api/power-monitor
- https://www.electronjs.org/docs/latest/api/app
- https://www.electronjs.org/docs/latest/api/browser-window
- https://www.electronjs.org/docs/latest/api/web-contents

Google's Live API documentation still requires long-session clients to use context compression, session resumption, and GoAway handling. Google currently documents approximately 10-minute connection lifetimes and unlimited session duration when context compression is enabled.

- https://ai.google.dev/gemini-api/docs/live-api/session-management
- https://ai.google.dev/gemini-api/docs/live-api/best-practices

Gemini and Groq both document HTTP 429 rate limiting. Groq exposes `retry-after` on 429 responses; Gemini documents `RESOURCE_EXHAUSTED`/rate-limit cases and bounded backoff.

- https://console.groq.com/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/troubleshooting

## Opt-in acceptance recorder

Normal ContextHalo runs remain unchanged.

The recorder activates only when the app is started with:

```
--reliability-acceptance
```

Set the evidence directory explicitly:

```powershell
$env:CONTEXTHALO_ACCEPTANCE_DIR = "$PWD\acceptance-gemini-8h"
$env:CONTEXTHALO_ACCEPTANCE_SAMPLE_MS = "60000"
.\ContextHalo-Windows-x64.exe --reliability-acceptance
```

The sampling interval is clamped to 10 seconds through 5 minutes. The physical acceptance default is one minute.

Recorded files:

- `metadata.json`
- `samples.jsonl`
- `events.jsonl`
- `summary.json`

After the run:

```powershell
node scripts/reliability-acceptance-report.js .\acceptance-gemini-8h --minimum-hours=8
```

This generates:

- `report.json`
- `report.md`

## Privacy boundary

The recorder is deliberately metadata-only.

It records:

- app/release/commit identity;
- platform/architecture/Electron/Chromium/Node versions;
- display scale factors, not display names or coordinates;
- Electron process type, CPU, working set/private memory, sandbox/integrity metadata;
- main-process memory/Node heap;
- aggregate sizes of known ContextHalo storage buckets;
- session-active boolean;
- lifecycle/provider/capture state names;
- capture readiness booleans;
- suspend/resume/lock/unlock/battery/AC/speed-limit events;
- unresponsive/responsive and crashed renderer/child-process events.

It does **not** record:

- prompts;
- transcripts;
- model answers;
- audio;
- screenshots;
- API keys;
- local file paths;
- captured text;
- history contents;
- provider response bodies.

Disk measurement reads file metadata/size only.

## Resource checkpoints

The recorder automatically snapshots 1h, 4h and 8h checkpoints when the run reaches them.

For each run, review:

- first/last/peak total Electron working set;
- first/last/peak total private memory;
- main-process resident set;
- main-process Node heap;
- known ContextHalo storage growth;
- Electron process count/types;
- unexpected renderer/GPU/utility exits;
- unresponsive events;
- provider/capture/lifecycle state at sample time.

There is intentionally no invented universal memory threshold. A Local AI model load and a cloud-only session have materially different legitimate memory profiles. The evidence report checks duration, sample coverage, finalization, checkpoints, active-session observation, and Electron crash/hang events; a human/device review must interpret sustained resource growth.

## Disk behavior

Saved History remains user data and is not truncated to manufacture a bounded disk result.

The recorder reports aggregate sizes for:

- history;
- diagnostics logs;
- Knowledge;
- Practice;
- models;
- native binaries;
- top-level ContextHalo config files.

Provider working context remains separately bounded in runtime code. Disk History can grow as the user deliberately saves more sessions; Phase 9 treats that as expected persistent data, not a memory leak.

## Network behavior

Existing code keeps continuous audio dispatch bounded:

- renderer audio dispatch queue: maximum 6 chunks;
- stale queued audio older than 900 ms is discarded;
- Gemini capture uses native 16 kHz PCM;
- screenshots are on-demand rather than continuously uploaded;
- full-screen capture is width-bounded and selected-region capture has its own width bound;
- typed/screen provider operations have bounded request deadlines and cancellation;
- Gemini Live uses context compression/resumption rather than unbounded local replay.

The acceptance recorder does not inspect packet payloads or log network content.

## Packaged CI proof

The standard Windows workflow now launches every packaged scale smoke with `--reliability-acceptance`.

For each 100%, 125%, 150% and 200% Chromium scale run, CI requires:

- `metadata.json` exists;
- `summary.json` exists;
- at least one real packaged resource sample was recorded;
- the recorder finalized even though the smoke exits through `app.exit()`;
- evidence app version/release tag matches the packaged artifact.

This verifies the recorder in the exact packaged EXE. It is not counted as a long-session physical run.

## Physical acceptance matrix

The canonical template is:

`docs/PHASE_9_ACCEPTANCE_MATRIX_TEMPLATE.json`

Required areas include:

- Windows 10 and Windows 11 physical launch;
- Gemini 8h with 1h/4h/8h checkpoints;
- Groq 1h;
- Local AI CPU 1h;
- Local AI Vulkan 1h;
- speaker-only, mic-only and mixed capture;
- real network interruption/recovery;
- suspend/resume and lock/unlock;
- microphone/speaker device removal/reconnect;
- multi-monitor active-display retargeting;
- physical 100/125/150/200% DPI region capture;
- content protection in a real sharing/meeting app;
- real/safely reproducible provider throttling/quota behavior;
- interrupted Local AI runtime/model download.

A physical scenario may be marked not-applicable only with a concrete hardware/account reason. It must not be silently counted as passed.

## Phase 9 exit rule

Phase 9 is not complete merely because CI is green.

Repository-side tooling is ready when:

1. recorder/unit/report tests pass;
2. the normal Electron and packaged Windows matrix passes;
3. the packaged recorder produces provenance-matched evidence.

Full Phase 9 acceptance requires the physical matrix to be executed and recorded separately. The final re-audit must distinguish:

- automated pass;
- physical pass;
- not-run;
- not-applicable with reason.

No final "fully validated" claim is allowed while required physical scenarios remain `not-run`.
