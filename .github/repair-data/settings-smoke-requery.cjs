const fs = require('node:fs');
const file = 'scripts/renderer-behavior-smoke.js';
let source = fs.readFileSync(file, 'utf8');
const before = `                    const settingsInApp = app.shadowRoot?.querySelector('customize-view');
                    let settingsReady = false;
                    for (let attempt = 0; attempt < 100 && !settingsReady; attempt++) {
                        const settingsText = settingsInApp?.shadowRoot?.textContent || '';
                        settingsReady = settingsText.includes('Session Defaults') &&
                            settingsText.includes('AI Provider & Models') &&
                            settingsText.includes('AI Behavior') &&
                            settingsText.includes('Keyboard Shortcuts');
                        if (!settingsReady) await new Promise(resolve => setTimeout(resolve, 20));
                    }
                    const unifiedPage = settingsInApp?.shadowRoot?.querySelector('.unified-page');`;
const after = `                    let settingsInApp = null;
                    let settingsReady = false;
                    for (let attempt = 0; attempt < 200 && !settingsReady; attempt++) {
                        settingsInApp = app.shadowRoot?.querySelector('customize-view') || null;
                        const settingsText = settingsInApp?.shadowRoot?.textContent || '';
                        settingsReady = Boolean(settingsInApp?.shadowRoot?.querySelector('.unified-page')) &&
                            settingsText.includes('Session Defaults') &&
                            settingsText.includes('AI Provider & Models') &&
                            settingsText.includes('AI Behavior') &&
                            settingsText.includes('Keyboard Shortcuts');
                        if (!settingsReady) await new Promise(resolve => setTimeout(resolve, 25));
                    }
                    const unifiedPage = settingsInApp?.shadowRoot?.querySelector('.unified-page');`;
if (!source.includes(before)) throw new Error('Expected mounted Settings probe was not found.');
source = source.replace(before, after);
fs.writeFileSync(file, source);
