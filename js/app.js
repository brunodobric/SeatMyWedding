
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
    setupAppUpdates();
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
  if (typeof splash !== 'undefined') splash.ready();
}

const SECTIONS = ['sala', 'gosti', 'raspored'];

function renderSection(section) {
  if (section === 'sala') renderSala();
  else if (section === 'gosti') renderGosti();
  else if (section === 'raspored') renderRaspored();
}

// A new deploy installs in the background; the open page keeps its version
// until the user chooses to reload, so old and new files never mix.
function setupAppUpdates() {
  // Reload only after the user asked for the new version (the first install
  // also changes the controller, and that must not reload the page).
  let reloadOnChange = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadOnChange) return;
    reloadOnChange = false;
    location.reload();
  });
  const offer = worker => {
    showToast('Dostupna je nova verzija aplikacije', false, {
      label: 'Osvježi',
      duration: 0,
      onClick: () => { reloadOnChange = true; worker.postMessage('SKIP_WAITING'); }
    });
  };
  navigator.serviceWorker.register('./sw.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 60 * 60 * 1000);
  }).catch(() => {});
}

function onStateChange(e) {
  const type = (e.detail ? e.detail.type : null);
  if (type === 'settings' || type === 'import') updateMonogram();
  refreshCurrentSection();
}

function refreshCurrentSection() {
  renderSection(currentSection);
  updateHeader();
  renderGuide();
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
  renderGuide();
  renderOptions();
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
  // The default heart is a drawn icon: the ♡ character comes from a different
  // fallback font on each device and never sits in the middle of the circle.
  document.querySelectorAll('.monogram-text').forEach(el => {
    if (m === '♡') el.innerHTML = '<svg class="ic monogram-heart" aria-hidden="true"><use href="#i-heart"/></svg>';
    else el.textContent = m;
  });
}

// ── Opcije ─────────────────────────────────────────────────────────────────────
// One menu on every screen: account, wedding & view, data, and what belongs to
// the current screen (incl. the destructive "start over" actions, all undoable).

function openOptions() {
  renderOptions();
  const panel = document.getElementById('options-panel');
  panel.hidden = false;
  document.getElementById('btn-options').setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => panel.classList.add('open'));
}

function closeOptions() {
  const panel = document.getElementById('options-panel');
  if (panel.hidden) return;
  panel.classList.remove('open');
  document.getElementById('btn-options').setAttribute('aria-expanded', 'false');
  panel.hidden = true;
}

const SCREEN_OPTIONS = {
  sala: () => [
    { id: 'hall', icon: 'sparkles', label: 'Složi salu', run: () => openHallModal(null) },
    { id: 'start-over', icon: 'undo', label: 'Kreni ispočetka', danger: true, run: startOver }
  ],
  gosti: () => [
    { id: 'categories', icon: 'palette', label: 'Kategorije', run: openCategoryManager },
    { id: 'delete-guests', icon: 'trash', label: 'Obriši sve goste', danger: true, disabled: !state.guests.length, run: deleteAllGuestsConfirmed }
  ],
  raspored: () => [
    { id: 'unseat-all', icon: 'user-x', label: 'Makni sve goste sa stolova', danger: true,
      disabled: !state.guests.some(g => g.tableId && !g.locked), run: unseatAllConfirmed }
  ]
};
const SCREEN_NAMES = { sala: 'Sala', gosti: 'Gosti', raspored: 'Raspored' };

function renderOptions() {
  const names = document.getElementById('opt-full-names');
  if (!names) return;
  names.setAttribute('aria-checked', String(!!state.settings.showFullNames));
  document.getElementById('opt-guide').hidden = !state.settings.guideDismissed;
  const items = (SCREEN_OPTIONS[currentSection] || (() => []))();
  const box = document.getElementById('options-screen');
  box.innerHTML = `<div class="options-title">${SCREEN_NAMES[currentSection] || ''}</div>` + items.map(it =>
    `<button class="menu-item${it.danger ? ' danger' : ''}" data-screen-opt="${it.id}"${it.disabled ? ' disabled' : ''}>${icon(it.icon)} ${it.label}</button>`
  ).join('');
  box.querySelectorAll('[data-screen-opt]').forEach(btn => btn.addEventListener('click', () => {
    const it = items.find(x => x.id === btn.dataset.screenOpt);
    closeOptions();
    it.run();
  }));
}

