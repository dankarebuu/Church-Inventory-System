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
import type { Category, Database } from '@/types/database';

export const DEFAULT_CATEGORY_COLOR = '#7a8290';

export const CATEGORY_FALLBACK_COLORS: Record<string, string> = {
  Drums: '#d97740',
  'Bass Rig': '#e8a33d',
  'Electric Guitar Rig': '#d3554a',
  'Acoustic & Classical': '#5fa777',
  Keyboard: '#4fa8a0',
  'In-Ear Monitors': '#9575b0',
  'Spares & Shared': '#4e7fb0',
  'Unassigned - Needs Review': '#8b92a0',
  Others: '#8b92a0',
};

export interface CategoryTreeNode extends Category {
  subcategories: Category[];
}

const EMPTY_CATEGORIES: Category[] = [];

/**
 * Sorts categories consistently by `sort_order` ascending, then `name`.
 */
export function sortCategories(categories: readonly Category[]): Category[] {
  return [...categories].sort((a, b) => {
    const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Groups flat 2-level category rows into sorted top-level categories with
 * nested sorted `subcategories[]`.
 */
export function buildCategoryTree(categories: readonly Category[]): CategoryTreeNode[] {
  const sorted = sortCategories(categories);
  const childrenByParent = new Map<string, Category[]>();
  const topLevel: Category[] = [];

  for (const cat of sorted) {
    if (cat.parent_id === null) {
      topLevel.push(cat);
      continue;
    }
    const bucket = childrenByParent.get(cat.parent_id);
    if (bucket) {
      bucket.push(cat);
    } else {
      childrenByParent.set(cat.parent_id, [cat]);
    }
  }

  return topLevel.map((parent) => ({
    ...parent,
    subcategories: childrenByParent.get(parent.id) ?? [],
  }));
}

/**
 * Resolves the hex accent color for a category by `categoryId` or `categoryName`,
 * falling back to WINGMACC's legacy palette and neutral slate.
 */
export function getCategoryColor(
  categoryName: string | null | undefined,
  categories: readonly Category[] = [],
  categoryId?: string | null
): string {
  if (categoryId) {
    const byId = categories.find((cat) => cat.id === categoryId);
    if (byId?.color) return byId.color;
  }

  const normalizedName = categoryName?.trim().toLowerCase() ?? '';
  if (normalizedName) {
    const byName = categories.find(
      (cat) => cat.parent_id === null && cat.name.trim().toLowerCase() === normalizedName
    ) ?? categories.find((cat) => cat.name.trim().toLowerCase() === normalizedName);
    if (byName?.color) return byName.color;

    const fallbackEntry = Object.entries(CATEGORY_FALLBACK_COLORS).find(
      ([key]) => key.toLowerCase() === normalizedName
    );
    if (fallbackEntry) return fallbackEntry[1];
  }

  return DEFAULT_CATEGORY_COLOR;
}

async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return sortCategories(data ?? []);
}

/**
 * Fetches flat 2-level equipment categories sorted by `sort_order`, then `name`.
 */
export function useCategories() {
  const cacheOwnerId = getActiveOfflineCacheUserId();
  const offlineInitial = isSupabaseConfigured
    ? getOfflineInitialSlice('categories', cacheOwnerId)
    : null;

  return useQuery<Category[], Error>({
    queryKey: queryKeys.categories,
    queryFn: async () => {
      try {
        return await fetchCategories();
      } catch (err) {
        if (isOfflineNetworkError(err)) {
          const fallback = loadOfflineSnapshot(getActiveOfflineCacheUserId());
          if (fallback) {
            return fallback.categories;
          }
        }
        throw err;
      }
    },
    enabled: isSupabaseConfigured,
    initialData: !isSupabaseConfigured
      ? EMPTY_CATEGORIES
      : offlineInitial
        ? offlineInitial.data
        : undefined,
    initialDataUpdatedAt: offlineInitial ? offlineInitial.updatedAt : undefined,
  });
}

export interface CreateCategoryInput {
  name: string;
  parent_id?: string | null;
  color?: string;
  icon?: string | null;
  sort_order?: number;
}

export interface UpdateCategoryInput {
  id: string;
  name: string;
  parent_id?: string | null;
  color?: string;
  icon?: string | null;
  sort_order?: number;
  previousName?: string;
}

export type DeleteCategoryTarget = string | Pick<Category, 'id'>;

type CategoryInsert = Database['public']['Tables']['categories']['Insert'];
type CategoryUpdate = Database['public']['Tables']['categories']['Update'];

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Validates and normalizes hex color strings, defaulting blank inputs to
 * `DEFAULT_CATEGORY_COLOR`.
 */
export function normalizeCategoryColor(color?: string | null): string {
  const trimmed = trimOrNull(color);
  if (!trimmed) return DEFAULT_CATEGORY_COLOR;
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    throw new Error('Category color must be a valid hex code (e.g. #d97740).');
  }
  return normalized;
}

function getNextCategorySortOrder(
  categories: readonly Category[],
  parentId: string | null
): number {
  let maxOrder = 0;
  for (const cat of categories) {
    if (cat.parent_id === parentId && cat.sort_order > maxOrder) {
      maxOrder = cat.sort_order;
    }
  }
  return maxOrder + 10;
}

function buildDuplicateCategoryError(name: string, parentId: string | null): Error {
  if (parentId) {
    return new Error(`A subcategory named "${name}" already exists under this category.`);
  }
  return new Error(`A category named "${name}" already exists.`);
}

interface InventorySyncSpec {
  payload: Database['public']['Tables']['inventory']['Update'];
  matchColumn: 'category_id' | 'subcategory_id';
  matchValue: string;
}

function resolveInventorySyncSpec(params: {
  categoryId: string;
  trimmedName: string;
  previousName: string | undefined;
  previousParentId: string | null;
  nextParentId: string | null;
  nextParent: Category | undefined;
}): InventorySyncSpec | null {
  const {
    categoryId,
    trimmedName,
    previousName,
    previousParentId,
    nextParentId,
    nextParent,
  } = params;

  if (previousParentId !== null && nextParentId === null) {
    return {
      payload: {
        category_id: categoryId,
        category: trimmedName,
        subcategory_id: null,
      },
      matchColumn: 'subcategory_id',
      matchValue: categoryId,
    };
  }

  if (previousParentId === null && nextParentId !== null && nextParent) {
    return {
      payload: {
        category_id: nextParent.id,
        category: nextParent.name,
        subcategory_id: categoryId,
      },
      matchColumn: 'category_id',
      matchValue: categoryId,
    };
  }

  if (
    previousParentId !== null &&
    nextParentId !== null &&
    previousParentId !== nextParentId &&
    nextParent
  ) {
    return {
      payload: {
        category_id: nextParent.id,
        category: nextParent.name,
      },
      matchColumn: 'subcategory_id',
      matchValue: categoryId,
    };
  }

  const nameChanged =
    previousName !== undefined ? previousName.trim() !== trimmedName : true;
  if (previousParentId === null && nextParentId === null && nameChanged) {
    return {
      payload: { category: trimmedName },
      matchColumn: 'category_id',
      matchValue: categoryId,
    };
  }

  return null;
}

/**
 * Provides Admin-guarded CRUD mutations for 2-level categories and
 * subcategories, keeping `inventory.category` text synced on top-level
 * renames and translating Postgres `23505` collisions into friendly errors.
 */
export function useCategoryMutations() {
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
      throw new Error('Only administrators can manage categories.');
    }
  }, [role]);

  const createMutation = useMutation<Category, Error, CreateCategoryInput>({
    mutationFn: async (input) => {
      assertCanMutate();

      const trimmedName = input.name.trim();
      if (!trimmedName) {
        throw new Error('Category name is required.');
      }

      const parentId = trimOrNull(input.parent_id);
      const allCategories = await queryClient.ensureQueryData({
        queryKey: queryKeys.categories,
        queryFn: fetchCategories,
      });

      if (parentId) {
        const parentRow = allCategories.find((cat) => cat.id === parentId);
        if (parentRow && parentRow.parent_id !== null) {
          throw new Error('Subcategories can only be created under top-level categories.');
        }
      }

      const color = normalizeCategoryColor(input.color);
      const icon = trimOrNull(input.icon) ?? 'tag';
      const sortOrder =
        input.sort_order ?? getNextCategorySortOrder(allCategories, parentId);

      const insertPayload: CategoryInsert = {
        name: trimmedName,
        parent_id: parentId,
        color,
        icon,
        sort_order: sortOrder,
      };

      const { data, error } = await supabase
        .from('categories')
        .insert([insertPayload])
        .select('*')
        .single();

      if (error) {
        if (isUniqueConstraintError(error)) {
          throw buildDuplicateCategoryError(trimmedName, parentId);
        }
        throw new Error(error.message);
      }

      await invalidateAll();
      return data;
    },
  });

  const updateMutation = useMutation<Category, Error, UpdateCategoryInput>({
    mutationFn: async (input) => {
      assertCanMutate();

      const trimmedName = input.name.trim();
      if (!trimmedName) {
        throw new Error('Category name is required.');
      }

      const allCategories = await queryClient.ensureQueryData({
        queryKey: queryKeys.categories,
        queryFn: fetchCategories,
      });
      const existing = allCategories.find((cat) => cat.id === input.id);
      const previousParentId = existing?.parent_id ?? null;
      const hasExplicitParent = input.parent_id !== undefined;
      const nextParentId = hasExplicitParent
        ? trimOrNull(input.parent_id)
        : previousParentId;
      let nextParent: Category | undefined;

      if (nextParentId === input.id) {
        throw new Error('A category cannot be its own parent.');
      }

      if (hasExplicitParent && nextParentId !== null) {
        const hasChildren = allCategories.some((cat) => cat.parent_id === input.id);
        if (hasChildren) {
          throw new Error('Cannot nest a category that already has subcategories.');
        }
        nextParent = allCategories.find((cat) => cat.id === nextParentId);
        if (!nextParent) {
          throw new Error('Selected parent category was not found.');
        }
        if (nextParent.parent_id !== null) {
          throw new Error('Subcategories can only be nested under top-level categories.');
        }
      }

      const updatePayload: CategoryUpdate = {
        name: trimmedName,
      };
      if (hasExplicitParent) {
        updatePayload.parent_id = nextParentId;
      }

      if (input.color !== undefined) {
        updatePayload.color = normalizeCategoryColor(input.color);
      }
      if (input.icon !== undefined) {
        updatePayload.icon = trimOrNull(input.icon) ?? 'tag';
      }
      if (input.sort_order !== undefined) {
        updatePayload.sort_order = input.sort_order;
      }

      const { data, error } = await supabase
        .from('categories')
        .update(updatePayload)
        .eq('id', input.id)
        .select('*')
        .single();

      if (error) {
        if (isUniqueConstraintError(error)) {
          throw buildDuplicateCategoryError(trimmedName, nextParentId);
        }
        throw new Error(error.message);
      }

      const syncSpec = resolveInventorySyncSpec({
        categoryId: input.id,
        trimmedName,
        previousName: input.previousName ?? existing?.name,
        previousParentId,
        nextParentId,
        nextParent,
      });

      if (syncSpec) {
        const { error: syncError } = await supabase
          .from('inventory')
          .update(syncSpec.payload)
          .eq(syncSpec.matchColumn, syncSpec.matchValue);

        if (syncError) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.categories });
          throw new Error(syncError.message);
        }
      }

      await invalidateAll();
      return data;
    },
  });

  const deleteMutation = useMutation<void, Error, DeleteCategoryTarget>({
    mutationFn: async (target) => {
      assertCanMutate();

      const categoryId = typeof target === 'string' ? target : target.id;
      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', categoryId);

      if (error) {
        throw new Error(error.message);
      }

      await invalidateAll();
    },
  });

  const { mutateAsync: runCreate } = createMutation;
  const { mutateAsync: runUpdate } = updateMutation;
  const { mutateAsync: runDelete } = deleteMutation;

  const createCategory = useCallback(
    (input: CreateCategoryInput) => runCreate(input),
    [runCreate]
  );

  const updateCategory = useCallback(
    (input: UpdateCategoryInput) => runUpdate(input),
    [runUpdate]
  );

  const deleteCategory = useCallback(
    (target: DeleteCategoryTarget) => runDelete(target),
    [runDelete]
  );

  return {
    createCategory,
    updateCategory,
    deleteCategory,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}
