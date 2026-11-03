// Movimentos de câmera. Cada movimento é uma especificação em JSON que o rig (camrig.js) transforma
// num caminho suave. É isso que o Claude escreve quando você descreve a câmera por prompt — no chat
// (e ele adiciona aqui) ou direto no app (campo "Dirigir por prompt").
//
// Formato:
// {
//   "name": "Mergulho com revelação",
//   "loop": false,            // true = loop perfeito (spline fechada); false = começa e termina parado
//   "duration": 8,            // segundos sugeridos (vira a duração do clipe)
//   "lens": 28,               // lente sugerida em mm
//   "dof": 1,                 // profundidade de campo padrão dos pontos (0..1, multiplica o slider)
//   "bank": 4,                // inclinação máxima nas curvas, graus (≤5)
//   "keys": [                 // pontos de câmera, em ordem
//     { "eye": {"near": "capsula", "az": -35, "el": 20, "dist": 1.7},   // olho relativo a um elemento
//       "look": "capsula",    // ponto de interesse: elemento (animado) ou [x,y,z]
//       "aim": 1,             // 1 = mira no elemento, 0 = olha para onde anda
//       "hold": 10,           // opcional: segura no elemento (2 controles, desliza N graus)
//       "gate": 0.7,          // opcional: portal (3 controles colineares, atravessa em direção ao alvo)
//       "dof": 0.8,           // opcional: desfoque neste trecho (0 = nítido)
//       "lens": 35 }          // opcional: lente neste trecho (zoom suave)
//   ]
// }
// az = azimute em graus (0 = frente, onde fica a câmera padrão; 90 = direita; 180 = fundo; -90 = esquerda)
// el = elevação em graus, dist = metros. "eye" também aceita [x,y,z] absoluto.

export const MOVES = [
  {
    id: 'observador',
    name: 'Observador flutuante (padrão)',
    observer: true,
    note: 'Enquadra a composição inteira com arco lateral suave e flutuação viva. Loop de 4 s.',
  },
  {
    id: 'mergulho',
    name: 'Mergulho com revelação',
    note: 'Entra pela frente em push-in, passa rente à cápsula e ao cubo, contorna o cromo pela esquerda e abre por trás e de cima mostrando tudo. O desfoque some na revelação.',
    loop: false,
    duration: 18,
    lens: 24,
    dof: 0.9,
    bank: 4,
    keys: [
      { eye: [1.0, 1.4, 9.5], look: 'capsula' },
      { eye: [-0.9, 1.0, 4.8], look: 'capsula' },
      { eye: [-1.4, 1.1, 2.6], look: 'cubo' },
      { eye: [-3.2, 1.3, 0.2], look: 'cubo' },
      { eye: [-3.7, 1.45, -1.1], look: [-0.8, 1.3, -1.0] },
      { eye: [-3.6, 1.7, -2.4], look: 'cromo', dof: 0.7 },
      { eye: [-4.4, 3.0, -5.2], look: 'centro', dof: 0.25 },
      { eye: [-4.9, 4.2, -8.0], look: 'centro', dof: 0, hold: 1 },
    ],
  },
  {
    id: 'tour',
    name: 'Tour pelos elementos',
    note: 'Uma volta ao redor do set visitando cada elemento, com o foco puxando para quem está em cena. Loop.',
    loop: true,
    duration: 26,
    lens: 28,
    dof: 0.8,
    bank: 3,
    keys: [
      { eye: { near: 'cromo', az: 0, el: 14, dist: 4.8 }, look: 'cromo', hold: 10 },
      { eye: { near: 'esfera', az: 60, el: 20, dist: 2.7 }, look: 'esfera', hold: 10 },
      { eye: { near: 'vidro', az: 150, el: 20, dist: 2.7 }, look: 'vidro', hold: 10 },
      { eye: { near: 'cubo', az: -140, el: 22, dist: 2.7 }, look: 'cubo', hold: 10 },
      { eye: { near: 'capsula', az: -60, el: 20, dist: 2.5 }, look: 'capsula', hold: 10 },
    ],
  },
];

