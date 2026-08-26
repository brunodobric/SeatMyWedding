
const CATEGORY_COLORS = ['#7B9E87','#7A8FA6','#B07B72','#9B8EA8','#8A9A6A','#C4956A','#6B8FAA','#A88FA8'];

let currentSection = 'sala';
let floorPlanEdit = null;
let floorPlanAssign = null;
let lastSeatingSnapshot = null;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

// iOS Safari ignores user-scalable=no, so block pinch-zoom gestures explicitly.
// (The floor plan keeps its own +/- zoom controls.)
['gesturestart', 'gesturechange', 'gestureend'].forEach(evt =>
  document.addEventListener(evt, e => e.preventDefault(), { passive: false })
);

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  await loadAll();
  setupNav();
  setupHeader();
  if (typeof setupAuth === 'function') setupAuth();
  window.addEventListener('stateChange', onStateChange);
  if (!state.settings.weddingTitle) {
    showOnboarding();
  } else {
    renderAll();
    navigateTo('sala');
  }
}

const SECTIONS = ['sala', 'gosti', 'pravila', 'raspored', 'pregled'];

function renderSection(section) {
  if (section === 'sala') renderSala();
  else if (section === 'gosti') renderGosti();
  else if (section === 'pravila') renderPravila();
  else if (section === 'raspored') renderRaspored();
  else if (section === 'pregled') renderPregled();
}

function onStateChange(e) {
  const type = (e.detail ? e.detail.type : null);
  if (type === 'settings') updateMonogram();
  if (type === 'rules') refreshRules();
  else refreshCurrentSection();
}

function refreshCurrentSection() {
  renderSection(currentSection);
  updateHeader();
}

function refreshRules() {
  if (currentSection === 'pravila') renderPravila();
  updateHeader();
}

function renderAll() {
  SECTIONS.forEach(renderSection);
  updateHeader();
  updateMonogram();
}

// ── Navigation ─────────────────────────────────────────────────────────────────

function setupNav() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.nav));
  });
}

function navigateTo(section) {
  currentSection = section;
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === section);
  });
  document.querySelectorAll('.section').forEach(el => {
    el.classList.toggle('active', el.id === `section-${section}`);
  });
  renderSection(section);
}

// ── Header ─────────────────────────────────────────────────────────────────────

