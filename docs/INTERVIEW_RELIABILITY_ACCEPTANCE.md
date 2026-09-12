# Interview reliability acceptance

This is the final device/account acceptance gate for the long-interview reliability work. Automated tests exercise the same state transitions with controlled provider and capture fixtures, but they cannot establish physical Windows device behavior or a real Gemini project's service/quota behavior.

## Automated gate

Before device testing, the candidate commit must pass the standard Windows workflow, including source validation, the full Node regression suite, the sandboxed Electron behavior/layout smoke, portable EXE build/checksum verification, and packaged launches at Chromium scale factors 1, 1.25, 1.5, and 2.

The regression suite must cover all of these behaviors:

- Gemini Live context compression, ordinary session resumption, safe resumable-handle reuse, GoAway rotation, 409 ABORTED recovery, bounded reconnect backoff, and no duplicate history replay after server resumption.
- A virtual clock advances through 60 minutes, 36,000 audio chunks, six controlled Live rotations and 12 screen requests. This validates application state transitions, not wall-clock memory stability or real service/device availability.
- Analyze Screen while a Live reconnect is still pending.
- Screen 503/504 retry without terminating the Live interview.
- Fresh-frame waiting, blank-frame retry/rejection, selected-region validation, and higher-fidelity screenshot dimensions.
- Automatic screen/audio capture reacquisition after an ended track and active-display invalidation after the app moves to another monitor.
- AudioWorklet capture, bounded renderer/main-process audio queues, Gemini-native 16 kHz PCM, and `audioStreamEnd` when capture pauses/ends.

## Physical Windows + live Gemini gate

Use the portable EXE produced from the candidate commit on a Windows 10 22H2 or Windows 11 x64 workstation with a real Gemini API key. Do not use a production interview as the first validation session.

1. Start a Gemini interview session using the normal speaker/microphone configuration and keep it active for at least 60 minutes. Confirm the session remains usable through provider connection rotation; a temporary Reconnecting state is acceptable, but the session must return to ready without restarting the app.
2. During the hour, run Analyze Screen at least once before 10 minutes, once around each observed Live reconnect/GoAway rotation, and once after 45 minutes. The screen request must not terminate or restart Live audio.
3. Temporarily interrupt network access, restore it, and confirm the Live connection automatically recovers with the existing session context. Verify that one interruption does not produce duplicate answers/history.
4. Stop and restore the selected microphone/audio device while the session is active. Confirm capture enters a visible recovering state, reacquires within the bounded recovery attempts when the device/source is available, and continues the session.
5. With capture source set to Active display, move ContextHalo to another monitor. Confirm capture retargets to the new active display and Analyze Screen reads that display rather than a stale source.
6. Analyze a dense code/SQL/terminal screen and a selected sub-region. Confirm small text is legible enough for a correct answer. If a frame is blank/stalled, ContextHalo must retry/reject it rather than submit a blank image as valid analysis.
7. Repeat at Windows display scaling 100%, 125%, 150%, and 200% where hardware permits. Confirm the HUD remains usable and screen region coordinates still match the selected content.
8. Review Google AI Studio usage/errors after the session. Transient 409/503/504 responses may still occur upstream, but none should permanently stop the interview. Record the app commit, Windows version, scale, audio mode, provider model IDs, and any provider status codes; do not record API keys or interview content.

## Pass criteria

Pass only when the packaged candidate completes the full hour without an unrecovered Live stop, Analyze Screen stays available through reconnects, capture can recover from an ended track/source, and no application crash or stuck audio backlog occurs. Any unresolved provider response should remain an operation-level error with retry/recovery instead of silently changing the user's provider/model configuration.
