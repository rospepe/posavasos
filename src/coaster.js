// Generador de geometría de posavasos.
// Todo en milímetros; el eje Z es la altura (la cara superior mira a +Z).
//
// Las operaciones booleanas y los desplazamientos 2D se hacen con manifold-3d,
// que garantiza mallas cerradas (manifold) aptas para imprimir en 3D.

import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

export const SHAPES = ['circle', 'square', 'hexagon', 'octagon', 'heart'];
export const PATTERNS = ['none', 'rings', 'dots', 'stripes', 'waves'];

export const DEFAULTS = {
  shape: 'circle',
  size: 100, // diámetro / ancho exterior
  cornerRadius: 12, // solo para 'square'
  thickness: 4, // grosor de la base
  quality: 'normal',
  border: { enabled: true, width: 4, height: 1.5 },
  text: {
    enabled: true,
    content: '¡Salud!',
    font: 'pacifico',
    size: 16, // cuerpo de la tipografía en mm
    depth: 1,
    mode: 'emboss', // 'emboss' (relieve) | 'engrave' (grabado)
    offsetX: 0,
    offsetY: 0,
    lineSpacing: 1.1,
    letterSpacing: 0, // mm extra entre letras
  },
  // `contours`: grupos de contornos en unidades del SVG (ver parseSvg).
  logo: { enabled: false, contours: null, size: 30, offsetX: 0, offsetY: 26, depth: 1, mode: 'emboss' },
  // `clearance`: el patrón se aparta esta distancia del texto y del logotipo.
  pattern: { type: 'none', mode: 'engrave', depth: 0.6, spacing: 6, width: 1.2, margin: 2, clearance: 2 },
  recess: { enabled: false, inset: 6, depth: 1 },
};

const QUALITY = {
  draft: { curve: 4, round: 64 },
  normal: { curve: 10, round: 128 },
  high: { curve: 20, round: 256 },
};

// Solapamiento mínimo entre piezas que se suman, para no depender de caras
// exactamente coplanares.
const EPS = 0.01;

