// Motion 3D — motor da prévia + rack de sliders + render MP4 na GPU do usuário
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { params as P, config, lightPresets, createScene } from './scene.js';
import { PRESETS, parseColors, autoRoles, ROLE_LABELS } from './palette.js';
import { FINISHES, FRAMES, finishAtlas } from './finish.js';

const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

// ------------------------------------------------------------------ estado
const DEFAULT_PARAMS = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.value]));
const state = {
  palette: { name: PRESETS[9].name, colors: PRESETS[9].colors.slice(), roles: autoRoles(PRESETS[9].colors) },
  finish: { id: 'papel', amount: 0.3, scale: 1.4, blend: 'softlight', boil: 0 },
  previewScale: 0.75,
  playing: true,
  t: 0,
  rendering: false,
};
const DEFAULT_FINISH = { ...state.finish };
const STORE = 'motion3d.settings.v1';

// ------------------------------------------------------------------ render
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const S = createScene(renderer);

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    tFinish: { value: null },
    uHasFinish: { value: 0 },
    uAmt: { value: 0.3 },
    uScale: { value: 1.4 },
    uMode: { value: 0 },
    uFrame: { value: 0 },
    uFrames: { value: FRAMES },
    uAspect: { value: 16 / 9 },
    uCA: { value: 0.0006 },
    uDist: { value: 0.02 },
    uSat: { value: 1 },
    uLift: { value: 0 },
    uGain: { value: 1 },
    uVigAmt: { value: 0.3 },
    uVigSize: { value: 0.4 },
    uVigFeather: { value: 0.7 },
    uVigShape: { value: 0.5 },
    uVigC: { value: new THREE.Vector2(0.5, 0.5) },
    uVigTint: { value: new THREE.Color(0, 0, 0) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tFinish;
    uniform float uHasFinish, uAmt, uScale, uMode, uFrame, uFrames, uAspect;
    uniform float uCA, uDist, uSat, uLift, uGain;
    uniform float uVigAmt, uVigSize, uVigFeather, uVigShape; uniform vec2 uVigC; uniform vec3 uVigTint;
    varying vec2 vUv;
    vec2 barrel(vec2 uv){
      vec2 p = uv - 0.5; p.x *= uAspect;
      float r2 = dot(p,p);
      float rc = 0.25*(uAspect*uAspect + 1.0);
      p *= (1.0 + uDist*r2) / (1.0 + uDist*rc);
      p.x /= uAspect;
      return p + 0.5;
    }
    void main(){
      vec2 uv = barrel(vUv);
      vec2 d = uv - 0.5;
      float k = uCA * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, 0.5 + d*(1.0 + k)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, 0.5 + d*(1.0 - k)).b;
      // grade
      col = col * uGain + uLift * (1.0 - col);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = max(mix(vec3(l), col, uSat), 0.0);
      // vinheta
      vec2 q = vUv - uVigC;
      float circle = length(q * vec2(uAspect, 1.0)) / (0.5 * sqrt(uAspect*uAspect + 1.0)) * 1.15;
      float frame = pow(pow(abs(q.x*2.0), 5.0) + pow(abs(q.y*2.0), 5.0), 0.2);
      float dd = mix(frame, circle, uVigShape);
      float v = smoothstep(uVigSize, uVigSize + uVigFeather, dd);
      col = mix(col, uVigTint, v * uVigAmt);
      // textura de acabamento (neutra em 0.5)
      if (uHasFinish > 0.5) {
        vec2 fuv = fract(vUv * vec2(uAspect, 1.0) * uScale);
        fuv.y = (fuv.y + uFrame) / uFrames;
        float f = texture2D(tFinish, fuv).r;
        vec3 c = clamp(col, 0.0, 1.0);
        vec3 res;
        if (uMode < 0.5) res = (1.0 - 2.0*f)*c*c + 2.0*f*c;                       // soft light
        else if (uMode < 1.5) res = mix(2.0*c*f, 1.0 - 2.0*(1.0-c)*(1.0-f), step(0.5, c)); // overlay
        else res = c * (2.0 * f);                                                   // multiply
        col = mix(col, res, uAmt);
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(S.scene, S.camera);
const bokeh = new BokehPass(S.scene, S.camera, { focus: 9, aperture: 0.0005, maxblur: 0.012 });
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 288), 0.08, 0.45, 0.86);
const output = new OutputPass();
const smaa = new SMAAPass(512, 288);
const finishPass = new ShaderPass(FinishShader);
composer.addPass(renderPass);
composer.addPass(bokeh);
composer.addPass(bloom);
composer.addPass(output);
composer.addPass(smaa);
composer.addPass(finishPass);

