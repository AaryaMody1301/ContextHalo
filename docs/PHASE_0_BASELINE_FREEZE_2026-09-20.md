# Phase 0 baseline freeze — 2026-09-20

Phase 0 freezes the current ContextHalo release baseline before any further cleanup, API migration, dependency update, security hardening, native-runtime replacement, structural refactor, or updater work.

**Scope of this phase:** documentation/evidence only. No runtime source, dependency, workflow, test, model, release, repository setting, or user-data behavior is intentionally changed by this phase.

## 1. Immutable source baseline

| Item | Frozen value |
| --- | --- |
| Repository | `AaryaMody1301/ContextHalo` |
| Supported application target | Windows 10/11 x64 |
| Baseline branch | `main` |
| Baseline commit | `37c96f6bb17702a04ecfcb8d39e5687de8c6beff` |
| Baseline commit | Merge PR #56: `fix: restore green CI and harden long Gemini sessions` |
| Application/package version | `0.8.0` |
| Config schema | `CONFIG_VERSION = 7` |
| License | GPL-3.0 |
| Open PRs when frozen | 0 |

All later phases must compare behavior against this commit unless a newer baseline is deliberately declared.

## 2. Successful Windows release evidence

The baseline release is the successful post-merge Windows workflow run:

- Workflow: **Build ContextHalo Windows Portable EXE**
- Run: **#336**
- Run ID: `35443546243`
- Head: `37c96f6bb17702a04ecfcb8d39e5687de8c6beff`
- Result: **success**
- Release: **`v0.8.0-portable.336`**
- Release target: baseline commit above
- Published: 2026-09-19
- Release state at freeze: not draft, not prerelease, **not immutable**
- Portable EXE: `ContextHalo-Windows-x64.exe`
- EXE size: **101,217,149 bytes**
- EXE SHA-256: **`08ccf10b3cd45a11f2cb535e038ec32bcbd8d2ffe562ae6b2202dfe42523eac3`**

GitHub Actions evidence for run #336:

| Gate | Baseline result |
| --- | --- |
| Lockfile dry-run verification | Passed |
| Locked dependency install | Passed |
| Production dependency audit, high threshold | Passed |
| Source validation | **57 JavaScript files passed** |
| Node regression tests | **260 passed, 0 failed** |
| Real sandboxed Electron behavior/layout smoke | Passed |
| Portable Windows x64 build | Passed |
| EXE checksum generation | Passed |
| Packaged launch, Chromium scale 1.0 / 100% | Passed |
| Packaged launch, Chromium scale 1.25 / 125% | Passed |
| Packaged launch, Chromium scale 1.5 / 150% | Passed |
| Packaged launch, Chromium scale 2.0 / 200% | Passed |
| GitHub release publication | Passed |
| Repository maintenance after successful build | Passed |

The four packaged smokes reported `packaged: true`, `platform: win32`, `arch: x64`, Electron `44.3.0`, and the baseline commit.

### CI evidence boundary

The current GitHub runner is `windows-2022` and reported Windows `10.0.20348`. This is automated Windows packaging/runtime evidence; it is **not** evidence of a physical Windows 10 or Windows 11 end-user machine, a real microphone/loopback device, GPU driver compatibility, or a live provider account.

## 3. Locked application/toolchain baseline

| Component | Baseline |
| --- | --- |
| Node engine policy | `>=22.16.0` |
| CI Node line | Node 24 |
| Node 24 status at freeze | LTS |
| Electron package | `44.3.0` locked |
| Electron embedded Node | `24.20.0` |
| Electron embedded Chromium | `152.0.7977.78` |
| `@google/genai` | `2.22.0` locked |
| electron-builder | `26.15.3` locked |
| npm lockfile | lockfileVersion 3 |
| Packaging target | portable Windows x64 |
| ASAR | enabled |
| Electron fuses | runAsNode off; cookie encryption on; NODE_OPTIONS off; CLI inspect args off; embedded ASAR integrity on; only load app from ASAR |

At freeze time Node 24 remains an LTS line. Electron 44.3.0 is a September 2026 release. This is a baseline statement, not a decision to prevent later point-version updates.

Official references checked on 2026-09-20:

- Electron 44.3.0: https://releases.electronjs.org/release/v44.3.0
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- Node release status: https://nodejs.org/en/about/previous-releases

## 4. Provider/model baseline

### Gemini

| Purpose | Baseline |
| --- | --- |
| Live default | `gemini-3.8-live` |
| Text/screen default | `gemini-3.8-flash` |
| API package | `@google/genai 2.22.0` |
| Text/screen response behavior | streaming GenerateContent path |
| Live output | audio with transcription |
| Long-session reliability | context compression + session resumption + GoAway handling |
| Compression target | trigger 25,000 tokens; sliding target 8,000 |
| Search default | off |
| Search policy | explicit user preference; Live fallback must not silently rewrite saved preference |
| Typed/screen thinking policy | low for interactive/balanced behavior; detailed may use medium |
| 3.8 Live thinking setup | no `thinkingConfig` / `thinking_level` in Live setup |

