/**
 * KYC v2 option lists (spec docs/superpowers/specs/2026-11-19-kyc-v2-design.md).
 * Wording and codes come from the marketing co-founder's doc,
 * docs/superpowers/specs/2026-11-19-kyc-v2-source.md. Role family/seniority and the
 * search synonyms are engineering's draft: marketing reviews them.
 *
 * Codes are what gets stored, in Postgres and in PostHog. Labels are display only
 * and may be reworded freely. To retire an option, delete it here and never reuse
 * its code.
 *
 * Pure data, no imports: loaded by node --test, the edge-free server and the client.
 */

export type IndustryCode =
  | 'IND' | 'CON' | 'PRD' | 'MFG' | 'ARC' | 'INT' | 'CST' | 'VIZ' | 'GRD' | 'VID' | 'PHO' | 'OTH';
/** The four v1 pillars, kept as the roll-up for reports and the 4 solution pages. */
export type ParentSegment = 'ID' | 'PD' | 'AC' | 'GV';
export type Track = 'prosumer' | 'small_team' | 'mid_team' | 'large_team';
export type Seniority = 'owner_exec' | 'director' | 'manager_lead' | 'individual' | 'student';
export type RoleFamily =
  | 'leadership' | 'design' | 'engineering' | 'project_management' | 'operations_production'
  | 'quality' | 'procurement' | 'sales_estimating' | 'marketing' | 'creative_production'
  | 'education' | 'other';
export type FileGroup = '3d_cad' | '3d_mesh' | '2d_docs' | 'bim' | 'images' | 'video';

export interface Industry {
  code: IndustryCode;
  label: string;
  helper: string;
  parent: ParentSegment | null;
  /** Reporting only; never shown. */
  priority: 'core' | 'beachhead' | 'secondary' | null;
  synonyms?: readonly string[];
}
export interface Market { code: string; group: string; label: string; synonyms?: readonly string[] }
export interface ClientModel {
  code: string;
  label: string;
  helper?: string;
  /** Absent = shown for every industry. */
  industries?: readonly IndustryCode[];
}
export interface Band { code: string; label: string; min: number; max: number | null }
export interface SizeBand extends Band { track: Track }
export interface Role {
  code: string;
  label: string;
  family: RoleFamily;
  /** Null only for Other. */
  seniority: Seniority | null;
  synonyms?: readonly string[];
}
/** `id` is per label (what the UI selects); `code` is what is stored (labels differ by industry, codes do not). */
export interface Reviewer { id: string; code: string; label: string }
export interface FileType {
  code: string;
  /** Null only for Other. */
  group: FileGroup | null;
  label: string;
  /** Undotted, lowercase. supported_at_signup = any of these is in lib/fileFormats.ts. */
  extensions: readonly string[];
  synonyms?: readonly string[];
}

export const OTHER_TEXT_MAX = 120;
export const OTHER_INDUSTRY = 'OTH';
export const OTHER_MARKET = 'MK-99';
export const OTHER_ROLE = 'RL-99';
export const OTHER_FILE_TYPE = 'FT-99';
export const MAX_MARKETS = 3;

export const INDUSTRIES: readonly Industry[] = [
  { code: 'IND', label: 'Industrial Design', helper: 'Designing the form, function and finish of physical products', parent: 'ID', priority: 'core' },
  { code: 'CON', label: 'Concept Development', helper: 'Early-stage ideas, research, concepts and appearance models', parent: 'ID', priority: 'core' },
  { code: 'PRD', label: 'Product Development', helper: 'Engineering products from concept to production-ready design', parent: 'PD', priority: 'beachhead', synonyms: ['mechanical engineering', 'electrical engineering'] },
  { code: 'MFG', label: 'Manufacturing', helper: 'Making parts, tooling or finished products', parent: 'PD', priority: 'beachhead' },
  { code: 'ARC', label: 'Architecture & Building Engineering', helper: 'Designing buildings, sites and building systems', parent: 'AC', priority: 'core', synonyms: ['structural', 'mep', 'civil'] },
  { code: 'INT', label: 'Interior Design', helper: 'Designing interiors, fit-outs and furnishings', parent: 'AC', priority: 'core' },
  { code: 'CST', label: 'Construction & Fabrication', helper: 'Building, renovating, fabricating or developing projects', parent: 'AC', priority: 'core' },
  { code: 'VIZ', label: '3D Visualization & CGI', helper: 'Renders, 3D animation and 3D assets', parent: 'GV', priority: 'secondary' },
  { code: 'GRD', label: 'Graphic Design & Branding', helper: 'Brand, packaging, print and digital design', parent: 'GV', priority: 'secondary' },
  { code: 'VID', label: 'Video & Animation', helper: 'Production, post-production and motion', parent: 'GV', priority: 'secondary' },
  { code: 'PHO', label: 'Photography', helper: 'Product, architecture and commercial photography', parent: 'GV', priority: 'secondary' },
  { code: 'OTH', label: 'Other', helper: 'Please specify', parent: null, priority: null },
];

