# API compatibility implementation - 2026-10-09

The approved fixes and app improvements are implemented locally against `main` at `466d62d9342591e28eee5ee223af5de570c4f220`. This record supersedes the dependency versions and open implementation recommendations in the September audit. Historical acceptance records retain their original results.

## Correctness fixes

| Problem | Result | Regression coverage |
| --- | --- | --- |
| Groq's history budget could discard a long newest question | The newest question survives intact through the 32,000-character IPC limit; older history is evicted first | Actual request serialization at 12,000, 12,001 and 32,000 characters; 32,001 rejected |
| An abruptly ended stream could be saved as a successful answer | Gemini requires terminal `STOP`; Groq and Local require terminal `stop`. Missing completion, truncation, filters and unsupported tool completions fail visibly; partial output is never retried or saved as a completed history turn | Real Google SDK loopback streaming; Groq/Local SSE and history tests |
| Knowledge, Session Pack and response-mode middleware could reintroduce Qwen system messages | Qwen role formatting runs after all instruction middleware; the full instruction goes into the latest user turn once. GPT-OSS retains its system role and Local remains independent | Full production fetch middleware chain, text and screenshots, every response mode, image preservation |
| Interrupted knowledge writes could damage stored documents/indexes | Knowledge reuses the existing temporary-file-and-rename JSON writer and reports failures | Real partial-write, disk-full and rename-failure tests preserve the previous file and remove temporary files |

Atomic replacement protects each JSON file; it does not make a multi-file import one transaction.

## App improvements and simplification

- The send button becomes **Cancel message** while a typed request is pending. Cancellation targets its request ID and current session epoch, preserves the draft, and leaves concurrent voice/screen work running. `/screen` and `/region` use the existing analysis cancellation path.
- Session details show the selected model, time to first text, total time including queue/retries, and provider-reported token metadata when supplied. Counts are not a billing estimate; missing metadata is shown as unavailable.
- Model pickers expose the selected model's Preview/capability labels and cached-catalog status beside the picker. Model selection remains explicit.
- Local AI checks an English-only Whisper model against the selected language before starting or downloading anything.
- Knowledge retrieval loads enabled documents once per query instead of loading them again through a second search call.
- The bypassed Groq audio queue/WAV implementation was removed; the existing runtime hardening path continues to own Groq transcription and the Windows mixer.
- Vulkan downloads reuse the existing verified-download/checksum helpers. Native runtime pins and security checks remain intact.
- Real desktop validation found that the compositor fixture's backdrop could sit beneath other applications. The isolated backdrop now uses the HUD's topmost window band; the original backdrop, alpha and opaque-control pixel assertions remain unchanged. The corrected source-app run passed all ten desktop captures.

## Current integrations and dependencies

Official provider contracts and release records were checked on October 9. A supported contract is distinct from an account having access or every native executable being the newest upstream build.

