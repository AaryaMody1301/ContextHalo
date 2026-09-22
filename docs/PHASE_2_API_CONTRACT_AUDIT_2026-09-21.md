# Phase 2 provider API-contract audit — 2026-09-21

## Scope and baseline

This audit implements Phase 2 against `main` at `8cbc8699a02b404700776cebff299fbed157b99f`, after the Phase 1 repository/provenance PR was merged and the Windows build on main passed.

Phase 2 is intentionally limited to provider/API contracts. It does not perform Electron hardening, replace native binaries, pin Hugging Face model revisions, upgrade vendored renderer libraries, refactor large modules, or change release governance.

The rule for this audit is request-by-request verification. A model name appearing in documentation is not sufficient evidence that ContextHalo is using the provider correctly.

## Gemini Developer API

### Live request contract

| Contract | ContextHalo behavior | Verification | Official source |
| --- | --- | --- | --- |
| Model | Stable `gemini-3.8-live` only in the normal Live picker | `provider-model-registry.test.js`, `live-sdk-wire.test.js` | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live |
| Legacy Live model | Persisted `gemini-3.1-flash-live-preview` is migrated to 3.8 and is no longer offered by the normal picker | storage/provider registry tests | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live |
| Response modality | `AUDIO` | real installed-SDK loopback wire test | https://ai.google.dev/gemini-api/docs/live-api/capabilities |
| Thinking setup | No `thinkingConfig` / `thinkingLevel` for `gemini-3.8-live` | real installed-SDK loopback wire test | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live |
| Input/output transcription | Both enabled with empty configuration objects | real installed-SDK loopback wire test | https://ai.google.dev/gemini-api/docs/live-api/capabilities |
| Search grounding | `tools: [{ googleSearch: {} }]` when the saved Search preference is effective | recovery + SDK wire tests | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live |
| Session resumption | `sessionResumption: {}`; safe server handles are reused only after a resumable update | production wiring + reconnect tests | https://ai.google.dev/gemini-api/docs/live-api/session-management |
| Context compression | trigger 25,000 tokens; sliding-window target 8,000 | real installed-SDK loopback wire test | https://ai.google.dev/gemini-api/docs/live-api/session-management |
| GoAway | schedules bounded replacement connection; fatal failures supersede GoAway | soak/final contract tests | https://ai.google.dev/gemini-api/docs/live-api/session-management |
| Fresh reconnect context | when no valid server handle exists, `historyConfig.initialHistoryInClientContent=true` and local history is seeded with `turnComplete:true` | production wiring/service recovery tests | https://ai.google.dev/gemini-api/docs/live-api/session-management |
| Cancellation | setup guard and session lifecycle abort pending work and close late sockets | recovery/final contract tests | https://ai.google.dev/gemini-api/docs/live-api/session-management |

Google currently documents `gemini-3.8-live` as the stable/default low-latency Live model and explicitly says to omit `thinking_level` / `thinking_config` when migrating from the legacy 3.1 Live preview. The standard ContextHalo picker therefore no longer advertises the legacy preview.

### HTTP typed and screen contract

| Contract | ContextHalo behavior | Verification | Official source |
| --- | --- | --- | --- |
| Endpoint ownership | `@google/genai` `generateContentStream` serializes to `:streamGenerateContent?alt=sse` | installed-SDK loopback test | https://ai.google.dev/api/generate-content |
| Model | default `gemini-3.8-flash`; supported explicit stable Flash selections remain discoverable | registry/storage tests | https://ai.google.dev/gemini-api/docs/models |
| Thinking | `low` for Instant/screen; `medium` for Detailed typed mode; no unsupported `minimal` for 3.8 | SDK wire + thinking tests | https://ai.google.dev/gemini-api/docs/thinking |
| Screen image | JPEG `inlineData` plus text prompt | installed-SDK loopback test | https://ai.google.dev/api/generate-content |
| Search | same effective Search state as the session; `googleSearch` tool included only when enabled | recovery/SDK wire tests | https://ai.google.dev/gemini-api/docs/google-search |
| Typed history | last 6 saved turns, each user/model item capped at 2,500 chars; last 12 transcript items capped at 6,000 chars; latest screen context capped at 4,000 chars | typed history + source contract tests | application policy; provider accepts multi-turn contents |
| Provider budget | 70 seconds for typed/screen provider work; session and Windows wrappers are wider | screen reliability + final contract tests | application timeout ownership |
| Retry owner | SDK retries forced to one attempt; ContextHalo owns the initial HTTP attempt plus up to four retries inside the single provider budget | recovery/service recovery/SDK wire tests | https://ai.google.dev/gemini-api/docs/api-errors |
| Retryable categories | short-term throttling, transient network/server failures, and ABORTED conflict; ambiguous/exhausted quota, auth, permission, unsupported tools and ALREADY_EXISTS/state conflict do not auto-retry | recovery tests | https://ai.google.dev/gemini-api/docs/api-errors |
| Partial stream failure | no retry after visible output has begun, preventing duplicated answer text | source + SSE/recovery tests | application consistency policy |
| Cancellation | one operation signal reaches SDK `abortSignal`; a hanging SDK is bounded by the outer deadline | final contract + SDK wire tests | Google GenAI SDK cancellation support |

