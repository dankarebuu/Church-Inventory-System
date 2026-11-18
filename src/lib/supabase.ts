import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const rawUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const rawAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

/**
 * True when both Supabase Vite environment variables are configured.
 * Allows tests and unconfigured local previews to import safely without throwing.
 */
export const isSupabaseConfigured = Boolean(rawUrl && rawAnonKey);

const supabaseUrl = isSupabaseConfigured ? rawUrl : 'https://placeholder.supabase.co';
const supabaseAnonKey = isSupabaseConfigured ? rawAnonKey : 'placeholder-anon-key';

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