function setupHeader() {
  const titleEl = document.getElementById('wedding-title-display');
  titleEl.addEventListener('click', () => {
    const input = document.getElementById('wedding-title-input');
    input.value = state.settings.weddingTitle;
    input.style.display = 'inline-block';
    titleEl.style.display = 'none';
    input.focus();
    input.select();
  });
  const input = document.getElementById('wedding-title-input');
  input.addEventListener('blur', async () => {
    await saveSettings({ weddingTitle: input.value.trim() || 'Moje Vjenčanje' });
    input.style.display = 'none';
    document.getElementById('wedding-title-display').style.display = '';
    updateHeader();
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
}

function updateHeader() {
  const titleEl = document.getElementById('wedding-title-display');
  titleEl.textContent = state.settings.weddingTitle || 'Moje Vjenčanje';
  const stats = getStats();
  document.getElementById('stat-assigned').textContent = `Raspoređeno ${stats.assigned}/${stats.total}`;
  document.getElementById('stat-violated').textContent = `Prekršena pravila: ${stats.violated}`;
  document.getElementById('stat-violated').className = stats.violated > 0 ? 'stat-badge violated' : 'stat-badge';
}

function updateMonogram() {
  const m = state.settings.monogram || '♡';
  document.querySelectorAll('.monogram-text').forEach(el => el.textContent = m);
}

// ── Onboarding ─────────────────────────────────────────────────────────────────

function showOnboarding() {
  const modal = document.getElementById('modal-onboarding');
  modal.style.display = 'flex';
  let step = 1;
  showOnboardingStep(step);

  document.getElementById('onboarding-next').addEventListener('click', async () => {
    if (step === 1) {
      const title = document.getElementById('ob-title').value.trim() || 'Moje Vjenčanje';
      const monogram = document.getElementById('ob-monogram').value.trim() || '♡';
      await saveSettings({ weddingTitle: title, monogram });
      step = 2;
      showOnboardingStep(step);
    } else if (step === 2) {
      const numTables = parseInt(document.getElementById('ob-tables').value) || 0;
      const numSeats = parseInt(document.getElementById('ob-seats').value) || 8;
      const headSeats = parseInt(document.getElementById('ob-head-seats').value) || 5;
      await saveTable({
        id: crypto.randomUUID(), name: 'Stol mladenaca',
        shape: 'head', seats: headSeats * 2,
        seatsLong: headSeats, seatsEnd: 0,
        x: 500, y: 55, rotation: 0
      });
      for (let i = 1; i <= numTables; i++) {
        await saveTable({
          id: crypto.randomUUID(), name: 'Stol ' + i,
          shape: 'round', seats: numSeats,
          x: 100 + ((i - 1) % 5) * 170, y: 160 + Math.floor((i - 1) / 5) * 170,
          rotation: 0
        });
      }
      // Default bridal-party categories — auto-seated at the bridal table.
      await saveCategory({ id: crypto.randomUUID(), name: 'Mladenci', color: '#7A8FA6', atHeadTable: true });
      await saveCategory({ id: crypto.randomUUID(), name: 'Kumovi', color: '#B07B72', atHeadTable: true });
      step = 3;
      showOnboardingStep(step);
    } else {
      modal.style.display = 'none';
      renderAll();
      navigateTo('sala');
    }
  });
}

function showOnboardingStep(step) {
  document.querySelectorAll('.ob-step').forEach(el => {
    el.style.display = parseInt(el.dataset.step) === step ? 'block' : 'none';
  });
  const btn = document.getElementById('onboarding-next');
  btn.textContent = step === 3 ? 'Počni ✨' : 'Dalje →';
}

// ── SALA ───────────────────────────────────────────────────────────────────────

function renderSala() {
  renderTableList();
  if (!floorPlanEdit) {
    const svg = document.getElementById('fp-edit-svg');
    floorPlanEdit = new FloorPlan(svg, {
      mode: 'edit',
      onTableMove: async (table) => { await saveTable(table); },
      onTableClick: (id) => { openTableModal(id); floorPlanEdit.selectTable(id); }
    });
  }
  const violated = getViolatedTableIds();
  floorPlanEdit.update(state.tables, state.guests, state.categories, violated);
}

function renderTableList() {
  const list = document.getElementById('table-list');
  if (!list) return;
  if (state.tables.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>Nema stolova.<br>Dodaj prvi stol ↑</p></div>';
    return;
  }
  list.innerHTML = state.tables.map(t => {
    const assigned = state.guests.filter(g => g.tableId === t.id).length;
    const shapeIcon = { round: '⭕', square: '⬜', rectangular: '▭', royal: '▬', head: '🥂' }[t.shape] || '⬜';
    return `<div class="table-row" data-id="${t.id}">
      <span class="table-shape-icon">${shapeIcon}</span>
      <div class="table-row-info">
        <span class="table-row-name">${esc(t.name)}</span>
        <span class="table-row-count">${assigned}/${t.seats} mjesta</span>
      </div>
      <button class="btn-icon" data-edit="${t.id}" title="Uredi">✏️</button>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openTableModal(btn.dataset.edit); });
  });
  list.querySelectorAll('.table-row').forEach(row => {
    row.addEventListener('click', () => { openTableModal(row.dataset.id); });
  });
}

function updateSeatsUI(shape) {
  const isSided = shape === 'square' || shape === 'rectangular' || shape === 'royal' || shape === 'head';
  document.getElementById('seats-total-group').style.display = isSided ? 'none' : '';
  document.getElementById('seats-per-side-group').style.display = isSided ? 'flex' : 'none';
  document.getElementById('seats-end-group').style.display = shape === 'square' ? 'none' : '';
  const longLabel = document.getElementById('label-seats-long');
  if (shape === 'square') longLabel.textContent = 'Mjesta po strani';
  else if (shape === 'head') longLabel.textContent = 'Mjesta (prednja strana)';
  else longLabel.textContent = 'Mjesta po dužoj strani';
  const endLabel = document.querySelector('label[for="table-seats-end"]');
  if (endLabel) endLabel.textContent = 'Mjesta po čelu (kraća strana)';
  updateSeatsTotalDisplay(shape);
}

function updateSeatsTotalDisplay(shape) {
  const nLong = parseInt(document.getElementById('table-seats-long').value) || 0;
  const nEnd = parseInt(document.getElementById('table-seats-end').value) || 0;
  let total = 0;
  if (shape === 'square') total = nLong * 4;
  else if (shape === 'head') total = nLong + nEnd * 2;
  else total = nLong * 2 + nEnd * 2;
  document.getElementById('seats-total-computed').textContent = `Ukupno: ${total} mjesta`;
}

function openTableModal(id) {
  const table = id ? state.tables.find(t => t.id === id) : null;
  const modal = document.getElementById('modal-table');
  const title = document.getElementById('modal-table-title');
  title.textContent = table ? 'Uredi stol' : 'Dodaj stol';

  document.getElementById('table-name').value = (table ? table.name : undefined) || `Stol ${state.tables.length + 1}`;
  const shape = (table ? table.shape : undefined) || 'round';
  document.querySelectorAll('.shape-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.shape === shape);
  });

  if (shape === 'round') {
    document.getElementById('table-seats').value = (table ? table.seats : undefined) || 8;
  } else if (shape === 'square') {
    const perSide = (table ? table.seatsLong : undefined) || Math.round(((table ? table.seats : undefined) || 8) / 4) || 2;
    document.getElementById('table-seats-long').value = perSide;
  } else if (shape === 'head') {
    document.getElementById('table-seats-long').value = (table ? table.seatsLong : undefined) || 8;
    document.getElementById('table-seats-end').value = (table ? table.seatsEnd : undefined) || 1;
  } else {
    document.getElementById('table-seats-long').value = (table ? table.seatsLong : undefined) || 4;
    document.getElementById('table-seats-end').value = (table ? table.seatsEnd : undefined) || 1;
  }

  updateSeatsUI(shape);

  document.getElementById('btn-delete-table').style.display = table ? '' : 'none';
  document.getElementById('btn-duplicate-table').style.display = table ? '' : 'none';

  modal.dataset.editId = id || '';
  modal.style.display = 'flex';
}

function setupTableModal() {
  document.querySelectorAll('.shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateSeatsUI(btn.dataset.shape);
    });
  });

  ['table-seats-long', 'table-seats-end'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const shape = document.querySelector('.shape-btn.active').dataset.shape || 'round';
      updateSeatsTotalDisplay(shape);
    });
  });

  document.getElementById('btn-save-table').addEventListener('click', async () => {
    const modal = document.getElementById('modal-table');
    const id = modal.dataset.editId || crypto.randomUUID();
    const existing = state.tables.find(t => t.id === id);
    const shape = document.querySelector('.shape-btn.active').dataset.shape || 'round';

    let seats, seatsLong, seatsEnd;
    if (shape === 'round') {
      seats = parseInt(document.getElementById('table-seats').value) || 8;
    } else if (shape === 'square') {
      seatsLong = parseInt(document.getElementById('table-seats-long').value) || 2;
      seatsEnd = seatsLong;
      seats = seatsLong * 4;
    } else if (shape === 'head') {
      seatsLong = parseInt(document.getElementById('table-seats-long').value) || 8;
      seatsEnd = parseInt(document.getElementById('table-seats-end').value) || 0;
      seats = seatsLong + seatsEnd * 2;
    } else {
      seatsLong = parseInt(document.getElementById('table-seats-long').value) || 4;
      seatsEnd = parseInt(document.getElementById('table-seats-end').value) || 0;
      seats = seatsLong * 2 + seatsEnd * 2;
    }

    const table = {
      id,
      name: document.getElementById('table-name').value.trim() || 'Stol',
      shape,
      seats,
      seatsLong,
      seatsEnd,
      x: (existing ? existing.x : undefined) || 200, y: (existing ? existing.y : undefined) || 200, rotation: (existing ? existing.rotation : undefined) || 0
    };
    await saveTable(table);
    modal.style.display = 'none';
    renderSala();
  });

  document.getElementById('btn-delete-table').addEventListener('click', async () => {
    const modal = document.getElementById('modal-table');
    const id = modal.dataset.editId;
    if (id && confirm('Obrisati stol i osloboditi sva mjesta?')) {
      await deleteTable(id);
      modal.style.display = 'none';
      renderSala();
    }
  });

  document.getElementById('btn-duplicate-table').addEventListener('click', async () => {
    const modal = document.getElementById('modal-table');
    const id = modal.dataset.editId;
    const orig = state.tables.find(t => t.id === id);
    if (!orig) return;
    const newTable = { ...orig, id: crypto.randomUUID(), name: orig.name + ' (kopija)', x: orig.x + 60, y: orig.y + 60 };
    await saveTable(newTable);
    modal.style.display = 'none';
    renderSala();
  });

  document.getElementById('btn-add-table').addEventListener('click', () => openTableModal(null));

  document.getElementById('btn-snap-grid').addEventListener('click', () => {
    if (!floorPlanEdit) return;
    const active = !floorPlanEdit.snapToGrid;
    floorPlanEdit.setSnapToGrid(active);
    document.getElementById('btn-snap-grid').classList.toggle('active', active);
  });

  document.getElementById('btn-zoom-in').addEventListener('click', () => floorPlanEdit && floorPlanEdit.zoomIn());
  document.getElementById('btn-zoom-out').addEventListener('click', () => floorPlanEdit && floorPlanEdit.zoomOut());
  document.getElementById('btn-zoom-reset').addEventListener('click', () => floorPlanEdit && floorPlanEdit.resetView());
}

// ── GOSTI ──────────────────────────────────────────────────────────────────────

let guestSearchQuery = '';
let guestCategoryFilter = '';

function renderGosti() {
  renderCategoryChips();
  renderGuestList();
  document.getElementById('guest-count').textContent = `${state.guests.length} gostiju`;
}

function renderCategoryChips() {
  const container = document.getElementById('category-filter-chips');
  if (!container) return;
  container.innerHTML = `<button class="chip${!guestCategoryFilter ? ' active' : ''}" data-cat="">Svi</button>` +
    state.categories.map(c =>
      `<button class="chip${guestCategoryFilter === c.id ? ' active' : ''}" data-cat="${c.id}" style="--cat-color:${c.color}">${esc(c.name)}</button>`
    ).join('');
  container.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => { guestCategoryFilter = btn.dataset.cat; renderGuestList(); renderCategoryChips(); });
  });
}

function renderGuestList() {
  const list = document.getElementById('guest-list');
  if (!list) return;
  let guests = [...state.guests];
  if (guestSearchQuery) {
    const q = guestSearchQuery.toLowerCase();
    guests = guests.filter(g => g.name.toLowerCase().includes(q));
  }
  if (guestCategoryFilter) {
    guests = guests.filter(g => g.categoryId === guestCategoryFilter);
  }
  guests.sort((a, b) => a.name.localeCompare(b.name));
  if (guests.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>Nema gostiju.</p></div>';
    return;
  }
  list.innerHTML = guests.map(g => {
    const cat = state.categories.find(c => c.id === g.categoryId);
    const table = g.tableId ? state.tables.find(t => t.id === g.tableId) : null;
    const statusLabel = g.status === 'assigned' ? `<span class="status-badge assigned">Stol: ${esc((table ? table.name : undefined) || '?')}</span>`
      : g.status === 'maybe' ? '<span class="status-badge maybe">Možda</span>'
      : '<span class="status-badge unassigned">Nedodijeljen</span>';
    return `<div class="guest-row" data-id="${g.id}">
      <div class="guest-row-main">
        <span class="guest-name">${esc(g.name)}</span>
        ${cat ? `<span class="cat-chip" style="background:${cat.color}">${esc(cat.name)}</span>` : '<span class="cat-chip no-cat">—</span>'}
      </div>
      <div class="guest-row-meta">
        ${statusLabel}
        ${g.locked ? '<span class="lock-badge">🔒</span>' : ''}
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.guest-row').forEach(row => {
    row.addEventListener('click', () => openGuestModal(row.dataset.id));
  });
}

function setupGostiEvents() {
  const input = document.getElementById('quick-add-guest');
  input && input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const name = input.value.trim();
      if (!name) return;
      await saveGuest({ id: crypto.randomUUID(), name, categoryId: null, status: 'unassigned', tableId: null, seatIndex: null, locked: false, notes: '' });
      input.value = '';
      renderGosti();
    }
  });

  document.getElementById('btn-import-guests').addEventListener('click', () => {
    document.getElementById('modal-import').style.display = 'flex';
  });

  document.getElementById('btn-import-confirm').addEventListener('click', async () => {
    const raw = document.getElementById('import-textarea').value;
    const names = raw.split('\n').map(n => n.trim().split(',')[0].trim()).filter(Boolean);
    for (const name of names) {
      if (!state.guests.find(g => g.name === name)) {
        await saveGuest({ id: crypto.randomUUID(), name, categoryId: null, status: 'unassigned', tableId: null, seatIndex: null, locked: false, notes: '' });
      }
    }
    document.getElementById('modal-import').style.display = 'none';
    document.getElementById('import-textarea').value = '';
    renderGosti();
  });

  document.getElementById('guest-search').addEventListener('input', (e) => {
    guestSearchQuery = e.target.value;
    renderGuestList();
  });

  document.getElementById('btn-manage-categories').addEventListener('click', () => {
    renderCategoryManager();
    document.getElementById('modal-categories').style.display = 'flex';
  });

  document.getElementById('btn-add-guest-btn').addEventListener('click', () => openGuestModal(null));
}

