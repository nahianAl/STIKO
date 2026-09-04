import * as THREE from 'three';

/**
 * The assembly tree, read back out of a loaded model.
 *
 * A part is a NODE, never a primitive and never a material group. A rim modelled as 200
 * fragments under one node is one part; a rim carrying two materials is still one part, even
 * though GLTFLoader hands it to us as a Group with two Mesh children.
 *
 * Two sources of truth, in order:
 *
 * 1. `userData.stikoPart`, stamped into glTF node `extras` by our import pipeline and copied
 *    into userData by GLTFLoader (GLTFLoader.js:2306). This is authoritative and nests.
 * 2. No marker anywhere — a legacy upload, or a format that never passes through our import
 *    (OBJ, DAE, 3DS). Then the direct children of the scene root are the parts and nothing
 *    nests. This is a fallback, not a guess dressed up as structure: where a file has no
 *    hierarchy at all the answer is genuinely "one part", and the panel says so.
 *
 * Pure: no rendering, no DOM, no React. Unit-tested under `node --test`.
 */

/** The glTF `extras` key our import stamps, surfacing as `object.userData[PART_MARKER]`. */
export const PART_MARKER = 'stikoPart';

export interface PartNode {
  /** Index path from the scene root — `0/2/1`. Stable because stored files are immutable. */
  key: string;
  /** Display only. May be empty, and may be duplicated across parts. */
  name: string;
  children: PartNode[];
  /** Meshes owned by this node directly — never those belonging to a nested part. */
  meshes: THREE.Mesh[];
  /** This part's own triangles plus every descendant's. Drives auto-colour ranking. */
  triangles: number;
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function isDrawable(object: THREE.Object3D): object is THREE.Line | THREE.Points {
  const candidate = object as THREE.Line & THREE.LineSegments & THREE.Points;
  return candidate.isLine === true || candidate.isLineSegments === true || candidate.isPoints === true;
}

/**
 * Line and point drawables anywhere under `root` — the `Line`/`LineSegments`/`LineLoop` and
 * `Points` objects GLTFLoader builds for glTF's LINES/LINE_STRIP/LINE_LOOP/POINTS primitives
 * (see lib/model/optimizeGlb.ts's LINE_MODES handling for a concrete case: the reference file
 * carries 551 LINE_STRIP primitives).
 *
 * `ownMeshes` above only ever collects `isMesh` objects, and `buildBatches` only ever batches
 * triangle geometry — `BatchedMesh` has no way to hold a strip or a point cloud — so without a
 * separate pass, every line and point primitive in a model that has parts is silently dropped
 * once the batched render replaces the loaded tree. They carry no part key (there is no slot in
 * `PartNode.meshes` for them), so the caller cannot colour, hide or pick them through the part
 * panel — it renders them as plain extra primitives, unbatched, alongside the batches instead.
 *
 * Deliberately does not overlap `ownMeshes`/`buildPartTree`: `isDrawable` and `isMesh` are
 * mutually exclusive on every object three.js produces, so nothing collected here can already be
 * sitting inside a batch.
 */
export function collectDrawables(root: THREE.Object3D): (THREE.Line | THREE.Points)[] {
  const out: (THREE.Line | THREE.Points)[] = [];
  root.traverse((object) => {
    if (isDrawable(object)) out.push(object);
  });
  return out;
}

function isBoundary(object: THREE.Object3D): boolean {
  return object.userData?.[PART_MARKER] === true;
}

function trianglesOf(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  if (!geometry) return 0;
  const index = geometry.getIndex();
  const count = index ? index.count : (geometry.getAttribute('position')?.count ?? 0);
  return Math.floor(count / 3);
}

/** True if any node under `root` carries the import marker. */
function hasMarkers(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((object) => {
    if (isBoundary(object)) found = true;
  });
  return found;
}

/**
 * Meshes under `object` that belong to `object` itself, stopping at any nested part boundary.
 * `object` is the boundary we started from, so its own marker must not stop the walk.
 */
function ownMeshes(object: THREE.Object3D, isStart: boolean): THREE.Mesh[] {
  if (!isStart && isBoundary(object)) return [];
  const out: THREE.Mesh[] = [];
  if (isMesh(object)) out.push(object);
  for (const child of object.children) out.push(...ownMeshes(child, false));
  return out;
}

function sumTriangles(meshes: THREE.Mesh[]): number {
  return meshes.reduce((sum, m) => sum + trianglesOf(m), 0);
}

function makePart(object: THREE.Object3D, key: string): PartNode {
  const children = boundariesUnder(object, key);
  const meshes = ownMeshes(object, true);
  const triangles = sumTriangles(meshes) + children.reduce((sum, c) => sum + c.triangles, 0);
  return { key, name: object.name ?? '', children, meshes, triangles };
}

/**
 * The part boundaries directly beneath `object`, descending through unmarked intermediates.
 * Exporters routinely insert an unnamed wrapper node between the scene root and the real
 * assembly; treating that wrapper as a part would put every model inside a single useless row.
 *
 * Deliberately blind to geometry: any mesh reachable from `object` without crossing a nested
 * boundary is already accounted for by the caller's own `ownMeshes(object, true)` (that call
 * recurses through non-boundary structure exactly as this one does), so re-collecting it here
 * would double-count it. This function's only job is finding the *next* boundary down each
 * branch. It is safe to use from within `makePart`, and only from there — see `totalPartsUnder`
 * for the outermost walk, which has no such enclosing `ownMeshes` call to rely on.
 */
function boundariesUnder(object: THREE.Object3D, prefix: string): PartNode[] {
  const out: PartNode[] = [];
  object.children.forEach((child, i) => {
    const key = prefix === '' ? String(i) : `${prefix}/${i}`;
    if (isBoundary(child)) out.push(makePart(child, key));
    else out.push(...boundariesUnder(child, key));
  });
  return out;
}

/**
 * The top-level forest: real part boundaries, plus whatever it takes to keep the tree total.
 *
 * `buildPartTree` never wraps the scene root itself in a `makePart` call, so nothing plays the
 * role of "owner" for content that sits above every boundary — a mesh attached directly to an
 * unmarked node, or an entire unmarked subtree with no marked descendant at all, would otherwise
 * appear in no PartNode anywhere (see `boundariesUnder`'s own docs for why that function alone
 * can't be the fix: it stays deliberately blind to geometry so it never conflicts with an
 * enclosing `ownMeshes` call, but at the top level there is no enclosing call to conflict with).
 *
 * So this walk additionally asks, for each non-boundary child, whether it owns any geometry no
 * boundary has claimed (`ownMeshes(child, true)` — stops at nested boundaries, same as always).
 * If it does, that child becomes a part in its own right via the ordinary `makePart` machinery,
 * which — because it goes back through the geometry-blind `boundariesUnder` — cannot re-promote
 * anything beneath it a second time. If it doesn't (a pure pass-through wrapper), we keep
 * descending in this totality-aware mode, since a real claim point may still be further down.
 */
function totalPartsUnder(object: THREE.Object3D, prefix: string): PartNode[] {
  const out: PartNode[] = [];
  object.children.forEach((child, i) => {
    const key = prefix === '' ? String(i) : `${prefix}/${i}`;
    if (isBoundary(child) || ownMeshes(child, true).length > 0) {
      out.push(makePart(child, key));
      return;
    }
    out.push(...totalPartsUnder(child, key));
  });
  return out;
}

export function buildPartTree(root: THREE.Object3D): PartNode[] {
  if (hasMarkers(root)) return totalPartsUnder(root, '');

  return root.children.map((child, i) => {
    const meshes = ownMeshes(child, true);
    return {
      key: String(i),
      name: child.name ?? '',
      children: [],
      meshes,
      triangles: sumTriangles(meshes),
    };
  });
}

/** Depth-first, parents before children — the order the panel renders rows in. */
export function flattenParts(parts: PartNode[]): PartNode[] {
  const out: PartNode[] = [];
  const walk = (nodes: PartNode[]) => {
    for (const node of nodes) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(parts);
  return out;
}

/**
 * Whether the model arrived carrying colour information of its own.
 *
 * Auto-colouring must never overwrite a designer's intent, the same principle
 * repairMaterials.ts follows in only ever touching the exporter-default signature. "Carries
 * colour" is read as "not every material is the same colour" — a model where everything is
 * one grey is exactly the bland case this feature exists to fix.
 */
export function hasAuthoredColors(root: THREE.Object3D): boolean {
  const seen = new Set<string>();
  root.traverse((object) => {
    if (!isMesh(object) || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const color = (material as THREE.MeshStandardMaterial).color;
      if (color) seen.add(color.getHexString());
    }
  });
  return seen.size > 1;
}
