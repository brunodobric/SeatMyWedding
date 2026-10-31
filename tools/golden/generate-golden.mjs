// Pokreće POSTOJEĆI JavaScript (js/state.js, js/sync.js, js/db.js) nad
// zadanim i nasumičnim ulazima i sprema rezultate u golden.json. Swift paket
// SeatingCore mora na istim ulazima dati iste rezultate (vidi GoldenTests.swift).
//
//   node tools/golden/generate-golden.mjs          zapiše datoteku
//   node tools/golden/generate-golden.mjs --check  provjeri da je datoteka svježa
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(root, 'ios-native/SeatingCore/Tests/SeatingCoreTests/Fixtures/golden.json');

// ── JS okruženje ─────────────────────────────────────────────────────────────
let fakeNow = 0;
class FakeDate extends Date { static now() { return fakeNow; } }
const putCalls = [];
const ctx = vm.createContext({ console, Date: FakeDate, JSON, Math, Number, Array, Object, Set, Map, Promise });
for (const f of ['db.js', 'state.js', 'sync.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx, { filename: f });
}
ctx.dbPutAll = async (store, items) => { putCalls.push([store, items.map(i => i.id)]); };
const run = code => vm.runInContext(code, ctx);
const clone = v => JSON.parse(JSON.stringify(v));

// ── Nasumični ulazi (isti svaki put) ─────────────────────────────────────────
function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261031);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = arr => arr[int(0, arr.length - 1)];
const chance = p => rand() < p;

const BAD_IDS = ['a b', '<img>', 'x'.repeat(65), '', 'č', 'a/b'];
const goodId = prefix => prefix + '-' + int(1, 12);
const maybeBadId = (prefix, p) => (chance(p) ? pick(BAD_IDS) : goodId(prefix));
const NUMBER_JUNK = ['12', 'abc', '', '  ', '3.5', '-4', '1e2', true, false, null, {}, 7, 0, 2.5];
const NAMES = ['Ana', 'Ivo', 'Marija Horvat', 5, 3.5, true, null, [1, 2], {}, 'Šime'];
const COLORS = ['#C9A24B', '#fff', '#12345678', 'red', '#zzz', '#12', 7, null, '#ABCDEF'];

function fuzzRecord(kind) {
  const r = { id: maybeBadId(kind, 0.08) };
  if (chance(0.9)) r.name = pick(NAMES);
  if (chance(0.5)) r.updatedAt = chance(0.7) ? int(1, 1000) : pick(NUMBER_JUNK);
  if (kind === 'g') {
    r.tableId = chance(0.6) ? (chance(0.8) ? goodId('t') : pick(BAD_IDS)) : null;
    r.seatIndex = chance(0.7) ? (chance(0.8) ? int(-1, 9) : pick(NUMBER_JUNK)) : null;
    r.categoryId = chance(0.5) ? goodId('c') : (chance(0.2) ? pick(BAD_IDS) : null);
    r.status = pick(['assigned', 'unassigned', 'maybe']);
    r.locked = chance(0.2);
    if (chance(0.3)) r.party = pick(['couple', 'kumovi']);
    if (chance(0.2)) r.futureField = { a: [1, 2, { b: null }] };
  } else if (kind === 't') {
    r.shape = pick(['round', 'head', 'royal', 'square', 'rectangular']);
    r.seats = chance(0.85) ? int(0, 12) : pick(NUMBER_JUNK);
    r.x = chance(0.9) ? int(0, 2000) : pick(NUMBER_JUNK);
    r.y = int(0, 2000);
    r.rotation = pick([0, 90, '45', 'x']);
    if (r.shape === 'head' || chance(0.2)) {
      r.seatsLong = chance(0.8) ? int(0, 12) : pick(NUMBER_JUNK);
      r.seatsEnd = chance(0.7) ? int(0, 2) : pick(NUMBER_JUNK);
    }
  } else if (kind === 'c') {
    r.color = pick(COLORS);
    r.atHeadTable = chance(0.2);
  } else if (kind === 'r') {
    r.type = pick(['together', 'apart', 'fixed', 'category-together']);
    r.guestIds = chance(0.9) ? Array.from({ length: int(0, 4) }, () => (chance(0.9) ? goodId('g') : pick(BAD_IDS))) : pick([null, 'x', 5]);
    r.tableId = chance(0.5) ? goodId('t') : null;
    r.seatIndex = chance(0.5) ? int(0, 8) : null;
  }
  return r;
}
const list = (kind, n) => Array.from({ length: n }, () => fuzzRecord(kind));

