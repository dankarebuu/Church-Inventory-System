import {
  Box,
  Cable,
  CircleHelp,
  Disc,
  Drum,
  Guitar,
  Headphones,
  Keyboard,
  Mic,
  Music,
  Piano,
  Sliders,
  Speaker,
  Tag,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import type { Category, EquipmentType, LocationRecord } from '@/types/database';

export interface CategoryIconOption {
  value: string;
  label: string;
  icon: LucideIcon;
}

export const CURATED_CATEGORY_ICONS: readonly CategoryIconOption[] = [
  { value: 'tag', label: 'Tag', icon: Tag },
  { value: 'drum', label: 'Drum', icon: Drum },
  { value: 'guitar', label: 'Guitar', icon: Guitar },
  { value: 'piano', label: 'Piano', icon: Piano },
  { value: 'headphones', label: 'Headphones', icon: Headphones },
  { value: 'mic', label: 'Mic', icon: Mic },
  { value: 'cable', label: 'Cable', icon: Cable },
  { value: 'speaker', label: 'Speaker', icon: Speaker },
  { value: 'box', label: 'Box', icon: Box },
  { value: 'wrench', label: 'Wrench', icon: Wrench },
  { value: 'music', label: 'Music', icon: Music },
  { value: 'sliders', label: 'Sliders', icon: Sliders },
] as const;

const EXTRA_LEGACY_ICONS: Record<string, LucideIcon> = {
  zap: Zap,
  keyboard: Keyboard,
  'help-circle': CircleHelp,
  disc: Disc,
};

const ICON_LOOKUP = new Map<string, LucideIcon>([
  ...CURATED_CATEGORY_ICONS.map((entry) => [entry.value, entry.icon] as const),
  ...Object.entries(EXTRA_LEGACY_ICONS),
]);

/**
 * Resolves a stored Lucide icon identifier (including curated and legacy
 * seeded category icons) to its Lucide component, falling back to `Tag`.
 */
export function resolveCategoryIcon(iconName?: string | null): LucideIcon {
  const key = iconName?.trim().toLowerCase() ?? '';
  return ICON_LOOKUP.get(key) ?? Tag;
}

export interface ColorSwatchOption {
  hex: string;
  label: string;
}

export const WINGMACC_COLOR_SWATCHES: readonly ColorSwatchOption[] = [
  { hex: '#d97740', label: 'Drums Terracotta (#d97740)' },
  { hex: '#e8a33d', label: 'Bass Amber (#e8a33d)' },
  { hex: '#d3554a', label: 'Guitar Crimson (#d3554a)' },
  { hex: '#5fa777', label: 'Acoustic Sage (#5fa777)' },
  { hex: '#4fa8a0', label: 'Keyboard Teal (#4fa8a0)' },
  { hex: '#9575b0', label: 'Monitor Lavender (#9575b0)' },
  { hex: '#4e7fb0', label: 'Spares Steel Blue (#4e7fb0)' },
  { hex: '#2563EB', label: 'WINGMACC Blue (#2563EB)' },
  { hex: '#059669', label: 'Emerald (#059669)' },
  { hex: '#8b92a0', label: 'Muted Slate (#8b92a0)' },
  { hex: '#7a8290', label: 'Neutral Gray (#7a8290)' },
] as const;

export interface CategoryItemCounts {
  byTopCategoryId: Map<string, number>;
  bySubcategoryId: Map<string, number>;
}

/**
 * Counts active inventory items per top-level category and subcategory using
 * foreign keys first, falling back to category name only when `category_id`
 * is unset.
 */
export function computeCategoryItemCounts(
  items: readonly EnrichedInventoryItem[],
  categories: readonly Category[]
): CategoryItemCounts {
  const byTopCategoryId = new Map<string, number>();
  const bySubcategoryId = new Map<string, number>();

  const topCategories = categories.filter((cat) => cat.parent_id === null);
  const topById = new Map(topCategories.map((cat) => [cat.id, cat]));
  const topByLowerName = new Map(
    topCategories.map((cat) => [cat.name.trim().toLowerCase(), cat])
  );
  const subById = new Map(
    categories.filter((cat) => cat.parent_id !== null).map((cat) => [cat.id, cat])
  );

  for (const item of items) {
    let resolvedTopId: string | null = null;

    if (item.category_id && topById.has(item.category_id)) {
      resolvedTopId = item.category_id;
    }

    if (item.subcategory_id && subById.has(item.subcategory_id)) {
      bySubcategoryId.set(
        item.subcategory_id,
        (bySubcategoryId.get(item.subcategory_id) ?? 0) + 1
      );
      if (!resolvedTopId) {
        resolvedTopId = subById.get(item.subcategory_id)?.parent_id ?? null;
      }
    }

    if (!resolvedTopId && !item.category_id && item.category) {
      const matched = topByLowerName.get(item.category.trim().toLowerCase());
      if (matched) {
        resolvedTopId = matched.id;
      }
    }

    if (resolvedTopId) {
      byTopCategoryId.set(resolvedTopId, (byTopCategoryId.get(resolvedTopId) ?? 0) + 1);
    }
  }

  return { byTopCategoryId, bySubcategoryId };
}

/**
 * Counts active inventory items per storage location using `location_id`
 * first and falling back to `location` name when `location_id` is unset.
 */
export function computeLocationItemCounts(
  items: readonly EnrichedInventoryItem[],
  locations: readonly LocationRecord[]
): Map<string, number> {
  const byLocationId = new Map<string, number>();
  const locById = new Map(locations.map((loc) => [loc.id, loc]));
  const locByLowerName = new Map(
    locations.map((loc) => [loc.name.trim().toLowerCase(), loc])
  );

  for (const item of items) {
    let resolvedLocId: string | null = null;
    if (item.location_id && locById.has(item.location_id)) {
      resolvedLocId = item.location_id;
    } else if (!item.location_id && item.location) {
      const matched = locByLowerName.get(item.location.trim().toLowerCase());
      if (matched) {
        resolvedLocId = matched.id;
      }
    }

    if (resolvedLocId) {
      byLocationId.set(resolvedLocId, (byLocationId.get(resolvedLocId) ?? 0) + 1);
    }
  }

  return byLocationId;
}

/**
 * Counts active inventory items per equipment type using `equipment_type_id`
 * first and falling back to case-insensitive `equipment_type` name.
 */
export function computeEquipmentTypeItemCounts(
  items: readonly EnrichedInventoryItem[],
  equipmentTypes: readonly EquipmentType[]
): Map<string, number> {
  const byTypeId = new Map<string, number>();
  const typeById = new Map(equipmentTypes.map((et) => [et.id, et]));
  const typeByLowerName = new Map(
    equipmentTypes.map((et) => [et.name.trim().toLowerCase(), et])
  );

  for (const item of items) {
    let resolvedTypeId: string | null = null;
    if (item.equipment_type_id && typeById.has(item.equipment_type_id)) {
      resolvedTypeId = item.equipment_type_id;
    } else if (!item.equipment_type_id && item.equipment_type) {
      const matched = typeByLowerName.get(item.equipment_type.trim().toLowerCase());
      if (matched) {
        resolvedTypeId = matched.id;
      }
    }

    if (resolvedTypeId) {
      byTypeId.set(resolvedTypeId, (byTypeId.get(resolvedTypeId) ?? 0) + 1);
    }
  }

  return byTypeId;
}

/**
 * Formats an item count with singular/plural noun agreement.
 */
export function formatItemCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

/**
 * Formats a subcategory count with singular/plural noun agreement.
 */
export function formatSubcategoryCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'subcategory' : 'subcategories'}`;
}
