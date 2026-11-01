import { test } from 'node:test';
import assert from 'node:assert';
import { resolveLyricsSettings, DEFAULT_LYRICS_SETTINGS } from '../lib/lyrics-settings.ts';
import { resolveLyricsSettings as clientResolveLyricsSettings } from '../../src/utils/lyricsSettings.ts';

/**
 * Generic decoupled input simulator matching the implementation in Settings.tsx
 */
class SettingInputSimulator {
  private savedSettings: any;
  private inputStr: string;
  private isFocused: boolean;
  private key: string;
  private min: number;
  private max: number;
  private defaultVal: number;

  constructor(
    key: string,
    min: number,
    max: number,
    defaultVal: number,
    initialSettings: any = DEFAULT_LYRICS_SETTINGS
  ) {
    this.key = key;
    this.min = min;
    this.max = max;
    this.defaultVal = defaultVal;
    this.savedSettings = resolveLyricsSettings(initialSettings);
    this.inputStr = String(this.savedSettings[key] ?? defaultVal);
    this.isFocused = false;
  }

  get inputValue(): string {
    return this.inputStr;
  }

  get currentSettings(): any {
    return this.savedSettings;
  }

  focus() {
    this.isFocused = true;
  }

  type(newVal: string) {
    this.inputStr = newVal;
  }

  commit() {
    const trimmed = this.inputStr.trim();
    if (!trimmed) {
      this.inputStr = String(this.savedSettings[this.key] ?? this.defaultVal);
      return;
    }
    const parsed = parseInt(trimmed, 10);
    if (isNaN(parsed)) {
      this.inputStr = String(this.savedSettings[this.key] ?? this.defaultVal);
      return;
    }
    const clamped = Math.max(this.min, Math.min(this.max, parsed));
    this.inputStr = String(clamped);
    this.savedSettings = resolveLyricsSettings({
      ...this.savedSettings,
      [this.key]: clamped,
    });
  }

  blur() {
    this.isFocused = false;
    this.commit();
  }

  pressEnter() {
    this.commit();
    this.isFocused = false;
  }
}

test('Settings eLRC Display Lead Input Suite', async (t) => {
  await t.test('Replacing 1500 with 2500 without intermediate resets', () => {
    const sim = new SettingInputSimulator('elrcDisplayLeadInMs', 1500, 5000, 1500, { elrcDisplayLeadInMs: 1500 });
    sim.focus();

    sim.type('150');
    assert.strictEqual(sim.inputValue, '150');
    assert.strictEqual(sim.currentSettings.elrcDisplayLeadInMs, 1500);

    sim.type('');
    assert.strictEqual(sim.inputValue, '');

    sim.type('2500');
    assert.strictEqual(sim.inputValue, '2500');

    sim.blur();
    assert.strictEqual(sim.inputValue, '2500');
    assert.strictEqual(sim.currentSettings.elrcDisplayLeadInMs, 2500);
  });

  await t.test('Leaving field empty restores previous valid value on blur', () => {
    const sim = new SettingInputSimulator('elrcDisplayLeadInMs', 1500, 5000, 1500, { elrcDisplayLeadInMs: 3200 });
    sim.focus();
    sim.type('');
    sim.blur();
    assert.strictEqual(sim.inputValue, '3200');
    assert.strictEqual(sim.currentSettings.elrcDisplayLeadInMs, 3200);
  });

  await t.test('Clamping boundaries for eLRC display lead (1500 - 5000)', () => {
    const sim = new SettingInputSimulator('elrcDisplayLeadInMs', 1500, 5000, 1500);
    sim.focus();
    sim.type('400');
    sim.blur();
    assert.strictEqual(sim.inputValue, '1500');
    assert.strictEqual(sim.currentSettings.elrcDisplayLeadInMs, 1500);

    sim.focus();
    sim.type('9999');
    sim.pressEnter();
    assert.strictEqual(sim.inputValue, '5000');
    assert.strictEqual(sim.currentSettings.elrcDisplayLeadInMs, 5000);
  });
});

