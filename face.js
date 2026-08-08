/**
 * face.js — the face burst: one big cat face, wearing other cats' eyes and ears.
 *
 * Fourteen seconds driven entirely by `since`, the seconds elapsed since the
 * burst was triggered:
 *
 *   enter    a head, three times the size of any cat the notes put on screen
 *   gaze     its eyes — another cat's eyes — wander, both together
 *   waggle   its ears — a third cat's ears — twitch, one against the other
 *   rotate   the whole face crossfades into the next chimera, five in all
 *   leave
 *
 * The parts come from faces.py, which recorded where every eye and ear sat as a
 * fraction of its own head box. That is the whole trick: a slot measured on one
 * cat is a slot on any cat, so cat_65's eye can be dropped into cat_47's eye
 * socket without either of them being touched by hand.
 *
 * Two things are deliberate and look wrong written down:
 *
 *   - Donor parts are scaled to *cover* their slot, not to fit inside it. The
 *     host's own eye is still there underneath — nothing was erased — and a
 *     donor that merely fits leaves a rim of the host's eye showing round it.
 *   - Both eyes take the same gaze offset. Moving them independently is what
 *     the maths wants and it reads as two stickers sliding about; moving them
 *     together reads as a cat looking at something.
 *
 * Like draw() in viz.js and tailBurst() in tail.js this is a pure function of
 * time — no counters, no rand(), nothing carried between frames. Keep it that
 * way.
 */

const CASTS = 5; // chimeras rotated through
const HOLD = 2.7; // seconds each one is up
const CROSS = 0.6; // seconds of crossfade between them

export const BURST_LENGTH = CASTS * HOLD + 1.1;

const HEAD_H = 0.74; // head height, as a fraction of the frame
const FILL = 1.12; // donor part size, as a multiple of the slot it fills
const GAZE = 0.05; // how far the eyes wander, as a fraction of head width
const WAGGLE = 0.19; // radians, the ear twitch at full size
const WAG_HZ = 0.55; // ear twitches per second
const TAU = Math.PI * 2;

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));

/**
 * The whole score, as numbers, at `s` seconds in. Every stage is a ramp with an
 * explicit window, so the timing is readable in one place — change a number
 * here rather than anywhere below.
 */
function score(s) {
  return {
    alpha: ramp(s, 0, 0.8) * (1 - ramp(s, BURST_LENGTH - 1.1, BURST_LENGTH)),
    // The face arrives still and then comes alive, rather than already
    // twitching at the moment it fades up.
    gaze: ramp(s, 0.9, 2.3),
    waggle: ramp(s, 1.5, 3.1),
  };
}

/**
 * How present each chimera is at `s`. Two are non-zero during a crossfade and
 * one the rest of the time; the last one never fades out on its own, because
 * the burst's own alpha is what ends the piece.
 */
function weights(s) {
  const out = [];
  for (let k = 0; k < CASTS; k++) {
    const t0 = k * HOLD;
    const gone = k === CASTS - 1 ? 0 : ramp(s, t0 + HOLD - CROSS, t0 + HOLD);
    const w = ramp(s, t0 - CROSS, t0) * (1 - gone);
    if (w > 0.003) out.push([k, w]);
  }
  return out;
}

/**
 * The k-th chimera: whose head, whose eyes, whose ears. Deterministic, and the
 * three are always different cats — a chimera wearing its own eyes is just a
 * cat, and one of those in the rotation reads as a mistake.
 */
function cast(faces, k) {
  const n = faces.length;
  const i = [k * 3, k * 3 + 1 + k, k * 3 + 2 + 2 * k].map((v) => v % n);
  while (i[1] === i[0]) i[1] = (i[1] + 1) % n;
  while (i[2] === i[0] || i[2] === i[1]) i[2] = (i[2] + 1) % n;
  return { host: faces[i[0]], eyes: faces[i[1]], ears: faces[i[2]] };
}

/**
 * Draw a donor part into one of the host's slots.
 *
 * Scaled to *fit* the slot and then a little over, never to cover it. Covering
 * hides more of the host's own eye underneath, which is tempting, but the donor
 * rarely has the slot's proportions — a wide ear going into a narrow slot has
 * to grow enormously to cover it, and arrives as a rectangle of fur twice the
 * size of the head. Fitting keeps the donor's own shape at the donor's own
 * scale, and the rim of host eye that shows round it costs less than that.
 */
function into(ctx, img, slot, box) {
  const { ox, oy, hw, hh } = box;
  const k = Math.min((slot.w * hw * FILL) / img.width, (slot.h * hh * FILL) / img.height);
  const dw = img.width * k;
  const dh = img.height * k;
  ctx.drawImage(img, ox + slot.x * hw - dw / 2, oy + slot.y * hh - dh / 2, dw, dh);
}

/** One chimera, at `s` seconds into the burst. */
function chimera(ctx, W, H, c, imgs, s, p) {
  const head = imgs[c.host.head.file];
  if (!head) return;
  const hh = HEAD_H * H;
  const hw = hh * (head.width / head.height);
  const box = { ox: (W - hw) / 2, oy: (H - hh) / 2, hw, hh };
  ctx.drawImage(head, box.ox, box.oy, hw, hh);

  // Ears first: they sit at the top of the head, and an eye never overlaps one,
  // so the order only matters if a slot is wildly wrong — in which case seeing
  // the eye win is more useful than seeing the ear win.
  c.host.ears.forEach((slot, i) => {
    const img = imgs[c.ears.ears[i]?.file];
    if (!img) return;
    // Pivot at the base of the slot, not its middle: an ear hinges where it
    // meets the skull. Turned against each other, so the two never look like
    // one rocking slab.
    const a = WAGGLE * p.waggle * Math.sin(TAU * WAG_HZ * s + i * Math.PI);
    const px = box.ox + slot.x * hw;
    const py = box.oy + (slot.y + slot.h / 2) * hh;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a);
    ctx.translate(-px, -py);
    into(ctx, img, slot, box);
    ctx.restore();
  });

  // A wander rather than a cycle: two sines that do not divide into each other,
  // so the eyes do not visibly return to where they were.
  const gx = GAZE * p.gaze * Math.sin(TAU * 0.23 * s) * Math.cos(TAU * 0.11 * s + 1.3);
  const gy = GAZE * p.gaze * 0.6 * Math.sin(TAU * 0.17 * s + 0.7);
  ctx.save();
  ctx.translate(gx * hw, gy * hh);
  c.host.eyes.forEach((slot, i) => {
    const img = imgs[c.eyes.eyes[i]?.file];
    if (img) into(ctx, img, slot, box);
  });
  ctx.restore();
}

/**
 * Draw the burst. `since` is seconds since it was triggered — negative or past
 * the end and nothing is drawn. Returns whether anything was.
 *
 *   faceBurst(ctx, canvas.width, canvas.height, t - 45, faces, faceImages)
 */
export function faceBurst(ctx, W, H, since, faces, imgs) {
  if (since < 0 || since > BURST_LENGTH || faces.length < 3) return false;
  const p = score(since);
  if (p.alpha <= 0.001) return false;

  ctx.save();
  for (const [k, w] of weights(since)) {
    ctx.globalAlpha = p.alpha * w;
    chimera(ctx, W, H, cast(faces, k), imgs, since, p);
  }
  ctx.restore();
  return true;
}
