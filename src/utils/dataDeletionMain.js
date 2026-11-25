const { dialog } = require('electron');
const { abortable } = require('./requestDeadline');
const { clearLocalData, getDownloadBytes, setDataEraseInProgress } = require('../storage');

const SCOPES = {
    personal: {
        action: 'Delete personal data',
        detail: 'Remove saved sessions, knowledge, practice history, provider credentials, settings, and diagnostics. Local AI runners and models are kept.',
    },
    downloads: {
        action: 'Delete Local AI downloads',
        detail: 'Remove downloaded Local AI runners and models. Saved sessions, knowledge, provider credentials, and settings are kept.',
    },
    all: {
        action: 'Reset all local data',
        detail: 'Remove personal data and all downloaded Local AI runners and models.',
    },
};
const BUSY = 'A data deletion request is already in progress.';
const cancelled = () => ({ success: true, cancelled: true });

function formatDownloadSize(bytes) {
    if (bytes < 1024) return `${bytes} bytes`;
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
    return `${(bytes / 1024 ** (unit + 1)).toFixed(1)} ${units[unit]}`;
}

async function confirmDeletion(window, { action, detail }) {
    const answer = await dialog.showMessageBox(window, {
        type: 'warning',
        title: 'ContextHalo',
        message: action + '?',
        detail,
        buttons: ['Cancel', action],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
    });
    return answer.response === 1;
}

function createDataDeletionController({ getWindow, stopActivity, quit }) {
    let confirming = false;
    let erasing = false;
    let completed = false;

    async function erase(scope) {
        if (erasing) return { success: false, error: BUSY };
        erasing = true;
        setDataEraseInProgress(true);
        try {
            try {
                const signal = AbortSignal.timeout(15000);
                await abortable(() => stopActivity(scope, signal), signal);
            } catch {
                return { success: false, error: 'Could not stop ContextHalo activity. Let the session or download finish, then retry.' };
            }

            const result = await clearLocalData(scope);
            if (result.success) {
                completed = true;
                quit();
            }
            return result;
        } catch {
            return { success: false, error: 'Could not clear the selected local data. Check folder permissions and retry.' };
        } finally {
            if (!completed) {
                erasing = false;
                setDataEraseInProgress(false);
            }
        }
    }

    async function request(scope, isTrusted) {
        if (!isTrusted()) return { success: false, error: 'Untrusted renderer' };
        if (typeof scope !== 'string' || !Object.hasOwn(SCOPES, scope)) return { success: false, error: 'Choose a valid data deletion scope.' };
        if (confirming || erasing) return cancelled();
        confirming = true;
        try {
            const { action, detail } = SCOPES[scope];
            const size = scope === 'downloads' ? ` Current files use about ${formatDownloadSize(await getDownloadBytes())}.` : '';
            if (!isTrusted() || erasing) return cancelled();
            const accepted = await confirmDeletion(getWindow(), {
                action,
                detail: detail + size + ' ContextHalo closes when deletion succeeds.',
            });
            if (!accepted || !isTrusted() || erasing) return cancelled();
            return await erase(scope);
        } catch {
            return { success: false, error: 'Could not confirm deletion. Check folder access and retry.' };
        } finally {
            confirming = false;
        }
    }

    return {
        request,
        emergencyErase: () => erase('personal'),
        isErasing: () => erasing,
        blocksQuit: () => erasing && !completed,
    };
}

module.exports = { confirmDeletion, createDataDeletionController };
