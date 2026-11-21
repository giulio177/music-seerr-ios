// A stand-in Music Seerr server with made-up data, for screenshots and UI tests.
// Usage: node scripts/mock-server.mjs [port]   (default 8787; any username and password sign in)
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8787);
const TOKEN = 'mock-session-token';

const palette = [
  ['#f94c84', '#b23afc'],
  ['#3b82f6', '#06b6d4'],
  ['#f97316', '#ef4444'],
  ['#14b8a6', '#0ea5e9'],
  ['#8b5cf6', '#4f46e5'],
  ['#eab308', '#f97316'],
  ['#22c55e', '#14b8a6'],
  ['#ef4444', '#db2777'],
];

const artists = [
  { id: 'ar1', name: 'Neon Harbor' },
  { id: 'ar2', name: 'Velvet Static' },
  { id: 'ar3', name: 'Marina Sole' },
  { id: 'ar4', name: 'The Paper Comets' },
  { id: 'ar5', name: 'Lumen Drive' },
  { id: 'ar6', name: 'Quiet Atlas' },
];

const albumDefs = [
  ['al1', 'Midnight Transit', 'ar1', 2024, ['Midnight Transit', 'Glass Avenue', 'Afterglow Signals', 'Northbound', 'Paper Lanterns', 'City of Echoes', 'Last Train Home']],
  ['al2', 'Low Fidelity Hearts', 'ar2', 2023, ['Static Bloom', 'Tape Hiss Lullaby', 'Ghost Frequencies', 'Cassette Summer', 'Warm Noise']],
  ['al3', 'Onde', 'ar3', 2025, ['Onde', 'Sale sulla pelle', 'Faro', 'Mareggiata', 'Luce di settembre', 'Riva']],
  ['al4', 'Orbit Postcards', 'ar4', 2022, ['Comet Tail', 'Postcard from Io', 'Gravity Assist', 'Small Satellites']],
  ['al5', 'Overdrive Hymns', 'ar5', 2024, ['Ignition', 'Night Highway', 'Chrome Choir', 'Redline', 'Outrun the Dawn']],
  ['al6', 'Still Water Maps', 'ar6', 2021, ['Cartography', 'Low Tide', 'Fog Index', 'Harbor Lights']],
  ['al7', 'Neon Remixes', 'ar1', 2025, ['Glass Avenue (Night Mix)', 'Northbound (Dub)', 'Afterglow Signals (Edit)']],
  ['al8', 'Satellite Radio', 'ar5', 2023, ['Frequency', 'Carrier Wave', 'Radio Silence', 'Broadcast']],
];

const albums = albumDefs.map(([id, name, artistId, year]) => ({
  id,
  name,
  artist: artists.find((a) => a.id === artistId).name,
  artist_id: artistId,
  year,
  cover_url: `/api/jellyfin/image/${id}`,
}));

const tracks = [];
for (const [albumId, albumName, artistId, , titles] of albumDefs) {
  titles.forEach((title, i) => {
    const id = `${albumId}t${i + 1}`;
    tracks.push({
      id,
      title,
      artist: artists.find((a) => a.id === artistId).name,
      artists: [],
      artist_id: artistId,
      album: albumName,
      album_id: albumId,
      duration: '',
      duration_sec: 150 + ((i * 37) % 120),
      index_number: i + 1,
      disc_number: 1,
      has_lyrics: true,
      is_favorite: false,
      path: `/music/${albumName}/${title}.m4a`,
      stream_url: `/api/jellyfin/stream/${id}`,
      cover_url: `/api/jellyfin/image/${albumId}`,
    });
  });
}

const playlists = [
  { id: 'pl1', name: 'Late Night Drive', ids: ['al1t2', 'al5t2', 'al2t3', 'al1t1', 'al5t5', 'al8t3', 'al4t1'] },
  { id: 'pl2', name: 'Estate 2026', ids: ['al3t1', 'al3t4', 'al4t2', 'al6t2', 'al3t5'] },
  { id: 'pl3', name: 'Focus', ids: ['al6t1', 'al6t3', 'al2t5', 'al2t2'] },
  { id: 'pl4', name: 'Running', ids: ['al5t1', 'al5t4', 'al8t1', 'al1t4', 'al7t2'] },
].map((p) => ({ ...p, track_count: p.ids.length, cover_url: `/api/jellyfin/image/${p.id}` }));

const catalog = [
  ['deezer:1', 'Glass Avenue', 'Neon Harbor', 'Midnight Transit', 'al1t2'],
  ['deezer:2', 'Glass Avenue (Acoustic)', 'Neon Harbor', 'Glass Avenue Sessions', null],
  ['deezer:3', 'Glasshouse', 'Velvet Static', 'Greenhouse EP', null],
  ['deezer:4', 'Avenue of Lights', 'Lumen Drive', 'Satellite Radio', null],
  ['deezer:5', 'Glass Hearts', 'Marina Sole', 'Onde (Deluxe)', null],
].map(([id, title, artist, album, jellyfinId], i) => ({
  id,
  title,
  artist,
  album,
  duration: 200 + i * 11,
  cover_url: `/api/jellyfin/image/c${i}`,
  preview_url: `/api/jellyfin/stream/preview${i}`,
  isrc: null,
  source: 'deezer',
  in_jellyfin: !!jellyfinId,
  jellyfin_id: jellyfinId,
}));

const lyrics = [
  'Headlights paint the empty street',
  'Every window keeps a secret',
  'We were running out of night',
  'Chasing signals through the static',
  '',
  'Glass avenue, I see you shining',
  'Glass avenue, the city breathing',
  'Hold the moment, let it echo',
  'Till the morning finds us leaving',
  '',
  'Neon rivers, silver traces',
  'All the stations call your name',
];

