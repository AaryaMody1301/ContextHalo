# API compatibility and release gates - 2026-09-21

## Product and scope

ContextHalo remains a Windows 10/11 x64 Electron/Lit interview, meeting and desktop-context assistant. Live audio, typed questions and screen analysis must coexist without one operation resetting another. Preserve explicit Gemini/Groq/Local selection, saved settings/history, cancellation, protected capture, and GPL provenance. There is no promise of unlimited service availability or error-free remote inference.

## Verified contracts

| Integration | Contract retained and checked | Official reference |
| --- | --- | --- |
| Gemini Developer Live | `gemini-3.8-live` is the stable/default Live model; AUDIO output with transcription, Search grounding, compression, ordinary session resumption and GoAway. Persisted 3.1 Live preview selections migrate to 3.8 and the normal picker no longer advertises the legacy preview | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live and https://ai.google.dev/gemini-api/docs/live-api/session-management |
| Gemini SDK | 2.22.0 remains pinned; 2.23.0 (2026-09-16) was evaluated and adds unrelated credential/Interactions/environment/custom-fetch features rather than a demonstrated ContextHalo wire fix. Explicitly select Developer API (`vertexai: false`) and keep installed-SDK loopback serialization tests | https://github.com/googleapis/js-genai/releases/tag/v2.23.0 and https://github.com/googleapis/js-genai/blob/v2.22.0/src/live.ts |
| Live context restore | Fresh reconnects seed local history only with `historyConfig.initialHistoryInClientContent: true` and `sendClientContent({turns, turnComplete:true})`; server-resumed sessions never duplicate local history. The 3.8 migration keeps the normal turn lifecycle while omitting unsupported thinking setup | https://ai.google.dev/gemini-api/docs/live-api/thinking and https://ai.google.dev/api/generate-content |
| Gemini text/image | `generateContent` remains fully supported even though Interactions is recommended for new projects. Default HTTP model `gemini-3.8-flash`; low thinking for screenshots and Instant typed mode. No unsupported `minimal` for 3.8 | https://ai.google.dev/gemini-api/docs/interactions-overview and https://ai.google.dev/gemini-api/docs/generate-content/thinking |
| Gemini errors | SDK retries are disabled (`attempts: 1`); ContextHalo owns up to four HTTP attempts inside one 70-second provider budget, with bounded backoff/provider delay. Distinguish 409 ABORTED from ALREADY_EXISTS; cancellation/deadline actively abort work, even a noncooperative SDK | https://ai.google.dev/gemini-api/docs/api-errors |
| Model retirement | Superseded 2026-09-19: migrate persisted 2.5 defaults to stable 3.8 defaults while preserving supported explicit Gemini 3.x Flash selections. Discovery remains advisory and account-dependent. | https://ai.google.dev/gemini-api/docs/models |
| Groq | `/openai/v1/models`, `/chat/completions`, `/audio/transcriptions`; GPT-OSS 120B text, Qwen 3.8 vision default, Whisper Large V3 Turbo. Qwen 3.6 was shut down for Free/Developer on 2026-09-14 but can remain dynamically selectable when an exempt Enterprise account reports it | https://console.groq.com/docs/deprecations, https://console.groq.com/docs/models and https://console.groq.com/docs/vision |
| Groq reasoning | Only documented model families get reasoning parameters. Qwen uses explicit `default` for thinking or `none` for instruct mode with `reasoning_format:hidden`; GPT-OSS keeps `low`/`include_reasoning:false`. Qwen instructions stay in the user message per current guidance while GPT-OSS keeps its documented role hierarchy; Qwen vision is labeled Preview | https://console.groq.com/docs/reasoning |
| Native inference | Vulkan and CPU llama.cpp use official Windows x64 `b10964` archives from source commit `b29c606e28a01b1bc8c1351026a0fa6e616bf6c4`; Whisper uses official `b5130` Windows x64 from commit `927cfce34f31707e17f2bff35c349632fb9e2c3a`, the same commit as stable v1.9.4. Archives are checksum pinned and extracted only after expected server binaries are present. | https://github.com/ggml-org/llama.cpp/releases/tag/b10964 and https://github.com/ggml-org/whisper.cpp/releases/tag/b5130 |
| Hugging Face | Resolve the model repository's full commit SHA first, follow paginated tree links at that exact revision, download model/projector from the same immutable revision, verify LFS/Xet SHA-256, and persist revision/path/checksum provenance. Bundled Whisper model URLs are also commit-pinned. | https://huggingface.co/docs/huggingface_hub/package_reference/hf_api |
| Electron | 44.3.0, sandbox/context isolation, trusted-frame display-media handler, Windows loopback; asynchronous clipboard results supported | https://www.electronjs.org/docs/latest/api/session and https://www.electronjs.org/docs/latest/tutorial/security |
| Browser capture | AudioWorklet with bounded credit/ack messages; 100 ms PCM, Gemini 16 kHz; stale/ended capture and processor errors recover visibly; fresh frame counters rather than assuming delay proves freshness | https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback and https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process |
| Release pipeline | GitHub release actions are pinned by immutable commit to checkout v7.0.1, setup-node v7.0.0, upload-artifact v7.0.1, download-artifact v8.0.1 and action-gh-release v3.0.3 | https://github.com/actions/checkout/releases, https://github.com/actions/setup-node/releases, https://github.com/actions/upload-artifact/releases, https://github.com/actions/download-artifact/releases, https://github.com/softprops/action-gh-release/releases |

