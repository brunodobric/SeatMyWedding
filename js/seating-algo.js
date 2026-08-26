/**
 * Auto-seating algorithm.
 * Returns { assignments: [{guestId, tableId, seatIndex}], violations: [{ruleId, reason}] }
 */
export function suggestSeating(tables, guests, rules, categories) {
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
    const seatIdx = rule.seatIndex !== null ? rule.seatIndex : seatMap[t.id]?.[0];
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
    .filter(t => seatMap[t.id]?.length > 0)
    .sort((a, b) => (seatMap[b.id]?.length || 0) - (seatMap[a.id]?.length || 0));

  // Place category-together groups on single tables when possible
  for (const catId of Object.keys(byCategory)) {
    const group = byCategory[catId].filter(g => !assignments[g.id]);
    if (group.length === 0) continue;
    if (catTogetherIds.has(catId)) {
      const t = tablesBySpace().find(t => (seatMap[t.id]?.length || 0) >= group.length);
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
  const assignArr = Object.entries(assignments).map(([guestId, a]) => ({ guestId, ...a }));
  const lockedIds = new Set(guests.filter(g => g.locked).map(g => g.id));

  function countViolations(asgn) {
    const asgnMap = {};
    for (const a of asgn) asgnMap[a.guestId] = a;
    let v = 0;
    for (const rule of rules) {
      if (rule.type === 'apart') {
        const placed = rule.guestIds.map(id => asgnMap[id]).filter(Boolean);
        if (placed.length >= 2) {
          const tables = placed.map(a => a.tableId);
          const unique = new Set(tables);
          if (unique.size < tables.length) v++;
        }
      } else if (rule.type === 'together') {
        const placed = rule.guestIds.map(id => asgnMap[id]).filter(Boolean);
        if (placed.length >= 2) {
          const tbls = new Set(placed.map(a => a.tableId));
          if (tbls.size > 1) v++;
        }
      } else if (rule.type === 'category-together') {
        const catGuests = guests.filter(g => g.categoryId === rule.categoryId);
        const placed = catGuests.map(g => asgnMap[g.id]).filter(Boolean);
        if (placed.length >= 2) {
          const tbls = new Set(placed.map(a => a.tableId));
          if (tbls.size > 1) v++;
        }
      }
    }
    return v;
  }

  let best = [...assignArr];
  let bestScore = countViolations(best);
  const movable = assignArr.filter(a => !lockedIds.has(a.guestId));

  for (let iter = 0; iter < 500 && bestScore > 0; iter++) {
    if (movable.length < 2) break;
    const i = Math.floor(movable.length * (iter / 500) % movable.length);
    const j = (i + 1 + Math.floor(iter / movable.length)) % movable.length;
    if (i === j) continue;
    const candidate = best.map(a => ({ ...a }));
    const ai = candidate.find(a => a.guestId === movable[i].guestId);
    const aj = candidate.find(a => a.guestId === movable[j].guestId);
    if (!ai || !aj) continue;
    [ai.tableId, aj.tableId] = [aj.tableId, ai.tableId];
    [ai.seatIndex, aj.seatIndex] = [aj.seatIndex, ai.seatIndex];
    const score = countViolations(candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
      movable[i] = { ...ai };
      movable[j] = { ...aj };
    }
  }

  // Check violations for report
  const asgnMap = {};
  for (const a of best) asgnMap[a.guestId] = a;
  const violations = [];
  for (const rule of rules) {
    if (rule.type === 'apart') {
      const placed = rule.guestIds.map(id => asgnMap[id]).filter(Boolean);
      if (placed.length >= 2) {
        const tids = placed.map(a => a.tableId);
        const unique = new Set(tids);
        if (unique.size < tids.length) {
          const names = rule.guestIds.map(id => guests.find(g => g.id === id)?.name || id);
          violations.push({ ruleId: rule.id, reason: `Gosti moraju biti odvojeni: ${names.join(', ')}` });
        }
      }
    } else if (rule.type === 'together') {
      const placed = rule.guestIds.map(id => asgnMap[id]).filter(Boolean);
      if (placed.length >= 2) {
        const tbls = new Set(placed.map(a => a.tableId));
        if (tbls.size > 1) {
          const names = rule.guestIds.map(id => guests.find(g => g.id === id)?.name || id);
          violations.push({ ruleId: rule.id, reason: `Gosti moraju biti zajedno: ${names.join(', ')}` });
        }
      }
    } else if (rule.type === 'category-together') {
      const catGuests = guests.filter(g => g.categoryId === rule.categoryId);
      const placed = catGuests.map(g => asgnMap[g.id]).filter(Boolean);
      if (placed.length >= 2) {
        const tbls = new Set(placed.map(a => a.tableId));
        if (tbls.size > 1) {
          const catName = categories.find(c => c.id === rule.categoryId)?.name || rule.categoryId;
          violations.push({ ruleId: rule.id, reason: `Kategorija "${catName}" nije na istom stolu` });
        }
      }
    }
  }

  return { assignments: best, violations };
}
