'use client';

import { useEffect, useState } from 'react';
import { SettingsCard, SettingsShell } from '@/components/settings/SettingsShell';
import { ACCOUNT_RAIL } from '@/components/settings/accountRail';
import { useToast } from '@/components/ui/Toast';
import OnboardingForm from '@/components/welcome/OnboardingForm';
import { EMPTY_FORM, FIELD_ERRORS, toRequestBody, type FormValues } from '@/lib/kyc/form';

const LOGIN_URL = `/login?callbackUrl=${encodeURIComponent('/settings/company')}`;
const linkClass = 'font-bold text-stiko-primary';

/** The company answers, editable. Each save adds a history row (spec §7). */
export default function CompanySettings() {
  const { toast } = useToast();
  // The form reads `initial` once on mount, so it only mounts after the GET resolves.
  const [initial, setInitial] = useState<FormValues | null>(null);
  const [prefill, setPrefill] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<{ field: string | null; message: string } | null>(null);

  const load = () => {
    setLoadError(false);
    fetch('/api/welcome')
      .then((r) => {
        if (r.status === 401) {
          window.location.assign(LOGIN_URL);
          return null;
        }
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((s) => {
        if (!s) return;
        setPrefill(typeof s.prefillWebsite === 'string' ? s.prefillWebsite : '');
        // No v2 profile yet (e.g. a reviewer): an empty form, and saving it is how they answer.
        setInitial({ ...EMPTY_FORM, ...(s.current ?? {}) });
      })
      // Never fall back to an empty form here: saving it would overwrite good answers with a new row.
      .catch(() => setLoadError(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const save = async (values: FormValues) => {
    setSaving(true);
    setServerError(null);
    try {
      const res = await fetch('/api/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...toRequestBody(values, 'company'), source: 'settings' }),
      });
      const data = await res.json().catch(() => ({}));
      setSaving(false);
      if (res.ok) {
        toast('Company profile saved');
        setInitial(values);
        setFormKey((k) => k + 1);
        return;
      }
      if (res.status === 401) {
        window.location.assign(LOGIN_URL);
        return;
      }
      if (res.status === 409) {
        setServerError({ field: null, message: 'Your account changed since this page loaded. Reload the page and try again.' });
        return;
      }
      // Only a field the form knows is a field; anything else (e.g. 'kind') shows in the banner.
      const field =
        typeof data.field === 'string' && Object.prototype.hasOwnProperty.call(FIELD_ERRORS, data.field) ? data.field : null;
      setServerError({
        field,
        message: (field && FIELD_ERRORS[field as keyof typeof FIELD_ERRORS]) || 'Could not save. Try again.',
      });
    } catch {
      setSaving(false);
      setServerError({ field: null, message: 'Could not save. Check your connection and try again.' });
    }
  };

  return (
    <SettingsShell crumbs={[{ label: 'Settings' }, { label: 'Company' }]} railLabel="Account" items={ACCOUNT_RAIL} active="company">
      <SettingsCard heading="Company" description="What your company does and who reviews your work. Changes keep a history.">
        {!initial && !loadError && (
          <p role="status" className="text-[13.5px] text-stiko-muted">Loading…</p>
        )}
        {loadError && (
          <p role="alert" className="text-[13.5px] text-stiko-muted">
            Could not load your company profile.{' '}
            <button type="button" onClick={load} className={linkClass}>Try again</button>
          </p>
        )}
        {initial && (
          <OnboardingForm
            key={formKey}
            variant="company"
            initial={initial}
            prefillWebsite={prefill}
            submitLabel="Save changes"
            showMarketing={false}
            saving={saving}
            serverError={serverError}
            onSubmit={save}
            onEdit={() => serverError && setServerError(null)}
          />
        )}
      </SettingsCard>
    </SettingsShell>
  );
}
