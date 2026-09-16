/**
 * STEP wireframe extraction — the curves OpenCascade throws away.
 *
 * occt-import-js only ever walks TopAbs_FACE/SHELL/SOLID (see importer-xcaf.cpp) and meshes
 * what it finds, so a file whose only geometry is curves comes back `success: true` with an
 * empty `meshes` array. That is not an exotic export: Rhino's
 * GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION is what you get for panel layouts,
 * toolpaths and engraving patterns, and before this module those files reached the reviewer
 * as "This 3D file could not be displayed."
 *
 * This is a FALLBACK, not a second opinion. stepToGlb calls it only when OCCT produced no
 * triangles at all, so nothing here can change the output of a file that already works. It
 * deliberately does NOT try to add curves alongside solids — a mixed file (a panel plus its
 * toolpaths) still loses its curves, and fixing that needs edge geometry excluded by
 * EDGE_CURVE reachability, which is a different and much larger change.
 *
 * No DOM and no WASM: it takes STEP text and returns point lists, so it runs in the worker
 * and directly under `node --test`.
 */

/** A resolved entity instance: `#12=CIRCLE('',#13,5.)` or one arm of a complex instance. */
export interface StepEntity {
  type: string;
  args: StepValue[];
  /** Set only for a complex instance — `(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`. */
  parts?: StepEntity[];
}

export interface StepRef {
  ref: number;
}

export type StepValue = number | string | StepRef | StepEntity | StepValue[] | null;

export interface WireframePolyline {
  /**
   * Flat x,y,z triples in millimetres, ready for a glTF POSITION accessor.
   *
   * Pinned to `ArrayBuffer` rather than left as the default `ArrayBufferLike`: gltf-transform's
   * setArray only accepts the former, and a SharedArrayBuffer-backed view cannot be written
   * into a GLB.
   */
  points: Float32Array<ArrayBuffer>;
}

export interface WireframeResult {
  polylines: WireframePolyline[];
  /**
   * Entity types that sat in a curve set but that this module cannot evaluate, each counted
   * once. The caller reports them rather than letting a partial render pass for a complete
   * one — a file that draws 9 of its 11 curves looks finished, and nothing else would say
   * otherwise.
   */
  unsupported: Map<string, number>;
}

/** How finely a full turn of a conic is sampled: the maximum angle, in radians, per segment. */
const ANGULAR_TOLERANCE = 0.12;

/** Segment count for one full turn of a circle or ellipse, from ANGULAR_TOLERANCE. */
const FULL_TURN_SEGMENTS = Math.ceil((2 * Math.PI) / ANGULAR_TOLERANCE);

/**
 * Ceiling on how many times a knot span may be bisected: 2^10 segments for one span, which
 * no well-formed curve approaches and a degenerate one must not exceed.
 */
const MAX_FLATTEN_DEPTH = 10;

/**
 * Chord error budget, as a fraction of the wireframe's overall size. A span deviating from
 * its own chord by less than this is drawn as one straight segment.
 *
 * Bounding-box-relative rather than absolute, like STEP_TESSELLATION's own setting, so the
 * budget scales with the model instead of being lavish on a panel and crude on a building.
 *
 * 0.0001 rather than OpenCascade's 0.001 default because flattening a curve is cheap where
 * meshing a surface is not — de Boor over 4,300 control points is microseconds — and because
 * the reported files earn it: a 1.5 m panel carrying 3.5 mm line spacing has features three
 * orders of magnitude below its own size, and at 0.001 the waves flatten by up to 1.5 mm,
 * nearly half a line's height. At 0.0001 the same file is held to 0.22 mm.
 */
const LINEAR_DEFLECTION_RATIO = 0.0001;

/** Guards a pathological file from producing a buffer nothing can draw. */
const MAX_POINTS_PER_CURVE = 200_000;

function isRef(value: StepValue): value is StepRef {
  return typeof value === 'object' && value !== null && 'ref' in value;
}

function isEntity(value: StepValue): value is StepEntity {
  return typeof value === 'object' && value !== null && 'type' in value;
}

const CODE_0 = 48;
const CODE_9 = 57;

function isDigit(code: number): boolean {
  return code >= CODE_0 && code <= CODE_9;
}

/**
 * Whether a character can appear in a STEP keyword. Keywords are upper-case, digits and
 * underscore; the leading `!` of a user-defined entity is accepted so an unknown extension
 * parses as an entity to be skipped rather than derailing the scan.
 */
function isKeywordChar(code: number): boolean {
  return (
    (code >= 65 && code <= 90) || // A-Z
    isDigit(code) ||
    code === 95 || // _
    code === 33 // !
  );
}

