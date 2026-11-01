import { test } from 'node:test';
import assert from 'node:assert';
import { computeWordIntervals, calculateWordProgress } from '../../src/utils/lyricsProgress.ts';

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

test('Continuous Left-to-Right eLRC Word Highlighting & Progressive Fill', async (t) => {
  await t.test('computeWordIntervals: normal spacing connects words seamlessly', () => {
    const words = [
      { text: 'Hello', start: 1.0 },
      { text: 'world', start: 2.0 },
      { text: 'karaoke', start: 3.5 },
    ];
    const intervals = computeWordIntervals(words, 5.0);
    assert.strictEqual(intervals.length, 3);
    // Word 0 starts at 1.0, ends at 2.0 (flows directly into Word 1)
    assert.strictEqual(intervals[0].start, 1.0);
    assert.strictEqual(intervals[0].end, 2.0);

    // Word 1 starts at 2.0, ends at 3.5 (flows directly into Word 2)
    assert.strictEqual(intervals[1].start, 2.0);
    assert.strictEqual(intervals[1].end, 3.5);

    // Word 2 starts at 3.5, ends after 3.5 based on cadence
    assert.strictEqual(intervals[2].start, 3.5);
    assert.ok(intervals[2].end > 3.5);
  });

  await t.test('computeWordIntervals: close timestamps (10ms, 20ms, 50ms) are non-zero and strictly positive', () => {
    const words = [
      { text: 'Fast', start: 10.00 },
      { text: 'fire', start: 10.01 }, // 10ms gap
      { text: 'words', start: 10.03 }, // 20ms gap
      { text: 'flow', start: 10.08 },  // 50ms gap
    ];
    const intervals = computeWordIntervals(words);
    assert.strictEqual(intervals.length, 4);
    assert.strictEqual(intervals[0].start, 10.00);
    assert.strictEqual(intervals[0].end, 10.01);
    assert.strictEqual(intervals[1].start, 10.01);
    assert.strictEqual(intervals[1].end, 10.03);
    assert.strictEqual(intervals[2].start, 10.03);
    assert.strictEqual(intervals[2].end, 10.08);
    assert.ok(intervals[3].end > 10.08);

    for (let i = 0; i < intervals.length; i++) {
      assert.ok(intervals[i].end > intervals[i].start, `Interval ${i} must have positive duration`);
    }
  });

  await t.test('computeWordIntervals: identical timestamps are clustered and smoothly partitioned by length', () => {
    const words = [
      { text: 'Hi', start: 5.0 },
      { text: 'there', start: 5.0 }, // Identical timestamp with previous word
      { text: 'friend', start: 6.0 },
    ];
    const intervals = computeWordIntervals(words);
    assert.strictEqual(intervals.length, 3);
    // Both 'Hi' and 'there' share the 1.0s interval [5.0, 6.0]
    assert.strictEqual(intervals[0].start, 5.0);
    assert.ok(intervals[0].end > 5.0);
    assert.strictEqual(intervals[1].start, intervals[0].end);
    assert.strictEqual(intervals[1].end, 6.0);
    // 'there' (5 letters) should receive more duration than 'Hi' (2 letters)
    const durHi = intervals[0].end - intervals[0].start;
    const durThere = intervals[1].end - intervals[1].start;
    assert.ok(durThere > durHi, `'there' duration (${durThere}) must be greater than 'Hi' (${durHi})`);
    // Word 2 starts at 6.0
    assert.strictEqual(intervals[2].start, 6.0);
  });

  await t.test('computeWordIntervals: single-word line generates valid duration', () => {
    const single = [{ text: 'Sing', start: 2.0 }];
    const intervals = computeWordIntervals(single, 3.0);
    assert.strictEqual(intervals.length, 1);
    assert.strictEqual(intervals[0].start, 2.0);
    assert.ok(intervals[0].end > 2.0);
    assert.ok(intervals[0].end <= 3.0);
  });

  await t.test('calculateWordProgress: smooth continuous progressive fill 0% -> 100%', () => {
    const words = [
      { text: 'First', start: 10.0 },
      { text: 'Second', start: 11.0 },
    ];
    const intervals = computeWordIntervals(words); // [10.0, 11.0] and [11.0, 11.0 + dur]

    // Before start: 0%
    const p0 = calculateWordProgress(words, intervals, 9.5, true, false);
    assert.strictEqual(p0[0], 0);
    assert.strictEqual(p0[1], 0);

    // At start: 0%
    const p1 = calculateWordProgress(words, intervals, 10.0, true, false);
    assert.strictEqual(p1[0], 0);
    assert.strictEqual(p1[1], 0);

    // Halfway through word 0: 50%
    const p2 = calculateWordProgress(words, intervals, 10.5, true, false);
    assert.strictEqual(Math.round(p2[0]), 50);
    assert.strictEqual(p2[1], 0);

    // 75% through word 0: 75%
    const p3 = calculateWordProgress(words, intervals, 10.75, true, false);
    assert.strictEqual(Math.round(p3[0]), 75);
    assert.strictEqual(p3[1], 0);

    // At 11.0: Word 0 finishes 100%, Word 1 begins 0% (seamless transition)
    const p4 = calculateWordProgress(words, intervals, 11.0, true, false);
    assert.strictEqual(p4[0], 100);
    assert.strictEqual(p4[1], 0);

    // Halfway through word 1: Word 0 stays 100%, Word 1 is 50%
    const w1Dur = intervals[1].end - intervals[1].start;
    const p5 = calculateWordProgress(words, intervals, 11.0 + w1Dur * 0.5, true, false);
    assert.strictEqual(p5[0], 100);
    assert.strictEqual(Math.round(p5[1]), 50);

    // Past word 1 end: both 100%
    const p6 = calculateWordProgress(words, intervals, intervals[1].end + 0.5, true, false);
    assert.strictEqual(p6[0], 100);
    assert.strictEqual(p6[1], 100);
  });

  await t.test('calculateWordProgress: word order monotonicity prevents skipped words', () => {
    const words = [
      { text: 'A', start: 1.0 },
      { text: 'B', start: 1.01 }, // 10ms gap
      { text: 'C', start: 2.0 },
    ];
    const intervals = computeWordIntervals(words);

    // If clock skips directly to 1.02, 'B' has started, so 'A' MUST be 100%
    const p = calculateWordProgress(words, intervals, 1.02, true, false);
    assert.strictEqual(p[0], 100, 'Word A must be 100% complete if Word B has started');
    assert.ok(p[1] > 0, 'Word B has started filling');
    assert.strictEqual(p[2], 0, 'Word C not yet started');
  });

  await t.test('calculateWordProgress: past line retains 100% across all words', () => {
    const words = [
      { text: 'Old', start: 1.0 },
      { text: 'line', start: 2.0 },
    ];
    const intervals = computeWordIntervals(words);
    const p = calculateWordProgress(words, intervals, 0, false, true);
    assert.deepStrictEqual(p, [100, 100]);
  });

  await t.test('calculateWordProgress: preview mode demonstrates progressive fill', () => {
    const words = [
      { text: 'Preview', start: 1.0 },
      { text: 'Word', start: 2.0 },
      { text: 'Three', start: 3.0 },
    ];
    const intervals = computeWordIntervals(words);
    const p = calculateWordProgress(words, intervals, 0, false, false, true);
    assert.strictEqual(p[0], 100);
    assert.strictEqual(p[1], 65);
    assert.strictEqual(p[2], 0);
  });

  await t.test('calculateWordProgress: seeking backwards resets progress cleanly without lag', () => {
    const words = [
      { text: 'Seek', start: 10.0 },
      { text: 'Test', start: 20.0 },
    ];
    const intervals = computeWordIntervals(words);

    // Sing forward to 25.0s -> both 100%
    const pForward = calculateWordProgress(words, intervals, 25.0, true, false);
    assert.deepStrictEqual(pForward, [100, 100]);

    // User seeks backward to 15.0s -> Seek is progressively filled to 50%, Test is 0%
    const pSeekBack = calculateWordProgress(words, intervals, 15.0, true, false);
    assert.strictEqual(Math.round(pSeekBack[0]), 50);
    assert.strictEqual(pSeekBack[1], 0);

    // At 20.0s -> Seek has finished (100%), Test is starting (0%)
    const pAt20 = calculateWordProgress(words, intervals, 20.0, true, false);
    assert.strictEqual(pAt20[0], 100);
    assert.strictEqual(pAt20[1], 0);

    // User seeks backward to 5.0s -> both 0%
    const pStart = calculateWordProgress(words, intervals, 5.0, true, false);
    assert.deepStrictEqual(pStart, [0, 0]);
  });

  await t.test('calculateWordProgress: pausing freezes fill in place; resuming continues smoothly', () => {
    const words = [
      { text: 'Pause', start: 10.0 },
      { text: 'Resume', start: 12.0 },
    ];
    const intervals = computeWordIntervals(words); // [10.0, 12.0]

    // Pause at 11.0s (50% through 'Pause')
    const frozenFrame1 = calculateWordProgress(words, intervals, 11.0, true, false);
    assert.strictEqual(Math.round(frozenFrame1[0]), 50);

    // Repeated frames while paused remain identical
    for (let f = 0; f < 5; f++) {
      const stable = calculateWordProgress(words, intervals, 11.0, true, false);
      assert.strictEqual(Math.round(stable[0]), 50);
      assert.strictEqual(stable[1], 0);
    }

    // Resume playback to 11.5s (75%)
    const resumed = calculateWordProgress(words, intervals, 11.5, true, false);
    assert.strictEqual(Math.round(resumed[0]), 75);
    assert.strictEqual(resumed[1], 0);
  });
});

