# Phase 4 Local AI supply-chain audit — 2026-09-21

## Scope

Phase 4 replaces the two unresolved native-runtime provenance paths recorded by the Phase 0–2 audits and removes mutable Hugging Face `main` from Local AI downloads.

Baseline before this phase:

- `main`: `0a15dff021f5ce737d2e9efeaf7bf05bfa9650ab` (merged Phase 3)
- Windows target: Windows 10/11 x64
- Local AI default: `unsloth/Qwen3.5-2B-GGUF:Q4_K_M`
- preferred llama runner: official Vulkan llama.cpp `b10964`
- CPU llama/Whisper fallback before Phase 4: checksum-pinned historical v0.7.0 executables without exact upstream ggml source commits
- dynamic Hugging Face GGUF/model downloads before Phase 4: checksum verified but resolved through mutable `main`

This phase changes only native/model acquisition and the matching Local AI CLI compatibility path. It does not change cloud providers, model defaults, Local AI conversation semantics, saved user preferences, or the portable application format.

## Official upstream evidence

### llama.cpp

Official release:

- repository: https://github.com/ggml-org/llama.cpp
- release: `b10964`
- source commit: `b29c606e28a01b1bc8c1351026a0fa6e616bf6c4`
- release date: 2026-09-14

Windows x64 assets used by ContextHalo:

| Role | Artifact | SHA-256 |
| --- | --- | --- |
| Vulkan preferred runner | `llama-b10964-bin-win-vulkan-x64.zip` | `1ee3ad952f4ba71f438bd6d7bebef19e1c7af04adcaa35d08b4ddabb27d4c642` |
| CPU fallback | `llama-b10964-bin-win-cpu-x64.zip` | `917f39c076402c421224824607397af20f53625a60defc20e8dd22446bf4c5d7` |

Source references:

- https://github.com/ggml-org/llama.cpp/releases/tag/b10964
- https://github.com/ggml-org/llama.cpp/blob/b10964/tools/server/README.md
- GitHub artifact attestations for the b10964 release expose the same archive digests.

Both CPU and Vulkan now come from the same exact upstream source revision, so the earlier “unknown CPU source ancestry” blocker is removed.

### whisper.cpp

Official releases:

- repository: https://github.com/ggml-org/whisper.cpp
- stable version: `v1.9.4`
- corresponding developer build with Windows assets: `b5130`
- source commit for both: `927cfce34f31707e17f2bff35c349632fb9e2c3a`
- release date: 2026-09-11

Windows x64 artifact used by ContextHalo:

- `whisper-bin-x64.zip`
- SHA-256: `f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c`

Source references:

- https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.4
- https://github.com/ggml-org/whisper.cpp/releases/tag/b5130
- https://github.com/ggml-org/whisper.cpp/tree/b5130/examples/server

The official server contract continues to support the ContextHalo invocation and request path: model path, host/port binding, multipart `/inference`, language, temperature, and JSON response format.

## Runtime acquisition policy

`src/utils/native-ai-runtime.js` now owns official CPU llama and Whisper release manifests. `src/utils/windowsLocalAiRuntime.js` owns the official Vulkan llama manifest.

For every native archive:

1. the download URL is an explicit official `ggml-org` GitHub release URL;
2. the expected SHA-256 is pinned in source;
3. the archive is downloaded to an application-owned binaries directory through a temporary file;
4. its SHA-256 is verified before install;
5. extraction occurs in a temporary staging directory;
6. the expected server executable must exist before promotion;
7. Vulkan additionally requires `ggml-vulkan.dll`;
8. the staging directory gets a `.source.json` record with tag, full source commit, artifact name, URL and SHA-256;
9. only then is the staged directory atomically promoted;
10. cancellation or extraction failure removes the staging directory and cannot replace the last valid runtime.

The previous standalone legacy CPU llama and Whisper executable URLs are no longer referenced by runtime source.

## llama CPU/Vulkan compatibility

Both llama runners are official `b10964` builds from the same source commit. ContextHalo therefore uses the same audited server flags for both, including:

