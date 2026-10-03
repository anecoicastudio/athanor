import { type ReactNode } from 'react';

/**
 * PageReveal — wraps the page in `.page-shell`. A plain layout wrapper: the splash intro that
 * once opened onto it was removed on 2026-10-03, and the name is what is left of it.
 */
export function PageReveal({ children }: { children: ReactNode }) {
  return <div className="page-shell">{children}</div>;
}
