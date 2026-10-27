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
  // Shades are cached at 4 decimals; computing the rounded value too keeps every render of the same
  // atlas identical, whichever nearby value happened to be asked first.
  function shade(hex, t, shading) {
    t = Math.round(t * 1e4) / 1e4;
    const key = hex + '|' + t + '|' + shading.hue + '|' + shading.light + '|' + shading.dark;
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

  // Material palettes as OKLCH ranges: hue, chroma and lightness.
  const MATERIALS = {
    concrete: { name: 'Concrete', h: [70, 100], c: [0.004, 0.016], l: [0.5, 0.82] },
    granite: { name: 'Granite', h: [20, 60], c: [0.008, 0.03], l: [0.3, 0.8] },
    sandstone: { name: 'Sandstone', h: [55, 80], c: [0.04, 0.09], l: [0.52, 0.86] },
    slate: { name: 'Slate', h: [215, 250], c: [0.01, 0.03], l: [0.3, 0.66] },
    basalt: { name: 'Basalt', h: [240, 290], c: [0.002, 0.012], l: [0.22, 0.45] },
    brick: { name: 'Brick', h: [28, 45], c: [0.07, 0.13], l: [0.36, 0.64] },
    limestone: { name: 'Limestone', h: [75, 95], c: [0.015, 0.04], l: [0.7, 0.9] },
  };

  // Popular fixed palettes from Lospec (lospec.com/palette-list), author as listed there.
  const PALETTES = {
    'pico-8': {
      name: 'PICO-8',
      colors: [
        '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
        '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
      ],
    },
    'sweetie-16': {
      name: 'Sweetie 16',
      colors: [
        '#1A1C2C', '#5D275D', '#B13E53', '#EF7D57', '#FFCD75', '#A7F070', '#38B764', '#257179',
        '#29366F', '#3B5DC9', '#41A6F6', '#73EFF7', '#F4F4F4', '#94B0C2', '#566C86', '#333C57',
      ],
    },
    'endesga-32': {
      name: 'Endesga 32',
      by: 'ENDESGA',
      colors: [
        '#BE4A2F', '#D77643', '#EAD4AA', '#E4A672', '#B86F50', '#733E39', '#3E2731', '#A22633',
        '#E43B44', '#F77622', '#FEAE34', '#FEE761', '#63C74D', '#3E8948', '#265C42', '#193C3E',
        '#124E89', '#0099DB', '#2CE8F5', '#FFFFFF', '#C0CBDC', '#8B9BB4', '#5A6988', '#3A4466',
        '#262B44', '#181425', '#FF0044', '#68386C', '#B55088', '#F6757A', '#E8B796', '#C28569',
      ],
    },
    'resurrect-64': {
      name: 'Resurrect 64',
      by: 'Kerrie Lake',
      colors: [
        '#2E222F', '#3E3546', '#625565', '#966C6C', '#AB947A', '#694F62', '#7F708A', '#9BABB2',
        '#C7DCD0', '#FFFFFF', '#6E2727', '#B33831', '#EA4F36', '#F57D4A', '#AE2334', '#E83B3B',
        '#FB6B1D', '#F79617', '#F9C22B', '#7A3045', '#9E4539', '#CD683D', '#E6904E', '#FBB954',
        '#4C3E24', '#676633', '#A2A947', '#D5E04B', '#FBFF86', '#165A4C', '#239063', '#1EBC73',
        '#91DB69', '#CDDF6C', '#313638', '#374E4A', '#547E64', '#92A984', '#B2BA90', '#0B5E65',
        '#0B8A8F', '#0EAF9B', '#30E1B9', '#8FF8E2', '#323353', '#484A77', '#4D65B4', '#4D9BE6',
        '#8FD3FF', '#45293F', '#6B3E75', '#905EA9', '#A884F3', '#EAADED', '#753C54', '#A24B6F',
        '#CF657F', '#ED8099', '#831C5D', '#C32454', '#F04F78', '#F68181', '#FCA790', '#FDCBB0',
      ],
    },
    'aap-64': {
      name: 'AAP-64',
      by: 'Adigun A. Polack',
      colors: [
        '#060608', '#141013', '#3B1725', '#73172D', '#B4202A', '#DF3E23', '#FA6A0A', '#F9A31B',
        '#FFD541', '#FFFC40', '#D6F264', '#9CDB43', '#59C135', '#14A02E', '#1A7A3E', '#24523B',
        '#122020', '#143464', '#285CC4', '#249FDE', '#20D6C7', '#A6FCDB', '#FFFFFF', '#FEF3C0',
        '#FAD6B8', '#F5A097', '#E86A73', '#BC4A9B', '#793A80', '#403353', '#242234', '#221C1A',
        '#322B28', '#71413B', '#BB7547', '#DBA463', '#F4D29C', '#DAE0EA', '#B3B9D1', '#8B93AF',
        '#6D758D', '#4A5462', '#333941', '#422433', '#5B3138', '#8E5252', '#BA756A', '#E9B5A3',
        '#E3E6FF', '#B9BFFB', '#849BE4', '#588DBE', '#477D85', '#23674E', '#328464', '#5DAF8D',
        '#92DCBA', '#CDF7E2', '#E4D2AA', '#C7B08B', '#A08662', '#796755', '#5A4E44', '#423934',
      ],
    },
    'apollo': {
      name: 'Apollo',
      by: 'AdamCYounis',
      colors: [
        '#172038', '#253A5E', '#3C5E8B', '#4F8FBA', '#73BED3', '#A4DDDB', '#19332D', '#25562E',
        '#468232', '#75A743', '#A8CA58', '#D0DA91', '#4D2B32', '#7A4841', '#AD7757', '#C09473',
        '#D7B594', '#E7D5B3', '#341C27', '#602C2C', '#884B2B', '#BE772B', '#DE9E41', '#E8C170',
        '#241527', '#411D31', '#752438', '#A53030', '#CF573C', '#DA863E', '#1E1D39', '#402751',
        '#7A367B', '#A23E8C', '#C65197', '#DF84A5', '#090A14', '#10141F', '#151D28', '#202E37',
        '#394A50', '#577277', '#819796', '#A8B5B2', '#C7CFCC', '#EBEDE9',
      ],
    },
    'dawnbringer-16': {
      name: 'DawnBringer 16',
      colors: [
        '#140C1C', '#442434', '#30346D', '#4E4A4E', '#854C30', '#346524', '#D04648', '#757161',
        '#597DCE', '#D27D2C', '#8595A1', '#6DAA2C', '#D2AA99', '#6DC2CA', '#DAD45E', '#DEEED6',
      ],
    },
    'dawnbringer-32': {
      name: 'DawnBringer 32',
      colors: [
        '#000000', '#222034', '#45283C', '#663931', '#8F563B', '#DF7126', '#D9A066', '#EEC39A',
        '#FBF236', '#99E550', '#6ABE30', '#37946E', '#4B692F', '#524B24', '#323C39', '#3F3F74',
        '#306082', '#5B6EE1', '#639BFF', '#5FCDE4', '#CBDBFC', '#FFFFFF', '#9BADB7', '#847E87',
        '#696A6A', '#595652', '#76428A', '#AC3232', '#D95763', '#D77BBA', '#8F974A', '#8A6F30',
      ],
    },
    'zughy-32': {
      name: 'Zughy 32',
      colors: [
        '#472D3C', '#5E3643', '#7A444A', '#A05B53', '#BF7958', '#EEA160', '#F4CCA1', '#B6D53C',
        '#71AA34', '#397B44', '#3C5956', '#302C2E', '#5A5353', '#7D7071', '#A0938E', '#CFC6B8',
        '#DFF6F5', '#8AEBF1', '#28CCDF', '#3978A8', '#394778', '#39314B', '#564064', '#8E478C',
        '#CD6093', '#FFAEB6', '#F4B41B', '#F47E1B', '#E6482E', '#A93B3B', '#827094', '#4F546B',
      ],
    },
    'cc-29': {
      name: 'CC-29',
      by: 'Alpha6',
      colors: [
        '#F2F0E5', '#B8B5B9', '#868188', '#646365', '#45444F', '#3A3858', '#212123', '#352B42',
        '#43436A', '#4B80CA', '#68C2D3', '#A2DCC7', '#EDE19E', '#D3A068', '#B45252', '#6A536E',
        '#4B4158', '#80493A', '#A77B5B', '#E5CEB4', '#C2D368', '#8AB060', '#567B79', '#4E584A',
        '#7B7243', '#B2B47E', '#EDC8C4', '#CF8ACB', '#5F556A',
      ],
    },
    'jehkoba64': {
      name: 'Jehkoba64',
      by: 'Jehkoba',
      colors: [
        '#000000', '#FABBAF', '#EB758F', '#D94C8E', '#B32D7D', '#FA9891', '#FF7070', '#F53141',
        '#C40C2E', '#852264', '#FAA032', '#F58122', '#F2621F', '#DB4B16', '#9E4C4C', '#FAD937',
        '#FFB938', '#E69B22', '#CC8029', '#AD6A45', '#CCC73D', '#B3B02D', '#989C27', '#8C8024',
        '#7A5E37', '#94BF30', '#55B33B', '#179C43', '#068051', '#116061', '#A0EBA8', '#7CCF9A',
        '#5CB888', '#3DA17E', '#20806C', '#49C2F2', '#25ACF5', '#1793E6', '#1C75BD', '#195BA6',
        '#AE88E3', '#7E7EF2', '#586AC4', '#3553A6', '#243966', '#E29BFA', '#CA7EF2', '#A35DD9',
        '#773BBF', '#4E278C', '#B58C7F', '#9E7767', '#875D58', '#6E4250', '#472E3E', '#A69A9C',
        '#807980', '#696570', '#495169', '#0D2140', '#050E1A', '#D9A798', '#C4BBB3', '#F2F2DA',
      ],
    },
    'vinik24': {
      name: 'Vinik24',
      by: 'Vinik',
      colors: [
        '#000000', '#6F6776', '#9A9A97', '#C5CCB8', '#8B5580', '#C38890', '#A593A5', '#666092',
        '#9A4F50', '#C28D75', '#7CA1C0', '#416AA3', '#8D6268', '#BE955C', '#68ACA9', '#387080',
        '#6E6962', '#93A167', '#6EAA78', '#557064', '#9D9F7F', '#7E9E99', '#5D6872', '#433455',
      ],
    },
    'lost-century': {
      name: 'Lost Century',
      by: 'SurrealEmber',
      colors: [
        '#D1B187', '#C77B58', '#AE5D40', '#79444A', '#4B3D44', '#BA9158', '#927441', '#4D4539',
        '#77743B', '#B3A555', '#D2C9A5', '#8CABA1', '#4B726E', '#574852', '#847875', '#AB9B8E',
      ],
    },
    'steam-lords': {
      name: 'Steam Lords',
      by: 'Slynyrd',
      colors: [
        '#213B25', '#3A604A', '#4F7754', '#A19F7C', '#77744F', '#775C4F', '#603B3A', '#3B2137',
        '#170E19', '#2F213B', '#433A60', '#4F5277', '#65738C', '#7C94A1', '#A0B9BA', '#C0D1CC',
      ],
    },
    'slso8': {
      name: 'SLSO8',
      by: 'Luis Miguel Maldonado',
      colors: [
        '#0D2B45', '#203C56', '#544E68', '#8D697A', '#D08159', '#FFAA5E', '#FFD4A3', '#FFECD6',
      ],
    },
    'nyx8': {
      name: 'Nyx8',
      colors: [
        '#08141E', '#0F2A3F', '#20394F', '#F6D6BD', '#C3A38A', '#997577', '#816271', '#4E495F',
      ],
    },
    'oil-6': {
      name: 'Oil 6',
      colors: [
        '#FBF5EF', '#F2D3AB', '#C69FA5', '#8B6D9C', '#494D7E', '#272744',
      ],
    },
    'nintendo-gameboy-bgb': {
      name: 'Game Boy',
      colors: [
        '#081820', '#346856', '#88C070', '#E0F8D0',
      ],
    },
  };

  // One material colour; the palette runs from light to dark so it covers the whole range.
  function pickMaterial(i, n, m, base, rnd) {
    const r = (a, b) => a + rnd() * (b - a);
    const t = n > 1 ? i / (n - 1) : 0.5;
    const L = m.l[1] - (m.l[1] - m.l[0]) * t + r(-0.03, 0.03);
    const h = base + r(-6, 6);
    return rgbToHex(lchToRgb(L, r(m.c[0], m.c[1]), ((h % 360) + 360) % 360));
  }

  // Unlocked entries get a related set from a popular palette: colours near a random anchor hue
  // with an even spread from light to dark, sometimes with one contrasting accent. Greys fit any set.
  function pickFixed(palette, fixed, rnd) {
    const used = new Set(palette.filter(p => p.locked).map(p => p.color.toUpperCase()));
    const pool = fixed.colors.filter(c => !used.has(c)).map(hex => {
      const [L, C, h] = rgbToLch(hexToRgb(hex));
      return { hex, L, C, h };
    });
    const need = palette.filter(p => !p.locked).length;
    if (!pool.length || !need) return palette.map(p => p.color);
    const hueGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
    const chromatic = pool.filter(c => c.C > 0.03);
    const anchors = chromatic.length ? chromatic : pool;
    const anchor = anchors[Math.floor(rnd() * anchors.length)];
    const accents = need >= 5 && rnd() < 0.5 ? pool.filter(c => c.C > 0.06 && hueGap(c.h, anchor.h) > 110) : [];
    const accent = accents.length ? accents[Math.floor(rnd() * accents.length)] : null;
    const want = need - (accent ? 1 : 0);
    const near = pool
      .filter(c => c !== accent)
      .map(c => ({ c, d: (c.C <= 0.03 ? 45 : hueGap(c.h, anchor.h)) + rnd() * 10 }))
      .sort((a, b) => a.d - b.d)
      .map(x => x.c);
    // A few spare colours from the nearest hues, then an even pick across their lightness.
    const spare = near.slice(0, Math.max(want, Math.ceil(want * 1.6))).sort((a, b) => b.L - a.L);
    let chosen = spare.length <= want
      ? spare
      : Array.from({ length: want }, (_, i) => spare[want === 1 ? 0 : Math.round((i * (spare.length - 1)) / (want - 1))]);
    if (accent) chosen.push(accent);
    chosen = chosen.sort((a, b) => b.L - a.L).map(c => c.hex);
    let k = 0;
    return palette.map(p => (p.locked ? p.color : chosen[k++ % chosen.length]));
  }

  // Returns new colours for the palette; locked entries keep theirs and set the base hue.
  function generate(palette, harmony, rnd = Math.random) {
    if (PALETTES[harmony]) return pickFixed(palette, PALETTES[harmony], rnd);
    const m = MATERIALS[harmony];
    const locked = palette.find(p => p.locked);
    const base = m ? m.h[0] + rnd() * (m.h[1] - m.h[0]) : locked ? rgbToLch(hexToRgb(locked.color))[2] : rnd() * 360;
    return palette.map((p, i) => {
      if (p.locked) return p.color;
      return m ? pickMaterial(i, palette.length, m, base, rnd) : pick(i, palette.length, base, harmony, rnd);
    });
  }

  return { hexToRgb, rgbToHex, parseHex, rgbToOklab, oklabToRgb, rgbToLch, lchToRgb, distance, shade, generate, HARMONIES, MATERIALS, PALETTES };
})();
