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
  // Texto que recorre una espiral desde el borde hacia el centro, siguiendo la
  // forma del posavasos; con `repeat` se repite hasta llenar la espiral.
  spiral: {
    enabled: false,
    content: 'Feliz cumpleaños',
    separator: ' · ',
    repeat: true,
    font: 'roboto',
    size: 8, // tamaño de letra al empezar (borde)
    sizeEnd: 4.5, // tamaño de letra al terminar (centro)
    fit: true, // «ajuste perfecto»: el texto termina justo al final de la espiral
    adaptive: true, // letras más grandes donde las vueltas quedan más separadas
    depth: 0.8,
    mode: 'emboss',
    lineSpacing: 1.3, // separación entre vueltas, en múltiplos del tamaño de letra
    letterSpacing: 0.3, // mm (con el tamaño inicial; se escala con la letra)
    innerRadius: 6, // radio del hueco central libre (mm); el texto y el logo centrales se esquivan solos
    startAngle: 90, // grados; 90 = arriba
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

// Tamaño mínimo (mm) al que se colocan letras en la espiral; por debajo no
// se leen bien impresas con una boquilla de 0,4 mm.
const MIN_LEGIBLE = 2.5;

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
    glyphs.forEach((g, k) => {
      contours.push(...glyphContours(g, xs[k] - x / 2, -i * lineHeight, t.size, curveSegments));
    });
  });
  if (!contours.length) return [];
  const tf = transformFor(bounds(contours), t.offsetX, t.offsetY, 1, false);
  return contours.map((c) => c.map(tf));
}

/**
 * Contornos de un glifo de opentype.js con su origen en (x, baseline) y el eje
 * Y hacia arriba.
 */
function glyphContours(glyph, x, baseline, size, curveSegments) {
  const contours = [];
  const path = glyph.getPath(x, 0, size);
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
  return contours;
}

// ---------------------------------------------------------------------------
// Texto en espiral

/**
 * Remuestrea un polígono cerrado en `n` puntos equidistantes, en sentido
 * horario. Empieza en el vértice más cercano a `anchor` o, si no se da, en el
 * que mejor apunta desde el origen hacia `startAngle`.
 */
