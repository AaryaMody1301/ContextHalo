# Third-party notices

ContextHalo is GPL-3.0 licensed. This file records third-party components that are vendored, packaged, downloaded at runtime, or used to build the Windows release. It is a provenance index, not a replacement for the upstream license texts or notices embedded in those components.

## Packaged runtime dependencies

| Component | Version | Role | License | Upstream |
| --- | --- | --- | --- | --- |
| Electron | 44.3.0 locked | Desktop runtime packaged into the Windows executable | MIT | https://github.com/electron/electron |
| @google/genai | 2.22.0 locked | Gemini Developer API SDK | Apache-2.0 | https://github.com/googleapis/js-genai |

Transitive production npm packages are recorded with exact version, registry URL, integrity and declared license in `docs/THIRD_PARTY_PROVENANCE.json`.

## Vendored renderer assets

| Tracked asset | Version | License | Upstream |
| --- | --- | --- | --- |
| `src/assets/lit-core-2.7.4.min.js` | Lit 2.7.4 | BSD-3-Clause | https://github.com/lit/lit |
| `src/assets/marked-4.3.0.min.js` | Marked 4.3.0 | MIT | https://github.com/markedjs/marked |
| `src/assets/highlight-11.9.0.min.js` | highlight.js 11.9.0 | BSD-3-Clause | https://github.com/highlightjs/highlight.js |
| `src/assets/highlight-vscode-dark.min.css` | highlight.js theme bundled with the 11.9.0 renderer asset set | BSD-3-Clause | https://github.com/highlightjs/highlight.js |

The vendored JavaScript assets retain upstream copyright/license headers. ContextHalo sanitizes Marked output before rendering; Marked itself does not provide HTML sanitization.

## Native Local AI runtime

ContextHalo downloads native runtimes on demand; they are not committed to this repository.

- Preferred Windows x64 Vulkan llama.cpp runtime: upstream `ggml-org/llama.cpp` release `b10964`, archive `llama-b10964-bin-win-vulkan-x64.zip`, SHA-256 `1ee3ad952f4ba71f438bd6d7bebef19e1c7af04adcaa35d08b4ddabb27d4c642`. llama.cpp is MIT licensed.
- CPU llama fallback: legacy upstream [v0.7.0 release](https://github.com/sohzm/cheating%2Ddaddy/releases/tag/v0.7.0), file `llama-server-windows-x86_64.exe`, SHA-256 `7dcdb6ae66c8a03f43d412f2fac00382b927a8d2d817d22b231c14a326cdc862`.
- Whisper runtime fallback: legacy upstream [v0.7.0 release](https://github.com/sohzm/cheating%2Ddaddy/releases/tag/v0.7.0), file `whisper-server-windows-x86_64.exe`, SHA-256 `654e4531ad7cebe772c08485a742be770d6848b0cda2f540b179f426a6105435`.

The checksum pins establish byte identity for the legacy fallback executables; they do not by themselves establish a complete reproducible build chain. Replacing or independently reproducing those legacy binaries remains a dedicated Local AI supply-chain task.

## Downloaded models

Whisper GGML model files and user-selected GGUF/projector files are downloaded only when Local AI is configured. ContextHalo verifies expected SHA-256 values before installation and uses atomic temporary downloads.

The current download implementation resolves Hugging Face files from the mutable `main` revision. A future supply-chain phase should resolve and persist a full repository commit before downloading model/projector files. Model licenses are defined by their individual upstream repositories; ContextHalo does not relicense downloaded models.

## Build and release tooling

The Windows workflow pins GitHub Actions by full commit SHA. electron-builder 26.15.3 is a build-time dependency and is MIT licensed. Exact npm package resolution is recorded in `package-lock.json`.

## ContextHalo source availability

Each GitHub release tag points to the exact ContextHalo commit used to build that release, and GitHub exposes source archives for the tag. See the repository and release history for the corresponding source revision.

For project-level derivative attribution, see `CREDITS.md`. For the ContextHalo license, see `LICENSE`.
