# API compatibility and release gates - 2026-09-15

## Product and scope

ContextHalo remains a Windows 10/11 x64 Electron/Lit interview, meeting and desktop-context assistant. Live audio, typed questions and screen analysis must coexist without one operation resetting another. Preserve explicit Gemini/Groq/Local selection, saved settings/history, cancellation, protected capture, and GPL provenance. There is no promise of unlimited service availability or error-free remote inference.

## Verified contracts

| Integration | Contract retained and checked | Official reference |
| --- | --- | --- |
| Gemini Developer Live | `gemini-3.1-flash-live-preview`, AUDIO output with transcription, compression, ordinary session resumption, GoAway; no Enterprise-only transparent replay | https://ai.google.dev/gemini-api/docs/live-api/session-management |
| Gemini SDK | 2.22.0; explicitly select Developer API (`vertexai: false`), do not inherit an Enterprise environment flag; buffer setup messages emitted before connect resolves | https://github.com/googleapis/js-genai/blob/v2.22.0/src/live.ts |
| Live context restore | Gemini 3.1 seeds local history only on a fresh reconnect with `historyConfig.initialHistoryInClientContent: true` and `sendClientContent({turns, turnComplete:true})`; server-resumed sessions never duplicate local history | https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview |
| Gemini text/image | `generateContent` remains fully supported even though Interactions is recommended for new projects. Default HTTP model `gemini-3.8-flash`; low thinking for screenshots and Instant typed mode. No unsupported `minimal` for 3.8 | https://ai.google.dev/gemini-api/docs/interactions-overview and https://ai.google.dev/gemini-api/docs/generate-content/thinking |
| Gemini errors | Two bounded attempts, one retry owner; distinguish 409 ABORTED from ALREADY_EXISTS; cancellation/deadline actively abort work, even a noncooperative SDK | https://ai.google.dev/gemini-api/docs/api-errors |
| Model retirement | Preserve selected 2.5 Flash/3.7 Flash rather than invent a shutdown; migrate known retired 2.0 defaults. Discovery is advisory and account-dependent | https://ai.google.dev/gemini-api/docs/deprecations |
| Groq | `/openai/v1/models`, `/chat/completions`, `/audio/transcriptions`; GPT-OSS 120B text, Qwen 3.6 vision default and 3.8 discovery, Whisper Large V3 Turbo | https://console.groq.com/docs/models and https://console.groq.com/docs/vision |
| Groq reasoning | Only documented model families get reasoning parameters. Qwen `none`/`hidden` and GPT-OSS `low`/`include_reasoning:false` remain separate; Qwen vision is labeled Preview | https://console.groq.com/docs/reasoning |
| Native inference | llama.cpp OpenAI-compatible chat, whisper.cpp `/inference`, verified GGUF/model/projector downloads. English-only Whisper models reject non-English selection clearly | https://github.com/ggml-org/llama.cpp/tree/master/tools/server and https://github.com/ggml-org/whisper.cpp/tree/master/examples/server |
| Hugging Face | Follow paginated Hub tree Link headers; BF16/F16/F32 projector selection; SHA-256/ETag verification, cancellable atomic download. Cancellation preserves verified cache | https://huggingface.co/docs/hub/api |
| Electron | 44.3.0, sandbox/context isolation, trusted-frame display-media handler, Windows loopback; asynchronous clipboard results supported | https://www.electronjs.org/docs/latest/api/session and https://www.electronjs.org/docs/latest/tutorial/security |
| Browser capture | AudioWorklet with bounded credit/ack messages; 100 ms PCM, Gemini 16 kHz; stale/ended capture and processor errors recover visibly; fresh frame counters rather than assuming delay proves freshness | https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback and https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process |
| Release pipeline | GitHub release actions are pinned by immutable commit to checkout v7.0.1, setup-node v7.0.0, upload-artifact v7.0.1, download-artifact v8.0.1 and action-gh-release v3.0.3 | https://github.com/actions/checkout/releases, https://github.com/actions/setup-node/releases, https://github.com/actions/upload-artifact/releases, https://github.com/actions/download-artifact/releases, https://github.com/softprops/action-gh-release/releases |

Defaults are not a claim that a user's account has access, quota, billing eligibility or native hardware compatibility. Preview models can change. The migration to Google's newer Interactions API is not a prerequisite for a supported Generate Content integration; changing API architecture without preserving history/cancellation would be a regression.

## Product-specific model choices

`gemini-3.8-flash` remains the default typed/screen model because it is a current stable Flash release with no announced shutdown. `gemini-3.1-flash-live-preview` remains the Live model because it is the current documented Gemini Live model for low-latency bidirectional audio and has no announced shutdown date.

Groq text uses the production `openai/gpt-oss-120b`, and transcription uses production `whisper-large-v3-turbo`. Groq currently has no production multimodal model in the same low-latency fit: both Qwen 3.6 and 3.8 vision models are Preview. ContextHalo keeps Qwen 3.6 as the default screen model because it is faster and cheaper for frequent screen assistance, while dynamic discovery exposes Qwen 3.8 for users who prefer its newer reasoning/coding quality. The UI and catalog explicitly mark both as Preview.

The vendored Lit/Markdown/highlighting UI stack is intentionally not major-upgraded during this reliability pass. The rendered provider/Markdown path remains sanitized and the real Electron smoke covers navigation, labels, focus, scaling, response routing, persistence, knowledge, practice and review. A major UI-library migration would add unrelated release risk without fixing an identified Windows runtime defect.

## Important corrections from the earlier audit

The September 15 re-audit corrected Gemini 3.1 Live history restore. Fresh reconnects now opt into initial-history mode and complete the seed message; successful server resumption never receives a duplicate local replay.

The HTTP retry helper previously calculated a 70-second budget but did not enforce it around a hanging SDK. It now owns an abortable deadline. Typed requests no longer carry an independent 27-second per-attempt cap. The screen hierarchy remains 70s provider, 75s session, 77s Windows wrapper, 80s renderer watchdog.

The original six-rotation test was not a sixty-minute soak. It remains a rotation regression; a separate virtual-clock load test now sends 36,000 chunks and checks repeated screen/reconnect behavior. Neither substitutes for the one-hour physical-device/live-provider acceptance run.

Saved keys no longer round-trip through renderer reads. Only new replacement key input enters the Home form; successful saving clears the input. The retired Cloud provider's runtime/IPC routes and stored token are removed without deleting Gemini/Groq keys or history.

Unused legacy UI/preload files and the one-shot hardening workflow are removed before release. The permanent Windows workflow is the only release path and uses immutable action SHAs.

## Validation and unresolved environment gates

The normal Windows workflow must install the lockfile, audit production dependencies, run all tests and source checks, exercise the actual sandboxed Electron renderer (including the real bundled AudioWorklet with synthetic audio), build/checksum the portable EXE and launch it at 100/125/150/200% Chromium scaling. A real installed-SDK test uses a loopback HTTP server; no real API credentials or paid requests are used in CI.

Real Gemini/Groq account success, a physical microphone/loopback device, native downloaded-model inference, protected sharing applications, and wall-clock one-hour stability require [device/account acceptance](INTERVIEW_RELIABILITY_ACCEPTANCE.md) and [the cross-provider matrix](RELIABILITY_AUDIT.md). Do not mark these passed without evidence.

GitHub branch protection is an administrative setting, not a source-code fix. The connected repository tools do not expose an administration write operation. Require `Build ContextHalo Windows x64 EXE` on main and disallow direct/force pushes through a repository ruleset before treating merge governance as enforced. Do not use an Actions token to bypass that permission boundary.