- `--host 127.0.0.1`
- `--port`
- `--alias local`
- `-c`
- `-m`
- `--mmproj`
- `--cache-reuse 256`

Vulkan remains preferred. If the verified Vulkan archive or GPU-backed launch fails, ContextHalo stops the failed process and starts the verified official b10964 CPU runner with the same selected model/projector. Cancellation never triggers fallback.

## Whisper model provenance

The built-in Whisper model choices retain their existing file SHA-256 pins but no longer resolve through mutable `main`.

Repository:

- https://huggingface.co/ggerganov/whisper.cpp
- pinned full revision: `5359861c739e955e79d9a303bcbc70fb988958b1`

The runtime constructs `/resolve/<40-character-commit>/<artifact>` URLs for `tiny.en`, `base.en`, and `small.en`.

## Dynamic Hugging Face GGUF provenance

For a user-selected `owner/repository:quant` reference, the runtime now uses one immutable repository snapshot for the entire resolution/download transaction:

1. fetch model metadata from `https://huggingface.co/api/models/<owner>/<repository>`;
2. require a full 40-character hexadecimal `sha`;
3. list the model tree at `/tree/<sha>`, following pagination only inside that exact repository/revision path;
4. select exactly one requested GGUF quant and one supported BF16/F16/F32 multimodal projector;
5. use LFS SHA-256 metadata when available;
6. on the Windows Xet fallback, obtain SHA-256 ETags from `/resolve/<sha>/<path>`;
7. download both model and projector from that same immutable revision;
8. checksum verify and atomically install each file;
9. persist `.source-<quant>.json` containing repository, full revision, quant, model/projector paths and SHA-256 values.

A model provenance record cannot be written with `main`, a short hash, or any non-40-character revision.

Hugging Face reference:

- https://huggingface.co/docs/huggingface_hub/package_reference/hf_api

The Hub model metadata contract exposes the repository commit SHA through `ModelInfo.sha`.

## Provenance records

Current distribution/runtime provenance is maintained in:

- `THIRD_PARTY_NOTICES.md`
- `docs/THIRD_PARTY_PROVENANCE.json`

Historical Phase 0/1/2 audits intentionally retain the legacy hashes and old unresolved statements because they describe the baseline at those phases. They are not current runtime configuration.

## Regression and negative coverage

Phase 4 adds or updates tests for:

- exact official llama CPU release/tag/full commit/archive/SHA/URL;
- exact official Whisper release/stable version/full commit/archive/SHA/URL;
- exact pinned Whisper Hugging Face revision;
- absence of legacy runtime filenames/hashes/host from runtime code;
- absence of `resolve/main` from Local AI runtime code;
- archive staging and expected-server validation before promotion;
- `.source.json` native runtime metadata;
- cancellation-safe Vulkan staging;
- Hub metadata rejecting a missing full revision;
- tree pagination bound to the same immutable repository/revision;
- cross-origin pagination rejection;
- dynamic GGUF downloads using the same resolved revision for both artifacts;
- persisted model source revision/path/checksum metadata;
- rejection of non-immutable model provenance;
- CPU and Vulkan b10964 using the same cache-reuse CLI contract;
- machine-readable provenance matching the source manifests.

## Exit status and remaining physical gates

Source-level Phase 4 supply-chain blockers are resolved when Windows CI is green:

- legacy fallback executables are no longer runtime dependencies;
- official native releases have explicit full source commits and SHA-256 pins;
- model downloads no longer use mutable `main`;
- selected dynamic model revisions are locally auditable after download.

CI can validate the JavaScript control flow, archive staging logic, checksums/manifests, renderer/application regression suite, portable build, and packaged application launches without downloading multi-gigabyte AI models.

The following remain physical acceptance gates rather than supply-chain gaps:

- successful native b10964 Vulkan inference on representative Windows GPUs/drivers;
- successful b10964 CPU fallback inference on representative x64 CPUs;
- successful b5130 Whisper inference with a real microphone/system-audio capture;
- full user-selected GGUF/model downloads and inference on real networks/storage.

Those gates must not be reported as hardware-validated solely from CI.
