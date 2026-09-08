const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

// Load main-process code in the normal JS realm with explicit native boundaries.
// This does not claim to test Electron itself; the Windows smoke does that.
function loadMain(file, mocks = {}, globals = {}) {
    const cache = new Map();
    function load(filename) {
        filename = path.resolve(filename);
        if (cache.has(filename)) return cache.get(filename).exports;
        const module = { exports: {} }; cache.set(filename, module);
        const realRequire = createRequire(filename);
        const scopedRequire = name => {
            if (Object.hasOwn(mocks, name)) return mocks[name];
            if (name === 'electron') return {};
            if (name.startsWith('.')) return load(realRequire.resolve(name));
            return realRequire(name);
        };
        const run = new Function('require', 'module', 'exports', '__dirname', '__filename', ...Object.keys(globals), fs.readFileSync(filename, 'utf8'));
        run(scopedRequire,module,module.exports,path.dirname(filename),filename,...Object.values(globals));
        return module.exports;
    }
    return load(file);
}
module.exports = { loadMain };
