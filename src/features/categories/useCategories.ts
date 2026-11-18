import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { Category } from '@/types/database';

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
  return useQuery<Category[], Error>({
    queryKey: queryKeys.categories,
    queryFn: fetchCategories,
    enabled: isSupabaseConfigured,
    initialData: isSupabaseConfigured ? undefined : EMPTY_CATEGORIES,
  });
}