function lrc() {
  return lyrics.map((line, i) => `[00:${String(4 + i * 4).padStart(2, '0')}.00]${line}`).join('\n');
}

function hash(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function cover(id) {
  const [a, b] = palette[hash(id) % palette.length];
  const h = hash(id + 'x');
  const cx = 30 + (h % 40);
  const cy = 30 + ((h >> 8) % 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 100 100">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<radialGradient id="r" cx="${cx}%" cy="${cy}%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="100" height="100" fill="url(#g)"/><rect width="100" height="100" fill="url(#r)"/>
<circle cx="${100 - cx}" cy="${100 - cy}" r="${18 + (h % 14)}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/>
<circle cx="${100 - cx}" cy="${100 - cy}" r="${8 + (h % 6)}" fill="#0b0b12" fill-opacity=".55"/></svg>`;
}

// A quiet two-tone WAV, long enough for the scrubber to show progress.
function wav(seconds = 240) {
  const rate = 22050;
  const samples = rate * seconds;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const v = 0.06 * Math.sin(2 * Math.PI * 220 * t) + 0.04 * Math.sin(2 * Math.PI * 330 * t);
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
const audio = wav();

const jobs = new Map();

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function authed(req) {
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const user = { id: 'u1', name: 'giulio', is_admin: true, is_guest: false };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname;
  const q = (url.searchParams.get('q') ?? '').toLowerCase();
  let m;

  if (path === '/api/health') return json(res, 200, { status: 'healthy' });
  if (path === '/api/auth/login' || path === '/api/auth/guest') {
    await readBody(req);
    const u = path.endsWith('guest') ? { name: 'Guest', is_guest: true, is_admin: false } : user;
    return json(res, 200, { success: true, user: u, session_token: TOKEN });
  }
  if (path === '/api/auth/session') return json(res, 200, authed(req) ? { authenticated: true, user } : { authenticated: false, user: null });
  if (!authed(req)) return json(res, 401, { detail: 'Sign in with Jellyfin or continue as a guest.' });

  if ((m = path.match(/^\/api\/jellyfin\/image\/(.+)$/))) {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=86400' });
    return res.end(cover(m[1]));
  }
  if (path.startsWith('/api/jellyfin/stream/')) {
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
      res.writeHead(206, {
        'Content-Type': 'audio/wav',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${audio.length}`,
        'Content-Length': end - start + 1,
      });
      return res.end(audio.subarray(start, end + 1));
    }
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': audio.length });
    return res.end(audio);
  }
  if (path === '/api/me/preferences') return json(res, 200, { accent_color: null, default_accent_color: 'pink', crossfade_seconds: 0 });
  if (path === '/api/jellyfin/playlists') return json(res, 200, playlists.map(({ ids, ...p }) => p));
  if (path === '/api/jellyfin/albums') {
    const list = albums.filter((a) => !q || a.name.toLowerCase().includes(q));
    return json(res, 200, { total: list.length, albums: list });
  }
  if (path === '/api/jellyfin/artists') {
    const list = artists.filter((a) => !q || a.name.toLowerCase().includes(q)).map((a) => ({ ...a, cover_url: `/api/jellyfin/image/${a.id}` }));
    return json(res, 200, { total: list.length, artists: list });
  }
  if ((m = path.match(/^\/api\/jellyfin\/album\/([^/]+)\/tracks$/))) {
    return json(res, 200, { album: albums.find((a) => a.id === m[1]), tracks: tracks.filter((t) => t.album_id === m[1]) });
  }
  if ((m = path.match(/^\/api\/jellyfin\/artist\/([^/]+)\/tracks$/))) {
    const artist = artists.find((a) => a.id === m[1]);
    return json(res, 200, { artist: { ...artist, cover_url: `/api/jellyfin/image/${artist.id}` }, tracks: tracks.filter((t) => t.artist_id === m[1]) });
  }
  if ((m = path.match(/^\/api\/jellyfin\/playlist\/([^/]+)\/tracks$/))) {
    const p = playlists.find((x) => x.id === m[1]);
    return json(res, 200, { playlist: { id: p.id, name: p.name, track_count: p.track_count, cover_url: p.cover_url }, tracks: p.ids.map((id) => tracks.find((t) => t.id === id)) });
  }
  if (path === '/api/jellyfin/library/tracks') {
    const list = tracks.filter((t) => !q || `${t.title} ${t.artist}`.toLowerCase().includes(q)).slice(0, Number(url.searchParams.get('limit') ?? 50));
    return json(res, 200, { total: list.length, tracks: list });
  }
  if (path.startsWith('/api/jellyfin/track-lyrics/')) return json(res, 200, { found: true, synced: lrc(), plain: lyrics.join('\n') });
  if (path === '/api/search') return json(res, 200, { query: q, total: catalog.length, results: catalog });
  if (path === '/api/download' && req.method === 'POST') {
    const body = await readBody(req);
    const job = { job_id: `job${jobs.size + 1}`, track: body.track, status: 'downloading', progress: 42, message: null };
    jobs.set(job.job_id, job);
    return json(res, 200, job);
  }
  if ((m = path.match(/^\/api\/download\/job\/(.+)$/))) return json(res, 200, jobs.get(m[1]) ?? {});
  if (path === '/api/history/plays' && req.method === 'POST') return json(res, 200, { recorded: true, id: 1 });
  if (path.startsWith('/api/history/plays/')) return json(res, 200, { listened_seconds: 0, duration: 0 });
  if (path === '/api/auth/logout') return json(res, 200, { success: true });
  return json(res, 404, { detail: 'Not found' });
}).listen(port, () => console.log(`Mock Music Seerr server on http://localhost:${port}`));
