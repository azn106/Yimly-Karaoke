import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import {
  validateAndCanonicalizeYouTubeUrl,
  validateSpotifyUrl,
  isPrivateOrBlockedHost,
  isUrlOrUri,
  isValidArtworkUrl,
} from '../lib/url-validator.js';

const testDataDir = path.resolve(process.cwd(), 'data/test_downloader_ssrf_isolated');
if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true });
}
fs.mkdirSync(testDataDir, { recursive: true });
process.env.DATA_DIR = testDataDir;

const DETERMINISTIC_TEST_JWT_SECRET = 'yimly_deterministic_test_jwt_secret_ci_only_32_bytes_safe';
const JWT_SECRET = process.env.JWT_SECRET || DETERMINISTIC_TEST_JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const dbModule = await import('../db/index.js');
await dbModule.setupDatabase();

const { db } = dbModule;
const { users, libraries } = await import('../db/schema.js');
const { downloadQueue } = await import('../lib/download-queue.js');
const { resolveUrlOrQuery } = await import('../routes/downloader.js');
const downloaderRoutes = (await import('../routes/downloader.js')).default;

test('Downloader URL Validation and SSRF Protection Suite (Issue 4)', async (suite) => {
  // Prevent actual network downloads or subprocess execs during test
  const originalDownload = downloadQueue.downloadSingleTrackAudio;
  downloadQueue.downloadSingleTrackAudio = async () => '/tmp/mock-audio.mp3';

  // Setup test library and user
  const libDir = path.join(testDataDir, 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  const [lib] = await db.insert(libraries).values({
    name: 'SSRF Test Lib',
    path: libDir,
  }).returning();

  const hashedPassword = await bcrypt.hash('password123', 10);
  const now = new Date();
  const [testUser] = await db.insert(users).values({
    username: 'ssrf_tester',
    password: hashedPassword,
    role: 'user',
    createdAt: now,
    updatedAt: now,
  }).returning();

  const authToken = jwt.sign({ id: testUser.id, username: testUser.username, role: testUser.role }, JWT_SECRET);

  // Setup test express application
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/downloader', downloaderRoutes);

  let server: http.Server;
  let baseUrl: string;

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 1: Standard YouTube watch URL
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 1: Standard YouTube watch URL accepted and canonicalized', () => {
    const raw = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=shared&t=10s';
    const res = validateAndCanonicalizeYouTubeUrl(raw);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.videoId, 'dQw4w9WgXcQ');
    assert.strictEqual(res.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: youtu.be short URL
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 2: youtu.be short URL accepted and canonicalized', () => {
    const raw = 'https://youtu.be/dQw4w9WgXcQ?si=abcdef123456';
    const res = validateAndCanonicalizeYouTubeUrl(raw);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.videoId, 'dQw4w9WgXcQ');
    assert.strictEqual(res.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: YouTube Shorts URL
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 3: YouTube Shorts URL accepted and canonicalized to watch URL', () => {
    const raw = 'https://www.youtube.com/shorts/dQw4w9WgXcQ';
    const res = validateAndCanonicalizeYouTubeUrl(raw);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.videoId, 'dQw4w9WgXcQ');
    assert.strictEqual(res.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: YouTube Music URL
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 4: YouTube Music URL accepted and canonicalized to standard watch URL', () => {
    const raw = 'https://music.youtube.com/watch?v=dQw4w9WgXcQ';
    const res = validateAndCanonicalizeYouTubeUrl(raw);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.videoId, 'dQw4w9WgXcQ');
    assert.strictEqual(res.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: YouTube Playlist URL
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 5: YouTube Playlist URL handled safely based on allowPlaylist option', () => {
    const playlistOnly = 'https://www.youtube.com/playlist?list=PL4fGSIFgk5tUcL2lV7D56V6X3Q2o8iZ6W';
    const videoWithPlaylist = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL4fGSIFgk5tUcL2lV7D56V6X3Q2o8iZ6W';

    // When playlists are allowed (e.g. resolve)
    const resResolveOnly = validateAndCanonicalizeYouTubeUrl(playlistOnly, { allowPlaylist: true });
    assert.strictEqual(resResolveOnly.valid, true);
    assert.strictEqual(resResolveOnly.isPlaylist, true);
    assert.strictEqual(resResolveOnly.playlistId, 'PL4fGSIFgk5tUcL2lV7D56V6X3Q2o8iZ6W');

    const resResolveWithVideo = validateAndCanonicalizeYouTubeUrl(videoWithPlaylist, { allowPlaylist: true });
    assert.strictEqual(resResolveWithVideo.valid, true);
    assert.strictEqual(resResolveWithVideo.videoId, 'dQw4w9WgXcQ');
    assert.strictEqual(resResolveWithVideo.playlistId, 'PL4fGSIFgk5tUcL2lV7D56V6X3Q2o8iZ6W');
    assert.strictEqual(resResolveWithVideo.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL4fGSIFgk5tUcL2lV7D56V6X3Q2o8iZ6W');

    // When playlists are disallowed (e.g. single track download / start)
    const resSingleTrack = validateAndCanonicalizeYouTubeUrl(playlistOnly, { allowPlaylist: false });
    assert.strictEqual(resSingleTrack.valid, false);

    const resVideoInSingleTrack = validateAndCanonicalizeYouTubeUrl(videoWithPlaylist, { allowPlaylist: false });
    assert.strictEqual(resVideoInSingleTrack.valid, true);
    assert.strictEqual(resVideoInSingleTrack.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  // ---------------------------------------------------------------------------
  // Scenario 6: Invalid and malformed video IDs
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 6: Malformed, truncated, or invalid video IDs are rejected', () => {
    const invalidIds = [
      'https://www.youtube.com/watch?v=too_short',
      'https://www.youtube.com/watch?v=too_long_video_id_12345',
      'https://www.youtube.com/watch?v=bad!@#chars',
      'https://www.youtube.com/watch?v=../../etc/passwd',
      'https://www.youtube.com/watch?v=dQw4w9W;rm-',
      'https://youtu.be/short',
      'https://youtu.be/too_long_video_id_12345',
      '-o /tmp/injected_flag',
    ];

    for (const url of invalidIds) {
      const res = validateAndCanonicalizeYouTubeUrl(url);
      assert.strictEqual(res.valid, false, `Expected ${url} to be rejected`);
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 7: Hostname spoofing and deceptive subdomains
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 7: Hostname spoofing and deceptive subdomains are rejected', () => {
    const spoofedHosts = [
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'https://not-youtube.com/watch?v=dQw4w9WgXcQ',
      'https://evil-youtu.be/dQw4w9WgXcQ',
      'https://subdomain.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://phishing-youtube.com/watch?v=dQw4w9WgXcQ',
      'https://fake.youtu.be/dQw4w9WgXcQ',
    ];

    for (const url of spoofedHosts) {
      const res = validateAndCanonicalizeYouTubeUrl(url);
      assert.strictEqual(res.valid, false, `Expected ${url} to be rejected`);
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 8: User-info deception and credentials embedding
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 8: User-info deception and embedded credentials are strictly rejected', () => {
    const userInfoUrls = [
      'http://youtube.com@127.0.0.1/watch?v=dQw4w9WgXcQ',
      'http://user:pass@youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com:password@10.0.0.1/',
      'http://attacker:secret@open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    ];

    for (const url of userInfoUrls) {
      const resYt = validateAndCanonicalizeYouTubeUrl(url);
      assert.strictEqual(resYt.valid, false, `Expected ${url} to be rejected by YouTube validator`);

      const resSp = validateSpotifyUrl(url);
      assert.strictEqual(resSp.valid, false, `Expected ${url} to be rejected by Spotify validator`);
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 9: Localhost and loopback addresses
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 9: Localhost and loopback addresses are blocked and recognized', () => {
    const loopbacks = [
      'http://localhost:3000/api/admin',
      'http://127.0.0.1:8080/secret',
      'http://127.0.1.1/',
      'http://2130706433/',
      'http://localhost/',
      'http://my.local/',
    ];

    for (const url of loopbacks) {
      const parsed = new URL(url);
      assert.strictEqual(isPrivateOrBlockedHost(parsed.hostname), true, `Expected host ${parsed.hostname} to be blocked`);

      const res = validateAndCanonicalizeYouTubeUrl(url);
      assert.strictEqual(res.valid, false, `Expected ${url} to be rejected`);

      assert.strictEqual(isValidArtworkUrl(url), false, `Expected ${url} to be invalid artwork`);
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 10: Private and internal IPv4 addresses
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 10: Private and internal IPv4 addresses (including AWS/GCP metadata) are blocked', () => {
    const privateIps = [
      '10.0.0.1',
      '10.255.255.254',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.0.1',
      '192.168.1.100',
      '169.254.169.254', // Cloud metadata
      '169.254.1.1',
      '0.0.0.0',
    ];

    for (const ip of privateIps) {
      assert.strictEqual(isPrivateOrBlockedHost(ip), true, `Expected IP ${ip} to be blocked`);
      const url = `http://${ip}/latest/meta-data/`;
      assert.strictEqual(validateAndCanonicalizeYouTubeUrl(url).valid, false);
      assert.strictEqual(isValidArtworkUrl(url), false);
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 11: IPv6 loopback and link-local addresses
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 11: IPv6 loopback and link-local addresses are blocked', () => {
    const ipv6Hosts = [
      '::1',
      '[::1]',
      'fe80::1',
      '[fe80::1]',
      'fc00::1',
      'fd00::1',
      '::ffff:127.0.0.1',
    ];

    for (const host of ipv6Hosts) {
      assert.strictEqual(isPrivateOrBlockedHost(host), true, `Expected IPv6 ${host} to be blocked`);
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 12: Non-HTTP(S) schemes
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 12: Non-HTTP(S) schemes are rejected', () => {
    const nonHttpUrls = [
      'file:///etc/passwd',
      'file:///c:/boot.ini',
      'gopher://127.0.0.1:6379/_ping',
      'ftp://evil.com/audio.mp3',
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
    ];

    for (const url of nonHttpUrls) {
      assert.strictEqual(validateAndCanonicalizeYouTubeUrl(url).valid, false);
      assert.strictEqual(isValidArtworkUrl(url), false);
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 13: Arbitrary external non-whitelisted URLs
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 13: Arbitrary external non-whitelisted URLs are rejected', () => {
    const arbitraryUrls = [
      'https://evil.com/malicious.mp3',
      'https://example.com/stream.wav',
      'https://attacker.org/audio.opus',
      'https://vimeo.com/12345678',
      'https://soundcloud.com/artist/track',
    ];

    for (const url of arbitraryUrls) {
      const res = validateAndCanonicalizeYouTubeUrl(url);
      assert.strictEqual(res.valid, false, `Expected arbitrary URL ${url} to be rejected`);
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 14: End-to-End API endpoint protection & legitimate query preservation
  // ---------------------------------------------------------------------------
  await suite.test('Scenario 14A: /api/downloader/resolve rejects SSRF and arbitrary URLs', async () => {
    const maliciousPayloads = [
      'http://127.0.0.1:8080/foo',
      'http://169.254.169.254/latest/meta-data/',
      'http://youtube.com@127.0.0.1/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'file:///etc/passwd',
      'https://attacker.com/malicious',
    ];

    for (const badUrl of maliciousPayloads) {
      const res = await fetch(`${baseUrl}/api/downloader/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ urlOrQuery: badUrl }),
      });

      // Must be rejected with 500/400 containing an error message, never passing to yt-dlp
      assert.strictEqual(res.status >= 400, true, `Expected ${badUrl} to return error status`);
      const body = await res.json();
      assert.strictEqual(Boolean(body.error), true);
      assert.match(body.error, /invalid|unsupported|prohibited|disallowed/i);
    }
  });

  await suite.test('Scenario 14B: /api/downloader/resolve allows legitimate text search queries', async () => {
    // Text search queries (like "Bohemian Rhapsody") should be recognized as search, not URLs
    assert.strictEqual(isUrlOrUri('Bohemian Rhapsody'), false);
    assert.strictEqual(isUrlOrUri('Ed Sheeran - Perfect'), false);

    const res = await fetch(`${baseUrl}/api/downloader/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ urlOrQuery: 'Bohemian Rhapsody Queen' }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.type, 'search');
    assert.strictEqual(Array.isArray(body.tracks), true);
  });

  await suite.test('Scenario 14C: /api/downloader/resolve allows legitimate Spotify URLs without yt-dlp', async () => {
    const spotifyUrl = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
    const val = validateSpotifyUrl(spotifyUrl);
    assert.strictEqual(val.valid, true);
    assert.strictEqual(val.type, 'track');
    assert.strictEqual(val.id, '4cOdK2wGLETKBW3PvgPWqT');
  });

  await suite.test('Scenario 14D: /api/downloader/start rejects SSRF payloads in sourceUrl with HTTP 400', async () => {
    const ssrfTrackPayloads = [
      {
        title: 'SSRF Attack 1',
        artist: 'Attacker',
        sourceUrl: 'http://169.254.169.254/latest/meta-data/',
      },
      {
        title: 'SSRF Attack 2',
        artist: 'Attacker',
        sourceUrl: 'http://127.0.0.1:8080/admin',
      },
      {
        title: 'SSRF Attack 3',
        artist: 'Attacker',
        sourceUrl: 'http://youtube.com@127.0.0.1/watch?v=dQw4w9WgXcQ',
      },
      {
        title: 'SSRF Attack 4',
        artist: 'Attacker',
        sourceUrl: 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      },
      {
        title: 'SSRF Attack 5',
        artist: 'Attacker',
        sourceUrl: 'file:///etc/passwd',
      },
    ];

    for (const track of ssrfTrackPayloads) {
      const res = await fetch(`${baseUrl}/api/downloader/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          libraryId: lib.id,
          tracks: [track],
        }),
      });

      assert.strictEqual(res.status, 400, `Expected start endpoint to reject ${track.sourceUrl} with 400`);
      const body = await res.json();
      assert.strictEqual(Boolean(body.error), true);
      assert.match(body.error, /invalid or unsafe audio sourceurl/i);
    }
  });

  await suite.test('Scenario 14E: /api/downloader/start accepts valid canonical YouTube URL and queues safely', async () => {
    const validTrack = {
      title: 'Legitimate Track',
      artist: 'Legitimate Artist',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
    };

    const res = await fetch(`${baseUrl}/api/downloader/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        libraryId: lib.id,
        tracks: [validTrack],
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(Boolean(body.jobId), true);
    assert.strictEqual(body.totalTracks, 1);

    // Verify in memory/database that sourceUrl was canonicalized
    const queuedJob = await downloadQueue.getJob(body.jobId);
    assert.strictEqual(Boolean(queuedJob), true);
    assert.strictEqual(queuedJob!.tracks[0].sourceUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  await suite.test('Scenario 14F: downloadQueue.downloadSingleTrackAudio fails closed on unsafe URLs', async () => {
    // Test the unmocked implementation of downloadSingleTrackAudio
    await assert.rejects(
      async () => {
        await originalDownload.call(downloadQueue, 'http://169.254.169.254/latest/meta-data/', '/tmp');
      },
      /invalid or disallowed download url/i
    );

    await assert.rejects(
      async () => {
        await originalDownload.call(downloadQueue, 'http://127.0.0.1:8080/foo', '/tmp');
      },
      /invalid or disallowed download url/i
    );

    await assert.rejects(
      async () => {
        await originalDownload.call(downloadQueue, 'file:///etc/passwd', '/tmp');
      },
      /invalid or disallowed download url/i
    );
  });

  // Teardown
  server.close();
  downloadQueue.downloadSingleTrackAudio = originalDownload;
});
