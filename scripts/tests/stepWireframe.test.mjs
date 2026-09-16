import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { WebIO, Primitive } from '@gltf-transform/core';
import { stepToGlb } from '../../lib/model/stepToGlb.ts';
import { extractWireframe, lengthUnitInMillimetres, parseStepEntities } from '../../lib/model/stepWireframe.ts';

const locateFile = (p) => path.join(process.cwd(), 'node_modules/occt-import-js/dist/', p);

/**
 * Enough product structure that OCCT will actually read the file.
 *
 * This is load-bearing, not ceremony. Given only a representation and its geometry, OCCT
 * rejects the file outright (`success: false`) and stepToGlb's wireframe fallback would be
 * exercised on its could-not-read path instead of the one that matters. With the structure
 * below, ReadStepFile returns `success: true` with `meshes: []` and a root of
 * `{name:"", children:[{name:"Document", meshes:[], children:[]}]}` — character for
 * character what the 4.4 MB Rhino file in the bug report returns. These fixtures therefore
 * reproduce the reported failure rather than merely resembling it.
 *
 * Units are millimetres, matching OCCT's own default output unit.
 */
const PREAMBLE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('wire.stp','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));
ENDSEC;
DATA;
#1=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
#2=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));
#3=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());
#4=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.001),#1,'','');
#5=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#4))
GLOBAL_UNIT_ASSIGNED_CONTEXT((#1,#2,#3))REPRESENTATION_CONTEXT('ID1','3D'));
#6=APPLICATION_CONTEXT('configuration controlled 3d designs');
#7=APPLICATION_PROTOCOL_DEFINITION('international standard','config_control_design',1994,#6);
#8=PRODUCT_CONTEXT('',#6,'mechanical');
#9=PRODUCT('Document','Document','',(#8));
#10=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#9,.NOT_KNOWN.);
#11=PRODUCT_DEFINITION_CONTEXT('part definition',#6,'design');
#12=PRODUCT_DEFINITION('','',#10,#11);
#13=PRODUCT_DEFINITION_SHAPE('','',#12);
`;

const EPILOGUE = `ENDSEC;
END-ISO-10303-21;
`;

/** Wraps curve instances in the representation chain extractWireframe walks. */
function wireframeStep(body, curveRefs) {
  return (
    PREAMBLE +
    body +
    `#900=GEOMETRIC_CURVE_SET('curve_set_0',(${curveRefs.join(',')}));\n` +
    `#901=GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION('wireframe_rep_0',(#900),#5);\n` +
    `#902=SHAPE_DEFINITION_REPRESENTATION(#13,#901);\n` +
    EPILOGUE
  );
}

/** A single open polyline through three points — the least wireframe a STEP file can carry. */
const POLYLINE_STEP = wireframeStep(
  `#200=CARTESIAN_POINT('',(0.,0.,0.));
#201=CARTESIAN_POINT('',(10.,0.,0.));
#202=CARTESIAN_POINT('',(10.,10.,0.));
#203=POLYLINE('',(#200,#201,#202));
`,
  ['#203']
);

function bytes(text) {
  return new Uint8Array(Buffer.from(text, 'latin1'));
}

/** A polyline's points as [x,y,z] triples, so assertions can read as geometry. */
function tripletsOf(polyline) {
  const out = [];
  for (let i = 0; i < polyline.points.length; i += 3) {
    out.push([polyline.points[i], polyline.points[i + 1], polyline.points[i + 2]]);
  }
  return out;
}

function assertClose(actual, expected, message, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${message}: expected ${expected}, got ${actual}`);
}

// --- The reported bug, end to end -------------------------------------------------------

test('OCCT reads the fixture and finds no geometry in it', async () => {
  // Guards the fixtures themselves. If a future edit breaks the product structure, OCCT
  // starts returning success:false and every test below would still pass — via the
  // could-not-read branch — while no longer covering the case this module exists for.
  const occt = await (await import('occt-import-js')).default({ locateFile });
  const result = occt.ReadStepFile(bytes(POLYLINE_STEP), null);

  assert.equal(result.success, true, 'the fixture must be a file OCCT accepts');
  assert.equal(result.meshes.length, 0, 'and one it finds no solid geometry in');
});

test('a wireframe-only STEP converts to a GLB of line primitives', async () => {
  const glb = await stepToGlb(bytes(POLYLINE_STEP), { locateFile });

  const doc = await new WebIO().readBinary(glb);
  const primitives = doc.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());

  assert.equal(primitives.length, 1, 'expected one primitive for one polyline');
  assert.equal(primitives[0].getMode(), Primitive.Mode.LINE_STRIP);
  assert.deepEqual(
    Array.from(primitives[0].getAttribute('POSITION').getArray()),
    [0, 0, 0, 10, 0, 0, 10, 10, 0]
  );
});

test('a solid STEP is untouched by the wireframe path', async () => {
  // The fallback must be unreachable for any file that already worked. occt-import-js ships
  // this cube as a direct dependency, so the guarantee is checked against real tessellation.
  const CUBE = 'node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp';
  const { readFileSync } = await import('node:fs');

  const glb = await stepToGlb(new Uint8Array(readFileSync(CUBE)), { locateFile });
  const doc = await new WebIO().readBinary(glb);
  const primitives = doc.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());

  assert.ok(primitives.length >= 1, 'expected the solid to still tessellate');
  for (const primitive of primitives) {
    assert.equal(primitive.getMode(), Primitive.Mode.TRIANGLES, 'solids stay triangles');
  }
});

// --- Curve evaluation -------------------------------------------------------------------
// These drive extractWireframe directly rather than stepToGlb: the geometry is the subject,
// and routing each one through a WASM init guaranteed to find no solids proves nothing.

test('a degree-1 B-spline evaluates to its own control polygon', () => {
  // Degree 1 is the one B-spline whose exact answer is known by inspection: the curve IS the
  // control polygon, so any error in the de Boor recurrence or the knot expansion shows up
  // as a point off the two straight legs.
  const step = wireframeStep(
    `#210=CARTESIAN_POINT('',(0.,0.,0.));
#211=CARTESIAN_POINT('',(0.,10.,0.));
#212=CARTESIAN_POINT('',(10.,10.,0.));
#213=B_SPLINE_CURVE_WITH_KNOTS('',1,(#210,#211,#212),.UNSPECIFIED.,.F.,.F.,(2,1,2),
(0.,1.,2.),.UNSPECIFIED.);
`,
    ['#213']
  );

  const { polylines } = extractWireframe(step);
  assert.equal(polylines.length, 1);

  const points = tripletsOf(polylines[0]);
  assert.deepEqual(points[0], [0, 0, 0], 'starts at the first control point');
  assert.deepEqual(points[points.length - 1], [10, 10, 0], 'ends at the last control point');

  for (const [x, y, z] of points) {
    assertClose(z, 0, 'stays in the z=0 plane');
    // Leg one runs up x=0; leg two runs along y=10. Every sample must lie on one of them.
    const onFirstLeg = Math.abs(x) < 1e-6 && y >= -1e-6 && y <= 10 + 1e-6;
    const onSecondLeg = Math.abs(y - 10) < 1e-6 && x >= -1e-6 && x <= 10 + 1e-6;
    assert.ok(onFirstLeg || onSecondLeg, `point (${x}, ${y}) is off the control polygon`);
  }
});

test('a rational B-spline holds its exact radius', () => {
  // The standard quarter-circle NURBS: degree 2, middle weight cos(45°). Ignoring the weights
  // still produces a plausible arc, just not a circular one — so the assertion is on radius,
  // which only the rational recurrence gets right. Also the only coverage of the complex
  // instance form, where the degree and the knots live on different arms.
  const step = wireframeStep(
    `#220=CARTESIAN_POINT('',(10.,0.,0.));
#221=CARTESIAN_POINT('',(10.,10.,0.));
#222=CARTESIAN_POINT('',(0.,10.,0.));
#223=(BOUNDED_CURVE()B_SPLINE_CURVE(2,(#220,#221,#222),.UNSPECIFIED.,.F.,.F.)
B_SPLINE_CURVE_WITH_KNOTS((3,3),(0.,1.),.UNSPECIFIED.)CURVE()
GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_CURVE((1.,0.70710678118654752,1.))
REPRESENTATION_ITEM(''));
`,
    ['#223']
  );

  const { polylines } = extractWireframe(step);
  assert.equal(polylines.length, 1, 'the complex (rational) instance form is recognised');

  const points = tripletsOf(polylines[0]);
  for (const [x, y, z] of points) {
    assertClose(Math.hypot(x, y), 10, 'sample lies on the radius-10 arc', 1e-4);
    assertClose(z, 0, 'stays in the z=0 plane');
  }

  // Samples sit exactly on the curve however few of them there are, so radius alone cannot
  // catch under-sampling. The chord between consecutive samples can: its midpoint cuts the
  // corner by an amount that grows fast as the segment count falls.
  for (let i = 1; i < points.length; i += 1) {
    const midX = (points[i - 1][0] + points[i][0]) / 2;
    const midY = (points[i - 1][1] + points[i][1]) / 2;
    assertClose(Math.hypot(midX, midY), 10, 'the chord does not visibly cut the arc', 0.05);
  }
});

test('a circle is sampled in its own placement, not the global axes', () => {
  // Axis along +Y, so a circle built on the global XY plane fails every assertion here.
  const step = wireframeStep(
    `#230=CARTESIAN_POINT('',(5.,0.,0.));
