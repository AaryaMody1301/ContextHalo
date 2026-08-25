# Contributing

## Before you start

1. Create a branch from the latest `main`.
2. Keep each pull request focused on one purpose.
3. Do not commit API keys, credentials, generated installers, or local data.

## Development

```bash
npm install
npm start
```

Run the relevant validation before opening a pull request:

```bash
npm run build:portable
```

## Pull request guidelines

- Use a clear, conventional commit message where practical.
- Explain what changed and why.
- Include validation results.
- Avoid drive-by refactors and unrelated formatting changes.
- Update documentation when behavior, configuration, or supported platforms change.

## Code style

Follow the existing JavaScript style unless a deliberate repository-wide formatting change is being made. Prefer small functions, explicit error handling, and clear names over clever abstractions.
