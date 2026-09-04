import * as THREE from 'three';
import { flattenParts, type PartNode } from './partTree.ts';

/**
 * Renders a part tree as as few draw calls as its materials allow, with per-part colour.
 *
 * THREE.BatchedMesh is doing the work this module exists to set up: many geometries in one
 * buffer, one multi-draw, and — the reason it was chosen over separate meshes or a custom
 * vertex-colour scheme — per-instance colour (setColorAt), per-instance visibility
 * (setVisibleAt) and per-instance picking (intersect.batchId) all native.
 *
 * The batch material is WHITE with vertexColors on, and each part's original colour is baked
 * in through setColorAt. The shader multiplies the batch colour into vColor
 * (color_vertex.glsl, USE_BATCHING_COLOR), so a white base makes setColorAt the entire colour
 * rather than a tint over one. That is also what lets materials differing only in colour
 * share a batch — which, in CAD exports, is nearly all of them.
 *
 * Never call BatchedMesh.optimize(): it can make instance ids stop matching indices
 * (BatchedMesh.js:780), and every id here is a durable handle held in `instances`.
 */

export interface PartInstance {
  mesh: THREE.BatchedMesh;
  instanceId: number;
  /** What the model itself said this part's colour was, for restoring after an override. */
  baseColor: THREE.Color;
}

export interface PartBatches {
  meshes: THREE.BatchedMesh[];
  instances: Map<string, PartInstance[]>;
  dispose(): void;
}

/**
 * Every map property that samples UVs and is also an appearanceKey discriminator. Single
 * source of truth for both: `materialUsesUv` decides whether a batch's geometry needs a uv
 * attribute at all, and appearanceKey folds the same properties into its key. Listing them
 * once means the two can never drift the way `needsUv` and appearanceKey used to.
 */
const UV_MAP_KEYS = ['map', 'normalMap'] as const;

/**
 * Everything about a material EXCEPT its base colour. Two materials agreeing here share a
 * batch; anything else — a map, a different roughness, a different side — gets its own.
 */
function appearanceKey(material: THREE.Material): string {
  const standard = material as THREE.MeshStandardMaterial;
  return [
    material.type,
    standard.roughness ?? '',
    standard.metalness ?? '',
    material.side,
    material.transparent ? standard.opacity : 1,
    ...UV_MAP_KEYS.map((mapKey) => standard[mapKey]?.uuid ?? ''),
    standard.emissive?.getHexString() ?? '',
  ].join('|');
}

/** Whether a batch built from this material's appearance needs a uv attribute at all. */
function materialUsesUv(material: THREE.Material): boolean {
  const standard = material as THREE.MeshStandardMaterial;
  return UV_MAP_KEYS.some((mapKey) => Boolean(standard[mapKey]));
}

/** The material a batch is drawn with: the source's properties, colour removed. */
function batchMaterialFrom(source: THREE.Material): THREE.MeshStandardMaterial {
  const material = (source as THREE.MeshStandardMaterial).clone();
  material.color = new THREE.Color(0xffffff);
  material.vertexColors = true;
  return material;
}

/**
 * BatchedMesh requires every geometry it holds to share one attribute layout, and CAD
 * geometry arrives inconsistent — some primitives carry UVs, some do not. Reduce each to
 * position + normal + index, which is all an untextured CAD surface needs, and add uv only
 * where the batch's material actually samples one.
 */
function normalized(source: THREE.BufferGeometry, needsUv: boolean): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const position = source.getAttribute('position');
  geometry.setAttribute('position', position);
  geometry.setAttribute(
    'normal',
    source.getAttribute('normal') ?? new THREE.BufferAttribute(new Float32Array(position.count * 3), 3)
  );
  if (needsUv) {
    geometry.setAttribute(
      'uv',
      source.getAttribute('uv') ?? new THREE.BufferAttribute(new Float32Array(position.count * 2), 2)
    );
  }
  geometry.setIndex(
    source.getIndex() ??
      new THREE.BufferAttribute(new Uint32Array(Array.from({ length: position.count }, (_, i) => i)), 1)
  );
  return geometry;
}