const CP = 'Consumer products';
const IT = 'Industrial and technical';
const BS = 'Buildings and spaces';
const MB = 'Media and brand';

export const MARKETS: readonly Market[] = [
  { code: 'MK-01', group: CP, label: 'Consumer electronics', synonyms: ['audio', 'wearables', 'smart home'] },
  { code: 'MK-02', group: CP, label: 'Home appliances' },
  { code: 'MK-03', group: CP, label: 'Furniture and lighting', synonyms: ['millwork', 'cabinetry', 'casework'] },
  { code: 'MK-04', group: CP, label: 'Home goods and decor', synonyms: ['housewares'] },
  { code: 'MK-05', group: CP, label: 'Sports, outdoor and fitness', synonyms: ['bikes', 'outdoor gear'] },
  { code: 'MK-06', group: CP, label: 'Toys and juvenile' },
  { code: 'MK-07', group: CP, label: 'Fashion, footwear and accessories', synonyms: ['apparel', 'shoes'] },
  { code: 'MK-08', group: CP, label: 'Beauty and personal care', synonyms: ['cosmetics'] },
  { code: 'MK-09', group: CP, label: 'Food and beverage' },
  { code: 'MK-10', group: CP, label: 'Packaging', synonyms: ['labels', 'dielines'] },
  { code: 'MK-11', group: IT, label: 'Medical and health devices', synonyms: ['medtech', 'medical'] },
  { code: 'MK-12', group: IT, label: 'Automotive and EV', synonyms: ['auto', 'electric vehicle'] },
  { code: 'MK-13', group: IT, label: 'Aerospace and defense', synonyms: ['aviation', 'defence'] },
  { code: 'MK-14', group: IT, label: 'Marine, RV and specialty vehicles', synonyms: ['boats'] },
  { code: 'MK-15', group: IT, label: 'Industrial equipment and machinery', synonyms: ['cnc', 'machining', 'molding', 'moulding', 'fabrication'] },
  { code: 'MK-16', group: IT, label: 'Robotics and automation', synonyms: ['robots'] },
  { code: 'MK-17', group: IT, label: 'Tools and hardware', synonyms: ['power tools'] },
  { code: 'MK-18', group: IT, label: 'Electronics and PCBs', synonyms: ['pcb', 'pcba'] },
  { code: 'MK-19', group: IT, label: 'Energy and cleantech', synonyms: ['solar', 'battery'] },
  { code: 'MK-20', group: IT, label: 'Building products and HVAC', synonyms: ['windows', 'doors'] },
  { code: 'MK-21', group: BS, label: 'Residential', synonyms: ['homes', 'housing'] },
  { code: 'MK-22', group: BS, label: 'Commercial and office' },
  { code: 'MK-23', group: BS, label: 'Retail and hospitality', synonyms: ['hotels', 'restaurants'] },
  { code: 'MK-24', group: BS, label: 'Healthcare and education', synonyms: ['hospitals', 'schools'] },
  { code: 'MK-25', group: BS, label: 'Industrial and warehouse' },
  { code: 'MK-26', group: BS, label: 'Infrastructure and civil', synonyms: ['bridges', 'roads'] },
  { code: 'MK-27', group: BS, label: 'Landscape and public spaces' },
  { code: 'MK-28', group: BS, label: 'Exhibitions and events', synonyms: ['trade show'] },
  { code: 'MK-29', group: MB, label: 'Brand and marketing content', synonyms: ['advertising'] },
  { code: 'MK-30', group: MB, label: 'Entertainment, film and games', synonyms: ['gaming'] },
  { code: 'MK-99', group: '', label: 'Other (please specify)' },
];

