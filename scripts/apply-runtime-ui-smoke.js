const fs = require('node:fs');

const file = 'src/index.js';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const beforeReturn = `                    return {
                        bridge: Boolean(window.electronAPI && window.require),
                        platform: window.process?.platform,
                        arch: window.process?.arch,
                        app: Boolean(document.querySelector('context-halo-app')),
                    };`;

const afterReturn = `                    await customElements.whenDefined('customize-view');

                    const mainView = document.createElement('main-view');
                    mainView.style.display = 'none';
                    document.body.appendChild(mainView);
                    await mainView.updateComplete;
                    mainView.startError = 'Smoke test session failure';
                    mainView.requestUpdate();
                    await mainView.updateComplete;
                    const mainText = mainView.shadowRoot?.textContent || '';
                    const homeReady = mainText.includes('Start Session') && mainText.includes('Session Profile');
                    const errorReady = Boolean(mainView.shadowRoot?.querySelector('.session-status.error'));

                    const settingsView = document.createElement('customize-view');
                    settingsView.style.display = 'none';
                    document.body.appendChild(settingsView);
                    await settingsView.updateComplete;
                    const settingsText = settingsView.shadowRoot?.textContent || '';
                    const settingsReady = settingsText.includes('Session Defaults') &&
                        settingsText.includes('AI Behavior') &&
                        settingsText.includes('Keyboard Shortcuts');

                    mainView.remove();
                    settingsView.remove();

                    return {
                        bridge: Boolean(window.electronAPI && window.require),
                        platform: window.process?.platform,
                        arch: window.process?.arch,
                        app: Boolean(document.querySelector('context-halo-app')),
                        home: homeReady,
                        sessionError: errorReady,
                        settings: settingsReady,
                    };`;

if (!source.includes(beforeReturn)) throw new Error('Could not find Windows smoke result block');
source = source.replace(beforeReturn, afterReturn);

const beforeReady = `            const ready = result?.bridge === true && result?.platform === 'win32' && result?.arch === 'x64' && result?.app === true;
            finish(ready, ready ? 'sandboxed preload and renderer loaded' : \`unexpected renderer state \${JSON.stringify(result)}\`);`;
const afterReady = `            const ready = result?.bridge === true &&
                result?.platform === 'win32' &&
                result?.arch === 'x64' &&
                result?.app === true &&
                result?.home === true &&
                result?.sessionError === true &&
                result?.settings === true;
            finish(ready, ready ? 'sandboxed preload, Home, session error state, and Settings rendered' : \`unexpected renderer state \${JSON.stringify(result)}\`);`;

if (!source.includes(beforeReady)) throw new Error('Could not find Windows smoke readiness block');
source = source.replace(beforeReady, afterReady);
fs.writeFileSync(file, source, 'utf8');

console.log('Windows Electron smoke now exercises Home and Settings rendering.');