test('Settings eLRC Fade Duration Input Suite', async (t) => {
  await t.test('Default value is 1500 ms for new and existing users', () => {
    const resolved = resolveLyricsSettings({});
    assert.strictEqual(resolved.elrcFadeDurationMs, 1500);
  });

  await t.test('Allows typing custom duration (e.g. 2000 ms) without intermediate resets', () => {
    const sim = new SettingInputSimulator('elrcFadeDurationMs', 300, 5000, 1500, { elrcFadeDurationMs: 1500 });
    sim.focus();
    sim.type('');
    assert.strictEqual(sim.inputValue, '');
    sim.type('2000');
    sim.pressEnter();
    assert.strictEqual(sim.inputValue, '2000');
    assert.strictEqual(sim.currentSettings.elrcFadeDurationMs, 2000);
  });

  await t.test('Clamps below minimum (300 ms) and above maximum (5000 ms)', () => {
    const sim = new SettingInputSimulator('elrcFadeDurationMs', 300, 5000, 1500);
    sim.focus();
    sim.type('100');
    sim.blur();
    assert.strictEqual(sim.inputValue, '300');
    assert.strictEqual(sim.currentSettings.elrcFadeDurationMs, 300);

    sim.focus();
    sim.type('8000');
    sim.pressEnter();
    assert.strictEqual(sim.inputValue, '5000');
    assert.strictEqual(sim.currentSettings.elrcFadeDurationMs, 5000);
  });

  await t.test('Empty field restores previous valid duration on blur', () => {
    const sim = new SettingInputSimulator('elrcFadeDurationMs', 300, 5000, 1500, { elrcFadeDurationMs: 1800 });
    sim.focus();
    sim.type('');
    sim.blur();
    assert.strictEqual(sim.inputValue, '1800');
    assert.strictEqual(sim.currentSettings.elrcFadeDurationMs, 1800);
  });
});

test('Settings eLRC Fade Overlap Input Suite', async (t) => {
  await t.test('Default value is 300 ms for new and existing users', () => {
    const resolved = resolveLyricsSettings({});
    assert.strictEqual(resolved.elrcFadeOverlapMs, 300);
  });

  await t.test('Allows typing custom overlap (e.g. 500 ms or 0 ms) without intermediate resets', () => {
    const sim = new SettingInputSimulator('elrcFadeOverlapMs', 0, 3000, 300, { elrcFadeOverlapMs: 300 });
    sim.focus();
    sim.type('');
    sim.type('500');
    sim.pressEnter();
    assert.strictEqual(sim.inputValue, '500');
    assert.strictEqual(sim.currentSettings.elrcFadeOverlapMs, 500);

    sim.focus();
    sim.type('0');
    sim.pressEnter();
    assert.strictEqual(sim.inputValue, '0');
    assert.strictEqual(sim.currentSettings.elrcFadeOverlapMs, 0);
  });

  await t.test('Clamps negative overlap to 0 ms and upper bound to 3000 ms', () => {
    const sim = new SettingInputSimulator('elrcFadeOverlapMs', 0, 3000, 300);
    sim.focus();
    sim.type('-50');
    sim.blur();
    assert.strictEqual(sim.inputValue, '0');
    assert.strictEqual(sim.currentSettings.elrcFadeOverlapMs, 0);

    sim.focus();
    sim.type('5000');
    sim.pressEnter();
    assert.strictEqual(sim.inputValue, '3000');
    assert.strictEqual(sim.currentSettings.elrcFadeOverlapMs, 3000);
  });
});

