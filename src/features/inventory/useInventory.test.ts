import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  saveOfflineSnapshot,
  setActiveOfflineCacheUserId,
} from '@/lib/offlineCache';
import { queryKeys } from '@/lib/queryKeys';
import type {
  Category,
  EquipmentType,
  InventoryItem,
  LoanRecord,
  LocationRecord,
  PublicInventoryItem,
  UserRole,
} from '@/types/database';
import {
  GUEST_INVENTORY_REFETCH_INTERVAL_MS,
  enrichItemsWithLoans,
  useInventoryItems,
  useItemMutations,
} from './useInventory';

const {
  mockIsConfigured,
  mockAuthState,
  mockFrom,
  mockRpc,
  mockStorageFrom,
  mockStorageBucket,
  tableQueries,
  insertCalls,
  updateCalls,
  resetMocks,
} = vi.hoisted(() => {
  const configured = { value: true };
  const auth = {
    role: 'admin' as UserRole,
    user: { id: 'user-1', email: 'dan@wingmacc.org' },
    profile: {
      id: 'user-1',
      email: 'dan@wingmacc.org',
      first_name: 'Dan',
      last_name: 'Caleb',
      role: 'admin' as const,
      created_at: '2026-11-18T00:00:00.000Z',
    },
  };

  const bucket = {
    upload: vi.fn(),
    getPublicUrl: vi.fn(),
    remove: vi.fn(),
  };

  const storageFrom = vi.fn(() => bucket);
  const rpc = vi.fn();

  type TableResult = { data: unknown; error: { message: string } | null };
  const queryMap = new Map<string, TableResult>();
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown>; col: string; id: unknown }> = [];

  const from = vi.fn((table: string) => {
    const getResult = (): TableResult =>
      queryMap.get(table) ?? { data: [], error: null };

    const eqChain = {
      is: vi.fn(() => ({
        limit: vi.fn(async () => getResult()),
        then: (
          onFulfilled: (value: TableResult) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => Promise.resolve(getResult()).then(onFulfilled, onRejected),
      })),
    };

    const selectBuilder = {
      eq: vi.fn(() => eqChain),
      in: vi.fn(() => eqChain),
      is: vi.fn(async () => getResult()),
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
      eq: vi.fn(async (col: string, id: unknown) => {
        updates.push({ table, payload, col, id });
        return getResult();
      }),
    }));

    const selectFn = vi.fn(() => selectBuilder);

    return {
      select: selectFn,
      insert: insertFn,
      update: updateFn,
    };
  });

  return {
    mockIsConfigured: configured,
    mockAuthState: auth,
    mockFrom: from,
    mockRpc: rpc,
    mockStorageFrom: storageFrom,
    mockStorageBucket: bucket,
    tableQueries: queryMap,
    insertCalls: inserts,
    updateCalls: updates,
    resetMocks: () => {
      configured.value = true;
      auth.role = 'admin';
      auth.user = { id: 'user-1', email: 'dan@wingmacc.org' };
      auth.profile = {
        id: 'user-1',
        email: 'dan@wingmacc.org',
        first_name: 'Dan',
        last_name: 'Caleb',
        role: 'admin',
        created_at: '2026-11-18T00:00:00.000Z',
      };
      queryMap.clear();
      inserts.length = 0;
      updates.length = 0;
    },
  };
});

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() {
    return mockIsConfigured.value;
  },
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
    storage: {
      from: mockStorageFrom,
    },
  },
}));

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockAuthState,
}));

function makeInventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'item_1',
    category: 'Drums',
    category_id: 'cat-drums',
    subcategory_id: 'sub-snare',
    item: 'Snare Drum',
    brand: 'Pearl',
    qty: 3,
    condition: 'working',
    owner: 'Church Property',
    location: 'Stage',
    location_id: 'loc-stage',
    checkedBy: 'Dan Caleb',
    dateChecked: 'November 18, 2026',
    checked_at: '2026-11-18T09:00:00.000Z',
    updated_at: '2026-11-18T09:00:00.000Z',
    remarks: 'Fresh head',
    borrower: null,
    returnDate: null,
    serial: 'SN-100',
    description: '14 inch brass snare',
    image_filename: null,
    equipment_type_id: null,
    equipment_type: null,
    min_qty: null,
    deleted_at: null,
    ...overrides,
  };
}

