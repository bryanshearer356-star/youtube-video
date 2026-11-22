// Bundles the game into one self-contained page fragment (styles and scripts
// inlined) for hosts that take a single file. Run from the repo root:
//
//   node cheer-idle/tools/build-single.mjs
//
// Output: cheer-idle/dist/hit-zero.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const page = read('index.html');
const title = page.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = page.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/)[0];
const body = page.split('<!-- app:start -->')[1].split('<!-- app:end -->')[0].trim();
const scripts = [...page.matchAll(/<script src="([^"]+)"><\/script>/g)].map((match) => read(match[1]));

const out = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  fonts,
  '<style>\n' + read('styles.css') + '</style>',
  body,
  ...scripts.map((source) => '<script>\n' + source + '</script>'),
  '',
].join('\n');

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'hit-zero.html'), out);
console.log('Wrote cheer-idle/dist/hit-zero.html (' + Math.round(out.length / 1024) + ' KB)');
