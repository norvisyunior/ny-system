// Genera los iconos de la app a partir de public/brand/nyora-symbol.svg:
// - build/icon.png  (256×256, icono de ventana)
// - build/icon.ico  (instalador Windows / electron-builder)
// El .ico usa entradas BMP sin comprimir en tamaños 16–256 (formato que
// aceptan NSIS y rcedit sin dependencias externas).
// Uso: npm run electron:icons
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SIZES = [16, 24, 32, 48, 64, 128, 256];

const svgPath = path.resolve("public/brand/nyora-symbol.svg");
const outDir = path.resolve("build");
const svg = readFileSync(svgPath);

mkdirSync(outDir, { recursive: true });

writeFileSync(
  path.join(outDir, "icon.png"),
  await sharp(svg, { density: 600 }).resize(256, 256).png().toBuffer(),
);

/** BMPBMI de una entrada: BITMAPINFOHEADER (40B) + pixeles BGRA bottom-up + máscara AND. */
function bmpEntry({ width, height, rgba }) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8); // alto doble (color + máscara)
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bpp
  header.writeUInt32LE(0, 20); // sin compresión

  const rowBytes = width * 4;
  const pixels = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4; // bottom-up
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const d = y * rowBytes + x * 4;
      pixels[d] = rgba[s + 2]; // B
      pixels[d + 1] = rgba[s + 1]; // G
      pixels[d + 2] = rgba[s]; // R
      pixels[d + 3] = rgba[s + 3]; // A
    }
  }

  const maskRowBytes = Math.ceil(width / 32) * 4;
  const mask = Buffer.alloc(maskRowBytes * height); // máscara opaca (todo 0)

  return Buffer.concat([header, pixels, mask]);
}

const entries = [];
for (const size of SIZES) {
  const { data, info } = await sharp(svg, { density: 600 })
    .resize(size, size)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  entries.push({ size, data: bmpEntry({ width: info.width, height: info.height, rgba: data }) });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type icon
header.writeUInt16LE(entries.length, 4);

const dirSize = 16;
const imgOffset0 = 6 + dirSize * entries.length;
const directory = [];
let offset = imgOffset0;
for (const e of entries) {
  const d = Buffer.alloc(16);
  d[0] = e.size === 256 ? 0 : e.size; // width
  d[1] = e.size === 256 ? 0 : e.size; // height
  d[2] = 0; // palette
  d[3] = 0; // reserved
  d.writeUInt16LE(1, 4); // planes
  d.writeUInt16LE(32, 6); // bpp
  d.writeUInt32LE(e.data.length, 8);
  d.writeUInt32LE(offset, 12);
  directory.push(d);
  offset += e.data.length;
}

const ico = Buffer.concat([header, ...directory, ...entries.map((e) => e.data)]);
writeFileSync(path.join(outDir, "icon.ico"), ico);

console.log(
  `[icons] listos: ${path.join(outDir, "icon.ico")} (BMP 16–256) + icon.png (desde ${svgPath})`,
);
