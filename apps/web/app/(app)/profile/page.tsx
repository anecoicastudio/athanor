import { redirect } from 'next/navigation';
import { getActiveDream, getOwnProfile } from '@auria/api';
import { createClient } from '@/utils/supabase/server';
import { getUserSafe } from '@/utils/supabase/get-user';
import { ProfileView } from './profile-view';

/**
 * Profilo Evolutivo — own authenticated view (PRD §4.2, M1).
 * Server-fetches profile + active dream, hands them to the client edit shell.
 * The public @handle SSR page is a separate M2 deliverable.
 */
export default async function ProfilePage() {
  const supabase = await createClient();
  const user = await getUserSafe(supabase);
  if (!user) redirect('/login');

  const [profile, dream] = await Promise.all([
    getOwnProfile(supabase, user.id),
    getActiveDream(supabase, user.id),
  ]);
  if (!profile) redirect('/onboarding');

  return <ProfileView userId={user.id} profile={profile} dreamText={dream?.text ?? null} />;
}
