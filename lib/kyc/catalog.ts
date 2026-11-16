/**
 * The KYC questionnaire's options, from the marketing co-founder's sheet
 * (stiko-kyc-business-types-v3.xlsx: Business Types + KYC Fields tabs).
 *
 * IDs are what gets stored, in Postgres and in PostHog. Labels are display only
 * and may be reworded freely. To retire an option, delete it here and never
 * reuse its ID. Review "Other" answers monthly (sheet, "How to use" step 4).
 *
 * Pure data, no imports: loaded by node --test and by the client bundle.
 */

export type PillarId = 'ID' | 'PD' | 'AC' | 'GV';
export type Track = 'prosumer' | 'small_team' | 'mid_team' | 'large_team';

export interface Option<T extends string = string> {
  id: T;
  label: string;
}
export interface Pillar extends Option<PillarId> {
  priority: 'priority' | 'secondary';
}
export interface BusinessType {
  id: string;
  pillar: PillarId;
  label: string;
  helper: string;
}
export interface SizeBand extends Option {
  track: Track;
}

export const PILLARS: readonly Pillar[] = [
  { id: 'ID', label: 'Industrial Design & Concept Development', priority: 'priority' },
  { id: 'PD', label: 'Product Development & Manufacturing', priority: 'priority' },
  { id: 'AC', label: 'Architecture, Interior & Construction', priority: 'priority' },
  { id: 'GV', label: 'Graphic Design, Video & Photography', priority: 'secondary' },
];

export const BUSINESS_TYPES: readonly BusinessType[] = [
  { id: "ID-01", pillar: "ID", label: "Industrial design studio or agency", helper: "We design products for client brands" },
  { id: "ID-02", pillar: "ID", label: "Product design and engineering firm", helper: "We take client products from concept to production-ready CAD" },
  { id: "ID-03", pillar: "ID", label: "Consumer electronics company", helper: "Audio, wearables, smart home, accessories, small appliances" },
  { id: "ID-04", pillar: "ID", label: "Furniture, lighting or home goods brand", helper: "Residential or contract furniture, lighting, housewares, decor" },
  { id: "ID-05", pillar: "ID", label: "Sporting goods, outdoor or toy company", helper: "Fitness, outdoor gear, bikes, toys, juvenile products" },
  { id: "ID-06", pillar: "ID", label: "Medical device company", helper: "Diagnostic, surgical, patient-facing or wellness devices" },
  { id: "ID-07", pillar: "ID", label: "Vehicle, e-bike or mobility company", helper: "Vehicle accessories and interiors, e-bikes, scooters, marine, RV" },
  { id: "ID-08", pillar: "ID", label: "Tools or industrial products company", helper: "Power tools, equipment housings, robotics, cleantech hardware" },
  { id: "ID-09", pillar: "ID", label: "Hardware startup", helper: "We are designing our first physical product" },
  { id: "ID-10", pillar: "ID", label: "3D rendering or product visualization studio", helper: "We create product renders and animations for brands" },
  { id: "ID-99", pillar: "ID", label: "Other (please specify)", helper: "Tell us what your business does" },
  { id: "PD-01", pillar: "PD", label: "Product development firm", helper: "We develop products for clients, from concept to manufacturing" },
  { id: "PD-02", pillar: "PD", label: "Engineering or DFM consultancy", helper: "Mechanical design, DFM/DFA, design reviews for clients" },
  { id: "PD-03", pillar: "PD", label: "Machinery or equipment manufacturer", helper: "Industrial, process, packaging, agricultural or food equipment" },
  { id: "PD-04", pillar: "PD", label: "Consumer product manufacturer", helper: "We design and make our own consumer products" },
  { id: "PD-05", pillar: "PD", label: "Medical device manufacturer", helper: "We manufacture regulated medical devices" },
  { id: "PD-06", pillar: "PD", label: "Automotive or aerospace parts supplier", helper: "Tier 1 / Tier 2 parts, aerospace components, specialty vehicles" },
  { id: "PD-07", pillar: "PD", label: "Machine shop or metal fabricator", helper: "CNC machining, sheet metal, welding, fabrication" },
  { id: "PD-08", pillar: "PD", label: "Injection moulding or tooling company", helper: "Injection moulding, mould making, die casting" },
  { id: "PD-09", pillar: "PD", label: "Automation or custom machine builder", helper: "Robotic cells, special-purpose machines, fixtures and tooling" },
  { id: "PD-10", pillar: "PD", label: "Hardware startup moving into production", helper: "We are working with factories to manufacture our product" },
  { id: "PD-99", pillar: "PD", label: "Other (please specify)", helper: "Tell us what your business does" },
  { id: "AC-01", pillar: "AC", label: "Residential architecture firm", helper: "Custom homes, renovations, additions" },
  { id: "AC-02", pillar: "AC", label: "Commercial architecture firm", helper: "Office, multi-family, mixed-use, hospitality, retail" },
  { id: "AC-03", pillar: "AC", label: "Residential interior design studio", helper: "Homes, condos, kitchens and baths" },
  { id: "AC-04", pillar: "AC", label: "Commercial interior design firm", helper: "Offices, hotels, restaurants, retail spaces" },
  { id: "AC-05", pillar: "AC", label: "Design-build company", helper: "We design and build projects for our clients" },
  { id: "AC-06", pillar: "AC", label: "General contractor or construction manager", helper: "Commercial and institutional construction" },
  { id: "AC-07", pillar: "AC", label: "Home builder or renovation company", helper: "Custom homes, renovations, remodelling" },
  { id: "AC-08", pillar: "AC", label: "Millwork, cabinetry or custom fabrication shop", helper: "Architectural millwork, cabinets, fixtures, steel, glass" },
  { id: "AC-09", pillar: "AC", label: "Structural or MEP engineering firm", helper: "Structural, mechanical, electrical, plumbing engineering" },
  { id: "AC-10", pillar: "AC", label: "Architectural rendering or 3D visualization studio", helper: "Renders, walkthroughs and 3D presentations for projects" },
  { id: "AC-99", pillar: "AC", label: "Other (please specify)", helper: "Tell us what your business does" },
  { id: "GV-01", pillar: "GV", label: "Branding or graphic design agency", helper: "Brand identity, graphic design, print and digital design" },
  { id: "GV-02", pillar: "GV", label: "Advertising agency", helper: "Campaign creative across print, digital and video" },
  { id: "GV-03", pillar: "GV", label: "Video production company", helper: "Commercial, corporate and branded video" },
  { id: "GV-04", pillar: "GV", label: "Post-production or editing studio", helper: "Editing, colour grading, finishing" },
  { id: "GV-05", pillar: "GV", label: "Animation or motion graphics studio", helper: "2D/3D animation, motion design, explainer videos" },
  { id: "GV-06", pillar: "GV", label: "Photography studio", helper: "Product, lifestyle, e-commerce or commercial photography" },
  { id: "GV-07", pillar: "GV", label: "Packaging design agency", helper: "Packaging graphics, labels, dielines" },
  { id: "GV-08", pillar: "GV", label: "Social media or content agency", helper: "Social content and campaigns at volume" },
  { id: "GV-09", pillar: "GV", label: "Web and digital design agency", helper: "Websites, landing pages, digital campaigns" },
  { id: "GV-10", pillar: "GV", label: "3D or AR studio for e-commerce", helper: "3D product models, configurators, AR experiences" },
  { id: "GV-99", pillar: "GV", label: "Other (please specify)", helper: "Tell us what your business does" },
];

