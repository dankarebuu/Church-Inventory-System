import { useMemo, useState, type CSSProperties } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Box,
  CalendarCheck2,
  CheckCircle2,
  ClipboardCheck,
  FolderTree,
  History,
  Package,
  RefreshCw,
  Tags,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { describeHistoryEntry, resolveHistoryItemName, useActivityLog } from '@/features/activity/useActivityLog';
import { useAuth } from '@/features/auth/useAuth';
import { buildCategoryTree, getCategoryColor, useCategories } from '@/features/categories/useCategories';
import { CheckOffTrendChart } from '@/features/dashboard/CheckOffTrendChart';
import {
  buildCheckOffTrend,
  computeCheckOffFreshness,
  formatCompactCount,
  formatWholePercent,
  sortHealthBucketsForAttention,
} from '@/features/dashboard/dashboardCharts';
import {
  DEFAULT_EQUIPMENT_TYPE_COLOR,
  getEquipmentTypeColor,
  sortEquipmentTypes,
  useEquipmentTypes,
} from '@/features/equipmentTypes/useEquipmentTypes';
import { CONDITION_META, isLowStock } from '@/features/inventory/inventoryUi';
import { useInventoryItems, type EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { isLoanOverdue } from '@/features/loans/schemas';
import { useLoans } from '@/features/loans/useLoans';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { DashboardSkeleton, FeedListSkeleton } from '@/components/ui/skeleton';
import { cn, formatDisplayDate, getUserEmailPrefix, trimOrNull } from '@/lib/utils';
import type {
  Category,
  EquipmentType,
  HistoryAction,
  HistoryEntry,
  LoanRecord,
} from '@/types/database';

const EMPTY_ITEMS: EnrichedInventoryItem[] = [];
const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_EQUIPMENT_TYPES: EquipmentType[] = [];
const MAX_ATTENTION_ITEMS = 8;
const MAX_ACTIVE_LOANS = 5;
const MAX_RECENT_ACTIVITY = 5;

interface KpiCardSpec {
  id: string;
  testId: string;
  label: string;
  value: number;
  sublabel: string;
  to: string;
  icon: LucideIcon;
  tone?: 'default' | 'success' | 'danger' | 'info';
  badge?: string;
}

interface CategoryHealthBucket {
  key: string;
  name: string;
  linkParam: string;
  color: string;
  itemCount: number;
  unitCount: number;
  workingCount: number;
  flaggedCount: number;
  onLoanUnits: number;
  healthPercent: number;
}

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'working'
  | 'repair'
  | 'missing'
  | 'loaned';

const HISTORY_ACTION_META: Record<HistoryAction, { label: string; badgeVariant: BadgeVariant }> = {
  added: { label: 'Added', badgeVariant: 'working' },
  updated: { label: 'Updated', badgeVariant: 'outline' },
  checked: { label: 'Checked', badgeVariant: 'working' },
  deleted: { label: 'Deleted', badgeVariant: 'repair' },
  restored: { label: 'Restored', badgeVariant: 'working' },
  import: { label: 'Import', badgeVariant: 'loaned' },
  loan: { label: 'Loan', badgeVariant: 'loaned' },
};

function getHistoryActionMeta(
  action: string | null | undefined
): { label: string; badgeVariant: BadgeVariant } {
  if (
    typeof action === 'string' &&
    Object.prototype.hasOwnProperty.call(HISTORY_ACTION_META, action)
  ) {
    return HISTORY_ACTION_META[action as HistoryAction];
  }
  const formatted = typeof action === 'string' && action.trim() ? action.trim() : null;
  return {
    label: formatted ? formatted.charAt(0).toUpperCase() + formatted.slice(1) : 'Activity',
    badgeVariant: 'outline',
  };
}

function getSafeConditionMeta(
  condition: unknown
): { label: string; badgeVariant: BadgeVariant } {
  if (
    typeof condition === 'string' &&
    Object.prototype.hasOwnProperty.call(CONDITION_META, condition)
  ) {
    return CONDITION_META[condition as keyof typeof CONDITION_META];
  }
  const formatted = typeof condition === 'string' && condition.trim() ? condition.trim() : null;
  return {
    label: formatted ? formatted.charAt(0).toUpperCase() + formatted.slice(1) : 'Unknown',
    badgeVariant: 'repair',
  };
}

const KPI_ICON_CLASSES: Record<NonNullable<KpiCardSpec['tone']>, string> = {
  default: 'bg-secondary text-foreground',
  success: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  danger: 'bg-red-500/12 text-red-600 dark:text-red-400',
  info: 'bg-primary/12 text-primary',
};

function safeNonNegativeInt(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

function formatPluralCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatShortTimestamp(isoString: string): string {
  const dateLabel = formatDisplayDate(isoString);
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return dateLabel;
  }
  const timeLabel = parsed.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${dateLabel} · ${timeLabel}`;
}

function buildCategoryHealthBuckets(
  items: readonly EnrichedInventoryItem[],
  categories: readonly Category[]
): CategoryHealthBucket[] {
  const tree = buildCategoryTree(categories);
  const topById = new Map(tree.map((node) => [node.id, node]));
  const topByLowerName = new Map(
    tree.map((node) => [node.name.trim().toLowerCase(), node])
  );
  const parentBySubId = new Map<string, string>();
  for (const cat of categories) {
    if (cat.parent_id && topById.has(cat.parent_id)) {
      parentBySubId.set(cat.id, cat.parent_id);
    }
  }

  interface MutableBucket {
    key: string;
    name: string;
    linkParam: string;
    color: string;
    itemCount: number;
    unitCount: number;
    workingCount: number;
    flaggedCount: number;
    onLoanUnits: number;
  }

  const buckets = new Map<string, MutableBucket>();
  for (const node of tree) {
    buckets.set(node.id, {
      key: node.id,
      name: node.name,
      linkParam: node.id,
      color: node.color || getCategoryColor(node.name, categories, node.id),
      itemCount: 0,
      unitCount: 0,
      workingCount: 0,
      flaggedCount: 0,
      onLoanUnits: 0,
    });
  }

  for (const item of items) {
    let targetTopId: string | null = null;
    if (item.category_id && topById.has(item.category_id)) {
      targetTopId = item.category_id;
    } else if (item.category_id && parentBySubId.has(item.category_id)) {
      targetTopId = parentBySubId.get(item.category_id) ?? null;
    } else if (item.subcategory_id && parentBySubId.has(item.subcategory_id)) {
      targetTopId = parentBySubId.get(item.subcategory_id) ?? null;
    } else if (item.category?.trim()) {
      const matchedByName = topByLowerName.get(item.category.trim().toLowerCase());
      if (matchedByName) {
        targetTopId = matchedByName.id;
      }
    }

    let bucket: MutableBucket | undefined = targetTopId ? buckets.get(targetTopId) : undefined;
    if (!bucket) {
      const fallbackName = item.category?.trim() || 'Uncategorized';
      const fallbackKey = `name:${fallbackName.toLowerCase()}`;
      bucket = buckets.get(fallbackKey);
      if (!bucket) {
        bucket = {
          key: fallbackKey,
          name: fallbackName,
          linkParam: fallbackName,
          color: getCategoryColor(fallbackName, categories, item.category_id),
          itemCount: 0,
          unitCount: 0,
          workingCount: 0,
          flaggedCount: 0,
          onLoanUnits: 0,
        };
        buckets.set(fallbackKey, bucket);
      }
    }

    bucket.itemCount += 1;
    bucket.unitCount += safeNonNegativeInt(item.qty);
    bucket.onLoanUnits += safeNonNegativeInt(item.qty_on_loan);
    if (item.condition === 'working') {
      bucket.workingCount += 1;
    } else {
      bucket.flaggedCount += 1;
    }
  }

  return [...buckets.values()].map((bucket) => ({
    ...bucket,
    healthPercent:
      bucket.itemCount > 0 ? Math.round((bucket.workingCount / bucket.itemCount) * 100) : 100,
  }));
}

function buildEquipmentTypeHealthBuckets(
  items: readonly EnrichedInventoryItem[],
  equipmentTypes: readonly EquipmentType[]
): CategoryHealthBucket[] {
  const sortedTypes = sortEquipmentTypes(equipmentTypes);
  const typeById = new Map(sortedTypes.map((et) => [et.id, et]));
  const typeByLowerName = new Map(
    sortedTypes.map((et) => [et.name.trim().toLowerCase(), et])
  );

  interface MutableBucket {
    key: string;
    name: string;
    linkParam: string;
    color: string;
    itemCount: number;
    unitCount: number;
    workingCount: number;
    flaggedCount: number;
    onLoanUnits: number;
  }

  const buckets = new Map<string, MutableBucket>();
  for (const et of sortedTypes) {
    buckets.set(et.id, {
      key: et.id,
      name: et.name,
      linkParam: et.id,
      color: et.color || getEquipmentTypeColor(et.name, equipmentTypes, et.id),
      itemCount: 0,
      unitCount: 0,
      workingCount: 0,
      flaggedCount: 0,
      onLoanUnits: 0,
    });
  }

  const unassignedBucket: MutableBucket = {
    key: '__unassigned__',
    name: 'Unassigned Type',
    linkParam: '__unassigned__',
    color: DEFAULT_EQUIPMENT_TYPE_COLOR,
    itemCount: 0,
    unitCount: 0,
    workingCount: 0,
    flaggedCount: 0,
    onLoanUnits: 0,
  };

  for (const item of items) {
    let targetBucket: MutableBucket | undefined;
    if (item.equipment_type_id && typeById.has(item.equipment_type_id)) {
      targetBucket = buckets.get(item.equipment_type_id);
    } else if (!item.equipment_type_id) {
      const textName = trimOrNull(item.equipment_type);
      if (textName) {
        const matched = typeByLowerName.get(textName.toLowerCase());
        if (matched) {
          targetBucket = buckets.get(matched.id);
        }
      }
    }

    if (!targetBucket) {
      const textName = trimOrNull(item.equipment_type);
      if (textName) {
        const fallbackKey = `name:${textName.toLowerCase()}`;
        targetBucket = buckets.get(fallbackKey);
        if (!targetBucket) {
          targetBucket = {
            key: fallbackKey,
            name: textName,
            linkParam: textName,
            color: getEquipmentTypeColor(textName, equipmentTypes, item.equipment_type_id),
            itemCount: 0,
            unitCount: 0,
            workingCount: 0,
            flaggedCount: 0,
            onLoanUnits: 0,
          };
          buckets.set(fallbackKey, targetBucket);
        }
      } else {
        targetBucket = unassignedBucket;
      }
    }

    targetBucket.itemCount += 1;
    targetBucket.unitCount += safeNonNegativeInt(item.qty);
    targetBucket.onLoanUnits += safeNonNegativeInt(item.qty_on_loan);
    if (item.condition === 'working') {
      targetBucket.workingCount += 1;
    } else {
      targetBucket.flaggedCount += 1;
    }
  }

  const allBuckets = [...buckets.values()];
  if (unassignedBucket.itemCount > 0) {
    allBuckets.push(unassignedBucket);
  }

  return allBuckets.map((bucket) => ({
    ...bucket,
    healthPercent:
      bucket.itemCount > 0 ? Math.round((bucket.workingCount / bucket.itemCount) * 100) : 100,
  }));
}

function sortActiveLoansForTriage(loans: readonly LoanRecord[]): LoanRecord[] {
  return [...loans].sort((a, b) => {
    const aOverdue = isLoanOverdue(a.due_date, a.returned_at);
    const bOverdue = isLoanOverdue(b.due_date, b.returned_at);
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

    const aDue = a.due_date ?? '9999-12-31';
    const bDue = b.due_date ?? '9999-12-31';
    const dueCmp = aDue.localeCompare(bDue);
    if (dueCmp !== 0) return dueCmp;

    return b.checked_out_at.localeCompare(a.checked_out_at);
  });
}

function PanelErrorBox({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 sm:flex-row sm:items-center"
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{message}</p>
        </div>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw className="size-3.5" aria-hidden="true" />
        <span>Retry</span>
      </Button>
    </div>
  );
}

/**
 * Operations Dashboard (`/dashboard`) providing clickable inventory KPIs,
 * Needs Attention triage, Category Health Breakdown, and role-isolated
 * Active & Overdue Loans + Recent Activity previews for Members and Admins.
 */
export function DashboardPage() {
  const { role } = useAuth();
  const canViewOperationalData = role !== 'guest';
  const [healthGroupBy, setHealthGroupBy] = useState<'type' | 'rig'>('type');

  const {
    data: items = EMPTY_ITEMS,
    isLoading: isLoadingInventory,
    isError: isInventoryError,
    error: inventoryError,
    refetch: refetchInventory,
  } = useInventoryItems(role);

  const {
    data: categories = EMPTY_CATEGORIES,
    isLoading: isLoadingCategories,
    isError: isCategoriesError,
    error: categoriesError,
    refetch: refetchCategories,
  } = useCategories();

  const {
    data: equipmentTypes = EMPTY_EQUIPMENT_TYPES,
    isLoading: isLoadingEquipmentTypes,
    isError: isEquipmentTypesError,
    error: equipmentTypesError,
    refetch: refetchEquipmentTypes,
  } = useEquipmentTypes();

  const {
    activeLoans,
    isLoading: isLoadingLoans,
    isError: isLoansError,
    error: loansError,
    refetch: refetchLoans,
  } = useLoans(canViewOperationalData);

  const {
    entries: activityEntries,
    isLoading: isLoadingActivity,
    isError: isActivityError,
    error: activityError,
    refetch: refetchActivity,
  } = useActivityLog(canViewOperationalData);

  const itemsById = useMemo(() => {
    const map = new Map<string, EnrichedInventoryItem>();
    for (const item of items) {
      map.set(item.id, item);
    }
    return map;
  }, [items]);

  const metrics = useMemo(() => {
    let totalUnits = 0;
    let workingCount = 0;
    let repairCount = 0;
    let missingCount = 0;
    let onLoanUnits = 0;
    let onLoanItemCount = 0;

    for (const item of items) {
      totalUnits += safeNonNegativeInt(item.qty);
      if (item.condition === 'working') {
        workingCount += 1;
      } else if (item.condition === 'repair') {
        repairCount += 1;
      } else {
        missingCount += 1;
      }

      const itemLoanUnits = safeNonNegativeInt(item.qty_on_loan);
      if (itemLoanUnits > 0) {
        onLoanUnits += itemLoanUnits;
        onLoanItemCount += 1;
      }
    }

    return {
      loggedItems: items.length,
      totalUnits,
      workingCount,
      repairCount,
      missingCount,
      flaggedCount: repairCount + missingCount,
      onLoanUnits,
      onLoanItemCount,
    };
  }, [items]);

  const flaggedItems = useMemo(() => {
    return items
      .filter((item) => item.condition !== 'working')
      .sort((a, b) => {
        if (a.condition !== b.condition) {
          return a.condition === 'missing' ? -1 : 1;
        }
        return a.item.localeCompare(b.item);
      });
  }, [items]);

  const categoryHealth = useMemo(
    () => buildCategoryHealthBuckets(items, categories),
    [items, categories]
  );

  const equipmentTypeHealth = useMemo(
    () => buildEquipmentTypeHealthBuckets(items, equipmentTypes),
    [items, equipmentTypes]
  );

  const lowStockItems = useMemo(
    () =>
      items
        .filter((item) => isLowStock(item))
        .sort((a, b) => a.item.localeCompare(b.item)),
    [items]
  );

  const sortedActiveLoans = useMemo(
    () => (canViewOperationalData ? sortActiveLoansForTriage(activeLoans) : []),
    [activeLoans, canViewOperationalData]
  );

  const overdueLoansCount = useMemo(
    () =>
      canViewOperationalData
        ? sortedActiveLoans.filter((loan) => isLoanOverdue(loan.due_date, loan.returned_at)).length
        : 0,
    [sortedActiveLoans, canViewOperationalData]
  );

  const recentActivity = useMemo(
    () => (canViewOperationalData ? activityEntries.slice(0, MAX_RECENT_ACTIVITY) : []),
    [activityEntries, canViewOperationalData]
  );

  const workingPercent = useMemo(
    () => formatWholePercent(metrics.workingCount, metrics.loggedItems),
    [metrics.workingCount, metrics.loggedItems]
  );

  const freshness = useMemo(() => computeCheckOffFreshness(items), [items]);
  const checkOffTrend = useMemo(() => buildCheckOffTrend(items, 14), [items]);

  const sortedHealthBuckets = useMemo(() => {
    const raw = healthGroupBy === 'type' ? equipmentTypeHealth : categoryHealth;
    return sortHealthBucketsForAttention(raw);
  }, [healthGroupBy, equipmentTypeHealth, categoryHealth]);

  const supportMetricPills = useMemo<KpiCardSpec[]>(() => {
    return [
      {
        id: 'logged-items',
        testId: 'kpi-logged-items',
        label: 'Logged Items',
        value: metrics.loggedItems,
        sublabel: 'Catalog records',
        to: '/inventory',
        icon: Package,
        tone: 'default',
      },
      {
        id: 'total-units',
        testId: 'kpi-total-units',
        label: 'Total Units',
        value: metrics.totalUnits,
        sublabel: 'Tracked in inventory',
        to: '/inventory',
        icon: Box,
        tone: 'default',
      },
      {
        id: 'flagged',
        testId: 'kpi-flagged',
        label: 'Flagged',
        value: metrics.flaggedCount,
        sublabel:
          metrics.flaggedCount > 0
            ? `${metrics.repairCount} repair · ${metrics.missingCount} missing`
            : 'No gear flagged',
        to: '/inventory?condition=flagged',
        icon: AlertTriangle,
        tone: metrics.flaggedCount > 0 ? 'danger' : 'default',
      },
      {
        id: 'on-loan',
        testId: 'kpi-on-loan',
        label: 'On Loan',
        value: metrics.onLoanUnits,
        sublabel:
          metrics.onLoanItemCount > 0
            ? `Across ${formatPluralCount(metrics.onLoanItemCount, 'item', 'items')}`
            : 'All gear in house',
        to: canViewOperationalData ? '/loans' : '/inventory?loan=on-loan',
        icon: ArrowLeftRight,
        tone: metrics.onLoanUnits > 0 ? 'info' : 'default',
        badge:
          canViewOperationalData && overdueLoansCount > 0
            ? `${overdueLoansCount} Overdue`
            : undefined,
      },
    ];
  }, [canViewOperationalData, metrics, overdueLoansCount]);

  const isCoreLoading = isLoadingInventory || isLoadingCategories || isLoadingEquipmentTypes;
  const isCoreError = isInventoryError || isCategoriesError || isEquipmentTypesError;
  const coreErrorMessage =
    inventoryError?.message ??
    categoriesError?.message ??
    equipmentTypesError?.message ??
    'Unable to load operations dashboard data.';

  const visibleFlaggedItems = flaggedItems.slice(0, MAX_ATTENTION_ITEMS);
  const visibleActiveLoans = sortedActiveLoans.slice(0, MAX_ACTIVE_LOANS);

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-block rounded bg-primary/10 px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wider text-primary">
            Workspace Overview
          </span>
          <h1 className="font-display mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Operations Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Equipment readiness, flagged items, category health, and live service status.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/inventory">
              <Package className="size-4" aria-hidden="true" />
              <span>Browse Inventory</span>
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/checklist">
              <ClipboardCheck className="size-4" aria-hidden="true" />
              <span>Sunday Checklist</span>
            </Link>
          </Button>
        </div>
      </div>

      {isCoreLoading ? (
        <DashboardSkeleton label="Loading operations dashboard..." />
      ) : isCoreError ? (
        <div
          role="alert"
          className="flex flex-col items-start justify-between gap-4 rounded-xl border border-destructive/40 bg-destructive/10 p-6 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <p className="font-semibold text-foreground">Unable to load dashboard</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{coreErrorMessage}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void Promise.all([
                refetchInventory(),
                refetchCategories(),
                refetchEquipmentTypes(),
              ]);
            }}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>Retry</span>
          </Button>
        </div>
      ) : (
        <>
          {/* 01 One Number First + 02 Add a Comparison: Hero Readiness Card & Supporting Strip */}
          <div className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-card">
            <Link
              to="/inventory?condition=working"
              data-testid="kpi-working"
              className="group flex flex-col gap-5 p-5 transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:p-6"
            >
              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                  >
                    <CheckCircle2 className="size-4" />
                  </span>
                  <span className="font-sans text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Working Items
                  </span>
                </div>

                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="font-display text-4xl font-bold tracking-tight tabular-nums text-foreground sm:text-5xl">
                    {formatCompactCount(metrics.workingCount)}
                  </span>
                  <span className="font-display text-lg font-medium tabular-nums text-muted-foreground sm:text-xl">
                    of {formatCompactCount(metrics.loggedItems)} working
                  </span>
                </div>
              </div>

              <div className="w-full space-y-2.5 sm:max-w-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-sans text-xs font-medium text-foreground">
                    {metrics.loggedItems === 0
                      ? 'No inventory items logged yet'
                      : metrics.flaggedCount === 0
                        ? 'On target for Sunday'
                        : `${formatCompactCount(metrics.flaggedCount)} below 100% target`}
                  </span>
                  <span className="shrink-0 font-display text-sm font-bold tabular-nums text-foreground">
                    {metrics.loggedItems > 0 ? `${workingPercent}% ready` : '—'}
                  </span>
                </div>

                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-300 ease-out',
                      metrics.flaggedCount === 0 && metrics.loggedItems > 0
                        ? 'bg-emerald-600 dark:bg-emerald-500'
                        : 'bg-primary'
                    )}
                    style={{
                      width: `${metrics.loggedItems > 0 ? workingPercent : 0}%`,
                    }}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 font-sans text-xs tabular-nums text-muted-foreground">
                  <span>
                    {freshness.freshPercent}% checked in last 7 days (
                    {formatCompactCount(freshness.checkedLast7Days)} of{' '}
                    {formatCompactCount(freshness.totalItems)})
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-primary group-hover:underline">
                    <span>Working gear</span>
                    <ArrowRight
                      className="size-3.5 transition-[transform,translate] duration-150 ease-out group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </div>
              </div>
            </Link>

            <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
              {supportMetricPills.map((kpi) => {
                const Icon = kpi.icon;
                const tone = kpi.tone ?? 'default';

                return (
                  <Link
                    key={kpi.id}
                    to={kpi.to}
                    data-testid={kpi.testId}
                    className="group flex flex-col justify-between bg-card p-3.5 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-sans text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {kpi.label}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded-md',
                          KPI_ICON_CLASSES[tone]
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                    </div>

                    <div className="mt-2 space-y-0.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            'font-display text-xl font-bold tracking-tight tabular-nums text-foreground',
                            tone === 'danger' && 'text-destructive'
                          )}
                        >
                          {formatCompactCount(kpi.value)}
                        </span>
                        {kpi.badge && <Badge variant="repair">{kpi.badge}</Badge>}
                      </div>
                      <p className="truncate font-sans text-xs tabular-nums text-muted-foreground">
                        {kpi.sublabel}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Clickable Low-Stock Callout Card */}
          <Link
            to="/inventory?stock=low"
            data-testid="dashboard-low-stock"
            className={cn(
              'card-accent-hover group flex flex-col justify-between gap-4 rounded-xl border p-4 shadow-card sm:flex-row sm:items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              lowStockItems.length > 0
                ? 'border-amber-500/40 bg-amber-500/[0.06] hover:border-amber-500/60'
                : 'border-border bg-card'
            )}
          >
            <div className="flex min-w-0 items-start gap-3 sm:items-center">
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-lg',
                  lowStockItems.length > 0
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    : 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                )}
              >
                {lowStockItems.length > 0 ? (
                  <AlertTriangle className="size-5" />
                ) : (
                  <CheckCircle2 className="size-5" />
                )}
              </span>

              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-sm font-semibold text-foreground">
                    Low Stock
                  </span>
                  {lowStockItems.length > 0 ? (
                    <>
                      <span className="font-display text-xl font-bold tabular-nums text-amber-700 dark:text-amber-300">
                        {formatCompactCount(lowStockItems.length)}
                      </span>
                      <Badge variant="lowStock">Restock Alert</Badge>
                    </>
                  ) : (
                    <Badge variant="working">0 low-stock items</Badge>
                  )}
                </div>

                {lowStockItems.length > 0 ? (
                  <p className="truncate font-sans text-xs tabular-nums text-muted-foreground">
                    {formatPluralCount(lowStockItems.length, 'item', 'items')} at or below min
                    threshold:{' '}
                    {lowStockItems
                      .slice(0, 3)
                      .map((item) => `${item.item} (${item.qty}/${item.min_qty})`)
                      .join(', ')}
                    {lowStockItems.length > 3 ? ` +${lowStockItems.length - 3} more` : ''}
                  </p>
                ) : (
                  <p className="font-sans text-xs text-muted-foreground">
                    All stocked equipment is above configured minimum thresholds.
                  </p>
                )}
              </div>
            </div>

            <span className="inline-flex shrink-0 items-center gap-1.5 font-sans text-xs font-medium text-primary group-hover:underline">
              <span>{lowStockItems.length > 0 ? 'Review Low Stock' : 'Filter Low Stock'}</span>
              <ArrowRight
                className="size-3.5 transition-[transform,translate] duration-150 ease-out group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
          </Link>

          {/* 03 One Question Per Chart + 04 Label the Lines */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Chart 1: Which groups need attention? (Sorted Direct-Labeled Readiness Bars) */}
            <Card
              data-testid="dashboard-category-health"
              className="flex flex-col lg:col-span-7"
            >
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 border-b border-border pb-4">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary"
                  >
                    {healthGroupBy === 'type' ? (
                      <Tags className="size-4" />
                    ) : (
                      <FolderTree className="size-4" />
                    )}
                  </span>
                  <div>
                    <h2 className="font-display text-base font-semibold leading-tight tracking-tight text-foreground">
                      Which groups need attention?
                    </h2>
                    <p className="font-sans text-xs tabular-nums text-muted-foreground">
                      {healthGroupBy === 'type'
                        ? `${formatPluralCount(equipmentTypeHealth.length, 'equipment type', 'equipment types')} tracked`
                        : `${formatPluralCount(categoryHealth.length, 'category', 'categories')} tracked`}{' '}
                      · Lowest readiness first
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="group"
                    aria-label="Inventory health grouping"
                    className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5"
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant={healthGroupBy === 'type' ? 'default' : 'ghost'}
                      aria-pressed={healthGroupBy === 'type'}
                      onClick={() => setHealthGroupBy('type')}
                      className="h-7 px-2.5 text-xs"
                    >
                      Equipment Type
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={healthGroupBy === 'rig' ? 'default' : 'ghost'}
                      aria-pressed={healthGroupBy === 'rig'}
                      onClick={() => setHealthGroupBy('rig')}
                      className="h-7 px-2.5 text-xs"
                    >
                      Rig
                    </Button>
                  </div>

                  <Link
                    to={healthGroupBy === 'type' ? '/categories?tab=types' : '/categories'}
                    className="group inline-flex items-center gap-1 rounded-md px-2 py-1 font-sans text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>{healthGroupBy === 'type' ? 'Types' : 'Categories'}</span>
                    <ArrowRight
                      className="size-3.5 transition-[transform,translate] duration-150 ease-out group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </div>
              </CardHeader>

              <CardContent className="flex-1 pt-4">
                {(() => {
                  const destinationParam = healthGroupBy === 'type' ? 'type' : 'category';

                  if (sortedHealthBuckets.length === 0) {
                    return (
                      <div className="flex min-h-[210px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center">
                        {healthGroupBy === 'type' ? (
                          <Tags className="size-8 text-muted-foreground/60" aria-hidden="true" />
                        ) : (
                          <FolderTree
                            className="size-8 text-muted-foreground/60"
                            aria-hidden="true"
                          />
                        )}
                        <p className="font-display text-sm font-semibold text-foreground">
                          {healthGroupBy === 'type'
                            ? 'No equipment types configured yet'
                            : 'No categories configured yet'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {healthGroupBy === 'type'
                            ? 'Equipment types and readiness bars will appear here.'
                            : 'Equipment categories and readiness bars will appear here.'}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div key={healthGroupBy} className="view-switch-enter space-y-2.5">
                      {sortedHealthBuckets.map((bucket) => {
                        const barWidth = bucket.itemCount > 0 ? bucket.healthPercent : 0;

                        return (
                          <Link
                            key={bucket.key}
                            to={`/inventory?${destinationParam}=${encodeURIComponent(bucket.linkParam)}`}
                            className="group block rounded-lg border border-border/80 bg-background/60 px-3.5 py-2.5 transition-colors hover:border-border hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span
                                    aria-hidden="true"
                                    className="size-2.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: bucket.color }}
                                  />
                                  <span className="truncate font-display text-sm font-semibold text-foreground group-hover:text-primary">
                                    {bucket.name}
                                  </span>
                                </div>
                                <span className="font-sans text-xs tabular-nums text-muted-foreground">
                                  {formatPluralCount(bucket.itemCount, 'item', 'items')} ·{' '}
                                  {formatPluralCount(bucket.unitCount, 'unit', 'units')}
                                </span>
                              </div>

                              <div className="ml-auto flex shrink-0 items-center gap-2">
                                {bucket.flaggedCount > 0 && (
                                  <Badge variant="repair">
                                    {formatCompactCount(bucket.flaggedCount)} flagged
                                  </Badge>
                                )}
                                {bucket.onLoanUnits > 0 && (
                                  <Badge variant="loaned">
                                    {formatCompactCount(bucket.onLoanUnits)} on loan
                                  </Badge>
                                )}
                                {bucket.itemCount > 0 &&
                                  bucket.flaggedCount === 0 &&
                                  bucket.onLoanUnits === 0 && (
                                    <span className="font-sans text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                      All working
                                    </span>
                                  )}
                                <span className="font-display text-sm font-bold tabular-nums text-foreground">
                                  {bucket.itemCount > 0 ? `${bucket.healthPercent}%` : '—'}
                                </span>
                              </div>
                            </div>

                            <div
                              role="progressbar"
                              aria-label={`${bucket.name} health ${bucket.itemCount > 0 ? `${bucket.healthPercent}%` : 'empty'}`}
                              aria-valuenow={barWidth}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary"
                            >
                              <div
                                className="h-full rounded-full transition-[width] duration-300 ease-out"
                                style={{
                                  width: `${barWidth}%`,
                                  backgroundColor: bucket.color,
                                }}
                              />
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Right Column: Check-off Trend Chart + Needs Attention Triage */}
            <div className="flex flex-col gap-6 lg:col-span-5">
              {/* Chart 2: Are we checking gear regularly? (14-Day Direct-Labeled Line Chart) */}
              <Card data-testid="dashboard-checkoff-trend" className="flex flex-col">
                <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border pb-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary"
                    >
                      <CalendarCheck2 className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-display text-base font-semibold leading-tight tracking-tight text-foreground">
                        Are we checking gear regularly?
                      </h2>
                      <p className="truncate font-sans text-xs tabular-nums text-muted-foreground">
                        {formatCompactCount(checkOffTrend.totalInWindow)} checked in 14 days · Avg{' '}
                        {formatCompactCount(checkOffTrend.roundedDailyAverage)}/day
                      </p>
                    </div>
                  </div>

                  <Link
                    to="/checklist"
                    className="group inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-sans text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>Checklist</span>
                    <ArrowRight
                      className="size-3.5 transition-[transform,translate] duration-150 ease-out group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </CardHeader>

                <CardContent className="pt-4">
                  <CheckOffTrendChart trend={checkOffTrend} />
                </CardContent>
              </Card>

              {/* Needs Attention Triage Queue */}
              <Card data-testid="dashboard-needs-attention" className="flex flex-1 flex-col">
                <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border pb-4">
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/12 text-red-600 dark:text-red-400"
                    >
                      <Wrench className="size-4" />
                    </span>
                    <div>
                      <h2 className="font-display text-base font-semibold leading-tight tracking-tight text-foreground">
                        Needs Attention
                      </h2>
                      <p className="font-sans text-xs text-muted-foreground">
                        {flaggedItems.length > 0
                          ? `${formatPluralCount(flaggedItems.length, 'item', 'items')} flagged`
                          : 'All clear'}
                      </p>
                    </div>
                  </div>

                  <Link
                    to="/inventory?condition=flagged"
                    className="group inline-flex items-center gap-1 rounded-md px-2 py-1 font-sans text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>View All</span>
                    <ArrowRight
                      className="size-3.5 transition-[transform,translate] duration-150 ease-out group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </CardHeader>

                <CardContent className="flex-1 pt-4">
                  {visibleFlaggedItems.length === 0 ? (
                    <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center">
                      <CheckCircle2 className="size-8 text-success" aria-hidden="true" />
                      <p className="font-display text-sm font-semibold text-foreground">
                        All equipment is in working condition
                      </p>
                      <p className="text-xs text-muted-foreground">
                        No items are currently flagged for repair or missing.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2.5">
                        {visibleFlaggedItems.map((item) => {
                          const meta = getSafeConditionMeta(item.condition);
                          const color = getCategoryColor(
                            item.category,
                            categories,
                            item.category_id
                          );
                          const metadataParts = [
                            item.category,
                            item.location?.trim() || null,
                            `Qty ${safeNonNegativeInt(item.qty)}`,
                          ].filter((part): part is string => Boolean(part));

                          return (
                            <Link
                              key={item.id}
                              to={`/inventory?item=${encodeURIComponent(item.id)}`}
                              style={{ '--card-accent': color } as CSSProperties}
                              className="card-accent-hover group relative flex items-start justify-between gap-3 overflow-hidden rounded-lg border border-border bg-background/60 p-3 pl-4 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span
                                aria-hidden="true"
                                className="band absolute inset-y-0 left-0 w-1"
                                style={{ backgroundColor: color }}
                              />
                              <div className="min-w-0 flex-1 space-y-1">
                                <p className="truncate font-display text-sm font-semibold text-foreground group-hover:text-primary">
                                  {item.item}
                                </p>
                                <p className="truncate font-sans text-xs tabular-nums text-muted-foreground">
                                  {metadataParts.join(' · ')}
                                </p>
                                {item.remarks && (
                                  <p className="line-clamp-1 text-xs text-muted-foreground">
                                    {item.remarks}
                                  </p>
                                )}
                              </div>
                              <Badge variant={meta.badgeVariant} className="shrink-0">
                                {meta.label}
                              </Badge>
                            </Link>
                          );
                        })}
                      </div>

                      {flaggedItems.length > MAX_ATTENTION_ITEMS && (
                        <Link
                          to="/inventory?condition=flagged"
                          className="group mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 font-sans text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span>View all {flaggedItems.length} flagged items</span>
                          <ArrowRight
                            className="size-3.5 transition-[transform,translate] duration-150 ease-out group-hover:translate-x-0.5"
                            aria-hidden="true"
                          />
                        </Link>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Member & Admin Operational Panels (Strictly Hidden from Guests) */}
          {canViewOperationalData && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Active & Overdue Loans */}
              <Card data-testid="dashboard-active-loans" className="flex flex-col">
                <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border pb-4">
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary"
                    >
                      <ArrowLeftRight className="size-4" />
                    </span>
                    <div>
                      <h2 className="font-display text-base font-semibold leading-tight tracking-tight text-foreground">
                        Active & Overdue Loans
                      </h2>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="loaned">{sortedActiveLoans.length} Active</Badge>
                        {overdueLoansCount > 0 && (
                          <Badge variant="repair">{overdueLoansCount} Overdue</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <Link
                    to="/loans"
                    className="group inline-flex items-center gap-1 rounded-md px-2 py-1 font-sans text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>Manage Loans</span>
                    <ArrowRight
                      className="size-3.5 transition-[transform,translate] duration-150 ease-out group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </CardHeader>

                <CardContent className="flex-1 pt-4">
                  {isLoadingLoans ? (
                    <FeedListSkeleton label="Loading active loans..." rows={3} compact />
                  ) : isLoansError ? (
                    <PanelErrorBox
                      title="Unable to load active loans"
                      message={loansError?.message ?? 'Failed to fetch equipment loans.'}
                      onRetry={() => void refetchLoans()}
                    />
                  ) : visibleActiveLoans.length === 0 ? (
                    <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center">
                      <ArrowLeftRight
                        className="size-8 text-muted-foreground/60"
                        aria-hidden="true"
                      />
                      <p className="font-display text-sm font-semibold text-foreground">
                        No equipment is currently on loan
                      </p>
                      <Link
                        to="/loans"
                        className="rounded font-sans text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Check out gear →
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {visibleActiveLoans.map((loan) => {
                        const matchedItem = itemsById.get(loan.item_id);
                        const itemName = matchedItem?.item ?? `Item ${loan.item_id}`;
                        const overdue = isLoanOverdue(loan.due_date, loan.returned_at);

                        return (
                          <Link
                            key={loan.id}
                            to="/loans"
                            className={cn(
                              'card-accent-hover flex items-start justify-between gap-3 rounded-lg border border-border bg-background/60 p-3 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              overdue && 'border-red-500/35 bg-destructive/5'
                            )}
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate font-display text-sm font-semibold text-foreground">
                                  {itemName}
                                </p>
                                <Badge variant="loaned">Qty {loan.qty_loaned}</Badge>
                                {overdue && <Badge variant="repair">Overdue</Badge>}
                              </div>
                              <p className="truncate text-xs font-medium text-foreground">
                                {loan.borrower_name}
                              </p>
                              <p className="font-sans text-xs tabular-nums text-muted-foreground">
                                {loan.due_date
                                  ? `Due ${formatDisplayDate(loan.due_date)}`
                                  : 'No due date'}
                              </p>
                            </div>
                          </Link>
                        );
                      })}

                      {sortedActiveLoans.length > MAX_ACTIVE_LOANS && (
                        <Link
                          to="/loans"
                          className="group mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 font-sans text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span>View all {sortedActiveLoans.length} active loans</span>
                          <ArrowRight
                            className="size-3.5 transition-[transform,translate] duration-150 ease-out group-hover:translate-x-0.5"
                            aria-hidden="true"
                          />
                        </Link>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Activity Preview */}
              <Card data-testid="dashboard-recent-activity" className="flex flex-col">
                <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border pb-4">
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground"
                    >
                      <History className="size-4" />
                    </span>
                    <div>
                      <h2 className="font-display text-base font-semibold leading-tight tracking-tight text-foreground">
                        Recent Activity
                      </h2>
                      <p className="font-sans text-xs text-muted-foreground">
                        Latest audit trail events
                      </p>
                    </div>
                  </div>

                  <Link
                    to="/activity"
                    className="group inline-flex items-center gap-1 rounded-md px-2 py-1 font-sans text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>View Full Log</span>
                    <ArrowRight
                      className="size-3.5 transition-[transform,translate] duration-150 ease-out group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </CardHeader>

                <CardContent className="flex-1 pt-4">
                  {isLoadingActivity ? (
                    <FeedListSkeleton label="Loading recent activity..." rows={3} compact />
                  ) : isActivityError ? (
                    <PanelErrorBox
                      title="Unable to load recent activity"
                      message={activityError?.message ?? 'Failed to fetch activity log.'}
                      onRetry={() => void refetchActivity()}
                    />
                  ) : recentActivity.length === 0 ? (
                    <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center">
                      <History className="size-8 text-muted-foreground/60" aria-hidden="true" />
                      <p className="font-display text-sm font-semibold text-foreground">
                        No recent activity recorded yet
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Sunday checks, item updates, loans, and imports will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {recentActivity.map((entry: HistoryEntry) => {
                        const actionMeta = getHistoryActionMeta(entry.action);
                        const itemName = resolveHistoryItemName(entry);
                        const summary = describeHistoryEntry(entry);
                        const actorName = getUserEmailPrefix(entry.user_email);

                        return (
                          <Link
                            key={entry.id}
                            to="/activity"
                            className={cn(
                              'card-accent-hover block rounded-lg border border-border bg-background/60 p-3 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              entry.undone && 'opacity-60'
                            )}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <Badge variant={actionMeta.badgeVariant}>{actionMeta.label}</Badge>
                                {entry.undone && <Badge variant="outline">Undone</Badge>}
                              </div>
                              <span className="font-sans text-xs tabular-nums text-muted-foreground">
                                {formatShortTimestamp(entry.timestamp)}
                              </span>
                            </div>

                            <p
                              className={cn(
                                'mt-1.5 truncate font-display text-sm font-semibold text-foreground',
                                entry.undone && 'line-through'
                              )}
                            >
                              {itemName}
                            </p>
                            <p
                              className={cn(
                                'truncate text-xs text-muted-foreground',
                                entry.undone && 'line-through'
                              )}
                            >
                              {summary}
                            </p>
                            <p className="mt-1 font-sans text-xs text-muted-foreground">
                              by <span className="font-semibold text-foreground">{actorName}</span>
                            </p>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </section>
  );
}
