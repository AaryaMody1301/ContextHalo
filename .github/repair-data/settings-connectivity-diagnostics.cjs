const fs = require('node:fs');
const path = 'scripts/renderer-behavior-smoke.js';
let source = fs.readFileSync(path, 'utf8');
const before = `                            currentView: app?.currentView || null,\n                            present: Boolean(settingsInApp),\n                            shadow: Boolean(settingsInApp?.shadowRoot),`;
const after = `                            currentView: app?.currentView || null,\n                            appConnected: Boolean(app?.isConnected),\n                            present: Boolean(settingsInApp),\n                            isConnected: Boolean(settingsInApp?.isConnected),\n                            parentClass: settingsInApp?.parentElement?.className || null,\n                            rootIsAppShadow: settingsInApp?.getRootNode?.() === app?.shadowRoot,\n                            shadow: Boolean(settingsInApp?.shadowRoot),`;
if (!source.includes(before)) throw new Error('Settings connectivity diagnostic insertion point not found');
source = source.replace(before, after);
fs.writeFileSync(path, source);
