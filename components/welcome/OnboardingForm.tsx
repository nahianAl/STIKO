'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import { ErrorBanner, Input } from '@/components/ui/Primitives';
import ComboSelect, { type ComboOption } from '@/components/welcome/ComboSelect';
import {
  INDUSTRIES, MARKETS, MAX_MARKETS, OTHER_FILE_TYPE, OTHER_INDUSTRY, OTHER_MARKET, OTHER_ROLE, OTHER_TEXT_MAX,
  SIZE_BANDS,
} from '@/lib/kyc/catalog';
import {
  clientModelsFor, fileTypeGroupsFor, reviewTeamBandsFor, reviewersFor, rolesFor,
  type CompanyField, type RoleField, type SubmitKind,
} from '@/lib/kyc/profile';
import { FIELD_ERRORS, fieldDomId, firstInvalidField, withCompanySize, withIndustry, type FormValues } from '@/lib/kyc/form';

/** One labelled question: the label is the question, helper text sits under it. */
function Question({
  field, label, helper, optional, error, children,
}: {
  field: CompanyField | RoleField; label: string; helper?: string; optional?: boolean; error?: string | null; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <span id={`${fieldDomId(field)}-label`} className="text-[13.5px] font-bold text-stiko-ink">
        {label}
        {optional && <span className="ml-1 font-medium text-stiko-faint">(optional)</span>}
      </span>
      {helper && <span className="-mt-[3px] text-[12px] text-stiko-muted">{helper}</span>}
      {children}
      {error && <span role="alert" className="text-[12px] font-semibold text-note-red-text">{error}</span>}
    </div>
  );
}

