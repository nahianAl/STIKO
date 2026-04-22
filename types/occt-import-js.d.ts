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

  interface OcctModuleOptions {
    locateFile?: (path: string, scriptDirectory: string) => string;
  }

  export default function (options?: OcctModuleOptions): Promise<OcctImportJs>;
}