let finishTex = null;
function setFinishTexture() {
  const atlas = finishAtlas(state.finish.id);
  if (finishTex) { finishTex.dispose(); finishTex = null; }
  if (atlas) {
    finishTex = new THREE.CanvasTexture(atlas);
    finishTex.colorSpace = THREE.NoColorSpace;
    finishTex.generateMipmaps = false;
    finishTex.minFilter = THREE.LinearFilter;
    finishTex.magFilter = THREE.LinearFilter;
    finishTex.flipY = false;
  }
  finishPass.uniforms.tFinish.value = finishTex;
  finishPass.uniforms.uHasFinish.value = finishTex ? 1 : 0;
}

let curW = 0, curH = 0;
function setRenderSize(w, hgt) {
  w = Math.max(16, Math.round(w)); hgt = Math.max(16, Math.round(hgt));
  if (w === curW && hgt === curH) return;
  curW = w; curH = hgt;
  renderer.setSize(w, hgt, false);
  composer.setSize(w, hgt);
  finishPass.uniforms.uAspect.value = w / hgt;
}

function renderAt(t) {
  const aspect = curW / curH;
  const { focus } = S.update(t, aspect);
  renderer.toneMappingExposure = P.exposicao.value;
  const ap = P.dof.value;
  bokeh.enabled = ap > 0.001;
  bokeh.uniforms.focus.value = focus;
  bokeh.uniforms.aperture.value = ap * ap * 0.0035 * (P.lente.value / 50);
  bokeh.uniforms.maxblur.value = 0.004 + ap * 0.012;
  bloom.enabled = P.bloom.value > 0.001;
  bloom.strength = P.bloom.value;
  const U = finishPass.uniforms;
  U.uCA.value = P.ca.value;
  U.uDist.value = P.distorcao.value;
  U.uSat.value = P.saturacao.value;
  U.uLift.value = P.lift.value;
  U.uGain.value = P.gain.value;
  U.uVigAmt.value = P.vigAmt.value;
  U.uVigSize.value = P.vigSize.value;
  U.uVigFeather.value = P.vigFeather.value;
  U.uVigShape.value = P.vigShape.value;
  U.uVigC.value.set(P.vigX.value, 1 - P.vigY.value);
  U.uVigTint.value.set(0, 0, 0).lerp(new THREE.Color(state.palette.roles.anchor).multiplyScalar(0.55), P.vigTint.value);
  U.uAmt.value = state.finish.amount;
  U.uScale.value = state.finish.scale;
  U.uMode.value = { softlight: 0, overlay: 1, multiply: 2 }[state.finish.blend] ?? 0;
  U.uFrame.value = state.finish.boil > 0 ? Math.floor(t * state.finish.boil + 1e-6) % FRAMES : 0;
  composer.render();
}

// ------------------------------------------------------------------ prévia
const viewWrap = $('#viewWrap');
function fitPreview() {
  if (state.rendering) return;
  const r = viewWrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.min(1920, r.width * dpr * state.previewScale);
  setRenderSize(w, w * 9 / 16);
}
new ResizeObserver(fitPreview).observe(viewWrap);

let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0;
function tick(now) {
  requestAnimationFrame(tick);
  if (state.rendering) { last = now; return; }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const T = P.duracao.value;
  if (state.playing) state.t = (state.t + dt) % T;
  if (state.t >= T) state.t = state.t % T;
  renderAt(state.t);
  fpsAcc += dt; fpsN++;
  if (now - fpsT > 500) {
    $('#fps').textContent = `${Math.round(fpsN / Math.max(fpsAcc, 1e-3))} fps · ${curW}×${curH}`;
    fpsAcc = 0; fpsN = 0; fpsT = now;
  }
  $('#scrub').value = String(Math.round((state.t / T) * 1000));
  $('#tcode').textContent = `${state.t.toFixed(2)} / ${T.toFixed(1)} s`;
}

