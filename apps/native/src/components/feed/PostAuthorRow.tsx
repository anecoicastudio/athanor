import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { Pressable, Text } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { useProfile } from '@/hooks/use-profile';

/**
 * Post/comment author identity — Avatar + handle. Tap → person detail (M2 read view).
 * The aura-chip NUMBER is deferred to M6 (Aura reads zero pre-engine — no fabricated
 * badge, rule #1/#3). `size` lets comments render a smaller row than the post header.
 */
export function PostAuthorRow({ authorId, size = 'md' }: { authorId: string; size?: 'sm' | 'md' }) {
  const router = useRouter();
  const { data: profile } = useProfile(authorId);
  const handle = profile?.handle ?? null;
  const label = memberLabel(profile?.display_name, handle);
  const avatarSize = size === 'sm' ? 28 : 36;
  const nameClass = size === 'sm' ? 'text-[13px]' : 'text-[14px]';
  return (
    <Pressable
      className="flex-row items-center gap-3"
      onPress={() => router.push(`/(modal)/user/${authorId}`)}
    >
      <Avatar
        handle={handle}
        displayName={profile?.display_name ?? null}
        avatarPath={profile?.avatar_path ?? null}
        size={avatarSize}
      />
      <Text className={`${nameClass} font-semibold text-foreground`}>{label ?? '·'}</Text>
    </Pressable>
  );
}