#231=DIRECTION('',(0.,1.,0.));
#232=DIRECTION('',(1.,0.,0.));
#233=AXIS2_PLACEMENT_3D('',#230,#231,#232);
#234=CIRCLE('',#233,4.);
`,
    ['#234']
  );

  const { polylines } = extractWireframe(step);
  assert.equal(polylines.length, 1);

  for (const [x, y, z] of tripletsOf(polylines[0])) {
    assertClose(y, 0, 'the circle lies in the plane its axis defines', 1e-5);
    assertClose(Math.hypot(x - 5, z), 4, 'sample lies on the radius-4 circle', 1e-5);
  }
});

test('a composite curve joins its segments without doubling the shared point', () => {
  // A duplicated join point is invisible on screen and corrupts nothing, which is exactly why
  // it needs a test: every composite curve would quietly carry a zero-length segment.
  const step = wireframeStep(
    `#240=CARTESIAN_POINT('',(0.,0.,0.));
#241=CARTESIAN_POINT('',(10.,0.,0.));
#242=CARTESIAN_POINT('',(10.,10.,0.));
#243=POLYLINE('',(#240,#241));
#244=POLYLINE('',(#241,#242));
#245=COMPOSITE_CURVE_SEGMENT(.CONTINUOUS.,.T.,#243);
#246=COMPOSITE_CURVE_SEGMENT(.CONTINUOUS.,.T.,#244);
#247=COMPOSITE_CURVE('',(#245,#246),.U.);
`,
    ['#247']
  );

  const { polylines } = extractWireframe(step);
  assert.equal(polylines.length, 1);
  assert.deepEqual(tripletsOf(polylines[0]), [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
  ]);
});

test('a curve reached only as another curve\'s basis is not drawn twice', () => {
  // The circle below exists solely as the TRIMMED_CURVE's basis. Emitting every curve
  // instance in the file — rather than the ones a representation lists — would draw it once
  // on its own account and again through the trim.
  const step = wireframeStep(
    `#250=CARTESIAN_POINT('',(0.,0.,0.));