The earlier audit text said “two bounded attempts.” That is stale. Current code and tests intentionally allow up to four HTTP attempts inside one 70-second provider budget, with exponential backoff and provider delay handling. Google recommends bounded retry/backoff for transient errors but does not prescribe two attempts.

### Google GenAI SDK 2.22.0 versus 2.23.0

ContextHalo remains pinned to `@google/genai 2.22.0` in this Phase 2 branch.

Upstream `2.23.0` was released on 2026-09-16. Its release notes list credential-resource APIs, Interactions retrieval schema additions, environment file upload/download, and custom `fetch` support in `HttpOptions`. None is required by the current ContextHalo Live or Generate Content paths, and the release notes do not identify a fix for the wire contracts exercised here.

The installed 2.22.0 SDK is exercised directly against loopback HTTP/WebSocket servers in CI. Those tests verify actual serialization rather than a mocked SDK surface. A version bump would change the lockfile and dependency provenance without fixing a demonstrated Phase 2 defect, so it is deliberately deferred until a concrete SDK benefit or compatibility need exists.

Official release record: https://github.com/googleapis/js-genai/releases/tag/v2.23.0

### Interactions API evaluation

Google recommends the Interactions API for new agentic work, but the existing Generate Content API remains supported. Interactions also changes state/privacy semantics because stored interactions are the default unless storage is disabled. ContextHalo already owns local history, request cancellation, response routing, and retry epochs. Phase 2 therefore does not migrate API architecture merely because a newer API exists.

Official overview: https://ai.google.dev/gemini-api/docs/interactions-overview

## Groq API

### Current model policy

Groq's deprecation record says `qwen/qwen3.6-27b` was shut down for Free and Developer usage on 2026-09-14 and names `qwen/qwen3.8-27b` as the replacement. Enterprise customers with a committed-spend contract are exempt.

Phase 2 therefore:

- changes the ContextHalo vision default/recommendation to `qwen/qwen3.8-27b`;
- migrates the old saved 3.6 default once with config v8;
- keeps 3.6 in dynamic discovery only when the user's account still returns it from `/models`;
- preserves an explicitly reselected 3.6 model after the v8 migration so eligible enterprise users are not repeatedly overwritten.

Official deprecation record: https://console.groq.com/docs/deprecations

### Request contracts

| Request | ContextHalo contract | Verification | Official source |
| --- | --- | --- | --- |
| Model discovery | `GET https://api.groq.com/openai/v1/models` with bearer auth | provider model registry tests | https://console.groq.com/docs/api-reference |
| Text | `POST /openai/v1/chat/completions`, `openai/gpt-oss-120b`, streaming SSE | provider wire + transport tests | https://console.groq.com/docs/api-reference |
| Text reasoning | GPT-OSS uses `reasoning_effort: low` and `include_reasoning:false`; no `reasoning_format` | reasoning + provider wire tests | https://console.groq.com/docs/reasoning |
| Vision | `POST /openai/v1/chat/completions`, `qwen/qwen3.8-27b`, user content contains `text` plus `image_url.url = data:image/jpeg;base64,...` | provider wire test | https://console.groq.com/docs/vision |
| Qwen reasoning | `reasoning_format:hidden`; `reasoning_effort:none` when thinking is disabled, otherwise `default`; never mixes `include_reasoning` | reasoning + provider wire tests | https://console.groq.com/docs/reasoning |
| Qwen instructions | ContextHalo folds instructions into the user message rather than sending a system role | request policy + provider wire tests | https://console.groq.com/docs/reasoning |
| Transcription | `POST /openai/v1/audio/transcriptions`; model `whisper-large-v3-turbo`; WAV file; JSON response; ISO-639-1 language when known | source contract + runtime tests | https://console.groq.com/docs/speech-to-text |
| Retry owner | Windows provider transport owns at most two attempts for Groq calls; `Retry-After` is honored without shortening it | Windows transport tests | https://console.groq.com/docs/errors |

