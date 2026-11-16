/**
 * Rules for the /welcome wizard (spec 2026-11-16-welcome-wizard-design.md).
 * Pure: no React, no I/O. The server's validateProfile stays the authority on
 * submit; this only decides what the UI lets you continue past.
 */
import { CLIENT_MODELS, PILLARS, ROLES, SIZE_BANDS } from './catalog.ts';
import { businessTypesFor, isOtherSegment } from './profile.ts';

export const STEPS = ['pillar', 'business_type', 'client_model', 'company_size', 'role'] as const;
export type StepName = (typeof STEPS)[number];

export interface WizardAnswers {
  pillar: string;
  segmentId: string;
  businessTypeOther: string;
  clientModel: string;
  companySizeBand: string;
  role: string;
}

export function canContinue(step: number, a: WizardAnswers): boolean {
  switch (STEPS[step]) {
    case 'pillar':
      return PILLARS.some((p) => p.id === a.pillar);
    case 'business_type':
      if (!businessTypesFor(a.pillar).some((t) => t.id === a.segmentId)) return false;
      return !isOtherSegment(a.segmentId) || a.businessTypeOther.trim().length > 0;
    case 'client_model':
      return CLIENT_MODELS.some((c) => c.id === a.clientModel);
    case 'company_size':
      return SIZE_BANDS.some((s) => s.id === a.companySizeBand);
    case 'role':
      return ROLES.some((r) => r.id === a.role);
    default:
      return false;
  }
}

const FIELD_STEP: Record<string, number> = {
  pillar: 0, segmentId: 1, businessTypeOther: 1, clientModel: 2, companySizeBand: 3, role: 4,
};

export function stepForField(field: string): number | null {
  return field in FIELD_STEP ? FIELD_STEP[field] : null;
}

export function letterFor(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 'a'/'A' → 0 … ; null for anything that is not a single letter within range. */
export function indexForKey(key: string, optionCount: number): number | null {
  if (key.length !== 1) return null;
  const i = key.toUpperCase().charCodeAt(0) - 65;
  return i >= 0 && i < optionCount && i < 26 ? i : null;
}

/** The stored code for a step — what the analytics event carries. Never free text. */
export function stepValue(step: number, a: WizardAnswers): string {
  return [a.pillar, a.segmentId, a.clientModel, a.companySizeBand, a.role][step] ?? '';
}
