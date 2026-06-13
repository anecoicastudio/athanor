import { redirect } from 'next/navigation';
import { getActiveDream, getOwnProfile } from '@kaira/api';
import { createClient } from '@/utils/supabase/server';
import { ProfileView } from './profile-view';

/**
 * Profilo Evolutivo — own authenticated view (PRD §4.2, M1).
 * Server-fetches profile + active dream, hands them to the client edit shell.
 * The public @handle SSR page is a separate M2 deliverable.
 */
export default async function ProfiloPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [profile, dream] = await Promise.all([
    getOwnProfile(supabase, user.id),
    getActiveDream(supabase, user.id),
  ]);
  if (!profile) redirect('/onboarding');

  return <ProfileView userId={user.id} profile={profile} dreamText={dream?.text ?? null} />;
}