export const CLIENT_MODELS: readonly ClientModel[] = [
  { code: 'CM-1', label: 'Clients', helper: "We're a studio, agency, firm, consultant or contractor" },
  { code: 'CM-2', label: 'Our own company', helper: "We're the brand, manufacturer, owner or developer" },
  { code: 'CM-3', label: 'Other companies, as a supplier', helper: 'We make parts, tooling or products to their designs', industries: ['PRD', 'MFG', 'CST'] },
  { code: 'CM-4', label: 'Mostly clients, some our own' },
  { code: 'CM-5', label: 'Mostly our own, some clients' },
];

export const SIZE_BANDS: readonly SizeBand[] = [
  { code: 'CS-01', label: 'Just me', min: 1, max: 1, track: 'prosumer' },
  { code: 'CS-02', label: '2-4', min: 2, max: 4, track: 'small_team' },
  { code: 'CS-03', label: '5-9', min: 5, max: 9, track: 'mid_team' },
  { code: 'CS-04', label: '10-24', min: 10, max: 24, track: 'mid_team' },
  { code: 'CS-05', label: '25-49', min: 25, max: 49, track: 'mid_team' },
  { code: 'CS-06', label: '50-99', min: 50, max: 99, track: 'large_team' },
  { code: 'CS-07', label: '100-249', min: 100, max: 249, track: 'large_team' },
  { code: 'CS-08', label: '250+', min: 250, max: null, track: 'large_team' },
];

export const REVIEW_TEAM_BANDS: readonly Band[] = [
  { code: 'RT-01', label: '1 (just me)', min: 1, max: 1 },
  { code: 'RT-02', label: '2-4', min: 2, max: 4 },
  { code: 'RT-03', label: '5-9', min: 5, max: 9 },
  { code: 'RT-04', label: '10-24', min: 10, max: 24 },
  { code: 'RT-05', label: '25-49', min: 25, max: 49 },
  { code: 'RT-06', label: '50+', min: 50, max: null },
];

