# Mistral free-account validation and ContextHalo choices

Tested October 13, 2026 on Windows x64. This supersedes the earlier recommendation to evaluate Small 4 first. Published model benchmarks did not establish access on this account; the live requests below do.

## Finding and public reproductions

The same configured Studio credential receives HTTP 429, code `1300`, type `rate_limited` for pinned `mistral-small-2603`, including a minimal nonstreamed request. Its response explicitly reports `x-ratelimit-limit-req-minute: 0` and zero remaining requests. Admin still shows a Free subscription, unused included allowance and PAYG disabled. These observations establish the enforced zero request allowance for this model/key at test time. They do not establish why Mistral assigned it or when it will change.

Other developers reproduced the same pattern. An [October 11 OmniRoute discussion](https://github.com/diegosouzapw/OmniRoute/discussions/16252) includes direct calls: Small returns 429/1300 while `ministral-8b-2512` returns a successful completion with the same credential. The author's [independent model-access audit](https://nachtigall.dev/en/writing/mistral-vibe-devex-audit) likewise distinguishes displayed Admin allowances, model discovery and actual runtime access. These are first-hand reports, not an official explanation or evidence that every free organization is affected.

The working remedy verified here is to **explicitly select a callable Ministral model**. No subscription, payment, spending cap, privacy setting or credential was changed. Enabling billing is not a demonstrated necessary fix. If Small itself is required, send Mistral support the selected model, public minimal reproduction, time, zero-limit header and correlation ID privately; never send an API key. Waiting or shortening prompts cannot overcome a currently enforced zero RPM allowance.

Mistral's [subscription documentation](https://docs.mistral.ai/admin/billing-usage/subscriptions) still describes Free mode and included monthly usage. This evidence does not support claiming the whole free API has disappeared. Access remains account/model dependent.

## Live request results

First, call the official chat endpoint directly with minimal nonstreamed requests, then streamed text and a synthetic JPEG. Second, repeat streamed text and vision using the modified production `streamMistral` function, its real payloads, deadline handling, pacing, SSE parser and failure classifier.

The text prompt asks for three incremental-pipeline checks. The image contains the six-digit code `731528`, a blue square on the left and a red circle on the right. A pass requires all expected fields and correct code/colors/shapes; nested shape objects and Markdown JSON fences are accepted. No real screen, private history or user document is sent. These are small functional checks, not a general reasoning or OCR benchmark.

| Pinned model | Direct access | Production streamed text | Production synthetic screenshot | First text / total text | First text / total screen |
| --- | --- | --- | --- | --- | --- |
| `ministral-8b-2512` | HTTP 200 | Pass | Pass | 397 / 1,021 ms | 496 / 1,075 ms |
| `ministral-14b-2512` | HTTP 200 | Pass | Pass | 564 / 2,349 ms | 852 / 2,298 ms |
| `ministral-3b-2512` | HTTP 200 | Pass | Pass | 377 / 886 ms | 570 / 859 ms |
| `mistral-small-2603` | HTTP 429, zero RPM | Blocked; exactly one attempt | Not repeated after confirmed access block | No output | No output |

Each successful production operation made exactly one request and completed normally. Times include application pacing and vary between runs. Each Ministral also passed the earlier direct streamed text/image checks. The initial 3B/8B minimal prompts returned extra words rather than an exact `OK`; those responses still establish HTTP 200 access. Do not label an overly strict exact-string grade as an access failure. Nothing here guarantees future availability or free access on another account.

Official contracts checked before implementation: [Ministral 3 8B](https://docs.mistral.ai/models/ministral-3-8b-25-12), [14B](https://docs.mistral.ai/models/ministral-3-14b-25-12), [3B](https://docs.mistral.ai/models/ministral-3-3b-25-12), [vision messages](https://docs.mistral.ai/studio/conversations/vision), [chat API](https://docs.mistral.ai/api/endpoint/chat), and [Small reasoning controls](https://docs.mistral.ai/studio/conversations/reasoning). All three Ministral choices support text and images. Only Small sends `reasoning_effort: 'none'`.

## What the app should offer for free use

| Option | Product recommendation | Cost and validation boundary |
| --- | --- | --- |
| Mistral + Ministral 3 8B | Recommended text/screenshots choice in the Mistral picker; 14B and 3B remain explicit alternatives | Live verified on this Free account with PAYG disabled. Included usage and effective limits still apply. |
| Groq | Keep the existing separate provider for transcription, text and screenshots; retain the current default provider | [Groq documents Free plan limits](https://console.groq.com/docs/rate-limits). Live Groq inference was not repeated in this investigation. It is capped, not an unlimited shared service. |
| Local AI | Keep the existing on-device option for users who want no per-request provider bill | Uses local hardware and model downloads. No newly downloaded model or physical Local AI session was tested here; existing acceptance gates still apply. |
| Gemini | Keep as an explicitly selected alternative for supported models/features | [Free eligibility and limits vary](https://ai.google.dev/gemini-api/docs/rate-limits); [pricing and data handling differ by tier](https://ai.google.dev/gemini-api/docs/pricing). Do not promise every feature is free. No live Gemini call was made here. |

Use each user's own securely stored provider key. A key distributed inside a desktop executable cannot be kept secret. Do not ship a common developer key or silently send a failed request to another provider. Avoid adding another hosted dependency while an existing integration already solves the demonstrated failure.

## Implementation and verification

- Shared pinned-model allowlist drives the main-process policy and renderer picker. Fresh configuration defaults the Mistral model to 8B; legacy installations retain Small. The existing overall Groq default is unchanged.
- Explicit selections persist through validated IPC and stay pinned for the session. The picker is disabled while starting or active. Unknown model values are rejected before inference.
- Text/screenshots and retries share cancellable start pacing: 2.2 seconds for 14B and one second for the other options. This conservative app-local policy cannot coordinate other applications or enforce token/monthly budgets.
- Only allowlisted nonnegative integer rate headers reach diagnostics. Confirmed zero RPM suppresses automatic retries and gives a model-access explanation; a missing retry delay stays unknown. Private error bodies and credentials remain excluded.
- `npm run check`: 151 JavaScript files passed. `npm test`: 464 passed, zero failures/skips/cancellations.
- Actual source Electron 44.7.0 sandboxed renderer: 92 behavior, 101 keyboard and 10 accessibility checks; zero renderer errors. Checks cover picker persistence/locking and visible zero-limit diagnostics through the real preload/IPC boundary.

Live evidence is retained only in ignored `.cache/mistral-free-model-results.json` and `.cache/mistral-production-results.json`; runtime evidence is in `.cache/mistral-free-source/`. Credentials are decrypted only in memory for the authorized probes. Public documentation excludes account identity, credential suffixes, correlation IDs and private billing values.

The isolated encrypted probe profile was removed after testing; the original application profile and stored credential file were left unchanged.

## Portable artifact

`npm run build:portable -- --publish never` succeeded. The newly built portable EXE passed actual sandboxed renderer launches at Chromium scale factors 100%, 125%, 150% and 200%. Every launch passed 92 behavior, 101 keyboard and 10 accessibility checks, with zero renderer errors. These scale checks do not establish physical Windows DPI acceptance.

All 78 packaged application JavaScript/JSON files matched the workspace bytes, including the shared Mistral model policy. Executable fuses preserve disabled RunAsNode, Node options and inspect arguments, and enabled cookie encryption, embedded ASAR integrity and ASAR-only loading.

- Artifact: `dist/ContextHalo-Windows-x64.exe`, version 0.8.0, **110,576,764 bytes**.
- SHA-256: `1091ed54080d0e781ca3b4339995e5eddc91dc3fc36d90d668bbe203e7b1513c`, also recorded in ignored `dist/SHA256SUMS.txt`.
- Build and verification evidence: ignored `.cache/mistral-free-build.log`, `mistral-free-portable-matrix.json`, four `mistral-free-portable-*/` directories, `mistral-free-asar-match.json`, `mistral-free-fuses.json` and `mistral-free-artifact.json`.

The artifact supersedes the earlier October 13 diagnostic build. It is unsigned, uncommitted and unpublished; no release tag/commit metadata was added. These checks do not replace physical microphone/system-audio, long-session, signing or release acceptance. Close the running older app before opening the replacement EXE, then explicitly choose Ministral 3 8B in Home for an existing installation.
