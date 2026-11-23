import { useEffect, useMemo, useState } from 'react';
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Edit2,
  Eye,
  ImageOff,
  MapPin,
  MessageSquare,
  Package,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCategoryColor } from '@/features/categories/useCategories';
import {
  DEFAULT_EQUIPMENT_TYPE_COLOR,
  getEquipmentTypeColor,
} from '@/features/equipmentTypes/useEquipmentTypes';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { cn, parseImages } from '@/lib/utils';
import type {
  Category,
  EquipmentType,
  ItemCondition,
  LocationRecord,
  UserRole,
} from '@/types/database';
import {
  CONDITION_META,
  isLowStock,
  resolveCategoryName,
  resolveEquipmentTypeName,
  resolveLocationName,
  resolveSubcategoryName,
} from './inventoryUi';
import { QuickCheckButtons } from './QuickCheckButtons';

export interface InventoryTableProps {
  items: readonly EnrichedInventoryItem[];
  role: UserRole;
  categories: readonly Category[];
  locations: readonly LocationRecord[];
  equipmentTypes?: readonly EquipmentType[];
  commentCounts?: Readonly<Record<string, number>>;
  selectionMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (itemId: string) => void;
  onToggleSelectAll?: (itemIds: readonly string[], allSelected: boolean) => void;
  onSelectItem: (item: EnrichedInventoryItem) => void;
  onQuickCheck?: (item: EnrichedInventoryItem, condition: ItemCondition) => void;
  onEdit?: (item: EnrichedInventoryItem) => void;
  onDelete?: (item: EnrichedInventoryItem) => void;
  isChecking?: boolean;
  isOffline?: boolean;
}

const inventoryTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    basic: sortFn_basic,
  },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

const columnHelper = createColumnHelper<typeof inventoryTableFeatures, EnrichedInventoryItem>();

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const MOBILE_SORT_OPTIONS = [
  { id: 'none', label: 'Default order' },
  { id: 'item', label: 'Item name' },
  { id: 'equipment_type', label: 'Type' },
  { id: 'category', label: 'Category' },
  { id: 'location', label: 'Location' },
  { id: 'condition', label: 'Condition' },
  { id: 'available_qty', label: 'Availability' },
] as const;
const EMPTY_EQUIPMENT_TYPES: EquipmentType[] = [];
const EMPTY_COMMENT_COUNTS: Record<string, number> = {};

function TableItemThumbnail({
  src,
  itemName,
  itemId,
}: {
  src: string | null;
  itemName: string;
  itemId: string;
}) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!src || hasError) {
    return (
      <div
        aria-hidden="true"
        data-testid={`table-thumb-fallback-${itemId}`}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/50 text-muted-foreground/60"
      >
        <ImageOff className="size-4" />
      </div>
    );
  }

  return (
    <div className="img-inset-outline size-9 shrink-0 overflow-hidden rounded-lg bg-secondary/40">
      <img
        src={src}
        alt={`${itemName} thumbnail`}
        loading="lazy"
        decoding="async"
        onError={() => setHasError(true)}
        className="size-full object-cover"
      />
    </div>
  );
}

const MOBILE_CELL_ORDER: Record<string, string> = {
  select: 'max-md:order-1 max-md:p-0',
  condition: 'max-md:order-3 max-md:p-0',
  available_qty: 'max-md:order-4 max-md:p-0',
  equipment_type: 'max-md:order-5 max-md:p-0',
  category: 'max-md:order-6 max-md:p-0',
  location: 'max-md:order-7 max-md:p-0',
};

function getMobileCellClass(colId: string, selectionMode: boolean, hasActionBar: boolean): string {
  if (colId === 'item') {
    return cn(
      'max-md:order-2 max-md:min-w-0 max-md:flex-1 max-md:p-0',
      selectionMode ? 'max-md:basis-[calc(100%-2.25rem)]' : 'max-md:basis-full'
    );
  }
  if (colId === 'actions') {
    return cn(
      'max-md:order-8 max-md:p-0',
      hasActionBar
        ? 'max-md:mt-0.5 max-md:w-full max-md:border-t max-md:border-dashed max-md:border-border max-md:pt-2.5'
        : 'max-md:ml-auto'
    );
  }
  return MOBILE_CELL_ORDER[colId] ?? '';
}

/**
 * Sortable, paginated TanStack Table v9 view for inventory equipment with
 * Equipment Type pills, Low Stock badges, comment count pills, and Admin
 * multi-select checkboxes.
 */
