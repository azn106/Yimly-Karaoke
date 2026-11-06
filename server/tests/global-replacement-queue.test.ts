import test from 'node:test';
import assert from 'node:assert/strict';
import { DownloadQueueManager } from '../lib/download-queue.js';

test('GlobalQueue: FIFO ordering across all four job types with concurrency of 1', async () => {
  const queue = new DownloadQueueManager();

  assert.strictEqual(queue.getConcurrency(), 1, 'DownloadQueueManager must enforce concurrency of 1');

  const executionOrder: string[] = [];
  let concurrentExecutions = 0;
  let maxConcurrent = 0;

  // Intercept track processing
  (queue as any).processTrack = async (job: any, track: any) => {
    concurrentExecutions++;
    maxConcurrent = Math.max(maxConcurrent, concurrentExecutions);
    const label = job.id === 'job_karaoke' ? `karaoke_download:${track.id}` : `admin_download:${track.id}`;
    executionOrder.push(`start:${label}`);
    track.status = 'downloading';
    await new Promise(r => setTimeout(r, 20));
    track.status = 'completed';
    executionOrder.push(`finish:${label}`);
    concurrentExecutions--;
  };

  (queue as any).checkJobCompletion = async () => {};

  // Mock download jobs in memory
  const adminJob: any = {
    id: 'job_admin',
    status: 'downloading',
    tracks: [{ id: 'track_admin_1', status: 'queued', jobId: 'job_admin' }],
  };
  const karaokeJob: any = {
    id: 'job_karaoke',
    status: 'downloading',
    tracks: [{ id: 'track_karaoke_1', status: 'queued', jobId: 'job_karaoke' }],
  };
  (queue as any).memoryJobs.set('job_admin', adminJob);
  (queue as any).memoryJobs.set('job_karaoke', karaokeJob);

  // Pause queue pumping momentarily to queue all 4 items in FIFO order
  const originalPump = (queue as any).pumpQueue.bind(queue);
  let paused = true;
  (queue as any).pumpQueue = () => {
    if (paused) return;
    originalPump();
  };

  // 1. Admin download
  (queue as any).fifoQueue.push({ kind: 'download_track', jobId: 'job_admin', trackId: 'track_admin_1' });

  // 2. Replace Audio
  const replaceAudioPromise = queue.enqueueReplacementJob({
    id: 'rep_audio_101',
    songId: 101,
    type: 'replace_audio',
    execute: async (state) => {
      concurrentExecutions++;
      maxConcurrent = Math.max(maxConcurrent, concurrentExecutions);
      executionOrder.push(`start:replace_audio:${state.id}`);
      state.status = 'downloading';
      await new Promise(r => setTimeout(r, 15));
      state.status = 'separating';
      await new Promise(r => setTimeout(r, 15));
      state.status = 'finalising';
      await new Promise(r => setTimeout(r, 15));
      state.status = 'completed';
      executionOrder.push(`finish:replace_audio:${state.id}`);
      concurrentExecutions--;
      return { success: true, songId: 101 };
    },
  });

  // 3. Karaoke download
  (queue as any).fifoQueue.push({ kind: 'download_track', jobId: 'job_karaoke', trackId: 'track_karaoke_1' });

  // 4. Replace Instrumental
  const replaceInstPromise = queue.enqueueReplacementJob({
    id: 'rep_inst_102',
    songId: 102,
    type: 'replace_instrumental',
    execute: async (state) => {
      concurrentExecutions++;
      maxConcurrent = Math.max(maxConcurrent, concurrentExecutions);
      executionOrder.push(`start:replace_instrumental:${state.id}`);
      state.status = 'separating';
      await new Promise(r => setTimeout(r, 15));
      state.status = 'finalising';
      await new Promise(r => setTimeout(r, 15));
      state.status = 'completed';
      executionOrder.push(`finish:replace_instrumental:${state.id}`);
      concurrentExecutions--;
      return { success: true, songId: 102 };
    },
  });

  // Now resume queue pump
  paused = false;
  (queue as any).pumpQueue = originalPump;
  (queue as any).pumpQueue();

  // Await completion of replacements
  await Promise.all([replaceAudioPromise, replaceInstPromise]);

  // Wait for queue to drain completely
  while ((queue as any).activeWorkers > 0 || (queue as any).fifoQueue.length > 0) {
    await new Promise(r => setTimeout(r, 20));
  }

  assert.strictEqual(maxConcurrent, 1, 'Concurrency must strictly remain 1 at all times');

  assert.deepStrictEqual(executionOrder, [
    'start:admin_download:track_admin_1',
    'finish:admin_download:track_admin_1',
    'start:replace_audio:rep_audio_101',
    'finish:replace_audio:rep_audio_101',
    'start:karaoke_download:track_karaoke_1',
    'finish:karaoke_download:track_karaoke_1',
    'start:replace_instrumental:rep_inst_102',
    'finish:replace_instrumental:rep_inst_102',
  ], 'Queue must execute all 4 job types in strict FIFO order');
});