// regras da skill que o Claude segue ao escrever um movimento
export function promptFor(userText, subjects, current) {
  const subj = Object.entries(subjects).map(([k, s]) =>
    `- "${k}": ${s.label}; posição em repouso [${s.rest.toArray().map((v) => v.toFixed(2)).join(', ')}], raio ${s.radius}`).join('\n');
  return `Você é diretor de câmera de motion 3D (padrão Cinema 4D / Octane). Escreva UM movimento de câmera para a cena abaixo, como JSON.

PEDIDO DO USUÁRIO:
"""${userText}"""

CENA (metros, y para cima; a câmera padrão fica em +z olhando para o centro):
${subj}
Obstáculos: chão (y=0), pedestal (cilindro raio 1,05, altura 0,5, no centro), casco do cromo + anel (esfera de raio 1,31 em [0,2.2,0]), três esferas de acento orbitando o cromo a 1,75 m dele, e os elementos acima. A esfera pula até ~1,6 m de altura.
Clipe atual: ${current.duration} s, lente ${current.lens} mm.

FORMATO (responda só o JSON, sem texto):
{"name": string curto em português, "loop": bool, "duration": número (s), "lens": mm 18–85, "dof": 0–1, "bank": 0–5,
 "keys": [{"eye": {"near": elemento, "az": graus, "el": graus, "dist": metros} ou [x,y,z],
           "look": elemento ou [x,y,z], "aim": 0–1 (opcional), "hold": graus (opcional), "gate": metros (opcional),
           "dof": 0–1 (opcional), "lens": mm (opcional)}]}
az: 0 = frente (+z), 90 = direita (+x), 180 = fundo, -90 = esquerda.

REGRAS (obrigatórias):
1. O caminho é uma B-spline suave que passa PERTO dos pontos (não exatamente por eles). Use 4–10 pontos.
2. Folga mínima de 0,3 m de qualquer objeto em qualquer momento; mantenha "dist" ≥ raio + 1,2 m ao passar rente. Nunca coloque a câmera abaixo de y=0,4. Contorne o centro por fora (o cromo, o anel e as órbitas ocupam ~1,9 m ao redor de [0,2.2,0]).
3. Quando a peça viaja pelo espaço, a câmera MERGULHA para frente (push-in) perto do elemento, passa AO LADO dele e segue; nunca um dolly lateral. Se o pedido falar em revelar/abrir/mostrar tudo, termine abrindo (subindo e recuando) para um plano geral olhando "centro", com "dof": 0 no(s) último(s) ponto(s) e "hold": 1 no último.
4. Um ponto de interesse por ponto de câmera; nunca mire num ponto pelo qual a câmera passa perto. Sempre algum elemento em quadro.
5. Loop nunca tem "volta em grampo": um loop é um deslizar lateral ou uma volta ao redor do set. Use "loop": true só se o pedido for um loop/volta.
6. Uma virada final de mais de ~60° precisa de dois pontos intermediários.
7. Velocidade: giro de vista ≤35°/s na maior parte do tempo. Um tour completo precisa de 20–30 s; um mergulho por 3 elementos com revelação, 16–20 s (lente 24 mm). Escolha "duration" compatível com o pedido e com essas regras.
8. Desfoque (dof ~0,6–0,9) enquanto perto dos elementos; nítido (0) na revelação final: "a lente corrige".`;
}

// limpa e valida a resposta (o Claude pode errar nomes ou tipos)
export function sanitizeMove(m, subjects) {
  if (!m || typeof m !== 'object' || !Array.isArray(m.keys)) throw new Error('Resposta sem "keys".');
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
  const names = Object.keys(subjects);
  const okLook = (l) => (typeof l === 'string' && names.includes(l)) || (Array.isArray(l) && l.length === 3 && l.every((x) => Number.isFinite(+x)));
  const keys = m.keys.slice(0, 16).map((k) => {
    let eye = k.eye;
    if (Array.isArray(eye)) eye = eye.slice(0, 3).map((x) => num(x, -30, 30, 0));
    else if (eye && typeof eye === 'object') {
      eye = {
        near: Array.isArray(eye.near) ? eye.near.slice(0, 3).map((x) => num(x, -30, 30, 0)) : (names.includes(eye.near) ? eye.near : 'centro'),
        az: num(eye.az, -720, 720, 0), el: num(eye.el, -10, 89, 15), dist: num(eye.dist, 0.4, 40, 3), dy: num(eye.dy, -5, 5, 0),
      };
    } else throw new Error('Ponto de câmera sem "eye".');
    const out = { eye, look: okLook(k.look) ? k.look : 'centro' };
    if (k.aim != null) out.aim = num(k.aim, 0, 1, 1);
    if (k.hold) out.hold = num(k.hold, 0, 40, 0);
    if (k.gate) out.gate = num(k.gate, 0.2, 3, 0.7);
    if (k.dof != null) out.dof = num(k.dof, 0, 1, 1);
    if (k.lens) out.lens = num(k.lens, 14, 135, 35);
    return out;
  });
  if (keys.length < 2) throw new Error('Poucos pontos de câmera.');
  return {
    id: 'custom-' + Date.now().toString(36),
    name: String(m.name || 'Movimento por prompt').slice(0, 60),
    loop: !!m.loop,
    duration: num(m.duration, 2, 40, 8),
    lens: num(m.lens, 14, 135, 35),
    dof: num(m.dof, 0, 1, 0.8),
    bank: num(m.bank, 0, 5, 3),
    keys,
    custom: true,
  };
}
