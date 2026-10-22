'use strict';
// Colour maths: sRGB <-> OKLab/OKLCH, hue-shifted shades and palette generation.
const Color = (() => {
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const toLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const toGam = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

  function hexToRgb(hex) {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.replace(/./g, ch => ch + ch);
    const n = parseInt(h, 16);
    if (h.length !== 6 || Number.isNaN(n)) return [0, 0, 0];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  const rgbToHex = rgb =>
    '#' + rgb.map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

  function parseHex(str) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(str || '').trim());
    return m ? rgbToHex(hexToRgb(m[1])) : null;
  }

  function linToOklab(r, g, b) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function oklabToLin(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }

  const linToRgb = lin => lin.map(v => clamp01(toGam(clamp01(v))));
  const rgbToOklab = rgb => linToOklab(toLin(rgb[0]), toLin(rgb[1]), toLin(rgb[2]));
  const oklabToRgb = lab => linToRgb(oklabToLin(lab[0], lab[1], lab[2]));
  const inGamut = lin => lin.every(v => v >= -1e-4 && v <= 1.0001);

  function rgbToLch(rgb) {
    const [L, a, b] = rgbToOklab(rgb);
    const h = (Math.atan2(b, a) * 180) / Math.PI;
    return [L, Math.hypot(a, b), h < 0 ? h + 360 : h];
  }

  // Out-of-gamut colours keep lightness and hue and lose chroma.
  function lchToRgb(L, C, h) {
    L = clamp01(L);
    const r = (h * Math.PI) / 180;
    const ca = Math.cos(r);
    const sa = Math.sin(r);
    let lin = oklabToLin(L, C * ca, C * sa);
    if (!inGamut(lin)) {
      let lo = 0;
      let hi = C;
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(oklabToLin(L, mid * ca, mid * sa))) lo = mid;
        else hi = mid;
      }
      lin = oklabToLin(L, lo * ca, lo * sa);
    }
    return linToRgb(lin);
  }

  function distance(hexA, hexB) {
    const a = rgbToOklab(hexToRgb(hexA));
    const b = rgbToOklab(hexToRgb(hexB));
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  // t in [-1, 1]: negative darkens, positive lightens. Highlights drift towards yellow,
  // shadows towards blue, like hand-painted ramps.
  function computeShade(hex, t, shading) {
    const rgb = hexToRgb(hex);
    if (!t) return rgb;
    let [L, C, h] = rgbToLch(rgb);
    let target;
    if (t > 0) {
      const k = shading.light;
      L += t * (0.96 - L) * 0.55 * k;
      C *= 1 - 0.3 * t * Math.min(1, k);
      target = 95;
    } else {
      const k = shading.dark;
      L += t * Math.max(0, L - 0.12) * 0.34 * k;
      C *= 1 + 0.2 * t * Math.min(1, k);
      target = 265;
    }
    const d = ((target - h + 540) % 360) - 180;
    h += Math.sign(d) * Math.min(Math.abs(d), shading.hue * Math.abs(t));
    return lchToRgb(L, Math.max(0, C), h);
  }

  const shadeCache = new Map();
  function shade(hex, t, shading) {
    const key = hex + '|' + t.toFixed(4) + '|' + shading.hue + '|' + shading.light + '|' + shading.dark;
    let v = shadeCache.get(key);
    if (!v) {
      if (shadeCache.size > 30000) shadeCache.clear();
      v = computeShade(hex, t, shading);
      shadeCache.set(key, v);
    }
    return v;
  }

  const HARMONIES = {
    earthy: 'Earthy',
    analogous: 'Analogous',
    complementary: 'Complementary',
    triadic: 'Triadic',
    pastel: 'Pastel',
    vivid: 'Vivid',
    random: 'Anything goes',
  };

  function pick(i, n, base, harmony, rnd) {
    const r = (a, b) => a + rnd() * (b - a);
    let h;
    let L;
    let C;
    switch (harmony) {
      case 'analogous': h = base + (i - (n - 1) / 2) * r(16, 28); L = r(0.42, 0.82); C = r(0.08, 0.16); break;
      case 'complementary': h = base + (i % 2 ? 180 : 0) + r(-15, 15); L = r(0.4, 0.8); C = r(0.07, 0.15); break;
      case 'triadic': h = base + (i % 3) * 120 + r(-12, 12); L = r(0.45, 0.8); C = r(0.08, 0.15); break;
      case 'earthy': h = r(35, 150); L = r(0.35, 0.78); C = r(0.04, 0.12); break;
      case 'pastel': h = base + (i * 360) / n + r(-10, 10); L = r(0.82, 0.92); C = r(0.04, 0.09); break;
      case 'vivid': h = base + (i * 360) / n + r(-10, 10); L = r(0.55, 0.78); C = r(0.15, 0.22); break;
      default: h = r(0, 360); L = r(0.3, 0.9); C = r(0.03, 0.2);
    }
    return rgbToHex(lchToRgb(L, C, ((h % 360) + 360) % 360));
  }

  // Returns new colours for the palette; locked entries keep theirs and set the base hue.
  function generate(palette, harmony, rnd = Math.random) {
    const locked = palette.find(p => p.locked);
    const base = locked ? rgbToLch(hexToRgb(locked.color))[2] : rnd() * 360;
    return palette.map((p, i) => (p.locked ? p.color : pick(i, palette.length, base, harmony, rnd)));
  }

  return { hexToRgb, rgbToHex, parseHex, rgbToOklab, oklabToRgb, rgbToLch, lchToRgb, distance, shade, generate, HARMONIES };
})();
