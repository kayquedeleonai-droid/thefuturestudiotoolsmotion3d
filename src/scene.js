// Cena "Still-life flutuante": cromo líquido levitando sobre pedestal, anel dourado girando,
// esfera de cerâmica pulando (squash & stretch), cápsula de bala rolando, cubo de veludo
// balançando, esfera de vidro fosco e três esferas de acento em órbita.
// Tudo é função pura de t (loop perfeito: ciclos inteiros por clipe).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './finish.js';

const TAU = Math.PI * 2;

export const config = { width: 1920, height: 1080, fps: 60, baseDuration: 4 };

// grupos: motion, camera, light, vignette, look
export const params = {
  energia: { label: 'Energia dos objetos', min: 0, max: 2, step: 0.01, value: 1, group: 'motion' },
  liquido: { label: 'Líquido do cromo', min: 0, max: 2, step: 0.01, value: 1, group: 'motion' },
  pulo: { label: 'Altura do pulo', min: 0, max: 2, step: 0.01, value: 1, group: 'motion' },
  pulos: { label: 'Pulos por loop', min: 1, max: 6, step: 1, value: 2, group: 'motion', unit: '×' },
  anel: { label: 'Voltas do anel', min: 0, max: 4, step: 1, value: 1, group: 'motion', unit: '×' },
  orbita: { label: 'Voltas das esferas', min: 0, max: 4, step: 1, value: 1, group: 'motion', unit: '×' },

  duracao: { label: 'Duração do loop', min: 2, max: 16, step: 0.5, value: 4, group: 'camera', unit: 's' },
  arco: { label: 'Arco lateral', min: 0, max: 40, step: 0.5, value: 14, group: 'camera', unit: '°' },
  flutuar: { label: 'Flutuação (vivo)', min: 0, max: 2, step: 0.01, value: 1, group: 'camera' },
  roll: { label: 'Respiração (roll)', min: 0, max: 2, step: 0.05, value: 0.5, group: 'camera', unit: '°' },
  altura: { label: 'Altura da câmera', min: 0, max: 45, step: 0.5, value: 13, group: 'camera', unit: '°' },
  lente: { label: 'Lente', min: 14, max: 135, step: 1, value: 50, group: 'camera', unit: 'mm' },
  enquadre: { label: 'Enquadramento', min: 0.7, max: 1.5, step: 0.01, value: 1, group: 'camera' },
  dof: { label: 'Profundidade de campo', min: 0, max: 1, step: 0.01, value: 0.2, group: 'camera' },

  intensidade: { label: 'Intensidade', min: 0, max: 4, step: 0.01, value: 2.2, group: 'light' },
  temperatura: { label: 'Temperatura', min: 2000, max: 11000, step: 50, value: 5600, group: 'light', unit: 'K' },
  direcao: { label: 'Direção', min: -180, max: 180, step: 1, value: 38, group: 'light', unit: '°' },
  elev: { label: 'Altura da luz', min: 8, max: 88, step: 1, value: 52, group: 'light', unit: '°' },
  distancia: { label: 'Distância (perto = suave)', min: 0.4, max: 3, step: 0.01, value: 1, group: 'light' },
  sombra: { label: 'Força da sombra', min: 0, max: 1, step: 0.01, value: 0.42, group: 'light' },
  suavidade: { label: 'Suavidade da sombra', min: 0, max: 1, step: 0.01, value: 0.55, group: 'light' },
  contato: { label: 'Sombras de contato', min: 0, max: 1, step: 0.01, value: 0.55, group: 'light' },
  fill: { label: 'Preenchimento', min: 0, max: 3, step: 0.01, value: 0.9, group: 'light' },
  rim: { label: 'Recortes (rim)', min: 0, max: 4, step: 0.01, value: 1.2, group: 'light' },
  env: { label: 'Reflexos do ambiente', min: 0, max: 2.5, step: 0.01, value: 1, group: 'light' },
  exposicao: { label: 'Exposição', min: 0.3, max: 2.5, step: 0.01, value: 1, group: 'light' },

  vigAmt: { label: 'Quantidade', min: 0, max: 1, step: 0.01, value: 0.32, group: 'vignette' },
  vigSize: { label: 'Centro limpo', min: 0, max: 1, step: 0.01, value: 0.42, group: 'vignette' },
  vigFeather: { label: 'Suavidade', min: 0.05, max: 1.5, step: 0.01, value: 0.7, group: 'vignette' },
  vigShape: { label: 'Forma (quadro → círculo)', min: 0, max: 1, step: 0.01, value: 0.55, group: 'vignette' },
  vigX: { label: 'Centro X', min: 0.2, max: 0.8, step: 0.01, value: 0.5, group: 'vignette' },
  vigY: { label: 'Centro Y', min: 0.2, max: 0.8, step: 0.01, value: 0.5, group: 'vignette' },
  vigTint: { label: 'Cor da borda (preto → âncora)', min: 0, max: 1, step: 0.01, value: 0.6, group: 'vignette' },

  bloom: { label: 'Bloom', min: 0, max: 0.6, step: 0.005, value: 0.08, group: 'look' },
  saturacao: { label: 'Saturação', min: 0, max: 2, step: 0.01, value: 1.04, group: 'look' },
  lift: { label: 'Lift (sombras)', min: -0.1, max: 0.15, step: 0.002, value: 0.0, group: 'look' },
  gain: { label: 'Gain (altas)', min: 0.6, max: 1.4, step: 0.01, value: 1, group: 'look' },
  ca: { label: 'Aberração cromática', min: 0, max: 0.003, step: 0.0001, value: 0.0006, group: 'look' },
  distorcao: { label: 'Distorção de lente', min: 0, max: 0.3, step: 0.005, value: 0.02, group: 'look' },
};

