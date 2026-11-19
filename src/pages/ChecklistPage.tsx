import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileDown,
  Loader2,
  MapPin,
  Package,
  Printer,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/features/auth/useAuth';
import { sortCategories, useCategories } from '@/features/categories/useCategories';
import {
  computeChecklistProgress,
  filterChecklistItems,
  formatChecklistPrintDate,
  formatLocalYmd,
  groupChecklistItemsByCategory,
  isCheckedToday,
  toPrintableChecklistItem,
  type ChecklistCategoryGroup,
  type ChecklistProgress,
  type PrintableChecklistItem,
} from '@/features/checklist/checklistUtils';
import {
  CONDITION_META,
  formatLastCheckedDate,
  resolveLocationName,
  resolveSubcategoryName,
} from '@/features/inventory/inventoryUi';
import { QuickCheckButtons } from '@/features/inventory/QuickCheckButtons';
import {
  useInventoryItems,
  useItemMutations,
  type EnrichedInventoryItem,
} from '@/features/inventory/useInventory';
import { sortLocations, useLocations } from '@/features/locations/useLocations';
import { cn } from '@/lib/utils';
import type { Category, ItemCondition, LocationRecord } from '@/types/database';

type ChecklistTab = 'live' | 'print';
type Html2PdfFactory = typeof import('html2pdf.js').default;

const ALL_OPTION = '__all__';
const EMPTY_ITEMS: EnrichedInventoryItem[] = [];
const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_LOCATIONS: LocationRecord[] = [];

function resolveHtml2PdfFactory(mod: unknown): Html2PdfFactory | null {
  if (typeof mod === 'function') {
    return mod as Html2PdfFactory;
  }
  if (typeof mod === 'object' && mod !== null && 'default' in mod) {
    return resolveHtml2PdfFactory((mod as { default: unknown }).default);
  }
  return null;
}

interface ChecklistProgressCardProps {
  progress: ChecklistProgress;
  flaggedCount: number;
  filteredCount: number;
  totalCount: number;
  hasActiveFilters: boolean;
}

function ChecklistProgressCard({
  progress,
  flaggedCount,
  filteredCount,
  totalCount,
  hasActiveFilters,
}: ChecklistProgressCardProps) {
  const pendingCount = Math.max(progress.total - progress.checked, 0);
  const allChecked = progress.total > 0 && progress.checked === progress.total;

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
                Checked Today
              </span>
              {allChecked && (
                <Badge variant="working">Ready for Service</Badge>
              )}
            </div>
            <p className="mt-1 text-sm font-medium text-foreground">
              {progress.checked} of {progress.total} items checked today
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {formatChecklistPrintDate()}
            </p>
          </div>

          <div className="flex items-baseline gap-3 self-start sm:self-center">
            <span className="font-display text-3xl font-bold tracking-tight text-foreground">
              {progress.percent}%
            </span>
          </div>
        </div>

        <Progress value={progress.percent} aria-label="Sunday check-off progress" />

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="gap-1">
            <Clock className="size-3" aria-hidden="true" />
            <span>{pendingCount} Pending Today</span>
          </Badge>
          {flaggedCount > 0 && (
            <Badge variant="repair">{flaggedCount} Flagged</Badge>
          )}
          {hasActiveFilters && (
            <span className="font-mono text-[11px] text-muted-foreground">
              Showing {filteredCount} of {totalCount} items
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface ChecklistFiltersProps {
  topCategories: readonly Category[];
  sortedLocations: readonly LocationRecord[];
  selectedCategoryId: string;
  selectedLocationId: string;
  onCategoryChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  uncheckedOnly?: boolean;
  onToggleUncheckedOnly?: () => void;
  showLiveControls?: boolean;
  actions?: ReactNode;
  className?: string;
}

function ChecklistCategoryLocationControls({
  topCategories,
  sortedLocations,
  selectedCategoryId,
  selectedLocationId,
  onCategoryChange,
  onLocationChange,
  hasActiveFilters,
  onClearFilters,
  searchQuery = '',
  onSearchChange,
  uncheckedOnly = false,
  onToggleUncheckedOnly,
  showLiveControls = false,
  actions,
  className,
}: ChecklistFiltersProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card lg:flex-row lg:items-center lg:justify-between',
        className
      )}
    >
      <div className="flex flex-1 flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        {showLiveControls && onSearchChange && (
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search equipment, brand, serial, or remarks..."
              aria-label="Search checklist items"
              className="pl-9"
            />
          </div>
        )}

        <Select value={selectedCategoryId} onValueChange={onCategoryChange}>
          <SelectTrigger aria-label="Filter by category" className="w-full sm:w-[200px]">
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

        <Select value={selectedLocationId} onValueChange={onLocationChange}>
          <SelectTrigger aria-label="Filter by location" className="w-full sm:w-[190px]">
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

        {showLiveControls && onToggleUncheckedOnly && (
          <Button
            type="button"
            size="sm"
            variant={uncheckedOnly ? 'default' : 'outline'}
            aria-pressed={uncheckedOnly}
            onClick={onToggleUncheckedOnly}
            className="h-9 gap-1.5"
          >
            <Clock className="size-3.5" aria-hidden="true" />
            <span>Unchecked Today</span>
          </Button>
        )}

        {hasActiveFilters && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClearFilters}
            className="h-9 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
            <span>Clear Filters</span>
          </Button>
        )}
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

