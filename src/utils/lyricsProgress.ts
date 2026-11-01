export interface LyricWord {
  text: string;
  start: number;
}

export interface WordInterval {
  start: number;
  end: number;
}

/**
 * Computes contiguous playback intervals [start, end] for each word in an eLRC line.
 * 
 * Rules:
 * - Each word begins filling at its start timestamp.
 * - Each internal word finishes filling at the start timestamp of the next word.
 * - Words with identical timestamps are grouped into clusters and smoothly partitioned by word length.
 * - The final word's duration is derived reliably from the line's established word cadence and phonetic length,
 *   ensuring it behaves like every other word with a smooth progressive left-to-right fill.
 * - The next lyric line's timestamp is NOT used to truncate the final word's singing duration,
 *   preventing instant snaps when lines have close timestamps or small gaps.
 * - All intervals have strictly positive durations (end > start).
 */
export function computeWordIntervals(words: LyricWord[], _nextLineTime?: number): WordInterval[] {
  if (!words || words.length === 0) return [];
  const N = words.length;

  // Single-word line: duration derived from word length and vocal phrasing
  if (N === 1) {
    const singleWord = words[0];
    const len = Math.max(1, singleWord.text.length);
    // Base sustain ~0.4s plus ~0.12s per character, bounded between 0.45s and 2.5s
    const duration = Math.max(0.45, Math.min(2.5, 0.35 + len * 0.12));
    return [{ start: singleWord.start, end: singleWord.start + duration }];
  }

  // Ensure non-decreasing start times
  const sanitizedStarts: number[] = new Array(N);
  sanitizedStarts[0] = words[0].start;
  for (let i = 1; i < N; i++) {
    sanitizedStarts[i] = Math.max(sanitizedStarts[i - 1], words[i].start);
  }

  // Group words into clusters of identical start times
  interface Cluster {
    indices: number[];
    startTime: number;
  }
  const clusters: Cluster[] = [];
  let currentCluster: Cluster = { indices: [0], startTime: sanitizedStarts[0] };

  for (let i = 1; i < N; i++) {
    if (sanitizedStarts[i] === currentCluster.startTime) {
      currentCluster.indices.push(i);
    } else {
      clusters.push(currentCluster);
      currentCluster = { indices: [i], startTime: sanitizedStarts[i] };
    }
  }
  clusters.push(currentCluster);

  // Compute duration for the last cluster based on surrounding line cadence
  const lastCluster = clusters[clusters.length - 1];
  const numInLast = lastCluster.indices.length;
  let lastClusterDuration: number;

  const totalCharsInLast = lastCluster.indices.reduce((sum, idx) => sum + Math.max(1, words[idx].text.length), 0);

  if (clusters.length > 1) {
    const precedingSpan = lastCluster.startTime - clusters[0].startTime;
    const precedingWordCount = N - numInLast;
    const precedingChars = clusters
      .slice(0, clusters.length - 1)
      .reduce((acc, c) => acc + c.indices.reduce((sum, idx) => sum + Math.max(1, words[idx].text.length), 0), 0);

    if (precedingSpan > 0 && precedingChars > 0 && precedingWordCount > 0) {
      const secPerChar = precedingSpan / precedingChars;
      const avgWordDur = precedingSpan / precedingWordCount;
      // In vocal performance, final phrase words carry a natural vocal sustain (elongation factor 1.25)
      const cadenceDuration = totalCharsInLast * secPerChar * 1.25;
      const wordCountDuration = numInLast * avgWordDur * 1.25;
      const blended = 0.6 * cadenceDuration + 0.4 * wordCountDuration;
      // Clamp between sensible human vocal bounds: minimum 0.45s per word up to 3.0s per word
      lastClusterDuration = Math.max(0.45 * numInLast, Math.min(3.0 * numInLast, blended));
    } else {
      // Preceding clusters had 0 span; use length-based phrasing
      lastClusterDuration = Math.max(0.45 * numInLast, Math.min(2.5 * numInLast, 0.35 * numInLast + totalCharsInLast * 0.12));
    }
  } else {
    // All words in line share identical start timestamp
    lastClusterDuration = Math.max(0.45 * numInLast, Math.min(2.5 * numInLast, 0.35 * numInLast + totalCharsInLast * 0.12));
  }

  const intervals: WordInterval[] = new Array(N);

  for (let c = 0; c < clusters.length; c++) {
    const cluster = clusters[c];
    const isLastCluster = c === clusters.length - 1;
    const clusterStart = cluster.startTime;
    const clusterEnd = isLastCluster ? clusterStart + lastClusterDuration : clusters[c + 1].startTime;
    const clusterSpan = Math.max(0.005 * cluster.indices.length, clusterEnd - clusterStart);

    const totalWeight = cluster.indices.reduce((acc, idx) => acc + Math.max(1, words[idx].text.length), 0);

    let currStart = clusterStart;
    for (let j = 0; j < cluster.indices.length; j++) {
      const wordIdx = cluster.indices[j];
      const weight = Math.max(1, words[wordIdx].text.length);
      const isLastWordInCluster = j === cluster.indices.length - 1;
      const wordDur = isLastWordInCluster
        ? Math.max(0.002, clusterEnd - currStart)
        : (clusterSpan * weight) / totalWeight;
      const wordEnd = isLastWordInCluster ? clusterEnd : currStart + wordDur;

      intervals[wordIdx] = {
        start: currStart,
        end: wordEnd,
      };
      currStart = wordEnd;
    }
  }

  return intervals;
}

