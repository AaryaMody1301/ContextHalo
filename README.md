# ContextHalo

ContextHalo is an open-source, context-aware AI desktop assistant for Windows. It combines screen context, Windows system audio, microphone input, typed prompts, and local or cloud AI models to provide real-time assistance for meetings, presentations, development workflows, research, and general productivity.

> **Platform:** Windows 10/11 x64 is the supported target.

## Features

- Gemini Live for low-latency audio assistance
- Gemini screenshot and screen-context analysis
- Groq transcription, reasoning, and vision modes
- Optional fully local AI with whisper.cpp and llama.cpp
- Windows system-audio loopback and microphone capture
- Speaker-only, microphone-only, and mixed-audio modes
- On-demand screen analysis with keyboard shortcuts
- Conversation and screen-analysis history
- Always-on-top transparent overlay with click-through mode
- Windows DPAPI-backed API-key protection through Electron safeStorage

## Requirements

- Windows 10 or Windows 11 x64
- Node.js 22+ and npm 10+ for development
- A Gemini API key, Groq API key, or Local AI model depending on the selected provider
- Screen/audio permissions required by Windows

## Quick start

```bash
npm install
npm start
```

Build the portable Windows executable:

```bash
npm run build:portable
```

## Validation

```bash
npm run check
npm test
```

CI also launches the real Electron renderer in sandboxed mode before packaging the portable Windows executable.

## Provider modes

### Gemini API
Uses Gemini Live for real-time audio and Gemini Flash for screen analysis.

### Groq API
Uses Whisper for transcription, GPT-OSS for text reasoning, and Qwen vision for screenshots.

### Local AI
Uses native whisper.cpp and llama.cpp runners with downloadable GGUF models. No cloud API key is required.

## Security and privacy

- API credentials are never committed to the repository.
- On Windows, ContextHalo encrypts stored API credentials with Electron safeStorage / Windows DPAPI when available.
- Renderer sandboxing, context isolation, a restrictive CSP, and IPC channel allowlists are enabled.
- Keep API keys out of screenshots, issues, logs, and source files.
- See [SECURITY.md](SECURITY.md) for security reporting guidance.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Keep changes focused and ensure the Windows validation workflow passes before merging.

## Credits and license

ContextHalo is a substantially modified and rebranded derivative of earlier GPL-3.0 work. See [CREDITS.md](CREDITS.md) for attribution.

Licensed under the [GNU General Public License v3.0](LICENSE).