// ── Slučajevi ────────────────────────────────────────────────────────────────
const out = { cleanData: [], migrateTables: [], repairSeating: [], mergeSyncStates: [], cloudDoc: [], floorGeometry: [], dropGuest: [], suggestSeating: [], normalizeRules: [], setRelations: [], ruleStatus: [], categoryRules: [], planHall: [], placeTable: [], reseat: [], guestImport: [] };

// cleanData
const cleanInputs = [
  ['prazno', {}],
  ['null', null],
  ['postavke i nepoznata polja', { settings: { weddingTitle: 'Ana i Ivo', monogram: 5, theme: 'x', nested: { a: [1, null] } }, tables: [], categories: [], guests: [], rules: [] }],
  ['nisu liste', { settings: [], tables: 'x', categories: 5, guests: null, rules: {} }],
  ['ime nije tekst', { guests: [{ id: 'g1', name: 5 }, { id: 'g2', name: null }, { id: 'g3', name: true }, { id: 'g4', name: [1, 2] }, { id: 'g5', name: {} }, { id: 'g6', name: 3.5 }] }],
  ['boje', { categories: [{ id: 'c1', color: '#C9A24B' }, { id: 'c2', color: 'red' }, { id: 'c3', color: '#12' }, { id: 'c4', color: '#12345678' }, { id: 'c5', color: '#123456789' }, { id: 'c6', color: 7 }] }],
  ['brojevi kao tekst', { tables: [{ id: 't1', seats: '12', x: ' 7 ', y: '', rotation: 'abc', seatsLong: '1e2', seatsEnd: true, updatedAt: '  ' }] }],
  ['id-jevi', { guests: [{ id: 'ok_1-A', tableId: 'bad id', categoryId: 'c-1' }, { id: 'bad id' }, { id: 'x'.repeat(64) }, { id: 'x'.repeat(65) }, { id: '' }, { id: 'č' }] }],
  ['guestIds', { rules: [{ id: 'r1', guestIds: ['a', 'b c', 'd'] }, { id: 'r2', guestIds: 'x' }, { id: 'r3', guestIds: null }, { id: 'r4' }] }]
];
for (const [name, input] of cleanInputs) {
  out.cleanData.push({ name, input, expected: clone(run(`cleanData(${JSON.stringify(input)})`)) });
}
for (let i = 0; i < 40; i++) {
  const input = {
    settings: chance(0.8) ? { weddingTitle: pick(['A', '', 5, null]), monogram: pick(['A&B', 7]) } : pick([null, {}]),
    tables: list('t', int(0, 6)), categories: list('c', int(0, 4)), guests: list('g', int(0, 12)), rules: list('r', int(0, 4))
  };
  out.cleanData.push({ name: 'nasumično ' + i, input, expected: clone(run(`cleanData(${JSON.stringify(input)})`)) });
}

// migrateTables
async function migrate(tables) {
  ctx.state = { settings: {}, tables: clone(tables), categories: [], guests: [], rules: [] };
  putCalls.length = 0;
  await run('migrateTables()');
  return { tables: clone(ctx.state.tables), changed: putCalls.flatMap(c => c[1]) };
}
const headCases = [
  [{ id: 't1', shape: 'head', seats: 12, seatsLong: 12, seatsEnd: 2 }],
  [{ id: 't1', shape: 'head', seats: 8, seatsLong: 4, seatsEnd: 2 }],
  [{ id: 't1', shape: 'head', seats: 2, seatsLong: 4, seatsEnd: 2 }],
  [{ id: 't1', shape: 'head', seats: 6, seatsLong: 6 }, { id: 't2', shape: 'round', seats: 8, seatsLong: 3 }],
  [{ id: 't1', shape: 'head', seatsLong: 6, seatsEnd: 1 }],
  [{ id: 't1', shape: 'head', seats: 6, seatsLong: 2.5, seatsEnd: 1 }]
];
for (let i = 0; i < headCases.length; i++) {
  out.migrateTables.push({ name: 'primjer ' + i, input: { tables: headCases[i] }, expected: await migrate(headCases[i]) });
}
for (let i = 0; i < 40; i++) {
  const tables = list('t', int(0, 6)).filter(t => /^[A-Za-z0-9_-]{1,64}$/.test(t.id));
  const cleaned = clone(run(`cleanData(${JSON.stringify({ tables })})`).tables);
  out.migrateTables.push({ name: 'nasumično ' + i, input: { tables: cleaned }, expected: await migrate(cleaned) });
}

