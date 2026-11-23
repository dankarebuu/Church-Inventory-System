import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';
import type { LocationRecord, UserRole } from '@/types/database';
import { useLocationMutations } from './useLocations';

const {
  mockIsConfigured,
  mockAuthState,
  mockFrom,
  insertCalls,
  updateCalls,
  deleteCalls,
  setResult,
  resetMocks,
} = vi.hoisted(() => {
  const configured = { value: true };
  const auth = {
    role: 'admin' as UserRole,
  };

  type QueryResult = {
    data: unknown;
    error: { code?: string; message: string } | null;
  };

  const resultsByOp = new Map<string, QueryResult>();
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    col: string;
    id: unknown;
  }> = [];
  const deletes: Array<{ table: string; col: string; id: unknown }> = [];

  const getResult = (key: string): QueryResult =>
    resultsByOp.get(key) ?? { data: null, error: null };

  const from = vi.fn((table: string) => ({
    insert: vi.fn((payload: unknown) => {
      inserts.push({ table, payload });
      const res = getResult(`${table}:insert`);
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => res),
        })),
        then: (
          onFulfilled: (value: QueryResult) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => Promise.resolve(res).then(onFulfilled, onRejected),
      };
    }),
    update: vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn((col: string, id: unknown) => {
        updates.push({ table, payload, col, id });
        const res = getResult(`${table}:update`);
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => res),
          })),
          then: (
            onFulfilled: (value: QueryResult) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => Promise.resolve(res).then(onFulfilled, onRejected),
        };
      }),
    })),
    delete: vi.fn(() => ({
      eq: vi.fn(async (col: string, id: unknown) => {
        deletes.push({ table, col, id });
        return getResult(`${table}:delete`);
      }),
    })),
  }));

  return {
    mockIsConfigured: configured,
    mockAuthState: auth,
    mockFrom: from,
    insertCalls: inserts,
    updateCalls: updates,
    deleteCalls: deletes,
    setResult: (key: string, result: QueryResult) => {
      resultsByOp.set(key, result);
    },
    resetMocks: () => {
      configured.value = true;
      auth.role = 'admin';
      resultsByOp.clear();
      inserts.length = 0;
      updates.length = 0;
      deletes.length = 0;
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

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe('useLocationMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('enforces Admin-only JS guard before mutating locations', async () => {
    mockAuthState.role = 'member';
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useLocationMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(result.current.createLocation({ name: 'Stage' })).rejects.toThrow(/admin/i);
    await expect(
      result.current.updateLocation({ id: 'loc-1', name: 'Booth' })
    ).rejects.toThrow(/admin/i);
    await expect(result.current.deleteLocation('loc-1')).rejects.toThrow(/admin/i);

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('trims location name on create and maps Postgres 23505 to a friendly duplicate error', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const created: LocationRecord = {
      id: 'loc-closet',
      name: 'Storage Closet',
      description: 'Backstage rack room',
      sort_order: 20,
      created_at: '2026-11-18T00:00:00.000Z',
    };
    setResult('locations:insert', { data: created, error: null });

    const { result } = renderHook(() => useLocationMutations(), {
      wrapper: createWrapper(queryClient),
    });

    const row = await result.current.createLocation({
      name: '  Storage Closet  ',
      description: '  Backstage rack room  ',
    });

    expect(row.name).toBe('Storage Closet');
    expect((insertCalls[0].payload as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: 'Storage Closet',
      description: 'Backstage rack room',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.locations });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });

    setResult('locations:insert', {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    await expect(
      result.current.createLocation({ name: 'Storage Closet' })
    ).rejects.toThrow(/already exists/i);
  });

  it('syncs inventory.location text when location name changes and skips sync when unchanged', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const existing: LocationRecord[] = [
      {
        id: 'loc-stage',
        name: 'Stage',
        description: 'Main platform',
        sort_order: 10,
        created_at: '2026-11-18T00:00:00.000Z',
      },
    ];
    queryClient.setQueryData(queryKeys.locations, existing);

    setResult('locations:update', {
      data: { ...existing[0], name: 'Main Stage' },
      error: null,
    });
    setResult('inventory:update', { data: null, error: null });

    const { result } = renderHook(() => useLocationMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.updateLocation({
      id: 'loc-stage',
      name: '  Main Stage  ',
      description: 'Main platform',
    });

    expect(updateCalls.find((c) => c.table === 'inventory')).toEqual({
      table: 'inventory',
      payload: { location: 'Main Stage' },
      col: 'location_id',
      id: 'loc-stage',
    });

    // Updating description only with same name should not touch inventory
    updateCalls.length = 0;
    queryClient.setQueryData(queryKeys.locations, [{ ...existing[0], name: 'Main Stage' }]);
    setResult('locations:update', {
      data: { ...existing[0], name: 'Main Stage', description: 'Updated desc' },
      error: null,
    });

    await result.current.updateLocation({
      id: 'loc-stage',
      name: 'Main Stage',
      description: 'Updated desc',
    });

    expect(updateCalls.some((c) => c.table === 'inventory')).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.categories });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.locations });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
  });

  it('deletes a location, clears stale inventory location text/FKs, and invalidates categories, locations, and inventory', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    setResult('inventory:update', { data: null, error: null });
    setResult('locations:delete', { data: null, error: null });

    const { result } = renderHook(() => useLocationMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.deleteLocation('loc-stage');

    expect(updateCalls).toEqual([
      {
        table: 'inventory',
        payload: { location_id: null, location: null },
        col: 'location_id',
        id: 'loc-stage',
      },
    ]);
    expect(deleteCalls).toEqual([{ table: 'locations', col: 'id', id: 'loc-stage' }]);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.categories });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.locations });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
  });

  it('rejects blank names and maps Postgres 23505 on updateLocation', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useLocationMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(result.current.createLocation({ name: '   ' })).rejects.toThrow(/required/i);
    await expect(
      result.current.updateLocation({ id: 'loc-1', name: '  ' })
    ).rejects.toThrow(/required/i);

    setResult('locations:update', {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    await expect(
      result.current.updateLocation({ id: 'loc-1', name: 'Stage' })
    ).rejects.toThrow(/already exists/i);
  });
});
