import { localeTag, t, type Locale } from '@athanor/i18n';
import type { AdminReportedMessage } from '@athanor/api';

/**
 * The evidence block on a `target_type = 'message'` report (#574).
 *
 * What it renders is the whole of what a moderator may see of a private 1:1 exchange: the one
 * message a report names, and that message's image. #97's ruling (2026-08-30) drew that line —
 * «the admin read path never reaches the surrounding conversation or the thread» — and the
 * database enforces it (`messages_select_reported` / `chat-media_select_reported`,
 * 20260831153525) rather than this component. The scope sentence below is therefore not a
 * disclaimer: it tells the reader what they are looking at, and what they are not.
 *
 * Absence is rendered, never elided. `reports.target_id` has no FK, so an erased or
 * soft-deleted message leaves a report pointing at nothing — and a verdict page that simply
 * showed no evidence box would be indistinguishable from one where nobody had attached any.
 */
export function ReportedMessage({
  message,
  imageUrl,
  locale,
}: {
  message: AdminReportedMessage | null;
  /** Short-lived signed URL for `message.media_url`, minted per render by the page. */
  imageUrl?: string;
  locale: Locale;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4">
      <header className="flex flex-col gap-1">
        <h2 className="font-semibold">{t('admin.report.evidence', locale)}</h2>
        <p className="text-xs text-muted-foreground">{t('admin.report.evidenceScope', locale)}</p>
      </header>
      {message === null ? (
        <p className="text-sm text-muted-foreground">{t('admin.report.evidenceGone', locale)}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {message.sender_handle ? `@${message.sender_handle} · ` : ''}
            {new Date(message.created_at).toLocaleString(localeTag(locale))}
          </p>
          {message.media_url ? (
            imageUrl ? (
              /* Plain <img>, same reasoning as public-dream-view: the src is a short-lived
                 SIGNED url against the private chat-media bucket, so the next/image optimizer
                 would cache-miss on every re-sign and cost a Worker round-trip for nothing. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={t('admin.report.evidenceImage', locale)}
                className="max-h-96 w-auto max-w-full rounded-[10px] border border-border object-contain"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('admin.report.evidenceImageGone', locale)}
              </p>
            )
          ) : null}
          {message.body ? <p className="whitespace-pre-wrap text-sm">{message.body}</p> : null}
        </>
      )}
    </section>
  );
}