/**
 * Whether a keyword may BEGIN here. Distinct from isKeywordChar, which accepts digits: STEP
 * keywords never start with one, so testing the broader predicate first reads `0.` — the
 * commonest token in any STEP file — as a keyword named "0" and then consumes the rest of
 * the instance looking for its argument list.
 */
function isKeywordStart(code: number): boolean {
  return (code >= 65 && code <= 90) || code === 33;
}

/**
 * Parses the DATA section into instances by id.
 *
 * Hand-rolled rather than regex-driven because the files this exists for run to tens of
 * megabytes with 60,000+ instances, and because STEP strings may legally contain `;`, `(`
 * and `)` — the separators a regex split would trust. A single forward scan that knows when
 * it is inside a string is both the fast option and the correct one.
 */
export function parseStepEntities(text: string): Map<number, StepEntity> {
  const entities = new Map<number, StepEntity>();

  const dataStart = text.indexOf('DATA;');
  let i = dataStart === -1 ? 0 : dataStart + 'DATA;'.length;
  const end = text.length;

  /** Advances past whitespace and `/* *\/` comments, which may appear between any tokens. */
  const skipTrivia = (): void => {
    while (i < end) {
      const code = text.charCodeAt(i);
      if (code === 32 || code === 9 || code === 10 || code === 13) {
        i += 1;
      } else if (code === 47 && text.charCodeAt(i + 1) === 42) {
        const close = text.indexOf('*/', i + 2);
        i = close === -1 ? end : close + 2;
      } else {
        return;
      }
    }
  };

  const parseString = (): string => {
    // Opening quote already confirmed by the caller.
    i += 1;
    let out = '';
    while (i < end) {
      if (text.charCodeAt(i) === 39) {
        // A doubled quote is an escaped quote, not the end of the string.
        if (text.charCodeAt(i + 1) === 39) {
          out += "'";
          i += 2;
          continue;
        }
        i += 1;
        return out;
      }
      out += text[i];
      i += 1;
    }
    return out;
  };

  const parseList = (): StepValue[] => {
    // Opening paren already confirmed by the caller.
    i += 1;
    const out: StepValue[] = [];
    for (;;) {
      skipTrivia();
      if (i >= end) return out;
      const code = text.charCodeAt(i);
      if (code === 41) {
        i += 1;
        return out;
      }
      if (code === 44) {
        i += 1;
        continue;
      }
      out.push(parseValue());
    }
  };

  const parseValue = (): StepValue => {
    skipTrivia();
    const code = text.charCodeAt(i);

    if (code === 35) {
      // #123 — a reference to another instance.
      i += 1;
      let id = 0;
      while (i < end && isDigit(text.charCodeAt(i))) {
        id = id * 10 + (text.charCodeAt(i) - CODE_0);
        i += 1;
      }
      return { ref: id };
    }

    if (code === 39) return parseString();
    if (code === 40) return parseList();

    if (code === 36 || code === 42) {
      // $ is an unset optional, * an inherited/derived value. Neither carries geometry.
      i += 1;
      return null;
    }

    if (code === 46) {
      // .T. / .UNSPECIFIED. — an enumeration. Returned without its dots.
      i += 1;
      const close = text.indexOf('.', i);
      if (close === -1) {
        i = end;
        return '';
      }
      const value = text.slice(i, close);
      i = close + 1;
      return value;
    }

    if (isKeywordStart(code)) {
      // A typed value: LENGTH_MEASURE(25.4), PARAMETER_VALUE(0.5).
      const start = i;
      while (i < end && isKeywordChar(text.charCodeAt(i))) i += 1;
      const type = text.slice(start, i);
      skipTrivia();
      const args = text.charCodeAt(i) === 40 ? parseList() : [];
      return { type, args };
    }

    // A number. Everything up to the next separator, which STEP guarantees is one of these.
    const start = i;
    while (i < end) {
      const c = text.charCodeAt(i);
      if (c === 44 || c === 41 || c === 59) break;
      i += 1;
    }
    const raw = text.slice(start, i).trim();
    const value = Number(raw);
    return Number.isNaN(value) ? raw : value;
  };

  /** A simple instance body — `KEYWORD(args)` — with the keyword start already located. */
  const parseSimple = (): StepEntity => {
    const start = i;
    while (i < end && isKeywordChar(text.charCodeAt(i))) i += 1;
    const type = text.slice(start, i);
    skipTrivia();
    const args = text.charCodeAt(i) === 40 ? parseList() : [];
    return { type, args };
  };

  while (i < end) {
    skipTrivia();
    if (i >= end) break;

    if (text.charCodeAt(i) !== 35) {
      // ENDSEC; or anything else that is not an instance. Skip to the next terminator.
      if (text.startsWith('ENDSEC', i)) break;
      const semi = text.indexOf(';', i);
      if (semi === -1) break;
      i = semi + 1;
      continue;
    }

    i += 1;
    let id = 0;
    while (i < end && isDigit(text.charCodeAt(i))) {
      id = id * 10 + (text.charCodeAt(i) - CODE_0);
      i += 1;
    }

    skipTrivia();
    if (text.charCodeAt(i) !== 61) {
      const semi = text.indexOf(';', i);
      if (semi === -1) break;
      i = semi + 1;
      continue;
    }
    i += 1;
    skipTrivia();

    if (text.charCodeAt(i) === 40) {
      // A complex instance: several entity arms sharing one id.
      i += 1;
      const parts: StepEntity[] = [];
      for (;;) {
        skipTrivia();
        if (i >= end) break;
        if (text.charCodeAt(i) === 41) {
          i += 1;
          break;
        }
        if (!isKeywordStart(text.charCodeAt(i))) {
          i += 1;
          continue;
        }
        parts.push(parseSimple());
      }
      entities.set(id, { type: 'COMPLEX', args: [], parts });
    } else if (isKeywordStart(text.charCodeAt(i))) {
      entities.set(id, parseSimple());
    }

    // Trailing tokens between the body and its `;` are not ours to interpret.
    const semi = text.indexOf(';', i);
    if (semi === -1) break;
    i = semi + 1;
  }

  return entities;
}

