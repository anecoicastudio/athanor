import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { QueryObserverResult } from '@tanstack/react-query';

/**
 * Calls `onActive` each time the app returns to the foreground. Returns the cleanup.
 *
 * TanStack's `refetchOnWindowFocus` never fires on device: nothing wires `focusManager` to
 * `AppState`, and its default listens for `visibilitychange`, which React Native has no source
 * for. Wiring it app-wide would start every mounted infinite list refetching on each return, so
 * a screen whose answer changes while the member is away (#879) opts in here instead.
 */
export function onAppForeground(onActive: () => void): () => void {
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') onActive();
  });
  return () => sub.remove();
}

/**
 * Re-reads a query whenever the app comes back while the calling screen is mounted.
 * `cancelRefetch: false` joins a fetch already in flight (the mount read) instead of cancelling it.
 */
export function useRefetchOnForeground(refetch: QueryObserverResult['refetch']): void {
  // TanStack keeps `refetch` stable for the observer's lifetime, so this subscribes once.
  useEffect(() => onAppForeground(() => void refetch({ cancelRefetch: false })), [refetch]);
}
