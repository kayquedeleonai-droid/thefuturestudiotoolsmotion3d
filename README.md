# Motion 3D · The Future

Prévia interativa de motion 3D (Three.js + WebGL) com sliders e render MP4 **na GPU de quem abre a página**.
Baseado na skill *Motion 3D do Jonaum — BETA V1*.

## Abrir

- **Online**: https://motion3d.thefuturestudiostools.app (Cloudflare Workers, publicado automaticamente a cada push na `main`).
- **No Claude**: o mesmo app como artifact, com o campo "Dirigir por prompt" ligado ao Claude.

Não precisa instalar nada: as bibliotecas vêm de CDN (jsDelivr). O servidor só entrega os arquivos;
a prévia e o render MP4 rodam na GPU de quem abre a página.

### Deploy no Cloudflare

`wrangler.jsonc` publica a pasta como um Worker só de arquivos estáticos no domínio
`motion3d.thefuturestudiostools.app` (`.assetsignore` deixa de fora README, configs e `.git`; `_headers` evita cache
velho nos scripts). Com o repositório conectado em *Workers & Pages → Create → Import a repository*, cada push na
`main` publica sozinho. Deploy manual: `npx wrangler@latest deploy`.

- **GitHub Pages**: em *Settings → Pages*, escolha a branch `main` e a pasta `/ (root)`. O app abre em
  `https://kayque-thefuture.github.io/thefuture-motiontool/`.
- **Local**: o WebCodecs (render MP4) exige contexto seguro, então abra por `localhost`:
  ```bash
  npx serve .            # ou: python3 -m http.server 8080
  ```
  e acesse `http://localhost:3000` (ou `:8080`). Abrir o `index.html` direto pelo Finder (`file://`) não funciona.

Use Chrome, Edge ou Safari 17+ atualizados.

## O que tem

- **Cena** (`src/scene.js`): still-life flutuante com cromo líquido, anel dourado, esfera de cerâmica pulando
  (squash & stretch), cápsula de bala rolando, cubo de veludo balançando, esfera de vidro fosco e esferas de acento
  em órbita. Tudo é função pura do tempo, e o loop fecha sem emenda.
- **Câmera dirigida por prompt** (`src/camrig.js`, `src/moves.js`): você descreve o movimento e o Claude escreve o
  caminho: B-spline C2 (fechada para loops), ponto de interesse por ponto de câmera, mira com mistura limitada por
  ângulo, suavização gaussiana de fase zero, banking pela aceleração lateral, perfil de velocidade de operador e
  desfoque que "corrige" na revelação. Movimentos prontos: **Observador flutuante** (loop 4 s), **Mergulho com
  revelação** (18 s, 24 mm) e **Tour pelos elementos** (loop 26 s, 28 mm). Checagem ao vivo no padrão da skill: giro
  p95 ≤35°/s e pico ≤50°/s, ≤0,35 quadro/s na tela, mudança de giro ≤0,15°/quadro, folga ≥0,3 m dos objetos
  animados, sempre algum elemento em quadro. Quando falha, diz a duração mínima. **Vista 360°** com o caminho em azul
  e a câmera em vermelho.
- **Dirigir por prompt no app**: dentro do Claude, o campo "Dirigir câmera" pede o movimento ao Claude, valida, roda
  a checagem (com uma rodada de correção se passar perto de algum objeto) e salva em "Movimentos". Fora do Claude,
  descreva o movimento no chat: ele é adicionado a `src/moves.js` e publicado.
- **Painéis**: Movimento · Câmera · Luz (presets Estúdio / Manhã / Meio-dia / Pôr do sol / Nublado / Dramática) ·
  Cores (paletas Coolors, link colado, seletor por papel) · Acabamento (papel, papelão, saco, caderno, aquarela,
  celofane, lousa, tecido, feltro; com "boil") · Vinheta · Imagem (bloom, saturação, lift/gain, aberração,
  distorção de lente) · Visualização · Render · Ajustes (copiar/colar preset).
- **Render na sua GPU**: 720p a 4K, 24/30/60 fps, supersampling até 2×, motion blur com 4–16 sub-quadros, bitrate até
  150 Mb/s, arquivo com o loop repetido N vezes. Também tem "Testar meu computador" e PNG do quadro atual.
- Os ajustes ficam salvos no navegador (localStorage).

## Estrutura

```
index.html        layout, import map, estilos
src/app.js        motor (pós: Bokeh → Bloom → Output → SMAA → Acabamento), rack de sliders, render MP4
src/scene.js      cena, materiais, luzes, poses animadas, obstáculos, câmera, parâmetros dos sliders
src/camrig.js     rig de câmera (B-spline, mira, suavização, banking) + checagem camQA
src/moves.js      movimentos prontos, prompt com as regras da skill, validação da resposta
src/palette.js    paletas Coolors + papéis automáticos (clara, âncora, fria, quente, acento)
src/finish.js     texturas de acabamento procedurais (neutras em cinza médio, tileáveis)
```

Para uma peça nova, duplique `src/scene.js`, mantenha o contrato (`params`, `createScene` → `update(t)`,
`applyPalette`, `cameraAt`) e troque o import em `src/app.js`.
