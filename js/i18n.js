// Languages of the app. The app is written in Croatian: every text in the code
// is the Croatian original, wrapped in tr('...'). Another language is a
// dictionary from the Croatian original to its translation, in js/lang/<code>.js.
//
// Adding a language:
//   1. copy js/lang/en.js to js/lang/<code>.js and translate the values,
//   2. add it to LANGUAGES below and a <script> line in index.html (before this file),
//   3. add the file to sw.js,
//   4. `node tools/i18n-check.mjs` lists every text that is still missing.
//
//   tr('Dodaj stol')                      → "Add table"
//   tr('Stol {n}', { n: 3 })              → "Table 3"
//   trn(n, { one: '{n} gost', few: '{n} gosta', other: '{n} gostiju' })
//       → plural form for the current language (the dictionary key is `other`;
//         its value is a string or { one, few, many, other } for that language).
(function (global) {
  'use strict';

  const SOURCE = 'hr';
  const LANGUAGES = [
    { code: 'hr', name: 'Hrvatski' },
    { code: 'en', name: 'English' }
  ];
  // Close languages whose speakers read Croatian more easily than English.
  const ALIASES = { bs: 'hr', sr: 'hr', sh: 'hr', cnr: 'hr' };
  const FALLBACK = 'en';
  const STORAGE_KEY = 'smw-lang';

  const dicts = global.I18N_DICTS = global.I18N_DICTS || {};

  function supported(code) {
    if (!code) return null;
    const base = String(code).toLowerCase().split(/[-_]/)[0];
    const c = ALIASES[base] || base;
    return LANGUAGES.some(l => l.code === c) ? c : null;
  }

  function stored() {
    try { return supported(global.localStorage && localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  }

  function detect() {
    const nav = global.navigator;
    const list = nav ? (nav.languages && nav.languages.length ? nav.languages : [nav.language]) : [];
    for (const l of list) { const c = supported(l); if (c) return c; }
    return nav ? FALLBACK : SOURCE;
  }

  let lang = stored() || detect();

  function fill(s, params) {
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m));
  }

  function lookup(src) {
    if (lang === SOURCE) return undefined;
    const d = dicts[lang];
    return d ? d[src] : undefined;
  }

  function tr(src, params) {
    const v = lookup(src);
    return fill(typeof v === 'string' ? v : src, params);
  }

  const rulesCache = {};
  function pluralCategory(n) {
    try {
      const r = rulesCache[lang] || (rulesCache[lang] = new Intl.PluralRules(lang));
      return r.select(n);
    } catch (e) {
      return n === 1 ? 'one' : 'other';
    }
  }

  // forms: the Croatian { one, few, other }; {n} is the number.
  function trn(n, forms, params) {
    const v = lookup(forms.other);
    const set = v && typeof v === 'object' ? v : typeof v === 'string' ? { other: v } : forms;
    const cat = pluralCategory(Math.abs(n));
    const s = set[cat] != null ? set[cat] : set.other;
    return fill(s, Object.assign({ n }, params));
  }

  // Static texts in index.html: text nodes and these attributes are looked up
  // by their Croatian original (whitespace collapsed).
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'data-placeholder', 'content'];
  const norm = s => s.replace(/\s+/g, ' ').trim();

  function translateDom(root) {
    if (lang === SOURCE || typeof document === 'undefined') return;
    const d = dicts[lang] || {};
    root = root || document;
    const start = root === document ? document.documentElement : root;
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentNode && /^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const raw = node.nodeValue;
      const key = norm(raw);
      if (!key) continue;
      const v = d[key];
      if (typeof v !== 'string') continue;
      const lead = raw.match(/^\s*/)[0];
      const trail = raw.match(/\s*$/)[0];
      node.nodeValue = (lead ? ' ' : '') + v + (trail ? ' ' : '');
    }
    const sel = ATTRS.map(a => a === 'content' ? 'meta[name="description"]' : `[${a}]`).join(',');
    start.querySelectorAll(sel).forEach(el => {
      ATTRS.forEach(a => {
        const val = el.getAttribute(a);
        if (!val) return;
        const v = d[norm(val)];
        if (typeof v === 'string') el.setAttribute(a, v);
      });
    });
  }

  function setLang(code) {
    const c = supported(code);
    if (!c) return;
    try { localStorage.setItem(STORAGE_KEY, c); } catch (e) {}
    lang = c;
  }

  // Dates and numbers follow the language.
  function locale() { return lang === 'hr' ? 'hr-HR' : lang === 'en' ? 'en-GB' : lang; }

  global.I18N = {
    get lang() { return lang; },
    LANGUAGES,
    SOURCE,
    supported,
    setLang,
    locale,
    translateDom,
    dicts
  };
  global.tr = tr;
  global.trn = trn;

  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    translateDom(document);
  }
})(typeof window !== 'undefined' ? window : globalThis);
