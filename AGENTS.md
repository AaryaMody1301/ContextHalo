# ContextHalo Repository Guidelines

ContextHalo is a Windows 10/11 x64 Electron desktop AI assistant. The supported application modes are Gemini API, Groq API, and Local AI. macOS and Linux behavior is not a release target unless shared code directly affects Windows.

## Getting started

```bash
npm install
npm start
```

Build the portable Windows executable with:

```bash
npm run build:portable
```

## Required validation

Before merging a change, run:

```bash
npm run check
npm test
```

The GitHub Actions Windows workflow also launches the real Electron renderer with the sandboxed preload before building and verifying the portable EXE. Do not treat packaging alone as runtime validation.

## Code style

- JavaScript uses four-space indentation, semicolons, and single quotes where practical.
- Keep provider logic explicit: Gemini, Groq, and Local AI should not silently depend on one another.
- Validate and sanitize every value crossing the renderer/main IPC boundary.
- Keep network requests bounded with cancellation/timeouts; stale provider work must not outlive a session or Analyze Screen request.
- Keep Windows loopback/microphone audio work off the UI hot path.
- Add or update tests for every behavioral fix.
- Do not commit API keys, tokens, downloaded models, generated binaries, or build output.

## Windows runtime

The supported target is Windows x64. Preserve these properties when changing window/capture code:

- `nodeIntegration: false`
- `contextIsolation: true`
- renderer sandboxing enabled
- Windows system-audio loopback capture
- microphone-only, speaker-only, and mixed-audio modes
- DPAPI-backed credential storage through Electron `safeStorage` when available
- restrictive Content Security Policy and IPC channel allowlists

## Provider integrations

- Gemini Live handles real-time Gemini audio sessions.
- Gemini Flash handles Gemini screen analysis with a bounded fallback strategy.
- Groq uses Whisper for transcription, GPT-OSS for text reasoning, and Qwen vision for screenshots.
- Local AI uses checksum-verified native whisper.cpp and llama.cpp runners plus GGUF models.

Provider model IDs and request fields can change over time. Check the current official provider documentation before changing models or API schemas.

## Branding

The public product identity is **ContextHalo**. Keep package names, executable names, UI strings, documentation, tests, and release metadata consistent. `tests/brand.test.js` intentionally fails if the pre-ContextHalo product identity is reintroduced as a literal tracked source string.

## Licensing and provenance

ContextHalo remains GPL-3.0 licensed and is a substantially modified derivative of earlier GPL-3.0 work. Preserve `LICENSE` and `CREDITS.md`, and clearly mark substantial modifications when redistributing the project.
