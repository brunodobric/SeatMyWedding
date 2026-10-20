
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
  if (typeof setupSync === 'function') setupSync();
  window.addEventListener('stateChange', onStateChange);
  if (!state.settings.weddingTitle) {
    showOnboarding();
  } else {
    renderAll();
    navigateTo('sala');
  }
}

const SECTIONS = ['sala', 'gosti', 'raspored'];

function renderSection(section) {
  if (section === 'sala') renderSala();
  else if (section === 'gosti') renderGosti();
  else if (section === 'raspored') renderRaspored();
}

function onStateChange(e) {
  const type = (e.detail ? e.detail.type : null);
  if (type === 'settings' || type === 'import') updateMonogram();
  refreshCurrentSection();
}

function refreshCurrentSection() {
  renderSection(currentSection);
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
  // Explicitly keep bottom nav + sidebar in sync (mobile highlight)
  document.querySelectorAll('#bottom-nav .bottom-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === section);
  });
  document.querySelectorAll('#sidebar .nav-item').forEach(el => {
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

  const nextBtn = document.getElementById('onboarding-next');
  let busy = false;
  nextBtn.addEventListener('click', async () => {
    // Ignore repeated clicks while a step is saving (would create duplicate tables).
    if (busy) return;
    busy = true;
    nextBtn.disabled = true;
    try {
      await onboardingStep();
    } finally {
      busy = false;
      nextBtn.disabled = false;
    }
  });

  async function onboardingStep() {
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
  }
}

function showOnboardingStep(step) {
  document.querySelectorAll('.ob-step').forEach(el => {
    el.style.display = parseInt(el.dataset.step) === step ? 'block' : 'none';
  });
  const btn = document.getElementById('onboarding-next');
  btn.textContent = step === 3 ? 'Počni' : 'Dalje →';
}

// ── SALA ───────────────────────────────────────────────────────────────────────

function renderSala() {
  renderCapacityBar();
  renderTableList();
  if (!floorPlanEdit) {
    const svg = document.getElementById('fp-edit-svg');
    if (svg) {
      floorPlanEdit = new FloorPlan(svg, {
        mode: 'edit',
        showFullNames: !!state.settings.showFullNames,
        onTableMove: async (table) => { await saveTable(table); },
        onTableClick: (id) => { openTableModal(id); floorPlanEdit.selectTable(id); }
      });
    }
  }
  if (floorPlanEdit) {
    floorPlanEdit.setShowFullNames(!!state.settings.showFullNames);
    const violated = getViolatedTableIds();
    floorPlanEdit.update(state.tables, state.guests, state.categories, violated);
  }
  const btnNamesSala = document.getElementById('btn-full-names-sala');
  if (btnNamesSala) btnNamesSala.classList.toggle('active', !!state.settings.showFullNames);
}

function renderCapacityBar() {
  const el = document.getElementById('capacity-bar');
  if (!el) return;
  const c = capacityInfo();
  let status;
  if (state.tables.length === 0) status = '<span class="cap-status">Još nema stolova</span>';
  else if (c.missing > 0) status = `<span class="cap-status bad">${icon('alert')} Fali ${c.missing} ${c.missing === 1 ? 'mjesto' : 'mjesta'}</span>`;
  else if (c.guests > 0) status = `<span class="cap-status ok">${icon('check')} Dovoljno mjesta${c.regularSeats - c.regularGuests > 0 ? ` (${c.regularSeats - c.regularGuests} slobodno)` : ''}</span>`;
  else status = '';
  el.innerHTML = `
    <div class="cap-numbers">
      <span><strong>${c.guests}</strong> ${c.guests === 1 ? 'gost' : 'gostiju'}</span>
      <span class="cap-dot">·</span>
      <span><strong>${c.seats}</strong> mjesta</span>
      ${status}
    </div>
    <button class="btn-primary btn-sm" id="btn-open-hall">${icon('sparkles')} ${c.missing > 0 ? 'Dodaj stolove' : state.tables.length > 1 ? 'Složi salu' : 'Složi salu automatski'}</button>`;
  document.getElementById('btn-open-hall').addEventListener('click', () => openHallModal(c.missing > 0 ? 'add' : null));
}

function templateArt(key) {
  const g = (inner) => `<svg class="tpl-art" viewBox="0 0 120 80" aria-hidden="true">${inner}</svg>`;
  const head = '<rect x="38" y="6" width="44" height="9" rx="2"/>';
  if (key === 'round') {
    let c = '';
    for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) c += `<circle cx="${18 + i * 28}" cy="${34 + r * 28}" r="9"/>`;
    return g(head + c);
  }
  if (key === 'long') {
    let c = '';
    for (let r = 0; r < 3; r++) for (let i = 0; i < 2; i++) c += `<rect x="${12 + i * 52}" y="${26 + r * 17}" width="44" height="8" rx="2"/>`;
    return g(head + c);
  }
  return g(head + '<rect x="24" y="20" width="9" height="54" rx="2"/><rect x="87" y="20" width="9" height="54" rx="2"/>');
}

let hallTemplate = 'round';

