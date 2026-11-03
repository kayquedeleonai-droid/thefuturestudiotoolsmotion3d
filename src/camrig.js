// Rig de câmera da skill Motion 3D:
// - B-spline cúbica uniforme (C2): fechada para loops, presa nas pontas para movimentos com começo e fim
// - cada controle tem posição do olho + ponto de interesse (elemento animado ou ponto fixo) + peso de mira
// - mira com mistura limitada por ângulo (slerp, nunca média linear de vetores opostos)
// - suavização gaussiana de fase zero da mira, da distância de foco e do banking
// - perfil de velocidade de operador: desacelera onde a vista gira, ease in/out nas pontas
// - "portais" (gate) = 3 controles colineares; "hold" = dois controles no mesmo elemento
// Tudo é função pura de t.

import * as THREE from 'three';

const V3 = THREE.Vector3;
const D2R = Math.PI / 180;

function basis(t) {
  const t2 = t * t, t3 = t2 * t;
  return [(1 - 3 * t + 3 * t2 - t3) / 6, (4 - 6 * t2 + 3 * t3) / 6, (1 + 3 * t + 3 * t2 - 3 * t3) / 6, t3 / 6];
}

// rotaciona o vetor unitário a em direção a b por um ângulo `ang` (rad)
function rotateToward(a, b, ang) {
  const d = Math.min(1, Math.max(-1, a.dot(b)));
  const full = Math.acos(d);
  if (full < 1e-6) return a.clone();
  const f = Math.min(1, ang / full);
  // slerp
  const s = Math.sin(full);
  return a.clone().multiplyScalar(Math.sin((1 - f) * full) / s).add(b.clone().multiplyScalar(Math.sin(f * full) / s)).normalize();
}

// ------------------------------------------------------------------ resolver pontos da especificação
// eye: [x,y,z] | {near:'nome'|[x,y,z], az, el, dist, dy?}
// look: 'nome' | [x,y,z] | {near:'nome', offset:[x,y,z]}
function resolveEye(e, subjects) {
  if (Array.isArray(e)) return new V3(+e[0] || 0, +e[1] || 0, +e[2] || 0);
  if (e && typeof e === 'object') {
    const base = Array.isArray(e.near) ? new V3(...e.near.map(Number)) : (subjects[e.near] ? subjects[e.near].rest.clone() : new V3(0, 1.2, 0));
    const az = (+e.az || 0) * D2R, el = (+e.el || 0) * D2R, dist = e.dist == null ? 3 : +e.dist;
    return base.add(new V3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(dist)).add(new V3(0, +e.dy || 0, 0));
  }
  return new V3(0, 2, 8);
}
function resolveLook(l, subjects) {
  if (typeof l === 'string' && subjects[l]) { const s = subjects[l]; return (t) => s.at(t); }
  if (Array.isArray(l)) { const p = new V3(+l[0] || 0, +l[1] || 0, +l[2] || 0); return () => p.clone(); }
  if (l && typeof l === 'object' && subjects[l.near]) {
    const s = subjects[l.near], o = new V3(...(l.offset || [0, 0, 0]).map(Number));
    return (t) => s.at(t).add(o);
  }
  return () => (subjects.centro ? subjects.centro.at(0) : new V3(0, 1.2, 0));
}

