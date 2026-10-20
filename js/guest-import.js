/**
 * Quick guest entry: turns pasted text into guests and seating groups.
 *
 *   Ana Horvat                 → one guest
 *   Ana i Marko Horvat         → Ana Horvat + Marko Horvat, seated together
 *   Ivo, Mia, Lea Kovač        → a family of three, seated together
 *   Petar Marić +1             → Petar Marić + "Pratnja (Petar Marić)"
 *   Ana Horvat;Prijatelji      → with a category (also tab-separated, e.g. from Excel)
 */

const IMPORT_HEADER_NAMES = ['ime', 'ime i prezime', 'gost', 'gosti', 'name'];

function splitGroup(text) {
  const parts = text.split(/\s*[,&+]\s*|\s+i\s+/i).map(p => p.trim()).filter(Boolean);
  const people = [];
  const companions = [];
  for (const p of parts) {
    if (/^\d+$/.test(p)) companions.push(parseInt(p));
    else people.push(p.replace(/\s+/g, ' '));
  }
  // "Ana i Marko Horvat": first names alone share the last person's surname.
  const last = people[people.length - 1];
  if (people.length > 1 && last && last.includes(' ')) {
    const surname = last.split(' ').slice(1).join(' ');
    for (let i = 0; i < people.length - 1; i++) {
      if (!people[i].includes(' ')) people[i] += ' ' + surname;
    }
  }
  const host = people[0] || '';
  const extra = companions.reduce((n, c) => n + Math.min(c, 10), 0);
  for (let i = 0; i < extra; i++) people.push(extra === 1 ? `Pratnja (${host})` : `Pratnja ${i + 1} (${host})`);
  return host ? people : [];
}

// → [{ names: [..], category: 'Prijatelji' | null }]
function parseGuestText(text) {
  const rows = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const cols = /[\t;]/.test(trimmed) ? trimmed.split(/[\t;]/).map(c => c.trim().replace(/^"|"$/g, '')) : [trimmed];
    if (i === 0 && IMPORT_HEADER_NAMES.includes(cols[0].toLowerCase())) return;
    const names = splitGroup(cols[0]);
    if (names.length) rows.push({ names, category: cols[1] || null });
  });
  return rows;
}

// What an import would add, skipping names that already exist.
function previewGuestImport(rows) {
  const existing = new Set(state.guests.map(g => g.name.toLowerCase()));
  const seen = new Set();
  let guests = 0, groups = 0, skipped = 0;
  const kept = [];
  for (const row of rows) {
    const names = row.names.filter(n => {
      const key = n.toLowerCase();
      if (existing.has(key) || seen.has(key)) { skipped++; return false; }
      seen.add(key);
      return true;
    });
    if (!names.length) continue;
    guests += names.length;
    if (names.length > 1) groups++;
    kept.push({ names, category: row.category });
  }
  return { rows: kept, guests, groups, skipped };
}

async function importGuestRows(rows, defaultCategoryId) {
  const preview = previewGuestImport(rows);
  const catByName = new Map(state.categories.map(c => [c.name.toLowerCase(), c.id]));
  const toAdd = [];
  const groups = [];
  for (const row of preview.rows) {
    let categoryId = defaultCategoryId || null;
    if (row.category) {
      const key = row.category.toLowerCase();
      if (!catByName.has(key)) {
        const color = CATEGORY_COLORS[state.categories.length % CATEGORY_COLORS.length];
        const cat = { id: crypto.randomUUID(), name: row.category, color, atHeadTable: false };
        await saveCategory(cat);
        catByName.set(key, cat.id);
      }
      categoryId = catByName.get(key);
    }
    const ids = row.names.map(name => {
      const g = { id: crypto.randomUUID(), name, categoryId, status: 'unassigned', tableId: null, seatIndex: null, locked: false, notes: '' };
      toAdd.push(g);
      return g.id;
    });
    if (ids.length > 1) groups.push(ids);
  }
  await addGuests(toAdd);
  if (groups.length) await addTogetherGroups(groups);
  return preview;
}