// repairSeating
async function repair(tables, guests) {
  ctx.state = { settings: {}, tables: clone(tables), categories: [], guests: clone(guests), rules: [] };
  putCalls.length = 0;
  await run('repairSeating()');
  return { guests: clone(ctx.state.guests), freed: putCalls.flatMap(c => c[1]) };
}
for (let i = 0; i < 60; i++) {
  const data = clone(run(`cleanData(${JSON.stringify({
    tables: Array.from({ length: int(0, 4) }, (_, k) => ({ id: 't-' + (k + 1), shape: 'round', seats: int(0, 6) })),
    guests: Array.from({ length: int(0, 14) }, (_, k) => ({
      id: 'g-' + (k + 1), status: pick(['assigned', 'unassigned', 'maybe']),
      tableId: chance(0.75) ? 't-' + int(1, 5) : null,
      seatIndex: chance(0.85) ? int(-1, 6) : null,
      locked: chance(0.25), updatedAt: chance(0.8) ? int(1, 5) : undefined
    }))
  })})`));
  out.repairSeating.push({ name: 'nasumično ' + i, input: { tables: data.tables, guests: data.guests }, expected: await repair(data.tables, data.guests) });
}

// mergeSyncStates
const STORES = ['settings', 'tables', 'categories', 'guests', 'rules'];
const NOW = 1_700_000_000_000;
function fuzzSync(side) {
  const s = { records: {}, deleted: {} };
  for (const store of STORES) {
    const ids = Array.from({ length: int(0, 4) }, () => store[0] + '-' + int(1, 5));
    s.records[store] = [...new Set(ids)].map(id => ({ id, name: side + int(1, 3), updatedAt: int(1, 4) * 1000 }));
    s.deleted[store] = {};
    for (let k = 0; k < int(0, 3); k++) s.deleted[store][store[0] + '-' + int(1, 5)] = chance(0.5) ? int(1, 5) * 1000 : NOW - int(0, 30_000_000_000);
    if (chance(0.3)) s.records[store].forEach(r => { r.updatedAt = NOW - int(0, 30_000_000_000); });
  }
  return s;
}
for (let i = 0; i < 80; i++) {
  const a = fuzzSync('a'), b = fuzzSync('b'), preferB = chance(0.5);
  fakeNow = NOW;
  const expected = clone(run(`mergeSyncStates(${JSON.stringify(a)}, ${JSON.stringify(b)}, ${preferB})`));
  out.mergeSyncStates.push({ name: 'nasumično ' + i, input: { a, b, preferB, now: NOW }, expected });
}

// cloudDoc
const docs = [
  ['prazan dokument', {}],
  ['nema dokumenta', null],
  ['stari dokument bez syncVersion', { updatedAt: 55, settings: { weddingTitle: 'X' }, tables: [{ id: 't1', seats: 4 }], guests: [{ id: 'g1', name: 'A' }] }],
  ['novi dokument', {
    syncVersion: 2, updatedAt: 99, settings: { id: 'main', weddingTitle: 'Ana i Ivo', monogram: 'A&I', futureSetting: [1] },
    tables: [{ id: 't1', seats: 8, updatedAt: 5 }], categories: [{ id: 'c1', color: '#fff' }],
    guests: [{ id: 'g1', name: 'A', tableId: 't1', seatIndex: 0, updatedAt: 7, novoPolje: { x: 1 } }],
    rules: [{ id: 'r1', type: 'together', guestIds: ['g1', 'g2'], satisfied: true }],
    deleted: { guests: { g9: 123 }, tables: {} }
  }]
];
for (const [name, doc] of docs) {
  fakeNow = NOW;
  const fromCloud = clone(run(`fromCloudDoc(${JSON.stringify(doc)})`));
  const toCloud = clone(run(`toCloudDoc(${JSON.stringify(fromCloud)})`));
  out.cloudDoc.push({ name, input: doc, now: NOW, expected: { fromCloud, toCloud } });
}