function renderCategoryManager() {
  const list = document.getElementById('category-manager-list');
  if (!list) return;
  list.innerHTML = state.categories.map((c, i) =>
    `<div class="cat-manager-row" style="--cat-color:${c.color}">
      <span class="cat-swatch" style="background:${c.color}"></span>
      <span class="cat-manager-name">${esc(c.name)}</span>
      <button class="btn-icon" data-edit-cat="${c.id}">✏️</button>
      <button class="btn-icon danger" data-del-cat="${c.id}">🗑️</button>
    </div>`
  ).join('') || '<p class="muted">Nema kategorija.</p>';
  list.querySelectorAll('[data-del-cat]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Obrisati kategoriju?')) { await deleteCategory(btn.dataset.delCat); renderCategoryManager(); renderGosti(); }
    });
  });
  list.querySelectorAll('[data-edit-cat]').forEach(btn => {
    btn.addEventListener('click', () => openCategoryEditModal(btn.dataset.editCat));
  });
}

function openCategoryEditModal(id) {
  const cat = id ? state.categories.find(c => c.id === id) : null;
  const modal = document.getElementById('modal-category-edit');
  document.getElementById('cat-edit-name').value = (cat ? cat.name : undefined) || '';
  document.getElementById('cat-edit-head').checked = !!(cat && cat.atHeadTable);
  document.querySelectorAll('.color-swatch-btn').forEach((btn, i) => {
    btn.style.background = CATEGORY_COLORS[i];
    btn.classList.toggle('active', CATEGORY_COLORS[i] === ((cat ? cat.color : undefined) || CATEGORY_COLORS[0]));
    btn.dataset.color = CATEGORY_COLORS[i];
  });
  modal.dataset.editId = id || '';
  modal.style.display = 'flex';
}

