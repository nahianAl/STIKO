// Generates the two Rhino fixtures in scripts/tests/fixtures/models/.
//
// rhino3dm is NOT a dependency of this repo, and three's bundled copy does not load under
// node. Install it somewhere throwaway and point this script at it:
//
//   mkdir -p /tmp/rhino-gen && (cd /tmp/rhino-gen && npm init -y >/dev/null && npm i rhino3dm@8.35.0)
//   node scripts/fixtures/make-3dm-fixtures.mjs /tmp/rhino-gen scripts/tests/fixtures/models
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [rhinoHome, outDir] = process.argv.slice(2);
if (!rhinoHome || !outDir) {
  console.error('usage: node make-3dm-fixtures.mjs <dir with node_modules/rhino3dm> <outDir>');
  process.exit(1);
}
const rhino = await createRequire(path.join(rhinoHome, 'noop.js'))('rhino3dm')();

// A 10 mm box stored as a Mesh object: always displayable, like any Rhino mesh.
{
  const doc = new rhino.File3dm();
  const mesh = new rhino.Mesh();
  const v = [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
  for (const [x, y, z] of v) mesh.vertices().add(x, y, z);
  for (const [a, b, c, d] of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]) {
    mesh.faces().addQuadFace(a, b, c, d);
  }
  mesh.normals().computeNormals();
  const attrs = new rhino.ObjectAttributes();
  attrs.name = 'fixture box';
  doc.objects().add(mesh, attrs);
  fs.writeFileSync(path.join(outDir, 'box-mesh.3dm'), doc.toByteArray());
}

// A sphere Brep with NO render mesh: what a "Save Small" Rhino file looks like to rhino3dm.
{
  const doc = new rhino.File3dm();
  doc.objects().add(new rhino.Sphere([0, 0, 0], 5).toBrep(), null);
  fs.writeFileSync(path.join(outDir, 'sphere-no-render-mesh.3dm'), doc.toByteArray());
}
