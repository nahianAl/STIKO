import { Primitive, WebIO, type Document, type Material, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  convertPrimitiveToLines,
  convertPrimitiveToTriangles,
  dedup,
  flatten,
  join,
  joinPrimitives,
  prune,
  weld,
} from '@gltf-transform/functions';
import { PART_MARKER } from './partTree.ts';

/**
 * Collapses a fragmented glTF export into as few draw calls as its materials allow.
 *
 * CAD exporters — Rhino in particular — emit one node, one mesh and one primitive per
 * object *and* per material, merging nothing. The reference file that prompted this work
 * carried 7,995 primitives at a median of two triangles each. GPUs are indifferent to the
 * 228k triangles involved; they are not indifferent to 8,000 state changes per frame. That
 * file leaves here with 26 primitives and exactly the same triangles — but only when its
 * objects are unnamed, which takes it down the unsegmented path below. A named export of the
 * same shape takes the segmented path instead, where the merge only ever reaches across
 * primitives that already share a node's mesh; one-primitive-per-node Rhino geometry has
 * nothing to merge there, so it ships at its original primitive count — unreduced, but with
 * every part preserved instead of collapsed away.
 *
 * WebIO rather than NodeIO on purpose: this runs in a Web Worker, and readBinary /
 * writeBinary never touch the filesystem or the network, so the same code path is what the
 * tests exercise under Node.
 */

export interface OptimizeCounts {
  primitives: number;
  triangles: number;
  /**
   * Indices belonging to LINES / LINE_STRIP / LINE_LOOP primitives (mode 1/2/3). Counted
   * separately from triangles so the lossless guarantee can actually see line geometry —
   * see the note on measure() below.
   */
  lineIndices: number;
  /**
   * Nodes stamped as parts. Counted for the same reason lineIndices is: the lossless
   * guarantee has to be able to SEE everything it claims to preserve. join() used to erase
   * part identity while "triangles unchanged" stayed green.
   */
  parts: number;
  nodes: number;
  bytes: number;
}

export interface OptimizeStats {
  before: OptimizeCounts;
  after: OptimizeCounts;
}

export interface OptimizeResult {
  buffer: ArrayBuffer;
  stats: OptimizeStats;
}

/** glTF primitive mode 4 is TRIANGLES. Line and point primitives carry no triangles. */
const MODE_TRIANGLES = 4;

/**
 * The three line modes. An earlier version of measure() counted only MODE_TRIANGLES, so a
 * transform that mangled LINE_STRIP geometry into garbage indices (see the primitive-restart
 * comment below) still reported a "lossless" pass — the line data simply wasn't part of what
 * was being watched. Counting it here is what let that regression be caught by a test.
 */
const LINE_MODES = new Set([Primitive.Mode.LINES, Primitive.Mode.LINE_STRIP, Primitive.Mode.LINE_LOOP]);

/**
 * Sentinel standing in for "this primitive has no material" when grouping primitives by
 * material identity below. A primitive's material may legitimately be null, and null can't be
 * used as a distinguishing Map key on its own the way a real Material object can — every
 * materialless primitive would need to share this one key regardless, which is correct: they
 * really are all in the same "no material" group.
 */
const NO_MATERIAL = Symbol('no-material');

/**
 * Every node a scene actually reaches, depth-first. `doc.getRoot().listNodes()` includes
 * orphans — nodes no scene references at all — and an orphan stamped and counted into
 * `before.parts` would inflate the part count for geometry nobody will ever render, only to
 * have prune() remove it later. Scoping both the stamping walk and measure()'s counting to
 * this list keeps that from ever happening.
 */
function sceneReachableNodes(doc: Document): Node[] {
  const seen = new Set<Node>();
  const visit = (node: Node): void => {
    if (seen.has(node)) return;
    seen.add(node);
    node.listChildren().forEach(visit);
  };
  doc.getRoot().listScenes().forEach((scene) => scene.listChildren().forEach(visit));
  return Array.from(seen);
}

/**
 * Counted per NODE REFERENCE, not per mesh. dedup() (segmented mode's first step) merges
 * byte-identical meshes, so N identically-shaped parts at different transforms — repeated
 * fasteners, the most ordinary CAD shape there is — end up as N nodes sharing one Mesh
 * object. Walking `listMeshes()` would then count that shared mesh's triangles once instead
 * of once per node that actually places it in the scene, reporting a triangle loss that
 * never happened. All four bolts still render — every node that references the mesh draws it
 * — so the count has to reflect that: a mesh referenced by four nodes contributes its
 * primitives, triangles and line indices four times over.
 */
