import { css } from '../../assets/lit-core-3.3.3.min.js';

export const contextHaloAppStyles = css`
        .phase4-overlay {
            position: fixed; inset: 12px; width: auto; height: auto; max-width: none; max-height: none;
            margin: 0; padding: 0; display: flex; flex-direction: column; overflow: hidden;
            border: 1px solid var(--border-strong); border-radius: 12px;
            background: var(--bg-surface); color: var(--text-primary); -webkit-app-region: no-drag;
        }
        .phase4-overlay:not([open]) { display: none; }
        .phase4-overlay::backdrop { background: rgb(0 0 0 / 0.3); }
        .phase4-overlay :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .phase4-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 40px; flex: 0 0 auto;
        padding: 0 18px;
        border-bottom: 1px solid var(--border);
    }
    .phase4-title {
        display: flex;
        align-items: baseline;
        gap: 10px;
        color: var(--text-primary);
        font-size: 15px;
        font-weight: 650;
    }
    .phase4-subtitle { color: var(--text-secondary); font-size: 13px; font-weight: 400; }
    .phase4-close, .phase4-btn, .phase4-tab, .phase4-source-button {
        border: 1px solid var(--border);
        background: var(--bg-elevated);
        color: var(--text-secondary);
        border-radius: 9px;
        cursor: pointer;
        font: inherit;
    }
    .phase4-close { min-height: 32px; padding: 0 10px; font-size: 13px; }
    .phase4-close:hover, .phase4-btn:hover, .phase4-tab:hover, .phase4-source-button:hover { background: var(--bg-elevated); color: var(--text-primary); }
    .phase4-tabs { display: flex; gap: 6px; padding: 10px 18px 0; }
    .phase4-tab { padding: 7px 11px; font-size: 13px; }
    .phase4-tab.active { border-color: rgba(96,165,250,.55); background: rgba(59,130,246,.13); color: var(--accent); }
    .phase4-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 18px 22px; }
    .phase4-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
    .phase4-btn { min-height: 32px; padding: 0 11px; font-size: 13px; }
    .phase4-btn.primary { border-color: rgba(96,165,250,.55); background: rgba(59,130,246,.18); color: var(--text-primary); }
    .phase4-btn.danger { border-color: rgba(248,113,113,.25); color: var(--text-primary); }
    .phase4-btn:disabled { opacity: .45; cursor: default; }
    .phase4-input, .phase4-textarea, .phase4-select {
        width: 100%;
        border: 1px solid var(--border);
        border-radius: 9px;
        background: var(--bg-elevated);
        color: var(--text-primary);
        font: inherit;
        color-scheme: var(--control-color-scheme, dark); box-sizing: border-box;
    }
    .phase4-input, .phase4-select { height: 36px; padding: 0 10px; }
    .phase4-textarea { min-height: 110px; padding: 9px 10px; resize: vertical; user-select: text; cursor: text; }
    .phase4-input:focus, .phase4-textarea:focus, .phase4-select:focus { border-color: rgba(96,165,250,.65); }
    .phase4-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 12px; }
    .phase4-card {
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--bg-elevated);
        padding: 13px;
    }
    .phase4-card-title { color: var(--text-primary); font-size: 15px; font-weight: 650; margin-bottom: 5px; }
    .phase4-muted { color: var(--text-secondary); font-size: 13px; line-height: 1.55; }
    .phase4-note, .phase4-error { color: var(--text-primary); font-size: 13px; line-height: 1.55; margin: 8px 0 14px; }
    .phase4-list { display: flex; flex-direction: column; gap: 7px; }
    .phase4-doc, .phase4-session {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 48px;
        padding: 9px 10px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--bg-elevated);
    }
    .phase4-doc-main, .phase4-session-main { flex: 1; min-width: 0; }
    .phase4-doc-title, .phase4-session-title { color: var(--text-primary); font-size: 13px; overflow-wrap: anywhere; }
    .phase4-doc-meta, .phase4-session-meta { color: var(--text-secondary); font-size: 13px; margin-top: 3px; }
    .phase4-toggle { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; }
    .phase4-search-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; margin-bottom: 14px; }
    .phase4-result { margin-top: 8px; padding: 10px; border-left: 2px solid rgba(96,165,250,.5); background: rgba(59,130,246,.05); }
    .phase4-result-title { color: var(--accent); font-size: 13px; font-weight: 600; }
    .phase4-result-text { color: var(--text-secondary); font-size: 13px; line-height: 1.55; margin-top: 5px; white-space: pre-wrap; user-select: text; }
    .phase4-form { display: none; margin: 10px 0 14px; gap: 8px; }
    .phase4-form.visible { display: grid; }
    .phase4-practice-question { font-size: 14px; line-height: 1.55; color: var(--text-primary); white-space: pre-wrap; user-select: text; margin: 12px 0; }
    .phase4-progress { color: var(--text-secondary); font-size: 13px; }
    .phase4-feedback { margin-top: 10px; padding: 10px; border-radius: 9px; background: var(--bg-elevated); font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
    .phase4-feedback.strong { background: rgba(34,197,94,.08); color: var(--text-primary); }
    .phase4-feedback.partial { background: rgba(234,179,8,.08); color: var(--text-primary); }
    .phase4-feedback.retry { background: rgba(248,113,113,.08); color: var(--text-primary); }
    .phase4-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
    .phase4-tag { padding: 4px 7px; border-radius: 999px; background: var(--bg-elevated); color: var(--text-secondary); font-size: 13px; }
    .phase4-review-section { margin-top: 14px; }
    .phase4-review-section h4 { margin: 0 0 7px; color: var(--text-primary); font-size: 13px; }
    .phase4-review-section ul { margin: 0; padding-left: 18px; color: var(--text-secondary); font-size: 13px; line-height: 1.6; user-select: text; }
    .phase4-empty { padding: 32px 16px; text-align: center; color: var(--text-secondary); font-size: 13px; }
    .phase4-live-chip {
        min-height: 24px;
        padding: 0 8px;
        border: 1px solid rgba(96,165,250,.2);
        border-radius: 999px;
        background: rgba(59,130,246,.07);
        color: var(--accent);
        font-size: 13px;
        cursor: pointer;
    }
    @media (max-width: 900px) { .phase4-grid { grid-template-columns: 1fr; } }

        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
        .phase4-page { font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
        * {
            box-sizing: border-box;
            font-family: var(--font);
            margin: 0;
            cursor: default;
            user-select: none;
        }

        :host {
            display: block;
            width: 100%;
            height: 100vh;
            overflow: hidden;
            border-radius: 12px;
            background: transparent;
            color: var(--text-primary);
        }

        /* ── Full app shell: top bar + sidebar/content ── */

        .app-shell {
            display: flex;
            height: calc(100vh - 2px);
            margin: 1px;
            overflow: hidden;
            border: 2px solid rgba(255, 255, 255, 0.18);
            border-radius: 11px;
            background: var(--window-background, var(--bg-app));
        }

        .top-drag-bar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            height: 38px;
            background: transparent;
        }

        .drag-region {
            flex: 1;
            height: 100%;
            -webkit-app-region: drag;
        }

        .top-drag-bar.hidden {
            display: none;
        }

        .traffic-lights {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 var(--space-md);
            height: 100%;
            -webkit-app-region: no-drag;
        }

        .traffic-light {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            border: none;
            cursor: pointer;
            padding: 0;
            transition: opacity 0.15s ease;
        }

        .traffic-light:hover {
            opacity: 0.8;
        }

        .traffic-light.close {
            background: #ff5f57;
        }

        .traffic-light.minimize {
            background: #febc2e;
        }

        .traffic-light.maximize {
            background: #28c840;
        }

        .sidebar {
            width: var(--sidebar-width);
            min-width: var(--sidebar-width);
            background: var(--bg-surface);
            border-right: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            padding: 42px 0 var(--space-md) 0;
            transition:
                width var(--transition),
                min-width var(--transition),
                opacity var(--transition);
        }

        .sidebar.hidden {
            display: none;
        }

        .sidebar-brand {
            padding: var(--space-sm) var(--space-lg);
            padding-top: var(--space-md);
            margin-bottom: var(--space-lg);
        }

        .sidebar-brand h1 {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            letter-spacing: -0.01em;
        }

        .sidebar-nav {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
            padding: 0 var(--space-sm);
            -webkit-app-region: no-drag;
        }

        .nav-item {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            padding: var(--space-sm) var(--space-md);
            border-radius: var(--radius-md);
            color: var(--text-secondary);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            cursor: pointer;
            transition:
                color var(--transition),
                background var(--transition);
            border: none;
            background: none;
            width: 100%;
            text-align: left;
        }

        .nav-item:hover {
            color: var(--text-primary);
            background: var(--bg-hover);
        }

        .nav-item.active {
            color: var(--text-primary);
            background: var(--bg-elevated);
        }

        .nav-item svg {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }

        .sidebar-footer {
            flex-shrink: 0;
            padding: var(--space-sm);
            margin-top: var(--space-sm);
            -webkit-app-region: no-drag;
        }

        .update-btn {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            width: 100%;
            padding: var(--space-sm) var(--space-md);
            border-radius: var(--radius-md);
            border: 1px solid rgba(239, 68, 68, 0.2);
            background: rgba(239, 68, 68, 0.08);
            color: var(--danger);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            cursor: pointer;
            text-align: left;
            transition:
                background var(--transition),
                border-color var(--transition);
            animation: update-wobble 5s ease-in-out infinite;
        }

        .update-btn:hover {
            background: rgba(239, 68, 68, 0.14);
            border-color: rgba(239, 68, 68, 0.35);
        }

        @keyframes update-wobble {
            0%,
            90%,
            100% {
                transform: rotate(0deg);
            }
            92% {
                transform: rotate(-2deg);
            }
            94% {
                transform: rotate(2deg);
            }
            96% {
                transform: rotate(-1.5deg);
            }
            98% {
                transform: rotate(1.5deg);
            }
        }

        .update-btn svg {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }

        .version-text {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            padding: var(--space-xs) var(--space-md);
        }

        /* ── Main content area ── */

        .content {
            min-width: 0;
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            background: transparent;
        }

        /* A single alpha surface; child backgrounds must not compound it. */
        .app-shell.live-hud { background: var(--window-background, rgba(10,10,10,0.8)); }
        .live-hud .content, .content-inner.live { background: transparent; }
        .live-bar {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
            gap: 12px;
            align-items: center;
            padding: 8px 12px;
            flex-shrink: 0;
            border-bottom: 1px solid var(--border-strong);
            -webkit-app-region: drag;
        }
        .live-bar-left, .live-bar-right {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
            -webkit-app-region: no-drag;
        }
        .live-bar-right { justify-content: flex-end; }
        .live-bar-center {
            min-width: 0;
            font-size: 14px;
            font-weight: 600;
            text-shadow: var(--hud-text-shadow);
        }
        .live-bar button, .session-actions button {
            min-height: 32px;
            padding: 6px 10px;
            border: 1px solid var(--border-strong);
            border-radius: 8px;
            color: var(--text-primary);
            background: var(--bg-elevated);
            cursor: pointer;
            -webkit-app-region: no-drag;
        }
        .live-bar button:hover, .session-actions button:hover { background: var(--bg-hover); }
        button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .live-bar-text { font-size: 12px; white-space: nowrap; text-shadow: var(--hud-text-shadow); }
        .session-state { padding:4px 12px; display:flex; align-items:center; gap:8px; flex-shrink:0; min-height:36px;
            font-size:13px; color:var(--text-primary); text-shadow:var(--hud-text-shadow); }
        .status-detail { min-width:0; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .search-state { flex-shrink:0; font-size:13px; }
        .session-state button { min-height:28px; flex-shrink:0; padding:4px 8px; border:1px solid var(--border-strong); border-radius:6px; background:var(--bg-elevated); color:var(--text-primary); cursor:pointer; font:inherit; }
        .session-actions { display:flex; flex-wrap:wrap; gap:8px; min-width:0; }
        .session-actions > span { flex-basis:100%; overflow-wrap:anywhere; }
        .session-details { position:fixed; inset:12px; width:auto; height:auto; max-width:none; max-height:none; margin:0; padding:0; display:flex; flex-direction:column;
            background:var(--bg-surface); color:var(--text-primary); border:1px solid var(--border-strong); border-radius:12px; -webkit-app-region:no-drag; }
        .session-details:not([open]) { display:none; }
        .session-details::backdrop { background:rgb(0 0 0 / .35); }
        .details-header { display:flex; align-items:center; gap:12px; padding:10px 14px; border-bottom:1px solid var(--border); flex-shrink:0; }
        .details-header h2 { margin-right:auto; font-size:16px; }
        .details-body { flex:1; min-height:0; overflow:auto; padding:16px; font-size:14px; line-height:1.6; user-select:text; }
        .details-body p { margin:8px 0 12px; overflow-wrap:anywhere; white-space:pre-wrap; user-select:text; }
        .details-body summary { cursor:pointer; padding:8px 0; font-weight:600; }
        .details-body h3 { font-size:15px; margin:16px 0 8px; }
        .live-bar-center { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
        :host([windows]) .top-drag-bar { height: 38px; background: var(--bg-surface); }
        :host([windows]) .drag-region { order: 1; }
        :host([windows]) .traffic-lights { order: 2; padding: 0; gap: 0; }
        :host([windows]) .traffic-light {
            position: relative; width: 46px; height: 38px;
            border-radius: 0; background: transparent; opacity: 1;
        }
        :host([windows]) .traffic-light:hover { background: var(--bg-hover); }
        :host([windows]) .traffic-light.close { order: 3; }
        :host([windows]) .traffic-light.close:hover { background: #c42b1c; color: white; }
        :host([windows]) .traffic-light::before, :host([windows]) .traffic-light::after {
            content: ''; position: absolute; left: 50%; top: 50%;
            color: var(--text-primary); pointer-events: none;
        }
        :host([windows]) .traffic-light.minimize::before {
            width: 10px; height: 1px; background: currentColor; transform: translate(-50%, 2px);
        }
        :host([windows]) .traffic-light.maximize::before {
            width: 9px; height: 8px; border: 1px solid currentColor; transform: translate(-50%, -50%);
        }
        :host([windows]) .traffic-light.close::before, :host([windows]) .traffic-light.close::after {
            width: 12px; height: 1px; background: currentColor; transform: translate(-50%, -50%) rotate(45deg);
        }
        :host([windows]) .traffic-light.close::after { transform: translate(-50%, -50%) rotate(-45deg); }
        @media (max-width: 700px) {
            .live-bar { gap: 6px; padding: 6px 8px; }
            .live-bar-center { font-size: 13px; }
            .live-bar-text.elapsed { display: none; }
        }

        /* Content inner */
        .content-inner {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            overscroll-behavior: contain;
            scroll-behavior: auto;
        }

        .content-inner.live {
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        /* Onboarding fills everything */
        .fullscreen {
            position: fixed;
            inset: 0;
            z-index: 100;
            background: var(--window-background, var(--bg-app));
        }

        .startup-shell {
            width: 100%;
            height: 100%;
            display: grid;
            place-items: center;
            background: var(--window-background, var(--bg-app));
            color: var(--text-primary);
        }

        .startup-card {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 14px 18px;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-surface);
            font-size: var(--font-size-sm);
            color: var(--text-secondary);
        }

        .startup-spinner {
            width: 16px;
            height: 16px;
            border: 2px solid var(--border-strong);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: startup-spin 0.8s linear infinite;
        }

        @keyframes startup-spin {
            to { transform: rotate(360deg); }
        }

        .app-shell.compact .sidebar {
            width: 184px;
            min-width: 184px;
        }

        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }

        ::-webkit-scrollbar-track {
            background: transparent;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--border-strong);
            border-radius: 3px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: #444444;
        }
    `;
