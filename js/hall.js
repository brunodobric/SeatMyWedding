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
  const party = state.guests.filter(g => g.status !== 'maybe' && g.categoryId && headCats.has(g.categoryId)).length;
  return Math.min(party, headSeats);
}

function headSeatsTotal() {
  return state.tables.filter(isHeadTable).reduce((n, t) => n + t.seats, 0);
}

// Seats vs confirmed guests, split into the bridal table and the rest.
function capacityInfo() {
  const guests = state.guests.filter(g => g.status !== 'maybe').length;
  const seats = state.tables.reduce((n, t) => n + t.seats, 0);
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

function makeHeadTable() {
  return {
    id: crypto.randomUUID(), name: 'Stol mladenaca', shape: 'head',
    seats: HEAD_TABLE_FRONT_SEATS, seatsLong: HEAD_TABLE_FRONT_SEATS, seatsEnd: 0,
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
      out.push({ x: gap + len / 2 + col * (len + gap), y: top + 55 + row * 150, rotation: 0 });
    }
    return out;
  }
  const cols = 5;
  for (let i = 0; i < count; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    out.push({ x: 120 + col * 190, y: top + 70 + row * 175, rotation: 0 });
  }
  return out;
}

function nextTableNumber() {
  let max = 0;
  for (const t of state.tables) {
    const m = /^Stol (\d+)$/.exec(t.name || '');
    if (m) max = Math.max(max, parseInt(m[1]));
  }
  return max + 1;
}

// Lowest point occupied by existing tables, so added tables go underneath.
function tablesBottom(tables) {
  let bottom = 0;
  for (const t of tables) {
    const turned = ((t.rotation || 0) % 180 + 180) % 180 === 90;
    const half = t.shape === 'round' ? 60 : turned ? longTableLength((t.seatsLong || 4) * 2) / 2 + 30 : 60;
    bottom = Math.max(bottom, t.y + half);
  }
  return bottom;
}

/**
 * Plan a hall.
 *  mode 'rebuild' – replace all regular tables (the bridal table stays)
 *  mode 'add'     – keep everything, add only the missing tables underneath
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
    hallPositions(template, count, perTable, 110).forEach((p, i) =>
      create.push(makeHallTable(template, perTable, 'Stol ' + (i + 1), p.x, p.y, p.rotation)));
    return { create, remove: state.tables.filter(t => !isHeadTable(t)).map(t => t.id), count, perTable };
  }
  const regularSeats = state.tables.filter(t => !isHeadTable(t)).reduce((n, t) => n + t.seats, 0);
  const count = tablesNeeded(regularGuests - regularSeats, perTable);
  const top = Math.max(110, tablesBottom(state.tables));
  const first = nextTableNumber();
  // U arms only make sense from scratch; extra tables are added in rows.
  hallPositions(template === 'u' ? 'long' : template, count, perTable, top).forEach((p, i) =>
    create.push(makeHallTable(template, perTable, 'Stol ' + (first + i), p.x, p.y, p.rotation)));
  return { create, remove: [], count, perTable };
}