// ------------------------------------------------------------------ verificação de suavidade da câmera
function camCheck() {
  const T = P.duracao.value, N = 480, dt = T / N;
  const hfov = 2 * Math.atan(18 / P.lente.value) * 180 / Math.PI;
  let prev = null, prevRoll = 0, maxDeg = 0;
  for (let i = 0; i <= N; i++) {
    const c = S.cameraAt(i * dt);
    const dir = c.look.clone().sub(c.pos).normalize();
    if (prev) {
      const a = Math.acos(Math.min(1, Math.max(-1, dir.dot(prev)))) * 180 / Math.PI;
      const r = Math.abs(c.roll - prevRoll) * 180 / Math.PI;
      maxDeg = Math.max(maxDeg, Math.hypot(a, r) / dt);
    }
    prev = dir; prevRoll = c.roll;
  }
  const screen = maxDeg / hfov;
  const f = Math.max(maxDeg / 35, screen / 0.35);
  const el = $('#camcheck');
  if (!el) return;
  if (f <= 1) { el.textContent = `Suavidade ok · pico ${maxDeg.toFixed(1)}°/s · ${screen.toFixed(2)} quadros/s`; el.className = 'check ok'; }
  else { el.textContent = `Rápido demais — mínimo ${(T * f).toFixed(1)} s (pico ${maxDeg.toFixed(0)}°/s)`; el.className = 'check bad'; }
}

// ------------------------------------------------------------------ ajustes (salvar / copiar / colar)
function getSettings() {
  return {
    v: 1,
    params: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.value])),
    palette: state.palette,
    finish: state.finish,
  };
}
function applySettings(s) {
  if (!s || typeof s !== 'object') return;
  if (s.params) for (const [k, v] of Object.entries(s.params)) if (P[k] && typeof v === 'number') P[k].value = v;
  if (s.palette && s.palette.roles) {
    state.palette = { name: s.palette.name || 'Personalizada', colors: s.palette.colors || [], roles: s.palette.roles };
    S.applyPalette(state.palette.roles);
  }
  if (s.finish) { state.finish = { ...DEFAULT_FINISH, ...s.finish }; setFinishTexture(); }
  refreshUI();
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(getSettings())); } catch (e) { /* sem storage */ } }, 250);
  camCheck();
}

// ------------------------------------------------------------------ UI
const sliders = {};
function slider(key) {
  const p = P[key];
  const val = h('span', { class: 'val' });
  const inp = h('input', { type: 'range', min: p.min, max: p.max, step: p.step, value: p.value });
  const fmt = () => {
    const d = p.step >= 1 ? 0 : p.step >= 0.1 ? 1 : p.step >= 0.01 ? 2 : p.step >= 0.001 ? 3 : 4;
    val.textContent = Number(p.value).toFixed(d) + (p.unit ? ` ${p.unit}` : '');
  };
  inp.addEventListener('input', () => { p.value = parseFloat(inp.value); fmt(); save(); });
  inp.addEventListener('dblclick', () => { p.value = DEFAULT_PARAMS[key]; inp.value = p.value; fmt(); save(); });
  fmt();
  sliders[key] = { inp, fmt };
  return h('label', { class: 'row', title: 'Duplo clique para voltar ao padrão' }, h('span', { class: 'lbl' }, p.label), val, inp);
}
function panel(title, open, ...kids) {
  const d = h('details', { class: 'panel' }, h('summary', {}, title), h('div', { class: 'body' }, ...kids));
  if (open) d.open = true;
  return d;
}
const keysOf = (g) => Object.keys(P).filter((k) => P[k].group === g);

function refreshUI() {
  for (const [k, s] of Object.entries(sliders)) { s.inp.value = P[k].value; s.fmt(); }
  renderPaletteUI();
  renderFinishUI();
  camCheck();
}

