import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  CheckCircle2,
  Edit2,
  Eye,
  History,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  UploadCloud,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  describeHistoryEntry,
  resolveHistoryItemName,
  useActivityLog,
} from '@/features/activity/useActivityLog';
import { useAuth } from '@/features/auth/useAuth';
import { cn, formatDisplayDate, getUserEmailPrefix } from '@/lib/utils';
import type { HistoryAction, HistoryEntry } from '@/types/database';

const ALL_ACTIONS = '__all__';

interface ActionDisplayMeta {
  label: string;
  icon: LucideIcon;
  badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline' | 'working' | 'repair' | 'missing' | 'loaned';
}

const ACTION_META: Record<HistoryAction, ActionDisplayMeta> = {
  added: {
    label: 'Added',
    icon: Plus,
    badgeVariant: 'working',
  },
  updated: {
    label: 'Updated',
    icon: Edit2,
    badgeVariant: 'outline',
  },
  checked: {
    label: 'Checked',
    icon: CheckCircle2,
    badgeVariant: 'working',
  },
  deleted: {
    label: 'Deleted',
    icon: Trash2,
    badgeVariant: 'repair',
  },
  restored: {
    label: 'Restored',
    icon: RotateCcw,
    badgeVariant: 'working',
  },
  import: {
    label: 'Import',
    icon: UploadCloud,
    badgeVariant: 'loaned',
  },
  loan: {
    label: 'Loan',
    icon: ArrowLeftRight,
    badgeVariant: 'loaned',
  },
};

const ACTION_FILTER_OPTIONS: ReadonlyArray<{ value: HistoryAction; label: string }> = [
  { value: 'added', label: 'Added' },
  { value: 'updated', label: 'Updated' },
  { value: 'checked', label: 'Checked' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'restored', label: 'Restored' },
  { value: 'import', label: 'Import' },
  { value: 'loan', label: 'Loan' },
];

