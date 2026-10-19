import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

// Isolate test database to prevent race conditions with other test suites
const testDataDir = path.resolve(process.cwd(), 'data', 'test_library_registration');
process.env.DATA_DIR = testDataDir;

import { setupDatabase, db } from '../db/index.js';
import { libraries } from '../db/schema.js';
import { registerSampleLibraryIfNeeded } from '../lib/library-registration.js';

test('Library Registration Tests', async (t) => {
    await setupDatabase();
    
    // Clear libraries for clean test
    await db.delete(libraries);

    // 1. Test: Production mode (should NOT register)
    process.env.AUTO_REGISTER_SAMPLE_LIBRARY = 'true';
    await registerSampleLibraryIfNeeded(true);
    let libs = await db.select().from(libraries);
    assert.strictEqual(libs.length, 0, 'Should NOT register in production');

    // 2. Test: Development mode, but flag off (should NOT register)
    process.env.AUTO_REGISTER_SAMPLE_LIBRARY = 'false';
    await registerSampleLibraryIfNeeded(false);
    libs = await db.select().from(libraries);
    assert.strictEqual(libs.length, 0, 'Should NOT register if flag is off');

    // 3. Test: Development mode, flag on, empty database (should register)
    process.env.AUTO_REGISTER_SAMPLE_LIBRARY = 'true';
    await registerSampleLibraryIfNeeded(false);
    libs = await db.select().from(libraries);
    assert.strictEqual(libs.length, 1, 'Should register in dev with flag');
    assert.strictEqual(libs[0].name, 'Sample Library');

    // 4. Test: Repeated registration (should NOT duplicate)
    await registerSampleLibraryIfNeeded(false);
    libs = await db.select().from(libraries);
    assert.strictEqual(libs.length, 1, 'Should NOT duplicate library');

    // 5. Test: Already exists another library (should NOT overwrite)
    await db.delete(libraries);
    await db.insert(libraries).values({ name: 'User Library', path: '/fake/path' });
    await registerSampleLibraryIfNeeded(false);
    libs = await db.select().from(libraries);
    assert.strictEqual(libs.length, 1, 'Should NOT overwrite existing library');
    assert.strictEqual(libs[0].name, 'User Library');
});
