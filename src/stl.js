// Exportación a STL binario (sin dependencias).

/**
 * Serializa una malla indexada a un ArrayBuffer STL binario.
 * @param {Float32Array} positions  x, y, z por vértice.
 * @param {Uint32Array} indices     tres índices por triángulo.
 */
export function toSTL(positions, indices, name = 'posavasos') {
  const tris = indices.length / 3;
  const buf = new ArrayBuffer(84 + tris * 50);
  const view = new DataView(buf);
  const header = `STL ${name} - generado con Posavasos`.slice(0, 80);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i) & 0x7f);
  view.setUint32(80, tris, true);
  let o = 84;
  const v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const i = indices[t * 3 + k] * 3;
      v[k * 3] = positions[i];
      v[k * 3 + 1] = positions[i + 1];
      v[k * 3 + 2] = positions[i + 2];
    }
    const ax = v[3] - v[0], ay = v[4] - v[1], az = v[5] - v[2];
    const bx = v[6] - v[0], by = v[7] - v[1], bz = v[8] - v[2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    view.setFloat32(o, nx / len, true);
    view.setFloat32(o + 4, ny / len, true);
    view.setFloat32(o + 8, nz / len, true);
    o += 12;
    for (let k = 0; k < 9; k++, o += 4) view.setFloat32(o, v[k], true);
    o += 2; // attribute byte count
  }
  return buf;
}