function renderHallTemplates(container, selected, onPick) {
  container.innerHTML = Object.entries(HALL_TEMPLATES).map(([key, t]) =>
    `<button type="button" class="template-card${key === selected ? ' active' : ''}" data-template="${key}">
      ${templateArt(key)}
      <strong>${t.name}</strong>
      <span>${t.hint}</span>
    </button>`).join('');
  container.querySelectorAll('[data-template]').forEach(btn => btn.addEventListener('click', () => {
    container.querySelectorAll('[data-template]').forEach(b => b.classList.toggle('active', b === btn));
    onPick(btn.dataset.template);
  }));
}

function openHallModal(mode) {
  const modal = document.getElementById('modal-hall');
  const regular = state.tables.filter(t => !isHeadTable(t));
  hallTemplate = regular.length && regular.every(t => t.shape !== 'round') ? 'long' : 'round';
  renderHallTemplates(document.getElementById('hall-templates'), hallTemplate, key => {
    hallTemplate = key;
    document.getElementById('hall-seats').value = HALL_TEMPLATES[key].defaultSeats;
    updateHallSummary();
  });
  const c = capacityInfo();
  document.getElementById('hall-guests').value = c.guests || 100;
  document.getElementById('hall-seats').value = regular.length ? regular[0].seats : HALL_TEMPLATES[hallTemplate].defaultSeats;
  const hasTables = regular.length > 0;
  document.getElementById('hall-mode').style.display = hasTables ? '' : 'none';
  document.querySelector(`input[name="hall-mode"][value="${hasTables ? (mode || 'add') : 'rebuild'}"]`).checked = true;
  updateHallSummary();
  modal.style.display = 'flex';
}

function readHallForm() {
  return {
    template: hallTemplate,
    guestCount: parseInt(document.getElementById('hall-guests').value) || 0,
    perTable: Math.max(2, parseInt(document.getElementById('hall-seats').value) || 8),
    mode: document.querySelector('input[name="hall-mode"]:checked').value
  };
}

function updateHallSummary() {
  const form = readHallForm();
  const plan = planHall(form);
  const btn = document.getElementById('btn-apply-hall');
  const el = document.getElementById('hall-summary');
  const seats = plan.create.filter(t => !isHeadTable(t)).reduce((n, t) => n + t.seats, 0);
  if (form.mode === 'add' && plan.count === 0) {
    el.innerHTML = `${icon('check')} Već imate dovoljno mjesta za ${form.guestCount} gostiju.`;
    el.className = 'hall-summary ok';
    btn.disabled = true;
    return;
  }
  const verb = form.mode === 'add' ? 'Dodat će se' : 'Trebate';
  el.innerHTML = `${verb} <strong>${plan.count} ${plan.count === 1 ? 'stol' : plan.count < 5 ? 'stola' : 'stolova'}</strong> po ${plan.perTable} mjesta (${seats} mjesta)${plan.create.some(isHeadTable) ? ' i stol mladenaca' : ''}.`;
  el.className = 'hall-summary';
  btn.disabled = plan.count === 0 && !plan.create.length;
}

function setupHallModal() {
  ['hall-guests', 'hall-seats'].forEach(id => document.getElementById(id).addEventListener('input', updateHallSummary));
  document.querySelectorAll('input[name="hall-mode"]').forEach(r => r.addEventListener('change', updateHallSummary));
  document.getElementById('btn-apply-hall').addEventListener('click', async () => {
    const form = readHallForm();
    if (form.mode === 'rebuild' && state.tables.some(t => !isHeadTable(t))) {
      const seated = state.guests.filter(g => g.tableId && !isHeadTable(state.tables.find(t => t.id === g.tableId) || {})).length;
      if (!confirm(`Složiti salu ispočetka?${seated ? ` ${seated} gostiju ostat će bez mjesta.` : ''}`)) return;
    }
    await applyHallPlan(planHall(form));
    document.getElementById('modal-hall').style.display = 'none';
    if (floorPlanEdit) floorPlanEdit.fitToContent();
    if (floorPlanAssign) floorPlanAssign._fitted = false;
    showToast('Sala je složena');
  });
}