export function InventoryTable({
  items,
  role,
  categories,
  locations,
  equipmentTypes = EMPTY_EQUIPMENT_TYPES,
  commentCounts = EMPTY_COMMENT_COUNTS,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onSelectItem,
  onQuickCheck,
  onEdit,
  onDelete,
  isChecking = false,
  isOffline = false,
}: InventoryTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });

  const canCheck = role === 'member' || role === 'admin';
  const canAdmin = role === 'admin';

  const data = useMemo(() => [...items], [items]);
  const allItemIds = useMemo(() => items.map((entry) => entry.id), [items]);
  const allSelected =
    allItemIds.length > 0 && allItemIds.every((id) => Boolean(selectedIds?.has(id)));
  const someSelected =
    !allSelected && allItemIds.some((id) => Boolean(selectedIds?.has(id)));

  const columns = useMemo(
    () =>
      columnHelper.columns([
        ...(selectionMode
          ? [
              columnHelper.display({
                id: 'select',
                header: () => (
                  <div onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = someSelected;
                        }
                      }}
                      checked={allSelected}
                      onChange={() => onToggleSelectAll?.(allItemIds, allSelected)}
                      aria-label="Select all items"
                      className="size-4 cursor-pointer rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                ),
                cell: ({ row }) => {
                  const entry = row.original;
                  const isSelected = Boolean(selectedIds?.has(entry.id));
                  return (
                    <div onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect?.(entry.id)}
                        aria-label={`Select ${entry.item}`}
                        className="size-4 cursor-pointer rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  );
                },
              }),
            ]
          : []),
        columnHelper.accessor('item', {
          header: 'Item',
          sortFn: 'alphanumeric',
          cell: ({ row }) => {
            const entry = row.original;
            const accent = getCategoryColor(entry.category, categories, entry.category_id);
            const firstPhoto = parseImages(entry.image_filename)[0] ?? null;
            const subtitle = [entry.brand, entry.serial ? `SN: ${entry.serial}` : null]
              .filter((part): part is string => Boolean(part && part.trim()))
              .join(' · ');

            return (
              <div className="flex min-w-0 items-center gap-2.5 md:min-w-[165px] md:max-w-[235px]">
                <span
                  aria-hidden="true"
                  className="h-9 w-1 shrink-0 rounded-full md:h-7"
                  style={{ backgroundColor: accent }}
                />
                <TableItemThumbnail
                  src={firstPhoto}
                  itemName={entry.item}
                  itemId={entry.id}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-display line-clamp-2 font-semibold leading-snug text-foreground md:truncate md:font-sans">
                    {entry.item}
                  </p>
                  {subtitle && (
                    <p className="truncate font-sans text-xs tabular-nums text-muted-foreground">
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>
            );
          },
        }),
        columnHelper.accessor(
          (row) => resolveEquipmentTypeName(row, equipmentTypes) ?? '',
          {
            id: 'equipment_type',
            header: 'Type',
            sortFn: 'alphanumeric',
            cell: ({ row }) => {
              const entry = row.original;
              const typeName = resolveEquipmentTypeName(entry, equipmentTypes);
              if (!typeName) {
                return <span className="text-xs text-muted-foreground">—</span>;
              }
              const accent = getEquipmentTypeColor(
                typeName,
                equipmentTypes,
                entry.equipment_type_id
              );
              return (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-0.5 font-sans text-[11px] font-medium text-foreground whitespace-nowrap md:px-2 md:text-[10px]">
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: accent || DEFAULT_EQUIPMENT_TYPE_COLOR }}
                  />
                  <span className="max-w-[140px] truncate md:max-w-[115px]">{typeName}</span>
                </span>
              );
            },
          }
        ),
        columnHelper.accessor(
          (row) => resolveCategoryName(row, categories),
          {
            id: 'category',
            header: 'Category',
            sortFn: 'alphanumeric',
            cell: ({ row }) => {
              const entry = row.original;
              const categoryName = resolveCategoryName(entry, categories);
              const subcategoryName = resolveSubcategoryName(entry, categories);
              const accent = getCategoryColor(categoryName, categories, entry.category_id);

              return (
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 md:min-w-[105px] md:max-w-[165px] md:flex-col md:items-start">
                  <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs font-medium text-foreground md:text-sm md:font-normal">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: accent }}
                    />
                    <span className="min-w-0 truncate">{categoryName}</span>
                  </span>
                  {subcategoryName && (
                    <span className="max-w-full truncate font-sans text-[11px] text-muted-foreground md:pl-3.5">
                      <span className="md:hidden">· </span>
                      {subcategoryName}
                    </span>
                  )}
                </div>
              );
            },
          }
        ),
        columnHelper.accessor(
          (row) => resolveLocationName(row, locations),
          {
            id: 'location',
            header: 'Location',
            sortFn: 'alphanumeric',
            cell: ({ row }) => (
              <span className="inline-flex max-w-[140px] items-center gap-1 truncate rounded-full border border-border/70 bg-background/70 px-2 py-0.5 font-sans text-[11px] text-muted-foreground md:block md:max-w-[115px] md:rounded-none md:border-0 md:bg-transparent md:p-0 md:text-sm md:text-foreground">
                <MapPin className="size-3 shrink-0 md:hidden" aria-hidden="true" />
                <span className="truncate">{resolveLocationName(row.original, locations)}</span>
              </span>
            ),
          }
        ),
        columnHelper.accessor('condition', {
          header: 'Condition',
          sortFn: 'text',
          cell: ({ row }) => {
            const meta = CONDITION_META[row.original.condition];
            return <Badge variant={meta.badgeVariant}>{meta.label}</Badge>;
          },
        }),
        columnHelper.accessor('available_qty', {
          header: 'Availability',
          sortFn: 'basic',
          cell: ({ row }) => {
            const entry = row.original;
            const lowStock = isLowStock(entry);
            return (
              <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
                <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-secondary/50 px-2 py-0.5 font-sans text-xs font-semibold tabular-nums text-foreground md:rounded-none md:border-0 md:bg-transparent md:p-0">
                  <Package className="size-3 shrink-0 text-muted-foreground md:hidden" aria-hidden="true" />
                  <span>{`${entry.available_qty} / ${entry.qty}`}</span>
                </span>
                {entry.qty_on_loan > 0 && <Badge variant="loaned">On Loan</Badge>}
                {lowStock && <Badge variant="lowStock">Low Stock</Badge>}
              </div>
            );
          },
        }),
        columnHelper.display({
          id: 'actions',
          header: () => <span className="sr-only sm:not-sr-only">Actions</span>,
          cell: ({ row }) => {
            const entry = row.original;
            const commentCount =
              role !== 'guest' ? (commentCounts[entry.id] ?? 0) : 0;

            return (
              <div
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap md:gap-1',
                  canCheck || canAdmin ? 'justify-between md:justify-end' : 'justify-end'
                )}
                onClick={(event) => event.stopPropagation()}
              >
                {canCheck && (
                  <QuickCheckButtons
                    item={entry}
                    onQuickCheck={onQuickCheck}
                    disabled={isChecking || isOffline}
                    layout="inline"
                  />
                )}

                <div className="flex items-center gap-1">
                  {commentCount > 0 && (
                    <span
                      aria-label={`${commentCount} ${commentCount === 1 ? 'note' : 'notes'}`}
                      className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-sans text-[11px] tabular-nums text-muted-foreground"
                    >
                      <MessageSquare className="size-3" aria-hidden="true" />
                      <span>{commentCount}</span>
                    </span>
                  )}

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-9 text-muted-foreground hover:text-foreground md:size-7"
                    aria-label={`View ${entry.item}`}
                    title="View details"
                    onClick={() => onSelectItem(entry)}
                  >
                    <Eye className="size-4" aria-hidden="true" />
                  </Button>

                  {canAdmin && (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-9 text-muted-foreground hover:text-foreground md:size-7"
                        aria-label={`Edit ${entry.item}`}
                        title="Edit item"
                        disabled={isOffline}
                        onClick={() => onEdit?.(entry)}
                      >
                        <Edit2 className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-9 text-muted-foreground hover:text-destructive md:size-7"
                        aria-label={`Move ${entry.item} to Trash`}
                        title="Move to Trash"
                        disabled={isOffline}
                        onClick={() => onDelete?.(entry)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          },
        }),
      ]),
    [
      allItemIds,
      allSelected,
      canAdmin,
      canCheck,
      categories,
      commentCounts,
      equipmentTypes,
      isChecking,
      isOffline,
      locations,
      onDelete,
      onEdit,
      onQuickCheck,
      onSelectItem,
      onToggleSelect,
      onToggleSelectAll,
      role,
      selectedIds,
      selectionMode,
      someSelected,
    ]
  );

  const table = useTable(
    {
      features: inventoryTableFeatures,
      columns,
      data,
      getRowId: (row) => row.id,
      state: {
        sorting,
        pagination,
      },
      onSortingChange: setSorting,
      onPaginationChange: setPagination,
    },
    (state) => ({
      sorting: state.sorting,
      pagination: state.pagination,
    })
  );

  const rows = table.getRowModel().rows;
  const pageCount = Math.max(table.getPageCount(), 1);
  const currentPageIndex = table.state.pagination.pageIndex;
  const currentPageSize = table.state.pagination.pageSize;
  const totalCount = data.length;

  useEffect(() => {
    const maxPageIndex = Math.max(Math.ceil(totalCount / currentPageSize) - 1, 0);
    if (currentPageIndex > maxPageIndex) {
      setPagination((prev) => ({ ...prev, pageIndex: maxPageIndex }));
    }
  }, [currentPageIndex, currentPageSize, totalCount]);
  const startRow = totalCount === 0 ? 0 : currentPageIndex * currentPageSize + 1;
  const endRow = Math.min((currentPageIndex + 1) * currentPageSize, totalCount);
  const activeSort = sorting[0] ?? null;

  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      {/* Mobile-only compact Sort bar since desktop column headers collapse into card rows */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 md:hidden">
        <span className="font-sans text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sort
        </span>
        <div className="flex items-center gap-1.5">
          <Select
            value={activeSort?.id ?? 'none'}
            onValueChange={(colId) =>
              setSorting(colId === 'none' ? [] : [{ id: colId, desc: activeSort?.desc ?? false }])
            }
          >
            <SelectTrigger aria-label="Sort inventory table by" className="h-8 w-[145px] text-xs">
              <SelectValue placeholder="Default order" />
            </SelectTrigger>
            <SelectContent>
              {MOBILE_SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {activeSort && (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-8"
              aria-label={activeSort.desc ? 'Sort ascending' : 'Sort descending'}
              onClick={() =>
                setSorting([{ id: activeSort.id, desc: !activeSort.desc }])
              }
            >
              {activeSort.desc ? (
                <ArrowDown className="size-3.5 text-primary" aria-hidden="true" />
              ) : (
                <ArrowUp className="size-3.5 text-primary" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </div>

      <Table
        containerLabel="Equipment inventory table"
        containerClassName="max-md:overflow-x-visible"
        className="md:[&_th]:px-2.5 md:[&_td]:px-2.5 md:[&_td]:py-2.5"
      >
        <TableHeader className="max-md:hidden">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sortDir = header.column.getIsSorted();
                const toggleSorting = header.column.getToggleSortingHandler();

                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      sortDir === 'asc'
                        ? 'ascending'
                        : sortDir === 'desc'
                          ? 'descending'
                          : canSort
                            ? 'none'
                            : undefined
                    }
                    className={cn(
                      header.id === 'actions' && 'text-right',
                      header.id === 'select' && 'w-10'
                    )}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={toggleSorting}
                        className="inline-flex items-center gap-1.5 rounded py-0.5 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <table.FlexRender header={header} />
                        {sortDir === 'asc' ? (
                          <ArrowUp className="size-3.5 text-primary" aria-hidden="true" />
                        ) : sortDir === 'desc' ? (
                          <ArrowDown className="size-3.5 text-primary" aria-hidden="true" />
                        ) : (
                          <ArrowUpDown className="size-3.5 opacity-50" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody className="max-md:block max-md:divide-y max-md:divide-border">
          {rows.map((row) => {
            const isSelected = Boolean(selectionMode && selectedIds?.has(row.original.id));
            return (
              <TableRow
                key={row.id}
                onClick={() =>
                  selectionMode && onToggleSelect
                    ? onToggleSelect(row.original.id)
                    : onSelectItem(row.original)
                }
                className={cn(
                  'cursor-pointer transition-colors duration-150 max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-2 max-md:gap-y-2.5 max-md:border-0 max-md:px-4 max-md:py-4',
                  isSelected && 'bg-primary/[0.04]'
                )}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={getMobileCellClass(
                      cell.column.id,
                      selectionMode,
                      canCheck || canAdmin
                    )}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Pagination Footer */}
      <div className="flex flex-col gap-3 border-t border-border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between md:py-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground sm:justify-start">
          <span className="font-sans tabular-nums">
            Showing {startRow}–{endRow} of {totalCount}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-[11px] font-semibold uppercase tracking-wider">Rows:</span>
            <Select
              value={String(currentPageSize)}
              onValueChange={(val) => table.setPageSize(Number(val))}
            >
              <SelectTrigger aria-label="Rows per page" className="h-8 w-[74px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span className="font-sans text-xs tabular-nums text-muted-foreground">
            Page {currentPageIndex + 1} of {pageCount}
          </span>
          <div className="flex items-center gap-1.5 md:gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 md:size-8"
              onClick={() => table.firstPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="First page"
            >
              <ChevronsLeft className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 md:size-8"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 md:size-8"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 md:size-8"
              onClick={() => table.lastPage()}
              disabled={!table.getCanLastPage()}
              aria-label="Last page"
            >
              <ChevronsRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