// floorGeometry: metode FloorPlan (js/floor-plan.js) pozvane bez DOM-a
vm.runInContext('var window = globalThis;', ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'floor-plan.js'), 'utf8'), ctx, { filename: 'floor-plan.js' });
const FP = ctx.FloorPlan.prototype;
const num = v => (Number.isFinite(v) ? v : null);
function geometry(tables) {
  const self = { _dims: FP._dims, tables };
  return {
    dims: tables.map(t => { const d = FP._dims.call(self, t); return { w: num(d.w ?? 90), h: num(d.h ?? 90) }; }),
    seats: tables.map(t => FP._getSeatPositions.call(self, t).map(p => ({ x: num(p.x), y: num(p.y) }))),
    bounds: tables.length ? clone(FP._contentBounds.call(self)) : null
  };
}
const shapes = ['round', 'square', 'rectangular', 'royal', 'head', 'bogus'];
const geoTables = [];
for (const shape of shapes) {
  for (const seats of [0, 1, 2, 6, 8, 12]) geoTables.push({ id: 'a' + geoTables.length, shape, seats, x: 100, y: 200, rotation: 0 });
}
for (const shape of ['rectangular', 'royal', 'head', 'square']) {
  for (const [sl, se] of [[0, 0], [1, 1], [2, 0], [4, 1], [6, 2], [10, 3], [5, null]]) {
    geoTables.push({ id: 'b' + geoTables.length, shape, seats: sl * 2 + se * 2, seatsLong: sl, seatsEnd: se, x: 300, y: 50, rotation: pick([0, 90, 180, 270, 45, -90]) });
  }
}
for (let i = 0; i < 20; i++) {
  const t = clean => clone(run(`cleanData(${JSON.stringify({ tables: [fuzzRecord('t')] })})`).tables)[0];
  const rec = t();
  if (rec) geoTables.push(rec);
}
for (let i = 0; i < geoTables.length; i += 5) {
  const group = geoTables.slice(i, i + 5);
  out.floorGeometry.push({ name: 'skupina ' + i, input: { tables: group }, expected: geometry(group) });
}
out.floorGeometry.push({ name: 'nema stolova', input: { tables: [] }, expected: geometry([]) });

