import jwt from 'jsonwebtoken';
import { PNG } from 'pngjs';
import { db } from '../server/db/index.js';
import { users, songs, playlists, playlistSongs } from '../server/db/schema.js';
import { eq, asc } from 'drizzle-orm';

interface PlaylistSpec {
  name: string;
  description: string;
  isPublic: boolean;
  songTitles: string[];
  colors: {
    primary: [number, number, number];
    secondary: [number, number, number];
    accent: [number, number, number];
  };
}

const PLAYLIST_SPECS: PlaylistSpec[] = [
  // Private playlists (4)
  {
    name: 'Late Night Vibes',
    description: 'Smooth R&B, slow jams, and relaxed songs.',
    isPublic: false,
    songTitles: ['Love Galore (feat. Travis Scott)', 'Snooze'],
    colors: {
      primary: [30, 15, 60],
      secondary: [12, 18, 38],
      accent: [168, 85, 247],
    },
  },
  {
    name: 'My Karaoke Favourites',
    description: 'A personal collection of popular, easy-to-sing songs.',
    isPublic: false,
    songTitles: ['Snooze', 'Love Galore (feat. Travis Scott)'],
    colors: {
      primary: [250, 36, 60],
      secondary: [120, 20, 70],
      accent: [255, 105, 180],
    },
  },
  {
    name: 'Power Ballads',
    description: 'Emotional ballads, big choruses, and powerful vocals.',
    isPublic: false,
    songTitles: ['Snooze'],
    colors: {
      primary: [190, 24, 45],
      secondary: [40, 10, 20],
      accent: [251, 113, 133],
    },
  },
  {
    name: 'Practice Room',
    description: 'Songs for rehearsing vocals and improving singing technique.',
    isPublic: false,
    songTitles: ['Snooze', 'Love Galore (feat. Travis Scott)'],
    colors: {
      primary: [13, 148, 136],
      secondary: [15, 30, 45],
      accent: [45, 212, 191],
    },
  },
  // Public playlists (4)
  {
    name: 'Karaoke Party Hits',
    description: 'Upbeat, recognisable songs for parties and group singing.',
    isPublic: true,
    songTitles: ['Love Galore (feat. Travis Scott)', 'Snooze'],
    colors: {
      primary: [255, 75, 110],
      secondary: [90, 20, 220],
      accent: [255, 215, 0],
    },
  },
  {
    name: '90s & 2000s Throwbacks',
    description: 'Nostalgic hits from the 1990s and 2000s.',
    isPublic: true,
    songTitles: [], // No 90s/2000s songs exist in the library yet
    colors: {
      primary: [245, 140, 20],
      secondary: [180, 30, 150],
      accent: [56, 189, 248],
    },
  },
  {
    name: 'Duets & Sing-Alongs',
    description: 'Duets and songs suited to singing together.',
    isPublic: true,
    songTitles: ['Love Galore (feat. Travis Scott)'],
    colors: {
      primary: [244, 63, 94],
      secondary: [88, 28, 135],
      accent: [253, 164, 175],
    },
  },
  {
    name: 'Ultimate Crowd Pleasers',
    description: 'Well-known, energetic songs that work well for karaoke nights.',
    isPublic: true,
    songTitles: ['Love Galore (feat. Travis Scott)', 'Snooze'],
    colors: {
      primary: [234, 179, 8],
      secondary: [220, 38, 38],
      accent: [254, 240, 138],
    },
  },
];

function generatePlaylistCover(
  primaryColor: [number, number, number],
  secondaryColor: [number, number, number],
  accentColor: [number, number, number]
): Buffer {
  const size = 400;
  const png = new PNG({ width: size, height: size });
  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Base diagonal gradient
      const diagT = (x * 0.7 + y * 0.7) / size;
      let r = primaryColor[0] * (1 - diagT) + secondaryColor[0] * diagT;
      let g = primaryColor[1] * (1 - diagT) + secondaryColor[1] * diagT;
      let b = primaryColor[2] * (1 - diagT) + secondaryColor[2] * diagT;

      // Center radial glow
      const glow = Math.max(0, 1 - dist / (size * 0.55));
      r += accentColor[0] * glow * 0.35;
      g += accentColor[1] * glow * 0.35;
      b += accentColor[2] * glow * 0.35;

      // Vinyl groove rings
      if (dist > 50 && dist < 170) {
        const ring = Math.sin(dist * 0.5) * 7;
        r += ring;
        g += ring;
        b += ring;
      }

      // Inner disc center label
      if (dist < 42) {
        const centerT = dist / 42;
        r = r * 0.4 + accentColor[0] * 0.6 * centerT;
        g = g * 0.4 + accentColor[1] * 0.6 * centerT;
        b = b * 0.4 + accentColor[2] * 0.6 * centerT;
      }

      // Center spindle hole
      if (dist < 10) {
        r = 15;
        g = 16;
        b = 22;
      }

      png.data[idx] = Math.max(0, Math.min(255, Math.round(r)));
      png.data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      png.data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      png.data[idx + 3] = 255;
    }
  }

  return PNG.sync.write(png);
}