#251=DIRECTION('',(0.,0.,1.));
#252=DIRECTION('',(1.,0.,0.));
#253=AXIS2_PLACEMENT_3D('',#250,#251,#252);
#254=CIRCLE('',#253,4.);
#255=TRIMMED_CURVE('',#254,(PARAMETER_VALUE(0.)),(PARAMETER_VALUE(1.5707963)),.T.,
.PARAMETER.);
`,
    ['#255']
  );

  const { polylines } = extractWireframe(step);
  assert.equal(polylines.length, 1, 'the basis circle is construction geometry, not an item');
});

// --- Units ------------------------------------------------------------------------------

test('a file measured in inches is converted to millimetres', () => {
  // Every other length in the pipeline is millimetres, because that is what OCCT emits by
  // default. A wireframe that skipped the conversion would load at 1/25th scale.
  const inches = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('wire.stp','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));
ENDSEC;
DATA;
#1=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));
#2=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));
#3=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());
#14=DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);
#15=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.0254),#1);
#16=(CONVERSION_BASED_UNIT('INCH',#15)LENGTH_UNIT()NAMED_UNIT(#14));
#17=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNIT_ASSIGNED_CONTEXT((#16,#2,#3))
REPRESENTATION_CONTEXT('ID1','3D'));
#260=CARTESIAN_POINT('',(0.,0.,0.));
#261=CARTESIAN_POINT('',(1.,0.,0.));
#262=POLYLINE('',(#260,#261));
#900=GEOMETRIC_CURVE_SET('curve_set_0',(#262));
#901=GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION('w',(#900),#17);
ENDSEC;
END-ISO-10303-21;
`;

  const { polylines } = extractWireframe(inches);
  assert.equal(polylines.length, 1);
  assertClose(tripletsOf(polylines[0])[1][0], 25.4, 'one inch is 25.4 mm', 1e-4);
});

