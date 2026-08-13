import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Toast, type ToastTone } from '@/components/Toast';

/**
 * Global toast host (#117). One state, one timer, one position: screens call
 * `useToast().showToast(label, tone?)` instead of owning a `useState` +
 * `setTimeout` + `<Toast/>` triple, so two toasts can never co-exist, a
 * re-show extends the hold instead of being cut short by the first timer, and
 * a toast fired just before `router.back()` survives onto the screen below.
 *
 * The pill cannot render from a single mount beside the root <Stack>:
 * `(modal)` routes are native modals — their own native layer above the RN
 * root — so a root-level sibling would be covered whenever a modal is up.
 * Instead every `Screen` mounts a `ToastViewport`, and the provider elects
 * exactly one to render: a viewport registers while its route is focused, and
 * the most recently registered wins. A Screen inside an RN <Modal> (e.g. the
 * Lightbox) shares its route's focus and mounts later than the route's own
 * viewport, so the toast stays above that modal too.
 */

/** One hold for every toast — the longest of the per-screen timers this host replaced. */
export const TOAST_HOLD_MS = 2500;

type ToastState = { label: string; tone?: ToastTone } | null;

type ToastApi = {
  showToast: (label: string, tone?: ToastTone) => void;
  registerViewport: () => { id: number; unregister: () => void };
};

type ToastRender = { toast: ToastState; topViewport: number | null };

const ToastApiContext = createContext<ToastApi | null>(null);
const ToastRenderContext = createContext<ToastRender>({ toast: null, topViewport: null });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const [topViewport, setTopViewport] = useState<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);
  const stack = useRef<number[]>([]);

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  const showToast = useCallback((label: string, tone?: ToastTone) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => setToast(null), TOAST_HOLD_MS);
    setToast({ label, tone });
    // Android hears the viewport's accessibilityLiveRegion; iOS has no
    // live-region equivalent, so announce imperatively — once, here, not per
    // mounted viewport.
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(label);
  }, []);

  const registerViewport = useCallback(() => {
    const id = ++nextId.current;
    stack.current = [...stack.current, id];
    setTopViewport(id);
    return {
      id,
      unregister: () => {
        stack.current = stack.current.filter((v) => v !== id);
        setTopViewport(stack.current[stack.current.length - 1] ?? null);
      },
    };
  }, []);

  // Two contexts on purpose: the API object never changes identity, so
  // `useToast` callers don't re-render per toast and the viewports' focus
  // effects never re-run when one shows/hides — a re-run would re-register
  // every focused viewport and scramble the election order.
  const api = useMemo(() => ({ showToast, registerViewport }), [showToast, registerViewport]);
  const render = useMemo(() => ({ toast, topViewport }), [toast, topViewport]);

  return (
    <ToastApiContext.Provider value={api}>
      <ToastRenderContext.Provider value={render}>{children}</ToastRenderContext.Provider>
    </ToastApiContext.Provider>
  );
}

export function useToast(): Pick<ToastApi, 'showToast'> {
  const api = useContext(ToastApiContext);
  if (!api) throw new Error('useToast requires <ToastProvider> above the router');
  return api;
}

/**
 * Rendered by `Screen`, never used directly. Requires a navigation context —
 * `Screen` only mounts inside the router (routes, or RN-Modal subtrees of a
 * route like the Lightbox, which inherit the route's context).
 */
export function ToastViewport() {
  const api = useContext(ToastApiContext);
  const { toast, topViewport } = useContext(ToastRenderContext);
  const idRef = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!api) return undefined;
      const { id, unregister } = api.registerViewport();
      idRef.current = id;
      return () => {
        idRef.current = null;
        unregister();
      };
    }, [api]),
  );

  if (!toast || idRef.current === null || topViewport !== idRef.current) return null;
  return <Toast label={toast.label} tone={toast.tone} />;
}