Google currently identifies `gemini-3.8-live` as the stable/default model for most low-latency Live voice experiences and `gemini-3.8-flash` as stable/GA. Gemini 3.8 Live documentation says to omit `thinking_level`/`thinking_config`.

Official references:

- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/deprecations

### Groq

| Purpose | Baseline |
| --- | --- |
| Text default | `openai/gpt-oss-120b` |
| Screen/vision default | `qwen/qwen3.6-27b` |
| Transcription default | `whisper-large-v3-turbo` |
| Models endpoint | `https://api.groq.com/openai/v1/models` |
| Chat endpoint | `https://api.groq.com/openai/v1/chat/completions` |
| Transcription endpoint | `https://api.groq.com/openai/v1/audio/transcriptions` |

At freeze time GPT-OSS 120B and Whisper Large V3 Turbo are Groq production models. Qwen 3.6 27B is a **Preview** vision model; Preview availability must not be treated as a permanent production guarantee.

Official references:

- https://console.groq.com/docs/models
- https://console.groq.com/docs/model/openai/gpt-oss-120b
- https://console.groq.com/docs/model/whisper-large-v3-turbo
- https://console.groq.com/docs/model/qwen/qwen3.6-27b
- https://console.groq.com/docs/deprecations

### Local AI

| Purpose | Baseline |
| --- | --- |
| Default language model | `unsloth/Qwen3.5-2B-GGUF:Q4_K_M` |
| Default Whisper model | `tiny.en` |
| Primary accelerated llama runtime | official llama.cpp Windows x64 Vulkan |
| Pinned llama.cpp release | `b10964` |
| Vulkan archive | `llama-b10964-bin-win-vulkan-x64.zip` |
| Vulkan archive SHA-256 | `1ee3ad952f4ba71f438bd6d7bebef19e1c7af04adcaa35d08b4ddabb27d4c642` |
| Vulkan backend requirement | `ggml-vulkan.dll` |
| CPU fallback source | legacy prebuilt v0.7.0 runtime |
| CPU llama SHA-256 | `7dcdb6ae66c8a03f43d412f2fac00382b927a8d2d817d22b231c14a326cdc862` |
| CPU whisper SHA-256 | `654e4531ad7cebe772c08485a742be770d6848b0cda2f540b179f426a6105435` |
| Model source | Hugging Face GGUF + projector |
| Verification | content checksum before install; atomic download/rename; cancellation |

The official llama.cpp release feed currently publishes Windows x64 CPU, CUDA, Vulkan, OpenVINO, SYCL and ROCm builds; `b10964` is an upstream release in that feed.

Official reference:

- https://github.com/ggml-org/llama.cpp/releases

The legacy CPU/Whisper executable host is frozen as an **existing baseline dependency**, not approved as the desired long-term supply-chain design. It is a Phase 4 audit target.

## 5. Vendored renderer asset baseline

These assets are tracked directly rather than resolved by npm at runtime:

| Asset | Baseline version |
| --- | --- |
| Lit | `lit-core-2.7.4.min.js` |
| Marked | `marked-4.3.0.min.js` |
| highlight.js | `highlight-11.9.0.min.js` |
| highlight theme | `highlight-vscode-dark.min.css` |

These versions are frozen here so later dependency/provenance work can distinguish an intentional upgrade from unrelated behavior drift.

## 6. Data/security invariants

The following are release invariants and must not be weakened by cleanup:

- Renderer Node integration remains disabled.
- Context isolation remains enabled.
- Renderer sandboxing remains enabled.
- `webSecurity` remains enabled.
- Main/preload IPC remains allowlisted and sender/main-frame validated.
- Display capture grants are restricted to the trusted main frame.
- Window navigation/popup creation stays denied unless explicitly safe.
- CSP remains restrictive.
- API keys are not returned to renderer reads.
- Packaged Windows credentials use Electron safeStorage / DPAPI when encryption is available.
- Existing encrypted credential files must not be overwritten if DPAPI is temporarily unavailable.
- History, settings, keys and downloaded models are not intentionally deleted by application upgrades.
- Network/provider operations retain cancellation and bounded deadlines.
- Provider selection stays explicit; no provider silently substitutes for another.
- Downloaded native executables/models remain integrity verified.
- GPL-3.0 `LICENSE` and `CREDITS.md` provenance remain present.

Electron's current security guidance specifically continues to recommend context isolation, sandboxing, restrictive CSP, navigation/window restrictions, current Electron, IPC sender validation and hardened fuses.

## 7. Must-not-regress matrix

