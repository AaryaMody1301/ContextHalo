const { spawnSync } = require('node:child_process');

const result = spawnSync('python', ['.github/scripts/apply_scroll_settings_gemini_repair.py'], {
    stdio: 'inherit',
    shell: false,
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
