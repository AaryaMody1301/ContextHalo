# Cheating Daddy

A desktop AI assistant for real-time interview, meeting, presentation, and screen-based assistance. The application combines live audio, screen context, and text input with Gemini, Groq, cloud, and local provider options.

> **Status:** Active development. Windows is the primary supported build target.

## Features

- Real-time AI assistance with configurable provider modes
- Screen capture and image analysis
- System-audio and microphone workflows
- Gemini Live and Groq integrations
- Conversation history and multiple profiles
- Always-on-top transparent overlay with click-through mode
- Configurable keyboard shortcuts
- Windows portable build and cross-platform Electron packaging

## Requirements

- Node.js 22+
- npm 10+
- Windows, macOS, or Linux with Electron support
- A valid API key for the provider you choose
- Required screen/audio permissions for your operating system

## Quick start

```bash
npm install
npm start
```

For a production-style Windows portable build:

```bash
npm run build:portable
```

## Development commands

| Command | Purpose |
| --- | --- |
| `npm start` | Run the app locally |
| `npm run package` | Package the Electron application |
| `npm run make` | Build platform installers through Electron Forge |
| `npm run build:portable` | Build the Windows x64 portable executable |

## Project structure

```text
src/
├── index.js           # Electron main process and IPC
├── utils/             # Providers, window, storage and platform utilities
├── renderer/          # Application UI
├── assets/            # Application assets
└── preload.js         # Isolated renderer-to-main IPC bridge

.github/workflows/     # CI and release automation
```

## Security and privacy

- API credentials are stored locally and are never committed to the repository.
- Keep API keys out of source code, screenshots, issues, and logs.
- Use `.env` or local configuration for development secrets.
- Report security issues privately; see [SECURITY.md](SECURITY.md).

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Keep changes focused, avoid unrelated formatting churn, and ensure the relevant build checks pass.

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
