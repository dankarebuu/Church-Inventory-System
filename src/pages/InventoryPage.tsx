import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Download,
  FileJson,
  FileSpreadsheet,
  LayoutGrid,
  Loader2,
  PackageOpen,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Table as TableIcon,
  Upload,
  X,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/features/auth/useAuth';
import { sortCategories, useCategories } from '@/features/categories/useCategories';
import {
  exportItemsToCSV,
  exportItemsToJSON,
} from '@/features/importExport/csvUtils';
import { ImportWizardDialog } from '@/features/importExport/ImportWizardDialog';
import { InventoryGrid } from '@/features/inventory/InventoryGrid';
import { InventoryTable } from '@/features/inventory/InventoryTable';
import { ItemDetailDrawer } from '@/features/inventory/ItemDetailDrawer';
import { ItemFormDialog } from '@/features/inventory/ItemFormDialog';
import {
  useInventoryItems,
  useItemMutations,
  type EnrichedInventoryItem,
} from '@/features/inventory/useInventory';
import { CheckoutDialog } from '@/features/loans/CheckoutDialog';
import { useLoanMutations } from '@/features/loans/useLoans';
import { sortLocations, useLocations } from '@/features/locations/useLocations';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type {
  Category,
  HistoryEntry,
  ItemCondition,
  LoanRecord,
  LocationRecord,
} from '@/types/database';

export const VIEW_MODE_STORAGE_KEY = 'wingmacc_view_mode';

export type InventoryViewMode = 'grid' | 'table';

const ALL_OPTION = '__all__';
const EMPTY_ITEMS: EnrichedInventoryItem[] = [];
const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_LOCATIONS: LocationRecord[] = [];

export interface InventoryPageProps {
  headerActions?: ReactNode;
}

function readInitialViewMode(): InventoryViewMode {
  try {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (stored === 'table' || stored === 'grid') {
        return stored;
      }
    }
  } catch {
    // Ignore storage read errors in restricted browser contexts.
  }
  return 'grid';
}

function persistViewMode(mode: InventoryViewMode): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    }
  } catch {
    // Ignore storage write errors in restricted browser contexts.
  }
}

function normalizeConditionFilter(raw: string | null): string {
  if (raw === 'working' || raw === 'repair' || raw === 'missing' || raw === 'flagged') {
    return raw;
  }
  return ALL_OPTION;
}

function normalizeLoanFilter(raw: string | null): string {
  if (raw === 'on-loan' || raw === 'loaned') return 'on-loan';
  if (raw === 'available') return 'available';
  return ALL_OPTION;
}

/**
 * Main Inventory catalog route supporting multi-facet URL-synced filters,
 * Grid/Table view toggle, Detail Drawer + ZoomLightbox, quick Member checks,
 * and Admin Add/Edit/Trash workflows.
 */
