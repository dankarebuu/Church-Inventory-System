import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';
import type { EquipmentType, UserRole } from '@/types/database';
import {
  DEFAULT_EQUIPMENT_TYPE_COLOR,
  getEquipmentTypeColor,
  sortEquipmentTypes,
  useEquipmentTypeMutations,
  useEquipmentTypes,
} from './useEquipmentTypes';

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
    select: vi.fn(() => {
      const res = resultsByOp.get(`${table}:select`) ?? { data: [], error: null };
      const chain = {
        order: vi.fn(() => chain),
        then: (
          onFulfilled: (value: QueryResult) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => Promise.resolve(res).then(onFulfilled, onRejected),
      };
      return chain;
    }),
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

const sampleTypes: EquipmentType[] = [
  {
    id: 'et-mics',
    name: 'Microphones',
    color: '#d3554a',
    icon: 'mic',
    sort_order: 20,
    created_at: '2026-11-20T00:00:00.000Z',
  },
  {
    id: 'et-inst',
    name: 'Instruments',
    color: '#2563EB',
    icon: 'guitar',
    sort_order: 10,
    created_at: '2026-11-20T00:00:00.000Z',
  },
  {
    id: 'et-amps',
    name: 'Amplifiers',
    color: '#d97740',
    icon: 'speaker',
    sort_order: 20,
    created_at: '2026-11-20T00:00:00.000Z',
  },
];

describe('sortEquipmentTypes & getEquipmentTypeColor', () => {
  it('sorts equipment types by sort_order ascending then alphabetically by name', () => {
    const sorted = sortEquipmentTypes(sampleTypes);
    expect(sorted.map((t) => t.id)).toEqual(['et-inst', 'et-amps', 'et-mics']);
  });

  it('resolves equipment type color by id first, then case-insensitive name, fallback palette, and default slate', () => {
    expect(getEquipmentTypeColor('Wrong Name', sampleTypes, 'et-inst')).toBe('#2563EB');
    expect(getEquipmentTypeColor('  microphones ', sampleTypes, null)).toBe('#d3554a');
    expect(getEquipmentTypeColor('Cables & Cords', [])).toBe('#4e7fb0');
    expect(getEquipmentTypeColor('Unknown Custom Type', sampleTypes)).toBe(
      DEFAULT_EQUIPMENT_TYPE_COLOR
    );
    expect(getEquipmentTypeColor(null, sampleTypes)).toBe(DEFAULT_EQUIPMENT_TYPE_COLOR);
  });
});

describe('useEquipmentTypes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('guards query when Supabase is not configured and returns empty array', () => {
    mockIsConfigured.value = false;
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useEquipmentTypes(), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockFrom).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([]);
  });

  it('fetches and sorts equipment_types when configured and surfaces query errors', async () => {
    setResult('equipment_types:select', { data: sampleTypes, error: null });
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useEquipmentTypes(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFrom).toHaveBeenCalledWith('equipment_types');
    expect(result.current.data?.map((t) => t.id)).toEqual(['et-inst', 'et-amps', 'et-mics']);

    const errClient = createTestQueryClient();
    setResult('equipment_types:select', {
      data: null,
      error: { message: 'network timeout' },
    });
    const { result: errResult } = renderHook(() => useEquipmentTypes(), {
      wrapper: createWrapper(errClient),
    });

    await waitFor(() => {
      expect(errResult.current.isError).toBe(true);
    });
    expect(errResult.current.error?.message).toContain('network timeout');
  });
});

