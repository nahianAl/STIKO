declare module 'occt-import-js' {
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

  export default function (): Promise<OcctImportJs>;
}
