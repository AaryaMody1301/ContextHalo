const fs = require('node:fs');
const path = 'src/components/views/CustomizeView.js';
let source = fs.readFileSync(path, 'utf8');
const before = `        this._loadFromStorage();\n    }\n\n    getThemes() {`;
const after = `        this._loadFromStorage();\n    }\n\n    connectedCallback() {\n        super.connectedCallback();\n    }\n\n    getThemes() {`;
if (!source.includes(before)) throw new Error('CustomizeView constructor insertion point not found');
source = source.replace(before, after);
fs.writeFileSync(path, source);
