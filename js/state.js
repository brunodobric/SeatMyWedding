var state = {
  settings: { id: 'main', weddingTitle: '', monogram: '' },
  tables: [],
  categories: [],
  guests: [],
  rules: []
};

function emit(type) {
  window.dispatchEvent(new CustomEvent('stateChange', { detail: { type } }));
}

async function loadAll() {
  const [settings, tables, categories, guests, rules] = await Promise.all([
    dbGet('settings', 'main'),
    dbGetAll('tables'),
    dbGetAll('categories'),
    dbGetAll('guests'),
    dbGetAll('rules')
  ]);
  state.settings = settings || { id: 'main', weddingTitle: '', monogram: '' };
  state.tables = tables || [];
  state.categories = categories || [];
  state.guests = guests || [];
  state.rules = rules || [];
  await migrateTables();
  await migrateRules();
  computeRuleStatus();
  updateMonogramIcon();
}

// Older bridal tables were saved with twice as many seats as were drawn (the
// extra seats had no place on the floor plan). Draw all of them instead.
async function migrateTables() {
  const fixed = state.tables.filter(t =>
    t.shape === 'head' && Number.isInteger(t.seatsLong) && t.seatsLong + 2 * (t.seatsEnd || 0) !== t.seats);
  for (const t of fixed) t.seatsLong = Math.max(0, t.seats - 2 * (t.seatsEnd || 0));
  if (fixed.length) await dbPutAll('tables', fixed);
}

// Replace regular tables / add missing ones in one go (see planHall in hall.js).
async function applyHallPlan(plan) {
  const removed = new Set(plan.remove);
  if (removed.size) {
    await dbDeleteAll('tables', plan.remove);
    state.tables = state.tables.filter(t => !removed.has(t.id));
    const affected = state.guests.filter(g => removed.has(g.tableId));
    for (const g of affected) { g.tableId = null; g.seatIndex = null; g.status = 'unassigned'; }
    if (affected.length) await dbPutAll('guests', affected);
  }
  if (plan.create.length) {
    await dbPutAll('tables', plan.create);
    state.tables.push(...plan.create);
  }
  await replaceRules(normalizeRules(state.rules)); // drops "always at table" rules for removed tables
  computeRuleStatus();
  emit('tables');
}

// ── Rule model ────────────────────────────────────────────────────────────────
// Rules are edited from the guest card and the category editor, so they are
// kept in a normalized shape:
//   together          – one rule per group (couple, family…), 2+ guests
//   apart             – one rule per pair of guests
//   fixed             – at most one per guest
//   category-together – at most one per category
// Older data (multi-guest "apart", overlapping "together", legacy "companion")
// is converted on load; the meaning of every rule stays the same.

function normalizeRules(rules) {
  const guestIds = new Set(state.guests.map(g => g.id));
  const tableIds = new Set(state.tables.map(t => t.id));
  const catIds = new Set(state.categories.map(c => c.id));
  const out = [];
  const base = { categoryId: null, tableId: null, seatIndex: null };

  // together: merge overlapping groups (togetherness is transitive)
  const parent = new Map();
  const find = id => { while (parent.get(id) !== id) id = parent.get(id); return id; };
  const groupRuleId = new Map();
  for (const r of rules) {
    if (r.type !== 'together' && r.type !== 'companion') continue;
    const ids = (r.guestIds || []).filter(id => guestIds.has(id));
    ids.forEach(id => { if (!parent.has(id)) parent.set(id, id); });
    for (let i = 1; i < ids.length; i++) parent.set(find(ids[i]), find(ids[0]));
    if (ids.length) groupRuleId.set(ids[0], groupRuleId.get(ids[0]) || r.id);
  }
  const groups = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const id = members.map(m => groupRuleId.get(m)).find(Boolean) || crypto.randomUUID();
    out.push({ ...base, id, type: 'together', guestIds: members });
  }

  // apart: one rule per pair
  const pairs = new Set();
  for (const r of rules) {
    if (r.type !== 'apart') continue;
    const ids = [...new Set((r.guestIds || []).filter(id => guestIds.has(id)))];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join('|');
        if (pairs.has(key)) continue;
        pairs.add(key);
        out.push({ ...base, id: ids.length === 2 ? r.id : crypto.randomUUID(), type: 'apart', guestIds: [ids[i], ids[j]] });
      }
    }
  }

  // fixed: last one per guest wins
  const fixed = new Map();
  for (const r of rules) {
    if (r.type !== 'fixed') continue;
    const gid = (r.guestIds || [])[0];
    if (!guestIds.has(gid) || !tableIds.has(r.tableId)) continue;
    fixed.set(gid, { ...base, id: r.id, type: 'fixed', guestIds: [gid], tableId: r.tableId, seatIndex: Number.isInteger(r.seatIndex) ? r.seatIndex : null });
  }
  out.push(...fixed.values());

  // category-together: one per category
  const cats = new Set();
  for (const r of rules) {
    if (r.type !== 'category-together' || !catIds.has(r.categoryId) || cats.has(r.categoryId)) continue;
    cats.add(r.categoryId);
    out.push({ ...base, id: r.id, type: 'category-together', guestIds: [], categoryId: r.categoryId });
  }
  return out;
}

