import { AlertTriangle, CheckCircle2, Wrench, type LucideIcon } from 'lucide-react';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { isLoanOverdue } from '@/features/loans/schemas';
import { formatDisplayDate, trimOrNull } from '@/lib/utils';
import type {
  Category,
  EquipmentType,
  ItemCondition,
  LocationRecord,
  PublicInventoryItem,
} from '@/types/database';

export interface ConditionDisplayMeta {
  label: string;
  shortLabel: string;
  badgeVariant: 'working' | 'repair' | 'missing';
}

export const CONDITION_META: Record<ItemCondition, ConditionDisplayMeta> = {
  working: {
    label: 'Working',
    shortLabel: 'OK',
    badgeVariant: 'working',
  },
  repair: {
    label: 'Needs Repair',
    shortLabel: 'Fix',
    badgeVariant: 'repair',
  },
  missing: {
    label: 'Missing',
    shortLabel: 'Lost',
    badgeVariant: 'missing',
  },
};

export interface QuickCheckAction {
  condition: ItemCondition;
  label: string;
  ariaLabel: string;
  icon: LucideIcon;
  hoverClassName: string;
  activeClassName: string;
}

export const QUICK_CHECK_ACTIONS: readonly QuickCheckAction[] = [
  {
    condition: 'working',
    label: 'OK',
    ariaLabel: 'OK',
    icon: CheckCircle2,
    hoverClassName:
      'hover:border-emerald-500/35 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300',
    activeClassName:
      'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200',
  },
  {
    condition: 'repair',
    label: 'Fix',
    ariaLabel: 'Fix',
    icon: Wrench,
    hoverClassName:
      'hover:border-amber-500/35 hover:bg-amber-500/10 hover:text-amber-800 dark:hover:text-amber-300',
    activeClassName:
      'border-amber-500/40 bg-amber-500/15 text-amber-800 hover:bg-amber-500/20 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200',
  },
  {
    condition: 'missing',
    label: 'Lost',
    ariaLabel: 'Lost',
    icon: AlertTriangle,
    hoverClassName:
      'hover:border-red-500/35 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300',
    activeClassName:
      'border-red-500/40 bg-red-500/15 text-red-700 hover:bg-red-500/20 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200',
  },
];

export function resolveCategoryName(
  item: Pick<EnrichedInventoryItem, 'category' | 'category_id'>,
  categories: readonly Category[]
): string {
  if (item.category_id) {
    const matched = categories.find((cat) => cat.id === item.category_id);
    if (matched) return matched.name;
  }
  return item.category || 'Uncategorized';
}

export function resolveSubcategoryName(
  item: Pick<EnrichedInventoryItem, 'subcategory_id'>,
  categories: readonly Category[]
): string | null {
  if (!item.subcategory_id) return null;
  const matched = categories.find((cat) => cat.id === item.subcategory_id);
  return matched ? matched.name : null;
}

export function resolveLocationName(
  item: Pick<EnrichedInventoryItem, 'location' | 'location_id'>,
  locations: readonly LocationRecord[]
): string {
  if (item.location_id) {
    const matched = locations.find((loc) => loc.id === item.location_id);
    if (matched) return matched.name;
  }
  return item.location?.trim() || '—';
}

/**
 * Resolves the display name of an item's equipment type via `equipment_type_id`
 * first, falling back to the denormalized `equipment_type` text column.
 */
export function resolveEquipmentTypeName(
  item: Pick<PublicInventoryItem, 'equipment_type' | 'equipment_type_id'>,
  equipmentTypes: readonly EquipmentType[] = []
): string | null {
  if (item.equipment_type_id) {
    const matched = equipmentTypes.find((et) => et.id === item.equipment_type_id);
    if (matched) return matched.name;
  }
  return trimOrNull(item.equipment_type);
}

/**
 * Returns true when an item has a configured non-null `min_qty` threshold and
 * its total `qty` is at or below that threshold (`qty <= min_qty`).
 */
export function isLowStock(
  item: Pick<PublicInventoryItem, 'qty' | 'min_qty'> | { qty: number; min_qty?: number | null }
): boolean {
  return item.min_qty !== null && item.min_qty !== undefined && item.qty <= item.min_qty;
}

export function formatLastCheckedDate(
  item: Pick<PublicInventoryItem, 'checked_at' | 'dateChecked'>
): string {
  return formatDisplayDate(trimOrNull(item.checked_at) ?? item.dateChecked);
}

export function isLoanDateOverdue(
  dueDate?: string | null,
  returnedAt?: string | null,
  referenceDate: Date = new Date()
): boolean {
  return isLoanOverdue(dueDate, returnedAt, referenceDate);
}
