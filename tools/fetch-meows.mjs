/**
 * fetch-meows.mjs — a CC0 meow pool from Freesound, licence-checked twice.
 *
 *   FREESOUND_TOKEN=... node tools/fetch-meows.mjs
 *   node tools/fetch-meows.mjs --token=... --want=120 --min-rate=44100
 *
 * WHY THIS EXISTS. The bank pick.mjs has been running on is CatMeows (Zenodo
 * 4008297): 440 field recordings at 8 kHz mono. Measured across the 24 that got
 * picked, every one of them is a brick wall — 95% of the energy under 2.2 kHz,
 * literally nothing above 4 kHz, and a median 24 dB between the cat and the
 * hiss. Retuned up eight semitones by the sampler, that hiss lands at 6.4 kHz,
 * which is the part you hear as scratch. This fetches a source that has
 * something up there to stretch instead.
 *
 * It also fixes a licence embarrassment: CatMeows is CC BY 4.0, which is the one
 * thing in the audio side that `ALLOWED` in download.py would reject. This pool
 * is CC0 only.
 *
 * WHAT IT TAKES. The hq-ogg preview, not the original. Originals are behind
 * OAuth2 — a browser round-trip for every run — while previews are 48 kHz
 * ~192 kbps Vorbis on an open CDN. Through three filters and a playback-rate
 * shift, that is not the weak link; 8 kHz PCM was.
 *
 * LICENCE, TWICE. The search asks Freesound for CC0. Then every sound's own
 * `license` field is re-checked against CC0 here before it is kept, because a
 * search filter is not a licence check — same rule, same reason, as download.py.
 * Anything else is dropped loudly.
 *
 * Output: raw/meows/*.wav (16-bit mono) + credits.json. Feed it to pick.mjs.
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

/**
 * The api_key out of ~/.config/freesound/credentials, if it is there.
 *
 * A key on the command line ends up in shell history and a key in the repo ends
 * up in a commit, so the default place to keep it is neither: a 600 file outside
 * the working tree. --token and FREESOUND_TOKEN still win, for one-off runs.
 */
const CREDS = join(homedir(), '.config', 'freesound', 'credentials');

function storedKey() {
  if (!existsSync(CREDS)) return '';
  for (const line of readFileSync(CREDS, 'utf8').split('\n')) {
    const m = line.match(/^\s*api_key\s*=\s*(\S+)/);
    if (m) return m[1];
  }
  return '';
}

const TOKEN = arg('token', process.env.FREESOUND_TOKEN || storedKey());
const OUT = resolve(arg('out', 'raw/meows'));
const WANT = Number(arg('want', 120));
const MIN_RATE = Number(arg('min-rate', 44100));
// Wide on purpose. Searching "meow" returns 654 CC0 sounds; "cat" returns 6506,
// and the top of that ranking is not junk — it is the same meows plus growls,
// hisses and named individual animals on better microphones. The duration
// window is generous for the same reason: a 12-second clip with four meows in
// it is four samples once cut-meows.mjs has been at it, and the good field
// recordings are exactly the ones that do not arrive pre-trimmed.
const [MIN_SEC, MAX_SEC] = arg('dur', '0.2,30').split(',').map(Number);
const QUERY = arg('q', 'cat');

const API = 'https://freesound.org/apiv2/search/text/';
const FIELDS = 'id,name,username,pack,license,type,samplerate,bitdepth,channels,duration,previews,url';

/**
 * What counts as CC0. Freesound reports `license` as the deed URL rather than a
 * short name, so match the URL — but accept a short name too, in case that ever
 * changes, and never accept anything that merely contains "creative commons".
 */
const ALLOWED = /(publicdomain\/zero|^\s*(cc0|creative commons 0)\b)/i;

// ------------------------------------------------------------------ fetching --