describe('useEquipmentTypeMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('enforces Admin-only JS guard before mutating equipment_types', async () => {
    mockAuthState.role = 'member';
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useEquipmentTypeMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(result.current.createEquipmentType({ name: 'Lighting' })).rejects.toThrow(
      /admin/i
    );
    await expect(
      result.current.updateEquipmentType({ id: 'et-1', name: 'Audio' })
    ).rejects.toThrow(/admin/i);
    await expect(result.current.deleteEquipmentType('et-1')).rejects.toThrow(/admin/i);

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('trims name, auto-computes sort_order, normalizes color, and maps 23505 on createEquipmentType', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.equipmentTypes, sampleTypes);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const created: EquipmentType = {
      id: 'et-wireless',
      name: 'Wireless Packs',
      color: '#2563EB',
      icon: 'headphones',
      sort_order: 30,
      created_at: '2026-11-20T00:00:00.000Z',
    };
    setResult('equipment_types:insert', { data: created, error: null });

    const { result } = renderHook(() => useEquipmentTypeMutations(), {
      wrapper: createWrapper(queryClient),
    });

    const row = await result.current.createEquipmentType({
      name: '  Wireless Packs  ',
      color: '2563EB',
      icon: 'headphones',
    });

    expect(row.name).toBe('Wireless Packs');
    expect((insertCalls[0].payload as Array<Record<string, unknown>>)[0]).toEqual({
      name: 'Wireless Packs',
      color: '#2563EB',
      icon: 'headphones',
      sort_order: 30,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.equipmentTypes });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });

    setResult('equipment_types:insert', {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    await expect(
      result.current.createEquipmentType({ name: 'Wireless Packs' })
    ).rejects.toThrow(/already exists/i);
  });

  it('syncs inventory.equipment_type when name changes and skips sync when name is unchanged', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    queryClient.setQueryData(queryKeys.equipmentTypes, sampleTypes);

    setResult('equipment_types:update', {
      data: { ...sampleTypes[0], name: 'Vocal Mics' },
      error: null,
    });
    setResult('inventory:update', { data: null, error: null });

    const { result } = renderHook(() => useEquipmentTypeMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.updateEquipmentType({
      id: 'et-mics',
      name: '  Vocal Mics  ',
      color: '#d3554a',
      icon: 'mic',
    });

    expect(updateCalls.find((c) => c.table === 'inventory')).toEqual({
      table: 'inventory',
      payload: { equipment_type: 'Vocal Mics' },
      col: 'equipment_type_id',
      id: 'et-mics',
    });

    // Updating only color/sort_order with identical name skips inventory sync
    updateCalls.length = 0;
    queryClient.setQueryData(queryKeys.equipmentTypes, [
      { ...sampleTypes[0], name: 'Vocal Mics' },
    ]);
    setResult('equipment_types:update', {
      data: { ...sampleTypes[0], name: 'Vocal Mics', color: '#059669', sort_order: 25 },
      error: null,
    });

    await result.current.updateEquipmentType({
      id: 'et-mics',
      name: 'Vocal Mics',
      color: '#059669',
      sort_order: 25,
    });

    expect(updateCalls.some((c) => c.table === 'inventory')).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.equipmentTypes });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
  });

  it('validates blank names, invalid hex colors, non-integer sort_order, maps 23505 on update, and deletes cleanly', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => useEquipmentTypeMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(result.current.createEquipmentType({ name: '   ' })).rejects.toThrow(
      /required/i
    );
    await expect(
      result.current.createEquipmentType({ name: 'Mics', color: 'bad-hex' })
    ).rejects.toThrow(/hex/i);
    await expect(
      result.current.createEquipmentType({ name: 'Mics', sort_order: 1.5 })
    ).rejects.toThrow(/whole number/i);

    setResult('equipment_types:update', {
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    await expect(
      result.current.updateEquipmentType({ id: 'et-mics', name: 'Instruments' })
    ).rejects.toThrow(/already exists/i);

    updateCalls.length = 0;
    setResult('equipment_types:delete', { data: null, error: null });
    await result.current.deleteEquipmentType({ id: 'et-mics' });
    expect(updateCalls).toEqual([
      {
        table: 'inventory',
        payload: { equipment_type_id: null, equipment_type: null },
        col: 'equipment_type_id',
        id: 'et-mics',
      },
    ]);
    expect(deleteCalls).toEqual([{ table: 'equipment_types', col: 'id', id: 'et-mics' }]);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.equipmentTypes });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
  });

  it('clears equipment_type & equipment_type_id on linked inventory rows before deleting equipment type and aborts on clear error', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    setResult('inventory:update', { data: null, error: null });
    setResult('equipment_types:delete', { data: null, error: null });

    const { result } = renderHook(() => useEquipmentTypeMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.deleteEquipmentType('et-mics');

    expect(mockFrom.mock.calls.map((call) => call[0])).toEqual([
      'inventory',
      'equipment_types',
    ]);
    expect(updateCalls).toEqual([
      {
        table: 'inventory',
        payload: { equipment_type_id: null, equipment_type: null },
        col: 'equipment_type_id',
        id: 'et-mics',
      },
    ]);
    expect(deleteCalls).toEqual([{ table: 'equipment_types', col: 'id', id: 'et-mics' }]);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.equipmentTypes });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });

    // If clearing linked inventory rows fails, do not delete the equipment_types row
    vi.clearAllMocks();
    updateCalls.length = 0;
    deleteCalls.length = 0;
    setResult('inventory:update', {
      data: null,
      error: { message: 'failed to clear inventory equipment type' },
    });

    await expect(result.current.deleteEquipmentType('et-inst')).rejects.toThrow(
      /failed to clear inventory equipment type/i
    );
    expect(deleteCalls).toEqual([]);
  });
});
