# Reliability audit and release acceptance

## Changes in this repair

- Typed Gemini requests use a separate, selected HTTP model without discarding live audio.
- Session-scoped request IDs isolate overlapping response cards. Deadlines and epochs cancel queued work and suppress late provider output.
- Groq and local chat history is committed only after a successful answer. Failed requests do not contaminate the next turn.
- A shared SSE reader handles split UTF-8, CRLF, final events without a newline and provider errors.
- Gemini Live turns are saved on turn completion, not early generation completion; alternative output modalities are not concatenated twice.
- Composer controls are native, multiline, keyboard-accessible, IME-aware and preserve failed/newer drafts.
- Screen capture awaits encoding and the actual provider result; no orphan event waiters or duplicate screenshot implementation remain.
- Preload subscriptions strip privileged Electron events, preserve listener ownership, and main handlers validate sender frames.
- Storage writes are atomic, path IDs are validated, extended session fields survive subsequent writes, and write failures are returned to the UI.
- Packaged Windows credential writes fail closed when encryption is unavailable. Transport diagnostics are opt-in and metadata-only.
- Duplicate maximize handling, the typed audio-gating bootstrap, repeated sanitizer patches, unused Gemma helper and particle animation were removed.

## What automated checks prove

Node tests cover pure transformations, real application methods with controlled provider/IPC dependencies, cancellation and persistence. The Windows Electron smoke uses the actual sandboxed preload and actual storage/knowledge/practice/review IPC. Cloud replies in composer checks are simulated. A passing EXE build alone is not evidence of a successful live provider call.

## Required device/account acceptance before declaring full runtime completion

| Area | Acceptance check |
| --- | --- |
| Gemini | Valid account: start Live, ask two typed questions while speaker audio is playing, verify relevant answers and uninterrupted capture. Test quota/auth failures. |
| Groq | Text, speech transcription and vision with account-accessible compatible models; check failed/empty responses and recover. |
| Local AI | Download and verify runners/model/projector; cancel a download; restart and test text, Whisper and a vision-capable model. English-only Whisper models cannot transcribe other languages. |
| Capture | Speaker only, microphone only, mixed input, permission denial, stopped display track, region crop, window source and a second monitor. |
| Session lifecycle | Close while each provider is responding; start again; no old response/transcript appears. |
| UI | Small HUD, normal/compact layout, Windows display scaling, light/dark themes, keyboard-only operation and long code responses. |
| Privacy | Verify capture exclusion with each intended sharing application. Platform APIs cannot guarantee invisibility to every capture method. |

Practice scoring is deterministic keyword coverage, and Session Review uses local extraction heuristics. Neither is an expert evaluation or a substitute for reviewing the source.

## Official API references consulted

- https://ai.google.dev/gemini-api/docs/live-api/capabilities
- https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html
- https://console.groq.com/docs/reasoning
- https://www.electronjs.org/docs/latest/api/ipc-renderer
- https://www.electronjs.org/docs/latest/tutorial/security

Do not commit provider secrets or confidential recordings into tests. Keep unavailable live/hardware checks explicitly unverified in release notes.
