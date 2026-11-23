import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  Download,
  FileJson,
  FileSpreadsheet,
  ImageOff,
  Layers,
  LayoutGrid,
  Loader2,
  PackageOpen,
  Plus,
  Printer,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Table as TableIcon,
  Upload,
  X,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { OfflineNotice } from '@/components/layout/OfflineBanner';
import { BRAND } from '@/lib/branding';
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
import { Badge, badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardGridSkeleton, TableRowsSkeleton } from '@/components/ui/skeleton';
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
import { useCommentCounts } from '@/features/comments/useItemComments';
import {
  sortEquipmentTypes,
  useEquipmentTypes,
} from '@/features/equipmentTypes/useEquipmentTypes';
import {
  exportItemsToCSV,
  exportItemsToJSON,
} from '@/features/importExport/csvUtils';
import { ImportWizardDialog } from '@/features/importExport/ImportWizardDialog';
import { BulkAssignDialog } from '@/features/inventory/BulkAssignDialog';
import {
  InventoryGrid,
  type InventoryGroupBy,
} from '@/features/inventory/InventoryGrid';
import { InventoryTable } from '@/features/inventory/InventoryTable';
import {
  isLowStock,
  resolveCategoryName,
  resolveEquipmentTypeName,
  resolveLocationName,
  resolveSubcategoryName,
} from '@/features/inventory/inventoryUi';
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
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { cn, parseImages, trimOrNull } from '@/lib/utils';
import type {
  Category,
  EquipmentType,
  HistoryEntry,
  ItemCondition,
  LoanRecord,
  LocationRecord,
} from '@/types/database';

export const VIEW_MODE_STORAGE_KEY = 'wingmacc_view_mode';
export const GROUP_BY_STORAGE_KEY = 'wingmacc_group_by';

export type InventoryViewMode = 'grid' | 'table';
export type { InventoryGroupBy };

const ALL_OPTION = '__all__';
const UNASSIGNED_TYPE_OPTION = '__unassigned__';
const EMPTY_ITEMS: EnrichedInventoryItem[] = [];
const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_LOCATIONS: LocationRecord[] = [];
const EMPTY_EQUIPMENT_TYPES: EquipmentType[] = [];
const EMPTY_COMMENT_COUNTS: Record<string, number> = {};

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

function readInitialGroupBy(): InventoryGroupBy {
  try {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(GROUP_BY_STORAGE_KEY);
      if (stored === 'rig' || stored === 'type') {
        return stored;
      }
    }
  } catch {
    // Ignore storage read errors in restricted browser contexts.
  }
  return 'type';
}

function persistGroupBy(mode: InventoryGroupBy): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(GROUP_BY_STORAGE_KEY, mode);
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

function normalizeStockFilter(raw: string | null): string {
  if (raw === 'low') return 'low';
  return ALL_OPTION;
}

function normalizePhotoFilter(raw: string | null): string {
  if (raw === 'missing') return 'missing';
  return ALL_OPTION;
}

