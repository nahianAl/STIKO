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

function isDrawable(object: THREE.Object3D): boolean {
  // Not a type predicate: the wrapper this feeds returns a `THREE.Group`, not the drawable
  // itself, so nothing downstream needs the narrowed `Line | Points | Sprite` type.
  const candidate = object as THREE.Line & THREE.LineSegments & THREE.Points & THREE.Sprite;
  return (
    candidate.isLine === true ||
    candidate.isLineSegments === true ||
    candidate.isPoints === true ||
    // No loader in this repo currently produces a Sprite, but `isSprite` costs nothing to
    // check and the alternative — a sprite silently vanishing the day one shows up, the exact
    // failure this function exists to prevent for Line/Points — costs a debugging session.
    candidate.isSprite === true
  );
}

/**
 * Line and point drawables anywhere under `root` — the `Line`/`LineSegments`/`LineLoop`/`Points`
 * (and, for completeness, `Sprite`) objects GLTFLoader builds for glTF's
 * LINES/LINE_STRIP/LINE_LOOP/POINTS primitives (see lib/model/optimizeGlb.ts's LINE_MODES
 * handling for a concrete case: the reference file carries 551 LINE_STRIP primitives) — each
 * returned wrapped in a fresh `THREE.Group` that carries the drawable's baked WORLD transform
 * (relative to `root`, which itself has no parent) as its own local transform, and holds a
 * shallow clone of the drawable, reset to an identity local transform, as its only child.
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
 *
 * Why a wrapper around a CLONE, rather than returning the drawable found in `root` (baked or
 * not): `root` is `useLoader`'s cached tree, kept alive across mounts by `suspend-react` with no
 * lifespan and no `useLoader.clear()` call anywhere in this repo. A caller that reparents the
 * returned object — `<primitive object={x}>` calls `Object3D.add`, which detaches `x` from
 * whatever it was previously attached to — would tear the drawable out of `root` on the first
 * mount, so a second mount resolving to the same cache entry would traverse a `root` that no
 * longer has it: the line/point vanishes again, permanently. Mutating the drawable's own
 * position/quaternion/scale in place has a second, sharper failure: this function's own caller
 * cannot tell whether the tree it was handed already had its placement baked in by an earlier
 * call — there is nothing to distinguish "never baked" from "baked once" — so a second call
 * would bake `ancestors × (already-baked local)`, corrupting the placement rather than merely
 * repeating a no-op. A fresh `Group` wrapping a fresh clone sidesteps both: `root` is only ever
 * read (`traverse`, `updateWorldMatrix`, `matrixWorld` — nothing here writes through to a node
 * already in `root`), so it stays exactly as `useLoader` cached it, and every call — first,
 * second, hundredth — reads the same unmutated source and produces an equivalent wrapper.
 *
 * The clone shares (does not duplicate) geometry and material: three's own `Line`/`Points`
 * `.copy()` assigns `this.geometry = source.geometry` and `this.material = source.material`
 * (see three/src/objects/Line.js and Points.js), never a deep copy, and `.clone(false)` skips
 * recursing into children on top of that — there is nothing to gain cloning children a
 * Line/Points/Sprite never has, and every extra clone is one more object whoever renders this
 * output has to keep alive. What `.clone()` does NOT reset is the source's own local transform,
 * which `.copy()` copies verbatim — left alone, the clone would carry the drawable's original
 * root-relative local placement while sitting inside a wrapper that already supplies the full
 * baked world placement, doubling the transform one level down from where C1's `<Center
 * precise>` fix and buildBatches.ts's instance-matrix baking both had to solve the identical
 * problem. Zeroing it here is what makes the wrapper's transform the only one in effect.
 */
export function collectDrawables(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (!isDrawable(object)) return;

    // Only ever READS position/quaternion/scale/parent, via the cached `matrixWorld` three.js
    // already maintains that field for. `root` is never attached to a live scene graph (only
    // the batches/wrappers built from it are), so nothing else brings a stale `matrixWorld` up
    // to date — this is the same `updateWorldMatrix(true, false)` idiom buildBatches.ts uses
    // for its own instance matrices, and for the identical reason (see its header comment).
    object.updateWorldMatrix(true, false);

    const wrapper = new THREE.Group();
    object.matrixWorld.decompose(wrapper.position, wrapper.quaternion, wrapper.scale);

    const clone = object.clone(false);
    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    clone.scale.set(1, 1, 1);
    // Line/LineSegments/LineLoop/Points' own `copy()` (three/src/objects/Line.js, Points.js)
    // assigns `this.geometry = source.geometry` and `this.material = source.material`, so
    // `.clone()` already shares rather than duplicates for those. `Sprite.prototype.copy()`
    // (Sprite.js) does NOT touch `material` — only `center` — so `.clone(false)` on a Sprite
    // would silently carry the constructor's default `SpriteMaterial` instead of the source's
    // own. Reassigning both explicitly, for every recognized drawable type alike, makes "shares,
    // does not duplicate" hold regardless of which subclass's `copy()` gets it right on its own.
    // Cast through an intersection rather than the Line|Points|Sprite union itself: the union's
    // `material` type differs per member (`Material | Material[]` vs `SpriteMaterial`), which
    // TypeScript would otherwise require satisfying for every member at once.
    type HasGeometryAndMaterial = THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    (clone as HasGeometryAndMaterial).geometry = (object as HasGeometryAndMaterial).geometry;
    (clone as HasGeometryAndMaterial).material = (object as HasGeometryAndMaterial).material;
    wrapper.add(clone);

    out.push(wrapper);
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

/**
 * True if any node under `root` carries the import marker — i.e. `buildPartTree` will use its
 * MARKED path (`totalPartsUnder`) rather than the unmarked fallback (scene root's direct
 * children, one part each).
 *
 * Exported so a caller deciding whether to batch, show the Parts pill, or auto-colour can ask
 * this directly instead of re-deriving it from `buildPartTree`'s own output. `parts.length` is
 * NOT a substitute: the unmarked fallback below returns one PartNode per direct child of the
 * scene root, which is >=1 for essentially any file (legacy uploads, OBJ, DAE, 3DS all included)
 * — so gating on `parts.length` alone means those formats wrongly qualify as "this file has
 * parts" too. `hasMarkers` is the one true test of "did the file's own import pipeline actually
 * declare parts," independent of what shape `buildPartTree` falls back to when it didn't.
 */
export function hasMarkers(root: THREE.Object3D): boolean {
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