// ------------------------------------------------------------------ construir o rig
export function buildRig(spec, subjects, defaults = {}) {
  const loop = !!spec.loop;
  const ctrls = [];
  const defLens = spec.lens || defaults.lens || 35;
  for (const k of spec.keys || []) {
    const look = resolveLook(k.look, subjects);
    const base = {
      look,
      lookName: typeof k.look === 'string' ? k.look : null,
      w: k.aim == null ? 1 : Math.max(0, Math.min(1, +k.aim)),
      lens: k.lens ? +k.lens : null,
      dof: k.dof == null ? (spec.dof == null ? 1 : +spec.dof) : +k.dof,
    };
    const hold = +k.hold || 0;
    if (k.gate) {
      // portal: 3 controles colineares, atravessando em direção ao ponto de interesse
      const p = resolveEye(k.eye, subjects);
      const target = look(0);
      const dir = target.clone().sub(p); dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize().multiplyScalar(+k.gate > 0.05 ? +k.gate : 0.7);
      ctrls.push({ ...base, eye: p.clone().sub(dir), w: Math.min(base.w, 0.35) });
      ctrls.push({ ...base, eye: p.clone(), w: Math.min(base.w, 0.5) });
      ctrls.push({ ...base, eye: p.clone().add(dir) });
    } else if (hold && k.eye && !Array.isArray(k.eye) && typeof k.eye === 'object') {
      // segurar no elemento: dois controles com azimute ligeiramente diferente (continua deslizando)
      ctrls.push({ ...base, eye: resolveEye({ ...k.eye, az: (+k.eye.az || 0) - hold / 2 }, subjects) });
      ctrls.push({ ...base, eye: resolveEye({ ...k.eye, az: (+k.eye.az || 0) + hold / 2 }, subjects) });
    } else if (hold) {
      const p = resolveEye(k.eye, subjects);
      ctrls.push({ ...base, eye: p }, { ...base, eye: p.clone() });
    } else {
      ctrls.push({ ...base, eye: resolveEye(k.eye, subjects) });
    }
  }
  if (ctrls.length < 2) throw new Error('O movimento precisa de pelo menos 2 pontos de câmera.');

  // sequência de controles da spline
  let Q;
  if (loop) Q = ctrls;
  else Q = [ctrls[0], ctrls[0], ...ctrls, ctrls[ctrls.length - 1], ctrls[ctrls.length - 1]];
  const nSeg = loop ? Q.length : Q.length - 3;

  // pesos da spline para u ∈ [0,1]
  function weights(u) {
    if (loop) {
      const s = (((u % 1) + 1) % 1) * nSeg;
      const j = Math.floor(s), f = s - j;
      const b = basis(f);
      const n = Q.length;
      return [0, 1, 2, 3].map((i) => ({ c: Q[(((j - 1 + i) % n) + n) % n], b: b[i] }));
    }
    const uu = Math.max(0, Math.min(1, u));
    let s = uu * nSeg;
    let j = Math.floor(s);
    if (j >= nSeg) j = nSeg - 1;
    const f = s - j;
    const b = basis(f);
    return [0, 1, 2, 3].map((i) => ({ c: Q[j + i], b: b[i] }));
  }
  function eyeU(u) {
    const p = new V3();
    for (const { c, b } of weights(u)) p.addScaledVector(c.eye, b);
    return p;
  }
  function blendU(u, t) {
    const look = new V3();
    let w = 0, dof = 0, lensW = 0, lensSum = 0;
    for (const { c, b } of weights(u)) {
      look.addScaledVector(c.look(t), b);
      w += c.w * b; dof += c.dof * b;
      lensSum += (c.lens || 0) * b; lensW += c.lens ? b : 0;
    }
    return { look, w, dof, lens: lensW > 0.001 ? lensSum / lensW : null };
  }

  // tabela densa de "tempo de operador" ao longo da spline
  const M = 1600;
  const cum = new Float64Array(M + 1);
  let prevE = eyeU(0), prevD = blendU(0, 0).look.clone().sub(prevE).normalize();
  for (let k = 1; k <= M; k++) {
    const u = k / M;
    const e = eyeU(u);
    const d = blendU(u, 0).look.clone().sub(e).normalize();
    const lin = e.distanceTo(prevE);
    const ang = Math.acos(Math.min(1, Math.max(-1, d.dot(prevD)))) / D2R;
    cum[k] = cum[k - 1] + lin + ang / 7 + 0.004; // 1 m ≈ 7° de giro: o operador desacelera onde a vista gira
    prevE = e; prevD = d;
  }
  const total = cum[M];
  for (let k = 0; k <= M; k++) cum[k] /= total;

  const T = () => (defaults.duration ? defaults.duration() : spec.duration || 8);
  function uOf(t) {
    const Tn = T();
    let tau = loop ? ((((t / Tn) % 1) + 1) % 1) : Math.max(0, Math.min(1, t / Tn));
    if (!loop) {
      // ease in/out suave nas pontas (começa e termina parado, sem tranco)
      const e = tau * tau * tau * (tau * (tau * 6 - 15) + 10);
      tau = 0.45 * tau + 0.55 * e;
    }
    let lo = 0, hi = M;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= tau) lo = mid; else hi = mid; }
    const span = cum[hi] - cum[lo] || 1;
    return (lo + (tau - cum[lo]) / span) / M;
  }

  const eyeT = (t) => eyeU(uOf(t));
  function rawAt(t) {
    const u = uOf(t);
    const eye = eyeU(u);
    const bl = blendU(u, t);
    const target = bl.look.clone().sub(eye);
    const dist = Math.max(0.3, target.length());
    target.normalize();
    // olhar à frente (direção de deslocamento)
    const h = 1 / 240;
    const ahead = eyeT(t + h).sub(eyeT(t - h));
    let dir = target;
    if (bl.w < 0.999 && ahead.lengthSq() > 1e-8) {
      ahead.normalize();
      const full = Math.acos(Math.min(1, Math.max(-1, ahead.dot(target))));
      // desvio limitado: nunca mais que 35° fora do ponto de interesse
      dir = rotateToward(target, ahead, Math.min((1 - bl.w) * full, 35 * D2R));
    }
    return { eye, dir, dist, dof: bl.dof, lens: bl.lens, lookName: null };
  }
  function bankAt(t, dir) {
    const h = 1 / 30;
    const a = eyeT(t + h).add(eyeT(t - h)).sub(eyeT(t).multiplyScalar(2)).divideScalar(h * h);
    const right = new V3().crossVectors(dir, new V3(0, 1, 0));
    if (right.lengthSq() < 1e-8) return 0;
    right.normalize();
    const lat = a.dot(right);
    const max = (spec.bank == null ? 4 : Math.min(5, +spec.bank)) * D2R;
    return Math.max(-max, Math.min(max, -lat * 0.03));
  }

  // quadro final: suavização gaussiana de fase zero (σ ≈ 0,14 s)
  const SIG = 0.14;
  const TAPS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
  function frame(t) {
    const Tn = T();
    const dir = new V3();
    let dist = 0, bank = 0, wsum = 0, dof = 0;
    let lens = null;
    for (const k of TAPS) {
      let tt = t + k * SIG * 0.5;
      if (!loop) tt = Math.max(0, Math.min(Tn, tt));
      const g = Math.exp(-(k * k) / 8);
      const r = rawAt(tt);
      dir.addScaledVector(r.dir, g);
      dist += r.dist * g;
      dof += r.dof * g;
      bank += bankAt(tt, r.dir) * g;
      wsum += g;
      if (k === 0) lens = r.lens;
    }
    dir.normalize();
    dist /= wsum; bank /= wsum; dof /= wsum;
    const pos = eyeT(t);
    return { pos, look: pos.clone().addScaledVector(dir, dist), roll: bank, focus: dist, dofMul: Math.max(0, dof), lens };
  }

  function pathPoints(n = 400) {
    const Tn = T();
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(eyeT((i / n) * Tn));
    return pts;
  }

  return { loop, frame, pathPoints, controls: ctrls.map((c) => c.eye.clone()), spec };
}