export default function OnboardingForm({
  variant, initial, prefillWebsite, submitLabel, showMarketing, saving, serverError, onSubmit,
}: {
  variant: SubmitKind;
  initial: FormValues;
  prefillWebsite: string;
  submitLabel: string;
  showMarketing: boolean;
  saving: boolean;
  serverError: { field: string | null; message: string } | null;
  onSubmit: (values: FormValues) => void;
}) {
  const [v, setV] = useState<FormValues>(() =>
    initial.website || initial.noWebsite || !prefillWebsite ? initial : { ...initial, website: prefillWebsite }
  );
  const company = variant !== 'role';
  const askRole = variant !== 'company';
  const invalid = firstInvalidField(v, variant);
  // A question shows the server's message when the server blamed it or its "Other" text box.
  const errorFor = (...fields: string[]) =>
    serverError?.field && fields.includes(serverError.field) ? serverError.message : null;

  // The server named a field: take the person to it.
  useEffect(() => {
    if (serverError?.field) document.getElementById(fieldDomId(serverError.field as CompanyField | RoleField))?.focus();
  }, [serverError]);

  const ids = (f: CompanyField | RoleField) => ({ id: fieldDomId(f), labelId: `${fieldDomId(f)}-label` });
  const industryOptions: ComboOption[] = INDUSTRIES.map((i) => ({ id: i.code, label: i.label, helper: i.helper, synonyms: i.synonyms }));
  const marketOptions: ComboOption[] = MARKETS.map((m) => ({ id: m.code, label: m.label, group: m.group || undefined, synonyms: m.synonyms }));
  const clientOptions: ComboOption[] = clientModelsFor(v.industry || null).map((c) => ({ id: c.code, label: c.label, helper: c.helper }));
  const sizeOptions: ComboOption[] = SIZE_BANDS.map((b) => ({ id: b.code, label: b.label }));
  const rtOptions: ComboOption[] = reviewTeamBandsFor(v.companySize || null).map((b) => ({ id: b.code, label: b.label }));
  const roleIndustry = variant === 'role' ? null : v.industry || null;
  const roleOptions: ComboOption[] = useMemo(
    () => rolesFor(roleIndustry).map((r) => ({ id: r.code, label: r.label, synonyms: r.synonyms })),
    [roleIndustry]
  );
  const reviewerOptions: ComboOption[] = reviewersFor(v.industry || null).map((r) => ({ id: r.id, label: r.label }));
  const fileOptions: ComboOption[] = fileTypeGroupsFor(v.industry || null).flatMap((g) =>
    g.types.map((t) => ({ id: t.code, label: t.label, group: g.label || undefined, synonyms: t.synonyms }))
  );
  // Role and External reviewers belong to the industry (changing it clears them), so
  // wherever the industry question is asked they wait for it. The Role-only page has none.
  const needIndustryFirst = company && !v.industry;

  const set = (patch: Partial<FormValues>) => setV((cur) => ({ ...cur, ...patch }));
  const otherInput = (field: 'industryOtherText' | 'marketOtherText' | 'fileTypeOtherText' | 'roleOtherText', placeholder: string) => (
    <Input
      id={fieldDomId(field)}
      aria-label={placeholder}
      placeholder={placeholder}
      maxLength={OTHER_TEXT_MAX}
      value={v[field]}
      onChange={(e) => set({ [field]: e.target.value } as Partial<FormValues>)}
    />
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid && !saving) onSubmit(v);
      }}
      className="flex flex-col gap-5"
    >
      {company && (
        <>
          <Question field="website" label="What's your company website?" error={errorFor('website')}>
            <Input
              id={fieldDomId('website')}
              aria-labelledby={`${fieldDomId('website')}-label`}
              placeholder="yourcompany.com"
              inputMode="url"
              autoComplete="url"
              disabled={v.noWebsite}
              value={v.noWebsite ? '' : v.website}
              onChange={(e) => set({ website: e.target.value })}
            />
            <label className="flex items-center gap-2 text-[12.5px] text-stiko-secondary">
              <input
                type="checkbox"
                checked={v.noWebsite}
                onChange={(e) => set({ noWebsite: e.target.checked })}
                className="h-4 w-4 accent-stiko-primary"
              />
              We don&apos;t have a website yet
            </label>
          </Question>

          <Question field="industry" label="What industry are you in?" helper="Pick the closest match." error={errorFor('industry', 'industryOtherText')}>
            <ComboSelect {...ids('industry')} options={industryOptions} value={v.industry} onChange={(c) => setV((cur) => withIndustry(cur, c))} />
            {v.industry === OTHER_INDUSTRY && otherInput('industryOtherText', 'What industry are you in?')}
          </Question>

          <Question field="markets" label="What do you work on?" helper={`Select up to ${MAX_MARKETS}, starting with your biggest market.`} error={errorFor('markets', 'marketOtherText')}>
            <ComboSelect {...ids('markets')} multiple primaryTag max={MAX_MARKETS} searchable options={marketOptions} value={v.markets} onChange={(m) => set({ markets: m })} />
            {v.markets.includes(OTHER_MARKET) && otherInput('marketOtherText', 'Your other market')}
          </Question>

          <Question field="clientModel" label="Who do you mainly work for?" helper="Pick the one that describes most of your work." error={errorFor('clientModel')}>
            <ComboSelect {...ids('clientModel')} options={clientOptions} value={v.clientModel} onChange={(c) => set({ clientModel: c })} />
          </Question>

          <Question field="companySize" label="How many people work at your company?" error={errorFor('companySize')}>
            <ComboSelect {...ids('companySize')} options={sizeOptions} value={v.companySize} onChange={(c) => setV((cur) => withCompanySize(cur, c))} />
          </Question>

          <Question field="reviewTeamSize" label="How many people on your team review designs?" helper="Include anyone who uploads, comments or approves." error={errorFor('reviewTeamSize')}>
            <ComboSelect {...ids('reviewTeamSize')} options={rtOptions} value={v.reviewTeamSize} onChange={(c) => set({ reviewTeamSize: c })} />
          </Question>
        </>
      )}

      {askRole && (
        <Question field="role" label="What's your role?" helper="Pick the closest match." error={errorFor('role', 'roleOtherText')}>
          <ComboSelect
            {...ids('role')}
            searchable
            options={roleOptions}
            value={v.role}
            onChange={(c) => set({ role: c, roleOtherText: c === OTHER_ROLE ? v.roleOtherText : '' })}
            disabled={needIndustryFirst}
            placeholder={needIndustryFirst ? 'Pick your industry first' : 'Select…'}
          />
          {v.role === OTHER_ROLE && otherInput('roleOtherText', 'Your role')}
        </Question>
      )}

      {company && (
        <>
          <Question field="reviewers" label="Who reviews your designs?" helper="Select all that apply." optional error={errorFor('reviewers')}>
            <ComboSelect
              {...ids('reviewers')}
              multiple
              options={reviewerOptions}
              value={v.reviewers}
              onChange={(r) => set({ reviewers: r })}
              disabled={needIndustryFirst}
              placeholder={needIndustryFirst ? 'Pick your industry first' : 'Select…'}
            />
          </Question>

          <Question field="fileTypes" label="What files do you share for review?" helper="Select all that apply." optional error={errorFor('fileTypes', 'fileTypeOtherText')}>
            <ComboSelect {...ids('fileTypes')} multiple searchable options={fileOptions} value={v.fileTypes} onChange={(f) => set({ fileTypes: f })} />
            {v.fileTypes.includes(OTHER_FILE_TYPE) && otherInput('fileTypeOtherText', 'Other file type')}
          </Question>
        </>
      )}

      {showMarketing && (
        <label className="flex items-start gap-[9px] text-[12.5px] text-stiko-secondary">
          <input
            type="checkbox"
            checked={v.marketingConsent}
            onChange={(e) => set({ marketingConsent: e.target.checked })}
            className="mt-[2px] h-4 w-4 shrink-0 accent-stiko-primary"
          />
          <span>Send me product news and tips from stiko. You can unsubscribe at any time.</span>
        </label>
      )}

      {serverError && !serverError.field && <ErrorBanner>{serverError.message}</ErrorBanner>}

      <Button type="submit" disabled={Boolean(invalid) || saving} fullWidth>
        {saving ? 'Saving…' : submitLabel}
      </Button>
      {invalid && !saving && (
        <p className="-mt-3 text-center text-[11.5px] text-stiko-faint" aria-live="polite">
          {FIELD_ERRORS[invalid]}
        </p>
      )}
    </form>
  );
}
