/**
 * Drag & drop of guests on the seating screen.
 * Sources: guests without a seat, seated guests on the floor plan and in the
 * table cards. Targets: a seat (swaps with whoever sits there), a table (first
 * free seat), a table card, or the "Bez mjesta" panel (removes the seat).
 * Mouse drags start after a small movement; touch drags from scrollable lists
 * start with a long press so normal scrolling keeps working.
 */

const guestDrag = {
  active: null,
  lastDropAt: 0,

  // True right after a drop, so the click that follows it is ignored.
  justDropped() {
    return Date.now() - this.lastDropAt < 400;
  },

  start(guestId, x, y) {
    const guest = state.guests.find(g => g.id === guestId);
    if (!guest) return;
    const cat = state.categories.find(c => c.id === guest.categoryId);
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.innerHTML = `${cat ? `<span class="chip-dot" style="background:${cat.color}"></span>` : ''}${esc(guest.name)}`;
    document.body.appendChild(ghost);
    document.body.classList.add('dragging-guest');
    this.active = { guestId, ghost, target: null, targetEl: null };
    this.move(x, y);
  },

  move(x, y) {
    const a = this.active;
    if (!a) return;
    a.x = x;
    a.y = y;
    a.ghost.style.left = x + 'px';
    a.ghost.style.top = y + 'px';
    this.autoScroll();
    this.updateTarget();
  },

  // Near the edge of the floor plan or of a scrolling list, keep moving it
  // while the finger or mouse stays there, so far tables can be reached.
  autoScroll() {
    const a = this.active;
    if (!a || a.scrollFrame) return;
    const EDGE = 44, MAX = 14;
    const speed = (pos, start, end) => {
      if (pos < start + EDGE) return -Math.ceil(MAX * (1 - Math.max(0, pos - start) / EDGE));
      if (pos > end - EDGE) return Math.ceil(MAX * (1 - Math.max(0, end - pos) / EDGE));
      return 0;
    };
    const step = () => {
      a.scrollFrame = null;
      if (this.active !== a) return;
      const el = document.elementFromPoint(a.x, a.y);
      let moved = false;
      const svg = el && el.closest && el.closest('#fp-assign-svg');
      if (svg && typeof floorPlanAssign !== 'undefined' && floorPlanAssign) {
        const r = svg.getBoundingClientRect();
        const dx = speed(a.x, r.left, r.right), dy = speed(a.y, r.top, r.bottom);
        if (dx || dy) { floorPlanAssign.panBy(dx, dy); moved = true; }
      } else {
        let box = el;
        while (box && box !== document.body) {
          const cs = getComputedStyle(box);
          if (/(auto|scroll)/.test(cs.overflowY) && box.scrollHeight > box.clientHeight) break;
          box = box.parentElement;
        }
        if (box && box !== document.body) {
          const r = box.getBoundingClientRect();
          const dy = speed(a.y, r.top, r.bottom);
          const before = box.scrollTop;
          if (dy) box.scrollTop += dy;
          moved = box.scrollTop !== before;
        }
      }
      if (moved) {
        this.updateTarget();
        a.scrollFrame = requestAnimationFrame(step);
      }
    };
    a.scrollFrame = requestAnimationFrame(step);
  },

  updateTarget() {
    const a = this.active;
    const target = this.hitTest(a.x, a.y);
    const el = target ? target.el : null;
    if (el !== a.targetEl) {
      if (a.targetEl) a.targetEl.classList.remove('drop-target');
      if (el) el.classList.add('drop-target');
      a.targetEl = el;
    }
    a.target = target;
  },

  hitTest(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || !el.closest) return null;
    const seat = el.closest('#fp-assign-svg .seat-group');
    if (seat) return { el: seat, kind: 'seat', tableId: seat.getAttribute('data-table'), seatIndex: parseInt(seat.getAttribute('data-seat')) };
    const table = el.closest('#fp-assign-svg .table-group');
    if (table) return { el: table, kind: 'table', tableId: table.getAttribute('data-id') };
    const card = el.closest('.table-card[data-table-card]');
    if (card) return { el: card, kind: 'table', tableId: card.dataset.tableCard };
    const panel = el.closest('#unassigned-panel');
    if (panel) return { el: panel, kind: 'unseat' };
    return null;
  },

  async drop(x, y) {
    const a = this.active;
    if (!a) return;
    this.move(x, y);
    const { guestId, target } = a;
    this.cleanup();
    this.lastDropAt = Date.now();
    if (target) await dropGuest(guestId, target);
  },

  cancel() {
    this.cleanup();
  },

  cleanup() {
    const a = this.active;
    if (!a) return;
    if (a.scrollFrame) cancelAnimationFrame(a.scrollFrame);
    if (a.targetEl) a.targetEl.classList.remove('drop-target');
    a.ghost.remove();
    document.body.classList.remove('dragging-guest');
    this.active = null;
  }
};