function resampleRing(poly, startAngle, n, anchor = null) {
  const pts = polygonArea(poly) > 0 ? poly.slice().reverse() : poly.slice();
  const cost = anchor
    ? ([x, y]) => Math.hypot(x - anchor[0], y - anchor[1])
    : ([x, y]) => Math.abs(Math.atan2(Math.sin(Math.atan2(y, x) - startAngle), Math.cos(Math.atan2(y, x) - startAngle)));
  let start = 0;
  let best = Infinity;
  pts.forEach((pt, i) => {
    const c = cost(pt);
    if (c < best - 1e-9) {
      best = c;
      start = i;
    }
  });
  const ring = [...pts.slice(start), ...pts.slice(0, start), pts[start]];
  const cum = [0];
  for (let i = 1; i < ring.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const out = [];
  let seg = 1;
  for (let j = 0; j < n; j++) {
    const d = (total * j) / n;
    while (seg < ring.length - 1 && cum[seg] < d) seg++;
    const f = (d - cum[seg - 1]) / (cum[seg] - cum[seg - 1] || 1);
    out.push([
      ring[seg - 1][0] + (ring[seg][0] - ring[seg - 1][0]) * f,
      ring[seg - 1][1] + (ring[seg][1] - ring[seg - 1][1]) * f,
    ]);
  }
  return out;
}

/**
 * Camino en espiral (sentido horario, de fuera hacia dentro) a partir de una
 * serie de anillos concéntricos centrados en el origen: cada vuelta pasa
 * gradualmente del anillo k al k+1 (emparejando puntos por fracción de
 * recorrido), así la espiral hereda la forma del posavasos, aunque sea cóncava.
 *
 * Si se dan `values` (uno por anillo, p. ej. el tamaño de letra), cada punto
 * lleva como tercer elemento el valor interpolado entre sus dos anillos y como
 * cuarto la separación (mm) con la vuelta siguiente en ese punto.
 *
 * @param {Array<Array<[number, number]>>} rings  Polígonos de fuera a dentro.
 * @returns {Array<[number, number, number?, number?]>}
 */
export function spiralPath(rings, startAngle = Math.PI / 2, samplesPerTurn = 256, values = null) {
  // Cada anillo empieza junto al inicio del anterior, para que las vueltas encajen.
  const sampled = [];
  for (const r of rings) {
    sampled.push(resampleRing(r, startAngle, samplesPerTurn, sampled.length ? sampled[sampled.length - 1][0] : null));
  }
  // Separación entre cada anillo y el siguiente, punto a punto.
  const gaps = sampled.slice(0, -1).map((ring, k) => ring.map(([ax, ay], j) => Math.hypot(sampled[k + 1][j][0] - ax, sampled[k + 1][j][1] - ay)));
  const gapAt = (k, j) => (k < gaps.length ? gaps[k][j] : gaps[gaps.length - 1][j]);
  const pts = [];
  for (let k = 0; k + 1 < sampled.length; k++) {
    for (let j = 0; j < samplesPerTurn; j++) {
      const f = j / samplesPerTurn;
      const [ax, ay] = sampled[k][j];
      const [bx, by] = sampled[k + 1][j];
      const pt = [ax + (bx - ax) * f, ay + (by - ay) * f];
      if (values) {
        pt.push(values[k] + (values[k + 1] - values[k]) * f);
        // Al final de la vuelta manda la separación con la vuelta de más adentro.
        pt.push(gapAt(k, j) * (1 - f) + Math.min(gapAt(k, j), gapAt(k + 1, j)) * f);
      }
      pts.push(pt);
    }
  }
  if (sampled.length > 1) {
    const last = sampled.length - 1;
    pts.push(values ? [...sampled[last][0], values[last], gaps.length ? gapAt(last - 1, 0) : 0] : sampled[last][0]);
  }
  return pts;
}

/** Recorrido por longitud de arco de un camino [x, y, tamaño?]. */
function makeTrack(path, defaultSize) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const at = (d) => {
    d = Math.min(Math.max(d, 0), total);
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const f = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
    const [ax, ay, as = defaultSize] = path[lo];
    const [bx, by, bs = defaultSize] = path[hi];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    return {
      x: ax + (bx - ax) * f,
      y: ay + (by - ay) * f,
      tx: (bx - ax) / len,
      ty: (by - ay) / len,
      size: as + (bs - as) * f,
    };
  };
  return { at, total };
}

/**
 * Maqueta (sin generar geometría) el texto a lo largo del recorrido: decide
 * qué letra va en qué posición y con qué tamaño. El tamaño local es el del
 * camino multiplicado por `gamma`. Se detiene al consumir `limit` caracteres
 * o al acabarse el camino. Solo empieza palabras que caben enteras.
 */
