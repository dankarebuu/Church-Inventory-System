import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import {
  getActiveOfflineCacheUserId,
  getOfflineInitialSlice,
  isOfflineNetworkError,
  loadOfflineSnapshot,
} from '@/lib/offlineCache';
import { queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { isUniqueConstraintError, trimOrNull } from '@/lib/utils';
import type { Database, LocationRecord } from '@/types/database';

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
  const cacheOwnerId = getActiveOfflineCacheUserId();
  const offlineInitial = isSupabaseConfigured
    ? getOfflineInitialSlice('locations', cacheOwnerId)
    : null;

  return useQuery<LocationRecord[], Error>({
    queryKey: queryKeys.locations,
    queryFn: async () => {
      try {
        return await fetchLocations();
      } catch (err) {
        if (isOfflineNetworkError(err)) {
          const fallback = loadOfflineSnapshot(getActiveOfflineCacheUserId());
          if (fallback) {
            return fallback.locations;
          }
        }
        throw err;
      }
    },
    enabled: isSupabaseConfigured,
    initialData: !isSupabaseConfigured
      ? EMPTY_LOCATIONS
      : offlineInitial
        ? offlineInitial.data
        : undefined,
    initialDataUpdatedAt: offlineInitial ? offlineInitial.updatedAt : undefined,
  });
}

export interface CreateLocationInput {
  name: string;
  description?: string | null;
  sort_order?: number;
}

export interface UpdateLocationInput {
  id: string;
  name: string;
  description?: string | null;
  sort_order?: number;
  previousName?: string;
}

export type DeleteLocationTarget = string | Pick<LocationRecord, 'id'>;

type LocationInsert = Database['public']['Tables']['locations']['Insert'];
type LocationUpdate = Database['public']['Tables']['locations']['Update'];

function getNextLocationSortOrder(locations: readonly LocationRecord[]): number {
  let maxOrder = 0;
  for (const loc of locations) {
    if (loc.sort_order > maxOrder) {
      maxOrder = loc.sort_order;
    }
  }
  return maxOrder + 10;
}

/**
 * Provides Admin-guarded CRUD mutations for storage locations, keeping
 * `inventory.location` text synced on renames and mapping Postgres `23505`
 * collisions into friendly duplicate-name errors.
 */
export function useLocationMutations() {
  const { role } = useAuth();
  const queryClient = useQueryClient();

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.categories }),
      queryClient.invalidateQueries({ queryKey: queryKeys.locations }),
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory(role) }),
    ]);
  }, [queryClient, role]);

  const assertCanMutate = useCallback(() => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured.');
    }
    if (role !== 'admin') {
      throw new Error('Only administrators can manage storage locations.');
    }
  }, [role]);

  const createMutation = useMutation<LocationRecord, Error, CreateLocationInput>({
    mutationFn: async (input) => {
      assertCanMutate();

      const trimmedName = input.name.trim();
      if (!trimmedName) {
        throw new Error('Location name is required.');
      }

      const cachedLocations =
        queryClient.getQueryData<LocationRecord[]>(queryKeys.locations) ?? [];
      const sortOrder = input.sort_order ?? getNextLocationSortOrder(cachedLocations);

      const insertPayload: LocationInsert = {
        name: trimmedName,
        description: trimOrNull(input.description),
        sort_order: sortOrder,
      };

      const { data, error } = await supabase
        .from('locations')
        .insert([insertPayload])
        .select('*')
        .single();

      if (error) {
        if (isUniqueConstraintError(error)) {
          throw new Error(`A storage location named "${trimmedName}" already exists.`);
        }
        throw new Error(error.message);
      }

      await invalidateAll();
      return data;
    },
  });

  const updateMutation = useMutation<LocationRecord, Error, UpdateLocationInput>({
    mutationFn: async (input) => {
      assertCanMutate();

      const trimmedName = input.name.trim();
      if (!trimmedName) {
        throw new Error('Location name is required.');
      }

      const cachedLocations =
        queryClient.getQueryData<LocationRecord[]>(queryKeys.locations) ?? [];
      const existing = cachedLocations.find((loc) => loc.id === input.id);

      const updatePayload: LocationUpdate = {
        name: trimmedName,
      };

      if (input.description !== undefined) {
        updatePayload.description = trimOrNull(input.description);
      }
      if (input.sort_order !== undefined) {
        updatePayload.sort_order = input.sort_order;
      }

      const { data, error } = await supabase
        .from('locations')
        .update(updatePayload)
        .eq('id', input.id)
        .select('*')
        .single();

      if (error) {
        if (isUniqueConstraintError(error)) {
          throw new Error(`A storage location named "${trimmedName}" already exists.`);
        }
        throw new Error(error.message);
      }

      const previousName = input.previousName ?? existing?.name;
      const nameChanged =
        previousName !== undefined ? previousName.trim() !== trimmedName : true;

      if (nameChanged) {
        const { error: syncError } = await supabase
          .from('inventory')
          .update({ location: trimmedName })
          .eq('location_id', input.id);

        if (syncError) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.locations });
          throw new Error(syncError.message);
        }
      }

      await invalidateAll();
      return data;
    },
  });

  const deleteMutation = useMutation<void, Error, DeleteLocationTarget>({
    mutationFn: async (target) => {
      assertCanMutate();

      const locationId = typeof target === 'string' ? target : target.id;
      const { error } = await supabase
        .from('locations')
        .delete()
        .eq('id', locationId);

      if (error) {
        throw new Error(error.message);
      }

      await invalidateAll();
    },
  });

  const { mutateAsync: runCreate } = createMutation;
  const { mutateAsync: runUpdate } = updateMutation;
  const { mutateAsync: runDelete } = deleteMutation;

  const createLocation = useCallback(
    (input: CreateLocationInput) => runCreate(input),
    [runCreate]
  );

  const updateLocation = useCallback(
    (input: UpdateLocationInput) => runUpdate(input),
    [runUpdate]
  );

  const deleteLocation = useCallback(
    (target: DeleteLocationTarget) => runDelete(target),
    [runDelete]
  );

  return {
    createLocation,
    updateLocation,
    deleteLocation,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}