function ruleKey(r) {
  return JSON.stringify([r.type, r.guestIds, r.categoryId, r.tableId, r.seatIndex]);
}

// Persist a new rule list, writing only what changed.
async function replaceRules(next) {
  const prev = new Map(state.rules.map(r => [r.id, r]));
  const nextIds = new Set(next.map(r => r.id));
  const removed = state.rules.filter(r => !nextIds.has(r.id)).map(r => r.id);
  const changed = next.filter(r => !prev.has(r.id) || ruleKey(prev.get(r.id)) !== ruleKey(r));
  const clean = changed.map(r => { const c = { ...r }; delete c.satisfied; return c; });
  if (removed.length) await dbDeleteAll('rules', removed);
  if (clean.length) await dbPutAll('rules', clean);
  state.rules = next;
  return removed.length + changed.length > 0;
}

async function migrateRules() {
  await replaceRules(normalizeRules(state.rules));
}

function getGuestRelations(guestId) {
  const together = new Set();
  const apart = new Set();
  let fixed = null;
  for (const r of state.rules) {
    if (!r.guestIds || !r.guestIds.includes(guestId)) continue;
    if (r.type === 'together' || r.type === 'companion') r.guestIds.forEach(id => id !== guestId && together.add(id));
    else if (r.type === 'apart') r.guestIds.forEach(id => id !== guestId && apart.add(id));
    else if (r.type === 'fixed') fixed = r;
  }
  return { together: [...together], apart: [...apart], fixed };
}

// Rewrite every rule that concerns this guest from the guest card.
// rel = { together: [ids], apart: [ids], fixedTableId, fixedSeat }
async function setGuestRelations(guestId, rel) {
  const together = new Set((rel.together || []).filter(id => id !== guestId));
  const apart = new Set((rel.apart || []).filter(id => id !== guestId && !together.has(id)));
  let rules = state.rules.map(r => ({ ...r, guestIds: [...(r.guestIds || [])] }));

  // together: the guest leaves its old group; whoever is still wanted joins the
  // new group, and groups of newly picked guests are merged in.
  const merged = new Set([guestId, ...together]);
  rules = rules.filter(r => {
    if (r.type !== 'together') return true;
    if (r.guestIds.includes(guestId)) {
      r.guestIds = r.guestIds.filter(id => id !== guestId && !together.has(id));
      return r.guestIds.length >= 2;
    }
    if (r.guestIds.some(id => together.has(id))) {
      r.guestIds.forEach(id => merged.add(id));
      return false;
    }
    return true;
  });
  if (merged.size >= 2) {
    const old = state.rules.find(r => r.type === 'together' && r.guestIds.includes(guestId));
    const reuse = old && !rules.some(r => r.id === old.id) ? old.id : crypto.randomUUID();
    rules.push({ id: reuse, type: 'together', guestIds: [...merged], categoryId: null, tableId: null, seatIndex: null });
  }

  // apart: one pair rule per person, existing pairs keep their ids
  const oldApart = new Map();
  rules = rules.filter(r => {
    if (r.type !== 'apart' || !r.guestIds.includes(guestId)) return true;
    oldApart.set(r.guestIds.find(id => id !== guestId), r.id);
    return false;
  });
  for (const other of apart) {
    rules.push({ id: oldApart.get(other) || crypto.randomUUID(), type: 'apart', guestIds: [guestId, other], categoryId: null, tableId: null, seatIndex: null });
  }

  // fixed table
  const oldFixed = rules.find(r => r.type === 'fixed' && r.guestIds[0] === guestId);
  rules = rules.filter(r => !(r.type === 'fixed' && r.guestIds[0] === guestId));
  if (rel.fixedTableId) {
    rules.push({
      id: oldFixed ? oldFixed.id : crypto.randomUUID(), type: 'fixed', guestIds: [guestId],
      categoryId: null, tableId: rel.fixedTableId,
      seatIndex: Number.isInteger(rel.fixedSeat) ? rel.fixedSeat : null
    });
  }

  if (await replaceRules(normalizeRules(rules))) {
    computeRuleStatus();
    emit('rules');
  }
}

