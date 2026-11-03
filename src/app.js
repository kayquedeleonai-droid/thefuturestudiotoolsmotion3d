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
import { buildRig, camQA } from './camrig.js';
import { MOVES, promptFor, sanitizeMove } from './moves.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
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
  camera: { moveId: 'observador', custom: [] },
  view360: false,
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
  helpers.visible = false;
  const { focus, dofMul, lens } = S.update(t, aspect);
  renderer.toneMappingExposure = P.exposicao.value;
  const ap = P.dof.value * Math.min(1, Math.max(0, dofMul));
  bokeh.enabled = ap > 0.001;
  bokeh.uniforms.focus.value = focus;
  bokeh.uniforms.aperture.value = ap * ap * 0.0035 * (lens / 50) * (S.getRig() ? 2.2 : 1);
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
  if (state.view360) render360(state.t);
  else renderAt(state.t);
  fpsAcc += dt; fpsN++;
  if (now - fpsT > 500) {
    $('#fps').textContent = `${Math.round(fpsN / Math.max(fpsAcc, 1e-3))} fps · ${curW}×${curH}`;
    fpsAcc = 0; fpsN = 0; fpsT = now;
  }
  $('#scrub').value = String(Math.round((state.t / T) * 1000));
  $('#tcode').textContent = `${state.t.toFixed(2)} / ${T.toFixed(1)} s`;
}

// ------------------------------------------------------------------ checagem da câmera (camqa ao vivo)
let lastQA = null;
function camCheck() {
  const el = $('#camcheck');
  const T = P.duracao.value;
  const qa = camQA((t) => S.cameraAt(t), T, (t) => S.obstacles(t), {
    fps: 30,
    inFrame: (t) => Object.entries(S.subjects).filter(([k]) => k !== 'centro' && k !== 'anel').map(([, s]) => s.at(t)),
  });
  lastQA = qa;
  rebuildPath();
  if (!el) return qa;
  el.innerHTML = '';
  const line = (txt, cls = '') => el.append(h('div', { class: cls }, txt));
  if (qa.pass) {
    el.className = 'check ok';
    line(`Suavidade ok · giro p95 ${qa.p95.toFixed(0)}°/s, pico ${qa.max.toFixed(0)}°/s · ${qa.screen.toFixed(2)} quadros/s · folga ${qa.minClear.toFixed(2)} m`);
  } else {
    el.className = 'check bad';
    if (qa.minDuration) {
      line(`Rápido demais — mínimo ${(Math.ceil(qa.minDuration * 2) / 2).toFixed(1)} s (pico ${qa.max.toFixed(0)}°/s em ${qa.maxAt.toFixed(1)} s)`);
      el.append(h('button', { class: 'chip', onclick: () => { P.duracao.value = Math.min(P.duracao.max, Math.ceil(qa.minDuration * 2) / 2); refreshUI(); save(); } }, 'Usar a duração mínima'));
    }
    if (!qa.clearOk) line(`Passa perto demais de: ${qa.clearName} (${qa.minClear.toFixed(2)} m em ${qa.clearAt.toFixed(1)} s; mínimo 0,30 m)`);
    if (qa.emptyFrames) line(`${qa.emptyFrames} quadros sem nenhum elemento em cena`);
  }
  return qa;
}

// ------------------------------------------------------------------ movimentos de câmera
function allMoves() { return [...MOVES, ...state.camera.custom]; }
function findMove(id) { return allMoves().find((m) => m.id === id) || MOVES[0]; }
function applyMove(id, { setDefaults = true } = {}) {
  const m = findMove(id);
  const wasRig = !!S.getRig();
  state.camera.moveId = m.id;
  if (m.observer) {
    S.setRig(null);
    if (setDefaults && wasRig) { P.duracao.value = 4; P.lente.value = DEFAULT_PARAMS.lente; }
  } else {
    try {
      S.setRig(buildRig(m, S.subjects, { duration: () => P.duracao.value, lens: P.lente.value }));
    } catch (e) { moveStatus(`Movimento inválido: ${e.message}`, 'bad'); S.setRig(null); return; }
    if (setDefaults) { P.duracao.value = m.duration || P.duracao.value; if (m.lens) P.lente.value = m.lens; }
  }
  state.t = 0;
  refreshUI();
  renderMoveUI();
  save();
}
function moveStatus(msg, cls = '') { const el = $('#movestatus'); if (el) { el.textContent = msg; el.className = 'muted ' + cls; } }