function layoutAlongPath(font, track, s, chars, { gamma = 1, limit = Infinity, avoid = null } = {}) {
  const { at, total } = track;
  const charAt = (k) => (s.repeat ? chars[k % chars.length] : chars[k]);
  const isWordStart = (k) => {
    const before = k > 0 ? charAt(k - 1) : ' ';
    return charAt(k).trim() && !(before && before.trim());
  };
  const sizeAt = (d) => gamma * at(d).size;
  // Por debajo de este tamaño no se colocan letras: el tramo se salta.
  const minSize = s.minSize ?? 0;
  const tooSmall = (dd) => at(dd).size < minSize; // según el sitio disponible en el camino
  const placed = [];
  let d = 0;
  let prev = null;
  let i = 0;
  // Inicio de la palabra en curso, para poder retroceder si no cabe entera.
  let word = { i: 0, d: 0, n: 0 };
  const skipAhead = (from, step) => {
    placed.length = word.n;
    i = word.i;
    d = from + Math.max(step, 0.25);
    prev = null;
  };
  while (i < limit && i < 20000) {
    const ch = charAt(i);
    if (ch === undefined) break;
    const size = sizeAt(d);
    const scale = size / font.unitsPerEm;
    const spacing = (s.letterSpacing * size) / s.size;
    const g = font.charToGlyph(ch);
    if (prev) d += font.getKerningValue(prev, g) * scale + spacing;
    const adv = (g.advanceWidth || 0) * scale;
    if (isWordStart(i)) word = { i, d, n: placed.length };
    // Al empezar una palabra se comprueba que quepa entera (sin huecos ni final
    // del camino por medio), para no dejar trozos de palabra sueltos.
    if (isWordStart(i)) {
      let w = 0;
      for (let k = i; k < i + 200 && k < limit; k++) {
        const c2 = charAt(k);
        if (c2 === undefined || !c2.trim()) break;
        w += (font.charToGlyph(c2).advanceWidth || 0) * scale + spacing;
      }
      w -= spacing;
      if (d + w > total + 1e-6) break;
      let blocked = false;
      const step = Math.max(size / 4, 0.4);
      for (let t = 0; !blocked; t = Math.min(t + step, w)) {
        const c2 = at(d + t);
        blocked = !!(avoid && avoid(c2.x, c2.y, size)) || tooSmall(d + t);
        if (t >= w) break;
      }
      if (blocked) {
        skipAhead(d, adv / 4);
        continue;
      }
    }
    if (d + adv > total + 1e-6) {
      // La palabra no llega a caber: se retira entera.
      placed.length = word.n;
      d = word.d;
      i = word.i;
      break;
    }
    const mid = at(d + adv / 2);
    const hits = (pt) => avoid(pt.x, pt.y, size);
    if (ch.trim() && ((avoid && (hits(mid) || hits(at(d)) || hits(at(d + adv)))) || tooSmall(d + adv / 2))) {
      // Choca a mitad de palabra: la palabra entera se mueve más adelante.
      skipAhead(Math.max(word.d, d - adv), adv / 4);
      continue;
    }
    placed.push({ g, d, adv, size, ch });
    d += adv;
    prev = g;
    i++;
  }
  return { placed, consumed: i, end: d };
}

/**
 * Coloca texto a lo largo de un camino [x, y, tamaño?]: cada letra se gira
 * según la tangente, con la parte de arriba hacia fuera, centrada sobre el
 * camino y con el tamaño local del camino (así puede ir de grande a pequeño).
 *
 * Con `s.fit` («ajuste perfecto») se elige el número de repeticiones completas
 * que mejor cabe y se reescalan ligeramente todas las letras para que el texto
 * termine justo al final del camino.
 *
 * @returns {{ contours: number[][][], placed: object[], total: number, end: number,
 *             gamma: number, fitted: boolean }}
 */
