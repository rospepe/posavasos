import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import Module from 'manifold-3d';
import { buildCoaster, SHAPES, PATTERNS } from '../src/coaster.js';
import { toSTL } from '../src/stl.js';

const fontFile = (pkg, file) => {
  const buf = readFileSync(new URL(`../node_modules/@fontsource/${pkg}/files/${file}`, import.meta.url));
  return parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

/** Aristas que no comparten exactamente dos triángulos (0 ⇒ malla cerrada). */
function badEdges({ indices }) {
  const edges = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e];
      const b = indices[t + ((e + 1) % 3)];
      const id = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(id, (edges.get(id) || 0) + 1);
    }
  }
  let bad = 0;
  for (const n of edges.values()) if (n !== 2) bad++;
  return bad;
}

let wasm;
let fonts;
const build = (params) => buildCoaster(wasm, params, fonts);

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
  fonts = {
    roboto: fontFile('roboto', 'roboto-latin-700-normal.woff'),
    pacifico: fontFile('pacifico', 'pacifico-latin-400-normal.woff'),
  };
});

describe('buildCoaster', () => {
  it('genera un disco liso con las dimensiones pedidas', () => {
    const r = build({ size: 90, thickness: 3, border: { enabled: false }, text: { enabled: false } });
    expect(r.size[0]).toBeCloseTo(90, 1);
    expect(r.size[2]).toBeCloseTo(3, 5);
    expect(r.volume).toBeCloseTo(Math.PI * 45 * 45 * 3, -2);
    expect(badEdges(r)).toBe(0);
  });

  for (const shape of SHAPES) {
    it(`forma ${shape} con borde y texto en relieve es cerrada`, () => {
      const r = build({ shape, text: { font: 'roboto', content: 'Hola\nMamá' } });
      // `size` es el ancho en al menos un eje (hexágono/octógono: entre lados opuestos).
      expect(r.size.slice(0, 2).some((d) => Math.abs(d - 100) < 0.5)).toBe(true);
      expect(r.size[2]).toBeCloseTo(4 + 1.5, 5);
      expect(badEdges(r)).toBe(0);
    });
  }

  for (const type of PATTERNS.filter((t) => t !== 'none')) {
    for (const mode of ['emboss', 'engrave']) {
      it(`patrón ${type} (${mode})`, () => {
        const plain = build({ text: { enabled: false } });
        const r = build({ text: { enabled: false }, pattern: { type, mode } });
        expect(badEdges(r)).toBe(0);
        if (mode === 'emboss') expect(r.volume).toBeGreaterThan(plain.volume);
        else expect(r.volume).toBeLessThan(plain.volume);
      });
    }
  }

  it('limita el grabado para no atravesar la base y respeta el hueco inferior', () => {
    const r = build({
      text: { font: 'pacifico', content: '¡Salud!', mode: 'engrave', depth: 10 },
      recess: { enabled: true, depth: 1 },
    });
    expect(r.warnings.some((w) => w.includes('grabado limitado'))).toBe(true);
    expect(r.size[2]).toBeCloseTo(5.5, 5);
    expect(badEdges(r)).toBe(0);
  });

  it('avisa si el texto se sale del área decorable', () => {
    const r = build({ text: { font: 'roboto', content: 'MUY LARGO', size: 40 } });
    expect(r.warnings.some((w) => w.includes('recortado'))).toBe(true);
    expect(r.size[0]).toBeCloseTo(100, 0);
  });

  it('logotipo SVG con agujero', () => {
    const square = (a, b) => [[a, a], [b, a], [b, b], [a, b]];
    const contours = [[square(1, 9), square(3, 7).reverse()]];
    const plain = build({ text: { enabled: false } });
    const r = build({ text: { enabled: false }, logo: { enabled: true, contours, size: 30, offsetY: 0, depth: 1 } });
    // Marco de 30×30 con agujero de 15×15 → 675 mm² de relieve de 1 mm.
    expect(r.volume - plain.volume).toBeCloseTo(675, -1);
    expect(badEdges(r)).toBe(0);
  });
});

