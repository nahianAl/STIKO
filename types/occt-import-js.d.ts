declare module 'occt-import-js' {
  /**
   * Triangulation parameters. Previously typed as `null` only, which made the settings the
   * viewer needs literally unrepresentable — that is how OCCT's 0.001 default ended up
   * shipping. See docs/superpowers/specs/2026-09-02-step-viewing-design.md.
   */
  export interface OcctImportParams {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
    linearDeflection?: number;
    angularDeflection?: number;
  }

  interface OcctMeshAttributes {
    position: { array: number[] };
    normal: { array: number[] };
  }

  interface OcctMesh {
    name?: string;
    index: { array: number[] };
    attributes: OcctMeshAttributes;
    color?: [number, number, number];
  }

  /**
   * The assembly hierarchy OCCT reads out of the STEP product structure. Previously not
   * declared at all, which is why stepToGlb flattened every model to a list of sibling
   * solids and threw the tree away — the data was always there.
   */
  interface OcctNode {
    name?: string;
    /** Indices into OcctResult.meshes owned by this node directly. */
    meshes?: number[];
    children?: OcctNode[];
  }

  interface OcctResult {
    success: boolean;
    /** Absent on older builds and on files whose product structure is empty. */
    root?: OcctNode;
    meshes: OcctMesh[];
  }

  interface OcctImportJs {
    ReadStepFile: (buffer: Uint8Array, params: OcctImportParams | null) => OcctResult;
  }

  interface OcctModuleOptions {
    locateFile?: (path: string, scriptDirectory: string) => string;
  }

  export default function (options?: OcctModuleOptions): Promise<OcctImportJs>;
}