function makePublicItem(overrides: Partial<PublicInventoryItem> = {}): PublicInventoryItem {
  return {
    id: 'item_1',
    category: 'Drums',
    category_id: 'cat-drums',
    subcategory_id: 'sub-snare',
    item: 'Snare Drum',
    brand: 'Pearl',
    qty: 3,
    condition: 'working',
    owner: 'Church Property',
    location: 'Stage',
    location_id: 'loc-stage',
    serial: 'SN-100',
    description: '14 inch brass snare',
    image_filename: null,
    remarks: 'Fresh head',
    dateChecked: 'November 18, 2026',
    checked_at: '2026-11-18T09:00:00.000Z',
    qty_on_loan: 1,
    available_qty: 2,
    equipment_type_id: null,
    equipment_type: null,
    min_qty: null,
    ...overrides,
  };
}

function makeLoan(overrides: Partial<LoanRecord> = {}): LoanRecord {
  return {
    id: 'loan-1',
    item_id: 'item_1',
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

describe('enrichItemsWithLoans', () => {
  it('sums qty_loaned across multiple active loans on the same item and ignores returned loans', () => {
    const items = [
      makeInventoryItem({ id: 'item_mic', item: 'SM58', qty: 5 }),
      makeInventoryItem({ id: 'item_zero', item: 'Broken Cable', qty: 0 }),
      makeInventoryItem({ id: 'item_over', item: 'DI Box', qty: 1 }),
    ];

    const loans = [
      makeLoan({ id: 'l1', item_id: 'item_mic', qty_loaned: 2, returned_at: null }),
      makeLoan({ id: 'l2', item_id: 'item_mic', qty_loaned: 1, returned_at: null }),
      makeLoan({
        id: 'l3',
        item_id: 'item_mic',
        qty_loaned: 2,
        returned_at: '2026-11-17T08:00:00.000Z',
      }),
      makeLoan({ id: 'l4', item_id: 'item_over', qty_loaned: 3, returned_at: null }),
    ];

    const enriched = enrichItemsWithLoans(items, loans);

    expect(enriched[0].qty_on_loan).toBe(3);
    expect(enriched[0].available_qty).toBe(2);
    expect(enriched[0].activeLoans).toHaveLength(2);

    expect(enriched[1].qty).toBe(0);
    expect(enriched[1].qty_on_loan).toBe(0);
    expect(enriched[1].available_qty).toBe(0);
    expect(enriched[1].activeLoans).toEqual([]);

    expect(enriched[2].qty_on_loan).toBe(3);
    expect(enriched[2].available_qty).toBe(0);
  });
});

describe('useInventoryItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('guards queries when Supabase is not configured and returns empty array', () => {
    mockIsConfigured.value = false;
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useInventoryItems('guest'), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockFrom).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual([]);
  });

  it('queries ONLY inventory_public for guest role, sorts by category then item, and omits checkedBy', async () => {
    tableQueries.set('inventory_public', {
      data: [
        makePublicItem({ id: '2', category: 'Keyboard', item: 'Nord Stage' }),
        makePublicItem({ id: '3', category: 'Drums', item: 'Snare Drum' }),
        makePublicItem({ id: '1', category: 'Drums', item: 'Crash Cymbal' }),
      ],
      error: null,
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useInventoryItems('guest'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('inventory_public');
    expect(mockFrom).not.toHaveBeenCalledWith('inventory');
    expect(mockFrom).not.toHaveBeenCalledWith('loans');

    expect(result.current.data?.map((i) => i.id)).toEqual(['1', '3', '2']);
    expect(result.current.data?.[0].checkedBy).toBeUndefined();
    expect(result.current.data?.[0].activeLoans).toBeUndefined();
  });

  it('queries inventory (non-deleted) and active loans for member and admin roles and computes availability', async () => {
    tableQueries.set('inventory', {
      data: [
        makeInventoryItem({ id: 'b', category: 'Keyboard', item: 'Stand', qty: 4 }),
        makeInventoryItem({ id: 'a', category: 'Drums', item: 'Cajon', qty: 2 }),
      ],
      error: null,
    });
    tableQueries.set('loans', {
      data: [makeLoan({ id: 'loan-a', item_id: 'a', qty_loaned: 1, returned_at: null })],
      error: null,
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useInventoryItems('member'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFrom).toHaveBeenCalledWith('inventory');
    expect(mockFrom).toHaveBeenCalledWith('loans');
    expect(mockFrom).not.toHaveBeenCalledWith('inventory_public');

    const selectInventoryCall = mockFrom.mock.results[0].value;
    const selectLoansCall = mockFrom.mock.results[1].value;
    expect(selectInventoryCall.select).toHaveBeenCalledWith('*');
    expect(selectLoansCall.select).toHaveBeenCalledWith('*');

    expect(result.current.data?.map((i) => i.id)).toEqual(['a', 'b']);
    expect(result.current.data?.[0].qty_on_loan).toBe(1);
    expect(result.current.data?.[0].available_qty).toBe(1);
    expect(result.current.data?.[0].checkedBy).toBe('Dan Caleb');
    expect(result.current.data?.[0].activeLoans).toHaveLength(1);
  });

  it('surfaces Supabase query errors for member/admin queries', async () => {
    tableQueries.set('inventory', {
      data: null,
      error: { message: 'permission denied for table inventory' },
    });
    tableQueries.set('loans', { data: [], error: null });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useInventoryItems('admin'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toContain('permission denied');
  });

  it('enables refetchOnWindowFocus and 60s refetchInterval only for guest role', async () => {
    tableQueries.set('inventory_public', {
      data: [makePublicItem({ id: '1', item: 'Guest Mic' })],
      error: null,
    });

    const queryClient = createTestQueryClient();
    const { result: guestResult, unmount } = renderHook(
      () => useInventoryItems('guest'),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(guestResult.current.isSuccess).toBe(true);
    });

    const guestQuery = queryClient
      .getQueryCache()
      .find({ queryKey: queryKeys.inventory('guest') });
    expect(guestQuery?.options).toEqual(
      expect.objectContaining({
        refetchOnWindowFocus: true,
        refetchInterval: GUEST_INVENTORY_REFETCH_INTERVAL_MS,
      })
    );
    expect(GUEST_INVENTORY_REFETCH_INTERVAL_MS).toBe(60_000);

    // Triggering visibilitychange / window focus refreshes guest inventory_public automatically.
    window.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledTimes(2);
    });
    unmount();

    mockFrom.mockClear();
    tableQueries.set('inventory', {
      data: [makeInventoryItem({ id: '2', item: 'Member Mic' })],
      error: null,
    });
    tableQueries.set('loans', { data: [], error: null });

    const { result: memberResult } = renderHook(
      () => useInventoryItems('member'),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(memberResult.current.isSuccess).toBe(true);
    });

    const memberQuery = queryClient
      .getQueryCache()
      .find({ queryKey: queryKeys.inventory('member') });
    expect(memberQuery?.options).toEqual(
      expect.objectContaining({
        refetchOnWindowFocus: false,
        refetchInterval: false,
      })
    );
  });

  it('hydrates offline snapshot per namespace when offline without leaking member cache to guests', () => {
    localStorage.clear();
    saveOfflineSnapshot('guest', {
      inventory: [makePublicItem({ id: 'g-1', item: 'Guest Cached Mic' })],
      savedAt: '2026-11-20T08:00:00.000Z',
    });
    saveOfflineSnapshot('user-1', {
      inventory: [makePublicItem({ id: 'm-1', item: 'Member Cached Snare' })],
      savedAt: '2026-11-20T08:30:00.000Z',
    });

    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      setActiveOfflineCacheUserId('user-1');
      const guestClient = createTestQueryClient();
      const { result: guestResult, unmount } = renderHook(
        () => useInventoryItems('guest'),
        { wrapper: createWrapper(guestClient) }
      );
      expect(guestResult.current.data?.map((i) => i.item)).toEqual(['Guest Cached Mic']);
      unmount();

      const memberClient = createTestQueryClient();
      const { result: memberResult } = renderHook(
        () => useInventoryItems('member'),
        { wrapper: createWrapper(memberClient) }
      );
      expect(memberResult.current.data?.map((i) => i.item)).toEqual(['Member Cached Snare']);
    } finally {
      setActiveOfflineCacheUserId(null);
      onLineSpy.mockRestore();
      localStorage.clear();
    }
  });
});

