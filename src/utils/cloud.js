// Compatibility shim for an unpublished provider that is no longer part of ContextHalo.
// Public ContextHalo builds support Gemini API, Groq API, and Local AI only.

let onTurnComplete = null;

function unsupported() {
    return new Error('This legacy cloud provider is not supported in ContextHalo. Use Gemini API, Groq API, or Local AI.');
}

async function connectCloud() {
    throw unsupported();
}

function sendCloudAudio() { return false; }
function sendCloudText() { return false; }
function sendCloudImage() { return false; }
function closeCloud() {}
function isCloudActive() { return false; }
function setOnTurnComplete(callback) { onTurnComplete = callback; }

module.exports = {
    connectCloud,
    sendCloudAudio,
    sendCloudText,
    sendCloudImage,
    closeCloud,
    isCloudActive,
    setOnTurnComplete,
};
