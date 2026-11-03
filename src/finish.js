// Texturas de acabamento procedurais (papel, papelão, saco de papel, caderno, celofane,
// lousa, tecido, feltro). Saída neutra em cinza médio (128): só fibras / vincos / trama,
// sem tingir nem vinhetar. Tileáveis. Cada tipo tem vários quadros para o "boil".

export const FINISHES = [
  { id: 'none', label: 'Nenhum' },
  { id: 'papel', label: 'Papel' },
  { id: 'papelao', label: 'Papelão' },
  { id: 'saco', label: 'Saco de papel' },
  { id: 'caderno', label: 'Caderno' },
  { id: 'aquarela', label: 'Papel aquarela' },
  { id: 'celofane', label: 'Celofane' },
  { id: 'lousa', label: 'Lousa / giz' },
  { id: 'tecido', label: 'Tecido' },
  { id: 'feltro', label: 'Feltro' },
];

export const FRAMES = 4;
const S = 512;

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// value noise tileável (período = P células sobre o tile)
function lattice(P, r) {
  const v = new Float32Array(P * P);
  for (let i = 0; i < v.length; i++) v[i] = r() * 2 - 1;
  return v;
}
function vnoise(v, P, x, y) {
  // x, y em [0,1)
  const fx = x * P, fy = y * P;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  let tx = fx - ix, ty = fy - iy;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const x0 = ((ix % P) + P) % P, y0 = ((iy % P) + P) % P;
  const x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
  const a = v[y0 * P + x0], b = v[y0 * P + x1], c = v[y1 * P + x0], d = v[y1 * P + x1];
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}
function fbmField(seed, basePeriod, octaves, gain = 0.5) {
  const r = rng(seed);
  const lats = [];
  for (let o = 0; o < octaves; o++) lats.push({ P: basePeriod << o, v: lattice(basePeriod << o, r) });
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let s = 0, a = 1, n = 0;
      for (const L of lats) { s += a * vnoise(L.v, L.P, x / S, y / S); n += a; a *= gain; }
      out[y * S + x] = s / n;
    }
  }
  return out;
}
function whiteNoise(seed) {
  const r = rng(seed);
  const out = new Float32Array(S * S);
  for (let i = 0; i < out.length; i++) out[i] = r() * 2 - 1;
  return out;
}

// desenha traços (fibras, vincos) num canvas, com cópias para tilear
function strokes(seed, count, { len = [6, 30], width = [0.4, 1.2], alpha = [0.05, 0.18], curve = 0.4, dark = 0.5, straight = false, angle = null } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, S, S);
  const r = rng(seed);
  const lerp = (a, t) => a[0] + (a[1] - a[0]) * t;
  for (let i = 0; i < count; i++) {
    const x = r() * S, y = r() * S;
    const L = lerp(len, r());
    const ang = angle == null ? r() * Math.PI * 2 : angle + (r() - 0.5) * 0.15;
    const bend = (r() - 0.5) * curve * L;
    const isDark = r() < dark;
    const a = lerp(alpha, r());
    g.strokeStyle = isDark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    g.lineWidth = lerp(width, r());
    g.lineCap = 'round';
    const dx = Math.cos(ang) * L, dy = Math.sin(ang) * L;
    const nx = -Math.sin(ang) * bend, ny = Math.cos(ang) * bend;
    for (let ox = -S; ox <= S; ox += S) for (let oy = -S; oy <= S; oy += S) {
      const x0 = x + ox, y0 = y + oy;
      if (x0 + L < -L || x0 - L > S + L || y0 + L < -L || y0 - L > S + L) continue;
      g.beginPath();
      g.moveTo(x0 - dx / 2, y0 - dy / 2);
      if (straight) g.lineTo(x0 + dx / 2, y0 + dy / 2);
      else g.quadraticCurveTo(x0 + nx, y0 + ny, x0 + dx / 2, y0 + dy / 2);
      g.stroke();
    }
  }
  const d = g.getImageData(0, 0, S, S).data;
  const out = new Float32Array(S * S);
  for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] - 128) / 128;
  return out;
}