function setupOptions() {
  document.getElementById('btn-options').addEventListener('click', e => {
    e.stopPropagation();
    if (document.getElementById('options-panel').hidden) openOptions(); else closeOptions();
  });
  document.getElementById('btn-options-close').addEventListener('click', closeOptions);
  // Click outside the sheet (the dimmed backdrop on phones) closes it.
  document.getElementById('options-panel').addEventListener('click', e => { if (e.target.id === 'options-panel') closeOptions(); });
  document.addEventListener('click', e => {
    if (!e.target.closest('#options-panel, #btn-options')) closeOptions();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOptions(); });
  ['btn-login', 'btn-export-json', 'btn-export-csv'].forEach(id =>
    document.getElementById(id).addEventListener('click', closeOptions));

  document.getElementById('opt-full-names').addEventListener('click', () => toggleFullNames());
  document.getElementById('opt-guide').addEventListener('click', async () => {
    closeOptions();
    await saveSettings({ guideDismissed: false });
    renderGuide();
  });
  document.getElementById('opt-wedding').addEventListener('click', () => {
    closeOptions();
    document.getElementById('wedding-edit-title').value = state.settings.weddingTitle || '';
    document.getElementById('wedding-edit-monogram').value = state.settings.monogram || '';
    document.getElementById('modal-wedding').style.display = 'flex';
    document.getElementById('wedding-edit-title').focus();
  });
  document.getElementById('btn-save-wedding').addEventListener('click', async () => {
    await saveSettings({
      weddingTitle: document.getElementById('wedding-edit-title').value.trim() || 'Moje Vjenčanje',
      monogram: document.getElementById('wedding-edit-monogram').value.trim() || '♡'
    });
    document.getElementById('modal-wedding').style.display = 'none';
    updateHeader();
    updateMonogram();
  });
}

function openCategoryManager() {
  renderCategoryManager();
  document.getElementById('modal-categories').style.display = 'flex';
}