/** Mezcla profunda (un nivel) de parámetros parciales sobre DEFAULTS. */
export function withDefaults(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    const p = params[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...v, ...(p || {}) } : p ?? v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contornos 2D (listas de [x, y])

const circle = (r, n, cx = 0, cy = 0) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

/** Contorno exterior del posavasos, centrado en el origen. */
export function outlinePoints(p, q = QUALITY[p.quality] || QUALITY.normal) {
  const half = p.size / 2;
  switch (p.shape) {
    case 'square': {
      const r = Math.min(Math.max(p.cornerRadius, 0), half);
      if (r < 1e-3) return [[half, half], [-half, half], [-half, -half], [half, -half]];
      const seg = Math.max(2, Math.round(q.round / 4));
      const pts = [];
      const corners = [
        [half - r, half - r],
        [-half + r, half - r],
        [-half + r, -half + r],
        [half - r, -half + r],
      ];
      corners.forEach(([cx, cy], c) => {
        for (let i = 0; i <= seg; i++) {
          const a = ((c + i / seg) * Math.PI) / 2;
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
      });
      return pts;
    }
    case 'hexagon':
    case 'octagon': {
      // `size` se mide entre lados opuestos (cabe en un cuadrado de size × size).
      const n = p.shape === 'hexagon' ? 6 : 8;
      const R = half / Math.cos(Math.PI / n);
      return Array.from({ length: n }, (_, i) => {
        const a = Math.PI / 2 + Math.PI / n + (i / n) * Math.PI * 2;
        return [R * Math.cos(a), R * Math.sin(a)];
      });
    }
    case 'heart': {
      const raw = Array.from({ length: q.round }, (_, i) => {
        const t = (i / q.round) * Math.PI * 2;
        return [
          16 * Math.sin(t) ** 3,
          13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
        ];
      });
      const b = bounds([raw]);
      const s = p.size / Math.max(b.w, b.h);
      return raw.map(([x, y]) => [(x - b.cx) * s, (y - b.cy) * s]);
    }
    default:
      return circle(half, q.round);
  }
}

// ---------------------------------------------------------------------------
// Texto y logotipo → contornos

/**
 * Convierte texto (multilínea) en contornos usando una fuente de opentype.js.
 * Conserva el sentido de giro de la fuente (se interpretan con la regla
 * NonZero) y centra el bloque en (offsetX, offsetY).
 */
export function textContours(font, t, curveSegments = 10) {
  const lines = String(t.content || '').split('\n');
  const lineHeight = t.size * t.lineSpacing;
  const scale = t.size / font.unitsPerEm;
  const contours = [];
  lines.forEach((line, i) => {
    // Maquetación propia (carácter a carácter + kerning) para no depender del
    // motor de shaping de opentype.js, que no soporta todas las tablas OpenType.
    const glyphs = Array.from(line).map((ch) => font.charToGlyph(ch));
    const xs = [];
    let x = 0;
    glyphs.forEach((g, k) => {
      xs.push(x);
      x += (g.advanceWidth || 0) * scale;
      if (k < glyphs.length - 1) x += font.getKerningValue(g, glyphs[k + 1]) * scale + t.letterSpacing;
    });
    const baseline = -i * lineHeight;
    glyphs.forEach((g, k) => {
      const path = g.getPath(xs[k] - x / 2, 0, t.size);
      // opentype usa Y hacia abajo: se invierte y se baja a su línea.
      const Y = (y) => -y + baseline;
      let cur = null;
      const flush = () => {
        if (cur) {
          const pts = cur.getPoints(curveSegments).map((v) => [v.x, v.y]);
          if (pts.length > 2) contours.push(pts);
        }
        cur = null;
      };
      for (const c of path.commands) {
        if (c.type === 'M') {
          flush();
          cur = new THREE.Path();
          cur.moveTo(c.x, Y(c.y));
        } else if (c.type === 'L') cur.lineTo(c.x, Y(c.y));
        else if (c.type === 'Q') cur.quadraticCurveTo(c.x1, Y(c.y1), c.x, Y(c.y));
        else if (c.type === 'C') cur.bezierCurveTo(c.x1, Y(c.y1), c.x2, Y(c.y2), c.x, Y(c.y));
        else if (c.type === 'Z') flush();
      }
      flush();
    });
  });
  if (!contours.length) return [];
  const tf = transformFor(bounds(contours), t.offsetX, t.offsetY, 1, false);
  return contours.map((c) => c.map(tf));
}

/**
 * Convierte un SVG en grupos de contornos (uno por forma rellena: contorno
 * exterior seguido de sus agujeros), en las unidades originales del SVG.
 * Necesita DOMParser, así que se llama desde el hilo principal.
 */
export function parseSvg(svgText, curveSegments = 20) {
  const data = new SVGLoader().parse(svgText);
  const groups = [];
  for (const path of data.paths) {
    const fill = path.userData?.style?.fill;
    if (fill === 'none' || fill === 'transparent') continue;
    for (const shape of path.toShapes()) {
      const { shape: outer, holes } = shape.extractPoints(curveSegments);
      groups.push([outer, ...holes].map((c) => c.map((v) => [v.x, v.y])));
    }
  }
  return groups;
}

/** Escala los grupos del SVG para que su lado mayor mida `size` mm y los centra. */
function fitSvg(groups, l) {
  const all = groups.flat();
  if (!all.length) return [];
  const b = bounds(all);
  const scale = l.size / Math.max(b.w, b.h, 1e-6);
  // SVG usa Y hacia abajo: se invierte.
  const tf = transformFor(b, l.offsetX, l.offsetY, scale, true);
  return groups.map((g) => g.map((c) => c.map(tf)));
}

function bounds(contours) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of contours) {
    for (const [x, y] of c) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

function transformFor(b, cx, cy, scale, flipY) {
  const sy = flipY ? -scale : scale;
  return ([x, y]) => [(x - b.cx) * scale + cx, (y - b.cy) * sy + cy];
}

// ---------------------------------------------------------------------------
// Patrones decorativos (se recortan luego al área interior)

function patternContours(pat, radius, q) {
  const out = [];
  const w = pat.width;
  const step = Math.max(pat.spacing, w + 0.4);
  switch (pat.type) {
    case 'rings':
      for (let r = step; r - w / 2 < radius * 1.5; r += step) {
        out.push(circle(r + w / 2, q.round), circle(r - w / 2, q.round).reverse());
      }
      break;
    case 'dots': {
      const seg = Math.max(12, q.round / 8);
      const dy = (step * Math.sqrt(3)) / 2;
      const nj = Math.ceil((radius * 1.5) / dy);
      const ni = Math.ceil((radius * 1.5) / step) + 1;
      for (let j = -nj; j <= nj; j++) {
        for (let i = -ni; i <= ni; i++) {
          const x = i * step + (j & 1) * (step / 2);
          const y = j * dy;
          if (Math.hypot(x, y) < radius * 1.5) out.push(circle(w / 2, seg, x, y));
        }
      }
      break;
    }
    case 'stripes':
    case 'waves': {
      const L = radius * 1.6;
      const n = Math.ceil(L / step);
      const samples = pat.type === 'waves' ? Math.max(24, q.round / 2) : 1;
      const amp = pat.type === 'waves' ? step * 0.3 : 0;
      const rot = ([x, y]) => [(x - y) * Math.SQRT1_2, (x + y) * Math.SQRT1_2]; // 45°
      for (let i = -n; i <= n; i++) {
        const top = [];
        const bottom = [];
        for (let k = 0; k <= samples; k++) {
          const x = -L + (2 * L * k) / samples;
          const y = i * step + amp * Math.sin((x / (step * 2)) * Math.PI * 2);
          top.push(rot([x, y + w / 2]));
          bottom.push(rot([x, y - w / 2]));
        }
        out.push([...bottom, ...top.reverse()]);
      }
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Construcción del posavasos

/**
 * Construye el posavasos.
 *
 * @param {object} wasm    Módulo manifold-3d ya inicializado (tras `setup()`).
 * @param {object} params  Parámetros (ver DEFAULTS).
 * @param {object} fonts   Mapa nombre → fuente opentype.js ya cargada.
 * @returns {{ positions: Float32Array, indices: Uint32Array, warnings: string[],
 *             size: number[], volume: number }}
 */
export function buildCoaster(wasm, params, fonts = {}) {
  const { Manifold, CrossSection } = wasm;
  const p = withDefaults(params);
  const q = QUALITY[p.quality] || QUALITY.normal;
  const T = p.thickness;
  const warnings = [];

  // manifold-3d vive en memoria WASM: todo lo creado se libera al final.
  const trash = [];
  const own = (obj) => (trash.push(obj), obj);
  const inset = (cs, d) => (d > 0 ? own(cs.offset(-d, 'Round', 2, q.round)) : cs);
  const slab = (cs, z0, z1) => own(own(cs.extrude(z1 - z0)).translate([0, 0, z0]));

  try {
    const outer = own(new CrossSection([outlinePoints(p, q)], 'NonZero'));
    let body = slab(outer, 0, T);

    const borderOn = p.border.enabled && p.border.width > 0 && p.border.height > 0;
    const deco = inset(outer, (borderOn ? p.border.width : 0) + p.pattern.margin);
    if (deco.isEmpty()) warnings.push('El borde es tan ancho que no queda sitio para decorar.');

    // Altura máxima de cualquier relieve: los grabados llegan hasta aquí para atravesarlos.
    const reliefTop =
      T +
      1 +
      Math.max(
        borderOn ? p.border.height : 0,
        p.text.enabled && p.text.mode === 'emboss' ? p.text.depth : 0,
        p.logo.enabled && p.logo.mode === 'emboss' ? p.logo.depth : 0,
        p.pattern.type !== 'none' && p.pattern.mode === 'emboss' ? p.pattern.depth : 0,
      );
    const maxEngrave = Math.max(0.2, T - 0.8 - (p.recess.enabled ? p.recess.depth : 0));

    const adds = [];
    const subs = [];
    /** Añade una sección 2D como relieve o grabado, recortada a la zona decorable. */
    const decorate = (cs, mode, depth, what, warnClip = true) => {
      const clipped = own(cs.intersect(deco));
      if (clipped.isEmpty()) return;
      if (warnClip && clipped.area() < cs.area() - 1e-3) {
        warnings.push(`${what} se sale del área decorable y se ha recortado.`);
      }
      if (mode === 'engrave') {
        if (depth > maxEngrave) {
          warnings.push(`${what}: grabado limitado a ${maxEngrave.toFixed(1)} mm para no atravesar la base.`);
        }
        subs.push(slab(clipped, T - Math.min(depth, maxEngrave), reliefTop));
      } else {
        adds.push(slab(clipped, T - EPS, T + depth));
      }
    };

    if (borderOn) {
      const ring = own(outer.subtract(inset(outer, p.border.width)));
      adds.push(slab(ring, T - EPS, T + p.border.height));
    }

    let textCS = null;
    if (p.text.enabled && String(p.text.content || '').trim()) {
      const font = fonts[p.text.font] || Object.values(fonts)[0];
      if (!font) warnings.push('No hay ninguna fuente cargada: se omite el texto.');
      else {
        const contours = textContours(font, p.text, q.curve);
        if (contours.length) textCS = own(new CrossSection(contours, 'NonZero'));
      }
    }

    let logoCS = null;
    if (p.logo.enabled && p.logo.contours) {
      const groups = fitSvg(p.logo.contours, p.logo);
      if (!groups.length) warnings.push('El SVG no contiene formas rellenas.');
      else logoCS = own(CrossSection.union(groups.map((g) => own(new CrossSection(g, 'EvenOdd')))));
    }

    if (p.pattern.type !== 'none') {
      const contours = patternContours(p.pattern, p.size / 2, q);
      if (contours.length) {
        let cs = own(new CrossSection(contours, 'NonZero'));
        // Deja un margen liso alrededor del texto y el logotipo para que se lean bien.
        const figures = [textCS, logoCS].filter(Boolean);
        if (figures.length && p.pattern.clearance > 0) {
          const union = figures.length > 1 ? own(CrossSection.union(figures)) : figures[0];
          cs = own(cs.subtract(own(union.offset(p.pattern.clearance, 'Round', 2, q.round / 4))));
        }
        decorate(cs, p.pattern.mode, p.pattern.depth, 'El patrón', false);
      }
    }
    if (textCS) decorate(textCS, p.text.mode, p.text.depth, 'El texto');
    if (logoCS) decorate(logoCS, p.logo.mode, p.logo.depth, 'El logotipo');

    // Primero todos los relieves; después los grabados (que también los atraviesan).
    if (adds.length) body = own(Manifold.union([body, ...adds]));
    if (subs.length) body = own(body.subtract(own(Manifold.union(subs))));

    // Hueco inferior para pegar corcho o fieltro
    if (p.recess.enabled && p.recess.depth > 0) {
      const depth = Math.min(p.recess.depth, T - 1);
      const hole = inset(outer, p.recess.inset);
      if (depth > 0 && !hole.isEmpty()) body = own(body.subtract(slab(hole, -1, depth)));
    }

    const mesh = body.getMesh();
    const n = mesh.numProp;
    const positions = new Float32Array((mesh.vertProperties.length / n) * 3);
    for (let i = 0, j = 0; i < mesh.vertProperties.length; i += n, j += 3) {
      positions[j] = mesh.vertProperties[i];
      positions[j + 1] = mesh.vertProperties[i + 1];
      positions[j + 2] = mesh.vertProperties[i + 2];
    }
    const bb = body.boundingBox();
    return {
      positions,
      indices: new Uint32Array(mesh.triVerts),
      warnings: [...new Set(warnings)],
      size: [0, 1, 2].map((k) => bb.max[k] - bb.min[k]),
      volume: body.volume(),
    };
  } finally {
    for (const obj of trash) obj.delete();
  }
}