interface Pending {
  material: THREE.Material;
  entries: { partKey: string; mesh: THREE.Mesh; geometry: THREE.BufferGeometry; material: THREE.Material }[];
  vertices: number;
  indices: number;
}

interface MaterialGroup {
  material: THREE.Material;
  /** The mesh's own geometry, or — when split — a view over just this group's index range. */
  geometry: THREE.BufferGeometry;
}

/**
 * Splits a mesh into one (material, geometry) pair per material actually used.
 *
 * The common case is a single material, which needs no splitting. An array material paired
 * with `geometry.groups` — TDSLoader is the reachable example, building `mesh.material`
 * arrays alongside `geometry.addGroup(...)` calls — means the mesh is genuinely drawn with
 * more than one material, each over its own index range. Collapsing that onto
 * `materials[0]` (the old behaviour) silently renders the whole part in one sub-material's
 * appearance and colour. Splitting instead gives each group its own entry, which lands in
 * its own appearance batch with its own baked colour, while all of them still map to the
 * same part key.
 *
 * The split geometry keeps the mesh's full attribute buffers (position/normal/uv) and only
 * narrows the index to the group's [start, start + count) range — "this group's index range
 * as its own geometry" — so no vertex remapping is needed; `normalized()` still trims
 * attributes to what the batch needs.
 *
 * Degenerate inputs are handled without throwing, since this runs on arbitrary uploaded
 * files: an array material with no groups (or a non-indexed geometry, which group ranges
 * can't address here) falls back to materials[0] over the whole geometry, matching the
 * single-material path. A group whose materialIndex has no entry in the material array
 * — reachable via TDSLoader, which advances materialIndex even for a face-array subchunk
 * whose named material never resolved — falls back to materials[0] too, rather than
 * dropping the group. Only when neither the indexed nor the fallback material exists does a
 * group get skipped.
 */
function meshMaterialGroups(geometry: THREE.BufferGeometry, materials: THREE.Material[]): MaterialGroup[] {
  const matGroups = geometry.groups;
  const index = geometry.getIndex();

  // No render groups (the overwhelming common case: BufferGeometry.groups defaults to `[]`
  // and single-material meshes never call addGroup) or no index to slice group ranges out
  // of — either way there is nothing to split against, so the whole geometry is one entry.
  // Deliberately not gated on materials.length: a mesh can carry groups with only one
  // resolved material (TDSLoader's readFaceArray skips pushing a material it couldn't find
  // by name while still incrementing materialIndex), and that must still honour the groups.
  if (!matGroups || matGroups.length === 0 || !index) {
    const material = materials[0];
    return material ? [{ material, geometry }] : [];
  }

  const out: MaterialGroup[] = [];
  matGroups.forEach((group) => {
    // addGroup defaults materialIndex to 0 (BufferGeometry.js:104); the type only marks it
    // optional because the parameter itself is, not because a stored group ever omits it.
    const materialIndex = group.materialIndex ?? 0;
    const material = materials[materialIndex] ?? materials[0];
    if (!material) return;

    const sub = new THREE.BufferGeometry();
    Object.keys(geometry.attributes).forEach((name) => {
      sub.setAttribute(name, geometry.getAttribute(name));
    });
    // TypedArray#slice returns a same-typed copy, so the group's own index range becomes its
    // own attribute without touching the shared position/normal/uv buffers above.
    sub.setIndex(new THREE.BufferAttribute(index.array.slice(group.start, group.start + group.count), 1));
    out.push({ material, geometry: sub });
  });
  return out;
}