const guestCountLabel = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'gost' : 'gostiju'}`;

async function deleteAllGuestsConfirmed() {
  const n = state.guests.length;
  if (!n || !confirm(`Obrisati sve goste (${guestCountLabel(n)})? Brišu se i njihova mjesta i želje. Stolovi i kategorije ostaju.`)) return;
  await withUndo(`Obrisano: ${guestCountLabel(n)}`, () => deleteAllGuests());
}

async function unseatAllConfirmed() {
  const seated = state.guests.filter(g => g.tableId && !g.locked);
  const locked = state.guests.filter(g => g.tableId && g.locked).length;
  if (!seated.length || !confirm(`Maknuti ${guestCountLabel(seated.length)} sa stolova?${locked ? ` Zaključana mjesta (${locked}) ostaju.` : ''}`)) return;
  await withUndo(`${guestCountLabel(seated.length)} je bez mjesta`,
    () => placeGuests(seated.map(g => ({ id: g.id, tableId: null, seatIndex: null }))));
}

async function startOver() {
  if (!confirm('Krenuti ispočetka? Brišu se svi gosti, stolovi, kategorije i naslov, i otvaraju se uvodni koraci.')) return;
  const settings = { ...state.settings };
  await withUndo('Sve je obrisano', () => clearWeddingData(), {
    onUndo: async () => {
      await saveSettings({ weddingTitle: settings.weddingTitle, monogram: settings.monogram, guideDismissed: settings.guideDismissed });
      document.getElementById('modal-onboarding').style.display = 'none';
      updateHeader();
      updateMonogram();
      renderAll();
      navigateTo('sala');
    }
  });
  updateHeader();
  updateMonogram();
  renderAll();
  navigateTo('sala');
  showOnboarding();
}

// ── Onboarding ─────────────────────────────────────────────────────────────────

let resetOnboarding = null;

function showOnboarding() {
  // Set up once; "Kreni ispočetka" opens it again from the first step.
  if (resetOnboarding) { resetOnboarding(); return; }
  const modal = document.getElementById('modal-onboarding');
  modal.style.display = 'flex';
  let step = 1;
  let template = 'round';
  showOnboardingStep(step);

  const summary = () => {
    const guests = parseInt(document.getElementById('ob-guests').value) || 0;
    const perTable = Math.max(2, parseInt(document.getElementById('ob-seats').value) || 8);
    const n = tablesNeeded(guests, perTable);
    document.getElementById('ob-summary').innerHTML =
      `Složit ćemo <strong>${n} ${n === 1 ? 'stol' : n > 1 && n < 5 ? 'stola' : 'stolova'}</strong> po ${perTable} mjesta i stol mladenaca.`;
  };
  renderHallTemplates(document.getElementById('ob-templates'), template, key => {
    template = key;
    document.getElementById('ob-seats').value = HALL_TEMPLATES[key].defaultSeats;
    summary();
  });
  ['ob-guests', 'ob-seats'].forEach(id => document.getElementById(id).addEventListener('input', summary));
  summary();

  const listEl = document.getElementById('ob-guest-list');
  listEl.addEventListener('input', () => {
    const p = previewGuestImport(parseGuestText(listEl.value, { surnameFirst: detectSurnameFirst(listEl.value) }));
    document.getElementById('ob-guest-preview').innerHTML = p.guests
      ? `<p><strong>${p.guests}</strong> ${p.guests === 1 ? 'gost' : 'gostiju'}${p.groups ? ` · ${p.groups} ${p.groups === 1 ? 'par ili obitelj' : 'parova i obitelji'} sjedi zajedno` : ''}</p>`
      : '';
  });

  const nextBtn = document.getElementById('onboarding-next');
  let busy = false;
  const run = async (skip) => {
    // Ignore repeated clicks while a step is saving (would create duplicate tables).
    if (busy) return;
    busy = true;
    nextBtn.disabled = true;
    try {
      await onboardingStep(skip);
    } finally {
      busy = false;
      nextBtn.disabled = false;
    }
  };
  nextBtn.addEventListener('click', () => run(false));
  document.getElementById('onboarding-skip').addEventListener('click', () => run(true));

  resetOnboarding = () => {
    step = 1;
    template = 'round';
    ['ob-title', 'ob-monogram', 'ob-guest-list'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('ob-guests').value = 100;
    document.getElementById('ob-seats').value = HALL_TEMPLATES.round.defaultSeats;
    document.getElementById('ob-guest-preview').innerHTML = '';
    renderHallTemplates(document.getElementById('ob-templates'), template, key => {
      template = key;
      document.getElementById('ob-seats').value = HALL_TEMPLATES[key].defaultSeats;
      summary();
    });
    summary();
    showOnboardingStep(step);
    modal.style.display = 'flex';
  };

  async function onboardingStep(skip) {
    if (step === 1) {
      const title = document.getElementById('ob-title').value.trim() || 'Moje Vjenčanje';
      const monogram = document.getElementById('ob-monogram').value.trim() || '♡';
      await saveSettings({ weddingTitle: title, monogram });
      step = 2;
      showOnboardingStep(step);
    } else if (step === 2) {
      // Default bridal-party categories — auto-seated at the bridal table.
      await saveCategory({ id: crypto.randomUUID(), name: 'Mladenci', color: '#7A8FA6', atHeadTable: true });
      await saveCategory({ id: crypto.randomUUID(), name: 'Kumovi', color: '#B07B72', atHeadTable: true });
      await applyHallPlan(planHall({
        template,
        guestCount: parseInt(document.getElementById('ob-guests').value) || 0,
        perTable: Math.max(2, parseInt(document.getElementById('ob-seats').value) || 8),
        mode: 'rebuild'
      }));
      step = 3;
      showOnboardingStep(step);
    } else {
      const rows = skip ? [] : parseGuestText(listEl.value, { surnameFirst: detectSurnameFirst(listEl.value) });
      if (rows.length) await importGuestRows(rows, null);
      modal.style.display = 'none';
      renderAll();
      navigateTo(rows.length ? 'raspored' : 'gosti');
    }
  }
}

function showOnboardingStep(step) {
  document.querySelectorAll('.ob-step').forEach(el => {
    el.style.display = parseInt(el.dataset.step) === step ? 'block' : 'none';
  });
  document.querySelectorAll('.ob-dots [data-dot]').forEach(d => d.classList.toggle('active', parseInt(d.dataset.dot) <= step));
  document.querySelector('.modal-onboarding').classList.toggle('wide', step > 1);
  document.getElementById('onboarding-next').textContent = step === 3 ? 'Počni' : 'Dalje →';
  document.getElementById('onboarding-skip').style.display = step === 3 ? '' : 'none';
}

// ── First steps guide ──────────────────────────────────────────────────────────

function guideSteps() {
  return [
    { nav: 'sala', label: 'Složi salu', done: state.tables.some(t => !isHeadTable(t)) },
    { nav: 'gosti', label: 'Dodaj goste', done: state.guests.length > 0 },
    { nav: 'raspored', label: 'Predloži raspored', done: state.guests.some(g => g.status === 'assigned') }
  ];
}

function renderGuide() {
  const el = document.getElementById('guide-bar');
  if (!el) return;
  const steps = guideSteps();
  if (state.settings.guideDismissed || !state.settings.weddingTitle || steps.every(s => s.done)) {
    el.hidden = true;
    return;
  }
  const current = steps.findIndex(s => !s.done);
  el.hidden = false;
  el.innerHTML = `<span class="guide-title">Prvi koraci</span>
    <div class="guide-steps">${steps.map((s, i) => `
      <button class="guide-step${s.done ? ' done' : ''}${i === current ? ' current' : ''}" data-guide="${s.nav}">
        <span class="guide-num">${s.done ? icon('check') : i + 1}</span><span class="guide-label">${s.label}</span>
      </button>`).join('<span class="guide-sep"></span>')}</div>
    <button class="btn-icon guide-close" id="guide-close" title="Sakrij">${icon('x')}</button>`;
  el.querySelectorAll('[data-guide]').forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.guide)));
  document.getElementById('guide-close').addEventListener('click', () => saveSettings({ guideDismissed: true }));
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
  hallTemplate = currentHallTemplate();
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
    const seated = form.mode === 'rebuild'
      ? state.guests.filter(g => g.tableId && !isHeadTable(state.tables.find(t => t.id === g.tableId) || {})).length
      : 0;
    await withUndo(seated ? `Sala je složena, ${seated} gostiju je bez mjesta` : 'Sala je složena',
      () => applyHallPlan(planHall(form)));
    document.getElementById('modal-hall').style.display = 'none';
    if (floorPlanEdit) floorPlanEdit.fitToContent();
    if (floorPlanAssign) floorPlanAssign._fitted = false;
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
    document.getElementById('table-seats-end').value = table && Number.isInteger(table.seatsEnd) ? table.seatsEnd : 0;
  } else {
    document.getElementById('table-seats-long').value = (table ? table.seatsLong : undefined) || 4;
    document.getElementById('table-seats-end').value = table && Number.isInteger(table.seatsEnd) ? table.seatsEnd : 1;
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

    let table = {
      id,
      name: document.getElementById('table-name').value.trim() || 'Stol',
      shape,
      seats,
      seatsLong,
      seatsEnd,
      x: existing ? existing.x : 500, y: existing ? existing.y : 350,
      rotation: shape !== 'round' && shape !== 'square' && document.getElementById('table-rotated').checked ? 90 : 0
    };
    if (!existing) table = placeNewTable(table);
    await saveTable(table);
    modal.style.display = 'none';
    renderSala();
  });

  document.getElementById('btn-delete-table').addEventListener('click', async () => {
    const modal = document.getElementById('modal-table');
    const id = modal.dataset.editId;
    const table = state.tables.find(t => t.id === id);
    if (table) {
      await withUndo(`Obrisano: ${table.name}`, () => deleteTable(id));
      modal.style.display = 'none';
      renderSala();
    }
  });

  document.getElementById('btn-duplicate-table').addEventListener('click', async () => {
    const modal = document.getElementById('modal-table');
    const id = modal.dataset.editId;
    const orig = state.tables.find(t => t.id === id);
    if (!orig) return;
    const newTable = placeNewTable({ ...orig, id: crypto.randomUUID(), name: orig.name + ' (kopija)' });
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

async function toggleFullNames() {
  const next = !state.settings.showFullNames;
  await saveSettings({ showFullNames: next });
  if (floorPlanEdit) floorPlanEdit.setShowFullNames(next);
  if (floorPlanAssign) floorPlanAssign.setShowFullNames(next);
  renderOptions();
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
  if (state.guests.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <p><strong>Još nema gostiju.</strong><br>Upiši ime gore ili zalijepi cijeli popis odjednom.<br>Parovi i obitelji u istom redu sjedit će zajedno.</p>
      <button class="btn-primary" id="btn-empty-import">${icon('import')} Zalijepi popis gostiju</button>
    </div>`;
    document.getElementById('btn-empty-import').addEventListener('click', () => openImportModal(''));
    return;
  }
  if (guests.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>Nema gostiju koji odgovaraju filtru.</p></div>';
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
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const rows = parseGuestText(input.value);
    if (!rows.length) return;
    const categoryId = guestCategoryFilter || null;
    const result = await importGuestRows(rows, categoryId);
    input.value = '';
    if (result.skipped && !result.guests) {
      const name = result.duplicates[0];
      showToast(`${name} je već na popisu`, false, {
        label: 'Dodaj ipak',
        onClick: async () => {
          await importGuestRows(rows, categoryId, { includeExisting: true });
          showToast(`Dodan još jedan gost: ${name}`);
        }
      });
    }
    else if (result.guests > 1) showToast(`Dodano ${result.guests} gostiju, sjede zajedno`);
  });
  // Pasting several lines into the quick-add field opens the full import.
  input.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (text && /\n/.test(text.trim())) {
      e.preventDefault();
      openImportModal(text);
    }
  });

  document.getElementById('btn-import-guests').addEventListener('click', () => openImportModal(''));
  const importText = document.getElementById('import-textarea');
  const surnameBox = document.getElementById('import-surname-first');
  importText.addEventListener('input', () => {
    // A header such as "Prezime i ime" sets the order; otherwise the user's choice stays.
    if (detectSurnameFirst(importText.value)) surnameBox.checked = true;
    updateImportPreview();
  });
  surnameBox.addEventListener('change', updateImportPreview);
  document.getElementById('import-include-existing').addEventListener('change', updateImportPreview);

  document.getElementById('btn-import-confirm').addEventListener('click', async () => {
    const rows = parseGuestText(importText.value, { surnameFirst: surnameBox.checked });
    if (!rows.length) return;
    const result = await importGuestRows(rows, document.getElementById('import-category').value || null,
      { includeExisting: document.getElementById('import-include-existing').checked });
    document.getElementById('modal-import').style.display = 'none';
    document.getElementById('import-textarea').value = '';
    showToast(`Dodano ${result.guests} gostiju`);
  });

  document.getElementById('guest-search').addEventListener('input', (e) => {
    guestSearchQuery = e.target.value;
    renderGuestList();
  });

  document.getElementById('btn-add-guest-btn').addEventListener('click', () => openGuestModal(null));

  document.getElementById('btn-filter-violated').addEventListener('click', () => {
    guestViolationFilter = !guestViolationFilter;
    renderGosti();
  });
}

