# Phase 3 Electron security and trust-boundary audit — 2026-09-21

## Baseline and scope

- Repository: `AaryaMody1301/ContextHalo`
- Phase 3 baseline: `main` at `8c145a768a0c460893d42e7d4fa153f7294c5f0c` after Phase 2 merged
- Product target: Windows 10/11 x64
- Current package lock: Electron 44.3.0
- Current stable Electron observed during this audit: 44.4.3 (released 2026-09-18)
- Detailed machine-readable boundary inventory: `docs/PHASE_3_TRUST_BOUNDARIES.json`

This phase follows the planned security scope: every BrowserWindow, preload, renderer-to-main IPC route, permission, display-capture request, CSP rule, external URL, clipboard read, renderer-controlled path, fuse and credential transition is reviewed. The `file://` replacement is researched but deliberately not implemented until the required compatibility proof exists.

Official references:

- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Session permissions/display capture: https://www.electronjs.org/docs/latest/api/session
- WebContents IPC/frame behavior: https://www.electronjs.org/docs/latest/api/web-contents
- safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- Custom protocols: https://www.electronjs.org/docs/latest/api/protocol
- electron-builder fuses: https://www.electron.build/v26/docs/tutorials/adding-electron-fuses/
- Electron stable releases: https://releases.electronjs.org/?channel=stable

## Concrete Phase 3 repairs

### Renderer/main IPC

The main window already validated `senderFrame` in `src/index.js`, the provider IPC wrapper, Phase 4 handlers, Windows runtime handlers and context-capture invoke handlers.

Two inconsistent paths were repaired:

1. `src/utils/window.js` previously trusted the main WebContents ID but not the exact frame for `view-changed`, `window-minimize` and `toggle-window-visibility`. It now requires `event.senderFrame === mainWindow.webContents.mainFrame`.
2. The region selector used the raw WebContents `ipc-message` event. Electron documents that a WebContents listener can receive IPC from child frames, so selector messages now require the selector's exact main frame.

The unused preload `log-message` send capability had no sender usage and no main-process owner. It was removed instead of carrying dead privilege.

The complete preload invoke/send/subscription inventory is locked by `tests/electron-security-boundary.test.js` against `docs/PHASE_3_TRUST_BOUNDARIES.json`.

### Permission boundary

The default session permits only `media` and `display-capture` for the exact main ContextHalo document.

Permission decisions now require:

- the expected main-window WebContents;
- main-frame status;
- the exact packaged `index.html` URL while `file://` remains in use;
- a compatible opaque `file://` origin serialization for permission checks.

Requests from a child frame, another document, another WebContents, or another permission class are denied. This follows Electron's guidance to use `requestingUrl` / `requestingOrigin` rather than trusting a WebContents alone.

### Display capture

`setDisplayMediaRequestHandler` already required the request's `WebFrameMain` object to be the current main frame. Phase 3 makes that policy explicit in a testable helper and checks it both before and after asynchronous source selection.

The selected source is still owned by main-process capture state. A missing selected display/window is denied rather than silently replaced.

### BrowserWindow configuration

Both application windows retain:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- popup denial
- navigation denial

The main window also retains `allowRunningInsecureContent: false`.

No `<webview>`, `nodeIntegrationInSubFrames`, experimental Blink feature or renderer Electron API exposure is used.

### Content Security Policy

The main CSP no longer permits remote frames from Google Forms/Docs because the runtime contains no corresponding remote iframe.

The remaining main `frame-src 'self'` supports the sanitized `srcdoc` attribution frame without creating a remote-frame allowlist. Scripts remain `'self'` only; objects, base URLs and form submission remain disabled.

The region-selector CSP remains self-only and more restrictive.

### External URLs

All renderer-triggered external navigation is routed through `open-external` in the main process.

Phase 3 centralizes the URL boundary:

- only `http:` and `https:` are accepted;
- URLs containing username/password credentials are rejected;
- malformed, `javascript:`, `file:`, `data:`, `mailto:` and other schemes are rejected;
- accepted links are opened by the OS browser with `shell.openExternal`; they are never loaded into a ContextHalo BrowserWindow.

HTTP remains permitted only for OS-browser external links because provider citations/help targets may legitimately use it. Remote content loaded by ContextHalo itself remains HTTPS/WSS or loopback.

### Clipboard

Electron 44 no longer exposes its privileged clipboard module to renderers. ContextHalo already follows the secure shape: clipboard access lives in the main process and is reachable only through the trusted-frame `context-capture:read-clipboard` IPC route.

Only plain text is returned and it is sanitized/bounded to 20,000 characters. The renderer does not receive a generic clipboard object.

### Renderer-controlled paths

Knowledge-file paths originate from main-process `showOpenDialog`, followed by supported-extension, size and binary checks.

The custom Local AI model feature intentionally accepts an absolute user-selected path. Phase 3 tightens that capability:

- the selected model must have a `.gguf` extension;
- it must be a regular file;
- the paired projector must be one of the recognized `mmproj-BF16.gguf`, `mmproj-F16.gguf` or `mmproj-F32.gguf` names;
- the projector must also be a regular file beside the model.

Repository-based Local AI downloads continue to use a fixed Hugging Face host plus validated owner/repository references.

### Electron fuses

The portable build already sets:

- `runAsNode: false`
- `enableCookieEncryption: true`
- `enableNodeOptionsEnvironmentVariable: false`
- `enableNodeCliInspectArguments: false`
- `enableEmbeddedAsarIntegrityValidation: true`
- `onlyLoadAppFromAsar: true`

`grantFileProtocolExtraPrivileges` is intentionally not disabled yet. electron-builder specifically recommends disabling it only when the application no longer serves pages through `file://`.

## Async safeStorage migration

Phase 3 removes ContextHalo's use of synchronous `safeStorage.isEncryptionAvailable`, `encryptString` and `decryptString`.

Windows credential storage now uses:

- `isAsyncEncryptionAvailable()`
- `encryptStringAsync()`
- `decryptStringAsync()`

The existing on-disk `windows-safe-storage-v1` format is retained. Electron's current source documentation explicitly states that ciphertext written by the earlier synchronous API can be decrypted with `decryptStringAsync`, so current users are migrated in place rather than asked to re-enter keys.

The new flow is:

1. synchronous storage bootstrap loads non-secret preferences/config/history only;
2. after Electron `app.ready`, ContextHalo awaits async credential initialization before creating the main window;
3. old encrypted values are decrypted into a main-process-only in-memory cache;
4. if Electron reports `shouldReEncrypt`, both keys are re-encrypted atomically using the async provider;
5. API-key setters await encrypted persistence before reporting success;
6. if async encryption is temporarily unavailable, an existing encrypted file is left untouched and replacement writes are refused rather than overwriting an unreadable sibling key;
7. renderers continue to receive only credential-presence booleans, never saved keys.

The Windows provider behavior does not change: Gemini/Groq still read their keys only in the main process.

## Network destinations

Runtime network ownership is enumerated in `docs/PHASE_3_TRUST_BOUNDARIES.json`.

The bounded destinations are:

- Gemini Developer API / SDK-owned Live transport under `generativelanguage.googleapis.com`;
- Groq under `api.groq.com`;
- Hugging Face model metadata/downloads under `huggingface.co`;
- checksum-pinned native release downloads under `github.com`;
- Local AI HTTP only on `127.0.0.1` ephemeral ports;
- arbitrary HTTP(S) citations/help links only through the OS browser after main-process URL validation.

No provider credential is placed in a renderer URL or renderer-readable configuration.

## Custom `app://` protocol research

Electron recommends replacing `file://` because Electron grants local files additional privileges. Phase 3 researched the migration but does **not** implement it, as required by the modernization plan.

The safe migration shape is:

1. before `app.ready`, register an `app` scheme with `standard: true`, `secure: true`, and `supportFetchAPI: true`; do **not** grant `bypassCSP`;
2. after ready, install `protocol.handle('app', ...)`;
3. use a single host such as `app://bundle/`;
4. resolve requested paths only beneath the packaged application root using `path.resolve` plus `path.relative` containment checks, rejecting traversal and unexpected hosts;
5. replace both `loadFile` calls with fixed `app://bundle/index.html` / region-selector URLs;
6. update the permission origin policy from opaque `file://` to the exact `app://bundle` origin;
7. prove relative script/style/image/audio-worklet loading, CSP enforcement, sanitized `srcdoc` attribution, region selection, real Electron behavior smoke and packaged 100/125/150/200% launches;
8. only after those gates pass, set the electron-builder `grantFileProtocolExtraPrivileges` fuse to `false`.

Implementing only half of this sequence would risk broken packaged assets or a wider-than-intended protocol handler, so the scheme migration remains a separate security change.

## Electron version checklist item

Electron's stable channel is currently 44.4.3 while ContextHalo is locked to 44.3.0.

Phase 3 does not silently edit the package lock while also changing IPC, permissions and credential persistence. The 44.4.3 same-major update remains a dedicated dependency-only validation change before final release re-audit. Electron 45 is still prerelease and is not a target for this phase.

## Negative tests added

`tests/electron-security-boundary.test.js` proves:

- correct main frame accepted; child/wrong frames rejected;
- unrelated permission type, document and origin rejected;
- region-selector child-frame IPC rejected;
- display-capture child-frame requests rejected;
- unsafe external schemes and credential-bearing URLs rejected;
- both BrowserWindows retain sandbox/isolation/web-security/navigation/popup controls;
- unused remote CSP frame origins stay removed;
- security fuses remain pinned;
- existing sync-safeStorage ciphertext can be read by the async migration fixture and rotated without changing the file format;
- temporary encryption unavailability cannot overwrite the existing encrypted credential file;
- no synchronous safeStorage API remains in storage code;
- preload IPC capabilities exactly match the machine-readable trust inventory;
- custom Local AI paths reject non-GGUF files, directories and missing projectors.

Existing tests continue to cover session-ID validation, knowledge import constraints, display-source invalidation, privileged clipboard IPC, renderer event stripping, provider cancellation and packaged Electron behavior.

## Phase 3 exit status

The planned trust-boundary exit criterion is satisfied in source when CI passes: every exposed renderer invoke/send capability is owned by the trust inventory, every BrowserWindow has an explicit renderer boundary, every secret transition stays in the main process after entry, every known runtime network destination is documented, and negative tests cover the newly hardened privilege paths.

Two researched follow-ups are intentionally outside this PR:

- the fully validated `app://` migration followed by disabling file-protocol extra privileges;
- the isolated Electron 44.4.3 point update.

Neither is being silently marked complete here.
