# Mistral 429 troubleshooting and repair

Date: October 13, 2026. Target: ContextHalo on Windows x64. This guide covers public provider guidance, application behavior and controlled validation.

## Interpreting a 429

A 429 does not by itself identify the enforced rate/usage limit or its reset time. Inspect the model's request/token limits, included monthly usage and organization/workspace caps privately in Mistral Admin. A saved Studio API key or a listed model does not establish working inference access. Preserve a supplied `Retry-After`; if it is absent, report the reset time as unknown. Published benchmark speeds do not establish free-account availability.

When diagnosing a persistent failure, compare one short, public text prompt through the documented chat endpoint with the application's request path, using the selected model and a securely configured credential. Omit application history, screenshots, streaming and retries in that control request. This can distinguish a provider/account rejection from prompt construction or stream handling; it does not establish which account restriction was enforced. Keep account-specific findings and identifiers out of public bug reports.

## Official documentation checked

- [Usage and limits](https://docs.mistral.ai/admin/billing-usage/usage-limits): completion limits are per model and organization; organization/workspace caps can also restrict access. Free mode supports API keys and included usage within the shown limits. Pay-as-you-go extends usage beyond the included allowance. The usage Admin API is Enterprise-only, so a standard Studio key is not used to query it.
- [Rate-limit guidance](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them): request, token-throughput and monthly limits are distinct. API/Studio keys and Vibe Code plan keys have different budget behavior. A generic 429 does not establish that enabling payment will resolve it.
- [Error glossary](https://docs.mistral.ai/resources/error-glossary): error JSON may provide a diagnostic code/type; transient failures use bounded backoff. Preserve only recognized codes/types and avoid inferring a more specific cause than the response establishes.
- [Pinned Small 4 contract](https://docs.mistral.ai/models/mistral-small-4-0-26-03): retain explicit selection of the supported text/vision model. A generic 429 does not establish that model migration or Labs activation is needed.

## Application repairs

1. Conservatively space Mistral request starts by at least one second across text, screenshots and retries. Waiting honors cancellation and existing request deadlines; a cancelled waiter reserves no future slot. Responses can still stream concurrently. This app-local policy does not enforce account token budgets, discover an account's actual request limit or coordinate other applications/instances.
2. Retain only allowlisted provider codes/types from error bodies read within one second and 16 KiB. Malformed, oversized or stalled bodies retain the HTTP status and supplied retry delay. Raw provider messages, prompts and credentials never enter UI diagnostics.
3. Classify 429 as `rate-or-quota`, preserve a missing retry delay as unknown and keep at most one retry before output. Session details links [Mistral Admin Limits](https://admin.mistral.ai/plateforme/limits), displays safe code/type metadata and uses a Mistral-specific Search explanation.
4. Explain that saving a key does not confirm working inference access. Provider/model selection remains explicit, and Mistral audio stays disabled.

## Validation

| Check | Result |
| --- | --- |
| Source validation | `npm run check`: 151 JavaScript files passed. |
| Complete regression suite | `npm test`: **459 passed**, zero failures, cancellations or skips. The focused Mistral/setup suite passed 28 tests. |
| Actual source Electron renderer | Sandboxed preload on Windows x64: **89 behavior, 101 keyboard and 10 accessibility checks**, zero renderer errors. The actual Mistral recovery button, diagnostic metadata and Search caption passed controlled-fixture checks. |
| Portable Windows build | `npm run build:portable -- --publish never` succeeded. The resulting EXE passed launches at Chromium scale factors 100%, 125%, 150% and 200%, with the same 89/101/10 checks and zero renderer errors per launch. Each run completed three reliability samples with zero fatal events. These are short runtime checks, not physical DPI or long-session acceptance. |
| Packaged source and security | All **77** packaged application JavaScript files match the workspace bytes. Executable fuse values preserve disabled RunAsNode/Node options/inspect arguments, enabled cookie encryption/ASAR integrity and ASAR-only loading. |

Focused regressions cover concurrent text/screen start spacing, retry spacing, cancellation without reserved slots, bounded malformed/oversized/stalled error bodies, private-body exclusion and safe diagnostics reaching both IPC request lanes without successful history writes. Renderer checks use controlled responses and do not establish live account access.

The replacement local artifact is `dist/ContextHalo-Windows-x64.exe`, version **0.8.0**, **110,574,867 bytes**, SHA-256 **`858092f178dd243dbae43eecee390565ae4b5f607d63f596490a4de28fc6963f`**, also recorded in ignored `dist/SHA256SUMS.txt`. It supersedes the October 12 local artifact for this repair. It is unsigned and has no published release tag or commit metadata; it is not committed to Git.

Local application-validation evidence is under ignored `.cache/`: `mistral-429-check.log`, `mistral-429-tests.log`, `mistral-429-source/`, `mistral-429-build.log`, `mistral-429-portable-matrix.json`, the four `mistral-429-portable-*/` directories, `mistral-429-asar-match.json`, `mistral-429-fuses.json` and `mistral-429-artifact.json`. Account-specific diagnostics, identities, key suffixes, private billing amounts and credentials are excluded from tracked documentation.

## Remaining acceptance and support

Live text and screenshot success requires separate account acceptance. For a persistent limit response inconsistent with the account's privately reviewed Admin pages, contact [Mistral support](https://help.mistral.ai/) through a private channel to identify the enforced restriction and reset or corrective action. Include the endpoint, selected model, public reproduction and sanitized response metadata. Never include an API key or private prompt. Do not assume that payment, a model switch or a privacy-setting change will resolve an unidentified restriction.

Published benchmark speeds and successful mocked/packaged checks do not establish live account availability. Existing provider and physical-device/long-session acceptance limits remain recorded in the [implementation plan](PROVIDER_IMPLEMENTATION_PLAN_2026-10-12.md) and [October 12 recheck](PROVIDER_DEEP_RECHECK_2026-10-12.md).
