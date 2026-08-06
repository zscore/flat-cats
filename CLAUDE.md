# tidewater — how we work on this

Read this before touching anything.

This project exists as a corrective. The last one (`ethereal-jungle`) reached 94
commits, 54 design decisions and 26,000 lines in about five working days — 46
commits on one day — and the person whose project it was ended up feeling like an
executive producer rather than the author. The cause was not carelessness. It was
**amplification**: thirteen lines of listening notes would come back as a
400-line proposal and eight commits, and no human can review at that ratio.

Everything below exists to hold the ratio down. The point is not slower work; it
is work Zane can still see into on day thirty.

---

## 1. Who owns what

| Directory | Owner | Meaning |
|---|---|---|
| `score/` | **Zane** | What happens and when. Sections, lengths, arrangement, levels, colours, the tune. |
| `src/` | Claude | How it gets rendered. Signals, patterns, shaders, the studio page. |
| `tools/`, `test/` | Claude | Harness. |
| `docs/` | shared | See §5 for what may go in it. |

**Do not edit `score/score.js` without asking first.** Not as a formality — that
file is the one Zane reads to know what the piece is. If a change in `src/`
requires a score change, say so and propose the specific numbers; don't make them.

Everything in `score/` is data — no functions, no cleverness. If you find
yourself wanting to put logic there, the logic belongs in `src/bus.js` and the
knob belongs in the score.

## 2. One change at a time

- One commit = one change = one sentence. If the commit subject needs a comma
  splice or a list of IDs, it is more than one change.
- **Never** land several unrelated items in one go because they were all in the
  same note. Six notes means six changes, reviewed six times, in whatever order
  Zane wants them.
- Do not open a second front while one is unreviewed.

## 3. Ask before building, not after

For anything **aesthetic** — how it sounds, how it looks, how long something is,
whether a section earns its place — post the intent first, in five lines or
fewer:

```
What I'd change:  the bell only enters on the second half of hightide
What you'd hear:  the climax arrives without the tune, so the tune arrives as relief
Where:            score/score.js voices, src/music/patterns.js bell()
Risk:             hightide may feel underweight for 8 bars
```

Then stop. Cheap to read, cheap to reject. Reserve long documents for genuinely
structural decisions, and even then cap them (§5).

For anything **mechanical** — a bug, a crash, a test, a rename, a measurement —
just do it and say what you did.

## 4. Every change ships with something to look at or listen to

A diff is not a review artifact for an audiovisual piece. Before saying a change
is done, produce the thing that lets Zane judge it with his eyes and ears:

```sh
npm run board                          # contact sheet of the whole piece → board/storyboard.png
node tools/ab.mjs --at=hightide --secs=12 --against=HEAD    # before | after, side by side
npm run studio                         # the timeline, the arrangement, the curves
```

`--against=HEAD` is the important one. If a change is not better side by side, it
is not better.

## 5. Documentation has a budget

The last project's decision log reached 3,593 lines and stopped being read, which
made it a substitute for understanding rather than a record of it.

- `docs/decisions.md` — **8 lines maximum per entry.** What changed, why, what it
  cost, what would undo it. Numbered `D1, D2, …`, assigned when the change lands.
- `docs/journal.md` — one line per session. What happened, what's next.
- `docs/GLOSSARY.md` — see §7.
- Proposal documents: only when asked for, and **under 80 lines**. A proposal
  longer than the change it describes is a warning sign, not thoroughness.

## 6. Size budget — the tripwire

Soft ceilings. These are not style rules; they are the point at which a file
stops being readable in one sitting:

| File | Ceiling |
|---|---|
| `score/score.js` | 200 lines |
| any file in `src/` | 400 lines |
| any single function | 60 lines |
| whole repo `src/` | 2,000 lines |

**When a change would break a ceiling, stop and say so before writing it.** The
answer might be "fine, go ahead" — but it has to be Zane's answer. The jungle got
to 26,000 lines one reasonable increment at a time, and nobody was ever asked.

Also stop and check in if a single turn is about to produce more than ~150 lines
of new code that hasn't been discussed.

## 7. Zane names things by ear

He will say "the organ" or "the ground floor" or "that shimmery bit". Those are
descriptions of what he heard, not identifiers in the source — in the last
project "the organ" turned out to be a saw pad re-attacking under a long release,
and there was no organ anywhere in the cast.

- For a **section or voice**: ask which one. It's a one-line question.
- For a **sound he can't name**: don't guess and don't grep for his word — a
  matching name in the source is more likely a coincidence than the answer.
  Measure: mute voices one at a time in `score/score.js` `LEVELS` (set to 0),
  re-record, and find which one owns the thing he's describing.
- When you learn one, add it to `docs/GLOSSARY.md` immediately.

## 8. No parallel agents, no worktrees

The previous project ran up to fourteen worktrees and three concurrent sessions
editing the same working tree. It collided on decision numbers, files changed
underneath sessions mid-task, and the piece stopped having a single story anyone
could follow.

**One session, one thread, one change.** Do not spawn subagents to parallelise
work here. The only sanctioned worktree is the throwaway one `tools/ab.mjs`
creates and removes for the "before" side of a comparison.

## 9. Things that must stay true

These are load-bearing — the tooling breaks silently without them:

- **`src/visuals/scene.js` `renderAt(t)` is pure.** Same `t` in, same pixels out.
  No accumulating state, no `+=` across frames. The storyboard and the studio
  scrubber both depend on being able to ask for an arbitrary frame directly.
- **`src/bus.js` and `src/music/patterns.js` import nothing from the browser.**
  No `three`, no `@strudel/*` at module scope (Strudel is passed *into*
  `buildPiece`). That is why `npm test` and `tools/ab.mjs` can run in plain node.
- **The picture reads the score, never the audio.** `music = M(bus, t)` and
  `picture = P(bus, t)`, never `P(audio)`. When the picture needs to know where
  the kicks are, it calls the same function the kick pattern is built from
  (`patterns.kickPositions`).
- `window.tidewater` is the tools' only entry point. Changing its shape breaks
  every tool, and a broken tool is a review that gets skipped.

## 10. Reporting

Say what actually happened. If a test fails, show it. If you skipped part of a
request, name the part. If you're unsure whether a change improved the piece,
say that instead of asserting it did — you cannot hear it, and Zane can.
