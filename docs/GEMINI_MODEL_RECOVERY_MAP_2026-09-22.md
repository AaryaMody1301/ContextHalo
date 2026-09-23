# Gemini model and recovery map — 2026-09-22

The model map remains unchanged. Search quota/setup handling is superseded by [the September 23 runtime repair](FINAL_RUNTIME_REPAIR_2026-09-23.md): explicit route state, one bounded Search-off control, and no unsupported claim that every quota error is a project/model quota.

This audit was triggered by a real ContextHalo Analyze Screen request returning HTTP 503 with `gemini-3.8-flash`.

## Screen-analysis finding

The request shape is valid.

`gemini-3.8-flash` is GA/stable and supports:

- text, image, video, audio and PDF input;
- text output;
- Google Search grounding;
- thinking levels `low`, `medium`, and `high`;
- 1,048,576 input tokens;
- 65,536 output tokens.

Official source:

- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/latest-model

Google classifies HTTP 503 as `service_unavailable`: the backend is temporarily overloaded or unavailable. Google recommends exponential backoff with jitter for retryable 429/408/5xx failures and a bounded maximum number of retries.

Official source:

- https://ai.google.dev/gemini-api/docs/api-errors
- https://ai.google.dev/gemini-api/docs/troubleshooting

ContextHalo does not silently switch models on a 503. A transient outage of 3.8 Flash therefore cannot change the selected model, API key, Search preference, session, or saved draft.

## Recovery correction

Before this audit, ContextHalo owned four total HTTP attempts. It also treated a provider `Retry-After: 0` as a zero-delay retry, which could defeat exponential backoff during an overload burst.

After this audit:

- HTTP text/screen requests use at most five total attempts: the initial request plus up to four retries;
- SDK transport retries remain disabled so there is still one retry owner;
- local backoff is exponential with jitter;
- a provider `Retry-After` value is treated as a minimum delay;
- `Retry-After: 0` cannot disable local backoff;
- a provider delay that does not fit inside the operation budget is surfaced rather than shortened;
- once streaming text has reached the renderer, the request is not retried because that would duplicate visible output.

The normal screen deadline layering remains unchanged:

- provider: 70 seconds;
- session: 75 seconds;
- Windows provider scope: 77 seconds;
- renderer watchdog: 80 seconds.

This keeps retries bounded while giving immediate 503 responses enough spacing to recover.

## Stable Gemini model map

The source-of-truth runtime map is `src/utils/geminiModelPolicy.js`.

| Model | Lifecycle | ContextHalo route | Image input | Search | Thinking | ContextHalo status |
| --- | --- | --- | --- | --- | --- | --- |
| `gemini-3.8-flash` | Stable | Text + Screen | Yes | Yes | low / medium / high | Supported, default |
| `gemini-3.7-flash` | Stable | Text + Screen | Yes | Yes | low / medium / high | Supported |
| `gemini-3.6-flash` | Stable | Text + Screen | Yes | Yes | minimal / low / medium / high | Supported |
| `gemini-3.5-flash` | Stable | Text + Screen | Yes | Yes | minimal / low / medium / high | Supported |
| `gemini-3.5-flash-lite` | Stable | Text + Screen | Yes | Yes | minimal / low / medium / high | Supported |
| `gemini-3.1-flash-lite` | Stable | Text + Screen | Yes | Yes | minimal / low / medium / high | Supported |
| `gemini-3.8-live` | Stable | Live audio | Yes | Yes | fixed interleaved reasoning; no thinkingLevel config | Supported, default |
| `gemini-3.8-live-extended-thinking` | Stable | Live audio | Yes | Yes | low / medium / high | Mapped, not selectable yet |

Official model sources:

- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash
- https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live-extended-thinking
- https://ai.google.dev/gemini-api/docs/thinking

## Why Extended Thinking is not selectable yet

`gemini-3.8-live-extended-thinking` is stable, but it is not a drop-in model-string swap for the current Live path.

Google documents three protocol differences that matter to ContextHalo:

1. `turnComplete: true` ends one spoken utterance but does **not** mean the interaction is idle.
2. Clients must track `interactionStatus` and wait for `IDLE` before treating the interaction as complete.
3. Custom function declarations must be asynchronous `NON_BLOCKING`.

The current ContextHalo Live persistence path still uses `turnComplete` as its turn-completion boundary. Offering Extended Thinking before changing that state machine could split filler/final audio into incorrect saved turns.

Therefore the model is:

- recognized in provider discovery;
- labeled with its current stable capabilities;
- returned in the mapped Live catalog;
- deliberately excluded from the selectable Live catalog.

Official source:

- https://ai.google.dev/gemini-api/docs/live-api/thinking
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live-extended-thinking

A later Extended Thinking implementation must first add `interactionStatus` lifecycle ownership and tests. It should not be enabled by merely adding the model ID to the picker.

## Search behavior

Both `gemini-3.8-flash` and `gemini-3.8-live` support Google Search grounding.

ContextHalo still honors the saved Search preference:

- Search off: no `googleSearch` tool is sent;
- Search on: the tool is available to the model;
- the model decides whether a request actually needs Search;
- a Live-only setup fallback never disables HTTP text/screen Search;
- a 503 never changes the Search preference.

Official source:

- https://ai.google.dev/gemini-api/docs/google-search
- https://ai.google.dev/gemini-api/docs/live-api/tools

## SDK decision

ContextHalo remains on `@google/genai` 2.22.0.

The current 2.23.0 release adds credential APIs, Interactions retrieval steps, environment-file features and custom fetch support. Its published release notes do not identify a GenerateContent 503 recovery fix required by ContextHalo.

Source:

- https://github.com/googleapis/js-genai/releases

The SDK already supports per-request retry options and Live `interactionStatus`; ContextHalo intentionally disables SDK retries on owned HTTP calls so application cancellation, UI status, deduplication and retry timing have one owner.