test('Setting Independence and Resolver Parity Suite', async (t) => {
  await t.test('Fade Duration and Fade Overlap work independently of Extra eLRC Display Lead', () => {
    const initial = {
      elrcDisplayLeadInMs: 2500,
      elrcFadeDurationMs: 1200,
      elrcFadeOverlapMs: 400,
      visibleLines: 3,
      alignment: 'center' as const,
    };

    // Update only Fade Duration
    const simDuration = new SettingInputSimulator('elrcFadeDurationMs', 300, 5000, 1500, initial);
    simDuration.focus();
    simDuration.type('1800');
    simDuration.commit();

    assert.strictEqual(simDuration.currentSettings.elrcFadeDurationMs, 1800);
    assert.strictEqual(simDuration.currentSettings.elrcFadeOverlapMs, 400, 'Fade Overlap must remain unchanged');
    assert.strictEqual(simDuration.currentSettings.elrcDisplayLeadInMs, 2500, 'Display Lead must remain unchanged');
    assert.strictEqual(simDuration.currentSettings.visibleLines, 3);

    // Update only Fade Overlap
    const simOverlap = new SettingInputSimulator('elrcFadeOverlapMs', 0, 3000, 300, simDuration.currentSettings);
    simOverlap.focus();
    simOverlap.type('600');
    simOverlap.commit();

    assert.strictEqual(simOverlap.currentSettings.elrcFadeDurationMs, 1800, 'Fade Duration must remain unchanged');
    assert.strictEqual(simOverlap.currentSettings.elrcFadeOverlapMs, 600);
    assert.strictEqual(simOverlap.currentSettings.elrcDisplayLeadInMs, 2500, 'Display Lead must remain unchanged');
  });

  await t.test('Frontend and Server resolvers both enforce defaults and bounds for all 3 eLRC settings', () => {
    const testCases = [
      {
        input: { elrcDisplayLeadInMs: 500, elrcFadeDurationMs: 100, elrcFadeOverlapMs: -10 },
        expectedLead: 1500,
        expectedDuration: 300,
        expectedOverlap: 0,
      },
      {
        input: { elrcDisplayLeadInMs: 2500, elrcFadeDurationMs: 2000, elrcFadeOverlapMs: 500 },
        expectedLead: 2500,
        expectedDuration: 2000,
        expectedOverlap: 500,
      },
      {
        input: { elrcDisplayLeadInMs: 9000, elrcFadeDurationMs: 9000, elrcFadeOverlapMs: 9000 },
        expectedLead: 5000,
        expectedDuration: 5000,
        expectedOverlap: 3000,
      },
      {
        input: {},
        expectedLead: 1500,
        expectedDuration: 1500,
        expectedOverlap: 300,
      },
    ];

    for (const tc of testCases) {
      const serverRes = resolveLyricsSettings(tc.input);
      const clientRes = clientResolveLyricsSettings(tc.input);

      assert.strictEqual(serverRes.elrcDisplayLeadInMs, tc.expectedLead);
      assert.strictEqual(clientRes.elrcDisplayLeadInMs, tc.expectedLead);

      assert.strictEqual(serverRes.elrcFadeDurationMs, tc.expectedDuration);
      assert.strictEqual(clientRes.elrcFadeDurationMs, tc.expectedDuration);

      assert.strictEqual(serverRes.elrcFadeOverlapMs, tc.expectedOverlap);
      assert.strictEqual(clientRes.elrcFadeOverlapMs, tc.expectedOverlap);
    }
  });

  await t.test('Vertical Alignment Resolution Suite', () => {
    const resolvedDefault = resolveLyricsSettings({});
    assert.strictEqual(resolvedDefault.verticalAlignment, 'center');

    const resolvedTop = resolveLyricsSettings({ verticalAlignment: 'top' });
    assert.strictEqual(resolvedTop.verticalAlignment, 'top');

    const resolvedBottom = resolveLyricsSettings({ verticalAlignment: 'bottom' });
    assert.strictEqual(resolvedBottom.verticalAlignment, 'bottom');

    const resolvedInvalid = resolveLyricsSettings({ verticalAlignment: 'invalid_align' });
    assert.strictEqual(resolvedInvalid.verticalAlignment, 'center');
  });
});

test('LRC and eLRC section counts resolve independently', () => {
  const input = {
    visibleLines: 2,
    lrcVisibleLines: 1,
    elrcVisibleLines: 5,
  };

  for (const resolver of [resolveLyricsSettings, clientResolveLyricsSettings]) {
    const resolved = resolver(input);
    assert.strictEqual(resolved.lrcVisibleLines, 1);
    assert.strictEqual(resolved.elrcVisibleLines, 5);
  }
});

test('Legacy shared section count migrates to both format-specific counts', () => {
  for (const resolver of [resolveLyricsSettings, clientResolveLyricsSettings]) {
    const resolved = resolver({ visibleLines: 4 });
    assert.strictEqual(resolved.lrcVisibleLines, 4);
    assert.strictEqual(resolved.elrcVisibleLines, 4);
  }
});
