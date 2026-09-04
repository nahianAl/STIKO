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
    standard.map?.uuid ?? '',
    standard.normalMap?.uuid ?? '',
    standard.emissive?.getHexString() ?? '',
  ].join('|');
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
  entries: { partKey: string; mesh: THREE.Mesh; geometry: THREE.BufferGeometry }[];
  vertices: number;
  indices: number;
}

export function buildBatches(parts: PartNode[]): PartBatches | null {
  const groups = new Map<string, Pending>();

  flattenParts(parts).forEach((part) => {
    part.meshes.forEach((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const material = materials[0];
      if (!material || !mesh.geometry?.getAttribute('position')) return;

      const key = appearanceKey(material);
      const pending = groups.get(key) ?? { material, entries: [], vertices: 0, indices: 0 };
      const geometry = normalized(mesh.geometry, Boolean((material as THREE.MeshStandardMaterial).map));
      const index = geometry.getIndex();

      pending.entries.push({ partKey: part.key, mesh, geometry });
      pending.vertices += geometry.getAttribute('position').count;
      pending.indices += index ? index.count : 0;
      groups.set(key, pending);
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
      // part keeps whatever transform its node carried.
      entry.mesh.updateMatrixWorld(true);
      batched.setMatrixAt(instanceId, entry.mesh.matrixWorld);

      const source = (Array.isArray(entry.mesh.material) ? entry.mesh.material[0] : entry.mesh.material) as
        THREE.MeshStandardMaterial;
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
