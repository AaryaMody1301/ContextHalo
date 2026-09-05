from pathlib import Path
changes = {}
def edit(name, old, new):
    text = changes.get(name, Path(name).read_text(encoding='utf-8'))
    assert text.count(old) == 1, (name, 'Expected one matching source section')
    changes[name] = text.replace(old, new)

edit('src/components/app/ContextHaloApp.js', '            margin: 0;\n            padding: 0;\n            cursor: default;', '            margin: 0;\n            cursor: default;')
edit('src/utils/realtimeContextRenderer.js', '    panel.replaceChildren();', '''    // Only rebuild the transcript-owned subtree. Capture tools and the context
    // inspector have separate owners and must survive transcript/status updates.
    let content = panel.querySelector(':scope > .phase3-transcript-content');
    if (!content) {
        content = document.createElement('div');
        content.className = 'phase3-transcript-content';
        panel.prepend(content);
    }
    content.replaceChildren();''')
for name in ['row', 'preview', 'history']:
    edit('src/utils/realtimeContextRenderer.js', f'panel.appendChild({name});', f'content.appendChild({name});')
edit('scripts/renderer-behavior-smoke.js', "    verify(input?.tagName==='TEXTAREA' && button,'Multiline composer and Send button render');", """    verify(input?.tagName==='TEXTAREA' && button,'Multiline composer and Send button render');
    await waitUntil(()=>root.querySelector('.phase3-capture-tools'));
    root.querySelector('.phase3-transcript-toggle').click(); await settle(assistant);
    verify(Boolean(root.querySelector('.phase3-capture-tools')),'Capture tools survive transcript refresh');
    [...root.querySelectorAll('.phase3-tool-button')].find(b=>b.textContent==='Context').click();
    root.querySelector('.phase3-transcript-toggle').click(); await settle(assistant);
    verify(Boolean(root.querySelector('.phase3-context-inspector')),'Context inspector survives transcript refresh');
    [...root.querySelectorAll('.phase3-tool-button')].find(b=>b.textContent==='Context').click();""")
edit('scripts/renderer-behavior-smoke.js', "    app.navigate('main');await settle(app);", """    app.navigate('main');await settle(app);
    const home=app.shadowRoot.querySelector('main-view'); await settle(home);
    await waitUntil(()=>home.shadowRoot.querySelector('.page-title')?.getBoundingClientRect().top>=40);
    verify(home.shadowRoot.querySelector('.page-title').getBoundingClientRect().top>=40,'Home heading is below the draggable caption');""")
for name, text in changes.items():
    Path(name).write_text(text, encoding='utf-8', newline='\n')
print('Applied final component ownership corrections to', len(changes), 'files')
