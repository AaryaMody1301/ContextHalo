const fs = require('node:fs');
const path = 'scripts/renderer-behavior-smoke.js';
let source = fs.readFileSync(path, 'utf8');
const before = `                    let settingsUpdateError = '';\n                    if (settingsInApp) {\n                        try { await settingsInApp.updateComplete; }\n                        catch (error) { settingsUpdateError = String(error?.stack || error?.message || error).slice(0, 4000); }\n                    }`;
const after = `                    let settingsUpdateError = '';\n                    if (settingsInApp) {\n                        try {\n                            const updateResult = await Promise.race([\n                                settingsInApp.updateComplete.then(() => 'complete', error => { throw error; }),\n                                new Promise(resolve => setTimeout(() => resolve('timeout'), 2000)),\n                            ]);\n                            if (updateResult === 'timeout') settingsUpdateError = 'updateComplete timed out after 2000ms';\n                        } catch (error) { settingsUpdateError = String(error?.stack || error?.message || error).slice(0, 4000); }\n                    }`;
if (!source.includes(before)) throw new Error('Unbounded Settings diagnostic await not found');
source = source.replace(before, after);
fs.writeFileSync(path, source);