/**
 * An arm's arguments with the entity NAME removed, so one set of indices works for both
 * instance forms.
 *
 * A simple instance carries its own name first — `CIRCLE('',#53,4.)` — while the arms of a
 * complex instance do not, because the name lives on the REPRESENTATION_ITEM arm instead:
 * `(...CIRCLE(#53,4.)...REPRESENTATION_ITEM(''))`. Reading a fixed index across both forms is
 * off by one for exactly one of them, which is how a B-spline's degree came back as `''`.
 */
function slots(entity: StepEntity, type: string): StepValue[] | null {
  const target = arm(entity, type);
  if (!target) return null;
  return entity.parts?.length ? target.args : target.args.slice(1);
}

/** One arm of a complex instance by type, or the instance itself when it is simple. */
function arm(entity: StepEntity | undefined, type: string): StepEntity | undefined {
  if (!entity) return undefined;
  if (entity.type === type) return entity;
  return entity.parts?.find((part) => part.type === type);
}

/** Every type name an instance answers to — one for a simple instance, several for a complex. */
function typesOf(entity: StepEntity): string[] {
  return entity.parts?.length ? entity.parts.map((part) => part.type) : [entity.type];
}

class Resolver {
  // Declared and assigned rather than a `private readonly` constructor parameter: these
  // modules run under `node --test`, whose type stripping rejects parameter properties
  // outright (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX) because they emit code rather than erase.
  private readonly entities: Map<number, StepEntity>;

  constructor(entities: Map<number, StepEntity>) {
    this.entities = entities;
  }

  get(value: StepValue): StepEntity | undefined {
    if (isRef(value)) return this.entities.get(value.ref);
    if (isEntity(value)) return value;
    return undefined;
  }

  /** The instance a value points at, but only if it is of one of the named types. */
  typed(value: StepValue, types: string[]): StepEntity | undefined {
    const entity = this.get(value);
    if (!entity) return undefined;
    return typesOf(entity).some((type) => types.includes(type)) ? entity : undefined;
  }

  /** The name-stripped arguments of the first of `types` this value answers to. */
  slotsOf(value: StepValue, types: string[]): StepValue[] | null {
    const entity = this.get(value);
    if (!entity) return null;
    for (const type of types) {
      const found = slots(entity, type);
      if (found) return found;
    }
    return null;
  }

  lookup(id: number): StepEntity | undefined {
    return this.entities.get(id);
  }
}

type Vec3 = [number, number, number];

/**
 * A number, unwrapping a STEP typed value if that is how it arrived.
 *
 * `LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.0254),#1)` holds its magnitude inside a named
 * wrapper rather than as a bare literal, which is the form every inch-based file states its
 * conversion factor in. Reading the wrapper as a non-number made such files fall through to
 * the metre they convert FROM, scaling the model by 1000.
 */
function numberOf(value: StepValue): number | null {
  if (typeof value === 'number') return value;
  if (isEntity(value) && value.args.length === 1) return numberOf(value.args[0]);
  return null;
}

