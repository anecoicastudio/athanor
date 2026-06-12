import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export type KairaClient = SupabaseClient<Database>;

/**
 * Base client factory for contexts without platform-specific needs
 * (scripts, tests). Web uses @supabase/ssr clients; mobile wraps this
 * with AsyncStorage auth persistence.
 */
export function createKairaClient(url: string, anonKey: string): KairaClient {
  return createClient<Database>(url, anonKey);
}