// dropGuest: smještanje gosta (js/guest-drag.js) sa zamjenom mjesta
for (const f of ['hall.js', 'guest-drag.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx, { filename: f });
}
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  let depth = 0, i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('nema funkcije ' + name);
}
vm.runInContext(extractFunction(fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8'), 'firstFreeSeat'), ctx);
let notices = [], undoMessage = null;
ctx.showToast = (message, isError) => { notices.push({ message, isError: !!isError }); };
ctx.withUndo = async (message, action) => { undoMessage = message; return action(); };
ctx.emit = () => {};
for (let i = 0; i < 150; i++) {
  const nt = int(1, 4);
  const tables = Array.from({ length: nt }, (_, k) => ({ id: 't-' + (k + 1), name: 'Stol ' + (k + 1), shape: k === 0 && chance(0.4) ? 'head' : 'round', seats: int(1, 4) }));
  const guests = Array.from({ length: int(1, 9) }, (_, k) => {
    const seated = chance(0.6);
    const g = { id: 'g-' + (k + 1), name: 'Gost ' + (k + 1), status: 'unassigned', tableId: null, seatIndex: null, locked: chance(0.2) };
    if (seated) { g.tableId = 't-' + int(1, nt); g.seatIndex = int(0, 3); g.status = 'assigned'; }
    if (chance(0.15)) g.party = pick(['couple', 'kumovi']);
    return g;
  });
  const gid = chance(0.95) ? pick(guests).id : 'g-404';
  const kind = pick(['seat', 'seat', 'table', 'unseat']);
  const tid = chance(0.95) ? 't-' + int(1, nt) : 't-404';
  const target = kind === 'seat' ? { kind, tableId: tid, seatIndex: int(0, 3) } : kind === 'table' ? { kind, tableId: tid } : { kind };
  ctx.state = { settings: {}, tables: clone(tables), categories: [], guests: clone(guests), rules: [] };
  notices = []; undoMessage = null;
  await run(`dropGuest(${JSON.stringify(gid)}, ${JSON.stringify(target)})`);
  out.dropGuest.push({
    name: 'nasumično ' + i,
    input: { tables, guests, guestId: gid, target },
    expected: { guests: clone(ctx.state.guests), notices, undoMessage }
  });
}


// suggestSeating: automatsko slaganje (js/seating-algo.js)
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'seating-algo.js'), 'utf8'), ctx, { filename: 'seating-algo.js' });
for (let i = 0; i < 120; i++) {
  const nt = int(1, 5), ng = int(1, 16), nc = int(0, 3);
  const tables = Array.from({ length: nt }, (_, k) => ({
    id: 't-' + (k + 1), name: 'Stol ' + (k + 1), shape: k === 0 && chance(0.35) ? 'head' : 'round', seats: int(2, 6)
  }));
  const categories = Array.from({ length: nc }, (_, k) => ({ id: 'c-' + (k + 1), name: 'Kat ' + (k + 1), color: '#C9A24B', atHeadTable: chance(0.15) }));
  const usedSeats = new Set();
  const guests = Array.from({ length: ng }, (_, k) => {
    const g = { id: 'g-' + (k + 1), name: 'Gost ' + (k + 1), status: 'unassigned', tableId: null, seatIndex: null, locked: false, categoryId: nc && chance(0.6) ? 'c-' + int(1, nc) : null };
    if (chance(0.15)) g.status = 'maybe';
    if (chance(0.35)) {
      const t = pick(tables), seat = int(0, t.seats - 1), key = t.id + '/' + seat;
      if (!usedSeats.has(key)) {
        usedSeats.add(key);
        g.tableId = t.id; g.seatIndex = seat; g.status = 'assigned'; g.locked = chance(0.5);
      }
    }
    return g;
  });
  const gp = () => 'g-' + int(1, ng);
  const rules = [];
  for (let k = int(0, 3); k > 0; k--) rules.push({ id: 'r-' + rules.length, type: chance(0.2) ? 'companion' : 'together', guestIds: [...new Set([gp(), gp(), ...(chance(0.3) ? [gp()] : [])])], categoryId: null, tableId: null, seatIndex: null });
  for (let k = int(0, 3); k > 0; k--) rules.push({ id: 'r-' + rules.length, type: 'apart', guestIds: [...new Set([gp(), gp()])], categoryId: null, tableId: null, seatIndex: null });
  for (let k = int(0, 2); k > 0; k--) rules.push({ id: 'r-' + rules.length, type: 'fixed', guestIds: [gp()], categoryId: null, tableId: 't-' + int(1, nt), seatIndex: chance(0.5) ? int(0, 5) : null });
  if (nc && chance(0.4)) rules.push({ id: 'r-' + rules.length, type: 'category-together', guestIds: [], categoryId: 'c-' + int(1, nc), tableId: null, seatIndex: null });
  const result = run(`suggestSeating(${JSON.stringify(tables)}, ${JSON.stringify(guests)}, ${JSON.stringify(rules)}, ${JSON.stringify(categories)})`);
  out.suggestSeating.push({ name: 'nasumično ' + i, input: { tables, categories, guests, rules }, expected: clone(result) });
}


