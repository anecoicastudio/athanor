import { NextResponse, type NextRequest } from 'next/server';
import { createAuthedClient } from '@/utils/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createAuthedClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${request.nextUrl.origin}/admin/login`);
}
