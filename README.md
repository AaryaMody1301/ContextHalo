# ContextHalo

ContextHalo is an open-source, context-aware AI desktop assistant for Windows. It combines screen context, Windows system audio, microphone input, typed prompts, and local or cloud AI models to provide real-time assistance for meetings, presentations, development workflows, research, and general productivity.

> **Supported platform:** Windows 10/11 x64.

**Project links:** [Latest release](https://github.com/AaryaMody1301/ContextHalo/releases/latest) · [Report a bug](https://github.com/AaryaMody1301/ContextHalo/issues/new/choose) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## Features

- Gemini Live, Groq, and optional fully local AI with dynamic provider model discovery
- Low-latency Windows system-audio loopback and microphone capture
- Protected Windows Live HUD with always-on-top, click-through, taskbar hiding, and capture protection
- Mica/Acrylic Windows presentation with solid fallbacks where system materials are unavailable
- Live transcript context across Gemini, Groq Whisper, and local whisper.cpp paths
- Instant, Balanced, and Detailed response modes plus Important/Decision/Action/Question markers
- Multi-monitor/window capture selection, protected region analysis, and explicit copied-text context
- Session Packs for goals, notes, and reusable session context
- Local Knowledge Library with dependency-free retrieval for text, code, logs, CSV/JSON, SQL, YAML, and related text formats
- Practice Lab generated locally from knowledge sources or previous sessions, with keyword-overlap feedback (not an expert assessment)
- Session Review for topics, decisions, actions, questions, markers, and follow-up practice
- Conversation and screen-analysis history stored locally
- Windows DPAPI-backed API-key protection through Electron safeStorage
- Production portable builds use electron-builder with hardened Electron fuses and ASAR integrity validation

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

CI also launches the real Electron renderer in sandboxed mode before packaging and verifying the portable Windows executable. It exercises sending, draft recovery, mixed response routing, HTML sanitization, navigation, persistence, knowledge retrieval, practice, and review. Provider responses in these UI checks are mocked; live API calls, Windows capture devices and downloaded native-model inference still require the acceptance checks in [the reliability audit](docs/RELIABILITY_AUDIT.md).

## Provider modes

### Gemini API

Uses Gemini Live for real-time audio. Typed prompts and screen analysis use the selected Gemini text/analysis model through separate bounded HTTP requests. Typed questions include recent saved transcript, conversation, session-pack, knowledge, and screen-analysis context; they do not pause audio capture. Live and HTTP models are separate selections because not every model supports both APIs.

### Groq API

Uses Whisper for transcription, GPT-OSS for text reasoning, and Qwen vision for screenshots.

### Local AI

Uses native whisper.cpp and llama.cpp runners with downloadable GGUF models. No cloud API key is required.

## Security and privacy

- API credentials are never committed to the repository.
- On Windows, ContextHalo encrypts stored API credentials with Electron safeStorage / Windows DPAPI when available.
- Renderer sandboxing, context isolation, a restrictive CSP, and IPC channel allowlists are enabled.
- Network/provider operations use bounded timeouts and cancellation where applicable.
- Keep API keys, private recordings, sensitive screenshots, personal data, and access tokens out of issues, logs, and source files.
- See [SECURITY.md](SECURITY.md) for security reporting guidance.

Transport logs are off by default. `CONTEXTHALO_DIAGNOSTICS=1` enables size-limited, metadata-only diagnostic logs; prompts, API keys, audio and full responses are not recorded by this logger. Local history remains user data and can be deleted through Settings.

ContextHalo has no application subscription requirement. Cloud providers may impose quotas, change access, or charge for usage; a model appearing in discovery does not guarantee free or unlimited requests. Screen requests are on demand only.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Keep changes focused and ensure the Windows validation workflow passes before merging.

## Credits and license

ContextHalo is a substantially modified and rebranded derivative of earlier GPL-3.0 work. See [CREDITS.md](CREDITS.md) for attribution and provenance.

Licensed under the [GNU General Public License v3.0](LICENSE).
