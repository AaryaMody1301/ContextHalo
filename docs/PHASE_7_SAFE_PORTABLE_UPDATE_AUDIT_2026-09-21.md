# Phase 7 Safe Portable Update Audit — 2026-09-21

## Baseline

Phase 7 starts from merged Phase 6 `main` at `d1ecd0acb3299bcf08add374ed97be2233a7e2c9`.

At the start of this audit, the latest official ContextHalo release was `v0.8.0-portable.367`, targeting that Phase 6 merge commit and publishing both `ContextHalo-Windows-x64.exe` and `SHA256SUMS.txt` with GitHub-provided SHA-256 asset digests.

## Upstream constraints

The current product is an electron-builder Windows `portable` target.

Current electron-builder documentation classifies Windows portable distribution as manual update and lists NSIS as the Windows target supported by `electron-updater`:

- https://www.electron.build/v26/docs/targets/
- https://www.electron.build/v26/docs/features/auto-update/
- https://www.electron.build/v26/docs/win/

Electron's `app.getVersion()` reports the package version, so the previous static `0.8.0` value could not distinguish portable build 357 from 367:

- https://www.electronjs.org/docs/latest/api/app#appgetversion

electron-builder supports build-time `extraMetadata`, which Phase 7 uses to embed CI provenance without changing the source package version:

- https://www.electron.build/docs/configuration/

For a future installer auto-update channel, Windows signing must be treated as a prerequisite rather than disabled around. electron-builder's Windows update signature verification defaults to enabled for the supported NSIS updater path. Microsoft recommends trusted code signing for direct EXE distribution and notes that unsigned releases cannot carry publisher reputation forward:

- https://www.electron.build/v26/docs/win/
- https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation

## Phase 7 decision

Do not add `electron-updater`, Electron `autoUpdater`, an unsigned installer, or self-replacing portable executable.

The current safe update architecture is notification-only:

1. CI derives the release version from `package.json`.
2. CI creates one release tag `v<version>-portable.<run_number>`.
3. The same tag, run number and commit SHA are embedded into the packaged app through electron-builder `extraMetadata`.
4. Packaged smoke tests read that metadata back from the exact EXE and reject a mismatch.
5. At normal packaged startup, main-process `updateMain.js` queries only the fixed official GitHub Releases API endpoint.
6. The response is bounded and must describe a non-draft/non-prerelease tag matching ContextHalo's portable-tag grammar.
7. The release must target an immutable 40-character commit SHA and contain exactly one expected portable EXE plus one checksum asset with sane sizes and GitHub SHA-256 digests.
8. Renderer code receives only sanitized release metadata and a canonical official release-page URL.
9. The existing external-link boundary opens that official page in the system browser when the user chooses **Update available**.
10. No update code downloads, writes, replaces, launches or executes the new EXE.

## Trust-boundary changes

Phase 7 adds one renderer-to-main capability:

- `updates:check`

It is main-window/main-frame only and takes no renderer-controlled URL or path argument.

The Phase 3 trust inventory is updated with:
- `updates:check` under `src/index.js#setupGeneralIpcHandlers`;
- `api.github.com` as the fixed read-only update-metadata destination.

No main-to-renderer event or filesystem capability is added.

## Failure behavior

Update checks fail closed.

- Development/source runs do not contact GitHub.
- CI smoke runs do not contact GitHub.
- Packaged builds without matching embedded provenance do not contact GitHub.
- Non-Windows/non-x64 runs do not contact GitHub.
- HTTP errors, oversized responses, malformed JSON, invalid tags, mutable targets, missing/duplicate assets, suspicious sizes or missing digests return one generic unavailable state.
- Remote error bodies, arbitrary URLs and provider-supplied executable paths are never exposed to the renderer.
- Update-check failure never blocks startup, sessions, provider use, storage or Local AI.

## Release provenance

The Windows workflow now resolves the numeric semantic version directly from `package.json` and emits it as job output. The exact same derived tag is used for:

- `extraMetadata.releaseTag` in the EXE;
- the packaged-smoke expected tag;
- the GitHub Release `tag_name`.

The packaged app also embeds:
- `releaseBuild = github.run_number`;
- `releaseCommit = github.sha`.

This removes the former hardcoded `0.8.0` release-tag coupling.

## Future automatic-update gate

A future installer auto-update phase may evaluate signed NSIS or Microsoft Store/MSIX distribution, but it must not be enabled until all of these are true:

- a stable trusted Windows signing identity is available;
- CI fails rather than publishing an unsigned installer;
- the installed-app migration from portable distribution is explicitly tested;
- electron-updater signature validation remains enabled;
- update metadata and rollback behavior are tested;
- existing portable users retain a documented manual migration path;
- SmartScreen/signing behavior is validated on representative Windows systems.

Until then, the portable/manual replacement model is the supported update path.

## Validation required for Phase 7 exit

- syntax validation for source/tests/scripts/preload;
- full Node regression suite including update parser/trust/fail-closed tests;
- source Electron behavior/layout smoke with no update network traffic;
- portable EXE build with embedded release tag/build/commit;
- packaged smoke verifies embedded tag and commit at 100%, 125%, 150% and 200% Chromium scale;
- normal package/release artifact checksum generation remains unchanged;
- PR is not merged automatically.