function renderTableList() {
  const list = document.getElementById('table-list');
  if (!list) return;
  if (state.tables.length === 0) {
    list.innerHTML = `<div class="empty-state"><p>Još nema stolova.</p><button class="btn-primary" id="btn-empty-hall">${icon('sparkles')} Složi salu automatski</button></div>`;
    document.getElementById('btn-empty-hall').addEventListener('click', () => openHallModal(null));
    return;
  }
  list.innerHTML = state.tables.map(t => {
    const assigned = state.guests.filter(g => g.tableId === t.id).length;
    const shapeIcon = icon({ round: 'round', square: 'square', rectangular: 'rect', royal: 'royal', head: 'toast' }[t.shape] || 'square');
    return `<div class="table-row" data-id="${t.id}">
      <span class="table-shape-icon">${shapeIcon}</span>
      <div class="table-row-info">
        <span class="table-row-name">${esc(t.name)}</span>
        <span class="table-row-count">${assigned}/${t.seats} mjesta</span>
      </div>
      <button class="btn-icon" data-edit="${t.id}" title="Uredi">${icon('edit')}</button>
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
  document.getElementById('table-rotate-row').style.display = shape === 'round' || shape === 'square' ? 'none' : '';
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
  document.getElementById('table-rotated').checked = !!(table && table.rotation);

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
      x: existing ? existing.x : 500, y: existing ? existing.y : 350,
      rotation: shape !== 'round' && shape !== 'square' && document.getElementById('table-rotated').checked ? 90 : 0
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

  document.getElementById('btn-full-names-sala')?.addEventListener('click', () => toggleFullNames());

  document.getElementById('btn-zoom-in').addEventListener('click', () => floorPlanEdit && floorPlanEdit.zoomIn());
  document.getElementById('btn-zoom-out').addEventListener('click', () => floorPlanEdit && floorPlanEdit.zoomOut());
  document.getElementById('btn-zoom-reset').addEventListener('click', () => floorPlanEdit && floorPlanEdit.resetView());
}

async function toggleFullNames() {
  const next = !state.settings.showFullNames;
  await saveSettings({ showFullNames: next });
  if (floorPlanEdit) floorPlanEdit.setShowFullNames(next);
  if (floorPlanAssign) floorPlanAssign.setShowFullNames(next);
  document.getElementById('btn-full-names-sala')?.classList.toggle('active', next);
  document.getElementById('btn-full-names-raspored')?.classList.toggle('active', next);
}

// ── GOSTI ──────────────────────────────────────────────────────────────────────

let guestSearchQuery = '';
let guestCategoryFilter = '';
let guestViolationFilter = false;

function guestHasViolation(g) {
  return rulesForGuest(g).some(r => r.satisfied === false);
}

// One muted line under the guest's name summarizing their seating wishes.
function guestRelationLine(g) {
  const rel = getGuestRelations(g.id);
  const parts = [];
  if (rel.together.length) parts.push(`<span title="Sjedi s">${icon('together')} ${esc(rel.together.map(nameOf).join(', '))}</span>`);
  if (rel.apart.length) parts.push(`<span title="Ne sjedi s">${icon('apart')} ${esc(rel.apart.map(nameOf).join(', '))}</span>`);
  if (rel.fixed) {
    const t = state.tables.find(x => x.id === rel.fixed.tableId);
    parts.push(`<span title="Uvijek za stolom">${icon('pin')} ${esc(t ? t.name : '?')}${rel.fixed.seatIndex !== null ? `, mj. ${rel.fixed.seatIndex + 1}` : ''}</span>`);
  }
  return parts.length ? `<span class="guest-rel">${parts.join('')}</span>` : '';
}

function renderGosti() {
  renderCategoryChips();
  renderGuestList();
  document.getElementById('guest-count').textContent = `${state.guests.length} gostiju`;
  const violated = state.guests.filter(guestHasViolation).length;
  if (!violated) guestViolationFilter = false;
  const vBtn = document.getElementById('btn-filter-violated');
  vBtn.style.display = violated ? '' : 'none';
  vBtn.classList.toggle('active', guestViolationFilter);
  vBtn.innerHTML = `${icon('alert')} ${violated} ${violated === 1 ? 'gost ima neispunjen zahtjev' : 'gostiju ima neispunjen zahtjev'}`;
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
  if (guestViolationFilter) {
    guests = guests.filter(guestHasViolation);
  }
  guests.sort((a, b) => a.name.localeCompare(b.name));
  if (guests.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>Nema gostiju.</p></div>';
    return;
  }
  list.innerHTML = guests.map(g => {
    const cat = state.categories.find(c => c.id === g.categoryId);
    const table = g.tableId ? state.tables.find(t => t.id === g.tableId) : null;
    const statusLabel = g.status === 'assigned' ? `<span class="status-badge assigned">${esc((table ? table.name : undefined) || '?')}</span>`
      : g.status === 'maybe' ? '<span class="status-badge maybe">Možda</span>'
      : '<span class="status-badge unassigned">Bez mjesta</span>';
    return `<div class="guest-row${guestHasViolation(g) ? ' violated' : ''}" data-id="${g.id}">
      <div class="guest-row-main">
        <div class="guest-row-text">
          <span class="guest-name">${esc(g.name)}${guestHasViolation(g) ? ` <span class="rel-bad" title="Zahtjev nije ispunjen">${icon('alert')}</span>` : ''}</span>
          ${guestRelationLine(g)}
        </div>
        ${cat ? `<span class="cat-chip" style="background:${cat.color}">${esc(cat.name)}</span>` : ''}
      </div>
      <div class="guest-row-meta">
        ${statusLabel}
        ${g.locked ? `<span class="lock-badge">${icon('lock')}</span>` : ''}
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
    const seen = new Set(state.guests.map(g => g.name));
    const toAdd = [];
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      toAdd.push({ id: crypto.randomUUID(), name, categoryId: null, status: 'unassigned', tableId: null, seatIndex: null, locked: false, notes: '' });
    }
    await addGuests(toAdd);
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

  document.getElementById('btn-filter-violated').addEventListener('click', () => {
    guestViolationFilter = !guestViolationFilter;
    renderGosti();
  });
}

function renderCategoryManager() {
  const list = document.getElementById('category-manager-list');
  if (!list) return;
  list.innerHTML = state.categories.map((c, i) =>
    `<div class="cat-manager-row" style="--cat-color:${c.color}">
      <span class="cat-swatch" style="background:${c.color}"></span>
      <span class="cat-manager-name">${esc(c.name)}</span>
      <button class="btn-icon" data-edit-cat="${c.id}" title="Uredi">${icon('edit')}</button>
      <button class="btn-icon danger" data-del-cat="${c.id}" title="Obriši">${icon('trash')}</button>
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
  document.getElementById('cat-edit-together').checked = !!(cat && isCategoryTogether(cat.id));
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
    await setCategoryTogether(id, document.getElementById('cat-edit-together').checked);
    modal.style.display = 'none';
    renderCategoryManager();
    renderGosti();
  });
}

function setupAddCategoryBtn() {
  document.getElementById('btn-add-category').addEventListener('click', () => openCategoryEditModal(null));
}

// Chip-style multi-select of guests with type-ahead search.
class PeoplePicker {
  constructor(el, options = {}) {
    this.el = el;
    this.exclude = options.exclude || (() => []);
    this.onChange = options.onChange || (() => {});
    this.value = [];
    el.innerHTML = `<div class="pp-box"><span class="pp-chips"></span><input class="pp-input" type="text" autocomplete="off" placeholder="${esc(el.dataset.placeholder || 'Dodaj…')}"></div><div class="pp-suggest"></div>`;
    this.chips = el.querySelector('.pp-chips');
    this.input = el.querySelector('.pp-input');
    this.suggest = el.querySelector('.pp-suggest');
    el.querySelector('.pp-box').addEventListener('click', () => this.input.focus());
    this.input.addEventListener('input', () => this.renderSuggest());
    this.input.addEventListener('focus', () => this.renderSuggest());
    this.input.addEventListener('blur', () => setTimeout(() => { this.suggest.innerHTML = ''; }, 150));
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !this.input.value && this.value.length) {
        this.value.pop(); this.render(); this.onChange();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const first = this.suggest.querySelector('[data-pick]');
        if (first) this.add(first.dataset.pick);
      }
    });
  }

  setValue(ids) { this.value = [...ids]; this.input.value = ''; this.render(); }
  getValue() { return [...this.value]; }

  add(id) {
    if (!this.value.includes(id)) this.value.push(id);
    this.input.value = '';
    this.render();
    this.renderSuggest();
    this.onChange();
  }

  render() {
    this.chips.innerHTML = this.value.map(id =>
      `<span class="pp-chip">${esc(nameOf(id))}<button type="button" data-remove="${id}" aria-label="Ukloni">${icon('x')}</button></span>`
    ).join('');
    this.chips.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      this.value = this.value.filter(id => id !== btn.dataset.remove);
      this.render();
      this.onChange();
    }));
  }

  renderSuggest() {
    const q = this.input.value.trim().toLowerCase();
    const skip = new Set([...this.value, ...this.exclude()]);
    const matches = state.guests
      .filter(g => !skip.has(g.id) && (!q || g.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 6);
    if (document.activeElement !== this.input || matches.length === 0) { this.suggest.innerHTML = ''; return; }
    this.suggest.innerHTML = matches.map(g => {
      const cat = state.categories.find(c => c.id === g.categoryId);
      return `<button type="button" class="pp-option" data-pick="${g.id}">${cat ? `<span class="chip-dot" style="background:${cat.color}"></span>` : ''}${esc(g.name)}</button>`;
    }).join('');
    this.suggest.querySelectorAll('[data-pick]').forEach(btn => {
      btn.addEventListener('mousedown', e => e.preventDefault()); // keep focus in the input
      btn.addEventListener('click', () => this.add(btn.dataset.pick));
    });
  }
}

let ppTogether = null;
let ppApart = null;

function fillFixedSeatOptions(tableId, selected) {
  const table = state.tables.find(t => t.id === tableId);
  const seatSel = document.getElementById('guest-edit-fixed-seat');
  seatSel.innerHTML = '<option value="">bilo koje mjesto</option>' +
    (table ? Array.from({ length: table.seats }, (_, i) => `<option value="${i}"${selected === i ? ' selected' : ''}>Mjesto ${i + 1}</option>`).join('') : '');
  seatSel.disabled = !table;
}

function openGuestModal(id) {
  const guest = id ? state.guests.find(g => g.id === id) : null;
  const modal = document.getElementById('modal-guest');
  document.getElementById('modal-guest-title').textContent = guest ? 'Uredi gosta' : 'Dodaj gosta';
  document.getElementById('guest-edit-name').value = (guest ? guest.name : undefined) || '';
  document.getElementById('guest-edit-notes').value = (guest ? guest.notes : undefined) || '';
  document.getElementById('guest-edit-locked').checked = (guest ? guest.locked : undefined) || false;
  document.getElementById('guest-edit-maybe').checked = !!(guest && guest.status === 'maybe');

  const catSel = document.getElementById('guest-edit-category');
  catSel.innerHTML = '<option value="">— bez kategorije —</option>' +
    state.categories.map(c => `<option value="${c.id}"${(guest ? guest.categoryId : undefined) === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('');

  const rel = guest ? getGuestRelations(guest.id) : { together: [], apart: [], fixed: null };
  ppTogether.setValue(rel.together);
  ppApart.setValue(rel.apart);
  const fixedTableId = rel.fixed ? rel.fixed.tableId : '';
  document.getElementById('guest-edit-fixed-table').innerHTML = '<option value="">— bilo koji —</option>' +
    state.tables.map(t => `<option value="${t.id}"${t.id === fixedTableId ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
  fillFixedSeatOptions(fixedTableId, rel.fixed ? rel.fixed.seatIndex : null);

  document.getElementById('btn-delete-guest').style.display = guest ? '' : 'none';
  modal.dataset.editId = id || '';
  modal.style.display = 'flex';
}

function setupGuestModal() {
  // A person can't be in both lists: picking them in one hides them in the other.
  ppTogether = new PeoplePicker(document.getElementById('pp-together'), {
    exclude: () => [document.getElementById('modal-guest').dataset.editId, ...ppApart.getValue()]
  });
  ppApart = new PeoplePicker(document.getElementById('pp-apart'), {
    exclude: () => [document.getElementById('modal-guest').dataset.editId, ...ppTogether.getValue()]
  });
  document.getElementById('guest-edit-fixed-table').addEventListener('change', e => fillFixedSeatOptions(e.target.value, null));

  document.getElementById('btn-save-guest').addEventListener('click', async () => {
    const modal = document.getElementById('modal-guest');
    const id = modal.dataset.editId || crypto.randomUUID();
    const existing = state.guests.find(g => g.id === id);
    const name = document.getElementById('guest-edit-name').value.trim();
    if (!name) return;
    const catId = document.getElementById('guest-edit-category').value || null;
    const maybe = document.getElementById('guest-edit-maybe').checked;
    const locked = document.getElementById('guest-edit-locked').checked;
    const notes = document.getElementById('guest-edit-notes').value.trim();
    const guest = {
      id, name, categoryId: catId,
      tableId: (existing && existing.tableId) || null,
      seatIndex: (existing && existing.seatIndex != null) ? existing.seatIndex : null,
      locked, notes
    };
    // An unconfirmed guest gives up their seat.
    if (maybe) { guest.tableId = null; guest.seatIndex = null; }
    guest.status = maybe ? 'maybe' : guest.tableId ? 'assigned' : 'unassigned';
    await saveGuest(guest);
    const seatVal = document.getElementById('guest-edit-fixed-seat').value;
    await setGuestRelations(id, {
      together: ppTogether.getValue(),
      apart: ppApart.getValue(),
      fixedTableId: document.getElementById('guest-edit-fixed-table').value || null,
      fixedSeat: seatVal !== '' ? parseInt(seatVal) : null
    });
    modal.style.display = 'none';
    refreshCurrentSection();
  });

  document.getElementById('btn-delete-guest').addEventListener('click', async () => {
    const modal = document.getElementById('modal-guest');
    const id = modal.dataset.editId;
    if (!id) return;
    const g = state.guests.find(x => x.id === id);
    if (confirm(`Obrisati gosta ${g ? g.name : ''}?`)) {
      await deleteGuest(id);
      modal.style.display = 'none';
      refreshCurrentSection();
    }
  });
}

// ── RASPORED (dodjela + pregled + izvoz) ─────────────────────────────────────

let rasporedSearch = '';
let rasporedView = 'floor';
let selectedGuestForAssign = null;

function renderRaspored() {
  document.querySelector('.raspored-layout').dataset.view = rasporedView;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === rasporedView));
  renderSeatingProgress();
  renderUnassignedPanel();
  if (rasporedView === 'floor') {
    if (!floorPlanAssign) {
      const svg = document.getElementById('fp-assign-svg');
      floorPlanAssign = new FloorPlan(svg, {
        mode: 'assign',
        showFullNames: !!state.settings.showFullNames,
        onSeatClick: (tableId, seatIndex, guest) => handleSeatClick(tableId, seatIndex, guest)
      });
    }
    floorPlanAssign.setShowFullNames(!!state.settings.showFullNames);
    floorPlanAssign.update(state.tables, state.guests, state.categories, getViolatedTableIds());
    document.getElementById('btn-full-names-raspored').classList.toggle('active', !!state.settings.showFullNames);
  } else if (rasporedView === 'tables') {
    renderTablesView();  // replaces the guests-view skeleton, if any
  } else {
    renderGuestsView();
  }
}

function renderSeatingProgress() {
  const el = document.getElementById('seating-progress');
  if (!el) return;
  const stats = getStats();
  const unseated = stats.total - stats.assigned;
  const maybe = state.guests.filter(g => g.status === 'maybe').length;
  const pct = stats.total ? Math.round(stats.assigned / stats.total * 100) : 0;
  const notes = [];
  if (unseated > 0) notes.push(`<button class="progress-link" data-progress="unseated">${unseated} bez mjesta</button>`);
  if (stats.violated > 0) notes.push(`<button class="progress-link bad" data-progress="violated">${icon('alert')} ${stats.violated} ${stats.violated === 1 ? 'neispunjen zahtjev' : 'neispunjenih zahtjeva'}</button>`);
  const cap = capacityInfo();
  if (cap.missing > 0) notes.push(`<button class="progress-link bad" data-progress="capacity">${icon('alert')} fali ${cap.missing} mjesta</button>`);
  if (maybe > 0) notes.push(`<span class="progress-note">${maybe} možda</span>`);
  if (stats.total > 0 && unseated === 0 && stats.violated === 0) notes.push(`<span class="progress-note ok">${icon('check')} Svi su smješteni</span>`);
  el.innerHTML = `
    <div class="progress-label"><strong>${stats.assigned}</strong> od ${stats.total} gostiju smješteno</div>
    <div class="progress-track"><div class="progress-fill${pct === 100 ? ' done' : ''}" style="width:${pct}%"></div></div>
    <div class="progress-notes">${notes.join('')}</div>`;
  el.querySelectorAll('[data-progress]').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.progress === 'violated') {
      guestViolationFilter = true;
      navigateTo('gosti');
    } else if (btn.dataset.progress === 'capacity') {
      navigateTo('sala');
      openHallModal('add');
    } else {
      const panel = document.getElementById('unassigned-panel');
      if (rasporedView === 'guests') { rasporedView = 'floor'; renderRaspored(); }
      panel.scrollIntoView({ block: 'nearest' });
      panel.classList.remove('flash');
      void panel.offsetWidth;
      panel.classList.add('flash');
    }
  }));
}

function unseatedGuests() {
  return state.guests.filter(g => g.status !== 'assigned' && g.status !== 'maybe');
}

function renderUnassignedPanel() {
  const panel = document.getElementById('unassigned-panel');
  if (!panel) return;
  const all = unseatedGuests();
  if (selectedGuestForAssign && !all.some(g => g.id === selectedGuestForAssign)) selectedGuestForAssign = null;
  let guests = all;
  if (rasporedSearch) {
    const q = rasporedSearch.toLowerCase();
    guests = guests.filter(g => g.name.toLowerCase().includes(q));
  }
  guests.sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('unassigned-count').textContent = all.length ? `(${all.length})` : '';
  document.getElementById('unassigned-hint').textContent = selectedGuestForAssign
    ? `Odaberi slobodno mjesto za: ${nameOf(selectedGuestForAssign)}`
    : all.length ? 'Dodirni gosta pa slobodno mjesto.' : '';
  const list = document.getElementById('unassigned-list');
  panel.classList.toggle('all-seated', all.length === 0);
  if (guests.length === 0) {
    list.innerHTML = `<div class="empty-state small"><p>${all.length ? 'Nema rezultata.' : 'Svi gosti imaju mjesto.'}</p></div>`;
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
      if (rasporedView === 'tables') renderTablesView();
    });
  });
}

function firstFreeSeat(table) {
  const taken = new Set(state.guests.filter(g => g.tableId === table.id).map(g => g.seatIndex));
  for (let i = 0; i < table.seats; i++) if (!taken.has(i)) return i;
  return -1;
}

function renderTablesView() {
  const container = document.getElementById('raspored-list');
  if (state.tables.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Još nema stolova. Dodaj ih u Sali.</p></div>';
    return;
  }
  const violated = getViolatedTableIds();
  container.innerHTML = `<div class="table-cards">${state.tables.map(t => {
    const guests = state.guests.filter(g => g.tableId === t.id).sort((a, b) => (a.seatIndex || 0) - (b.seatIndex || 0));
    const free = t.seats - guests.length;
    const addBtn = free > 0
      ? `<button class="table-card-add${selectedGuestForAssign ? ' ready' : ''}" data-add="${t.id}">${icon('plus')} ${selectedGuestForAssign ? `Smjesti ${esc(nameOf(selectedGuestForAssign))} ovdje` : 'Dodaj gosta'}</button>`
      : '';
    return `<div class="table-card${violated.has(t.id) ? ' violated' : ''}">
      <div class="table-card-head">
        <h3>${esc(t.name)}</h3>
        <span class="table-card-count${free === 0 ? ' full' : ''}">${guests.length}/${t.seats}</span>
      </div>
      <ol class="table-card-guests">${guests.map(g => {
        const cat = state.categories.find(c => c.id === g.categoryId);
        return `<li data-guest="${g.id}" data-table="${t.id}" data-seat="${g.seatIndex}">
          <span class="seat-no">${(g.seatIndex || 0) + 1}</span>
          ${cat ? `<span class="chip-dot" style="background:${cat.color}"></span>` : ''}
          <span class="table-card-name">${esc(g.name)}</span>
          ${g.locked ? `<span class="lock-badge">${icon('lock')}</span>` : ''}
        </li>`;
      }).join('')}</ol>
      ${addBtn}
    </div>`;
  }).join('')}</div>`;
  container.querySelectorAll('[data-guest]').forEach(li => li.addEventListener('click', () => {
    const g = state.guests.find(x => x.id === li.dataset.guest);
    if (g) showSeatOptionsModal(li.dataset.table, parseInt(li.dataset.seat), g);
  }));
  container.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', async () => {
    const table = state.tables.find(t => t.id === btn.dataset.add);
    const seat = firstFreeSeat(table);
    if (seat < 0) return;
    if (selectedGuestForAssign) {
      await assignGuest(selectedGuestForAssign, table.id, seat);
      selectedGuestForAssign = null;
    } else {
      showAssignSeatModal(table.id, seat);
    }
  }));
}

function renderGuestsView() {
  const container = document.getElementById('raspored-list');
  if (!document.getElementById('guests-view-search')) {
    container.innerHTML = `<input id="guests-view-search" class="form-control guests-view-search" type="search" placeholder="Pretraži goste...">
      <div id="guests-view-table"></div>`;
    document.getElementById('guests-view-search').addEventListener('input', e => {
      rasporedSearch = e.target.value;
      document.getElementById('raspored-search').value = rasporedSearch;
      renderGuestsView();
    });
  }
  document.getElementById('guests-view-search').value = rasporedSearch;
  const wrap = document.getElementById('guests-view-table');
  let guests = [...state.guests];
  if (rasporedSearch) {
    const q = rasporedSearch.toLowerCase();
    guests = guests.filter(g => g.name.toLowerCase().includes(q));
  }
  guests.sort((a, b) => a.name.localeCompare(b.name));
  if (guests.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><p>Nema gostiju.</p></div>';
    return;
  }
  const used = {};
  state.guests.forEach(g => { if (g.tableId) used[g.tableId] = (used[g.tableId] || 0) + 1; });
  wrap.innerHTML = `<table class="pregled-table">
    <thead><tr><th>Gost</th><th class="hide-sm">Kategorija</th><th>Stol</th></tr></thead>
    <tbody>${guests.map(g => {
      const cat = state.categories.find(c => c.id === g.categoryId);
      const select = g.status === 'maybe'
        ? '<span class="status-badge maybe">Možda</span>'
        : `<select class="form-control table-select" data-guest="${g.id}">
            <option value="">— bez mjesta —</option>
            ${state.tables.map(t => {
              const left = t.seats - (used[t.id] || 0);
              const mine = g.tableId === t.id;
              return `<option value="${t.id}"${mine ? ' selected' : ''}${!mine && left <= 0 ? ' disabled' : ''}>${esc(t.name)}${mine ? '' : ` (${left} slob.)`}</option>`;
            }).join('')}
          </select>`;
      return `<tr>
        <td>${cat ? `<span class="chip-dot" style="background:${cat.color}"></span> ` : ''}${esc(g.name)}${g.locked ? ` <span class="lock-badge">${icon('lock')}</span>` : ''}</td>
        <td class="hide-sm">${cat ? `<span class="cat-chip" style="background:${cat.color}">${esc(cat.name)}</span>` : '—'}</td>
        <td>${select}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
  wrap.querySelectorAll('.table-select').forEach(sel => sel.addEventListener('change', async () => {
    const tableId = sel.value;
    if (!tableId) { await unassignGuest(sel.dataset.guest); return; }
    const seat = firstFreeSeat(state.tables.find(t => t.id === tableId));
    if (seat < 0) { alert('Za tim stolom više nema mjesta.'); renderGuestsView(); return; }
    await assignGuest(sel.dataset.guest, tableId, seat);
  }));
}

async function handleSeatClick(tableId, seatIndex, guest) {
  if (guest) {
    showSeatOptionsModal(tableId, seatIndex, guest);
  } else if (selectedGuestForAssign) {
    const existingAtSeat = state.guests.find(g => g.tableId === tableId && g.seatIndex === seatIndex);
    if (existingAtSeat) { alert('To mjesto je zauzeto.'); return; }
    const id = selectedGuestForAssign;
    selectedGuestForAssign = null;
    await assignGuest(id, tableId, seatIndex);
  } else {
    showAssignSeatModal(tableId, seatIndex);
  }
}

function showAssignSeatModal(tableId, seatIndex) {
  const modal = document.getElementById('modal-assign-seat');
  const table = state.tables.find(t => t.id === tableId);
  document.getElementById('assign-seat-label').textContent = `${(table ? table.name : undefined) || 'Stol'} — Mjesto ${seatIndex + 1}`;
  const sel = document.getElementById('assign-guest-select');
  sel.innerHTML = '<option value="">— odaberi gosta —</option>' +
    unseatedGuests().sort((a, b) => a.name.localeCompare(b.name)).map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  modal.dataset.tableId = tableId;
  modal.dataset.seatIndex = seatIndex;
  modal.style.display = 'flex';
}

function setupAssignSeatModal() {
  document.getElementById('btn-confirm-assign').addEventListener('click', async () => {
    const modal = document.getElementById('modal-assign-seat');
    const guestId = document.getElementById('assign-guest-select').value;
    if (!guestId) return;
    modal.style.display = 'none';
    await assignGuest(guestId, modal.dataset.tableId, parseInt(modal.dataset.seatIndex));
  });
}

function showSeatOptionsModal(tableId, seatIndex, guest) {
  const modal = document.getElementById('modal-seat-options');
  const table = state.tables.find(t => t.id === tableId);
  document.getElementById('seat-options-label').textContent = `${guest.name} — ${(table ? table.name : undefined) || 'Stol'}, Mj. ${seatIndex + 1}`;
  document.getElementById('btn-seat-lock').innerHTML = guest.locked ? `${icon('unlock')} Otključaj` : `${icon('lock')} Zaključaj`;
  modal.dataset.guestId = guest.id;
  modal.style.display = 'flex';
}

function setupSeatOptionsModal() {
  document.getElementById('btn-seat-unassign').addEventListener('click', async () => {
    const modal = document.getElementById('modal-seat-options');
    modal.style.display = 'none';
    await unassignGuest(modal.dataset.guestId);
  });

  document.getElementById('btn-seat-lock').addEventListener('click', async () => {
    const modal = document.getElementById('modal-seat-options');
    modal.style.display = 'none';
    const guest = state.guests.find(g => g.id === modal.dataset.guestId);
    if (guest) { guest.locked = !guest.locked; await saveGuest(guest); }
  });

  document.getElementById('btn-seat-edit-guest').addEventListener('click', () => {
    const modal = document.getElementById('modal-seat-options');
    modal.style.display = 'none';
    openGuestModal(modal.dataset.guestId);
  });
}

function setupAutoSeating() {
  document.getElementById('btn-suggest-seating').addEventListener('click', async () => {
    if (state.tables.length === 0) { alert('Najprije dodaj stolove u Sali.'); return; }
    lastSeatingSnapshot = state.guests.map(g => ({ ...g }));
    const result = suggestSeating(state.tables, state.guests, state.rules, state.categories);
    await applySeatingResult(result.assignments);
    showSeatingResultModal(result);
  });
}

function showSeatingResultModal(result) {
  const modal = document.getElementById('modal-seating-result');
  const total = result.assignments.length;
  const placed = result.assignments.filter(a => a.tableId).length;
  let html = `<p><strong>${placed}/${total}</strong> gostiju raspoređeno.</p>`;
  if (placed < total) html += `<p class="muted">Za ${total - placed} gostiju nema dovoljno mjesta. Dodaj stolove u Sali.</p>`;
  if (result.violations.length > 0) {
    html += `<p class="text-error">${icon('alert')} ${result.violations.length} zahtjev(a) nije moguće ispuniti:</p><ul>`;
    result.violations.forEach(v => { html += `<li>${esc(v.reason)}</li>`; });
    html += '</ul>';
  } else {
    html += `<p class="text-success">${icon('check')} Svi posebni zahtjevi su ispunjeni.</p>`;
  }
  document.getElementById('seating-result-body').innerHTML = html;
  modal.style.display = 'flex';
}

function setupSeatingResultModal() {
  document.getElementById('btn-undo-seating').addEventListener('click', async () => {
    if (!lastSeatingSnapshot) return;
    document.getElementById('modal-seating-result').style.display = 'none';
    await restoreGuests(lastSeatingSnapshot);
    lastSeatingSnapshot = null;
  });
  document.getElementById('btn-close-seating-result').addEventListener('click', () => {
    document.getElementById('modal-seating-result').style.display = 'none';
  });
}

function setupRasporedEvents() {
  document.getElementById('raspored-search').addEventListener('input', e => {
    rasporedSearch = e.target.value;
    renderUnassignedPanel();
  });
  document.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => {
    rasporedView = btn.dataset.view;
    renderRaspored();
  }));
  document.getElementById('btn-full-names-raspored').addEventListener('click', () => toggleFullNames());
  document.getElementById('btn-zoom-in-assign').addEventListener('click', () => floorPlanAssign && floorPlanAssign.zoomIn());
  document.getElementById('btn-zoom-out-assign').addEventListener('click', () => floorPlanAssign && floorPlanAssign.zoomOut());
  document.getElementById('btn-zoom-reset-assign').addEventListener('click', () => floorPlanAssign && floorPlanAssign.resetView());

  const menuBtn = document.getElementById('btn-export-menu');
  const menu = document.getElementById('export-menu');
  menuBtn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', () => { menu.hidden = true; });

  document.getElementById('btn-print').addEventListener('click', () => window.print());

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    const rows = [['Ime', 'Kategorija', 'Stol', 'Mjesto', 'Status', 'Bilješka']];
    const statusLabels = { assigned: 'Dodijeljen', unassigned: 'Nedodijeljen', maybe: 'Možda' };
    [...state.guests].sort((a, b) => a.name.localeCompare(b.name)).forEach(g => {
      const catObj = state.categories.find(c => c.id === g.categoryId);
      const cat = catObj ? catObj.name : '';
      const tableObj = g.tableId ? state.tables.find(t => t.id === g.tableId) : null;
      const table = tableObj ? tableObj.name : '';
      rows.push([g.name, cat, table, g.tableId && g.seatIndex != null ? g.seatIndex + 1 : '', statusLabels[g.status] || g.status || '', g.notes || '']);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    // BOM so Excel opens the UTF-8 file with č/ć/š/ž intact.
    downloadFile('raspored-sjedenja.csv', 'text/csv;charset=utf-8', '﻿' + csv);
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
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking right away can cancel the download in Safari/Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      renderSala();
    });
  });
}

// ── Entry point ────────────────────────────────────────────────────────────────

async function _appMain() {
  setupModalClose();
  setupTableModal();
  setupHallModal();
  setupGostiEvents();
  setupGuestModal();
  setupCategoryEditModal();
  setupAddCategoryBtn();
  setupRasporedEvents();
  setupAssignSeatModal();
  setupSeatOptionsModal();
  setupAutoSeating();
  setupSeatingResultModal();
  setupSalaTabs();
  await init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _appMain);
} else {
  _appMain();
}
