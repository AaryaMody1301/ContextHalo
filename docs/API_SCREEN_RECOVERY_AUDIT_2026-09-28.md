# Screen analysis and provider API audit — 28 September 2026

Base inspected: `11e8034e72fd2a71e8cc7af45246d1f7e3c0e235` (main, PR #72).

## What the supplied screenshot establishes

The Google AI Studio dashboard shows `503 ServiceUnavailable`, with Flash 3.8 and Live 3.8 usage. Its model filter is **All Models** and request filter is **All API Keys**. It does not associate an individual error with a screen request, identify its payload, or prove a model-specific outage. Request-level logs would be needed to attribute every failure.

Google identifies 503 as temporary overload or unavailability and recommends bounded exponential backoff with jitter. This is distinct from authentication, malformed configuration, and exhausted quota. Application changes cannot guarantee availability during a provider outage. [Troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting), [error reference](https://ai.google.dev/gemini-api/docs/api-errors).

The existing model ID, JPEG input, low thinking, Search tool, and retry count were already compatible. `gemini-3.8-flash` supports images and `low`, `medium`, and `high` thinking; it does not support `minimal` or Live sessions. Audio continues to use the separate `gemini-3.8-live` model. [Flash model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [Live model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live).

## Reproduced defects and repairs

| Defect | Before | Repair and regression evidence |
| --- | --- | --- |
| Error inside an already-open Gemini stream | Installed SDK 2.22.0 discarded `error` inside a `data:` SSE event. A 503 before text became “no text”; a 503 after text could be saved as success. | Inspect SSE errors before SDK conversion. Retry eligible failures before visible output; never replay after visible output. Real SDK + loopback HTTP tests reproduce both cases. |
| Broken HTTP error body | A read error discarded authoritative HTTP status and Retry-After. | Preserve status and provider delay even if the body fails; cancellation still wins. |
| Failed attempt lifetime | Attempts shared one signal, so a failed SDK stream could survive into the next attempt. | Abort each completed/failed attempt before backoff; keep one overall deadline. |
| False completion | Gemini `MAX_TOKENS`, blocked responses and failed tool outcomes were ignored. | Distinct sanitized failure categories; unsuccessful output stays out of saved history. |
| Thinking budget | 768/2,048/4,096 visible-answer targets were also the complete Gemini generation budget. | Add a bounded thinking allowance and use response-mode instructions for answer length. |
| Misleading recovery message | Every 503 claimed retries had happened, even when a long Retry-After prevented them. | Report actual attempt count. |
| Other providers' completion status | Groq and Local AI accepted nonempty output even with `length`, content filtering or an unfinished tool call. | Validate declared finish reasons before saving successful answers. |
| Qwen 3.8 thinking selection | Enabling thinking sent `default`, which Groq's reasoning guide/API reference describe as non-reasoning for 3.8. | Send explicit `low` when enabled, `none` when disabled. Preserve the enterprise 3.6 contract. |
| Baseline test portability | A history test required 1970 for a timestamp that displays as 1969 west of UTC. | Assert the actual local formatted date without changing application behavior. |

These are reproduced code defects, not proof that each caused a particular request in the screenshot. No real API credentials or private screenshots are included in tests or this repository.

## Gemini request and response map

| Operation | Endpoint / SDK | Contract used by ContextHalo | Owning code / tests |
| --- | --- | --- | --- |
| Screen and typed answer | `models.generateContentStream` → `POST /v1beta/models/{model}:streamGenerateContent?alt=sse` | Selected stable Flash model; SDK serializes user contents, system instruction, generation config and optional tools. | `gemini.js`; `sdk-wire-contract.test.js`, `gemini-screen-wire-repair.test.js` |
| Screenshot | Same HTTP route | JPEG base64 `inlineData` and text prompt. Capture is on demand; existing request-size cap retained. | `sendImageToGeminiHttp`; screen contract/wire tests |
| Thinking | `generationConfig.thinkingConfig.thinkingLevel` | Screen always `low`; typed Instant/Balanced `low`, Detailed `medium`; only mapped models receive these fields. | `geminiModelPolicy.js`, `geminiGenerationPolicy.js` |
| Search | `tools: [{ googleSearch: {} }]` | Effective HTTP Search preference is preserved across retries. Grounding and thought signatures survive stream inspection. | `geminiGrounding.js`, `geminiWorkingContext.js`, `gemini-stream-guard.test.js` |
| Generation outcome | `promptFeedback.blockReason`, `candidates[0].finishReason` | Blocked, token-limited and failed outcomes are errors, even if some text arrived. Provider messages are not copied to diagnostics. | `geminiGenerationPolicy.js`, `geminiFailure.js` |
| Retry | Application-owned | Initial attempt plus up to four retries inside 70 seconds. SDK uses `attempts: 1`. Exponential waits have jitter; provider delay is a minimum. | `runGeminiRequest`; service recovery tests |
| Cancellation | SDK `abortSignal`, session epoch, request deadline | Attempt cleanup; cancellation during backoff; no stale answer/history after session end. | session-request, recovery and final-contract tests |
| Model discovery | `GET /v1beta/models`, page tokens, `x-goog-api-key` | Account availability plus the static documented capability map. | `providerModelRegistry.js`; registry tests |
| Live audio | `ai.live.connect`, v1beta, `gemini-3.8-live` | AUDIO response, 16 kHz mono PCM input, input/output transcription, optional Search; no Flash thinking configuration. | Live SDK wire and audio reliability tests |
| Live continuity | Live session resumption, compression and GoAway | Bounded reconnects, local context replay when necessary, late-event rejection. Independent from HTTP screen recovery. | Live runtime, supervisor, production-wiring and soak tests |

Official references: [Generate Content](https://ai.google.dev/api/generate-content), [images](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding), [thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking), [Search](https://ai.google.dev/gemini-api/docs/generate-content/google-search), [model discovery](https://ai.google.dev/api/models), [Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities), [Live session management](https://ai.google.dev/gemini-api/docs/live-api/session-management).

### Gemini generation ceilings

Google documents that the generation ceiling includes thinking and answer tokens. The allowance below is an application policy, not a guaranteed amount of reasoning or a provider recommendation. More complex requests can still reach it. The higher ceiling can increase token consumption; the response-mode prompt still asks for concise answers and the 70-second request budget remains in force.

| Mode | Previous shared ceiling | Screen ceiling / thinking | Typed ceiling / thinking |
| --- | ---: | --- | --- |
| Instant | 768 | 4,864 / low | 4,864 / low |
| Balanced | 2,048 | 6,144 / low | 6,144 / low |
| Detailed | 4,096 | 8,192 / low | 12,288 / medium |

The policy is capped at the mapped model's output limit. Unknown models keep the prior budget and do not acquire guessed thinking fields.

## Groq and Local AI map

| Operation | Endpoint / model | Request mapping and status |
| --- | --- | --- |
| Groq text | `POST https://api.groq.com/openai/v1/chat/completions`; `openai/gpt-oss-120b` default | Bearer authentication, messages, streamed output, `max_completion_tokens`, `reasoning_effort: low`, `include_reasoning: false`. |
| Groq screenshots | Same endpoint; `qwen/qwen3.8-27b` default | User text plus JPEG data URI in `image_url`; `reasoning_format: hidden`; explicit `none`/`low`. |
| Groq transcription | `POST /openai/v1/audio/transcriptions`; `whisper-large-v3-turbo` | Multipart WAV, model, JSON response format and ISO language code. |
| Groq discovery | `GET /openai/v1/models` | Bearer authentication; documented lifecycle policy over account discovery. Retired Compound excluded; Qwen 3.6 enterprise exception retained. |
| Groq retries | Existing Windows transport | Two bounded attempts for documented transient statuses; Retry-After is not shortened. |
| Local text/vision | Loopback `POST /v1/chat/completions`; llama.cpp `b10964` | Selected GGUF model via `local` alias, optional multimodal projector, streaming, prompt cache, `enable_thinking: false`; declared failed completion cannot enter history. |
| Local transcription | Loopback `POST /inference`; whisper.cpp `b5130` (`v1.9.4`) | Multipart WAV, JSON output, language; binaries/models remain pinned and checksum-verified. |

Sources: [Groq API](https://console.groq.com/docs/api-reference), [vision](https://console.groq.com/docs/vision), [reasoning](https://console.groq.com/docs/reasoning), [speech](https://console.groq.com/docs/speech-to-text), [errors](https://console.groq.com/docs/errors), [models](https://console.groq.com/docs/models), [deprecations](https://console.groq.com/docs/deprecations), [pinned llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/b10964/tools/server/README.md), [pinned whisper.cpp server](https://github.com/ggml-org/whisper.cpp/blob/b5130/examples/server/README.md).

Groq documentation discrepancy: the Qwen model page's best-practice paragraph calls `default` a thinking mode, while its reasoning guide and API reference state that 3.8's default does not reason. Explicit `low` is documented by all three and avoids relying on that inconsistent default.

## Validation and remaining limits

The new reproductions failed before the repairs. Verification includes the installed Google SDK against a local HTTP server, split SSE errors, 503 before/after text, 401, provider retry delays, broken error bodies, cancellation, Unicode, grounding/signature preservation, generation outcomes, and provider isolation. All normal repository tests and source checks must pass before merge; the existing Windows CI runs the sandboxed Electron smoke and portable build.

No paid cloud calls, physical Windows screen/audio capture, native inference, or provider-account quota checks were performed locally. Tests establish request serialization and failure handling; they do not establish Google's current capacity or prove every possible repository defect has been eliminated. The aggregate screenshot cannot settle those questions. This audit supersedes older retry-count and Qwen-default descriptions only for the behavior explicitly covered above.
