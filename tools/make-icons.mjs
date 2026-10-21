// Generates the app icon (SVG source + every PNG size) and the iOS splash
// screens. Run from the repo root:  node tools/make-icons.mjs
// Needs Playwright with Chromium (used only to rasterise the SVGs).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = resolve(ROOT, 'icons');
const SPLASH = resolve(ICONS, 'splash');
mkdirSync(SPLASH, { recursive: true });

const DARK = '#17120E';
const CREAM = '#FDFBF7';

// ── Shared defs: metallic gold, diamond facets, background ──────────────────
const defs = `
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FBEFC4"/>
    <stop offset=".22" stop-color="#E2C273"/>
    <stop offset=".45" stop-color="#A9802F"/>
    <stop offset=".62" stop-color="#EBD08A"/>
    <stop offset=".82" stop-color="#B98F3E"/>
    <stop offset="1" stop-color="#7A5A22"/>
  </linearGradient>
  <radialGradient id="bg" cx=".5" cy=".38" r=".8">
    <stop offset="0" stop-color="#3B2F25"/>
    <stop offset=".55" stop-color="#231B15"/>
    <stop offset="1" stop-color="${DARK}"/>
  </radialGradient>
  <radialGradient id="glow" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="#E6C86E" stop-opacity=".22"/>
    <stop offset="1" stop-color="#E6C86E" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="weave"><circle cx="256" cy="218.8" r="30"/></clipPath>`;

// Two interlocking rings (A over B at the top crossing, B over A at the
// bottom) with a brilliant-cut diamond and a few sparkles, on a 512 grid.
function emblem(gap) {
  const ring = (cx) => `
    <circle cx="${cx}" cy="296" r="92" fill="none" stroke="${gap}" stroke-width="34"/>
    <circle cx="${cx}" cy="296" r="92" fill="none" stroke="url(#gold)" stroke-width="22"/>
    <circle cx="${cx}" cy="296" r="83.5" fill="none" stroke="#FFF6D8" stroke-opacity=".45" stroke-width="1.6"/>
    <circle cx="${cx}" cy="296" r="100.5" fill="none" stroke="#5E4419" stroke-opacity=".5" stroke-width="1.2"/>`;
  const star = (x, y, s, o = 1) => `
    <path transform="translate(${x} ${y}) scale(${s})" fill="#FFF4D2" fill-opacity="${o}"
      d="M0-10C.9-2.6 2.6-.9 10 0 2.6.9.9 2.6 0 10-.9 2.6-2.6.9-10 0-2.6-.9-.9-2.6 0-10z"/>`;
  return `
  <circle cx="256" cy="262" r="190" fill="url(#glow)"/>
  ${ring(206)}
  ${ring(306)}
  <g clip-path="url(#weave)">${ring(206)}</g>
  <g stroke="#7A5A22" stroke-width="1.2" stroke-linejoin="round">
    <polygon points="218,138 238,118 274,118 294,138 256,190" fill="#F3E3B6"/>
    <polygon points="238,118 274,118 266,138 246,138" fill="#FFFDF5"/>
    <polygon points="218,138 238,118 246,138" fill="#E9D193"/>
    <polygon points="294,138 274,118 266,138" fill="#FBF0CF"/>
    <polygon points="218,138 246,138 256,190" fill="#D9B866"/>
    <polygon points="246,138 266,138 256,190" fill="#FFF8E4"/>
    <polygon points="266,138 294,138 256,190" fill="#C9A24B"/>
  </g>
  ${star(276, 116, 1.5)}
  ${star(366, 136, 1.1, .9)}
  ${star(140, 176, .75, .75)}
  ${star(392, 196, .5, .6)}`;
}

function iconSvg({ rounded = false } = {}) {
  const body = `<rect width="512" height="512" fill="url(#bg)"/>${emblem('#20180F')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>${defs}
  <clipPath id="corners"><rect width="512" height="512" rx="115"/></clipPath>
</defs>
${rounded ? `<g clip-path="url(#corners)">${body}</g>` : body}
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
await renderSvg(full, 192, 'icon-192-maskable.png');
await renderSvg(full, 512, 'icon-512-maskable.png');
await renderSvg(iconSvg({ rounded: true }), 32, 'favicon-32.png');

// iOS app (Capacitor): the App Store icon must be square, opaque, 1024 px.
const IOS_ASSETS = resolve(ROOT, 'ios/App/App/Assets.xcassets');
if (existsSync(IOS_ASSETS)) {
  await page.setViewportSize({ width: 1024, height: 1024 });
  await page.setContent(`<style>html,body{margin:0;background:${DARK}}svg{display:block;width:1024px;height:1024px}</style>${full}`);
  await page.screenshot({ path: resolve(IOS_ASSETS, 'AppIcon.appiconset/AppIcon-512@2x.png') });
  console.log('wrote the iOS app icon');
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
