const overlay = document.querySelector('#overlay');
const selection = document.querySelector('#selection');
const sizeLabel = document.querySelector('#sizeLabel');
const hint = document.querySelector('#hint');

let startX = 0;
let startY = 0;
let dragging = false;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function updateSelection(clientX, clientY) {
    const x1 = clamp(startX, 0, window.innerWidth);
    const y1 = clamp(startY, 0, window.innerHeight);
    const x2 = clamp(clientX, 0, window.innerWidth);
    const y2 = clamp(clientY, 0, window.innerHeight);
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    selection.style.left = `${left}px`;
    selection.style.top = `${top}px`;
    selection.style.width = `${width}px`;
    selection.style.height = `${height}px`;
    selection.hidden = false;
    sizeLabel.textContent = `${Math.round(width)} × ${Math.round(height)}`;
    return { left, top, width, height };
}

function completeRegion(rect) {
    if (!rect || rect.width < 8 || rect.height < 8) {
        selection.hidden = true;
        hint.textContent = 'Drag a larger rectangle · Esc to cancel';
        return;
    }

    window.regionSelector.complete({
        x: rect.left / window.innerWidth,
        y: rect.top / window.innerHeight,
        width: rect.width / window.innerWidth,
        height: rect.height / window.innerHeight,
    });
}

overlay.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    overlay.setPointerCapture(event.pointerId);
    updateSelection(event.clientX, event.clientY);
    hint.textContent = 'Release to capture this region';
});

overlay.addEventListener('pointermove', event => {
    if (!dragging) return;
    updateSelection(event.clientX, event.clientY);
});

overlay.addEventListener('pointerup', event => {
    if (!dragging) return;
    dragging = false;
    const rect = updateSelection(event.clientX, event.clientY);
    completeRegion(rect);
});

overlay.addEventListener('pointercancel', () => {
    dragging = false;
    selection.hidden = true;
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') window.regionSelector.cancel();
});
