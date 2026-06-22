import { type NextRequest } from 'next/server';
import { updateSession } from '@/utils/supabase/middleware';

// Next 16: middleware.ts is deprecated; the entry point is proxy.ts with a named `proxy` export.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = { matcher: ['/admin/:path*'] };
