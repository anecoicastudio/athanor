import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getOwnProfile } from '@kaira/api';
import type { Profile } from '@kaira/schemas';
import { supabase } from './supabase';

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** true when a magic link failed to exchange (expired/invalid) — welcome screen shows auth.error.invalidLink */
  linkError: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  linkError: false,
  refreshProfile: async () => {},
});

/** Magic link lands here: handles both PKCE ?code= and implicit #access_token= forms. */
async function createSessionFromUrl(url: string): Promise<void> {
  const parsed = Linking.parse(url);
  const code = typeof parsed.queryParams?.code === 'string' ? parsed.queryParams.code : null;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }
  const fragment = url.split('#')[1];
  if (!fragment) return;
  const params = new URLSearchParams(fragment);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return;
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkError, setLinkError] = useState(false);
  const incomingUrl = Linking.useURL();

  const refreshProfile = useCallback(async () => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    setProfile(userId ? await getOwnProfile(supabase, userId) : null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) setLinkError(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (incomingUrl?.includes('auth/callback')) {
      createSessionFromUrl(incomingUrl).catch(() => setLinkError(true));
    }
  }, [incomingUrl]);

  useEffect(() => {
    if (session) void refreshProfile();
    else setProfile(null);
  }, [session, refreshProfile]);

  return (
    <AuthContext.Provider value={{ session, profile, loading, linkError, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
