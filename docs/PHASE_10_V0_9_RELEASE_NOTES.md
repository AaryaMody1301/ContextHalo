# ContextHalo v0.9 for Windows x64

- Analyze Screen can use the decoded frame from a static window. Canceled requests preserve the draft, and recovery shows the stage that failed.
- Gemini 4 Hydrogen is available when the account lists it. Mistral reports HTTP 402 as a billing rejection.
- Local AI ships updated checksum-pinned CPU and Vulkan runners. The renderer treats raw provider HTML as text and renders standard Markdown formatting.
- Portable releases bind the tested EXE and checksum file to a Git commit. The release check resolves the tag and compares both downloaded files with their build hashes.

## Verification

The **ContextHalo-Windows-x64-Portable** artifact from the successful `main` workflow contains `release-candidate.json`. It records the candidate commit, workflow run, test totals, four packaged Chromium scale results, Authenticode status and SHA-256 of both public assets. The 14 physical Phase 9 scenarios are marked **skipped** for v0.9 by agreement. See the historical Phase 9 results in [PR #112](https://github.com/AaryaMody1301/ContextHalo/pull/112) and the [Phase 9 follow-up](https://github.com/AaryaMody1301/ContextHalo/blob/e31cfbb0de321f11d4fd2a6f135143a1ff6134ba/docs/PHASE_9_ACCEPTANCE_FOLLOWUP_2026-11-26.json).

During the earlier saved-key retest in PR #113, Gemini returned HTTP 503 on all three attempts and Mistral returned HTTP 402. Neither provider produced a hosted answer. The v0.9 workflow exercises synthetic provider fixtures and packaged startup. [PR #113 and its provider evidence](https://github.com/AaryaMody1301/ContextHalo/pull/113).

## Publish and verify

After approval, open the Windows workflow on `main`, enable `publish`, and enter the successful candidate workflow run ID as `candidate_run_id`. The candidate must match the selected `main` commit. The workflow downloads and verifies the same artifact for attestation and publication. [Build ContextHalo Windows Portable EXE](https://github.com/AaryaMody1301/ContextHalo/actions/workflows/build-windows.yml).

Extract `release-candidate.json` from that Actions artifact and verify the public release from a checkout containing the release verifier.

```powershell
node scripts/verify-windows-release.js verify .\release-candidate.json
```
