// Copies the website's files into www/, which Capacitor packs into the iOS and
// Android apps. Run with `npm run build` (the ios/android scripts run it too).
// The website itself is served from the repo root and does not use www/.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'www');

// sw.js stays out: the app ships its files inside and updates through the store.
// icons/splash holds the home-screen launch images, which the app replaces
// with its own launch screen; icons/source holds the full-size icon artwork
// the other icons are made from.
const FILES = ['index.html', 'manifest.json', 'css', 'fonts', 'js'];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of FILES) cpSync(resolve(ROOT, f), resolve(OUT, f), { recursive: true });
const SKIP = ['splash', 'source'].map(d => resolve(ROOT, 'icons', d));
const keep = src => !SKIP.some(d => src === d || src.startsWith(d + sep));
cpSync(resolve(ROOT, 'icons'), resolve(OUT, 'icons'), { recursive: true, filter: keep });
console.log('www/ ready');
