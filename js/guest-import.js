/**
 * Quick guest entry: turns pasted text into guests and seating groups.
 *
 *   Ana Horvat                 → one guest
 *   Ana i Marko Horvat         → Ana Horvat + Marko Horvat, seated together
 *   Ivo, Mia, Lea Kovač        → a family of three, seated together
 *   Petar Marić +1             → Petar Marić + "Pratnja (Petar Marić)"
 *   Ana Horvat;Prijatelji      → with a category (also tab-separated, e.g. from Excel)
 *   Horvat Ana / Horvat, Ana   → with "Prezime prvo" on (or a "Prezime i ime" header)
 *   Ime<TAB>Prezime header     → separate name and surname columns from Excel
 */

const IMPORT_HEADER_NAMES = ['ime', 'ime i prezime', 'prezime i ime', 'gost', 'gosti', 'name'];
const IMPORT_CATEGORY_HEADERS = ['kategorija', 'grupa', 'skupina', 'category', 'strana'];

// "Horvat Ana" → "Ana Horvat" (the first word is the surname).
function swapSurname(name) {
  const words = name.split(' ');
  return words.length > 1 ? [...words.slice(1), words[0]].join(' ') : name;
}

function splitGroup(text, surnameFirst) {
  // "Horvat, Ana": with the surname first, a single comma separates surname and name.
  if (surnameFirst) {
    const m = text.match(/^\s*([^,&+\s]+)\s*,\s*([^,&+]+?)\s*$/);
    if (m && !/\s+i\s+/i.test(m[2])) text = m[1] + ' ' + m[2];
  }
  const parts = text.split(/\s*[,&+]\s*|\s+i\s+/i).map(p => p.trim()).filter(Boolean);
  let people = [];
  const companions = [];
  for (const p of parts) {
    if (/^\d+$/.test(p)) companions.push(parseInt(p));
    else people.push(p.replace(/\s+/g, ' '));
  }
  if (surnameFirst) {
    // "Horvat Ana i Marko": first names alone share the first person's surname.
    const first = people[0];
    const surname = first && first.includes(' ') ? first.split(' ')[0] : null;
    people = people.map((p, i) => p.includes(' ') ? swapSurname(p) : (i > 0 && surname ? p + ' ' + surname : p));
  } else {
    // "Ana i Marko Horvat": first names alone share the last person's surname.
    const last = people[people.length - 1];
    if (people.length > 1 && last && last.includes(' ')) {
      const surname = last.split(' ').slice(1).join(' ');
      for (let i = 0; i < people.length - 1; i++) {
        if (!people[i].includes(' ')) people[i] += ' ' + surname;
      }
    }
  }
  const host = people[0] || '';
  const extra = companions.reduce((n, c) => n + Math.min(c, 10), 0);
  for (let i = 0; i < extra; i++) people.push(extra === 1 ? `Pratnja (${host})` : `Pratnja ${i + 1} (${host})`);
  return host ? people : [];
}

function splitColumns(line) {
  return /[\t;]/.test(line) ? line.split(/[\t;]/).map(c => c.trim().replace(/^"|"$/g, '')) : [line];
}

// Reads a header row, if there is one: which columns hold the name, surname and category,
// and whether the surname comes first ("Prezime i ime", or a "Prezime" column before "Ime").
function readImportHeader(cols) {
  const lower = cols.map(c => c.toLowerCase());
  const ime = lower.indexOf('ime');
  const prezime = lower.indexOf('prezime');
  const category = lower.findIndex(c => IMPORT_CATEGORY_HEADERS.includes(c));
  if (ime >= 0 && prezime >= 0) return { ime, prezime, category, surnameFirst: false };
  if (IMPORT_HEADER_NAMES.includes(lower[0])) {
    return { name: 0, category: category >= 0 ? category : 1, surnameFirst: lower[0] === 'prezime i ime' };
  }
  return null;
}

// Whether the pasted list says the surname comes first. Never guessed from names alone:
// a comma also separates the members of a family ("Ivo, Mia Kovač").
function detectSurnameFirst(text) {
  const firstLine = String(text || '').split(/\r?\n/).find(l => l.trim());
  const header = firstLine ? readImportHeader(splitColumns(firstLine.trim())) : null;
  return !!(header && header.surnameFirst);
}

// → [{ names: [..], category: 'Prijatelji' | null }]
function parseGuestText(text, opts = {}) {
  const rows = [];
  let header = null;
  let first = true;
  String(text || '').split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const cols = splitColumns(trimmed);
    if (first) {
      first = false;
      header = readImportHeader(cols);
      if (header) return;
    }
    let nameText, category;
    if (header && header.ime !== undefined) {
      // Separate "Ime" and "Prezime" columns: the order is known, so no swapping.
      nameText = [cols[header.ime], cols[header.prezime]].filter(Boolean).join(' ');
      category = header.category >= 0 ? cols[header.category] : null;
      const names = nameText ? [nameText.replace(/\s+/g, ' ')] : [];
      if (names.length) rows.push({ names, category: category || null });
      return;
    }
    nameText = cols[header ? header.name : 0];
    category = cols[header ? header.category : 1];
    const names = splitGroup(nameText || '', !!opts.surnameFirst);
    if (names.length) rows.push({ names, category: category || null });
  });
  return rows;
}

// What an import would add. Names already on the guest list are skipped unless
// includeExisting is set; the same name twice in the pasted list is two people.
function previewGuestImport(rows, opts = {}) {
  const existing = new Set(state.guests.map(g => g.name.toLowerCase()));
  let guests = 0, groups = 0, skipped = 0;
  const duplicates = [];
  const kept = [];
  for (const row of rows) {
    const names = row.names.filter(n => {
      if (!existing.has(n.toLowerCase())) return true;
      if (!duplicates.includes(n)) duplicates.push(n);
      if (opts.includeExisting) return true;
      skipped++;
      return false;
    });
    if (!names.length) continue;
    guests += names.length;
    if (names.length > 1) groups++;
    kept.push({ names, category: row.category });
  }
  return { rows: kept, guests, groups, skipped, duplicates };
}

async function importGuestRows(rows, defaultCategoryId, opts = {}) {
  const preview = previewGuestImport(rows, opts);
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
