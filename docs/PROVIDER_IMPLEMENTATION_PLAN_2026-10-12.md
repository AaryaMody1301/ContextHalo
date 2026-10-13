# ContextHalo provider implementation and repair plan

Updated: October 12, 2026. Target: Windows 10/11 x64. Status: application changes implemented; acceptance results and remaining external dependencies are recorded below.

## Decisions and delivery order

1. Repair Gemini typed messages and Analyze Screen, including visible failure explanations.
2. Diagnose and repair Local AI setup/startup and verify its text, screenshot, and existing audio paths.
3. Add Mistral as an explicitly selected provider for text and screenshots only.
4. Make Groq the default for fresh installations while preserving every existing saved provider selection.
5. Complete regression checks and real Windows runtime acceptance before calling the work finished.

These extend the earlier choices: Mistral first, no new-provider audio integration, and Groq for fresh installations. Published benchmarks remain the evidence source for comparing new providers; no live performance ranking has been established.

## Benchmark interpretation

The [benchmark review](FREE_API_PROVIDER_BENCHMARK_REVIEW_2026-10-12.md) supports evaluating Mistral next, but does not establish a replacement that is faster or more reliable than ContextHalo's existing providers.

| Evidence in the review | Implementation implication |
| --- | --- |
| Mistral Small 4, direct Mistral host, non-reasoning: approximately 151 output tokens/s and 0.72 s to first chunk | A useful candidate for interactive text and screenshots. Free-tier scheduling and screenshot latency remain unmeasured. |
| Groq GPT-OSS-120B, high reasoning: approximately 471 output tokens/s and 0.71 s to first chunk | Retain Groq. ContextHalo currently uses low reasoning, so the published high-reasoning duration is not its expected application latency. |
| GLM-4.7-Flash measurements vary substantially between Novita and Bedrock; Z.ai's free endpoint is not measured | Defer Z.ai rather than inferring its free-endpoint speed from another host. Its text and vision candidates are also separate models. |
| SambaNova starts later than Groq in the cited comparison and allows only 20 free requests/day per listed model | Defer it for this interactive application despite its higher measured generation speed. |

First chunk, first visible answer, complete-answer time, screenshot accuracy, and failure rate are separate measures. The published workload uses 10,000 input tokens and does not establish suitability for every free quota. Mistral's free mode is intended for evaluation/prototyping and has account/model limits; it is not an availability guarantee. [Mistral limits](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them)

At investigation time, the review's phrase "keep Groq as the working default" was a recommendation: the missing-preference default was Gemini (`byok`). The implemented migration changes only the fresh-install default to Groq.

## 1. Gemini text and screen repair

### Evidence and unresolved cause

- The user reported both typed messages and Analyze Screen failing. The supplied session footer shows `gemini-3.8-flash`, no first text, 12.92 seconds including queue/retries, Search off, and a retry cooldown. It does not identify an HTTP status or the cause.
- The inspected portable build was release 436, commit `f45a3a6f681d0e8607405b4fb86f2f802cc64229`, matching the workspace's Gemini request code. Its installed `@google/genai` was 2.28.0. A stale executable or SDK is not established as the explanation.
- The detailed request error was collapsed behind "Read request error". The app was closed before that message was captured; the implemented UI now displays the primary error directly.
- Text and screenshots already share bounded HTTP streaming/retry logic. The code already preserves HTTP/SSE failures, uses cancellation, avoids retries after visible output, and has a 70-second HTTP request budget with at most three attempts. Increasing retries or timeouts is not a demonstrated fix.

### Work

1. Show the sanitized primary error by default in Session details: operation, category/status when known, model, and retry availability. Keep extended details collapsible. Reuse the existing request-error state and metadata diagnostics; never expose keys, request bodies, screenshots, or raw provider error bodies.
2. Reproduce with one short text fixture and one sanitized JPEG, the selected model, and Search off. Compare a minimal official API request with the application's HTTP path using the same credential supplied through supported secure configuration. Add context/history only after the minimal request succeeds. This separates account/service failures from request construction, streaming, and context handling.
3. Fix the demonstrated cause once in the shared request/transport/classification path and cover both callers. Use these branches to decide the remedy:

| Observed failure | Remedy |
| --- | --- |
| Authentication or permission failure | Check the AI Studio key's status, API restriction and project access. Report the corrective step; do not keep retrying an invalid credential. |
| `400` / invalid argument | Correct the actual rejected field or turn. Validate text and JPEG payloads against the current model contract. |
| `404` / unavailable model | Report the selected model's availability and offer explicit user selection of another supported model. |
| `429` | Preserve whether the response identifies rate throttling or exhausted quota and honor its retry delay. Do not label every `429` as a temporary rate limit. |
| `503` or another eligible transient failure | Retain bounded backoff with jitter and a single retry owner; preserve the final status and a useful overload/network explanation. |
| Empty, blocked, truncated, or interrupted stream | Preserve the terminal reason, partial-output state, cancellation, and failure through to the renderer. Save history only for a complete successful response. |

Google recommends bounded exponential backoff for transient failures and avoiding retries for permanent client errors. A `503` can be service overload; the footer provided does not prove one occurred. [Troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting), [API errors](https://ai.google.dev/gemini-api/docs/api-errors)

4. Keep `gemini-3.8-flash` unless the user selects another model. It is currently valid; its supported thinking levels are `low`, `medium`, and `high`, and `minimal` is invalid. Preserve the existing low-thinking interactive setting, sufficient answer/thinking allowance, valid final user text, and thought signatures. Do not introduce a new API migration or sampling override without a reproduced need. [Current model contract](https://ai.google.dev/gemini-api/docs/generate-content/latest-model)
5. For an authentication failure, include Google's current key guidance: unrestricted standard keys are rejected, while correctly restricted keys remain supported. This is a diagnostic possibility, not the diagnosed cause of this incident. [API-key guidance](https://ai.google.dev/gemini-api/docs/api-key)
6. Preserve independent Live-session and HTTP-request errors/cooldowns. HTTP retry must not reconnect or block Gemini Live unnecessarily. Provider/model changes remain explicit.

### Reach and acceptance

Review `gemini.js`, `geminiFailure.js`, `geminiGenerationPolicy.js`, `windowsProviderTransport.js`, the session request/IPC callers, and `ContextHaloApp` error rendering. Extend the relevant Gemini screen, streaming, recovery, typed-history, and renderer tests instead of adding another retry framework.

Acceptance requires actual typed text and actual Analyze Screen answers in the Windows application, plus visible and correctly classified failures. Verify cancellation, partial-stream failure, retry cooldowns, session replacement, and history integrity. Passing mocked tests alone does not establish that the user's account works.

## 2. Local AI setup and runtime repair

### Evidence and unresolved cause

The user also reported Local AI not working, without a captured error or failure stage. The selected model is `unsloth/Qwen3.5-2B-GGUF:Q4_K_M`, with `small.en` Whisper and English selected.

Initial inspection found `Qwen3.5-2B-Q4_K_M.gguf` (1,280,835,840 bytes) but no `mmproj` vision projector or provenance manifest in the selected cache. The app requires the projector before starting the session. The completed repair retained the base model, downloaded and verified its matching projector, and recorded the immutable source revision.

The upstream model repository offers projector files, and the pinned llama.cpp server accepts the local projector through `--mmproj`. [Model files](https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/tree/main), [Pinned server contract](https://github.com/ggml-org/llama.cpp/blob/b10964/tools/server/README.md)

### Work

1. Identify the failing stage: native bundle preparation, Whisper model, language model, projector, Whisper launch, or llama launch/health. Carry a sanitized stage and actionable cause through the existing progress/error events. Preserve process launch errors and exit codes; classify only bounded, sanitized native diagnostics.
2. Complete the selected model/projector pair through the existing checksum-verified installer. Verify cached files against one resolved immutable repository revision, download only missing/invalid files, and retain provenance for recovery. Investigate and fix the reason a retry cannot complete if it fails again. Reuse existing atomic download and cancellation behavior; do not add a second installer or clear the whole model cache.
3. Require the complete verified bundle before reporting ready. Preserve progress and cancellation during downloads, model loading and health checks. A cancelled initialization must stop its processes and must not update a replacement session.
4. Verify the active native executable and bundled DLL paths, localhost binding, server health and supported arguments. Keep the existing pinned llama.cpp `b10964` and Whisper `b5130` unless a reproduced incompatibility requires an audited update with new hashes. Installed files alone do not prove the runners launch.
5. Exercise the existing Vulkan-to-CPU fallback with the same selected model. Diagnose CPU failure independently; do not attribute a missing projector or failed download to the GPU. Do not change the user's model automatically.

### Reach and acceptance

Review `native-ai-runtime.js`, `windowsLocalAiRuntime.js`, `localai.js`, the existing verified downloader, initialization IPC, and progress/error views. Extend Local AI/native-runtime tests for a cached language model with a missing projector, interrupted recovery, checksum failure, launch failure, fallback and cancellation.

Acceptance requires successful local text, screenshot and a short audio fixture through the real Windows app with the selected complete model. Verify process cleanup after cancel/close and the existing CPU fallback; record which backend actually ran. Existing valid caches must remain usable.

## 3. Mistral text and screenshot integration

1. Add explicit provider mode `mistral`. Use a small main-process module with existing fetch/SSE conventions; no new SDK or provider framework. Extend initialization and `send-text-message` / `send-image-content` dispatch and preserve request IDs, session ownership, response events and timing/usage fields.
2. Pin `mistral-small-2603` for both text and JPEG screenshots. Send `stream: true`, `reasoning_effort: 'none'`, and `max_tokens: 2048` to Mistral's chat-completions endpoint. Show the fixed model in v1 instead of adding another configurable catalog. [Model](https://docs.mistral.ai/models/mistral-small-4-0-26-03), [Reasoning controls](https://docs.mistral.ai/studio/conversations/reasoning)
3. Add `mistralApiKey` to existing encrypted credential storage, `storage:set-mistral-api-key` to the validated IPC/preload allowlist, and a boolean `mistral` credential-status field. Extend the provider/key views without exposing the secret to the renderer or overwriting other provider credentials.
4. Extend explicit Mistral endpoint recognition in knowledge/RAG, session-pack, response-mode and Windows transport integration. Reuse those existing context paths. Maintain bounded Mistral-owned history, retain only completed current answers, and prevent overlapping requests from overwriting newer history.
5. Use the current Groq text/image time budgets. Permit at most one retry before visible output for eligible network, `408`, `429`, `500`, `502`, `503`, or `504` failures, respecting `Retry-After` and the same deadline. Never retry a partial answer or switch provider/model automatically. Parse fragmented SSE, content blocks, terminal reasons and usage using fixtures from the documented contract; show sanitized failures.
6. Make Mistral startup valid with `audioReady: false`. Skip microphone/system-audio acquisition for this mode; display that it supports text and screenshots and reject audio IPC. Preserve saved audio preferences for providers that support audio. Do not route Mistral audio through another provider.

Extend storage/preload/IPC tests, provider contract tests, streaming fixtures, context/history tests, startup and provider-view tests. Verify text/screenshot dispatch, image validation, timeout, cancellation, stale-session responses, partial failure, retry limits, and credential preservation. Real Mistral account acceptance remains necessary before declaring the integration operational; published figures alone cannot validate the implementation.

## 4. Fresh-install default and compatibility

Change the missing provider preference to `groq`. Preserve saved `byok`, `groq`, `local`, and future `mistral` selections; retain the existing legacy `cloud` to `byok` migration. An existing user with Gemini or Local AI selected must not be silently moved to Groq because a request failed. A fresh installation still needs its explicitly configured Groq credential.

Update defaults, initialization/provider validation, onboarding/customization, credential status, help/README and provider tests together. Preserve Windows sandboxing, CSP, IPC validation, DPAPI-backed storage, GPL licensing and ContextHalo branding.

## Validation and completion

The investigation baseline passed `npm run check` (148 JavaScript files) and `npm test` (431 tests). These results predate implementation and do not validate the reported live failures.

For each behavior change, add or update a focused regression test. Before merge, run `npm run check` and `npm test`, then the real Electron renderer with the sandboxed preload and the portable Windows runtime checks. Packaging alone is insufficient.

Use sanitized fixtures to verify answers, first visible text, completion, failures, retry/cancel behavior and cleanup. Gemini and Local AI remain open until their real application acceptance checks pass. Separate a provider outage or account restriction from a code regression and report any remaining dependency explicitly.

The original planning pass made no application changes. The implementation and acceptance work below followed the user's instruction to implement. No provider/account was switched automatically, and no keys, purchases, publication or release were performed.

## Implementation results

| Area | Delivered behavior and evidence |
| --- | --- |
| Gemini errors | Sanitized request and connection errors are visible without expanding details. Existing HTTP/Live ownership, retry bounds, selected models and Search preferences are preserved. |
| Gemini live account checks | An initial minimal SDK text request and the application's streamed image request succeeded. Later, the same key received HTTP 503 from the minimal request and HTTP 429 with a quota-exhausted classification and approximately 6.5 hours of provider retry delay. Real Live initialization succeeded, while trusted screen IPC correctly surfaced the quota error. These observations do not establish the cause of the user's original incident. No further inference was attempted after the IPC quota result. |
| Local AI download repair | Reproduced a full-file Hub CDN response that supplied headers but no file bytes. A byte-zero range request delivered the file. The existing installer now uses that request for Hub files, stops after 30 seconds without progress, preserves verified caches and pins model/projector recovery to one immutable revision. Invalid cached provenance is resolved again. |
| Local AI setup and diagnostics | Verified the existing selected language model and completed the 671,372,992-byte vision projector with SHA-256 verification. Stage-specific sanitized failures preserve HTTP status and native exit codes. A cancelled older initialization cannot close or overwrite a replacement session. Existing verified Vulkan-to-CPU fallback remains covered. |
| Local AI real Windows acceptance | The real application Local AI module initialized successfully. Text answered `2 plus 2 equals 4`; vision identified red, green and blue stripes in order; a public Windows-synthesized audio fixture passed VAD, Whisper transcription and local answering. Repeated all three checks with the verified CPU runner and confirmed both native process IDs had exited after close. The selected model and Whisper model were retained. |
| Mistral | Added explicit `mistral` mode with its own encrypted key, validated IPC and provider UI, pinned text/vision model, context integration, bounded history, streaming and one retry before output. Detailed mode cannot raise the 2,048-token ceiling; Instant mode can lower it. Mistral starts with audio off and acquires no microphone/system audio. Other providers' catalog failures are excluded from its UI. |
| Defaults and compatibility | Fresh preference files choose Groq. Saved Gemini, Groq, Local AI and Mistral selections survive migration and credential updates; legacy `cloud` retains its Gemini mapping. |
| Regression validation | `npm run check` passed for 151 JavaScript files; the second deep recheck passed all 453 tests with none skipped (447 after initial implementation). Focused tests cover interrupted setup, idle timeout, unsafe provenance, stale initialization, encrypted credential preservation, provider routing, request cancellation, incomplete streams, cooldowns and Mistral's response-mode ceiling. |
| Windows renderer and portable build | The real source Electron renderer with sandboxed preload passed. Packaged Windows x64 launches passed at 100%, 125%, 150% and 200% display scaling: 86 behavior checks per scale, zero renderer errors, and completed reliability sampling. All 22 changed packaged JavaScript files matched the final workspace bytes. After the last settings-caption cleanup, the refreshed portable executable passed the sandboxed launch again with 86 behavior checks and zero renderer errors. |

The second [deep recheck](PROVIDER_DEEP_RECHECK_2026-10-12.md) reproduced and fixed overlapping encrypted saves/reset, delayed Local AI cancellation and stale startup, malformed initialization IPC, and cross-origin access to the local native servers. Credential operations now serialize in the main process. llama.cpp uses a fresh main-process session key and localhost CORS; Whisper routes use a fresh unguessable session prefix. Real Local AI text, screenshot and audio fixtures passed again through the sandboxed preload and hardened IPC on the CPU runner, with process cleanup verified. The configured Groq account's saved Qwen model also passed real text and screenshot IPC checks. The final executable passed all four scale-factor launches, 86 behavior checks per launch and zero renderer errors; all 22 changed packaged JavaScript files match the workspace, and its actual security fuses were verified.

The local development artifact is `dist/ContextHalo-Windows-x64.exe` (version 0.8.0; 110,575,034 bytes). Its SHA-256 is `b5de651b55c42caf93b251660f83283521831aafcd9eb718eb3c23aa767818e7`, also recorded in `dist/SHA256SUMS.txt`. It is unsigned and has no published release tag or commit metadata. No Git commit, push or release was performed.

Local acceptance evidence is stored in ignored `.cache` files, including `local-runtime.log`, `local-cpu-runtime.log`, `gemini-ipc-probe.log`, `final-tests.log`, `windows-qa/`, `portable-*/` and `portable-final/`. Public test text/images/audio were used; credentials were read only through supported encrypted storage and were never printed.

Remaining acceptance limits: Gemini's current account quota prevents another successful typed/screen IPC inference check; an early typed IPC probe had incomplete request metadata and is not counted as a product failure or a successful acceptance result. No Mistral key was available, so its live account inference remains unverified. Audio fixtures validate the native pipeline, while physical microphone/loopback devices and GPU offload still need device acceptance. Deferred scope remains Z.ai and other providers, new-provider audio, automatic failover and unrelated window/compositor changes.
