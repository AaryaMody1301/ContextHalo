# Final closure audit — 2026-09-22

## Purpose

This closure pass follows merged Phase 10 on `main` at `722df9e8f9ff045943b3dfc310a499078307fffe` and the successful public release `v0.8.0-portable.385`.

The final release pipeline completed successfully:

- production npm audit: 0 vulnerabilities;
- 128 JavaScript files validated;
- 325 tests passed / 0 failed;
- real Electron smoke passed;
- portable EXE build/checksum passed;
- measured Authenticode state: `NotSigned`;
- packaged launches passed at 100%, 125%, 150%, and 200% scale;
- artifact attestation passed;
- release publication passed.

Release artifact SHA-256:

`ee9d56489b09a0626ccf69902a8757e685e50ef1151d99dcb2a3f0a8e2f0ac6d`

## Historical branch disposition

The repository maintenance workflow normally deletes only ancestry-proven merged branches. Six old branches still contain unique commits, so they were intentionally retained until this explicit review.

Each branch below is now classified as superseded. Deletion is SHA-pinned: maintenance may delete it only while the branch still points to the exact reviewed SHA. A new push changes the SHA and automatically prevents deletion.

| Branch | Audited SHA | Disposition |
| --- | --- | --- |
| `audit/final-repo-readiness-2026-09-13` | `bc78353799d2e75d427e478e13f835110615731a` | superseded by the later Lit 3/provenance/release-readiness phases |
| `cleanup/ponytail-windows-only` | `73d0edd50ad6404ada9341494a6fb74e981b1815` | superseded by the later architecture/runtime cleanup and renderer-boundary work |
| `final-api-ui-audit-20260913` | `763ec5f2ed02f4d23ef4880868e3dae4b79b94d5` | superseded by Phases 2–6 and the current final contract/security tests |
| `fix/final-api-runtime-hardening` | `04ebee29fa905107882b68fbb11f2dc0f2d8d020` | superseded by the later API, cancellation, capture, runtime and Local AI hardening now present on main |
| `fix/gemini-screen-reliability` | `a72f2e09224312653e0da01b74c05e8642a07660` | superseded by the current screen timeout layering and Settings recovery behavior/tests on main |
| `fix/ws-8.21.3-security` | `09ab0d743069b9f94f46b77b0ab5f39989597c6a` | obsolete direct-dependency proposal; current main has no direct `ws` dependency and production audit is clean |

The maintenance workflow continues to preserve:

- the default branch;
- protected branches;
- the currently executing branch;
- branches with open pull requests;
- any superseded branch whose SHA no longer matches the reviewed value;
- any other branch containing unmerged work.

## Repository state after Phase 10

At closure review time:

- open pull requests: 0;
- open issues: 0;
- current public release: `v0.8.0-portable.385`;
- release target: `722df9e8f9ff045943b3dfc310a499078307fffe`;
- current release immutable flag: `false`;
- repository rulesets: none;
- all 14 Phase 9 physical scenarios: `not-run`.

## Remaining external work

Repository/code work is complete once this branch cleanup lands.

Three external gates remain and cannot be performed by the currently connected GitHub integration or this CI environment:

1. Enable the Phase 8 `main` ruleset with repository Administration permission.
2. Enable GitHub immutable releases and verify a later release reports `immutable: true`.
3. Execute and record the Phase 9 physical/provider acceptance matrix on representative Windows hardware/accounts.

The repository already contains the admin policy/applicator and the physical acceptance recorder/reporting tools. These items are not code gaps and must not be represented as passed until their real evidence exists.
