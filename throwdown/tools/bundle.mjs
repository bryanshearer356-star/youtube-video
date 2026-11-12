#!/usr/bin/env node
// Builds the app into dist/:
//   index.html     standalone installable web app (any static host)
//   artifact.html  the same page as a bare fragment, for hosts that add their own <head>
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
mkdirSync(join(dist, 'data'), { recursive: true });

const out = await build({
  entryPoints: [join(root, 'app/js/main.js')], bundle: true, format: 'iife', minify: true,
  target: 'es2020', write: false, legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync(join(root, 'app/index.html'), 'utf8').replace('__BUNDLE__', () => js);
writeFileSync(join(dist, 'artifact.html'), page);

const cut = page.indexOf('<header class="top">');
const version = Date.now().toString(36);
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#ffc21a">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${page.slice(0, cut)}</head>
<body>
${page.slice(cut)}<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});</script>
</body>
</html>
`;
writeFileSync(join(dist, 'index.html'), standalone);
copyFileSync(join(root, 'app/data/cards.json'), join(dist, 'data/cards.json'));
writeFileSync(join(dist, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#ffc21a"/><g fill="#fff" stroke="#151b2e" stroke-width="20" stroke-linejoin="round"><rect x="120" y="150" width="190" height="260" rx="22" transform="rotate(-12 215 280)"/><rect x="210" y="120" width="190" height="260" rx="22" transform="rotate(10 305 250)"/></g></svg>`);
writeFileSync(join(dist, 'manifest.webmanifest'), JSON.stringify({
  name: 'Throwdown Deck Lab', short_name: 'Deck Lab', start_url: '.', display: 'standalone',
  background_color: '#f1f4fa', theme_color: '#ffc21a',
  icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
}, null, 2));
// Offline support: serve from cache, refresh in the background.
writeFileSync(join(dist, 'sw.js'), `const C = 'deck-lab-${version}';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(C).then((c) => c.addAll(['./', 'data/cards.json', 'icon.svg', 'manifest.webmanifest']))); });
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
`);
console.log(`dist/ built: page ${(page.length / 1024).toFixed(0)} KB, script ${(js.length / 1024).toFixed(0)} KB`);
