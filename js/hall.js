/**
 * Hall templates and table capacity helpers.
 * Builds table objects for a whole hall ("Složi salu") and works out how many
 * tables the guest list needs.
 */

const HALL_TEMPLATES = {
  round: { name: 'Okrugli stolovi', hint: 'Klasični okrugli stolovi u redovima', defaultSeats: 8 },
  long: { name: 'Dugi stolovi', hint: 'Dugi stolovi u redovima, gosti s obje strane', defaultSeats: 12 },
  u: { name: 'U-oblik', hint: 'Mladenci na čelu, gosti uz dva duga kraka', defaultSeats: 12 }
};

const HEAD_TABLE_FRONT_SEATS = 6;

function isHeadTable(t) {
  return t.shape === 'head';
}

// Guests the auto-seating will place at the bridal table rather than at the
// regular tables (bridal-party categories, capped by the bridal table's seats).
function headPartyCount(headSeats) {
  const headCats = new Set(state.categories.filter(c => c.atHeadTable).map(c => c.id));
  const party = invitedGuests().filter(g => g.status !== 'maybe' && g.categoryId && headCats.has(g.categoryId)).length;
  return Math.min(party, headSeats);
}

// Bridal-table seats still open to guests (the wedding party already sits there).
function headSeatsTotal() {
  const seats = state.tables.filter(isHeadTable).reduce((n, t) => n + t.seats, 0);
  return Math.max(0, seats - state.guests.filter(isWeddingParty).length);
}

// Seats vs confirmed guests, split into the bridal table and the rest.
function capacityInfo() {
  const guests = invitedGuests().filter(g => g.status !== 'maybe').length;
  const party = state.guests.filter(isWeddingParty).length;
  const seats = state.tables.reduce((n, t) => n + t.seats, 0) - party;
  const headSeats = headSeatsTotal();
  const regularSeats = seats - headSeats;
  const regularGuests = guests - headPartyCount(headSeats);
  return { guests, seats, regularGuests, regularSeats, missing: Math.max(0, regularGuests - regularSeats) };
}

function tablesNeeded(guestCount, perTable) {
  return perTable > 0 ? Math.ceil(Math.max(0, guestCount) / perTable) : 0;
}

function makeHallTable(template, perTable, name, x, y, rotation) {
  const base = { id: crypto.randomUUID(), name, x: Math.round(x), y: Math.round(y), rotation: rotation || 0 };
  if (template === 'round') return { ...base, shape: 'round', seats: perTable };
  const seatsLong = Math.max(1, Math.ceil(perTable / 2));
  return { ...base, shape: 'royal', seats: seatsLong * 2, seatsLong, seatsEnd: 0 };
}

function makeHeadTable(seats = HEAD_TABLE_FRONT_SEATS) {
  return {
    id: crypto.randomUUID(), name: 'Stol mladenaca', shape: 'head',
    seats, seatsLong: seats, seatsEnd: 0,
    x: 500, y: 60, rotation: 0
  };
}

function longTableLength(perTable) {
  return Math.max(200, Math.ceil(perTable / 2) * 28 + 20);
}

// Centre points for `count` tables of a template, laid out from `top` down.
function hallPositions(template, count, perTable, top) {
  const out = [];
  if (template === 'u') {
    // Two arms running down from the bridal table, turned lengthwise.
    const len = longTableLength(perTable);
    const left = Math.ceil(count / 2);
    for (let i = 0; i < count; i++) {
      const arm = i < left ? 0 : 1;
      const k = arm === 0 ? i : i - left;
      out.push({ x: arm === 0 ? 290 : 710, y: top + 40 + len / 2 + k * (len + 24), rotation: 90 });
    }
    return out;
  }
  if (template === 'long') {
    const len = longTableLength(perTable);
    const cols = len > 280 ? 2 : 3;
    const gap = (1000 - cols * len) / (cols + 1);
    for (let i = 0; i < count; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      out.push({ x: rowX(col, count, cols, len + gap), y: top + 55 + row * 150, rotation: 0 });
    }
    return out;
  }
  const cols = 5;
  for (let i = 0; i < count; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    out.push({ x: rowX(col, count, cols, 190), y: top + 70 + row * 175, rotation: 0 });
  }
  return out;
}

// x of a column in a row of tables. A hall that fits in one row is centred
// under the bridal table (x 500); fuller halls use the whole width.
function rowX(col, count, cols, step) {
  const n = Math.min(count, cols);
  return 500 + (col - (n - 1) / 2) * step;
}

function nextTableNumber() {
  let max = 0;
  for (const t of state.tables) {
    const m = /^Stol (\d+)$/.exec(t.name || '');
    if (m) max = Math.max(max, parseInt(m[1]));
  }
  return max + 1;
}

const HALL_TOP = 110;
const TABLE_CLEARANCE = 10;

function isTurned(t) {
  return ((t.rotation || 0) % 180 + 180) % 180 === 90;
}

