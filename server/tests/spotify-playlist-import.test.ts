import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { users, libraries, playlists } from '../db/schema.js';
import { resolveSpotifyPlaylist, getSpotifyWebPlayerToken } from '../lib/spotify-resolver.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev';

function generateMockTrackItem(index: number, spotifyId?: string, uid?: string) {
  const id = spotifyId || `track_${index}`;
  return {
    uid: uid || `item_uid_${index}`,
    addedAt: { isoString: '2026-01-01T00:00:00.000Z' },
    itemV2: {
      __typename: 'TrackResponseWrapper',
      data: {
        __typename: 'Track',
        uri: `spotify:track:${id}`,
        name: `Track Title ${index}`,
        artists: {
          items: [{ profile: { name: `Artist ${index}` }, uri: `spotify:artist:art_${index}` }],
        },
        albumOfTrack: {
          name: `Album of Track ${index}`,
          date: { isoString: '2025-05-10T00:00:00.000Z' },
          coverArt: {
            sources: [{ url: `https://mock.spotify.cdn/track_album_${index}.jpg`, width: 640, height: 640 }],
          },
        },
        trackDuration: { totalMilliseconds: 180000 + index * 1000 },
        discNumber: 1,
      },
    },
  };
}

test('Spotify Playlist Import, Pagination (100-Track Limit Fix) & Artwork Suite', async (t) => {
  const originalFetch = global.fetch;

  // -------------------------------------------------------------------------
  // 1. Playlists < 100 tracks
  // -------------------------------------------------------------------------
  await t.test('Scenario 1: Resolves playlists < 100 tracks completely', async () => {
    const totalCount = 42;
    const items = Array.from({ length: totalCount }, (_, i) => generateMockTrackItem(i + 1));

    global.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/token')) {
        return new Response(JSON.stringify({ accessToken: 'mock_token', accessTokenExpirationTimestampMs: Date.now() + 3600000 }), { status: 200 });
      }
      if (urlStr.includes('/pathfinder/v1/query')) {
        return new Response(JSON.stringify({
          data: {
            playlistV2: {
              __typename: 'Playlist',
              name: 'Indie Favorites',
              images: { items: [{ sources: [{ url: 'https://mock.spotify.cdn/playlist_cover_indie.jpg' }] }] },
              content: { totalCount, items },
            },
          },
        }), { status: 200 });
      }
      return originalFetch(url, init);
    };

    try {
      const res = await resolveSpotifyPlaylist('test_under_100');
      assert.strictEqual(res.title, 'Indie Favorites');
      assert.strictEqual(res.totalTracks, 42);
      assert.strictEqual(res.tracks.length, 42);
      assert.strictEqual(res.artworkUrl, 'https://mock.spotify.cdn/playlist_cover_indie.jpg');
      assert.strictEqual(res.tracks[0].title, 'Track Title 1');
      assert.strictEqual(res.tracks[41].title, 'Track Title 42');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 2. Playlists = 100 tracks
  // -------------------------------------------------------------------------
  await t.test('Scenario 2: Resolves playlists with exactly 100 tracks in single page', async () => {
    let queryCount = 0;
    const totalCount = 100;
    const items = Array.from({ length: totalCount }, (_, i) => generateMockTrackItem(i + 1));

    global.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/token')) {
        return new Response(JSON.stringify({ accessToken: 'mock_token', accessTokenExpirationTimestampMs: Date.now() + 3600000 }), { status: 200 });
      }
      if (urlStr.includes('/pathfinder/v1/query')) {
        queryCount++;
        return new Response(JSON.stringify({
          data: {
            playlistV2: {
              __typename: 'Playlist',
              name: 'Top 100 Classics',
              images: { items: [{ sources: [{ url: 'https://mock.spotify.cdn/top100.jpg' }] }] },
              content: { totalCount, items },
            },
          },
        }), { status: 200 });
      }
      return originalFetch(url, init);
    };

    try {
      const res = await resolveSpotifyPlaylist('test_exact_100');
      assert.strictEqual(res.totalTracks, 100);
      assert.strictEqual(res.tracks.length, 100);
      // Exactly 1 query because 100 items satisfies the totalCount
      assert.strictEqual(queryCount, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 3. Playlists > 100 tracks (Pagination over 100 tracks)
  // -------------------------------------------------------------------------
  await t.test('Scenario 3: Resolves playlists > 100 tracks with multi-page pagination', async () => {
    const totalCount = 165;
    const page1Items = Array.from({ length: 100 }, (_, i) => generateMockTrackItem(i + 1));
    const page2Items = Array.from({ length: 65 }, (_, i) => generateMockTrackItem(i + 101));
    const requestedOffsets: number[] = [];

    global.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/token')) {
        return new Response(JSON.stringify({ accessToken: 'mock_token', accessTokenExpirationTimestampMs: Date.now() + 3600000 }), { status: 200 });
      }
      if (urlStr.includes('/pathfinder/v1/query')) {
        const urlObj = new URL(urlStr);
        const vars = JSON.parse(urlObj.searchParams.get('variables') || '{}');
        requestedOffsets.push(vars.offset);

        const items = vars.offset === 0 ? page1Items : page2Items;
        return new Response(JSON.stringify({
          data: {
            playlistV2: {
              __typename: 'Playlist',
              name: 'Mega Playlist 165',
              images: { items: [{ sources: [{ url: 'https://mock.spotify.cdn/mega.jpg' }] }] },
              content: { totalCount, items },
            },
          },
        }), { status: 200 });
      }
      return originalFetch(url, init);
    };

    try {
      const res = await resolveSpotifyPlaylist('test_mega_165');
      assert.strictEqual(res.totalTracks, 165);
      assert.strictEqual(res.tracks.length, 165);
      assert.deepStrictEqual(requestedOffsets, [0, 100]);
      assert.strictEqual(res.tracks[0].title, 'Track Title 1');
      assert.strictEqual(res.tracks[99].title, 'Track Title 100');
      assert.strictEqual(res.tracks[100].title, 'Track Title 101');
      assert.strictEqual(res.tracks[164].title, 'Track Title 165');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 4. Ordering preservation
  // -------------------------------------------------------------------------
  await t.test('Scenario 4: Preserves exact sequential playlist track ordering', async () => {
    const totalCount = 120;
    const page1Items = Array.from({ length: 100 }, (_, i) => generateMockTrackItem(i + 1));
    const page2Items = Array.from({ length: 20 }, (_, i) => generateMockTrackItem(i + 101));

    global.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/token')) {
        return new Response(JSON.stringify({ accessToken: 'mock_token', accessTokenExpirationTimestampMs: Date.now() + 3600000 }), { status: 200 });
      }
      if (urlStr.includes('/pathfinder/v1/query')) {
        const urlObj = new URL(urlStr);
        const vars = JSON.parse(urlObj.searchParams.get('variables') || '{}');
        return new Response(JSON.stringify({
          data: {
            playlistV2: {
              __typename: 'Playlist',
              name: 'Ordered Playlist',
              images: { items: [{ sources: [{ url: 'https://mock.spotify.cdn/ordered.jpg' }] }] },
              content: { totalCount, items: vars.offset === 0 ? page1Items : page2Items },
            },
          },
        }), { status: 200 });
      }
      return originalFetch(url, init);
    };

    try {
      const res = await resolveSpotifyPlaylist('test_order');
      for (let i = 0; i < 120; i++) {
        assert.strictEqual(res.tracks[i].trackNumber, i + 1);
        assert.strictEqual(res.tracks[i].title, `Track Title ${i + 1}`);
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 5. Duplicate Handling: Legitimate duplicates vs Overlapping responses
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // 5. Duplicate Handling: Legitimate duplicates vs Overlapping responses
  // -------------------------------------------------------------------------
  await t.test('Scenario 5A: Preserves intentionally consecutive identical tracks at positions 100 and 101 across page boundary', async () => {
    // Playlist with 110 items where track "tr_consecutive" appears:
    // - At position 5 (index 4 of page 1)
    // - At position 100 (index 99 of page 1, tail of page 1)
    // - At position 101 (index 0 of page 2, head of page 2) -> intentionally consecutive across boundary!
    const totalCount = 110;
    const page1Items = Array.from({ length: 100 }, (_, i) => {
      const spotifyId = (i === 4) ? 'tr_repeat' : (i === 99 ? 'tr_consecutive' : `tr_${i + 1}`);
      return generateMockTrackItem(i + 1, spotifyId);
    });
    const page2Items = Array.from({ length: 10 }, (_, i) => {
      const spotifyId = (i === 0) ? 'tr_consecutive' : `tr_${i + 101}`;
      return generateMockTrackItem(i + 101, spotifyId);
    });

    global.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/token')) {
        return new Response(JSON.stringify({ accessToken: 'mock_token', accessTokenExpirationTimestampMs: Date.now() + 3600000 }), { status: 200 });
      }
      if (urlStr.includes('/pathfinder/v1/query')) {
        const urlObj = new URL(urlStr);
        const vars = JSON.parse(urlObj.searchParams.get('variables') || '{}');
        return new Response(JSON.stringify({
          data: {
            playlistV2: {
              __typename: 'Playlist',
              name: 'Consecutive Repeats Playlist',
              images: { items: [{ sources: [{ url: 'https://mock.spotify.cdn/repeats.jpg' }] }] },
              content: { totalCount, items: vars.offset === 0 ? page1Items : page2Items },
            },
          },
        }), { status: 200 });
      }
      return originalFetch(url, init);
    };

    try {
      const res = await resolveSpotifyPlaylist('test_consecutive_repeats');
      assert.strictEqual(res.totalTracks, 110);
      assert.strictEqual(res.tracks.length, 110);

      // Verify position 100 and position 101 are BOTH preserved
      assert.strictEqual(res.tracks[99].spotifyId, 'tr_consecutive', 'Track at position 100 must be preserved');
      assert.strictEqual(res.tracks[99].trackNumber, 100);
      assert.strictEqual(res.tracks[100].spotifyId, 'tr_consecutive', 'Consecutive identical track at position 101 must be preserved');
      assert.strictEqual(res.tracks[100].trackNumber, 101);

      // Also verify track at position 5
      assert.strictEqual(res.tracks[4].spotifyId, 'tr_repeat');
      assert.strictEqual(res.tracks[4].trackNumber, 5);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await t.test('Scenario 5B: Avoids duplicate tracks caused by overlapping pagination response', async () => {
    const totalCount = 105;
    const page1Items = Array.from({ length: 100 }, (_, i) => generateMockTrackItem(i + 1, `tr_${i + 1}`));
    // Suppose page 2 is fetched with overlapping offset 99 (returning slots 99, 100, 101)
    const page2OverlappingItems = [
      generateMockTrackItem(100, `tr_100`), // Slot 99 (already consumed in page 1)
      generateMockTrackItem(101, `tr_101`), // Slot 100
      generateMockTrackItem(102, `tr_102`), // Slot 101
    ];

    global.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/token')) {
        return new Response(JSON.stringify({ accessToken: 'mock_token', accessTokenExpirationTimestampMs: Date.now() + 3600000 }), { status: 200 });
      }
      if (urlStr.includes('/pathfinder/v1/query')) {
        const urlObj = new URL(urlStr);
        const vars = JSON.parse(urlObj.searchParams.get('variables') || '{}');
        // Simulate overlapping response window for page 2
        const items = vars.offset === 0 ? page1Items : page2OverlappingItems;
        return new Response(JSON.stringify({
          data: {
            playlistV2: {
              __typename: 'Playlist',
              name: 'Deduplicated Overlap Playlist',
              images: { items: [{ sources: [{ url: 'https://mock.spotify.cdn/dedup.jpg' }] }] },
              content: { totalCount, items },
            },
          },
        }), { status: 200 });
      }
      return originalFetch(url, init);
    };

    try {
      const res = await resolveSpotifyPlaylist('test_dedup_overlap');
      const tr100Count = res.tracks.filter(t => t.spotifyId === 'tr_100').length;
      assert.strictEqual(tr100Count, 1, 'Overlapping response item must not be duplicated');
      assert.strictEqual(res.tracks.length, 102);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 6. Graceful handling of unavailable, deleted or non-track items
  // -------------------------------------------------------------------------
  await t.test('Scenario 6: Gracefully skips deleted or unavailable items without failing import', async () => {
    const totalCount = 4;
    const items = [
      generateMockTrackItem(1, 'tr_1'),
      { itemV2: null }, // Null item
      { itemV2: { __typename: 'EpisodeResponseWrapper', data: { __typename: 'PodcastEpisode' } } }, // Podcast episode in playlist
      generateMockTrackItem(2, 'tr_2'),
    ];

    global.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/token')) {
        return new Response(JSON.stringify({ accessToken: 'mock_token', accessTokenExpirationTimestampMs: Date.now() + 3600000 }), { status: 200 });
      }
      if (urlStr.includes('/pathfinder/v1/query')) {
        return new Response(JSON.stringify({
          data: {
            playlistV2: {
              __typename: 'Playlist',
              name: 'Mixed Items Playlist',
              images: { items: [{ sources: [{ url: 'https://mock.spotify.cdn/mixed.jpg' }] }] },
              content: { totalCount, items },
            },
          },
        }), { status: 200 });
      }
      return originalFetch(url, init);
    };

    try {
      const res = await resolveSpotifyPlaylist('test_mixed_items');
      assert.strictEqual(res.tracks.length, 2);
      assert.strictEqual(res.tracks[0].spotifyId, 'tr_1');
      assert.strictEqual(res.tracks[1].spotifyId, 'tr_2');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 7. Explicit failure on broken pagination (no silent partial reporting)
  // -------------------------------------------------------------------------
  await t.test('Scenario 7: Throws explicit error if pagination fails mid-way', async () => {
    const totalCount = 150;
    const page1Items = Array.from({ length: 100 }, (_, i) => generateMockTrackItem(i + 1));

    global.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/token')) {
        return new Response(JSON.stringify({ accessToken: 'mock_token', accessTokenExpirationTimestampMs: Date.now() + 3600000 }), { status: 200 });
      }
      if (urlStr.includes('/pathfinder/v1/query')) {
        const urlObj = new URL(urlStr);
        const vars = JSON.parse(urlObj.searchParams.get('variables') || '{}');
        if (vars.offset === 0) {
          return new Response(JSON.stringify({
            data: {
              playlistV2: {
                __typename: 'Playlist',
                name: 'Failing Playlist',
                images: { items: [{ sources: [{ url: 'https://mock.spotify.cdn/fail.jpg' }] }] },
                content: { totalCount, items: page1Items },
              },
            },
          }), { status: 200 });
        } else {
          // Page 2 fails with network / server error
          return new Response('Internal Server Error', { status: 500 });
        }
      }
      return originalFetch(url, init);
    };

    try {
      await assert.rejects(
        async () => {
          await resolveSpotifyPlaylist('test_fail_mid_way');
        },
        /Failed to complete playlist pagination|Spotify Pathfinder query failed/
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 8. Track metadata isolation (track album != playlist name, track artwork != playlist artwork)
  // -------------------------------------------------------------------------
  await t.test('Scenario 8 & 11: Canonical metadata isolation preserves track album & artwork', async () => {
    const playlistName = 'Late Night Karaoke Party 2026';
    const playlistCover = 'https://mock.spotify.cdn/playlist_party_banner.jpg';
    const items = [
      generateMockTrackItem(1, 'tr_1'),
      generateMockTrackItem(2, 'tr_2'),
    ];

    global.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/token')) {
        return new Response(JSON.stringify({ accessToken: 'mock_token', accessTokenExpirationTimestampMs: Date.now() + 3600000 }), { status: 200 });
      }
      if (urlStr.includes('/pathfinder/v1/query')) {
        return new Response(JSON.stringify({
          data: {
            playlistV2: {
              __typename: 'Playlist',
              name: playlistName,
              images: { items: [{ sources: [{ url: playlistCover }] }] },
              content: { totalCount: 2, items },
            },
          },
        }), { status: 200 });
      }
      return originalFetch(url, init);
    };

    try {
      const res = await resolveSpotifyPlaylist('test_isolation');
      assert.strictEqual(res.title, playlistName);
      assert.strictEqual(res.artworkUrl, playlistCover);

      for (let i = 0; i < res.tracks.length; i++) {
        const track = res.tracks[i];
        // CRITICAL ISOLATION ASSERTIONS:
        assert.notStrictEqual(track.album, playlistName, 'Track album must not equal playlist name');
        assert.strictEqual(track.album, `Album of Track ${i + 1}`);
        assert.notStrictEqual(track.artworkUrl, playlistCover, 'Track artwork must not equal playlist artwork');
        assert.strictEqual(track.artworkUrl, `https://mock.spotify.cdn/track_album_${i + 1}.jpg`);
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 9 & 10. Local playlist cover downloading & Re-import updating
  // -------------------------------------------------------------------------
  await t.test('Scenario 9 & 10: Playlist cover saved locally and updated on re-import without duplicates', async () => {
    const testDataDir = path.resolve(process.cwd(), 'data/test_spotify_suite_covers');
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDataDir, { recursive: true });
    process.env.DATA_DIR = testDataDir;

    const dbModule = await import('../db/index.js');
    await dbModule.setupDatabase();

    const app = express();
    app.use(express.json());
    app.use(cookieParser());

    const authRoutes = (await import('../routes/auth.js')).default;
    const downloaderRoutes = (await import('../routes/downloader.js')).default;
    const playlistsRoutes = (await import('../routes/playlists.js')).default;

    app.use('/api/auth', authRoutes);
    app.use('/api/downloader', downloaderRoutes);
    app.use('/api/playlists', playlistsRoutes);

    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address() as any;
    const baseUrl = `http://localhost:${address.port}`;

    const hashedPassword = await bcrypt.hash('password123', 10);
    const now = new Date();
    const [user] = await dbModule.db.insert(users).values({
      username: 'cover_tester_user',
      password: hashedPassword,
      role: 'user',
      createdAt: now,
      updatedAt: now,
    }).returning();

    const [lib] = await dbModule.db.insert(libraries).values({
      name: 'Cover Test Lib',
      path: path.join(testDataDir, 'library'),
      lastScan: now,
    }).returning();

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);

    // Mock an image endpoint
    const mockImageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header bytes
    global.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('mock-cover-v1.png') || urlStr.includes('mock-cover-v2.png')) {
        return new Response(mockImageBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        });
      }
      return originalFetch(url, init);
    };

    try {
      const spotifyPlaylistId = 'spot_pl_cover_test_999';
      const playlistName = 'Cover Test Playlist';

      // Import 1st time with Cover V1
      const startRes1 = await fetch(`${baseUrl}/api/downloader/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          libraryId: lib.id,
          playlistName,
          playlistCoverUrl: 'https://mock.spotify.cdn/mock-cover-v1.png',
          spotifyPlaylistId,
          tracks: [{ title: 'Track 1', artist: 'Artist 1', spotifyId: 't1' }],
        }),
      });

      assert.strictEqual(startRes1.status, 200);
      const userPlaylists1 = await dbModule.db.select().from(playlists).where(eq(playlists.userId, user.id));
      assert.strictEqual(userPlaylists1.length, 1);
      const firstCover = userPlaylists1[0].coverPath;
      assert.ok(firstCover, 'First coverPath must be populated');
      
      const coverFilePath1 = path.join(testDataDir, 'playlist_covers', firstCover);
      assert.ok(fs.existsSync(coverFilePath1), 'Cover file must be created on disk in playlist_covers/');

      // Check /api/playlists endpoint serves coverImageUrl
      const listRes = await fetch(`${baseUrl}/api/playlists`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.strictEqual(listRes.status, 200);
      const listData = await listRes.json();
      assert.strictEqual(listData[0].coverImageUrl, `/api/playlists/${userPlaylists1[0].id}/cover`);

      // Re-import same playlist with updated Cover V2
      const startRes2 = await fetch(`${baseUrl}/api/downloader/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          libraryId: lib.id,
          playlistName: 'Updated Cover Test Playlist',
          playlistCoverUrl: 'https://mock.spotify.cdn/mock-cover-v2.png',
          spotifyPlaylistId,
          tracks: [{ title: 'Track 1', artist: 'Artist 1', spotifyId: 't1' }],
        }),
      });

      assert.strictEqual(startRes2.status, 200);
      const userPlaylists2 = await dbModule.db.select().from(playlists).where(eq(playlists.userId, user.id));
      assert.strictEqual(userPlaylists2.length, 1, 'Re-importing must not create duplicate playlists');
      assert.strictEqual(userPlaylists2[0].id, userPlaylists1[0].id, 'Must reuse existing playlist record');
      assert.strictEqual(userPlaylists2[0].name, 'Updated Cover Test Playlist');
      
      const secondCover = userPlaylists2[0].coverPath;
      assert.ok(secondCover, 'Second coverPath must be populated');
      assert.notStrictEqual(secondCover, firstCover, 'coverPath must be updated to new file');

      const coverFilePath2 = path.join(testDataDir, 'playlist_covers', secondCover);
      assert.ok(fs.existsSync(coverFilePath2), 'New cover file must exist on disk');

    } finally {
      global.fetch = originalFetch;
      await new Promise<void>(res => server.close(() => res()));
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });
});