| Surface | Frozen behavior | Automated baseline | External/device acceptance still required |
| --- | --- | --- | --- |
| App startup | Portable Windows x64 app reaches sandboxed renderer | Electron smoke + packaged smoke | Physical Win10/Win11 launch |
| Gemini Live | Start/close/reconnect, transcription, 1011 compatibility recovery | Unit/wire/runtime/soak tests | Real Gemini account and long wall-clock session |
| Gemini long sessions | Compression, newest resumption handle, GoAway rotation, bounded replay | Virtual long-session/rotation tests | Real provider multi-hour session |
| Gemini typed | Stream first/partial/final output without breaking active capture | SDK wire + UI request tests | Real account latency/quota |
| Gemini screen | Selected HTTP model; cancellation/retry/Search ownership | Screen/recovery tests | Real screenshots/provider account |
| Google Search | Saved requested state is distinct from effective Live/HTTP state | Recovery/UI tests | Account/tool availability |
| Groq text | GPT-OSS request completes independently of Gemini | Provider policy/session tests | Real Groq account |
| Groq voice | VAD -> Whisper transcription -> selected text model | VAD/request tests | Physical mic/loopback + real Groq |
| Groq screen | Qwen vision path remains explicit and Preview-labeled | Model/catalog/UI tests | Real Preview availability/account |
| Local AI | No cloud key required; selected model persists and launches | UI/startup/native tests | Real downloaded inference on CPU/GPU |
| Local AI Vulkan fallback | Verified Vulkan preferred; verified CPU fallback remains available | Windows runtime tests | GPU/driver-specific launch/inference |
| Speaker-only audio | System loopback path owned by session | Capture/audio tests | Physical Windows loopback |
| Mic-only audio | Microphone path owned by session | Capture/audio tests | Physical microphone |
| Mixed audio | Speaker + mic mixing does not block renderer hot path | Capture tests | Physical mixed-device run |
| Capture source | Active/primary/display/window selection remains explicit | Context-capture tests | Multi-monitor physical machine |
| Region analysis | Trusted isolated selector; protected capture; normalized region | Context-capture/Electron smoke | Real multi-monitor/DPI behavior |
| Capture protection | HUD/selector content protection remains enabled | Windows HUD/runtime tests | Target sharing/capture apps |
| Session lifecycle | Start/end/provider switch do not leak stale requests | Session lifecycle/request tests | Long interactive user session |
| History | Full saved conversation/screen history remains locally readable/deletable | History/storage tests | Large real history set |
| Session Packs | Saved context survives updates and reaches session context | Context/session smoke | Real workflow use |
| Knowledge | Local add/retrieve/disable behavior remains isolated | Knowledge tests + Electron smoke | Large heterogeneous corpus |
| Practice | Local question generation/grading remains deterministic enough for product contract | Practice tests + Electron smoke | User-quality acceptance |
| Review | Persisted session review reads current saved context | Review smoke/tests | Long real-session review |
| Shortcuts | Native registration, rollback and persistence remain correct | Shortcut tests | OS conflicts / user environment |
| Theme/transparency | Saved alpha affects native-transparent window; foreground remains readable | Appearance tests + Electron smoke | Real compositor/GPU/Win10/11 |
| Accessibility | Inputs labeled, focus recovery and keyboard actions remain usable | Electron smoke/UI tests | Screen reader/manual keyboard pass |
| Scaling | Packaged app launches at 100/125/150/200% Chromium scale | Run #336 packaged smoke | Physical monitor DPI combinations |
| Packaging | Hardened ASAR/fuses; x64 portable EXE produced | Workflow/release tests | Antivirus/SmartScreen environment |
| Credentials | Keys remain main-process-only and DPAPI-protected in packaged Windows | Storage/security tests | Same-user Windows threat assumptions |
| Repository provenance | GPL/CREDITS/brand identity stay intact | Brand/release tests | Legal review if upstream scope changes |

## 8. Baseline limitations and open external gates

Phase 0 does **not** claim the following have been proven by CI:

1. Live Gemini success for every account/project/quota configuration.
2. Live Groq success for every account/rate limit/Preview model state.
3. Physical microphone, speaker-loopback or mixed-device behavior.
4. Real GPU/driver compatibility for Vulkan Local AI.
5. Native Local AI speed/quality on representative end-user hardware.
6. Protected-capture behavior in every meeting/sharing application.
7. Wall-clock 1h/4h/8h provider sessions; virtual soak tests are not wall-clock provider tests.
8. Windows 10/11 physical hardware coverage; GitHub CI currently runs Windows Server 2022.
9. Authenticode/SmartScreen reputation; the current portable release is not frozen here as a signed installer.
10. Automatic application updating; the current release channel is portable/manual.
11. Branch-protection enforcement; `main` was reported unprotected at freeze time.
12. Immutable GitHub release enforcement; release `v0.8.0-portable.336` was reported `immutable: false`.

Those items belong to later phases or explicit physical/account acceptance.

## 9. Phase 0 exit criteria

Phase 0 is complete when:

- this document is reviewed against the exact baseline commit;
- the baseline main SHA, release tag, EXE digest, package versions and provider/native defaults match repository/Actions evidence;
- the must-not-regress matrix is accepted as the comparison contract for later phases;
- no runtime/dependency/workflow behavior has been changed as part of the freeze.

After Phase 0, Phase 1 can audit repository cleanliness/provenance against this frozen reference instead of judging files in isolation.
