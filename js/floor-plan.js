/**
 * Floor plan SVG renderer and interaction handler.
 * Manages dragging, zooming, panning of tables on the canvas.
 */

const CANVAS_W = 1000;
const CANVAS_H = 700;
const GRID_SIZE = 50;

const TABLE_DIMS = {
  round:       { rx: 45, ry: 45 },
  square:      { w: 80, h: 80 },
  rectangular: { w: 110, h: 70 },
  royal:       { w: 200, h: 50 },
  head:        { w: 260, h: 55 }
};

class FloorPlan {
  constructor(svgEl, options = {}) {
    this.svg = svgEl;
    this.snapToGrid = options.snapToGrid || false;
    this.onTableMove = options.onTableMove || (() => {});
    this.onTableClick = options.onTableClick || (() => {});
    this.onSeatClick = options.onSeatClick || (() => {});
    this.mode = options.mode || 'edit'; // 'edit' | 'assign'

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

    this.svg.appendChild(this.gridLayer);
    this.svg.appendChild(this.tablesLayer);
    this.svg.appendChild(this.decoLayer);

    this._renderGrid();
  }

  _renderGrid() {
    this.gridLayer.innerHTML = '';
    if (!this.snapToGrid) return;
    for (let x = 0; x <= CANVAS_W; x += GRID_SIZE) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x); line.setAttribute('y1', 0);
      line.setAttribute('x2', x); line.setAttribute('y2', CANVAS_H);
      line.setAttribute('stroke', '#E8DCC8'); line.setAttribute('stroke-width', '0.5');
      this.gridLayer.appendChild(line);
    }
    for (let y = 0; y <= CANVAS_H; y += GRID_SIZE) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0); line.setAttribute('y1', y);
      line.setAttribute('x2', CANVAS_W); line.setAttribute('y2', y);
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
  }

  _renderTables() {
    this.tablesLayer.innerHTML = '';
    for (const table of this.tables) {
      const g = this._createTableGroup(table);
      this.tablesLayer.appendChild(g);
    }
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
      const dims = TABLE_DIMS[table.shape] || TABLE_DIMS.rectangular;
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
    label.setAttribute('font-family', 'Inter, system-ui');
    label.setAttribute('font-size', '11');
    label.setAttribute('font-weight', '600');
    label.setAttribute('fill', '#6B5836');
    label.setAttribute('pointer-events', 'none');
    label.setAttribute('y', table.shape === 'round' ? -18 : 0);
    label.textContent = table.name;
    g.appendChild(label);

    // Seat positions
    const seats = this._getSeatPositions(table);
    const tableGuests = this.guests.filter(gg => gg.tableId === table.id);
    const seatMap = {};
    for (const gg of tableGuests) seatMap[gg.seatIndex] = gg;

    seats.forEach((pos, idx) => {
      const guest = seatMap[idx];
      const cat = guest ? this.categories.find(c => c.id === guest.categoryId) : null;
      const seatG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      seatG.setAttribute('data-seat', idx);
      seatG.setAttribute('data-table', table.id);
      seatG.style.cursor = 'pointer';

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.x); circle.setAttribute('cy', pos.y);
      circle.setAttribute('r', '10');
      circle.setAttribute('fill', guest ? ((cat ? cat.color : undefined) || '#C9A24B') : '#F5EBDD');
      circle.setAttribute('stroke', guest ? ((cat ? cat.color : undefined) || '#C9A24B') : '#E8DCC8');
      circle.setAttribute('stroke-width', '1.5');
      seatG.appendChild(circle);

      if (guest) {
        const initials = guest.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', pos.x); txt.setAttribute('y', pos.y);
        txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('dominant-baseline', 'central');
        txt.setAttribute('font-family', 'Inter, system-ui'); txt.setAttribute('font-size', '7');
        txt.setAttribute('font-weight', '700'); txt.setAttribute('fill', '#FFFFFF');
        txt.setAttribute('pointer-events', 'none');
        txt.textContent = initials;
        seatG.appendChild(txt);
        if (guest.locked) {
          const lock = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          lock.setAttribute('x', pos.x + 7); lock.setAttribute('y', pos.y - 7);
          lock.setAttribute('font-size', '7'); lock.setAttribute('pointer-events', 'none');
          lock.textContent = '🔒';
          seatG.appendChild(lock);
        }
      }

      seatG.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSeatClick(table.id, idx, guest || null);
      });
      g.appendChild(seatG);
    });

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
      const dims = TABLE_DIMS[table.shape] || TABLE_DIMS.rectangular;
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

    const dims = TABLE_DIMS[table.shape] || TABLE_DIMS.rectangular;
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
      const newX = this._snap(Math.max(0, Math.min(CANVAS_W, p.x - this._dragging.startX)));
      const newY = this._snap(Math.max(0, Math.min(CANVAS_H, p.y - this._dragging.startY)));
      if (Math.abs(newX - table.x) > 2 || Math.abs(newY - table.y) > 2) this._didDrag = true;
      table.x = newX; table.y = newY;
      this._applyDragTransform(table, g);
    };
    const onUp = () => {
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
      const newX = this._snap(Math.max(0, Math.min(CANVAS_W, p.x - this._dragging.startX)));
      const newY = this._snap(Math.max(0, Math.min(CANVAS_H, p.y - this._dragging.startY)));
      if (Math.abs(newX - table.x) > 2 || Math.abs(newY - table.y) > 2) this._didDrag = true;
      table.x = newX; table.y = newY;
      this._applyDragTransform(table, g);
    };
    const onEnd = () => {
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
    // Pan by middle-mouse or two-finger touch
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scale = e.deltaY > 0 ? 1.1 : 0.9;
      this._zoom(scale);
    }, { passive: false });

    this.svg.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) this._pinchDist = this._getTouchDist(e);
    }, { passive: true });

    this.svg.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && this._pinchDist !== null) {
        e.preventDefault();
        const newDist = this._getTouchDist(e);
        const scale = this._pinchDist / newDist;
        this._zoom(scale);
        this._pinchDist = newDist;
      }
    }, { passive: false });

    this.svg.addEventListener('touchend', () => { this._pinchDist = null; });
  }

  _getTouchDist(e) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  zoomIn() { this._zoom(0.8); }
  zoomOut() { this._zoom(1.25); }
  resetView() {
    this.viewBox = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
    this._applyViewBox();
  }

  _zoom(scale) {
    const cx = this.viewBox.x + this.viewBox.w / 2;
    const cy = this.viewBox.y + this.viewBox.h / 2;
    const newW = Math.max(200, Math.min(CANVAS_W * 3, this.viewBox.w * scale));
    const newH = Math.max(140, Math.min(CANVAS_H * 3, this.viewBox.h * scale));
    this.viewBox = { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
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
