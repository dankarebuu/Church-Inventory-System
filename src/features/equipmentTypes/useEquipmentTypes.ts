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
import type { Database, EquipmentType } from '@/types/database';

export const DEFAULT_EQUIPMENT_TYPE_COLOR = '#64748b';

export const EQUIPMENT_TYPE_FALLBACK_COLORS: Record<string, string> = {
  Instruments: '#2563EB',
  Amplifiers: '#d97740',
  'IEMs & Routing': '#9575b0',
  'Strings & Accessories': '#5fa777',
  'Bags & Cases': '#8b92a0',
  'Cables & Cords': '#4e7fb0',
  'Stands & Hardware': '#4fa8a0',
  'DI Boxes & Effects': '#e8a33d',
  Microphones: '#d3554a',
};

const EMPTY_EQUIPMENT_TYPES: EquipmentType[] = [];
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Sorts equipment types consistently by `sort_order` ascending, then `name`.
 */
export function sortEquipmentTypes(
  equipmentTypes: readonly EquipmentType[]
): EquipmentType[] {
  return [...equipmentTypes].sort((a, b) => {
    const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Resolves the hex accent color for an equipment type by `typeId` or `typeName`,
 * falling back to the seeded palette and neutral slate `#64748b`.
 */
export function getEquipmentTypeColor(
  typeName: string | null | undefined,
  equipmentTypes: readonly EquipmentType[] = [],
  typeId?: string | null
): string {
  if (typeId) {
    const byId = equipmentTypes.find((et) => et.id === typeId);
    if (byId?.color) return byId.color;
  }

  const normalizedName = typeName?.trim().toLowerCase() ?? '';
  if (normalizedName) {
    const byName = equipmentTypes.find(
      (et) => et.name.trim().toLowerCase() === normalizedName
    );
    if (byName?.color) return byName.color;

    const fallbackEntry = Object.entries(EQUIPMENT_TYPE_FALLBACK_COLORS).find(
      ([key]) => key.toLowerCase() === normalizedName
    );
    if (fallbackEntry) return fallbackEntry[1];
  }

  return DEFAULT_EQUIPMENT_TYPE_COLOR;
}

/**
 * Validates and normalizes hex color strings, defaulting blank inputs to
 * `DEFAULT_EQUIPMENT_TYPE_COLOR`.
 */
export function normalizeEquipmentTypeColor(color?: string | null): string {
  const trimmed = trimOrNull(color);
  if (!trimmed) return DEFAULT_EQUIPMENT_TYPE_COLOR;
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    throw new Error('Equipment type color must be a valid hex code (e.g. #2563EB).');
  }
  return normalized;
}

async function fetchEquipmentTypes(): Promise<EquipmentType[]> {
  const { data, error } = await supabase
    .from('equipment_types')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return sortEquipmentTypes(data ?? []);
}

/**
 * Fetches equipment types sorted by `sort_order`, then `name`.
 */
export function useEquipmentTypes() {
  const cacheOwnerId = getActiveOfflineCacheUserId();
  const offlineInitial = isSupabaseConfigured
    ? getOfflineInitialSlice('equipment_types', cacheOwnerId)
    : null;

  return useQuery<EquipmentType[], Error>({
    queryKey: queryKeys.equipmentTypes,
    queryFn: async () => {
      try {
        return await fetchEquipmentTypes();
      } catch (err) {
        if (isOfflineNetworkError(err)) {
          const fallback = loadOfflineSnapshot(getActiveOfflineCacheUserId());
          if (fallback) {
            return fallback.equipment_types;
          }
        }
        throw err;
      }
    },
    enabled: isSupabaseConfigured,
    initialData: !isSupabaseConfigured
      ? EMPTY_EQUIPMENT_TYPES
      : offlineInitial
        ? offlineInitial.data
        : undefined,
    initialDataUpdatedAt: offlineInitial ? offlineInitial.updatedAt : undefined,
  });
}

export interface CreateEquipmentTypeInput {
  name: string;
  color?: string;
  icon?: string | null;
  sort_order?: number;
}

export interface UpdateEquipmentTypeInput {
  id: string;
  name: string;
  color?: string;
  icon?: string | null;
  sort_order?: number;
  previousName?: string;
}

export type DeleteEquipmentTypeTarget = string | Pick<EquipmentType, 'id'>;

type EquipmentTypeInsert = Database['public']['Tables']['equipment_types']['Insert'];
type EquipmentTypeUpdate = Database['public']['Tables']['equipment_types']['Update'];

function getNextEquipmentTypeSortOrder(equipmentTypes: readonly EquipmentType[]): number {
  let maxOrder = 0;
  for (const et of equipmentTypes) {
    if (et.sort_order > maxOrder) {
      maxOrder = et.sort_order;
    }
  }
  return maxOrder + 10;
}

function validateSortOrder(sortOrder: number): number {
  if (!Number.isFinite(sortOrder) || !Number.isInteger(sortOrder)) {
    throw new Error('Sort order must be a whole number.');
  }
  return sortOrder === 0 ? 0 : sortOrder;
}

/**
 * Provides Admin-guarded CRUD mutations for equipment types, keeping
 * `inventory.equipment_type` text synced on renames and mapping Postgres
 * `23505` collisions into friendly duplicate-name errors.
 */
export function useEquipmentTypeMutations() {
  const { role } = useAuth();
  const queryClient = useQueryClient();

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.equipmentTypes }),
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory(role) }),
    ]);
  }, [queryClient, role]);

  const assertCanMutate = useCallback(() => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured.');
    }
    if (role !== 'admin') {
      throw new Error('Only administrators can manage equipment types.');
    }
  }, [role]);

  const createMutation = useMutation<EquipmentType, Error, CreateEquipmentTypeInput>({
    mutationFn: async (input) => {
      assertCanMutate();

      const trimmedName = input.name.trim();
      if (!trimmedName) {
        throw new Error('Equipment type name is required.');
      }

      const cachedTypes =
        queryClient.getQueryData<EquipmentType[]>(queryKeys.equipmentTypes) ?? [];
      const sortOrder =
        input.sort_order !== undefined
          ? validateSortOrder(input.sort_order)
          : getNextEquipmentTypeSortOrder(cachedTypes);
      const color = normalizeEquipmentTypeColor(input.color);
      const icon = trimOrNull(input.icon) ?? 'tag';

      const insertPayload: EquipmentTypeInsert = {
        name: trimmedName,
        color,
        icon,
        sort_order: sortOrder,
      };

      const { data, error } = await supabase
        .from('equipment_types')
        .insert([insertPayload])
        .select('*')
        .single();

      if (error) {
        if (isUniqueConstraintError(error)) {
          throw new Error(`An equipment type named "${trimmedName}" already exists.`);
        }
        throw new Error(error.message);
      }

      await invalidateAll();
      return data;
    },
  });

  const updateMutation = useMutation<EquipmentType, Error, UpdateEquipmentTypeInput>({
    mutationFn: async (input) => {
      assertCanMutate();

      const trimmedName = input.name.trim();
      if (!trimmedName) {
        throw new Error('Equipment type name is required.');
      }

      const cachedTypes =
        queryClient.getQueryData<EquipmentType[]>(queryKeys.equipmentTypes) ?? [];
      const existing = cachedTypes.find((et) => et.id === input.id);

      const updatePayload: EquipmentTypeUpdate = {
        name: trimmedName,
      };

      if (input.color !== undefined) {
        updatePayload.color = normalizeEquipmentTypeColor(input.color);
      }
      if (input.icon !== undefined) {
        updatePayload.icon = trimOrNull(input.icon) ?? 'tag';
      }
      if (input.sort_order !== undefined) {
        updatePayload.sort_order = validateSortOrder(input.sort_order);
      }

      const { data, error } = await supabase
        .from('equipment_types')
        .update(updatePayload)
        .eq('id', input.id)
        .select('*')
        .single();

      if (error) {
        if (isUniqueConstraintError(error)) {
          throw new Error(`An equipment type named "${trimmedName}" already exists.`);
        }
        throw new Error(error.message);
      }

      const previousName = input.previousName ?? existing?.name;
      const nameChanged =
        previousName !== undefined ? previousName.trim() !== trimmedName : true;

      if (nameChanged) {
        const { error: syncError } = await supabase
          .from('inventory')
          .update({ equipment_type: trimmedName })
          .eq('equipment_type_id', input.id);

        if (syncError) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.equipmentTypes });
          throw new Error(syncError.message);
        }
      }

      await invalidateAll();
      return data;
    },
  });

  const deleteMutation = useMutation<void, Error, DeleteEquipmentTypeTarget>({
    mutationFn: async (target) => {
      assertCanMutate();

      const typeId = typeof target === 'string' ? target : target.id;
      const { error } = await supabase
        .from('equipment_types')
        .delete()
        .eq('id', typeId);

      if (error) {
        throw new Error(error.message);
      }

      await invalidateAll();
    },
  });

  const { mutateAsync: runCreate } = createMutation;
  const { mutateAsync: runUpdate } = updateMutation;
  const { mutateAsync: runDelete } = deleteMutation;

  const createEquipmentType = useCallback(
    (input: CreateEquipmentTypeInput) => runCreate(input),
    [runCreate]
  );

  const updateEquipmentType = useCallback(
    (input: UpdateEquipmentTypeInput) => runUpdate(input),
    [runUpdate]
  );

  const deleteEquipmentType = useCallback(
    (target: DeleteEquipmentTypeTarget) => runDelete(target),
    [runDelete]
  );

  return {
    createEquipmentType,
    updateEquipmentType,
    deleteEquipmentType,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}
