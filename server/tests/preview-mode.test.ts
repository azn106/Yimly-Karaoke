import { test } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';

test('Preview Mode Isolation Test', async (t) => {
    // 1. Test directory isolation
    process.env.PREVIEW_MODE = 'true';
    
    // Force re-import of preview-mode module to pick up new env
    const { isPreviewMode, previewDataDir } = await import('../lib/preview-mode.js?update=' + Date.now());
    
    assert.strictEqual(isPreviewMode, true);
    assert.ok(previewDataDir?.endsWith('preview-data'), 'Preview data dir should be isolated');

    // 2. Test database path isolation
    const { setupDatabase, dbPath } = await import('../db/index.js?update=' + Date.now());
    await setupDatabase();
    
    assert.ok(dbPath.includes('preview-data'), 'Database path should be inside preview-data');
    assert.ok(fs.existsSync(dbPath), 'Preview database file should exist');

    // 3. Reset
    delete process.env.PREVIEW_MODE;
});
