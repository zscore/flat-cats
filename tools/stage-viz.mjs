/**
 * stage-viz.mjs — assemble everything viz.html needs into public/viz/.
 *
 *   node tools/stage-viz.mjs --song=out/blackwood_meowed.wav
 *
 * The page is a browser page, so its inputs have to be reachable over HTTP,
 * and out/ is not something anything downstream is allowed to read from. So
 * this stages: the cutouts worth looking at, the onset analysis, and the song.
 *
 * The filter is the interesting part. segment.py's report gives a foreground
 * coverage per cat, and four of the forty came out effectively empty — a cat
 * that is 0% foreground draws as nothing at all, which on screen reads as a
 * dropped beat rather than as a bad matte. They are dropped here, loudly.
 *
 * What comes out: public/viz/{cats,tails,bodies,faces}/*.png plus onsets.json,
 * song.wav and manifest.json
 * Re-run it to re-stage; nothing in there is hand-edited.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { readWav } from './wav.mjs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

const CUTOUTS = resolve(arg('cutouts', 'out/cutout'));
const REPORT = resolve(arg('report', 'out/report.json'));
const ONSETS = resolve(arg('onsets', 'out/onsets.json'));
const TAILS = resolve(arg('tails', 'out/tails'));
const BODIES = resolve(arg('bodies', 'out/bodies'));
const TAILS_JSON = resolve(arg('tails-json', 'out/tails.json'));
const FACES = resolve(arg('faces', 'out/faces'));
const FACES_JSON = resolve(arg('faces-json', 'out/faces.json'));
// Default to whatever onsets.json was actually measured on. The meowed and
// triggered renders in out/ are built from the untrimmed original, which is
// 4.35s longer at the head — play one of those against these onsets and every
// cat lands four seconds before its note.
const SONG = resolve(arg('song', 'blackwood_17_notes_trimmed.wav'));
const OUT = resolve('public/viz');
const MIN_COVERAGE = Number(arg('min-coverage', 0.05));

for (const [label, path, fix] of [
  ['cutouts', CUTOUTS, 'segment.py'],
  ['report', REPORT, 'segment.py'],
  ['onsets', ONSETS, 'tools/onsets.mjs'],
  ['tails', TAILS, 'tails.py'],
  ['bodies', BODIES, 'tails.py'],
  ['tails.json', TAILS_JSON, 'tails.py'],
  ['faces', FACES, 'faces.py'],
  ['faces.json', FACES_JSON, 'faces.py'],
  ['song', SONG, null],
]) {
  if (!existsSync(path)) {
    console.error(`missing ${label}: ${path}`);
    if (fix) console.error(`run ${fix} first.`);
    process.exit(1);
  }
}

// -------------------------------------------------------------------- sync --

// The analysis names the file it ran on. If the song being staged is a
// different length, the cats are drawn against a clock that is not the one
// playing, and that is not something you want to discover by eye.
const analysis = JSON.parse(readFileSync(ONSETS, 'utf8'));
const song = readWav(SONG);
const seconds = song.data.length / (song.sr * song.channels);
const drift = Math.abs(seconds - analysis.seconds);
if (drift > 0.5) {
  console.error(`onsets were measured on ${analysis.file} (${analysis.seconds}s)`);
  console.error(`but ${basename(SONG)} is ${seconds.toFixed(2)}s — ${drift.toFixed(2)}s of drift.`);
  console.error('stage the file the onsets were measured on, or re-run tools/onsets.mjs.');
  process.exit(1);
}

// ------------------------------------------------------------------ select --

const { coverage } = JSON.parse(readFileSync(REPORT, 'utf8'));
const kept = [];
const dropped = [];
for (const [id, frac] of Object.entries(coverage).sort()) {
  const png = join(CUTOUTS, `${id}.png`);
  if (!existsSync(png)) dropped.push([id, 'no cutout']);
  else if (frac < MIN_COVERAGE) dropped.push([id, `coverage ${frac}`]);
  else kept.push({ id, coverage: frac, file: `cats/${id}.png` });
}

if (!kept.length) {
  console.error('every cat was dropped — check --min-coverage and out/report.json');
  process.exit(1);
}

// -------------------------------------------------------------------- copy --

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'cats'), { recursive: true });
mkdirSync(join(OUT, 'tails'), { recursive: true });
mkdirSync(join(OUT, 'bodies'), { recursive: true });

for (const cat of kept) copyFileSync(join(CUTOUTS, `${cat.id}.png`), join(OUT, cat.file));

// The tail burst is built out of these. tails.py has already done the choosing
// and the dropping; whatever it kept is what the page gets. The body beside
// each tail is that cat with the tail taken off — the burst's host wears one,
// so the fan is the only tail it has.
const tails = JSON.parse(readFileSync(TAILS_JSON, 'utf8')).tails.map((t) => ({
  ...t,
  file: `tails/${t.file}`,
  body: `bodies/${t.body}`,
}));
if (!tails.length) {
  console.error('out/tails.json is empty — re-run tails.py, the burst needs tails');
  process.exit(1);
}
for (const t of tails) {
  copyFileSync(join(TAILS, basename(t.file)), join(OUT, t.file));
  copyFileSync(join(BODIES, basename(t.body)), join(OUT, t.body));
}

// The face burst needs cats that can both host a chimera and donate to one, so
// it takes only the complete faces — two eyes, two ears, a muzzle. A cat with
// one ear could still host, but keeping track of which cats may appear in which
// role is more bookkeeping than the extra few faces are worth.
const faces = JSON.parse(readFileSync(FACES_JSON, 'utf8')).faces.filter(
  (f) => f.eyes.length === 2 && f.ears.length === 2 && f.muzzle.length,
);
if (faces.length < 3) {
  console.error(`only ${faces.length} complete faces in out/faces.json — the burst needs 3`);
  process.exit(1);
}
mkdirSync(join(OUT, 'faces'), { recursive: true });
for (const f of faces) {
  for (const p of [f.head, ...f.eyes, ...f.ears, ...f.muzzle]) {
    copyFileSync(join(FACES, p.file), join(OUT, 'faces', p.file));
    p.file = `faces/${p.file}`;
  }
}

writeFileSync(join(OUT, 'onsets.json'), JSON.stringify(analysis));
copyFileSync(SONG, join(OUT, 'song.wav'));

writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify(
    { song: 'song.wav', onsets: 'onsets.json', source: basename(SONG), cats: kept, tails, faces },
    null,
    2,
  ) + '\n',
);

// ------------------------------------------------------------------ report --

for (const [id, why] of dropped) console.log(`dropped ${id} — ${why}`);
console.log(
  `\nstaged ${kept.length} cats + ${tails.length} tails + ${faces.length} faces + ${analysis.count} onsets → public/viz/` +
    `\nsong ${basename(SONG)} ${seconds.toFixed(2)}s vs analysis ${analysis.seconds}s (${drift.toFixed(3)}s drift)`,
);
