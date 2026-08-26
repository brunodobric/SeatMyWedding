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
  if (data.tables?.length) await dbPutAll('tables', data.tables);
  if (data.categories?.length) await dbPutAll('categories', data.categories);
  if (data.guests?.length) await dbPutAll('guests', data.guests);
  if (data.rules?.length) await dbPutAll('rules', data.rules);
  await loadAll();
  emit('settings');
  emit('tables');
  emit('categories');
  emit('guests');
  emit('rules');
}

function updateMonogramIcon() {
  const monogram = state.settings.monogram || '♡';
  const textEl = document.getElementById('icon-monogram-text');
  if (textEl) textEl.textContent = monogram;
}
