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

Run validation before opening an application pull request:

```bash
npm run check
npm test
```

Every pull request checks source syntax, dependency provenance, repository policy, and branding. Documentation-only changes can finish there. Changes limited to renderer components, Knowledge Library, Practice, or JavaScript tests run the full regression suite and the sandboxed Electron renderer on Windows. Changes to dependencies, workflows, or packaging and other changes also build the portable EXE, verify its checksum, and launch it at four display scales.

Pushes to main and manual runs always validate the portable EXE. Run `npm run build:portable` locally when changing packaging or runtime setup.

For dependency changes, run `node --test tests/repository-provenance.test.js`. Keep the production inventory in `docs/THIRD_PARTY_PROVENANCE.json` and the locked runtime versions in `THIRD_PARTY_NOTICES.md` in sync with `package-lock.json`.

## Pull request guidelines

- Use a clear, conventional commit message where practical.
- Explain what changed and why.
- Include validation results and reproducible steps for bug fixes.
- Keep changes focused on the supported Windows target unless shared code requires otherwise.
- Avoid drive-by refactors and unrelated formatting changes.
- Update documentation when behavior, configuration, privacy/security handling, or supported functionality changes.
- When adding or changing vendored JavaScript/CSS, native executables, downloadable models, or other non-npm runtime artifacts, update `THIRD_PARTY_NOTICES.md` and `docs/THIRD_PARTY_PROVENANCE.json` with the upstream source, version/revision, license, and integrity digest where available.
- Do not replace checksum-pinned native/model artifacts with floating URLs without an explicit provenance and rollback plan.
- Redact secrets and personal information from screenshots and logs.

## Code style

Follow the existing JavaScript style unless a deliberate repository-wide formatting change is being made. Prefer small functions, explicit error handling, bounded network operations, and clear names over clever abstractions.
