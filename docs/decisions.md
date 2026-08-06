# Decisions

Numbered when a change lands, not on a branch. **Eight lines maximum per entry**
— what changed, why, what it cost, what would undo it. The previous project's log
reached 3,593 lines and stopped being read; a record nobody reads is worse than
no record, because it looks like one.

---

## D1 — The score is data in its own directory (2026-08-06)

`score/score.js` holds the form, arrangement, levels, colours and tune as plain
data with no functions in it. `src/` may read it and may not write it.
**Why:** the authored layer is the one Zane needs to see into; keeping it free of
machinery means it stays readable, and keeping it data means the studio page can
*draw* it rather than maintaining a second description of the piece.
**Cost:** some things that would be one line of code (a per-section swing amount,
say) need a data field plus a reader.
**Undone by:** wanting genuinely generative form. Don't — author the form.

## D2 — Tension steps at section edges, brightness glides (2026-08-06)

`bus.tensionAt` jumps at a section boundary; `bus.brightnessAt` and `colorsAt`
ease across `BLEND_BARS` (2 bars).
**Why:** a drop should be sharp — that's what a drop is. But brightness drives the
camera height and the water colour, and a step there reads as a glitch rather
than a gesture.
**Cost:** two code paths in `walk()`, and a test (`signals.mjs`) to keep the
glide honest at 30 fps.
**Undone by:** wanting a hard visual cut at a section — then it'd need to be an
opt-in field per section rather than a global rule.

## D3 — The picture reads the score, never the audio (2026-08-06)

`renderAt(t)` is a pure function of time. The kick's ring is computed from
`patterns.kickPositions` — the same function the kick pattern is built from —
not from a live note event.
**Why:** it makes any frame renderable on demand, which is what `npm run board`
and the studio scrubber stand on. Frames are exact rather than "whatever was on
screen when we looked".
**Cost:** anything the picture wants from the music has to be exposed as a pure
function first. Live-only reactions (an FFT bloom) are ruled out by this.
**Undone by:** nothing cheaply. This is load-bearing; see CLAUDE.md §9.

## D4 — No sample files; every sound is synthesised (2026-08-06)

Six voices built from `sine`/`sawtooth`/`triangle` and `white`/`brown` noise. No
sample packs, local or remote.
**Why:** the repo works offline, has no licensing question, and every timbre is a
line of code that can be changed rather than a `.wav` that can't.
**Cost:** the kick is a synthesised thump rather than a real drum, and it will
never hit as hard as a sample.
**Undone by:** wanting a specific real drum sound. Then ship the samples in-repo
and note the licence — don't fetch them at boot.
