const MAX_MODEL_PARTS = 64;
const MAX_MODEL_TEXT_CHARS = 24000;

function clonePart(part) {
    if (!part || typeof part !== 'object') return null;
    const output = {};
    if (typeof part.text === 'string') output.text = part.text;
    if (part.thought === true) output.thought = true;
    if (typeof part.thoughtSignature === 'string' && part.thoughtSignature) output.thoughtSignature = part.thoughtSignature;
    else if (typeof part.thought_signature === 'string' && part.thought_signature) output.thoughtSignature = part.thought_signature;
    if (part.functionCall && typeof part.functionCall === 'object') output.functionCall = structuredClone(part.functionCall);
    if (part.functionResponse && typeof part.functionResponse === 'object') output.functionResponse = structuredClone(part.functionResponse);
    return Object.keys(output).length ? output : null;
}

function hasSignature(part) {
    return typeof part?.thoughtSignature === 'string' && part.thoughtSignature.length > 0;
}

function appendModelParts(existing, response) {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts) || !parts.length) return Array.isArray(existing) ? existing : [];

    const output = Array.isArray(existing) ? existing.map(part => structuredClone(part)) : [];
    let textChars = output.reduce((sum, part) => sum + (typeof part.text === 'string' ? part.text.length : 0), 0);

    for (const source of parts) {
        if (output.length >= MAX_MODEL_PARTS) break;
        const part = clonePart(source);
        if (!part) continue;

        if (typeof part.text === 'string') {
            const remaining = MAX_MODEL_TEXT_CHARS - textChars;
            if (remaining <= 0 && !hasSignature(part)) continue;
            if (remaining >= 0 && part.text.length > remaining) part.text = part.text.slice(0, remaining);
            textChars += part.text.length;
        }

        const previous = output[output.length - 1];
        if (previous && typeof previous.text === 'string' && typeof part.text === 'string'
            && !previous.thought && !part.thought && !hasSignature(previous) && !hasSignature(part)
            && !previous.functionCall && !part.functionCall && !previous.functionResponse && !part.functionResponse) {
            previous.text += part.text;
        } else {
            output.push(part);
        }
    }

    return output;
}

function modelPartsForHistory(parts, fallbackText = '') {
    if (Array.isArray(parts) && parts.length) return parts.map(part => structuredClone(part));
    return [{ text: String(fallbackText || '').slice(-2500) }];
}

module.exports = {
    appendModelParts,
    modelPartsForHistory,
    _test: { clonePart, hasSignature },
};
