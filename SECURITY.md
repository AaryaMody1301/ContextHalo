# Security Policy

## Reporting a vulnerability

Please do not publish sensitive vulnerabilities, exposed credentials, or reproducible exploit details in public issues.

Report the issue privately to the repository owner with:

- a clear description of the issue;
- affected versions or commits;
- steps to reproduce;
- potential impact; and
- any suggested mitigation.

Please redact API keys, access tokens, personal information, and user content from reports.

## Supported code

Security fixes are applied to the latest `main` branch. Older commits and generated releases may not receive patches.

## Development expectations

- Never hard-code credentials.
- Validate IPC inputs crossing the Electron renderer/main boundary.
- Prefer least-privilege permissions in GitHub Actions.
- Do not log sensitive prompts, credentials, or provider responses in production diagnostics.
