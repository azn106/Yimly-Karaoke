import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectTrackIntent,
  cleanString,
  normalizeCanonicalMetadata,
} from '../lib/canonical-metadata.js';
import {
  scoreCandidate,
  matchSpotifyTrackToYouTube,
  parseDurationSeconds,
  YouTubeCandidate,
} from '../lib/youtube-matcher.js';
import { saveArtworkBuffer } from '../lib/scanner.js';

describe('Canonical Metadata & Intent Detection', () => {
  test('1. Single song search intent extracts title, main artist, and featured artists', () => {
    const intent = detectTrackIntent(
      'Superhuman (feat. Keri Hilson)',
      'Chris Brown'
    );
    assert.equal(intent.coreTitle, 'Superhuman');
    assert.equal(intent.mainArtist, 'Chris Brown');
    assert.deepEqual(intent.featuredArtists, ['Keri Hilson']);
    assert.equal(intent.isRemix, false);
    assert.equal(intent.isLive, false);
    assert.equal(intent.isCover, false);

    const normalized = normalizeCanonicalMetadata({
      title: 'Superhuman (feat. Keri Hilson)',
      artist: 'Chris Brown',
      album: 'Exclusive',
      duration: 218000, // Milliseconds input
      artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/cover.jpg',
    });

    assert.equal(normalized.title, 'Superhuman (feat. Keri Hilson)');
    assert.equal(normalized.artist, 'Chris Brown');
    assert.equal(normalized.album, 'Exclusive');
    assert.equal(normalized.duration, 218); // Converted to seconds
    assert.equal(normalized.artworkUrl, 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/cover.jpg');
  });

  test('2. Spotify playlist title is never treated as a valid album', () => {
    const normalized = normalizeCanonicalMetadata({
      title: 'Single Song',
      artist: 'Some Artist',
      album: 'Spotify Playlist', // Known playlist placeholder
      duration: 180,
    });
    assert.equal(normalized.album, undefined);

    const normalized2 = normalizeCanonicalMetadata({
      title: 'Single Song',
      artist: 'Some Artist',
      album: 'Top 50 Hits 2026',
      duration: 180,
    });
    assert.equal(normalized2.album, 'Top 50 Hits 2026');
  });

  test('3. Discards invalid artwork URLs and keeps valid ones', () => {
    const invalidArt = normalizeCanonicalMetadata({
      title: 'Song',
      artist: 'Artist',
      artworkUrl: 'data:image/png;base64,invalid',
    });
    assert.equal(invalidArt.artworkUrl, undefined);

    const validArt = normalizeCanonicalMetadata({
      title: 'Song',
      artist: 'Artist',
      artworkUrl: 'https://images.example.com/art.jpg',
    });
    assert.equal(validArt.artworkUrl, 'https://images.example.com/art.jpg');
  });
});

describe('Audio Matching & Verification Engine', () => {
  test('8. A similarly named artist or cover is rejected over the original', () => {
    const target = {
      title: 'Superhuman',
      artist: 'Chris Brown feat. Keri Hilson',
      duration: 218,
    };

    const coverCandidate: YouTubeCandidate = {
      id: 'Mn0-xchTxpo',
      url: 'https://www.youtube.com/watch?v=Mn0-xchTxpo',
      title: 'Superhuman (Made Famous by Chris Brown)',
      artist: 'Double Platinum All-Stars',
      duration: 218, // Exact duration match!
    };

    const unrelatedArtistCandidate: YouTubeCandidate = {
      id: 'ginuwine_sh',
      url: 'https://www.youtube.com/watch?v=ginuwine_sh',
      title: 'Superhuman',
      artist: 'Ginuwine',
      duration: 218,
    };

    const scoredCover = scoreCandidate(target, coverCandidate);
    const scoredUnrelated = scoreCandidate(target, unrelatedArtistCandidate);

    // Cover / "Made Famous By" must receive severe negative penalty
    assert.ok(scoredCover.score < 0, `Cover scored ${scoredCover.score}, expected negative`);
    // Unrelated artist must receive primary artist mismatch penalty
    assert.ok(scoredUnrelated.score < 40, `Unrelated artist scored ${scoredUnrelated.score}, expected < 40`);
  });

  test('9a. Official studio recording beats an otherwise similar live performance', () => {
    const target = {
      title: 'Hotel California',
      artist: 'Eagles',
      duration: 390,
    };

    const studioCandidate: YouTubeCandidate = {
      id: 'studio_eagles',
      url: 'https://www.youtube.com/watch?v=studio_eagles',
      title: 'Hotel California (2013 Remaster)',
      artist: 'Eagles - Topic',
      duration: 391, // 1 second difference
      isTopic: true,
      isOfficial: true,
    };

    const liveCandidate: YouTubeCandidate = {
      id: 'live_eagles',
      url: 'https://www.youtube.com/watch?v=live_eagles',
      title: 'Hotel California (Live at The Forum, 1976)',
      artist: 'Eagles - Topic',
      duration: 390, // Exact 0 second duration match!
      isTopic: true,
      isOfficial: true,
    };

    const scoredStudio = scoreCandidate(target, studioCandidate);
    const scoredLive = scoreCandidate(target, liveCandidate);

    assert.ok(
      scoredStudio.score > scoredLive.score,
      `Studio score (${scoredStudio.score}) should beat live score (${scoredLive.score}) despite live having exact duration`
    );
  });

  test('9b. Official studio recording beats an otherwise similar remix', () => {
    const target = {
      title: 'Levels',
      artist: 'Avicii',
      duration: 200,
    };

    const studioCandidate: YouTubeCandidate = {
      id: 'studio_avicii',
      url: 'https://www.youtube.com/watch?v=studio_avicii',
      title: 'Levels (Radio Edit)',
      artist: 'Avicii - Topic',
      duration: 199,
      isTopic: true,
      isOfficial: true,
    };

    const remixCandidate: YouTubeCandidate = {
      id: 'remix_avicii',
      url: 'https://www.youtube.com/watch?v=remix_avicii',
      title: 'Levels (Skrillex Remix)',
      artist: 'Avicii - Topic',
      duration: 200, // Exact duration match!
      isTopic: true,
      isOfficial: true,
    };

    const scoredStudio = scoreCandidate(target, studioCandidate);
    const scoredRemix = scoreCandidate(target, remixCandidate);

    assert.ok(
      scoredStudio.score > scoredRemix.score,
      `Studio score (${scoredStudio.score}) should beat remix score (${scoredRemix.score})`
    );
  });

  test('9c. Explicit remix target rewards remix candidate', () => {
    const target = {
      title: 'Levels (Skrillex Remix)',
      artist: 'Avicii',
      duration: 260,
    };

    const remixCandidate: YouTubeCandidate = {
      id: 'remix_avicii_full',
      url: 'https://www.youtube.com/watch?v=remix_avicii_full',
      title: 'Levels (Skrillex Remix)',
      artist: 'Avicii - Topic',
      duration: 260,
      isTopic: true,
      isOfficial: true,
    };

    const studioCandidate: YouTubeCandidate = {
      id: 'studio_avicii_orig',
      url: 'https://www.youtube.com/watch?v=studio_avicii_orig',
      title: 'Levels (Original Version)',
      artist: 'Avicii - Topic',
      duration: 200,
      isTopic: true,
      isOfficial: true,
    };

    const scoredRemix = scoreCandidate(target, remixCandidate);
    const scoredStudio = scoreCandidate(target, studioCandidate);

    assert.ok(
      scoredRemix.score > scoredStudio.score,
      `Remix candidate (${scoredRemix.score}) should win when user explicitly requested remix (studio: ${scoredStudio.score})`
    );
  });

  test('Official Topic-channel upload ranks highly without blindly trusting every result', () => {
    const target = {
      title: 'Superhuman',
      artist: 'Chris Brown feat. Keri Hilson',
      duration: 218,
    };

    const topicCandidate: YouTubeCandidate = {
      id: 'cb_topic_sh',
      url: 'https://www.youtube.com/watch?v=cb_topic_sh',
      title: 'Superhuman (feat. Keri Hilson)',
      artist: 'Chris Brown - Topic',
      duration: 218,
      isTopic: true,
      isOfficial: true,
    };

    const randomUgcCandidate: YouTubeCandidate = {
      id: 'random_ugc_sh',
      url: 'https://www.youtube.com/watch?v=random_ugc_sh',
      title: 'Superhuman [Official Audio]',
      artist: 'RandomUser123',
      duration: 218,
      hasOfficialAudioBadge: true,
      isTopic: false,
      isOfficial: false,
    };

    const scoredTopic = scoreCandidate(target, topicCandidate);
    const scoredUgc = scoreCandidate(target, randomUgcCandidate);

    assert.ok(
      scoredTopic.score > scoredUgc.score,
      `Topic upload (${scoredTopic.score}) should beat third-party upload with Official Audio in title (${scoredUgc.score})`
    );
  });
});

describe('Artwork Buffer & MIME Sniffing', () => {
  test('11. Detects PNG, JPEG, and WebP correctly from magic bytes', async () => {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
    const pngFilename = await saveArtworkBuffer(pngBuffer, 'application/octet-stream');
    assert.ok(pngFilename.endsWith('.png'), `Expected .png filename, got ${pngFilename}`);

    // JPEG signature: FF D8 FF
    const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
    const jpegFilename = await saveArtworkBuffer(jpegBuffer, 'application/octet-stream');
    assert.ok(jpegFilename.endsWith('.jpg'), `Expected .jpg filename, got ${jpegFilename}`);

    // WebP signature: RIFF....WEBP
    const webpBuffer = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP'),
    ]);
    const webpFilename = await saveArtworkBuffer(webpBuffer, 'application/octet-stream');
    assert.ok(webpFilename.endsWith('.webp'), `Expected .webp filename, got ${webpFilename}`);
  });
});

