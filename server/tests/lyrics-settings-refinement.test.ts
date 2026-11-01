import { test } from 'node:test';
import assert from 'node:assert';
import { resolveLyricsSettings } from '../lib/lyrics-settings.ts';

test('Lyrics Settings Refinement - Minimum Display Lead', async (t) => {
  await t.test('enforces 1500ms minimum on new settings', () => {
    const raw = { elrcDisplayLeadInMs: 500 };
    const resolved = resolveLyricsSettings(raw);
    assert.strictEqual(resolved.elrcDisplayLeadInMs, 1500);
  });

  await t.test('preserves values above 1500ms', () => {
    const raw = { elrcDisplayLeadInMs: 2000 };
    const resolved = resolveLyricsSettings(raw);
    assert.strictEqual(resolved.elrcDisplayLeadInMs, 2000);
  });

  await t.test('resolves undefined/missing values to 1500ms', () => {
    const resolved = resolveLyricsSettings({});
    assert.strictEqual(resolved.elrcDisplayLeadInMs, 1500);
  });

  await t.test('existing saved values below 1500ms are migrated', () => {
    const raw = { elrcDisplayLeadInMs: 0 };
    const resolved = resolveLyricsSettings(raw);
    assert.strictEqual(resolved.elrcDisplayLeadInMs, 1500);
  });
});