export const lightPresets = {
  'Estúdio': { intensidade: 2.2, temperatura: 5600, direcao: 38, elev: 52, distancia: 1, sombra: 0.42, suavidade: 0.55, fill: 0.9, rim: 1.2, env: 1, exposicao: 1 },
  'Manhã': { intensidade: 2.0, temperatura: 4300, direcao: 70, elev: 24, distancia: 1.6, sombra: 0.5, suavidade: 0.35, fill: 0.8, rim: 1.6, env: 0.9, exposicao: 1.05 },
  'Meio-dia': { intensidade: 3.0, temperatura: 6000, direcao: 15, elev: 80, distancia: 2.6, sombra: 0.6, suavidade: 0.15, fill: 1.0, rim: 0.6, env: 1.1, exposicao: 0.95 },
  'Pôr do sol': { intensidade: 2.6, temperatura: 2900, direcao: -75, elev: 14, distancia: 1.8, sombra: 0.55, suavidade: 0.3, fill: 0.55, rim: 2.4, env: 0.8, exposicao: 1.05 },
  'Nublado': { intensidade: 1.1, temperatura: 7000, direcao: 20, elev: 70, distancia: 0.45, sombra: 0.28, suavidade: 1, fill: 1.8, rim: 0.5, env: 1.3, exposicao: 1.1 },
  'Dramática': { intensidade: 3.4, temperatura: 5000, direcao: -120, elev: 35, distancia: 2.2, sombra: 0.75, suavidade: 0.12, fill: 0.25, rim: 3.2, env: 0.6, exposicao: 0.9 },
};

