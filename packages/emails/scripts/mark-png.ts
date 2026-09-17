/**
 * Rasterises the three-seed Pip mark (DESIGN.md, mid-tone pot colours) to a
 * transparent 96px PNG for email, where SVG doesn't render. No dependencies:
 * 4×4 supersampled circles, written with node:zlib.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 96;
const SS = 4;
const SCALE = SIZE / 56;
const seeds = [
  { cx: 19, cy: 20, r: 13, rgb: [0x7a, 0x8a, 0x5e] },
  { cx: 36.5, cy: 25, r: 10, rgb: [0xc6, 0x71, 0x39] },
  { cx: 27, cy: 41.5, r: 6.5, rgb: [0xc0, 0x39, 0x2c] },
] as const;

const pixels = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  pixels[y * (SIZE * 4 + 1)] = 0;
  for (let x = 0; x < SIZE; x++) {
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = (x + (sx + 0.5) / SS) / SCALE;
        const py = (y + (sy + 0.5) / SS) / SCALE;
        // later seeds paint over earlier ones, as in the SVG
        for (let i = seeds.length - 1; i >= 0; i--) {
          const s = seeds[i]!;
          if ((px - s.cx) ** 2 + (py - s.cy) ** 2 <= s.r ** 2) {
            r += s.rgb[0];
            g += s.rgb[1];
            b += s.rgb[2];
            a += 1;
            break;
          }
        }
      }
    }
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    const n = SS * SS;
    pixels[o] = a ? Math.round(r / a) : 0;
    pixels[o + 1] = a ? Math.round(g / a) : 0;
    pixels[o + 2] = a ? Math.round(b / a) : 0;
    pixels[o + 3] = Math.round((a / n) * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(pixels, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const target = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../apps/web/public/email/pip-mark-96.png",
);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, png);
console.log(`Wrote ${target} (${png.length} bytes)`);