| Integration | Current implementation | Official reference |
| --- | --- | --- |
| Google GenAI JavaScript SDK | Updated from 2.22.0 to **2.28.0**, exact lock; real HTTP/WebSocket wire and cancellation tests pass | [2.28.0 release](https://github.com/googleapis/js-genai/releases/tag/v2.28.0) |
| Gemini Live | `gemini-3.8-live`; existing audio/transcription, compression, resumption, GoAway and explicit Search recovery contracts retained | [Live model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live), [session management](https://ai.google.dev/gemini-api/docs/live-api/session-management) |
| Gemini text and screenshots | `gemini-3.8-flash`, supported Generate Content streaming, bounded application retries, terminal finish validation and reported usage | [Generate Content API](https://ai.google.dev/api/generate-content), [error guidance](https://ai.google.dev/gemini-api/docs/api-errors) |
| Groq | GPT-OSS 120B text, Whisper Large V3 Turbo transcription, Qwen 3.8 vision Preview; documented family-specific reasoning fields and final request roles | [Models](https://console.groq.com/docs/models), [reasoning](https://console.groq.com/docs/reasoning), [vision](https://console.groq.com/docs/vision), [speech](https://console.groq.com/docs/speech-to-text) |
| Hugging Face | Immutable model revision, paginated tree discovery, same-revision projector and SHA-256 verification retained | [Hub API](https://huggingface.co/docs/hub/api) |
| GitHub release notification | Supported `2022-11-28` API version retained; newer `2026-03-10` version is not required by the release fields used here | [API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions) |
| Electron | Updated from 44.3.0 to **44.7.0**; Windows x64 sandbox, context isolation, DPAPI, capture protections and restrictive IPC/CSP retained | [44.7.0 release](https://github.com/electron/electron/releases/tag/v44.7.0), [security](https://www.electronjs.org/docs/latest/tutorial/security) |
| Markdown and UI | Marked **18.1.0**, exact lock; vendored Lit **3.3.3** retained; sanitizer and actual-renderer tests pass | [Marked releases](https://github.com/markedjs/marked/releases), [Lit releases](https://github.com/lit/lit/releases) |
| Packaging | electron-builder updated from 26.15.3 to **26.17.0**; portable target, production dependency allowlist and ASAR integrity retained | [26.17.0 release](https://github.com/electron-userland/electron-builder/releases/tag/electron-builder%4026.17.0) |
| GitHub Actions | Immutable SHA pins updated to setup-node **7.1.0**, upload-artifact **7.0.2**, download-artifact **8.0.2**; other current pins retained; Dependabot runs weekly | [Setup Node](https://github.com/actions/setup-node/releases), [upload](https://github.com/actions/upload-artifact/releases), [download](https://github.com/actions/download-artifact/releases) |
| Local native inference | CPU/Vulkan llama.cpp **b10964** and Whisper **b5130 / v1.9.4** retained with existing checksums. Newer llama.cpp v0.6.0 and Whisper v1.9.5 / b5454 were observed; replacement remains gated on Windows inference/CLI/checksum validation | [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases), [Whisper releases](https://github.com/ggml-org/whisper.cpp/releases) |

No Interactions API migration, provider substitution, new dependency, or speculative module rewrite was needed for these fixes. The dependency provenance inventory and third-party notices reflect the new lockfile.

## Validation

| Check | Result |
| --- | --- |
| `npm run check` | 148 JavaScript files passed |
| `npm test` | 425 passed; zero failed, skipped or cancelled |
| `npm audit --omit=dev --audit-level=high` | Zero vulnerabilities reported |
| Real Electron 44.7.0 source renderer | Passed with renderer sandbox, isolated temporary profile, real storage/knowledge IPC and synthetic AudioWorklet input; 74 behavior, 101 keyboard and 10 accessibility checks, plus ten desktop compositor captures |
| `npm run build:portable -- --publish never` | Portable Windows build completed; final packaged launch matrix recorded below |
| Packaged application contents and fuses | Final source/QA script matched ASAR; required licenses present; build tools/tests/repository internals excluded; Node injection disabled, cookie encryption and ASAR integrity enabled |
| `npm run audit:readiness` | `staticReady: true`, `finalReady: false`; all static checks pass, fourteen physical scenarios and the two administration gates remain open |

The exact portable EXE passed the following matrix on Windows x64 `10.0.26300`, Electron 44.7.0, application version 0.8.0. Each run passed 74 behavior, 101 keyboard and 10 accessibility checks and finalized its reliability recorder with three samples.

| Chromium scale | Packaged smoke | Completed (UTC) | Evidence directory under `%TEMP%` |
| --- | --- | --- | --- |
| 100% | Passed, including all ten desktop compositor captures | 2026-10-09 11:29:51 | `contexthalo-20261009-final-portable-1` |
| 125% | Passed | 2026-10-09 11:30:23 | `contexthalo-20261009-final-portable-1.25` |
| 150% | Passed | 2026-10-09 11:30:54 | `contexthalo-20261009-final-portable-1.5` |
| 200% | Passed | 2026-10-09 11:31:25 | `contexthalo-20261009-final-portable-2` |

Screenshots at 200% were also inspected for readable Home and minimum-HUD recovery controls. Provider responses in renderer smoke are controlled fixtures; this does not certify real credentials, provider quota, physical microphone/loopback devices, physical Windows DPI or long-duration inference.

Local artifact: [ContextHalo-Windows-x64.exe](../dist/ContextHalo-Windows-x64.exe), **110,568,567 bytes**, Authenticode **NotSigned**. This is a local working-tree build without a published release tag/commit claim. [SHA256SUMS.txt](../dist/SHA256SUMS.txt) contains:

```text
82b1c0878ff43daaa65dced564caca807da03c7092e73042ee1c93bbd6f651bc  ContextHalo-Windows-x64.exe
```

## Remaining release gates

- The full dependency audit reports **eight moderate build-tool findings**, zero high/critical, all following the `sprintf-js` development dependency chain. The [upstream advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) lists no patched version. npm's suggested electron-builder downgrade to 26.5.0 was not applied. These build packages are absent from the application ASAR; monitor upstream rather than force a downgrade or hide the findings.
- Native runtime upgrades require real CPU/Vulkan/Whisper inference and current archive verification before replacing the checksum pins.
- The existing readiness audit distinguishes static correctness from release acceptance. Fourteen physical/device/account scenarios remain unrecorded; short smoke telemetry is not a one-hour soak or physical Windows DPI acceptance.
- Main-branch ruleset enforcement and immutable release settings remain separate repository administration work. The current source changes do not activate them.
- The portable build is unsigned unless an Authenticode certificate is configured. No release was published by this implementation.

Use [the device/account acceptance procedure](INTERVIEW_RELIABILITY_ACCEPTANCE.md), [the Phase 9 matrix](PHASE_9_ACCEPTANCE_MATRIX_TEMPLATE.json), and `npm run audit:readiness` to close these gates with actual evidence.
