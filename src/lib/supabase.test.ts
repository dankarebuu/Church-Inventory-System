import { describe, expect, it } from 'vitest';
import { isSupabaseConfigured, supabase } from './supabase';

describe('supabase client module', () => {
  it('initializes without throwing when env vars are unset in tests', () => {
    expect(typeof isSupabaseConfigured).toBe('boolean');
    expect(supabase).toBeDefined();
    expect(typeof supabase.auth.getSession).toBe('function');
    expect(typeof supabase.from).toBe('function');
  });
});
