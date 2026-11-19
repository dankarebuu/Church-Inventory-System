import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { createHistoryId, trimOrNull } from '@/lib/utils';
import type {
  Database,
  HistoryEntry,
  ImportHistoryPayload,
  InventoryItem,
  LoanHistoryPayload,
} from '@/types/database';

const EMPTY_HISTORY: HistoryEntry[] = [];
const HISTORY_FETCH_LIMIT = 200;

type HistoryInsert = Database['public']['Tables']['history_log']['Insert'];
type InventoryUpdate = Database['public']['Tables']['inventory']['Update'];

const MUTABLE_INVENTORY_FIELDS = [
  'category',
  'category_id',
  'subcategory_id',
  'item',
  'brand',
  'qty',
  'condition',
  'owner',
  'location',
  'location_id',
  'checkedBy',
  'dateChecked',
  'checked_at',
  'remarks',
  'borrower',
  'returnDate',
  'serial',
  'description',
  'image_filename',
  'deleted_at',
] as const satisfies ReadonlyArray<keyof InventoryUpdate>;

/**
 * Extracts only mutable `public.inventory` columns from a snapshot, explicitly
 * stripping server-managed (`id`, `created_at`, `updated_at`) and view-only
 * (`qty_on_loan`, `available_qty`, `activeLoans`) fields while keeping `qty = 0`.
 */
export function sanitizeMutableInventoryFields(raw: unknown): InventoryUpdate {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }

  const source = raw as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const key of MUTABLE_INVENTORY_FIELDS) {
    if (key in source && source[key] !== undefined) {
      sanitized[key] = source[key];
    }
  }

  return sanitized as InventoryUpdate;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function resolveTargetItemId(entry: HistoryEntry): string | null {
  if (typeof entry.item_id === 'string' && entry.item_id.trim() && entry.item_id !== 'batch_import') {
    return entry.item_id.trim();
  }
  const itemData = asRecord(entry.item_data);
  if (itemData && typeof itemData.id === 'string' && itemData.id.trim()) {
    return itemData.id.trim();
  }
  const prevData = asRecord(entry.prev_data);
  if (prevData && typeof prevData.id === 'string' && prevData.id.trim()) {
    return prevData.id.trim();
  }
  return null;
}