### Groq retry correction

Before Phase 2, the shared Groq transport inherited a generic set of retryable HTTP statuses: 408, 409, 425, 429, 500, 502, 503 and 504.

Groq's current error documentation specifically identifies 422 as a case that may be retried, 429 as rate limiting, 498 as temporary Flex capacity exhaustion, and 500/502/503 as server failures that may resolve on retry. Phase 2 changes the automatic Groq retry set to:

`422, 429, 498, 500, 502, 503`

The contract test explicitly proves those statuses get one bounded retry while 400, 401, 403, 404, 409, 413, 425 and 504 do not.

Official error reference: https://console.groq.com/docs/errors

## Local AI

### Exact official Vulkan llama.cpp runtime

The preferred Windows x64 Vulkan runner is an exact upstream release artifact:

- repository: `ggml-org/llama.cpp`
- tag: `b10964`
- archive: `llama-b10964-bin-win-vulkan-x64.zip`
- SHA-256: `1ee3ad952f4ba71f438bd6d7bebef19e1c7af04adcaa35d08b4ddabb27d4c642`

The exact b10964 server documentation supports the flags used by ContextHalo:

- `-m / --model`
- `-c / --ctx-size`
- `--mmproj`
- `--alias`
- `--host`
- `--port`
- `--cache-reuse`

It also documents the OpenAI-compatible `/v1/chat/completions` endpoint, streaming, `chat_template_kwargs`, `enable_thinking`, and prompt caching. Tests now assert the actual ContextHalo startup arguments and HTTP body.

Exact upstream source: https://github.com/ggml-org/llama.cpp/blob/b10964/tools/server/README.md

### Whisper request contract

ContextHalo starts its Windows Whisper fallback with:

`-m <model> --host 127.0.0.1 --port <port>`

and sends multipart requests to `/inference` with a WAV file and `response_format=json`, plus language where applicable. These field names match whisper.cpp's server API documentation.

Current upstream server reference: https://github.com/ggml-org/whisper.cpp/tree/master/examples/server

### Hard provenance boundary for legacy fallback executables

Phase 2 cannot truthfully certify the **exact upstream llama.cpp/whisper.cpp source version** used to build the legacy CPU llama and Whisper executables.

The original v0.7.0 repository snapshot contains the same artifact filenames and SHA-256 values ContextHalo uses, but it does not record a llama.cpp commit, whisper.cpp commit, compiler/build command, or reproducible build recipe for those Windows assets. Release metadata likewise identifies the binary artifacts but not their underlying upstream commits.

Therefore:

- byte identity is established by the pinned SHA-256 values;
- exact upstream source ancestry is **not established**;
- current upstream CLI documentation is not treated as proof of the legacy binary's exact build;
- replacing/rebuilding those fallbacks from explicit upstream revisions remains a Phase 4 supply-chain task.

This is an explicit audit blocker, not a passed check.

## Contract tests added or strengthened in Phase 2

- `tests/provider-api-contracts.test.js` — serialized Groq text/vision requests, transcription/model endpoint source contracts, Local AI endpoint/CLI contracts.
- `tests/live-sdk-wire.test.js` — exact 3.8 Live wire setup, including AUDIO, transcription, compression, resumption and absence of unsupported thinking configuration.
- `tests/groq-request-policy.test.js` — Qwen 3.8 and GPT-OSS mutually exclusive reasoning fields.
- `tests/windows-runtime-final.test.js` — current Qwen vision request classification and provider-documented Groq retry statuses.
- `tests/local-provider-behavior.test.js` — exact local server arguments and local chat body.
- `tests/provider-model-registry.test.js` — stable Gemini Live picker and Qwen 3.8 recommendation.
- `tests/storage.test.js` — config v8 default migration plus enterprise 3.6 reselection preservation.
- Existing installed-SDK, recovery, history, cancellation, SSE, GoAway, resumption and virtual-soak tests remain part of the normal test suite.

## Phase 2 result

Cloud-provider request contracts are now source-referenced and covered by automated checks where practical. The exact official llama.cpp b10964 path is also source-referenced and tested.

One planned exit condition remains intentionally **unproven**: the exact upstream build ancestry of the checksum-pinned legacy CPU llama and Whisper executables. Resolving that requires replacing or reproducibly rebuilding those assets, which is the planned Phase 4 native-dependency scope. Phase 2 records this boundary rather than guessing it.

No real provider credentials or paid requests are used by CI. Live-account success, physical audio devices and wall-clock one-hour behavior remain device/account acceptance gates.
