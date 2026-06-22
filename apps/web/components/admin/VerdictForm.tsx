'use client';
import { useState } from 'react';
import { t, type Locale } from '@athanor/i18n';
import { submitVerdict } from '@/app/admin/reports/[id]/actions';

/**
 * VerdictForm — client component that submits to the submitVerdict server action.
 *
 * Next 16 boundary: submitVerdict lives in a dedicated 'use server' file and is
 * imported directly into this client component. This is the documented Next 16
 * pattern (use-server.md §"Using Server Functions in a Client Component") —
 * direct import from a 'use server' file is correct; prop-passing from the server
 * page is not required.
 *
 * locale is threaded as a prop from the server page (same pattern as Task 7
 * ReportRow / StatusTabs) so the server page controls the locale, not the client.
 */
export function VerdictForm({ reportId, locale }: { reportId: string; locale: Locale }) {
  const [verdict, setVerdict] = useState<'dismiss' | 'uphold'>('dismiss');
  return (
    <form
      action={submitVerdict}
      className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4"
    >
      <input type="hidden" name="reportId" value={reportId} />
      <fieldset className="flex gap-4">
        <legend className="mb-2 font-semibold">{t('admin.verdict.title', locale)}</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="verdict"
            value="dismiss"
            checked={verdict === 'dismiss'}
            onChange={() => setVerdict('dismiss')}
          />
          {t('admin.verdict.dismiss', locale)}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="verdict"
            value="uphold"
            checked={verdict === 'uphold'}
            onChange={() => setVerdict('uphold')}
          />
          {t('admin.verdict.uphold', locale)}
        </label>
      </fieldset>
      {verdict === 'uphold' && (
        <label className="flex flex-col gap-1">
          <span>{t('admin.verdict.severity', locale)}</span>
          <select
            name="severity"
            required
            className="rounded-[14px] border border-border bg-background px-3 py-2"
          >
            <option value="low">{t('admin.severity.low', locale)}</option>
            <option value="medium">{t('admin.severity.medium', locale)}</option>
            <option value="high">{t('admin.severity.high', locale)}</option>
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span>{t('admin.verdict.resolution', locale)}</span>
        <textarea
          name="resolution"
          required
          maxLength={2000}
          placeholder={t('admin.verdict.resolutionPlaceholder', locale)}
          className="min-h-24 rounded-[14px] border border-border bg-background px-3 py-2"
        />
      </label>
      <button type="submit" className="rounded-[14px] bg-aura px-4 py-3 font-semibold text-on-aura">
        {t('admin.verdict.submit', locale)}
      </button>
    </form>
  );
}