function numbersOf(value: StepValue): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => numberOf(item) ?? Number.NaN);
}

function pointOf(resolver: Resolver, value: StepValue): Vec3 | null {
  const args = resolver.slotsOf(value, ['CARTESIAN_POINT']);
  if (!args) return null;
  const coords = numbersOf(args[0]);
  if (coords.length < 2 || coords.some(Number.isNaN)) return null;
  // A 2D CARTESIAN_POINT is legal STEP; the missing ordinate is zero.
  return [coords[0], coords[1], coords[2] ?? 0];
}

function directionOf(resolver: Resolver, value: StepValue): Vec3 | null {
  const args = resolver.slotsOf(value, ['DIRECTION']);
  if (!args) return null;
  const coords = numbersOf(args[0]);
  if (coords.length < 2 || coords.some(Number.isNaN)) return null;
  return [coords[0], coords[1], coords[2] ?? 0];
}

interface Placement {
  origin: Vec3;
  /** Local X, Y and Z, orthonormalised. */
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): Vec3 | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!(length > 0)) return null;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * AXIS2_PLACEMENT_3D as an orthonormal frame.
 *
 * Both direction slots are optional in STEP and frequently omitted, in which case the
 * defaults are the global axes. `ref_direction` is only a hint: the standard defines the
 * local X as its component orthogonal to the axis, so it is projected rather than trusted.
 */