// --- cores
const paletteBox = h('div');
function renderPaletteUI() {
  paletteBox.innerHTML = '';
  const sel = h('select', {
    onchange: (e) => {
      const pr = PRESETS[+e.target.value];
      if (!pr) return;
      state.palette = { name: pr.name, colors: pr.colors.slice(), roles: autoRoles(pr.colors) };
      S.applyPalette(state.palette.roles); renderPaletteUI(); save();
    },
  }, h('option', { value: '-1' }, '— presets do Coolors —'), ...PRESETS.map((p, i) => h('option', { value: i }, p.name)));
  const idx = PRESETS.findIndex((p) => p.name === state.palette.name);
  sel.value = String(idx);
  const paste = h('input', { type: 'text', placeholder: 'Cole um link do Coolors ou códigos hex' });
  const apply = h('button', {
    onclick: () => {
      const cs = parseColors(paste.value);
      if (cs.length < 2) { paste.classList.add('err'); return; }
      paste.classList.remove('err');
      state.palette = { name: 'Coolors (colada)', colors: cs, roles: autoRoles(cs) };
      S.applyPalette(state.palette.roles); renderPaletteUI(); save();
    },
  }, 'Aplicar');
  const sw = h('div', { class: 'swatches' }, ...state.palette.colors.map((c) => h('span', { style: `background:#${c}`, title: '#' + c })));
  const roles = h('div', { class: 'roles' }, ...Object.entries(ROLE_LABELS).map(([k, label]) => {
    const inp = h('input', { type: 'color', value: state.palette.roles[k] });
    inp.addEventListener('input', () => { state.palette.roles[k] = inp.value; S.applyPalette(state.palette.roles); save(); });
    return h('label', { class: 'role' }, inp, h('span', {}, label));
  }));
  paletteBox.append(
    h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Paleta'), sel),
    h('div', { class: 'paste' }, paste, apply),
    h('div', { class: 'muted' }, `Em uso: ${state.palette.name}`), sw, roles,
    h('a', { href: 'https://coolors.co/palettes/trending', target: '_blank', rel: 'noopener', class: 'link' }, 'Abrir paletas em alta no Coolors ↗'),
  );
}

// --- acabamento
const finishBox = h('div');
function renderFinishUI() {
  finishBox.innerHTML = '';
  const grid = h('div', { class: 'chips' }, ...FINISHES.map((f) => h('button', {
    class: 'chip' + (state.finish.id === f.id ? ' on' : ''),
    onclick: () => {
      state.finish.id = f.id;
      $('#busy').hidden = false;
      setTimeout(() => { setFinishTexture(); $('#busy').hidden = true; renderFinishUI(); save(); }, 30);
    },
  }, f.label)));
  const mk = (label, key, min, max, step, unit = '') => {
    const val = h('span', { class: 'val' }, String(state.finish[key]) + unit);
    const inp = h('input', { type: 'range', min, max, step, value: state.finish[key] });
    inp.addEventListener('input', () => { state.finish[key] = parseFloat(inp.value); val.textContent = state.finish[key] + unit; save(); });
    inp.addEventListener('dblclick', () => { state.finish[key] = DEFAULT_FINISH[key]; inp.value = state.finish[key]; val.textContent = state.finish[key] + unit; save(); });
    return h('label', { class: 'row' }, h('span', { class: 'lbl' }, label), val, inp);
  };
  const blend = h('select', { onchange: (e) => { state.finish.blend = e.target.value; save(); } },
    h('option', { value: 'softlight' }, 'Luz suave'), h('option', { value: 'overlay' }, 'Sobreposição'), h('option', { value: 'multiply' }, 'Multiplicar'));
  blend.value = state.finish.blend;
  finishBox.append(grid,
    mk('Intensidade', 'amount', 0, 1, 0.01),
    mk('Escala', 'scale', 0.3, 4, 0.05),
    h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Mesclagem'), blend),
    mk('Boil (0 = parado)', 'boil', 0, 24, 1, ' fps'));
}

