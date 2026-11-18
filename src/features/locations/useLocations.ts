import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { LocationRecord } from '@/types/database';

const EMPTY_LOCATIONS: LocationRecord[] = [];

/**
 * Sorts storage locations consistently by `sort_order` ascending, then `name`.
 */
export function sortLocations(locations: readonly LocationRecord[]): LocationRecord[] {
  return [...locations].sort((a, b) => {
    const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name);
  });
}

async function fetchLocations(): Promise<LocationRecord[]> {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return sortLocations(data ?? []);
}

/**
 * Fetches storage locations sorted by `sort_order`, then `name`.
 */
export function useLocations() {
  return useQuery<LocationRecord[], Error>({
    queryKey: queryKeys.locations,
    queryFn: fetchLocations,
    enabled: isSupabaseConfigured,
    initialData: isSupabaseConfigured ? undefined : EMPTY_LOCATIONS,
  });
}
