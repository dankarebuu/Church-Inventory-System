import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';
import type { HistoryEntry, InventoryItem, UserRole } from '@/types/database';
import { describeHistoryEntry, useActivityLog } from './useActivityLog';

const {
  mockIsConfigured,
  mockAuthState,
  mockFrom,
  tableResults,
  insertCalls,
  updateCalls,
  updateInCalls,
  orderCalls,
  resetMocks,
} = vi.hoisted(() => {
  const configured = { value: true };
  const auth = {
    role: 'admin' as UserRole,
    user: { id: 'user-1', email: 'admin@wingmacc.org' },
    profile: {
      id: 'user-1',
      email: 'admin@wingmacc.org',
      first_name: 'Dan',
      last_name: 'Caleb',
      role: 'admin' as const,
      created_at: '2026-11-18T00:00:00.000Z',
    },
  };

  type TableResult = { data: unknown; error: { message: string } | null };
  const queryMap = new Map<string, TableResult>();
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    col: string;
    id: unknown;
  }> = [];
  const updatesIn: Array<{
    table: string;
    payload: Record<string, unknown>;
    col: string;
    ids: unknown[];
  }> = [];
  const orders: Array<{ table: string; column: string; ascending: boolean }> = [];

  const from = vi.fn((table: string) => {
    const getResult = (): TableResult => queryMap.get(table) ?? { data: [], error: null };

    const selectBuilder = {
      order: vi.fn((column: string, opts?: { ascending?: boolean }) => {
        orders.push({ table, column, ascending: opts?.ascending ?? true });
        return {
          limit: vi.fn(async () => getResult()),
          then: (
            onFulfilled: (value: TableResult) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => Promise.resolve(getResult()).then(onFulfilled, onRejected),
        };
      }),
      then: (
        onFulfilled: (value: TableResult) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise.resolve(getResult()).then(onFulfilled, onRejected),
    };

    const insertFn = vi.fn(async (payload: unknown) => {
      inserts.push({ table, payload });
      return getResult();
    });

    const updateFn = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn((col: string, id: unknown) => {
        updates.push({ table, payload, col, id });
        const resultPromise = Promise.resolve(getResult());
        return {
          is: vi.fn(async () => getResult()),
          then: (
            onFulfilled: (value: TableResult) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => resultPromise.then(onFulfilled, onRejected),
        };
      }),
      in: vi.fn((col: string, ids: unknown[]) => {
        updatesIn.push({ table, payload, col, ids });
        const resultPromise = Promise.resolve(getResult());
        return {
          is: vi.fn(async () => getResult()),
          then: (
            onFulfilled: (value: TableResult) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => resultPromise.then(onFulfilled, onRejected),
        };
      }),
    }));

    return {
      select: vi.fn(() => selectBuilder),
      insert: insertFn,
      update: updateFn,
    };
  });

  return {
    mockIsConfigured: configured,
    mockAuthState: auth,
    mockFrom: from,
    tableResults: queryMap,
    insertCalls: inserts,
    updateCalls: updates,
    updateInCalls: updatesIn,
    orderCalls: orders,
    resetMocks: () => {
      configured.value = true;
      auth.role = 'admin';
      auth.user = { id: 'user-1', email: 'admin@wingmacc.org' };
      auth.profile = {
        id: 'user-1',
        email: 'admin@wingmacc.org',
        first_name: 'Dan',
        last_name: 'Caleb',
        role: 'admin',
        created_at: '2026-11-18T00:00:00.000Z',
      };
      queryMap.clear();
      inserts.length = 0;
      updates.length = 0;
      updatesIn.length = 0;
      orders.length = 0;
    },
  };
});

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() {
    return mockIsConfigured.value;
  },
  supabase: {
    from: mockFrom,
  },
}));

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockAuthState,
}));

function makeHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'h_1',
    action: 'updated',
    item_id: 'item_1',
    item_data: {
      id: 'item_1',
      item: 'Snare Drum',
      category: 'Drums',
      qty: 2,
      condition: 'repair',
    },
    prev_data: {
      id: 'item_1',
      item: 'Snare Drum',
      category: 'Drums',
      qty: 0,
      condition: 'working',
    },
    user_email: 'admin@wingmacc.org',
    undone: false,
    timestamp: '2026-11-18T10:00:00.000Z',
    ...overrides,
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