async function dropGuest(guestId, target) {
  const guest = state.guests.find(g => g.id === guestId);
  if (!guest) return;
  if (target.kind === 'unseat') {
    if (guest.tableId) await unassignGuest(guestId);
    return;
  }
  const table = state.tables.find(t => t.id === target.tableId);
  if (!table) return;
  if (target.kind === 'table') {
    if (guest.tableId === table.id) return;
    const seat = firstFreeSeat(table);
    if (seat < 0) { showToast(`${table.name} nema slobodnih mjesta`, true); return; }
    await placeGuests([{ id: guestId, tableId: table.id, seatIndex: seat }]);
    return;
  }
  // A seat: take it, and swap with whoever sits there.
  const occupant = state.guests.find(g => g.tableId === table.id && g.seatIndex === target.seatIndex);
  if (occupant && occupant.id === guestId) return;
  if (occupant && occupant.locked) { showToast(`${occupant.name} ima zaključano mjesto`, true); return; }
  const changes = [{ id: guestId, tableId: table.id, seatIndex: target.seatIndex }];
  if (occupant) changes.push({ id: occupant.id, tableId: guest.tableId, seatIndex: guest.seatIndex });
  if (!occupant) { await placeGuests(changes); return; }
  const message = guest.tableId ? `${guest.name} i ${occupant.name} su zamijenili mjesta` : `${occupant.name} je sada bez mjesta`;
  await withUndo(message, () => placeGuests(changes));
}

// Call from mousedown / touchstart on something that represents a guest.
// longPress: on touch, wait for a press-and-hold (the element is in a scrolling list).
function armGuestDrag(e, guestId, longPress) {
  const isTouch = e.type === 'touchstart';
  if (!isTouch && e.button !== 0) return;
  if (isTouch && e.touches.length !== 1) return;
  if (guestDrag.active) return;
  const p0 = isTouch ? e.touches[0] : e;
  const sx = p0.clientX, sy = p0.clientY;
  let started = false;
  let timer = null;

  const begin = (x, y) => {
    started = true;
    guestDrag.start(guestId, x, y);
    if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) {}
  };
  const point = ev => isTouch ? (ev.touches[0] || ev.changedTouches[0]) : ev;
  const onMove = ev => {
    if (isTouch && ev.touches.length > 1) { cleanup(); if (started) guestDrag.cancel(); return; }
    const p = point(ev);
    if (!started) {
      const dist = Math.hypot(p.clientX - sx, p.clientY - sy);
      if (isTouch && longPress) { if (dist > 10) cleanup(); return; } // the list is scrolling
      if (dist < 6) return;
      begin(p.clientX, p.clientY);
    }
    ev.preventDefault();
    guestDrag.move(p.clientX, p.clientY);
  };
  const onEnd = ev => {
    cleanup();
    if (!started) return;
    if (ev.type === 'touchcancel') { guestDrag.cancel(); return; }
    const p = point(ev);
    guestDrag.drop(p.clientX, p.clientY);
  };
  const cleanup = () => {
    clearTimeout(timer);
    if (isTouch) {
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    } else {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
    }
  };

  if (isTouch) {
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    if (longPress) timer = setTimeout(() => begin(sx, sy), 280);
  } else {
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  }
}
