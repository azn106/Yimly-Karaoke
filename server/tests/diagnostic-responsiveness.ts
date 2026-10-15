import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { db, setupDatabase } from '../db/index.js';
import { sessions, queueItems, libraries, users, controllers, songs } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import karaokeRoutes from '../routes/karaoke.js';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import NodeID3 from 'node-id3';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev';

function measureEventLoopLag(durationMs = 500): Promise<{ maxLagMs: number; avgLagMs: number; samples: number }> {
  return new Promise((resolve) => {
    let maxLag = 0;
    let totalLag = 0;
    let samples = 0;
    let lastTime = performance.now();
    const intervalMs = 10;

    const timer = setInterval(() => {
      const now = performance.now();
      const delta = now - lastTime;
      const lag = Math.max(0, delta - intervalMs);
      if (lag > maxLag) maxLag = lag;
      totalLag += lag;
      samples++;
      lastTime = now;
    }, intervalMs);

    setTimeout(() => {
      clearInterval(timer);
      resolve({
        maxLagMs: Math.round(maxLag * 100) / 100,
        avgLagMs: samples > 0 ? Math.round((totalLag / samples) * 100) / 100 : 0,
        samples,
      });
    }, durationMs);
  });
}

async function runDiagnostics() {
  console.log('=== YIMLY RESPONSIVENESS BASELINE DIAGNOSTIC ===');

  await setupDatabase();

  // 1. Measure Idle Event Loop Lag
  const idleLag = await measureEventLoopLag(500);
  console.log(`[Baseline] Idle Event Loop Lag: avg=${idleLag.avgLagMs}ms, max=${idleLag.maxLagMs}ms (${idleLag.samples} samples)`);

  // 2. Measure Synchronous File Operations vs Asynchronous on Event Loop
  const testDir = path.join(process.cwd(), 'data', 'tmp_diagnostic_test');
  fs.mkdirSync(testDir, { recursive: true });
  const sampleFilePath = path.join(testDir, 'sample_30mb.bin');
  const targetSyncCopy = path.join(testDir, 'copy_sync.bin');
  const targetAsyncCopy = path.join(testDir, 'copy_async.bin');

  const buf25mb = Buffer.alloc(25 * 1024 * 1024, 0x41);
  fs.writeFileSync(sampleFilePath, buf25mb);

  const syncLagPromise = measureEventLoopLag(400);
  const syncStart = performance.now();
  fs.copyFileSync(sampleFilePath, targetSyncCopy);
  const syncDuration = performance.now() - syncStart;
  const syncLag = await syncLagPromise;
  console.log(`[Test] fs.copyFileSync (25MB): duration=${Math.round(syncDuration * 100) / 100}ms, event-loop freeze maxLag=${syncLag.maxLagMs}ms`);

  const asyncLagPromise = measureEventLoopLag(400);
  const asyncStart = performance.now();
  await fs.promises.copyFile(sampleFilePath, targetAsyncCopy);
  const asyncDuration = performance.now() - asyncStart;
  const asyncLag = await asyncLagPromise;
  console.log(`[Test] fs.promises.copyFile (25MB): duration=${Math.round(asyncDuration * 100) / 100}ms, event-loop freeze maxLag=${asyncLag.maxLagMs}ms`);

  // Measure Synchronous NodeID3.write vs NodeID3.Promise.write
  const mp3Sample = path.join(testDir, 'test_tag.mp3');
  const fakeMp3 = Buffer.alloc(10 * 1024 * 1024);
  fakeMp3[0] = 0xff; fakeMp3[1] = 0xfb;
  fs.writeFileSync(mp3Sample, fakeMp3);

  const syncTagLagPromise = measureEventLoopLag(300);
  const syncTagStart = performance.now();
  NodeID3.write({ title: 'Test Title', artist: 'Test Artist', album: 'Test Album' }, mp3Sample);
  const syncTagDuration = performance.now() - syncTagStart;
  const syncTagLag = await syncTagLagPromise;
  console.log(`[Test] NodeID3.write (synchronous): duration=${Math.round(syncTagDuration * 100) / 100}ms, event-loop maxLag=${syncTagLag.maxLagMs}ms`);

  const asyncTagLagPromise = measureEventLoopLag(300);
  const asyncTagStart = performance.now();
  await NodeID3.Promise.write({ title: 'Test Title 2', artist: 'Test Artist 2', album: 'Test Album 2' }, mp3Sample);
  const asyncTagDuration = performance.now() - asyncTagStart;
  const asyncTagLag = await asyncTagLagPromise;
  console.log(`[Test] NodeID3.Promise.write (asynchronous): duration=${Math.round(asyncTagDuration * 100) / 100}ms, event-loop maxLag=${asyncTagLag.maxLagMs}ms`);

  // 3. Measure HTTP Endpoint Latency on Karaoke Room (Idle)
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/karaoke', karaokeRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Create an active test user & session
  let adminUser = await db.select().from(users).where(eq(users.role, 'administrator')).limit(1);
  if (adminUser.length === 0) {
    const inserted = await db.insert(users).values({
      username: 'diag_admin',
      password: 'hashedpassword',
      role: 'administrator',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    adminUser = inserted;
  }
  const token = jwt.sign({ id: adminUser[0].id, username: adminUser[0].username, role: 'administrator' }, JWT_SECRET, { expiresIn: '1h' });

  const sessionId = `diag_session_${Date.now()}`;
  await db.insert(sessions).values({
    id: sessionId,
    roomCode: '999 888',
    hostId: adminUser[0].id,
    hostDevice: 'Diagnostic Test Device',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Measure Idle HTTP Latency (10 requests)
  const idleLatencies: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    const res = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/state`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const dur = performance.now() - t0;
    if (res.ok) idleLatencies.push(dur);
  }
  const avgIdleHttp = Math.round((idleLatencies.reduce((a, b) => a + b, 0) / idleLatencies.length) * 100) / 100;
  const maxIdleHttp = Math.round(Math.max(...idleLatencies) * 100) / 100;
  console.log(`[HTTP Test] Room State endpoint (IDLE): avg=${avgIdleHttp}ms, max=${maxIdleHttp}ms`);

  // Measure Heartbeat latency (IDLE)
  const tHeartbeat0 = performance.now();
  const hbRes = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/heartbeat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  const hbDuration = Math.round((performance.now() - tHeartbeat0) * 100) / 100;
  console.log(`[HTTP Test] Host Heartbeat endpoint (IDLE): duration=${hbDuration}ms (status=${hbRes.status})`);

  // 4. Measure HTTP Room State Latency WHILE a Heavy Tagging / File Copy is running
  // We simulate what happened when synchronous copyFileSync and NodeID3.write blocked the event loop
  const busyLatencies: number[] = [];
  const startBusyTag = performance.now();
  
  // Launch 5 parallel state requests while copyFileSync runs
  const stateReqs = Promise.all([
    fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/state`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/state`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/state`, { headers: { Authorization: `Bearer ${token}` } }),
  ]);

  // Synchronous blocking work on main event loop:
  fs.copyFileSync(sampleFilePath, targetSyncCopy);
  NodeID3.write({ title: 'Simulated Tag Block' }, mp3Sample);

  const stateResults = await stateReqs;
  const busyDuration = performance.now() - startBusyTag;
  console.log(`[HTTP Test] Room State requests during synchronous file blocking: all resolved=${stateResults.every(r => r.ok)}, duration=${Math.round(busyDuration * 100) / 100}ms`);

  // Cleanup test session & server
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  server.close();

  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  console.log('=== DIAGNOSTIC COMPLETE ===');
}

runDiagnostics().catch(console.error);
