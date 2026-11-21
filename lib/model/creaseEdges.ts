/**
 * Finds the crease edges of a triangle mesh: every edge where two faces meet at
 * `thresholdDeg` or more, plus every open (single-face) boundary edge. This matches
 * THREE.EdgesGeometry's output.
 *
 * Exists instead of EdgesGeometry for two reasons, both measured (2026-11-20):
 *  - Speed: EdgesGeometry keys its hash maps on strings and takes 5.5 s on 1.5 M triangles;
 *    this takes ~1.25 s, using an integer open-addressing weld table and numeric edge keys.
 *  - Bundle: this runs inside lib/model/edgeWorker.ts, and importing three there would ship
 *    all of three in the worker chunk. This module imports nothing.
 *
 * WELDING IS THE POINT. CAD tessellation gives every B-rep face its own vertices, so two faces
 * that meet at a chamfer share positions but no indices. Without welding by position every face
 * boundary looks open and gets drawn, smooth seams included. Positions are quantised to 1e-4
 * (EdgesGeometry's own default precision) before comparison.
 */

export const CREASE_THRESHOLD_DEG = 30;

const WELD_PRECISION = 1e4;

export function extractCreaseEdges(
  positions: Float32Array,
  index: Uint32Array | null,
  thresholdDeg: number,
): Float32Array {
  const vertexCount = positions.length / 3;
  const triangleCount = index ? index.length / 3 : vertexCount / 3;

  // --- Weld: quantised position -> first vertex seen at that position.
  let capacity = 1;
  while (capacity < vertexCount * 2) capacity <<= 1;
  const mask = capacity - 1;
  const slots = new Int32Array(capacity).fill(-1);
  const qx = new Int32Array(vertexCount);
  const qy = new Int32Array(vertexCount);
  const qz = new Int32Array(vertexCount);
  const weld = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const x = Math.round(positions[v * 3] * WELD_PRECISION);
    const y = Math.round(positions[v * 3 + 1] * WELD_PRECISION);
    const z = Math.round(positions[v * 3 + 2] * WELD_PRECISION);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    for (;;) {
      const s = slots[h];
      if (s === -1) {
        slots[h] = v;
        qx[v] = x;
        qy[v] = y;
        qz[v] = z;
        weld[v] = v;
        break;
      }
      if (qx[s] === x && qy[s] === y && qz[s] === z) {
        weld[v] = s;
        break;
      }
      h = (h + 1) & mask;
    }
  }

  // --- Pair faces across each welded edge and compare their normals.
  const cosThreshold = Math.cos((thresholdDeg * Math.PI) / 180);
  const normals = new Float32Array(triangleCount * 3);
  // Edge key -> the first triangle seen on it, or -1 once a second triangle has been compared.
  // lo * vertexCount + hi stays far below 2^53 for any mesh that fits in memory.
  const firstFace = new Map<number, number>();
  const out: number[] = [];
  const emit = (a: number, b: number) => {
    out.push(
      positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2],
      positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2],
    );
  };
  const corners = [0, 0, 0];

  for (let t = 0; t < triangleCount; t++) {
    const a = weld[index ? index[t * 3] : t * 3];
    const b = weld[index ? index[t * 3 + 1] : t * 3 + 1];
    const c = weld[index ? index[t * 3 + 2] : t * 3 + 2];
    if (a === b || b === c || a === c) continue;

    const ux = positions[b * 3] - positions[a * 3];
    const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
    const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3];
    const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length === 0) continue;
    normals[t * 3] = nx / length;
    normals[t * 3 + 1] = ny / length;
    normals[t * 3 + 2] = nz / length;

    corners[0] = a;
    corners[1] = b;
    corners[2] = c;
    for (let k = 0; k < 3; k++) {
      const p = corners[k];
      const r = corners[(k + 1) % 3];
      const lo = p < r ? p : r;
      const hi = p < r ? r : p;
      const key = lo * vertexCount + hi;
      const other = firstFace.get(key);
      if (other === undefined) {
        firstFace.set(key, t);
        continue;
      }
      if (other === -1) continue; // a third face on a non-manifold edge: already decided
      const dot =
        normals[other * 3] * normals[t * 3] +
        normals[other * 3 + 1] * normals[t * 3 + 1] +
        normals[other * 3 + 2] * normals[t * 3 + 2];
      if (dot <= cosThreshold) emit(lo, hi);
      firstFace.set(key, -1);
    }
  }

  // --- Edges only one face ever touched are open boundaries: always drawn.
  firstFace.forEach((face, key) => {
    if (face === -1) return;
    const lo = Math.floor(key / vertexCount);
    emit(lo, key - lo * vertexCount);
  });

  return new Float32Array(out);
}
