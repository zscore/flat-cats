# tidewater

An audiovisual piece: three minutes of water and light, with the music and the
picture both written as functions of one authored score.

```sh
npm install
npm run dev        # the piece — open the printed URL, click once to start audio
npm run studio     # the timeline, thumbnails, arrangement grid, curves
npm test           # 15 checks over the score and the signals
npm run board      # contact sheet of the whole piece → board/storyboard.png
```

Chrome or Arc recommended. Space bar stops and starts.

## The shape of it

```
                  score/score.js
        the form, the arrangement, the levels,
          the colours, the tune — as DATA
                        │
                        ▼
                    src/bus.js
        turns the score into signals of time:
      tension(t) · brightness(t) · colours(t) · drift(t)
                   │            │
        ┌──────────┘            └──────────┐
        ▼                                  ▼
  src/music/patterns.js              src/visuals/scene.js
  one Strudel pattern per bar        renderAt(t) — pure, any frame
  (six synthesised voices)           (water, sky, motes, the kick's ring)
```

The picture never listens to the audio. Both read the same signals, so they agree
by construction rather than by coordination.

## Where things are

| Path | What |
|---|---|
| `score/score.js` | **The piece.** Sections, arrangement, levels, colours, motif. ~180 lines, all data. |
| `src/bus.js` | Score → signals of time. |
| `src/music/patterns.js` | The six voices, and the bar-by-bar compiler. |
| `src/music/engine.js` | Strudel + superdough boot, and the event mirror. |
| `src/visuals/scene.js` | The whole picture, including both shaders. |
| `src/studio/studio.js` | The studio page — a drawing of `score.js`. |
| `tools/storyboard.mjs` | Contact sheet of the whole piece. |
| `tools/ab.mjs` | Records clips; `--against=<ref>` stacks before/after. |

Nothing in `src/` is over 400 lines. That's a rule, not an accident — see
`CLAUDE.md` §6.

## How to change something

**The form, the arrangement, the mix, the colours, the tune** — `score/score.js`.
Change a number, save, and both media follow. You do not need to read any other
file to do this, and the studio page will redraw to show you what you did.

**How a voice is synthesised, how the water moves** — `src/`. Start with
`docs/LEARNING-STRUDEL.md` and `docs/LEARNING-THREE.md`, which walk through this
repo's actual code rather than a generic tutorial.

## Reviewing a change

```sh
npm run board                                             # did the look change anywhere?
node tools/ab.mjs --at=hightide --secs=12 --against=HEAD   # before | after, with sound
npm run studio                                            # where am I, and who's playing?
```

## Working with Claude on this

Read `CLAUDE.md`. Short version: `score/` is yours and Claude asks before touching
it; one change at a time; anything aesthetic gets proposed in five lines before
it gets built; every change ships with something to look at or listen to; no
parallel agents. The full reasoning, and what went wrong last time, is in that
file.

## Docs

| File | What |
|---|---|
| `CLAUDE.md` | How we work. The protocol. |
| `docs/LEARNING-STRUDEL.md` | Strudel, via this repo's patterns. With exercises. |
| `docs/LEARNING-THREE.md` | three.js and the shaders, plus how to see the sequencing. |
| `docs/GLOSSARY.md` | Zane's words → source names. |
| `docs/decisions.md` | Why things are the way they are. 8 lines per entry, max. |
| `docs/journal.md` | One line per session. |
