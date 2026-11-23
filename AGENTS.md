# AGENTS.md

Sitio educativo de una sola página, en español. **No hay build, npm, tests, linter ni git**: no inventes scripts ni intentes commitear.

## Archivos
- `index.html` — fuente de verdad (~13 MB): CSS, HTML, módulo JS, textos y modelos GLB en base64.
- `index-backup-sin-autores.html` — espejo **generado**: idéntico a `index.html` menos 27 líneas de créditos de la portada.
- `mod-0.mjs` — copia extraída del único `<script type="module">`; sirve para validar sintaxis. Es generado: la fuente es `index.html`.
- `README.md` — instrucciones en español para publicar en GitHub Pages.

## Reglas de edición
- Edita siempre `index.html` y después regenera el respaldo; nunca edites el respaldo a mano.
- Conserva finales de línea LF.
- No reformatees el archivo: el `<script type="application/json" id="glb-data">` ocupa una sola línea de ~12,8 MB con los GLB. Cargar o imprimir el archivo completo cuelga herramientas (`Select-String` tarda minutos). Usa ripgrep y `read` con `offset`/`limit`; para inspección puntual, Node.
- Los `.glb` viven solo embebidos en `#glb-data`; no agregues assets sueltos. El input «Cargar mi .glb» es carga del usuario en tiempo de ejecución.
- El visor depende de CDN (sin red no funciona). Mantén los pins: Three.js `0.160.0` (importmap) y `@mediapipe/tasks-vision@1.2.3` (+esm y wasm).

## Regenerar el respaldo sin autores
Quita el CSS `.cover-credits`/`.credit*`, sus dos overrides responsive y el markup de los dos círculos de la portada. **Conserva** la columna textual «Autores» del pie en ambos archivos. Script reproducible (guárdalo como `mkbackup.cjs` y ejecuta `node mkbackup.cjs`):

```js
const fs=require('fs'),L=fs.readFileSync('index.html','utf8').split('\n'),del=new Set();
const at=(re,from=0)=>{const i=L.findIndex((l,j)=>j>=from&&re.test(l));if(i<0)throw new Error(re);return i};
for(let i=at(/^\.cover-credits\{/),e=at(/^\.credit-role\{/,i);i<=e;i++)del.add(i);
for(const re of [/^\s*\.cover-credits\{margin-left:0\}/,/^\s*\.credit\{width:98px/,/^\s*\.credit-initials\{font-size:\.92rem\}/])del.add(at(re));
for(let i=at(/<div class="cover-credits"/),e=at(/^ {8}<\/div>$/,i+1);i<=e;i++)del.add(i);
fs.writeFileSync('index-backup-sin-autores.html',L.filter((_,i)=>!del.has(i)).join('\n'));
```

Verificación: el respaldo debe tener 27 líneas menos que `index.html` y no contener `cover-credits`, `credit-initials`, `credit-name` ni `credit-role`.

## Verificación
- Sintaxis: regenera `mod-0.mjs` extrayendo el cuerpo de `<script type="module">` y ejecuta `node --check mod-0.mjs` (no apuntes `node --check` a `index.html`).
- Manual: `python -m http.server 8000` y abre `http://localhost:8000/index.html`. AR/VR y cámara exigen contexto seguro (`https` o `localhost`); con `file://` quedan deshabilitados a propósito.
- En pruebas con Chrome headless/CDP: `readPixels` devuelve ceros tras el present (sin `preserveDrawingBuffer`), evalúa el render con capturas; en `Page.captureScreenshot` el `clip` usa coordenadas de página (suma `scrollX`/`scrollY`).

## Decisiones de producto que no debes romper
- AR (`immersive-ar`, respaldo `immersive-vr`), VR y MediaPipe son herramientas independientes: ninguna condiciona a otra.
- Manos: la derecha (magenta) separa/une piezas y mueve o rota la escena; la izquierda (cian) solo selecciona con pinza índice+pulgar. Con una sola mano se conserva el modo combinado. El reparto está en `processHands()` (`sel = l; exp = r`).
- Toda selección (raycast, pinza, etiquetas proyectadas, lista lateral) pasa por `selectPart(id)` para mostrar la misma ficha abajo a la izquierda; `#status` y la ficha comparten `.viewer-notes` (estado arriba, ficha abajo, sin solaparse).
- UI y textos en español; conserva el sistema visual (pestañas jelly, CometDial, rueda de artefactos, botón Specular) salvo que se pida cambiarlo.
- Cada cambio visible para el usuario debe añadir una entrada en «Notas del parche» (`<details class="patchnotes">` en el pie), en español.
