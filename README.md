# ContextHalo

Runtime status and source map: [September 23 final repair](docs/FINAL_RUNTIME_REPAIR_2026-09-23.md). This is not a claim that physical Windows/provider acceptance or repository Administration gates have passed.

ContextHalo is an open-source, context-aware AI desktop assistant for Windows. It combines screen context, Windows system audio, microphone input, typed prompts, and local or cloud AI models to provide real-time assistance for meetings, presentations, development workflows, research, and general productivity.

> **Supported platform:** Windows 10/11 x64.

**Project links:** [Latest release](https://github.com/AaryaMody1301/ContextHalo/releases/latest) · [Report a bug](https://github.com/AaryaMody1301/ContextHalo/issues/new/choose) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## Features

- Gemini Live, Groq, and optional fully local AI with dynamic provider model discovery
- Low-latency Windows system-audio loopback and microphone capture
- Protected Windows Live HUD with always-on-top, click-through, taskbar hiding, and capture protection
- Adjustable HUD background opacity with opaque text and controls
- Live transcript context across Gemini, Groq Whisper, and local whisper.cpp paths
- Instant, Balanced, and Detailed response modes plus Important/Decision/Action/Question markers
- Multi-monitor/window capture selection, protected region analysis, and explicit copied-text context
- Session Packs for goals, notes, and reusable session context
- Local Knowledge Library with dependency-free retrieval for text, code, logs, CSV/JSON, SQL, YAML, and related text formats
- Practice Lab generated locally from knowledge sources or previous sessions, with keyword-overlap feedback (not an expert assessment)
- Session Review for topics, decisions, actions, questions, markers, and follow-up practice
- Conversation and screen-analysis history stored locally
- Windows DPAPI-backed API-key protection through Electron safeStorage
- Production portable builds use electron-builder with hardened Electron fuses, ASAR integrity validation, embedded release provenance, and a notification-only official-release update check

## Requirements

- Windows 10 or Windows 11 x64
- Node.js 22.16+ (Node.js 24 LTS recommended) and npm 10+ for development
- A Gemini API key, Groq API key, or Local AI model depending on the selected provider
- Screen/audio permissions required by Windows

## Quick start

```bash
npm ci
npm start
```

Build the portable Windows executable:

```bash
npm run build:portable
```

## Updates

ContextHalo currently ships as a portable Windows executable. Packaged releases check the fixed official GitHub Releases feed and show **Update available** only after the release tag, immutable commit, expected executable/checksum assets, sizes, and SHA-256 metadata pass validation. Selecting the notice opens the official release page in the system browser.

The portable app does not silently download, replace, or execute an update. Replace the executable manually after verifying the release/checksum. Release builds embed the exact portable SemVer (for example, `0.8.0-portable.372` for tag `v0.8.0-portable.372`) and the source commit used to build them. A future installer-based auto-update channel requires a signed Windows distribution identity and separate validation before it can replace this portable/manual path.

Main-branch release artifacts also receive GitHub artifact provenance attestations. With the GitHub CLI installed, a downloaded executable can be checked against this repository with:

```bash
gh attestation verify ContextHalo-Windows-x64.exe --repo AaryaMody1301/ContextHalo
```

The repository's Phase 8 governance policy additionally requires pull requests, the Windows build check, resolved review threads, no force-pushes/deletions on `main`, and immutable releases. Signed-commit enforcement is intentionally deferred until the PR head-commit path itself produces verified signatures, so the rule cannot deadlock normal merges. The machine-readable target policy is in [`docs/PHASE_8_REPOSITORY_GOVERNANCE.json`](docs/PHASE_8_REPOSITORY_GOVERNANCE.json).

## Validation

```bash
npm run check
npm test
```

CI also launches the real Electron renderer in sandboxed mode before packaging and verifying the portable Windows executable. It exercises sending, draft recovery, mixed response routing, HTML sanitization, navigation, persistence, knowledge retrieval, practice, and review. Provider responses in these UI checks are mocked; live API calls, Windows capture devices and downloaded native-model inference still require the acceptance checks in [the reliability audit](docs/RELIABILITY_AUDIT.md).

For physical long-session validation, start the packaged EXE with `--reliability-acceptance` and set `CONTEXTHALO_ACCEPTANCE_DIR`. This opt-in mode records resource/lifecycle metadata only and creates 1h/4h/8h checkpoints; it does not record prompts, transcripts, audio, screenshots, keys, file paths, or model responses. Summarize a completed run with `node scripts/reliability-acceptance-report.js <evidence-dir> --minimum-hours=1|4|8`. See [the Phase 9 acceptance protocol](docs/PHASE_9_REAL_WORLD_ACCEPTANCE_2026-09-22.md).

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

Saved API keys are not returned to renderer code. Home shows credential-presence flags and accepts explicit key replacement/removal; provider initialization reads credentials in the main process.

Transport logs are off by default. `CONTEXTHALO_DIAGNOSTICS=1` enables size-limited, metadata-only diagnostic logs; prompts, API keys, audio and full responses are not recorded by this logger. Local history remains user data and can be deleted through Settings.

ContextHalo has no application subscription requirement. Cloud providers may impose quotas, change access, or charge for usage; a model appearing in discovery does not guarantee free or unlimited requests. Screen requests are on demand only.

## API and reliability verification

See [the dated API compatibility audit](docs/API_COMPATIBILITY_AUDIT.md) for verified endpoints, model contracts, source references, and the boundary between automated verification and live-account/device acceptance. A virtual 60-minute test exercises 36,000 audio chunks and six reconnect rotations; it is not a real one-hour provider or hardware test.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Keep changes focused and ensure the Windows validation workflow passes before merging.

## Credits and license

ContextHalo is a substantially modified and rebranded derivative of earlier GPL-3.0 work. See [CREDITS.md](CREDITS.md) for attribution and provenance.

Licensed under the [GNU General Public License v3.0](LICENSE).

### Transparency and Google Search recovery

HUD opacity changes the background only; text and controls remain solid. Drag the window edges/corners to resize, or focus the bottom-right resize handle and use Arrow keys (Shift for larger steps). Workspace fit/restore is application-owned; the transparent native window never enables native resize/maximize. Keep DevTools closed when evaluating desktop transparency.

Live and text/screen Search may have different effective states after recovery. Session details show both routes and the reason. A Search-enabled Live setup quota/1011 failure may receive one bounded same-model Search-off control; success keeps Live available without changing the saved preference or HTTP Search. An HTTP failure is never silently resent without Search: use **Retry request without Search** to opt out for the text/screen route. A generic quota error does not by itself identify a project/model quota.