// Pravila (js/state.js): normalizeRules, setGuestRelations, evaluateRule …
ctx.dbDeleteAll = async () => {};
ctx.dbPut = async () => {};
let uuidCounter = 0;
ctx.crypto = { randomUUID: () => 'u-' + (++uuidCounter) };
const stripSatisfied = rules => clone(rules).map(r => { delete r.satisfied; return r; });
function ruleWorld() {
  const nt = int(1, 3), ng = int(2, 8), nc = int(0, 2);
  const tables = Array.from({ length: nt }, (_, k) => ({ id: 't-' + (k + 1), name: 'Stol ' + (k + 1), shape: 'round', seats: int(2, 5) }));
  const categories = Array.from({ length: nc }, (_, k) => ({ id: 'c-' + (k + 1), name: 'Kat ' + (k + 1), color: '#C9A24B' }));
  const guests = Array.from({ length: ng }, (_, k) => {
    const g = { id: 'g-' + (k + 1), name: 'Gost ' + (k + 1), status: 'unassigned', tableId: null, seatIndex: null, locked: false, categoryId: nc && chance(0.6) ? 'c-' + int(1, nc) : null };
    if (chance(0.6)) { g.tableId = 't-' + int(1, nt); g.seatIndex = int(0, 3); g.status = 'assigned'; }
    return g;
  });
  const gp = () => (chance(0.05) ? 'g-99' : 'g-' + int(1, ng));
  const tp = () => (chance(0.05) ? 't-99' : 't-' + int(1, nt));
  const rules = [];
  const add = r => rules.push({ id: 'r-' + rules.length, categoryId: null, tableId: null, seatIndex: null, ...r });
  for (let k = int(0, 3); k > 0; k--) add({ type: chance(0.25) ? 'companion' : 'together', guestIds: Array.from({ length: int(0, 4) }, gp) });
  for (let k = int(0, 3); k > 0; k--) add({ type: 'apart', guestIds: Array.from({ length: int(0, 4) }, gp) });
  for (let k = int(0, 3); k > 0; k--) add({ type: 'fixed', guestIds: [gp()], tableId: tp(), seatIndex: pick([null, 0, 1, 2, 2.5, null]) });
  for (let k = int(0, 2); k > 0; k--) add({ type: 'category-together', guestIds: [], categoryId: chance(0.9) && nc ? 'c-' + int(1, nc) : 'c-99' });
  if (chance(0.2)) rules.forEach(r => { r.satisfied = pick([true, false, null]); });
  return { tables, categories, guests, rules, ng, nc, nt };
}
for (let i = 0; i < 150; i++) {
  const w = ruleWorld();
  ctx.state = { settings: {}, tables: clone(w.tables), categories: clone(w.categories), guests: clone(w.guests), rules: clone(w.rules) };
  uuidCounter = 0;
  const normalized = clone(run(`normalizeRules(state.rules)`));
  out.normalizeRules.push({ name: 'nasumično ' + i, input: { tables: w.tables, categories: w.categories, guests: w.guests, rules: w.rules }, expected: normalized });

  // evaluateRule na (normaliziranim) pravilima
  ctx.state.rules = clone(normalized);
  run('computeRuleStatus()');
  out.ruleStatus.push({ name: 'nasumično ' + i, input: { tables: w.tables, categories: w.categories, guests: w.guests, rules: normalized }, expected: ctx.state.rules.map(r => r.satisfied) });

  // setGuestRelations
  const gid = 'g-' + int(1, w.ng);
  const others = () => Array.from({ length: int(0, 3) }, () => 'g-' + int(1, w.ng));
  const rel = { together: others(), apart: others(), fixedTableId: chance(0.4) ? 't-' + int(1, w.nt) : null, fixedSeat: pick([null, 0, 1, 2.5, undefined]) };
  ctx.state = { settings: {}, tables: clone(w.tables), categories: clone(w.categories), guests: clone(w.guests), rules: clone(w.rules) };
  uuidCounter = 0;
  await run(`setGuestRelations(${JSON.stringify(gid)}, ${JSON.stringify(rel)})`);
  out.setRelations.push({ name: 'nasumično ' + i, input: { tables: w.tables, categories: w.categories, guests: w.guests, rules: w.rules, guestId: gid, rel: { ...rel, fixedSeat: rel.fixedSeat === undefined ? null : rel.fixedSeat } }, expected: stripSatisfied(ctx.state.rules) });

  // kategorija zajedno i uvoz grupa
  const catId = w.nc ? 'c-' + int(1, w.nc) : 'c-1';
  const on = chance(0.5);
  const groups = Array.from({ length: int(0, 3) }, () => Array.from({ length: int(0, 3) }, () => 'g-' + int(1, w.ng)));
  ctx.state = { settings: {}, tables: clone(w.tables), categories: clone(w.categories), guests: clone(w.guests), rules: clone(w.rules) };
  uuidCounter = 0;
  await run(`setCategoryTogether(${JSON.stringify(catId)}, ${on})`);
  const afterCat = stripSatisfied(ctx.state.rules);
  ctx.state.rules = clone(w.rules);
  uuidCounter = 0;
  await run(`addTogetherGroups(${JSON.stringify(groups)})`);
  out.categoryRules.push({ name: 'nasumično ' + i, input: { tables: w.tables, categories: w.categories, guests: w.guests, rules: w.rules, categoryId: catId, on, groups }, expected: { category: afterCat, groups: stripSatisfied(ctx.state.rules) } });
}


