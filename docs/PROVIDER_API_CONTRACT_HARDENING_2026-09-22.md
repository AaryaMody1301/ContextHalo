# Gemini + Groq provider contract audit — 2026-09-22

This document records the provider-contract fixes made after the September 22 deep re-audit. Runtime defaults remain unchanged.

## Official sources

Gemini:
- https://ai.google.dev/gemini-api/terms
- https://ai.google.dev/gemini-api/docs/zdr
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/generate-content/google-search
- https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures
- https://ai.google.dev/gemini-api/docs/live-api/best-practices

Groq:
- https://console.groq.com/docs/models
- https://console.groq.com/docs/deprecations
- https://console.groq.com/docs/api-reference
- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/reasoning
- https://console.groq.com/docs/model/qwen/qwen3.8-27b
- https://console.groq.com/docs/model/minimaxai/minimax-m2.7

## Gemini grounding and Search

Google documents `groundingChunks` in streamed GenerateContent responses as incremental: each streamed response contains chunks that were not included in previous responses. ContextHalo now accumulates those chunks and rebases local `groundingChunkIndices` before exposing citations to the active renderer response.

Google Search grounding metadata is split into two lifetimes:

- active response only: Search Suggestions HTML/CSS, source Links, web search queries, citation/support metadata;
- locally persistable: only the displayed grounded answer text plus a non-provider marker indicating that the answer was grounded.

ContextHalo no longer writes provider Search metadata to History. Legacy session files are migrated on storage initialization/read/write. Displayed grounded answer text is removed after a maximum two-year local History window while retaining the user's own question/prompt and the session shell.

Grounded answer text is excluded from later Gemini HTTP context and Live reconnect replay so persisted Search results are not silently resubmitted as ordinary provider history.

The Search settings UI now discloses Google's documented 30-day storage of prompts, contextual information and generated output when Grounding with Google Search is used.

Search Suggestions are rendered exactly as returned in `searchEntryPoint.renderedContent`. ContextHalo does not parse, sanitize, rewrite, persist, frame, or attach click tracking to that provider fragment. It is inserted into a dedicated nested Shadow DOM so provider CSS cannot restyle the privileged ContextHalo UI. `innerHTML`-created scripts remain inert and the application CSP forbids inline/provider scripts. Search Suggestion clicks are routed directly to their HTTP(S) destination without logging or persistence. Normal web source links remain validated as HTTP(S) before being handed directly to the OS external-link boundary.

## Gemini thought signatures

ContextHalo manually constructs bounded multi-turn GenerateContent history, so the Google SDK cannot preserve thought signatures automatically for that history.

The streaming parser now retains model parts and any `thoughtSignature`, including signatures delivered in a final chunk with empty text. These parts are kept only in an in-memory bounded working-context map and are returned on later typed Gemini turns. They are not written to History or exposed in the UI.

No custom HTTP function-calling path is enabled today, but this keeps normal Gemini 3 reasoning continuity correct and avoids creating a future signature-validation trap.

## Gemini Live audio

Google recommends 20–40 ms audio chunks for lowest Live latency and accepts small chunks up to about 100 ms.

ContextHalo now uses:

- Gemini BYOK: 40 ms capture chunks at the existing 16 kHz PCM input rate;
- Groq: unchanged 100 ms capture chunks;
- Local AI: unchanged 100 ms capture chunks.

The split is intentional. Groq and Local VAD thresholds are frame-count based and were tuned around the 100 ms capture cadence; changing their shared cadence would alter speech/silence behavior.

## Groq lifecycle policy

Groq `GET /openai/v1/models` is retained as the account-access discovery source, but it is not treated as the lifecycle authority. ContextHalo overlays a static documented policy for known models.

Current policy includes:

- `openai/gpt-oss-120b`: Production, supported default chat;
- `openai/gpt-oss-20b`: Production;
- `whisper-large-v3-turbo`: Production, supported default transcription;
- `whisper-large-v3`: Production;
- `qwen/qwen3.8-27b`: Preview, supported vision default with explicit Preview labeling;
- `minimaxai/minimax-m2.7`: Preview Enterprise;
- `qwen/qwen3.6-27b`: deprecated for Free/Developer, account-dependent for eligible Enterprise users;
- `groq/compound` and `groq/compound-mini`: retired and excluded.

Unknown account-discovered models remain available only as advanced/unverified lifecycle entries. They are never promoted to a production recommendation merely because `/models` returns them.

## Groq migration

Groq decommissioned `groq/compound` and `groq/compound-mini` on September 21, 2026. Storage config version 9 migrates those saved chat/image selections to current ContextHalo defaults.

Qwen 3.6 is not globally removed because Groq explicitly documents an Enterprise committed-spend exception. If an eligible account still reports it, the dynamic catalog can surface it with the account-dependent deprecation label.

## Groq retry policy

Groq documents `retry-after` in seconds for 429 rate limits. ContextHalo now treats that value as a minimum delay:

`retryDelay = max(local exponential backoff + jitter, provider Retry-After)`

A zero/short header cannot disable local backoff. A provider delay that does not fit inside the existing bounded request budget is still surfaced rather than shortened.

## Defaults unchanged

- Gemini Live: `gemini-3.8-live`
- Gemini text/screen: `gemini-3.8-flash`
- Groq chat: `openai/gpt-oss-120b`
- Groq vision: `qwen/qwen3.8-27b` (Preview)
- Groq transcription: `whisper-large-v3-turbo`

No silent fallback or automatic provider/model switching was added.
