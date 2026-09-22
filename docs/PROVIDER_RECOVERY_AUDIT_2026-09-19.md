# Provider recovery audit - 19 September 2026

Baseline: main `2a9ffe8a2b4bdec5d3ff11715b3abd39aaf271b2` (merged PR #53).

## Report and findings

The reported HTTP 503 belongs to a typed GenerateContent request, not necessarily
its separate Live WebSocket. Google's troubleshooting guidance recommends bounded
exponential backoff with jitter for transient failures. A 503 is not evidence of
an invalid key or failed user connectivity. Client changes cannot guarantee that
an unavailable upstream service will respond.

The original recovery policy exhausted attempts too close together for fast
503 responses. HTTP text/screen now get the initial attempt plus up to four
retries, with approximately 1, 2, 4 and 8 second local delays plus jitter inside
the unchanged total deadline. Provider Retry-After is treated as a minimum, so a
zero/short header cannot disable exponential backoff. Live
retains its separately bounded setup/recovery policy. Model/account/provider
selection never changes on failure. Authentication, permissions, unknown quota,
and exhausted daily quota are not retried as transient overload.

The pinned JavaScript SDK's `ApiError` stores message/status, not response headers.
Previous synthetic tests attaching headers directly to an Error therefore did not
prove production Retry-After behavior. The existing Windows transport now retains
the HTTP status, bounded error body and only Retry-After for Gemini generation
failures, before SDK conversion. It adds no retries. Success responses are unchanged.
The request owner honors Retry-After and JSON RetryInfo, including delays too long
to fit its budget, and preserves request identity and a single history write.

PR #53's Live compatibility fallback also disabled Search for independent text and
screen requests. This now changes only Live's effective Search; HTTP retains the
requested policy. Explicit user "Continue without Search" still disables both.
The HUD/details expose both paths. Availability is not a claim that Google actually
used Search; grounding metadata remains the evidence of a search. Generic 1011
compatibility fallback is a heuristic, not proof that Google rejected a field.
Authentication/permission/quota reasons carried in a 1011 cannot trigger it.

Cancelling setup now closes the opened transport even if the SDK never resolves
its Session promise. Core compatibility reconnect now evaluates history replay
against the configuration actually sent, avoiding an omitted resumption handle
silently suppressing local context restoration. HTTP retries do not reconnect Live
or reset capture/history. Request snapshots do not change during backoff.

Local AI's verified Vulkan archive was selected before the process was launched;
launch failure previously had no CPU fallback. The failed runner is now stopped,
and the same selected model is tried once on the verified CPU runner. Cancellation
never triggers that fallback. Extraction is asynchronous, cancellable and staged.
The UI says Vulkan-capable rather than claiming verified GPU utilization. A current
user question is never truncated by the history cap. The prior 8192-token context
allocation is restored so reduced history does not also halve multimodal capacity.

## Online contracts reviewed

No SDK dependency pins or provider model IDs changed in this repair.

| Boundary | Verified contract | Primary source |
| --- | --- | --- |
| Gemini HTTP | GenerateContent remains supported; v1beta model path, systemInstruction, contents, generationConfig, googleSearch tools | https://ai.google.dev/api/generate-content |
| HTTP recovery | Transient 503/5xx backoff; do not retry invalid parameters/permissions | https://ai.google.dev/gemini-api/docs/troubleshooting |
| Search | HTTP googleSearch and groundingMetadata are independent of a Live session | https://ai.google.dev/gemini-api/docs/generate-content/google-search |
| Gemini models | Stable gemini-3.8-flash and gemini-3.8-live; no guessed downgrade | https://ai.google.dev/gemini-api/docs/models |
| Live model | AUDIO plus transcription; omit unsupported thinking_config | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live |
| Live lifecycle | setup readiness, resumption handles, compression, GoAway | https://ai.google.dev/gemini-api/docs/live-api/session-management |
| Thinking | Model-specific levels; 3.8 Flash does not accept minimal | https://ai.google.dev/gemini-api/docs/generate-content/thinking |
| Installed SDK | v2.22.0 ApiError omits headers; attempts includes initial request | https://github.com/googleapis/js-genai/blob/v2.22.0/src/errors.ts and https://github.com/googleapis/js-genai/blob/v2.22.0/src/_api_client.ts |
| Groq | Models API, GPT-OSS, Qwen 3.6 vision, reasoning parameter contracts | https://console.groq.com/docs/models and https://console.groq.com/docs/reasoning and https://console.groq.com/docs/vision |
| Groq transcription | Multipart audio/transcriptions with whisper-large-v3-turbo | https://console.groq.com/docs/speech-to-text |
| Local generation | OpenAI-compatible /v1/chat/completions; prompt-cache reuse | https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md |
| Native extraction | execFile supports AbortSignal without blocking the main process | https://nodejs.org/api/child_process.html |

## Evidence and limits

Nine focused regression tests were run against the baseline first: all nine failed.
They pass after the repair. Additional tests cover actual typed 503 recovery, request
snapshot stability, reconnect replay, cancellation during backoff, selected model
preservation, Vulkan startup fallback, interrupted extraction and rendered Search
state. SDK/loopback tests exercise real HTTP serialization, 503/503/success and a
120-second Retry-After which must not be shortened. They use no real provider key.

Local source validation and regression results are recorded in the PR. The source
artifact omits hidden .github files and installed dependencies; the Windows workflow
runs the full suite with the locked SDK, release checks and sandboxed renderer.
Controlled results do not establish account quota/access, physical devices, GPU
utilization or disappearance of Google's upstream 503s. Build success is not a
substitute for those live-account checks.