interface LiveChecklistGroupsProps {
  groups: readonly ChecklistCategoryGroup<EnrichedInventoryItem>[];
  categories: readonly Category[];
  locations: readonly LocationRecord[];
  checkingItemId: string | null;
  isChecking: boolean;
  onQuickCheck: (item: EnrichedInventoryItem, condition: ItemCondition) => Promise<void>;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

function LiveChecklistGroups({
  groups,
  categories,
  locations,
  checkingItemId,
  isChecking,
  onQuickCheck,
  hasActiveFilters,
  onClearFilters,
}: LiveChecklistGroupsProps) {
  if (groups.length === 0) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-card">
        <ClipboardCheck className="size-10 text-muted-foreground/60" aria-hidden="true" />
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold text-foreground">
            {hasActiveFilters
              ? 'No equipment matches your checklist filters'
              : 'No equipment logged yet'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {hasActiveFilters
              ? 'Try clearing filters or turning off Unchecked Today to see all gear.'
              : 'Add band equipment from Inventory to start Sunday check-offs.'}
          </p>
        </div>
        {hasActiveFilters && (
          <Button type="button" variant="outline" onClick={onClearFilters}>
            Clear Filters
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-7">
      {groups.map((group) => {
        const checkedInGroup = group.items.filter((entry) =>
          isCheckedToday(entry.checked_at)
        ).length;

        return (
          <section key={group.key} aria-label={`${group.label} checklist group`}>
            <div className="mb-3 flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: group.color }}
              />
              <h2 className="font-display text-sm font-semibold uppercase tracking-[0.06em] text-foreground">
                {group.label}
              </h2>
              <span className="font-mono text-xs text-muted-foreground">
                ({checkedInGroup}/{group.items.length} checked)
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {group.items.map((item) => {
                const checkedToday = isCheckedToday(item.checked_at);
                const conditionMeta = CONDITION_META[item.condition];
                const subcategoryName = resolveSubcategoryName(item, categories);
                const locationName = resolveLocationName(item, locations);
                const isItemChecking = checkingItemId === item.id;

                return (
                  <article
                    key={item.id}
                    data-testid={`checklist-item-${item.id}`}
                    className={cn(
                      'relative flex flex-col justify-between overflow-hidden rounded-xl border bg-card p-4 pl-5 shadow-card transition-colors',
                      checkedToday ? 'border-emerald-500/35' : 'border-border'
                    )}
                  >
                    <div
                      aria-hidden="true"
                      className="band absolute inset-y-0 left-0 w-1.5"
                      style={{ backgroundColor: group.color }}
                    />

                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-display text-base font-semibold leading-snug text-foreground">
                            {item.item}
                          </h3>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {[
                              item.brand,
                              subcategoryName,
                              item.serial ? `SN: ${item.serial}` : null,
                            ]
                              .filter((part): part is string => Boolean(part && part.trim()))
                              .join(' · ') || 'No brand or serial logged'}
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge variant={checkedToday ? 'working' : 'outline'}>
                            {checkedToday ? (
                              <>
                                <CheckCircle2 className="size-3" aria-hidden="true" />
                                <span>Checked Today</span>
                              </>
                            ) : (
                              <>
                                <Clock className="size-3" aria-hidden="true" />
                                <span>Pending</span>
                              </>
                            )}
                          </Badge>
                          <div className="flex flex-wrap justify-end gap-1">
                            <Badge variant={conditionMeta.badgeVariant}>
                              {conditionMeta.label}
                            </Badge>
                            {item.qty_on_loan > 0 && <Badge variant="loaned">On Loan</Badge>}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 rounded-lg bg-secondary/50 px-3 py-2 text-xs">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Package
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span className="text-muted-foreground">Avail:</span>
                          <span className="font-mono font-semibold text-foreground">
                            {`${item.available_qty} / ${item.qty}`}
                          </span>
                        </div>

                        <div className="flex min-w-0 items-center justify-end gap-1.5">
                          <MapPin
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span className="truncate font-medium text-foreground">
                            {locationName}
                          </span>
                        </div>
                      </div>

                      {item.remarks && (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {item.remarks}
                        </p>
                      )}
                    </div>

                    <div className="mt-4 space-y-2.5 border-t border-dashed border-border pt-3">
                      <QuickCheckButtons
                        item={item}
                        onQuickCheck={onQuickCheck}
                        disabled={isChecking || isItemChecking}
                        layout="grid"
                        size="checklist"
                      />

                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {item.checkedBy || item.dateChecked || item.checked_at
                          ? `Last check: ${formatLastCheckedDate(item)}${
                              item.checkedBy ? ` · ${item.checkedBy}` : ''
                            }`
                          : 'Not checked yet'}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

interface PrintChecklistSheetProps {
  groups: readonly ChecklistCategoryGroup<PrintableChecklistItem>[];
  totalItems: number;
  totalUnits: number;
  filterSummary: string;
  sheetRef: React.RefObject<HTMLDivElement | null>;
}

function PrintChecklistSheet({
  groups,
  totalItems,
  totalUnits,
  filterSummary,
  sheetRef,
}: PrintChecklistSheetProps) {
  return (
    <div
      ref={sheetRef}
      data-testid="checklist-print-sheet"
      className="print-sheet rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-6 text-[#0f172a] shadow-[0_1px_3px_rgba(0,0,0,0.05)] sm:p-8"
    >
      <div className="mb-6 flex flex-col gap-4 border-b-2 border-[#0f172a] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/images/logo.svg"
            alt="WINGMACC logo"
            className="size-10 shrink-0 rounded-lg border border-[#e2e8f0] bg-[#ffffff] p-1"
          />
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#475569]">
              WINGMACC Band Inventory
            </p>
            <h2 className="font-display text-2xl font-bold tracking-tight text-[#0f172a]">
              Sunday Equipment Checklist
            </h2>
          </div>
        </div>

        <div className="text-left font-mono text-xs text-[#334155] sm:text-right">
          <p className="font-semibold text-[#0f172a]">{formatChecklistPrintDate()}</p>
          <p>
            {filterSummary} · {totalItems} {totalItems === 1 ? 'item' : 'items'} · {totalUnits}{' '}
            {totalUnits === 1 ? 'unit' : 'units'}
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#cbd5e1] p-8 text-center text-sm text-[#475569]">
          No equipment matches the selected checklist filters.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section
              key={group.key}
              className="print-section break-inside-avoid space-y-2"
            >
              <div className="flex items-center gap-2 border-b-2 border-[#cbd5e1] pb-1.5">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
                <h3 className="font-display text-sm font-bold uppercase tracking-wider text-[#0f172a]">
                  {group.label}
                </h3>
                <span className="font-mono text-xs text-[#475569]">
                  ({group.items.length})
                </span>
              </div>

              <table className="print-table w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#cbd5e1] bg-[#f1f5f9] text-[11px] font-semibold uppercase tracking-wide text-[#1e293b]">
                    <th className="w-8 px-2 py-2" aria-label="Checked box" />
                    <th className="px-2 py-2">Equipment</th>
                    <th className="px-2 py-2">Brand</th>
                    <th className="w-14 px-2 py-2 text-center">Qty</th>
                    <th className="px-2 py-2">Location</th>
                    <th className="px-2 py-2">Owner</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((entry) => {
                    const statusLabel = CONDITION_META[entry.condition].label;
                    const subline = [
                      entry.subcategoryName,
                      entry.serial ? `SN: ${entry.serial}` : null,
                    ]
                      .filter((part): part is string => Boolean(part))
                      .join(' · ');

                    return (
                      <tr key={entry.id} className="border-b border-[#e2e8f0]">
                        <td className="px-2 py-2 align-middle">
                          <span
                            aria-hidden="true"
                            className="inline-block size-4 rounded-[2px] border-[1.5px] border-[#64748b]"
                          />
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <span className="font-semibold text-[#0f172a]">{entry.item}</span>
                          {subline && (
                            <span className="block font-mono text-[10px] text-[#475569]">
                              {subline}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 align-middle text-[#1e293b]">
                          {entry.brand ?? '—'}
                        </td>
                        <td className="px-2 py-2 text-center align-middle font-mono font-semibold text-[#0f172a]">
                          {entry.qty}
                        </td>
                        <td className="px-2 py-2 align-middle text-[#1e293b]">
                          {entry.locationName}
                        </td>
                        <td className="px-2 py-2 align-middle text-[#1e293b]">
                          {entry.owner ?? '—'}
                        </td>
                        <td className="px-2 py-2 align-middle font-mono text-[11px] text-[#1e293b]">
                          <span>{statusLabel}</span>
                          {entry.qtyOnLoan > 0 && (
                            <span className="block text-[10px] text-[#475569]">
                              {entry.qtyOnLoan} on loan
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      <div className="print-signature mt-10 grid grid-cols-1 gap-8 break-inside-avoid sm:grid-cols-2 sm:gap-12">
        <div className="text-center">
          <div className="mb-2 h-8 border-b border-[#0f172a]" />
          <p className="font-mono text-[11px] uppercase tracking-wider text-[#334155]">
            Checked By (Signature over Printed Name)
          </p>
        </div>
        <div className="text-center">
          <div className="mb-2 h-8 border-b border-[#0f172a]" />
          <p className="font-mono text-[11px] uppercase tracking-wider text-[#334155]">
            Date &amp; Time
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Shared Sunday Checklist route (`/checklist`):
 * - `Member` & `Admin` land on **Live Check-Off** with a real-time Checked
 *   Today progress bar, filters, and mobile-sized OK/Fix/Lost tap controls.
 * - `Guest` (View Only) sees **Print / PDF Checklist** only, omitting Live
 *   Check-Off controls and stripping all borrower PII & `checkedBy` fields.
 */
export function ChecklistPage() {
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const printSheetRef = useRef<HTMLDivElement | null>(null);

  const canCheck = role === 'member' || role === 'admin';
  const requestedTab: ChecklistTab =
    searchParams.get('tab') === 'print' ? 'print' : 'live';
  const activeTab: ChecklistTab = canCheck ? requestedTab : 'print';

  const {
    data: items = EMPTY_ITEMS,
    isLoading,
    isError,
    error,
    refetch,
  } = useInventoryItems(role);
  const { data: categories = EMPTY_CATEGORIES } = useCategories();
  const { data: locations = EMPTY_LOCATIONS } = useLocations();
  const { memberCheckItem, isChecking } = useItemMutations();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(ALL_OPTION);
  const [selectedLocationId, setSelectedLocationId] = useState<string>(ALL_OPTION);
  const [uncheckedOnly, setUncheckedOnly] = useState(false);
  const [checkingItemId, setCheckingItemId] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const topCategories = useMemo(
    () => sortCategories(categories.filter((cat) => cat.parent_id === null)),
    [categories]
  );
  const sortedLocations = useMemo(() => sortLocations(locations), [locations]);

  const effectiveCategoryId =
    selectedCategoryId === ALL_OPTION ? '' : selectedCategoryId;
  const effectiveLocationId =
    selectedLocationId === ALL_OPTION ? '' : selectedLocationId;

  const overallProgress = useMemo(() => computeChecklistProgress(items), [items]);
  const flaggedCount = useMemo(
    () => items.filter((item) => item.condition !== 'working').length,
    [items]
  );

  const liveFilteredItems = useMemo(
    () =>
      filterChecklistItems(items, {
        search: searchQuery,
        categoryId: effectiveCategoryId,
        locationId: effectiveLocationId,
        uncheckedOnly,
        categories,
        locations,
        includeCheckedByInSearch: canCheck,
      }),
    [
      items,
      searchQuery,
      effectiveCategoryId,
      effectiveLocationId,
      uncheckedOnly,
      categories,
      locations,
      canCheck,
    ]
  );

  const liveGroups = useMemo(
    () => groupChecklistItemsByCategory(liveFilteredItems, categories),
    [liveFilteredItems, categories]
  );

  const printFilteredItems = useMemo(
    () =>
      filterChecklistItems(items, {
        categoryId: effectiveCategoryId,
        locationId: effectiveLocationId,
        categories,
        locations,
      }),
    [items, effectiveCategoryId, effectiveLocationId, categories, locations]
  );

  const printableItems = useMemo(
    () =>
      printFilteredItems.map((item) =>
        toPrintableChecklistItem(item, categories, locations)
      ),
    [printFilteredItems, categories, locations]
  );

  const printableGroups = useMemo(
    () =>
      groupChecklistItemsByCategory(printFilteredItems, categories).map((group) => ({
        ...group,
        items: group.items.map((item) =>
          toPrintableChecklistItem(item, categories, locations)
        ),
      })),
    [printFilteredItems, categories, locations]
  );

  const totalPrintUnits = useMemo(
    () => printableItems.reduce((sum, item) => sum + item.qty, 0),
    [printableItems]
  );

  const printFilterSummary = useMemo(() => {
    const parts: string[] = [];
    if (effectiveCategoryId) {
      const cat = topCategories.find((entry) => entry.id === effectiveCategoryId);
      if (cat) parts.push(cat.name);
    }
    if (effectiveLocationId) {
      const loc = sortedLocations.find((entry) => entry.id === effectiveLocationId);
      if (loc) parts.push(loc.name);
    }
    return parts.length > 0 ? parts.join(' · ') : 'All Equipment';
  }, [effectiveCategoryId, effectiveLocationId, topCategories, sortedLocations]);

  const hasLiveFilters = Boolean(
    searchQuery.trim() ||
      effectiveCategoryId ||
      effectiveLocationId ||
      uncheckedOnly
  );
  const hasPrintFilters = Boolean(effectiveCategoryId || effectiveLocationId);

  const handleTabChange = (value: string) => {
    if (!canCheck) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'print') {
          next.set('tab', 'print');
        } else {
          next.delete('tab');
        }
        return next;
      },
      { replace: true }
    );
  };

  const handleClearLiveFilters = () => {
    setSearchQuery('');
    setSelectedCategoryId(ALL_OPTION);
    setSelectedLocationId(ALL_OPTION);
    setUncheckedOnly(false);
  };

  const handleClearPrintFilters = () => {
    setSelectedCategoryId(ALL_OPTION);
    setSelectedLocationId(ALL_OPTION);
  };

  const handleQuickCheck = async (
    item: EnrichedInventoryItem,
    condition: ItemCondition
  ) => {
    if (!canCheck) return;
    setCheckingItemId(item.id);
    try {
      await memberCheckItem({
        itemId: item.id,
        condition,
      });
      const label = CONDITION_META[condition].label;
      toast.success(`Checked "${item.item}" as ${label}.`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to save checklist check-off.';
      toast.error(message);
    } finally {
      setCheckingItemId((current) => (current === item.id ? null : current));
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = async () => {
    const targetElement = printSheetRef.current;
    if (!targetElement) {
      toast.error('Checklist sheet is not ready to export yet.');
      return;
    }

    setIsExportingPdf(true);
    try {
      const loadedModule = await import('html2pdf.js');
      const html2pdf = resolveHtml2PdfFactory(loadedModule);
      if (!html2pdf) {
        throw new Error('PDF generator failed to initialize.');
      }

      const filename = `wingmacc-sunday-checklist-${formatLocalYmd()}.pdf`;
      await html2pdf()
        .set({
          margin: 10,
          filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(targetElement)
        .save();

      toast.success(`Downloaded ${filename}.`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to generate PDF checklist.';
      toast.error(message);
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-block rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
            Sunday Ops
          </span>
          <h1 className="font-display mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Sunday Checklist
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {canCheck
              ? 'Tap through live Sunday equipment verification or export a clean printable sheet.'
              : 'View-only printable and PDF equipment checklist for Sunday preparation.'}
          </p>
        </div>
      </div>

      {isLoading && items.length === 0 ? (
        <div
          role="status"
          className="no-print flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-8 text-muted-foreground shadow-card"
        >
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
          <span className="font-mono text-xs uppercase tracking-wider">
            Loading Sunday checklist...
          </span>
        </div>
      ) : isError ? (
        <div
          role="alert"
          className="no-print flex flex-col items-start justify-between gap-4 rounded-xl border border-destructive/40 bg-destructive/10 p-6 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <p className="font-semibold text-foreground">
                Unable to load Sunday checklist
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {error?.message ?? 'An unexpected error occurred while fetching inventory.'}
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>Retry</span>
          </Button>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList className="no-print">
            {canCheck && (
              <TabsTrigger value="live">
                <ClipboardCheck className="size-4" aria-hidden="true" />
                <span>Live Check-Off</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="print">
              <Printer className="size-4" aria-hidden="true" />
              <span>Print / PDF Checklist</span>
            </TabsTrigger>
          </TabsList>

          {canCheck && (
            <TabsContent value="live" className="no-print space-y-5">
              <ChecklistProgressCard
                progress={overallProgress}
                flaggedCount={flaggedCount}
                filteredCount={liveFilteredItems.length}
                totalCount={items.length}
                hasActiveFilters={hasLiveFilters}
              />

              <ChecklistCategoryLocationControls
                topCategories={topCategories}
                sortedLocations={sortedLocations}
                selectedCategoryId={selectedCategoryId}
                selectedLocationId={selectedLocationId}
                onCategoryChange={setSelectedCategoryId}
                onLocationChange={setSelectedLocationId}
                hasActiveFilters={hasLiveFilters}
                onClearFilters={handleClearLiveFilters}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                uncheckedOnly={uncheckedOnly}
                onToggleUncheckedOnly={() => setUncheckedOnly((prev) => !prev)}
                showLiveControls
              />

              <LiveChecklistGroups
                groups={liveGroups}
                categories={categories}
                locations={locations}
                checkingItemId={checkingItemId}
                isChecking={isChecking}
                onQuickCheck={handleQuickCheck}
                hasActiveFilters={hasLiveFilters}
                onClearFilters={handleClearLiveFilters}
              />
            </TabsContent>
          )}

          <TabsContent value="print" className="space-y-4">
            <ChecklistCategoryLocationControls
              className="no-print print-actions"
              topCategories={topCategories}
              sortedLocations={sortedLocations}
              selectedCategoryId={selectedCategoryId}
              selectedLocationId={selectedLocationId}
              onCategoryChange={setSelectedCategoryId}
              onLocationChange={setSelectedLocationId}
              hasActiveFilters={hasPrintFilters}
              onClearFilters={handleClearPrintFilters}
              actions={
                <>
                  <Button type="button" variant="outline" onClick={handlePrint}>
                    <Printer className="size-4" aria-hidden="true" />
                    <span>Print Checklist</span>
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleDownloadPdf()}
                    disabled={isExportingPdf}
                  >
                    {isExportingPdf ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <FileDown className="size-4" aria-hidden="true" />
                    )}
                    <span>{isExportingPdf ? 'Generating PDF...' : 'Download PDF'}</span>
                  </Button>
                </>
              }
            />

            <PrintChecklistSheet
              groups={printableGroups}
              totalItems={printableItems.length}
              totalUnits={totalPrintUnits}
              filterSummary={printFilterSummary}
              sheetRef={printSheetRef}
            />
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}
