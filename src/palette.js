// Paletas Coolors + atribuição automática de papéis (light / anchor / cool / warm / accent)

export const PRESETS = [
  { name: 'Coolors · Sunset Desert', colors: ['264653', '2a9d8f', 'e9c46a', 'f4a261', 'e76f51'] },
  { name: 'Coolors · Vivid Pop', colors: ['ffbe0b', 'fb5607', 'ff006e', '8338ec', '3a86ff'] },
  { name: 'Coolors · Cotton Candy', colors: ['cdb4db', 'ffc8dd', 'ffafcc', 'bde0fe', 'a2d2ff'] },
  { name: 'Coolors · Olive Garden', colors: ['606c38', '283618', 'fefae0', 'dda15e', 'bc6c25'] },
  { name: 'Coolors · Fire & Cream', colors: ['003049', 'd62828', 'f77f00', 'fcbf49', 'eae2b7'] },
  { name: 'Coolors · Ocean Breeze', colors: ['8ecae6', '219ebc', '023047', 'ffb703', 'fb8500'] },
  { name: 'Coolors · Midnight Slate', colors: ['0d1b2a', '1b263b', '415a77', '778da9', 'e0e1dd'] },
  { name: 'Coolors · Neon Dream', colors: ['f72585', '7209b7', '3a0ca3', '4361ee', '4cc9f0'] },
  { name: 'Coolors · Peach Mint', colors: ['f6bd60', 'f7ede2', 'f5cac3', '84a59d', 'f28482'] },
  { name: 'Coolors · Terracotta', colors: ['f4f1de', 'e07a5f', '3d405b', '81b29a', 'f2cc8f'] },
];

// Aceita link do Coolors (coolors.co/264653-2a9d8f-...) ou lista de hex (#264653, 2a9d8f ...)
export function parseColors(str) {
  if (!str) return [];
  const m = String(str).match(/[0-9a-fA-F]{6}/g) || [];
  return m.map((h) => h.toLowerCase()).slice(0, 10);
}

function hexToRgb(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function lum(h) {
  const c = hexToRgb(h).map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function hsl(h) {
  const [r, g, b] = hexToRgb(h);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let s = 0, hue = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  return { h: hue, s, l };
}

// light = mais clara (fundo), anchor = mais escura (base), cool = mais azulada,
// accent = mais saturada / maior contraste, warm = a que sobrar
export function autoRoles(colors) {
  let cs = colors.map((c) => c.replace('#', '').toLowerCase()).filter((c) => /^[0-9a-f]{6}$/.test(c));
  if (!cs.length) cs = PRESETS[0].colors.slice();
  while (cs.length < 5) cs.push(cs[cs.length % Math.max(1, cs.length)]);
  const byLum = cs.slice().sort((a, b) => lum(b) - lum(a));
  const light = byLum[0];
  const anchor = byLum[byLum.length - 1];
  let rest = cs.filter((c) => c !== light && c !== anchor);
  if (rest.length < 3) rest = byLum.slice(1, 4);
  const coolScore = (c) => {
    const { h, s } = hsl(c);
    const d = Math.min(Math.abs(h - 205), 360 - Math.abs(h - 205));
    return (1 - d / 180) * (0.3 + s);
  };
  const cool = rest.slice().sort((a, b) => coolScore(b) - coolScore(a))[0];
  rest = rest.filter((c) => c !== cool);
  const accScore = (c) => hsl(c).s * 0.7 + Math.abs(lum(c) - lum(light)) * 0.6;
  const accent = rest.slice().sort((a, b) => accScore(b) - accScore(a))[0] || cool;
  const warm = rest.find((c) => c !== accent) || accent;
  return { light: '#' + light, anchor: '#' + anchor, cool: '#' + cool, warm: '#' + warm, accent: '#' + accent };
}

export const ROLE_LABELS = {
  light: 'Clara (fundo)',
  anchor: 'Âncora (base)',
  cool: 'Fria',
  warm: 'Quente',
  accent: 'Acento',
};