export function resolveHistoryItemName(entry: HistoryEntry): string {
  if (entry.action === 'import') {
    return 'Batch Import';
  }
  const itemData = asRecord(entry.item_data);
  if (itemData && typeof itemData.item === 'string' && itemData.item.trim()) {
    return itemData.item.trim();
  }
  const prevData = asRecord(entry.prev_data);
  if (prevData && typeof prevData.item === 'string' && prevData.item.trim()) {
    return prevData.item.trim();
  }
  return entry.item_id ? `Item ${entry.item_id}` : 'Equipment Item';
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

/**
 * Formats a concise human-readable description of a `history_log` entry.
 */
export function describeHistoryEntry(entry: HistoryEntry): string {
  const itemData = asRecord(entry.item_data);
  const prevData = asRecord(entry.prev_data);

  switch (entry.action) {
    case 'added': {
      const qty = itemData?.qty;
      return typeof qty === 'number' ? `Added to inventory (Qty ${qty})` : 'Added to inventory';
    }
    case 'deleted':
      return 'Moved to Trash';
    case 'restored':
      return 'Restored from Trash';
    case 'checked': {
      const condition =
        typeof itemData?.condition === 'string' ? itemData.condition.toUpperCase() : 'WORKING';
      return `Verified Sunday check-off (${condition})`;
    }
    case 'import': {
      const payload = (itemData ?? {}) as Partial<ImportHistoryPayload>;
      const insertedCount = Array.isArray(payload.insertedIds) ? payload.insertedIds.length : 0;
      const updatedCount = Array.isArray(payload.updatedItems) ? payload.updatedItems.length : 0;
      return `Imported ${insertedCount} added, ${updatedCount} updated`;
    }
    case 'loan': {
      const payload = (itemData ?? {}) as Partial<LoanHistoryPayload>;
      const qty = typeof payload.qty_loaned === 'number' ? payload.qty_loaned : 1;
      const borrower = trimOrNull(payload.borrower_name) ?? 'Borrower';
      return payload.actionType === 'return'
        ? `Returned ${qty} × from ${borrower}`
        : `Checked out ${qty} × to ${borrower}`;
    }
    case 'updated': {
      if (!prevData || !itemData) return 'Item details updated';
      const changes: string[] = [];
      if (prevData.item !== itemData.item) {
        changes.push(`Renamed to "${formatFieldValue(itemData.item)}"`);
      }
      if (prevData.condition !== itemData.condition) {
        changes.push(`Condition -> ${String(itemData.condition ?? '').toUpperCase()}`);
      }
      if (prevData.qty !== itemData.qty) {
        changes.push(`Qty ${formatFieldValue(prevData.qty)} -> ${formatFieldValue(itemData.qty)}`);
      }
      if (prevData.category !== itemData.category) {
        changes.push(`Category -> ${formatFieldValue(itemData.category)}`);
      }
      if (prevData.location !== itemData.location) {
        changes.push(`Location -> ${formatFieldValue(itemData.location)}`);
      }
      if (prevData.owner !== itemData.owner) {
        changes.push(`Owner -> ${formatFieldValue(itemData.owner)}`);
      }
      if (prevData.remarks !== itemData.remarks) {
        changes.push('Remarks updated');
      }
      return changes.length > 0 ? changes.join(' · ') : 'Item details updated';
    }
  }
}

export interface UndoHistoryParams {
  entry: HistoryEntry;
  currentItem?: InventoryItem | EnrichedInventoryItem | null;
}

export type UndoHistoryInput = HistoryEntry | UndoHistoryParams;

function isUndoHistoryParams(input: UndoHistoryInput): input is UndoHistoryParams {
  return typeof input === 'object' && input !== null && 'entry' in input;
}

async function fetchHistoryLog(): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from('history_log')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(HISTORY_FETCH_LIMIT);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

/**
 * Role-isolated audit history hook (`member` & `admin` read; `admin` only
 * for Undo & Restore mutations with strict mutable-field sanitization).
 */
export function useActivityLog(enabled: boolean) {
  const { role, user, profile } = useAuth();
  const queryClient = useQueryClient();

  const canReadHistory =
    enabled && isSupabaseConfigured && (role === 'member' || role === 'admin');

  const query = useQuery<HistoryEntry[], Error>({
    queryKey: queryKeys.history,
    queryFn: fetchHistoryLog,
    enabled: canReadHistory,
  });

  const assertCanAdminMutate = useCallback(() => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured.');
    }
    if (role !== 'admin') {
      throw new Error('Only administrators can undo or restore activity log changes.');
    }
  }, [role]);

  const invalidateRelated = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory(role) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.history }),
    ]);
  }, [queryClient, role]);

  const executeRestoreDeletedItem = useCallback(
    async (entry: HistoryEntry) => {
      if (entry.undone) {
        throw new Error('This entry has already been restored or undone.');
      }
      if (entry.action !== 'deleted') {
        throw new Error('Only deleted item entries can be restored.');
      }

      const itemId = resolveTargetItemId(entry);
      if (!itemId) {
        throw new Error('Unable to identify the deleted item to restore.');
      }

      const nowIso = new Date().toISOString();
      const actorEmail = user?.email ?? profile?.email ?? 'unknown';

      const { error: restoreError } = await supabase
        .from('inventory')
        .update({ deleted_at: null })
        .eq('id', itemId);

      if (restoreError) {
        throw new Error(restoreError.message);
      }

      const { error: markUndoneError } = await supabase
        .from('history_log')
        .update({ undone: true })
        .eq('id', entry.id);

      if (markUndoneError) {
        throw new Error(markUndoneError.message);
      }

      const snapshotSource = entry.prev_data ?? entry.item_data;
      const sanitizedSnapshot = sanitizeMutableInventoryFields(snapshotSource);
      const restoredPayload: Partial<InventoryItem> = {
        ...sanitizedSnapshot,
        id: itemId,
        deleted_at: null,
      };

      const restoredLog: HistoryInsert = {
        id: createHistoryId(),
        action: 'restored',
        item_id: itemId,
        item_data: restoredPayload,
        prev_data: null,
        user_email: actorEmail,
        undone: false,
        timestamp: nowIso,
      };

      const { error: logError } = await supabase
        .from('history_log')
        .insert([restoredLog]);

      if (logError) {
        throw new Error(logError.message);
      }

      await invalidateRelated();
    },
    [invalidateRelated, profile?.email, user?.email]
  );

  const restoreMutation = useMutation<void, Error, HistoryEntry>({
    mutationFn: async (entry) => {
      assertCanAdminMutate();
      await executeRestoreDeletedItem(entry);
    },
  });

  const undoMutation = useMutation<void, Error, UndoHistoryInput>({
    mutationFn: async (input) => {
      assertCanAdminMutate();

      const entry = isUndoHistoryParams(input) ? input.entry : input;
      if (entry.undone) {
        throw new Error('This history entry has already been undone.');
      }

      if (entry.action === 'deleted') {
        await executeRestoreDeletedItem(entry);
        return;
      }

      const nowIso = new Date().toISOString();
      const actorEmail = user?.email ?? profile?.email ?? 'unknown';

      if (entry.action === 'import') {
        const payload = asRecord(entry.item_data) as Partial<ImportHistoryPayload> | null;
        const insertedIds = Array.isArray(payload?.insertedIds)
          ? payload.insertedIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
          : [];
        const updatedItems = Array.isArray(payload?.updatedItems)
          ? payload.updatedItems
          : [];

        if (insertedIds.length > 0) {
          const { error: delErr } = await supabase
            .from('inventory')
            .update({ deleted_at: nowIso })
            .in('id', insertedIds);
          if (delErr) {
            throw new Error(delErr.message);
          }
        }

        for (const updated of updatedItems) {
          if (!updated || typeof updated.id !== 'string') continue;
          const sanitizedPrev = sanitizeMutableInventoryFields(updated.prev_data);
          if (Object.keys(sanitizedPrev).length === 0) continue;
          const { error: updErr } = await supabase
            .from('inventory')
            .update(sanitizedPrev)
            .eq('id', updated.id);
          if (updErr) {
            throw new Error(updErr.message);
          }
        }

        const { error: markErr } = await supabase
          .from('history_log')
          .update({ undone: true })
          .eq('id', entry.id);
        if (markErr) {
          throw new Error(markErr.message);
        }

        await invalidateRelated();
        return;
      }

      if (entry.action === 'added') {
        const itemId = resolveTargetItemId(entry);
        if (!itemId) {
          throw new Error('Unable to identify the added item to undo.');
        }

        const { error: softDelErr } = await supabase
          .from('inventory')
          .update({ deleted_at: nowIso })
          .eq('id', itemId);
        if (softDelErr) {
          throw new Error(softDelErr.message);
        }

        const { error: markErr } = await supabase
          .from('history_log')
          .update({ undone: true })
          .eq('id', entry.id);
        if (markErr) {
          throw new Error(markErr.message);
        }

        const prevSnapshot = sanitizeMutableInventoryFields(entry.item_data);
        const deleteLog: HistoryInsert = {
          id: createHistoryId(),
          action: 'deleted',
          item_id: itemId,
          item_data: { ...prevSnapshot, id: itemId, deleted_at: nowIso },
          prev_data: Object.keys(prevSnapshot).length > 0 ? { ...prevSnapshot, id: itemId } : null,
          user_email: actorEmail,
          undone: false,
          timestamp: nowIso,
        };

        const { error: logErr } = await supabase
          .from('history_log')
          .insert([deleteLog]);
        if (logErr) {
          throw new Error(logErr.message);
        }

        await invalidateRelated();
        return;
      }

      if (entry.action === 'updated' || entry.action === 'checked') {
        const itemId = resolveTargetItemId(entry);
        if (!itemId) {
          throw new Error('Unable to identify the equipment item to undo.');
        }

        const sanitizedPrev = sanitizeMutableInventoryFields(entry.prev_data);
        if (Object.keys(sanitizedPrev).length === 0) {
          throw new Error('Cannot undo because the previous item snapshot is missing.');
        }

        const { error: revertErr } = await supabase
          .from('inventory')
          .update(sanitizedPrev)
          .eq('id', itemId);
        if (revertErr) {
          throw new Error(revertErr.message);
        }

        const { error: markErr } = await supabase
          .from('history_log')
          .update({ undone: true })
          .eq('id', entry.id);
        if (markErr) {
          throw new Error(markErr.message);
        }

        const explicitCurrent = isUndoHistoryParams(input) ? input.currentItem : undefined;
        const cachedItems =
          queryClient.getQueryData<EnrichedInventoryItem[]>(queryKeys.inventory(role)) ?? [];
        const resolvedCurrent =
          explicitCurrent !== undefined
            ? explicitCurrent
            : cachedItems.find((item) => item.id === itemId) ?? null;

        const currentSnapshotSource = resolvedCurrent ?? entry.item_data ?? null;
        const sanitizedCurrent = currentSnapshotSource
          ? sanitizeMutableInventoryFields(currentSnapshotSource)
          : null;

        const undoLog: HistoryInsert = {
          id: createHistoryId(),
          action: 'updated',
          item_id: itemId,
          item_data: { ...sanitizedPrev, id: itemId },
          prev_data:
            sanitizedCurrent && Object.keys(sanitizedCurrent).length > 0
              ? { ...sanitizedCurrent, id: itemId }
              : null,
          user_email: actorEmail,
          undone: false,
          timestamp: nowIso,
        };

        const { error: logErr } = await supabase
          .from('history_log')
          .insert([undoLog]);
        if (logErr) {
          throw new Error(logErr.message);
        }

        await invalidateRelated();
        return;
      }

      throw new Error(`Undo is not supported for "${entry.action}" entries.`);
    },
  });

  const pendingEntryId = restoreMutation.isPending
    ? restoreMutation.variables?.id ?? null
    : undoMutation.isPending
      ? (isUndoHistoryParams(undoMutation.variables)
          ? undoMutation.variables.entry.id
          : undoMutation.variables?.id) ?? null
      : null;

  const { mutateAsync: runRestore } = restoreMutation;
  const { mutateAsync: runUndo } = undoMutation;

  const restoreDeletedItem = useCallback(
    (entry: HistoryEntry) => runRestore(entry),
    [runRestore]
  );

  const undoHistoryEntry = useCallback(
    (input: UndoHistoryInput) => runUndo(input),
    [runUndo]
  );

  return {
    entries: canReadHistory ? (query.data ?? EMPTY_HISTORY) : EMPTY_HISTORY,
    isLoading: canReadHistory ? query.isLoading : false,
    isError: canReadHistory ? query.isError : false,
    error: canReadHistory ? query.error : null,
    refetch: query.refetch,
    restoreDeletedItem,
    undoHistoryEntry,
    isRestoring: restoreMutation.isPending,
    isUndoing: undoMutation.isPending,
    pendingEntryId,
  };
}