/** One code per unique label across every industry's list. Ordered by first appearance. */
export const ROLES: readonly Role[] = [
  { code: 'RL-01', label: 'Owner / Principal / Founder', family: 'leadership', seniority: 'owner_exec' },
  { code: 'RL-02', label: 'Design director / Head of design', family: 'design', seniority: 'director' },
  { code: 'RL-03', label: 'Design manager / Lead designer', family: 'design', seniority: 'manager_lead' },
  { code: 'RL-04', label: 'Industrial designer', family: 'design', seniority: 'individual' },
  { code: 'RL-05', label: 'CMF designer', family: 'design', seniority: 'individual', synonyms: ['colour', 'color', 'materials', 'finish'] },
  { code: 'RL-06', label: 'Design engineer', family: 'engineering', seniority: 'individual' },
  { code: 'RL-07', label: 'Mechanical engineer', family: 'engineering', seniority: 'individual' },
  { code: 'RL-08', label: 'Product manager', family: 'project_management', seniority: 'manager_lead' },
  { code: 'RL-09', label: 'Marketing / brand', family: 'marketing', seniority: 'individual' },
  { code: 'RL-10', label: 'Student or educator', family: 'education', seniority: 'student', synonyms: ['teacher', 'professor'] },
  { code: 'RL-11', label: 'Owner / Founder', family: 'leadership', seniority: 'owner_exec' },
  { code: 'RL-12', label: 'Innovation or R&D director', family: 'design', seniority: 'director', synonyms: ['research and development'] },
  { code: 'RL-13', label: 'Concept design lead', family: 'design', seniority: 'manager_lead' },
  { code: 'RL-14', label: 'Concept designer', family: 'design', seniority: 'individual' },
  { code: 'RL-15', label: 'Design researcher', family: 'design', seniority: 'individual', synonyms: ['ux research'] },
  { code: 'RL-16', label: 'Strategist', family: 'design', seniority: 'individual' },
  { code: 'RL-17', label: 'Concept artist / illustrator', family: 'creative_production', seniority: 'individual' },
  { code: 'RL-18', label: 'Model maker / prototyper', family: 'operations_production', seniority: 'individual', synonyms: ['prototype'] },
  { code: 'RL-19', label: 'Inventor / entrepreneur', family: 'leadership', seniority: 'owner_exec' },
  { code: 'RL-20', label: 'Owner / President / CEO', family: 'leadership', seniority: 'owner_exec' },
  { code: 'RL-21', label: 'VP or Director of engineering', family: 'engineering', seniority: 'director' },
  { code: 'RL-22', label: 'Engineering manager', family: 'engineering', seniority: 'manager_lead' },
  { code: 'RL-23', label: 'Mechanical / design engineer', family: 'engineering', seniority: 'individual' },
  { code: 'RL-24', label: 'Electrical engineer', family: 'engineering', seniority: 'individual', synonyms: ['pcb', 'electronics'] },
  { code: 'RL-25', label: 'Program / project manager', family: 'project_management', seniority: 'manager_lead' },
  { code: 'RL-26', label: 'Quality / regulatory', family: 'quality', seniority: 'individual', synonyms: ['qa', 'compliance'] },
  { code: 'RL-27', label: 'Procurement / sourcing', family: 'procurement', seniority: 'individual', synonyms: ['purchasing', 'buyer'] },
  { code: 'RL-28', label: 'Owner / President / GM', family: 'leadership', seniority: 'owner_exec', synonyms: ['general manager'] },
  { code: 'RL-29', label: 'Plant or operations manager', family: 'operations_production', seniority: 'manager_lead' },
  { code: 'RL-30', label: 'Manufacturing / process engineer', family: 'engineering', seniority: 'individual' },
  { code: 'RL-31', label: 'Tooling / mold engineer', family: 'engineering', seniority: 'individual', synonyms: ['molding', 'moulding', 'mould', 'injection', 'die'] },
  { code: 'RL-32', label: 'Quality engineer / inspector', family: 'quality', seniority: 'individual', synonyms: ['qa', 'qc', 'cmm'] },
  { code: 'RL-33', label: 'CNC programmer / machinist', family: 'operations_production', seniority: 'individual', synonyms: ['machining', 'cam'] },
  { code: 'RL-34', label: 'Estimator / sales engineer', family: 'sales_estimating', seniority: 'individual', synonyms: ['quoting', 'sales'] },
  { code: 'RL-35', label: 'Project / program manager', family: 'project_management', seniority: 'manager_lead' },
  { code: 'RL-36', label: 'Procurement / supply chain', family: 'procurement', seniority: 'individual', synonyms: ['purchasing', 'buyer'] },
  { code: 'RL-37', label: 'Principal / Partner', family: 'leadership', seniority: 'owner_exec' },
  { code: 'RL-38', label: 'Associate / Studio director', family: 'design', seniority: 'director' },
  { code: 'RL-39', label: 'Project architect', family: 'design', seniority: 'manager_lead' },
  { code: 'RL-40', label: 'Architect', family: 'design', seniority: 'individual' },
  { code: 'RL-41', label: 'Designer / intern architect', family: 'design', seniority: 'individual' },
  { code: 'RL-42', label: 'Engineer (structural, MEP, civil)', family: 'engineering', seniority: 'individual' },
  { code: 'RL-43', label: 'BIM / CAD manager', family: 'engineering', seniority: 'manager_lead', synonyms: ['revit'] },
  { code: 'RL-44', label: 'Drafter / technologist', family: 'design', seniority: 'individual', synonyms: ['draftsperson', 'cad'] },
  { code: 'RL-45', label: 'Project manager', family: 'project_management', seniority: 'manager_lead', synonyms: ['pm'] },
  { code: 'RL-46', label: 'Principal / Owner', family: 'leadership', seniority: 'owner_exec' },
  { code: 'RL-47', label: 'Design director', family: 'design', seniority: 'director' },
  { code: 'RL-48', label: 'Senior interior designer', family: 'design', seniority: 'individual' },
  { code: 'RL-49', label: 'Interior designer', family: 'design', seniority: 'individual' },
  { code: 'RL-50', label: 'Junior designer / design assistant', family: 'design', seniority: 'individual' },
  { code: 'RL-51', label: 'FF&E specialist', family: 'design', seniority: 'individual', synonyms: ['furniture', 'fixtures'] },
  { code: 'RL-52', label: 'Kitchen and bath designer', family: 'design', seniority: 'individual' },
  { code: 'RL-53', label: 'Procurement', family: 'procurement', seniority: 'individual', synonyms: ['purchasing'] },
  { code: 'RL-54', label: 'Owner / President', family: 'leadership', seniority: 'owner_exec' },
  { code: 'RL-55', label: 'Operations director / Project executive', family: 'operations_production', seniority: 'director' },
  { code: 'RL-56', label: 'Superintendent / site manager', family: 'operations_production', seniority: 'manager_lead', synonyms: ['foreman'] },
  { code: 'RL-57', label: 'Project engineer / coordinator', family: 'project_management', seniority: 'individual' },
  { code: 'RL-58', label: 'Estimator / preconstruction', family: 'sales_estimating', seniority: 'individual', synonyms: ['quoting', 'preconstruction'] },
  { code: 'RL-59', label: 'VDC / BIM manager', family: 'engineering', seniority: 'manager_lead', synonyms: ['revit', 'navisworks'] },
  { code: 'RL-60', label: 'Shop drawing detailer', family: 'design', seniority: 'individual', synonyms: ['millwork', 'shop drawings', 'detailing'] },
  { code: 'RL-61', label: "Developer / owner's rep", family: 'leadership', seniority: 'director', synonyms: ['real estate'] },
  { code: 'RL-62', label: 'Creative director', family: 'creative_production', seniority: 'director' },
  { code: 'RL-63', label: 'Art director', family: 'creative_production', seniority: 'manager_lead' },
  { code: 'RL-64', label: 'Producer / project manager', family: 'project_management', seniority: 'manager_lead' },
  { code: 'RL-65', label: 'Designer', family: 'design', seniority: 'individual', synonyms: ['graphic designer'] },
  { code: 'RL-66', label: '3D artist / visualizer', family: 'creative_production', seniority: 'individual', synonyms: ['render', 'cgi'] },
  { code: 'RL-67', label: 'Animator / motion designer', family: 'creative_production', seniority: 'individual', synonyms: ['motion graphics'] },
  { code: 'RL-68', label: 'Editor / colorist', family: 'creative_production', seniority: 'individual', synonyms: ['colourist', 'post-production'] },
  { code: 'RL-69', label: 'Photographer', family: 'creative_production', seniority: 'individual' },
  { code: 'RL-70', label: 'Account / client manager', family: 'sales_estimating', seniority: 'manager_lead' },
  { code: 'RL-71', label: 'Marketing', family: 'marketing', seniority: 'individual' },
  { code: 'RL-99', label: 'Other', family: 'other', seniority: null },
];

