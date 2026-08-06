# Strudel, as used in this repo

Not a general tutorial — a guide to exactly what `src/music/patterns.js` does, so
you can open that file and change it. Everything here is runnable: `npm run dev`,
click, and edit; Vite reloads and the pattern recompiles.

## The one idea

A **pattern** is a function from a stretch of time to a list of events. That's
it. Strudel's unit of time is a **cycle**. In this repo one cycle is one bar of
4/4, set in `src/music/engine.js`:

```js
scheduler.setCps(bus.CPS);      // CPS = BPM / 60 / 4  →  cycles per second
```

At 96 BPM a bar is 2.5 seconds. Change `BPM` in `score/score.js` and everything —
music, section lengths, the timeline drawing — moves together, because they all
read that one number.

## Mini-notation

Strings inside `note(...)` and `s(...)` are a tiny rhythm language. It's enabled
by `miniAllStrings()` in `engine.js`.

| You write | You get |
|---|---|
| `"a b c d"` | four events, evenly splitting the cycle |
| `"a ~ ~ ~"` | one event on beat 1, then three rests (`~` is a rest) |
| `"[a,b,c]"` | a **chord** — all three at once |
| `"a*4"` | `a` four times inside its slot |
| `"a b"` where `a` is `"[x y]"` | nesting subdivides |

This repo does not lean on the fancier operators. `patterns.js` builds explicit
16-step strings with a helper, because a written-out grid is something you can
read at a glance:

```js
function grid(positions, token) {          // [0, 8] → "x ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~"
  const set = new Set(positions);
  return Array.from({ length: 16 }, (_, i) => (set.has(i) ? token : '~')).join(' ');
}
```

So a kick on beats 1 and 3 is `s(grid([0, 8], 'white'))`. Sixteen slots, and
position `i` is the i-th sixteenth note.

## The two ways to start a pattern

- `s("...")` — **sound**. The token names a sound source.
- `note("...")` — **pitch**. The token is a note. We pass fractional MIDI numbers
  as strings (`"50.000"`), because superdough reads the decimal part as cents,
  so microtuning is free if you ever want it.

You usually want both: `note("50").s("sawtooth")` means *this pitch, on that
oscillator*.

## Sound sources available here

This repo uses **no sample files at all**, so it works offline and every timbre
is code you can edit. `registerSynthSounds()` gives you:

- oscillators: `sine`, `sawtooth`, `square`, `triangle`
- noise: `white`, `pink`, `brown`, `crackle`

That's the whole palette. A kick is a low `sine` with a fast decay plus a tiny
`white` click glued to the front — look at `pulse()` in `patterns.js`. There is
no `bd` sample; the kick is four lines of envelope.

## The methods this repo uses

Chained onto a pattern, each returns a new pattern:

**Envelope** — the shape of a single note over time.
```js
.attack(0.001)   // seconds to reach full volume
.decay(0.2)      // seconds to fall to the sustain level
.sustain(0)      // level held while the note lasts (0 = a percussive hit)
.release(0.03)   // seconds to fade after the note ends
```
`sustain(0)` with a short `decay` is a hit. A long `attack` with a high `sustain`
is a pad — that's the difference between `pulse()` and `air()`, and it is most of
what makes them feel like different instruments.

**Filter** — what frequencies survive.
```js
.lpf(1200)        // low-pass: keep below 1200 Hz (this is the "brightness" knob)
.hpf(6800)        // high-pass: keep above — how the hats are made from white noise
.resonance(7)     // emphasise right at the cutoff; high values whistle
```

**Space and placement**
```js
.room(0.6)        // reverb send
.roomsize(8)      // how big that room is
.pan(0.45)        // 0 = left, 1 = right
.gain(0.3)        // level. In this repo it always comes from score.js LEVELS
.orbit(3)         // which output bus — orbits have independent reverbs
```

Orbits in this repo: `1` = drums, `2` = bass, `3` = everything with space on it.

**Combining**
```js
stack(a, b, c)    // play together (vertical)
cat(a, b, c)      // play one per cycle, in order (horizontal)
silence           // a pattern with no events
```

## How the whole piece is compiled

This is the part worth understanding, and it's ten lines. `buildPiece()` makes
**one pattern per bar** and hands the list to `cat`:

```js
for (let bar = 0; bar < bus.TOTAL_BARS; bar++) {
  const ctx = contextForBar(bar);              // tension, brightness, mode, who plays
  const layers = ctx.voices.map((id) => BUILDERS[id](strudel, ctx));
  bars.push(stack(...layers));
}
return cat(...bars);                            // bar 0, then bar 1, then bar 2…
```

`cat` plays exactly one item per cycle, so `bars[17]` **is** bar 17 of the piece.
You can print it, inspect it, or replace it, and nothing else has to agree.

A cleverer engine would compute what bar it's on from the cycle number and be
half the length. It would also be much harder to see into, and seeing into it is
the entire point of this repo.

`contextForBar(bar)` is where the score becomes music:

```js
const t = (bar + 0.5) * bus.BAR_SECONDS;    // sample the middle of the bar
T:          bus.tensionAt(t),               // 0..1 → drum density, filter opening
brightness: bus.brightnessAt(t),            // 0..1 → which mode, how open the pad
mode:       bus.modeAt(brightness),         // aeolian → dorian → … → lydian
voices:     at.section.voices,              // the arrangement, straight from score.js
```

## Try these

Each is one line, and you'll hear it immediately.

1. **Make the hats busier earlier.** In `tick()`, change
   `T < 0.45 ? 4 : T < 0.78 ? 2 : 1` to `T < 0.2 ? 4 : T < 0.5 ? 2 : 1`.
2. **Give the bass a different passing note.** In `bass()`, change
   `[4, 3, 5]` to `[6, 1, 4]` — same rhythm, different colour.
3. **Detune the pad.** In `air()`, add `.detune(0.15)` before `.gain(...)`.
4. **Silence a voice without touching code.** Set its `LEVELS` entry to `0` in
   `score/score.js`. This is also how you find out which voice is the one
   annoying you — mute them one at a time.
5. **Change the tune.** `MOTIF` in `score/score.js` is seven numbers. They are
   scale degrees: `0` is the root, `4` is a fifth above, `null` is a rest.

## Where to look when something is silent

1. Is the voice in that section's `voices` array in `score/score.js`?
2. Is its `LEVELS` entry above 0?
3. Is the sound name one of the eight listed above? A typo doesn't throw — it
   just doesn't sound. `npm test` catches the *voice*-level version of this
   mistake but not a misspelled oscillator.
4. `node tools/ab.mjs --secs=6` prints the peak level of what it recorded, so you
   can tell "silent" from "quiet" without trusting your speakers.
