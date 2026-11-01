import { test } from 'node:test';
import assert from 'node:assert';

// Simulated logic from AutoResponsiveLyrics.tsx and RoomSession.tsx
function calculateTiming(firstWordTimestamp: number, leadInMs: number) {
  const transitionDuration = 1.5;
  const leadSec = Math.max(1500, leadInMs) / 1000;
  
  // RoomSession scheduling logic
  const schedulingTime = firstWordTimestamp - leadSec;
  
  // AutoResponsiveLyrics transition logic
  const transitionDelay = Math.max(0, leadSec - transitionDuration);
  
  const transitionStartTime = schedulingTime + transitionDelay;
  const transitionEndTime = transitionStartTime + transitionDuration;
  
  return {
    schedulingTime,
    transitionStartTime,
    transitionEndTime,
    transitionDelay
  };
}

test('Lyrics Transition Timing Refinement', async (t) => {
  await t.test('Transition finishes EXACTLY at first-word timestamp when lead is 1500ms', () => {
    const firstWord = 10.0;
    const lead = 1500;
    const result = calculateTiming(firstWord, lead);
    
    assert.strictEqual(result.transitionDelay, 0, 'Delay should be 0 when lead matches duration');
    assert.strictEqual(result.transitionEndTime, 10.0, 'Transition must end at first-word timestamp');
    assert.strictEqual(result.transitionStartTime, 8.5, 'Transition must start 1.5s before first-word');
  });

  await t.test('Transition finishes EXACTLY at first-word timestamp when lead is 2000ms', () => {
    const firstWord = 10.0;
    const lead = 2000;
    const result = calculateTiming(firstWord, lead);
    
    assert.strictEqual(result.transitionDelay, 0.5, 'Delay should be lead - 1.5');
    assert.strictEqual(result.transitionEndTime, 10.0, 'Transition must end at first-word timestamp');
    assert.strictEqual(result.transitionStartTime, 8.5, 'Transition must start 1.5s before first-word');
  });

  await t.test('Minimum lead is enforced in timing calculation', () => {
    const firstWord = 10.0;
    const lead = 500; // Below minimum
    const result = calculateTiming(firstWord, lead);
    
    assert.strictEqual(result.transitionEndTime, 10.0, 'Should still end at first-word timestamp due to minimum enforcement');
    assert.strictEqual(result.transitionDelay, 0, 'Delay should be 0 for minimum lead');
  });
});
