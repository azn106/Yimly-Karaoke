import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import {
  CompactSearchKeyboard,
  insertSearchTextAtCursor,
  backspaceSearchTextAtCursor,
  KEYBOARD_NUMBER_ROW,
  KEYBOARD_TOP_ALPHA_ROW,
  KEYBOARD_MID_ALPHA_ROW,
  KEYBOARD_BOT_ALPHA_ROW,
} from '../../src/components/CompactSearchKeyboard.tsx';

test('CompactSearchKeyboard text helpers handle cursor and end-of-string edits', () => {
  assert.deepStrictEqual(insertSearchTextAtCursor('sza', ' ', null, null), {
    value: 'sza ',
    nextCursor: 4,
  });

  assert.deepStrictEqual(insertSearchTextAtCursor('snoze', 'o', 3, 3), {
    value: 'snooze',
    nextCursor: 4,
  });

  assert.deepStrictEqual(insertSearchTextAtCursor('hello world', '!', 5, 11), {
    value: 'hello!',
    nextCursor: 6,
  });

  assert.deepStrictEqual(backspaceSearchTextAtCursor('sza', null, null), {
    value: 'sz',
    nextCursor: 2,
  });

  assert.deepStrictEqual(backspaceSearchTextAtCursor('snooze', 3, 3), {
    value: 'snoze',
    nextCursor: 2,
  });

  assert.deepStrictEqual(backspaceSearchTextAtCursor('snooze', 0, 0), {
    value: 'snooze',
    nextCursor: 0,
  });

  assert.deepStrictEqual(backspaceSearchTextAtCursor('snooze', 1, 5), {
    value: 'se',
    nextCursor: 1,
  });

  assert.deepStrictEqual(backspaceSearchTextAtCursor('', null, null), {
    value: '',
    nextCursor: 0,
  });
});

test('CompactSearchKeyboard renders A-Z, 0-9, Space, Backspace, Clear, Search and handles clicks', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost:3000',
  });
  const prevWindow = (globalThis as any).window;
  const prevDocument = (globalThis as any).document;
  const prevHTMLElement = (globalThis as any).HTMLElement;
  const prevActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;

  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  try {
    let query = '';
    let searchSubmitted = 0;

    const container = dom.window.document.getElementById('root')!;
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(CompactSearchKeyboard, {
          onKeyPress: (ch: string) => {
            query = insertSearchTextAtCursor(query, ch, null, null).value;
          },
          onBackspace: () => {
            query = backspaceSearchTextAtCursor(query, null, null).value;
          },
          onClear: () => {
            query = '';
          },
          onSearch: () => {
            searchSubmitted += 1;
          },
        })
      );
    });

    const allLetters = [
      ...KEYBOARD_TOP_ALPHA_ROW,
      ...KEYBOARD_MID_ALPHA_ROW,
      ...KEYBOARD_BOT_ALPHA_ROW,
    ];
    assert.strictEqual(allLetters.length, 26);
    assert.strictEqual(KEYBOARD_NUMBER_ROW.length, 10);

    for (const digit of KEYBOARD_NUMBER_ROW) {
      const btn = container.querySelector<HTMLButtonElement>(`[data-tv-id="kb-key-${digit}"]`);
      assert.ok(btn, `Expected digit key ${digit}`);
      assert.strictEqual(btn.getAttribute('type'), 'button');
      assert.strictEqual(btn.getAttribute('data-tv-kb-key'), 'true');
    }

    for (const letter of allLetters) {
      const btn = container.querySelector<HTMLButtonElement>(`[data-tv-id="kb-key-${letter}"]`);
      assert.ok(btn, `Expected letter key ${letter}`);
      assert.strictEqual(btn.getAttribute('type'), 'button');
      assert.strictEqual(btn.getAttribute('data-tv-kb-key'), 'true');
    }

    const spaceBtn = container.querySelector<HTMLButtonElement>('[data-tv-id="kb-key-space"]');
    const backspaceBtn = container.querySelector<HTMLButtonElement>('[data-tv-id="kb-key-backspace"]');
    const clearBtn = container.querySelector<HTMLButtonElement>('[data-tv-id="kb-key-clear"]');
    const searchBtn = container.querySelector<HTMLButtonElement>('[data-tv-id="kb-key-search"]');

    assert.ok(spaceBtn && backspaceBtn && clearBtn && searchBtn);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-tv-id="kb-key-s"]')!.click();
      container.querySelector<HTMLButtonElement>('[data-tv-id="kb-key-z"]')!.click();
      container.querySelector<HTMLButtonElement>('[data-tv-id="kb-key-a"]')!.click();
      spaceBtn.click();
      container.querySelector<HTMLButtonElement>('[data-tv-id="kb-key-2"]')!.click();
    });
    assert.strictEqual(query, 'sza 2');

    await act(async () => {
      backspaceBtn.click();
    });
    assert.strictEqual(query, 'sza ');

    await act(async () => {
      searchBtn.click();
    });
    assert.strictEqual(searchSubmitted, 1);

    await act(async () => {
      clearBtn.click();
    });
    assert.strictEqual(query, '');

    await act(async () => {
      root.unmount();
    });
  } finally {
    (globalThis as any).window = prevWindow;
    (globalThis as any).document = prevDocument;
    (globalThis as any).HTMLElement = prevHTMLElement;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    dom.window.close();
  }
});