let sampleFn = null;
let directCtl = null;
async function direct() {
  const ta = $('#moveprompt');
  const text = ta.value.trim();
  if (!text) { ta.classList.add('err'); return; }
  ta.classList.remove('err');
  if (!sampleFn) { moveStatus('O Claude não está disponível aqui. Abra o app no Claude ou descreva o movimento no chat.', 'bad'); return; }
  const btn = $('#btnDirect'), stop = $('#btnStop');
  btn.disabled = true; stop.hidden = false;
  directCtl = new AbortController();
  moveStatus('Pensando no movimento…');
  const ask = async (extra) => sampleFn.json(promptFor(text, S.subjects, { duration: P.duracao.value, lens: P.lente.value }) + (extra || ''), { signal: directCtl.signal, cache: false });
  try {
    let mv = sanitizeMove(await ask(), S.subjects);
    let rig = buildRig(mv, S.subjects, { duration: () => mv.duration });
    const qaOf = (r, T) => camQA((t) => { const f = r.frame(t); f.lens = f.lens || mv.lens; return f; }, T, (t) => S.obstacles(t), { fps: 30 });
    let qa = qaOf(rig, mv.duration);
    if (!qa.clearOk) {
      // uma rodada de correção com o relatório da checagem
      moveStatus(`Ajustando: a câmera passava a ${qa.minClear.toFixed(2)} m de ${qa.clearName}…`);
      const fix = `\n\nSUA VERSÃO ANTERIOR:\n${JSON.stringify(mv)}\nFALHOU NA CHECAGEM: a câmera passa a ${qa.minClear.toFixed(2)} m de "${qa.clearName}" em t=${qa.clearAt.toFixed(1)} s (mínimo 0,3 m). Afaste os pontos desse trecho (mais "dist" ou outro "az") e responda o JSON corrigido completo.`;
      mv = sanitizeMove(await ask(fix), S.subjects);
      rig = buildRig(mv, S.subjects, { duration: () => mv.duration });
      qa = qaOf(rig, mv.duration);
    }
    if (qa.minDuration && qa.minDuration > mv.duration) mv.duration = Math.min(40, Math.ceil(qa.minDuration * 2) / 2);
    mv.prompt = text;
    state.camera.custom.push(mv);
    applyMove(mv.id);
    renderMoveUI();
    const q2 = lastQA;
    moveStatus(`Pronto: “${mv.name}” · ${mv.duration} s · ${mv.keys.length} pontos${q2 && q2.pass ? ' · checagem ok' : ' · veja os avisos da checagem'}`, q2 && q2.pass ? 'okc' : 'bad');
  } catch (e) {
    const code = e && e.code;
    if (code === 'cancelled') moveStatus('Cancelado.');
    else if (code === 'not_granted' || code === 'sampling_disabled') { moveStatus('Sem permissão para usar o Claude nesta página.', 'bad'); }
    else if (code === 'rate_limited') moveStatus('Muitas chamadas agora. Tente de novo em instantes.', 'bad');
    else if (code === 'invalid_json') moveStatus('A resposta veio fora do formato. Clique em Dirigir de novo.', 'bad');
    else moveStatus(`Não deu certo: ${(e && (e.message || e.code)) || e}`, 'bad');
  } finally {
    btn.disabled = false; stop.hidden = true; directCtl = null;
  }
}