export function InventoryPage({ headerActions }: InventoryPageProps) {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    data: items = EMPTY_ITEMS,
    isLoading,
    isError,
    error,
    refetch,
  } = useInventoryItems(role);
  const { data: categories = EMPTY_CATEGORIES } = useCategories();
  const { data: locations = EMPTY_LOCATIONS } = useLocations();
  const {
    softDeleteItem,
    memberCheckItem,
    isDeleting,
    isChecking,
  } = useItemMutations();
  const { checkoutItem, returnLoan, isCheckingOut } = useLoanMutations();

  const [viewMode, setViewMode] = useState<InventoryViewMode>(readInitialViewMode);
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<EnrichedInventoryItem | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<EnrichedInventoryItem | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutItemTarget, setCheckoutItemTarget] = useState<EnrichedInventoryItem | null>(
    null
  );
  const [returningLoanId, setReturningLoanId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [isExportingJson, setIsExportingJson] = useState(false);

  const canCheck = role === 'member' || role === 'admin';
  const canAdmin = role === 'admin';

  const topCategories = useMemo(
    () => sortCategories(categories.filter((cat) => cat.parent_id === null)),
    [categories]
  );
  const sortedLocations = useMemo(() => sortLocations(locations), [locations]);

  const rawSearch = searchParams.get('q') ?? '';
  const rawCategoryParam = searchParams.get('category');
  const rawSubcategoryParam = searchParams.get('subcategory');
  const rawLocationParam = searchParams.get('location');
  const conditionFilter = normalizeConditionFilter(searchParams.get('condition'));
  const loanFilter = normalizeLoanFilter(searchParams.get('loan'));
  const activeItemId = searchParams.get('item');

  const resolvedCategoryId = useMemo(() => {
    if (!rawCategoryParam) return ALL_OPTION;
    const byId = topCategories.find((cat) => cat.id === rawCategoryParam);
    if (byId) return byId.id;
    const byName = topCategories.find(
      (cat) => cat.name.trim().toLowerCase() === rawCategoryParam.trim().toLowerCase()
    );
    return byName ? byName.id : rawCategoryParam;
  }, [rawCategoryParam, topCategories]);

  const filterSubcategories = useMemo(() => {
    if (resolvedCategoryId === ALL_OPTION) return [];
    return sortCategories(categories.filter((cat) => cat.parent_id === resolvedCategoryId));
  }, [categories, resolvedCategoryId]);

  const resolvedSubcategoryId = useMemo(() => {
    if (!rawSubcategoryParam || filterSubcategories.length === 0) return ALL_OPTION;
    const valid = filterSubcategories.find((sub) => sub.id === rawSubcategoryParam);
    return valid ? valid.id : ALL_OPTION;
  }, [rawSubcategoryParam, filterSubcategories]);

  const resolvedLocationId = useMemo(() => {
    if (!rawLocationParam) return ALL_OPTION;
    const byId = sortedLocations.find((loc) => loc.id === rawLocationParam);
    if (byId) return byId.id;
    const byName = sortedLocations.find(
      (loc) => loc.name.trim().toLowerCase() === rawLocationParam.trim().toLowerCase()
    );
    return byName ? byName.id : rawLocationParam;
  }, [rawLocationParam, sortedLocations]);

  const updateParams = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mutate(next);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleViewModeChange = (mode: InventoryViewMode) => {
    setViewMode(mode);
    persistViewMode(mode);
  };

  const handleSearchChange = (value: string) => {
    updateParams((next) => {
      if (value.trim().length > 0) {
        next.set('q', value);
      } else {
        next.delete('q');
      }
    });
  };

  const handleCategoryFilterChange = (value: string) => {
    updateParams((next) => {
      if (value === ALL_OPTION) {
        next.delete('category');
        next.delete('subcategory');
      } else {
        next.set('category', value);
        const currentSub = next.get('subcategory');
        const subBelongs = categories.some(
          (cat) => cat.id === currentSub && cat.parent_id === value
        );
        if (!subBelongs) {
          next.delete('subcategory');
        }
      }
    });
  };

  const handleSubcategoryFilterChange = (value: string) => {
    updateParams((next) => {
      if (value === ALL_OPTION) {
        next.delete('subcategory');
      } else {
        next.set('subcategory', value);
      }
    });
  };

  const handleLocationFilterChange = (value: string) => {
    updateParams((next) => {
      if (value === ALL_OPTION) {
        next.delete('location');
      } else {
        next.set('location', value);
      }
    });
  };

  const handleConditionFilterChange = (value: string) => {
    updateParams((next) => {
      if (value === ALL_OPTION) {
        next.delete('condition');
      } else {
        next.set('condition', value);
      }
    });
  };

  const handleLoanFilterChange = (value: string) => {
    updateParams((next) => {
      if (value === ALL_OPTION) {
        next.delete('loan');
      } else {
        next.set('loan', value);
      }
    });
  };

  const handleClearFilters = () => {
    updateParams((next) => {
      next.delete('q');
      next.delete('category');
      next.delete('subcategory');
      next.delete('location');
      next.delete('condition');
      next.delete('loan');
    });
  };

  const hasActiveFilters = Boolean(
    rawSearch.trim() ||
      rawCategoryParam ||
      rawSubcategoryParam ||
      rawLocationParam ||
      conditionFilter !== ALL_OPTION ||
      loanFilter !== ALL_OPTION
  );

  const filteredItems = useMemo(() => {
    const query = rawSearch.trim().toLowerCase();
    const matchedCategoryObj =
      resolvedCategoryId !== ALL_OPTION
        ? topCategories.find((c) => c.id === resolvedCategoryId)
        : undefined;
    const matchedLocationObj =
      resolvedLocationId !== ALL_OPTION
        ? sortedLocations.find((l) => l.id === resolvedLocationId)
        : undefined;

    return items.filter((item) => {
      if (resolvedCategoryId !== ALL_OPTION) {
        const matchesId = item.category_id === resolvedCategoryId;
        const matchesName = matchedCategoryObj
          ? item.category.trim().toLowerCase() === matchedCategoryObj.name.trim().toLowerCase()
          : item.category.trim().toLowerCase() === resolvedCategoryId.trim().toLowerCase();
        if (!matchesId && !matchesName) return false;
      }

      if (resolvedSubcategoryId !== ALL_OPTION) {
        if (item.subcategory_id !== resolvedSubcategoryId) return false;
      }

      if (resolvedLocationId !== ALL_OPTION) {
        const matchesLocId = item.location_id === resolvedLocationId;
        const itemLocName = item.location?.trim().toLowerCase() ?? '';
        const matchesLocName = matchedLocationObj
          ? itemLocName === matchedLocationObj.name.trim().toLowerCase()
          : itemLocName === resolvedLocationId.trim().toLowerCase();
        if (!matchesLocId && !matchesLocName) return false;
      }

      if (conditionFilter === 'flagged') {
        if (item.condition === 'working') return false;
      } else if (conditionFilter !== ALL_OPTION) {
        if (item.condition !== conditionFilter) return false;
      }

      if (loanFilter === 'on-loan') {
        if (item.qty_on_loan <= 0) return false;
      } else if (loanFilter === 'available') {
        if (item.available_qty <= 0) return false;
      }

      if (query) {
        const subName = item.subcategory_id
          ? categories.find((c) => c.id === item.subcategory_id)?.name ?? ''
          : '';
        const searchableParts = [
          item.item,
          item.brand,
          item.category,
          subName,
          item.location,
          item.owner,
          item.serial,
          item.description,
          item.remarks,
        ];
        if (canCheck && item.checkedBy) {
          searchableParts.push(item.checkedBy);
        }
        const haystack = searchableParts
          .filter((part): part is string => typeof part === 'string' && part.length > 0)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });
  }, [
    items,
    rawSearch,
    resolvedCategoryId,
    resolvedSubcategoryId,
    resolvedLocationId,
    conditionFilter,
    loanFilter,
    topCategories,
    sortedLocations,
    categories,
    canCheck,
  ]);

  const selectedItem = useMemo(
    () => (activeItemId ? items.find((entry) => entry.id === activeItemId) ?? null : null),
    [activeItemId, items]
  );

  const summaryStats = useMemo(() => {
    let totalUnits = 0;
    let flaggedCount = 0;
    let onLoanCount = 0;

    for (const entry of filteredItems) {
      totalUnits += entry.qty;
      if (entry.condition !== 'working') flaggedCount += 1;
      if (entry.qty_on_loan > 0) onLoanCount += 1;
    }

    return {
      itemCount: filteredItems.length,
      totalUnits,
      flaggedCount,
      onLoanCount,
    };
  }, [filteredItems]);

  const handleOpenItem = useCallback(
    (item: EnrichedInventoryItem) => {
      updateParams((next) => {
        next.set('item', item.id);
      });
    },
    [updateParams]
  );

  const handleDrawerOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        updateParams((next) => {
          next.delete('item');
        });
      }
    },
    [updateParams]
  );

  const handleQuickCheck = useCallback(
    async (item: EnrichedInventoryItem, condition: ItemCondition) => {
      if (!canCheck) return;
      try {
        await memberCheckItem({
          itemId: item.id,
          condition,
        });
        toast.success(`Marked "${item.item}" as ${condition}.`);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unable to update item condition.';
        toast.error(message);
      }
    },
    [canCheck, memberCheckItem]
  );

  const handleOpenAdd = () => {
    if (!canAdmin) return;
    setEditingItem(null);
    setFormOpen(true);
  };

  const handleOpenEdit = useCallback(
    (item: EnrichedInventoryItem) => {
      if (!canAdmin) return;
      setEditingItem(item);
      setFormOpen(true);
    },
    [canAdmin]
  );

  const handleOpenCheckout = useCallback(
    (item: EnrichedInventoryItem) => {
      if (!canCheck) return;
      setCheckoutItemTarget(item);
      setCheckoutOpen(true);
    },
    [canCheck]
  );

  const handleReturnLoan = useCallback(
    async (loan: LoanRecord, item: EnrichedInventoryItem) => {
      if (!canCheck) return;
      setReturningLoanId(loan.id);
      try {
        await returnLoan({ loan, itemName: item.item });
        toast.success(
          `Returned ${loan.qty_loaned} × "${item.item}" from ${loan.borrower_name}.`
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unable to return equipment loan.';
        toast.error(message);
      } finally {
        setReturningLoanId(null);
      }
    },
    [canCheck, returnLoan]
  );

  const handleConfirmDelete = async () => {
    if (!pendingDeleteItem || !canAdmin) return;
    const target = pendingDeleteItem;
    try {
      await softDeleteItem(target);
      toast.success(`Moved "${target.item}" to Trash.`);
      if (activeItemId === target.id) {
        updateParams((next) => {
          next.delete('item');
        });
      }
      setPendingDeleteItem(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to move item to Trash.';
      toast.error(message);
    }
  };

  const handleExportCsv = () => {
    if (!canAdmin) return;
    const activeLoans = items.flatMap((entry) => entry.activeLoans ?? []);
    exportItemsToCSV(items, activeLoans, categories);
    toast.success(`Exported ${items.length} ${items.length === 1 ? 'item' : 'items'} as CSV.`);
  };

  const handleExportJson = async () => {
    if (!canAdmin) return;
    setIsExportingJson(true);
    try {
      let historyEntries: HistoryEntry[] = [];
      if (isSupabaseConfigured) {
        const { data, error: historyError } = await supabase
          .from('history_log')
          .select('*')
          .order('timestamp', { ascending: false })
          .limit(200);
        if (historyError) {
          throw new Error(historyError.message);
        }
        historyEntries = data ?? [];
      }
      exportItemsToJSON(items, historyEntries);
      toast.success(`Exported ${items.length} ${items.length === 1 ? 'item' : 'items'} as JSON.`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to export JSON backup.';
      toast.error(message);
    } finally {
      setIsExportingJson(false);
    }
  };

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-block rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
            Gear Catalog
          </span>
          <h1 className="font-display mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Band Inventory
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse, filter, inspect, and check off WINGMACC church band equipment.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Toggle */}
          <div
            role="group"
            aria-label="Inventory view mode"
            className="inline-flex rounded-lg border border-border bg-card p-1 shadow-xs"
          >
            <Button
              type="button"
              size="sm"
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              aria-pressed={viewMode === 'grid'}
              onClick={() => handleViewModeChange('grid')}
              className="h-7 px-2.5 text-xs"
            >
              <LayoutGrid className="size-3.5" aria-hidden="true" />
              <span>Grid</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              aria-pressed={viewMode === 'table'}
              onClick={() => handleViewModeChange('table')}
              className="h-7 px-2.5 text-xs"
            >
              <TableIcon className="size-3.5" aria-hidden="true" />
              <span>Table</span>
            </Button>
          </div>

          {canAdmin && headerActions}

          {canAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" disabled={isExportingJson}>
                  {isExportingJson ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="size-4" aria-hidden="true" />
                  )}
                  <span>Export</span>
                  <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={handleExportCsv}>
                  <FileSpreadsheet className="size-4" aria-hidden="true" />
                  <span>Export CSV</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleExportJson()}>
                  <FileJson className="size-4" aria-hidden="true" />
                  <span>Export JSON Backup</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/checklist?tab=print')}>
                  <Printer className="size-4" aria-hidden="true" />
                  <span>Print / PDF Checklist</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {canAdmin && (
            <Button type="button" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" aria-hidden="true" />
              <span>Import</span>
            </Button>
          )}

          {canAdmin && (
            <Button type="button" onClick={handleOpenAdd}>
              <Plus className="size-4" aria-hidden="true" />
              <span>Add Item</span>
            </Button>
          )}
        </div>
      </div>

      {/* Multi-facet Filter Bar */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-card space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative sm:col-span-2 lg:col-span-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={rawSearch}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="Search equipment, brand, serial, location..."
              aria-label="Search equipment"
              className="pl-9"
            />
          </div>

          <Select value={resolvedCategoryId} onValueChange={handleCategoryFilterChange}>
            <SelectTrigger aria-label="Filter by category">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_OPTION}>All Categories</SelectItem>
              {topCategories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={resolvedSubcategoryId}
            onValueChange={handleSubcategoryFilterChange}
            disabled={filterSubcategories.length === 0}
          >
            <SelectTrigger aria-label="Filter by subcategory">
              <SelectValue
                placeholder={
                  filterSubcategories.length === 0 ? 'All Subcategories' : 'All Subcategories'
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_OPTION}>All Subcategories</SelectItem>
              {filterSubcategories.map((sub) => (
                <SelectItem key={sub.id} value={sub.id}>
                  {sub.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={resolvedLocationId} onValueChange={handleLocationFilterChange}>
            <SelectTrigger aria-label="Filter by location">
              <SelectValue placeholder="All Locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_OPTION}>All Locations</SelectItem>
              {sortedLocations.map((loc) => (
                <SelectItem key={loc.id} value={loc.id}>
                  {loc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="grid grid-cols-2 gap-2">
            <Select value={conditionFilter} onValueChange={handleConditionFilterChange}>
              <SelectTrigger aria-label="Filter by condition">
                <SelectValue placeholder="Condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_OPTION}>All Status</SelectItem>
                <SelectItem value="working">Working</SelectItem>
                <SelectItem value="flagged">Flagged (Repair/Missing)</SelectItem>
                <SelectItem value="repair">Needs Repair</SelectItem>
                <SelectItem value="missing">Missing</SelectItem>
              </SelectContent>
            </Select>

            <Select value={loanFilter} onValueChange={handleLoanFilterChange}>
              <SelectTrigger aria-label="Filter by loan status">
                <SelectValue placeholder="Loan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_OPTION}>All Loans</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="on-loan">On Loan</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Filter Summary & Clear */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 font-mono text-muted-foreground">
            <span>
              {summaryStats.itemCount} {summaryStats.itemCount === 1 ? 'item' : 'items'} (
              {summaryStats.totalUnits} {summaryStats.totalUnits === 1 ? 'unit' : 'units'})
            </span>
            {summaryStats.flaggedCount > 0 && (
              <Badge variant="repair">{summaryStats.flaggedCount} Flagged</Badge>
            )}
            {summaryStats.onLoanCount > 0 && (
              <Badge variant="loaned">{summaryStats.onLoanCount} On Loan</Badge>
            )}
          </div>

          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden="true" />
              <span>Clear Filters</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main Content States */}
      {isLoading ? (
        <div
          role="status"
          className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-8 text-muted-foreground shadow-card"
        >
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
          <span className="font-mono text-xs uppercase tracking-wider">
            Loading inventory catalog...
          </span>
        </div>
      ) : isError ? (
        <div
          role="alert"
          className="flex flex-col items-start justify-between gap-4 rounded-xl border border-destructive/40 bg-destructive/10 p-6 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <p className="font-semibold text-foreground">Unable to load inventory items</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {error?.message ?? 'An unexpected error occurred while reading Supabase.'}
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>Retry</span>
          </Button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-card">
          <PackageOpen className="size-10 text-muted-foreground/60" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="font-display text-lg font-semibold text-foreground">
              {hasActiveFilters ? 'No equipment matches these filters' : 'No equipment logged yet'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {hasActiveFilters
                ? 'Try widening your search or clearing active category/location filters.'
                : 'Add your first band instrument, cable, or sound rig item to get started.'}
            </p>
          </div>
          {hasActiveFilters ? (
            <Button type="button" variant="outline" onClick={handleClearFilters}>
              Clear Filters
            </Button>
          ) : (
            canAdmin && (
              <Button type="button" onClick={handleOpenAdd}>
                <Plus className="size-4" aria-hidden="true" />
                <span>Add Item</span>
              </Button>
            )
          )}
        </div>
      ) : viewMode === 'table' ? (
        <InventoryTable
          items={filteredItems}
          role={role}
          categories={categories}
          locations={locations}
          onSelectItem={handleOpenItem}
          onQuickCheck={handleQuickCheck}
          onEdit={handleOpenEdit}
          onDelete={setPendingDeleteItem}
          isChecking={isChecking}
        />
      ) : (
        <InventoryGrid
          items={filteredItems}
          role={role}
          categories={categories}
          locations={locations}
          onSelectItem={handleOpenItem}
          onQuickCheck={handleQuickCheck}
          onEdit={handleOpenEdit}
          onDelete={setPendingDeleteItem}
          isChecking={isChecking}
        />
      )}

      {/* Slide-over Detail Drawer + ZoomLightbox */}
      <ItemDetailDrawer
        item={selectedItem}
        open={Boolean(selectedItem)}
        onOpenChange={handleDrawerOpenChange}
        role={role}
        categories={categories}
        locations={locations}
        onQuickCheck={handleQuickCheck}
        isChecking={isChecking}
        onEdit={handleOpenEdit}
        onDelete={setPendingDeleteItem}
        onCheckout={canCheck ? handleOpenCheckout : undefined}
        onReturnLoan={canCheck ? handleReturnLoan : undefined}
        returningLoanId={returningLoanId}
      />

      {/* Member & Admin Equipment Check-Out Dialog */}
      {canCheck && (
        <CheckoutDialog
          open={checkoutOpen}
          onOpenChange={(nextOpen) => {
            setCheckoutOpen(nextOpen);
            if (!nextOpen) {
              setCheckoutItemTarget(null);
            }
          }}
          items={items}
          preselectedItem={checkoutItemTarget}
          onCheckout={checkoutItem}
          isSubmitting={isCheckingOut}
        />
      )}

      {/* Admin Add/Edit Modal & Import Wizard */}
      {canAdmin && (
        <>
          <ItemFormDialog
            open={formOpen}
            onOpenChange={(nextOpen) => {
              setFormOpen(nextOpen);
              if (!nextOpen) {
                setEditingItem(null);
              }
            }}
            item={editingItem}
            categories={categories}
            locations={locations}
          />

          <ImportWizardDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            items={items}
            categories={categories}
            locations={locations}
          />
        </>
      )}

      {/* Admin Soft-Delete Confirmation Dialog */}
      <AlertDialog
        open={Boolean(pendingDeleteItem)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isDeleting) {
            setPendingDeleteItem(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move Item to Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              This will move{' '}
              <span className="font-semibold text-foreground">
                {pendingDeleteItem?.item}
              </span>{' '}
              out of the active inventory catalog. Admins can restore trashed items later
              from the Activity Log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Moving...' : 'Move to Trash'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
