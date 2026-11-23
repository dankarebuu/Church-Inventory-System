import { getCategoryColor } from '@/features/categories/useCategories';
import {
  resolveCategoryName,
  resolveEquipmentTypeName,
  resolveLocationName,
  resolveSubcategoryName,
} from '@/features/inventory/inventoryUi';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { isSameLocalDay } from '@/lib/utils';
import type {
  Category,
  EquipmentType,
  ItemCondition,
  LocationRecord,
  PublicInventoryItem,
} from '@/types/database';

export interface ChecklistProgress {
  checked: number;
  total: number;
  percent: number;
}

export interface ChecklistFilterOptions {
  search?: string;
  categoryId?: string;
  locationId?: string;
  uncheckedOnly?: boolean;
  categories: readonly Category[];
  locations: readonly LocationRecord[];
  equipmentTypes?: readonly EquipmentType[];
  referenceDate?: Date;
  includeCheckedByInSearch?: boolean;
}

export interface ChecklistCategoryGroup<T> {
  key: string;
  label: string;
  color: string;
  sortOrder: number;
  items: T[];
}

/**
 * Safe printable checklist item projection. Intentionally excludes `checkedBy`,
 * `activeLoans`, and all borrower PII so neither Guest mode nor Print/PDF
 * exports can leak personal information.
 */
export interface PrintableChecklistItem {
  id: string;
  item: string;
  categoryName: string;
  subcategoryName: string | null;
  categoryColor: string;
  brand: string | null;
  qty: number;
  qtyOnLoan: number;
  availableQty: number;
  locationName: string;
  owner: string | null;
  condition: ItemCondition;
  serial: string | null;
}

/**
 * Checks whether an inventory item's `checked_at` timestamp falls on the same
 * local calendar day as `referenceDate` (timezone-safe local midnight check).
 */
export function isCheckedToday(
  checkedAt?: string | null,
  referenceDate: Date = new Date()
): boolean {
  return isSameLocalDay(checkedAt, referenceDate);
}

/**
 * Computes Sunday check-off progress counts and rounded percentage across
 * inventory items using local calendar day boundaries.
 */
export function computeChecklistProgress(
  items: readonly Pick<PublicInventoryItem, 'checked_at'>[],
  referenceDate: Date = new Date()
): ChecklistProgress {
  const total = items.length;
  if (total === 0) {
    return { checked: 0, total: 0, percent: 0 };
  }

  let checked = 0;
  for (const item of items) {
    if (isCheckedToday(item.checked_at, referenceDate)) {
      checked += 1;
    }
  }

  return {
    checked,
    total,
    percent: Math.round((checked / total) * 100),
  };
}

/**
 * Filters checklist items by category, storage location, search query, and
 * optional "unchecked today" status.
 */