function measure(doc: Document, bytes: number): OptimizeCounts {
  let primitives = 0;
  let triangles = 0;
  let lineIndices = 0;

  const reachable = sceneReachableNodes(doc);

  reachable.forEach((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    mesh.listPrimitives().forEach((prim) => {
      primitives++;
      const mode = prim.getMode();
      const indices = prim.getIndices();
      const count = indices ? indices.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0);

      if (mode === MODE_TRIANGLES) {
        triangles += count / 3;
      } else if (LINE_MODES.has(mode)) {
        lineIndices += count;
      }
    });
  });

  // Scoped to scene-reachable nodes too, for the same reason the stamping walk is: an orphan
  // that arrived in the input already carrying a stale marker (or one the stamping walk never
  // touches, since it only ever adds markers, never clears one that's already there) must not
  // inflate a count that's supposed to be fully under our control.
  const parts = reachable.filter((node) => node.getExtras()[PART_MARKER] === true).length;

  return {
    primitives,
    triangles: Math.round(triangles),
    lineIndices,
    parts,
    nodes: doc.getRoot().listNodes().length,
    bytes,
  };
}

export async function optimizeGlb(input: ArrayBuffer): Promise<OptimizeResult> {
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(new Uint8Array(input));

  // join() merges primitives that share a material using primitive-restart sentinels
  // whenever any of them use a restart-capable mode (LINE_STRIP, LINE_LOOP, TRIANGLE_STRIP,
  // TRIANGLE_FAN), and then marks KHR_mesh_primitive_restart as REQUIRED on the document.
  // three.js r169 does not implement that extension — it only console.warns — so every
  // sentinel index (0xFFFF / 0xFFFFFFFF) is read back as an ordinary vertex index, which is
  // out of range and resolves to (0,0,0). The reference file carries 551 LINE_STRIP
  // primitives (CAD construction/dimension lines); left alone, that turns into hundreds of
  // stray line segments radiating to the model origin in the "optimized" output — silent,
  // because those primitives don't carry triangles and the lossless check below didn't used
  // to look at anything else.
  //
  // Converting to plain LINES / TRIANGLES up front costs nothing (same vertices, no data
  // loss) and keeps every downstream primitive in a mode join() can merge without resorting
  // to restart sentinels at all. This must run before `before` is measured: measure() counts
  // line indices, and LINE_STRIP / LINES report different index counts for the same
  // geometry, so measuring before-and-after normalisation would make the "preserved exactly"
  // assertion compare two different encodings of the same lines instead of the same encoding
  // twice.
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mode = prim.getMode();
      if (mode === Primitive.Mode.LINE_STRIP || mode === Primitive.Mode.LINE_LOOP) {
        convertPrimitiveToLines(prim);
      } else if (mode === Primitive.Mode.TRIANGLE_STRIP || mode === Primitive.Mode.TRIANGLE_FAN) {
        convertPrimitiveToTriangles(prim);
      }
    }
  }

  // Stamp parts before anything measures or merges. Only NAMED nodes are stamped — an
  // unnamed node is not a part, which is the discriminator the whole two-mode design below
  // rests on, and stamping unnamed fragments would put a 7,995-row list in the panel for a
  // file that never told us what its objects are.
  //
  // Same-named siblings are ONE object, not several. Rhino emits one node per object AND per
  // material, so a rim with a steel body and a chrome lip arrives as two sibling nodes both
  // named "Rim". Stamping each would put the same physical part on two panel rows and let
  // someone colour half a rim. Grouping them under one stamped wrapper recovers the object
  // the modeller made. The wrapper carries an identity transform, so its children keep the
  // world placement their own transforms give them — which is why the group is NOT
  // reparented under its first member, whose transform would then compose onto its siblings.
  //
  // This is the ONLY "does this node carry geometry" helper in the file. It used to have a
  // byte-identical twin (`carriesGeometry`) backing the old namesAnything discriminator —
  // two copies whose *agreement* was the load-bearing invariant of the two-mode design, which
  // made that agreement incidental rather than structural. The discriminator is now
  // `before.parts < 2` (parts are counted directly, post-stamping), so there is exactly one
  // definition of "carries geometry" left, and nothing can drift out of sync with it.
  const carriesGeometry = (node: Node): boolean =>
    node.getMesh() !== null || node.listChildren().some(carriesGeometry);

  /**
   * Parents whose children may need grouping: every scene, and every node. `ownerNode` is
   * `null` for a scene and the Node itself otherwise — the grouping loop below needs it to
   * recognise a parent that's already an established part (see the re-optimization guard).
   */
  const parents: { ownerNode: Node | null; list: () => Node[]; add: (n: Node) => void; remove: (n: Node) => void }[] = [
    ...doc.getRoot().listScenes().map((scene) => ({
      ownerNode: null,
      list: () => scene.listChildren(),
      add: (n: Node) => { scene.addChild(n); },
      remove: (n: Node) => { scene.removeChild(n); },
    })),
    ...doc.getRoot().listNodes().map((node) => ({
      ownerNode: node,
      list: () => node.listChildren(),
      add: (n: Node) => { node.addChild(n); },
      remove: (n: Node) => { node.removeChild(n); },
    })),
  ];

  // Children folded into a same-name wrapper below. They keep their original name (that's
  // how the wrapper got its own), so without tracking this the final stamping loop would
  // mark them too — reproducing, one level down, exactly the "same physical part on two
  // panel rows" duplication the wrapper exists to prevent: the panel would show a "Rim" row
  // whose own children are two more rows both also called "Rim".
  const absorbedIntoWrapper = new Set<Node>();

  for (const parent of parents) {
    const byName = new Map<string, Node[]>();
    for (const child of parent.list()) {
      const name = child.getName();
      // Unnamed nodes are not evidence of anything — grouping every unnamed sibling together
      // would fuse unrelated geometry into one row.
      if (!name || !carriesGeometry(child)) continue;
      const group = byName.get(name);
      if (group) group.push(child);
      else byName.set(name, [child]);
    }

    // .forEach() rather than for...of: this project's tsconfig sets no `target`, which
    // defaults below ES2015, and iterating a Map directly needs --downlevelIteration or an
    // ES2015+ target. Array.prototype.forEach needs neither.
    byName.forEach((group, name) => {
      if (group.length < 2) return;

      // Re-optimizing an already-optimized file: `parents` is drawn from listNodes(), which
      // on this second pass includes the wrapper the FIRST pass already built — and that
      // wrapper's own children are still both named "Rim". Without this guard, grouping would
      // wrap them again, nesting one level deeper and adding one spurious part every single
      // pass. A parent that already carries this same name, or already carries PART_MARKER,
      // is either that pre-existing wrapper or on its way to becoming one via the stamping
      // loop below — either way these children are already spoken for by their parent, so
      // treat them the same as this pass's own absorbed children rather than grouping again.
      if (parent.ownerNode && (parent.ownerNode.getName() === name || parent.ownerNode.getExtras()[PART_MARKER] === true)) {
        group.forEach((child) => absorbedIntoWrapper.add(child));
        return;
      }

      const wrapper = doc.createNode(name);
      for (const child of group) {
        parent.remove(child);
        wrapper.addChild(child);
        absorbedIntoWrapper.add(child);
      }
      parent.add(wrapper);
    });
  }

  // Named only, and not a child a wrapper above already speaks for, and only among nodes a
  // scene actually reaches — an orphan must never be stamped. `parents` above is drawn from
  // every scene AND every node in listNodes(), which includes orphans no scene references at
  // all, so a parent is not always a scene or a node already in the tree — it may itself be an
  // orphan. A wrapper built under a scene-reachable parent is scene-reachable in turn and gets
  // stamped below; a wrapper built under an orphan parent stays part of that orphan subtree and
  // is correctly skipped here, the same as any other orphan.
  sceneReachableNodes(doc).forEach((node) => {
    if (node.getName() !== '' && carriesGeometry(node) && !absorbedIntoWrapper.has(node)) {
      node.setExtras({ ...node.getExtras(), [PART_MARKER]: true });
    }
  });

  const before = measure(doc, input.byteLength);

  // The discriminator: branch on the part count just measured, not on names. Stamping above
  // already ran, so `before.parts` is exact. Fewer than two parts means there is nothing to
  // differentiate and nothing to protect, so the aggressive unsegmented path applies. This
  // replaced an earlier "does any named node carry geometry" check, which misfired on a very
  // common export shape: a single named non-geometry ancestor (RootNode, Scene, a wrapper
  // carrying the filename — exporters emit these constantly) recurses through
  // carriesGeometry's child walk and flips the whole file to the segmented path even though
  // it stamps to exactly one part, since the merge is intra-mesh and every leaf node still has
  // its own unmerged mesh. Branching on the actual part count sidesteps that entirely: one
  // named RootNode over anonymous fragments stamps to one part and correctly takes the
  // unsegmented path below.
  if (before.parts < 2) {
    // UNSEGMENTED MODE — byte-for-byte the pipeline that shipped before this feature. A file
    // that names nothing (or names only a single ancestor with no sibling parts) gets exactly
    // the optimization it always got, the viewer reports no parts, and the panel says so. This
    // is also the path the 7,995-primitive Rhino reference file takes when its objects are
    // unnamed, so its 26-draw-call result is preserved.
    //
    // Clear every PART_MARKER first. join() below merges each same-material group into the
    // group's FIRST node and keeps THAT node's extras — so if the lone stamped node from above
    // happens to land as a merge destination, its marker survives into a file this branch has
    // already decided (via before.parts < 2) has no parts to protect, and the surviving node
    // now also silently contains the geometry of everything merged into it. There is nothing
    // downstream of this mode that can still need the marker, since the whole point of taking
    // this branch is that there is nothing to differentiate.
    doc.getRoot().listNodes().forEach((node) => {
      const extras = node.getExtras();
      if (extras[PART_MARKER] === undefined) return;
      const rest: Record<string, unknown> = {};
      Object.keys(extras).forEach((key) => {
        if (key !== PART_MARKER) rest[key] = extras[key];
      });
      node.setExtras(rest);
    });

    // Order is load-bearing: weld() must precede join(), or join() leaves a
    // KHR_mesh_primitive_restart state that weld() refuses outright.
    await doc.transform(
      dedup(),
      flatten(),
      dedup(),
      weld(),
      join({ keepNamed: false }),
      prune({ keepLeaves: false })
    );
  } else {
    // SEGMENTED MODE — the file named its objects, so those names are the parts.
    await doc.transform(
      dedup(),                      // merge identical accessors / materials / textures
      weld(),                       // index and merge co-located vertices
      prune({ keepLeaves: true })   // keepLeaves so an emptied part node is not pruned away
    );

    // Merge the primitives a single mesh already holds, grouped by material and mode. This
    // is where a part carrying several primitives collapses; it deliberately never reaches
    // across nodes, because that is exactly what would fuse one part into another.
    for (const mesh of doc.getRoot().listMeshes()) {
      // Keyed on material IDENTITY, not material NAME: unnamed materials are common — every
      // unnamed material would otherwise collapse to the same `''` name key, group primitives
      // that don't actually share a material, and get rejected wholesale by joinPrimitives'
      // identity check (see the per-group try/catch below), silently losing the merge for the
      // whole mesh. A Map keyed on the Material object itself (the NO_MATERIAL sentinel
      // standing in for primitives with no material at all) groups by identity for free; mode
      // is nested one level in because joinPrimitives cannot concatenate LINES into TRIANGLES,
      // and CAD exports carry both. Normalisation above already reduced these to
      // LINES / TRIANGLES.
      const groups = new Map<Material | typeof NO_MATERIAL, Map<number, Primitive[]>>();
      for (const prim of mesh.listPrimitives()) {
        const material = prim.getMaterial() ?? NO_MATERIAL;
        const mode = prim.getMode();
        let byMode = groups.get(material);
        if (!byMode) {
          byMode = new Map<number, Primitive[]>();
          groups.set(material, byMode);
        }
        const group = byMode.get(mode);
        if (group) group.push(prim);
        else byMode.set(mode, [prim]);
      }

      // .forEach() rather than for...of: this project's tsconfig sets no `target`, which
      // defaults below ES2015, and iterating a Map's .values() directly needs
      // --downlevelIteration or an ES2015+ target. Array.prototype.forEach needs neither.
      groups.forEach((byMode) => {
        byMode.forEach((group) => {
          if (group.length < 2) return;
          // joinPrimitives throws when primitives are not compatible, and grouping by material
          // does not guarantee they are — one CAD primitive may carry UVs where its neighbour
          // does not. An uncaught throw would abandon the WHOLE optimization (runOptimize reads
          // any throw as "upload the original"), trading every other part's merge for one
          // awkward group. Skip the group instead: those primitives stay unmerged, which is
          // slower to load and completely correct.
          let merged;
          try {
            merged = joinPrimitives(group);
          } catch {
            return;
          }
          // dispose() detaches each primitive from its mesh, which is the documented idiom.
          for (const prim of group) prim.dispose();
          mesh.addPrimitive(merged);
        });
      });
    }

    await doc.transform(prune({ keepLeaves: true }));
  }

  // Belt-and-braces, in case some future primitive shape still tempts join() into a restart
  // merge despite the normalisation above: refuse to hand back a document that requires an
  // extension three.js cannot read, rather than silently store one the viewer would render
  // wrong. optimizeGlb is only ever called from runOptimize, which treats any throw as
  // "upload the original" — so this can only make a file fall back to unoptimized, never
  // corrupt what gets stored.
  const requiredExtensions = doc.getRoot().listExtensionsRequired();
  if (requiredExtensions.length > 0) {
    throw new Error(
      `optimizeGlb produced a document requiring extensions the viewer cannot read: ${requiredExtensions
        .map((ext) => ext.extensionName)
        .join(', ')}`
    );
  }

  const output = await io.writeBinary(doc);
  // writeBinary hands back a Uint8Array that may be a view into a larger buffer; slice to
  // an exact, transferable ArrayBuffer so postMessage can hand it over without copying.
  const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;

  return { buffer, stats: { before, after: measure(doc, buffer.byteLength) } };
}