// ------------------------------------------------------------------ checagem (camqa)
// cam(t) -> {pos, look, roll, lens}; obstacles(t) -> [{name, dist(p)}]; visible(t) -> pontos que devem caber no quadro
export function camQA(cam, T, obstacles, opts = {}) {
  const fps = opts.fps || 60;
  const N = Math.max(2, Math.round(T * fps));
  const rot = [];
  const scr = [];
  let prevQ = null;
  let minClear = Infinity, clearAt = 0, clearName = '';
  let emptyFrames = 0;
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const up = new V3(0, 1, 0);
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * T;
    const c = cam(t);
    m.lookAt(c.pos, c.look, up);
    q.setFromRotationMatrix(m);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 0, 1), c.roll || 0));
    if (prevQ) {
      const ang = (2 * Math.acos(Math.min(1, Math.abs(prevQ.dot(q))))) / D2R; // graus no quadro
      rot.push({ t, v: ang * fps });
      const hfov = (2 * Math.atan(18 / (c.lens || 35))) / D2R;
      scr.push(ang * fps / hfov);
    }
    prevQ = q.clone();
    for (const o of obstacles(t)) {
      const d = o.dist(c.pos);
      if (d < minClear) { minClear = d; clearAt = t; clearName = o.name; }
    }
    if (opts.inFrame) {
      const fwd = c.look.clone().sub(c.pos).normalize();
      const hfov = 2 * Math.atan(18 / (c.lens || 35));
      const vfov = 2 * Math.atan(Math.tan(hfov / 2) / (opts.aspect || 16 / 9));
      const right = new V3().crossVectors(fwd, up).normalize();
      const upv = new V3().crossVectors(right, fwd);
      const any = opts.inFrame(t).some((p) => {
        const d = p.clone().sub(c.pos);
        const z = d.dot(fwd);
        if (z <= 0.2) return false;
        return Math.abs(d.dot(right) / z) < Math.tan(hfov / 2) * 0.9 && Math.abs(d.dot(upv) / z) < Math.tan(vfov / 2) * 0.9;
      });
      if (!any) emptyFrames++;
    }
  }
  const vs = rot.map((r) => r.v).sort((a, b) => a - b);
  const p95 = vs[Math.floor(vs.length * 0.95)] || 0;
  const maxR = rot.reduce((a, r) => (r.v > a.v ? r : a), { v: 0, t: 0 });
  // variação de rotação quadro a quadro (aceleração angular)
  let maxDelta = 0, deltaAt = 0;
  for (let i = 1; i < rot.length; i++) {
    // mudança de giro por quadro, sempre medida como se fosse a 60 fps (regra da skill: ≤0,15°)
    const d = (Math.abs(rot[i].v - rot[i - 1].v) * fps) / 3600;
    if (d > maxDelta) { maxDelta = d; deltaAt = rot[i].t; }
  }
  const maxScr = scr.reduce((a, b) => Math.max(a, b), 0);
  const f = Math.max(p95 / 35, maxR.v / 50, maxScr / 0.35, Math.sqrt(maxDelta / 0.15));
  const clearOk = minClear >= 0.3;
  return {
    pass: f <= 1 && clearOk && emptyFrames === 0,
    p95, max: maxR.v, maxAt: maxR.t, maxDelta, deltaAt, screen: maxScr,
    minClear, clearAt, clearName, clearOk, emptyFrames,
    minDuration: f > 1 ? T * f : null,
  };
}
