/**
 * Floor plan SVG renderer and interaction handler.
 * Manages dragging, zooming, panning of tables on the canvas.
 */
(function () {
  'use strict';
  if (typeof window.FloorPlan === 'function') return;

const CANVAS_W = 1000;
const CANVAS_H = 700;
// Tables may be placed beyond the initial 1000×700 view (big halls); the view
// fits itself to the tables.
const WORLD_W = 2400;
const WORLD_H = 2400;
const GRID_SIZE = 50;
const SEAT_PITCH = 28;
// Seat colours: the couple, the kumovi with their partners, everyone else.
const SEAT_COLORS = { couple: '#8A5A7E', kumovi: '#5E7F99', guest: '#C9A24B' };
function seatColor(guest) {
  if (!guest) return null;
  if (guest.party === 'couple') return SEAT_COLORS.couple;
  return guest.party ? SEAT_COLORS.kumovi : SEAT_COLORS.guest;
}

const TABLE_DIMS = {
  round:       { rx: 45, ry: 45 },
  square:      { w: 80, h: 80 },
  rectangular: { w: 110, h: 70 },
  royal:       { w: 200, h: 50 },
  head:        { w: 260, h: 55 }
};

class FloorPlan {
  constructor(svgEl, options = {}) {
    if (!svgEl) {
      console.error('[FloorPlan] SVG element missing');
      return;
    }
    this.svg = svgEl;
    this.snapToGrid = options.snapToGrid || false;
    this.onTableMove = options.onTableMove || (() => {});
    this.onTableClick = options.onTableClick || (() => {});
    this.onTableOpen = options.onTableOpen || null; // assign mode: tap on the table itself
    this.onSeatClick = options.onSeatClick || (() => {});
    this.onSeatPress = options.onSeatPress || null; // (event, tableId, seatIndex, guest) – start of a press on an occupied seat
    this.mode = options.mode || 'edit'; // 'edit' | 'assign'
    this.namesView = false; // tables drawn as cards with their guests' names
    this.onNamesViewChange = options.onNamesViewChange || null;

    this.viewBox = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
    this.tables = [];
    this.guests = [];
    this.categories = [];
    this.violatedTableIds = new Set();
    this.selectedTableId = null;

    this._dragging = null;
    this._panning = false;
    this._panStart = null;
    this._pinchDist = null;

    this._setupSVG();
    this._bindEvents();
  }

  _setupSVG() {
    this.svg.setAttribute('viewBox', `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    // Grid layer
    this.gridLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.gridLayer.setAttribute('class', 'grid-layer');
    // Tables layer
    this.tablesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.tablesLayer.setAttribute('class', 'tables-layer');
    // Decorations layer
    this.decoLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.decoLayer.setAttribute('class', 'deco-layer');

    // Guest names (when shown) – drawn above all tables so they can be placed
    // to avoid each other.
    this.labelsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.labelsLayer.setAttribute('class', 'labels-layer');
    this.labelsLayer.setAttribute('pointer-events', 'none');

    this.svg.appendChild(this.gridLayer);
    this.svg.appendChild(this.tablesLayer);
    this.svg.appendChild(this.labelsLayer);
    this.svg.appendChild(this.decoLayer);

    this._renderGrid();
  }

  _renderGrid() {
    this.gridLayer.innerHTML = '';
    if (!this.snapToGrid) return;
    for (let x = 0; x <= WORLD_W; x += GRID_SIZE) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x); line.setAttribute('y1', 0);
      line.setAttribute('x2', x); line.setAttribute('y2', WORLD_H);
      line.setAttribute('stroke', '#E8DCC8'); line.setAttribute('stroke-width', '0.5');
      this.gridLayer.appendChild(line);
    }
    for (let y = 0; y <= WORLD_H; y += GRID_SIZE) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0); line.setAttribute('y1', y);
      line.setAttribute('x2', WORLD_W); line.setAttribute('y2', y);
      line.setAttribute('stroke', '#E8DCC8'); line.setAttribute('stroke-width', '0.5');
      this.gridLayer.appendChild(line);
    }
  }

  setSnapToGrid(val) {
    this.snapToGrid = val;
    this._renderGrid();
  }

  update(tables, guests, categories, violatedTableIds = new Set()) {
    this.tables = tables;
    this.guests = guests;
    this.categories = categories;
    this.violatedTableIds = violatedTableIds;
    this._renderTables();
    // First time there is something to show, frame it.
    if (!this._fitted && tables.length && this.svg.getBoundingClientRect().width > 0) {
      this._fitted = true;
      this.fitToContent();
    }
  }

  // Table size: long tables grow with the number of seats along their sides.
  _dims(table) {
    const base = TABLE_DIMS[table.shape] || TABLE_DIMS.rectangular;
    if (table.shape === 'round' || table.shape === 'square' || table.seatsLong === undefined) return base;
    const nE = table.seatsEnd || 0;
    return {
      w: Math.max(base.w, (table.seatsLong || 0) * SEAT_PITCH + 20),
      h: table.shape === 'head' ? base.h : Math.max(base.h, nE * SEAT_PITCH + 20)
    };
  }

  // Bounding box of all tables including their seats, in canvas units.
  _contentBounds() {
    if (!this.tables.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const t of this.tables) {
      const d = t.shape === 'round' ? { w: 90, h: 90 } : this._dims(t);
      const rot = ((t.rotation || 0) % 180 + 180) % 180 === 90;
      const hw = (rot ? d.h : d.w) / 2 + 30;
      const hh = (rot ? d.w : d.h) / 2 + 30;
      x1 = Math.min(x1, t.x - hw); x2 = Math.max(x2, t.x + hw);
      y1 = Math.min(y1, t.y - hh); y2 = Math.max(y2, t.y + hh);
    }
    return { x1, y1, x2, y2 };
  }

  fitToContent(extraPad = 0) {
    const b = this._contentBounds();
    if (!b) { this.viewBox = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }; this._applyViewBox(); return; }
    const pad = 30 + extraPad;
    let w = Math.max(b.x2 - b.x1 + pad * 2, 420);
    let h = Math.max(b.y2 - b.y1 + pad * 2, 300);
    // Match the element's aspect ratio so the content is centred, not letterboxed to one side.
    const rect = this.svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const aspect = rect.width / rect.height;
      if (w / h < aspect) w = h * aspect; else h = w / aspect;
    }
    const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
    this.viewBox = { x: cx - w / 2, y: cy - h / 2, w, h };
    this._applyViewBox();
  }

  _renderTables() {
    if (!this.tablesLayer) return;
    this.tablesLayer.innerHTML = '';
    for (const table of this.tables) {
      try {
        const g = this.namesView && this.mode === 'assign' ? this._createNamesCard(table) : this._createTableGroup(table);
        this.tablesLayer.appendChild(g);
      } catch (err) {
        console.error('[FloorPlan] table render failed', table && table.id, err);
      }
    }
    this.labelsLayer.innerHTML = '';
  }

  // Show tables as cards listing who sits there (positions stay the same), or
  // back as tables with seats.
  setNamesView(on, focusTableId) {
    on = !!on && this.mode === 'assign';
    if (on === this.namesView) return;
    this.namesView = on;
    this._renderTables();
    // On a phone the whole hall is too small to read: zoom in on the tapped table.
    const rect = this.svg.getBoundingClientRect();
    const t = on && focusTableId && this.tables.find(x => x.id === focusTableId);
    if (t && rect.width > 0 && rect.width < 600 && this.viewBox.w > 480) {
      const w = 460, h = w * rect.height / rect.width;
      this.viewBox = { x: t.x - w / 2, y: t.y - h / 2, w, h };
      this._applyViewBox();
    }
    if (this.onNamesViewChange) this.onNamesViewChange(on);
  }

  // A rounded card in the table's place: name, how full, and its guests in seat
  // order, sized so every name fits without running into the next table.
  _createNamesCard(table) {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs, text) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      if (text != null) n.textContent = text;
      return n;
    };
    const guests = this.guests.filter(gg => gg.tableId === table.id)
      .sort((a, b) => (a.seatIndex || 0) - (b.seatIndex || 0));
    const turned = ((table.rotation || 0) % 180 + 180) % 180 === 90;
    const d = this._dims(table);
    const W = table.shape === 'round' || turned ? 172 : Math.min(table.shape === 'head' ? 300 : 270, Math.max(172, d.w + 60));
    const cols = guests.length > (W >= 260 ? 3 : 8) ? 2 : 1;
    const rows = Math.max(1, Math.ceil(guests.length / cols));
    const LINE = 15, HEAD = 26;
    const H = HEAD + rows * LINE + 10;
    const full = guests.length >= table.seats;
    const violated = this.violatedTableIds.has(table.id);

    const g = el('g', { class: 'table-group names-card', 'data-id': table.id, transform: `translate(${table.x},${table.y})` });
    g.style.cursor = 'pointer';
    g.appendChild(el('rect', {
      x: -W / 2, y: -H / 2, width: W, height: H, rx: 12,
      fill: full ? '#F3F8F1' : '#FFFFFF',
      stroke: violated ? '#B04A3F' : '#A17C33', 'stroke-width': violated ? 2.5 : 1.5,
      filter: 'drop-shadow(0 1px 3px rgba(43,38,34,0.12))'
    }));
    const top = -H / 2;
    g.appendChild(el('text', {
      x: -W / 2 + 12, y: top + 15, 'dominant-baseline': 'central', 'pointer-events': 'none',
      'font-family': "'Cormorant Garamond', Georgia, serif", 'font-size': 14, 'font-weight': 600, fill: '#6B5836'
    }, table.name));
    g.appendChild(el('text', {
      x: W / 2 - 12, y: top + 15, 'text-anchor': 'end', 'dominant-baseline': 'central', 'pointer-events': 'none',
      'font-family': 'Jost, system-ui, sans-serif', 'font-size': 10.5, 'font-weight': full ? 700 : 500, fill: full ? '#5E8C61' : '#9A8E7E'
    }, `${guests.length}/${table.seats}`));
    g.appendChild(el('line', { x1: -W / 2 + 10, x2: W / 2 - 10, y1: top + HEAD - 2, y2: top + HEAD - 2, stroke: '#EADFCB', 'stroke-width': 1 }));

    const colW = (W - 20) / cols;
    const maxChars = Math.max(4, Math.floor((colW - 14) / 6.6));
    const fit = name => {
      if (name.length <= maxChars) return name;
      const parts = name.split(/\s+/);
      const short = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : name;
      return short.length <= maxChars ? short : name.slice(0, maxChars - 1) + '…';
    };
    if (!guests.length) {
      g.appendChild(el('text', {
        x: 0, y: top + HEAD + LINE / 2 + 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'pointer-events': 'none',
        'font-family': 'Jost, system-ui, sans-serif', 'font-size': 11, 'font-style': 'italic', fill: '#A99D8C'
      }, 'prazno'));
    }
    guests.forEach((gg, i) => {
      const col = Math.floor(i / rows), row = i % rows;
      const x = -W / 2 + 10 + col * colW;
      const y = top + HEAD + row * LINE + LINE / 2 + 2;
      g.appendChild(el('circle', { cx: x + 4, cy: y, r: 3.5, fill: seatColor(gg), 'pointer-events': 'none' }));
      g.appendChild(el('text', {
        x: x + 12, y, 'dominant-baseline': 'central', 'pointer-events': 'none',
        'font-family': 'Jost, system-ui, sans-serif', 'font-size': 11.5, fill: '#2B2622'
      }, fit(String(gg.name || '?'))));
    });
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onTableOpen) this.onTableOpen(table.id);
    });
    return g;
  }

  _createTableGroup(table) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `table-group${this.selectedTableId === table.id ? ' selected' : ''}`);
    g.setAttribute('data-id', table.id);
    g.setAttribute('transform', `translate(${table.x},${table.y}) rotate(${table.rotation || 0})`);
    g.style.cursor = this.mode === 'edit' ? 'grab' : 'default';

    const isViolated = this.violatedTableIds.has(table.id);
    const strokeColor = isViolated ? '#B04A3F' : (this.selectedTableId === table.id ? '#C9A24B' : '#A17C33');
    const strokeW = isViolated ? 2.5 : (this.selectedTableId === table.id ? 2 : 1.5);

    // Draw table shape
    if (table.shape === 'round') {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', TABLE_DIMS.round.rx);
      circle.setAttribute('fill', '#FFFFFF');
      circle.setAttribute('stroke', strokeColor);
      circle.setAttribute('stroke-width', strokeW);
      circle.setAttribute('filter', 'drop-shadow(0 1px 3px rgba(43,38,34,0.12))');
      g.appendChild(circle);
    } else {
      const dims = this._dims(table);
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', -dims.w / 2); rect.setAttribute('y', -dims.h / 2);
      rect.setAttribute('width', dims.w); rect.setAttribute('height', dims.h);
      rect.setAttribute('rx', '6');
      rect.setAttribute('fill', '#FFFFFF');
      rect.setAttribute('stroke', strokeColor);
      rect.setAttribute('stroke-width', strokeW);
      rect.setAttribute('filter', 'drop-shadow(0 1px 3px rgba(43,38,34,0.12))');
      g.appendChild(rect);
    }

    // Table name label
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    label.setAttribute('font-family', "'Cormorant Garamond', Georgia, serif");
    label.setAttribute('font-size', '13.5');
    label.setAttribute('font-weight', '600');
    label.setAttribute('fill', '#6B5836');
    label.setAttribute('pointer-events', 'none');
    const labelY = table.shape === 'round' ? -10 : -7;
    label.setAttribute('y', labelY);
    const rot = table.rotation || 0;
    // Text stays upright even when the table is turned.
    if (rot) label.setAttribute('transform', `rotate(${-rot} 0 ${labelY})`);
    label.textContent = table.name;
    g.appendChild(label);

    // How full the table is ("5/8"), so free seats show without tapping.
    const tableGuests = this.guests.filter(gg => gg.tableId === table.id);
    const full = tableGuests.length >= table.seats;
    const fill = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    fill.setAttribute('class', 'table-fill');
    fill.setAttribute('text-anchor', 'middle');
    fill.setAttribute('dominant-baseline', 'central');
    fill.setAttribute('font-family', "Jost, system-ui, sans-serif");
    fill.setAttribute('font-size', '11');
    fill.setAttribute('font-weight', full ? '700' : '500');
    fill.setAttribute('fill', full ? '#5E8C61' : '#9A8E7E');
    fill.setAttribute('pointer-events', 'none');
    fill.setAttribute('y', labelY + 16);
    if (rot) fill.setAttribute('transform', `rotate(${-rot} 0 ${labelY + 16})`);
    fill.textContent = `${tableGuests.length}/${table.seats}`;
    g.appendChild(fill);
    if (full) { g.classList.add('full'); g.firstChild.setAttribute('fill', '#F3F8F1'); }

    // Seat positions
    const seats = this._getSeatPositions(table);
    const seatMap = {};
    for (const gg of tableGuests) seatMap[gg.seatIndex] = gg;

    seats.forEach((pos, idx) => {
      const guest = seatMap[idx];
      const color = seatColor(guest);
      const seatG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      seatG.setAttribute('class', 'seat-group');
      seatG.setAttribute('data-seat', idx);
      seatG.setAttribute('data-table', table.id);
      seatG.style.cursor = 'pointer';

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.x); circle.setAttribute('cy', pos.y);
      circle.setAttribute('r', '10');
      circle.setAttribute('fill', color || '#F5EBDD');
      circle.setAttribute('stroke', color || '#E8DCC8');
      circle.setAttribute('stroke-width', '1.5');
      seatG.appendChild(circle);

      if (guest) {
        const guestName = (guest.name != null && String(guest.name).trim()) ? String(guest.name).trim() : '?';
        const initials = guestName.split(/\s+/).filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', pos.x); txt.setAttribute('y', pos.y);
        if (rot) txt.setAttribute('transform', `rotate(${-rot} ${pos.x} ${pos.y})`);
        txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('dominant-baseline', 'central');
        txt.setAttribute('font-family', "Jost, system-ui, sans-serif"); txt.setAttribute('font-size', '7');
        txt.setAttribute('font-weight', '700'); txt.setAttribute('fill', '#FFFFFF');
        txt.setAttribute('pointer-events', 'none');
        txt.textContent = initials;
        seatG.appendChild(txt);
        if (guest.locked) {
          const lock = document.createElementNS('http://www.w3.org/2000/svg', 'use');
          lock.setAttribute('href', '#i-lock');
          lock.setAttribute('x', pos.x + 6); lock.setAttribute('y', pos.y - 14);
          lock.setAttribute('width', '8'); lock.setAttribute('height', '8');
          lock.setAttribute('class', 'fp-lock'); lock.setAttribute('pointer-events', 'none');
          seatG.appendChild(lock);
        }
      }

      // While arranging tables a seat is just part of its table: a tap opens
      // the table and a press starts dragging it.
      if (this.mode === 'edit') { seatG.style.cursor = ''; g.appendChild(seatG); return; }
      seatG.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSeatClick(table.id, idx, guest || null);
      });
      if (guest && this.onSeatPress) {
        seatG.addEventListener('mousedown', (e) => this.onSeatPress(e, table.id, idx, guest));
        seatG.addEventListener('touchstart', (e) => this.onSeatPress(e, table.id, idx, guest), { passive: true });
      }
      g.appendChild(seatG);
    });

    if (this.mode === 'assign' && this.onTableOpen) {
      g.addEventListener('click', (e) => { e.stopPropagation(); this.onTableOpen(table.id); });
    }

    // Drag (edit mode only)
    if (this.mode === 'edit') {
      g.addEventListener('mousedown', (e) => this._startDrag(e, table, g));
      g.addEventListener('touchstart', (e) => this._startDragTouch(e, table, g), { passive: false });
      g.addEventListener('click', (e) => {
        if (!this._didDrag) {
          e.stopPropagation();
          this._handleTableTap(table);
        }
      });
    }

    return g;
  }

  _getSeatPositions(table) {
    const seats = [];
    if (table.shape === 'round') {
      const n = table.seats;
      const r = TABLE_DIMS.round.rx + 14;
      for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * i / n) - Math.PI / 2;
        seats.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
      }
      return seats;
    }

    // For sided tables: use seatsLong/seatsEnd if available, else fall back to even distribution
    if (table.seatsLong === undefined) {
      const dims = this._dims(table);
      const hw = dims.w / 2 + 14;
      const hh = dims.h / 2 + 14;
      const perimeter = 2 * (dims.w + dims.h);
      for (let i = 0; i < table.seats; i++) {
        const t = (i / table.seats) * perimeter;
        let x, y;
        if (t < dims.w) { x = -dims.w / 2 + t; y = -hh; }
        else if (t < dims.w + dims.h) { x = hw; y = -dims.h / 2 + (t - dims.w); }
        else if (t < 2 * dims.w + dims.h) { x = dims.w / 2 - (t - dims.w - dims.h); y = hh; }
        else { x = -hw; y = dims.h / 2 - (t - 2 * dims.w - dims.h); }
        seats.push({ x, y });
      }
      return seats;
    }

    const dims = this._dims(table);
    const hw = dims.w / 2;
    const hh = dims.h / 2;
    const off = 14;
    const margin = 10;
    const nL = table.seatsLong || 0;
    const nE = table.shape === 'square' ? nL : (table.seatsEnd || 0);

    const hLine = (n, y, x1, x2) => {
      for (let i = 0; i < n; i++) {
        const x = n === 1 ? (x1 + x2) / 2 : x1 + (x2 - x1) * i / (n - 1);
        seats.push({ x, y });
      }
    };
    const vLine = (n, x, y1, y2) => {
      for (let i = 0; i < n; i++) {
        const y = n === 1 ? (y1 + y2) / 2 : y1 + (y2 - y1) * i / (n - 1);
        seats.push({ x, y });
      }
    };

    if (table.shape === 'head') {
      // Head table: seats only on front (top) side + optional ends
      hLine(nL, -(hh + off), -hw + margin, hw - margin);
      vLine(nE, hw + off, -hh + margin, hh - margin);
      vLine(nE, -(hw + off), hh - margin, -hh + margin);
    } else {
      // Top (left → right), Right end (top → bottom), Bottom (right → left), Left end (bottom → top)
      hLine(nL, -(hh + off), -hw + margin, hw - margin);
      vLine(nE, hw + off, -hh + margin, hh - margin);
      hLine(nL, hh + off, hw - margin, -hw + margin);
      vLine(nE, -(hw + off), hh - margin, -hh + margin);
    }

    return seats;
  }

  _svgPoint(clientX, clientY) {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const pt = this.svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const svgP = pt.matrixTransform(ctm.inverse());
    return { x: svgP.x, y: svgP.y };
  }

  _snap(val) {
    return this.snapToGrid ? Math.round(val / GRID_SIZE) * GRID_SIZE : val;
  }

  _applyDragTransform(table, g) {
    // Live-update only the dragged group's transform — no full re-render.
    // This keeps the touch target element alive so touch events keep flowing.
    g.setAttribute('transform', `translate(${table.x},${table.y}) rotate(${table.rotation || 0})`);
  }

  _handleTableTap(table) {
    this.onTableClick(table.id);
  }

  _startDrag(e, table, g) {
    if (e.button !== 0) return;
    e.preventDefault();
    this._didDrag = false;
    const pt = this._svgPoint(e.clientX, e.clientY);
    this._dragging = { table, g, startX: pt.x - table.x, startY: pt.y - table.y };
    const onMove = (ev) => {
      const p = this._svgPoint(ev.clientX, ev.clientY);
      const newX = this._snap(Math.max(0, Math.min(WORLD_W, p.x - this._dragging.startX)));
      const newY = this._snap(Math.max(0, Math.min(WORLD_H, p.y - this._dragging.startY)));
      if (Math.abs(newX - table.x) > 2 || Math.abs(newY - table.y) > 2) this._didDrag = true;
      table.x = newX; table.y = newY;
      if (this._didDrag) this.labelsLayer.style.display = 'none';
      this._applyDragTransform(table, g);
    };
    const onUp = () => {
      this.labelsLayer.style.display = '';
      const dragged = this._dragging && this._didDrag;
      const t = this._dragging ? this._dragging.table : null;
      this._dragging = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (dragged) this.onTableMove(t);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  _startDragTouch(e, table, g) {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    this._didDrag = false;
    const touch = e.touches[0];
    const pt = this._svgPoint(touch.clientX, touch.clientY);
    this._dragging = { table, g, startX: pt.x - table.x, startY: pt.y - table.y };
    const onMove = (ev) => {
      if (!this._dragging || ev.touches.length !== 1) return;
      ev.preventDefault();
      const t = ev.touches[0];
      const p = this._svgPoint(t.clientX, t.clientY);
      const newX = this._snap(Math.max(0, Math.min(WORLD_W, p.x - this._dragging.startX)));
      const newY = this._snap(Math.max(0, Math.min(WORLD_H, p.y - this._dragging.startY)));
      if (Math.abs(newX - table.x) > 2 || Math.abs(newY - table.y) > 2) this._didDrag = true;
      table.x = newX; table.y = newY;
      if (this._didDrag) this.labelsLayer.style.display = 'none';
      this._applyDragTransform(table, g);
    };
    const onEnd = () => {
      this.labelsLayer.style.display = '';
      const dragged = this._dragging && this._didDrag;
      const tapped = this._dragging && !this._didDrag;
      const tbl = this._dragging ? this._dragging.table : null;
      this._dragging = null;
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
      if (dragged) this.onTableMove(tbl);
      else if (tapped) this._handleTableTap(tbl);
    };
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
  }

  _bindEvents() {
    // A tap on the empty floor (not a pan) brings back the seats.
    this.svg.addEventListener('click', (e) => {
      if (!this.namesView || this._panMoved) return;
      if (e.target.closest && e.target.closest('.table-group')) return;
      this.setNamesView(false);
    });

    // Scroll wheel → zoom toward cursor
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scale = e.deltaY > 0 ? 1.1 : 0.9;
      const pt = this._svgPoint(e.clientX, e.clientY);
      this._zoomAt(scale, pt.x, pt.y);
    }, { passive: false });

    // Mouse pan: left-drag on empty canvas, or middle-button anywhere
    this.svg.addEventListener('mousedown', (e) => {
      if (this._dragging) return;
      const onTable = e.target.closest && e.target.closest('.table-group');
      const middle = e.button === 1;
      const leftEmpty = e.button === 0 && !onTable;
      if (!middle && !leftEmpty) return;
      e.preventDefault();
      this._startPan(e.clientX, e.clientY);
      const onMove = (ev) => {
        if (!this._panning) return;
        this._movePan(ev.clientX, ev.clientY);
      };
      const onUp = () => {
        this._endPan();
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    // Touch: 1 finger on empty → pan; 2 fingers → pinch zoom + pan
    this.svg.addEventListener('touchstart', (e) => {
      if (this._dragging) return;
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const el = document.elementFromPoint(t.clientX, t.clientY);
        const onTable = el && el.closest && el.closest('.table-group');
        const onSeat = el && el.closest && el.closest('.seat-group');
        if (!onTable && !onSeat) {
          this._startPan(t.clientX, t.clientY);
        }
      } else if (e.touches.length === 2) {
        this._endPan();
        this._pinchDist = this._getTouchDist(e);
        this._pinchMid = this._getTouchMid(e);
      }
    }, { passive: true });

    this.svg.addEventListener('touchmove', (e) => {
      if (this._dragging) return;
      if (e.touches.length === 1 && this._panning) {
        e.preventDefault();
        this._movePan(e.touches[0].clientX, e.touches[0].clientY);
      } else if (e.touches.length === 2 && this._pinchDist !== null) {
        e.preventDefault();
        const newDist = this._getTouchDist(e);
        const mid = this._getTouchMid(e);
        const scale = this._pinchDist / newDist;
        // Zoom around previous midpoint (in SVG coords), then pan by midpoint shift
        const svgMid = this._svgPoint(this._pinchMid.x, this._pinchMid.y);
        this._zoomAt(scale, svgMid.x, svgMid.y);
        // Screen-space delta of midpoint → viewBox shift
        const rect = this.svg.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const dxScreen = mid.x - this._pinchMid.x;
          const dyScreen = mid.y - this._pinchMid.y;
          const dxSvg = -(dxScreen / rect.width) * this.viewBox.w;
          const dySvg = -(dyScreen / rect.height) * this.viewBox.h;
          this.viewBox.x += dxSvg;
          this.viewBox.y += dySvg;
          this._applyViewBox();
        }
        this._pinchDist = newDist;
        this._pinchMid = mid;
      }
    }, { passive: false });

    this.svg.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        this._endPan();
        this._pinchDist = null;
        this._pinchMid = null;
      } else if (e.touches.length === 1) {
        this._pinchDist = null;
        this._pinchMid = null;
        // Continue as single-finger pan from remaining touch
        this._startPan(e.touches[0].clientX, e.touches[0].clientY);
      }
    });
    this.svg.addEventListener('touchcancel', () => {
      this._endPan();
      this._pinchDist = null;
      this._pinchMid = null;
    });
  }

  _startPan(clientX, clientY) {
    this._panning = true;
    this._panMoved = false;
    this._panStart = {
      x: clientX,
      y: clientY,
      vbX: this.viewBox.x,
      vbY: this.viewBox.y
    };
    this.svg.style.cursor = 'grabbing';
  }

  _movePan(clientX, clientY) {
    if (!this._panning || !this._panStart) return;
    const rect = this.svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dxScreen = clientX - this._panStart.x;
    const dyScreen = clientY - this._panStart.y;
    if (Math.abs(dxScreen) + Math.abs(dyScreen) > 4) this._panMoved = true;
    // Convert screen pixels to viewBox units
    const dxSvg = -(dxScreen / rect.width) * this.viewBox.w;
    const dySvg = -(dyScreen / rect.height) * this.viewBox.h;
    this.viewBox.x = this._panStart.vbX + dxSvg;
    this.viewBox.y = this._panStart.vbY + dySvg;
    this._applyViewBox();
  }

  _endPan() {
    this._panning = false;
    this._panStart = null;
    this.svg.style.cursor = '';
  }

  _getTouchDist(e) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _getTouchMid(e) {
    return {
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
      y: (e.touches[0].clientY + e.touches[1].clientY) / 2
    };
  }

  zoomIn() {
    const cx = this.viewBox.x + this.viewBox.w / 2;
    const cy = this.viewBox.y + this.viewBox.h / 2;
    this._zoomAt(0.8, cx, cy);
  }
  zoomOut() {
    const cx = this.viewBox.x + this.viewBox.w / 2;
    const cy = this.viewBox.y + this.viewBox.h / 2;
    this._zoomAt(1.25, cx, cy);
  }
  resetView() {
    this.fitToContent();
  }

  /** Zoom keeping (cx, cy) in SVG coords fixed on screen */
  // Move the view by a number of screen pixels (auto-pan while dragging a guest).
  panBy(dxScreen, dyScreen) {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.viewBox.x += (dxScreen / rect.width) * this.viewBox.w;
    this.viewBox.y += (dyScreen / rect.height) * this.viewBox.h;
    this._applyViewBox();
  }

  _zoomAt(scale, cx, cy) {
    const newW = Math.max(200, Math.min(WORLD_W * 1.5, this.viewBox.w * scale));
    const newH = Math.max(140, Math.min(WORLD_H * 1.5, this.viewBox.h * scale));
    // Fraction of point within current viewBox
    const fx = (cx - this.viewBox.x) / this.viewBox.w;
    const fy = (cy - this.viewBox.y) / this.viewBox.h;
    this.viewBox = {
      x: cx - newW * fx,
      y: cy - newH * fy,
      w: newW,
      h: newH
    };
    this._applyViewBox();
  }

  _applyViewBox() {
    this.svg.setAttribute('viewBox', `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);
  }

  selectTable(id) {
    this.selectedTableId = id;
    this._renderTables();
  }

  setMode(mode) {
    this.mode = mode;
    this._renderTables();
  }
}


  window.FloorPlan = FloorPlan;
  window.seatColor = seatColor;
})();