// Sala: planHall / placeNewTable (js/hall.js) i reseatOverflowGuests (js/state.js)
function hallWorld() {
  const tables = [];
  if (chance(0.5)) tables.push({ id: 'h-1', name: 'Stol mladenaca', shape: 'head', seats: 6, seatsLong: 6, seatsEnd: 0, x: 500, y: 60, rotation: 0 });
  const regularCount = chance(0.2) ? 0 : int(1, 9);
  const kind = pick(['round', 'royal', 'u', 'mixed']);
  for (let k = 0; k < regularCount; k++) {
    const round = kind === 'round' || (kind === 'mixed' && chance(0.5));
    const sl = int(2, 8);
    const base = { id: 't-' + (k + 1), name: chance(0.85) ? 'Stol ' + (k + 1) : pick(['VIP', 'Stol 12x', 'Djeca']), x: int(100, 900), y: int(150, 1200), rotation: kind === 'u' ? 90 : pick([0, 0, 90, 180]) };
    tables.push(round ? { ...base, shape: 'round', seats: int(4, 12) }
      : { ...base, shape: pick(['royal', 'royal', 'rectangular', 'square']), seats: sl * 2, seatsLong: sl, seatsEnd: pick([0, 0, 1]) });
  }
  const categories = Array.from({ length: int(0, 3) }, (_, k) => ({ id: 'c-' + (k + 1), name: 'K' + (k + 1), color: '#C9A24B', atHeadTable: chance(0.3) }));
  const guests = Array.from({ length: int(0, 40) }, (_, k) => ({
    id: 'g-' + (k + 1), name: 'Gost ' + (k + 1), status: chance(0.1) ? 'maybe' : 'unassigned', tableId: null, seatIndex: null,
    locked: false, categoryId: categories.length && chance(0.5) ? pick(categories).id : null, ...(chance(0.08) ? { party: pick(['couple', 'kumovi']) } : {})
  }));
  return { tables, categories, guests };
}
const setHall = w => { ctx.state = { settings: {}, tables: clone(w.tables), categories: clone(w.categories), guests: clone(w.guests), rules: [] }; };
for (let i = 0; i < 120; i++) {
  const w = hallWorld();
  const form = { template: pick(['round', 'long', 'u']), guestCount: int(0, 220), perTable: int(2, 14), mode: pick(['rebuild', 'add', 'add']) };
  setHall(w); uuidCounter = 0;
  const plan = clone(run(`planHall(${JSON.stringify(form)})`));
  out.planHall.push({ name: 'nasumično ' + i, input: { ...w, form }, expected: plan });

  const nt = { id: 'new-1', name: 'Novi', shape: pick(['round', 'royal', 'rectangular', 'square']), seats: 8, x: 500, y: 350, rotation: pick([0, 90]) };
  if (nt.shape !== 'round') { nt.seatsLong = 4; nt.seatsEnd = pick([0, 1]); }
  setHall(w); uuidCounter = 0;
  const placed = clone(run(`placeNewTable(${JSON.stringify(nt)})`));
  out.placeTable.push({ name: 'nasumično ' + i, input: { ...w, table: nt }, expected: placed });
}
for (let i = 0; i < 80; i++) {
  const table = { id: 't-1', name: 'Stol 1', shape: 'round', seats: int(0, 6) };
  const guests = Array.from({ length: int(0, 8) }, (_, k) => ({
    id: 'g-' + (k + 1), name: 'G' + (k + 1), status: 'assigned', tableId: chance(0.9) ? 't-1' : 't-2',
    seatIndex: chance(0.9) ? int(0, 8) : null, locked: chance(0.25)
  }));
  ctx.state = { settings: {}, tables: [clone(table)], categories: [], guests: clone(guests), rules: [] };
  const moved = clone(run(`reseatOverflowGuests(state.tables[0])`)).map(g => g.id);
  out.reseat.push({ name: 'nasumično ' + i, input: { table, guests }, expected: { guests: clone(ctx.state.guests), moved } });
}


