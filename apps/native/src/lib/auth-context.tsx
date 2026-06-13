import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getOwnProfile } from '@auria/api';
import type { Profile } from '@auria/schemas';
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
  const sessionRef = useRef<Session | null>(null);
  const handledUrlRef = useRef<string | null>(null);

  const refreshProfile = useCallback(async () => {
    const userId = sessionRef.current?.user.id ?? null;
    if (!userId) {
      setProfile(null);
      return;
    }
    try {
      const fresh = await getOwnProfile(supabase, userId);
      if (sessionRef.current?.user.id === userId) {
        setProfile(fresh);
      }
    } catch {
      // keep prior profile; next session change or manual refresh retries
    }
  }, []);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        sessionRef.current = data.session;
        setSession(data.session);
      })
      .finally(() => setLoading(false));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      sessionRef.current = next;
      setSession(next);
      if (next) setLinkError(false);
      else setProfile(null); // sign-out clears profile here (event handler, not effect)
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Deep-link handler: guard against replayed URLs (fast refresh re-fires
  // useURL with a consumed code → spurious linkError).
  useEffect(() => {
    if (!incomingUrl?.includes('auth/callback')) return;
    if (handledUrlRef.current === incomingUrl) return;
    handledUrlRef.current = incomingUrl;
    createSessionFromUrl(incomingUrl).catch(() => setLinkError(true));
  }, [incomingUrl]);

  // Profile hydration keyed on user id (not session object — token refresh
  // churns identity). Cancellable so a sign-out during an in-flight fetch
  // can't resurrect the profile.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) {
      return; // profile cleared by the sign-out branch in onAuthStateChange
    }
    let cancelled = false;
    getOwnProfile(supabase, userId)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        // profile stays as-is; guard waits, next auth event retries
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <AuthContext.Provider value={{ session, profile, loading, linkError, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
