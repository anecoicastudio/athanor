import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import * as Haptics from 'expo-haptics';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProject, projectKeys } from '@athanor/api';
import { type MessageKey, t } from '@athanor/i18n';
import type { ProjectCategory } from '@athanor/schemas';
import { ScrollView, Text, View } from '@/tw';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { useDirtyGuard } from '@/hooks/use-dirty-guard';
import { useLocale } from '@/hooks/use-locale';
import { isDraftDirty } from '@/lib/dirty-guard';
import { useAuth } from '@/lib/auth-context';
import { useGuardedBack } from '@/lib/modal-exit';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/ToastHost';

const CATEGORIES: ProjectCategory[] = [
  'startup',
  'artistic',
  'business',
  'scientific',
  'volunteer',
];

export default function ProjectComposeScreen() {
  const { session } = useAuth();
  const leave = useGuardedBack();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ProjectCategory>('startup');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const authorId = session?.user.id;

  // #636: title + category + description went with one swipe-down. This composer is missing
  // from the issue's roster entirely; it loses work exactly like the ones that are on it.
  const { showToast } = useToast();

  /**
   * TanStack v5 awaits the hook-level `onSuccess` after this component unmounts, and the exit
   * stays live while the write is in flight — so without this ref a publish that lands late
   * navigates the member off whatever screen they reached, and a late failure `setError`s into
   * a component nobody is looking at (#579). Same ref, same reasons, as `post-compose`.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!authorId) throw new Error('no session');
      return createProject(supabase, {
        author_id: authorId,
        title,
        category,
        description,
        terms: null,
      });
    },
    onSuccess: async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      // A haptic says nothing on web and little on a device (#579). Outside the guard: the
      // toast host is global, so it reaches the member even if they already left. `'success'`,
      // not `'moment'` — rule 4 keeps the ✦ for what happens TO them, and a ricerca that finds
      // someone is the moment, not the posting of it.
      showToast(t('project.toast.published', locale), 'success');
      if (mounted.current) leave();
    },
    onError: () => {
      /*
        `project.compose.error` — «Dai un titolo alla ricerca» — is the CLIENT-side validation
        miss, and it was answering server refusals too: a network drop or an RLS denial told
        the member to title a ricerca they had already titled, which is advice they cannot act
        on. Same slip post-compose carried, fixed the same way (#579).

        Inline while they are here; the toast is the only surface left once they are not.
      */
      const message = t('project.compose.publishError', locale);
      if (mounted.current) setError(message);
      else showToast(message);
    },
  });

  const [baseline] = useState(() => ({ title, category, description }));
  useDirtyGuard({
    dirty: isDraftDirty(baseline, { title, category, description }),
    saving: mutation.isPending,
    submitted: mutation.isSuccess,
  });

  const onPublish = () => {
    if (title.trim().length === 0) {
      setError(t('project.compose.error', locale));
      return;
    }
    setError(null);
    mutation.mutate();
  };

  return (
    <KeyboardAvoiding>
      <Screen>
        <ModalHeader
          title={t('create.project.title', locale)}
          backLabel={t('common.back', locale)}
        />
        <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-8">
          <Text className="text-[14px] text-faint">{t('create.project.desc', locale)}</Text>

          <View className="gap-2">
            <SectionLabel>{t('project.compose.titleLabel', locale)}</SectionLabel>
            <Input
              placeholder={t('project.compose.titlePlaceholder', locale)}
              value={title}
              onChangeText={setTitle}
              maxLength={140}
            />
          </View>
          {error ? <Text className="text-[13px] text-error">{error}</Text> : null}

          <View className="gap-2">
            <SectionLabel>{t('project.compose.catLabel', locale)}</SectionLabel>
            <View className="flex-row flex-wrap gap-2">
              {/* The same hand-rolled pill `post-compose` had, over the same six keys the board
                  filter renders — folded onto `Chip` with it so the two composers and the board
                  cannot drift (#635). */}
              {CATEGORIES.map((c) => (
                <Chip
                  key={c}
                  small
                  label={t(`costellazioni.filter.${c}` as MessageKey, locale)}
                  selected={c === category}
                  onPress={() => setCategory(c)}
                />
              ))}
            </View>
          </View>

          <View className="gap-2">
            <SectionLabel>{t('project.compose.descLabel', locale)}</SectionLabel>
            <Field
              size="lg"
              multiline
              placeholder={t('project.compose.descPlaceholder', locale)}
              value={description}
              onChangeText={setDescription}
            />
          </View>

          {/* P2.5 hint-truth: no create-hint — the engine never rewards publishing (anti-gaming). */}
          <Button
            label={t('common.publish', locale)}
            onPress={onPublish}
            disabled={mutation.isPending}
            variant="light"
          />
        </ScrollView>
      </Screen>
    </KeyboardAvoiding>
  );
}
