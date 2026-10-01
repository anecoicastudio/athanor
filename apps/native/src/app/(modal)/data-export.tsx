import { useState } from 'react';
import { Linking } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { t } from '@athanor/i18n';
import { gdprKeys, requestExport } from '@athanor/api';
import { ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { useToast } from '@/components/ToastHost';
import { useExportJob } from '@/hooks/use-export-job';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';
import { Screen } from '@/components/Screen';

/**
 * GDPR data export (09 §3.5.1). Request → processing → ready, or → failed (#721), which is
 * terminal and re-requestable from the same button. A ready archive lives 7 days (#784): the link
 * is signed for the whole window and the nightly pass then deletes the archive and the row, so
 * past `expires_at` the screen says the link has expired and offers the request button again —
 * never a Download button on a dead link. The archive is assembled server-side
 * by the gdpr-export-job; BOTH terminal outcomes send a gdprExport notification that routes back
 * here — ready (#129), where the time-limited signed link is served, and failed (#721), where the
 * request button is the retry. Neutral chrome, flat cyan
 * CTA — no glow (rule #4).
 */
export default function DataExportScreen() {
  const locale = useLocale();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const [openedAt] = useState(() => Date.now());

  // Re-read on entry and on every return to the foreground: the job turns ready on a nightly
  // pass while the member is away, and a cached «Stiamo preparando» must not outlive it (#879).
  const job = useExportJob();
  // The clock the expiry is read against: the later of when the screen opened and when the row was
  // last read. Render must stay pure, so no timer — but a screen held open for days and brought
  // back to the foreground judges the fresh read by that read's time, not by a days-old open.
  // `openedAt` stays the floor: a rehydrated row carries the time of its old fetch.
  const readAt = Math.max(openedAt, job.dataUpdatedAt);
  const status = job.data?.status ?? null;
  const pending = status === 'requested' || status === 'processing';
  const expiresAt = job.data?.expires_at ? Date.parse(job.data.expires_at) : Number.NaN;
  // Past the window the row may still be there for a few hours until the nightly reap; it must not
  // read as ready. An unparseable expiry is treated as expired — the request button is the safe
  // side, a dead link is not.
  const expired = status === 'ready' && !(expiresAt > readAt);
  const ready = status === 'ready' && !!job.data?.download_url && !expired;
  // Terminal (#721): the archive could not be produced or handed over. The retry is the ordinary
  // request button below, which files a NEW job — a failed one is never re-claimed.
  const failed = status === 'failed';

  const request = useMutation({
    mutationFn: () => requestExport(supabase),
    onSuccess: () => {
      showToast(t('gdpr.export.toast', locale), 'success');
      void qc.invalidateQueries({ queryKey: gdprKeys.exportStatus() });
    },
    onError: () => showToast(t('profile.error', locale)),
  });

  return (
    <Screen {...MODAL_A11Y}>
      <ModalHeader title={t('gdpr.export.title', locale)} backLabel={t('common.back', locale)} />
      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-5 pb-12">
        <Text className="text-[15px] leading-relaxed text-muted-foreground">
          {t('gdpr.export.sub', locale)}
        </Text>

        {pending ? (
          <View className="rounded-card border border-hair bg-raise p-5">
            <Text className="text-[14px] leading-relaxed text-muted-foreground">
              {t('gdpr.export.processing', locale)}
            </Text>
          </View>
        ) : null}

        {failed ? (
          <View className="rounded-card border border-hair bg-raise p-5">
            <Text className="text-[14px] leading-relaxed text-muted-foreground">
              {t('gdpr.export.failed', locale)}
            </Text>
          </View>
        ) : null}

        {expired ? (
          <View className="rounded-card border border-hair bg-raise p-5">
            <Text className="text-[14px] leading-relaxed text-muted-foreground">
              {t('gdpr.export.expired', locale)}
            </Text>
          </View>
        ) : null}

        {ready ? (
          <View className="gap-3 rounded-card border border-hair bg-raise p-5">
            <Text className="text-base text-foreground">{t('gdpr.export.ready', locale)}</Text>
            <Button
              variant="light"
              label={t('gdpr.export.download', locale)}
              onPress={() => {
                const url = job.data?.download_url;
                if (url) {
                  Linking.openURL(url).catch(() => showToast(t('gdpr.export.linkError', locale)));
                }
              }}
            />
          </View>
        ) : null}

        {!ready ? (
          <Button
            variant="light"
            label={pending ? t('gdpr.export.requesting', locale) : t('gdpr.export.cta', locale)}
            disabled={pending || request.isPending}
            onPress={() => request.mutate()}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