function placementOf(resolver: Resolver, value: StepValue): Placement | null {
  const args = resolver.slotsOf(value, ['AXIS2_PLACEMENT_3D', 'AXIS2_PLACEMENT_2D']);
  if (!args) return null;

  const origin = pointOf(resolver, args[0]);
  if (!origin) return null;

  const z = normalize(directionOf(resolver, args[1]) ?? [0, 0, 1]) ?? [0, 0, 1];
  const hint = directionOf(resolver, args[2]) ?? (Math.abs(z[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]);

  const projection = dot(hint, z);
  const x = normalize([
    hint[0] - projection * z[0],
    hint[1] - projection * z[1],
    hint[2] - projection * z[2],
  ]);
  if (!x) return null;

  return { origin, x, y: cross(z, x), z };
}

function atPlacement(placement: Placement, u: number, v: number): Vec3 {
  const { origin, x, y } = placement;
  return [
    origin[0] + x[0] * u + y[0] * v,
    origin[1] + x[1] * u + y[1] * v,
    origin[2] + x[2] * u + y[2] * v,
  ];
}

/**
 * The file's length unit expressed in millimetres, which is the unit OCCT emits by default
 * and therefore the unit the rest of the pipeline assumes.
 *
 * Read from a GLOBAL_UNIT_ASSIGNED_CONTEXT, not from the first LENGTH_UNIT in the file, and
 * that distinction is the whole function. An inch-based export defines the metre too — as
 * the base its inch converts FROM — so scanning for the first length unit finds the metre
 * and scales the model by 1000. Only the context says which unit the coordinates are
 * actually written in.
 *
 * A file may in principle carry several contexts with different units; every file this has
 * been seen on carries one. Taking the first is a defined behaviour, where mixing units
 * within one output would not be.
 */
export function lengthUnitInMillimetres(entities: Map<number, StepEntity>): number {
  const SI_PREFIX: Record<string, number> = {
    EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2,
    DECA: 1e1, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9,
    PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18,
  };
  const resolver = new Resolver(entities);

  /** An SI length in millimetres — metres scaled by the instance's prefix, times 1000. */
  const siLength = (entity: StepEntity): number | null => {
    const si = arm(entity, 'SI_UNIT');
    if (!si || !arm(entity, 'LENGTH_UNIT')) return null;
    // SI_UNIT(prefix, name): both are attributes, so neither form carries a leading name.
    if (si.args[1] !== 'METRE') return null;
    const prefix = typeof si.args[0] === 'string' ? SI_PREFIX[si.args[0]] : undefined;
    return 1000 * (prefix ?? 1);
  };

  /** A unit defined as a multiple of another — how inches and feet always arrive. */
  const conversionLength = (entity: StepEntity): number | null => {
    const conversion = arm(entity, 'CONVERSION_BASED_UNIT');
    if (!conversion || !arm(entity, 'LENGTH_UNIT')) return null;

    // CONVERSION_BASED_UNIT(name, conversion_factor): the name is an attribute of the unit
    // itself ('INCH'), not an instance name, so it is present in both forms.
    const measure = resolver.get(conversion.args[1]);
    if (!measure) return null;

    const factor = numberOf(measure.args[0]);
    const base = resolver.get(measure.args[1]);
    if (factor === null || !base) return null;

    const baseMm = siLength(base);
    return baseMm === null ? null : factor * baseMm;
  };

  const lengthOf = (entity: StepEntity): number | null =>
    conversionLength(entity) ?? siLength(entity);

  // forEach rather than for...of throughout: tsconfig.json sets no `target`, so iterating a
  // Map with for...of needs downlevelIteration and fails the typecheck without it.
  let declared: number | null = null;
  entities.forEach((entity) => {
    if (declared !== null) return;

    // GLOBAL_UNIT_ASSIGNED_CONTEXT(units) — one attribute, and it only ever appears as an
    // arm of a complex instance, so there is no instance name ahead of it.
    const units = arm(entity, 'GLOBAL_UNIT_ASSIGNED_CONTEXT')?.args[0];
    if (!Array.isArray(units)) return;

    for (const reference of units) {
      const unit = resolver.get(reference);
      const millimetres = unit ? lengthOf(unit) : null;
      if (millimetres !== null) {
        declared = millimetres;
        return;
      }
    }
  });
  if (declared !== null) return declared;

  // No context declared a length unit. Falling back to whatever the file defines is better
  // than assuming millimetres outright, and for a single-unit file the two agree.
  let defined: number | null = null;
  entities.forEach((entity) => {
    if (defined !== null) return;
    defined = lengthOf(entity);
  });

  return defined ?? 1;
}

/** Perpendicular distance from `point` to the segment `a`-`b`. */
function distanceToChord(point: Vec3, a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const lengthSquared = dx * dx + dy * dy + dz * dz;

  const px = point[0] - a[0];
  const py = point[1] - a[1];
  const pz = point[2] - a[2];
  if (lengthSquared === 0) return Math.hypot(px, py, pz);

  // Clamped, so a control point beyond either end measures to the end rather than to the
  // infinite line — a closed span's chord can be degenerate in ways an unclamped projection
  // reports as zero deviation.
  const t = Math.min(1, Math.max(0, (px * dx + py * dy + pz * dz) / lengthSquared));
  return Math.hypot(px - t * dx, py - t * dy, pz - t * dz);
}

/** de Boor evaluation of a B-spline at parameter `u`, rational when weights are given. */
function deBoor(
  degree: number,
  controls: Vec3[],
  weights: number[] | null,
  knots: number[],
  span: number,
  u: number
): Vec3 {
  // Homogeneous coordinates, so the rational and polynomial cases share one recurrence.
  const d: number[][] = [];
  for (let j = 0; j <= degree; j += 1) {
    const index = span - degree + j;
    const w = weights ? weights[index] : 1;
    const p = controls[index];
    d.push([p[0] * w, p[1] * w, p[2] * w, w]);
  }

  for (let r = 1; r <= degree; r += 1) {
    for (let j = degree; j >= r; j -= 1) {
      const index = span - degree + j;
      const lower = knots[index];
      const upper = knots[index + degree - r + 1];
      const denominator = upper - lower;
      const alpha = denominator === 0 ? 0 : (u - lower) / denominator;
      const previous = d[j - 1];
      const current = d[j];
      for (let k = 0; k < 4; k += 1) {
        current[k] = (1 - alpha) * previous[k] + alpha * current[k];
      }
    }
  }

  const [x, y, z, w] = d[degree];
  return w === 0 ? [x, y, z] : [x / w, y / w, z / w];
}

/** The knot span index containing `u`, clamped to the last non-empty span. */
function findSpan(degree: number, knots: number[], u: number): number {
  const last = knots.length - degree - 2;
  if (u >= knots[last + 1]) return last;
  let low = degree;
  let high = last + 1;
  let mid = Math.floor((low + high) / 2);
  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) high = mid;
    else low = mid;
    mid = Math.floor((low + high) / 2);
    if (mid <= degree) return degree;
    if (mid >= last) return last;
  }
  return mid;
}

export class CurveEvaluator {
  private readonly resolver: Resolver;
  /** Chord error budget in the file's own units — see LINEAR_DEFLECTION_RATIO. */
  private readonly tolerance: number;
  readonly unsupported = new Map<string, number>();

  constructor(entities: Map<number, StepEntity>, tolerance: number) {
    this.resolver = new Resolver(entities);
    this.tolerance = tolerance;
  }

  private note(type: string): null {
    this.unsupported.set(type, (this.unsupported.get(type) ?? 0) + 1);
    return null;
  }