const moveBox = h('div');
function renderMoveUI() {
  moveBox.innerHTML = '';
  const m = findMove(state.camera.moveId);
  const sel = h('select', { onchange: (e) => applyMove(e.target.value) },
    ...allMoves().map((mv) => h('option', { value: mv.id }, (mv.custom ? '✦ ' : '') + mv.name)));
  sel.value = m.id;
  const ta = h('textarea', { id: 'moveprompt', rows: 3, placeholder: 'Ex.: mergulha até a cápsula, passa rente ao cubo, contorna o cromo por trás e abre no final mostrando tudo' });
  const directRow = h('div', { class: 'btns' },
    h('button', { class: 'primary', id: 'btnDirect', onclick: direct }, 'Dirigir câmera'),
    h('button', { id: 'btnStop', hidden: true, onclick: () => directCtl && directCtl.abort() }, 'Parar'));
  const promptWrap = h('div', { id: 'promptwrap', hidden: !sampleFn }, h('div', { class: 'sub' }, 'Dirigir por prompt'), ta, directRow);
  const noPrompt = h('div', { class: 'muted', id: 'noprompt', hidden: !!sampleFn },
    'Para dirigir por texto aqui, abra o app no Claude. Ou descreva o movimento no chat: o Claude escreve o caminho, confere a suavidade e adiciona aos movimentos salvos.');
  const tools = h('div', { class: 'btns' },
    h('button', { onclick: (e) => copyText(JSON.stringify(m.observer ? { id: m.id } : m, null, 1), e.target, 'Copiar JSON') }, 'Copiar JSON'),
    h('button', {
      onclick: () => showPaste('', (txt) => {
        const mv = sanitizeMove(JSON.parse(txt), S.subjects);
        state.camera.custom.push(mv); applyMove(mv.id); renderMoveUI();
      }),
    }, 'Colar JSON'),
    m.custom ? h('button', {
      onclick: () => { state.camera.custom = state.camera.custom.filter((x) => x.id !== m.id); applyMove('observador'); renderMoveUI(); },
    }, 'Excluir este') : null);
  moveBox.append(
    h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Movimento'), sel),
    h('div', { class: 'muted' }, m.prompt ? `“${m.prompt}”` : (m.note || '')),
    promptWrap, noPrompt, h('div', { id: 'movestatus', class: 'muted' }), tools);
}
async function copyText(txt, btn, label) {
  try { await navigator.clipboard.writeText(txt); btn.textContent = 'Copiado ✓'; setTimeout(() => { btn.textContent = label; }, 1500); }
  catch (_) { showPaste(txt); }
}

// ------------------------------------------------------------------ vista 360° (só olhar; caminho em azul, câmera em vermelho)
const helpers = new THREE.Group();
helpers.visible = false;
S.scene.add(helpers);
const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x3d8bff, depthTest: false, transparent: true }));
pathLine.renderOrder = 10;
const camCone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 24), new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false, transparent: true, opacity: 0.9 }));
camCone.geometry.rotateX(-Math.PI / 2); // aponta para -z (para onde a câmera olha)
camCone.renderOrder = 11;
const ctrlDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x3d8bff, size: 7, sizeAttenuation: false, depthTest: false }));
helpers.add(pathLine, camCone, ctrlDots);
const orbitCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 400);
orbitCam.position.set(9, 11, 16);
let orbit = null;
function rebuildPath() {
  const T = P.duracao.value, n = 300;
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(S.cameraAt((i / n) * T).pos);
  pathLine.geometry.dispose();
  pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  const rig = S.getRig();
  ctrlDots.geometry.dispose();
  ctrlDots.geometry = new THREE.BufferGeometry().setFromPoints(rig ? rig.controls : []);
}
function render360(t) {
  const aspect = curW / curH;
  S.update(t, aspect);
  helpers.visible = true;
  camCone.position.copy(S.camera.position);
  camCone.quaternion.copy(S.camera.quaternion);
  orbitCam.aspect = aspect;
  orbitCam.updateProjectionMatrix();
  if (orbit) orbit.update();
  renderer.toneMappingExposure = P.exposicao.value;
  renderer.setRenderTarget(null);
  renderer.render(S.scene, orbitCam);
  helpers.visible = false;
}
function toggle360() {
  state.view360 = !state.view360;
  if (state.view360 && !orbit) {
    orbit = new OrbitControls(orbitCam, canvas);
    orbit.target.set(0, 1.2, 0);
    orbit.enableDamping = true;
  }
  if (orbit) orbit.enabled = state.view360;
  $('#btn360').classList.toggle('on', state.view360);
  $('#btn360').textContent = state.view360 ? 'Vista da câmera' : 'Vista 360°';
}

