import { type ReactNode } from 'react';

/**
 * PageReveal — wraps the page in `.page-shell`. The splash hands off via an iris
 * that opens *onto* the page (components/splash.tsx), so the page itself no longer
 * zooms/transforms during the reveal — this is a plain layout wrapper. Scroll
 * entrances still gate on `whenSplashDone` inside <Reveal> (lib/splash-ready.ts).
 */
export function PageReveal({ children }: { children: ReactNode }) {
  return <div className="page-shell">{children}</div>;
}
