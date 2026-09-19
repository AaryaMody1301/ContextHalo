# Performance, model, and transparency audit - 19 September 2026

Baseline: `main` `3d4b12066f7be15433fc5037ebd79b2c27e8ee51`.

## Confirmed causes

- Gemini defaults in source were already 3.8, but storage migration preserved older saved 2.5 selections. Config v7 migrates the legacy Live/2.5 HTTP defaults to stable `gemini-3.8-live` and `gemini-3.8-flash`.
- The Text / Screen picker was fed the whole Gemini catalog. It is now limited to documented stable multimodal Flash families suitable for ContextHalo; unrelated Pro/image/TTS/transcription/legacy 2.5 entries are not presented in that picker.
- Typed and screen Gemini calls used non-streaming `generateContent`, so the renderer waited for the complete answer. They now use `generateContentStream` and publish chunks as they arrive.
- Gemini 3.8 Flash defaults to medium thinking. Interactive and balanced ContextHalo modes now explicitly request low thinking; Detailed uses medium. The Live model continues to omit `thinkingConfig`, as required for 3.8 Live setup.
- Typed Gemini repeatedly sent substantially more transcript/history than the interactive UI needs. Recent transcript/history/screen context remains available but is more tightly bounded to reduce prompt-prefill latency.
- Local AI keeps streaming and verified Vulkan/CPU fallback. New/default installs use Qwen 3.5 2B Q4 instead of the older 4B default; the old implicit default migrates once. 0.8B remains the fastest manual choice. Small presets use a 4096-token native context while 4B+ models retain 8192. The current Vulkan runner enables `--cache-reuse 256`; the older CPU fallback keeps its conservative CLI.
- The transparency preference previously affected only the HUD. Normal content painted an opaque `--bg-app`, and normal mode enabled Windows Mica. The native frameless BrowserWindow was already transparent. The root window surface now uses the saved RGBA alpha in normal and HUD modes, child content roots are transparent, cards/text remain opaque for readability, and Windows background material stays `none` so CSS alpha exposes the desktop.

## Primary contracts reviewed

- Gemini model catalog and stable IDs: https://ai.google.dev/gemini-api/docs/models
- Gemini 3.8 Flash capabilities and thinking levels: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- Gemini 3.8 Live migration/setup: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live
- Gemini streaming generation: https://ai.google.dev/gemini-api/docs/text-generation
- Google GenAI JS streaming API: https://github.com/googleapis/js-genai
- Electron transparent windows: https://www.electronjs.org/docs/latest/tutorial/custom-window-styles
- llama.cpp server cache/GPU/context flags: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md

No provider is silently substituted. Groq behavior/model defaults are unchanged. Credentials, cancellation/deadlines, Search isolation, Live resumption, sandboxing, IPC validation, certificate validation and checksum verification remain in place.