/** The secondary pillars (VIZ, GRD, VID, PHO) share one list. */
const SECONDARY_ROLES = [
  'RL-11', 'RL-62', 'RL-63', 'RL-64', 'RL-65', 'RL-66', 'RL-67', 'RL-68', 'RL-69', 'RL-70', 'RL-71', 'RL-10', 'RL-99',
] as const;

/** Most senior first; each ends with Other (source doc, Field 6). */
export const ROLE_LISTS: Readonly<Record<Exclude<IndustryCode, 'OTH'>, readonly string[]>> = {
  IND: ['RL-01', 'RL-02', 'RL-03', 'RL-04', 'RL-05', 'RL-06', 'RL-07', 'RL-08', 'RL-09', 'RL-10', 'RL-99'],
  CON: ['RL-11', 'RL-12', 'RL-13', 'RL-14', 'RL-15', 'RL-16', 'RL-17', 'RL-18', 'RL-08', 'RL-19', 'RL-10', 'RL-99'],
  PRD: ['RL-20', 'RL-21', 'RL-22', 'RL-23', 'RL-24', 'RL-04', 'RL-08', 'RL-25', 'RL-26', 'RL-27', 'RL-10', 'RL-99'],
  MFG: ['RL-28', 'RL-29', 'RL-22', 'RL-30', 'RL-31', 'RL-32', 'RL-33', 'RL-34', 'RL-35', 'RL-36', 'RL-10', 'RL-99'],
  ARC: ['RL-37', 'RL-38', 'RL-39', 'RL-40', 'RL-41', 'RL-42', 'RL-43', 'RL-44', 'RL-45', 'RL-10', 'RL-99'],
  INT: ['RL-46', 'RL-47', 'RL-48', 'RL-49', 'RL-50', 'RL-51', 'RL-52', 'RL-45', 'RL-53', 'RL-10', 'RL-99'],
  CST: ['RL-54', 'RL-55', 'RL-45', 'RL-56', 'RL-57', 'RL-58', 'RL-59', 'RL-60', 'RL-61', 'RL-10', 'RL-99'],
  VIZ: SECONDARY_ROLES,
  GRD: SECONDARY_ROLES,
  VID: SECONDARY_ROLES,
  PHO: SECONDARY_ROLES,
};