function build(id, f) {
  const seed = 1000 + f * 7919 + id.length * 131;
  const out = new Float32Array(S * S);
  const add = (src, k) => { for (let i = 0; i < out.length; i++) out[i] += src[i] * k; };
  switch (id) {
    case 'papel': {
      add(fbmField(seed, 4, 5, 0.55), 0.18);
      add(whiteNoise(seed + 1), 0.10);
      add(fbmField(seed + 2, 64, 2, 0.5), 0.12);
      add(strokes(seed + 3, 900, { len: [5, 22], alpha: [0.06, 0.2], dark: 0.45 }), 0.9);
      break;
    }
    case 'aquarela': {
      add(fbmField(seed, 8, 4, 0.6), 0.25);
      const pits = fbmField(seed + 1, 48, 2, 0.6);
      for (let i = 0; i < out.length; i++) out[i] += Math.max(0, -pits[i] - 0.15) * -0.9 + Math.max(0, pits[i] - 0.2) * 0.4;
      add(whiteNoise(seed + 2), 0.06);
      break;
    }
    case 'papelao': {
      const n = fbmField(seed, 4, 4, 0.5);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = y * S + x;
        out[i] += Math.sin((y / S) * Math.PI * 2 * 24 + n[i] * 1.2) * 0.12;
      }
      add(fbmField(seed + 1, 8, 5, 0.6), 0.22);
      add(whiteNoise(seed + 2), 0.12);
      add(strokes(seed + 3, 500, { len: [4, 14], alpha: [0.08, 0.22], dark: 0.6 }), 0.8);
      break;
    }
    case 'saco': {
      add(fbmField(seed, 4, 5, 0.5), 0.2);
      add(whiteNoise(seed + 1), 0.08);
      add(strokes(seed + 2, 1200, { len: [6, 26], alpha: [0.05, 0.16], dark: 0.5 }), 0.8);
      // vincos: pares claro/escuro longos
      add(strokes(seed + 3, 14, { len: [180, 420], width: [1.2, 2.6], alpha: [0.12, 0.3], curve: 0.08, dark: 0.5 }), 1.2);
      add(strokes(seed + 4, 14, { len: [180, 420], width: [4, 10], alpha: [0.03, 0.08], curve: 0.08, dark: 0.5 }), 1.2);
      break;
    }
    case 'caderno': {
      add(fbmField(seed, 4, 4, 0.5), 0.12);
      add(whiteNoise(seed + 1), 0.06);
      add(strokes(seed + 2, 500, { len: [5, 18], alpha: [0.04, 0.12] }), 0.7);
      for (let y = 0; y < S; y++) {
        const ly = (y % 32);
        const k = ly === 0 ? -0.35 : ly === 1 ? -0.15 : 0;
        if (k) for (let x = 0; x < S; x++) out[y * S + x] += k;
      }
      break;
    }
    case 'celofane': {
      add(strokes(seed, 160, { len: [40, 160], width: [0.6, 2.2], alpha: [0.15, 0.55], curve: 0.05, dark: 0.35, straight: true }), 1.1);
      add(strokes(seed + 1, 60, { len: [60, 220], width: [3, 9], alpha: [0.04, 0.12], curve: 0.05, dark: 0.3, straight: true }), 1.2);
      add(fbmField(seed + 2, 4, 3, 0.5), 0.15);
      break;
    }
    case 'lousa': {
      add(fbmField(seed, 2, 5, 0.6), 0.35);
      add(whiteNoise(seed + 1), 0.12);
      add(strokes(seed + 2, 140, { len: [40, 160], width: [6, 18], alpha: [0.02, 0.07], curve: 0.6, dark: 0.15 }), 1.3);
      break;
    }
    case 'tecido': {
      const n = fbmField(seed, 16, 3, 0.5);
      const w = whiteNoise(seed + 1);
      const per = 128;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const u = (x / S) * per * Math.PI, v = (y / S) * per * Math.PI;
        const over = (Math.floor(x / (S / per)) + Math.floor(y / (S / per))) % 2 ? 1 : -1;
        const warp = Math.abs(Math.sin(u)) * 0.5 + 0.5, weft = Math.abs(Math.sin(v)) * 0.5 + 0.5;
        out[i] += (over > 0 ? warp : weft) * 0.35 - 0.25 + n[i] * 0.15 + w[i] * 0.05;
      }
      add(fbmField(seed + 2, 4, 3, 0.5), 0.12);
      break;
    }
    case 'feltro': {
      add(whiteNoise(seed), 0.22);
      add(fbmField(seed + 1, 32, 3, 0.6), 0.25);
      add(fbmField(seed + 2, 4, 3, 0.5), 0.15);
      add(strokes(seed + 3, 3000, { len: [3, 10], width: [0.3, 0.8], alpha: [0.08, 0.25], curve: 1.2 }), 0.9);
      break;
    }
    default: break;
  }
  // normaliza para desvio-padrão fixo (intensidade comparável entre tipos)
  let m = 0;
  for (let i = 0; i < out.length; i++) m += out[i];
  m /= out.length;
  let v = 0;
  for (let i = 0; i < out.length; i++) v += (out[i] - m) ** 2;
  const sd = Math.sqrt(v / out.length) || 1;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let i = 0; i < out.length; i++) {
    const val = Math.max(0, Math.min(255, 128 + ((out[i] - m) / sd) * 34));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = val;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

const cache = new Map();
// devolve um canvas S x (S*FRAMES) com os quadros empilhados (um atlas vertical)
export function finishAtlas(id) {
  if (id === 'none') return null;
  if (cache.has(id)) return cache.get(id);
  const atlas = document.createElement('canvas');
  atlas.width = S; atlas.height = S * FRAMES;
  const g = atlas.getContext('2d');
  for (let f = 0; f < FRAMES; f++) g.drawImage(build(id, f), 0, f * S);
  cache.set(id, atlas);
  return atlas;
}