// --- render
const R = {
  res: '1920x1080', fps: 60, ss: 1.5, mb: 8, shutter: 180, mbps: 40, repeat: 1,
};
const renderBox = h('div');
function buildRenderUI() {
  const sel = (key, opts) => {
    const s = h('select', { onchange: (e) => { R[key] = isNaN(+e.target.value) ? e.target.value : +e.target.value; estimate(); } },
      ...opts.map(([v, l]) => h('option', { value: v }, l)));
    s.value = String(R[key]);
    return s;
  };
  const row = (label, el) => h('div', { class: 'row' }, h('span', { class: 'lbl' }, label), el);
  renderBox.append(
    row('Resolução', sel('res', [['1280x720', '720p'], ['1920x1080', '1080p Full HD'], ['2560x1440', '1440p'], ['3840x2160', '4K UHD'], ['1080x1080', 'Quadrado 1080'], ['1080x1920', 'Vertical 1080×1920']])),
    row('Quadros por segundo', sel('fps', [['24', '24'], ['30', '30'], ['60', '60']])),
    row('Supersampling', sel('ss', [['1', '1× (rápido)'], ['1.5', '1,5×'], ['2', '2× (bordas limpas)']])),
    row('Motion blur', sel('mb', [['0', 'Desligado'], ['4', '4 sub-quadros'], ['8', '8 sub-quadros'], ['16', '16 sub-quadros']])),
    row('Obturador', sel('shutter', [['90', '90°'], ['180', '180° (cinema)'], ['270', '270°']])),
    row('Bitrate', sel('mbps', [['12', '12 Mb/s'], ['25', '25 Mb/s'], ['40', '40 Mb/s'], ['80', '80 Mb/s'], ['150', '150 Mb/s']])),
    row('Duração do arquivo', sel('repeat', [['1', 'Loop 1×'], ['2', 'Loop 2×'], ['3', 'Loop 3×'], ['4', 'Loop 4×'], ['8', 'Loop 8×']])),
    h('div', { class: 'muted', id: 'estimate' }, ''),
    h('div', { class: 'btns' },
      h('button', { class: 'primary', id: 'btnRender', onclick: renderMP4 }, 'Renderizar MP4'),
      h('button', { onclick: gpuTest }, 'Testar meu computador'),
      h('button', { onclick: saveStill }, 'Salvar quadro PNG')),
    h('div', { class: 'progress', id: 'prog', hidden: true }, h('div', { class: 'bar', id: 'progBar' }), h('span', { id: 'progTxt' })),
    h('div', { class: 'muted' }, 'Mantenha a aba visível e o notebook na tomada durante o render.'),
  );
}
let msPerMP = null; // ms por megapixel por sub-quadro, medido
function estimate() {
  const el = $('#estimate');
  if (!el) return;
  const [w, hh] = R.res.split('x').map(Number);
  const frames = Math.round(P.duracao.value * R.fps);
  const sub = Math.max(1, R.mb);
  const mp = (w * hh * R.ss * R.ss) / 1e6;
  if (msPerMP == null) { el.textContent = `${frames} quadros × ${sub} sub-quadro(s). Clique em "Testar meu computador" para estimar o tempo.`; return; }
  const sec = (frames * sub * mp * msPerMP) / 1000;
  el.textContent = `${frames} quadros × ${sub} sub-quadro(s) · estimativa ≈ ${fmtTime(sec)} na sua GPU`;
}
const fmtTime = (s) => (s < 90 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);

function syncGPU() {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
}
async function gpuTest() {
  if (state.rendering) return;
  state.rendering = true;
  const el = $('#estimate');
  el.textContent = 'Medindo a GPU…';
  await new Promise((r) => setTimeout(r, 30));
  setRenderSize(1920, 1080);
  for (let i = 0; i < 3; i++) renderAt(0);
  syncGPU();
  const N = 12;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) { renderAt((i / N) * P.duracao.value); syncGPU(); }
  const ms = (performance.now() - t0) / N;
  msPerMP = ms / ((1920 * 1080) / 1e6);
  state.rendering = false;
  curW = 0; fitPreview();
  const f = Math.round(P.duracao.value * 60);
  const est = (w, hh, ss, mb) => fmtTime((f * Math.max(1, mb) * (w * hh * ss * ss) / 1e6 * msPerMP) / 1000);
  $('#gpuinfo').textContent = `Sua GPU: ${ms.toFixed(1)} ms por quadro 1080p. Estimativas (${P.duracao.value}s a 60 fps): ` +
    `1080p rápido ${est(1920, 1080, 1, 0)} · 1080p 1,5× + blur 8 ${est(1920, 1080, 1.5, 8)} · 4K + blur 8 ${est(3840, 2160, 1, 8)}`;
  estimate();
}

