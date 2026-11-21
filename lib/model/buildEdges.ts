import * as THREE from 'three';
import { flattenParts, type PartNode } from './partTree.ts';

/**
 * Onshape-style edge lines: thin dark lines wherever two faces meet at a crease.
 *
 * The crease search itself (lib/model/creaseEdges.ts) runs in a worker (lib/model/runEdges.ts).
 * This module is the main-thread half on either side of it:
 *  - collect: copy each part's geometry out, with the placement it renders at
 *  - assemble: bake that placement into the worker's local-space segments and merge every
 *    part into ONE LineSegments, so edges cost one draw call however many parts there are
 *
 * Hiding a part rewrites the index in place to only the visible parts' ranges and moves the
 * draw range. It is O(edges) per toggle and nothing per frame. drawRange alone cannot do it
 * (hidden parts are not contiguous), and swapping in a new index attribute would orphan the old
 * GPU buffer on every toggle.
 *
 * The lines do not pick: raycast is a no-op, so measurement snapping, comment pins and part
 * clicks see exactly the faces they saw before. They are clipped by the section planes for
 * free (setClippingPlanes in lib/threeMaterials.ts sets planes on ANY object with a material),
 * and SectionCaps skips them because it only reads `isMesh` objects.
 */

export const EDGE_COLOR = '#2b2f36';

/**
 * Above this many triangles in a model, no edges are drawn. The worker would take roughly
 * 1.25 s per 1.5 M triangles (measured 2026-11-20), plus copying the geometry over; past this
 * the copy's memory starts to matter on the files the 200 MB audit is about.
 */
export const EDGE_MAX_TRIANGLES = 1_500_000;

export interface EdgeSource {
  /** Part key; `''` on paths with no parts. */
  key: string;
  /** A COPY. Safe to transfer to the worker without detaching the live geometry. */
  positions: Float32Array;
  index: Uint32Array | null;
  /** Where these local positions render, in the frame the LineSegments is mounted in. */
  matrix: THREE.Matrix4;
  triangles: number;
}

export interface ModelEdges {
  lines: THREE.LineSegments;
  setHidden(isHidden: (key: string) => boolean): void;
  dispose(): void;
}

interface Range {
  start: number;
  count: number;
}

function isPlainMesh(object: THREE.Object3D): object is THREE.Mesh {
  const candidate = object as THREE.Mesh & THREE.InstancedMesh & THREE.BatchedMesh & THREE.SkinnedMesh;
  if (candidate.isMesh !== true) return false;
  // Their geometry is not where they render: per-instance matrices or a skeleton pose it.
  return !candidate.isInstancedMesh && !candidate.isBatchedMesh && !candidate.isSkinnedMesh;
}

/** Float32 copy of the positions, de-interleaved and de-quantised through the attribute. */
function copyPositions(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
  const plain = attribute as THREE.BufferAttribute;
  if (
    !(attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute &&
    plain.array instanceof Float32Array &&
    plain.itemSize === 3 &&
    !plain.normalized
  ) {
    return plain.array.slice(0, plain.count * 3);
  }
  const out = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++) {
    out[i * 3] = attribute.getX(i);
    out[i * 3 + 1] = attribute.getY(i);
    out[i * 3 + 2] = attribute.getZ(i);
  }
  return out;
}

function sourceFor(key: string, mesh: THREE.Mesh, matrix: THREE.Matrix4): EdgeSource | null {
  const position = mesh.geometry?.getAttribute('position');
  if (!position || position.count === 0) return null;
  const indexAttribute = mesh.geometry.getIndex();
  const index = indexAttribute ? Uint32Array.from(indexAttribute.array as ArrayLike<number>) : null;
  return {
    key,
    positions: copyPositions(position),
    index,
    matrix,
    triangles: (index ? index.length : position.count) / 3,
  };
}

/**
 * Batched path. The loaded root is never mounted there (only the batches are), so a mesh's
 * matrixWorld after updateWorldMatrix(true, false) is root-relative: the exact matrix
 * buildBatches puts on the instance, so the lines and the faces share one frame.
 */
export function collectEdgeSources(parts: PartNode[]): EdgeSource[] {
  const sources: EdgeSource[] = [];
  flattenParts(parts).forEach((part) => {
    part.meshes.forEach((mesh) => {
      if (!mesh.visible || !isPlainMesh(mesh)) return;
      mesh.updateWorldMatrix(true, false);
      const source = sourceFor(part.key, mesh, mesh.matrixWorld.clone());
      if (source) sources.push(source);
    });
  });
  return sources;
}

/**
 * Unbatched path and STL/PLY. Here `root` itself IS mounted, under the transform group and
 * <Center>, by the time an effect runs, so a mesh's matrixWorld includes those ancestors.
 * The lines render as root's sibling, under the same parent, so they need root's own transform
 * and none of its ancestors': root.matrix x root.matrixWorld^-1 x mesh.matrixWorld.
 */
export function collectEdgeSourcesForObject(root: THREE.Object3D): EdgeSource[] {
  root.updateWorldMatrix(true, true);
  const toParentFrame = root.matrix.clone().multiply(root.matrixWorld.clone().invert());
  const sources: EdgeSource[] = [];
  root.traverseVisible((object) => {
    if (!isPlainMesh(object)) return;
    const source = sourceFor('', object, toParentFrame.clone().multiply(object.matrixWorld));
    if (source) sources.push(source);
  });
  return sources;
}

export function assembleEdges(sources: EdgeSource[], segments: Float32Array[]): ModelEdges | null {
  let total = 0;
  segments.forEach((s) => (total += s.length));
  if (total === 0) return null;

  const positions = new Float32Array(total);
  const ranges = new Map<string, Range[]>();
  const point = new THREE.Vector3();
  let offset = 0;
  segments.forEach((local, i) => {
    if (local.length === 0) return;
    const matrix = sources[i].matrix;
    for (let p = 0; p < local.length; p += 3) {
      point.set(local[p], local[p + 1], local[p + 2]).applyMatrix4(matrix);
      positions[offset + p] = point.x;
      positions[offset + p + 1] = point.y;
      positions[offset + p + 2] = point.z;
    }
    const list = ranges.get(sources[i].key) ?? [];
    list.push({ start: offset / 3, count: local.length / 3 });
    ranges.set(sources[i].key, list);
    offset += local.length;
  });

  const vertexCount = total / 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const indexArray = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) indexArray[i] = i;
  const index = new THREE.BufferAttribute(indexArray, 1);
  geometry.setIndex(index);
  geometry.setDrawRange(0, vertexCount);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = 'stiko-edges';
  lines.raycast = () => {};

  return {
    lines,
    setHidden(isHidden) {
      let written = 0;
      ranges.forEach((list, key) => {
        if (isHidden(key)) return;
        list.forEach((range) => {
          for (let i = 0; i < range.count; i++) indexArray[written++] = range.start + i;
        });
      });
      geometry.setDrawRange(0, written);
      index.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
