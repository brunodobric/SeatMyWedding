/**
 * Auto-seating algorithm.
 * Returns { assignments: [{guestId, tableId, seatIndex}], violations: [{ruleId, reason}] }
 */
function suggestSeating(tables, guests, rules, categories) {
  // Build seat availability map: tableId -> Set of free seatIndexes
  const seatMap = {};
  for (const t of tables) {
    const occupied = new Set(
      guests.filter(g => g.tableId === t.id && g.locked).map(g => g.seatIndex)
    );
    const free = [];
    for (let i = 0; i < t.seats; i++) {
      if (!occupied.has(i)) free.push(i);
    }
    seatMap[t.id] = free;
  }

  // Current assignments (start from locked only)
  const assignments = {};
  for (const g of guests) {
    if (g.locked && g.tableId !== null) {
      assignments[g.id] = { tableId: g.tableId, seatIndex: g.seatIndex };
    }
  }

  // Guests to place
  const toPlace = guests.filter(g => !g.locked && g.status !== 'maybe');

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

  // Local improvement: swap pairs to reduce rule violations
  const lockedIds = new Set(guests.filter(g => g.locked).map(g => g.id));

  function countViolations(map) {
    let v = 0;
    for (const rule of rules) {
      if (rule.type === 'apart') {
        const placed = rule.guestIds.map(id => map[id]).filter(Boolean);
        if (placed.length >= 2) {
          const tables = placed.map(a => a.tableId);
          if (new Set(tables).size < tables.length) v++;
        }
      } else if (rule.type === 'together') {
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

  // Work on a guestId -> {tableId, seatIndex} map for cheap in-place swaps.
  const asgnMap = {};
  for (const [guestId, a] of Object.entries(assignments)) {
    asgnMap[guestId] = { tableId: a.tableId, seatIndex: a.seatIndex };
  }
  const movableIds = Object.keys(asgnMap).filter(id => !lockedIds.has(id));

  // Hill-climb: repeatedly sweep all movable pairs, keeping any swap that
  // lowers the violation count, until a full pass yields no improvement.
  let bestScore = countViolations(asgnMap);
  let improved = true;
  let passes = 0;
  while (improved && bestScore > 0 && passes < 12) {
    improved = false;
    passes++;
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
    } else if (rule.type === 'together') {
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
