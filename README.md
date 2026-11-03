# Motion 3D · The Future

Prévia interativa de motion 3D (Three.js + WebGL) com sliders e render MP4 **na GPU de quem abre a página**.
Baseado na skill *Motion 3D do Jonaum — BETA V1*.

## Abrir

Não precisa instalar nada: as bibliotecas vêm de CDN (jsDelivr).

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
- **Câmera "observador flutuante"**: arco lateral suave, flutuação viva e respiração no roll. A distância acompanha
  a lente (14–135 mm), então o enquadramento não muda. Verificação de suavidade ao vivo.
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
src/scene.js      cena, materiais, luzes, câmera, parâmetros dos sliders
src/palette.js    paletas Coolors + papéis automáticos (clara, âncora, fria, quente, acento)
src/finish.js     texturas de acabamento procedurais (neutras em cinza médio, tileáveis)
```

Para uma peça nova, duplique `src/scene.js`, mantenha o contrato (`params`, `createScene` → `update(t)`,
`applyPalette`, `cameraAt`) e troque o import em `src/app.js`.
