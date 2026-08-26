/**
 * Auto-seating algorithm.
 * Returns { assignments: [{guestId, tableId, seatIndex}], violations: [{ruleId, reason}] }
 */
function suggestSeating(tables, guests, rules, categories) {
  // Bridal table(s): reserved for the newlyweds' party. Regular guests are never
  // auto-placed here — only guests in a head-table category (kum/kuma), anyone
  // tied to them by a "zajedno" rule, and anyone already seated there.
  const headTableIds = new Set(tables.filter(t => t.shape === 'head').map(t => t.id));
  const headCatIds = new Set((categories || []).filter(c => c.atHeadTable).map(c => c.id));
  // "companion" is a legacy alias for "together" — treat both the same.
  const togetherRules = rules.filter(r => r.type === 'together' || r.type === 'companion');

  // Determine the full bridal party: head-table categories + already-seated
  // guests, then propagate to anyone linked by a "zajedno" rule so a guest
  // tied to a kum/mladenac is pulled onto the bridal table too.
  const headGuestIds = new Set();
  for (const g of guests) {
    if (g.status === 'maybe') continue;
    if ((g.categoryId && headCatIds.has(g.categoryId)) || headTableIds.has(g.tableId)) {
      headGuestIds.add(g.id);
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of togetherRules) {
      const inParty = r.guestIds.some(id => headGuestIds.has(id));
      if (inParty) {
        for (const id of r.guestIds) {
          if (!headGuestIds.has(id)) { headGuestIds.add(id); grew = true; }
        }
      }
    }
  }

  // Build seat availability map: tableId -> array of free seatIndexes.
  // Head tables are kept out of the general pool (filled by a dedicated pass).
  const seatMap = {};
  for (const t of tables) {
    if (headTableIds.has(t.id)) { seatMap[t.id] = []; continue; }
    const occupied = new Set(
      guests.filter(g => g.tableId === t.id && g.locked).map(g => g.seatIndex)
    );
    const free = [];
    for (let i = 0; i < t.seats; i++) {
      if (!occupied.has(i)) free.push(i);
    }
    seatMap[t.id] = free;
  }

  // Current assignments: keep locked guests and anyone already at the bridal
  // table (newlyweds / best men stay put — auto-seating won't relocate them).
  const assignments = {};
  for (const g of guests) {
    if (g.tableId !== null && (g.locked || headTableIds.has(g.tableId))) {
      assignments[g.id] = { tableId: g.tableId, seatIndex: g.seatIndex };
    }
  }

  // Dedicated bridal-table pass: seat the party into the head table(s).
  for (const t of tables) {
    if (!headTableIds.has(t.id)) continue;
    const occupied = new Set(
      Object.values(assignments).filter(a => a.tableId === t.id).map(a => a.seatIndex)
    );
    const free = [];
    for (let i = 0; i < t.seats; i++) if (!occupied.has(i)) free.push(i);
    const needy = guests.filter(g =>
      headGuestIds.has(g.id) && !assignments[g.id] && !g.locked && g.status !== 'maybe'
    );
    for (const g of needy) {
      if (free.length === 0) break;
      assignments[g.id] = { tableId: t.id, seatIndex: free.shift() };
    }
  }

  // Guests still to place (skip locked, "maybe", and anyone already seated above)
  const toPlace = guests.filter(g => !g.locked && g.status !== 'maybe' && !assignments[g.id]);

  // Handle fixed rules first (non-locked guests with fixed rule)
  const fixedRules = rules.filter(r => r.type === 'fixed');
  for (const rule of fixedRules) {
    const gid = rule.guestIds[0];
    const g = toPlace.find(x => x.id === gid);
    if (!g) continue;
    const t = tables.find(t => t.id === rule.tableId);
    if (!t) continue;
    const seatIdx = rule.seatIndex !== null ? rule.seatIndex : (seatMap[t.id] ? seatMap[t.id][0] : undefined);
    if (seatIdx !== undefined && seatMap[t.id]) {
      const freeIdx = seatMap[t.id].indexOf(seatIdx);
      if (freeIdx >= 0) {
        seatMap[t.id].splice(freeIdx, 1);
        assignments[gid] = { tableId: t.id, seatIndex: seatIdx };
      }
    }
  }

  // Group unplaced guests by category
  const unplaced = toPlace.filter(g => !assignments[g.id]);
  const byCategory = {};
  const noCat = [];
  for (const g of unplaced) {
    if (g.categoryId) {
      if (!byCategory[g.categoryId]) byCategory[g.categoryId] = [];
      byCategory[g.categoryId].push(g);
    } else {
      noCat.push(g);
    }
  }

  // Handle category-together rules: try to fit entire category on one table
  const catTogetherRules = rules.filter(r => r.type === 'category-together');
  const catTogetherIds = new Set(catTogetherRules.map(r => r.categoryId));

  // Sort tables by remaining seats descending for greedy fill
  const tablesBySpace = () => tables
    .filter(t => (seatMap[t.id] ? seatMap[t.id].length : 0) > 0)
    .sort((a, b) => ((seatMap[b.id] ? seatMap[b.id].length : 0) || 0) - ((seatMap[a.id] ? seatMap[a.id].length : 0) || 0));

  // Category-together has PRIORITY over individuals and pairs: reserve a whole
  // table for each such category before anyone else is placed, evicting movable
  // guests if no table is free enough. Locked, bridal-table and fixed-seat
  // guests are never evicted; already-reserved category members neither.
  const immovableIds = new Set(guests.filter(g => g.locked).map(g => g.id));
  for (const [gid, a] of Object.entries(assignments)) {
    if (headTableIds.has(a.tableId)) immovableIds.add(gid);
  }
  for (const r of fixedRules) if (r.guestIds[0]) immovableIds.add(r.guestIds[0]);

  for (const catId of catTogetherIds) {
    const group = (byCategory[catId] || []).filter(g => !assignments[g.id]);
    if (group.length === 0) continue;
    // Best non-head table = one that fits the whole group once movable guests
    // leave; among those, prefer the one already emptiest (least to evict).
    const candidate = tables
      .filter(t => !headTableIds.has(t.id))
      .map(t => {
        const immovableHere = Object.entries(assignments)
          .filter(([gid, a]) => a.tableId === t.id && immovableIds.has(gid)).length;
        return { t, room: t.seats - immovableHere };
      })
      .filter(c => c.room >= group.length)
      .sort((a, b) => ((seatMap[b.t.id] ? seatMap[b.t.id].length : 0)) - ((seatMap[a.t.id] ? seatMap[a.t.id].length : 0)))[0];
    if (!candidate) continue; // group larger than any table can hold — greedy fallback below
    const t = candidate.t;
    // Evict movable guests from this table back into the placement pool.
    for (const [gid, a] of Object.entries(assignments)) {
      if (a.tableId === t.id && !immovableIds.has(gid)) delete assignments[gid];
    }
    // Rebuild the table's free seats (those not held by immovable guests).
    const occupied = new Set(
      Object.values(assignments).filter(a => a.tableId === t.id).map(a => a.seatIndex)
    );
    const free = [];
    for (let i = 0; i < t.seats; i++) if (!occupied.has(i)) free.push(i);
    // Seat the whole category here and pin them so a later category can't evict them.
    for (const g of group) {
      if (free.length === 0) break;
      assignments[g.id] = { tableId: t.id, seatIndex: free.shift() };
      immovableIds.add(g.id);
    }
    seatMap[t.id] = free;
  }

  // Place category-together groups on single tables when possible
  for (const catId of Object.keys(byCategory)) {
    const group = byCategory[catId].filter(g => !assignments[g.id]);
    if (group.length === 0) continue;
    if (catTogetherIds.has(catId)) {
      const t = tablesBySpace().find(t => ((seatMap[t.id] ? seatMap[t.id].length : 0) || 0) >= group.length);
      if (t) {
        for (const g of group) {
          const seat = seatMap[t.id].shift();
          assignments[g.id] = { tableId: t.id, seatIndex: seat };
        }
        continue;
      }
    }
    // Regular greedy: fill best available table
    for (const g of group) {
      if (assignments[g.id]) continue;
      const t = tablesBySpace()[0];
      if (!t) continue;
      const seat = seatMap[t.id].shift();
      assignments[g.id] = { tableId: t.id, seatIndex: seat };
    }
  }

  // Place guests without category
  for (const g of noCat) {
    if (assignments[g.id]) continue;
    const t = tablesBySpace()[0];
    if (!t) continue;
    const seat = seatMap[t.id].shift();
    assignments[g.id] = { tableId: t.id, seatIndex: seat };
  }

  // Local improvement: swap pairs to reduce rule violations.
  // Locked guests and everyone seated at a bridal table are immovable.
  const lockedIds = new Set(guests.filter(g => g.locked).map(g => g.id));
  for (const [gid, a] of Object.entries(assignments)) {
    if (headTableIds.has(a.tableId)) lockedIds.add(gid);
  }

  function countViolations(map) {
    let v = 0;
    for (const rule of rules) {
      if (rule.type === 'apart') {
        const placed = rule.guestIds.map(id => map[id]).filter(Boolean);
        if (placed.length >= 2) {
          const tables = placed.map(a => a.tableId);
          if (new Set(tables).size < tables.length) v++;
        }
      } else if (rule.type === 'together' || rule.type === 'companion') {
        const placed = rule.guestIds.map(id => map[id]).filter(Boolean);
        if (placed.length >= 2 && new Set(placed.map(a => a.tableId)).size > 1) v++;
      } else if (rule.type === 'category-together') {
        const catGuests = guests.filter(g => g.categoryId === rule.categoryId);
        const placed = catGuests.map(g => map[g.id]).filter(Boolean);
        if (placed.length >= 2 && new Set(placed.map(a => a.tableId)).size > 1) v++;
      }
    }
    return v;
  }

  // Work on a guestId -> {tableId, seatIndex} map for cheap in-place edits.
  const asgnMap = {};
  for (const [guestId, a] of Object.entries(assignments)) {
    asgnMap[guestId] = { tableId: a.tableId, seatIndex: a.seatIndex };
  }
  const movableIds = Object.keys(asgnMap).filter(id => !lockedIds.has(id));

  // Track free seats per table so a guest can be MOVED into an empty seat (not
  // just swapped). Without this, two guests each alone at their own table can
  // never be brought together — a swap only exchanges their tables.
  // Head tables are reserved, so they never receive moved guests.
  const freeByTable = {};
  for (const t of tables) {
    if (headTableIds.has(t.id)) { freeByTable[t.id] = []; continue; }
    const occupied = new Set(
      Object.values(asgnMap).filter(a => a.tableId === t.id).map(a => a.seatIndex)
    );
    const free = [];
    for (let i = 0; i < t.seats; i++) if (!occupied.has(i)) free.push(i);
    freeByTable[t.id] = free;
  }

  // Hill-climb: repeatedly try moves (relocate to a free seat) and swaps,
  // keeping any change that lowers the violation count, until a full pass
  // yields no improvement.
  let bestScore = countViolations(asgnMap);
  let improved = true;
  let passes = 0;
  while (improved && bestScore > 0 && passes < 12) {
    improved = false;
    passes++;

    // Moves: relocate a movable guest to a free seat on another table.
    for (let i = 0; i < movableIds.length && bestScore > 0; i++) {
      const a = asgnMap[movableIds[i]];
      const fromTable = a.tableId, fromSeat = a.seatIndex;
      for (const t of tables) {
        if (t.id === fromTable || headTableIds.has(t.id)) continue;
        const free = freeByTable[t.id];
        if (!free || free.length === 0) continue;
        const toSeat = free[0];
        a.tableId = t.id; a.seatIndex = toSeat;
        const score = countViolations(asgnMap);
        if (score < bestScore) {
          bestScore = score;
          improved = true;
          free.shift();                       // toSeat now taken
          freeByTable[fromTable].push(fromSeat); // old seat now free
          break;
        } else {
          a.tableId = fromTable; a.seatIndex = fromSeat; // revert
        }
      }
    }

    // Swaps: exchange the tables of two movable guests (seat occupancy per
    // table is unchanged, so free-seat lists stay valid).
    for (let i = 0; i < movableIds.length && bestScore > 0; i++) {
      for (let j = i + 1; j < movableIds.length; j++) {
        const a = asgnMap[movableIds[i]];
        const b = asgnMap[movableIds[j]];
        if (a.tableId === b.tableId) continue; // same table: no table-level change
        const at = a.tableId, as = a.seatIndex, bt = b.tableId, bs = b.seatIndex;
        a.tableId = bt; a.seatIndex = bs;
        b.tableId = at; b.seatIndex = as;
        const score = countViolations(asgnMap);
        if (score < bestScore) {
          bestScore = score;
          improved = true;
          if (bestScore === 0) break;
        } else {
          a.tableId = at; a.seatIndex = as;
          b.tableId = bt; b.seatIndex = bs;
        }
      }
    }
  }

  const best = Object.entries(asgnMap).map(([guestId, a]) => ({ guestId, tableId: a.tableId, seatIndex: a.seatIndex }));

  // Check violations for report
  const violations = [];
  for (const rule of rules) {
    if (rule.type === 'apart') {
      const placed = rule.guestIds.map(id => asgnMap[id]).filter(Boolean);
      if (placed.length >= 2) {
        const tids = placed.map(a => a.tableId);
        const unique = new Set(tids);
        if (unique.size < tids.length) {
          const names = rule.guestIds.map(id => { const g = guests.find(x => x.id === id); return g ? g.name : id; });
          violations.push({ ruleId: rule.id, reason: `Gosti moraju biti odvojeni: ${names.join(', ')}` });
        }
      }
    } else if (rule.type === 'together' || rule.type === 'companion') {
      const placed = rule.guestIds.map(id => asgnMap[id]).filter(Boolean);
      if (placed.length >= 2) {
        const tbls = new Set(placed.map(a => a.tableId));
        if (tbls.size > 1) {
          const names = rule.guestIds.map(id => { const g = guests.find(x => x.id === id); return g ? g.name : id; });
          violations.push({ ruleId: rule.id, reason: `Gosti moraju biti zajedno: ${names.join(', ')}` });
        }
      }
    } else if (rule.type === 'category-together') {
      const catGuests = guests.filter(g => g.categoryId === rule.categoryId);
      const placed = catGuests.map(g => asgnMap[g.id]).filter(Boolean);
      if (placed.length >= 2) {
        const tbls = new Set(placed.map(a => a.tableId));
        if (tbls.size > 1) {
          const catObj = categories.find(c => c.id === rule.categoryId);
          const catName = catObj ? catObj.name : rule.categoryId;
          violations.push({ ruleId: rule.id, reason: `Kategorija "${catName}" nije na istom stolu` });
        }
      }
    }
  }

  return { assignments: best, violations };
}