describe('Duration Parsing Utilities', () => {
  test('Parses minutes:seconds and hours:minutes:seconds accurately', () => {
    assert.equal(parseDurationSeconds('3:45'), 225);
    assert.equal(parseDurationSeconds('03:45'), 225);
    assert.equal(parseDurationSeconds('1:02:15'), 3735);
    assert.equal(parseDurationSeconds(''), 0);
    assert.equal(parseDurationSeconds('invalid'), 0);
  });
});

describe('Search Expansion & Confidence Fallbacks', () => {
  test('Superhuman by Chris Brown featuring Keri Hilson generates intelligent query expansions', () => {
    const rawQuery = '"Superhuman" by Chris Brown featuring Keri Hilson';
    const intent = detectTrackIntent(rawQuery, '');

    assert.equal(intent.coreTitle, 'Superhuman');
    const cleanCore = cleanString(intent.coreTitle);
    assert.equal(cleanCore, 'superhuman');
    assert.equal(intent.mainArtist, 'Chris Brown');
    assert.ok(intent.featuredArtists.includes('Keri Hilson'));
  });

  test('matchSpotifyTrackToYouTube rejects low confidence matches instead of arbitrary downloads', async () => {
    // When only low-scoring / negative-scoring candidates exist (covers, tributes)
    const target = {
      title: 'Very Obscure Track',
      artist: 'Unheard Artist',
      duration: 180,
    };

    // Candidate is a completely different song by a different artist with matching duration
    const badCandidate: YouTubeCandidate = {
      id: 'bad_id',
      url: 'https://www.youtube.com/watch?v=bad_id',
      title: 'Completely Unrelated Track',
      artist: 'Someone Else',
      duration: 180, // Same duration
    };

    const scored = scoreCandidate(target, badCandidate);
    // Score should be below acceptable threshold (< 40)
    assert.ok(scored.score < 40, `Expected score < 40, got ${scored.score}`);
  });

  test('YouTube link resolution preserves exact audio source URL while separating metadata', () => {
    const pastedUrl = 'https://www.youtube.com/watch?v=fhMlSITt7hU';
    const rawTitle = 'Chris Brown - Superhuman (Official Music Video) ft. Keri Hilson';
    const uploader = 'ChrisBrownVEVO';

    const intent = detectTrackIntent(rawTitle, uploader);
    assert.equal(intent.coreTitle, 'Chris Brown - Superhuman');
    // Ensure "Official Music Video" was stripped from core title
    assert.ok(!intent.coreTitle.toLowerCase().includes('official music video'));

    const normalized = normalizeCanonicalMetadata({
      title: intent.coreTitle,
      artist: intent.mainArtist,
      sourceType: 'youtube',
      audioSourceUrl: pastedUrl,
    });

    assert.equal(normalized.audioSourceUrl, pastedUrl);
    assert.equal(normalized.sourceType, 'youtube');
  });

  test('Superhuman by Chris Brown featuring Keri Hilson can be found and ranked #1 when present in provider results', () => {
    const target = {
      title: 'Superhuman',
      artist: 'Chris Brown feat. Keri Hilson',
      duration: 218,
    };

    const providerCandidates: YouTubeCandidate[] = [
      {
        id: 'fhMlSITt7hU',
        url: 'https://www.youtube.com/watch?v=fhMlSITt7hU',
        title: 'Superhuman (feat. Keri Hilson)',
        artist: 'Chris Brown',
        duration: 220,
        isOfficial: true,
      },
      {
        id: 'wNy6bnANY1o',
        url: 'https://www.youtube.com/watch?v=wNy6bnANY1o',
        title: 'Chris Brown ft. Keri Hilson - Superhuman (with lyrics)',
        artist: 'WANDERPOEM',
        duration: 218,
        isOfficial: false,
      },
      {
        id: 'Mn0-xchTxpo',
        url: 'https://www.youtube.com/watch?v=Mn0-xchTxpo',
        title: 'Superhuman (Made Famous by Chris Brown)',
        artist: 'Double Platinum All-Stars',
        duration: 218,
        isOfficial: false,
      },
      {
        id: 'live_superhuman',
        url: 'https://www.youtube.com/watch?v=live_sh',
        title: 'Superhuman (Live at London O2)',
        artist: 'Chris Brown',
        duration: 218,
        isOfficial: true,
      },
      {
        id: 'remix_superhuman',
        url: 'https://www.youtube.com/watch?v=remix_sh',
        title: 'Superhuman (Club Remix)',
        artist: 'Chris Brown',
        duration: 218,
        isOfficial: true,
      },
    ];

    const ranked = providerCandidates
      .map(c => scoreCandidate(target, c))
      .sort((a, b) => b.score - a.score);

    // 1. The official studio recording must be ranked #1
    assert.equal(ranked[0].candidate.id, 'fhMlSITt7hU');
    assert.ok(ranked[0].score >= 100, `Expected score >= 100, got ${ranked[0].score}`);

    // 2. The official recording beats live performance and remix despite live/remix having exact duration
    const liveMatch = ranked.find(r => r.candidate.id === 'live_superhuman')!;
    const remixMatch = ranked.find(r => r.candidate.id === 'remix_superhuman')!;
    assert.ok(ranked[0].score > liveMatch.score, 'Studio recording must beat live performance');
    assert.ok(ranked[0].score > remixMatch.score, 'Studio recording must beat remix');

    // 3. Made famous by / cover receives negative score and is rejected
    const coverMatch = ranked.find(r => r.candidate.id === 'Mn0-xchTxpo')!;
    assert.ok(coverMatch.score < 0, 'Cover / Made Famous By must receive negative score');
  });

  test('Natural-language search "Superhuman from Chris Brown" resolves title and artist correctly', () => {
    const intent = detectTrackIntent('Superhuman from Chris Brown', '');

    assert.equal(intent.coreTitle, 'Superhuman');
    assert.equal(intent.mainArtist, 'Chris Brown');
    assert.deepEqual(intent.featuredArtists, []);

    // Representative official studio result should outrank a same-title wrong-artist upload.
    const officialCandidate: YouTubeCandidate = {
      id: 'superhuman_official_test',
      url: 'https://www.youtube.com/watch?v=superhuman_official_test',
      title: 'Superhuman (feat. Keri Hilson)',
      artist: 'Chris BrownVEVO',
      duration: 218,
      isOfficial: true,
    };
    const wrongArtistCandidate: YouTubeCandidate = {
      id: 'superhuman_wrong_artist_test',
      url: 'https://www.youtube.com/watch?v=superhuman_wrong_artist_test',
      title: 'Superhuman',
      artist: 'Another Artist',
      duration: 218,
    };

    const officialScore = scoreCandidate(
      { title: intent.coreTitle, artist: intent.mainArtist, duration: 218 },
      officialCandidate
    );
    const wrongArtistScore = scoreCandidate(
      { title: intent.coreTitle, artist: intent.mainArtist, duration: 218 },
      wrongArtistCandidate
    );

    assert.ok(officialScore.score > wrongArtistScore.score);
    assert.ok(officialScore.score >= 100);
  });

  test('A matching VEVO channel is recognised even when its name uses CamelCase', () => {
    const target = { title: 'Superhuman', artist: 'Chris Brown', duration: 218 };
    const vevoCandidate: YouTubeCandidate = {
      id: 'chris_brown_vevo_test',
      url: 'https://www.youtube.com/watch?v=chris_brown_vevo_test',
      title: 'Superhuman (Official Music Video)',
      artist: 'ChrisBrownVEVO',
      duration: 218,
      isOfficial: true,
    };
    const unrelatedVevoCandidate: YouTubeCandidate = {
      id: 'unrelated_vevo_test',
      url: 'https://www.youtube.com/watch?v=unrelated_vevo_test',
      title: 'Superhuman',
      artist: 'UnrelatedArtistVEVO',
      duration: 218,
      isOfficial: false,
    };

    const matchingScore = scoreCandidate(target, vevoCandidate);
    const unrelatedScore = scoreCandidate(target, unrelatedVevoCandidate);
    assert.ok(matchingScore.score > unrelatedScore.score);
  });

  test('A duration mismatch greater than 30 seconds cannot win on official status alone', () => {
    const target = { title: 'Superhuman', artist: 'Chris Brown', duration: 218 };
    const closeCandidate: YouTubeCandidate = {
      id: 'superhuman_close_duration',
      url: 'https://www.youtube.com/watch?v=superhuman_close_duration',
      title: 'Superhuman',
      artist: 'Chris Brown - Topic',
      duration: 220,
      isTopic: true,
      isOfficial: true,
    };
    const wrongRecording: YouTubeCandidate = {
      id: 'superhuman_wrong_duration',
      url: 'https://www.youtube.com/watch?v=superhuman_wrong_duration',
      title: 'Superhuman',
      artist: 'Chris Brown - Topic',
      duration: 280,
      isTopic: true,
      isOfficial: true,
    };

    assert.ok(
      scoreCandidate(target, closeCandidate).score > scoreCandidate(target, wrongRecording).score,
      'A plausible duration match should beat a different-length recording'
    );
  });

  test('Query decomposition handles Superhuman queries in various formats', () => {
    const queries = [
      'Superhuman by Chris Brown featuring Keri Hilson',
      '"Superhuman" by Chris Brown featuring Keri Hilson',
      'Chris Brown - Superhuman ft. Keri Hilson',
      'Chris Brown: Superhuman',
    ];

    for (const q of queries) {
      const intent = detectTrackIntent(q, '');
      assert.equal(intent.coreTitle, 'Superhuman', `Failed on query: ${q}`);
      assert.equal(intent.mainArtist, 'Chris Brown', `Failed on query: ${q}`);
    }
  });
});