function openImportModal(text) {
  document.getElementById('import-textarea').value = text || '';
  document.getElementById('import-surname-first').checked = detectSurnameFirst(text);
  document.getElementById('import-include-existing').checked = false;
  document.getElementById('import-category').innerHTML = '<option value="">— bez kategorije —</option>' +
    state.categories.map(c => `<option value="${c.id}"${c.id === guestCategoryFilter ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  updateImportPreview();
  document.getElementById('modal-import').style.display = 'flex';
  document.getElementById('import-textarea').focus();
}

function updateImportPreview() {
  const el = document.getElementById('import-preview');
  const rows = parseGuestText(document.getElementById('import-textarea').value,
    { surnameFirst: document.getElementById('import-surname-first').checked });
  const includeBox = document.getElementById('import-include-existing');
  const p = previewGuestImport(rows, { includeExisting: includeBox.checked });
  document.getElementById('btn-import-confirm').disabled = p.guests === 0;
  // Names already on the list: skipped by default, since a list pasted twice is the usual cause.
  const dupRow = document.getElementById('import-dup-row');
  dupRow.hidden = !p.duplicates.length;
  if (p.duplicates.length) {
    const shown = p.duplicates.slice(0, 4).map(n => {
      const cat = state.categories.find(c => c.id === (state.guests.find(g => g.name.toLowerCase() === n.toLowerCase()) || {}).categoryId);
      return `<em>${esc(n)}</em>${cat ? ` (${esc(cat.name)})` : ''}`;
    }).join(', ');
    const more = p.duplicates.length > 4 ? ` i još ${p.duplicates.length - 4}` : '';
    document.getElementById('import-dup-label').innerHTML =
      `${p.duplicates.length === 1 ? 'Već je na popisu' : `Već su na popisu (${p.duplicates.length})`}: ${shown}${more}. <strong>Dodaj ih ipak</strong> kao nove goste (npr. imenjaci).`;
  }
  if (!p.guests && !p.skipped) { el.innerHTML = ''; return; }
  const summary = [`<strong>${p.guests}</strong> ${p.guests === 1 ? 'gost' : 'gostiju'}`];
  if (p.groups) summary.push(`${p.groups} ${p.groups === 1 ? 'par ili obitelj' : 'parova i obitelji'} sjedi zajedno`);
  if (p.skipped) summary.push(`${p.skipped} preskočeno`);
  const sample = p.rows.slice(0, 6).map(r =>
    `<li>${r.names.map(n => `<span class="pp-chip">${esc(n)}</span>`).join(r.names.length > 1 ? `<span class="import-link">${icon('together')}</span>` : '')}${r.category ? ` <span class="muted">· ${esc(r.category)}</span>` : ''}</li>`
  ).join('');
  el.innerHTML = `<p>${summary.join(' · ')}</p>${sample ? `<ul>${sample}</ul>` : ''}${p.rows.length > 6 ? `<p class="muted">… i još ${p.rows.length - 6} redaka</p>` : ''}`;
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
      const cat = state.categories.find(c => c.id === btn.dataset.delCat);
      if (!cat) return;
      await withUndo(`Kategorija ${cat.name} je obrisana`, () => deleteCategory(cat.id));
      renderCategoryManager();
      renderGosti();
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

// Picking someone who already sits with a group brings that whole group along;
// say so before saving instead of merging silently.
function renderTogetherNote() {
  const note = document.getElementById('pp-together-note');
  const guestId = document.getElementById('modal-guest').dataset.editId;
  const picked = ppTogether.getValue();
  const known = new Set([guestId, ...picked]);
  const lines = [];
  for (const id of picked) {
    const group = state.rules.find(r => r.type === 'together' && r.guestIds.includes(id) && !r.guestIds.includes(guestId));
    if (!group) continue;
    const extra = group.guestIds.filter(g => !known.has(g));
    if (!extra.length) continue;
    extra.forEach(g => known.add(g));
    lines.push(`${esc(nameOf(id))} već sjedi s: <strong>${extra.map(g => esc(nameOf(g))).join(', ')}</strong>`);
  }
  note.hidden = !lines.length;
  note.innerHTML = lines.length
    ? `${icon('together')}<span>${lines.join('<br>')}<br>Spremanjem će svi sjediti zajedno.</span>`
    : '';
}

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
  modal.dataset.editId = id || '';
  ppTogether.setValue(rel.together);
  ppApart.setValue(rel.apart);
  renderTogetherNote();
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
    exclude: () => [document.getElementById('modal-guest').dataset.editId, ...ppApart.getValue()],
    onChange: renderTogetherNote
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
    if (g) {
      await withUndo(`Obrisano s popisa: ${g.name}`, () => deleteGuest(id));
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
        onSeatClick: (tableId, seatIndex, guest) => handleSeatClick(tableId, seatIndex, guest),
        onSeatPress: (e, tableId, seatIndex, guest) => armGuestDrag(e, guest.id, false)
      });
    }
    floorPlanAssign.setShowFullNames(!!state.settings.showFullNames);
    floorPlanAssign.update(state.tables, state.guests, state.categories, getViolatedTableIds());
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
  if (selectedGuestForAssign && !state.guests.some(g => g.id === selectedGuestForAssign)) selectedGuestForAssign = null;
  let guests = all;
  if (rasporedSearch) {
    const q = rasporedSearch.toLowerCase();
    guests = guests.filter(g => g.name.toLowerCase().includes(q));
  }
  guests.sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('unassigned-count').textContent = all.length ? `(${all.length})` : '';
  const hint = document.getElementById('unassigned-hint');
  if (selectedGuestForAssign) {
    hint.innerHTML = `Dodirni mjesto za: <strong>${esc(nameOf(selectedGuestForAssign))}</strong> <button class="btn-text hint-cancel" id="btn-cancel-select">Odustani</button>`;
    hint.classList.add('selecting');
    document.getElementById('btn-cancel-select').addEventListener('click', () => clearGuestSelection());
  } else {
    hint.textContent = all.length ? 'Povuci gosta na mjesto ili stol, ili ga dodirni pa dodirni mjesto.' : '';
    hint.classList.remove('selecting');
  }
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
    chip.addEventListener('mousedown', e => armGuestDrag(e, chip.dataset.id, true));
    chip.addEventListener('touchstart', e => armGuestDrag(e, chip.dataset.id, true), { passive: true });
    chip.addEventListener('click', () => {
      if (guestDrag.justDropped()) return;
      selectedGuestForAssign = selectedGuestForAssign === chip.dataset.id ? null : chip.dataset.id;
      renderUnassignedPanel();
      if (rasporedView === 'tables') renderTablesView();
    });
  });
}

function clearGuestSelection() {
  selectedGuestForAssign = null;
  renderUnassignedPanel();
  if (rasporedView === 'tables') renderTablesView();
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
    return `<div class="table-card${violated.has(t.id) ? ' violated' : ''}" data-table-card="${t.id}">
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
  container.querySelectorAll('[data-guest]').forEach(li => {
    li.addEventListener('mousedown', e => armGuestDrag(e, li.dataset.guest, true));
    li.addEventListener('touchstart', e => armGuestDrag(e, li.dataset.guest, true), { passive: true });
  });
  container.querySelectorAll('[data-guest]').forEach(li => li.addEventListener('click', () => {
    if (guestDrag.justDropped()) return;
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
  if (guestDrag.justDropped()) return;
  if (selectedGuestForAssign) {
    // Tap a guest, then tap a seat: takes a free seat or swaps with whoever sits there.
    const id = selectedGuestForAssign;
    selectedGuestForAssign = null;
    if (guest && guest.id === id) { renderUnassignedPanel(); return; }
    await dropGuest(id, { kind: 'seat', tableId, seatIndex });
    renderUnassignedPanel();
  } else if (guest) {
    showSeatOptionsModal(tableId, seatIndex, guest);
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
  document.getElementById('btn-seat-move').addEventListener('click', () => {
    const modal = document.getElementById('modal-seat-options');
    modal.style.display = 'none';
    selectedGuestForAssign = modal.dataset.guestId;
    if (rasporedView !== 'floor') { rasporedView = 'floor'; renderRaspored(); } else renderUnassignedPanel();
  });

  document.getElementById('btn-seat-unassign').addEventListener('click', async () => {
    const modal = document.getElementById('modal-seat-options');
    modal.style.display = 'none';
    const guest = state.guests.find(g => g.id === modal.dataset.guestId);
    if (guest) await withUndo(`${guest.name} je sada bez mjesta`, () => unassignGuest(guest.id));
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
  document.getElementById('btn-zoom-in-assign').addEventListener('click', () => floorPlanAssign && floorPlanAssign.zoomIn());
  document.getElementById('btn-zoom-out-assign').addEventListener('click', () => floorPlanAssign && floorPlanAssign.zoomOut());
  document.getElementById('btn-zoom-reset-assign').addEventListener('click', () => floorPlanAssign && floorPlanAssign.resetView());

  document.getElementById('btn-print').addEventListener('click', () => {
    if (!state.guests.some(g => g.tableId)) { showToast('Još nitko nema mjesto'); return; }
    document.getElementById('modal-print').style.display = 'flex';
  });
  document.getElementById('btn-print-go').addEventListener('click', () => {
    const parts = {
      tables: document.getElementById('print-tables').checked,
      alpha: document.getElementById('print-alpha').checked
    };
    if (!parts.tables && !parts.alpha) return;
    document.getElementById('modal-print').style.display = 'none';
    buildPrintArea(parts);
    // Let the print layout render (fonts) before the dialog opens.
    setTimeout(() => window.print(), 150);
  });
  document.getElementById('btn-share').addEventListener('click', shareSeatingList);

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
    closeOptions();
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
        showToast('Podaci su vraćeni iz kopije');
      }
    } catch (e) {
      alert('Neispravna JSON datoteka.');
    }
    e.target.value = '';
  });
}

// ── Ispis i dijeljenje ────────────────────────────────────────────────────────

function seatedGuestsSorted() {
  return state.guests
    .filter(g => g.tableId && state.tables.some(t => t.id === g.tableId))
    .sort((a, b) => a.name.localeCompare(b.name, 'hr'));
}

function buildPrintArea(parts) {
  const area = document.getElementById('print-area');
  const title = esc(state.settings.weddingTitle || 'Moje Vjenčanje');
  const header = (sub) => `<header class="print-head">
      <div class="print-monogram">${esc(state.settings.monogram || '♡')}</div>
      <div class="print-title">${title}</div>
      <div class="print-sub">${sub}</div>
    </header>`;
  const pages = [];
  if (parts.tables) {
    pages.push(`<section class="print-page">${header('Raspored sjedenja')}
      <div class="print-tables">${state.tables.map(t => {
        const guests = state.guests.filter(g => g.tableId === t.id).sort((a, b) => (a.seatIndex || 0) - (b.seatIndex || 0));
        return `<div class="print-table">
          <h3>${esc(t.name)}</h3>
          <ol>${guests.map(g => `<li>${esc(g.name)}</li>`).join('') || '<li class="muted">—</li>'}</ol>
        </div>`;
      }).join('')}</div>
    </section>`);
  }
  if (parts.alpha) {
    const tableName = id => (state.tables.find(t => t.id === id) || {}).name || '';
    pages.push(`<section class="print-page">${header('Gdje sjedim')}
      <div class="print-alpha">${seatedGuestsSorted().map(g =>
        `<div class="print-alpha-row"><span>${esc(g.name)}</span><span class="print-dots"></span><strong>${esc(tableName(g.tableId))}</strong></div>`
      ).join('')}</div>
    </section>`);
  }
  area.innerHTML = pages.join('');
}

async function shareSeatingList() {
  const tableName = id => (state.tables.find(t => t.id === id) || {}).name || '';
  const lines = seatedGuestsSorted().map(g => `${g.name} – ${tableName(g.tableId)}`);
  if (!lines.length) { showToast('Još nitko nema mjesto'); return; }
  const title = `${state.settings.weddingTitle || 'Vjenčanje'} – gdje sjedim`;
  const text = `${title}\n\n${lines.join('\n')}`;
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Popis je kopiran, zalijepi ga u poruku');
  } catch (e) {
    downloadFile('gdje-sjedim.txt', 'text/plain;charset=utf-8', text);
  }
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
  setupOptions();
  await init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _appMain);
} else {
  _appMain();
}
