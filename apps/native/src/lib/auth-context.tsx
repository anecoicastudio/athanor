import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getOwnProfile } from '@athanor/api';
import { isProfileComplete } from '@athanor/core';
import type { Profile } from '@athanor/schemas';
import { supabase } from './supabase';
import { flushOnboardingDraft } from './flush-onboarding';
import { registerForPush, unregisterPush } from './push';

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** True while the pre-auth onboarding draft is being persisted post-OTP — the
   *  AuthGuard holds position so the funnel never flashes between the two reads. */
  flushing: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  flushing: false,
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [flushing, setFlushing] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const pushTokenRef = useRef<string | null>(null);

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
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      sessionRef.current = next;
      setSession(next);
      if (!next) {
        setProfile(null); // sign-out clears profile here (event handler, not effect)
        void unregisterPush(pushTokenRef.current);
        pushTokenRef.current = null;
      } else if (
        event === 'SIGNED_IN' ||
        event === 'INITIAL_SESSION' ||
        event === 'TOKEN_REFRESHED'
      ) {
        if (!pushTokenRef.current) {
          void registerForPush().then((t) => {
            pushTokenRef.current = t;
          });
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Profile hydration keyed on user id (not session object — token refresh
  // churns identity). Cancellable so a sign-out during an in-flight fetch
  // can't resurrect the profile. When the freshly-created profile is still
  // incomplete (new account just after OTP), flush the pre-auth onboarding
  // draft and re-read, so the guard can route straight home.
  const userId = session?.user.id ?? null;
  const email = session?.user.email ?? null;
  useEffect(() => {
    if (!userId) {
      return; // profile cleared by the sign-out branch in onAuthStateChange
    }
    let cancelled = false;
    (async () => {
      try {
        const p = await getOwnProfile(supabase, userId);
        if (cancelled) return;
        if (p && email && !isProfileComplete(p)) {
          setFlushing(true);
          const result = await flushOnboardingDraft(userId, email);
          if (cancelled) return;
          if (result === 'flushed') {
            await refreshProfile(); // re-read the now-complete profile
          } else {
            setProfile(p); // 'nodraft' / 'error' → stay incomplete, guard → funnel
          }
          if (!cancelled) setFlushing(false);
        } else {
          setProfile(p);
        }
      } catch {
        // profile stays as-is; guard waits, next auth event retries
        if (!cancelled) setFlushing(false);
      }
    })();
    return () => {
      cancelled = true;
      // Never leave the guard latched: if the user signs out (or identity
      // changes) mid-flush, clear `flushing` so AuthGuard can route again.
      setFlushing(false);
    };
  }, [userId, email, refreshProfile]);

  return (
    <AuthContext.Provider value={{ session, profile, loading, flushing, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