  /**
   * A curve instance as a point list, or `null` when this module cannot evaluate it.
   *
   * `seen` breaks reference cycles. A COMPOSITE_CURVE whose segment points back at it is
   * malformed, but these files come from outside and a stack overflow is a worse answer
   * than a skipped curve.
   */
  evaluate(value: StepValue, seen: Set<StepEntity> = new Set()): Vec3[] | null {
    const entity = this.resolver.get(value);
    if (!entity || seen.has(entity)) return null;
    seen.add(entity);

    const types = typesOf(entity);

    if (types.includes('POLYLINE')) return this.polyline(entity);
    if (types.includes('B_SPLINE_CURVE_WITH_KNOTS')) return this.bSpline(entity);
    if (types.includes('CIRCLE')) return this.conic(entity, 'CIRCLE');
    if (types.includes('ELLIPSE')) return this.conic(entity, 'ELLIPSE');
    if (types.includes('LINE')) return this.line(entity);
    if (types.includes('TRIMMED_CURVE')) return this.trimmed(entity, seen);
    if (types.includes('COMPOSITE_CURVE')) return this.composite(entity, seen);

    return this.note(types[0] ?? 'UNKNOWN');
  }

  private polyline(entity: StepEntity): Vec3[] | null {
    const list = slots(entity, 'POLYLINE')?.[0];
    if (!Array.isArray(list)) return null;
    const points: Vec3[] = [];
    for (const item of list) {
      const point = pointOf(this.resolver, item);
      if (point) points.push(point);
    }
    return points.length >= 2 ? points : null;
  }

  private line(entity: StepEntity): Vec3[] | null {
    // An unbounded LINE only has drawable extent through its VECTOR's magnitude. A zero or
    // missing magnitude leaves nothing to draw, which is the honest outcome — a line of
    // arbitrary invented length would silently distort the model's bounds.
    const args = slots(entity, 'LINE');
    if (!args) return null;

    const origin = pointOf(this.resolver, args[0]);
    const vector = this.resolver.slotsOf(args[1], ['VECTOR']);
    if (!origin || !vector) return null;

    const direction = directionOf(this.resolver, vector[0]);
    const magnitude = vector[1];
    if (!direction || typeof magnitude !== 'number' || magnitude === 0) return null;

    return [
      origin,
      [
        origin[0] + direction[0] * magnitude,
        origin[1] + direction[1] * magnitude,
        origin[2] + direction[2] * magnitude,
      ],
    ];
  }

  private conic(entity: StepEntity, kind: 'CIRCLE' | 'ELLIPSE'): Vec3[] | null {
    const args = slots(entity, kind);
    if (!args) return null;

    const placement = placementOf(this.resolver, args[0]);
    if (!placement) return null;

    // A circle's single radius serves as both semi-axes; an ellipse names them separately.
    const first = args[1];
    const second = kind === 'ELLIPSE' ? args[2] : args[1];
    if (typeof first !== 'number' || typeof second !== 'number') return null;
    if (first <= 0 || second <= 0) return null;

    const points: Vec3[] = [];
    for (let i = 0; i <= FULL_TURN_SEGMENTS; i += 1) {
      const angle = (2 * Math.PI * i) / FULL_TURN_SEGMENTS;
      points.push(atPlacement(placement, first * Math.cos(angle), second * Math.sin(angle)));
    }
    return points;
  }

