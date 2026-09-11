const fs = require('node:fs');
const path = 'src/components/app/ContextHaloApp.js';
let source = fs.readFileSync(path, 'utf8');
const before = `        if (changedProperties.has('currentView')) {\n            this._resetContentScroll();\n            if (window.require) {`;
const after = `        if (changedProperties.has('currentView')) {\n            this._resetContentScroll();\n            // Windows CI exposed an upgraded, connected Settings element whose Lit\n            // connection gate had not run after dynamic navigation. Normal custom-element\n            // lifecycle is left alone; only recover a connected child with no render root.\n            if (this.currentView === 'customize') {\n                const settingsView = this.shadowRoot?.querySelector('customize-view');\n                if (settingsView?.isConnected && !settingsView.renderRoot && typeof settingsView.connectedCallback === 'function') {\n                    settingsView.connectedCallback();\n                }\n            }\n            if (window.require) {`;
if (!source.includes(before)) throw new Error('ContextHaloApp updated() insertion point not found');
source = source.replace(before, after);
fs.writeFileSync(path, source);