// ------------------------------------------------------------------ ajustes (salvar / copiar / colar)
function getSettings() {
  return {
    v: 1,
    params: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.value])),
    palette: state.palette,
    finish: state.finish,
    camera: state.camera,
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
  if (s.camera) {
    state.camera = { moveId: s.camera.moveId || 'observador', custom: Array.isArray(s.camera.custom) ? s.camera.custom : [] };
    applyMove(state.camera.moveId, { setDefaults: false });
    renderMoveUI();
  }
  refreshUI();
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify(getSettings())); } catch (e) { /* sem storage */ }
    camCheck();
  }, 250);
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
// ícones brancos das abas (traço simples, 24×24)
const ICONS = {
  'Movimento': '<circle cx="15" cy="12" r="5"/><path d="M2.5 9h5M1.5 12h6M2.5 15h5"/>',
  'Câmera': '<rect x="2" y="7" width="13" height="10" rx="2"/><path d="M15 11l6-3v8l-6-3z"/>',
  'Luz': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  'Cores': '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1 .2-2.2 1.3-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11.5" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1.2" fill="currentColor"/><circle cx="15" cy="8" r="1.2" fill="currentColor"/>',
  'Acabamento': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 13l10-10M3 21L21 3M11 21l10-10"/>',
  'Vinheta': '<rect x="2" y="5" width="20" height="14" rx="2"/><ellipse cx="12" cy="12" rx="6" ry="4"/>',
  'Imagem': '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  'Visualização': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'Render': '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  'Ajustes': '<path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-0"/><circle cx="16" cy="6" r="2.2"/><circle cx="10" cy="12" r="2.2"/><circle cx="18" cy="18" r="2.2"/>',
};
function iconFor(title) {
  const key = Object.keys(ICONS).find((k) => title.startsWith(k));
  if (!key) return null;
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key]}</svg>`;
  return span;
}
function panel(title, open, ...kids) {
  const d = h('details', { class: 'panel' }, h('summary', {}, iconFor(title), h('span', {}, title)), h('div', { class: 'body' }, ...kids));
  if (open) d.open = true;
  return d;
}
const keysOf = (g) => Object.keys(P).filter((k) => P[k].group === g);

function refreshUI() {
  for (const [k, s] of Object.entries(sliders)) { s.inp.value = P[k].value; s.fmt(); }
  renderPaletteUI();
  renderFinishUI();
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
        state.camera.moveId = 'observador'; S.setRig(null); renderMoveUI();
        S.applyPalette(state.palette.roles); setFinishTexture(); refreshUI(); save();
      },
    }, 'Voltar ao padrão'));
}
function showPaste(prefill, onOk) {
  const m = $('#modal');
  const ta = h('textarea', { rows: 8, placeholder: 'Cole aqui os ajustes copiados' });
  ta.value = prefill;
  $('#modalBody').innerHTML = '';
  $('#modalBody').append(h('p', {}, prefill ? 'Copie o texto abaixo:' : 'Cole os ajustes e clique OK:'), ta);
  $('#modalOk').onclick = () => {
    if (!prefill) {
      try { if (onOk) onOk(ta.value); else applySettings(JSON.parse(ta.value)); save(); } catch (_) { ta.classList.add('err'); return; }
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
    panel('Câmera', true, moveBox, h('div', { id: 'camcheck', class: 'check' }),
      h('div', { class: 'sub' }, 'Ajustes'), ...keysOf('camera').map(slider), h('div', { class: 'sub' }, 'Lentes (mm)'), lensBtns,
      h('div', { class: 'muted' }, 'No observador flutuante a distância acompanha a lente, então o enquadramento fica parado. Arco e altura valem só para ele; nos movimentos, a duração define a velocidade.')),
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
    if (saved && saved.camera) state.camera = { moveId: saved.camera.moveId || 'observador', custom: Array.isArray(saved.camera.custom) ? saved.camera.custom : [] };
  } catch (e) { /* sem storage */ }
  S.applyPalette(state.palette.roles);
  setFinishTexture();
  buildRenderUI();
  applyMove(state.camera.moveId, { setDefaults: false });
  renderMoveUI();
  buildRack();
  buildTransport();
  $('#btn360').onclick = toggle360;
  refreshUI();
  camCheck();
  estimate();
  fitPreview();
  $('#loading').hidden = true;
  requestAnimationFrame(tick);
  (async () => {
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        sampleFn = await window.claude.use('sample');
        if (sampleFn) { $('#promptwrap') && ($('#promptwrap').hidden = false); $('#noprompt') && ($('#noprompt').hidden = true); }
      }
    } catch (e) { sampleFn = null; }
  })();
  window.__motion = { renderAt, setRenderSize, P, state, S, R, renderMP4, getSettings, applySettings, config, applyMove, camCheck, buildRig, camQA, MOVES, toggle360, render360, sanitizeMove };
})();