// Uvoz gostiju iz teksta (js/guest-import.js)
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'guest-import.js'), 'utf8'), ctx, { filename: 'guest-import.js' });
const FIRST = ['Ana', 'Marko', 'Ivo', 'Mia', 'Lea', 'Petar', 'Šime', 'Đurđica', 'Josip', 'Maja'];
const LAST = ['Horvat', 'Kovač', 'Marić', 'Babić Perić', 'Novak', 'Čović'];
const CATS = ['Prijatelji', 'Obitelj', 'obitelj', 'Mladenkina strana', ''];
function importLine() {
  const f = () => pick(FIRST), l = () => pick(LAST);
  const cat = () => (chance(0.3) ? pick([';', '\t']) + pick(CATS) : '');
  switch (int(0, 11)) {
    case 0: return f() + ' ' + l() + cat();
    case 1: return f() + cat();
    case 2: return f() + ' i ' + f() + ' ' + l() + cat();
    case 3: return f() + ', ' + f() + ', ' + f() + ' ' + l() + cat();
    case 4: return f() + ' ' + l() + ' +' + int(0, 12) + cat();
    case 5: return l() + ' ' + f() + cat();
    case 6: return l().split(' ')[0] + ', ' + f() + cat();
    case 7: return l().split(' ')[0] + ' ' + f() + ' i ' + f() + cat();
    case 8: return '  ' + f() + '  ' + l() + '  ';
    case 9: return '"' + f() + ' ' + l() + '"' + cat();
    case 10: return f() + ' & ' + f() + ' ' + l();
    default: return '';
  }
}
function importText() {
  const lines = [];
  if (chance(0.35)) lines.push(pick(['Ime i prezime;Kategorija', 'Prezime i ime', 'Ime\tPrezime\tKategorija', 'Prezime\tIme', 'Gosti', 'Ime;Grupa', 'Name']));
  for (let k = int(0, 8); k > 0; k--) {
    const header = lines.length && /^(Ime\tPrezime|Prezime\tIme)/.test(lines[0]);
    lines.push(header ? pick(FIRST) + '\t' + pick(LAST) + (chance(0.5) ? '\t' + pick(CATS) : '') : importLine());
  }
  return lines.join(chance(0.2) ? '\r\n' : '\n');
}
for (let i = 0; i < 150; i++) {
  const text = importText();
  const existing = Array.from({ length: int(0, 3) }, () => pick(FIRST) + ' ' + pick(LAST));
  ctx.state = { settings: {}, tables: [], categories: [], guests: existing.map((name, k) => ({ id: 'g-' + k, name })), rules: [] };
  const surnameFirst = run(`detectSurnameFirst(${JSON.stringify(text)})`);
  const rows = clone(run(`parseGuestText(${JSON.stringify(text)}, { surnameFirst: ${surnameFirst} })`));
  const rowsSF = clone(run(`parseGuestText(${JSON.stringify(text)}, { surnameFirst: true })`));
  const preview = clone(run(`previewGuestImport(parseGuestText(${JSON.stringify(text)}, { surnameFirst: ${surnameFirst} }), {})`));
  const previewAll = clone(run(`previewGuestImport(parseGuestText(${JSON.stringify(text)}, { surnameFirst: ${surnameFirst} }), { includeExisting: true })`));
  out.guestImport.push({ name: 'nasumično ' + i, input: { text, existing }, expected: { surnameFirst, rows, rowsSF, preview, previewAll } });
}

// ── Zapis ────────────────────────────────────────────────────────────────────
const text = JSON.stringify(out, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error('golden.json nije svjež: pokreni `node tools/golden/generate-golden.mjs` i spremi promjenu.');
    process.exit(1);
  }
  console.log('golden.json je svjež.');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  const n = Object.values(out).reduce((s, v) => s + v.length, 0);
  console.log(`Zapisano ${n} slučajeva u ${path.relative(root, OUT)}`);
}