export const REVIEWERS: readonly Reviewer[] = [
  { id: 'rv-internal', code: 'ER-INTERNAL', label: 'Internal team' },
  { id: 'rv-clients', code: 'ER-CLIENT', label: 'Clients' },
  { id: 'rv-customers', code: 'ER-CLIENT', label: 'Customers' },
  { id: 'rv-building-owners', code: 'ER-CLIENT', label: 'Clients / building owners' },
  { id: 'rv-engineers', code: 'ER-ENGINEER', label: 'Engineers' },
  { id: 'rv-mep-consultants', code: 'ER-ENGINEER', label: 'Structural or MEP consultants' },
  { id: 'rv-manufacturers', code: 'ER-MANUFACTURER', label: 'Manufacturers / factories' },
  { id: 'rv-contract-manufacturers', code: 'ER-MANUFACTURER', label: 'Contract manufacturers / factories' },
  { id: 'rv-prototype-shops', code: 'ER-MANUFACTURER', label: 'Prototype shops' },
  { id: 'rv-suppliers', code: 'ER-SUPPLIER', label: 'Suppliers / vendors' },
  { id: 'rv-printers', code: 'ER-SUPPLIER', label: 'Printers / vendors' },
  { id: 'rv-toolmakers', code: 'ER-TOOLING', label: 'Toolmakers / mold shops' },
  { id: 'rv-quality', code: 'ER-QUALITY', label: 'Quality / inspection partners' },
  { id: 'rv-general-contractors', code: 'ER-CONTRACTOR', label: 'General contractors' },
  { id: 'rv-subcontractors', code: 'ER-CONTRACTOR', label: 'Subcontractors / trades' },
  { id: 'rv-fabricators', code: 'ER-FABRICATOR', label: 'Fabricators / millwork' },
  { id: 'rv-authorities', code: 'ER-AUTHORITY', label: 'Permitting authorities' },
  { id: 'rv-agencies', code: 'ER-AGENCY', label: 'Agencies' },
  { id: 'rv-freelancers', code: 'ER-FREELANCE', label: 'Talent / freelancers' },
  { id: 'rv-leadership', code: 'ER-LEADERSHIP', label: 'Investors / leadership' },
];

export const REVIEWER_LISTS: Readonly<Record<ParentSegment, readonly string[]>> = {
  ID: ['rv-internal', 'rv-clients', 'rv-engineers', 'rv-manufacturers', 'rv-prototype-shops', 'rv-leadership'],
  PD: ['rv-internal', 'rv-customers', 'rv-suppliers', 'rv-contract-manufacturers', 'rv-toolmakers', 'rv-quality', 'rv-leadership'],
  AC: ['rv-internal', 'rv-building-owners', 'rv-mep-consultants', 'rv-general-contractors', 'rv-subcontractors', 'rv-fabricators', 'rv-authorities', 'rv-leadership'],
  GV: ['rv-internal', 'rv-clients', 'rv-agencies', 'rv-freelancers', 'rv-printers', 'rv-leadership'],
};

export const FILE_GROUP_LABELS: Readonly<Record<FileGroup, string>> = {
  '3d_cad': '3D CAD',
  '3d_mesh': '3D models and mesh',
  '2d_docs': '2D drawings and documents',
  bim: 'BIM',
  images: 'Images and renders',
  video: 'Video',
};

/** Group order per parent segment; `default` is for Other and the Role-only page. */
export const FILE_GROUP_ORDER: Readonly<Record<ParentSegment | 'default', readonly FileGroup[]>> = {
  ID: ['3d_cad', '3d_mesh', '2d_docs', 'bim', 'images', 'video'],
  PD: ['3d_cad', '3d_mesh', '2d_docs', 'bim', 'images', 'video'],
  AC: ['2d_docs', 'bim', '3d_cad', '3d_mesh', 'images', 'video'],
  GV: ['images', 'video', '3d_mesh', '3d_cad', '2d_docs', 'bim'],
  default: ['3d_cad', '3d_mesh', '2d_docs', 'bim', 'images', 'video'],
};

