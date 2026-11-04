// Generates the app icon (SVG source + every PNG size) and the iOS splash
// screens. Run from the repo root:  node tools/make-icons.mjs
// Needs Playwright with Chromium (used only to rasterise the SVGs).
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = resolve(ROOT, 'icons');
const SPLASH = resolve(ICONS, 'splash');
mkdirSync(SPLASH, { recursive: true });

const DARK = '#17120E';
const CREAM = '#FDFBF7';

// ── App icon: white round table with chairs on smooth gold ──────────────────
// The artwork lives as PNG sources in icons/source/ (1024 px, full bleed):
//   app-icon.png           – the icon itself
//   app-icon-maskable.png  – same, artwork shrunk into the maskable safe zone
// Every size below is rasterised from those two files.
const SRC = resolve(ICONS, 'source');
const png64 = (name) => readFileSync(resolve(SRC, name)).toString('base64');
const ICON_PNG = png64('app-icon.png');
const MASKABLE_PNG = png64('app-icon-maskable.png');

function iconSvg({ rounded = false, maskable = false } = {}) {
  const img = `<image href="data:image/png;base64,${maskable ? MASKABLE_PNG : ICON_PNG}" width="512" height="512"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs><clipPath id="corners"><rect width="512" height="512" rx="115"/></clipPath></defs>
${rounded ? `<g clip-path="url(#corners)">${img}</g>` : img}
</svg>
`;
}

// iPhone portrait splash screens (CSS width × height @ device pixel ratio).
const DEVICES = [
  [440, 956, 3], [402, 874, 3], [420, 912, 3], [430, 932, 3], [393, 852, 3],
  [428, 926, 3], [390, 844, 3], [414, 896, 3], [375, 812, 3], [414, 896, 2],
  [375, 667, 2],
];

// Only the background: the app continues from it with the animated emblem
// (#splash in index.html), so the hand-over from iOS is seamless.
function splashHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:${CREAM};}
  body{background:radial-gradient(circle at 50% 40%, #FFFFFF 0, ${CREAM} 45%, #F5EBDD 100%);}
</style></head><body></body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();

async function renderSvg(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: resolve(ICONS, file), omitBackground: true });
  console.log('wrote icons/' + file);
}

writeFileSync(resolve(ICONS, 'icon.svg'), iconSvg({ rounded: true }));
console.log('wrote icons/icon.svg');

const full = iconSvg();
await renderSvg(full, 180, 'apple-touch-icon.png');
await renderSvg(full, 192, 'icon-192.png');
await renderSvg(full, 512, 'icon-512.png');
const maskable = iconSvg({ maskable: true });
await renderSvg(maskable, 192, 'icon-192-maskable.png');
await renderSvg(maskable, 512, 'icon-512-maskable.png');
await renderSvg(iconSvg({ rounded: true }), 32, 'favicon-32.png');

// iOS app (Capacitor): the App Store icon must be square, opaque, 1024 px.
const IOS_ASSETS = resolve(ROOT, 'ios/App/App/Assets.xcassets');
if (existsSync(IOS_ASSETS)) {
  await page.setViewportSize({ width: 1024, height: 1024 });
  await page.setContent(`<style>html,body{margin:0;background:${DARK}}svg{display:block;width:1024px;height:1024px}</style>${full}`);
  await page.screenshot({ path: resolve(IOS_ASSETS, 'AppIcon.appiconset/AppIcon-512@2x.png') });
  console.log('wrote the iOS app icon');
  // The native SwiftUI app uses the same icon.
  const NATIVE = resolve(ROOT, 'ios-native/App/Assets.xcassets/AppIcon.appiconset');
  if (existsSync(NATIVE)) {
    copyFileSync(resolve(IOS_ASSETS, 'AppIcon.appiconset/AppIcon-512@2x.png'), resolve(NATIVE, 'AppIcon-512@2x.png'));
    console.log('wrote the native iOS app icon');
  }
  // Launch screen: the same cream background the web splash starts from.
  await page.setViewportSize({ width: 2732, height: 2732 });
  await page.setContent(splashHtml());
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    await page.screenshot({ path: resolve(IOS_ASSETS, 'Splash.imageset', name) });
  }
  console.log('wrote the iOS launch screen');
}

const links = [];
for (const [w, h, dpr] of DEVICES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const p = await ctx.newPage();
  const tmp = resolve(SPLASH, '_tmp.html');
  writeFileSync(tmp, splashHtml());
  await p.goto(pathToFileURL(tmp).href);
  await p.evaluate(() => document.fonts.ready);
  const name = `splash-${w * dpr}x${h * dpr}.png`;
  await p.screenshot({ path: resolve(SPLASH, name) });
  await ctx.close();
  links.push(`  <link rel="apple-touch-startup-image" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" href="icons/splash/${name}">`);
  console.log('wrote icons/splash/' + name);
}
const { unlinkSync } = await import('node:fs');
unlinkSync(resolve(SPLASH, '_tmp.html'));
await browser.close();

console.log('\n<!-- paste into index.html <head> -->\n' + links.join('\n'));
