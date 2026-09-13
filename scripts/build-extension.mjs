import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const output = resolve('dist/extension');
await mkdir(output, { recursive: true });

await Promise.all([
  build({
    entryPoints: ['extension/background.ts'],
    outfile: resolve(output, 'background.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome116',
    minify: true,
    legalComments: 'none',
  }),
  build({
    entryPoints: ['extension/extract.ts'],
    outfile: resolve(output, 'extract.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome116',
    minify: true,
    legalComments: 'none',
  }),
  build({
    entryPoints: ['extension/overlay.ts'],
    outfile: resolve(output, 'overlay.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome116',
    minify: true,
    legalComments: 'none',
  }),
  copyFile('extension/manifest.json', resolve(output, 'manifest.json')),
  ...[16, 32, 48, 128].map((size) =>
    sharp('public/icon.svg').resize(size, size).png().toFile(resolve(output, `icon${size}.png`)),
  ),
]);

console.log(`Built Chrome extension in ${output}`);