/** One page of results. Freesound hands back a `next` URL rather than a cursor. */
async function page(url) {
  const res = await fetch(url, { headers: { Authorization: `Token ${TOKEN}` } });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Freesound rejected the token (${res.status}). Check --token.`);
  }
  if (!res.ok) throw new Error(`${url.split('?')[0]}: ${res.status} ${res.statusText}`);
  return res.json();
}

/** Every CC0 hit for QUERY, up to WANT of them, newest search ranking first. */
async function search() {
  const filter = [
    'license:"Creative Commons 0"',
    `samplerate:[${MIN_RATE} TO *]`,
    `duration:[${MIN_SEC} TO ${MAX_SEC}]`,
  ].join(' ');
  const params = new URLSearchParams({
    query: QUERY, filter, fields: FIELDS, page_size: '150', sort: 'score',
  });
  let url = `${API}?${params}`;
  const out = [];
  let total = 0;
  while (url && out.length < WANT) {
    const d = await page(url);
    total = d.count ?? total;
    out.push(...(d.results || []));
    url = d.next;
  }
  return { total, results: out.slice(0, WANT) };
}

/** The re-check. Returns [kept, dropped]; nothing is dropped silently. */
function vet(results) {
  const kept = [], dropped = [];
  for (const r of results) {
    if (!ALLOWED.test(r.license || '')) {
      dropped.push({ name: r.name, license: r.license || '?' });
      continue;
    }
    // A preview is the only thing reachable without OAuth2. No preview, no sound.
    const src = r.previews?.['preview-hq-ogg'] || r.previews?.['preview-hq-mp3'];
    if (!src) {
      dropped.push({ name: r.name, license: 'no hq preview' });
      continue;
    }
    kept.push({ ...r, src });
  }
  return [kept, dropped];
}

// --------------------------------------------------------------- conversion --

/** Anything Freesound serves -> 16-bit mono WAV, via ffmpeg on stdin. */
function convert(bytes, dest, rate) {
  return new Promise((ok, bad) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', 'pipe:0',
      '-ac', '1', '-ar', String(rate), '-acodec', 'pcm_s16le', dest]);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? ok() : bad(new Error(err.slice(0, 200)))));
    p.stdin.on('error', () => {});
    p.stdin.end(Buffer.from(bytes));
  });
}

const slug = (r) =>
  `fs${r.id}_${(r.username || 'anon').replace(/\W+/g, '').slice(0, 20)}.wav`;

/** Download and transcode everything that passed. Returns what actually landed. */
async function retrieve(kept) {
  mkdirSync(OUT, { recursive: true });
  const done = [];
  for (const r of kept) {
    const file = slug(r);
    const dest = join(OUT, file);
    if (!existsSync(dest)) {
      try {
        const res = await fetch(r.src);
        if (!res.ok) throw new Error(`preview: ${res.status}`);
        // The preview is 48 kHz whatever the original was, so writing at the
        // original's rate does not recover anything — it resamples silence up
        // and quadruples the file. Sadiquecat's 192 kHz recordings are the
        // reason this is not theoretical.
        await convert(await res.arrayBuffer(), dest, Math.min(r.samplerate, 48000));
      } catch (e) {
        console.log(`  FAIL  ${file}: ${e.message}`);
        continue;
      }
    }
    done.push({
      file, id: r.id, name: r.name, username: r.username, pack: r.pack || null,
      license: r.license, source_page: r.url, took: 'preview-hq-ogg',
      samplerate: Math.min(r.samplerate, 48000), original_samplerate: r.samplerate,
      seconds: +r.duration.toFixed(3),
    });
    if (done.length % 10 === 0) console.log(`  [${String(done.length).padStart(3)}] ${file}`);
  }
  return done;
}

// --------------------------------------------------------------------- run --

if (!TOKEN) {
  console.error(
    'fetch-meows.mjs: needs a Freesound API token.\n' +
    '  Get one (free, instant) at https://freesound.org/apiv2/apply/\n' +
    `  then put it in ${CREDS} as   api_key=xxx\n` +
    '  (or pass FREESOUND_TOKEN=xxx / --token=xxx for a one-off)',
  );
  process.exit(1);
}

console.log(`searching Freesound for CC0 "${QUERY}", ` +
  `>=${MIN_RATE} Hz, ${MIN_SEC}-${MAX_SEC}s …`);
const { total, results } = await search();
const [kept, dropped] = vet(results);
console.log(`${total} match the search, took ${results.length}; ` +
  `${kept.length} passed the CC0 re-check, ${dropped.length} dropped`);
for (const d of dropped) console.log(`  DROP  ${String(d.license).slice(0, 46).padEnd(48)}${d.name.slice(0, 40)}`);

const recs = await retrieve(kept);
writeFileSync(join(OUT, 'credits.json'), JSON.stringify(recs, null, 2) + '\n');

const rates = [...new Set(recs.map((r) => r.samplerate))].sort((a, b) => a - b);
const secs = recs.reduce((a, r) => a + r.seconds, 0);
console.log(`\nwrote ${recs.length} files (${rates.join('/')} Hz, ${secs.toFixed(0)}s total) ` +
  `+ credits.json -> ${OUT}`);
console.log(`${readdirSync(OUT).filter((f) => f.endsWith('.wav')).length} wav in the pool; ` +
  `next: node tools/pick.mjs --src=${OUT}`);