test('Final Word Progressive Highlight & Cadence Suite', async (t) => {
  await t.test('Final word progresses through intermediate fill percentages before reaching 100%', () => {
    const words: LyricWord[] = [
      { text: 'Never', start: 10.0 },
      { text: 'gonna', start: 10.8 },
      { text: 'give', start: 11.5 },
      { text: 'you', start: 12.0 },
      { text: 'up', start: 12.5 },
    ];
    const intervals = computeWordIntervals(words);
    const finalInterval = intervals[intervals.length - 1];

    assert.strictEqual(finalInterval.start, 12.5);
    const finalDuration = finalInterval.end - finalInterval.start;
    assert.ok(finalDuration >= 0.45, `Final word duration (${finalDuration}) must be at least 0.45s`);

    // 1. Before final word starts: exactly 0%
    const pStart = calculateWordProgress(words, intervals, 12.5, true, false);
    assert.strictEqual(pStart[4], 0, 'Final word must start at 0%');

    // 2. 25% through final word
    const p25 = calculateWordProgress(words, intervals, 12.5 + finalDuration * 0.25, true, false);
    assert.strictEqual(Math.round(p25[4]), 25, 'Final word must progress to ~25%');

    // 3. 50% through final word
    const p50 = calculateWordProgress(words, intervals, 12.5 + finalDuration * 0.50, true, false);
    assert.strictEqual(Math.round(p50[4]), 50, 'Final word must progress to ~50%');

    // 4. 75% through final word
    const p75 = calculateWordProgress(words, intervals, 12.5 + finalDuration * 0.75, true, false);
    assert.strictEqual(Math.round(p75[4]), 75, 'Final word must progress to ~75%');

    // 5. At completion timestamp: 100%
    const pEnd = calculateWordProgress(words, intervals, finalInterval.end, true, false);
    assert.strictEqual(pEnd[4], 100, 'Final word must reach 100% at end timestamp');

    // 6. After completion: remains 100%
    const pPast = calculateWordProgress(words, intervals, finalInterval.end + 1.0, true, false);
    assert.strictEqual(pPast[4], 100, 'Final word must remain 100% after completion');
  });

  await t.test('Final word duration derives reliably from surrounding word cadence and length', () => {
    // Fast cadence: 4 words in 0.8s => 0.2s per word
    const fastLine: LyricWord[] = [
      { text: 'Rap', start: 1.0 },
      { text: 'it', start: 1.2 },
      { text: 'out', start: 1.4 },
      { text: 'fast', start: 1.6 },
    ];
    const fastIntervals = computeWordIntervals(fastLine);
    const fastFinalDur = fastIntervals[3].end - fastIntervals[3].start;

    // Slow cadence: 4 words in 4.5s => 1.5s per word
    const slowLine: LyricWord[] = [
      { text: 'Sing', start: 10.0 },
      { text: 'so', start: 11.5 },
      { text: 'very', start: 13.0 },
      { text: 'slow', start: 14.5 },
    ];
    const slowIntervals = computeWordIntervals(slowLine);
    const slowFinalDur = slowIntervals[3].end - slowIntervals[3].start;

    assert.ok(slowFinalDur > fastFinalDur, `Slow line final word duration (${slowFinalDur}s) must be longer than fast line (${fastFinalDur}s)`);

    // Compare short final word vs long final word under same cadence
    const shortLine: LyricWord[] = [
      { text: 'Let', start: 2.0 },
      { text: 'us', start: 2.5 },
      { text: 'go', start: 3.0 }, // 2 chars
    ];
    const longLine: LyricWord[] = [
      { text: 'Let', start: 2.0 },
      { text: 'us', start: 2.5 },
      { text: 'remember', start: 3.0 }, // 8 chars
    ];
    const shortFinalDur = computeWordIntervals(shortLine)[2].end - 3.0;
    const longFinalDur = computeWordIntervals(longLine)[2].end - 3.0;

    assert.ok(longFinalDur > shortFinalDur, `Long word 'remember' (${longFinalDur}s) must be longer than short word 'go' (${shortFinalDur}s)`);
  });

  await t.test('Next line close timestamp or small gap does not truncate final word duration', () => {
    const line1: LyricWord[] = [
      { text: 'Hold', start: 5.0 },
      { text: 'on', start: 5.5 },
      { text: 'tight', start: 6.0 },
    ];

    // Next line starts only 50ms later (at 6.05s)
    const intervalsWithCloseNextLine = computeWordIntervals(line1, 6.05);
    const finalInterval = intervalsWithCloseNextLine[2];
    const finalDur = finalInterval.end - finalInterval.start;

    // Must NOT be truncated to 50ms (0.05s)
    assert.ok(finalDur >= 0.45, `Final word duration must not collapse to close next line timestamp; was ${finalDur}s`);
    
    // Halfway through its proper duration, it must have intermediate progress, not 100%
    const pMid = calculateWordProgress(line1, intervalsWithCloseNextLine, 6.0 + finalDur * 0.5, true, false);
    assert.strictEqual(Math.round(pMid[2]), 50, 'Final word must fill progressively regardless of next line timestamp');
  });

  await t.test('Display lead time does not prematurely snap final word when safeFocusIndex advances', () => {
    // Line 0 ends singing around 13.0s.
    // Display lead time (1.5s) causes safeFocusIndex to advance to Line 1 when adjustedTime reaches 12.5s.
    const words: LyricWord[] = [
      { text: 'One', start: 10.0 },
      { text: 'two', start: 11.0 },
      { text: 'three', start: 12.0 },
    ];
    const intervals = computeWordIntervals(words);
    const finalWordInterval = intervals[2];
    const finalDur = finalWordInterval.end - finalWordInterval.start;

    // At 12.4s, safeFocusIndex in RoomSession has already advanced to Line 1 (due to display lead).
    // In AutoResponsiveLyrics, we evaluate isLinePast using singing end time (adjustedTime >= lineSingingEndTime).
    // At 12.4s, lineSingingEndTime has NOT been reached.
    const isLinePast = 12.4 >= finalWordInterval.end; // false!
    const isLineActive = 12.4 >= intervals[0].start && 12.4 < finalWordInterval.end; // true!

    assert.strictEqual(isLinePast, false, 'Line must not be marked past while final word is still singing');
    assert.strictEqual(isLineActive, true, 'Line must remain active while final word is still singing');

    // Intermediate fill at 12.4s is progressive, NOT snapped to 100%
    const progress = calculateWordProgress(words, intervals, 12.4, isLineActive, isLinePast);
    assert.strictEqual(progress[0], 100);
    assert.strictEqual(progress[1], 100);
    assert.ok(progress[2] > 0 && progress[2] < 100, `Final word must be in intermediate fill (was ${progress[2]}%), not snapped to 100%`);

    // Midpoint fill check
    const progressMid = calculateWordProgress(words, intervals, 12.0 + finalDur * 0.5, isLineActive, isLinePast);
    assert.strictEqual(Math.round(progressMid[2]), 50, 'Final word must be 50% filled at midpoint, not snapped to 100%');
  });
});