describe('toSTL', () => {
  it('produce un STL binario con cabecera y número de triángulos correcto', () => {
    const r = build({ quality: 'draft', text: { enabled: false } });
    const buf = toSTL(r.positions, r.indices);
    const view = new DataView(buf);
    const tris = view.getUint32(80, true);
    expect(tris).toBe(r.indices.length / 3);
    expect(buf.byteLength).toBe(84 + tris * 50);
  });
});

describe('espacio libre del patrón', () => {
  it('aparta el patrón del texto', () => {
    const base = { text: { font: 'roboto', content: 'HOLA', mode: 'engrave' }, pattern: { type: 'dots', mode: 'emboss' } };
    const tight = build({ ...base, pattern: { ...base.pattern, clearance: 0 } });
    const wide = build({ ...base, pattern: { ...base.pattern, clearance: 6 } });
    expect(wide.volume).toBeLessThan(tight.volume);
    expect(badEdges(wide)).toBe(0);
  });
});

describe('texto en espiral', () => {
  const spiral = { enabled: true, content: 'Feliz cumpleaños', font: 'roboto' };

  for (const shape of ['circle', 'square', 'hexagon', 'heart']) {
    it(`llena una espiral que sigue la forma ${shape} y la malla es cerrada`, () => {
      const plain = build({ shape, text: { enabled: false } });
      const r = build({ shape, text: { enabled: false }, spiral });
      expect(r.volume).toBeGreaterThan(plain.volume + 50);
      expect(badEdges(r)).toBe(0);
      expect(r.warnings).toEqual([]);
    });
  }

  it('repetir llena más que escribir el texto una sola vez', () => {
    const base = build({ text: { enabled: false } }).volume;
    const once = build({ text: { enabled: false }, spiral: { ...spiral, repeat: false } }).volume - base;
    const many = build({ text: { enabled: false }, spiral }).volume - base;
    expect(many).toBeGreaterThan(once * 3);
  });

  it('un hueco central mayor deja menos texto', () => {
    const small = build({ text: { enabled: false }, spiral: { ...spiral, innerRadius: 10 } }).volume;
    const big = build({ text: { enabled: false }, spiral: { ...spiral, innerRadius: 30 } }).volume;
    expect(big).toBeLessThan(small);
  });

  it('se combina con texto central grabado y patrón', () => {
    const r = build({
      text: { font: 'pacifico', content: 'Ana', mode: 'engrave' },
      spiral: { ...spiral, mode: 'engrave' },
      pattern: { type: 'rings', mode: 'emboss' },
    });
    expect(badEdges(r)).toBe(0);
  });

  it('avisa si no cabe ninguna vuelta', () => {
    const r = build({ size: 50, text: { enabled: false }, spiral: { ...spiral, innerRadius: 40 } });
    expect(r.warnings.some((w) => w.includes('No cabe'))).toBe(true);
  });
});

describe('spiralPath', async () => {
  const { spiralPath } = await import('../src/coaster.js');
  it('va de fuera hacia dentro en sentido horario', () => {
    const circle = (r) => Array.from({ length: 64 }, (_, i) => [r * Math.cos((i / 64) * 2 * Math.PI), r * Math.sin((i / 64) * 2 * Math.PI)]);
    const path = spiralPath([circle(40), circle(30), circle(20)], Math.PI / 2, 128);
    const r = path.map(([x, y]) => Math.hypot(x, y));
    expect(r[0]).toBeCloseTo(40, 0);
    expect(r[r.length - 1]).toBeCloseTo(20, 0);
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeLessThanOrEqual(r[i - 1] + 0.05);
    // Horario: justo después de arrancar arriba, x crece.
    expect(path[1][0]).toBeGreaterThan(path[0][0]);
  });
});