function formatHistoryTimestamp(isoString: string): string {
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

function isUndoableEntry(entry: HistoryEntry): boolean {
  if (entry.undone) return false;
  if (entry.action === 'added' || entry.action === 'import') {
    return true;
  }
  if (entry.action === 'updated' || entry.action === 'checked') {
    return Boolean(
      entry.prev_data &&
        typeof entry.prev_data === 'object' &&
        Object.keys(entry.prev_data).length > 0
    );
  }
  return false;
}

/**
 * Searchable & filterable audit timeline for Band Members (`view only`) and
 * Admins (with safe Undo & soft-deleted item Restore controls).
 */
export function ActivityPage() {
  const { role } = useAuth();
  const canViewActivity = role === 'member' || role === 'admin';
  const canAdmin = role === 'admin';

  const {
    entries,
    isLoading,
    isError,
    error,
    refetch,
    restoreDeletedItem,
    undoHistoryEntry,
    pendingEntryId,
  } = useActivityLog(canViewActivity);

  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState<string>(ALL_ACTIONS);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (actionFilter !== ALL_ACTIONS && entry.action !== actionFilter) {
        return false;
      }

      if (normalizedSearch) {
        const itemName = resolveHistoryItemName(entry);
        const summary = describeHistoryEntry(entry);
        const actorPrefix = getUserEmailPrefix(entry.user_email);
        const haystack = [
          itemName,
          summary,
          entry.user_email,
          actorPrefix,
          entry.action,
        ]
          .join(' ')
          .toLowerCase();

        if (!haystack.includes(normalizedSearch)) {
          return false;
        }
      }

      return true;
    });
  }, [actionFilter, entries, normalizedSearch]);

  const hasActiveFilters = Boolean(normalizedSearch) || actionFilter !== ALL_ACTIONS;

  const handleClearFilters = () => {
    setSearchQuery('');
    setActionFilter(ALL_ACTIONS);
  };

  const handleRestore = async (entry: HistoryEntry) => {
    if (!canAdmin) return;
    const itemName = resolveHistoryItemName(entry);
    try {
      await restoreDeletedItem(entry);
      toast.success(`Restored "${itemName}" to active inventory.`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to restore inventory item.';
      toast.error(message);
    }
  };

  const handleUndo = async (entry: HistoryEntry) => {
    if (!canAdmin) return;
    const itemName = resolveHistoryItemName(entry);
    try {
      await undoHistoryEntry(entry);
      toast.success(
        entry.action === 'import'
          ? 'Reverted batch import changes.'
          : `Undid ${entry.action} on "${itemName}".`
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to undo activity log entry.';
      toast.error(message);
    }
  };

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-block rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
            Audit Trail
          </span>
          <h1 className="font-display mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Activity Log
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Searchable history of gear checks, edits, imports, loans, and trash restorations.
          </p>
        </div>

        {!canAdmin && (
          <Badge variant="outline" className="w-fit gap-1.5">
            <Eye className="size-3" aria-hidden="true" />
            <span>Read-Only (Admin Undo/Restore)</span>
          </Badge>
        )}
      </div>

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
            placeholder="Search by item, user email, borrower, or change..."
            aria-label="Search activity log"
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger aria-label="Filter by action" className="w-full sm:w-[180px]">
              <SelectValue placeholder="All Actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ACTIONS}>All Actions</SelectItem>
              {ACTION_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

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
            Loading activity log...
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
              <p className="font-semibold text-foreground">Unable to load activity log</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {error?.message ?? 'An unexpected error occurred while reading history_log.'}
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>Retry</span>
          </Button>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-card">
          <History className="size-10 text-muted-foreground/60" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="font-display text-lg font-semibold text-foreground">
              {hasActiveFilters
                ? 'No activity entries match your filters'
                : 'No activity recorded yet'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {hasActiveFilters
                ? 'Try clearing your search query or switching the action filter.'
                : 'Inventory edits, Sunday checks, loans, and imports will appear here.'}
            </p>
          </div>
          {hasActiveFilters && (
            <Button type="button" variant="outline" onClick={handleClearFilters}>
              Clear Filters
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEntries.map((entry) => {
            const meta = ACTION_META[entry.action];
            const ActionIcon = meta.icon;
            const itemName = resolveHistoryItemName(entry);
            const description = describeHistoryEntry(entry);
            const actorName = getUserEmailPrefix(entry.user_email);
            const isRowBusy = pendingEntryId === entry.id;
            const showRestore = canAdmin && !entry.undone && entry.action === 'deleted';
            const showUndo = canAdmin && isUndoableEntry(entry);
            const canLinkToItem =
              Boolean(entry.item_id) &&
              entry.item_id !== 'batch_import' &&
              entry.action !== 'deleted';

            return (
              <article
                key={entry.id}
                data-testid={`activity-entry-${entry.id}`}
                className={cn(
                  'flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card transition-opacity sm:flex-row sm:items-center sm:justify-between',
                  entry.undone && 'opacity-60'
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/60 text-foreground"
                  >
                    <ActionIcon className="size-4" />
                  </span>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
                      {entry.undone && <Badge variant="outline">Undone</Badge>}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {formatHistoryTimestamp(entry.timestamp)}
                      </span>
                    </div>

                    <div className="min-w-0">
                      {canLinkToItem && entry.item_id ? (
                        <Link
                          to={`/inventory?item=${encodeURIComponent(entry.item_id)}`}
                          className={cn(
                            'font-display text-base font-semibold text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded',
                            entry.undone && 'line-through'
                          )}
                        >
                          {itemName}
                        </Link>
                      ) : (
                        <p
                          className={cn(
                            'font-display text-base font-semibold text-foreground',
                            entry.undone && 'line-through'
                          )}
                        >
                          {itemName}
                        </p>
                      )}
                      <p
                        className={cn(
                          'text-sm text-muted-foreground',
                          entry.undone && 'line-through'
                        )}
                      >
                        {description}
                      </p>
                    </div>

                    <p className="font-mono text-[11px] text-muted-foreground">
                      by <span className="font-semibold text-foreground">{actorName}</span> (
                      {entry.user_email})
                    </p>
                  </div>
                </div>

                {(showRestore || showUndo) && (
                  <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                    {showRestore && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isRowBusy}
                        onClick={() => void handleRestore(entry)}
                      >
                        {isRowBusy ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <RotateCcw className="size-3.5" aria-hidden="true" />
                        )}
                        <span>{isRowBusy ? 'Restoring...' : 'Restore'}</span>
                      </Button>
                    )}

                    {showUndo && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isRowBusy}
                        onClick={() => void handleUndo(entry)}
                      >
                        {isRowBusy ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Undo2 className="size-3.5" aria-hidden="true" />
                        )}
                        <span>{isRowBusy ? 'Undoing...' : 'Undo'}</span>
                      </Button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
