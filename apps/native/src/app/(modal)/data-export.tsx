import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '@athanor/i18n';
import { gdprKeys, getLatestExportJob, requestExport } from '@athanor/api';
import { ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { Toast } from '@/components/Toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';

/**
 * GDPR data export (09 §3.5.1). Request → processing → ready. The archive is assembled server-side
 * by the gdpr-export-job and emailed as a time-limited signed link; this screen mirrors the status
 * and surfaces the same link when ready. Neutral chrome, flat cyan CTA — no glow (rule #4).
 */
export default function DataExportScreen() {
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);
  // Clear a pending toast timer on unmount so it can't setToast on a dead component.
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const job = useQuery({
    queryKey: gdprKeys.exportStatus(),
    queryFn: () => getLatestExportJob(supabase),
  });
  const status = job.data?.status ?? null;
  const pending = status === 'requested' || status === 'processing';
  const ready = status === 'ready' && !!job.data?.download_url;

  const request = useMutation({
    mutationFn: () => requestExport(supabase),
    onSuccess: () => {
      flashToast(t('gdpr.export.toast', locale));
      void qc.invalidateQueries({ queryKey: gdprKeys.exportStatus() });
    },
    onError: () => flashToast(t('profile.error', locale)),
  });

  return (
    <View {...MODAL_A11Y} className="flex-1 bg-background">
      <ModalHeader title={t('gdpr.export.title', locale)} backLabel={t('common.back', locale)} />
      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-5 pb-[104px]">
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

        {ready ? (
          <View className="gap-3 rounded-card border border-hair bg-raise p-5">
            <Text className="text-base text-foreground">{t('gdpr.export.ready', locale)}</Text>
            <Button
              variant="light"
              label={t('gdpr.export.download', locale)}
              onPress={() => {
                const url = job.data?.download_url;
                if (url) void Linking.openURL(url);
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
      {toast ? <Toast label={toast} /> : null}
    </View>
  );
}