export function filterChecklistItems<T extends EnrichedInventoryItem>(
  items: readonly T[],
  options: ChecklistFilterOptions
): T[] {
  const {
    search = '',
    categoryId = '',
    locationId = '',
    uncheckedOnly = false,
    categories,
    locations,
    equipmentTypes = [],
    referenceDate = new Date(),
    includeCheckedByInSearch = false,
  } = options;

  const query = search.trim().toLowerCase();
  const matchedCategory = categoryId
    ? categories.find((cat) => cat.id === categoryId)
    : undefined;
  const matchedLocation = locationId
    ? locations.find((loc) => loc.id === locationId)
    : undefined;

  return items.filter((item) => {
    if (categoryId) {
      const matchesCatId = item.category_id === categoryId;
      const itemCatName = item.category?.trim().toLowerCase() ?? '';
      const matchesCatName = matchedCategory
        ? itemCatName === matchedCategory.name.trim().toLowerCase()
        : itemCatName === categoryId.trim().toLowerCase();
      if (!matchesCatId && !matchesCatName) return false;
    }

    if (locationId) {
      const matchesLocId = item.location_id === locationId;
      const itemLocName = item.location?.trim().toLowerCase() ?? '';
      const matchesLocName = matchedLocation
        ? itemLocName === matchedLocation.name.trim().toLowerCase()
        : itemLocName === locationId.trim().toLowerCase();
      if (!matchesLocId && !matchesLocName) return false;
    }

    if (uncheckedOnly && isCheckedToday(item.checked_at, referenceDate)) {
      return false;
    }

    if (query) {
      const categoryName = resolveCategoryName(item, categories);
      const subName = resolveSubcategoryName(item, categories);
      const typeName = resolveEquipmentTypeName(item, equipmentTypes);
      const locationName = resolveLocationName(item, locations);
      const parts: Array<string | null | undefined> = [
        item.item,
        item.brand,
        categoryName,
        item.category,
        subName,
        typeName,
        item.equipment_type,
        locationName === '—' ? null : locationName,
        item.location,
        item.owner,
        item.serial,
        item.remarks,
      ];
      if (includeCheckedByInSearch) {
        parts.push(item.checkedBy);
      }
      const haystack = parts
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

/**
 * Groups checklist items into top-level categories ordered by `sort_order`,
 * then category name, with items sorted alphabetically inside each group.
 */
export function groupChecklistItemsByCategory<
  T extends Pick<PublicInventoryItem, 'category' | 'category_id' | 'item'>,
>(items: readonly T[], categories: readonly Category[]): ChecklistCategoryGroup<T>[] {
  const map = new Map<string, ChecklistCategoryGroup<T>>();

  for (const item of items) {
    const label = resolveCategoryName(item, categories);
    const matchedCat =
      (item.category_id ? categories.find((cat) => cat.id === item.category_id) : undefined) ??
      categories.find(
        (cat) =>
          cat.parent_id === null &&
          cat.name.trim().toLowerCase() === label.trim().toLowerCase()
      );
    const key = matchedCat?.id ?? `name:${label.toLowerCase()}`;
    const color = getCategoryColor(label, categories, item.category_id);
    const sortOrder = matchedCat?.sort_order ?? 9999;

    const existing = map.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      map.set(key, {
        key,
        label,
        color,
        sortOrder,
        items: [item],
      });
    }
  }

  return [...map.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => a.item.localeCompare(b.item)),
    }))
    .sort((a, b) => {
      const orderDiff = a.sortOrder - b.sortOrder;
      if (orderDiff !== 0) return orderDiff;
      return a.label.localeCompare(b.label);
    });
}

/**
 * Maps an inventory record to a PII-stripped printable checklist row while
 * preserving `qty = 0` accurately.
 */
export function toPrintableChecklistItem(
  item: Pick<
    PublicInventoryItem,
    | 'id'
    | 'item'
    | 'category'
    | 'category_id'
    | 'subcategory_id'
    | 'brand'
    | 'qty'
    | 'qty_on_loan'
    | 'available_qty'
    | 'location'
    | 'location_id'
    | 'owner'
    | 'condition'
    | 'serial'
  >,
  categories: readonly Category[],
  locations: readonly LocationRecord[]
): PrintableChecklistItem {
  const categoryName = resolveCategoryName(item, categories);
  const safeQty = Number.isFinite(item.qty) ? Math.max(item.qty, 0) : 0;
  const safeOnLoan = Number.isFinite(item.qty_on_loan) ? Math.max(item.qty_on_loan, 0) : 0;
  const safeAvailable = Number.isFinite(item.available_qty)
    ? Math.max(item.available_qty, 0)
    : Math.max(safeQty - safeOnLoan, 0);

  return {
    id: item.id,
    item: item.item,
    categoryName,
    subcategoryName: resolveSubcategoryName(item, categories),
    categoryColor: getCategoryColor(categoryName, categories, item.category_id),
    brand: item.brand?.trim() ? item.brand.trim() : null,
    qty: safeQty,
    qtyOnLoan: safeOnLoan,
    availableQty: safeAvailable,
    locationName: resolveLocationName(item, locations),
    owner: item.owner?.trim() ? item.owner.trim() : null,
    condition: item.condition,
    serial: item.serial?.trim() ? item.serial.trim() : null,
  };
}

/**
 * Formats a `Date` into local `YYYY-MM-DD` for timezone-safe PDF filenames.
 */
export function formatLocalYmd(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats a `Date` into a full Sunday checklist header string (e.g.
 * `Sunday, November 22, 2026`).
 */
export function formatChecklistPrintDate(date: Date = new Date()): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
