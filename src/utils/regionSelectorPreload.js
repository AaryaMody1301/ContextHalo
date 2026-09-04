const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('regionSelector', {
    complete(region) {
        ipcRenderer.send('region-selector-complete', region);
    },
    cancel() {
        ipcRenderer.send('region-selector-cancel');
    },
});
