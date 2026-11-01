import { test } from 'node:test';
import assert from 'node:assert';

export interface LyricWord {
  text: string;
  start: number;
}

export interface LyricLine {
  time: number;
  text: string;
  words?: LyricWord[];
}

/**
 * Authoritative transition target resolution as implemented in RoomSession.tsx and AutoResponsiveLyrics.tsx:
 * For eLRC lines with word timestamps, use the first word's original timestamp.
 * Fall back to line.time when word timestamps are unavailable.
 * Normal LRC uses line.time.
 */
export function getLineTargetTime(line: LyricLine | undefined, lyricsFormat: 'elrc' | 'lrc' = 'elrc'): number {
  if (!line) return 0;
  if (lyricsFormat === 'elrc' && line.words && line.words.length > 0 && typeof line.words[0].start === 'number') {
    return line.words[0].start;
  }
  return line.time;
}

/**
 * Scheduling and wipe calculation mirroring RoomSession.tsx & AutoResponsiveLyrics.tsx
 * with configurable Fade Duration and Fade Overlap.
 */
export function calculateLineTransitionTiming(
  line: LyricLine,
  leadInMs: number = 1500,
  lyricsFormat: 'elrc' | 'lrc' = 'elrc',
  fadeDurationMs: number = 1500,
  fadeOverlapMs: number = 300
) {
  const isElrcMode = lyricsFormat === 'elrc';
  const targetTime = getLineTargetTime(line, lyricsFormat);

  const fadeDurationSec = isElrcMode ? Math.max(300, Math.min(5000, fadeDurationMs)) / 1000 : 1.5;
  const fadeOverlapSec = isElrcMode ? Math.min(fadeDurationSec, Math.max(0, Math.min(3000, fadeOverlapMs)) / 1000) : 0;
  
  const transitionLeadSec = Math.max(fadeDurationSec, 2 * fadeDurationSec - fadeOverlapSec);
  const displayLeadSec = isElrcMode ? Math.max(1500, Math.min(5000, leadInMs)) / 1000 : 0;
  const effectiveLeadSec = isElrcMode ? Math.max(displayLeadSec, transitionLeadSec) : 0;

  // In RoomSession: lineDisplayTime = adjustedTime + effectiveLeadSec
  // The line becomes active when lineDisplayTime >= targetTime => adjustedTime >= targetTime - effectiveLeadSec
  const schedulingTime = targetTime - effectiveLeadSec;

  // Delays from scheduling moment:
  const inDelay = isElrcMode ? Math.max(0, effectiveLeadSec - fadeDurationSec) : 0;
  const outDelay = isElrcMode ? Math.max(0, effectiveLeadSec - (2 * fadeDurationSec - fadeOverlapSec)) : 0;

  const inStartTime = schedulingTime + inDelay;
  const inEndTime = inStartTime + fadeDurationSec;

  const outStartTime = schedulingTime + outDelay;
  const outEndTime = outStartTime + fadeDurationSec;

  return {
    targetTime,
    effectiveLeadSec,
    fadeDurationSec,
    fadeOverlapSec,
    schedulingTime,
    inDelay,
    outDelay,
    inStartTime,
    inEndTime,
    outStartTime,
    outEndTime,
  };
}

/**
 * Word highlighting evaluation function matching AutoResponsiveLyrics.tsx:
 * Evaluates the highlight status for each word in an eLRC line given current playback time.
 */
export function evaluateWordHighlights(
  words: LyricWord[],
  currentTime: number,
  isHighlighted: boolean = true,
  lyricOffset: number = 0
): { highlighted: boolean; word: LyricWord }[] {
  const adjustedTime = currentTime + lyricOffset / 1000;

  let maxActiveWordIndex = -1;
  if (words?.length && isHighlighted) {
    for (let i = 0; i < words.length; i++) {
      if (adjustedTime >= words[i].start) {
        maxActiveWordIndex = i;
      }
    }
  }

  return words.map((word, wordIndex) => ({
    highlighted: wordIndex <= maxActiveWordIndex,
    word,
  }));
}

