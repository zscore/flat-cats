/**
 * wav.mjs — read and write 16-bit PCM WAV. Nothing else.
 *
 * Both the sample picker and the renderer need this, and neither should own it.
 * Node has no audio anything, so the format is here in full: 44 bytes of header
 * and then interleaved little-endian shorts.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Read a 16-bit PCM WAV into { sr, channels, data } where data is Float32 in -1..1. */
export function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`not a RIFF/WAVE file: ${path}`);
  }
  let sr = 0, channels = 0, bits = 0, dataStart = 0, dataLen = 0;
  // Chunks are not in a guaranteed order and 'fmt ' is not guaranteed to be
  // first, so walk them rather than assuming the canonical 44-byte layout.
  for (let p = 12; p + 8 <= buf.length; ) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(p + 10);
      sr = buf.readUInt32LE(p + 12);
      bits = buf.readUInt16LE(p + 22);
    } else if (id === 'data') {
      dataStart = p + 8;
      dataLen = size;
    }
    p += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (bits !== 16) throw new Error(`${path}: expected 16-bit, got ${bits}`);
  const n = Math.floor(dataLen / 2);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
  return { sr, channels, data };
}

/** Write interleaved Float32 channels (-1..1) as a 16-bit PCM WAV. */
export function writeWav(path, channelData, sr) {
  const channels = channelData.length;
  const frames = channelData[0].length;
  const buf = Buffer.alloc(44 + frames * channels * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + frames * channels * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);            // PCM fmt chunk size
  buf.writeUInt16LE(1, 20);             // format = PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * channels * 2, 28); // byte rate
  buf.writeUInt16LE(channels * 2, 32);  // block align
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(frames * channels * 2, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, channelData[c][i]));
      buf.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  writeFileSync(path, buf);
  return { frames, seconds: frames / sr, bytes: buf.length };
}
