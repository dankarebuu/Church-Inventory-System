import { AlertTriangle, CheckCircle2, Wrench, type LucideIcon } from 'lucide-react';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { isLoanOverdue } from '@/features/loans/schemas';
import type { Category, ItemCondition, LocationRecord } from '@/types/database';

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
  activeClassName: string;
}

export const QUICK_CHECK_ACTIONS: readonly QuickCheckAction[] = [
  {
    condition: 'working',
    label: 'OK',
    ariaLabel: 'OK',
    icon: CheckCircle2,
    activeClassName:
      'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  {
    condition: 'repair',
    label: 'Fix',
    ariaLabel: 'Fix',
    icon: Wrench,
    activeClassName:
      'border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300',
  },
  {
    condition: 'missing',
    label: 'Lost',
    ariaLabel: 'Lost',
    icon: AlertTriangle,
    activeClassName:
      'border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300',
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

export function isLoanDateOverdue(
  dueDate?: string | null,
  returnedAt?: string | null,
  referenceDate: Date = new Date()
): boolean {
  return isLoanOverdue(dueDate, returnedAt, referenceDate);
}