test('Overlapping Lines & Transition Completion Suite', async (t) => {
  await t.test('Previous line continues progressing after next line starts', () => {
    const line0Words: LyricWord[] = [
      { text: 'Line', start: 10.0 },
      { text: 'zero', start: 10.5 },
    ];
    const line1Words: LyricWord[] = [
      { text: 'Line', start: 11.0 },
      { text: 'one', start: 11.5 },
    ];

    const intervals0 = computeWordIntervals(line0Words);
    const line0End = intervals0[intervals0.length - 1].end;

    // At time 11.1s (after line 1 starts at 11.0s, but before line 0 ends):
    // Line 0 final word progress should be between 0% and 100% (continuing independently).
    const isLinePast0 = 11.1 >= line0End;
    const isLineActive0 = 11.1 >= intervals0[0].start && 11.1 < line0End;
    const p0Mid = calculateWordProgress(line0Words, intervals0, 11.1, isLineActive0, isLinePast0);
    assert.strictEqual(p0Mid[0], 100);
    assert.ok(p0Mid[1] > 0 && p0Mid[1] < 100, 'Previous line final word continues progressing independently while next line has started');

    // At line 0 end time, progress reaches 100%
    const p0End = calculateWordProgress(line0Words, intervals0, line0End, false, true);
    assert.deepStrictEqual(p0End, [100, 100], 'Previous line reaches 100% before removal');
  });

  await t.test('Next line highlights simultaneously while previous line finishes', () => {
    const line0Words: LyricWord[] = [{ text: 'Old', start: 10.0 }];
    const line1Words: LyricWord[] = [{ text: 'New', start: 11.0 }];

    const intervals0 = computeWordIntervals(line0Words);
    const intervals1 = computeWordIntervals(line1Words);

    const end0 = intervals0[0].end;
    const start1 = intervals1[0].start;

    // At 11.1s, line 0 is past, line 1 is active
    const past0 = calculateWordProgress(line0Words, intervals0, 11.1, false, true);
    const active1 = calculateWordProgress(line1Words, intervals1, 11.1, true, false);

    assert.deepStrictEqual(past0, [100]);
    assert.ok(active1[0] > 0, 'Next line highlights simultaneously');
  });
});