describe('useActivityLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('never queries history_log when disabled or when role is guest', () => {
    const queryClient = createTestQueryClient();

    const disabledHook = renderHook(() => useActivityLog(false), {
      wrapper: createWrapper(queryClient),
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(disabledHook.result.current.entries).toEqual([]);
    expect(disabledHook.result.current.isLoading).toBe(false);

    mockAuthState.role = 'guest';
    const guestHook = renderHook(() => useActivityLog(true), {
      wrapper: createWrapper(queryClient),
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(guestHook.result.current.entries).toEqual([]);
  });

  it('blocks non-admin roles from restoreDeletedItem and undoHistoryEntry', async () => {
    mockAuthState.role = 'member';
    tableResults.set('history_log', { data: [], error: null });
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useActivityLog(true), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      result.current.restoreDeletedItem(
        makeHistoryEntry({ action: 'deleted', prev_data: { item: 'Snare' } })
      )
    ).rejects.toThrow(/admin/i);

    await expect(result.current.undoHistoryEntry(makeHistoryEntry())).rejects.toThrow(
      /admin/i
    );
    expect(updateCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it('queries history_log ordered descending by timestamp for member and admin', async () => {
    mockAuthState.role = 'member';
    const sample = makeHistoryEntry({ id: 'h_recent' });
    tableResults.set('history_log', { data: [sample], error: null });
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useActivityLog(true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });

    expect(mockFrom).toHaveBeenCalledWith('history_log');
    expect(orderCalls).toEqual([
      { table: 'history_log', column: 'timestamp', ascending: false },
    ]);
    expect(result.current.entries[0].id).toBe('h_recent');
  });

  it('undoHistoryEntry for updated entry sends only mutable fields (stripping id, created_at, updated_at) and handles missing currentItem safely', async () => {
    mockAuthState.role = 'admin';
    tableResults.set('history_log', { data: [], error: null });
    tableResults.set('inventory', { data: null, error: null });

    const queryClient = createTestQueryClient();
    // Explicitly ensure inventory cache has NO matching currentItem
    queryClient.setQueryData(queryKeys.inventory('admin'), []);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => useActivityLog(true), {
      wrapper: createWrapper(queryClient),
    });

    const entry = makeHistoryEntry({
      id: 'h_upd_1',
      action: 'updated',
      item_id: 'item_missing_from_cache',
      item_data: {
        id: 'item_missing_from_cache',
        item: 'New Snare Name',
        condition: 'repair',
        qty: 2,
      },
      prev_data: {
        id: 'item_missing_from_cache',
        created_at: '2026-11-01T00:00:00.000Z',
        updated_at: '2026-11-10T00:00:00.000Z',
        qty_on_loan: 1,
        available_qty: 0,
        activeLoans: [],
        item: 'Original Snare Name',
        category: 'Drums',
        qty: 0,
        condition: 'working',
        remarks: 'Before edit',
      } as Partial<InventoryItem> & Record<string, unknown>,
    });

    await act(async () => {
      await result.current.undoHistoryEntry(entry);
    });

    const invUpdate = updateCalls.find((call) => call.table === 'inventory');
    expect(invUpdate).toBeDefined();
    expect(invUpdate?.id).toBe('item_missing_from_cache');
    expect(invUpdate?.payload).toEqual({
      item: 'Original Snare Name',
      category: 'Drums',
      qty: 0,
      condition: 'working',
      remarks: 'Before edit',
    });
    expect('id' in (invUpdate?.payload ?? {})).toBe(false);
    expect('created_at' in (invUpdate?.payload ?? {})).toBe(false);
    expect('updated_at' in (invUpdate?.payload ?? {})).toBe(false);
    expect('qty_on_loan' in (invUpdate?.payload ?? {})).toBe(false);
    expect('available_qty' in (invUpdate?.payload ?? {})).toBe(false);
    expect('activeLoans' in (invUpdate?.payload ?? {})).toBe(false);

    const histUpdate = updateCalls.find((call) => call.table === 'history_log');
    expect(histUpdate).toEqual({
      table: 'history_log',
      col: 'id',
      id: 'h_upd_1',
      payload: { undone: true },
    });

    const histInsert = insertCalls.find((call) => call.table === 'history_log');
    expect(histInsert).toBeDefined();
    const insertedRow = (histInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(insertedRow.action).toBe('updated');
    expect(insertedRow.item_id).toBe('item_missing_from_cache');
    expect(insertedRow.user_email).toBe('admin@wingmacc.org');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });

  it('restoreDeletedItem sets deleted_at: null, marks entry undone, logs restored, and invalidates caches', async () => {
    mockAuthState.role = 'admin';
    tableResults.set('history_log', { data: [], error: null });
    tableResults.set('inventory', { data: null, error: null });

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => useActivityLog(true), {
      wrapper: createWrapper(queryClient),
    });

    const deletedEntry = makeHistoryEntry({
      id: 'h_del_1',
      action: 'deleted',
      item_id: 'item_del_9',
      item_data: {
        id: 'item_del_9',
        item: 'Cajon',
        category: 'Drums',
        qty: 1,
        condition: 'working',
        deleted_at: '2026-11-18T11:00:00.000Z',
      },
      prev_data: {
        id: 'item_del_9',
        item: 'Cajon',
        category: 'Drums',
        qty: 1,
        condition: 'working',
        deleted_at: null,
      },
    });

    await act(async () => {
      await result.current.restoreDeletedItem(deletedEntry);
    });

    const invUpdate = updateCalls.find((call) => call.table === 'inventory');
    expect(invUpdate).toBeDefined();
    expect(invUpdate?.id).toBe('item_del_9');
    expect(invUpdate?.payload.deleted_at).toBeNull();

    const histUpdate = updateCalls.find((call) => call.table === 'history_log');
    expect(histUpdate).toEqual({
      table: 'history_log',
      col: 'id',
      id: 'h_del_1',
      payload: { undone: true },
    });

    const histInsert = insertCalls.find((call) => call.table === 'history_log');
    expect(histInsert).toBeDefined();
    const restoredRow = (histInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(restoredRow.action).toBe('restored');
    expect(restoredRow.item_id).toBe('item_del_9');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });

  it('undoHistoryEntry reverses import entries cleanly by closing active loans on insertedIds, soft-deleting insertedIds, reverting updatedItems, and invalidating loans', async () => {
    mockAuthState.role = 'admin';
    tableResults.set('history_log', { data: [], error: null });
    tableResults.set('inventory', { data: null, error: null });
    tableResults.set('loans', { data: null, error: null });
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => useActivityLog(true), {
      wrapper: createWrapper(queryClient),
    });

    const importEntry = makeHistoryEntry({
      id: 'h_imp_1',
      action: 'import',
      item_id: 'batch_import',
      item_data: {
        insertedIds: ['item_new_1', 'item_new_2'],
        updatedItems: [
          {
            id: 'item_old_1',
            prev_data: {
              id: 'item_old_1',
              created_at: '2026-11-01T00:00:00.000Z',
              updated_at: '2026-11-05T00:00:00.000Z',
              item: 'Previous Cable',
              qty: 0,
            } as Partial<InventoryItem> & Record<string, unknown>,
          },
        ],
      },
      prev_data: null,
    });

    await act(async () => {
      await result.current.undoHistoryEntry(importEntry);
    });

    const loanCloseIn = updateInCalls.find((call) => call.table === 'loans');
    expect(loanCloseIn).toBeDefined();
    expect(loanCloseIn?.col).toBe('item_id');
    expect(loanCloseIn?.ids).toEqual(['item_new_1', 'item_new_2']);
    expect(typeof loanCloseIn?.payload.returned_at).toBe('string');
    expect(loanCloseIn?.payload.returned_by).toBe('Dan Caleb');

    const invDelIn = updateInCalls.find((call) => call.table === 'inventory');
    expect(invDelIn).toBeDefined();
    expect(invDelIn?.ids).toEqual(['item_new_1', 'item_new_2']);
    expect(typeof invDelIn?.payload.deleted_at).toBe('string');

    const revertedOld = updateCalls.find(
      (call) => call.table === 'inventory' && call.id === 'item_old_1'
    );
    expect(revertedOld?.payload).toEqual({
      item: 'Previous Cable',
      qty: 0,
    });
    expect('id' in (revertedOld?.payload ?? {})).toBe(false);
    expect('updated_at' in (revertedOld?.payload ?? {})).toBe(false);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.loans });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });

  it('undoHistoryEntry reverses added entries by closing active loans on item_id, soft-deleting the item, logging deleted, and invalidating loans', async () => {
    mockAuthState.role = 'admin';
    tableResults.set('history_log', { data: [], error: null });
    tableResults.set('inventory', { data: null, error: null });
    tableResults.set('loans', { data: null, error: null });
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => useActivityLog(true), {
      wrapper: createWrapper(queryClient),
    });

    const addedEntry = makeHistoryEntry({
      id: 'h_add_1',
      action: 'added',
      item_id: 'item_added_1',
      item_data: {
        id: 'item_added_1',
        item: 'New Mic',
        category: 'Spares & Shared',
        qty: 1,
        condition: 'working',
      },
      prev_data: null,
    });

    await act(async () => {
      await result.current.undoHistoryEntry(addedEntry);
    });

    const loanClose = updateCalls.find(
      (call) => call.table === 'loans' && call.id === 'item_added_1'
    );
    expect(loanClose).toBeDefined();
    expect(loanClose?.col).toBe('item_id');
    expect(typeof loanClose?.payload.returned_at).toBe('string');
    expect(loanClose?.payload.returned_by).toBe('Dan Caleb');

    const invUpdate = updateCalls.find(
      (call) => call.table === 'inventory' && call.id === 'item_added_1'
    );
    expect(typeof invUpdate?.payload.deleted_at).toBe('string');

    const histInsert = insertCalls.find((call) => call.table === 'history_log');
    const row = (histInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(row.action).toBe('deleted');
    expect(row.item_id).toBe('item_added_1');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.loans });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });

  it('undoHistoryEntry reverses checked entries safely stripping server columns', async () => {
    mockAuthState.role = 'admin';
    tableResults.set('history_log', { data: [], error: null });
    tableResults.set('inventory', { data: null, error: null });
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useActivityLog(true), {
      wrapper: createWrapper(queryClient),
    });

    const checkedEntry = makeHistoryEntry({
      id: 'h_chk_1',
      action: 'checked',
      item_id: 'item_chk_1',
      item_data: {
        id: 'item_chk_1',
        condition: 'working',
        checkedBy: 'Dan Caleb',
        dateChecked: 'November 19, 2026',
      },
      prev_data: {
        id: 'item_chk_1',
        created_at: '2026-11-01T00:00:00.000Z',
        updated_at: '2026-11-12T00:00:00.000Z',
        condition: 'working',
        checkedBy: 'Eli Cruz',
        dateChecked: 'November 12, 2026',
      } as Partial<InventoryItem> & Record<string, unknown>,
    });

    await act(async () => {
      await result.current.undoHistoryEntry(checkedEntry);
    });

    const invUpdate = updateCalls.find(
      (call) => call.table === 'inventory' && call.id === 'item_chk_1'
    );
    expect(invUpdate?.payload).toEqual({
      condition: 'working',
      checkedBy: 'Eli Cruz',
      dateChecked: 'November 12, 2026',
    });
    expect('id' in (invUpdate?.payload ?? {})).toBe(false);
    expect('created_at' in (invUpdate?.payload ?? {})).toBe(false);
    expect('updated_at' in (invUpdate?.payload ?? {})).toBe(false);
  });

  it('describeHistoryEntry returns safe fallback descriptions for unknown or null legacy action values', () => {
    expect(
      describeHistoryEntry(
        makeHistoryEntry({
          action: 'legacy_edit' as unknown as HistoryEntry['action'],
        })
      )
    ).toBe('Recorded legacy_edit action');

    expect(
      describeHistoryEntry(
        makeHistoryEntry({
          action: null as unknown as HistoryEntry['action'],
        })
      )
    ).toBe('Recorded activity action');
  });
});