test('Replacement jobs retain queue slot throughout processing lifecycle', async () => {
  const queue = new DownloadQueueManager();

  const observedActiveWorkers: number[] = [];

  const jobPromise = queue.enqueueReplacementJob({
    id: 'rep_audio_lifecycle',
    songId: 200,
    type: 'replace_audio',
    execute: async (state) => {
      observedActiveWorkers.push((queue as any).activeWorkers);
      assert.strictEqual(state.status, 'queued');

      state.status = 'downloading';
      observedActiveWorkers.push((queue as any).activeWorkers);
      await new Promise(r => setTimeout(r, 10));

      state.status = 'separating';
      observedActiveWorkers.push((queue as any).activeWorkers);
      await new Promise(r => setTimeout(r, 10));

      state.status = 'finalising';
      observedActiveWorkers.push((queue as any).activeWorkers);
      await new Promise(r => setTimeout(r, 10));

      state.status = 'completed';
      return { success: true, songId: 200 };
    },
  });

  await jobPromise;

  assert.ok(observedActiveWorkers.length >= 4, 'Should have checked active workers in multiple stages');
  for (const count of observedActiveWorkers) {
    assert.strictEqual(count, 1, 'Queue slot (activeWorkers=1) must be retained in all lifecycle stages');
  }

  // After completion, active workers drops back to 0
  assert.strictEqual((queue as any).activeWorkers, 0, 'Worker slot must be released after completion');
});

test('Song replacement queries independently distinguish audio vs instrumental for the same song', async () => {
  const queue = new DownloadQueueManager();

  let resolveAudio: any;
  const audioDeferred = new Promise(r => { resolveAudio = r; });

  const audioP = queue.enqueueReplacementJob({
    id: 'rep_audio_same_song',
    songId: 300,
    type: 'replace_audio',
    execute: async (state) => {
      state.status = 'downloading';
      await audioDeferred;
      state.status = 'completed';
      return { success: true, songId: 300 };
    },
  });

  const instP = queue.enqueueReplacementJob({
    id: 'rep_inst_same_song',
    songId: 300,
    type: 'replace_instrumental',
    execute: async (state) => {
      state.status = 'separating';
      state.status = 'completed';
      return { success: true, songId: 300 };
    },
  });

  // While audio is active in downloading:
  const audioJob = queue.getReplacementJob('rep_audio_same_song');
  const instJob = queue.getReplacementJob('rep_inst_same_song');

  assert.ok(audioJob, 'Audio job exists');
  assert.ok(instJob, 'Inst job exists');
  assert.strictEqual(audioJob?.type, 'replace_audio');
  assert.strictEqual(instJob?.type, 'replace_instrumental');
  assert.strictEqual(audioJob?.status, 'downloading');
  assert.strictEqual(instJob?.status, 'queued', 'Second job is waiting in FIFO queue');

  const songJobs = queue.getSongReplacements(300);
  assert.strictEqual(songJobs.length, 2, 'Song 300 has two independent jobs');
  const songAudio = songJobs.find(j => j.type === 'replace_audio');
  const songInst = songJobs.find(j => j.type === 'replace_instrumental');
  assert.ok(songAudio && songInst, 'Both audio and instrumental jobs are found');
  assert.notStrictEqual(songAudio.jobId, songInst.jobId, 'Audio and instrumental IDs are distinct');

  // Let audio finish so instrumental runs
  resolveAudio();
  await audioP;
  await instP;

  assert.strictEqual(queue.getReplacementJob('rep_audio_same_song')?.status, 'completed');
  assert.strictEqual(queue.getReplacementJob('rep_inst_same_song')?.status, 'completed');
});

