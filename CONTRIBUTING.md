# Contributing

Thanks for contributing to ContextHalo. The supported target is **Windows 10/11 x64**.

By participating, you agree to follow the project's [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

1. Create a branch from the latest `main`.
2. Keep each pull request focused on one purpose.
3. Do not commit API keys, credentials, generated installers, private recordings, sensitive screenshots, or local application data.
4. For security-sensitive reports, follow [SECURITY.md](SECURITY.md) rather than opening a public issue.

## Development

```bash
npm install
npm start
```

Run validation before opening a pull request:

```bash
npm run check
npm test
npm run build:portable
```

The GitHub Actions workflow also launches the real Electron renderer in sandboxed mode and verifies the portable Windows executable.

## Pull request guidelines

- Use a clear, conventional commit message where practical.
- Explain what changed and why.
- Include validation results and reproducible steps for bug fixes.
- Keep changes focused on the supported Windows target unless shared code requires otherwise.
- Avoid drive-by refactors and unrelated formatting changes.
- Update documentation when behavior, configuration, privacy/security handling, or supported functionality changes.
- Redact secrets and personal information from screenshots and logs.

## Code style

Follow the existing JavaScript style unless a deliberate repository-wide formatting change is being made. Prefer small functions, explicit error handling, bounded network operations, and clear names over clever abstractions.