export const FILE_TYPES: readonly FileType[] = [
  { code: 'FT-STEP', group: '3d_cad', label: 'STEP (.step, .stp)', extensions: ['step', 'stp'] },
  { code: 'FT-IGES', group: '3d_cad', label: 'IGES (.iges, .igs)', extensions: ['iges', 'igs'] },
  { code: 'FT-SLDPRT', group: '3d_cad', label: 'SolidWorks part (.sldprt)', extensions: ['sldprt'], synonyms: ['solidworks'] },
  { code: 'FT-BREP', group: '3d_cad', label: 'BREP (.brep)', extensions: ['brep'] },
  { code: 'FT-3DM', group: '3d_cad', label: 'Rhino (.3dm)', extensions: ['3dm'] },
  { code: 'FT-SLDASM', group: '3d_cad', label: 'SolidWorks assembly (.sldasm)', extensions: ['sldasm'], synonyms: ['solidworks'] },
  { code: 'FT-PARASOLID', group: '3d_cad', label: 'Parasolid (.x_t)', extensions: ['x_t', 'x_b'] },
  { code: 'FT-NATIVE-CAD', group: '3d_cad', label: 'Fusion 360, Inventor, CATIA, Creo or NX files', extensions: ['f3d', 'ipt', 'iam', 'catpart', 'catproduct', 'prt', 'asm'], synonyms: ['siemens', 'autodesk', 'dassault'] },
  { code: 'FT-GLB', group: '3d_mesh', label: 'GLB / glTF (.glb, .gltf)', extensions: ['glb', 'gltf'] },
  { code: 'FT-FBX', group: '3d_mesh', label: 'FBX (.fbx)', extensions: ['fbx'] },
  { code: 'FT-OBJ', group: '3d_mesh', label: 'OBJ (.obj)', extensions: ['obj'] },
  { code: 'FT-STL', group: '3d_mesh', label: 'STL (.stl)', extensions: ['stl'], synonyms: ['3d print'] },
  { code: 'FT-3MF', group: '3d_mesh', label: '3MF (.3mf)', extensions: ['3mf'] },
  { code: 'FT-PLY', group: '3d_mesh', label: 'PLY (.ply)', extensions: ['ply'], synonyms: ['scan'] },
  { code: 'FT-3DS', group: '3d_mesh', label: '3DS (.3ds)', extensions: ['3ds'] },
  { code: 'FT-DAE', group: '3d_mesh', label: 'Collada (.dae)', extensions: ['dae'] },
  { code: 'FT-USD', group: '3d_mesh', label: 'USDZ / USD (.usdz, .usda)', extensions: ['usdz', 'usd', 'usda', 'usdc'] },
  { code: 'FT-DWG', group: '2d_docs', label: 'DWG (.dwg)', extensions: ['dwg'], synonyms: ['autocad'] },
  { code: 'FT-DXF', group: '2d_docs', label: 'DXF (.dxf)', extensions: ['dxf'] },
  { code: 'FT-PDF', group: '2d_docs', label: 'PDF (.pdf)', extensions: ['pdf'] },
  { code: 'FT-SVG', group: '2d_docs', label: 'SVG (.svg)', extensions: ['svg'] },
  { code: 'FT-BIM', group: 'bim', label: 'IFC, Revit (.rvt) or SketchUp (.skp)', extensions: ['ifc', 'rvt', 'skp'] },
  { code: 'FT-JPG', group: 'images', label: 'JPG (.jpg)', extensions: ['jpg', 'jpeg'] },
  { code: 'FT-PNG', group: 'images', label: 'PNG (.png)', extensions: ['png'] },
  { code: 'FT-WEBP', group: 'images', label: 'WEBP (.webp)', extensions: ['webp'] },
  { code: 'FT-PSD-TIFF', group: 'images', label: 'PSD or TIFF', extensions: ['psd', 'tif', 'tiff'], synonyms: ['photoshop'] },
  { code: 'FT-MP4', group: 'video', label: 'MP4 (.mp4)', extensions: ['mp4'] },
  { code: 'FT-MOV', group: 'video', label: 'MOV (.mov)', extensions: ['mov'], synonyms: ['quicktime'] },
  { code: 'FT-99', group: null, label: 'Other (please specify)', extensions: [] },
];