test('Replacement error rollback handling releases queue and preserves queue processing', async () => {
  const queue = new DownloadQueueManager();
  const sequence: string[] = [];

  const failingJob = queue.enqueueReplacementJob({
    id: 'rep_failing_job',
    songId: 400,
    type: 'replace_audio',
    execute: async (state) => {
      sequence.push('start:failing');
      state.status = 'downloading';
      throw new Error('Simulated download network failure');
    },
  });

  const succeedingJob = queue.enqueueReplacementJob({
    id: 'rep_succeeding_job',
    songId: 401,
    type: 'replace_instrumental',
    execute: async (state) => {
      sequence.push('start:succeeding');
      state.status = 'completed';
      return { success: true, songId: 401 };
    },
  });

  const [res1, res2] = await Promise.all([failingJob, succeedingJob]);

  assert.strictEqual(res1.success, false, 'Failed job must return failure');
  assert.strictEqual(res2.success, true, 'Subsequent job in FIFO queue must succeed');

  const failedState = queue.getReplacementJob('rep_failing_job');
  assert.strictEqual(failedState?.status, 'failed');
  assert.ok(failedState?.error?.includes('Simulated download network failure'));

  assert.deepStrictEqual(sequence, ['start:failing', 'start:succeeding'], 'Queue continued draining after failure');
  assert.strictEqual((queue as any).activeWorkers, 0, 'Active workers must be 0 after jobs complete');
});

test('Job cancellation correctly cancels queued replacement without blocking queue', async () => {
  const queue = new DownloadQueueManager();

  let unblockFirst: any;
  const firstBlock = new Promise(r => { unblockFirst = r; });

  const firstJob = queue.enqueueReplacementJob({
    id: 'rep_blocking_1',
    songId: 501,
    type: 'replace_audio',
    execute: async () => {
      await firstBlock;
      return { success: true, songId: 501 };
    },
  });

  const secondJob = queue.enqueueReplacementJob({
    id: 'rep_cancelled_2',
    songId: 502,
    type: 'replace_instrumental',
    execute: async () => {
      return { success: true, songId: 502 };
    },
  });

  const thirdJob = queue.enqueueReplacementJob({
    id: 'rep_third_3',
    songId: 503,
    type: 'replace_audio',
    execute: async () => {
      return { success: true, songId: 503 };
    },
  });

  // Cancel the queued second job before it starts
  const cancelResult = await queue.cancelJob('rep_cancelled_2');
  assert.strictEqual(cancelResult, true, 'Cancellation of queued replacement job should succeed');

  const cancelledJobState = queue.getReplacementJob('rep_cancelled_2');
  assert.strictEqual(cancelledJobState?.status, 'cancelled');
  assert.ok(cancelledJobState?.error?.includes('cancelled'));

  // Unblock first job
  unblockFirst();
  const [r1, r2, r3] = await Promise.all([firstJob, secondJob, thirdJob]);

  assert.strictEqual(r1.success, true);
  assert.strictEqual(r2.success, false);
  assert.strictEqual(r3.success, true, 'Third job ran after first job without being blocked by cancelled job');
});