// Add couples / families from a bulk import as "together" groups.
async function addTogetherGroups(groups) {
  const rules = [...state.rules];
  for (const ids of groups) {
    if (ids.length >= 2) rules.push({ id: crypto.randomUUID(), type: 'together', guestIds: ids, categoryId: null, tableId: null, seatIndex: null });
  }
  if (await replaceRules(normalizeRules(rules))) {
    computeRuleStatus();
    emit('rules');
  }
}

function isCategoryTogether(categoryId) {
  return state.rules.some(r => r.type === 'category-together' && r.categoryId === categoryId);
}

async function setCategoryTogether(categoryId, on) {
  if (on === isCategoryTogether(categoryId)) return;
  const rules = on
    ? [...state.rules, { id: crypto.randomUUID(), type: 'category-together', guestIds: [], categoryId, tableId: null, seatIndex: null }]
    : state.rules.filter(r => !(r.type === 'category-together' && r.categoryId === categoryId));
  await replaceRules(rules);
  computeRuleStatus();
  emit('rules');
}

// Rules that involve a guest directly (pairs, groups, fixed seat) or via the
// guest's category.
function rulesForGuest(guest) {
  return state.rules.filter(r =>
    (r.guestIds && r.guestIds.includes(guest.id)) ||
    (r.type === 'category-together' && guest.categoryId && r.categoryId === guest.categoryId));
}

async function saveSettings(data) {
  Object.assign(state.settings, data);
  await dbPut('settings', state.settings);
  updateMonogramIcon();
  emit('settings');
}

// Tables
async function saveTable(table) {
  await dbPut('tables', table);
  const idx = state.tables.findIndex(t => t.id === table.id);
  if (idx >= 0) state.tables[idx] = table; else state.tables.push(table);
  // If the seat count shrank, guests on removed seats move to free seats of the
  // same table (or become unassigned when the table is full).
  const moved = reseatOverflowGuests(table);
  if (moved.length) {
    await dbPutAll('guests', moved);
    computeRuleStatus();
  }
  emit('tables');
}

function reseatOverflowGuests(table) {
  const seated = state.guests.filter(g => g.tableId === table.id);
  const fits = g => Number.isInteger(g.seatIndex) && g.seatIndex >= 0 && g.seatIndex < table.seats;
  const overflow = seated.filter(g => !fits(g));
  if (overflow.length === 0) return [];
  const taken = new Set(seated.filter(fits).map(g => g.seatIndex));
  const free = [];
  for (let i = 0; i < table.seats; i++) if (!taken.has(i)) free.push(i);
  overflow.sort((a, b) => (b.locked ? 1 : 0) - (a.locked ? 1 : 0) || (a.seatIndex || 0) - (b.seatIndex || 0));
  for (const g of overflow) {
    if (free.length) {
      g.seatIndex = free.shift();
    } else {
      g.tableId = null;
      g.seatIndex = null;
      g.status = 'unassigned';
    }
  }
  return overflow;
}

async function deleteTable(id) {
  await dbDelete('tables', id);
  state.tables = state.tables.filter(t => t.id !== id);
  // Unassign guests at this table
  const affected = state.guests.filter(g => g.tableId === id);
  for (const g of affected) {
    g.tableId = null;
    g.seatIndex = null;
    g.status = 'unassigned';
  }
  if (affected.length) await dbPutAll('guests', affected);
  // Remove rules referencing this table
  const rulesAffected = state.rules.filter(r => r.tableId === id);
  for (const r of rulesAffected) {
    await dbDelete('rules', r.id);
  }
  state.rules = state.rules.filter(r => r.tableId !== id);
  computeRuleStatus();
  emit('tables');
  emit('guests');
  emit('rules');
}

// Categories
async function saveCategory(cat) {
  await dbPut('categories', cat);
  const idx = state.categories.findIndex(c => c.id === cat.id);
  if (idx >= 0) state.categories[idx] = cat; else state.categories.push(cat);
  emit('categories');
}

async function deleteCategory(id) {
  await dbDelete('categories', id);
  state.categories = state.categories.filter(c => c.id !== id);
  // Remove category from guests
  const affectedGuests = state.guests.filter(g => g.categoryId === id);
  for (const g of affectedGuests) g.categoryId = null;
  if (affectedGuests.length) await dbPutAll('guests', affectedGuests);
  // Remove category-together rules
  const affected = state.rules.filter(r => r.categoryId === id);
  for (const r of affected) await dbDelete('rules', r.id);
  state.rules = state.rules.filter(r => r.categoryId !== id);
  computeRuleStatus();
  emit('categories');
  emit('guests');
  emit('rules');
}

