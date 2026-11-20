import { useMemo, useState, type CSSProperties } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Edit2,
  FolderOpen,
  FolderPlus,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Tags,
  Trash2,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { OfflineNotice } from '@/components/layout/OfflineBanner';
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
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/features/auth/useAuth';
import { CategoryDialog } from '@/features/categories/CategoryDialog';
import {
  computeCategoryItemCounts,
  computeEquipmentTypeItemCounts,
  computeLocationItemCounts,
  formatItemCountLabel,
  formatSubcategoryCountLabel,
  resolveCategoryIcon,
} from '@/features/categories/categoryUi';
import {
  buildCategoryTree,
  getCategoryColor,
  useCategories,
  useCategoryMutations,
  type CategoryTreeNode,
} from '@/features/categories/useCategories';
import { EquipmentTypeDialog } from '@/features/equipmentTypes/EquipmentTypeDialog';
import {
  getEquipmentTypeColor,
  sortEquipmentTypes,
  useEquipmentTypeMutations,
  useEquipmentTypes,
} from '@/features/equipmentTypes/useEquipmentTypes';
import { useInventoryItems, type EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { LocationDialog } from '@/features/locations/LocationDialog';
import {
  sortLocations,
  useLocationMutations,
  useLocations,
} from '@/features/locations/useLocations';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { Category, EquipmentType, LocationRecord } from '@/types/database';

type CategoriesTab = 'categories' | 'locations' | 'types';

interface PendingCategoryDelete {
  category: Category;
  linkedItemCount: number;
  linkedSubcategoryCount: number;
}

interface PendingLocationDelete {
  location: LocationRecord;
  linkedItemCount: number;
}

interface PendingEquipmentTypeDelete {
  equipmentType: EquipmentType;
  linkedItemCount: number;
}

const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_LOCATIONS: LocationRecord[] = [];
const EMPTY_EQUIPMENT_TYPES: EquipmentType[] = [];
const EMPTY_ITEMS: EnrichedInventoryItem[] = [];

function formatInventoryLinkCount(count: number): string {
  return `${count} ${count === 1 ? 'inventory item' : 'inventory items'}`;
}

/**
 * 2-level Categories & Storage Locations management route with role-gated
 * Admin CRUD, linked-item delete confirmations, and filtered `/inventory` links.
 */
export function CategoriesPage() {
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get('tab');
  const activeTab: CategoriesTab =
    rawTab === 'locations' ? 'locations' : rawTab === 'types' ? 'types' : 'categories';

  const handleTabChange = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'locations' || value === 'types') {
          next.set('tab', value);
        } else {
          next.delete('tab');
        }
        return next;
      },
      { replace: true }
    );
  };

  const {
    data: categories = EMPTY_CATEGORIES,
    isLoading: isLoadingCategories,
    isError: isCategoriesError,
    error: categoriesError,
    refetch: refetchCategories,
  } = useCategories();

  const {
    data: locations = EMPTY_LOCATIONS,
    isLoading: isLoadingLocations,
    isError: isLocationsError,
    error: locationsError,
    refetch: refetchLocations,
  } = useLocations();

  const {
    data: equipmentTypes = EMPTY_EQUIPMENT_TYPES,
    isLoading: isLoadingEquipmentTypes,
    isError: isEquipmentTypesError,
    error: equipmentTypesError,
    refetch: refetchEquipmentTypes,
  } = useEquipmentTypes();

  const {
    data: items = EMPTY_ITEMS,
    isLoading: isLoadingItems,
    isError: isItemsError,
    error: itemsError,
    refetch: refetchItems,
  } = useInventoryItems(role);

  const { deleteCategory, isDeleting: isDeletingCategory } = useCategoryMutations();
  const { deleteLocation, isDeleting: isDeletingLocation } = useLocationMutations();
  const { deleteEquipmentType, isDeleting: isDeletingEquipmentType } =
    useEquipmentTypeMutations();

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [defaultParentId, setDefaultParentId] = useState<string | null>(null);

  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<LocationRecord | null>(null);

  const [equipmentTypeDialogOpen, setEquipmentTypeDialogOpen] = useState(false);
  const [editingEquipmentType, setEditingEquipmentType] =
    useState<EquipmentType | null>(null);

  const [pendingDeleteCategory, setPendingDeleteCategory] =
    useState<PendingCategoryDelete | null>(null);
  const [pendingDeleteLocation, setPendingDeleteLocation] =
    useState<PendingLocationDelete | null>(null);
  const [pendingDeleteEquipmentType, setPendingDeleteEquipmentType] =
    useState<PendingEquipmentTypeDelete | null>(null);

  const canAdmin = role === 'admin';
  const { isOffline } = useOnlineStatus();

  const categoryTree = useMemo(() => buildCategoryTree(categories), [categories]);
  const sortedLocations = useMemo(() => sortLocations(locations), [locations]);
  const sortedEquipmentTypes = useMemo(
    () => sortEquipmentTypes(equipmentTypes),
    [equipmentTypes]
  );

  const categoryCounts = useMemo(
    () => computeCategoryItemCounts(items, categories),
    [items, categories]
  );
  const locationCounts = useMemo(
    () => computeLocationItemCounts(items, locations),
    [items, locations]
  );
  const equipmentTypeCounts = useMemo(
    () => computeEquipmentTypeItemCounts(items, equipmentTypes),
    [items, equipmentTypes]
  );

  const isLoading =
    isLoadingCategories || isLoadingLocations || isLoadingEquipmentTypes || isLoadingItems;
  const isError =
    isCategoriesError || isLocationsError || isEquipmentTypesError || isItemsError;
  const errorMessage =
    categoriesError?.message ??
    locationsError?.message ??
    equipmentTypesError?.message ??
    itemsError?.message ??
    'Unable to load categories and storage locations.';

  const handleRetry = () => {
    void Promise.all([
      refetchCategories(),
      refetchLocations(),
      refetchEquipmentTypes(),
      refetchItems(),
    ]);
  };

  const handleOpenAddCategory = () => {
    if (!canAdmin || isOffline) return;
    setEditingCategory(null);
    setDefaultParentId(null);
    setCategoryDialogOpen(true);
  };

  const handleOpenAddSubcategory = (parentId: string) => {
    if (!canAdmin || isOffline) return;
    setEditingCategory(null);
    setDefaultParentId(parentId);
    setCategoryDialogOpen(true);
  };

  const handleOpenEditCategory = (cat: Category) => {
    if (!canAdmin || isOffline) return;
    setEditingCategory(cat);
    setDefaultParentId(cat.parent_id);
    setCategoryDialogOpen(true);
  };

  const handleRequestDeleteCategory = (node: CategoryTreeNode) => {
    if (!canAdmin || isOffline) return;
    setPendingDeleteCategory({
      category: node,
      linkedItemCount: categoryCounts.byTopCategoryId.get(node.id) ?? 0,
      linkedSubcategoryCount: node.subcategories.length,
    });
  };

  const handleRequestDeleteSubcategory = (sub: Category) => {
    if (!canAdmin || isOffline) return;
    setPendingDeleteCategory({
      category: sub,
      linkedItemCount: categoryCounts.bySubcategoryId.get(sub.id) ?? 0,
      linkedSubcategoryCount: 0,
    });
  };

  const handleConfirmDeleteCategory = async () => {
    if (!pendingDeleteCategory || !canAdmin || isOffline) return;
    const target = pendingDeleteCategory.category;
    try {
      await deleteCategory(target.id);
      toast.success(`Deleted "${target.name}".`);
      setPendingDeleteCategory(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to delete category.';
      toast.error(msg);
    }
  };

  const handleOpenAddLocation = () => {
    if (!canAdmin || isOffline) return;
    setEditingLocation(null);
    setLocationDialogOpen(true);
  };

  const handleOpenEditLocation = (loc: LocationRecord) => {
    if (!canAdmin || isOffline) return;
    setEditingLocation(loc);
    setLocationDialogOpen(true);
  };

  const handleRequestDeleteLocation = (loc: LocationRecord) => {
    if (!canAdmin || isOffline) return;
    setPendingDeleteLocation({
      location: loc,
      linkedItemCount: locationCounts.get(loc.id) ?? 0,
    });
  };

  const handleConfirmDeleteLocation = async () => {
    if (!pendingDeleteLocation || !canAdmin || isOffline) return;
    const target = pendingDeleteLocation.location;
    try {
      await deleteLocation(target.id);
      toast.success(`Deleted "${target.name}".`);
      setPendingDeleteLocation(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to delete storage location.';
      toast.error(msg);
    }
  };

  const handleOpenAddEquipmentType = () => {
    if (!canAdmin || isOffline) return;
    setEditingEquipmentType(null);
    setEquipmentTypeDialogOpen(true);
  };

  const handleOpenEditEquipmentType = (equipmentType: EquipmentType) => {
    if (!canAdmin || isOffline) return;
    setEditingEquipmentType(equipmentType);
    setEquipmentTypeDialogOpen(true);
  };

  const handleRequestDeleteEquipmentType = (equipmentType: EquipmentType) => {
    if (!canAdmin || isOffline) return;
    setPendingDeleteEquipmentType({
      equipmentType,
      linkedItemCount: equipmentTypeCounts.get(equipmentType.id) ?? 0,
    });
  };

  const handleConfirmDeleteEquipmentType = async () => {
    if (!pendingDeleteEquipmentType || !canAdmin || isOffline) return;
    const target = pendingDeleteEquipmentType.equipmentType;
    try {
      await deleteEquipmentType(target.id);
      toast.success(`Deleted "${target.name}".`);
      setPendingDeleteEquipmentType(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to delete equipment type.';
      toast.error(msg);
    }
  };

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-block rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
            Organization
          </span>
          <h1 className="font-display mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Categories & Locations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse 2-level rig categories, storage rooms, and equipment types, or click through
            to filtered inventory gear.
          </p>
        </div>

        {canAdmin && (
          <div className="flex items-center gap-2">
            {activeTab === 'categories' ? (
              <Button type="button" disabled={isOffline} onClick={handleOpenAddCategory}>
                <Plus className="size-4" aria-hidden="true" />
                <span>Add Category</span>
              </Button>
            ) : activeTab === 'locations' ? (
              <Button type="button" disabled={isOffline} onClick={handleOpenAddLocation}>
                <Plus className="size-4" aria-hidden="true" />
                <span>Add Location</span>
              </Button>
            ) : (
              <Button type="button" disabled={isOffline} onClick={handleOpenAddEquipmentType}>
                <Plus className="size-4" aria-hidden="true" />
                <span>Add Equipment Type</span>
              </Button>
            )}
          </div>
        )}
      </div>

      {canAdmin && isOffline && (
        <OfflineNotice message="Offline — adding, editing, or deleting categories, locations, and equipment types is disabled until connection returns." />
      )}

      {isLoading ? (
        <div
          role="status"
          className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-8 text-muted-foreground shadow-card"
        >
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
          <span className="font-mono text-xs uppercase tracking-wider">
            Loading categories & locations...
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
              <p className="font-semibold text-foreground">Unable to load organization data</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{errorMessage}</p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={handleRetry}>
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>Retry</span>
          </Button>
        </div>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="space-y-4"
        >
          <TabsList>
            <TabsTrigger value="categories">
              <span>Rig Categories</span>
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {categoryTree.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="locations">
              <span>Storage Locations</span>
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {sortedLocations.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="types">
              <span>Equipment Types</span>
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {sortedEquipmentTypes.length}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Categories Tab */}
          <TabsContent value="categories" className="space-y-4">
            {categoryTree.length === 0 ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-card">
                <FolderOpen className="size-10 text-muted-foreground/60" aria-hidden="true" />
                <div className="space-y-1">
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    No categories configured yet
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Create equipment categories to organize band gear and subcategories.
                  </p>
                </div>
                {canAdmin && (
                  <Button type="button" disabled={isOffline} onClick={handleOpenAddCategory}>
                    <Plus className="size-4" aria-hidden="true" />
                    <span>Add Category</span>
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {categoryTree.map((node) => {
                  const swatchColor =
                    node.color || getCategoryColor(node.name, categories, node.id);
                  const CategoryIcon = resolveCategoryIcon(node.icon);
                  const itemCount = categoryCounts.byTopCategoryId.get(node.id) ?? 0;
                  const headingId = `category-card-${node.id}`;

                  return (
                    <article
                      key={node.id}
                      aria-labelledby={headingId}
                      style={{ '--card-accent': swatchColor } as CSSProperties}
                      className="card-accent-hover relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-card hover:-translate-y-0.5 hover:shadow-hover"
                    >
                      <div
                        aria-hidden="true"
                        className="band absolute inset-y-0 left-0 w-1.5"
                        style={{ backgroundColor: swatchColor }}
                      />

                      <CardHeader className="pl-5 pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              aria-hidden="true"
                              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 text-white shadow-xs"
                              style={{ backgroundColor: swatchColor }}
                            >
                              <CategoryIcon className="size-5" />
                            </span>

                            <div className="min-w-0">
                              <h2
                                id={headingId}
                                className="font-display truncate text-base font-semibold leading-tight text-foreground"
                              >
                                {node.name}
                              </h2>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span
                                  aria-label={`Color swatch ${swatchColor}`}
                                  title={swatchColor}
                                  className="inline-block size-2.5 rounded-full border border-border"
                                  style={{ backgroundColor: swatchColor }}
                                />
                                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                  {formatItemCountLabel(itemCount)}
                                </span>
                                {node.subcategories.length > 0 && (
                                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                    · {formatSubcategoryCountLabel(node.subcategories.length)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <Link
                            to={`/inventory?category=${encodeURIComponent(node.id)}`}
                            aria-label={`View ${node.name} equipment`}
                            className="group inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-secondary/60 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span>Browse</span>
                            <ArrowRight
                              className="size-3.5 transition-[transform,translate] duration-150 ease-out group-hover:translate-x-0.5"
                              aria-hidden="true"
                            />
                          </Link>
                        </div>
                      </CardHeader>

                      <CardContent className="flex-1 pl-5 pb-4">
                        {node.subcategories.length > 0 ? (
                          <div className="space-y-2">
                            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Subcategories
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {node.subcategories.map((sub) => {
                                const SubIcon = resolveCategoryIcon(sub.icon ?? node.icon);
                                const subCount = categoryCounts.bySubcategoryId.get(sub.id) ?? 0;
                                const subColor = sub.color || swatchColor;

                                return (
                                  <div
                                    key={sub.id}
                                    className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 py-1 pl-2.5 pr-1.5 text-xs"
                                  >
                                    <Link
                                      to={`/inventory?category=${encodeURIComponent(node.id)}&subcategory=${encodeURIComponent(sub.id)}`}
                                      className="inline-flex items-center gap-1.5 font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
                                    >
                                      <span
                                        aria-hidden="true"
                                        className="size-2 shrink-0 rounded-full"
                                        style={{ backgroundColor: subColor }}
                                      />
                                      <SubIcon
                                        className="size-3 shrink-0 text-muted-foreground"
                                        aria-hidden="true"
                                      />
                                      <span>{sub.name}</span>
                                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                                        ({subCount})
                                      </span>
                                    </Link>

                                    {canAdmin && (
                                      <div className="ml-0.5 flex items-center gap-0.5 border-l border-border pl-1">
                                        <button
                                          type="button"
                                          disabled={isOffline}
                                          onClick={() => handleOpenEditCategory(sub)}
                                          aria-label={`Edit ${sub.name}`}
                                          title={`Edit ${sub.name}`}
                                          className="cursor-pointer rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                          <Edit2 className="size-3" aria-hidden="true" />
                                        </button>
                                        <button
                                          type="button"
                                          disabled={isOffline}
                                          onClick={() => handleRequestDeleteSubcategory(sub)}
                                          aria-label={`Delete ${sub.name}`}
                                          title={`Delete ${sub.name}`}
                                          className="cursor-pointer rounded-full p-1 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                          <Trash2 className="size-3" aria-hidden="true" />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No subcategories</p>
                        )}
                      </CardContent>

                      {canAdmin && (
                        <CardFooter className="justify-between gap-2 border-t border-dashed border-border pl-5 pt-3">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isOffline}
                            onClick={() => handleOpenAddSubcategory(node.id)}
                            className="h-8 px-2.5 text-xs"
                          >
                            <FolderPlus className="size-3.5" aria-hidden="true" />
                            <span>Add Subcategory</span>
                          </Button>

                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="size-8 text-muted-foreground hover:text-foreground"
                              aria-label={`Edit ${node.name}`}
                              title={`Edit ${node.name}`}
                              disabled={isOffline}
                              onClick={() => handleOpenEditCategory(node)}
                            >
                              <Edit2 className="size-4" aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="size-8 text-muted-foreground hover:text-destructive"
                              aria-label={`Delete ${node.name}`}
                              title={`Delete ${node.name}`}
                              disabled={isOffline}
                              onClick={() => handleRequestDeleteCategory(node)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </CardFooter>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Storage Locations Tab */}
          <TabsContent value="locations" className="space-y-4">
            {sortedLocations.length === 0 ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-card">
                <MapPin className="size-10 text-muted-foreground/60" aria-hidden="true" />
                <div className="space-y-1">
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    No storage locations configured yet
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Add sanctuary rooms, closets, or racks where band equipment is stored.
                  </p>
                </div>
                {canAdmin && (
                  <Button type="button" disabled={isOffline} onClick={handleOpenAddLocation}>
                    <Plus className="size-4" aria-hidden="true" />
                    <span>Add Location</span>
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sortedLocations.map((loc) => {
                  const itemCount = locationCounts.get(loc.id) ?? 0;
                  const headingId = `location-card-${loc.id}`;

                  return (
                    <Card
                      key={loc.id}
                      className="flex flex-col justify-between p-0 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-hover"
                    >
                      <article
                        aria-labelledby={headingId}
                        className="flex flex-1 flex-col justify-between"
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <span
                                aria-hidden="true"
                                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary"
                              >
                                <MapPin className="size-5" />
                              </span>
                              <div className="min-w-0">
                                <h2
                                  id={headingId}
                                  className="font-display truncate text-base font-semibold leading-tight text-foreground"
                                >
                                  {loc.name}
                                </h2>
                                <Badge variant="secondary" className="mt-1 tabular-nums">
                                  {formatItemCountLabel(itemCount)}
                                </Badge>
                              </div>
                            </div>

                            <Link
                              to={`/inventory?location=${encodeURIComponent(loc.id)}`}
                              aria-label={`View ${loc.name} equipment`}
                              className="group inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-secondary/60 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span>Browse</span>
                              <ArrowRight
                                className="size-3.5 transition-[transform,translate] duration-150 ease-out group-hover:translate-x-0.5"
                                aria-hidden="true"
                              />
                            </Link>
                          </div>
                        </CardHeader>

                        <CardContent className="flex-1 pb-4">
                          <p className="text-sm text-muted-foreground">
                            {loc.description?.trim() || 'No storage description added yet.'}
                          </p>
                        </CardContent>

                        {canAdmin && (
                          <CardFooter className="justify-end gap-1 border-t border-dashed border-border pt-3">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="size-8 text-muted-foreground hover:text-foreground"
                              aria-label={`Edit ${loc.name}`}
                              title={`Edit ${loc.name}`}
                              disabled={isOffline}
                              onClick={() => handleOpenEditLocation(loc)}
                            >
                              <Edit2 className="size-4" aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="size-8 text-muted-foreground hover:text-destructive"
                              aria-label={`Delete ${loc.name}`}
                              title={`Delete ${loc.name}`}
                              disabled={isOffline}
                              onClick={() => handleRequestDeleteLocation(loc)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </CardFooter>
                        )}
                      </article>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Equipment Types Tab */}
          <TabsContent value="types" className="space-y-4">
            {sortedEquipmentTypes.length === 0 ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-card">
                <Tags className="size-10 text-muted-foreground/60" aria-hidden="true" />
                <div className="space-y-1">
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    No equipment types configured yet
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Create functional equipment types (such as Instruments, Microphones, or
                    Cables) to classify gear across categories.
                  </p>
                </div>
                {canAdmin && (
                  <Button type="button" disabled={isOffline} onClick={handleOpenAddEquipmentType}>
                    <Plus className="size-4" aria-hidden="true" />
                    <span>Add Equipment Type</span>
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sortedEquipmentTypes.map((et) => {
                  const swatchColor =
                    et.color || getEquipmentTypeColor(et.name, equipmentTypes, et.id);
                  const TypeIcon = resolveCategoryIcon(et.icon);
                  const itemCount = equipmentTypeCounts.get(et.id) ?? 0;
                  const headingId = `equipment-type-card-${et.id}`;

                  return (
                    <article
                      key={et.id}
                      aria-labelledby={headingId}
                      style={{ '--card-accent': swatchColor } as CSSProperties}
                      className="card-accent-hover relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-card hover:-translate-y-0.5 hover:shadow-hover"
                    >
                      <div
                        aria-hidden="true"
                        className="band absolute inset-y-0 left-0 w-1.5"
                        style={{ backgroundColor: swatchColor }}
                      />

                      <CardHeader className="pl-5 pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              aria-hidden="true"
                              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 text-white shadow-xs"
                              style={{ backgroundColor: swatchColor }}
                            >
                              <TypeIcon className="size-5" />
                            </span>

                            <div className="min-w-0">
                              <h2
                                id={headingId}
                                className="font-display truncate text-base font-semibold leading-tight text-foreground"
                              >
                                {et.name}
                              </h2>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span
                                  aria-label={`Color swatch ${swatchColor}`}
                                  title={swatchColor}
                                  className="inline-block size-2.5 rounded-full border border-border"
                                  style={{ backgroundColor: swatchColor }}
                                />
                                <Badge variant="secondary" className="tabular-nums">
                                  {formatItemCountLabel(itemCount)}
                                </Badge>
                              </div>
                            </div>
                          </div>

                          <Link
                            to={`/inventory?type=${encodeURIComponent(et.id)}`}
                            aria-label={`View ${et.name} equipment`}
                            className="group inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-secondary/60 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span>Browse</span>
                            <ArrowRight
                              className="size-3.5 transition-[transform,translate] duration-150 ease-out group-hover:translate-x-0.5"
                              aria-hidden="true"
                            />
                          </Link>
                        </div>
                      </CardHeader>

                      <CardContent className="flex-1 pl-5 pb-4">
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {swatchColor.toUpperCase()} · Order {et.sort_order}
                        </p>
                      </CardContent>

                      {canAdmin && (
                        <CardFooter className="justify-end gap-1 border-t border-dashed border-border pl-5 pt-3">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-8 text-muted-foreground hover:text-foreground"
                            aria-label={`Edit ${et.name}`}
                            title={`Edit ${et.name}`}
                            disabled={isOffline}
                            onClick={() => handleOpenEditEquipmentType(et)}
                          >
                            <Edit2 className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${et.name}`}
                            title={`Delete ${et.name}`}
                            disabled={isOffline}
                            onClick={() => handleRequestDeleteEquipmentType(et)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </CardFooter>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Admin Dialogs */}
      {canAdmin && (
        <>
          <CategoryDialog
            open={categoryDialogOpen}
            onOpenChange={(nextOpen) => {
              setCategoryDialogOpen(nextOpen);
              if (!nextOpen) {
                setEditingCategory(null);
                setDefaultParentId(null);
              }
            }}
            category={editingCategory}
            defaultParentId={defaultParentId}
            categories={categories}
            isOffline={isOffline}
          />

          <LocationDialog
            open={locationDialogOpen}
            onOpenChange={(nextOpen) => {
              setLocationDialogOpen(nextOpen);
              if (!nextOpen) {
                setEditingLocation(null);
              }
            }}
            location={editingLocation}
            isOffline={isOffline}
          />

          <EquipmentTypeDialog
            open={equipmentTypeDialogOpen}
            onOpenChange={(nextOpen) => {
              setEquipmentTypeDialogOpen(nextOpen);
              if (!nextOpen) {
                setEditingEquipmentType(null);
              }
            }}
            equipmentType={editingEquipmentType}
            isOffline={isOffline}
          />

          {/* Delete Category / Subcategory Confirmation */}
          <AlertDialog
            open={Boolean(pendingDeleteCategory)}
            onOpenChange={(nextOpen) => {
              if (!nextOpen && !isDeletingCategory) {
                setPendingDeleteCategory(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {pendingDeleteCategory?.category.parent_id
                    ? 'Delete Subcategory?'
                    : 'Delete Category?'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {pendingDeleteCategory && (
                    <>
                      <span className="font-semibold text-foreground">
                        {pendingDeleteCategory.category.name}
                      </span>{' '}
                      is currently linked to{' '}
                      <span className="font-semibold text-foreground">
                        {formatInventoryLinkCount(pendingDeleteCategory.linkedItemCount)}
                      </span>
                      {!pendingDeleteCategory.category.parent_id && (
                        <>
                          {' '}
                          and{' '}
                          <span className="font-semibold text-foreground">
                            {formatSubcategoryCountLabel(
                              pendingDeleteCategory.linkedSubcategoryCount
                            )}
                          </span>
                        </>
                      )}
                      . Linked equipment will remain in inventory with its category reference
                      cleared
                      {!pendingDeleteCategory.category.parent_id &&
                      pendingDeleteCategory.linkedSubcategoryCount > 0
                        ? ', and child subcategories will be permanently removed'
                        : ''}
                      .
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeletingCategory}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isDeletingCategory || isOffline}
                  onClick={(event) => {
                    event.preventDefault();
                    void handleConfirmDeleteCategory();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeletingCategory
                    ? 'Deleting...'
                    : pendingDeleteCategory?.category.parent_id
                      ? 'Delete Subcategory'
                      : 'Delete Category'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Delete Location Confirmation */}
          <AlertDialog
            open={Boolean(pendingDeleteLocation)}
            onOpenChange={(nextOpen) => {
              if (!nextOpen && !isDeletingLocation) {
                setPendingDeleteLocation(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Storage Location?</AlertDialogTitle>
                <AlertDialogDescription>
                  {pendingDeleteLocation && (
                    <>
                      <span className="font-semibold text-foreground">
                        {pendingDeleteLocation.location.name}
                      </span>{' '}
                      is currently linked to{' '}
                      <span className="font-semibold text-foreground">
                        {formatInventoryLinkCount(pendingDeleteLocation.linkedItemCount)}
                      </span>
                      . Linked equipment will remain in inventory with its storage location
                      assignment cleared.
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeletingLocation}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isDeletingLocation || isOffline}
                  onClick={(event) => {
                    event.preventDefault();
                    void handleConfirmDeleteLocation();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeletingLocation ? 'Deleting...' : 'Delete Location'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Delete Equipment Type Confirmation */}
          <AlertDialog
            open={Boolean(pendingDeleteEquipmentType)}
            onOpenChange={(nextOpen) => {
              if (!nextOpen && !isDeletingEquipmentType) {
                setPendingDeleteEquipmentType(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Equipment Type?</AlertDialogTitle>
                <AlertDialogDescription>
                  {pendingDeleteEquipmentType && (
                    <>
                      <span className="font-semibold text-foreground">
                        {pendingDeleteEquipmentType.equipmentType.name}
                      </span>{' '}
                      is currently linked to{' '}
                      <span className="font-semibold text-foreground">
                        {formatInventoryLinkCount(
                          pendingDeleteEquipmentType.linkedItemCount
                        )}
                      </span>
                      . Linked equipment will remain in inventory with its equipment type
                      reference cleared.
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeletingEquipmentType}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={isDeletingEquipmentType || isOffline}
                  onClick={(event) => {
                    event.preventDefault();
                    void handleConfirmDeleteEquipmentType();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeletingEquipmentType ? 'Deleting...' : 'Delete Equipment Type'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </section>
  );
}
