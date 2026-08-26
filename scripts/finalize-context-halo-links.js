const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const headerPath = path.join(root, 'src', 'components', 'app', 'AppHeader.js');
let source = fs.readFileSync(headerPath, 'utf8');

source = source.replace(
    'https://raw.githubusercontent.com/sohzm/context-halo/refs/heads/master/package.json',
    'https://raw.githubusercontent.com/AaryaMody1301/ContextHalo/main/package.json'
);
source = source.replace(
    'https://contexthalo.com',
    'https://github.com/AaryaMody1301/ContextHalo/releases/latest'
);

fs.writeFileSync(headerPath, source, 'utf8');
fs.rmSync(__filename, { force: true });
console.log('ContextHalo project links finalized.');
