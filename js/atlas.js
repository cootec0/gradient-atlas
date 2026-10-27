'use strict';
// Atlas model: defaults, layout, pixel rendering and project data stored inside the PNG.
const Atlas = (() => {
  const REF = 1024; // margin, gap and tile sizes are stored in pixels of a 1024 px sheet
  const LUT_N = 1024;
  const SIZES = [256, 512, 1024, 2048, 4096];
  const GRIDS = [2, 4, 8, 16, 32, 64, 128, 256]; // snap grid in export pixels
  const LOOK_KEYS = ['shape', 'angle', 'mode', 'steps', 'tile', 'jitter', 'hardness', 'noise', 'noiseSize', 'noiseMix', 'noiseDetail', 'noiseContrast', 'seamless'];
  const NOISES = ['clouds', 'grain', 'stones', 'voronoi', 'cracks', 'ridged', 'turbulence'];
  // Settings a cell remembers per colour source and noise type, and where each type starts.
  const NOISE_KEYS = ['noiseSize', 'noiseMix', 'spread', 'noiseDetail', 'noiseContrast', 'noiseColor', 'noiseShade'];
  const NOISE_START = {
    clouds: { noiseSize: 24 },
    grain: { noiseSize: 12 },
    stones: { noiseSize: 32 },
    voronoi: { noiseSize: 32 },
    cracks: { noiseSize: 40 },
    ridged: { noiseSize: 32 },
    turbulence: { noiseSize: 32 },
  };
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
      mode: 'mosaic', // smooth | steps | mosaic | noise
      steps: 6,
      tile: 10,
      jitter: 0,
      hardness: 0,
      noise: 'clouds', // clouds | grain | stones | voronoi | cracks | ridged | turbulence
      noiseSize: 24,
      noiseMix: 1, // 0 = only the gradient, 1 = only the noise
      spread: 0.3, // how far a noisy solid colour drifts from its shade
      noiseDetail: 5, // octaves of the cloud-like noises
      noiseContrast: 1,
      noiseColor: '', // palette id painted by the noise; empty = the cell's own colours
      noiseShade: 0,
      noiseMemory: {}, // 'source/type' -> NOISE_KEYS values
      seamless: true,
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
      grid: 16,
      gapFill: 'color', // color | bleed
      gapColor: '#D0C1B1',
      mix: 'oklab', // oklab | srgb
      dither: true,
      harmony: 'earthy',
      layout: 'classic',
      shading: { hue: 10, light: 1, dark: 1 },
      palette,
      rows,
    }, over);
  }

  function exampleProject() {
    const palette = ['#50954A', '#ABC35B', '#2A5341', '#5A5F34', '#6B4A37', '#E68237']
      .map(color => ({ id: uid('p'), color, locked: false }));
    const P = palette.map(p => p.id);
    const look = { mode: 'smooth', seamless: false };
    const g = (angle, ...st) => cell(Object.assign({ source: 'gradient', angle, stops: spread(st.map(([i, s]) => stop(P[i], s))) }, look));
    const sh = (i, angle, mode, light = 1, dark = 1) => cell(Object.assign({ source: 'shades', angle, light, dark, stops: [stop(P[i])] }, look, { mode }));
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

  // Layout styles: each roll builds new rows from the palette. Cells without an explicit blend
  // take the default cell look.
  const LAYOUTS = {
    classic: 'Classic',
    strips: 'Strips',
    grid: 'Grid',
    bars: 'Bars',
    material: 'Material',
    mixed: 'Mixed',
  };

  function layoutRows(style, palette, rnd = Math.random) {
    const P = palette.map(p => p.id);
    const n = P.length;
    const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const pick = list => list[Math.floor(rnd() * list.length)];
    const col = i => P[((i % n) + n) % n];
    const other = i => col(i + Math.max(1, Math.ceil(n / 2))); // far along the palette, so pairs contrast
    const times = (k, make) => Array.from({ length: k }, (_, i) => make(i));
    const solid = (i, s = 0) => cell({ stops: [stop(col(i), s)] });
    const shades = (i, angle, over) => cell(Object.assign({ source: 'shades', angle, stops: [stop(col(i))] }, over));
    const pair = (i, angle, over) => cell(Object.assign({ source: 'gradient', angle, stops: spread([stop(col(i)), stop(other(i))]) }, over));
    // The last row takes what is left of the 1024 px sheet, so rows land on whole pixels.
    const stack = list => {
      const used = list.slice(0, -1).reduce((a, r) => a + r.h, 0);
      list[list.length - 1].h = Math.max(32, 1024 - used);
      return list;
    };

    if (style === 'strips') {
      const down = rnd() < 0.5; // gradients top to bottom, otherwise mirrored across the strip
      const look = down ? { seamless: false } : {};
      const levels = [0, 0.45, -0.45, 0.75, -0.75];
      const tiles = times(int(1, 2), r => row(64, times(16, i => solid(i, levels[(Math.floor(i / n) + r * 2) % levels.length]))));
      const bars = times(int(2, 3), r => row(int(96, 136), times(int(2, 4), i => (rnd() < 0.5 ? shades(i + r, 90) : pair(i + r, 90)))));
      const used = [...tiles, ...bars].reduce((a, r) => a + r.h, 0);
      const strips = row(1024 - used, times(int(5, 10), i => (rnd() < 0.7 ? shades(i, down ? 90 : 0, look) : pair(i, down ? 90 : 0, look))));
      return [...tiles, strips, ...bars];
    }
    if (style === 'grid') {
      const g = pick([4, 4, 6, 8]);
      return times(g, y => row(1, times(g, x => {
        const i = y * g + x;
        const kind = rnd();
        if (kind < 0.3) return solid(i, Math.round((rnd() * 1.2 - 0.6) * 100) / 100);
        return kind < 0.65 ? shades(i, pick([0, 90])) : pair(i, pick([0, 90]));
      })));
    }
    if (style === 'bars') {
      return times(int(6, 12), y => row(1, times(pick([1, 1, 2, 2, 3]), x => (rnd() < 0.5 ? shades(y + x, pick([0, 90])) : pair(y + x, pick([0, 90]))))));
    }
    if (style === 'material') {
      const noisy = over => cell(Object.assign({ mode: 'noise', noise: pick(NOISES), noiseSize: pick([16, 24, 32]), noiseMix: 1, seamless: true }, over));
      const square = i => (rnd() < 0.7
        ? noisy({ source: 'shades', light: 0.6, dark: 0.6, stops: [stop(col(i))] })
        : noisy({ source: 'gradient', angle: 90, stops: spread([stop(col(i)), stop(other(i))]) }));
      const per = pick([3, 4, 4, 6]);
      return stack([
        row(256, times(per, square)),
        row(256, times(per, i => square(i + per))),
        row(128, times(8, i => noisy({ source: 'solid', noiseSize: 12, spread: 0.25, stops: [stop(col(i))] }))),
        row(0, times(pick([4, 6, 8]), i => noisy({ source: 'shades', angle: 90, noise: 'clouds', noiseMix: 0.5, stops: [stop(col(i))] }))),
      ]);
    }
    if (style === 'mixed') return randomProject(palette, rnd).rows;
    // Classic: solids, stepped ramps, colour pairs across, shades down.
    const smooth = { mode: 'smooth', seamless: false };
    const k = Math.min(Math.max(n, 4), 8);
    return stack([
      row(112, times(k, i => solid(i))),
      row(96, times(k, i => shades(i, 0, { mode: 'steps', steps: int(4, 8), seamless: false }))),
      row(int(100, 140), times(int(2, 3), i => pair(i, 0, smooth))),
      row(int(100, 140), times(int(3, 4), i => pair(i + 2, 0, smooth))),
      row(0, times(k, i => shades(i, 90, smooth))),
    ]);
  }

  // Stone, concrete and similar surfaces: noise squares, noisy solid tiles and long strips.
  function materialProject(palette) {
    return baseProject(palette, layoutRows('material', palette), { name: 'Material atlas', layout: 'material' });
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
    p.grid = GRIDS.includes(+src.grid) ? +src.grid : 16;
    p.gapFill = src.gapFill === 'bleed' ? 'bleed' : 'color';
    p.mix = src.mix === 'srgb' ? 'srgb' : 'oklab';
    p.dither = src.dither !== false;
    p.harmony = Color.HARMONIES[src.harmony] || Color.MATERIALS[src.harmony] || Color.PALETTES[src.harmony] ? src.harmony : 'earthy';
    p.layout = LAYOUTS[src.layout] ? src.layout : 'classic';
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

  // Noise settings of a cell or of a remembered set; bad values fall back to `base`.
  function noiseParams(src, base, ids) {
    return {
      noiseSize: num(src.noiseSize, base.noiseSize, 1, 1024),
      noiseMix: num(src.noiseMix, base.noiseMix, 0, 1),
      spread: num(src.spread, base.spread, 0, 1),
      noiseDetail: Math.round(num(src.noiseDetail, base.noiseDetail, 1, 8)),
      noiseContrast: num(src.noiseContrast, base.noiseContrast, 0, 3),
      noiseColor: ids.has(src.noiseColor) ? src.noiseColor : '',
      noiseShade: num(src.noiseShade, base.noiseShade, -1, 1),
    };
  }

  function normalizeCell(c, ids, first, freshId) {
    c = c || {};
    const out = cell();
    out.id = freshId(c.id, 'c');
    out.w = num(c.w, 1, 0.001);
    out.source = ['solid', 'gradient', 'shades'].includes(c.source) ? c.source : 'solid';
    out.shape = c.shape === 'radial' ? 'radial' : 'linear';
    out.mode = ['smooth', 'steps', 'mosaic', 'noise'].includes(c.mode) ? c.mode : out.mode;
    out.noise = NOISES.includes(c.noise) ? c.noise : out.noise;
    Object.assign(out, noiseParams(c, out, ids));
    out.noiseMemory = {};
    for (const [key, saved] of Object.entries(c.noiseMemory && typeof c.noiseMemory === 'object' ? c.noiseMemory : {})) {
      const [source, type] = key.split('/');
      if (['solid', 'gradient', 'shades'].includes(source) && NOISES.includes(type) && saved && typeof saved === 'object') {
        out.noiseMemory[key] = noiseParams(saved, out, ids);
      }
    }
    out.angle = num(c.angle, 0, 0, 359);
    out.steps = Math.round(num(c.steps, 6, 2, 64));
    out.tile = num(c.tile, out.tile, 1, 512);
    out.jitter = num(c.jitter, out.jitter, 0, 1);
    out.hardness = num(c.hardness, 0, 0, 1);
    out.light = num(c.light, 1, 0, 2);
    out.dark = num(c.dark, 1, 0, 2);
    out.seamless = c.seamless === undefined ? out.seamless : !!c.seamless;
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

    if (c.source === 'solid' && c.mode === 'noise') {
      // A noisy solid: shades around its own shade, lighter at u = 0 and darker at u = 1.
      const hex = hexOf(stops[0].c);
      for (let i = 0; i < N; i++) {
        const t = stops[0].s + c.spread * (1 - (2 * i) / (N - 1));
        put(i, Color.shade(hex, t < -1 ? -1 : t > 1 ? 1 : t, p.shading));
      }
      return lut;
    }
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
  function ditherAt(x, y) {
    const f = 0.06711056 * x + 0.00583715 * y;
    const t = 52.9829189 * (f - Math.floor(f));
    return t - Math.floor(t);
  }

  // ---------- Texture noise ----------
  // Coordinates are in noise features; px and py are wrap periods in features (0 = no wrap), so a
  // seamless cell holds a whole number of features and its opposite edges meet.

  const wrap = (a, period) => (period ? ((a % period) + period) % period : a);

  function valueNoise(x, y, px, py, seed) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const x0 = wrap(xi, px);
    const x1 = wrap(xi + 1, px);
    const y0 = wrap(yi, py);
    const y1 = wrap(yi + 1, py);
    const a = hash(x0, y0, seed);
    const b = hash(x1, y0, seed);
    const c = hash(x0, y1, seed);
    const d = hash(x1, y1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // Octaves of value noise; each octave doubles its period, so wrapping holds at every scale.
  // `shape` turns a 0..1 value into what the octave adds: plain, ridged or turbulent.
  function octaves(x, y, px, py, seed, count, shape) {
    let t = 0;
    let amp = 0.5;
    let f = 1;
    let total = 0;
    for (let o = 0; o < count; o++) {
      const v = valueNoise(x * f, y * f, px * f, py * f, seed + o * 1013);
      t += amp * (shape ? shape(v) : v);
      total += amp;
      f *= 2;
      amp *= 0.5;
    }
    return t / total;
  }
  const clouds = (x, y, px, py, seed, count) => octaves(x, y, px, py, seed, count);
  const ridge = v => (1 - Math.abs(2 * v - 1)) ** 2;
  const turbulent = v => Math.abs(2 * v - 1);

  // Jittered Voronoi: distances to the nearest and second nearest point and the nearest point's value.
  let vorD1 = 0;
  let vorD2 = 0;
  let vorVal = 0;
  function voronoi(x, y, px, py, seed) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    vorD1 = 9;
    vorD2 = 9;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const gx = wrap(xi + i, px);
        const gy = wrap(yi + j, py);
        const ox = xi + i + 0.15 + 0.7 * hash(gx, gy, seed) - x;
        const oy = yi + j + 0.15 + 0.7 * hash(gx, gy, seed + 7) - y;
        const d = Math.sqrt(ox * ox + oy * oy);
        if (d < vorD1) {
          vorD2 = vorD1;
          vorD1 = d;
          vorVal = hash(gx, gy, seed + 13);
        } else if (d < vorD2) {
          vorD2 = d;
        }
      }
    }
  }

  // Texture noise in [0, 1] at feature coordinates (x, y), shaped by the cell's noise settings.
  function textureNoise(c, x, y, px, py) {
    const seed = c.seed | 0;
    const count = c.noiseDetail;
    let n;
    switch (c.noise) {
      case 'stones': // one shade per stone, darker joints
        voronoi(x, y, px, py, seed);
        n = vorVal * 0.75 + 0.15 - (1 - Math.min(1, (vorD2 - vorD1) * 5)) * 0.35;
        break;
      case 'voronoi': // distance to the nearest point: soft cells
        voronoi(x, y, px, py, seed);
        n = vorD1 / 0.75;
        break;
      case 'cracks': // thin dark lines where cells meet
        voronoi(x, y, px, py, seed);
        n = (vorD2 - vorD1) * 4;
        break;
      case 'grain': { // specks over soft clouds
        const k = 4;
        const speck = hash(wrap(Math.floor(x * k), px * k), wrap(Math.floor(y * k), py * k), seed + 77);
        n = 0.5 + (speck - 0.5) * 0.9 + (clouds(x, y, px, py, seed, count) - 0.5) * 1.2;
        break;
      }
      case 'ridged':
        n = 0.5 + (octaves(x, y, px, py, seed, count, ridge) - 0.42) * 2;
        break;
      case 'turbulence':
        n = 0.5 + (octaves(x, y, px, py, seed, count, turbulent) - 0.38) * 2;
        break;
      default:
        n = 0.5 + (clouds(x, y, px, py, seed, count) - 0.5) * 2.2;
    }
    n = 0.5 + (n - 0.5) * c.noiseContrast;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  // (x0, y0, cw, ch) is the cell; (ax0..ax1, ay0..ay1) the painted area, larger when gaps bleed.
  // Coordinates are relative to the area's own buffer, so a cell looks the same wherever it sits.
  function drawCell(u32, W, c, p, s, x0, y0, cw, ch, ax0, ay0, ax1, ay1, lutN = LUT_N) {
    if (cw <= 0 || ch <= 0 || ax1 <= ax0 || ay1 <= ay0) return;
    const lut = cellLut(c, p, lutN);
    const last = lutN - 1;
    const px = new Uint32Array(lutN);
    for (let i = 0; i < lutN; i++) px[i] = pack(byte(lut[i * 3]), byte(lut[i * 3 + 1]), byte(lut[i * 3 + 2]));
    const noisy = c.mode === 'noise';
    const solid = c.source === 'solid';
    if (solid && !noisy) {
      for (let y = ay0; y < ay1; y++) u32.fill(px[0], y * W + ax0, y * W + ax1);
      return;
    }
    const radial = c.shape === 'radial';
    // In noise mode seamless wraps the noise; the gradient keeps its direction.
    const seam = c.seamless && !radial && !noisy;
    let nx = 1;
    let ny = 1;
    if (noisy) {
      const f = Math.max(1, c.noiseSize * s);
      nx = Math.max(1, Math.round(cw / f));
      ny = Math.max(1, Math.round(ch / f));
    }
    const wx = noisy && c.seamless ? nx : 0;
    const wy = noisy && c.seamless ? ny : 0;
    // A noise colour is painted over the cell's colours; without one the noise moves along them.
    const tintEntry = noisy && c.noiseColor ? p.palette.find(q => q.id === c.noiseColor) : null;
    const tint = tintEntry ? Color.shade(tintEntry.color, c.noiseShade, p.shading).map(v => v * 255) : null;
    const mix = solid && !tint ? 1 : c.noiseMix;
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
    // Only smooth blends and noise dither; flat bands and tiles keep exact colours.
    const dither = p.dither && (c.mode === 'smooth' || noisy);
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
        let paint = 0;
        if (noisy) {
          const nv = textureNoise(c, fx * nx, fy * ny, wx, wy);
          if (!tint) u += (nv - u) * mix;
          else {
            paint = nv * mix;
            if (solid) u = 0.5; // the solid's own shade sits in the middle of its ramp
          }
        }
        const i = (u * last + 0.5) | 0;
        if (tint) {
          const k = i * 3;
          const d = dither ? ditherAt(x, y) - 0.5 : 0;
          u32[rowStart + x] = pack(
            byte(lut[k] + (tint[0] - lut[k]) * paint + d),
            byte(lut[k + 1] + (tint[1] - lut[k + 1]) * paint + d),
            byte(lut[k + 2] + (tint[2] - lut[k + 2]) * paint + d),
          );
        } else if (dither) {
          const k = i * 3;
          const d = ditherAt(x, y) - 0.5;
          u32[rowStart + x] = pack(byte(lut[k] + d), byte(lut[k + 1] + d), byte(lut[k + 2] + d));
        } else {
          u32[rowStart + x] = px[i];
        }
      }
    }
  }

  // Everything outside a cell that changes how it looks.
  const sheetKey = (p, s) => JSON.stringify([p.palette, p.shading, p.mix, p.dither, s]);
  const cellKey = c => JSON.stringify(c, (k, v) => (k === 'id' || k === 'w' || k === 'noiseMemory' ? undefined : v));

  const DRAFT_MS = 0.5; // what one draft cell may cost

  // Pixels of one cell's painted area, from the cache when nothing about it changed. A draft is
  // quick and coarse, for when the frame is out of time; it is never cached.
  // `draft` is the expected cost of the full paint in ms, or 0 for a full paint.
  function cellPixels(cache, sheet, C, R, p, s, ax0, ay0, ax1, ay1, draft) {
    const aw = ax1 - ax0;
    const ah = ay1 - ay0;
    const key = cache && `${sheet}|${cellKey(C.cell)}|${C.x1 - C.x0},${R.y1 - R.y0},${ax0 - C.x0},${ay0 - R.y0},${aw},${ah}`;
    const hit = cache && cache.map.get(key);
    if (hit) {
      hit.gen = cache.gen;
      return hit.buf;
    }
    const buf = new Uint32Array(Math.max(0, aw * ah));
    if (draft) {
      // Coarser the dearer the cell, so a draft costs about the same whatever it shows.
      const f = Math.min(16, Math.max(2, Math.ceil(Math.sqrt(draft / DRAFT_MS))));
      const dw = Math.ceil(aw / f);
      const dh = Math.ceil(ah / f);
      const small = new Uint32Array(dw * dh);
      drawCell(small, dw, C.cell, p, s / f, (C.x0 - ax0) / f, (R.y0 - ay0) / f, (C.x1 - C.x0) / f, (R.y1 - R.y0) / f, 0, 0, dw, dh, 128);
      for (let y = 0; y < ah; y++) {
        const at = y * aw;
        if (y % f) {
          buf.copyWithin(at, at - aw, at); // same as the row above
          continue;
        }
        const from = (y / f) * dw;
        for (let x = 0; x < aw; x++) buf[at + x] = small[from + ((x / f) | 0)];
      }
      cache.drafts++;
      return buf;
    }
    drawCell(buf, aw, C.cell, p, s, C.x0 - ax0, R.y0 - ay0, C.x1 - C.x0, R.y1 - R.y0, 0, 0, aw, ah);
    if (cache) cache.map.set(key, { buf, gen: cache.gen });
    return buf;
  }

  // `drafts` counts the cells of the last render that were painted as drafts; `rates` holds the
  // measured cost of a pixel per kind of cell, to tell whether the next one fits in the time left.
  function createCache() {
    return { map: new Map(), gen: 0, drafts: 0, rates: new Map() };
  }

  const costKind = c => (c.mode === 'noise' ? 'noise/' + c.noise + '/' + c.noiseDetail : c.source === 'solid' ? 'flat' : c.mode);

  // `cache` (from createCache) keeps cell pixels between renders, so only changed cells are redrawn.
  // With `budget` (ms, needs a cache) cells that would not be ready in time are painted as drafts;
  // render again to finish them. `progress` makes sure at least one of them is finished.
  function render(p, W, H, reuse, cache, { budget = 0, progress = false } = {}) {
    const img = reuse && reuse.width === W && reuse.height === H ? reuse : new ImageData(W, H);
    const u32 = new Uint32Array(img.data.buffer);
    const bg = Color.hexToRgb(p.gapColor).map(v => Math.round(v * 255));
    u32.fill(pack(bg[0], bg[1], bg[2]));
    const L = layout(p, W, H);
    const bleed = p.gapFill === 'bleed';
    const before = Math.ceil(L.G / 2);
    const after = Math.floor(L.G / 2);
    const lastRow = L.rows.length - 1;
    const sheet = cache ? sheetKey(p, L.s) : '';
    if (!cache) budget = 0;
    const deadline = budget ? performance.now() + budget : Infinity;
    let finished = false; // a missing cell was painted in full this time
    if (cache) {
      cache.gen++;
      cache.drafts = 0;
    }
    for (const R of L.rows) {
      const ay0 = Math.max(0, !bleed ? R.y0 : R.ri === 0 ? 0 : R.y0 - before);
      const ay1 = Math.min(H, !bleed ? R.y1 : R.ri === lastRow ? H : R.y1 + after);
      const lastCell = R.cells.length - 1;
      for (const C of R.cells) {
        const ax0 = Math.max(0, !bleed ? C.x0 : C.ci === 0 ? 0 : C.x0 - before);
        const ax1 = Math.min(W, !bleed ? C.x1 : C.ci === lastCell ? W : C.x1 + after);
        if (ax1 <= ax0 || ay1 <= ay0 || C.x1 <= C.x0 || R.y1 <= R.y0) continue;
        const aw = ax1 - ax0;
        const area = aw * (ay1 - ay0);
        const kind = budget ? costKind(C.cell) : '';
        const t0 = performance.now();
        // Out of time, judging by what this kind of cell cost before: paint a draft instead.
        const cost = kind ? (cache.rates.get(kind) || 0) * area : 0;
        const draft = cost > DRAFT_MS && t0 + cost > deadline && !(progress && !finished) ? cost : 0;
        const buf = cellPixels(cache, sheet, C, R, p, L.s, ax0, ay0, ax1, ay1, draft);
        const ms = performance.now() - t0;
        if (kind && !draft && ms > 0.5) { // a real paint, not a near free cache hit
          cache.rates.set(kind, ms / area);
          finished = true;
        }
        for (let y = ay0; y < ay1; y++) u32.set(buf.subarray((y - ay0) * aw, (y - ay0 + 1) * aw), y * W + ax0);
      }
    }
    // Cells unused for a few renders go, so swapping back and forth while dragging stays cached.
    if (cache) for (const [k, v] of cache.map) if (cache.gen - v.gen > 4) cache.map.delete(k);
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
    REF, SIZES, GRIDS, LOOK_KEYS, LAYOUTS, NOISES, NOISE_KEYS, NOISE_START, uid, cell,
    exampleProject, blankProject, randomProject, materialProject, layoutRows, normalize,
    layout, render, createCache, cssGradient, embed, extract,
  };
})();