  private bSpline(entity: StepEntity): Vec3[] | null {
    const base = arm(entity, 'B_SPLINE_CURVE_WITH_KNOTS');
    if (!base) return null;

    // In the rational complex form the degree and control points live on the B_SPLINE_CURVE
    // arm, while the knots live on B_SPLINE_CURVE_WITH_KNOTS. In the simple form one
    // instance carries both, and `arm` returns it for either name.
    const curve = arm(entity, 'B_SPLINE_CURVE') ?? base;

    // Both arms are addressed through the same name-stripping rule; see slots().
    const complex = Boolean(entity.parts?.length);
    const curveArgs = complex ? curve.args : curve.args.slice(1);
    const knotArgs = complex ? base.args : base.args.slice(1);

    const degree = curveArgs[0];
    const controlList = curveArgs[1];
    if (typeof degree !== 'number' || degree < 1 || !Array.isArray(controlList)) return null;

    const controls: Vec3[] = [];
    for (const item of controlList) {
      const point = pointOf(this.resolver, item);
      if (!point) return null;
      controls.push(point);
    }
    if (controls.length <= degree) return null;

    // In the simple form one instance carries everything, so the knots sit after degree,
    // control points and the three flags that follow them. In the complex form the
    // B_SPLINE_CURVE_WITH_KNOTS arm carries only its own three attributes, knots first.
    const offset = base === curve ? 5 : 0;
    const multiplicities = numbersOf(knotArgs[offset]);
    const distinct = numbersOf(knotArgs[offset + 1]);
    if (!multiplicities.length || multiplicities.length !== distinct.length) return null;

    const knots: number[] = [];
    for (let i = 0; i < distinct.length; i += 1) {
      const count = multiplicities[i];
      if (!Number.isFinite(count) || count < 1) return null;
      for (let j = 0; j < count; j += 1) knots.push(distinct[i]);
    }
    if (knots.length !== controls.length + degree + 1) return null;

    const rational = slots(entity, 'RATIONAL_B_SPLINE_CURVE');
    let weights: number[] | null = null;
    if (rational) {
      const raw = numbersOf(rational[0]);
      if (raw.length === controls.length && !raw.some(Number.isNaN)) weights = raw;
    }

    const at = (u: number): Vec3 =>
      deBoor(degree, controls, weights, knots, findSpan(degree, knots, u), u);

    /**
     * Whether the straight segment p0-p1 stands in for the curve between u0 and u1.
     *
     * Three interior probes rather than one. A symmetric S-shaped span passes its midpoint
     * exactly through its own chord while straying far to either side of it, so a
     * midpoint-only test declares the worst case flat.
     */
    const flatEnough = (u0: number, u1: number, p0: Vec3, p1: Vec3): boolean => {
      for (const t of [0.25, 0.5, 0.75]) {
        if (distanceToChord(at(u0 + (u1 - u0) * t), p0, p1) > this.tolerance) return false;
      }
      return true;
    };

    const points: Vec3[] = [];

    /** Bisects until the chord meets tolerance, emitting p1 when it does. */
    const flatten = (u0: number, u1: number, p0: Vec3, p1: Vec3, depth: number): void => {
      if (points.length >= MAX_POINTS_PER_CURVE) return;

      if (depth < MAX_FLATTEN_DEPTH && !flatEnough(u0, u1, p0, p1)) {
        const middle = (u0 + u1) / 2;
        const p = at(middle);
        flatten(u0, middle, p0, p, depth + 1);
        flatten(middle, u1, p, p1, depth + 1);
        return;
      }
      points.push(p1);
    };

    // Measured rather than predicted. Deciding a subdivision up front from how far the
    // CONTROL polygon strays from its chord is the cheaper design and was the first one
    // written; it under-predicts, because the error left after n-fold subdivision only falls
    // as n^2 for a span that bends one way. On the reported files it left 1.5 mm of flattening
    // against a 2.2 mm budget. Bisecting against the real curve cannot: every segment emitted
    // has been checked.
    //
    // Knot spans are the outer loop because they are where the curve's continuity can break:
    // a span boundary may be a genuine corner, which bisection either side of it would round.
    const stop = knots[knots.length - degree - 1];
    let previous = at(knots[degree]);
    points.push(previous);

    for (let i = degree; i < knots.length - degree - 1; i += 1) {
      const lower = knots[i];
      const upper = knots[i + 1];
      if (!(upper > lower)) continue;

      const end = at(upper);
      flatten(lower, upper, previous, end, 0);
      previous = end;
    }

    if (points.length < 2) return null;
    if (previous !== points[points.length - 1]) points.push(at(stop));
    return points;
  }

  private trimmed(entity: StepEntity, seen: Set<StepEntity>): Vec3[] | null {
    // Evaluating the basis curve over its own full domain and ignoring the trim parameters
    // over-draws rather than under-draws. That is the right way round for a fallback: a
    // curve drawn slightly long is visible and recognisable, a curve dropped is neither.
    const basis = this.evaluate(slots(entity, 'TRIMMED_CURVE')?.[0] ?? null, seen);
    if (basis) return basis;
    return this.note('TRIMMED_CURVE');
  }

  private composite(entity: StepEntity, seen: Set<StepEntity>): Vec3[] | null {
    const segments = slots(entity, 'COMPOSITE_CURVE')?.[0];
    if (!Array.isArray(segments)) return null;

    const points: Vec3[] = [];
    for (const item of segments) {
      // COMPOSITE_CURVE_SEGMENT has no name of its own in either form: its attributes are
      // (transition, same_sense, parent_curve), so these indices need no adjustment.
      const segment = this.resolver.typed(item, ['COMPOSITE_CURVE_SEGMENT']);
      if (!segment) continue;

      const part = this.evaluate(segment.args[2], seen);
      if (!part?.length) continue;

      // `same_sense` false means the segment runs against its parent curve's direction.
      const ordered = segment.args[1] === 'F' ? [...part].reverse() : part;
      // The join point is shared with the previous segment's end; emitting it twice would
      // leave a zero-length rung in the strip.
      points.push(...(points.length ? ordered.slice(1) : ordered));
    }
    return points.length >= 2 ? points : null;
  }
}