// Guests
async function saveGuest(guest) {
  await dbPut('guests', guest);
  const idx = state.guests.findIndex(g => g.id === guest.id);
  if (idx >= 0) state.guests[idx] = guest; else state.guests.push(guest);
  computeRuleStatus();
  emit('guests');
}

// Add many guests at once (bulk import) — one DB transaction, one re-render.
async function addGuests(guests) {
  if (!guests.length) return;
  await dbPutAll('guests', guests);
  state.guests.push(...guests);
  computeRuleStatus();
  emit('guests');
}

async function deleteGuest(id) {
  await dbDelete('guests', id);
  state.guests = state.guests.filter(g => g.id !== id);
  // Remove from rules
  await replaceRules(normalizeRules(state.rules));
  computeRuleStatus();
  emit('guests');
  emit('rules');
}

async function assignGuest(guestId, tableId, seatIndex) {
  const guest = state.guests.find(g => g.id === guestId);
  if (!guest) return;
  // Free previous seat if moving
  guest.tableId = tableId;
  guest.seatIndex = seatIndex;
  guest.status = tableId ? 'assigned' : 'unassigned';
  await dbPut('guests', guest);
  computeRuleStatus();
  emit('guests');
}

async function unassignGuest(guestId) {
  const guest = state.guests.find(g => g.id === guestId);
  if (!guest) return;
  guest.tableId = null;
  guest.seatIndex = null;
  guest.status = 'unassigned';
  await dbPut('guests', guest);
  computeRuleStatus();
  emit('guests');
}

async function applySeatingResult(assignments) {
  // assignments: [{guestId, tableId, seatIndex}]
  const byId = new Map(state.guests.map(g => [g.id, g]));
  const changed = [];
  for (const a of assignments) {
    const guest = byId.get(a.guestId);
    if (!guest || guest.locked) continue;
    guest.tableId = a.tableId;
    guest.seatIndex = a.seatIndex;
    guest.status = a.tableId ? 'assigned' : 'unassigned';
    changed.push(guest);
  }
  if (changed.length) await dbPutAll('guests', changed);
  computeRuleStatus();
  emit('guests');
}

// Restore guests from a snapshot (undo of auto-seating) in one transaction.
async function restoreGuests(snapshot) {
  const byId = new Map(state.guests.map(g => [g.id, g]));
  const changed = [];
  for (const s of snapshot) {
    const curr = byId.get(s.id);
    if (curr) { Object.assign(curr, s); changed.push(curr); }
  }
  if (changed.length) await dbPutAll('guests', changed);
  computeRuleStatus();
  emit('guests');
}

function computeRuleStatus() {
  for (const rule of state.rules) {
    rule.satisfied = evaluateRule(rule);
  }
}

function evaluateRule(rule) {
  if (rule.type === 'apart') {
    const assigned = rule.guestIds.map(id => state.guests.find(g => g.id === id)).filter(g => g && g.tableId);
    if (assigned.length < 2) return null;
    const tableIds = assigned.map(g => g.tableId);
    const unique = new Set(tableIds);
    return unique.size === tableIds.length; // all on different tables
  }
  if (rule.type === 'together' || rule.type === 'companion') {
    const assigned = rule.guestIds.map(id => state.guests.find(g => g.id === id)).filter(g => g && g.tableId);
    if (assigned.length < 2) return null;
    const tableIds = new Set(assigned.map(g => g.tableId));
    return tableIds.size === 1;
  }
  if (rule.type === 'fixed') {
    const gid = rule.guestIds[0];
    const guest = state.guests.find(g => g.id === gid);
    if (!guest || !guest.tableId) return null;
    return guest.tableId === rule.tableId && (rule.seatIndex === null || guest.seatIndex === rule.seatIndex);
  }
  if (rule.type === 'category-together') {
    const cats = state.guests.filter(g => g.categoryId === rule.categoryId && g.tableId);
    if (cats.length === 0) return null;
    const tableIds = new Set(cats.map(g => g.tableId));
    return tableIds.size === 1;
  }
  return null;
}

function getStats() {
  const total = state.guests.filter(g => g.status !== 'maybe').length;
  const assigned = state.guests.filter(g => g.status === 'assigned').length;
  const violated = state.rules.filter(r => r.satisfied === false).length;
  return { total, assigned, violated };
}

