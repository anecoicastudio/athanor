import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isProfileComplete } from '@auria/core';
import type { Database } from '@auria/api';
import { getUserSafe } from '@/utils/supabase/get-user';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // rule 8: getUser(), never getSession(). getUserSafe degrades to null when
  // Supabase is unreachable (e.g. local stack down) instead of throwing.
  const user = await getUserSafe(supabase);

  const path = request.nextUrl.pathname;
  const isPublic = path === '/' || path.startsWith('/login') || path.startsWith('/auth');

  const redirectWithCookies = (url: URL) => {
    const redirectRes = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirectRes.cookies.set(cookie));
    return redirectRes;
  };

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return redirectWithCookies(url);
  }

  // onboarding gate for authed users — uses @auria/core isProfileComplete (proxy runs on Node)
  // /auth routes are never gated: token exchange must pass through.
  const onAuthRoutes = path.startsWith('/auth');
  if (user && !onAuthRoutes) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('handle, identity_tags, seeking')
      .eq('id', user.id)
      .maybeSingle();
    const complete = profile != null && isProfileComplete(profile);
    const onOnboarding = path.startsWith('/onboarding');
    // incomplete profile anywhere outside /onboarding → send to /onboarding
    if (!complete && !onOnboarding) {
      const url = request.nextUrl.clone();
      url.pathname = '/onboarding';
      return redirectWithCookies(url);
    }
    // complete profile on /onboarding or /login → send to /
    if (complete && (onOnboarding || path.startsWith('/login'))) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return redirectWithCookies(url);
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
