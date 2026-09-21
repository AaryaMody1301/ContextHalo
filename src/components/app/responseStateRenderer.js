export function addResponseState(host, response, metadata) {
    if (metadata?.uiEpoch !== undefined && metadata.uiEpoch !== host._uiSessionEpoch) return;
    const id = metadata?.requestId;
    if (id && host._responseRequestIndex.has(id)) return updateResponseState(host, response, metadata);

    const wasOnLatest = host.currentResponseIndex === host.responses.length - 1;
    const requestedReply = id && ['text', 'screen'].some(kind => host._requestOwners?.[kind]?.requestId === id);
    const canFollow = requestedReply || host.shadowRoot?.querySelector('assistant-view')?.canFollowResponse?.() !== false;

    host.responses = [...host.responses, String(response || '')];
    (host._responseGrounding ||= []).push(metadata?.grounding);
    host._responseIds.push(id || null);
    if (id) host._responseRequestIndex.set(id, host.responses.length - 1);
    if ((wasOnLatest && canFollow) || host.currentResponseIndex === -1) {
        host.currentResponseIndex = host.responses.length - 1;
    }
    host.requestUpdate();
}

export function updateResponseState(host, response, metadata) {
    if (metadata?.uiEpoch !== undefined && metadata.uiEpoch !== host._uiSessionEpoch) return;
    const id = metadata?.requestId;
    if (id && !host._responseRequestIndex.has(id)) return addResponseState(host, response, metadata);

    const index = id ? host._responseRequestIndex.get(id) : host.responses.length - 1;
    if (index < 0) return addResponseState(host, response, metadata);
    if (metadata?.grounding) (host._responseGrounding ||= [])[index] = metadata.grounding;

    const next = [...host.responses];
    next[index] = String(response || '');
    host.responses = next;
    host.requestUpdate();
}
