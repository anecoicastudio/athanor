import { NotFoundView } from '@/components/not-found-view';

/**
 * Branded 404 — the mandorla, a calm line, and the way home.
 *
 * Kept free of `getLocale()` so /_not-found prerenders: every bot hitting a dead
 * URL would otherwise cost a server render.
 */
export default function NotFound() {
  return <NotFoundView />;
}
