'use strict';
// Editor UI: panels, preview, selection, history and files.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const STORE = 'gradient-atlas:project';
  const icon = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const clone = o => JSON.parse(JSON.stringify(o));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  let project;
  let sel = null; // selected cell id
  let selStop = 0; // selected stop of a gradient cell
  let clip = null; // copied cell
  let lastLayout = null; // layout of the preview canvas, in canvas pixels
  let previewImage = null;
  let drawQueued = false;
  let drag = null;
  const hist = { stack: [], i: -1 };

  const view = $('#view');
  const viewCtx = view.getContext('2d');

  const FMT = {
    int: v => String(Math.round(v)),
    pct: v => Math.round(v * 100) + '%',
    deg: v => Math.round(v) + '°',
    px: v => Math.round(v * scale()) + ' px',
    shade: v => (Math.abs(v) < 0.005 ? 'Base' : (v > 0 ? 'Lighter ' : 'Darker ') + Math.round(Math.abs(v) * 100) + '%'),
  };

  // ---------- State helpers ----------

  function find(id) {
    for (let ri = 0; ri < project.rows.length; ri++) {
      const row = project.rows[ri];
      const ci = row.cells.findIndex(c => c.id === id);
      if (ci >= 0) return { row, ri, cell: row.cells[ci], ci };
    }
    return null;
  }
  const current = () => (sel ? find(sel) : null);
  const scale = () => Math.min(project.width, project.height) / Atlas.REF;
  const palColor = id => (project.palette.find(p => p.id === id) || project.palette[0]).color;
  const shadeHex = (hex, t) => Color.rgbToHex(Color.shade(hex, t, project.shading));
  const stopHex = st => shadeHex(palColor(st.c), st.s);
  const stopIndex = c => (c.source === 'gradient' ? Math.min(selStop, c.stops.length - 1) : 0);
  const allCells = () => project.rows.flatMap(r => r.cells);

  function setPath(obj, path, v) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    keys.reduce((o, k) => o[k], obj)[lastKey] = v;
  }

  function cloneCell(c) {
    return Object.assign(clone(c), { id: Atlas.uid('c') });
  }

  function nextPalId(id, step = 1) {
    const P = project.palette;
    const i = P.findIndex(p => p.id === id);
    return P[(((i < 0 ? 0 : i) + step) % P.length + P.length) % P.length].id;
  }

  function ensureStops(c) {
    if (!c.stops.length) c.stops.push({ c: project.palette[0].id, s: 0, p: 0 });
    if (c.source === 'gradient' && c.stops.length < 2) {
      const next = nextPalId(c.stops[0].c);
      c.stops[0].p = 0;
      c.stops.push({ c: next, s: next === c.stops[0].c ? -0.6 : 0, p: 1 });
    }
    selStop = 0;
  }

  // Keeps the total weight, gives one item the share v and scales the rest.
  function setShare(list, item, key, v) {
    const total = list.reduce((a, x) => a + x[key], 0);
    const rest = total - item[key];
    if (rest <= 0) return;
    const k = ((1 - v) * total) / rest;
    for (const x of list) x[key] = x === item ? v * total : x[key] * k;
  }

  // ---------- History and storage ----------

  function commit() {
    const snap = JSON.stringify(project);
    if (hist.stack[hist.i] === snap) return;
    hist.stack.length = hist.i + 1;
    hist.stack.push(snap);
    if (hist.stack.length > 200) hist.stack.shift();
    hist.i = hist.stack.length - 1;
    persist(snap);
    syncUndo();
  }

  function travel(d) {
    const i = hist.i + d;
    if (i < 0 || i >= hist.stack.length) return;
    hist.i = i;
    project = JSON.parse(hist.stack[i]);
    if (sel && !find(sel)) sel = null;
    persist(hist.stack[i]);
    renderAll();
  }

  function persist(snap) {
    try { localStorage.setItem(STORE, snap); } catch (e) { /* storage blocked: the editor still works */ }
  }

  function syncUndo() {
    $('#undo').disabled = hist.i <= 0;
    $('#redo').disabled = hist.i >= hist.stack.length - 1;
  }

  function load(p) {
    project = Atlas.normalize(p);
    sel = null;
    selStop = 0;
    renderAll();
    commit();
  }

  function done() {
    renderAll();
    commit();
  }

  // ---------- Controls ----------

  function range({ label, bind, min, max, step = 1, value, mul = 1, fmt = 'int', track = '' }) {
    const pct = ((value * mul - min) / (max - min)) * 100;
    const style = track ? `--track:${track}` : `--pct:${pct}%`;
    return `<div class="field"><div class="field-top"><label>${label}</label><output>${FMT[fmt](value)}</output></div>
      <input type="range" data-bind="${bind}" data-mul="${mul}" data-fmt="${fmt}" min="${min}" max="${max}" step="${step}" value="${value * mul}" style="${style}" aria-label="${label}"></div>`;
  }

  function seg(bind, value, options) {
    return `<div class="seg" data-seg="${bind}">${options.map(([v, label, title]) =>
      `<button type="button" data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}"${title ? ` title="${title}" aria-label="${title}"` : ''}>${label}</button>`).join('')}</div>`;
  }

  function toggle(bind, value, label, hint) {
    return `<label class="switch"><span><b>${label}</b><small>${hint}</small></span>
      <input type="checkbox" data-bind="${bind}"${value ? ' checked' : ''}><i></i></label>`;
  }

  function colorField(label, bind, value) {
    return `<div class="field"><div class="field-top"><label>${label}</label><output>${value}</output></div>
      <label class="swatch wide" style="--c:${value}"><input type="color" data-bind="${bind}" value="${value.toLowerCase()}" aria-label="${label}"></label></div>`;
  }

  function chips(current) {
    return `<div class="chips">${project.palette.map(p =>
      `<button type="button" class="chip${p.id === current ? ' on' : ''}" data-chip="${p.id}" style="--c:${p.color}" title="${p.color}" aria-label="Use ${p.color}"></button>`).join('')}</div>`;
  }

  function shadeTrack(hex) {
    return `linear-gradient(90deg, ${[-1, -0.5, 0, 0.5, 1].map((t, i) => `${shadeHex(hex, t)} ${i * 25}%`).join(', ')})`;
  }

  const rampHtml = hex => [1, 0.66, 0.33, 0, -0.33, -0.66, -1].map(t => `<i style="background:${shadeHex(hex, t)}"></i>`).join('');

  // ---------- Panels ----------

  function renderAll() {
    $('#projName').value = project.name;
    $('#sizeW').value = project.width;
    $('#sizeH').value = project.height;
    $('#harmony').value = project.harmony;
    renderPalette();
    renderSheet();
    renderInspector();
    draw();
    syncUndo();
  }

  function renderPalette() {
    $('#palCount').textContent = project.palette.length;
    $('#palList').innerHTML = project.palette.map(p => `
      <div class="pal-item">
        <label class="swatch" data-swatch="${p.id}" style="--c:${p.color}" title="Pick a colour">
          <input type="color" value="${p.color.toLowerCase()}" data-pal-color="${p.id}" aria-label="Colour ${p.color}">
        </label>
        <div class="pal-mid">
          <input class="hex" value="${p.color}" data-pal-hex="${p.id}" spellcheck="false" maxlength="7" aria-label="Hex code">
          <div class="ramp" data-ramp="${p.id}">${rampHtml(p.color)}</div>
        </div>
        <button class="icon-btn sm${p.locked ? ' on' : ''}" data-act="pal-lock" data-id="${p.id}" title="${p.locked ? 'Unlock' : 'Lock: keep this colour when generating'}">${icon(p.locked ? 'lock' : 'unlock')}</button>
        <button class="icon-btn sm danger" data-act="pal-del" data-id="${p.id}" title="Remove colour">${icon('x')}</button>
      </div>`).join('');
  }

  // Updates colours shown in the panels without rebuilding inputs that may be in use.
  function refreshColors() {
    for (const p of project.palette) {
      $$(`[data-swatch="${p.id}"], [data-chip="${p.id}"]`).forEach(el => el.style.setProperty('--c', p.color));
      const ramp = $(`[data-ramp="${p.id}"]`);
      if (ramp) ramp.innerHTML = rampHtml(p.color);
    }
    const f = current();
    if (!f) return;
    const c = f.cell;
    const fill = $('#gbar .gbar-fill');
    if (fill) fill.style.background = Atlas.cssGradient(c, project);
    $$('#gbar .handle').forEach(h => {
      const st = c.stops[+h.dataset.stop];
      if (st) h.style.setProperty('--c', stopHex(st));
    });
    const shadeRange = $('[data-bind="s:s"]');
    if (shadeRange) shadeRange.style.setProperty('--track', shadeTrack(palColor(c.stops[stopIndex(c)].c)));
  }

  function renderSheet() {
    const p = project;
    $('#shading').innerHTML = `
      ${range({ label: 'Hue shift', bind: 'p:shading.hue', min: 0, max: 45, value: p.shading.hue, fmt: 'deg' })}
      ${range({ label: 'Highlights', bind: 'p:shading.light', min: 0, max: 150, value: p.shading.light, mul: 100, fmt: 'pct' })}
      ${range({ label: 'Shadows', bind: 'p:shading.dark', min: 0, max: 150, value: p.shading.dark, mul: 100, fmt: 'pct' })}
      <div class="hint">Lighter shades drift towards yellow and darker ones towards blue, like hand-painted ramps.</div>`;
    $('#sheet').innerHTML = `
      ${range({ label: 'Outer margin', bind: 'p:margin', min: 0, max: 128, value: p.margin, fmt: 'px' })}
      ${range({ label: 'Gap between cells', bind: 'p:gap', min: 0, max: 64, value: p.gap, fmt: 'px' })}
      <div class="field"><div class="field-top"><label>Gaps</label></div>
        ${seg('p:gapFill', p.gapFill, [['color', 'Colour'], ['bleed', 'Cell bleed']])}</div>
      ${p.gapFill === 'color'
        ? colorField('Gap colour', 'p:gapColor', p.gapColor)
        : '<div class="hint" style="margin:-4px 0 14px">Gaps take the colour of the nearest cell, so texture filtering and mipmaps never pick up a border.</div>'}
      <div class="field"><div class="field-top"><label>Gradient mixing</label></div>
        ${seg('p:mix', p.mix, [['oklab', 'OKLab', 'Perceptual: even, clean midtones'], ['srgb', 'sRGB', 'Classic: like CSS and most apps']])}</div>`;
  }

  function renderInspector() {
    const box = $('#inspector');
    const f = current();
    if (!f) {
      box.innerHTML = emptyInspector();
      return;
    }
    const { row, ri, cell: c, ci } = f;
    const sumW = row.cells.reduce((a, x) => a + x.w, 0);
    const sumH = project.rows.reduce((a, r) => a + r.h, 0);
    const kind = { solid: 'Solid', gradient: 'Gradient', shades: 'Shades' }[c.source];
    const blend = c.source === 'solid' ? '' : ' · ' + { smooth: 'Smooth', steps: 'Steps', mosaic: 'Mosaic' }[c.mode];
    let h = `
      <div class="insp-head">
        <div><div class="eyebrow">${kind}${blend}</div><div class="insp-title">Row ${ri + 1} · Cell ${ci + 1}</div></div>
        <div class="tools">
          <button class="icon-btn" data-act="cell-left" title="Move left"${ci === 0 ? ' disabled' : ''}>${icon('left')}</button>
          <button class="icon-btn" data-act="cell-right" title="Move right"${ci === row.cells.length - 1 ? ' disabled' : ''}>${icon('right')}</button>
          <button class="icon-btn" data-act="cell-dup" title="Duplicate (Ctrl+D)">${icon('copy')}</button>
          <button class="icon-btn danger" data-act="cell-del" title="Delete (Del)">${icon('trash')}</button>
        </div>
      </div>
      <section class="group">
        <div class="group-title">Colour</div>
        ${seg('k:source', c.source, [['solid', 'Solid'], ['gradient', 'Gradient'], ['shades', 'Shades']])}
        ${sourceBody(c)}
      </section>`;
    if (c.source !== 'solid') {
      h += `
      <section class="group">
        <div class="group-title">Direction</div>
        ${seg('k:shape', c.shape, [['linear', 'Linear'], ['radial', 'Radial']])}
        ${c.shape === 'linear' ? seg('k:angle', c.angle, [
          [0, icon('arrow-right'), 'Left to right'], [90, icon('arrow-down'), 'Top to bottom'],
          [45, icon('arrow-dr'), 'Diagonal down'], [315, icon('arrow-ur'), 'Diagonal up'],
        ]) + range({ label: 'Angle', bind: 'k:angle', min: 0, max: 359, value: c.angle, fmt: 'deg' }) : ''}
      </section>
      <section class="group">
        <div class="group-title">Blend</div>
        ${seg('k:mode', c.mode, [['smooth', 'Smooth'], ['steps', 'Steps'], ['mosaic', 'Mosaic']])}
        ${modeBody(c)}
        ${c.shape === 'linear' ? toggle('k:seamless', c.seamless, 'Seamless', 'Mirrors the gradient so the cell tiles without a seam') : ''}
        <div class="tile-wrap"><canvas class="tile-prev" id="tilePrev"></canvas></div>
        <div class="hint" style="text-align:center">Tiling preview (3 × 3)</div>
      </section>`;
    }
    h += `
      <section class="group">
        <div class="group-title">Size</div>
        ${row.cells.length > 1 ? range({ label: 'Width in row', bind: 'share:cell', min: 3, max: 97, value: c.w / sumW, mul: 100, fmt: 'pct' }) : ''}
        ${project.rows.length > 1 ? range({ label: 'Row height', bind: 'share:row', min: 3, max: 97, value: row.h / sumH, mul: 100, fmt: 'pct' }) : ''}
        <div class="hint" style="margin-top:0">You can also drag the gaps in the preview.</div>
      </section>
      <section class="group">
        <div class="group-title">Row ${ri + 1}</div>
        <div class="btn-grid">
          <button class="btn" data-act="cell-add" title="Add a similar cell with the next palette colour">${icon('plus')} Cell</button>
          <button class="btn" data-act="row-add">${icon('plus')} Row below</button>
          <button class="btn" data-act="row-dup">${icon('copy')} Duplicate row</button>
          <div class="btn-pair">
            <button class="btn" data-act="row-up" title="Move row up"${ri === 0 ? ' disabled' : ''}>${icon('up')}</button>
            <button class="btn" data-act="row-down" title="Move row down"${ri === project.rows.length - 1 ? ' disabled' : ''}>${icon('down')}</button>
          </div>
          <button class="btn danger" data-act="row-del">${icon('trash')} Delete row</button>
        </div>
      </section>
      <section class="group">
        <div class="group-title">Reuse</div>
        <div class="btn-grid">
          <button class="btn" data-act="copy" title="Copy cell (Ctrl+C)">${icon('copy')} Copy cell</button>
          <button class="btn" data-act="paste" title="Paste onto this cell (Ctrl+V)"${clip ? '' : ' disabled'}>${icon('paste')} Paste cell</button>
          <button class="btn" data-act="look-row" title="Give the whole row this direction and blend; colours stay">Blend to row</button>
          <button class="btn" data-act="look-all" title="Give every cell this direction and blend; colours stay">Blend to all</button>
        </div>
      </section>`;
    box.innerHTML = h;
    refreshColors();
    drawTilePreview();
  }

  function sourceBody(c) {
    if (c.source === 'gradient') {
      const i = stopIndex(c);
      const st = c.stops[i];
      return `
        <div class="gbar" id="gbar"><div class="gbar-fill"></div>${c.stops.map((s, k) =>
          `<div class="handle${k === i ? ' on' : ''}" data-stop="${k}" style="left:${s.p * 100}%" title="Stop ${k + 1}"></div>`).join('')}</div>
        <div class="gbar-tools">
          <span class="hint">Click the bar to add a stop, drag one away to remove it</span>
          <button class="icon-btn sm" data-act="stops-even" title="Space stops evenly">${icon('spread')}</button>
          <button class="icon-btn sm" data-act="stops-rev" title="Reverse">${icon('swap')}</button>
        </div>
        <div class="sub">Stop ${i + 1} of ${c.stops.length}</div>
        ${chips(st.c)}
        ${range({ label: 'Shade', bind: 's:s', min: -100, max: 100, value: st.s, mul: 100, fmt: 'shade', track: shadeTrack(palColor(st.c)) })}`;
    }
    const st = c.stops[0];
    if (c.source === 'solid') {
      return chips(st.c) + range({ label: 'Shade', bind: 's:s', min: -100, max: 100, value: st.s, mul: 100, fmt: 'shade', track: shadeTrack(palColor(st.c)) });
    }
    return chips(st.c)
      + range({ label: 'Light end', bind: 'k:light', min: 0, max: 150, value: c.light, mul: 100, fmt: 'pct' })
      + range({ label: 'Dark end', bind: 'k:dark', min: 0, max: 150, value: c.dark, mul: 100, fmt: 'pct' });
  }

  function modeBody(c) {
    if (c.mode === 'steps') return range({ label: 'Steps', bind: 'k:steps', min: 2, max: 24, value: c.steps });
    if (c.mode === 'mosaic') {
      return range({ label: 'Tile size', bind: 'k:tile', min: 2, max: 128, value: c.tile, fmt: 'px' })
        + range({ label: 'Jitter', bind: 'k:jitter', min: 0, max: 100, value: c.jitter, mul: 100, fmt: 'pct' })
        + `<button class="btn sm wide" data-act="reseed" style="margin:-2px 0 14px">${icon('dice')} Reshuffle tiles</button>`;
    }
    return range({ label: 'Hardness', bind: 'k:hardness', min: 0, max: 100, value: c.hardness, mul: 100, fmt: 'pct' });
  }

  function emptyInspector() {
    const sample = project.palette.slice(0, 9).map(p => `<i style="background:${p.color}"></i>`).join('');
    return `<div class="empty">
      <div class="empty-art">${sample}</div>
      <h3>Pick a cell</h3>
      <p>Click any cell in the atlas to change its colours, blend and size.</p>
      <button class="btn" data-act="row-add-end">${icon('rows')} Add row</button>
      <div class="keys">
        <div><kbd>Space</kbd><span>New palette</span></div>
        <div><kbd>Ctrl Z</kbd><kbd>Ctrl Y</kbd><span>Undo, redo</span></div>
        <div><kbd>← ↑ → ↓</kbd><span>Move between cells</span></div>
        <div><kbd>Ctrl D</kbd><span>Duplicate cell</span></div>
        <div><kbd>Ctrl C</kbd><kbd>Ctrl V</kbd><span>Copy, paste cell</span></div>
        <div><kbd>Del</kbd><span>Delete cell</span></div>
        <div><kbd>Ctrl S</kbd><span>Export PNG</span></div>
      </div>
    </div>`;
  }

  // ---------- Preview ----------

  function draw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      drawNow();
    });
  }

  function drawNow() {
    const stage = $('#stageInner');
    const pad = 32;
    const availW = Math.max(80, stage.clientWidth - pad * 2);
    const availH = Math.max(80, stage.clientHeight - pad * 2);
    const ar = project.width / project.height;
    let cw = availW;
    let ch = cw / ar;
    if (ch > availH) {
      ch = availH;
      cw = ch * ar;
    }
    cw = Math.floor(cw);
    ch = Math.floor(ch);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = Math.min(1, 2048 / Math.max(cw * dpr, ch * dpr));
    const pw = Math.max(1, Math.round(cw * dpr * k));
    const ph = Math.max(1, Math.round(ch * dpr * k));
    if (view.width !== pw || view.height !== ph) {
      view.width = pw;
      view.height = ph;
    }
    view.style.width = cw + 'px';
    view.style.height = ch + 'px';
    previewImage = Atlas.render(project, pw, ph, previewImage);
    viewCtx.putImageData(previewImage, 0, 0);
    lastLayout = Atlas.layout(project, pw, ph);
    buildOverlay(cw / pw);
    drawTilePreview();
    const cells = allCells().length;
    $('#sizeInfo').textContent = `${project.width} × ${project.height} px · ${cells} ${cells === 1 ? 'cell' : 'cells'}`;
  }

  function buildOverlay(k) {
    const L = lastLayout;
    let h = '';
    for (const R of L.rows) {
      for (const C of R.cells) {
        h += `<div class="hit${C.cell.id === sel ? ' on' : ''}" data-cell="${C.cell.id}" style="left:${C.x0 * k}px;top:${R.y0 * k}px;width:${(C.x1 - C.x0) * k}px;height:${(R.y1 - R.y0) * k}px"></div>`;
      }
      for (let ci = 0; ci < R.cells.length - 1; ci++) {
        const x = ((R.cells[ci].x1 + R.cells[ci + 1].x0) / 2) * k;
        h += `<div class="gut v" data-gut="c:${R.ri}:${ci}" style="left:${x - 5}px;top:${R.y0 * k}px;height:${(R.y1 - R.y0) * k}px"></div>`;
      }
      if (R.ri < L.rows.length - 1) {
        const y = ((R.y1 + L.rows[R.ri + 1].y0) / 2) * k;
        h += `<div class="gut h" data-gut="r:${R.ri}" style="top:${y - 5}px;left:${L.M * k}px;width:${(L.W - 2 * L.M) * k}px"></div>`;
      }
    }
    $('#overlay').innerHTML = h;
  }

  function drawTilePreview() {
    const tc = $('#tilePrev');
    const f = current();
    if (!tc || !f || !lastLayout) return;
    const R = lastLayout.rows[f.ri];
    const C = R && R.cells[f.ci];
    if (!C) return;
    const cw = C.x1 - C.x0;
    const ch = R.y1 - R.y0;
    if (cw < 1 || ch < 1) return;
    const t = Math.min((tc.parentElement.clientWidth || 280) / 3 / cw, 150 / 3 / ch);
    const tw = Math.max(1, Math.floor(cw * t));
    const th = Math.max(1, Math.floor(ch * t));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    tc.width = Math.round(tw * 3 * dpr);
    tc.height = Math.round(th * 3 * dpr);
    tc.style.width = tw * 3 + 'px';
    tc.style.height = th * 3 + 'px';
    const ctx = tc.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const sw = tc.width / 3;
    const sh = tc.height / 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) ctx.drawImage(view, C.x0, R.y0, cw, ch, Math.round(i * sw), Math.round(j * sh), Math.round(sw), Math.round(sh));
    }
  }

  // ---------- Selection ----------

  function select(id) {
    sel = id;
    selStop = 0;
    $$('#overlay .hit').forEach(h => h.classList.toggle('on', h.dataset.cell === id));
    renderInspector();
  }

  function moveSelection(key) {
    const f = current();
    if (!f) return select(project.rows[0].cells[0].id);
    if (key === 'ArrowLeft' && f.ci > 0) return select(f.row.cells[f.ci - 1].id);
    if (key === 'ArrowRight' && f.ci < f.row.cells.length - 1) return select(f.row.cells[f.ci + 1].id);
    if ((key === 'ArrowUp' || key === 'ArrowDown') && lastLayout) {
      const ri = f.ri + (key === 'ArrowUp' ? -1 : 1);
      if (ri < 0 || ri >= project.rows.length) return;
      const C = lastLayout.rows[f.ri].cells[f.ci];
      const cx = (C.x0 + C.x1) / 2;
      let best = null;
      for (const D of lastLayout.rows[ri].cells) {
        if (!best || Math.abs((D.x0 + D.x1) / 2 - cx) < Math.abs((best.x0 + best.x1) / 2 - cx)) best = D;
      }
      if (best) select(best.cell.id);
    }
  }

  // ---------- Actions ----------

  function applyLook(cells) {
    const f = current();
    if (!f) return;
    for (const c of cells) if (c !== f.cell) for (const k of Atlas.LOOK_KEYS) c[k] = f.cell[k];
    done();
  }

  function sheetSettings() {
    const { width, height, margin, gap, gapFill, gapColor, mix, harmony } = project;
    return { width, height, margin, gap, gapFill, gapColor, mix, harmony, shading: clone(project.shading) };
  }

  const ACTIONS = {
    undo: () => travel(-1),
    redo: () => travel(1),

    'new-example'() {
      load(Atlas.exampleProject());
      toast('Example atlas loaded · Ctrl+Z to go back');
    },
    'new-blank'() {
      load(Object.assign(Atlas.blankProject(clone(project.palette)), sheetSettings()));
      toast('Blank grid · Ctrl+Z to go back');
    },
    'new-random'() {
      load(Object.assign(Atlas.randomProject(clone(project.palette)), sheetSettings()));
      toast('Random atlas · Ctrl+Z to go back');
    },

    'pal-add'() {
      const temp = project.palette.map(p => Object.assign({}, p, { locked: true })).concat({ color: '#808080', locked: false });
      const color = Color.generate(temp, project.harmony).pop();
      project.palette.push({ id: Atlas.uid('p'), color, locked: false });
      done();
    },
    'pal-del'(el) {
      if (project.palette.length <= 1) return toast('Keep at least one colour', true);
      const gone = project.palette.find(p => p.id === el.dataset.id);
      project.palette = project.palette.filter(p => p !== gone);
      let best = project.palette[0];
      for (const p of project.palette) if (Color.distance(p.color, gone.color) < Color.distance(best.color, gone.color)) best = p;
      for (const c of allCells()) for (const st of c.stops) if (st.c === gone.id) st.c = best.id;
      done();
      toast('Colour removed, its cells use the closest one · Ctrl+Z to undo');
    },
    'pal-lock'(el) {
      const p = project.palette.find(x => x.id === el.dataset.id);
      p.locked = !p.locked;
      renderPalette();
      commit();
    },
    'pal-gen'() {
      if (project.palette.every(p => p.locked)) return toast('Every colour is locked', true);
      const cols = Color.generate(project.palette, project.harmony);
      project.palette.forEach((p, i) => { p.color = cols[i]; });
      done();
    },

    'cell-left'() {
      const f = current();
      if (!f || f.ci === 0) return;
      f.row.cells.splice(f.ci - 1, 0, f.row.cells.splice(f.ci, 1)[0]);
      done();
    },
    'cell-right'() {
      const f = current();
      if (!f || f.ci >= f.row.cells.length - 1) return;
      f.row.cells.splice(f.ci + 1, 0, f.row.cells.splice(f.ci, 1)[0]);
      done();
    },
    'cell-dup'() {
      const f = current();
      if (!f) return;
      const c = cloneCell(f.cell);
      f.row.cells.splice(f.ci + 1, 0, c);
      sel = c.id;
      done();
    },
    'cell-add'() {
      const f = current();
      if (!f) return;
      const c = cloneCell(f.cell);
      c.stops.forEach(st => { st.c = nextPalId(st.c); });
      f.row.cells.splice(f.ci + 1, 0, c);
      sel = c.id;
      done();
    },
    'cell-del'() {
      const f = current();
      if (!f) return;
      if (f.row.cells.length === 1) {
        if (project.rows.length === 1) return toast('The atlas needs at least one cell', true);
        project.rows.splice(f.ri, 1);
        const near = project.rows[Math.min(f.ri, project.rows.length - 1)];
        sel = near.cells[0].id;
      } else {
        f.row.cells.splice(f.ci, 1);
        sel = f.row.cells[Math.min(f.ci, f.row.cells.length - 1)].id;
      }
      done();
      toast('Cell deleted · Ctrl+Z to undo');
    },

    'row-add'() {
      const f = current();
      const ref = f ? f.row : project.rows[project.rows.length - 1];
      const at = f ? f.ri + 1 : project.rows.length;
      const P = project.palette;
      const n = ref ? ref.cells.length : 4;
      const cells = Array.from({ length: n }, (_, i) => Atlas.cell({ stops: [{ c: P[i % P.length].id, s: 0, p: 0 }] }));
      project.rows.splice(at, 0, { id: Atlas.uid('r'), h: ref ? ref.h : 120, cells });
      sel = cells[0].id;
      done();
    },
    'row-add-end'() {
      sel = null;
      ACTIONS['row-add']();
    },
    'row-dup'() {
      const f = current();
      if (!f) return;
      const r = { id: Atlas.uid('r'), h: f.row.h, cells: f.row.cells.map(cloneCell) };
      project.rows.splice(f.ri + 1, 0, r);
      sel = r.cells[f.ci].id;
      done();
    },
    'row-up'() {
      const f = current();
      if (!f || f.ri === 0) return;
      project.rows.splice(f.ri - 1, 0, project.rows.splice(f.ri, 1)[0]);
      done();
    },
    'row-down'() {
      const f = current();
      if (!f || f.ri >= project.rows.length - 1) return;
      project.rows.splice(f.ri + 1, 0, project.rows.splice(f.ri, 1)[0]);
      done();
    },
    'row-del'() {
      const f = current();
      if (!f) return;
      if (project.rows.length === 1) return toast('The atlas needs at least one row', true);
      project.rows.splice(f.ri, 1);
      sel = project.rows[Math.min(f.ri, project.rows.length - 1)].cells[0].id;
      done();
      toast('Row deleted · Ctrl+Z to undo');
    },

    copy() {
      const f = current();
      if (!f) return;
      clip = clone(f.cell);
      renderInspector();
      toast('Cell copied');
    },
    paste() {
      const f = current();
      if (!f || !clip) return;
      const ids = new Set(project.palette.map(p => p.id));
      const c = Object.assign(clone(clip), { id: f.cell.id, w: f.cell.w });
      c.stops.forEach(st => { if (!ids.has(st.c)) st.c = project.palette[0].id; });
      f.row.cells[f.ci] = c;
      done();
    },
    'look-row'() {
      const f = current();
      if (f) applyLook(f.row.cells);
    },
    'look-all'() {
      applyLook(allCells());
    },

    'stops-even'() {
      const f = current();
      if (!f) return;
      f.cell.stops.forEach((s, i, a) => { s.p = i / (a.length - 1); });
      done();
    },
    'stops-rev'() {
      const f = current();
      if (!f) return;
      f.cell.stops.reverse().forEach(s => { s.p = 1 - s.p; });
      selStop = f.cell.stops.length - 1 - selStop;
      done();
    },
    reseed() {
      const f = current();
      if (!f) return;
      f.cell.seed = Math.floor(Math.random() * 1e6);
      draw();
      commit();
    },

    open: () => $('#fileInput').click(),
    export: exportPng,
  };

  // ---------- Files ----------

  function fileName() {
    const slug = project.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'atlas';
    return `${slug}-${project.width}x${project.height}.png`;
  }

  async function exportPng() {
    const W = project.width;
    const H = project.height;
    toast(`Rendering ${W} × ${H}…`, false, true);
    await new Promise(r => setTimeout(r, 30));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      canvas.getContext('2d').putImageData(Atlas.render(project, W, H), 0, 0);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const bytes = Atlas.embed(new Uint8Array(await blob.arrayBuffer()), JSON.stringify(project));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(`Saved ${a.download}`);
    } catch (e) {
      toast('Export failed: ' + e.message, true);
    }
  }

  async function openFile(file) {
    if (!file) return;
    const json = Atlas.extract(new Uint8Array(await file.arrayBuffer()));
    if (!json) return toast('This PNG has no Gradient Atlas data', true);
    try {
      load(JSON.parse(json));
      toast(`Opened ${file.name}`);
    } catch (e) {
      toast('Could not read the atlas data in this PNG', true);
    }
  }

  // ---------- Toast ----------

  let toastTimer = 0;
  function toast(msg, warn = false, sticky = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('warn', !!warn);
    el.classList.add('show');
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // ---------- Input handling ----------

  function apply(bind, v) {
    const [scope, key] = bind.split(':');
    const f = current();
    if (scope === 'p') setPath(project, key, v);
    else if (!f) return;
    else if (scope === 'k') f.cell[key] = v;
    else if (scope === 's') f.cell.stops[stopIndex(f.cell)][key] = v;
    else if (scope === 'share') {
      if (key === 'cell') setShare(f.row.cells, f.cell, 'w', v);
      else setShare(project.rows, f.row, 'h', v);
    }
  }

  function onRange(el, final) {
    const bind = el.dataset.bind;
    const v = +el.value / +el.dataset.mul;
    apply(bind, v);
    el.closest('.field').querySelector('output').textContent = FMT[el.dataset.fmt](v);
    if (!el.style.getPropertyValue('--track')) el.style.setProperty('--pct', ((el.value - el.min) / (el.max - el.min)) * 100 + '%');
    $$(`[data-seg="${bind}"] button`).forEach(b => b.classList.toggle('on', +b.dataset.v === v));
    if (bind.startsWith('p:shading') || bind === 's:s') refreshColors();
    draw();
    if (final) commit();
  }

  function setPaletteColor(id, hex, final) {
    const p = project.palette.find(x => x.id === id);
    if (!p) return;
    p.color = hex;
    const hexInput = $(`[data-pal-hex="${id}"]`);
    if (hexInput && document.activeElement !== hexInput) hexInput.value = hex;
    const picker = $(`[data-pal-color="${id}"]`);
    if (picker && document.activeElement !== picker) picker.value = hex.toLowerCase();
    refreshColors();
    draw();
    if (final) commit();
  }

  function onSeg(btn) {
    const bind = btn.parentElement.dataset.seg;
    const raw = btn.dataset.v;
    apply(bind, /^-?\d+(\.\d+)?$/.test(raw) ? +raw : raw);
    if (bind === 'k:source') ensureStops(current().cell);
    if (bind.startsWith('p:')) renderSheet();
    else renderInspector();
    draw();
    commit();
  }

  function onChip(chip) {
    const f = current();
    if (!f) return;
    f.cell.stops[stopIndex(f.cell)].c = chip.dataset.chip;
    renderInspector();
    draw();
    commit();
  }

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('input[type=range][data-bind]')) onRange(t, false);
    else if (t.matches('[data-pal-color]')) setPaletteColor(t.dataset.palColor, t.value.toUpperCase(), false);
    else if (t.matches('input[type=color][data-bind]')) {
      const hex = t.value.toUpperCase();
      apply(t.dataset.bind, hex);
      t.parentElement.style.setProperty('--c', hex);
      t.closest('.field').querySelector('output').textContent = hex;
      draw();
    }
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('input[type=range][data-bind]')) onRange(t, true);
    else if (t.matches('[data-pal-color]')) setPaletteColor(t.dataset.palColor, t.value.toUpperCase(), true);
    else if (t.matches('[data-pal-hex]')) {
      const hex = Color.parseHex(t.value);
      if (hex) setPaletteColor(t.dataset.palHex, hex, true);
      t.value = palColor(t.dataset.palHex);
    } else if (t.matches('input[type=color][data-bind]')) commit();
    else if (t.matches('input[type=checkbox][data-bind]')) {
      apply(t.dataset.bind, t.checked);
      draw();
      commit();
    } else if (t.id === 'projName') {
      project.name = t.value.trim() || 'Atlas';
      t.value = project.name;
      commit();
    } else if (t.id === 'sizeW' || t.id === 'sizeH') {
      project[t.id === 'sizeW' ? 'width' : 'height'] = +t.value;
      renderSheet();
      renderInspector();
      draw();
      commit();
    } else if (t.id === 'harmony') {
      project.harmony = t.value;
      commit();
    } else if (t.id === 'fileInput') {
      openFile(t.files[0]);
      t.value = '';
    }
  });

  document.addEventListener('click', e => {
    const t = e.target;
    const act = t.closest('[data-act]');
    if (act) {
      closeMenus();
      if (!act.disabled && ACTIONS[act.dataset.act]) ACTIONS[act.dataset.act](act);
      return;
    }
    const segBtn = t.closest('[data-seg] button');
    if (segBtn) return onSeg(segBtn);
    const chip = t.closest('[data-chip]');
    if (chip) return onChip(chip);
    const hit = t.closest('.hit');
    if (hit) return select(hit.dataset.cell);
    const menuBtn = t.closest('[data-menu]');
    if (menuBtn) {
      const menu = menuBtn.parentElement;
      const open = !menu.classList.contains('open');
      closeMenus();
      menu.classList.toggle('open', open);
      return;
    }
    if (!t.closest('.menu')) closeMenus();
    if (t.closest('#stageInner') && !t.closest('.canvas-box') && sel) select(null);
  });

  function closeMenus() {
    $$('.menu.open').forEach(m => m.classList.remove('open'));
  }

  // Dragging the gaps between cells and rows.
  $('#overlay').addEventListener('pointerdown', e => {
    const gut = e.target.closest('.gut');
    if (!gut) return;
    e.preventDefault();
    const [kind, a, b] = gut.dataset.gut.split(':');
    const L = lastLayout;
    const k = view.clientWidth / view.width;
    if (kind === 'c') {
      const R = L.rows[+a];
      const i = +b;
      drag = { axis: 'x', list: R.row.cells, i, key: 'w', start: e.clientX, avail: R.availW * k, sum: R.sumW };
    } else {
      drag = { axis: 'y', list: project.rows, i: +a, key: 'h', start: e.clientY, avail: L.availH * k, sum: L.sumH };
    }
    drag.wa = drag.list[drag.i][drag.key];
    drag.wb = drag.list[drag.i + 1][drag.key];
    document.body.classList.add(drag.axis === 'x' ? 'dragging-x' : 'dragging-y');
  });

  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const pos = drag.axis === 'x' ? e.clientX : e.clientY;
    const min = drag.sum * 0.02;
    const d = clamp(((pos - drag.start) / Math.max(1, drag.avail)) * drag.sum, min - drag.wa, drag.wb - min);
    drag.list[drag.i][drag.key] = drag.wa + d;
    drag.list[drag.i + 1][drag.key] = drag.wb - d;
    draw();
  });

  window.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('dragging-x', 'dragging-y');
    // The click that ends a drag must not select the cell under the pointer.
    const swallow = ev => ev.stopPropagation();
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    renderInspector();
    commit();
  });

  // Gradient stops: click the bar to add, drag to move, drag away to remove.
  $('#inspector').addEventListener('pointerdown', e => {
    const bar = e.target.closest('#gbar');
    const f = current();
    if (!bar || !f) return;
    e.preventDefault();
    const c = f.cell;
    const rect = bar.getBoundingClientRect();
    const pos = x => clamp((x - rect.left) / rect.width, 0, 1);
    const handle = e.target.closest('.handle');
    if (handle) {
      selStop = +handle.dataset.stop;
    } else {
      const p = pos(e.clientX);
      let j = c.stops.findIndex(s => s.p > p);
      if (j < 0) j = c.stops.length;
      const left = c.stops[Math.max(0, j - 1)];
      const right = c.stops[Math.min(c.stops.length - 1, j)];
      const w = right.p > left.p ? (p - left.p) / (right.p - left.p) : 0;
      c.stops.splice(j, 0, { c: (w < 0.5 ? left : right).c, s: Math.round((left.s + (right.s - left.s) * w) * 100) / 100, p });
      selStop = j;
      draw();
    }
    renderInspector();
    const moving = c.stops[selStop];
    const startY = e.clientY;
    let removing = false;
    const move = ev => {
      moving.p = pos(ev.clientX);
      removing = c.stops.length > 2 && Math.abs(ev.clientY - startY) > 40;
      const h = $(`#gbar .handle[data-stop="${c.stops.indexOf(moving)}"]`);
      if (h) {
        h.style.left = moving.p * 100 + '%';
        h.classList.toggle('removing', removing);
      }
      refreshColors();
      draw();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (removing) {
        c.stops.splice(c.stops.indexOf(moving), 1);
        selStop = 0;
      } else {
        c.stops.sort((x, y) => x.p - y.p);
        selStop = c.stops.indexOf(moving);
      }
      renderInspector();
      draw();
      commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  document.addEventListener('keydown', e => {
    const t = e.target;
    if (t.matches('input:not([type]), input[type=text], textarea, [contenteditable]')) return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      const map = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', d: 'cell-dup', s: 'export', c: 'copy', v: 'paste' };
      if (!map[key] || ((key === 'c' || key === 'v') && !sel)) return;
      e.preventDefault();
      ACTIONS[map[key]]();
      return;
    }
    if (e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      ACTIONS['pal-gen']();
    } else if (e.key === 'Escape') {
      closeMenus();
      if (sel) select(null);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
      e.preventDefault();
      ACTIONS['cell-del']();
    } else if (e.key.startsWith('Arrow') && !t.matches('input[type=range], select')) {
      e.preventDefault();
      moveSelection(e.key);
    }
  });

  // Drop an exported PNG anywhere to open it.
  let dragDepth = 0;
  window.addEventListener('dragenter', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragDepth++;
    document.body.classList.add('dropping');
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dropping');
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dropping');
    openFile(e.dataTransfer.files[0]);
  });

  // ---------- Start ----------

  function init() {
    const sizes = Atlas.SIZES.map(s => `<option value="${s}">${s}</option>`).join('');
    $('#sizeW').innerHTML = sizes;
    $('#sizeH').innerHTML = sizes;
    $('#harmony').innerHTML = Object.entries(Color.HARMONIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE)); } catch (e) { saved = null; }
    project = Atlas.normalize(saved && saved.app === 'gradient-atlas' ? saved : Atlas.exampleProject());
    renderAll();
    commit();
    new ResizeObserver(draw).observe($('#stageInner'));
  }

  init();
})();