async function saveFile(name, blob) {
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      const dl = await window.claude.use('downloads');
      if (dl) {
        try { await dl.save({ filename: name, data: blob }); return 'saved'; }
        catch (e) { if (e && e.code === 'declined') return 'declined'; if (e && e.code === 'rate_limited') return 'busy'; }
      }
    }
  } catch (e) { /* cai no download direto */ }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 120000);
  return 'saved';
}

async function saveStill() {
  if (state.rendering) return;
  state.rendering = true;
  const [w, hh] = R.res.split('x').map(Number);
  const ss = Math.min(R.ss, maxSS(w, hh));
  setRenderSize(w * ss, hh * ss);
  for (let i = 0; i < 3; i++) renderAt(state.t);
  const out = document.createElement('canvas');
  out.width = w; out.height = hh;
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, 0, 0, w, hh);
  state.rendering = false;
  curW = 0; fitPreview();
  const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
  await saveFile(`motion3d_${w}x${hh}_t${state.t.toFixed(2)}.png`, blob);
}

function maxSS(w, hh) {
  const max = renderer.capabilities.maxTextureSize || 8192;
  return Math.max(1, Math.min(2, Math.floor((max / Math.max(w, hh)) * 100) / 100));
}

async function pickConfig(w, hh, fps, bitrate) {
  const codecs = ['avc1.640034', 'avc1.640033', 'avc1.64002a', 'avc1.640028', 'avc1.4d0034', 'avc1.4d002a', 'avc1.42003e'];
  for (const codec of codecs) {
    for (const hw of ['prefer-hardware', 'no-preference', 'prefer-software']) {
      const cfg = { codec, width: w, height: hh, bitrate, framerate: fps, hardwareAcceleration: hw, avc: { format: 'avc' }, latencyMode: 'quality' };
      try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return cfg; } catch (e) { /* tenta o próximo */ }
    }
  }
  return null;
}

