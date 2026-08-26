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
  computeRuleStatus();
  updateMonogramIcon();
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
  emit('tables');
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
    await dbPut('guests', g);
  }
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
  for (const g of state.guests.filter(g => g.categoryId === id)) {
    g.categoryId = null;
    await dbPut('guests', g);
  }
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

async function deleteGuest(id) {
  await dbDelete('guests', id);
  // Free the seat
  const guest = state.guests.find(g => g.id === id);
  state.guests = state.guests.filter(g => g.id !== id);
  // Remove from rules
  const rulesAffected = state.rules.filter(r => r.guestIds && r.guestIds.includes(id));
  const rulesToDelete = [];
  for (const r of rulesAffected) {
    r.guestIds = r.guestIds.filter(gid => gid !== id);
    if (r.guestIds.length < (r.type === 'fixed' ? 1 : 2)) {
      rulesToDelete.push(r.id);
    } else {
      await dbPut('rules', r);
    }
  }
  for (const rid of rulesToDelete) {
    await dbDelete('rules', rid);
  }
  state.rules = state.rules.filter(r => !rulesToDelete.includes(r.id));
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
  for (const a of assignments) {
    const guest = state.guests.find(g => g.id === a.guestId);
    if (!guest || guest.locked) continue;
    guest.tableId = a.tableId;
    guest.seatIndex = a.seatIndex;
    guest.status = a.tableId ? 'assigned' : 'unassigned';
    await dbPut('guests', guest);
  }
  computeRuleStatus();
  emit('guests');
}

// Rules
async function saveRule(rule) {
  await dbPut('rules', rule);
  const idx = state.rules.findIndex(r => r.id === rule.id);
  if (idx >= 0) state.rules[idx] = rule; else state.rules.push(rule);
  computeRuleStatus();
  emit('rules');
}

async function deleteRule(id) {
  await dbDelete('rules', id);
  state.rules = state.rules.filter(r => r.id !== id);
  emit('rules');
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
  if (rule.type === 'together') {
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
  emit('settings');
  emit('tables');
  emit('categories');
  emit('guests');
  emit('rules');
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
