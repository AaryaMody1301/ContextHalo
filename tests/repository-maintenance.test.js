const test = require('node:test');
const assert = require('node:assert/strict');
const { branchRetention, releasePlan, ROLLBACK_TAG } = require('../scripts/repository-maintenance');

test('branch cleanup preserves default, protected, active and unmerged branches', () => {
    const context = { defaultBranch: 'main', currentBranch: 'repair', openHeads: new Set(['active']), merged: true };
    for (const name of ['main', 'repair', 'active']) assert.ok(branchRetention({ name }, context));
    assert.ok(branchRetention({ name: 'protected', protected: true }, context));
    assert.ok(branchRetention({ name: 'unmerged' }, { ...context, merged: false }));
    assert.equal(branchRetention({ name: 'merged' }, context), null);
});

test('release retention removes only obsolete complete automated builds and leaves rollback, stable and special releases intact', () => {
    const release = (id, overrides = {}) => ({ id, tag_name: `v0.8.0-portable.${id}`, published_at: `2026-09-${String(id).padStart(2, '0')}T00:00:00Z`,
        author: { login: 'github-actions[bot]' }, assets: ['ContextHalo-Windows-x64.exe', 'SHA256SUMS.txt'].map(name => ({ name, state: 'uploaded' })), ...overrides });
    const candidates = [release(1), release(2), release(3), release(4), release(5), release(6, { tag_name: ROLLBACK_TAG }),
        release(7, { tag_name: 'v0.8.0' }), release(8, { draft: true }), release(9, { prerelease: true }),
        release(10, { immutable: true }), release(11, { author: { login: 'maintainer' } }), release(12, { assets: [] })];
    assert.deepEqual(releasePlan(candidates, 1).map(item => item.id), [3, 2]);
    assert.deepEqual(releasePlan(candidates.slice(0, 3), 3), []);
    assert.equal(releasePlan(candidates, 1).some(item => item.tag_name === ROLLBACK_TAG), false);
});