export function buildBatches(parts: PartNode[]): PartBatches | null {
  const groups = new Map<string, Pending>();

  flattenParts(parts).forEach((part) => {
    part.meshes.forEach((mesh) => {
      // A mesh the model itself ships hidden — helper geometry, LOD stand-ins, construction
      // aids — should stay hidden. Without this check every batched model showed such meshes
      // regardless of what the source authored, since nothing else downstream reads `.visible`.
      if (!mesh.visible) return;
      if (!mesh.geometry?.getAttribute('position')) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      meshMaterialGroups(mesh.geometry, materials).forEach(({ material, geometry: rawGeometry }) => {
        const key = appearanceKey(material);
        const pending = groups.get(key) ?? { material, entries: [], vertices: 0, indices: 0 };
        const geometry = normalized(rawGeometry, materialUsesUv(material));
        const index = geometry.getIndex();

        pending.entries.push({ partKey: part.key, mesh, geometry, material });
        pending.vertices += geometry.getAttribute('position').count;
        pending.indices += index ? index.count : 0;
        groups.set(key, pending);
      });
    });
  });

  if (groups.size === 0) return null;

  const meshes: THREE.BatchedMesh[] = [];
  const instances = new Map<string, PartInstance[]>();

  groups.forEach((pending) => {
    const batched = new THREE.BatchedMesh(
      pending.entries.length,
      pending.vertices,
      pending.indices,
      batchMaterialFrom(pending.material)
    );
    // Frustum culling is per instance inside BatchedMesh; culling the batch as a whole would
    // drop the entire model the moment its bounds left the frustum.
    batched.frustumCulled = false;

    pending.entries.forEach((entry) => {
      const geometryId = batched.addGeometry(entry.geometry);
      const instanceId = batched.addInstance(geometryId);
      // Geometry stays in its own local space; placement rides on the instance matrix, so a
      // part keeps whatever transform its node carried. updateMatrixWorld(true) only forces a
      // recompute downward into children — per Object3D.js it multiplies THIS node's local
      // matrix by parent.matrixWorld exactly as last computed, never revisiting the parent —
      // so on a tree that has never had a top-down pass (true here: only the batched
      // replacement is ever displayed) an ancestor's stale/identity matrix silently corrupts
      // this placement. updateWorldMatrix(true, false) walks up to the root first; matches the
      // idiom ModelViewerInner.tsx already uses for the same reason.
      entry.mesh.updateWorldMatrix(true, false);
      batched.setMatrixAt(instanceId, entry.mesh.matrixWorld);

      const source = entry.material as THREE.MeshStandardMaterial;
      const baseColor = source.color ? source.color.clone() : new THREE.Color(0xffffff);
      batched.setColorAt(instanceId, baseColor);

      const list = instances.get(entry.partKey) ?? [];
      list.push({ mesh: batched, instanceId, baseColor });
      instances.set(entry.partKey, list);
    });

    meshes.push(batched);
  });

  return {
    meshes,
    instances,
    dispose() {
      meshes.forEach((mesh) => {
        mesh.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    },
  };
}

/** `null` restores whatever the model itself said the part's colour was. */
export function applyPartColor(batches: PartBatches, key: string, color: THREE.Color | null): void {
  (batches.instances.get(key) ?? []).forEach((instance) => {
    instance.mesh.setColorAt(instance.instanceId, color ?? instance.baseColor);
  });
}

export function applyPartVisibility(batches: PartBatches, key: string, visible: boolean): void {
  (batches.instances.get(key) ?? []).forEach((instance) => {
    instance.mesh.setVisibleAt(instance.instanceId, visible);
  });
}

/**
 * Which part a raycast hit. `batchId` comes off the intersection BatchedMesh produces
 * (BatchedMesh.js:947); this is the reverse of the index built above.
 *
 * Linear over instances rather than a second map: it runs once per click, never per frame,
 * and a second map would be one more thing to keep in step with the first.
 */
export function partKeyAt(batches: PartBatches, mesh: THREE.Object3D, batchId: number): string | null {
  let found: string | null = null;
  batches.instances.forEach((list, key) => {
    if (found !== null) return;
    if (list.some((instance) => instance.mesh === mesh && instance.instanceId === batchId)) found = key;
  });
  return found;
}
