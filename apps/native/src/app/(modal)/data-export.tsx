import { Linking } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '@athanor/i18n';
import { gdprKeys, getLatestExportJob, requestExport } from '@athanor/api';
import { ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { useToast } from '@/components/ToastHost';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';
import { Screen } from '@/components/Screen';

/**
 * GDPR data export (09 §3.5.1). Request → processing → ready. The archive is assembled server-side
 * by the gdpr-export-job; when it flips to ready the member gets a gdprExport notification (#129)
 * that routes back here, where the time-limited signed link is served. Neutral chrome, flat cyan
 * CTA — no glow (rule #4).
 */
export default function DataExportScreen() {
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const qc = useQueryClient();
  const { showToast } = useToast();

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
    </Screen>
  );
}
