import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { OfflineNotice } from '@/components/layout/OfflineBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/features/auth/useAuth';
import {
  useInventoryItems,
  type EnrichedInventoryItem,
} from '@/features/inventory/useInventory';
import { CheckoutDialog } from '@/features/loans/CheckoutDialog';
import { isLoanOverdue } from '@/features/loans/schemas';
import { useLoans } from '@/features/loans/useLoans';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { cn, formatDisplayDate } from '@/lib/utils';
import type { LoanRecord } from '@/types/database';

type LoansTab = 'active' | 'returned';

const EMPTY_ITEMS: EnrichedInventoryItem[] = [];

function matchesLoanSearch(
  loan: LoanRecord,
  item: EnrichedInventoryItem | undefined,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) return true;
  const parts = [
    item?.item,
    item?.brand,
    item?.category,
    item?.serial,
    loan.borrower_name,
    loan.borrower_contact,
    loan.checked_out_by,
    loan.returned_by,
    loan.notes,
  ];
  const haystack = parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

/**
 * Equipment Loans & Check-Out / Check-In workspace route for Band Members and
 * Admins, featuring search, Active/Returned tabs, Overdue Only filter, and
 * one-click gear returns.
 */
export function LoansPage() {
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManageLoans = role === 'member' || role === 'admin';

  const activeTab: LoansTab =
    searchParams.get('tab') === 'returned' ? 'returned' : 'active';

  const [searchQuery, setSearchQuery] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [returningLoanId, setReturningLoanId] = useState<string | null>(null);
  const { isOffline } = useOnlineStatus();

  const {
    activeLoans,
    returnedLoans,
    isLoading: isLoadingLoans,
    isError: isLoansError,
    error: loansError,
    refetch: refetchLoans,
    checkoutItem,
    returnLoan,
    isCheckingOut,
  } = useLoans(canManageLoans);

  const {
    data: items = EMPTY_ITEMS,
    isLoading: isLoadingInventory,
    isError: isInventoryError,
    error: inventoryError,
    refetch: refetchInventory,
  } = useInventoryItems(role);

  const itemsById = useMemo(() => {
    const map = new Map<string, EnrichedInventoryItem>();
    for (const item of items) {
      map.set(item.id, item);
    }
    return map;
  }, [items]);

  const overdueCount = useMemo(
    () =>
      activeLoans.reduce(
        (count, loan) =>
          isLoanOverdue(loan.due_date, loan.returned_at) ? count + 1 : count,
        0
      ),
    [activeLoans]
  );

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredActiveLoans = useMemo(
    () =>
      activeLoans.filter((loan) => {
        if (overdueOnly && !isLoanOverdue(loan.due_date, loan.returned_at)) {
          return false;
        }
        return matchesLoanSearch(loan, itemsById.get(loan.item_id), normalizedSearch);
      }),
    [activeLoans, itemsById, normalizedSearch, overdueOnly]
  );

  const filteredReturnedLoans = useMemo(
    () =>
      returnedLoans.filter((loan) =>
        matchesLoanSearch(loan, itemsById.get(loan.item_id), normalizedSearch)
      ),
    [itemsById, normalizedSearch, returnedLoans]
  );

  const handleTabChange = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'returned') {
          next.set('tab', 'returned');
        } else {
          next.delete('tab');
        }
        return next;
      },
      { replace: true }
    );
  };

  const handleReturnGear = async (loan: LoanRecord) => {
    if (!canManageLoans || isOffline) return;
    const matchedItem = itemsById.get(loan.item_id);
    const itemName = matchedItem?.item ?? loan.item_id;

    setReturningLoanId(loan.id);
    try {
      await returnLoan({ loan, itemName });
      toast.success(
        `Returned ${loan.qty_loaned} × "${itemName}" from ${loan.borrower_name}.`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to return loaned gear.';
      toast.error(message);
    } finally {
      setReturningLoanId(null);
    }
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setOverdueOnly(false);
  };

  const isLoading = canManageLoans && (isLoadingLoans || isLoadingInventory);
  const isError = canManageLoans && (isLoansError || isInventoryError);
  const errorMessage =
    loansError?.message ??
    inventoryError?.message ??
    'Unable to load equipment loans.';

  const hasActiveFilters = Boolean(normalizedSearch) || overdueOnly;

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-block rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
            Gear Lending
          </span>
          <h1 className="font-display mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Loans & Check-Out
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track active equipment check-outs, due dates, overdue alerts, and gear returns.
          </p>
        </div>

        {canManageLoans && (
          <Button
            type="button"
            disabled={isOffline}
            onClick={() => !isOffline && setCheckoutOpen(true)}
          >
            <ArrowLeftRight className="size-4" aria-hidden="true" />
            <span>Check Out Gear</span>
          </Button>
        )}
      </div>

      {isOffline && canManageLoans && (
        <OfflineNotice message="Offline — equipment check-outs and gear returns are disabled until connection returns." />
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by item, borrower, contact, or notes..."
            aria-label="Search loans"
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'active' && (
            <Button
              type="button"
              size="sm"
              variant={overdueOnly ? 'destructive' : 'outline'}
              aria-pressed={overdueOnly}
              onClick={() => setOverdueOnly((prev) => !prev)}
              className="gap-1.5"
            >
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              <span>Overdue Only</span>
              {overdueCount > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold',
                    overdueOnly
                      ? 'bg-destructive-foreground/20 text-destructive-foreground'
                      : 'bg-destructive/15 text-destructive'
                  )}
                >
                  {overdueCount}
                </span>
              )}
            </Button>
          )}

          {hasActiveFilters && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleClearFilters}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden="true" />
              <span>Clear Filters</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main Content */}
      {isLoading ? (
        <div
          role="status"
          className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-8 text-muted-foreground shadow-card"
        >
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
          <span className="font-mono text-xs uppercase tracking-wider">
            Loading equipment loans...
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
              <p className="font-semibold text-foreground">Unable to load loans</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{errorMessage}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void Promise.all([refetchLoans(), refetchInventory()]);
            }}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>Retry</span>
          </Button>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList>
            <TabsTrigger value="active">
              <span>Active Loans</span>
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {activeLoans.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="returned">
              <span>Returned History</span>
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {returnedLoans.length}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Active Loans Tab */}
          <TabsContent value="active" className="space-y-4">
            {filteredActiveLoans.length === 0 ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-card">
                <ArrowLeftRight className="size-10 text-muted-foreground/60" aria-hidden="true" />
                <div className="space-y-1">
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    {hasActiveFilters
                      ? 'No active loans match your filters'
                      : 'No gear is currently checked out'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {hasActiveFilters
                      ? 'Try clearing your search or turning off the Overdue Only filter.'
                      : 'Use Check Out Gear to log a temporary borrower and due date.'}
                  </p>
                </div>
                {hasActiveFilters ? (
                  <Button type="button" variant="outline" onClick={handleClearFilters}>
                    Clear Filters
                  </Button>
                ) : (
                  canManageLoans && (
                    <Button
                      type="button"
                      disabled={isOffline}
                      onClick={() => !isOffline && setCheckoutOpen(true)}
                    >
                      <ArrowLeftRight className="size-4" aria-hidden="true" />
                      <span>Check Out Gear</span>
                    </Button>
                  )
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card shadow-card">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Equipment</TableHead>
                      <TableHead>Borrower</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Checked Out</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredActiveLoans.map((loan) => {
                      const item = itemsById.get(loan.item_id);
                      const itemName = item?.item ?? `Item ${loan.item_id}`;
                      const itemMeta = [item?.category, item?.brand]
                        .filter((part): part is string => Boolean(part && part.trim()))
                        .join(' · ');
                      const overdue = isLoanOverdue(loan.due_date, loan.returned_at);
                      const isRowReturning = returningLoanId === loan.id;

                      return (
                        <TableRow
                          key={loan.id}
                          className={cn(overdue && 'bg-destructive/5 hover:bg-destructive/10')}
                        >
                          <TableCell>
                            <div className="min-w-[160px]">
                              <Link
                                to={`/inventory?item=${encodeURIComponent(loan.item_id)}`}
                                className="font-semibold text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                              >
                                {itemName}
                              </Link>
                              {itemMeta && (
                                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                  {itemMeta}
                                </p>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="min-w-[160px]">
                              <p className="font-medium text-foreground">{loan.borrower_name}</p>
                              {loan.borrower_contact && (
                                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                  {loan.borrower_contact}
                                </p>
                              )}
                              {loan.notes && (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {loan.notes}
                                </p>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            <Badge variant="loaned">Qty {loan.qty_loaned}</Badge>
                          </TableCell>

                          <TableCell>
                            <div className="whitespace-nowrap text-xs">
                              <p className="font-medium text-foreground">
                                {formatDisplayDate(loan.checked_out_at)}
                              </p>
                              {loan.checked_out_by && (
                                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                  by {loan.checked_out_by}
                                </p>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
                              <span
                                className={cn(
                                  'text-xs font-medium',
                                  overdue ? 'text-destructive font-semibold' : 'text-foreground'
                                )}
                              >
                                {loan.due_date ? formatDisplayDate(loan.due_date) : 'No due date'}
                              </span>
                              {overdue && <Badge variant="repair">Overdue</Badge>}
                            </div>
                          </TableCell>

                          <TableCell className="text-right">
                            {canManageLoans && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={isRowReturning || isOffline}
                                onClick={() => void handleReturnGear(loan)}
                              >
                                {isRowReturning ? (
                                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  <RotateCcw className="size-3.5" aria-hidden="true" />
                                )}
                                <span>{isRowReturning ? 'Returning...' : 'Return Gear'}</span>
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Returned History Tab */}
          <TabsContent value="returned" className="space-y-4">
            {filteredReturnedLoans.length === 0 ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-card">
                <CheckCircle2 className="size-10 text-muted-foreground/60" aria-hidden="true" />
                <div className="space-y-1">
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    {normalizedSearch
                      ? 'No returned loans match your search'
                      : 'No returned loan history yet'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {normalizedSearch
                      ? 'Try clearing your search to view all past returns.'
                      : 'Completed equipment check-ins will appear here for auditing.'}
                  </p>
                </div>
                {normalizedSearch && (
                  <Button type="button" variant="outline" onClick={() => setSearchQuery('')}>
                    Clear Search
                  </Button>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card shadow-card">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Equipment</TableHead>
                      <TableHead>Borrower</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Checked Out</TableHead>
                      <TableHead>Returned</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReturnedLoans.map((loan) => {
                      const item = itemsById.get(loan.item_id);
                      const itemName = item?.item ?? `Item ${loan.item_id}`;
                      const itemMeta = [item?.category, item?.brand]
                        .filter((part): part is string => Boolean(part && part.trim()))
                        .join(' · ');

                      return (
                        <TableRow key={loan.id}>
                          <TableCell>
                            <div className="min-w-[160px]">
                              <Link
                                to={`/inventory?item=${encodeURIComponent(loan.item_id)}`}
                                className="font-semibold text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                              >
                                {itemName}
                              </Link>
                              {itemMeta && (
                                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                  {itemMeta}
                                </p>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="min-w-[160px]">
                              <p className="font-medium text-foreground">{loan.borrower_name}</p>
                              {loan.borrower_contact && (
                                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                  {loan.borrower_contact}
                                </p>
                              )}
                              {loan.notes && (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {loan.notes}
                                </p>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            <Badge variant="secondary">Qty {loan.qty_loaned}</Badge>
                          </TableCell>

                          <TableCell>
                            <div className="whitespace-nowrap text-xs">
                              <p className="font-medium text-foreground">
                                {formatDisplayDate(loan.checked_out_at)}
                              </p>
                              {loan.checked_out_by && (
                                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                  by {loan.checked_out_by}
                                </p>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="whitespace-nowrap text-xs">
                              <p className="font-medium text-foreground">
                                {formatDisplayDate(loan.returned_at)}
                              </p>
                              {loan.returned_by && (
                                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                  by {loan.returned_by}
                                </p>
                              )}
                            </div>
                          </TableCell>

                          <TableCell className="text-right">
                            <Badge variant="working">Returned</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {canManageLoans && (
        <CheckoutDialog
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          items={items}
          onCheckout={checkoutItem}
          isSubmitting={isCheckingOut}
          isOffline={isOffline}
        />
      )}
    </section>
  );
}