async function importData(data) {
  await dbClear('settings');
  await dbClear('tables');
  await dbClear('categories');
  await dbClear('guests');
  await dbClear('rules');
  if (data.settings) await dbPut('settings', data.settings);
  if (data.tables && data.tables.length) await dbPutAll('tables', data.tables);
  if (data.categories && data.categories.length) await dbPutAll('categories', data.categories);
  if (data.guests && data.guests.length) await dbPutAll('guests', data.guests);
  if (data.rules && data.rules.length) await dbPutAll('rules', data.rules);
  await loadAll();
  emit('import');
}

function updateMonogramIcon() {
  // The favicon is an external SVG file, so it cannot be reached via the DOM.
  // We build the same round-decorated-table artwork inline and set it as the
  // favicon href through a data URI (kept in sync with icons/icon.svg).
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 192 192" width="192" height="192">'
    + '<defs>'
    + '<linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#E6C86E"/><stop offset="50%" stop-color="#C9A24B"/><stop offset="100%" stop-color="#A17C33"/></linearGradient>'
    + '<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FDFBF7"/><stop offset="100%" stop-color="#F5EBDD"/></linearGradient>'
    + '<clipPath id="clip"><rect width="192" height="192" rx="32"/></clipPath>'
    + '<g id="fl"><g fill="#FFFFFF" stroke="#E8DFC9" stroke-width="0.7">'
    + '<ellipse cx="0" cy="-8" rx="4.4" ry="7"/>'
    + '<ellipse cx="0" cy="-8" rx="4.4" ry="7" transform="rotate(72)"/>'
    + '<ellipse cx="0" cy="-8" rx="4.4" ry="7" transform="rotate(144)"/>'
    + '<ellipse cx="0" cy="-8" rx="4.4" ry="7" transform="rotate(216)"/>'
    + '<ellipse cx="0" cy="-8" rx="4.4" ry="7" transform="rotate(288)"/>'
    + '</g><circle r="2.8" fill="url(#gold)"/></g>'
    + '<g id="ch"><rect x="-9" y="-13.5" width="18" height="6" rx="3" fill="url(#gold)"/><rect x="-8" y="-9" width="16" height="13" rx="3.5" fill="url(#gold)"/></g>'
    + '<g id="pl"><circle r="7" fill="#FFFFFF" stroke="url(#gold)" stroke-width="1.4"/><circle r="3" fill="none" stroke="#E8DFC9" stroke-width="0.8"/></g>'
    + '</defs>'
    + '<g clip-path="url(#clip)">'
    + '<rect width="192" height="192" fill="url(#bg)"/>'
    + '<use xlink:href="#ch" transform="translate(158 96) rotate(90)"/>'
    + '<use xlink:href="#ch" transform="translate(139.8 139.8) rotate(135)"/>'
    + '<use xlink:href="#ch" transform="translate(96 158) rotate(180)"/>'
    + '<use xlink:href="#ch" transform="translate(52.2 139.8) rotate(225)"/>'
    + '<use xlink:href="#ch" transform="translate(34 96) rotate(270)"/>'
    + '<use xlink:href="#ch" transform="translate(52.2 52.2) rotate(315)"/>'
    + '<use xlink:href="#ch" transform="translate(96 34) rotate(0)"/>'
    + '<use xlink:href="#ch" transform="translate(139.8 52.2) rotate(45)"/>'
    + '<circle cx="96" cy="96" r="44" fill="#FFFFFF" stroke="url(#gold)" stroke-width="3"/>'
    + '<circle cx="96" cy="96" r="39" fill="none" stroke="#E8DFC9" stroke-width="1"/>'
    + '<use xlink:href="#pl" transform="translate(126 96)"/>'
    + '<use xlink:href="#pl" transform="translate(117.2 117.2)"/>'
    + '<use xlink:href="#pl" transform="translate(96 126)"/>'
    + '<use xlink:href="#pl" transform="translate(74.8 117.2)"/>'
    + '<use xlink:href="#pl" transform="translate(66 96)"/>'
    + '<use xlink:href="#pl" transform="translate(74.8 74.8)"/>'
    + '<use xlink:href="#pl" transform="translate(96 66)"/>'
    + '<use xlink:href="#pl" transform="translate(117.2 74.8)"/>'
    + '<use xlink:href="#fl" transform="translate(96 96) scale(1.2)"/>'
    + '</g></svg>';
  const href = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  const link = document.querySelector('link[rel="icon"]');
  if (link) link.href = href;
}
