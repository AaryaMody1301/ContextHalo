# Phase 5 renderer dependency audit — 2026-09-21

## Baseline and scope

- Repository: `AaryaMody1301/ContextHalo`
- Phase 5 baseline: `main` at `1ad6a40decbfb329d6155e9804fbcb3c81db71d2` after Phase 4 merged
- Main CI at baseline: Windows run #354 passed
- Scope: Lit, Marked, highlight.js, their renderer loading paths, provenance, sanitization boundary, and update ownership
- Out of scope: large component/module refactors (Phase 6), Electron dependency updates, updater/signing, and governance

Machine-readable decisions are recorded in `docs/PHASE_5_RENDERER_DEPENDENCIES.json`.

## Upstream review

### Lit

Current reviewed release: **Lit 3.3.3**.

Official references:

- Lit 3 upgrade guide: https://lit.dev/docs/releases/upgrade/
- Lit single-file bundle guidance: https://lit.dev/docs/v2/getting-started/#use-bundles
- Official distribution repository: https://github.com/lit/dist
- Exact bundle used by ContextHalo: https://github.com/lit/dist/blob/v3.3.3/core/lit-core.min.js

Lit documents very few breaking changes from 2.x to 3.x and states that the vast majority of applications require no code changes. The notable removals affect IE11, deprecated APIs, old decorators and SSR hydration modules.

ContextHalo's renderer imports only `LitElement`, `html` and `css` from the core bundle. It does not use decorators, `UpdatingElement`, SSR hydration modules, custom directives or the removed Lit 2 compatibility APIs.

Decision:

- upgrade the inherited `lit-core-2.7.4.min.js` to the official `lit/dist` **v3.3.3 core bundle**;
- keep the single-file bundle deployment instead of introducing a renderer bundler/import map solely for this dependency;
- verify the committed file is byte-for-byte the official Git blob through its Git blob SHA.

The official bundle repository exists specifically for applications that want a downloaded single-file, dependency-free module rather than npm/build tooling.

## Marked

Current reviewed package: **Marked 18.0.13**.

Official references:

- https://www.npmjs.com/package/marked
- https://marked.js.org/
- https://github.com/markedjs/marked

Marked 18.0.13 has zero runtime dependencies and its published package exposes `lib/marked.umd.js` as the browser build. ContextHalo previously carried an opaque copy of Marked 4.3.0 under `src/assets`.

Decision:

- upgrade to Marked 18.0.13;
- manage it as an exact production npm dependency rather than another hand-copied renderer file;
- load `../node_modules/marked/lib/marked.umd.js` locally from `src/index.html`;
- record the npm tarball URL and integrity in `package-lock.json` and `docs/THIRD_PARTY_PROVENANCE.json`;
- let the existing npm Dependabot configuration cover future Marked updates.

This does not make Marked trusted HTML. Marked's own documentation explicitly warns that it does **not** sanitize output.

ContextHalo therefore preserves the existing renderer chain:

`markdown text -> window.marked.parse(...) -> sanitizeAssistantHtml(...) -> rendered response`

The allowlist sanitizer drops script/style/iframe/object/embed/form/input/button/textarea/select/option/meta/link/base/SVG/MathML/template content, strips unsupported/event/style attributes, restricts links to credential-free HTTP(S), and adds `noopener noreferrer`.

The real Electron behavior smoke already sends hostile HTML containing a script tag, event handlers, SVG and a `javascript:` link through the response renderer and requires the unsafe nodes/attributes to be absent while safe markup remains.

## highlight.js

Current upstream release reviewed: **11.12.0**.

Official reference:

- https://highlightjs.org/

The baseline shipped highlight.js 11.9.0 plus a theme, but repository-wide runtime inspection found no `hljs.*`, `highlightAll()`, `highlightElement()` or equivalent invocation. Marked also does not automatically invoke highlight.js.

Assistant response CSS already provides readable `pre` and `code` styling independent of highlight.js.

Decision:

- **remove highlight.js instead of upgrading it**;
- remove both the unused JavaScript bundle and theme stylesheet;
- remove their `index.html` loads and current-distribution provenance entries;
- retain the Phase 0/Phase 1 records as historical evidence of the pre-Phase-5 baseline.

This removes roughly 120 KB of unused JavaScript plus the unused theme from the tracked renderer surface.

## Retired baseline assets

The following Phase 1 baseline paths are explicitly retired by this audit:

- `src/assets/lit-core-2.7.4.min.js`
- `src/assets/marked-4.3.0.min.js`
- `src/assets/highlight-11.9.0.min.js`
- `src/assets/highlight-vscode-dark.min.css`

The Phase 1 inventory remains immutable historical evidence. Its regression test now requires every baseline path to either still exist or appear in the explicit Phase 5 retirement list; it does not weaken the deletion guard for arbitrary files.

## Dependency ownership after Phase 5

| Component | Version | Ownership | Update path |
| --- | --- | --- | --- |
| Lit | 3.3.3 | One official vendored `lit/dist` bundle | explicit reviewed bundle replacement + provenance/test update |
| Marked | 18.0.13 | production npm dependency | package-lock + npm Dependabot |
| highlight.js | removed | none | add again only if a real syntax-highlighting feature is implemented and tested |

`docs/THIRD_PARTY_PROVENANCE.json` is regenerated from the production lockfile for npm packages and now contains only Lit under `vendoredRenderer`.

## Validation contracts

Phase 5 adds `tests/renderer-dependencies.test.js`, which verifies:

- the Lit bundle's Git blob SHA matches the official `lit/dist` v3.3.3 blob;
- no runtime JavaScript imports the old Lit 2.7.4 path;
- Marked 18.0.13 is exact in both package manifest and lockfile;
- the installed Marked package/browser UMD file exists after `npm ci`;
- GFM tables and `breaks:true` still behave through the actual installed Marked API;
- the response renderer still wraps Marked output in `sanitizeAssistantHtml`;
- old Lit/Marked/highlight assets are absent and explicitly retired;
- no highlight.js runtime call remains.

Existing Windows CI additionally proves:

- lockfile synchronization and production install/audit;
- source syntax;
- all regression tests;
- the real sandboxed Electron renderer (therefore the Lit 3 module and Marked 18 browser file);
- the hostile-response sanitizer smoke;
- portable packaging, checksum and packaged launches at 100/125/150/200% Chromium scale.

## Phase 5 exit criteria

Phase 5 is complete when CI confirms:

- every remaining renderer dependency has a current owner and provenance path;
- the stale Lit 2 bundle is replaced by the exact official Lit 3.3.3 core bundle;
- Marked is current and lockfile-managed rather than manually vendored;
- Marked output remains behind the tested sanitizer boundary;
- unused highlight.js code/theme are absent;
- no behavior/layout/package regression appears in the real Windows pipeline.

No architecture split or component redesign belongs in this phase.
