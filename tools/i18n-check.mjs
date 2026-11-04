// Checks the translations of the web app: every Croatian text in index.html and
// in tr('...') / trn(n, { ... }) calls in js/*.js must have a translation in
// each js/lang/<code>.js. Prints what is missing and what is no longer used.
//
//   node tools/i18n-check.mjs            all languages
//   node tools/i18n-check.mjs en         one language
//   node tools/i18n-check.mjs --keys     print every text to translate (for a new language)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const norm = s => s.replace(/\s+/g, ' ').trim();

// Texts in index.html that stay as they are in every language (sample names, symbols).
const KEEP = new Set(['Ana & Marko', 'A&M', 'vas@email.com', '••••••••', 'Email', 'SeatMyWedding']);

function unquote(body) {
  return vm.runInNewContext("'" + body + "'");
}

// ── Keys from the JavaScript ──────────────────────────────────────────────────
const keys = new Map(); // key → where
const add = (k, where) => { if (k && !keys.has(k)) keys.set(k, where); };
const STR = "'((?:[^'\\\\]|\\\\.)*)'";
for (const f of fs.readdirSync(path.join(root, 'js'))) {
  if (!f.endsWith('.js') || f === 'i18n.js') continue;
  const src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
  for (const m of src.matchAll(new RegExp('\\btr\\(\\s*' + STR, 'g'))) add(unquote(m[1]), 'js/' + f);
  // Plural forms: trn(n, { one: '…', few: '…', other: '…' }), keyed by `other`.
  for (const m of src.matchAll(new RegExp('\\bother:\\s*' + STR, 'g'))) add(unquote(m[1]), 'js/' + f + ' (plural)');
}

// ── Static texts in index.html ────────────────────────────────────────────────
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<svg[\s\S]*?<\/svg>/g, '');
for (const m of html.matchAll(/\s(title|placeholder|aria-label|alt|data-placeholder)="([^"]*)"/g)) {
  const v = norm(m[2].replace(/&#10;/g, '\n'));
  if (/\p{L}/u.test(v) && !KEEP.has(v)) add(v, 'index.html @' + m[1]);
}
const desc = /<meta name="description" content="([^"]*)"/.exec(html);
if (desc) add(norm(desc[1]), 'index.html meta');
for (const m of html.replace(/<[^>]+>/g, '\u0000').split('\u0000')) {
  const v = norm(m.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' '));
  if (/\p{L}/u.test(v) && !KEEP.has(v)) add(v, 'index.html');
}

if (process.argv.includes('--keys')) {
  for (const k of keys.keys()) console.log(JSON.stringify(k));
  process.exit(0);
}

// ── Compare with each dictionary ──────────────────────────────────────────────
const only = process.argv.slice(2).find(a => !a.startsWith('-'));
const langDir = path.join(root, 'js', 'lang');
let failed = false;
for (const f of fs.readdirSync(langDir)) {
  const code = f.replace(/\.js$/, '');
  if (only && code !== only) continue;
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(langDir, f), 'utf8'), ctx);
  const dict = (ctx.window.I18N_DICTS || {})[code] || {};
  const missing = [...keys].filter(([k]) => !(k in dict));
  const unused = Object.keys(dict).filter(k => !keys.has(k));
  const params = s => new Set(s.match(/\{\w+\}/g) || []);
  const badParams = Object.entries(dict).filter(([k, v]) => {
    if (!keys.has(k)) return false;
    const want = params(k);
    // A translation uses exactly the {params} of the original (a plural form may leave out {n}).
    const ok = (s, plural) => { const got = params(s); return [...got].every(p => want.has(p)) && [...want].every(p => got.has(p) || (plural && p === '{n}')); };
    return typeof v === 'string' ? !ok(v, false) : !Object.values(v).every(s => ok(s, true));
  });
  console.log(`${code}: ${keys.size - missing.length}/${keys.size} translated`);
  for (const [k, where] of missing) console.log(`  missing  ${JSON.stringify(k)}  (${where})`);
  for (const k of unused) console.log(`  unused   ${JSON.stringify(k)}`);
  for (const [k] of badParams) console.log(`  {params} differ  ${JSON.stringify(k)}`);
  if (missing.length || badParams.length) failed = true;
}
process.exit(failed ? 1 : 0);
