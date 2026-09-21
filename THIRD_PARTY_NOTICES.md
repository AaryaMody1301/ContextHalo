# Third-party notices

ContextHalo is GPL-3.0 licensed. This file records third-party components that are vendored, packaged, downloaded at runtime, or used to build the Windows release. It is a provenance index, not a replacement for the upstream license texts or notices embedded in those components.

## Packaged runtime dependencies

| Component | Version | Role | License | Upstream |
| --- | --- | --- | --- | --- |
| Electron | 44.3.0 locked | Desktop runtime packaged into the Windows executable | MIT | https://github.com/electron/electron |
| @google/genai | 2.22.0 locked | Gemini Developer API SDK | Apache-2.0 | https://github.com/googleapis/js-genai |
| Marked | 18.0.13 locked | Markdown parser; packaged from npm and loaded locally in the renderer | MIT | https://github.com/markedjs/marked |

Transitive production npm packages are recorded with exact version, registry URL, integrity and declared license in `docs/THIRD_PARTY_PROVENANCE.json`.

## Vendored renderer assets

| Tracked asset | Version | License | Upstream |
| --- | --- | --- | --- |
| `src/assets/lit-core-3.3.3.min.js` | Lit 3.3.3 | BSD-3-Clause | https://github.com/lit/dist/tree/v3.3.3/core |

Lit remains a single-file local bundle because the renderer does not use a bundler or import map. Marked is no longer a hand-copied asset: the exact npm package is locked in `package-lock.json`, and the browser UMD file is loaded locally from packaged `node_modules`.

ContextHalo sanitizes Marked output with its own allowlist before rendering; Marked itself does not sanitize output. The unused highlight.js 11.9.0 script and theme were removed in Phase 5 rather than upgraded because runtime code never invoked highlight.js.

## Native Local AI runtime

ContextHalo downloads native runtimes on demand; they are not committed to this repository.

- Preferred Windows x64 Vulkan llama.cpp runtime: official `ggml-org/llama.cpp` release `b10964`, source commit `b29c606e28a01b1bc8c1351026a0fa6e616bf6c4`, archive `llama-b10964-bin-win-vulkan-x64.zip`, SHA-256 `1ee3ad952f4ba71f438bd6d7bebef19e1c7af04adcaa35d08b4ddabb27d4c642`. llama.cpp is MIT licensed.
- CPU llama fallback: the same official `ggml-org/llama.cpp` `b10964` source commit, archive `llama-b10964-bin-win-cpu-x64.zip`, SHA-256 `917f39c076402c421224824607397af20f53625a60defc20e8dd22446bf4c5d7`.
- Whisper runtime: official `ggml-org/whisper.cpp` developer release `b5130`, source commit `927cfce34f31707e17f2bff35c349632fb9e2c3a`, archive `whisper-bin-x64.zip`, SHA-256 `f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c`. This is the same source commit referenced by stable `v1.9.4`; whisper.cpp is MIT licensed.

The former legacy v0.7.0 llama/Whisper executables are no longer runtime dependencies. Historical audit documents retain their old hashes only as evidence of the pre-Phase-4 baseline. Installed official runtime directories carry a `.source.json` file recording the upstream tag, full commit, archive, URL and SHA-256 used for that installation.

## Downloaded models

Whisper GGML model files and user-selected GGUF/projector files are downloaded only when Local AI is configured. ContextHalo verifies expected SHA-256 values before installation and uses atomic temporary downloads.

The bundled Whisper model choices are pinned to Hugging Face repository `ggerganov/whisper.cpp` at full commit `5359861c739e955e79d9a303bcbc70fb988958b1` in addition to their existing file SHA-256 values. For user-selected Hugging Face GGUF repositories, ContextHalo first resolves the repository's full 40-character commit SHA, lists files at that immutable revision, downloads the selected model/projector from the same revision, verifies their LFS/Xet SHA-256 values, and persists the revision plus artifact paths/checksums in a local `.source-{quant}.json` provenance record.

Model licenses are defined by their individual upstream repositories; ContextHalo does not relicense downloaded models.

## Build and release tooling

The Windows workflow pins GitHub Actions by full commit SHA. electron-builder 26.15.3 is a build-time dependency and is MIT licensed. Exact npm package resolution is recorded in `package-lock.json`.

## ContextHalo source availability

Each GitHub release tag points to the exact ContextHalo commit used to build that release, and GitHub exposes source archives for the tag. See the repository and release history for the corresponding source revision.

For project-level derivative attribution, see `CREDITS.md`. For the ContextHalo license, see `LICENSE`.
