import * as THREE from 'three';

// Singleton WASM instance — initialized once, reused
let occtPromise: Promise<OcctImportJs> | null = null;

interface OcctMeshAttributes {
  position: { array: number[] };
  normal: { array: number[] };
}

interface OcctMesh {
  index: { array: number[] };
  attributes: OcctMeshAttributes;
  color?: [number, number, number];
}

interface OcctResult {
  success: boolean;
  meshes: OcctMesh[];
}

interface OcctImportJs {
  ReadStepFile: (buffer: Uint8Array, params: null) => OcctResult;
}

function initOcct(): Promise<OcctImportJs> {
  if (!occtPromise) {
    occtPromise = import('occt-import-js').then((mod) => mod.default());
  }
  return occtPromise;
}

export class STEPLoader extends THREE.Loader {
  load(
    url: string,
    onLoad: (group: THREE.Group) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (event: unknown) => void,
  ): void {
    this.loadAsync(url, onProgress)
      .then(onLoad)
      .catch(onError);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<THREE.Group> {
    // Fetch the STEP file
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`STEPLoader: Failed to fetch ${url} (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // Initialize WASM and tessellate
    const occt = await initOcct();
    const result = occt.ReadStepFile(buffer, null);

    if (!result.success) {
      throw new Error('STEPLoader: Failed to parse STEP file');
    }

    // Convert to Three.js objects
    const group = new THREE.Group();

    for (const mesh of result.meshes) {
      const geometry = new THREE.BufferGeometry();

      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3),
      );
      geometry.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3),
      );

      if (mesh.index && mesh.index.array.length > 0) {
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.index.array), 1));
      }

      const materialColor = mesh.color
        ? new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2])
        : new THREE.Color('#8899aa');

      const material = new THREE.MeshStandardMaterial({
        color: materialColor,
        roughness: 0.6,
        metalness: 0.3,
      });

      group.add(new THREE.Mesh(geometry, material));
    }

    return group;
  }
}
