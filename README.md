# Posavasos personalizados

Aplicación web para diseñar posavasos y descargarlos en **STL** listos para imprimir en 3D.
Todo se calcula en el navegador: no hay servidor ni se sube nada.

## Qué se puede personalizar

- **Forma**: círculo, cuadrado (con esquinas redondeadas), hexágono, octógono o corazón; tamaño y grosor.
- **Borde** en relieve con ancho y altura a elegir (uniforme en cualquier forma).
- **Texto** de una o varias líneas, en **relieve o grabado**, con 5 tipografías incluidas
  (acentos, ñ, ¡, ¿…) o **tu propia fuente** (.ttf, .otf, .woff). Tamaño, posición,
  espaciado e interlineado.
- **Logotipo SVG** en relieve o grabado (se usan las formas con relleno).
- **Patrón de fondo**: anillos, puntos, rayas u ondas, en relieve o grabado, con un espacio
  libre ajustable alrededor del texto y el logo para que se lean bien.
- **Hueco inferior** para pegar corcho o fieltro antideslizante.
- Tres niveles de calidad de malla; el diseño se guarda automáticamente en el navegador.

Las mallas se generan con [manifold-3d](https://github.com/elalish/manifold), así que el STL
es siempre un sólido cerrado (*manifold*) que los laminadores aceptan sin reparaciones.
Los grabados se limitan automáticamente para no atravesar la base.

## Uso

```bash
npm install
npm run dev       # servidor de desarrollo en http://localhost:5173
npm test          # pruebas de geometría (comprueban que las mallas son cerradas)
npm run build     # versión estática en dist/ (se puede publicar en GitHub Pages, Netlify…)
```

## App para Mac (.dmg)

El DMG se genera automáticamente en GitHub Actions (workflow **«DMG para macOS»**) en cada
push: descárgalo desde la pestaña *Actions* → última ejecución → artefacto `Posavasos-dmg`.
Si creas una etiqueta `v*` (p. ej. `git tag v0.1.0 && git push --tags`), el DMG se publica
además en *Releases*. Es una app universal (Apple Silicon e Intel).

**Instalación:** abre el DMG y arrastra *Posavasos* a *Aplicaciones*.

La app no está firmada con un certificado de Apple Developer, así que la primera vez macOS
la bloqueará. Para abrirla:

1. Intenta abrirla una vez (aparecerá el aviso) y ciérralo.
2. Ve a *Ajustes del Sistema → Privacidad y seguridad* y pulsa **«Abrir igualmente»**.

O desde Terminal: `xattr -dr com.apple.quarantine /Applications/Posavasos.app`

Para generarlo en tu propio Mac: `npm install && npm run dist:mac` (queda en `release/`).
Para probar la versión de escritorio sin empaquetar: `npm run electron`.

### Consejo de impresión a dos colores

Si hay relieves (borde, texto, logo o patrón), añade en el laminador un cambio de filamento
(M600 / «pausa en altura») en la primera capa por encima del grosor de la base; la app te
indica la altura exacta.

## Estructura

| Archivo | Qué hace |
| --- | --- |
| `src/coaster.js` | Genera la geometría (contornos 2D, texto, SVG, patrones y booleanas). Sin DOM, se puede usar en Node. |
| `src/worker.js` | Web Worker que carga manifold-3d y las fuentes y construye el modelo sin bloquear la interfaz. |
| `src/main.js` | Interfaz: formulario, visor 3D (three.js) y descarga. |
| `src/stl.js` | Exportador de STL binario. |
| `src/fonts.js` | Tipografías incluidas. |
| `electron/main.cjs` | Envoltorio de escritorio (Electron) usado para la app de Mac. |
| `test/` | Pruebas con Vitest. |

## Licencias de terceros

- Tipografías (Pacifico, Lobster, Roboto, Bebas Neue, Playfair Display): SIL Open Font License,
  distribuidas mediante [Fontsource](https://fontsource.org).
- [three.js](https://threejs.org) (MIT), [opentype.js](https://opentype.js.org) (MIT),
  [manifold-3d](https://github.com/elalish/manifold) (Apache-2.0).