async function renderMP4() {
  if (state.rendering) return;
  if (typeof VideoEncoder === 'undefined') { alertBox('Este navegador não tem WebCodecs. Use o Chrome, Edge ou Safari 17+ atualizados.'); return; }
  const [w, hh] = R.res.split('x').map(Number);
  const fps = R.fps, T = P.duracao.value, frames = Math.round(T * fps);
  const cfg = await pickConfig(w, hh, fps, R.mbps * 1e6);
  if (!cfg) { alertBox(`Seu navegador não consegue codificar H.264 em ${w}×${hh}. Tente uma resolução menor.`); return; }
  state.rendering = true;
  const btn = $('#btnRender'); btn.disabled = true;
  const prog = $('#prog'); prog.hidden = false;
  const bar = $('#progBar'), txt = $('#progTxt');
  const ss = Math.min(R.ss, maxSS(w, hh));
  const sub = Math.max(1, R.mb);
  const shutter = (R.shutter / 360) / fps;
  const chunks = [];
  let encErr = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      chunks.push({ buf, type: chunk.type, ts: chunk.timestamp, dur: chunk.duration, meta });
    },
    error: (e) => { encErr = e; },
  });
  encoder.configure(cfg);
  const out = document.createElement('canvas');
  out.width = w; out.height = hh;
  const g = out.getContext('2d', { alpha: false });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const t0 = performance.now();
  try {
    setRenderSize(w * ss, hh * ss);
    for (let i = 0; i < 4; i++) renderAt(0); // aquecimento: o 1º quadro sai igual aos outros
    syncGPU();
    for (let i = 0; i < frames; i++) {
      const t = i / fps;
      for (let s = 0; s < sub; s++) {
        let ts = sub > 1 ? t + ((s + 0.5) / sub - 0.5) * shutter : t;
        ts = ((ts % T) + T) % T;
        renderAt(ts);
        g.globalAlpha = 1 / (s + 1);
        g.drawImage(canvas, 0, 0, w, hh);
      }
      g.globalAlpha = 1;
      const vf = new VideoFrame(out, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      if (encErr) throw encErr;
      while (encoder.encodeQueueSize > 3) await new Promise((r) => setTimeout(r, 2));
      if (i % 2 === 0 || i === frames - 1) {
        const el = (performance.now() - t0) / 1000;
        const left = (el / (i + 1)) * (frames - i - 1);
        bar.style.width = `${((i + 1) / frames) * 100}%`;
        txt.textContent = `Quadro ${i + 1}/${frames} · ${fmtTime(el)} · faltam ≈ ${fmtTime(left)}`;
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await encoder.flush();
    encoder.close();
    if (encErr) throw encErr;
    txt.textContent = 'Montando o arquivo MP4…';
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: w, height: hh, frameRate: fps },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    const loopUs = Math.round((frames * 1e6) / fps);
    for (let r = 0; r < R.repeat; r++) {
      for (const c of chunks) muxer.addVideoChunkRaw(c.buf, c.type, c.ts + r * loopUs, c.dur ?? Math.round(1e6 / fps), r === 0 ? c.meta : undefined);
    }
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    const mb = (blob.size / 1048576).toFixed(1);
    const name = `motion3d_${w}x${hh}_${fps}fps_${(T * R.repeat).toFixed(0)}s.mp4`;
    txt.textContent = `Pronto: ${mb} MB em ${fmtTime((performance.now() - t0) / 1000)}. Salvando…`;
    lastVideo = { name, blob };
    const res = await saveFile(name, blob);
    txt.textContent = res === 'declined' ? `Render pronto (${mb} MB). Download recusado — clique em "Salvar de novo".`
      : `Pronto: ${name} · ${mb} MB`;
    $('#again').hidden = false;
  } catch (e) {
    console.error(e);
    txt.textContent = `Erro no render: ${e && e.message ? e.message : e}`;
    try { encoder.close(); } catch (_) { /* já fechado */ }
  } finally {
    state.rendering = false;
    btn.disabled = false;
    curW = 0; fitPreview();
  }
}
let lastVideo = null;

function alertBox(msg) {
  const m = $('#modal');
  $('#modalBody').innerHTML = '';
  $('#modalBody').append(h('p', {}, msg));
  $('#modalOk').onclick = () => { m.hidden = true; };
  m.hidden = false;
}

// --- ajustes copiar / colar
function buildSettingsUI() {
  return h('div', { class: 'btns' },
    h('button', {
      onclick: async (e) => {
        const txt = JSON.stringify(getSettings());
        try { await navigator.clipboard.writeText(txt); e.target.textContent = 'Copiado ✓'; }
        catch (_) { showPaste(txt); }
        setTimeout(() => { e.target.textContent = 'Copiar ajustes'; }, 1500);
      },
    }, 'Copiar ajustes'),
    h('button', { onclick: () => showPaste('') }, 'Colar ajustes'),
    h('button', {
      onclick: () => {
        for (const k of Object.keys(P)) P[k].value = DEFAULT_PARAMS[k];
        state.palette = { name: PRESETS[9].name, colors: PRESETS[9].colors.slice(), roles: autoRoles(PRESETS[9].colors) };
        state.finish = { ...DEFAULT_FINISH };
        S.applyPalette(state.palette.roles); setFinishTexture(); refreshUI(); save();
      },
    }, 'Voltar ao padrão'));
}
function showPaste(prefill) {
  const m = $('#modal');
  const ta = h('textarea', { rows: 8, placeholder: 'Cole aqui os ajustes copiados' });
  ta.value = prefill;
  $('#modalBody').innerHTML = '';
  $('#modalBody').append(h('p', {}, prefill ? 'Copie o texto abaixo:' : 'Cole os ajustes e clique OK:'), ta);
  $('#modalOk').onclick = () => {
    if (!prefill) {
      try { applySettings(JSON.parse(ta.value)); save(); } catch (_) { ta.classList.add('err'); return; }
    }
    m.hidden = true;
  };
  m.hidden = false;
  ta.focus(); if (prefill) ta.select();
}

// --- montar o rack
function buildRack() {
  const rack = $('#rack');
  const lensBtns = h('div', { class: 'chips' }, ...[14, 18, 24, 28, 35, 50, 85, 135].map((mm) => h('button', {
    class: 'chip', onclick: () => { P.lente.value = mm; sliders.lente.inp.value = mm; sliders.lente.fmt(); save(); },
  }, `${mm}`)));
  const lightBtns = h('div', { class: 'chips' }, ...Object.entries(lightPresets).map(([name, vals]) => h('button', {
    class: 'chip', onclick: () => { for (const [k, v] of Object.entries(vals)) P[k].value = v; refreshUI(); save(); },
  }, name)));
  rack.append(
    panel('Movimento', true, ...keysOf('motion').map(slider)),
    panel('Câmera', true, h('div', { class: 'muted' }, 'Observador flutuante: arco lateral suave + flutuação viva. A distância acompanha a lente, então o enquadramento fica parado.'),
      ...keysOf('camera').map(slider), h('div', { class: 'sub' }, 'Lentes (mm)'), lensBtns, h('div', { id: 'camcheck', class: 'check' })),
    panel('Luz', true, h('div', { class: 'sub' }, 'Presets'), lightBtns, ...keysOf('light').map(slider)),
    panel('Cores', true, paletteBox),
    panel('Acabamento (textura sobre o quadro)', false, finishBox),
    panel('Vinheta', false, ...keysOf('vignette').map(slider)),
    panel('Imagem (bloom, cor, lente)', false, ...keysOf('look').map(slider)),
    panel('Visualização', false, h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Resolução da prévia'),
      (() => {
        const s = h('select', { onchange: (e) => { state.previewScale = +e.target.value; curW = 0; fitPreview(); } },
          h('option', { value: '0.5' }, '50% (leve)'), h('option', { value: '0.75' }, '75%'), h('option', { value: '1' }, '100%'));
        s.value = String(state.previewScale);
        return s;
      })())),
    panel('Render final na sua GPU', true, renderBox, h('div', { class: 'muted', id: 'gpuinfo' }),
      h('button', { id: 'again', hidden: true, onclick: () => lastVideo && saveFile(lastVideo.name, lastVideo.blob) }, 'Salvar de novo')),
    panel('Ajustes', false, h('div', { class: 'muted' }, 'Os ajustes ficam salvos neste navegador. Copie para guardar um preset ou mandar para alguém.'), buildSettingsUI()),
  );
}

// --- transporte
function buildTransport() {
  const play = $('#play');
  const setIcon = () => { play.textContent = state.playing ? '❚❚' : '▶'; };
  play.onclick = () => { state.playing = !state.playing; setIcon(); };
  setIcon();
  $('#scrub').addEventListener('input', (e) => { state.playing = false; setIcon(); state.t = (+e.target.value / 1000) * P.duracao.value; });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); play.click(); }
  });
}

// ------------------------------------------------------------------ início
(function start() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && saved.params) for (const [k, v] of Object.entries(saved.params)) if (P[k] && typeof v === 'number') P[k].value = v;
    if (saved && saved.palette && saved.palette.roles) state.palette = saved.palette;
    if (saved && saved.finish) state.finish = { ...DEFAULT_FINISH, ...saved.finish };
  } catch (e) { /* sem storage */ }
  S.applyPalette(state.palette.roles);
  setFinishTexture();
  buildRenderUI();
  buildRack();
  buildTransport();
  refreshUI();
  estimate();
  fitPreview();
  $('#loading').hidden = true;
  requestAnimationFrame(tick);
  window.__motion = { renderAt, setRenderSize, P, state, S, R, renderMP4, getSettings, applySettings, config };
})();
