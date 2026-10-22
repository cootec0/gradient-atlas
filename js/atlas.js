'use strict';
// Atlas model: defaults, layout, pixel rendering and project data stored inside the PNG.
const Atlas = (() => {
  const REF = 1024; // margin, gap and tile sizes are stored in pixels of a 1024 px sheet
  const LUT_N = 1024;
  const SIZES = [256, 512, 1024, 2048, 4096];
  const GRIDS = [2, 4, 8, 16, 32, 64, 128, 256]; // snap grid in export pixels
  const LOOK_KEYS = ['shape', 'angle', 'mode', 'steps', 'tile', 'jitter', 'hardness', 'seamless'];
  const PNG_KEY = 'gradient-atlas';

  let counter = 0;
  const uid = (prefix = 'x') => prefix + (counter++).toString(36) + Math.random().toString(36).slice(2, 7);
  const num = (v, d, lo = -Infinity, hi = Infinity) => {
    v = +v;
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  };

  // ---------- Model ----------

  function cell(over = {}) {
    return Object.assign({
      id: uid('c'),
      w: 1,
      source: 'solid', // solid | gradient | shades
      stops: [],
      light: 1,
      dark: 1,
      shape: 'linear', // linear | radial
      angle: 0,
      mode: 'smooth', // smooth | steps | mosaic
      steps: 6,
      tile: 24,
      jitter: 0.3,
      hardness: 0,
      seamless: false,
      seed: Math.floor(Math.random() * 1e6),
    }, over);
  }
  const stop = (c, s = 0, p = 0) => ({ c, s, p });
  const row = (h, cells) => ({ id: uid('r'), h, cells });
  function spread(stops) {
    stops.forEach((s, i) => { s.p = stops.length > 1 ? i / (stops.length - 1) : 0; });
    return stops;
  }

  function baseProject(palette, rows, over) {
    return Object.assign({
      app: 'gradient-atlas',
      version: 1,
      name: 'Atlas',
      width: 1024,
      height: 1024,
      margin: 0,
      gap: 0,
      snap: true,
      grid: 32,
      gapFill: 'color', // color | bleed
      gapColor: '#D0C1B1',
      mix: 'oklab', // oklab | srgb
      dither: true,
      harmony: 'earthy',
      shading: { hue: 10, light: 1, dark: 1 },
      palette,
      rows,
    }, over);
  }

  function exampleProject() {
    const palette = ['#50954A', '#ABC35B', '#2A5341', '#5A5F34', '#6B4A37', '#E68237']
      .map(color => ({ id: uid('p'), color, locked: false }));
    const P = palette.map(p => p.id);
    const g = (angle, ...st) => cell({ source: 'gradient', angle, stops: spread(st.map(([i, s]) => stop(P[i], s))) });
    const sh = (i, angle, mode, light = 1, dark = 1) => cell({ source: 'shades', angle, mode, light, dark, stops: [stop(P[i])] });
    return baseProject(palette, [
      row(137, P.map(id => cell({ stops: [stop(id)] }))),
      row(110, P.map((_, i) => sh(i, 0, 'steps'))),
      row(124, [g(0, [0, 0], [1, 0]), g(0, [2, 0], [3, 0])]),
      row(120, [g(0, [1, 0.2], [2, -0.6]), g(0, [0, 0], [0, -0.75]), g(0, [1, 0.2], [0, -0.3], [2, -1]), g(0, [0, 0], [3, -0.6])]),
      row(108, [g(0, [4, 0], [5, 0]), g(0, [5, 0], [4, -0.5]), g(0, [4, 0], [3, 0]), g(0, [5, 0.1], [3, 0])]),
      row(271, [
        sh(0, 90, 'smooth', 0.9, 0.9), sh(1, 90, 'smooth', 0.6, 1), sh(2, 90, 'smooth', 0.8, 0.8),
        sh(3, 90, 'smooth', 1, 0.8), sh(4, 90, 'smooth', 1, 0.8), sh(5, 90, 'smooth', 0.8, 1),
        g(90, [0, 0.6], [3, 0], [4, 0]), g(90, [0, 0.6], [1, -0.4], [5, 0]),
      ]),
    ], { name: 'Example atlas' });
  }

  function blankProject(palette) {
    const P = palette.map(p => p.id);
    const rows = [0, 1, 2].map(r => row(100, [0, 1, 2].map(i => cell({ stops: [stop(P[(r * 3 + i) % P.length])] }))));
    return baseProject(palette, rows, { name: 'New atlas' });
  }

  function randomProject(palette, rnd = Math.random) {
    const P = palette.map(p => p.id);
    const any = () => P[Math.floor(rnd() * P.length)];
    const shadeVal = () => Math.round((rnd() * 1.4 - 0.7) * 100) / 100;
    const rows = [];
    const rowCount = 4 + Math.floor(rnd() * 4);
    for (let r = 0; r < rowCount; r++) {
      const n = [1, 2, 3, 4, 4, 6, 6, 8][Math.floor(rnd() * 8)];
      const x = rnd();
      const source = x < 0.2 ? 'solid' : x < 0.5 ? 'shades' : 'gradient';
      const y = rnd();
      const look = {
        source,
        mode: y < 0.55 ? 'smooth' : y < 0.85 ? 'steps' : 'mosaic',
        angle: (n >= 6 && rnd() < 0.7) || rnd() < 0.15 ? 90 : 0,
        steps: 3 + Math.floor(rnd() * 6),
        tile: [8, 12, 16, 24, 32][Math.floor(rnd() * 5)],
        jitter: Math.round(rnd() * 60) / 100,
        hardness: rnd() < 0.3 ? Math.round(rnd() * 70) / 100 : 0,
        seamless: rnd() < 0.15,
      };
      const cells = [];
      for (let i = 0; i < n; i++) {
        let stops;
        if (source === 'gradient') {
          const a = any();
          let b = any();
          if (P.length > 1) while (b === a) b = any();
          stops = spread(rnd() < 0.75
            ? [stop(a, shadeVal()), stop(b, shadeVal())]
            : [stop(a, shadeVal()), stop(any(), shadeVal()), stop(b, shadeVal())]);
        } else {
          stops = [stop(source === 'shades' ? P[(r + i) % P.length] : any(), source === 'solid' ? shadeVal() : 0)];
        }
        cells.push(cell(Object.assign({}, look, { stops, light: 0.6 + rnd() * 0.4, dark: 0.6 + rnd() * 0.4 })));
      }
      rows.push(row(Math.round(80 + rnd() * 160), cells));
    }
    return baseProject(palette, rows, { name: 'Random atlas' });
  }

  // Fills gaps and fixes bad values so files from older versions or hand edits still open.
  function normalize(src) {
    src = src || {};
    const p = baseProject([], [], {});
    for (const k of ['name', 'gapColor']) if (typeof src[k] === 'string') p[k] = src[k];
    p.gapColor = Color.parseHex(p.gapColor) || '#D0C1B1';
    const nearestSize = v => SIZES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    p.width = nearestSize(num(src.width, 1024));
    p.height = nearestSize(num(src.height, 1024));
    p.margin = num(src.margin, 0, 0, 256);
    p.gap = num(src.gap, 0, 0, 256);
    p.snap = src.snap !== false;
    p.grid = GRIDS.includes(+src.grid) ? +src.grid : 32;
    p.gapFill = src.gapFill === 'bleed' ? 'bleed' : 'color';
    p.mix = src.mix === 'srgb' ? 'srgb' : 'oklab';
    p.dither = src.dither !== false;
    p.harmony = Color.HARMONIES[src.harmony] ? src.harmony : 'earthy';
    const sh = src.shading || {};
    p.shading = { hue: num(sh.hue, 10, 0, 90), light: num(sh.light, 1, 0, 2), dark: num(sh.dark, 1, 0, 2) };

    const seen = new Set();
    const freshId = (id, prefix) => {
      const out = typeof id === 'string' && id && !seen.has(id) ? id : uid(prefix);
      seen.add(out);
      return out;
    };
    p.palette = (Array.isArray(src.palette) ? src.palette : [])
      .filter(x => x && Color.parseHex(x.color))
      .map(x => ({ id: freshId(x.id, 'p'), color: Color.parseHex(x.color), locked: !!x.locked }));
    if (!p.palette.length) p.palette = [{ id: uid('p'), color: '#50954A', locked: false }];
    const ids = new Set(p.palette.map(x => x.id));
    const first = p.palette[0].id;

    p.rows = (Array.isArray(src.rows) ? src.rows : [])
      .map(r => ({
        id: freshId(r && r.id, 'r'),
        h: num(r && r.h, 100, 0.001),
        cells: (r && Array.isArray(r.cells) ? r.cells : []).map(c => normalizeCell(c, ids, first, freshId)),
      }))
      .filter(r => r.cells.length);
    if (!p.rows.length) p.rows = [row(100, [cell({ stops: [stop(first)] })])];
    return p;
  }

  function normalizeCell(c, ids, first, freshId) {
    c = c || {};
    const out = cell();
    out.id = freshId(c.id, 'c');
    out.w = num(c.w, 1, 0.001);
    out.source = ['solid', 'gradient', 'shades'].includes(c.source) ? c.source : 'solid';
    out.shape = c.shape === 'radial' ? 'radial' : 'linear';
    out.mode = ['smooth', 'steps', 'mosaic'].includes(c.mode) ? c.mode : 'smooth';
    out.angle = num(c.angle, 0, 0, 359);
    out.steps = Math.round(num(c.steps, 6, 2, 64));
    out.tile = num(c.tile, 24, 1, 512);
    out.jitter = num(c.jitter, 0.3, 0, 1);
    out.hardness = num(c.hardness, 0, 0, 1);
    out.light = num(c.light, 1, 0, 2);
    out.dark = num(c.dark, 1, 0, 2);
    out.seamless = !!c.seamless;
    out.seed = Math.round(num(c.seed, out.seed, 0, 1e9));
    const stops = Array.isArray(c.stops) && c.stops.length ? c.stops : [{}];
    out.stops = stops
      .map(s => ({ c: s && ids.has(s.c) ? s.c : first, s: num(s && s.s, 0, -1, 1), p: num(s && s.p, 0, 0, 1) }))
      .sort((a, b) => a.p - b.p);
    return out;
  }

  // ---------- Layout ----------

  // Integer pixel rectangles for every row and cell at the given sheet size.
  function layout(p, W, H) {
    const s = Math.min(W, H) / REF;
    const M = Math.round(p.margin * s);
    const G = Math.round(p.gap * s);
    const availH = Math.max(0, H - 2 * M - (p.rows.length - 1) * G);
    const sumH = p.rows.reduce((a, r) => a + r.h, 0) || 1;
    let accH = 0;
    const rows = p.rows.map((r, ri) => {
      const y0 = M + ri * G + Math.round((accH / sumH) * availH);
      accH += r.h;
      const y1 = M + ri * G + Math.round((accH / sumH) * availH);
      const availW = Math.max(0, W - 2 * M - (r.cells.length - 1) * G);
      const sumW = r.cells.reduce((a, c) => a + c.w, 0) || 1;
      let accW = 0;
      const cells = r.cells.map((c, ci) => {
        const x0 = M + ci * G + Math.round((accW / sumW) * availW);
        accW += c.w;
        return { ci, cell: c, x0, x1: M + ci * G + Math.round((accW / sumW) * availW) };
      });
      return { ri, row: r, y0, y1, cells, availW, sumW };
    });
    return { W, H, M, G, s, availH, sumH, rows };
  }

  // ---------- Colour lookup ----------

  function hardness(w, k) {
    if (k <= 0) return w;
    const e = Math.max(0.02, 1 - k);
    let x = (w - 0.5) / e + 0.5;
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    return x + (x * x * (3 - 2 * x) - x) * k;
  }

  // Colour along the cell's gradient axis (u = 0..1) as unrounded 0-255 RGB, so rendering can dither.
  function cellLut(c, p, N = LUT_N) {
    const lut = new Float32Array(N * 3);
    const pal = new Map(p.palette.map(x => [x.id, x.color]));
    const hexOf = id => pal.get(id) || p.palette[0].color;
    const put = (i, rgb) => {
      lut[i * 3] = rgb[0] * 255;
      lut[i * 3 + 1] = rgb[1] * 255;
      lut[i * 3 + 2] = rgb[2] * 255;
    };
    const stops = c.stops.slice().sort((a, b) => a.p - b.p);
    const k = c.mode === 'smooth' ? c.hardness : 0;

    if (c.source === 'solid' || (c.source === 'gradient' && stops.length < 2)) {
      const rgb = Color.shade(hexOf(stops[0].c), stops[0].s, p.shading);
      for (let i = 0; i < N; i++) put(i, rgb);
      return lut;
    }
    if (c.source === 'shades') {
      const hex = hexOf(stops[0].c);
      for (let i = 0; i < N; i++) {
        const u = hardness(i / (N - 1), k);
        put(i, Color.shade(hex, c.light - u * (c.light + c.dark), p.shading));
      }
      return lut;
    }
    const ok = p.mix === 'oklab';
    const cols = stops.map(s => {
      const rgb = Color.shade(hexOf(s.c), s.s, p.shading);
      return ok ? Color.rgbToOklab(rgb) : rgb;
    });
    let j = 0;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      while (j < stops.length - 2 && u > stops[j + 1].p) j++;
      const a = stops[j].p;
      const b = stops[j + 1].p;
      let w = b > a ? (u - a) / (b - a) : u >= b ? 1 : 0;
      w = hardness(w < 0 ? 0 : w > 1 ? 1 : w, k);
      const A = cols[j];
      const B = cols[j + 1];
      const m = [A[0] + (B[0] - A[0]) * w, A[1] + (B[1] - A[1]) * w, A[2] + (B[2] - A[2]) * w];
      put(i, ok ? Color.oklabToRgb(m) : m);
    }
    return lut;
  }

  function cssGradient(c, p) {
    const n = 48;
    const lut = cellLut(c, p, n);
    const parts = [];
    for (let i = 0; i < n; i++) {
      parts.push(`rgb(${Math.round(lut[i * 3])},${Math.round(lut[i * 3 + 1])},${Math.round(lut[i * 3 + 2])}) ${((i / (n - 1)) * 100).toFixed(1)}%`);
    }
    return `linear-gradient(90deg, ${parts.join(',')})`;
  }

  // ---------- Rendering ----------

  function hash(x, y, s) {
    let h = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1) ^ Math.imul(s + 1, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  const pack = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const byte = v => (v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0);

  // Interleaved gradient noise in [0, 1): an even, pattern-free threshold per pixel.
  function noise(x, y) {
    const f = 0.06711056 * x + 0.00583715 * y;
    const t = 52.9829189 * (f - Math.floor(f));
    return t - Math.floor(t);
  }

  // (x0, y0, cw, ch) is the cell; (ax0..ax1, ay0..ay1) the painted area, larger when gaps bleed.
  function drawCell(u32, W, c, p, s, x0, y0, cw, ch, ax0, ay0, ax1, ay1) {
    if (cw <= 0 || ch <= 0 || ax1 <= ax0 || ay1 <= ay0) return;
    const lut = cellLut(c, p);
    const last = LUT_N - 1;
    const px = new Uint32Array(LUT_N);
    for (let i = 0; i < LUT_N; i++) px[i] = pack(byte(lut[i * 3]), byte(lut[i * 3 + 1]), byte(lut[i * 3 + 2]));
    if (c.source === 'solid') {
      for (let y = ay0; y < ay1; y++) u32.fill(px[0], y * W + ax0, y * W + ax1);
      return;
    }
    const radial = c.shape === 'radial';
    const seam = c.seamless && !radial;
    const mosaic = c.mode === 'mosaic';
    const steps = c.mode === 'steps';
    const n = Math.max(2, c.steps | 0);
    const rad = (c.angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const ext = Math.abs(dx) + Math.abs(dy) || 1;
    let tx = 1;
    let ty = 1;
    if (mosaic) {
      const t = Math.max(1, c.tile * s);
      tx = Math.max(1, Math.round(cw / t));
      ty = Math.max(1, Math.round(ch / t));
    }
    const jit = mosaic ? c.jitter * 0.5 : 0;
    const seed = c.seed | 0;
    // Only smooth blends dither; flat bands and tiles keep exact colours.
    const dither = p.dither && c.mode === 'smooth';
    for (let y = ay0; y < ay1; y++) {
      let fy = (y + 0.5 - y0) / ch;
      fy = fy < 0 ? 0 : fy > 0.999999 ? 0.999999 : fy;
      let iy = 0;
      if (mosaic) {
        iy = Math.floor(fy * ty);
        fy = (iy + 0.5) / ty;
      }
      const rowStart = y * W;
      for (let x = ax0; x < ax1; x++) {
        let fx = (x + 0.5 - x0) / cw;
        fx = fx < 0 ? 0 : fx > 0.999999 ? 0.999999 : fx;
        let ix = 0;
        if (mosaic) {
          ix = Math.floor(fx * tx);
          fx = (ix + 0.5) / tx;
        }
        let u;
        if (radial) {
          const ox = fx - 0.5;
          const oy = fy - 0.5;
          u = Math.sqrt(ox * ox + oy * oy) / 0.70710678;
        } else {
          u = 0.5 + ((fx - 0.5) * dx + (fy - 0.5) * dy) / ext;
        }
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        if (seam) u = 1 - Math.abs(2 * u - 1);
        if (steps) u = Math.min(n - 1, Math.floor(u * n)) / (n - 1);
        else if (jit) {
          u += (hash(ix, iy, seed) - 0.5) * jit;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
        }
        const i = (u * last + 0.5) | 0;
        if (dither) {
          const k = i * 3;
          const d = noise(x, y) - 0.5;
          u32[rowStart + x] = pack(byte(lut[k] + d), byte(lut[k + 1] + d), byte(lut[k + 2] + d));
        } else {
          u32[rowStart + x] = px[i];
        }
      }
    }
  }

  function render(p, W, H, reuse) {
    const img = reuse && reuse.width === W && reuse.height === H ? reuse : new ImageData(W, H);
    const u32 = new Uint32Array(img.data.buffer);
    const bg = Color.hexToRgb(p.gapColor).map(v => Math.round(v * 255));
    u32.fill(pack(bg[0], bg[1], bg[2]));
    const L = layout(p, W, H);
    const bleed = p.gapFill === 'bleed';
    const before = Math.ceil(L.G / 2);
    const after = Math.floor(L.G / 2);
    const lastRow = L.rows.length - 1;
    for (const R of L.rows) {
      const ay0 = !bleed ? R.y0 : R.ri === 0 ? 0 : R.y0 - before;
      const ay1 = !bleed ? R.y1 : R.ri === lastRow ? H : R.y1 + after;
      const lastCell = R.cells.length - 1;
      for (const C of R.cells) {
        const ax0 = !bleed ? C.x0 : C.ci === 0 ? 0 : C.x0 - before;
        const ax1 = !bleed ? C.x1 : C.ci === lastCell ? W : C.x1 + after;
        drawCell(u32, W, C.cell, p, L.s, C.x0, R.y0, C.x1 - C.x0, R.y1 - R.y0, ax0, ay0, ax1, ay1);
      }
    }
    return img;
  }

  // ---------- Project data inside the PNG (tEXt chunk) ----------

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function embed(png, json) {
    const ascii = json.replace(/[\u0080-￿]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
    const data = new TextEncoder().encode(PNG_KEY + '\0' + ascii);
    const chunk = new Uint8Array(12 + data.length);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, data.length);
    chunk.set([0x74, 0x45, 0x58, 0x74], 4); // tEXt
    chunk.set(data, 8);
    dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    const at = 33; // PNG signature (8) + IHDR chunk (25)
    const out = new Uint8Array(png.length + chunk.length);
    out.set(png.subarray(0, at));
    out.set(chunk, at);
    out.set(png.subarray(at), at + chunk.length);
    return out;
  }

  function extract(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 8 || dv.getUint32(0) !== 0x89504e47) return null;
    const latin1 = new TextDecoder('latin1');
    let o = 8;
    while (o + 12 <= bytes.length) {
      const len = dv.getUint32(o);
      const type = latin1.decode(bytes.subarray(o + 4, o + 8));
      if (type === 'tEXt') {
        const data = bytes.subarray(o + 8, o + 8 + len);
        const z = data.indexOf(0);
        if (z > 0 && latin1.decode(data.subarray(0, z)) === PNG_KEY) return latin1.decode(data.subarray(z + 1));
      }
      if (type === 'IEND') break;
      o += 12 + len;
    }
    return null;
  }

  return {
    REF, SIZES, GRIDS, LOOK_KEYS, uid, cell,
    exampleProject, blankProject, randomProject, normalize,
    layout, render, cssGradient, embed, extract,
  };
})();
