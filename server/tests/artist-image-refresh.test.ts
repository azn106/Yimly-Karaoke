import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
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

      // Bulk refresh
      const bulk = await refreshAllArtists();
      assert.strictEqual(bulk.failed, bulk.total);
      assert.ok(bulk.error?.includes('API key not configured'), 'Bulk summary should explain missing API key');
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

    const [song] = await db.insert(songs).values({
      libraryId,
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
      process.env.JWT_SECRET || 'fallback_secret_for_dev'
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
    } finally {
      server.close();
      await db.delete(songs).where(eq(songs.id, song.id));
      await db.delete(albums).where(eq(albums.id, alb.id));
      await db.delete(artists).where(eq(artists.id, art.id));
    }
  });
});
