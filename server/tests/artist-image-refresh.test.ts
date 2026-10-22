import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

// Isolate test database to prevent race conditions with other test suites
const testDataDir = path.resolve(process.cwd(), 'data', 'test_artist_image_refresh');
process.env.DATA_DIR = testDataDir;

import { db, setupDatabase } from '../db/index.js';
import { artists, songs, albums, libraries } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  refreshArtistProfileImage,
  refreshAllArtists,
  normalizeArtistNameForMatching,
  isValidArtistImageUrl,
  validateImageMagicBytes,
  selectFanartTvArtistImage,
  queryFanartTvArtist,
  resolveMusicBrainzId,
  searchMusicBrainzArtists,
  resolveArtistDirectory,
  findLocalArtistArtwork,
  saveArtistImage,
  validateMusicBrainzArtistId,
} from '../lib/artist-image-refresher.js';
import { getOrCreateArtist } from '../lib/artist-utils.js';

// Helper to construct a valid JPEG image buffer (>1KB with FF D8 FF header)
function createMockJpegBuffer(): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const payload = Buffer.alloc(2048, 0xab);
  return Buffer.concat([header, payload]);
}

test('Fanart.tv Artist Images Integration Test Suite', async (t) => {
  await setupDatabase();

  // Ensure a test library exists for foreign-key constraints
  let lib = await db.select().from(libraries).limit(1);
  let libraryId = lib[0]?.id;
  if (!libraryId) {
    const [createdLib] = await db.insert(libraries).values({
      name: 'Test Artist Image Library',
      path: '/mock/test/library',
    }).returning();
    libraryId = createdLib.id;
  }

  const originalFetch = globalThis.fetch;
  const originalFanartKey = process.env.FANART_TV_API_KEY;

  t.afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalFanartKey !== undefined) {
      process.env.FANART_TV_API_KEY = originalFanartKey;
    } else {
      delete process.env.FANART_TV_API_KEY;
    }
  });

  await t.test('1. Normalization and URL validation utilities', () => {
    assert.strictEqual(normalizeArtistNameForMatching('The Beatles'), 'beatles');
    assert.strictEqual(normalizeArtistNameForMatching('Beyoncé'), 'beyonce');
    assert.strictEqual(normalizeArtistNameForMatching('AC/DC'), 'acdc');
    assert.strictEqual(normalizeArtistNameForMatching('  guns  n\'  roses  '), 'guns n roses');

    assert.strictEqual(isValidArtistImageUrl('https://assets.fanart.tv/fanart/music/artist.jpg'), true);
    assert.strictEqual(isValidArtistImageUrl('http://assets.fanart.tv/thumb.png'), true);
    assert.strictEqual(isValidArtistImageUrl('ftp://fanart.tv/test.jpg'), false);
    assert.strictEqual(isValidArtistImageUrl('https://169.254.169.254/secret'), false);

    const validJpg = createMockJpegBuffer();
    assert.strictEqual(validateImageMagicBytes(validJpg), true);

    const invalidBuf = Buffer.from('<html><body>Not an image</body></html>');
    assert.strictEqual(validateImageMagicBytes(invalidBuf), false);
  });

  await t.test('1a. Song title disambiguates same-name MusicBrainz artists', async () => {
    const originalFetchForSearch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.hostname === 'musicbrainz.org' && url.pathname.endsWith('/artist')) {
        return new Response(JSON.stringify({
          artists: [
            { id: 'mario-candidate-a', name: 'Mario', score: 100, country: 'US', type: 'Person' },
            { id: 'mario-candidate-b', name: 'Mario', score: 95, country: 'BR', type: 'Group' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.hostname === 'musicbrainz.org' && url.pathname.endsWith('/recording')) {
        return new Response(JSON.stringify({
          recordings: [{
            title: 'Let Me Love You',
            'artist-credit': [{ artist: { id: 'mario-candidate-b', name: 'Mario' } }],
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    };

    try {
      const candidates = await searchMusicBrainzArtists('Mario', 8000, 'Let Me Love You');
      assert.strictEqual(candidates.length, 2, 'Keep alternative same-name artists available for manual selection');
      assert.strictEqual(candidates[0].id, 'mario-candidate-b', 'Rank the artist credited on the matching song first');
    } finally {
      globalThis.fetch = originalFetchForSearch;
    }
  });

  await t.test('2. Missing FANART_TV_API_KEY returns configuration error', async () => {
    delete process.env.FANART_TV_API_KEY;

    const [art] = await db.insert(artists).values({
      name: `Test Artist Missing Key ${Date.now()}`,
      artworkPath: null,
    }).returning();

    try {
      const res = await refreshArtistProfileImage(art.id);
      assert.strictEqual(res.status, 'failed');
      assert.ok(res.error?.includes('API key not configured'), 'Should explain missing API key');

      // Bulk refresh now processes each artist independently so existing/local
      // artwork can be preserved even when Fanart.tv is not configured.
      const bulk = await refreshAllArtists();
      const targetResult = bulk.details.find(detail => detail.artistId === art.id);
      assert.ok(targetResult, 'Bulk summary should include the artist being tested');
      assert.strictEqual(targetResult.status, 'failed');
      assert.ok(targetResult.error?.includes('API key not configured'), 'Artist result should explain missing API key');
      assert.ok(bulk.failed >= 1, 'Bulk summary should count artists that cannot be refreshed');
    } finally {
      await db.delete(artists).where(eq(artists.id, art.id));
    }
  });

  await t.test('3. Successful Fanart.tv artist portrait download and metadata persistence', async () => {
    process.env.FANART_TV_API_KEY = 'mock_fanart_key';

    const testMbid = 'mbid-fanart-target-uuid-3333';
    const artistName = `Radiohead ${Date.now()}`;
    const [art] = await db.insert(artists).values({
      name: artistName,
      musicbrainzId: testMbid,
      artworkPath: null,
    }).returning();

    const mockJpeg = createMockJpegBuffer();
    let fanartApiKeyHeader = '';

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = String(input);
      // Fanart.tv provides artistthumb
      if (urlStr.includes(`/v3/music/${testMbid}`)) {
        fanartApiKeyHeader = (init?.headers as any)?.['api-key'] || '';
        const payload = {
          name: artistName,
          mbid_id: testMbid,
          artistthumb: [
            {
              id: '501',
              url: 'https://assets.fanart.tv/fanart/music/radiohead-thumb.jpg',
              likes: '25',
            },
          ],
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Download image asset
      if (urlStr === 'https://assets.fanart.tv/fanart/music/radiohead-thumb.jpg') {
        return new Response(mockJpeg, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      return new Response('Not Found', { status: 404 });
    };

    try {
      const res = await refreshArtistProfileImage(art.id);
      assert.strictEqual(res.status, 'updated');
      assert.strictEqual(res.provider, 'fanart_tv');
      assert.strictEqual(fanartApiKeyHeader, 'mock_fanart_key', 'Must authenticate Fanart.tv with api-key header');
      assert.strictEqual(res.artworkUrl, 'https://assets.fanart.tv/fanart/music/radiohead-thumb.jpg');

      const [updatedArt] = await db.select().from(artists).where(eq(artists.id, art.id));
      assert.ok(updatedArt.artworkPath);
      assert.strictEqual(updatedArt.artworkSource, 'fanart_tv');
      assert.strictEqual(updatedArt.artworkVerified, 1);
      assert.strictEqual(updatedArt.musicbrainzId, testMbid);

      // Second refresh with unchanged image returns 'unchanged'
      const unchangedResult = await refreshArtistProfileImage(art.id);
      assert.strictEqual(unchangedResult.status, 'unchanged');
    } finally {
      await db.delete(artists).where(eq(artists.id, art.id));
    }
  });

  await t.test('4. Fanart.tv schema parser ignores logos, banners, and album covers', () => {
    // Only logos and albums -> should return null
    const logoOnlyData = {
      name: 'Artist',
      musiclogo: [{ id: '1', url: 'https://assets.fanart.tv/logo.png' }],
      hdmusiclogo: [{ id: '2', url: 'https://assets.fanart.tv/hdlogo.png' }],
      musicbanner: [{ id: '3', url: 'https://assets.fanart.tv/banner.jpg' }],
      albums: { 'rel-1': { albumcover: [{ url: 'cover.jpg' }] } },
    };
    assert.strictEqual(selectFanartTvArtistImage(logoOnlyData), null);

    // Has artistbackground -> should return background
    const bgData = {
      artistbackground: [{ id: '10', url: 'https://assets.fanart.tv/bg.jpg', likes: '5' }],
    };
    assert.strictEqual(selectFanartTvArtistImage(bgData), 'https://assets.fanart.tv/bg.jpg');

    // Has both artistthumb and artistbackground -> prefers artistthumb with highest likes
    const fullData = {
      artistthumb: [
        { id: '1', url: 'https://assets.fanart.tv/low_thumb.jpg', likes: '2' },
        { id: '2', url: 'https://assets.fanart.tv/high_thumb.jpg', likes: '50' },
      ],
      artistbackground: [{ id: '3', url: 'https://assets.fanart.tv/bg.jpg', likes: '100' }],
    };
    assert.strictEqual(selectFanartTvArtistImage(fullData), 'https://assets.fanart.tv/high_thumb.jpg');
  });

  await t.test('5. Missing or invalid MusicBrainz ID without resolution returns unavailable', async () => {
    process.env.FANART_TV_API_KEY = 'mock_fanart_key';

    const artistName = `Unknown MBID Artist ${Date.now()}`;
    const [art] = await db.insert(artists).values({
      name: artistName,
      musicbrainzId: null,
      artworkPath: null,
    }).returning();

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = String(input);
      // MusicBrainz search returns no results
      if (urlStr.includes('musicbrainz.org/ws/2/artist')) {
        return new Response(JSON.stringify({ artists: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    };

    try {
      const res = await refreshArtistProfileImage(art.id);
      assert.strictEqual(res.status, 'unavailable');
      const [check] = await db.select().from(artists).where(eq(artists.id, art.id));
      assert.strictEqual(check.artworkPath, null);
    } finally {
      await db.delete(artists).where(eq(artists.id, art.id));
    }
  });

  await t.test('6. Fanart.tv API errors, rate limits (429), timeouts, and malformed responses', async () => {
    process.env.FANART_TV_API_KEY = 'mock_fanart_key';
    const mbid = 'mbid-test-error-429';

    // Rate Limit (429)
    globalThis.fetch = async () => new Response('Too Many Requests', { status: 429 });
    const resRateLimit = await queryFanartTvArtist(mbid);
    assert.strictEqual(resRateLimit.status, 'failed');
    assert.ok(resRateLimit.error?.includes('rate limit'));

    // Malformed JSON
    globalThis.fetch = async () => new Response('Invalid JSON {{{', { status: 200, headers: { 'Content-Type': 'application/json' } });
    const resMalformed = await queryFanartTvArtist(mbid);
    assert.strictEqual(resMalformed.status, 'failed');
    assert.ok(resMalformed.error?.includes('Malformed'));

    // Timeout (AbortError)
    globalThis.fetch = async () => {
      const err = new Error('Timeout');
      err.name = 'AbortError';
      throw err;
    };
    const resTimeout = await queryFanartTvArtist(mbid);
    assert.strictEqual(resTimeout.status, 'failed');
    assert.ok(resTimeout.error?.includes('timed out'));
  });

  await t.test('7. Existing verified image is preserved on provider failure', async () => {
    process.env.FANART_TV_API_KEY = 'mock_fanart_key';

    const [art] = await db.insert(artists).values({
      name: `Existing Portrait Artist ${Date.now()}`,
      artworkPath: 'existing_verified_portrait.jpg',
      artworkVerified: 1,
    }).returning();

    globalThis.fetch = async () => new Response('Internal Server Error', { status: 500 });

    try {
      const result = await refreshArtistProfileImage(art.id);
      assert.strictEqual(result.status, 'unchanged');

      // Verify existing artworkPath was NOT wiped or set to null
      const [check] = await db.select().from(artists).where(eq(artists.id, art.id));
      assert.strictEqual(check.artworkPath, 'existing_verified_portrait.jpg', 'Existing image must be preserved');
    } finally {
      await db.delete(artists).where(eq(artists.id, art.id));
    }
  });

  await t.test('8. Song scanning and album extraction never overwrite or populate artist portrait', async () => {
    const uniqueName = `Scanner Test Artist ${Date.now()}`;
    const artistId = await getOrCreateArtist(uniqueName);

    // Verify artist has no artwork initially
    const [createdArt] = await db.select().from(artists).where(eq(artists.id, artistId));
    assert.strictEqual(createdArt.artworkPath, null, 'Newly created artist must not have artwork');

    // Create album and song with cover artwork
    const [alb] = await db.insert(albums).values({
      artistId,
      title: 'Scanned Album',
      artworkPath: 'album_embedded_cover.jpg',
    }).returning();

    // Ensure valid library exists for foreign-key constraints
    let activeLibId = libraryId;
    const [existingLib] = await db.select().from(libraries).where(eq(libraries.id, activeLibId));
    if (!existingLib) {
      const [newLib] = await db.insert(libraries).values({
        name: `Test Artist Image Library ${Date.now()}`,
        path: `/mock/test/library_${Date.now()}`,
      }).returning();
      activeLibId = newLib.id;
      libraryId = activeLibId;
    }

    const [song] = await db.insert(songs).values({
      libraryId: activeLibId,
      artistId,
      albumId: alb.id,
      title: 'Scanned Song',
      mainAudioPath: '/mock/scanned_song.mp3',
      artworkPath: 'song_embedded_cover.jpg',
    }).returning();

    try {
      // Re-query artist: artist portrait must still be null!
      const [artAfterScan] = await db.select().from(artists).where(eq(artists.id, artistId));
      assert.strictEqual(artAfterScan.artworkPath, null, 'Track artwork must never populate artist portrait');

      // Album and song artwork must be intact
      const [songCheck] = await db.select().from(songs).where(eq(songs.id, song.id));
      assert.strictEqual(songCheck.artworkPath, 'song_embedded_cover.jpg');

      const [albCheck] = await db.select().from(albums).where(eq(albums.id, alb.id));
      assert.strictEqual(albCheck.artworkPath, 'album_embedded_cover.jpg');
    } finally {
      await db.delete(songs).where(eq(songs.id, song.id));
      await db.delete(albums).where(eq(albums.id, alb.id));
      await db.delete(artists).where(eq(artists.id, artistId));
    }
  });

  await t.test('9. Artist artwork endpoint never falls back to song or album covers', async () => {
    const express = (await import('express')).default;
    const jwt = (await import('jsonwebtoken')).default;
    const artistsRouter = (await import('../routes/artists.js')).default;

    const app = express();
    app.use(express.json());
    app.use('/api/artists', artistsRouter);

    const server = app.listen(0);
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const token = jwt.sign(
      { id: 1, username: 'test_admin', role: 'administrator' },
      process.env.JWT_SECRET || 'yimly_deterministic_test_jwt_secret_ci_only_32_bytes_safe'
    );

    // Create artist with NO artwork, but associated album and song WITH artwork
    const [art] = await db.insert(artists).values({
      name: `Fallback Test Artist ${Date.now()}`,
      artworkPath: null,
    }).returning();

    const [alb] = await db.insert(albums).values({
      artistId: art.id,
      title: 'Album with Cover',
      artworkPath: 'fake_album_art.jpg',
    }).returning();

    const [song] = await db.insert(songs).values({
      libraryId,
      artistId: art.id,
      albumId: alb.id,
      title: 'Song with Cover',
      mainAudioPath: '/mock/track.mp3',
      artworkPath: 'fake_song_art.jpg',
    }).returning();

    try {
      const res = await fetch(`${baseUrl}/api/artists/${art.id}/artwork`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 404, 'Must return 404 instead of falling back to album or song cover');
      assert.match(res.headers.get('cache-control') || '', /no-store/, 'Artist artwork responses must not be cached');
    } finally {
      server.close();
      await db.delete(songs).where(eq(songs.id, song.id));
      await db.delete(albums).where(eq(albums.id, alb.id));
      await db.delete(artists).where(eq(artists.id, art.id));
    }
  });
  await t.test('10. Resolve 98 Degrees variants to authoritative MBID', async () => {
    const targetMbid = '177fde26-5a95-46d9-922f-0933940d97e5';
    const artistName = '98 Degrees';
    const artistNameNorm = '98 degrees';

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes('musicbrainz.org/ws/2/artist')) {
        return new Response(JSON.stringify({
          artists: [{
            id: targetMbid,
            name: artistName,
            sortName: artistName,
          }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    };

    assert.strictEqual(await resolveMusicBrainzId('98º'), targetMbid);
    assert.strictEqual(await resolveMusicBrainzId('98°'), targetMbid);
    assert.strictEqual(await resolveMusicBrainzId('98 Degrees'), targetMbid);
  });

  await t.test('11. Persist MBID even if Fanart fails', async () => {
    process.env.FANART_TV_API_KEY = 'mock_fanart_key';
    const artistName = `MBID Persistence Artist ${Date.now()}`;
    const [art] = await db.insert(artists).values({ name: artistName }).returning();

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
        const urlStr = String(input);
        if (urlStr.includes('musicbrainz.org/ws/2/artist')) {
             return new Response(JSON.stringify({ 
                 artists: [{ id: 'target-mbid-1234', name: artistName }] 
             }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        // Fail Fanart lookup
        return new Response('Error', { status: 500 });
    };

    try {
        const res = await refreshArtistProfileImage(art.id);
        assert.strictEqual(res.status, 'failed', 'Should return failed status');

        const [check] = await db.select().from(artists).where(eq(artists.id, art.id));
        assert.strictEqual(check.musicbrainzId, 'target-mbid-1234', 'MBID must be persisted');
    } finally {
        await db.delete(artists).where(eq(artists.id, art.id));
    }
  });

  await t.test('12. MusicBrainz search returns ambiguous candidates without guessing', async () => {
    const artistName = `Ambiguous Artist ${Date.now()}`;
    const [art] = await db.insert(artists).values({ name: artistName }).returning();

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes('musicbrainz.org/ws/2/artist')) {
        return new Response(JSON.stringify({
          artists: [
            { id: 'candidate-uuid-1', name: artistName, disambiguation: 'Rock band from UK', country: 'GB', type: 'Group', score: 100 },
            { id: 'candidate-uuid-2', name: artistName, disambiguation: 'Electronic producer', country: 'US', type: 'Person', score: 90 },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    };

    try {
      const res = await refreshArtistProfileImage(art.id, undefined, true);
      assert.strictEqual(res.status, 'ambiguous', 'Must report ambiguous match');
      assert.strictEqual(res.candidates?.length, 2, 'Must return all matching candidates');
      assert.strictEqual(res.candidates![0].id, 'candidate-uuid-1');
      assert.strictEqual(res.candidates![0].disambiguation, 'Rock band from UK');
      assert.strictEqual(res.candidates![0].country, 'GB');
      assert.strictEqual(res.candidates![0].type, 'Group');

      // Verify artist record was NOT mutated with an uncertain match
      const [check] = await db.select().from(artists).where(eq(artists.id, art.id));
      assert.strictEqual(check.musicbrainzId, null, 'Must not silently guess an uncertain candidate');
    } finally {
      await db.delete(artists).where(eq(artists.id, art.id));
    }
  });

  await t.test('13. Manually selecting and changing an artist ID with validation', async () => {
    process.env.FANART_TV_API_KEY = 'mock_fanart_key';
    const artistName = `Manual Match Artist ${Date.now()}`;
    const [art] = await db.insert(artists).values({ name: artistName }).returning();

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes('musicbrainz.org/ws/2/artist/target-first-uuid')) {
        return new Response(JSON.stringify({
          id: 'target-first-uuid',
          name: artistName,
          type: 'Group',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('musicbrainz.org/ws/2/artist/target-second-uuid')) {
        return new Response(JSON.stringify({
          id: 'target-second-uuid',
          name: artistName,
          type: 'Person',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('musicbrainz.org/ws/2/artist/invalid-mbid')) {
        return new Response('Not Found', { status: 404 });
      }
      if (urlStr.includes('fanart.tv')) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response('Not Found', { status: 404 });
    };

    try {
      // 1. Manually set to target-first-uuid
      await refreshArtistProfileImage(art.id, 'target-first-uuid');
      let [check] = await db.select().from(artists).where(eq(artists.id, art.id));
      assert.strictEqual(check.musicbrainzId, 'target-first-uuid', 'Must save first selected MBID');

      // 2. Change to target-second-uuid
      await refreshArtistProfileImage(art.id, 'target-second-uuid');
      [check] = await db.select().from(artists).where(eq(artists.id, art.id));
      assert.strictEqual(check.musicbrainzId, 'target-second-uuid', 'Must update to newly selected MBID');

      // 3. Reject invalid MBID
      const invalidRes = await refreshArtistProfileImage(art.id, 'invalid-mbid');
      assert.strictEqual(invalidRes.status, 'failed');
      [check] = await db.select().from(artists).where(eq(artists.id, art.id));
      assert.strictEqual(check.musicbrainzId, 'target-second-uuid', 'Must preserve previous valid MBID on validation failure');
    } finally {
      await db.delete(artists).where(eq(artists.id, art.id));
    }
  });

  await t.test('14. Persisting and reusing the selected ID avoids unnecessary MusicBrainz requests', async () => {
    process.env.FANART_TV_API_KEY = 'mock_fanart_key';
    const persistedMbid = 'persisted-authoritative-mbid-9999';
    const artistName = `Reuse MBID Artist ${Date.now()}`;
    const [art] = await db.insert(artists).values({
      name: artistName,
      musicbrainzId: persistedMbid,
    }).returning();

    let musicBrainzSearchCalled = false;
    let fanartQueryMbid = '';

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes('musicbrainz.org/ws/2/artist')) {
        musicBrainzSearchCalled = true;
        return new Response('Error', { status: 500 });
      }
      if (urlStr.includes('/v3/music/')) {
        const parts = urlStr.split('/v3/music/');
        fanartQueryMbid = decodeURIComponent(parts[1] || '');
        return new Response('Not Found', { status: 404 });
      }
      return new Response('Not Found', { status: 404 });
    };

    try {
      await refreshArtistProfileImage(art.id);
      assert.strictEqual(musicBrainzSearchCalled, false, 'Must not search MusicBrainz when an ID is already saved');
      assert.strictEqual(fanartQueryMbid, persistedMbid, 'Must query Fanart.tv directly with the saved MBID');
    } finally {
      await db.delete(artists).where(eq(artists.id, art.id));
    }
  });

  await t.test('15. Saving downloaded artwork to the artist\'s actual folder as artist.jpg', async () => {
    process.env.FANART_TV_API_KEY = 'mock_fanart_key';
    const artistName = `Local Folder Artist ${Date.now()}`;
    const testMbid = 'mbid-local-folder-uuid-5555';

    // Create a real directory structure within testDataDir
    const testLibDir = path.join(testDataDir, 'test_library_' + Date.now());
    const artistDir = path.join(testLibDir, 'Queen');
    fs.mkdirSync(artistDir, { recursive: true });

    const [testLib] = await db.insert(libraries).values({
      name: 'Local Folder Test Library',
      path: testLibDir,
    }).returning();

    const [art] = await db.insert(artists).values({
      name: artistName,
      musicbrainzId: testMbid,
      artworkPath: null,
    }).returning();

    const fakeAudioPath = path.join(artistDir, 'bohemian.mp3');
    fs.writeFileSync(fakeAudioPath, 'fake-audio-content');

    const [song] = await db.insert(songs).values({
      libraryId: testLib.id,
      artistId: art.id,
      title: 'Bohemian Rhapsody',
      mainAudioPath: fakeAudioPath,
    }).returning();

    const mockJpeg = createMockJpegBuffer();

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes(`/v3/music/${testMbid}`)) {
        return new Response(JSON.stringify({
          name: artistName,
          artistthumb: [{ id: '10', url: 'https://assets.fanart.tv/fanart/music/queen-thumb.jpg', likes: '100' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr === 'https://assets.fanart.tv/fanart/music/queen-thumb.jpg') {
        return new Response(mockJpeg, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
      }
      return new Response('Not Found', { status: 404 });
    };

    try {
      const res = await refreshArtistProfileImage(art.id);
      assert.strictEqual(res.status, 'updated');

      const expectedArtistJpg = path.join(artistDir, 'artist.jpg');
      assert.strictEqual(fs.existsSync(expectedArtistJpg), true, 'artist.jpg must be saved in the artist folder');

      const [check] = await db.select().from(artists).where(eq(artists.id, art.id));
      assert.strictEqual(check.artworkPath, expectedArtistJpg, 'Database artworkPath must point to the saved artist.jpg');
      assert.strictEqual(check.artworkSource, 'fanart_tv');
    } finally {
      await db.delete(songs).where(eq(songs.id, song.id));
      await db.delete(artists).where(eq(artists.id, art.id));
      await db.delete(libraries).where(eq(libraries.id, testLib.id));
      fs.rmSync(testLibDir, { recursive: true, force: true });
    }
  });

  await t.test('16. Safe filesystem path handling and unwritable folders fallback', async () => {
    process.env.FANART_TV_API_KEY = 'mock_fanart_key';
    const artistName = `Unwritable Folder Artist ${Date.now()}`;
    const testMbid = 'mbid-unwritable-uuid-6666';

    const testLibDir = path.join(testDataDir, 'test_lib_ro_' + Date.now());
    const artistDir = path.join(testLibDir, 'ReadOnlyArtist');
    fs.mkdirSync(artistDir, { recursive: true });

    // Create artist.jpg as a directory so writing to it as a file throws an error on all platforms
    const blockerDir = path.join(artistDir, 'artist.jpg');
    fs.mkdirSync(blockerDir, { recursive: true });

    const [testLib] = await db.insert(libraries).values({
      name: 'RO Test Library',
      path: testLibDir,
    }).returning();

    const [art] = await db.insert(artists).values({
      name: artistName,
      musicbrainzId: testMbid,
      artworkPath: null,
    }).returning();

    const fakeAudioPath = path.join(artistDir, 'track.mp3');
    fs.writeFileSync(fakeAudioPath, 'audio-data');

    const [song] = await db.insert(songs).values({
      libraryId: testLib.id,
      artistId: art.id,
      title: 'RO Track',
      mainAudioPath: fakeAudioPath,
    }).returning();

    const mockJpeg = createMockJpegBuffer();

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes(`/v3/music/${testMbid}`)) {
        return new Response(JSON.stringify({
          name: artistName,
          artistthumb: [{ id: '11', url: 'https://assets.fanart.tv/fanart/music/ro-thumb.jpg', likes: '10' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr === 'https://assets.fanart.tv/fanart/music/ro-thumb.jpg') {
        return new Response(mockJpeg, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
      }
      return new Response('Not Found', { status: 404 });
    };

    try {
      const res = await refreshArtistProfileImage(art.id);
      assert.strictEqual(res.status, 'updated');

      const [check] = await db.select().from(artists).where(eq(artists.id, art.id));
      assert.ok(check.artworkPath, 'Must fall back to saved cache filename');
      const fallbackFile = path.join(testDataDir, 'artwork', path.basename(check.artworkPath));
      assert.strictEqual(fs.existsSync(fallbackFile), true, 'Fallback file must exist in cached artwork directory');
    } finally {
      await db.delete(songs).where(eq(songs.id, song.id));
      await db.delete(artists).where(eq(artists.id, art.id));
      await db.delete(libraries).where(eq(libraries.id, testLib.id));
      fs.rmSync(testLibDir, { recursive: true, force: true });
    }
  });

  await t.test('17. Path traversal prevention in artist directory resolution', async () => {
    const testLibDir = path.join(testDataDir, 'test_traversal_lib');
    fs.mkdirSync(testLibDir, { recursive: true });

    const [testLib] = await db.insert(libraries).values({
      name: 'Traversal Test Library',
      path: testLibDir,
    }).returning();

    const [art] = await db.insert(artists).values({ name: `Traversal Artist ${Date.now()}` }).returning();

    // Malicious audio path outside library root
    const outsideAudio = '/etc/passwd';
    const [song] = await db.insert(songs).values({
      libraryId: testLib.id,
      artistId: art.id,
      title: 'Malicious Track',
      mainAudioPath: outsideAudio,
    }).returning();

    try {
      const dirInfo = await resolveArtistDirectory(art.id);
      assert.strictEqual(dirInfo, null, 'Must reject paths outside library root');
    } finally {
      await db.delete(songs).where(eq(songs.id, song.id));
      await db.delete(artists).where(eq(artists.id, art.id));
      await db.delete(libraries).where(eq(libraries.id, testLib.id));
      fs.rmSync(testLibDir, { recursive: true, force: true });
    }
  });

  await t.test('18. Prefer valid local artist artwork when available', async () => {
    const artistName = `Local Art Artist ${Date.now()}`;
    const testLibDir = path.join(testDataDir, 'test_local_art_lib_' + Date.now());
    const artistDir = path.join(testLibDir, 'TheBeatles');
    fs.mkdirSync(artistDir, { recursive: true });

    // Place genuine artist.jpg in artist directory
    const localArtistJpg = path.join(artistDir, 'artist.jpg');
    fs.writeFileSync(localArtistJpg, createMockJpegBuffer());

    const [testLib] = await db.insert(libraries).values({
      name: 'Local Art Library',
      path: testLibDir,
    }).returning();

    const [art] = await db.insert(artists).values({
      name: artistName,
      artworkPath: null,
    }).returning();

    const [song] = await db.insert(songs).values({
      libraryId: testLib.id,
      artistId: art.id,
      title: 'Yesterday',
      mainAudioPath: path.join(artistDir, 'yesterday.mp3'),
    }).returning();

    delete process.env.FANART_TV_API_KEY;

    try {
      const res = await refreshArtistProfileImage(art.id);
      assert.strictEqual(res.status, 'updated');

      const [check] = await db.select().from(artists).where(eq(artists.id, art.id));
      assert.strictEqual(check.artworkPath, localArtistJpg);
      assert.strictEqual(check.artworkSource, 'local');
      assert.strictEqual(check.artworkVerified, 1);
    } finally {
      await db.delete(songs).where(eq(songs.id, song.id));
      await db.delete(artists).where(eq(artists.id, art.id));
      await db.delete(libraries).where(eq(libraries.id, testLib.id));
      fs.rmSync(testLibDir, { recursive: true, force: true });
    }
  });
});
