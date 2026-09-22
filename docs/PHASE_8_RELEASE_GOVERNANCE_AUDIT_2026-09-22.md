# Phase 8 Release and Repository Governance Audit — 2026-09-22

## Baseline

Phase 8 starts from merged Phase 7 `main` at `f03d08aa724c13d760835594e7d64c5638929c0b`.

Verified repository state at phase start:

- repository: `AaryaMody1301/ContextHalo`
- default branch: `main`
- repository rulesets: none
- latest release: `v0.8.0-portable.371`
- latest release target: `f03d08aa724c13d760835594e7d64c5638929c0b`
- latest release immutable flag: `false`
- latest release assets: portable EXE + SHA256SUMS.txt with GitHub SHA-256 digests
- the Phase 7 merge commit is GitHub-verified/signed

The connected GitHub integration can read rulesets but does not expose repository Administration writes. GitHub requires repository `Administration: write` permission to create/update repository rulesets and to enable immutable releases, so those settings cannot be applied by ordinary Actions `GITHUB_TOKEN` or by this repository's normal CI workflow.

## Upstream governance references

GitHub rulesets can enforce pull requests, required status checks, signed commits, deletion protection and non-fast-forward protection:

- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- https://docs.github.com/en/rest/repos/rules

Immutable releases lock the release tag and assets after publication and automatically generate a release attestation:

- https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases
- https://docs.github.com/en/rest/repos/repos#enable-immutable-releases

GitHub artifact attestations bind released binaries to workflow/repository/commit provenance using Sigstore:

- https://docs.github.com/en/actions/concepts/security/artifact-attestations
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations

## Main-branch governance policy

`docs/PHASE_8_REPOSITORY_GOVERNANCE.json` is the machine-readable source of truth.

The desired active ruleset is `Protect main`, targeting the default branch with:

- deletion protection;
- non-fast-forward protection (no force pushes);
- pull requests required before changes enter `main`;
- no mandatory external approval count, because this is currently a solo-maintainer repository;
- review-thread resolution required;
- only GitHub merge/squash methods allowed by the ruleset; rebase is excluded to keep the main history on GitHub-created merge/squash commits;
- required status check: `Build ContextHalo Windows x64 EXE`;
- strict status-check policy so the tested commit must include current `main`.

No bypass actor is encoded in the desired ruleset.

### Signed-commit enforcement decision

The Phase 7 `main` merge commit is GitHub-signed and verified, but the ordinary feature-branch commits produced by the repository tooling are currently unsigned. GitHub checks commits introduced from the PR head when a signed-commit protection applies; its documentation explicitly notes that unsigned head commits can block even a squash merge although GitHub would sign the final squash commit.

Therefore Phase 8 does **not** activate `required_signatures` yet. Doing so now would make the current PR workflow self-blocking.

Signed-commit enforcement becomes eligible only after every supported PR authoring path produces verified head commits (or a deliberately reviewed bypass model exists). At that point it can be introduced in its own governance change with a live test PR.

Reference:

- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-signed-commits

## Administrative application

The repository includes `scripts/repository-governance.js` as an explicit, idempotent admin tool. It does not use `GITHUB_TOKEN` and is not invoked by any workflow.

Audit:

```bash
GH_ADMIN_TOKEN=<fine-grained-token-with-Administration> node scripts/repository-governance.js --audit
```

Apply:

```bash
GH_ADMIN_TOKEN=<fine-grained-token-with-Administration> node scripts/repository-governance.js --apply
```

The token must be provided only through the process environment and must not be committed, printed, stored in repository variables, or added to application configuration.

The apply mode:

1. creates or updates only the named `Protect main` repository ruleset;
2. enables repository immutable releases if not already enabled;
3. re-reads both settings and fails unless the effective state exactly matches the policy;
4. writes a non-secret report to `qa-results/repository-governance.json`.

## Release-version alignment

Before Phase 8, the release tag changed per CI build while Electron's application version remained the base `0.8.0`.

Phase 8 keeps `package.json` as the source release line but writes the exact portable SemVer into the packaged metadata with electron-builder `extraMetadata.version`:

- source line: `0.8.0`
- example packaged application version: `0.8.0-portable.372`
- corresponding release tag: `v0.8.0-portable.372`

The same workflow step derives:

- base release version;
- exact packaged app version;
- release tag;
- build number;
- workflow commit.

The packaged Windows smoke now rejects any mismatch among `app.getVersion()`, release tag and release commit. The update reader accepts both the Phase 7 legacy form (base app version plus embedded release tag) and the new exact packaged version so users can move forward from existing portable releases.

## Build provenance attestations

The Windows workflow pins `actions/attest` v4.2.2 at commit:

`1e69f48acb82d1966a394da916b4c1698aa569d6`

Attestation runs in a separate `attest-release` job only on successful pushes to `main`. PR build jobs keep `contents: read` only and do not receive OIDC or attestation write permissions. The attestation job downloads the exact already-validated `ContextHalo-Windows-x64-Portable` artifact and must succeed before release publication.

The exact portable EXE is attested only after the build job has:

- passed all Node regression tests;
- passed the real Electron smoke;
- been packaged;
- had its SHA-256 checksum recorded;
- passed all four packaged scale launches and embedded-provenance checks.

Subjects after downloading the validated Actions artifact:

- `release/ContextHalo-Windows-x64.exe`
- `release/SHA256SUMS.txt`

PR/test-only builds are not attested. The attestation job alone receives `id-token: write`, `attestations: write`, and `artifact-metadata: write`; this matches the pinned action's documented v4.2.2 permission requirements.

Consumers can verify a downloaded executable with:

```bash
gh attestation verify ContextHalo-Windows-x64.exe --repo AaryaMody1301/ContextHalo
```

## Release publication and immutability compatibility

The pinned `softprops/action-gh-release` v3.0.3 implementation already creates normal releases as drafts, uploads assets, and only then finalizes the release. This is compatible with GitHub's immutable-release best practice because published immutable releases reject later asset mutation.

After publishing, the workflow verifies:

- target commit equals the workflow commit;
- exactly one portable EXE exists;
- exactly one checksum file exists;
- both assets report uploaded state;
- both assets expose SHA-256 digests.

Until the repository-level immutable release setting is applied, the workflow emits a warning rather than claiming immutability.

Repository maintenance already excludes `release.immutable === true` releases from automatic obsolete-release deletion. Future immutable releases therefore remain retained.

## electron-builder 27 evaluation

Current repository dependency: `electron-builder ^26.15.3`.

Current upstream major: v27.

The repository's Node floor is compatible with v27, but v27 is not a routine patch upgrade. Its documented changes include:

- native ESM across the builder ecosystem;
- minimum Node 22.12;
- removed/deprecated configuration APIs;
- explicit publishing behavior changes;
- a migration command (`electron-builder migrate-schema`);
- new default toolset resolution where unset toolsets resolve to `"latest"`.

That last change is particularly relevant after ContextHalo's supply-chain hardening: silently moving Windows signing/build tool bundles would weaken reproducibility unless the effective toolsets are intentionally pinned and validated.

Decision: **do not mix electron-builder 27 into Phase 8 governance changes.** A later build-system-only PR may evaluate it by:

1. running `electron-builder migrate-schema --dry-run`;
2. recording every schema/default difference;
3. deciding/pinning toolsets explicitly;
4. rebuilding the portable EXE from the same source;
5. comparing packaged file inventory and Electron fuses;
6. running the complete Windows smoke/scale matrix;
7. comparing artifact metadata and checksums;
8. changing no application/provider behavior in that PR.

References:

- https://www.electron.build/docs/migration/v27-breaking-changes/
- https://www.electron.build/docs/migration/v26-to-v27/
- https://www.electron.build/docs/migration/whats-new-v27/

## Phase 8 exit criteria

Repository-side Phase 8 code is ready when:

- the governance manifest and tests pass;
- signed-commit enforcement remains disabled until PR head commits are verifiably signed;
- the Windows required-check name is stable and matches the desired ruleset;
- packaged version/tag/commit are identical representations of one release identity;
- release artifacts receive GitHub provenance attestations on `main`;
- published release target/assets are re-verified;
- immutable releases remain compatible with the publication and retention workflows;
- electron-builder 27 remains outside this governance diff;
- the full Windows build/runtime/package matrix passes.

The repository itself is fully governed only after the admin policy reports `compliant: true`, which requires the `Protect main` ruleset and immutable releases to be enabled with repository Administration permission.