export function textAlongPath(font, path, s, curveSegments = 10, avoid = null) {
  const empty = { contours: [], placed: [], total: 0, end: 0, gamma: 1, fitted: false };
  if (path.length < 2) return empty;
  const unit = Array.from(String(s.content || '').replace(/\s*\n\s*/g, ' ').trim());
  if (!unit.some((ch) => ch.trim())) return empty;
  const sep = s.repeat ? Array.from(String(s.separator ?? '')) : [];
  const chars = [...unit, ...sep];
  const track = makeTrack(path, s.size);
  const layout = (opts) => layoutAlongPath(font, track, s, chars, { avoid, ...opts });

  let gamma = 1;
  let limit = Infinity;
  let fitted = false;
  if (s.fit) {
    // Mayor escala con la que caben exactamente `target` caracteres.
    const solve = (target, lo = 0.3, hi = 2.5) => {
      if (layout({ gamma: lo, limit: target }).consumed < target) return null;
      for (let it = 0; it < 30; it++) {
        const mid = (lo + hi) / 2;
        if (layout({ gamma: mid, limit: target }).consumed >= target) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const candidates = [];
    if (s.repeat) {
      const natural = layout({ gamma: 1 });
      const reps = Math.max(1, Math.round((natural.consumed + sep.length) / chars.length));
      for (const k of [reps, reps + 1, reps - 1, reps + 2]) {
        if (k < 1) continue;
        const target = k * chars.length - sep.length; // termina con el texto, no con el separador
        const gm = solve(target);
        if (gm !== null) candidates.push({ gamma: gm, target });
      }
    } else {
      const gm = solve(unit.length);
      if (gm !== null) candidates.push({ gamma: gm, target: unit.length });
    }
    // Se prefiere la escala más cercana a 1 dentro de márgenes que no juntan las vueltas.
    const ok = candidates.filter((c) => c.gamma >= 0.8 && c.gamma <= 1.15);
    const pick = (ok.length ? ok : candidates).sort((a, b) => Math.abs(Math.log(a.gamma)) - Math.abs(Math.log(b.gamma)))[0];
    if (pick) {
      gamma = Math.min(pick.gamma, 1.15);
      limit = pick.target;
      fitted = pick.gamma <= 1.15;
    }
  }

  const { placed, end } = layout({ gamma, limit });
  const contours = [];
  const capRatio = (font.tables.os2?.sCapHeight || font.unitsPerEm * 0.7) / font.unitsPerEm;
  for (const { g, d, adv, size } of placed) {
    const c = track.at(d + adv / 2);
    const nx = -c.ty; // normal hacia fuera en un recorrido horario
    const ny = c.tx;
    for (const contour of glyphContours(g, -adv / 2, (-capRatio * size) / 2, size, curveSegments)) {
      contours.push(contour.map(([lx, ly]) => [c.x + lx * c.tx + ly * nx, c.y + lx * c.ty + ly * ny]));
    }
  }
  return { contours, placed, total: track.total, end, gamma, fitted };
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

function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}

/** Distancia mínima desde el origen hasta el borde de un polígono. */
function distanceToPolygon(poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const ex = bx - ax;
    const ey = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * ex + ay * ey) / (ex * ex + ey * ey || 1)));
    best = Math.min(best, Math.hypot(ax + ex * t, ay + ey * t));
  }
  return best;
}