test('the metre an inch converts from is not mistaken for the file unit', () => {
  // The trap this guards is specific: an inch-based export DEFINES the metre, as the base of
  // its own conversion. Reading the first LENGTH_UNIT in the file finds that metre and scales
  // the whole model by 1000. Only the representation context says which unit is in force.
  const entities = parseStepEntities(`DATA;
#1=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));
#15=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.0254),#1);
#16=(CONVERSION_BASED_UNIT('INCH',#15)LENGTH_UNIT()NAMED_UNIT(#14));
#17=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNIT_ASSIGNED_CONTEXT((#16))
REPRESENTATION_CONTEXT('ID1','3D'));
ENDSEC;
`);

  assertClose(lengthUnitInMillimetres(entities), 25.4, 'the context names the inch', 1e-9);
});

// --- Honest failures --------------------------------------------------------------------

test('a curve type this cannot evaluate is named in the error, not silently dropped', async () => {
  const step = wireframeStep(
    `#270=CARTESIAN_POINT('',(0.,0.,0.));
#271=DIRECTION('',(0.,0.,1.));
#272=DIRECTION('',(1.,0.,0.));
#273=AXIS2_PLACEMENT_3D('',#270,#271,#272);
#274=CIRCLE('',#273,4.);
#275=OFFSET_CURVE_3D('',#274,2.,.F.,#271);
`,
    ['#275']
  );

  await assert.rejects(
    () => stepToGlb(bytes(step), { locateFile }),
    /no displayable geometry.*OFFSET_CURVE_3D/,
    'the error should name what it could not draw'
  );
});

test('a STEP holding neither solids nor curves fails with a message that says so', async () => {
  const empty = PREAMBLE + `#901=SHAPE_REPRESENTATION('Document',(),#5);
#902=SHAPE_DEFINITION_REPRESENTATION(#13,#901);
` + EPILOGUE;

  await assert.rejects(
    () => stepToGlb(bytes(empty), { locateFile }),
    /no displayable geometry/,
    'not "could not be read", and not "too complex"'
  );
});

// --- Sampling density -------------------------------------------------------------------

/** A clamped degree-3 B-spline through `points`, as STEP text. */
function bSplineStep(points, firstId = 300) {
  const degree = 3;
  const ids = points.map((_, i) => `#${firstId + i}`);
  const body = points
    .map(([x, y, z], i) => `#${firstId + i}=CARTESIAN_POINT('',(${x}.,${y},${z}.));`)
    .join('\n');

  // Clamped: the first and last knots carry degree+1 multiplicity, the interior ones one each.
  const interior = points.length - degree - 1;
  const multiplicities = [degree + 1, ...Array(interior).fill(1), degree + 1];
  const knots = Array.from({ length: interior + 2 }, (_, i) => `${i}.`);
  const curveId = firstId + points.length;

  return wireframeStep(
    `${body}
#${curveId}=B_SPLINE_CURVE_WITH_KNOTS('',${degree},(${ids.join(',')}),.UNSPECIFIED.,.F.,.F.,
(${multiplicities.join(',')}),(${knots.join(',')}),.UNSPECIFIED.);
`,
    [`#${curveId}`]
  );
}

test('sampling follows how much a span turns, not a fixed step per span', () => {
  // The reported files carry ~4,300 control points per curve over a 1.5 m panel — the control
  // polygon is already finer than a pixel. A fixed subdivision per knot span turned 60,000
  // control points into 430,000 samples and a 5 MB GLB of geometry nothing can resolve.
  const control = Array.from({ length: 24 }, (_, i) => [i, (0.002 * i * i).toFixed(4), 0]);
  const spans = control.length - 3 - 1;

  const { polylines } = extractWireframe(bSplineStep(control));
  assert.equal(polylines.length, 1);

  const points = tripletsOf(polylines[0]);
  assert.ok(
    points.length <= spans * 2 + 2,
    `a barely-curving span should need one sample: expected ~${spans}, got ${points.length}`
  );
  assert.ok(points.length >= spans, `but every span must still be represented: got ${points.length}`);
});
