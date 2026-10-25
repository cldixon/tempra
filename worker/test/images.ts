import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

/** Small real images made with Pillow (test/media/), with their sizes. */
export const SAMPLES: { file: string; media: string; width: number; height: number }[] = [
  { file: "photo.png", media: "image/png", width: 40, height: 24 },
  { file: "photo.jpg", media: "image/jpeg", width: 40, height: 24 },
  { file: "progressive.jpg", media: "image/jpeg", width: 40, height: 24 },
  { file: "exif.jpg", media: "image/jpeg", width: 37, height: 21 },
  { file: "anim.gif", media: "image/gif", width: 30, height: 18 },
  { file: "lossy.webp", media: "image/webp", width: 40, height: 24 },
  { file: "lossless.webp", media: "image/webp", width: 40, height: 24 },
  { file: "alpha.webp", media: "image/webp", width: 41, height: 23 },
  { file: "photo.avif", media: "image/avif", width: 40, height: 24 },
];

export const sample = (file: string) =>
  new Uint8Array(readFileSync(join(import.meta.dir, "media", file)));

export const SVG = new TextEncoder().encode(
  '<?xml version="1.0"?>\n<!-- a mark -->\n<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 12 6"><rect width="12" height="6"/></svg>',
);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/**
 * An RGB PNG, `width` by `height`; with `noise` its pixels are pseudo-random, so it does not
 * compress (a 320×320 one is about 300 KB).
 */
export function makePng(width: number, height: number, opts: { noise?: boolean } = {}) {
  const header = new Uint8Array(13);
  const h = new DataView(header.buffer);
  h.setUint32(0, width);
  h.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (width * 3 + 1));
  let seed = 7;
  for (let i = 0; i < raw.length; i++) {
    if (i % (width * 3 + 1) === 0) continue;
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    raw[i] = opts.noise ? seed >>> 24 : 0x80;
  }
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * TEMPRA-105's file in miniature: a valid signature and IHDR, an IDAT that declares more bytes
 * than follow, and bytes after it that are no chunk.
 */
export function truncatedIdatPng() {
  const good = makePng(32, 16, { noise: true });
  const cut = good.subarray(0, 33 + 8 + 40);
  return concat([cut, new TextEncoder().encode("garbage after the cut")]);
}

export const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
