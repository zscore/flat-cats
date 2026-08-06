# three.js, as used in this repo — and how to "see" the sequencing

You said doing this in code instead of an animation program is annoying because
there are no thumbnails, no timeline, nothing to scrub. That's a fair complaint,
and it's fixable — this repo fixes it. Read §4 first if that's the part you care
about.

## 1. The four objects

Every three.js program is the same four things:

```js
const renderer = new THREE.WebGLRenderer({ canvas });   // owns the GPU + the canvas
const scene    = new THREE.Scene();                     // a bag of things to draw
const camera   = new THREE.PerspectiveCamera(55, 1, 0.5, 900);   // fov, aspect, near, far
const mesh     = new THREE.Mesh(geometry, material);    // a shape + how to shade it
scene.add(mesh);
renderer.render(scene, camera);                          // draw one frame
```

`src/visuals/scene.js` has exactly three meshes: the **sky** (a big sphere seen
from the inside), the **water** (a flat plane), and the **motes** (a cloud of
points). That's the whole world.

- **Geometry** = the vertices. `new THREE.PlaneGeometry(700, 700, 220, 220)` is a
  700×700 plane cut into a 220×220 grid — 48,000 vertices to push around.
- **Material** = how each pixel gets its colour. Ours is a `ShaderMaterial`,
  meaning we wrote the shading ourselves.

## 2. What a shader actually is

Two small programs that run on the GPU, in this order, for everything drawn:

- The **vertex shader** runs once per vertex and decides *where it goes*.
- The **fragment shader** runs once per pixel and decides *what colour it is*.

They're written in GLSL, which is C-like. You pass values in from JavaScript as
**uniforms** (the same for every vertex/pixel this frame) and pass values from
the vertex to the fragment shader as **varyings** (interpolated across the
triangle in between).

In our water:

```js
const waterUniforms = {
  uTime:      { value: 0 },     // seconds — the waves travel because this moves
  uTension:   { value: 0.1 },   // 0..1 from the score — wave height, chop
  uBrightness:{ value: 0.2 },   // 0..1 from the score — sun height, specular tightness
  uRing:      { value: 1 },     // 0..1 — how far the kick's ring has spread
  uWater:     { value: new THREE.Color() },
  ...
};
```

Every one of those comes from `score/score.js` by way of `src/bus.js`. Nothing in
the shader invents anything.

The vertex shader makes the swell by summing three travelling sine waves:

```glsl
float surface(vec2 p, float time) {
  float amp = mix(0.10, 0.85, uTension);        // ← tension IS the wave height
  float h = 0.0;
  h += wave(p, vec2(1.0, 0.35), 26.0, 0.55, amp * 1.00, time);   // long swell
  h += wave(p, vec2(-0.4, 1.0), 13.0, 0.85, amp * 0.55, time);   // cross-chop
  h += wave(p, vec2(0.8, -0.7),  6.5, 1.40, amp * 0.28 * uTension, time);  // ripple
  ...
}
```

Three waves at different wavelengths, directions and speeds. That's it — that's
the ocean. The `mix(a, b, x)` function is GLSL's lerp and it is everywhere.

The fragment shader's most important line is the **Fresnel** term:

```glsl
float fres = pow(1.0 - max(dot(n, view), 0.0), 3.0);
col = mix(col, uSky, clamp(fres, 0.0, 0.85));
```

Water you look straight down into shows its own colour; water you look *across*
reflects the sky. That one term is most of what makes it read as water rather
than as blue plastic.

## 3. The purity rule

Look at how the frame is drawn:

```js
function renderAt(t) {
  const tension = bus.tensionAt(t);
  const brightness = bus.brightnessAt(t);
  camera.position.set(sway * 2.2, lerp(2.2, 26.0, brightness), 34 + sway * 3);
  ...
  renderer.render(scene, camera);
}
```

`renderAt(t)` takes the time and reads everything else from the score. There is
no state carried between frames anywhere in this file — no `+=`, no "last frame's
value", no history. **Same `t` in, same pixels out.**

That is a real constraint (it's why the kick's ring is computed from
`patterns.timeSinceKick(t)` rather than from a live event), and it buys the
entire §4 workflow. Don't break it; `CLAUDE.md` §9 lists it as load-bearing.

## 4. Seeing the sequencing — the part you asked for

You don't get a timeline for free in code, so this repo builds you three.

**The studio page** — `npm run studio`

One page that is a *drawing of `score/score.js`*: a live preview, a thumbnail
strip of the whole piece, the section blocks at true relative length, the
arrangement grid (which voice plays in which section, in colour), and the
tension/brightness curves underneath. Click anywhere on the timeline to scrub;
click a thumbnail to jump there. Edit a number in the score, save, and it
redraws.

This is the closest thing to the animation-program view: you can see the shape of
the whole piece and point at a moment instead of describing it.

**The storyboard** — `npm run board`

Renders a contact sheet of the entire piece to `board/storyboard.png` in a few
seconds, each frame captioned with its section, bar, tension and brightness. This
is the fastest way to answer "did that change break the look anywhere" — you're
comparing twenty frames, not scrubbing a video.

It's fast because of the purity rule: it asks for twenty exact frames directly
rather than playing three minutes and screenshotting.

**A/B clips** — `node tools/ab.mjs --at=hightide --secs=12 --against=HEAD`

Records the same twelve seconds twice — once from your working tree, once from a
throwaway checkout of `HEAD` — and stacks them side by side with sound. For
anything you have to judge rather than verify, this is the artifact.

## 5. Try these

1. **Make the water glassy.** In `score/score.js`, set `hightide`'s tension to
   `[0.2, 0.25]`, then `npm run board`. The climax goes flat — you'll see the
   whole arc change in one image.
2. **Move the camera.** In `renderAt`, change `lerp(2.2, 26.0, brightness)` to
   `lerp(2.2, 6.0, brightness)`. The piece now stays near the surface throughout.
3. **Change the swell.** In `surface()`, change the first wave's wavelength from
   `26.0` to `70.0` — long ocean rollers instead of chop.
4. **Kill the Fresnel.** Comment out the `col = mix(col, uSky, ...)` line and see
   how much work that one term was doing.
5. **Make the ring bigger.** In `renderAt`, `RING_SECONDS = 1.1` controls how long
   a kick's ring takes to cross the frame. Try `2.5`.

After any of these: `npm run board` and look. That's the loop.

## 6. Debugging a black screen

- Open the browser console first — a GLSL compile error prints there with a line
  number, and three.js will otherwise just draw nothing.
- `npm test` won't catch shader errors (they compile on the GPU, not in node).
  `npm run board` will: the storyboard prints any page errors it saw, and the
  frames come out black.
- If only *some* frames are wrong, that's usually a signal out of range —
  `test/signals.mjs` guards `tension` and `brightness` staying inside 0..1.
