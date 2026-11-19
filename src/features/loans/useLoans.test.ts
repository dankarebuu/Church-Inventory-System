import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { queryKeys } from '@/lib/queryKeys';
import type { LoanRecord, UserRole } from '@/types/database';
import { useLoanMutations, useLoans } from './useLoans';

const {
  mockIsConfigured,
  mockAuthState,
  mockFrom,
  tableResults,
  insertCalls,
  updateCalls,
  orderCalls,
  resetMocks,
} = vi.hoisted(() => {
  const configured = { value: true };
  const auth = {
    role: 'member' as UserRole,
    user: { id: 'user-1', email: 'dan@wingmacc.org' },
    profile: {
      id: 'user-1',
      email: 'dan@wingmacc.org',
      first_name: 'Dan',
      last_name: 'Caleb',
      role: 'member' as const,
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
  const orders: Array<{ table: string; column: string; ascending: boolean }> = [];

  const from = vi.fn((table: string) => {
    const getResult = (): TableResult => queryMap.get(table) ?? { data: [], error: null };

    const selectBuilder = {
      order: vi.fn((column: string, opts?: { ascending?: boolean }) => {
        orders.push({ table, column, ascending: opts?.ascending ?? true });
        return Promise.resolve(getResult());
      }),
      then: (
        onFulfilled: (value: TableResult) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise.resolve(getResult()).then(onFulfilled, onRejected),
    };

    const insertFn = vi.fn((payload: unknown) => {
      inserts.push({ table, payload });
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => getResult()),
        })),
        then: (
          onFulfilled: (value: TableResult) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => Promise.resolve(getResult()).then(onFulfilled, onRejected),
      };
    });

    const updateFn = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn((col: string, id: unknown) => {
        updates.push({ table, payload, col, id });
        const resultBuilder = {
          select: vi.fn(() => ({
            single: vi.fn(async () => getResult()),
            maybeSingle: vi.fn(async () => getResult()),
          })),
          then: (
            onFulfilled: (value: TableResult) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => Promise.resolve(getResult()).then(onFulfilled, onRejected),
        };
        return {
          ...resultBuilder,
          is: vi.fn(() => resultBuilder),
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
    orderCalls: orders,
    resetMocks: () => {
      configured.value = true;
      auth.role = 'member';
      auth.user = { id: 'user-1', email: 'dan@wingmacc.org' };
      auth.profile = {
        id: 'user-1',
        email: 'dan@wingmacc.org',
        first_name: 'Dan',
        last_name: 'Caleb',
        role: 'member',
        created_at: '2026-11-18T00:00:00.000Z',
      };
      queryMap.clear();
      inserts.length = 0;
      updates.length = 0;
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

function makeLoan(overrides: Partial<LoanRecord> = {}): LoanRecord {
  return {
    id: 'loan-1',
    item_id: 'item-snare',
    borrower_name: 'Joel Santos',
    borrower_contact: '09171234567',
    qty_loaned: 1,
    checked_out_at: '2026-11-15T10:00:00.000Z',
    due_date: '2026-11-22',
    returned_at: null,
    checked_out_by: 'Dan Caleb',
    returned_by: null,
    notes: 'Youth camp',
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

describe('useLoans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('never queries loans when disabled or when current role is guest', () => {
    const queryClient = createTestQueryClient();

    const disabledHook = renderHook(() => useLoans(false), {
      wrapper: createWrapper(queryClient),
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(disabledHook.result.current.isLoading).toBe(false);
    expect(disabledHook.result.current.activeLoans).toEqual([]);
    expect(disabledHook.result.current.returnedLoans).toEqual([]);

    mockAuthState.role = 'guest';
    const guestHook = renderHook(() => useLoans(true), {
      wrapper: createWrapper(queryClient),
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(guestHook.result.current.activeLoans).toEqual([]);
    expect(guestHook.result.current.returnedLoans).toEqual([]);
  });

  it('queries loans ordered by checked_out_at descending and separates activeLoans and returnedLoans', async () => {
    const active = makeLoan({ id: 'loan-active', returned_at: null });
    const returned = makeLoan({
      id: 'loan-returned',
      returned_at: '2026-11-17T12:00:00.000Z',
      returned_by: 'Dan Caleb',
    });

    tableResults.set('loans', { data: [active, returned], error: null });
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useLoans(true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.activeLoans).toHaveLength(1);
    });

    expect(mockFrom).toHaveBeenCalledWith('loans');
    expect(orderCalls).toEqual([
      { table: 'loans', column: 'checked_out_at', ascending: false },
    ]);
    expect(result.current.activeLoans.map((l) => l.id)).toEqual(['loan-active']);
    expect(result.current.returnedLoans.map((l) => l.id)).toEqual(['loan-returned']);
  });
});

describe('useLoanMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('blocks Guests in JS before touching Supabase on checkoutItem and returnLoan', async () => {
    mockAuthState.role = 'guest';
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useLoanMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      result.current.checkoutItem({
        item_id: 'item-snare',
        itemName: 'Pearl Brass Snare',
        maxAvailableQty: 2,
        borrower_name: 'Joel Santos',
        qty_loaned: 1,
      })
    ).rejects.toThrow(/member|admin/i);

    await expect(result.current.returnLoan(makeLoan())).rejects.toThrow(/member|admin/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('validates quantity bounds, inserts loan + history_log entry, and invalidates loans, inventory, and history queries', async () => {
    mockAuthState.role = 'member';
    const insertedLoan = makeLoan({
      id: 'loan-new-uuid',
      item_id: 'item-snare',
      borrower_name: 'Joel Santos',
      qty_loaned: 2,
      due_date: '2026-11-25',
    });
    tableResults.set('loans', { data: insertedLoan, error: null });
    tableResults.set('history_log', { data: null, error: null });

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => useLoanMutations(), {
      wrapper: createWrapper(queryClient),
    });

    // Rejects qty_loaned > maxAvailableQty before hitting Supabase
    await expect(
      result.current.checkoutItem({
        item_id: 'item-snare',
        itemName: 'Pearl Brass Snare',
        maxAvailableQty: 2,
        borrower_name: 'Joel Santos',
        qty_loaned: 3,
      })
    ).rejects.toThrow(/exceed|available/i);
    expect(mockFrom).not.toHaveBeenCalled();

    await result.current.checkoutItem({
      item_id: 'item-snare',
      itemName: 'Pearl Brass Snare',
      maxAvailableQty: 2,
      borrower_name: '  Joel Santos  ',
      borrower_contact: ' 09171234567 ',
      qty_loaned: 2,
      due_date: '2026-11-25',
      notes: 'Youth camp',
    });

    const loanInsert = insertCalls.find((c) => c.table === 'loans');
    expect(loanInsert).toBeDefined();
    const loanRow = (loanInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(loanRow.item_id).toBe('item-snare');
    expect(loanRow.borrower_name).toBe('Joel Santos');
    expect(loanRow.borrower_contact).toBe('09171234567');
    expect(loanRow.qty_loaned).toBe(2);
    expect(loanRow.due_date).toBe('2026-11-25');
    expect(loanRow.checked_out_by).toBe('Dan Caleb');

    const histInsert = insertCalls.find((c) => c.table === 'history_log');
    expect(histInsert).toBeDefined();
    const histRow = (histInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(histRow.action).toBe('loan');
    expect(histRow.item_id).toBe('item-snare');
    expect(histRow.user_email).toBe('dan@wingmacc.org');
    expect(histRow.undone).toBe(false);
    expect(histRow.item_data).toEqual(
      expect.objectContaining({
        actionType: 'checkout',
        item: 'Pearl Brass Snare',
        borrower_name: 'Joel Santos',
        qty_loaned: 2,
        due_date: '2026-11-25',
      })
    );

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.loans });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('member') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });

  it('updates loan with returned_at + returned_by on returnLoan, resolves item name from cache, writes history_log, and invalidates queries', async () => {
    mockAuthState.role = 'admin';
    const loan = makeLoan({
      id: 'loan-99',
      item_id: 'item-snare',
      borrower_name: 'Joel Santos',
      qty_loaned: 1,
      due_date: '2026-11-17',
    });
    tableResults.set('loans', {
      data: { ...loan, returned_at: '2026-11-18T12:00:00.000Z', returned_by: 'Dan Caleb' },
      error: null,
    });
    tableResults.set('history_log', { data: null, error: null });

    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.inventory('admin'), [
      { id: 'item-snare', item: 'Pearl Brass Snare' } as EnrichedInventoryItem,
    ]);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => useLoanMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.returnLoan(loan);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe('loans');
    expect(updateCalls[0].id).toBe('loan-99');
    expect(typeof updateCalls[0].payload.returned_at).toBe('string');
    expect(updateCalls[0].payload.returned_by).toBe('Dan Caleb');

    const histInsert = insertCalls.find((c) => c.table === 'history_log');
    expect(histInsert).toBeDefined();
    const histRow = (histInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(histRow.action).toBe('loan');
    expect(histRow.item_id).toBe('item-snare');
    expect(histRow.undone).toBe(false);
    expect(histRow.item_data).toEqual(
      expect.objectContaining({
        actionType: 'return',
        item: 'Pearl Brass Snare',
        borrower_name: 'Joel Santos',
        qty_loaned: 1,
      })
    );

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.loans });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });

  it('guards against concurrent returnLoan races when no unreturned row matches, invalidates loans/inventory, and skips duplicate history_log', async () => {
    mockAuthState.role = 'member';
    const loan = makeLoan({
      id: 'loan-race-1',
      item_id: 'item-snare',
      returned_at: null,
    });
    tableResults.set('loans', {
      data: null,
      error: null,
    });

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => useLoanMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(result.current.returnLoan(loan)).rejects.toThrow(
      /already been returned/i
    );

    expect(insertCalls.filter((c) => c.table === 'history_log')).toHaveLength(0);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.loans });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('member') });
  });
});
