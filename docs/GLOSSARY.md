# Glossary — Zane's words → what they are in the source

Zane names things by what they sound or look like. The source names them by what
they are. This file is the bridge, and it is **maintained by Claude**: whenever a
new name gets resolved in conversation, it gets added here in the same session.

Why this file exists: in the last project "the high pitched organ stuff" turned
out to be a saw pad re-attacking under a long release, and there was no organ in
the cast at all. Twenty minutes went into grepping for the wrong word. Worse,
another time a word *did* match a real thing in the source that wasn't what he
meant, which is the failure mode that wastes a whole afternoon.

**The rule (CLAUDE.md §7):** for a section or voice, ask which one. For a sound
he can't name, don't guess and don't grep his word — measure by muting voices one
at a time via `LEVELS` in `score/score.js`.

---

## Voices

| He says | It is | Where |
|---|---|---|
| — | `surf` — brown noise wash, filter opens with tension | `patterns.js` `surf()` |
| "the kick" | `pulse` — sine thump + white click | `patterns.js` `pulse()` |
| "the hats" | `tick` — filtered white noise, spacing from tension | `patterns.js` `tick()` |
| — | `bass` — sawtooth, root + one passing tone per bar | `patterns.js` `bass()` |
| "the pad", "the chord" | `air` — held sawtooth chord, long attack/release | `patterns.js` `air()` |
| "the tune", "the melody" | `bell` — triangle, states `MOTIF` one degree per bar | `patterns.js` `bell()` |

## Sections

| He says | It is |
|---|---|
| "the intro", "the start" | `lowtide` |
| "the climax", "the big bit" | `hightide` |
| "the drop out", "where it empties" | `undertow` |
| "the ending" | `slack` |

## Things that are not voices

| He might say | It actually is |
|---|---|
| "it's brighter" | could be `brightness` (mode + camera height) or an `lpf` opening with `tension` — ask which, they are different knobs |
| "it's swaying" | `bus.drift(t)` — the slow wander on the camera and the filters |
| "the ring on the water" | the kick's ripple, `uRing` in the water shader, driven by `patterns.timeSinceKick` |
| "the sparkles" | `motes` — the additive points above the water |
| "the glow at the horizon" | the sun halo in the sky fragment shader, grows with `tension` |

---

## Additions

Append here as they come up. Format: what he said, what it turned out to be, and
**how it was determined** — the method matters more than the answer, because the
next one will be a different word for a different thing.