async function main() {
  const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.DATA_DIR?.includes('test'));
  const DETERMINISTIC_TEST_JWT_SECRET = 'yimly_deterministic_test_jwt_secret_ci_only_32_bytes_safe';
  const jwtSecret = process.env.JWT_SECRET || (isTestEnv ? DETERMINISTIC_TEST_JWT_SECRET : 'fallback_secret_for_dev');

  // 1. Get primary user (Admin)
  const allUsers = await db.select().from(users).limit(1);
  if (allUsers.length === 0) {
    throw new Error('No user found in database to own playlists');
  }
  const currentUser = allUsers[0];
  console.log(`Using owner user: ${currentUser.username} (id: ${currentUser.id}, role: ${currentUser.role})`);

  const token = jwt.sign(
    { id: currentUser.id, username: currentUser.username, role: currentUser.role },
    jwtSecret,
    { expiresIn: '2h' }
  );

  // 2. Fetch existing songs from library
  const librarySongs = await db.select().from(songs);
  console.log(`Current library contains ${librarySongs.length} songs:`);
  librarySongs.forEach(s => console.log(`  - [ID: ${s.id}] "${s.title}"`));

  const songMap = new Map<string, number>();
  for (const s of librarySongs) {
    songMap.set(s.title.toLowerCase().trim(), s.id);
  }

  // 3. Process the 8 playlists
  const baseUrl = 'http://localhost:3000';
  const results: Array<{
    name: string;
    visibility: 'public' | 'private';
    songCount: number;
    hasCover: boolean;
    status: 'created' | 'reused';
  }> = [];

  for (const spec of PLAYLIST_SPECS) {
    console.log(`\n--- Processing "${spec.name}" (${spec.isPublic ? 'Public' : 'Private'}) ---`);

    // Check if playlist already exists
    const existing = await db.select()
      .from(playlists)
      .where(eq(playlists.name, spec.name))
      .limit(1);

    let playlistId: number;
    let status: 'created' | 'reused' = 'created';

    if (existing.length > 0) {
      playlistId = existing[0].id;
      status = 'reused';
      console.log(`  Existing playlist found (ID: ${playlistId}). Updating visibility & description...`);

      // Update visibility/description via API or DB
      const updateRes = await fetch(`${baseUrl}/api/playlists/${playlistId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          description: spec.description,
          isPublic: spec.isPublic,
        }),
      });
      if (!updateRes.ok) {
        console.warn(`  Failed to update playlist via API: ${updateRes.status}. Updating DB directly.`);
        await db.update(playlists)
          .set({ description: spec.description, isPublic: spec.isPublic ? 1 : 0, updatedAt: new Date() })
          .where(eq(playlists.id, playlistId));
      }
    } else {
      console.log(`  Creating new playlist via POST /api/playlists...`);
      const createRes = await fetch(`${baseUrl}/api/playlists`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: spec.name,
          description: spec.description,
          isPublic: spec.isPublic,
        }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`Failed to create playlist "${spec.name}": ${createRes.status} ${errText}`);
      }

      const createdData = await createRes.json();
      playlistId = createdData.id;
      console.log(`  Playlist created with ID: ${playlistId}`);
    }

    // 4. Populate songs without duplicates
    const currentPlaylistSongs = await db.select()
      .from(playlistSongs)
      .where(eq(playlistSongs.playlistId, playlistId))
      .orderBy(asc(playlistSongs.position));

    const existingSongIds = new Set(currentPlaylistSongs.map(ps => ps.songId));
    let nextPosition = currentPlaylistSongs.length;

    for (const songTitle of spec.songTitles) {
      const sId = songMap.get(songTitle.toLowerCase().trim());
      if (!sId) {
        console.warn(`  Song "${songTitle}" not found in current library catalogue.`);
        continue;
      }

      if (existingSongIds.has(sId)) {
        console.log(`  Song [${sId}] "${songTitle}" already in playlist, skipping duplicate.`);
        continue;
      }

      console.log(`  Adding song [${sId}] "${songTitle}" at position ${nextPosition}...`);
      const addRes = await fetch(`${baseUrl}/api/playlists/${playlistId}/songs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          songId: sId,
          position: nextPosition,
        }),
      });

      if (!addRes.ok) {
        const errJson = await addRes.json().catch(() => ({}));
        console.warn(`  Failed to add song [${sId}] via API:`, errJson);
      } else {
        existingSongIds.add(sId);
        nextPosition++;
      }
    }

    // 5. Upload themed cover art using POST /api/playlists/:id/cover
    const coverBuffer = generatePlaylistCover(
      spec.colors.primary,
      spec.colors.secondary,
      spec.colors.accent
    );

    console.log(`  Uploading themed vinyl cover (${coverBuffer.length} bytes)...`);
    const coverRes = await fetch(`${baseUrl}/api/playlists/${playlistId}/cover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        Authorization: `Bearer ${token}`,
      },
      body: coverBuffer,
    });

    let hasCover = false;
    if (coverRes.ok) {
      const coverData = await coverRes.json();
      hasCover = !!coverData.coverImageUrl;
      console.log(`  Cover uploaded successfully: ${coverData.coverImageUrl}`);
    } else {
      console.warn(`  Cover upload returned ${coverRes.status}`);
    }

    // 6. Verify playlist detail
    const detailRes = await fetch(`${baseUrl}/api/playlists/${playlistId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const detail = await detailRes.json();

    results.push({
      name: detail.name,
      visibility: detail.isPublic ? 'public' : 'private',
      songCount: detail.songs?.length || 0,
      hasCover: !!detail.coverImageUrl,
      status,
    });
  }

  console.log('\n============================================================');
  console.log('SAMPLE PLAYLISTS CREATION SUMMARY');
  console.log('============================================================');
  console.table(results);
}

main().then(() => {
  console.log('\nCompleted sample playlist creation successfully.');
  process.exit(0);
}).catch(err => {
  console.error('\nFatal error creating sample playlists:', err);
  process.exit(1);
});
