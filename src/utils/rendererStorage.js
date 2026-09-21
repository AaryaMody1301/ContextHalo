(function initializeRendererStorage(global) {
    function createRendererStorage(ipcRenderer) {
        let persistenceQueue = Promise.resolve();

        function persistStorage(channel, ...args) {
            const snapshot = structuredClone(args);
            const pending = persistenceQueue.then(async () => {
                const result = await ipcRenderer.invoke(channel, ...snapshot);
                if (result?.success !== true) {
                    throw Object.assign(new Error(result?.error || 'Could not save data. Your edit is retained; retry.'), { result });
                }
                return result;
            });
            persistenceQueue = pending.catch(() => {});
            return pending;
        }

        const storage = {
            async getConfig() {
                await persistenceQueue;
                const result = await ipcRenderer.invoke('storage:get-config');
                return result.success ? result.data : {};
            },
            async updateConfig(key, value) { return persistStorage('storage:update-config', key, value); },
            async getCredentialStatus() {
                await persistenceQueue;
                const result = await ipcRenderer.invoke('storage:credential-status');
                if (!result?.success) throw new Error('Credential status could not be loaded.');
                return result.data;
            },
            async setApiKey(apiKey) { return persistStorage('storage:set-api-key', apiKey); },
            async setGroqApiKey(groqApiKey) { return persistStorage('storage:set-groq-api-key', groqApiKey); },
            async getPreferences() {
                await persistenceQueue;
                const result = await ipcRenderer.invoke('storage:get-preferences');
                if (!result?.success) throw new Error('Preferences could not be loaded. Retry before editing.');
                return result.data;
            },
            async updatePreference(key, value) { return persistStorage('storage:update-preference', key, value); },
            async getShortcutState() {
                await persistenceQueue;
                return ipcRenderer.invoke('storage:get-keybinds');
            },
            async setKeybinds(keybinds) { return persistStorage('storage:set-keybinds', keybinds); },
            async getAllSessions() {
                await persistenceQueue;
                const result = await ipcRenderer.invoke('storage:get-all-sessions');
                if (!result?.success) throw Object.assign(new Error(result?.error || 'History could not be loaded. Retry.'), { code: result?.code });
                return result.data;
            },
            async getSession(sessionId) {
                await persistenceQueue;
                const result = await ipcRenderer.invoke('storage:get-session', sessionId);
                if (!result?.success) throw Object.assign(new Error(result?.error || 'This session could not be read. Retry.'), { code: result?.code });
                return result.data;
            },
            async saveSession(sessionId, data) { return persistStorage('storage:save-session', sessionId, data); },
            async deleteSession(sessionId) { return persistStorage('storage:delete-session', sessionId); },
            async deleteAllSessions() { return persistStorage('storage:delete-all-sessions'); },
            async clearAll() { return persistStorage('storage:clear-all'); },
        };

        let preferencesCache = null;
        async function loadPreferencesCache() {
            preferencesCache = await storage.getPreferences();
            return preferencesCache;
        }

        return {
            storage,
            loadPreferencesCache,
            getPreferencesCache: () => preferencesCache,
        };
    }

    global.ContextHaloRendererStorage = { createRendererStorage };
})(window);
