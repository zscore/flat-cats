/**
 * spectral.mjs — FFT, windows, and spectral envelopes. Nothing musical.
 *
 * Same reasoning as wav.mjs: Node has no audio anything and this repo has no
 * package.json, so the transform is here in full. It is the textbook iterative
 * radix-2, which is all a 2048-point frame needs.
 */

/** In-place complex FFT. Length must be a power of two. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k], ui = im[i + k];
        const xr = re[i + k + half], xi = im[i + k + half];
        const vr = xr * cr - xi * ci, vi = xr * ci + xi * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + half] = ur - vr; im[i + k + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** Periodic Hann. Periodic, not symmetric — symmetric does not overlap-add flat. */
export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * One analysis frame at `start`. Returns { re, im } of length n; bins 0..n/2 are
 * the useful half. Reads past the end of `data` as silence so the last partial
 * frame does not need a special case at every call site.
 */
export function frameFFT(data, start, w) {
  const n = w.length;
  const re = new Float64Array(n), im = new Float64Array(n);
  const lim = Math.min(n, data.length - start);
  for (let i = 0; i < lim; i++) re[i] = data[start + i] * w[i];
  fft(re, im);
  return { re, im };
}

/** Magnitudes of bins 0..n/2 from a frame. */
export function magnitudes(re, im) {
  const half = re.length >> 1;
  const mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}

/**
 * Spectral envelope by cepstral liftering, returned as log-magnitude.
 *
 * This is the whole trick of the file. A magnitude spectrum is two things
 * multiplied: an excitation (where the harmonics are — the PITCH) and an
 * envelope (the broad shape across frequency — the TIMBRE, formants and all).
 * In the log domain they add, so a low-pass along the frequency axis separates
 * them. `order` is how many cepstral coefficients to keep: low keeps only the
 * gross shape, high starts tracking individual harmonics and stops being an
 * envelope at all.
 *
 * Keeping these separable is what lets a cat's timbre be pasted onto a synth's
 * pitch without the pitch being measured, quantised, or otherwise touched.
 */
export function cepstralEnvelope(mag, order) {
  const half = mag.length - 1;
  const n = half * 2;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k <= half; k++) re[k] = Math.log(mag[k] + 1e-9);
  for (let k = 1; k < half; k++) re[n - k] = re[k]; // even mirror -> real cepstrum
  fft(re, im);
  for (let q = order; q <= n - order; q++) { re[q] = 0; im[q] = 0; }
  fft(re, im, true);
  return re.subarray(0, half + 1);
}

/**
 * Move a log-magnitude envelope from one sample rate's bin grid onto another's.
 *
 * Needed because CatMeows is 8 kHz and a song is not. Above the source's
 * Nyquist there is no information about the cat at all, so rather than invent
 * some, this rolls off at `rolloffDbPerOct` from the last real value. Cats do
 * have energy above 4 kHz; we simply do not have a recording of it.
 */
export function regridEnvelope(env, srcSr, dstBins, dstSr, rolloffDbPerOct = -9) {
  const srcNyq = srcSr / 2, dstNyq = dstSr / 2;
  const srcLast = env.length - 1;
  const out = new Float64Array(dstBins);
  const edge = env[srcLast];
  for (let i = 0; i < dstBins; i++) {
    const f = (i / (dstBins - 1)) * dstNyq;
    if (f <= srcNyq) {
      const x = (f / srcNyq) * srcLast;
      const a = Math.min(srcLast, Math.floor(x));
      const b = Math.min(srcLast, a + 1);
      out[i] = env[a] + (env[b] - env[a]) * (x - a);
    } else {
      const octaves = Math.log2(f / srcNyq);
      out[i] = edge + (rolloffDbPerOct * octaves) / 8.6858896; // dB -> natural log
    }
  }
  return out;
}