// Half width/height a table takes up on the plan, its seats included
// (same sizes as the floor plan draws).
function tableExtent(t) {
  let hw, hh;
  if (t.shape === 'round') {
    hw = hh = 70;
  } else {
    const base = { square: [80, 80], royal: [200, 50], head: [260, 55] }[t.shape] || [110, 70];
    let w = base[0], h = base[1];
    if (t.shape !== 'square' && t.seatsLong !== undefined) {
      w = Math.max(w, (t.seatsLong || 0) * 28 + 20);
      if (t.shape !== 'head') h = Math.max(h, (t.seatsEnd || 0) * 28 + 20);
    }
    const endSeats = t.shape === 'square' || t.seatsLong === undefined || t.seatsEnd > 0;
    hw = w / 2 + (endSeats ? 24 : 0);
    hh = h / 2 + (t.shape === 'head' ? 12 : 24); // bridal table: seats on the front only
  }
  return isTurned(t) ? { hw: hh, hh: hw } : { hw, hh };
}

// Template the regular tables were laid out with, so new tables follow it.
function currentHallTemplate() {
  const regular = state.tables.filter(t => !isHeadTable(t));
  if (!regular.length || regular.some(t => t.shape === 'round')) return 'round';
  return regular.every(isTurned) ? 'u' : 'long';
}

// The template's places in fill order. U arms are filled in turn, so added
// tables lengthen both arms evenly.
function hallSlots(template, perTable, n) {
  if (template !== 'u') return hallPositions(template, n, perTable, HALL_TOP);
  const arms = hallPositions('u', n * 2, perTable, HALL_TOP);
  const out = [];
  for (let k = 0; k < n; k++) out.push(arms[k], arms[n + k]);
  return out;
}

/**
 * Returns place(build): build(slot) makes a table at a slot's {x, y, rotation}
 * and place returns the one built at the next free place of the template's
 * layout, after the last place existing tables already take, so tables are
 * added at the end with the same spacing and never on top of another table.
 */
function tablePlacer(template, perTable) {
  const placed = state.tables.map(t => ({ x: t.x, y: t.y, ...tableExtent(t) }));
  const clashes = t => {
    const e = tableExtent(t);
    return placed.some(q => Math.abs(t.x - q.x) < e.hw + q.hw + TABLE_CLEARANCE &&
      Math.abs(t.y - q.y) < e.hh + q.hh + TABLE_CLEARANCE);
  };
  const slots = hallSlots(template, perTable, 600 + placed.length * 2);
  let next = 0;
  slots.forEach((s, i) => {
    if (clashes(makeHallTable(template, perTable, '', s.x, s.y, s.rotation))) next = i + 1;
  });
  return build => {
    for (; next < slots.length; next++) {
      const t = build(slots[next]);
      if (!clashes(t)) {
        next++;
        placed.push({ x: t.x, y: t.y, ...tableExtent(t) });
        return t;
      }
    }
    // Past the template's places (tables dragged far away): go under everything.
    const bottom = placed.reduce((b, q) => Math.max(b, q.y + q.hh), 0);
    const t = build({ x: 500, y: bottom, rotation: 0 });
    t.y = Math.round(bottom + tableExtent(t).hh + 40);
    placed.push({ x: t.x, y: t.y, ...tableExtent(t) });
    return t;
  };
}

// A single new table goes to the next free place of the hall's layout.
function placeNewTable(table) {
  const template = currentHallTemplate();
  const regular = state.tables.filter(t => !isHeadTable(t));
  const perTable = regular.length ? regular[0].seats : HALL_TEMPLATES[template].defaultSeats;
  return tablePlacer(template, perTable)(p => ({ ...table, x: Math.round(p.x), y: Math.round(p.y) }));
}

/**
 * Plan a hall.
 *  mode 'rebuild' – replace all regular tables (the bridal table stays)
 *  mode 'add'     – keep everything, add only the missing tables at the end
 * Returns { create: [tables], remove: [tableIds], count, perTable }.
 */
function planHall({ template, guestCount, perTable, mode }) {
  const heads = state.tables.filter(isHeadTable);
  const create = [];
  const headSeats = heads.length ? headSeatsTotal() : HEAD_TABLE_FRONT_SEATS;
  const regularGuests = Math.max(0, guestCount - headPartyCount(headSeats));
  if (mode === 'rebuild') {
    if (!heads.length) create.push(makeHeadTable());
    const count = tablesNeeded(regularGuests, perTable);
    hallPositions(template, count, perTable, HALL_TOP).forEach((p, i) =>
      create.push(makeHallTable(template, perTable, 'Stol ' + (i + 1), p.x, p.y, p.rotation)));
    return { create, remove: state.tables.filter(t => !isHeadTable(t)).map(t => t.id), count, perTable };
  }
  const regularSeats = state.tables.filter(t => !isHeadTable(t)).reduce((n, t) => n + t.seats, 0);
  const count = tablesNeeded(regularGuests - regularSeats, perTable);
  const first = nextTableNumber();
  const place = tablePlacer(template, perTable);
  for (let i = 0; i < count; i++)
    create.push(place(p => makeHallTable(template, perTable, 'Stol ' + (first + i), p.x, p.y, p.rotation)));
  return { create, remove: [], count, perTable };
}
