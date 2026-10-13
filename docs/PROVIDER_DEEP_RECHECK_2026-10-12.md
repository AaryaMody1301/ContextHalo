# Provider implementation deep recheck - October 12, 2026

The implementation follows the [approved plan](PROVIDER_IMPLEMENTATION_PLAN_2026-10-12.md), but this second pass found additional defects and repaired them. Passing automated checks does not establish that every account, device or failure scenario works. Final release readiness remains false.

## Scope and expected use

Reviewed the Windows desktop application entry and build configuration, preload and IPC capabilities, encrypted credential lifecycle, provider initialization and request ownership, context middleware, streaming/retry/deadline behavior, native installation and startup, capture/provider UI and documentation. The expected load is one desktop user with overlapping screen and conversation work, bounded provider history and no multi-user service deployment. Existing history, knowledge, practice, update, accessibility, audio and security regression tests were rerun together. Vendored dependencies were checked through the existing provenance/readiness checks and current advisories, not manually audited line by line.

The benchmark report remains a dated source for the implementation decision. Its provider measurements do not establish free-account latency or screenshot accuracy for this application. No relative performance ranking was inferred from the small acceptance fixtures below.

## Findings fixed in this pass

| Priority | Reproduced problem | Repair and verification |
| --- | --- | --- |
| P1 | The real native llama.cpp server returned HTTP 200 with `Access-Control-Allow-Origin: https://untrusted.example` for `/v1/models`; Whisper exposed `/health` with wildcard CORS. Their HTTP boundaries allowed unrelated origins. | llama.cpp now requires a random main-process session key and restricts CORS to localhost. The pinned Whisper server has no authentication option, so all its routes use a random 192-bit session prefix. After the change, the same unauthenticated llama.cpp probe returns 401 with no allowed external origin, and the old Whisper route returns 404. Authorized real text, image and audio requests still work. This protects against unrelated web pages; it does not isolate processes running as the same Windows user. |
| P1 | Three overlapping encrypted credential setters erased the earlier provider keys. A reset could also finish before a pending asynchronous key write recreated credentials. | Serialize credential writes in the main process, merge against the latest successful cache, and queue reset after pending writes. Await reset through IPC. Regression covers all three keys, encryption failure followed by a successful save, persisted reload and reset without key resurrection. |
| P2 | Local cancellation emitted progress/state after a 300 ms delay and could reset a newly selected provider to Gemini. Cached checks or an awaited port reservation could advance cancelled setup or start a stale runner. | Close and publish cancellation synchronously, keep provider choice with its session owner, and check the initialization signal after each awaited preparation/port step. Regressions cover replacement-provider routing, stale progress, both port-reservation stages and retention of replacement processes. |
| P2 | Local initialization IPC accepted malformed model/configuration values. Cloud initialization accepted array options and negative UI epochs that later requests could not use. | Reject malformed types, oversized configuration, array options and invalid epochs before native/account work. Actual owning IPC handlers are exercised by the regression fixtures. |

Also added coverage for stalled Mistral attempts, the single retry before output, no retry after a visible partial answer, and safe partial-download cleanup when a progress callback fails. The download cleanup case already passed; it did not require a speculative implementation change.

## Plan comparison and official contracts