test('Lyrics Transition Timing & Scheduling Suite', async (t) => {
  await t.test('eLRC line where line.time differs from words[0].start uses words[0].start as authoritative target', () => {
    const line: LyricLine = {
      time: 8.0,
      text: 'Hello world',
      words: [
        { text: 'Hello', start: 10.0 },
        { text: 'world', start: 11.2 },
      ],
    };

    const timing = calculateLineTransitionTiming(line, 2000, 'elrc', 1500, 300);

    assert.strictEqual(timing.targetTime, 10.0, 'Authoritative target must be words[0].start (10.0s), NOT line.time (8.0s)');
    assert.strictEqual(timing.inEndTime, 10.0, 'Incoming transition finishes EXACTLY at first-word timestamp (10.0s)');
    assert.strictEqual(timing.inStartTime, 8.5, 'Incoming wipe starts at 10.0 - 1.5 = 8.5s');
    assert.strictEqual(timing.outEndTime, 8.8, 'Outgoing wipe finishes at 8.5 + 0.3 = 8.8s (300ms after incoming starts)');
    assert.strictEqual(timing.outStartTime, 7.3, 'Outgoing wipe starts at 8.8 - 1.5 = 7.3s');
  });

  await t.test('eLRC Fade Duration and Fade Overlap work independently of Extra eLRC Display Lead', () => {
    const line: LyricLine = {
      time: 20.0,
      text: 'Independent test',
      words: [{ text: 'Independent', start: 20.0 }],
    };

    // Test with lead 1500ms, duration 1200ms, overlap 400ms
    const t1 = calculateLineTransitionTiming(line, 1500, 'elrc', 1200, 400);
    assert.strictEqual(t1.fadeDurationSec, 1.2);
    assert.strictEqual(t1.fadeOverlapSec, 0.4);
    assert.strictEqual(t1.inEndTime, 20.0, 'Must finish at 20.0s');
    assert.strictEqual(t1.inStartTime, 18.8, 'Incoming starts at 20.0 - 1.2 = 18.8s');
    assert.strictEqual(t1.outEndTime, 19.2, 'Outgoing finishes at 18.8 + 0.4 = 19.2s');
    assert.strictEqual(Math.round((t1.outEndTime - t1.inStartTime) * 1000), 400, 'Overlap must be exactly 400ms');

    // Test with same duration/overlap but huge Extra Display Lead (4000ms)
    const t2 = calculateLineTransitionTiming(line, 4000, 'elrc', 1200, 400);
    assert.strictEqual(t2.inEndTime, 20.0, 'Must still finish at 20.0s');
    assert.strictEqual(t2.inStartTime, 18.8, 'Incoming still starts at 18.8s');
    assert.strictEqual(t2.outEndTime, 19.2, 'Outgoing still finishes at 19.2s');
    assert.strictEqual(Math.round((t2.outEndTime - t2.inStartTime) * 1000), 400, 'Overlap remains exactly 400ms');
  });

  await t.test('Zero overlap (sequential wipes)', () => {
    const line: LyricLine = {
      time: 15.0,
      text: 'Sequential',
      words: [{ text: 'Sequential', start: 15.0 }],
    };

    const timing = calculateLineTransitionTiming(line, 1500, 'elrc', 1000, 0);
    assert.strictEqual(timing.inEndTime, 15.0);
    assert.strictEqual(timing.inStartTime, 14.0);
    assert.strictEqual(timing.outEndTime, 14.0, 'Outgoing finishes exactly when incoming starts');
    assert.strictEqual(timing.outStartTime, 13.0);
  });

  await t.test('Full overlap (simultaneous wipes when overlap equals duration)', () => {
    const line: LyricLine = {
      time: 10.0,
      text: 'Simultaneous',
      words: [{ text: 'Simultaneous', start: 10.0 }],
    };

    const timing = calculateLineTransitionTiming(line, 1500, 'elrc', 1500, 1500);
    assert.strictEqual(timing.inEndTime, 10.0);
    assert.strictEqual(timing.inStartTime, 8.5);
    assert.strictEqual(timing.outEndTime, 10.0, 'Outgoing finishes at 10.0s (same as incoming)');
    assert.strictEqual(timing.outStartTime, 8.5, 'Outgoing starts at 8.5s (same as incoming)');
  });

  await t.test('Fallback to line.time when word timestamps are unavailable', () => {
    const lineNoWords: LyricLine = {
      time: 14.5,
      text: '♪ Instrumental break ♪',
    };

    const timing = calculateLineTransitionTiming(lineNoWords, 2000, 'elrc', 1500, 300);
    assert.strictEqual(timing.targetTime, 14.5, 'Falls back to line.time');
    assert.strictEqual(timing.inEndTime, 14.5, 'Finishes at line.time');
  });

  await t.test('Standard LRC playback remains unaffected', () => {
    const line: LyricLine = {
      time: 42.0,
      text: 'Standard LRC line',
    };

    const timing = calculateLineTransitionTiming(line, 3000, 'lrc', 1500, 300);
    assert.strictEqual(timing.targetTime, 42.0, 'Standard LRC target is always line.time');
    assert.strictEqual(timing.effectiveLeadSec, 0, 'Standard LRC does not advance with display lead');
    assert.strictEqual(timing.inDelay, 0, 'Standard LRC inDelay is 0');
    assert.strictEqual(timing.outDelay, 0, 'Standard LRC outDelay is 0');
    assert.strictEqual(timing.inStartTime, 42.0, 'Standard LRC transition starts immediately at 42.0s');
  });
});

