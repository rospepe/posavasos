// Genera la geometría fuera del hilo principal para que la interfaz no se bloquee.
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { parse } from 'opentype.js';
import { buildCoaster } from './coaster.js';
import { FONTS } from './fonts.js';

const ready = Module({ locateFile: () => wasmUrl }).then((wasm) => {
  wasm.setup();
  return wasm;
});

const fonts = {};

async function getFont(id) {
  if (!fonts[id]) {
    const def = FONTS.find((f) => f.id === id);
    if (!def) return null;
    fonts[id] = fetch(def.url)
      .then((r) => r.arrayBuffer())
      .then((buf) => parse(buf));
  }
  return fonts[id];
}

self.onmessage = async ({ data }) => {
  if (data.type === 'font') {
    // Fuente subida por el usuario (ya validada en el hilo principal).
    fonts[data.id] = Promise.resolve(parse(data.buffer));
    return;
  }
  if (data.type !== 'build') return;
  try {
    const wasm = await ready;
    const fontId = data.params.text.font;
    const font = data.params.text.enabled ? await getFont(fontId) : null;
    const result = buildCoaster(wasm, data.params, font ? { [fontId]: font } : {});
    self.postMessage({ type: 'result', id: data.id, ...result }, [result.positions.buffer, result.indices.buffer]);
  } catch (e) {
    self.postMessage({ type: 'error', id: data.id, message: e?.message || String(e) });
  }
};