function largestPolygon(polys) {
  return polys.reduce((best, poly) => (Math.abs(polygonArea(poly)) > Math.abs(polygonArea(best)) ? poly : best));
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
        p.spiral.enabled && p.spiral.mode === 'emboss' ? p.spiral.depth : 0,
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

    let spiralCS = null;
    if (p.spiral.enabled && String(p.spiral.content || '').trim() && !deco.isEmpty()) {
      const font = fonts[p.spiral.font] || Object.values(fonts)[0];
      if (!font) warnings.push('No hay ninguna fuente cargada: se omite el texto en espiral.');
      else {
        const sp = p.spiral;
        let s0 = sp.size;
        let s1 = Math.min(sp.sizeEnd ?? sp.size, sp.size);
        // Centro de la espiral: el punto del eje de simetría vertical (todas las
        // formas lo tienen) más alejado del borde. En un corazón queda por debajo
        // de la muesca, no en el centro de su caja ni en su centroide.
        const decoPoly = largestPolygon(deco.toPolygons());
        const { cy: midY, h: hDeco } = bounds([decoPoly]);
        let cx = 0;
        let cy = midY;
        let bestR = -1;
        for (let y = midY - hDeco / 2; y <= midY + hDeco / 2; y += 0.25) {
          const r = distanceToPolygon(decoPoly.map(([x, yy]) => [x, yy - y]));
          if (r > bestR) {
            bestR = r;
            cy = y;
          }
        }

        // Hueco central: nunca menor que el que necesitan las letras finales
        // para no enredarse en vueltas demasiado cerradas.
        const holeFor = (b) => Math.max(sp.innerRadius, b * 1.6) + b * 0.55;

        // Las vueltas son copias a escala del contorno (reducidas hacia el
        // centro), así toda la forma se llena, incluidas puntas como la del
        // corazón. La separación mínima entre vueltas se da donde el contorno
        // pasa más cerca del centro (rIn) y ahí vale lineSpacing × tamaño.
        const smoothRing = (cs, R) => {
          const eroded = inset(cs, R);
          if (eroded.isEmpty()) return null;
          const opened = own(eroded.offset(R, 'Round', 2, q.round));
          const polys = own(own(opened.offset(R, 'Round', 2, q.round)).offset(-R, 'Round', 2, q.round)).toPolygons();
          return polys.length === 1 ? polys[0] : null; // si se parte, la espiral acaba
        };
        const makeRings = (a, b) => {
          const holeR = holeFor(b);
          const outerRing = inset(deco, a * 0.55);
          const base = outerRing.isEmpty() ? null : largestPolygon(outerRing.toPolygons()).map(([x, y]) => [x - cx, y - cy]);
          const rIn = base ? distanceToPolygon(base) : 0;
          // Tamaño de letra según lo cerca del centro que pasa cada vuelta.
          const sizeAtScale = (lambda) =>
            b + (a - b) * Math.min(1, Math.max(0, (lambda * rIn - holeR) / Math.max(1e-6, rIn - holeR)));
          const rings = [];
          const sizes = [];
          for (let k = 0, lambda = 1; base && k < 200 && lambda * rIn >= holeR; k++) {
            const sz = sizeAtScale(lambda);
            const scaled = own(new CrossSection([base.map(([x, y]) => [x * lambda, y * lambda])], 'NonZero'));
            const poly = smoothRing(scaled, sz * 1.4);
            if (!poly) break;
            rings.push(poly);
            sizes.push(sz);
            // Paso hasta la siguiente vuelta según el tamaño medio entre ambas.
            lambda -= (sp.lineSpacing * sizeAtScale(lambda - (sp.lineSpacing * sz) / (2 * rIn))) / rIn;
          }
          return { rings, sizes, holeR };
        };
        // Si con estos tamaños no caben al menos 3 anillos (dos vueltas), se
        // reducen las letras manteniendo la proporción entre inicio y final.
        // La letra final no baja de 3 mm por esta reducción (legibilidad).
        const endFor = (f) => Math.min(s1, Math.max(s1 * f, 3));
        let spiralRings = makeRings(s0, s1);
        let shrink = 1;
        while (spiralRings.rings.length < 3 && shrink > 0.3) {
          shrink *= 0.9;
          spiralRings = makeRings(Math.max(s0 * shrink, endFor(shrink)), endFor(shrink));
        }
        if (shrink < 1 && spiralRings.rings.length >= 3) {
          s1 = endFor(shrink);
          s0 = Math.max(s0 * shrink, s1);
          warnings.push(`Para que la espiral dé al menos dos vueltas, sus letras se han reducido a ${s0.toFixed(1)}–${s1.toFixed(1)} mm.`);
        } else if (shrink < 1) {
          spiralRings = makeRings(s0, s1);
        }
        const { rings, sizes: ringSizes, holeR } = spiralRings;

        // Donde las vueltas quedan mucho más separadas que en su punto más
        // estrecho (los lóbulos de un corazón), las letras crecen para llenar
        // el hueco. Por debajo de 1,45× no se toca, así las formas regulares
        // (círculo, polígonos, cuadrado) mantienen un tamaño uniforme.
        const SLACK_START = 1.45;
        const growFor = (slack) => (sp.adaptive ? Math.min(1.8, Math.max(1, slack / SLACK_START)) : 1);
        const raw = spiralPath(rings, (sp.startAngle * Math.PI) / 180, Math.max(128, q.round * 2), ringSizes);
        // Tamaño permitido en cada punto según la separación real con la vuelta
        // siguiente; se usa la MÍNIMA de su entorno (criterio conservador).
        const win = Math.max(4, Math.round(raw.length / Math.max(1, rings.length) / 16));
        const allowed = raw.map(([, , sz], i) => {
          let gap = Infinity;
          for (let k = Math.max(0, i - win); k <= Math.min(raw.length - 1, i + win); k++) gap = Math.min(gap, raw[k][3]);
          const room = gap / (sp.lineSpacing * sz);
          // Donde las vueltas quedan más juntas de lo previsto (p. ej. junto a
          // una muesca), las letras encogen para no pisarse; donde sobra sitio
          // pueden crecer (si está activado «adaptar el tamaño»).
          return sz * (room < 1 ? Math.max(0.55, room) : growFor(room));
        });
        // El tamaño solo puede cambiar poco a poco a lo largo del recorrido
        // (pasada hacia delante y hacia atrás), sin superar nunca lo permitido.
        const SLOPE = 0.04; // mm de tamaño por mm de recorrido
        const sizes = allowed.slice();
        const stepLen = (i) => Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
        for (let i = 1; i < sizes.length; i++) sizes[i] = Math.min(sizes[i], sizes[i - 1] + SLOPE * stepLen(i));
        for (let i = sizes.length - 2; i >= 0; i--) sizes[i] = Math.min(sizes[i], sizes[i + 1] + SLOPE * stepLen(i + 1));
        const path = raw.map(([x, y], i) => [x + cx, y + cy, sizes[i]]);
        // Se saltan las letras que invadirían el hueco central o pisarían el
        // texto o el logotipo centrales.
        const boxes = [textCS, logoCS].filter(Boolean).map((cs) => cs.bounds());
        const avoid = (x, y, size) => {
          const pad = size * 0.6 + 1;
          return (
            Math.hypot(x - cx, y - cy) < holeR - s1 * 0.55 + size * 0.55 ||
            boxes.some((b) => x > b.min[0] - pad && x < b.max[0] + pad && y > b.min[1] - pad && y < b.max[1] + pad)
          );
        };
        if (path.length < 2) {
          warnings.push('No cabe ninguna vuelta de espiral: reduce el tamaño de letra o el hueco central.');
        } else {
          const r = textAlongPath(
            font,
            path,
            { ...sp, size: s0, letterSpacing: (sp.letterSpacing * s0) / sp.size, minSize: Math.min(MIN_LEGIBLE, s1) },
            q.curve,
            avoid,
          );
          if (!r.contours.length) {
            warnings.push('No cabe el texto en espiral: reduce el tamaño de letra o el hueco central.');
          } else {
            spiralCS = own(new CrossSection(r.contours, 'NonZero'));
            const minSize = Math.min(...r.placed.map((g) => g.size));
            if (minSize < 3) {
              warnings.push(
                `Las letras más pequeñas de la espiral miden ${minSize.toFixed(1)} mm: por debajo de 3 mm pueden no leerse bien con una boquilla de 0,4 mm.`,
              );
            }
            if (sp.fit && !r.fitted) {
              warnings.push(
                sp.repeat
                  ? 'No se ha podido ajustar la espiral a repeticiones completas; prueba otro tamaño de letra.'
                  : 'El texto es corto para llenar la espiral: activa «Repetir» o aumenta el tamaño de letra.',
              );
            }
          }
        }
      }
    }

    if (p.pattern.type !== 'none') {
      const contours = patternContours(p.pattern, p.size / 2, q);
      if (contours.length) {
        let cs = own(new CrossSection(contours, 'NonZero'));
        // Deja un margen liso alrededor del texto y el logotipo para que se lean bien.
        const figures = [textCS, logoCS, spiralCS].filter(Boolean);
        if (figures.length && p.pattern.clearance > 0) {
          const union = figures.length > 1 ? own(CrossSection.union(figures)) : figures[0];
          cs = own(cs.subtract(own(union.offset(p.pattern.clearance, 'Round', 2, q.round / 4))));
        }
        decorate(cs, p.pattern.mode, p.pattern.depth, 'El patrón', false);
      }
    }
    if (textCS) decorate(textCS, p.text.mode, p.text.depth, 'El texto');
    if (logoCS) decorate(logoCS, p.logo.mode, p.logo.depth, 'El logotipo');
    if (spiralCS) decorate(spiralCS, p.spiral.mode, p.spiral.depth, 'El texto en espiral', false);

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