test('Smooth Word-by-Word Highlighting Engine Suite', async (t) => {
  await t.test('Consecutive words with very short timestamp gaps (10ms, 20ms, 50ms) activate in order without skipping', () => {
    const words: LyricWord[] = [
      { text: 'One', start: 10.00 },
      { text: 'Two', start: 10.01 }, // 10ms gap
      { text: 'Three', start: 10.03 }, // 20ms gap
      { text: 'Four', start: 10.08 }, // 50ms gap
    ];

    // At 9.99s: none highlighted
    let res = evaluateWordHighlights(words, 9.99);
    assert.deepStrictEqual(res.map(r => r.highlighted), [false, false, false, false]);

    // At 10.005s: Word 'One' highlighted, rest unhighlighted
    res = evaluateWordHighlights(words, 10.005);
    assert.deepStrictEqual(res.map(r => r.highlighted), [true, false, false, false]);

    // At 10.02s: Words 'One' and 'Two' highlighted
    res = evaluateWordHighlights(words, 10.02);
    assert.deepStrictEqual(res.map(r => r.highlighted), [true, true, false, false]);

    // At 10.05s: Words 'One', 'Two', 'Three' highlighted
    res = evaluateWordHighlights(words, 10.05);
    assert.deepStrictEqual(res.map(r => r.highlighted), [true, true, true, false]);

    // At 10.08s: All four words highlighted
    res = evaluateWordHighlights(words, 10.08);
    assert.deepStrictEqual(res.map(r => r.highlighted), [true, true, true, true]);
  });

  await t.test('Consecutive words with identical timestamps activate safely together without flickering', () => {
    const words: LyricWord[] = [
      { text: 'Double', start: 5.00 },
      { text: 'Trouble', start: 5.00 }, // Identical timestamp
      { text: 'Next', start: 5.50 },
    ];

    // Before timestamp: neither is highlighted
    let res = evaluateWordHighlights(words, 4.99);
    assert.deepStrictEqual(res.map(r => r.highlighted), [false, false, false]);

    // Exactly at timestamp: both identical words activate simultaneously
    res = evaluateWordHighlights(words, 5.00);
    assert.deepStrictEqual(res.map(r => r.highlighted), [true, true, false]);

    // After subsequent word timestamp: all active
    res = evaluateWordHighlights(words, 5.51);
    assert.deepStrictEqual(res.map(r => r.highlighted), [true, true, true]);
  });

  await t.test('Normal word spacing highlights sequentially as each timestamp passes', () => {
    const words: LyricWord[] = [
      { text: 'Walking', start: 1.0 },
      { text: 'down', start: 1.4 },
      { text: 'the', start: 1.7 },
      { text: 'street', start: 2.1 },
    ];

    assert.deepStrictEqual(evaluateWordHighlights(words, 0.9).map(r => r.highlighted), [false, false, false, false]);
    assert.deepStrictEqual(evaluateWordHighlights(words, 1.2).map(r => r.highlighted), [true, false, false, false]);
    assert.deepStrictEqual(evaluateWordHighlights(words, 1.5).map(r => r.highlighted), [true, true, false, false]);
    assert.deepStrictEqual(evaluateWordHighlights(words, 1.8).map(r => r.highlighted), [true, true, true, false]);
    assert.deepStrictEqual(evaluateWordHighlights(words, 2.2).map(r => r.highlighted), [true, true, true, true]);
  });

  await t.test('Seeking forwards immediately highlights words up to seeked position', () => {
    const words: LyricWord[] = [
      { text: 'Intro', start: 1.0 },
      { text: 'verse', start: 2.0 },
      { text: 'chorus', start: 3.0 },
      { text: 'outro', start: 4.0 },
    ];

    // Seek directly to 3.5s
    const res = evaluateWordHighlights(words, 3.5);
    assert.deepStrictEqual(res.map(r => r.highlighted), [true, true, true, false]);
  });

  await t.test('Seeking backwards cleanly unhighlights subsequent words', () => {
    const words: LyricWord[] = [
      { text: 'Intro', start: 1.0 },
      { text: 'verse', start: 2.0 },
      { text: 'chorus', start: 3.0 },
      { text: 'outro', start: 4.0 },
    ];

    // Playing at 3.5s: 3 words active
    let res = evaluateWordHighlights(words, 3.5);
    assert.deepStrictEqual(res.map(r => r.highlighted), [true, true, true, false]);

    // Seek backwards to 1.5s: only first word active
    res = evaluateWordHighlights(words, 1.5);
    assert.deepStrictEqual(res.map(r => r.highlighted), [true, false, false, false]);
  });

  await t.test('Pausing and resuming preserves highlighting state', () => {
    const words: LyricWord[] = [
      { text: 'Stay', start: 10.0 },
      { text: 'with', start: 10.5 },
      { text: 'me', start: 11.0 },
    ];

    // Pause at 10.6s
    const pausedHighlights = evaluateWordHighlights(words, 10.6);
    assert.deepStrictEqual(pausedHighlights.map(r => r.highlighted), [true, true, false]);

    // Multiple frames while paused produce stable identical output without flicker
    for (let frame = 0; frame < 10; frame++) {
      const stable = evaluateWordHighlights(words, 10.6);
      assert.deepStrictEqual(stable.map(r => r.highlighted), [true, true, false]);
    }

    // Resume to 11.2s
    const resumed = evaluateWordHighlights(words, 11.2);
    assert.deepStrictEqual(resumed.map(r => r.highlighted), [true, true, true]);
  });

  await t.test('Playback speed changes track position accurately', () => {
    const words: LyricWord[] = [
      { text: 'Fast', start: 2.0 },
      { text: 'or', start: 2.5 },
      { text: 'slow', start: 3.0 },
    ];

    // Simulated 1.5x speed playback where audio time advances by 1.5x per real second
    const speed = 1.5;
    let audioTime = 1.5;
    for (let sec = 0; sec <= 2.0; sec += 0.5) {
      audioTime = 1.5 + sec * speed;
      const res = evaluateWordHighlights(words, audioTime);
      if (audioTime < 2.0) {
        assert.strictEqual(res[0].highlighted, false);
      } else if (audioTime >= 3.0) {
        assert.strictEqual(res.every(r => r.highlighted), true);
      }
    }
  });

  await t.test('Word order safety: earlier word is never skipped if a subsequent word is reached', () => {
    // If an eLRC file has an anomalous timestamp where word 1 is 10.05 and word 2 is 10.02
    const words: LyricWord[] = [
      { text: 'First', start: 10.05 },
      { text: 'Second', start: 10.02 },
      { text: 'Third', start: 10.10 },
    ];

    // At 10.03: 'Second' has passed its timestamp, so 'First' must also be highlighted (never skip earlier word)
    const res = evaluateWordHighlights(words, 10.03);
    assert.strictEqual(res[0].highlighted, true, 'First word must be highlighted if second has started');
    assert.strictEqual(res[1].highlighted, true, 'Second word must be highlighted');
    assert.strictEqual(res[2].highlighted, false, 'Third word is not yet reached');
  });
});