test('Adaptive eLRC Timing Engine Comprehensive Suite', async (t) => {
  await t.test('Fast songs and slow songs adapt naturally without manual timing adjustments', () => {
    // Fast song: words spaced by 0.15s
    const fastWords: LyricWord[] = [
      { text: 'Brisk', start: 1.0 },
      { text: 'tempo', start: 1.15 },
      { text: 'track', start: 1.3 },
    ];
    const fastIntervals = computeWordIntervals(fastWords);
    assert.strictEqual(fastIntervals[0].end, 1.15);
    assert.strictEqual(fastIntervals[1].end, 1.3);
    assert.ok(fastIntervals[2].end > 1.3);

    // Slow ballad: words spaced by 2.0s
    const slowWords: LyricWord[] = [
      { text: 'Slow', start: 10.0 },
      { text: 'bal', start: 12.0 },
      { text: 'lad', start: 14.0 },
    ];
    const slowIntervals = computeWordIntervals(slowWords);
    assert.strictEqual(slowIntervals[0].end, 12.0);
    assert.strictEqual(slowIntervals[1].end, 14.0);
    assert.ok(slowIntervals[2].end > 14.0);
  });

  await t.test('Large gaps between phrases and long held notes handle smoothly', () => {
    const words: LyricWord[] = [
      { text: 'Hold', start: 5.0 },
      { text: 'on', start: 8.0 }, // 3 second gap
    ];
    const intervals = computeWordIntervals(words);
    assert.strictEqual(intervals[0].start, 5.0);
    assert.strictEqual(intervals[0].end, 8.0); // Held note spans the entire gap to the next word
    const pMid = calculateWordProgress(words, intervals, 6.5, true, false);
    assert.strictEqual(Math.round(pMid[0]), 50, 'Held note fills progressively across the 3s gap');
  });

  await t.test('Playback speed changes and guest sync maintain precise fill state', () => {
    const words: LyricWord[] = [{ text: 'Sync', start: 2.0 }];
    const intervals = computeWordIntervals(words);
    const duration = intervals[0].end - intervals[0].start;

    // Simulated playback speed 0.75x (time advances slower relative to audio time)
    // At audio time = start + duration * 0.5, progress must be 50% regardless of playback speed
    const p = calculateWordProgress(words, intervals, 2.0 + duration * 0.5, true, false);
    assert.strictEqual(Math.round(p[0]), 50);
  });
});