| Plan area | Current result | Official sources checked in this pass |
| --- | --- | --- |
| Gemini text/screenshots | Keep the selected `gemini-3.8-flash`, supported `low` thinking, valid final user text, thought-signature handling, independent HTTP/Live failures, bounded retry and visible sanitized errors. No silent fallback or additional retry layer was added. Live account acceptance remains limited by the previously observed quota exhaustion. | [Flash 3.8 contract](https://ai.google.dev/gemini-api/docs/generate-content/latest-model), [retry guidance](https://ai.google.dev/gemini-api/docs/troubleshooting), [key guidance](https://ai.google.dev/gemini-api/docs/api-key) |
| Local AI repair | Keep the selected model, immutable model/projector pair, checksum verification, resumable verified cache and existing CPU/Vulkan pins. Startup arguments, health/inference routes and access controls match the pinned runners. | [llama.cpp b10964 server](https://github.com/ggml-org/llama.cpp/blob/b10964/tools/server/README.md), [Whisper b5130 server](https://github.com/ggml-org/whisper.cpp/blob/b5130/examples/server/README.md), [Whisper route implementation](https://github.com/ggml-org/whisper.cpp/blob/b5130/examples/server/server.cpp) |
| Mistral text/screenshots | Explicit mode and own encrypted key; `mistral-small-2603`, `stream: true`, `reasoning_effort: 'none'`, maximum 2,048 output tokens, documented image URL payload, fragmented SSE handling, context integration, bounded history and at most one eligible retry before output. Audio acquisition and audio IPC remain disabled. No configured Mistral key was available for real inference. | [model release and image inputs](https://mistral.ai/news/mistral-small-4/), [pinned model](https://docs.mistral.ai/models/mistral-small-4-0-26-03), [chat API](https://docs.mistral.ai/api/endpoint/chat), [vision](https://docs.mistral.ai/studio/conversations/vision), [reasoning](https://docs.mistral.ai/studio/conversations/reasoning), [official image schema](https://github.com/mistralai/client-ts/blob/main/src/models/components/imageurlchunk.ts) |
| Groq default and compatibility | Missing preferences select Groq; existing selections and keys remain intact. The configured account's saved Qwen 3.8 text/image model was preserved and answered both real IPC fixtures. This does not claim live validation of every catalog model. | [supported models](https://console.groq.com/docs/models), [deprecations](https://console.groq.com/docs/deprecations), [reasoning fields](https://console.groq.com/docs/reasoning) |
| Windows security/storage | Preserve sandboxing, context isolation, Node isolation, CSP, trusted main-frame IPC, secret-free renderer status and packaged fuses. Async safeStorage calls match the installed Electron version; credential/reset operations now serialize. Repository mode guidance and README include Mistral. | [Electron 44.7.0 safeStorage](https://github.com/electron/electron/blob/v44.7.0/docs/api/safe-storage.md) |

## Verification

| Check | Result |
| --- | --- |
| Source validation | `npm run check`: all 151 JavaScript files passed. |
| Complete regression suite | `npm test`: 453 passed, zero failed, cancelled or skipped; baseline for this recheck was 447. |
| Defect reproduction | Credential-loss, delayed cancellation and malformed-initialization regressions failed before repair. Native cross-origin exposure was reproduced against the real verified runners. |
| Actual source Electron renderer | Windows x64, Electron 44.7.0, sandboxed preload: 86 behavior, 101 keyboard and 10 accessibility checks; zero renderer errors. |
| Real Local AI module | Selected model retained; native text answered four, screenshot identified red/green/blue in order, and public synthesized speech transcribed and answered correctly. Native process IDs were confirmed stopped after close. The normal selector used the Vulkan-capable runner; actual GPU offload was not established. |
| Real Local AI through preload and hardened IPC | Verified CPU runner: successful initialization, typed text, JPEG analysis and PCM audio/VAD/transcription/answer flow, then successful session close. Both native process IDs were confirmed stopped. Typed answer first text/total: 7.34/7.75 s; screenshot: 7.91/8.34 s. These are single fixture observations, not a benchmark. |
| Real Groq through preload and hardened IPC | Saved `qwen/qwen3.8-27b` answered typed text and the public JPEG correctly. First text/total: 0.48/0.50 s for text and 0.31/0.35 s for the image. No user model/provider preference was changed. |
| Final portable runtime | Rebuilt Windows x64 executable passed at Chromium scale factors 100%, 125%, 150% and 200%. Each launch passed 86 behavior, 101 keyboard and 10 accessibility checks, with zero renderer errors and completed reliability sampling. All 22 changed packaged JavaScript files match the workspace; actual executable fuse values match the required security settings. |
| Dependency advisories | Production audit: zero. Full audit: eight moderate dependency findings, zero high/critical; all propagate from the same build-only `sprintf-js` advisory. |
| Repository readiness | `staticReady: true`, `finalReady: false`; 14 physical acceptance scenarios remain not-run in the acceptance manifest, and repository-administration blockers remain open. The manifest's administration state was not refreshed remotely or changed by this pass. |

The build-only [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) affects attacker-controlled format strings and currently lists no patched version. The package is reached through the builder's proxy logger and is absent from production dependencies. npm's suggested downgrade from the current builder to 26.5.0 was not applied. No demonstrated application-controlled path into a vulnerable format string was found; this remains a disclosed build-tool advisory.

Local evidence is under ignored `.cache/`: `deep-audit-final-tests.log`, dependency reports, `deep-audit-readiness.log`, `deep-audit-source/`, `native-boundary-before.log`, `native-boundary-after.log`, `deep-audit-local-runtime.log`, `deep-audit-local-ipc-final.log`, `deep-audit-cloud-ipc.log`, `deep-audit-build.log`, `deep-audit-asar-match.json`, `deep-audit-fuses.json`, `deep-audit-artifact.json`, `deep-audit-portable-matrix.json` and the four `deep-audit-portable-*/` directories. Public text, a synthetic striped JPEG and public synthesized audio were used. Credentials were accessed only through supported encrypted storage; no keys were printed or added to source.

## Remaining acceptance limits

Gemini was not queried again after its quota-exhausted response. The original user incident is not proven to have the same cause, and successful typed/screen IPC inference with that account still needs a quota-available run. Mistral's real account inference remains unverified because its credential-presence check was false. Physical microphone/loopback, actual Windows DPI changes, GPU offload, Windows 10 hardware and a real long-session soak remain separate device acceptance work. Groq audio was not exercised against its live account in this pass.

Z.ai and additional providers, new-provider audio, automatic failover, native runner upgrades and unrelated compositor work remain outside the approved implementation scope. No commit, push, repository-administration change or release was performed.

## Final portable artifact

`dist/ContextHalo-Windows-x64.exe`, version 0.8.0, **110,575,034 bytes**. SHA-256: `b5de651b55c42caf93b251660f83283521831aafcd9eb718eb3c23aa767818e7`, also recorded in `dist/SHA256SUMS.txt`.

This is the final locally validated development artifact, with no published release tag/commit metadata or signing certificate. The four-scale packaged launch matrix validates this executable; earlier executable hashes in historical audits refer to earlier builds. Packaging, mocked regression tests and fixture acceptance do not close the remaining real-account, physical-device or release-governance gates.