/**
 * Main Inventory catalog route supporting multi-facet URL-synced filters
 * (including Equipment Type, Low Stock, and Missing Photos), Equipment Type /
 * Rig grouping, Grid/Table views, Detail Drawer + quick camera upload & notes,
 * quick Member checks, and Admin multi-select Bulk Assign / CRUD workflows.
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
  const { data: equipmentTypes = EMPTY_EQUIPMENT_TYPES } = useEquipmentTypes();
  const { data: commentCounts = EMPTY_COMMENT_COUNTS } = useCommentCounts(role !== 'guest');

  const {
    softDeleteItem,
    memberCheckItem,
    addItemPhoto,
    isDeleting,
    isChecking,
    isAddingPhoto,
  } = useItemMutations();
  const { checkoutItem, returnLoan, isCheckingOut } = useLoanMutations();

  const [viewMode, setViewMode] = useState<InventoryViewMode>(readInitialViewMode);
  const [groupBy, setGroupBy] = useState<InventoryGroupBy>(readInitialGroupBy);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);

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
  const { isOffline } = useOnlineStatus();

  const canCheck = role === 'member' || role === 'admin';
  const canAdmin = role === 'admin';

  useEffect(() => {
    if (!canAdmin) {
      setSelectionMode(false);
      setSelectedIds(new Set());
      setBulkAssignOpen(false);
    }
  }, [canAdmin]);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(items.map((entry) => entry.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [items]);

  const topCategories = useMemo(
    () => sortCategories(categories.filter((cat) => cat.parent_id === null)),
    [categories]
  );
  const sortedLocations = useMemo(() => sortLocations(locations), [locations]);
  const sortedEquipmentTypes = useMemo(
    () => sortEquipmentTypes(equipmentTypes),
    [equipmentTypes]
  );

  const rawSearch = searchParams.get('q') ?? '';
  const rawCategoryParam = searchParams.get('category');
  const rawSubcategoryParam = searchParams.get('subcategory');
  const rawTypeParam = searchParams.get('type');
  const rawLocationParam = searchParams.get('location');
  const conditionFilter = normalizeConditionFilter(searchParams.get('condition'));
  const loanFilter = normalizeLoanFilter(searchParams.get('loan'));
  const stockFilter = normalizeStockFilter(searchParams.get('stock'));
  const photoFilter = normalizePhotoFilter(searchParams.get('photo'));
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

  const resolvedTypeId = useMemo(() => {
    if (!rawTypeParam) return ALL_OPTION;
    if (rawTypeParam === UNASSIGNED_TYPE_OPTION || rawTypeParam === 'unassigned') {
      return UNASSIGNED_TYPE_OPTION;
    }
    const byId = sortedEquipmentTypes.find((et) => et.id === rawTypeParam);
    if (byId) return byId.id;
    const byName = sortedEquipmentTypes.find(
      (et) => et.name.trim().toLowerCase() === rawTypeParam.trim().toLowerCase()
    );
    return byName ? byName.id : rawTypeParam;
  }, [rawTypeParam, sortedEquipmentTypes]);

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

  const handleGroupByChange = (mode: InventoryGroupBy) => {
    setGroupBy(mode);
    persistGroupBy(mode);
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

  const handleTypeFilterChange = (value: string) => {
    updateParams((next) => {
      if (value === ALL_OPTION) {
        next.delete('type');
      } else {
        next.set('type', value);
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

  const handleToggleStockFilter = () => {
    updateParams((next) => {
      if (stockFilter === 'low') {
        next.delete('stock');
      } else {
        next.set('stock', 'low');
      }
    });
  };

  const handleTogglePhotoFilter = () => {
    updateParams((next) => {
      if (photoFilter === 'missing') {
        next.delete('photo');
      } else {
        next.set('photo', 'missing');
      }
    });
  };

  const handleClearFilters = () => {
    updateParams((next) => {
      next.delete('q');
      next.delete('category');
      next.delete('subcategory');
      next.delete('type');
      next.delete('location');
      next.delete('condition');
      next.delete('loan');
      next.delete('stock');
      next.delete('photo');
    });
  };

  const hasActiveFilters = Boolean(
    rawSearch.trim() ||
      rawCategoryParam ||
      rawSubcategoryParam ||
      rawTypeParam ||
      rawLocationParam ||
      conditionFilter !== ALL_OPTION ||
      loanFilter !== ALL_OPTION ||
      stockFilter !== ALL_OPTION ||
      photoFilter !== ALL_OPTION
  );

  // Facet selects only (search + quick toggles stay visible on mobile).
  const activeFacetCount = [
    rawTypeParam,
    rawCategoryParam,
    rawSubcategoryParam,
    rawLocationParam,
    conditionFilter !== ALL_OPTION,
    loanFilter !== ALL_OPTION,
  ].filter(Boolean).length;
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filteredItems = useMemo(() => {
    const query = rawSearch.trim().toLowerCase();
    const matchedCategoryObj =
      resolvedCategoryId !== ALL_OPTION
        ? topCategories.find((c) => c.id === resolvedCategoryId)
        : undefined;
    const matchedTypeObj =
      resolvedTypeId !== ALL_OPTION && resolvedTypeId !== UNASSIGNED_TYPE_OPTION
        ? sortedEquipmentTypes.find((et) => et.id === resolvedTypeId)
        : undefined;
    const knownTypeIds = new Set(sortedEquipmentTypes.map((et) => et.id));
    const matchedLocationObj =
      resolvedLocationId !== ALL_OPTION
        ? sortedLocations.find((l) => l.id === resolvedLocationId)
        : undefined;

    return items.filter((item) => {
      if (resolvedCategoryId !== ALL_OPTION) {
        const matchesId = item.category_id === resolvedCategoryId;
        const matchesName = matchedCategoryObj
          ? item.category.trim().toLowerCase() ===
            matchedCategoryObj.name.trim().toLowerCase()
          : item.category.trim().toLowerCase() === resolvedCategoryId.trim().toLowerCase();
        if (!matchesId && !matchesName) return false;
      }

      if (resolvedSubcategoryId !== ALL_OPTION) {
        if (item.subcategory_id !== resolvedSubcategoryId) return false;
      }

      if (resolvedTypeId === UNASSIGNED_TYPE_OPTION) {
        if (item.equipment_type_id || trimOrNull(item.equipment_type)) return false;
      } else if (resolvedTypeId !== ALL_OPTION) {
        const matchesTypeId = item.equipment_type_id === resolvedTypeId;
        const hasOtherKnownTypeId = Boolean(
          item.equipment_type_id &&
            item.equipment_type_id !== resolvedTypeId &&
            knownTypeIds.has(item.equipment_type_id)
        );
        const itemTypeText = trimOrNull(item.equipment_type)?.toLowerCase() ?? '';
        const matchesTypeName =
          !hasOtherKnownTypeId &&
          (matchedTypeObj
            ? itemTypeText === matchedTypeObj.name.trim().toLowerCase()
            : itemTypeText === resolvedTypeId.trim().toLowerCase());
        if (!matchesTypeId && !matchesTypeName) return false;
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

      if (stockFilter === 'low' && !isLowStock(item)) {
        return false;
      }

      if (photoFilter === 'missing' && parseImages(item.image_filename).length > 0) {
        return false;
      }

      if (query) {
        const categoryName = resolveCategoryName(item, categories);
        const subName = resolveSubcategoryName(item, categories);
        const typeName = resolveEquipmentTypeName(item, sortedEquipmentTypes);
        const locationName = resolveLocationName(item, sortedLocations);
        const searchableParts = [
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
    resolvedTypeId,
    resolvedLocationId,
    conditionFilter,
    loanFilter,
    stockFilter,
    photoFilter,
    topCategories,
    sortedEquipmentTypes,
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
    let lowStockCount = 0;

    for (const entry of filteredItems) {
      totalUnits += entry.qty;
      if (entry.condition !== 'working') flaggedCount += 1;
      if (entry.qty_on_loan > 0) onLoanCount += 1;
      if (isLowStock(entry)) lowStockCount += 1;
    }

    return {
      itemCount: filteredItems.length,
      totalUnits,
      flaggedCount,
      onLoanCount,
      lowStockCount,
    };
  }, [filteredItems]);

  const handleToggleSelectionMode = () => {
    if (!canAdmin) return;
    setSelectionMode((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedIds(new Set());
      }
      return next;
    });
  };

  const handleToggleSelect = useCallback((itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const handleSelectAllFiltered = useCallback(() => {
    setSelectedIds(new Set(filteredItems.map((entry) => entry.id)));
  }, [filteredItems]);

  const handleToggleSelectAllTable = useCallback(
    (itemIds: readonly string[], allCurrentlySelected: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (allCurrentlySelected) {
          for (const id of itemIds) {
            next.delete(id);
          }
        } else {
          for (const id of itemIds) {
            next.add(id);
          }
        }
        return next;
      });
    },
    []
  );

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

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
      if (!canCheck || isOffline) return;
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
    [canCheck, isOffline, memberCheckItem]
  );

  const handleAddDrawerPhoto = useCallback(
    async (item: EnrichedInventoryItem, file: File) => {
      if (!canCheck || isOffline) return;
      const existingCount = parseImages(item.image_filename).length;
      try {
        await addItemPhoto({
          itemId: item.id,
          file,
          existingPhotoCount: existingCount,
        });
        toast.success(`Added photo to "${item.item}".`);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unable to upload photo.';
        toast.error(message);
        throw err;
      }
    },
    [addItemPhoto, canCheck, isOffline]
  );

  const handleOpenAdd = () => {
    if (!canAdmin || isOffline) return;
    setEditingItem(null);
    setFormOpen(true);
  };

  const handleOpenEdit = useCallback(
    (item: EnrichedInventoryItem) => {
      if (!canAdmin || isOffline) return;
      setEditingItem(item);
      setFormOpen(true);
    },
    [canAdmin, isOffline]
  );

  const handleOpenCheckout = useCallback(
    (item: EnrichedInventoryItem) => {
      if (!canCheck || isOffline) return;
      setCheckoutItemTarget(item);
      setCheckoutOpen(true);
    },
    [canCheck, isOffline]
  );

  const handleReturnLoan = useCallback(
    async (loan: LoanRecord, item: EnrichedInventoryItem) => {
      if (!canCheck || isOffline) return;
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
    [canCheck, isOffline, returnLoan]
  );

  const handleConfirmDelete = async () => {
    if (!pendingDeleteItem || !canAdmin || isOffline) return;
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
    exportItemsToCSV(items, activeLoans, categories, { equipmentTypes });
    toast.success(`Exported ${items.length} ${items.length === 1 ? 'item' : 'items'} as CSV.`);
  };

  const handleExportJson = async () => {
    if (!canAdmin || isOffline) return;
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

  const visibleCommentCounts = role !== 'guest' ? commentCounts : EMPTY_COMMENT_COUNTS;
  const selectedIdsArray = useMemo(() => [...selectedIds], [selectedIds]);

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-block rounded bg-primary/10 px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wider text-primary">
            Gear Catalog
          </span>
          <h1 className="font-display mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Equipment Inventory
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse, filter, inspect, and check off {BRAND.churchShortName} ministry equipment.
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
            <Button
              type="button"
              variant={selectionMode ? 'default' : 'outline'}
              aria-pressed={selectionMode}
              onClick={handleToggleSelectionMode}
            >
              <CheckSquare className="size-4" aria-hidden="true" />
              <span>Select Items</span>
            </Button>
          )}

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
                <DropdownMenuItem
                  disabled={isOffline || isExportingJson}
                  onSelect={() => void handleExportJson()}
                >
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
            <Button
              type="button"
              variant="outline"
              disabled={isOffline}
              onClick={() => !isOffline && setImportOpen(true)}
            >
              <Upload className="size-4" aria-hidden="true" />
              <span>Import</span>
            </Button>
          )}

          {canAdmin && (
            <Button type="button" disabled={isOffline} onClick={handleOpenAdd}>
              <Plus className="size-4" aria-hidden="true" />
              <span>Add Item</span>
            </Button>
          )}
        </div>
      </div>

      {isOffline && canCheck && (
        <OfflineNotice message="Offline — edits, condition checks, imports, and bulk updates are disabled until connection returns." />
      )}

      {/* Multi-facet Filter Bar */}
      <div
        role="search"
        aria-label="Filter equipment"
        className="@container space-y-3 rounded-xl border border-border bg-card p-4 shadow-card"
      >
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="inventory-search"
              name="q"
              type="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={rawSearch}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="Search equipment, brand, serial, location..."
              aria-label="Search equipment"
              className="pl-9"
            />
          </div>

          {/* Mobile-only: collapse facet selects so gear is visible without scrolling */}
          <Button
            type="button"
            variant={activeFacetCount > 0 ? 'default' : 'outline'}
            onClick={() => setFiltersOpen((prev) => !prev)}
            aria-expanded={filtersOpen}
            aria-controls="inventory-facet-filters"
            className="h-9 shrink-0 px-3 md:hidden"
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            <span>Filters</span>
            {activeFacetCount > 0 && (
              <span className="rounded-full bg-primary-foreground/20 px-1.5 font-sans text-[10px] tabular-nums">
                {activeFacetCount}
              </span>
            )}
          </Button>
        </div>

        <div
          id="inventory-facet-filters"
          className={cn(
            'grid grid-cols-2 gap-3 @2xl:grid-cols-3 @5xl:grid-cols-6',
            !filtersOpen && 'max-md:hidden'
          )}
        >
          <Select value={resolvedTypeId} onValueChange={handleTypeFilterChange}>
            <SelectTrigger aria-label="Filter by equipment type">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_OPTION}>All Types</SelectItem>
              <SelectItem value={UNASSIGNED_TYPE_OPTION}>Unassigned Type</SelectItem>
              {sortedEquipmentTypes.map((et) => (
                <SelectItem key={et.id} value={et.id}>
                  {et.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

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
              <SelectValue placeholder="All Subcategories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_OPTION}>
                {filterSubcategories.length === 0
                  ? 'Subcategory (select category)'
                  : 'All Subcategories'}
              </SelectItem>
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

        {/* Quick Cleanup Toggles, Group-By Segmented Control & Selection Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={stockFilter === 'low' ? 'default' : 'outline'}
              aria-pressed={stockFilter === 'low'}
              onClick={handleToggleStockFilter}
              className="h-7 px-2.5 text-xs"
            >
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              <span>Low Stock</span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant={photoFilter === 'missing' ? 'default' : 'outline'}
              aria-pressed={photoFilter === 'missing'}
              onClick={handleTogglePhotoFilter}
              className="h-7 px-2.5 text-xs"
            >
              <ImageOff className="size-3.5" aria-hidden="true" />
              <span>Missing Photos</span>
            </Button>

            <div className="flex flex-wrap items-center gap-2 pl-1 font-sans tabular-nums text-muted-foreground">
              <span aria-live="polite" aria-atomic="true">
                {summaryStats.itemCount} {summaryStats.itemCount === 1 ? 'item' : 'items'} (
                {summaryStats.totalUnits} {summaryStats.totalUnits === 1 ? 'unit' : 'units'})
              </span>
              {summaryStats.flaggedCount > 0 && (
                <button
                  type="button"
                  aria-pressed={conditionFilter === 'flagged'}
                  title={
                    conditionFilter === 'flagged'
                      ? 'Clear flagged filter'
                      : 'Filter to flagged equipment'
                  }
                  onClick={() =>
                    handleConditionFilterChange(
                      conditionFilter === 'flagged' ? ALL_OPTION : 'flagged'
                    )
                  }
                  className={cn(
                    badgeVariants({ variant: 'repair' }),
                    'cursor-pointer transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    conditionFilter === 'flagged' && 'ring-2 ring-red-500/40'
                  )}
                >
                  {summaryStats.flaggedCount} Flagged
                </button>
              )}
              {summaryStats.onLoanCount > 0 && (
                <button
                  type="button"
                  aria-pressed={loanFilter === 'on-loan'}
                  title={
                    loanFilter === 'on-loan'
                      ? 'Clear on-loan filter'
                      : 'Filter to equipment on loan'
                  }
                  onClick={() =>
                    handleLoanFilterChange(loanFilter === 'on-loan' ? ALL_OPTION : 'on-loan')
                  }
                  className={cn(
                    badgeVariants({ variant: 'loaned' }),
                    'cursor-pointer transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    loanFilter === 'on-loan' && 'ring-2 ring-blue-500/40'
                  )}
                >
                  {summaryStats.onLoanCount} On Loan
                </button>
              )}
              {summaryStats.lowStockCount > 0 && (
                <Badge variant="lowStock">{summaryStats.lowStockCount} Low Stock</Badge>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canAdmin && selectionMode && (
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={filteredItems.length === 0}
                  onClick={handleSelectAllFiltered}
                  className="h-7 px-2.5 text-xs"
                >
                  Select All Filtered
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={selectedIds.size === 0}
                  onClick={handleClearSelection}
                  className="h-7 px-2.5 text-xs"
                >
                  Clear
                </Button>
              </div>
            )}

            {viewMode === 'grid' && (
              <div className="flex items-center gap-1.5">
                <span className="font-sans text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Group by:
                </span>
                <div
                  role="group"
                  aria-label="Group grid items by"
                  className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5"
                >
                  <Button
                    type="button"
                    size="sm"
                    variant={groupBy === 'type' ? 'default' : 'ghost'}
                    aria-pressed={groupBy === 'type'}
                    onClick={() => handleGroupByChange('type')}
                    className="h-6 px-2 text-[11px]"
                  >
                    Equipment Type
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={groupBy === 'rig' ? 'default' : 'ghost'}
                    aria-pressed={groupBy === 'rig'}
                    onClick={() => handleGroupByChange('rig')}
                    className="h-6 px-2 text-[11px]"
                  >
                    Rig
                  </Button>
                </div>
              </div>
            )}

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
      </div>

      {/* Main Content States */}
      {isLoading ? (
        viewMode === 'table' ? (
          <TableRowsSkeleton label="Loading inventory catalog..." rows={6} />
        ) : (
          <CardGridSkeleton label="Loading inventory catalog..." count={6} />
        )
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
                ? 'Try widening your search or clearing active category/type/location filters.'
                : 'Add your first band instrument, cable, or sound rig item to get started.'}
            </p>
          </div>
          {hasActiveFilters ? (
            <Button type="button" variant="outline" onClick={handleClearFilters}>
              Clear Filters
            </Button>
          ) : (
            canAdmin && (
              <Button type="button" disabled={isOffline} onClick={handleOpenAdd}>
                <Plus className="size-4" aria-hidden="true" />
                <span>Add Item</span>
              </Button>
            )
          )}
        </div>
      ) : (
        <div key={viewMode} className="view-switch-enter">
          {viewMode === 'table' ? (
            <InventoryTable
              items={filteredItems}
              role={role}
              categories={categories}
              locations={locations}
              equipmentTypes={equipmentTypes}
              commentCounts={visibleCommentCounts}
              selectionMode={canAdmin && selectionMode}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAllTable}
              onSelectItem={handleOpenItem}
              onQuickCheck={handleQuickCheck}
              onEdit={handleOpenEdit}
              onDelete={setPendingDeleteItem}
              isChecking={isChecking}
              isOffline={isOffline}
            />
          ) : (
            <InventoryGrid
              items={filteredItems}
              role={role}
              categories={categories}
              locations={locations}
              equipmentTypes={equipmentTypes}
              commentCounts={visibleCommentCounts}
              groupBy={groupBy}
              selectionMode={canAdmin && selectionMode}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onSelectItem={handleOpenItem}
              onQuickCheck={handleQuickCheck}
              onEdit={handleOpenEdit}
              onDelete={setPendingDeleteItem}
              isChecking={isChecking}
              isOffline={isOffline}
            />
          )}
        </div>
      )}

      {/* Sticky Admin Multi-Select Action Bar */}
      {canAdmin && selectionMode && selectedIds.size > 0 && (
        <div
          role="region"
          aria-label="Bulk selection actions"
          className="sticky bottom-20 z-20 mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-card/95 px-4 py-3 shadow-lg backdrop-blur-md md:bottom-4"
        >
          <span className="font-sans text-sm font-semibold tabular-nums text-foreground">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClearSelection}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isOffline}
              onClick={() => !isOffline && setBulkAssignOpen(true)}
            >
              <Layers className="size-3.5" aria-hidden="true" />
              <span>Bulk Assign</span>
            </Button>
          </div>
        </div>
      )}

      {/* Slide-over Detail Drawer + ZoomLightbox */}
      <ItemDetailDrawer
        item={selectedItem}
        open={Boolean(selectedItem)}
        onOpenChange={handleDrawerOpenChange}
        role={role}
        categories={categories}
        locations={locations}
        equipmentTypes={equipmentTypes}
        onQuickCheck={handleQuickCheck}
        isChecking={isChecking}
        onEdit={handleOpenEdit}
        onDelete={setPendingDeleteItem}
        onCheckout={canCheck ? handleOpenCheckout : undefined}
        onReturnLoan={canCheck ? handleReturnLoan : undefined}
        returningLoanId={returningLoanId}
        onAddPhoto={canCheck ? handleAddDrawerPhoto : undefined}
        isUploadingPhoto={isAddingPhoto}
        isOffline={isOffline}
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
          isOffline={isOffline}
        />
      )}

      {/* Admin Add/Edit Modal, Bulk Assign & Import Wizard */}
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
            equipmentTypes={equipmentTypes}
            isOffline={isOffline}
          />

          <BulkAssignDialog
            open={bulkAssignOpen}
            onOpenChange={setBulkAssignOpen}
            selectedIds={selectedIdsArray}
            categories={categories}
            locations={locations}
            equipmentTypes={equipmentTypes}
            onSuccess={handleClearSelection}
            isOffline={isOffline}
          />

          <ImportWizardDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            items={items}
            categories={categories}
            locations={locations}
            equipmentTypes={equipmentTypes}
            isOffline={isOffline}
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
              disabled={isDeleting || isOffline}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDelete();
              }}
              className="bg-destructive-fill text-destructive-foreground hover:bg-destructive-fill/90"
            >
              {isDeleting ? 'Moving...' : 'Move to Trash'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
