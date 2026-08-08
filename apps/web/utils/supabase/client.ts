import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@athanor/api';
import { supabaseKey } from './key';

export function createClient() {
  return createBrowserClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, supabaseKey());
}