export const CLIENT_MODELS: readonly Option[] = [
  { id: 'clients', label: 'Clients (we are a service provider)' },
  { id: 'own', label: 'Our own products or projects' },
  { id: 'both', label: 'Both' },
];

/** The sheet's "1-4" is split into "Just me" and "2-4" (engineering plan, Four segments). */
export const SIZE_BANDS: readonly SizeBand[] = [
  { id: 'just_me', label: 'Just me', track: 'prosumer' },
  { id: '2-4', label: '2-4', track: 'small_team' },
  { id: '5-9', label: '5-9', track: 'mid_team' },
  { id: '10-24', label: '10-24', track: 'mid_team' },
  { id: '25-49', label: '25-49', track: 'mid_team' },
  { id: '50-99', label: '50-99', track: 'large_team' },
  { id: '100-249', label: '100-249', track: 'large_team' },
  { id: '250+', label: '250+', track: 'large_team' },
];

export const ROLES: readonly Option[] = [
  { id: 'owner', label: 'Owner / Principal / Founder' },
  { id: 'design_lead', label: 'Design lead / Creative director' },
  { id: 'designer', label: 'Designer' },
  { id: 'engineer', label: 'Engineer' },
  { id: 'architect', label: 'Architect' },
  { id: 'interior_designer', label: 'Interior designer' },
  { id: 'project_manager', label: 'Project manager' },
  { id: 'operations', label: 'Operations / Production' },
  { id: 'procurement', label: 'Procurement / Sourcing' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'other', label: 'Other' },
];

/** Business types whose ID ends in this suffix are "Other (please specify)". */
export const OTHER_SUFFIX = '-99';
export const OTHER_TEXT_MAX = 120;