// ---------------------------------------------------------------- utilidades
export function kelvinToRGB(k) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.max(0, Math.min(255, v)) / 255;
  return new THREE.Color(c(r), c(g), c(b));
}
const cycles = (k0, P) => Math.max(1, Math.round(k0 * P.duracao.value / config.baseDuration));

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- cena
export function createScene(renderer) {
  const P = params;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 400);
  camera.filmGauge = 36;

  // --- chão infinito (só sombra) + fundo plano
  const floorMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.4 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // --- luzes
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const sc = key.shadow.camera;
  sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7; sc.near = 0.5; sc.far = 60;
  scene.add(key, key.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.8);
  scene.add(hemi);
  const rimA = new THREE.DirectionalLight(0xffffff, 1);
  const rimB = new THREE.DirectionalLight(0xffffff, 1);
  rimA.position.set(-6, 5, -7);
  rimB.position.set(7, 3, -6);
  scene.add(rimA, rimB);

  // --- materiais
  const M = {
    anchor: new THREE.MeshPhysicalMaterial({ roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
    chrome: new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.06, iridescence: 0.25, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520] }),
    gold: new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.22 }),
    ceramic: new THREE.MeshPhysicalMaterial({ roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.12 }),
    candy: new THREE.MeshPhysicalMaterial({ roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }),
    velvet: new THREE.MeshPhysicalMaterial({ roughness: 0.9, sheen: 1, sheenRoughness: 0.45 }),
    glass: new THREE.MeshPhysicalMaterial({ roughness: 0.32, transmission: 1, thickness: 1.1, ior: 1.42, attenuationDistance: 1.6 }),
    accent: new THREE.MeshPhysicalMaterial({ roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }),
  };

  const shadowTex = radialTexture();
  const contacts = [];
  function contact(size) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.5 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.003;
    m.renderOrder = 1;
    scene.add(m);
    contacts.push(m);
    return m;
  }
  const add = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); return mesh; };

  // pedestal (perfil torneado com borda arredondada)
  const prof = [];
  const R = 1.05, H = 0.5, rr = 0.08;
  prof.push(new THREE.Vector2(0, 0));
  prof.push(new THREE.Vector2(R - rr, 0));
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2); prof.push(new THREE.Vector2(R - rr + Math.cos(a) * rr, rr + Math.sin(a) * rr)); }
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); prof.push(new THREE.Vector2(R - rr + Math.cos(a) * rr, H - rr + Math.sin(a) * rr)); }
  prof.push(new THREE.Vector2(0, H));
  const pedestal = add(new THREE.Mesh(new THREE.LatheGeometry(prof, 128), M.anchor));
  const pedC = contact(3.4);
  pedC.position.set(0, 0.003, 0);

  // cromo líquido (deformado na CPU, normais recalculadas → sombra correta)
  let blobGeo = new THREE.IcosahedronGeometry(0.7, 40);
  blobGeo.deleteAttribute('normal'); blobGeo.deleteAttribute('uv');
  blobGeo = mergeVertices(blobGeo);
  blobGeo.computeVertexNormals();
  const basePos = blobGeo.attributes.position.array.slice();
  const blob = add(new THREE.Mesh(blobGeo, M.chrome));
  const r0 = rng(77);
  const waves = [];
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Vector3(r0() * 2 - 1, r0() * 2 - 1, r0() * 2 - 1).normalize();
    waves.push({ d, f: 2.2 + r0() * 3.2, m: 1 + Math.floor(r0() * 2), ph: r0() * TAU, a: 0.5 + r0() * 0.5 });
  }

  // anel dourado
  const ring = add(new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.055, 48, 320), M.gold));

  // esfera de cerâmica que pula
  const hopR = 0.45;
  const hop = add(new THREE.Mesh(new THREE.SphereGeometry(hopR, 96, 64), M.ceramic));
  const hopC = contact(1.9);
  const HOP = new THREE.Vector3(2.6, 0, 0.8);

  // cápsula de bala que rola
  const capR = 0.26;
  const capGeo = new THREE.CapsuleGeometry(capR, 0.7, 24, 64);
  capGeo.rotateX(Math.PI / 2);
  const capsule = add(new THREE.Mesh(capGeo, M.accent));
  const capC = contact(1.8);
  const CAP = new THREE.Vector3(-2.45, capR, 1.05);

  // cubo de veludo que balança sobre a aresta
  const cubeS = 0.8;
  const cube = add(new THREE.Mesh(new RoundedBoxGeometry(cubeS, cubeS, cubeS, 6, 0.09), M.velvet));
  const cubeC = contact(2.1);
  const CUBE = new THREE.Vector3(-1.65, 0, -1.75);

  // esfera de vidro fosco flutuando
  const glassR = 0.55;
  const glass = add(new THREE.Mesh(new THREE.SphereGeometry(glassR, 96, 64), M.glass));
  glass.castShadow = false;
  const glassC = contact(2.0);
  const GLASS = new THREE.Vector3(0.95, 0, -2.35);

  // esferas de acento em órbita
  const orbs = [];
  for (let i = 0; i < 3; i++) orbs.push(add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 48, 32), M.accent)));

  // --- ambiente para reflexos, feito da paleta
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  function buildEnvironment(roles) {
    const es = new THREE.Scene();
    const top = new THREE.Color(roles.light).multiplyScalar(1.25);
    const bottom = new THREE.Color(roles.anchor).multiplyScalar(0.25);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(50, 64, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { top: { value: top }, bottom: { value: bottom } },
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y; gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.25, 0.6, h)), 1.); }',
      }),
    );
    es.add(dome);
    const box = (w, h, pos, col, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.copy(pos); m.lookAt(0, 0, 0); es.add(m);
    };
    // softboxes
    box(26, 12, new THREE.Vector3(-18, 22, 18), '#ffffff', 5);
    box(14, 26, new THREE.Vector3(30, 10, 8), '#ffffff', 3);
    box(30, 6, new THREE.Vector3(0, 40, -10), '#ffffff', 2.5);
    // tiras da paleta
    const strips = [roles.cool, roles.warm, roles.accent, roles.light];
    strips.forEach((c, i) => {
      const a = -1.2 + i * 0.8;
      box(4, 30, new THREE.Vector3(Math.sin(a) * 40, 6, Math.cos(a) * -40), c, 1.4);
    });
    // parede escura (o cromo precisa de escuro para parecer metal)
    box(70, 40, new THREE.Vector3(-5, 5, -44), roles.anchor, 0.18);
    box(60, 30, new THREE.Vector3(44, -2, -10), '#000000', 0);
    const rt = pmrem.fromScene(es, 0.02);
    if (envRT) envRT.dispose();
    envRT = rt;
    scene.environment = rt.texture;
    es.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  let roles = null;
  function applyPalette(r) {
    roles = r;
    const C = (h) => new THREE.Color(h);
    scene.background = C(r.light);
    M.anchor.color = C(r.anchor);
    M.ceramic.color = C(r.warm);
    M.velvet.color = C(r.cool);
    M.velvet.sheenColor = C(r.cool).lerp(new THREE.Color(1, 1, 1), 0.55);
    M.accent.color = C(r.accent);
    M.glass.color = C(r.cool).lerp(new THREE.Color(1, 1, 1), 0.7);
    M.glass.attenuationColor = C(r.cool).lerp(new THREE.Color(1, 1, 1), 0.3);
    M.chrome.color = new THREE.Color(0.96, 0.96, 0.98).lerp(C(r.light), 0.08);
    M.gold.color = new THREE.Color('#e3b25a').lerp(C(r.warm), 0.25);
    // sombra = tom quente escurecido, nunca cinza
    const sh = C(r.anchor).lerp(C(r.warm), 0.35).multiplyScalar(0.45);
    floorMat.color = sh;
    contacts.forEach((c) => c.material.color.copy(sh));
    hemi.color = C(r.light);
    hemi.groundColor = C(r.anchor).lerp(C(r.warm), 0.3);
    rimA.color = C(r.cool).lerp(new THREE.Color(1, 1, 1), 0.4);
    rimB.color = C(r.warm).lerp(new THREE.Color(1, 1, 1), 0.4);
    buildEnvironment(r);
  }

  // ---------------------------------------------------------------- câmera
  const TARGET = new THREE.Vector3(0.05, 1.2, 0);
  function cameraAt(t, out = {}) {
    const T = P.duracao.value, u = t / T;
    const az = THREE.MathUtils.degToRad(P.arco.value / 2) * Math.sin(TAU * u);
    const el = THREE.MathUtils.degToRad(P.altura.value);
    const dist = 8.6 * (P.lente.value / 35) * P.enquadre.value;
    const fl = P.flutuar.value * (dist / 8.6) * 0.06;
    const pos = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(dist).add(TARGET);
    pos.x += fl * Math.sin(TAU * 2 * u + 1.3);
    pos.y += fl * 0.8 * Math.sin(TAU * 3 * u + 0.4);
    pos.z += fl * 0.6 * Math.sin(TAU * 1 * u + 2.1);
    const look = TARGET.clone();
    look.x += fl * 0.25 * Math.sin(TAU * 2 * u + 2.7);
    look.y += fl * 0.25 * Math.sin(TAU * 1 * u + 0.9);
    const roll = THREE.MathUtils.degToRad(P.roll.value) * Math.sin(TAU * 2 * u + 0.7);
    out.pos = pos; out.look = look; out.roll = roll; out.dist = dist;
    return out;
  }

  // ---------------------------------------------------------------- render(t)
  const tmp = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.15, 0.3, 0));
  function update(t, aspect) {
    const T = P.duracao.value, u = t / T, E = P.energia.value;

    // luzes
    const kc = kelvinToRGB(P.temperatura.value);
    key.color.copy(kc);
    key.intensity = P.intensidade.value;
    const az = THREE.MathUtils.degToRad(P.direcao.value), el = THREE.MathUtils.degToRad(P.elev.value);
    const kd = 14 * P.distancia.value;
    key.position.set(Math.cos(el) * Math.sin(az) * kd, Math.sin(el) * kd, Math.cos(el) * Math.cos(az) * kd);
    key.target.position.set(0, 0.8, 0);
    sc.far = kd + 25;
    sc.updateProjectionMatrix();
    key.shadow.radius = 1 + P.suavidade.value * 14 / P.distancia.value;
    floorMat.opacity = P.sombra.value;
    hemi.intensity = P.fill.value;
    rimA.intensity = P.rim.value * 0.9;
    rimB.intensity = P.rim.value * 0.7;
    scene.environmentIntensity = P.env.value;

    // cromo
    const by = 2.2 + 0.08 * E * Math.sin(TAU * u);
    blob.position.set(0, by, 0);
    const pos = blob.geometry.attributes.position.array;
    const L = 0.085 * Math.min(P.liquido.value, 2);
    const wph = waves.map((w) => TAU * cycles(w.m, P) * u + w.ph);
    for (let i = 0; i < pos.length; i += 3) {
      const x = basePos[i], y = basePos[i + 1], z = basePos[i + 2];
      let d = 0;
      for (let j = 0; j < waves.length; j++) {
        const w = waves[j];
        d += w.a * Math.sin((w.d.x * x + w.d.y * y + w.d.z * z) * w.f + wph[j]);
      }
      const s = 1 + (L * d) / (0.7 * 2.2);
      pos[i] = x * s; pos[i + 1] = y * s; pos[i + 2] = z * s;
    }
    blob.geometry.attributes.position.needsUpdate = true;
    blob.geometry.computeVertexNormals();
    blob.geometry.computeBoundingSphere();

    // anel: gira em torno do próprio eixo inclinado + precessão lenta
    ring.position.copy(blob.position);
    const ra = TAU * P.anel.value * u;
    q.setFromAxisAngle(tmp.set(0, 1, 0), ra);
    ring.quaternion.copy(q).multiply(qTilt);
    ring.rotateZ(ra * 1.0);

    // esferas de acento em órbita
    orbs.forEach((o, i) => {
      const a = TAU * (P.orbita.value * u + i / 3);
      o.position.set(Math.cos(a) * 1.75, by + 0.22 * Math.sin(2 * a + i), Math.sin(a) * 1.75);
    });

    // pulo com squash & stretch
    const k = Math.round(P.pulos.value);
    const p = (k * u) % 1;
    const Hh = 1.15 * P.pulo.value * E;
    const h = Hh * 4 * p * (1 - p);
    const vel = Math.abs(1 - 2 * p);
    const contactSq = Math.exp(-Math.pow(p / 0.045, 2)) + Math.exp(-Math.pow((1 - p) / 0.045, 2));
    const sy = 1 + (0.16 * vel * vel * (1 - contactSq) - 0.17 * contactSq) * Math.min(1, E * P.pulo.value);
    const sxz = 1 / Math.sqrt(sy);
    hop.scale.set(sxz, sy, sxz);
    hop.position.set(HOP.x, hopR * sy + h, HOP.z);
    hopC.position.set(HOP.x, 0.003, HOP.z);
    const hn = Math.min(1, h / 1.6);
    hopC.scale.setScalar(1 - 0.45 * hn);
    hopC.material.opacity = P.contato.value * 0.85 * (1 - 0.75 * hn);

    // cápsula rolando (sem escorregar)
    const kr = cycles(1, P);
    const dx = 0.38 * E * Math.sin(TAU * kr * u);
    capsule.position.set(CAP.x + dx, CAP.y, CAP.z);
    capsule.rotation.set(0, 0, -dx / capR);
    capC.position.set(CAP.x + dx, 0.003, CAP.z);
    capC.scale.set(1, 1, 0.9);
    capC.material.opacity = P.contato.value * 0.9;

    // cubo balançando sobre as arestas
    const kc2 = cycles(1, P);
    const th = THREE.MathUtils.degToRad(9) * E * Math.sin(TAU * kc2 * u + 0.6);
    const sgn = th >= 0 ? -1 : 1;
    const ex = CUBE.x + sgn * cubeS / 2;
    const cx = CUBE.x - ex, cy = cubeS / 2;
    cube.position.set(ex + cx * Math.cos(th) - cy * Math.sin(th), cx * Math.sin(th) + cy * Math.cos(th), CUBE.z);
    cube.rotation.set(0, 0, th);
    cubeC.position.set(cube.position.x, 0.003, CUBE.z);
    cubeC.material.opacity = P.contato.value * 0.8;

    // vidro flutuando
    const gy = 0.95 + 0.1 * E * Math.sin(TAU * cycles(1, P) * u + 1.9);
    glass.position.set(GLASS.x, gy, GLASS.z);
    glassC.position.set(GLASS.x, 0.003, GLASS.z);
    glassC.material.opacity = P.contato.value * 0.45;

    pedC.material.opacity = P.contato.value * 0.9;

    // câmera
    const cam = cameraAt(t);
    camera.setFocalLength(P.lente.value);
    camera.aspect = aspect;
    camera.position.copy(cam.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(cam.look);
    camera.rotateZ(cam.roll);
    camera.near = Math.max(0.05, cam.dist * 0.05);
    camera.far = cam.dist * 6 + 60;
    camera.updateProjectionMatrix();
    return { focus: camera.position.distanceTo(blob.position) };
  }

  return { scene, camera, update, applyPalette, cameraAt, pedestal };
}
