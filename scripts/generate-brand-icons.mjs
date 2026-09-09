/**
 * Renders every brand icon from the one gradient logo.
 *
 * The mark exists in two forms — a gradient one and a flat `#2563FF` one that
 * predates it — and the flat one had survived in exactly the places nobody looks
 * at twice: `favicon.ico`, `logo-32.png`, and the two small SVGs. A tab strip
 * showing the old mark beside a page showing the new one is the whole reason
 * this is a script and not a one-off export.
 *
 * Rasterising is done by Chrome, already installed for the end-to-end tests, so
 * this needs no image toolchain. `favicon.ico` is assembled here because the
 * format is a 6-byte header plus one 16-byte directory entry per image, and
 * every library that does it would be a dependency added for 30 lines.
 *
 * Usage: node scripts/generate-brand-icons.mjs [--check]
 *   --check reports what would change and exits non-zero, for CI.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_SVG = 'apps/dashboard/static/logo.svg';

/** Every directory that ships the product mark. */
const ICON_DIRS = [
  'apps/dashboard/static',
  'apps/website/static',
  'apps/course-app/static',
  'apps/admin/static',
  'apps/help/public',
  'packages/course-app/src/template/static'
];

/** PNG renders, by file name and pixel size. Only the ones that carry the mark itself. */
const PNG_SIZES = { 'logo-16.png': 16, 'logo-32.png': 32, 'logo-192.png': 192, 'logo-512.png': 512 };

/** The sizes a favicon.ico carries, in the order Windows expects them. */
const ICO_SIZES = [16, 32, 48];

/** SVG copies of the source, for the sizes referenced as SVG. */
const SVG_COPIES = ['logo.svg', 'logo-16.svg', 'logo-32.svg', 'logo-192.svg', 'logo-512.svg'];

/**
 * An ICO container around already-encoded PNGs.
 *
 * PNG-compressed entries are what every browser since IE11 reads, so no BMP
 * encoding is needed. A 256-pixel image would be written as 0 in the byte-wide
 * dimension fields; nothing here is that large, but the sizes are asserted so a
 * later edit cannot silently produce an icon that reads as 256.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];

  for (const { size, png } of images) {
    if (size < 1 || size > 255) throw new Error(`ICO entry size ${size} is outside the byte-wide field`);

    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt8(0, 2); // palette colours: 0 for a truecolour image
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

async function main() {
  const check = process.argv.includes('--check');
  const svg = await readFile(join(repoRoot, SOURCE_SVG), 'utf8');
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

  const browser = await chromium.launch({ channel: 'chrome' });
  const renders = new Map();

  try {
    const page = await browser.newPage();

    for (const size of new Set([...Object.values(PNG_SIZES), ...ICO_SIZES])) {
      await page.setViewportSize({ width: size, height: size });
      // Transparent background: the mark sits on the tab strip and on light and
      // dark app chrome alike, so a baked-in white square would show as a card.
      await page.setContent(
        `<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${svgDataUrl}">`
      );
      await page.locator('img').waitFor();
      renders.set(size, await page.screenshot({ omitBackground: true }));
    }
  } finally {
    await browser.close();
  }

  const ico = buildIco(ICO_SIZES.map((size) => ({ size, png: renders.get(size) })));
  const changed = [];

  for (const dir of ICON_DIRS) {
    const outputs = [
      ...Object.entries(PNG_SIZES).map(([name, size]) => [name, renders.get(size)]),
      ['favicon.ico', ico],
      ...SVG_COPIES.map((name) => [name, Buffer.from(svg)])
    ];

    for (const [name, content] of outputs) {
      const path = join(repoRoot, dir, name);
      const existing = await readFile(path).catch(() => null);

      // Only files this deployment already ships are rewritten. Creating the
      // full set everywhere would put a `logo-16.svg` in apps that never ask
      // for one, and a favicon in the retired docs stub.
      if (!existing) continue;
      if (existing.equals(content)) continue;

      changed.push(`${dir}/${name}`);
      if (!check) await writeFile(path, content);
    }
  }

  const digest = createHash('sha256').update(svg).digest('hex').slice(0, 12);
  console.log(`source ${SOURCE_SVG} (${digest})`);

  if (changed.length === 0) {
    console.log('every icon already matches the source');
    return;
  }

  console.log(`${check ? 'would rewrite' : 'rewrote'} ${changed.length} file(s):`);
  for (const path of changed) console.log(`  ${path}`);

  if (check) process.exitCode = 1;
}

await main();