function setupCategoryEditModal() {
  document.querySelectorAll('.color-swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.getElementById('btn-save-category').addEventListener('click', async () => {
    const modal = document.getElementById('modal-category-edit');
    const id = modal.dataset.editId || crypto.randomUUID();
    const name = document.getElementById('cat-edit-name').value.trim();
    if (!name) return;
    const color = document.querySelector('.color-swatch-btn.active').dataset.color || CATEGORY_COLORS[0];
    const atHeadTable = document.getElementById('cat-edit-head').checked;
    await saveCategory({ id, name, color, atHeadTable });
    modal.style.display = 'none';
    renderCategoryManager();
    renderGosti();
  });
}

function setupAddCategoryBtn() {
  document.getElementById('btn-add-category').addEventListener('click', () => openCategoryEditModal(null));
}

function openGuestModal(id) {
  const guest = id ? state.guests.find(g => g.id === id) : null;
  const modal = document.getElementById('modal-guest');
  document.getElementById('modal-guest-title').textContent = guest ? 'Uredi gosta' : 'Dodaj gosta';
  document.getElementById('guest-edit-name').value = (guest ? guest.name : undefined) || '';
  document.getElementById('guest-edit-notes').value = (guest ? guest.notes : undefined) || '';
  document.getElementById('guest-edit-locked').checked = (guest ? guest.locked : undefined) || false;
  document.getElementById('guest-edit-status').value = (guest ? guest.status : undefined) || 'unassigned';

  const catSel = document.getElementById('guest-edit-category');
  catSel.innerHTML = '<option value="">— bez kategorije —</option>' +
    state.categories.map(c => `<option value="${c.id}"${(guest ? guest.categoryId : undefined) === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('');

  document.getElementById('btn-delete-guest').style.display = guest ? '' : 'none';
  modal.dataset.editId = id || '';
  modal.style.display = 'flex';
}

function setupGuestModal() {
  document.getElementById('btn-save-guest').addEventListener('click', async () => {
    const modal = document.getElementById('modal-guest');
    const id = modal.dataset.editId || crypto.randomUUID();
    const existing = state.guests.find(g => g.id === id);
    const name = document.getElementById('guest-edit-name').value.trim();
    if (!name) return;
    const catId = document.getElementById('guest-edit-category').value || null;
    const status = document.getElementById('guest-edit-status').value;
    const locked = document.getElementById('guest-edit-locked').checked;
    const notes = document.getElementById('guest-edit-notes').value.trim();
    const guest = {
      id, name, categoryId: catId, status,
      tableId: (existing ? existing.tableId : undefined) || null,
      seatIndex: (existing ? existing.seatIndex : undefined) || null,
      locked, notes
    };
    if (status !== 'assigned') { guest.tableId = null; guest.seatIndex = null; }
    await saveGuest(guest);
    modal.style.display = 'none';
    renderGosti();
    if (currentSection === 'raspored') renderRaspored();
  });

  document.getElementById('btn-delete-guest').addEventListener('click', async () => {
    const modal = document.getElementById('modal-guest');
    const id = modal.dataset.editId;
    if (!id) return;
    const rulesAffected = state.rules.filter(r => r.guestIds && r.guestIds.includes(id));
    let msg = 'Obrisati gosta?';
    if (rulesAffected.length > 0) msg += ` Gost je u ${rulesAffected.length} pravil(u/ima) — bit će uklonjen iz njih.`;
    if (confirm(msg)) {
      await deleteGuest(id);
      modal.style.display = 'none';
      renderGosti();
      if (currentSection === 'raspored') renderRaspored();
    }
  });
}

// ── PRAVILA ────────────────────────────────────────────────────────────────────

function renderPravila() {
  const list = document.getElementById('rules-list');
  if (!list) return;
  if (state.rules.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <p>Nema pravila.</p>
    </div>`;
    return;
  }
  list.innerHTML = state.rules.map(r => {
    const icons = { apart: '❌', together: '✅', companion: '✅', fixed: '📌', 'category-together': '👪' };
    const labels = { apart: 'Odvojeni', together: 'Zajedno', companion: 'Zajedno', fixed: 'Fiksno', 'category-together': 'Kategorija zajedno' };
    let desc = '';
    if (r.type === 'apart' || r.type === 'together' || r.type === 'companion') {
      desc = r.guestIds.map(nameOf).join(', ');
    } else if (r.type === 'fixed') {
      const g = state.guests.find(x => x.id === r.guestIds[0]);
      const t = state.tables.find(x => x.id === r.tableId);
      desc = `${(g ? g.name : undefined) || '?'} → ${(t ? t.name : undefined) || '?'}${r.seatIndex !== null ? `, mj. ${r.seatIndex + 1}` : ''}`;
    } else if (r.type === 'category-together') {
      const cat = state.categories.find(c => c.id === r.categoryId);
      desc = (cat ? cat.name : undefined) || '?';
    }
    const status = r.satisfied === true ? '<span class="rule-status ok">✔</span>'
      : r.satisfied === false ? '<span class="rule-status bad">✖</span>'
      : '<span class="rule-status na">—</span>';
    return `<div class="rule-row">
      <span class="rule-icon">${icons[r.type]}</span>
      <div class="rule-info">
        <span class="rule-type-label">${labels[r.type]}</span>
        <span class="rule-desc">${esc(desc)}</span>
      </div>
      ${status}
      <button class="btn-icon danger" data-del-rule="${r.id}">🗑️</button>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-del-rule]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deleteRule(btn.dataset.delRule);
      renderPravila();
    });
  });
}

function setupPravilaEvents() {
  document.getElementById('btn-add-rule').addEventListener('click', () => {
    openRuleModal();
  });
}

function openRuleModal(prefillType) {
  const modal = document.getElementById('modal-rule');
  const type = prefillType || 'apart';
  document.querySelectorAll('.rule-type-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.type === type));
  updateRuleModalFields(type);
  modal.style.display = 'flex';
}

function updateRuleModalFields(type) {
  const guestPickerWrap = document.getElementById('rule-guest-picker-wrap');
  const catPickerWrap = document.getElementById('rule-cat-picker-wrap');
  const tablePickerWrap = document.getElementById('rule-table-picker-wrap');
  const seatPickerWrap = document.getElementById('rule-seat-picker-wrap');

  guestPickerWrap.style.display = (type === 'apart' || type === 'together' || type === 'companion' || type === 'fixed') ? '' : 'none';
  catPickerWrap.style.display = type === 'category-together' ? '' : 'none';
  tablePickerWrap.style.display = type === 'fixed' ? '' : 'none';
  seatPickerWrap.style.display = type === 'fixed' ? '' : 'none';

  const guestLabel = document.querySelector('#rule-guest-picker-wrap label');
  if (guestLabel) guestLabel.textContent = 'Odaberi goste';

  const guestSel = document.getElementById('rule-guest-select');
  guestSel.multiple = type !== 'fixed';
  guestSel.size = type === 'fixed' ? 1 : 5;
  guestSel.innerHTML = state.guests.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');

  const catSel = document.getElementById('rule-cat-select');
  catSel.innerHTML = state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const tableSel = document.getElementById('rule-table-select');
  tableSel.innerHTML = state.tables.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

  updateSeatOptions();
}

function updateSeatOptions() {
  const tableId = document.getElementById('rule-table-select').value;
  const table = state.tables.find(t => t.id === tableId);
  const seatSel = document.getElementById('rule-seat-select');
  if (!seatSel) return;
  seatSel.innerHTML = '<option value="">— bilo koje mjesto —</option>' +
    (table ? Array.from({ length: table.seats }, (_, i) => `<option value="${i}">Mjesto ${i + 1}</option>`).join('') : '');
}

function setupRuleModal() {
  document.querySelectorAll('.rule-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rule-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateRuleModalFields(btn.dataset.type);
    });
  });

  document.getElementById('rule-table-select').addEventListener('change', updateSeatOptions);

  document.getElementById('btn-save-rule').addEventListener('click', async () => {
    const type = document.querySelector('.rule-type-btn.active').dataset.type || 'apart';
    const rule = { id: crypto.randomUUID(), type, guestIds: [], categoryId: null, tableId: null, seatIndex: null, satisfied: null };

    if (type === 'apart' || type === 'together' || type === 'companion') {
      const sel = document.getElementById('rule-guest-select');
      rule.guestIds = Array.from(sel.selectedOptions).map(o => o.value);
      if (rule.guestIds.length < 2) {
        alert('Odaberi najmanje 2 gosta.');
        return;
      }
    } else if (type === 'fixed') {
      const sel = document.getElementById('rule-guest-select');
      rule.guestIds = [sel.value];
      rule.tableId = document.getElementById('rule-table-select').value;
      const seatVal = document.getElementById('rule-seat-select').value;
      rule.seatIndex = seatVal !== '' ? parseInt(seatVal) : null;
      if (!rule.guestIds[0] || !rule.tableId) { alert('Odaberi gosta i stol.'); return; }
    } else if (type === 'category-together') {
      rule.categoryId = document.getElementById('rule-cat-select').value;
      if (!rule.categoryId) { alert('Odaberi kategoriju.'); return; }
    }
    await saveRule(rule);
    document.getElementById('modal-rule').style.display = 'none';
    renderPravila();
  });
}

// ── RASPORED ──────────────────────────────────────────────────────────────────

let rasporedSearch = '';
let selectedGuestForAssign = null;

function renderRaspored() {
  renderUnassignedPanel();
  if (!floorPlanAssign) {
    const svg = document.getElementById('fp-assign-svg');
    floorPlanAssign = new FloorPlan(svg, {
      mode: 'assign',
      onSeatClick: (tableId, seatIndex, guest) => handleSeatClick(tableId, seatIndex, guest)
    });
  }
  const violated = getViolatedTableIds();
  floorPlanAssign.update(state.tables, state.guests, state.categories, violated);
}

function renderUnassignedPanel() {
  const panel = document.getElementById('unassigned-panel');
  if (!panel) return;
  let guests = state.guests.filter(g => g.status !== 'assigned' && g.status !== 'maybe');
  if (rasporedSearch) {
    const q = rasporedSearch.toLowerCase();
    guests = guests.filter(g => g.name.toLowerCase().includes(q));
  }
  guests.sort((a, b) => a.name.localeCompare(b.name));
  const count = document.getElementById('unassigned-count');
  if (count) count.textContent = `${guests.length} nedodijeljenih`;
  const list = document.getElementById('unassigned-list');
  if (!list) return;
  if (guests.length === 0) {
    list.innerHTML = '<div class="empty-state small"><p>Svi gosti su raspoređeni! 🎉</p></div>';
    return;
  }
  list.innerHTML = guests.map(g => {
    const cat = state.categories.find(c => c.id === g.categoryId);
    const isSelected = selectedGuestForAssign === g.id;
    return `<div class="guest-chip${isSelected ? ' selected' : ''}" data-id="${g.id}" style="${cat ? `--cat-color:${cat.color}` : ''}">
      ${cat ? `<span class="chip-dot" style="background:${cat.color}"></span>` : ''}
      <span>${esc(g.name)}</span>
    </div>`;
  }).join('');
  list.querySelectorAll('.guest-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedGuestForAssign = selectedGuestForAssign === chip.dataset.id ? null : chip.dataset.id;
      renderUnassignedPanel();
    });
  });
}

async function handleSeatClick(tableId, seatIndex, guest) {
  if (guest) {
    // Show options for assigned guest
    showSeatOptionsModal(tableId, seatIndex, guest);
  } else if (selectedGuestForAssign) {
    // Assign selected guest to this seat
    const existingAtSeat = state.guests.find(g => g.tableId === tableId && g.seatIndex === seatIndex);
    if (existingAtSeat) { alert('To mjesto je zauzeto.'); return; }
    await assignGuest(selectedGuestForAssign, tableId, seatIndex);
    selectedGuestForAssign = null;
    renderRaspored();
  } else {
    // No guest selected — show assign modal
    showAssignSeatModal(tableId, seatIndex);
  }
}

function showAssignSeatModal(tableId, seatIndex) {
  const modal = document.getElementById('modal-assign-seat');
  const table = state.tables.find(t => t.id === tableId);
  document.getElementById('assign-seat-label').textContent = `${(table ? table.name : undefined) || 'Stol'} — Mjesto ${seatIndex + 1}`;
  const sel = document.getElementById('assign-guest-select');
  const unassigned = state.guests.filter(g => g.status !== 'assigned' && g.status !== 'maybe');
  sel.innerHTML = '<option value="">— odaberi gosta —</option>' +
    unassigned.sort((a, b) => a.name.localeCompare(b.name)).map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  modal.dataset.tableId = tableId;
  modal.dataset.seatIndex = seatIndex;
  modal.style.display = 'flex';
}

function setupAssignSeatModal() {
  document.getElementById('btn-confirm-assign').addEventListener('click', async () => {
    const modal = document.getElementById('modal-assign-seat');
    const guestId = document.getElementById('assign-guest-select').value;
    if (!guestId) return;
    await assignGuest(guestId, modal.dataset.tableId, parseInt(modal.dataset.seatIndex));
    modal.style.display = 'none';
    renderRaspored();
  });
}

function showSeatOptionsModal(tableId, seatIndex, guest) {
  const modal = document.getElementById('modal-seat-options');
  const table = state.tables.find(t => t.id === tableId);
  document.getElementById('seat-options-label').textContent = `${esc(guest.name)} — ${(table ? table.name : undefined) || 'Stol'}, Mj. ${seatIndex + 1}`;
  document.getElementById('btn-seat-lock').textContent = guest.locked ? '🔓 Otključaj' : '🔒 Zaključaj';
  modal.dataset.guestId = guest.id;
  modal.style.display = 'flex';
}

function setupSeatOptionsModal() {
  document.getElementById('btn-seat-unassign').addEventListener('click', async () => {
    const modal = document.getElementById('modal-seat-options');
    await unassignGuest(modal.dataset.guestId);
    modal.style.display = 'none';
    renderRaspored();
  });

  document.getElementById('btn-seat-lock').addEventListener('click', async () => {
    const modal = document.getElementById('modal-seat-options');
    const guest = state.guests.find(g => g.id === modal.dataset.guestId);
    if (guest) { guest.locked = !guest.locked; await saveGuest(guest); }
    modal.style.display = 'none';
    renderRaspored();
  });

  document.getElementById('btn-seat-edit-guest').addEventListener('click', () => {
    const modal = document.getElementById('modal-seat-options');
    modal.style.display = 'none';
    openGuestModal(modal.dataset.guestId);
  });
}

function setupAutoSeating() {
  document.getElementById('btn-suggest-seating').addEventListener('click', async () => {
    lastSeatingSnapshot = state.guests.map(g => ({ ...g }));
    const result = suggestSeating(state.tables, state.guests, state.rules, state.categories);
    await applySeatingResult(result.assignments);
    showSeatingResultModal(result);
    renderRaspored();
  });
}

function showSeatingResultModal(result) {
  const modal = document.getElementById('modal-seating-result');
  const total = result.assignments.length;
  const placed = result.assignments.filter(a => a.tableId).length;
  let html = `<p><strong>${placed}/${total}</strong> gostiju raspoređeno.</p>`;
  if (result.violations.length > 0) {
    html += `<p class="text-error">⚠️ ${result.violations.length} pravilo(a) nije moglo biti zadovoljeno:</p><ul>`;
    result.violations.forEach(v => { html += `<li>${esc(v.reason)}</li>`; });
    html += '</ul>';
  } else {
    html += '<p class="text-success">✔ Sva pravila su zadovoljena.</p>';
  }
  document.getElementById('seating-result-body').innerHTML = html;
  modal.style.display = 'flex';
}

function setupSeatingResultModal() {
  document.getElementById('btn-undo-seating').addEventListener('click', async () => {
    if (!lastSeatingSnapshot) return;
    for (const g of lastSeatingSnapshot) {
      const curr = state.guests.find(x => x.id === g.id);
      if (curr) { Object.assign(curr, g); await saveGuest(curr); }
    }
    lastSeatingSnapshot = null;
    document.getElementById('modal-seating-result').style.display = 'none';
    renderRaspored();
  });
  document.getElementById('btn-close-seating-result').addEventListener('click', () => {
    document.getElementById('modal-seating-result').style.display = 'none';
  });
}

function setupRasporedSearch() {
  document.getElementById('raspored-search').addEventListener('input', e => {
    rasporedSearch = e.target.value;
    renderUnassignedPanel();
  });
  document.getElementById('btn-zoom-in-assign').addEventListener('click', () => floorPlanAssign && floorPlanAssign.zoomIn());
  document.getElementById('btn-zoom-out-assign').addEventListener('click', () => floorPlanAssign && floorPlanAssign.zoomOut());
  document.getElementById('btn-zoom-reset-assign').addEventListener('click', () => floorPlanAssign && floorPlanAssign.resetView());
}

// ── PREGLED ────────────────────────────────────────────────────────────────────

let pregledView = 'tables';
let floorPlanPreview = null;

function renderPregled() {
  // Validation banner
  const stats = getStats();
  const unassigned = stats.total - stats.assigned;
  const bannerEl = document.getElementById('pregled-validation');
  if (bannerEl) {
    if (unassigned > 0 || stats.violated > 0) {
      let msg = [];
      if (unassigned > 0) msg.push(`${unassigned} gostiju nije raspoređeno`);
      if (stats.violated > 0) msg.push(`${stats.violated} pravila su prekršena`);
      bannerEl.innerHTML = `⚠️ ${msg.join(' · ')}`;
      bannerEl.style.display = '';
    } else {
      bannerEl.style.display = 'none';
    }
  }
  renderPregledContent();
}

function renderPregledContent() {
  const container = document.getElementById('pregled-content');
  if (!container) return;
  if (pregledView === 'tables') {
    if (state.tables.length === 0) { container.innerHTML = '<div class="empty-state"><p>Nema stolova.</p></div>'; return; }
    container.innerHTML = state.tables.map(t => {
      const guests = state.guests.filter(g => g.tableId === t.id).sort((a, b) => (a.seatIndex || 0) - (b.seatIndex || 0));
      return `<div class="pregled-table-card">
        <h3 class="pregled-table-name">${esc(t.name)} <span class="muted">(${guests.length}/${t.seats})</span></h3>
        <ol class="pregled-guest-list">${guests.map(g => {
          const cat = state.categories.find(c => c.id === g.categoryId);
          return `<li>${esc(g.name)}${cat ? ` <span class="cat-chip small" style="background:${cat.color}">${esc(cat.name)}</span>` : ''}</li>`;
        }).join('')}</ol>
      </div>`;
    }).join('');
  } else if (pregledView === 'guests') {
    const sorted = [...state.guests].sort((a, b) => a.name.localeCompare(b.name));
    container.innerHTML = `<table class="pregled-table">
      <thead><tr><th>Gost</th><th>Kategorija</th><th>Stol</th><th>Status</th></tr></thead>
      <tbody>${sorted.map(g => {
        const cat = state.categories.find(c => c.id === g.categoryId);
        const table = g.tableId ? state.tables.find(t => t.id === g.tableId) : null;
        return `<tr>
          <td>${esc(g.name)}</td>
          <td>${cat ? `<span class="cat-chip" style="background:${cat.color}">${esc(cat.name)}</span>` : '—'}</td>
          <td>${table ? esc(table.name) : '—'}</td>
          <td>${g.status === 'assigned' ? '✔' : g.status === 'maybe' ? 'Možda' : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  } else if (pregledView === 'floor') {
    let svg = document.getElementById('fp-print-svg');
    if (!svg) {
      container.innerHTML = '<div class="pregled-floor-wrap"><svg id="fp-print-svg" class="floor-plan-svg"></svg></div>';
      svg = document.getElementById('fp-print-svg');
      floorPlanPreview = new FloorPlan(svg, { mode: 'assign' });
    }
    floorPlanPreview.update(state.tables, state.guests, state.categories, new Set());
  }
}

function setupPregledEvents() {
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      pregledView = btn.dataset.view;
      document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === pregledView));
      renderPregledContent();
    });
  });

  document.getElementById('btn-print').addEventListener('click', () => window.print());

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    const rows = [['Ime', 'Kategorija', 'Stol', 'Mjesto', 'Status', 'Bilješka']];
    state.guests.sort((a, b) => a.name.localeCompare(b.name)).forEach(g => {
      const catObj = state.categories.find(c => c.id === g.categoryId);
      const cat = catObj ? catObj.name : '';
      const tableObj = g.tableId ? state.tables.find(t => t.id === g.tableId) : null;
      const table = tableObj ? tableObj.name : '';
      rows.push([g.name, cat, table, g.seatIndex !== null ? g.seatIndex + 1 : '', g.status, g.notes || '']);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadFile('raspored-sjedenja.csv', 'text/csv', csv);
  });

  document.getElementById('btn-export-json').addEventListener('click', () => {
    const data = JSON.stringify({ settings: state.settings, tables: state.tables, categories: state.categories, guests: state.guests, rules: state.rules }, null, 2);
    downloadFile('raspored-sjedenja.json', 'application/json', data);
  });

  document.getElementById('btn-import-json').addEventListener('click', () => {
    document.getElementById('json-import-input').click();
  });

  document.getElementById('json-import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (confirm('Uvoz će zamijeniti sve trenutne podatke. Nastavi?')) {
        await importData(data);
        renderAll();
        navigateTo('sala');
      }
    } catch (e) {
      alert('Neispravna JSON datoteka.');
    }
    e.target.value = '';
  });
}

function downloadFile(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function nameOf(id) {
  const g = state.guests.find(x => x.id === id);
  return g ? g.name : '?';
}

function getViolatedTableIds() {
  const ids = new Set();
  for (const rule of state.rules) {
    if (rule.satisfied === false) {
      if (rule.type === 'apart' || rule.type === 'together' || rule.type === 'companion') {
        rule.guestIds.forEach(id => {
          const g = state.guests.find(x => x.id === id);
          if ((g ? g.tableId : undefined)) ids.add(g.tableId);
        });
      } else if (rule.type === 'fixed') {
        if (rule.tableId) ids.add(rule.tableId);
      } else if (rule.type === 'category-together') {
        state.guests.filter(g => g.categoryId === rule.categoryId && g.tableId).forEach(g => ids.add(g.tableId));
      }
    }
  }
  return ids;
}

// Close modals on backdrop click
function setupModalClose() {
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  });
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.modal-backdrop').style.display = 'none');
  });
}

// Mobile sala tabs
function setupSalaTabs() {
  document.querySelectorAll('.sala-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sala-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.sala-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === btn.dataset.tab));
    });
  });
}

// ── Entry point ────────────────────────────────────────────────────────────────

async function _appMain() {
  setupModalClose();
  setupTableModal();
  setupGostiEvents();
  setupGuestModal();
  setupCategoryEditModal();
  setupAddCategoryBtn();
  setupPravilaEvents();
  setupRuleModal();
  setupRasporedSearch();
  setupAssignSeatModal();
  setupSeatOptionsModal();
  setupAutoSeating();
  setupSeatingResultModal();
  setupPregledEvents();
  setupSalaTabs();
  await init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _appMain);
} else {
  _appMain();
}