describe('useItemMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('enforces Admin-only JS guard on saveItem, softDeleteItem, and uploadGearPhotos', async () => {
    mockAuthState.role = 'member';
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      result.current.saveItem({
        values: {
          item: 'DI Box',
          category: 'Spares & Shared',
          category_id: 'cat-1',
          subcategory_id: null,
          brand: 'Radial',
          qty: 0,
          condition: 'working',
          owner: 'Church Property',
          location: 'Stage',
          location_id: 'loc-1',
          serial: '',
          description: '',
          remarks: '',
        },
      })
    ).rejects.toThrow(/admin/i);

    await expect(result.current.softDeleteItem('item_1')).rejects.toThrow(/admin/i);
    await expect(
      result.current.uploadGearPhotos([
        new File(['a'], 'mic.png', { type: 'image/png' }),
      ])
    ).rejects.toThrow(/admin/i);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockStorageBucket.upload).not.toHaveBeenCalled();
  });

  it('saves a new item with qty=0, FK IDs + synced text columns, uploaded photos, history_log entry, and invalidates queries', async () => {
    mockAuthState.role = 'admin';
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    mockStorageBucket.upload.mockResolvedValue({ error: null });
    mockStorageBucket.getPublicUrl.mockImplementation((path: string) => ({
      data: { publicUrl: `https://cdn.example.com/gear-photos/${path}` },
    }));

    const file = new File(['img-bytes'], 'cable.png', { type: 'image/png' });
    const { result } = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.saveItem({
      values: {
        item: 'XLR Spare Cable',
        category: 'Spares & Shared',
        category_id: 'cat-spares',
        subcategory_id: 'sub-cables',
        brand: 'Mogami',
        qty: 0,
        condition: 'working',
        owner: 'Church Property',
        location: 'Booth',
        location_id: 'loc-booth',
        serial: 'XLR-00',
        description: '20ft XLR',
        remarks: 'Needs connector solder',
      },
      newPhotoFiles: [file],
    });

    expect(mockStorageFrom).toHaveBeenCalledWith('gear-photos');
    expect(mockStorageBucket.upload).toHaveBeenCalledTimes(1);

    const invInsert = insertCalls.find((c) => c.table === 'inventory');
    expect(invInsert).toBeDefined();
    const invRow = (invInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(invRow.qty).toBe(0);
    expect(invRow.category_id).toBe('cat-spares');
    expect(invRow.subcategory_id).toBe('sub-cables');
    expect(invRow.location_id).toBe('loc-booth');
    expect(invRow.category).toBe('Spares & Shared');
    expect(invRow.location).toBe('Booth');
    expect('borrower' in invRow).toBe(false);
    expect('returnDate' in invRow).toBe(false);

    const parsedImgs = JSON.parse(String(invRow.image_filename)) as string[];
    expect(parsedImgs).toHaveLength(1);
    expect(parsedImgs[0]).toContain('https://cdn.example.com/gear-photos/');

    const histInsert = insertCalls.find((c) => c.table === 'history_log');
    expect(histInsert).toBeDefined();
    const histRow = (histInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(histRow.action).toBe('added');
    expect(histRow.item_id).toBe(invRow.id);
    expect(histRow.user_email).toBe('dan@wingmacc.org');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.loans });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });

  it('resolves category and location text from query cache when only IDs are supplied', async () => {
    mockAuthState.role = 'admin';
    const queryClient = createTestQueryClient();
    const categories: Category[] = [
      {
        id: 'cat-drums',
        name: 'Drums',
        parent_id: null,
        color: '#d97740',
        icon: 'drum',
        sort_order: 10,
        created_at: '2026-11-18T00:00:00.000Z',
      },
    ];
    const locations: LocationRecord[] = [
      {
        id: 'loc-stage',
        name: 'Stage',
        description: null,
        sort_order: 10,
        created_at: '2026-11-18T00:00:00.000Z',
      },
    ];
    queryClient.setQueryData(queryKeys.categories, categories);
    queryClient.setQueryData(queryKeys.locations, locations);

    const { result } = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.saveItem({
      values: {
        item: 'Ride Cymbal',
        category: '',
        category_id: 'cat-drums',
        subcategory_id: null,
        brand: 'Zildjian',
        qty: 1,
        condition: 'working',
        owner: 'Church Property',
        location: '',
        location_id: 'loc-stage',
        serial: '',
        description: '',
        remarks: '',
      },
    });

    const invInsert = insertCalls.find((c) => c.table === 'inventory');
    const invRow = (invInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(invRow.category).toBe('Drums');
    expect(invRow.category_id).toBe('cat-drums');
    expect(invRow.location).toBe('Stage');
    expect(invRow.location_id).toBe('loc-stage');
  });

  it('updates an existing item, strips transient loan fields from prev_data, and logs "updated"', async () => {
    mockAuthState.role = 'admin';
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const existingItem = {
      ...makeInventoryItem({
        id: 'item_99',
        qty: 2,
        checkedBy: 'Previous Checker',
        dateChecked: 'November 10, 2026',
        checked_at: '2026-11-10T09:00:00.000Z',
        image_filename: '["https://cdn.example.com/gear-photos/old.png"]',
      }),
      qty_on_loan: 1,
      available_qty: 1,
      activeLoans: [makeLoan({ item_id: 'item_99' })],
    };

    const { result } = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.saveItem({
      existingItem,
      existingPhotos: ['https://cdn.example.com/gear-photos/old.png'],
      values: {
        item: 'Snare Drum Updated',
        category: 'Drums',
        category_id: 'cat-drums',
        subcategory_id: 'sub-snare',
        brand: 'Pearl',
        qty: 0,
        condition: 'repair',
        owner: 'Church Property',
        location: 'Stage',
        location_id: 'loc-stage',
        serial: 'SN-100',
        description: '14 inch brass snare',
        remarks: 'Snare wire bent',
      },
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe('inventory');
    expect(updateCalls[0].id).toBe('item_99');
    expect(updateCalls[0].payload.qty).toBe(0);
    expect(updateCalls[0].payload.checkedBy).toBe('Dan Caleb');
    expect('borrower' in updateCalls[0].payload).toBe(false);
    expect('returnDate' in updateCalls[0].payload).toBe(false);

    const histRow = (insertCalls[0].payload as Array<Record<string, unknown>>)[0];
    expect(histRow.action).toBe('updated');
    const prevData = histRow.prev_data as Record<string, unknown>;
    expect('qty_on_loan' in prevData).toBe(false);
    expect('available_qty' in prevData).toBe(false);
    expect('activeLoans' in prevData).toBe(false);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.loans });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });

  it('aborts saveItem cleanly on mid-queue upload failure without writing partial URLs to inventory', async () => {
    mockAuthState.role = 'admin';
    const queryClient = createTestQueryClient();

    mockStorageBucket.upload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'Storage quota exceeded' } });
    mockStorageBucket.getPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://cdn.example.com/gear-photos/first.png' },
    });
    mockStorageBucket.remove.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    const f1 = new File(['a'], 'first.png', { type: 'image/png' });
    const f2 = new File(['b'], 'second.png', { type: 'image/png' });

    await expect(
      result.current.saveItem({
        values: {
          item: 'Keyboard',
          category: 'Keyboard',
          category_id: 'cat-kb',
          subcategory_id: null,
          brand: 'Nord',
          qty: 1,
          condition: 'working',
          owner: 'Church Property',
          location: 'Stage',
          location_id: 'loc-stage',
          serial: '',
          description: '',
          remarks: '',
        },
        newPhotoFiles: [f1, f2],
      })
    ).rejects.toThrow(/second\.png.*Storage quota exceeded/i);

    expect(mockStorageBucket.remove).toHaveBeenCalledTimes(1);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('cleans up newly uploaded photos if inventory insert fails after upload', async () => {
    mockAuthState.role = 'admin';
    const queryClient = createTestQueryClient();

    mockStorageBucket.upload.mockResolvedValue({ error: null });
    mockStorageBucket.getPublicUrl.mockImplementation((path: string) => ({
      data: { publicUrl: `https://cdn.example.com/gear-photos/${path}` },
    }));
    mockStorageBucket.remove.mockResolvedValue({ data: [], error: null });
    tableQueries.set('inventory', {
      data: null,
      error: { message: 'RLS violation on inventory' },
    });

    const { result } = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      result.current.saveItem({
        values: {
          item: 'Bass Amp',
          category: 'Bass Rig',
          category_id: 'cat-bass',
          subcategory_id: null,
          brand: 'Ampeg',
          qty: 1,
          condition: 'working',
          owner: 'Church Property',
          location: 'Stage',
          location_id: 'loc-stage',
          serial: '',
          description: '',
          remarks: '',
        },
        newPhotoFiles: [new File(['a'], 'amp.png', { type: 'image/png' })],
      })
    ).rejects.toThrow(/RLS violation/);

    expect(mockStorageBucket.remove).toHaveBeenCalledTimes(1);
    expect(insertCalls.some((c) => c.table === 'history_log')).toBe(false);
  });

  it('rejects saving when combined existing + new photos exceed 4', async () => {
    mockAuthState.role = 'admin';
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    const f = new File(['a'], 'fifth.png', { type: 'image/png' });

    await expect(
      result.current.saveItem({
        existingPhotos: ['u1', 'u2', 'u3', 'u4'],
        newPhotoFiles: [f],
        values: {
          item: 'Amp',
          category: 'Electric Guitar Rig',
          category_id: 'cat-gtr',
          subcategory_id: null,
          brand: 'Fender',
          qty: 1,
          condition: 'working',
          owner: 'Church Property',
          location: 'Stage',
          location_id: 'loc-stage',
          serial: '',
          description: '',
          remarks: '',
        },
      })
    ).rejects.toThrow(/4/);

    expect(mockStorageBucket.upload).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('soft-deletes an item as admin, logs "deleted", and invalidates inventory & history', async () => {
    mockAuthState.role = 'admin';
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    const item = makeInventoryItem({ id: 'item_del_1' });
    await result.current.softDeleteItem(item);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].id).toBe('item_del_1');
    expect(typeof updateCalls[0].payload.deleted_at).toBe('string');

    const histRow = (insertCalls[0].payload as Array<Record<string, unknown>>)[0];
    expect(histRow.action).toBe('deleted');
    expect(histRow.item_id).toBe('item_del_1');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.loans });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });

  it('blocks soft-deleting an item with active loans (snapshot or DB) and invalidates caches on partial history_log failure', async () => {
    mockAuthState.role = 'admin';
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    // 1. Snapshot guard: rejects when qty_on_loan > 0 without touching inventory
    const itemWithLoan = {
      ...makeInventoryItem({ id: 'item_on_loan' }),
      qty_on_loan: 1,
      available_qty: 2,
      activeLoans: [makeLoan({ id: 'loan-active', item_id: 'item_on_loan' })],
    };

    await expect(result.current.softDeleteItem(itemWithLoan)).rejects.toThrow(
      /return all active loans/i
    );
    expect(updateCalls).toHaveLength(0);

    // 2. DB guard: rejects even with bare itemId string if active loans exist in Supabase
    tableQueries.set('loans', {
      data: [{ id: 'loan-db-active' }],
      error: null,
    });
    await expect(result.current.softDeleteItem('item_db_loan')).rejects.toThrow(
      /return all active loans/i
    );
    expect(updateCalls).toHaveLength(0);

    // 3. Partial-failure cache invalidation when history_log insert fails after saveItem / softDeleteItem
    tableQueries.set('loans', { data: [], error: null });
    tableQueries.set('history_log', {
      data: null,
      error: { message: 'history_log write failed' },
    });

    await expect(
      result.current.saveItem({
        values: {
          item: 'Committed Mic',
          category: 'Audio',
          category_id: 'cat-audio',
          subcategory_id: null,
          brand: 'Shure',
          qty: 1,
          condition: 'working',
          owner: 'Church Property',
          location: 'Stage',
          location_id: 'loc-stage',
          serial: '',
          description: '',
          remarks: '',
        },
      })
    ).rejects.toThrow(/history_log write failed/i);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.loans });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });

    invalidateSpy.mockClear();

    await expect(
      result.current.saveItem({
        existingItem: makeInventoryItem({ id: 'item_upd_partial' }),
        values: {
          item: 'Updated Mic',
          category: 'Drums',
          category_id: 'cat-drums',
          subcategory_id: 'sub-snare',
          brand: 'Pearl',
          qty: 3,
          condition: 'working',
          owner: 'Church Property',
          location: 'Stage',
          location_id: 'loc-stage',
          serial: 'SN-100',
          description: '',
          remarks: '',
        },
      })
    ).rejects.toThrow(/history_log write failed/i);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.loans });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });

    invalidateSpy.mockClear();

    await expect(
      result.current.softDeleteItem(makeInventoryItem({ id: 'item_del_partial' }))
    ).rejects.toThrow(/history_log write failed/i);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.loans });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });

  it('routes memberCheckItem through member_check_item RPC for members/admins and blocks guests', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    mockAuthState.role = 'guest';
    const guestHook = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      guestHook.result.current.memberCheckItem({
        itemId: 'item_1',
        condition: 'working',
      })
    ).rejects.toThrow(/member|admin/i);
    expect(mockRpc).not.toHaveBeenCalled();

    mockAuthState.role = 'member';
    mockRpc.mockResolvedValue({
      data: {
        id: 'item_1',
        condition: 'repair',
        checkedBy: 'Dan Caleb',
        dateChecked: 'November 18, 2026',
        checked_at: '2026-11-18T10:00:00.000Z',
        remarks: 'Loose XLR jack',
        action: 'updated',
      },
      error: null,
    });

    const memberHook = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    const rpcResult = await memberHook.result.current.memberCheckItem({
      itemId: 'item_1',
      condition: 'repair',
      remarks: 'Loose XLR jack',
    });

    expect(mockRpc).toHaveBeenCalledWith('member_check_item', {
      p_item_id: 'item_1',
      p_condition: 'repair',
      p_remarks: 'Loose XLR jack',
    });
    expect(rpcResult.action).toBe('updated');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('member') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });

  it('persists equipment_type_id, resolved equipment_type from cache, and min_qty (including 0) in saveItem and snapshots', async () => {
    mockAuthState.role = 'admin';
    const queryClient = createTestQueryClient();
    const equipmentTypes: EquipmentType[] = [
      {
        id: 'et-cables',
        name: 'Cables & Cords',
        color: '#4e7fb0',
        icon: 'cable',
        sort_order: 60,
        created_at: '2026-11-20T00:00:00.000Z',
      },
    ];
    queryClient.setQueryData(queryKeys.equipmentTypes, equipmentTypes);

    const { result } = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.saveItem({
      values: {
        item: 'XLR Spare',
        category: 'Spares & Shared',
        category_id: 'cat-spares',
        subcategory_id: null,
        equipment_type_id: 'et-cables',
        equipment_type: '',
        min_qty: '0',
        brand: 'Mogami',
        qty: 3,
        condition: 'working',
        owner: 'Church Property',
        location: 'Stage',
        location_id: 'loc-stage',
        serial: '',
        description: '',
        remarks: '',
      },
    });

    const invInsert = insertCalls.find((c) => c.table === 'inventory');
    const invRow = (invInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(invRow.equipment_type_id).toBe('et-cables');
    expect(invRow.equipment_type).toBe('Cables & Cords');
    expect(invRow.min_qty).toBe(0);

    await result.current.saveItem({
      existingItem: {
        ...makeInventoryItem({
          id: 'item_et_upd',
          equipment_type_id: 'et-cables',
          equipment_type: 'Cables & Cords',
          min_qty: 2,
        }),
        qty_on_loan: 0,
        available_qty: 3,
      },
      values: {
        item: 'XLR Spare',
        category: 'Spares & Shared',
        category_id: 'cat-spares',
        subcategory_id: null,
        equipment_type_id: null,
        equipment_type: '',
        min_qty: '',
        brand: 'Mogami',
        qty: 3,
        condition: 'working',
        owner: 'Church Property',
        location: 'Stage',
        location_id: 'loc-stage',
        serial: '',
        description: '',
        remarks: '',
      },
    });

    expect(updateCalls[0].payload.equipment_type_id).toBeNull();
    expect(updateCalls[0].payload.equipment_type).toBeNull();
    expect(updateCalls[0].payload.min_qty).toBeNull();

    const updHistInsert = insertCalls.find(
      (c) =>
        c.table === 'history_log' &&
        (c.payload as Array<Record<string, unknown>>)[0]?.action === 'updated'
    );
    const updHistRow = (updHistInsert?.payload as Array<Record<string, unknown>>)[0];
    expect((updHistRow.prev_data as Record<string, unknown>).equipment_type_id).toBe('et-cables');
    expect((updHistRow.prev_data as Record<string, unknown>).equipment_type).toBe('Cables & Cords');
    expect((updHistRow.prev_data as Record<string, unknown>).min_qty).toBe(2);
  });

  it('supports addItemPhoto for member & admin, validates 4-photo cap/MIME, and rolls back storage upload when RPC fails', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    // 1. Guest is blocked
    mockAuthState.role = 'guest';
    const guestHook = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });
    const validFile = new File(['img'], 'gear.png', { type: 'image/png' });

    await expect(
      guestHook.result.current.addItemPhoto({
        itemId: 'item_1',
        file: validFile,
        existingPhotoCount: 0,
      })
    ).rejects.toThrow(/member|admin/i);
    expect(mockStorageBucket.upload).not.toHaveBeenCalled();

    // 2. Member blocked at 4-photo cap before uploading
    mockAuthState.role = 'member';
    const memberHook = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });
    await expect(
      memberHook.result.current.addItemPhoto({
        itemId: 'item_1',
        file: validFile,
        existingPhotoCount: 4,
      })
    ).rejects.toThrow(/4/);
    expect(mockStorageBucket.upload).not.toHaveBeenCalled();

    // 3. Member success uploads, calls member_add_item_photo RPC, and invalidates queries
    mockStorageBucket.upload.mockResolvedValue({ error: null });
    mockStorageBucket.getPublicUrl.mockImplementation((path: string) => ({
      data: {
        publicUrl: `https://proj.supabase.co/storage/v1/object/public/gear-photos/${path}`,
      },
    }));
    mockRpc.mockResolvedValueOnce({
      data: {
        id: 'item_1',
        image_filename:
          '["https://proj.supabase.co/storage/v1/object/public/gear-photos/photo.png"]',
        photos: ['https://proj.supabase.co/storage/v1/object/public/gear-photos/photo.png'],
      },
      error: null,
    });

    const added = await memberHook.result.current.addItemPhoto({
      itemId: 'item_1',
      file: validFile,
      existingPhotoCount: 1,
    });

    expect(mockStorageFrom).toHaveBeenCalledWith('gear-photos');
    expect(mockStorageBucket.upload).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('member_add_item_photo', {
      p_item_id: 'item_1',
      p_photo_url: expect.stringMatching(
        /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/gear-photos\//
      ),
    });
    expect(added.photos).toHaveLength(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('member') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });

    // 4. Admin success + rollback via remove() when RPC fails
    mockAuthState.role = 'admin';
    mockStorageBucket.remove.mockResolvedValue({ data: [], error: null });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Maximum of 4 photos reached' },
    });

    const adminHook = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      adminHook.result.current.addItemPhoto({
        itemId: 'item_1',
        file: validFile,
        existingPhotoCount: 3,
      })
    ).rejects.toThrow(/maximum of 4 photos/i);

    expect(mockStorageBucket.remove).toHaveBeenCalledTimes(1);
  });

  it('enforces admin guard, skips unchanged rows, updates selected items, logs undoable updated history, and invalidates queries in bulkUpdateItems', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    mockAuthState.role = 'member';
    const memberHook = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });
    await expect(
      memberHook.result.current.bulkUpdateItems({
        itemIds: ['item_1'],
        location_id: 'loc-booth',
      })
    ).rejects.toThrow(/admin/i);

    mockAuthState.role = 'admin';
    const adminHook = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      adminHook.result.current.bulkUpdateItems({
        itemIds: [],
        location_id: 'loc-booth',
      })
    ).rejects.toThrow(/select at least one/i);

    queryClient.setQueryData(queryKeys.categories, [
      {
        id: 'cat-spares',
        name: 'Spares & Shared',
        parent_id: null,
        color: '#4e7fb0',
        icon: 'cable',
        sort_order: 70,
        created_at: '2026-11-18T00:00:00.000Z',
      },
    ] satisfies Category[]);
    queryClient.setQueryData(queryKeys.equipmentTypes, [
      {
        id: 'et-cables',
        name: 'Cables & Cords',
        color: '#4e7fb0',
        icon: 'cable',
        sort_order: 60,
        created_at: '2026-11-20T00:00:00.000Z',
      },
    ] satisfies EquipmentType[]);
    queryClient.setQueryData(queryKeys.locations, [
      {
        id: 'loc-booth',
        name: 'Sound Booth',
        description: null,
        sort_order: 20,
        created_at: '2026-11-18T00:00:00.000Z',
      },
    ] satisfies LocationRecord[]);

    const itemChanged = makeInventoryItem({
      id: 'item_a',
      category: 'Drums',
      category_id: 'cat-drums',
      subcategory_id: 'sub-snare',
      equipment_type_id: null,
      equipment_type: null,
      location: 'Stage',
      location_id: 'loc-stage',
    });
    const itemUnchanged = makeInventoryItem({
      id: 'item_b',
      category: 'Spares & Shared',
      category_id: 'cat-spares',
      subcategory_id: null,
      equipment_type_id: 'et-cables',
      equipment_type: 'Cables & Cords',
      location: 'Sound Booth',
      location_id: 'loc-booth',
    });

    tableQueries.set('inventory', {
      data: [itemChanged, itemUnchanged],
      error: null,
    });

    const bulkResult = await adminHook.result.current.bulkUpdateItems({
      itemIds: ['item_a', 'item_b'],
      category_id: 'cat-spares',
      equipment_type_id: 'et-cables',
      location_id: 'loc-booth',
    });

    expect(bulkResult).toEqual({
      updatedCount: 1,
      skippedCount: 1,
      updatedIds: ['item_a'],
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual({
      table: 'inventory',
      col: 'id',
      id: 'item_a',
      payload: expect.objectContaining({
        category_id: 'cat-spares',
        category: 'Spares & Shared',
        subcategory_id: null,
        equipment_type_id: 'et-cables',
        equipment_type: 'Cables & Cords',
        location_id: 'loc-booth',
        location: 'Sound Booth',
      }),
    });

    const histInsert = insertCalls.find((c) => c.table === 'history_log');
    expect(histInsert).toBeDefined();
    const histRows = histInsert?.payload as Array<Record<string, unknown>>;
    expect(histRows).toHaveLength(1);
    expect(histRows[0].action).toBe('updated');
    expect(histRows[0].item_id).toBe('item_a');
    expect((histRows[0].prev_data as Record<string, unknown>).category_id).toBe('cat-drums');
    expect((histRows[0].item_data as Record<string, unknown>).category_id).toBe('cat-spares');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });

  it('rejects reducing inventory qty below active loaned units and cleans up uploaded photos', async () => {
    mockAuthState.role = 'admin';
    const queryClient = createTestQueryClient();

    mockStorageBucket.upload.mockResolvedValue({ error: null });
    mockStorageBucket.getPublicUrl.mockImplementation((path: string) => ({
      data: { publicUrl: `https://cdn.example.com/gear-photos/${path}` },
    }));
    mockStorageBucket.remove.mockResolvedValue({ data: [], error: null });

    tableQueries.set('loans', {
      data: [{ qty_loaned: 2 }, { qty_loaned: 1 }],
      error: null,
    });

    const { result } = renderHook(() => useItemMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      result.current.saveItem({
        existingItem: makeInventoryItem({ id: 'item_loaned', qty: 4 }),
        newPhotoFiles: [new File(['img'], 'extra.png', { type: 'image/png' })],
        values: {
          item: 'Wireless Mic',
          category: 'In-Ear Monitors',
          category_id: 'cat-iem',
          subcategory_id: null,
          brand: 'Shure',
          qty: 2,
          condition: 'working',
          owner: 'Church Property',
          location: 'Stage',
          location_id: 'loc-stage',
          serial: '',
          description: '',
          remarks: '',
        },
      })
    ).rejects.toThrow(/currently on loan/i);

    expect(updateCalls).toHaveLength(0);
    expect(mockStorageBucket.remove).toHaveBeenCalledTimes(1);
  });
});