/**
 * Calculates continuous left-to-right fill percentage (0 to 100) for each word.
 * 
 * Rules:
 * - When in preview mode: Word 0 is 100%, Word 1 is 65% (demonstration fill), rest 0%.
 * - Word progress is authoritatively derived from adjustedTime vs the word's [start, end] interval.
 * - Before its start timestamp: word progress is 0%.
 * - Between start and end: word progressively fills from 0% to 100% from left to right.
 * - At and after end timestamp: word reaches 100% and remains fully highlighted.
 * - The final word is NOT forced to 100% prematurely when safeFocusIndex moves ahead for display lead.
 * - Earlier words are guaranteed 100% when a later word starts (word order monotonicity).
 */
export function calculateWordProgress(
  words: LyricWord[],
  intervals: WordInterval[],
  adjustedTime: number,
  isLineActive?: boolean,
  isLinePast?: boolean,
  isPreview: boolean = false
): number[] {
  if (!words || words.length === 0) return [];

  if (isPreview) {
    return words.map((_, i) => (i === 0 ? 100 : i === 1 ? 65 : 0));
  }

  // If explicitly marked past and playback time has reached or passed the line singing end
  if (isLinePast && (adjustedTime === 0 || intervals.length === 0 || adjustedTime >= intervals[intervals.length - 1].end)) {
    return words.map(() => 100);
  }

  // If line has not started singing yet
  if (isLineActive === false && !isLinePast && intervals.length > 0 && adjustedTime < intervals[0].start) {
    return words.map(() => 0);
  }

  const progress = new Array<number>(words.length);

  for (let i = 0; i < words.length; i++) {
    const interval = intervals[i];
    if (!interval) {
      progress[i] = 0;
      continue;
    }
    const { start, end } = interval;
    if (adjustedTime <= start) {
      progress[i] = 0;
    } else if (adjustedTime >= end) {
      progress[i] = 100;
    } else {
      const span = end - start;
      const fraction = span > 0 ? (adjustedTime - start) / span : 1;
      progress[i] = Math.max(0, Math.min(100, fraction * 100));
    }
  }

  // Authoritative Monotonicity: Earlier words must be 100% once later words begin
  let latestStartedIndex = -1;
  for (let i = 0; i < progress.length; i++) {
    if (progress[i] > 0) {
      latestStartedIndex = i;
    }
  }

  if (latestStartedIndex > 0) {
    for (let i = 0; i < latestStartedIndex; i++) {
      progress[i] = 100;
    }
  }

  return progress;
}

export function getLineSingingStartTime(line: { time: number; words?: LyricWord[] } | undefined): number {
  if (!line) return 0;
  if (line.words && line.words.length > 0 && typeof line.words[0].start === 'number') {
    return line.words[0].start;
  }
  return line.time;
}

export function getLineSingingEndTime(line: { time: number; words?: LyricWord[] } | undefined): number {
  if (!line) return 0;
  if (line.words && line.words.length > 0) {
    const intervals = computeWordIntervals(line.words);
    if (intervals.length > 0) {
      return intervals[intervals.length - 1].end;
    }
  }
  return line.time + 3.0;
}

