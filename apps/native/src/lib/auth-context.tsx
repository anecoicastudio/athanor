import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getOwnProfile } from '@auria/api';
import type { Profile } from '@auria/schemas';
import { supabase } from './supabase';

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<Session | null>(null);

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
      if (!next) setProfile(null); // sign-out clears profile here (event handler, not effect)
    });
    return () => sub.subscription.unsubscribe();
  }, []);

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
    <AuthContext.Provider value={{ session, profile, loading, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