Defaults are not a claim that a user's account has access, quota, billing eligibility or native hardware compatibility. Preview models can change. The migration to Google's newer Interactions API is not a prerequisite for a supported Generate Content integration; changing API architecture without preserving history/cancellation would be a regression.

## Product-specific model choices

`gemini-3.8-flash` is the default typed/screen model because it is the current stable Flash release. `gemini-3.8-live` is the default Live model because Google recommends it for most low-latency voice-agent experiences and explicitly describes Gemini 3.1 Flash Live as legacy. Config v8 retains the earlier Gemini migrations and additionally migrates the retired Groq Qwen 3.6 vision default. Supported explicit Gemini 3.x Flash HTTP selections remain preserved.

Groq text uses the production `openai/gpt-oss-120b`, and transcription uses production `whisper-large-v3-turbo`. Groq's current multimodal Qwen 3.8 model remains Preview. Groq shut down `qwen/qwen3.6-27b` for Free/Developer usage on September 14, 2026 and names `qwen/qwen3.8-27b` as the replacement, so ContextHalo now defaults to 3.8. Dynamic discovery can still expose 3.6 when an exempt Enterprise account reports it, and an explicit post-v8 reselection is preserved.

The vendored Lit/Markdown/highlighting UI stack is intentionally not major-upgraded during this reliability pass. The rendered provider/Markdown path remains sanitized and the real Electron smoke covers navigation, labels, focus, scaling, response routing, persistence, knowledge, practice and review. A major UI-library migration would add unrelated release risk without fixing an identified Windows runtime defect.

## Important corrections from the earlier audit

The September re-audit moved new/default Live sessions to stable `gemini-3.8-live`. The setup omits `thinkingConfig`, as required for 3.8. Compression, resumption, Search grounding, transcription and initial-history restore remain enabled. The legacy 3.1 Live preview is now migrated away in storage and removed from the normal model picker rather than presenting a selection that current policy will not persist.

The September 15 re-audit corrected Gemini 3.1 Live history restore. Fresh reconnects now opt into initial-history mode and complete the seed message; successful server resumption never receives a duplicate local replay.

Groq Qwen 3.8 requests follow the provider's reasoning guidance: instructions are folded into the current user turn instead of a system role, thinking is explicitly `default` when enabled and `none` when disabled, and hidden reasoning remains excluded from the visible answer. The helper retains the same family contract for dynamically discovered Enterprise 3.6 compatibility. GPT-OSS retains its separate system-role and low-latency reasoning policy.

The HTTP retry helper owns a 70-second abortable provider deadline. SDK retries remain disabled, while ContextHalo can make up to four bounded HTTP attempts within that one budget; no retry occurs after partial text has already rendered. Typed requests do not carry an independent 27-second per-attempt cap. The screen hierarchy remains 70s provider, 75s session, 77s Windows wrapper, 80s renderer watchdog.

The original six-rotation test was not a sixty-minute soak. It remains a rotation regression; a separate virtual-clock load test now sends 36,000 chunks and checks repeated screen/reconnect behavior. Neither substitutes for the one-hour physical-device/live-provider acceptance run.

Saved keys no longer round-trip through renderer reads. Only new replacement key input enters the Home form; successful saving clears the input. The retired Cloud provider's runtime/IPC routes and stored token are removed without deleting Gemini/Groq keys or history.

Unused legacy UI/preload files and the one-shot hardening workflow are removed before release. The permanent Windows workflow is the only release path and uses immutable action SHAs.

## Validation and unresolved environment gates

The normal Windows workflow must install the lockfile, audit production dependencies, run all tests and source checks, exercise the actual sandboxed Electron renderer (including the real bundled AudioWorklet with synthetic audio), build/checksum the portable EXE and launch it at 100/125/150/200% Chromium scaling. A real installed-SDK test uses a loopback HTTP server; no real API credentials or paid requests are used in CI.

Real Gemini/Groq account success, a physical microphone/loopback device, native downloaded-model inference on representative CPU/GPU hardware, protected sharing applications, and wall-clock one-hour stability require [device/account acceptance](INTERVIEW_RELIABILITY_ACCEPTANCE.md) and [the cross-provider matrix](RELIABILITY_AUDIT.md). Phase 4 resolves the earlier source-ancestry blocker for the downloaded CPU llama and Whisper runtimes; hardware-specific native launch/inference remains a physical acceptance gate.

GitHub branch protection is an administrative setting, not a source-code fix. The connected repository tools do not expose an administration write operation. Require `Build ContextHalo Windows x64 EXE` on main and disallow direct/force pushes through a repository ruleset before treating merge governance as enforced. Do not use an Actions token to bypass that permission boundary.