/**
 * Curve instances that a representation actually draws.
 *
 * Driven from the representations rather than "every curve instance in the file" because a
 * curve may equally be construction geometry for another curve — a TRIMMED_CURVE's basis, a
 * COMPOSITE_CURVE's segments — and emitting those alongside the curve that owns them draws
 * the same geometry twice, untrimmed.
 */
function representedCurves(entities: Map<number, StepEntity>): StepValue[] {
  const resolver = new Resolver(entities);
  const out: StepValue[] = [];
  const seen = new Set<number>();

  const push = (value: StepValue): void => {
    if (isRef(value)) {
      if (seen.has(value.ref)) return;
      seen.add(value.ref);
    }
    out.push(value);
  };

  entities.forEach((entity) => {
    const types = typesOf(entity);

    // A curve set names its contents directly. This is the shape Rhino writes.
    if (types.includes('GEOMETRIC_CURVE_SET') || types.includes('GEOMETRIC_SET')) {
      const items = slots(entity, types.includes('GEOMETRIC_CURVE_SET') ? 'GEOMETRIC_CURVE_SET' : 'GEOMETRIC_SET')?.[0];
      if (Array.isArray(items)) items.forEach(push);
      return;
    }

    // A wireframe representation may also list curves as its own items, without an
    // intervening set. Non-curve items (the placements every representation carries) fall
    // out downstream, where evaluate() declines them.
    if (
      types.includes('GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION') ||
      types.includes('GEOMETRICALLY_BOUNDED_SURFACE_SHAPE_REPRESENTATION')
    ) {
      const items = entity.args[1];
      if (!Array.isArray(items)) return;
      for (const item of items) {
        const referenced = resolver.get(item);
        if (!referenced) continue;
        const itemTypes = typesOf(referenced);
        if (itemTypes.includes('GEOMETRIC_CURVE_SET') || itemTypes.includes('GEOMETRIC_SET')) continue;
        push(item);
      }
    }
  });

  return out;
}

/**
 * The diagonal of the box holding every CARTESIAN_POINT in the file, in the file's own units.
 *
 * Stands in for "how big is this model", which is what a relative chord tolerance needs and
 * what nothing else here knows before the curves are evaluated. In a wireframe file those
 * points ARE the geometry, so the box is the model's box. A stray far-flung point inflates it
 * and coarsens sampling slightly — the safe direction to be wrong in, and the one OCCT's own
 * bounding_box_ratio is wrong in too.
 */
function cartesianPointSpread(entities: Map<number, StepEntity>): number {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let found = false;

  entities.forEach((entity) => {
    if (entity.type !== 'CARTESIAN_POINT') return;
    const coords = numbersOf(entity.args[1]);
    if (coords.length < 2 || coords.some(Number.isNaN)) return;

    found = true;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = coords[axis] ?? 0;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  });

  if (!found) return 1;
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  // A single point, or every point coincident, leaves nothing to scale a tolerance against.
  return diagonal > 0 ? diagonal : 1;
}

/** Items a representation lists that are placements or similar, not geometry we can draw. */
const NON_CURVE_ITEMS = new Set([
  'AXIS2_PLACEMENT_3D',
  'AXIS2_PLACEMENT_2D',
  'CARTESIAN_POINT',
  'VERTEX_POINT',
  'DIRECTION',
  'MAPPED_ITEM',
]);

/**
 * Every drawable curve in a STEP file's wireframe representations, sampled to point lists in
 * millimetres.
 */
export function extractWireframe(text: string): WireframeResult {
  const entities = parseStepEntities(text);
  const scale = lengthUnitInMillimetres(entities);
  const evaluator = new CurveEvaluator(entities, cartesianPointSpread(entities) * LINEAR_DEFLECTION_RATIO);
  const resolver = new Resolver(entities);

  const polylines: WireframePolyline[] = [];

  for (const value of representedCurves(entities)) {
    const entity = resolver.get(value);
    if (!entity) continue;
    if (typesOf(entity).some((type) => NON_CURVE_ITEMS.has(type))) continue;

    const points = evaluator.evaluate(value);
    if (!points || points.length < 2) continue;

    const flat = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i += 1) {
      flat[i * 3] = points[i][0] * scale;
      flat[i * 3 + 1] = points[i][1] * scale;
      flat[i * 3 + 2] = points[i][2] * scale;
    }
    polylines.push({ points: flat });
  }

  return { polylines, unsupported: evaluator.unsupported };
}
