import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';
import type { Category, UserRole } from '@/types/database';
import { useCategoryMutations } from './useCategories';

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

describe('useCategoryMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('enforces Admin-only JS guard before calling Supabase', async () => {
    mockAuthState.role = 'member';
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useCategoryMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(result.current.createCategory({ name: 'Vocals' })).rejects.toThrow(/admin/i);
    await expect(
      result.current.updateCategory({ id: 'cat-1', name: 'Vocals' })
    ).rejects.toThrow(/admin/i);
    await expect(result.current.deleteCategory('cat-1')).rejects.toThrow(/admin/i);

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('trims category name on create and surfaces friendly duplicate-name errors on Postgres 23505', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const created: Category = {
      id: 'cat-vocals',
      name: 'Vocals',
      parent_id: null,
      color: '#2563EB',
      icon: 'mic',
      sort_order: 100,
      created_at: '2026-11-18T00:00:00.000Z',
    };
    setResult('categories:insert', { data: created, error: null });

    const { result } = renderHook(() => useCategoryMutations(), {
      wrapper: createWrapper(queryClient),
    });

    const row = await result.current.createCategory({
      name: '  Vocals  ',
      parent_id: null,
      color: '#2563EB',
      icon: 'mic',
    });

    expect(row.name).toBe('Vocals');
    expect((insertCalls[0].payload as Array<Record<string, unknown>>)[0].name).toBe('Vocals');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.categories });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.locations });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });

    setResult('categories:insert', {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    await expect(
      result.current.createCategory({ name: '  Vocals  ', parent_id: null })
    ).rejects.toThrow(/already exists/i);
  });

  it('syncs inventory.category text when a top-level category name changes, and skips sync for subcategories', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const existing: Category[] = [
      {
        id: 'cat-drums',
        name: 'Drums',
        parent_id: null,
        color: '#d97740',
        icon: 'drum',
        sort_order: 10,
        created_at: '2026-11-18T00:00:00.000Z',
      },
      {
        id: 'sub-snare',
        name: 'Snares',
        parent_id: 'cat-drums',
        color: '#d97740',
        icon: 'drum',
        sort_order: 10,
        created_at: '2026-11-18T00:00:00.000Z',
      },
    ];
    queryClient.setQueryData(queryKeys.categories, existing);

    setResult('categories:update', {
      data: { ...existing[0], name: 'Percussion' },
      error: null,
    });
    setResult('inventory:update', { data: null, error: null });

    const { result } = renderHook(() => useCategoryMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.updateCategory({
      id: 'cat-drums',
      name: '  Percussion ',
      color: '#d97740',
      icon: 'drum',
    });

    const catUpdate = updateCalls.find((c) => c.table === 'categories');
    const invSync = updateCalls.find((c) => c.table === 'inventory');
    expect(catUpdate?.payload.name).toBe('Percussion');
    expect(invSync).toEqual({
      table: 'inventory',
      payload: { category: 'Percussion' },
      col: 'category_id',
      id: 'cat-drums',
    });

    // Subcategory rename should NOT overwrite inventory.category text
    updateCalls.length = 0;
    setResult('categories:update', {
      data: { ...existing[1], name: 'Snare Drums' },
      error: null,
    });

    await result.current.updateCategory({
      id: 'sub-snare',
      name: 'Snare Drums',
      parent_id: 'cat-drums',
    });

    expect(updateCalls.some((c) => c.table === 'inventory')).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.categories });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
  });

  it('deletes a category and invalidates categories, locations, and inventory', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    setResult('categories:delete', { data: null, error: null });

    const { result } = renderHook(() => useCategoryMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.deleteCategory('cat-drums');

    expect(deleteCalls).toEqual([{ table: 'categories', col: 'id', id: 'cat-drums' }]);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.categories });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.locations });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
  });

  it('rejects blank names, invalid hex colors, >2-level nesting, and maps 23505 on updateCategory', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.categories, [
      {
        id: 'cat-drums',
        name: 'Drums',
        parent_id: null,
        color: '#d97740',
        icon: 'drum',
        sort_order: 10,
        created_at: '2026-11-18T00:00:00.000Z',
      },
      {
        id: 'sub-snare',
        name: 'Snares',
        parent_id: 'cat-drums',
        color: '#d97740',
        icon: 'drum',
        sort_order: 10,
        created_at: '2026-11-18T00:00:00.000Z',
      },
      {
        id: 'cat-kb',
        name: 'Keyboard',
        parent_id: null,
        color: '#4fa8a0',
        icon: 'piano',
        sort_order: 20,
        created_at: '2026-11-18T00:00:00.000Z',
      },
    ]);

    const { result } = renderHook(() => useCategoryMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(result.current.createCategory({ name: '   ' })).rejects.toThrow(/required/i);
    await expect(
      result.current.createCategory({ name: 'Synth', color: 'not-hex' })
    ).rejects.toThrow(/hex/i);
    await expect(
      result.current.createCategory({ name: 'Piccolo', parent_id: 'sub-snare' })
    ).rejects.toThrow(/top-level/i);
    await expect(
      result.current.updateCategory({
        id: 'cat-drums',
        name: 'Drums',
        parent_id: 'cat-kb',
      })
    ).rejects.toThrow(/already has subcategories/i);

    setResult('categories:update', {
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    await expect(
      result.current.updateCategory({ id: 'cat-kb', name: 'Drums' })
    ).rejects.toThrow(/already exists/i);
  });

  it('syncs inventory on subcategory promotion to top-level and leaf category demotion to subcategory', async () => {
    const queryClient = createTestQueryClient();
    const drums: Category = {
      id: 'cat-drums',
      name: 'Drums',
      parent_id: null,
      color: '#d97740',
      icon: 'drum',
      sort_order: 10,
      created_at: '2026-11-18T00:00:00.000Z',
    };
    const spares: Category = {
      id: 'cat-spares',
      name: 'Spares & Shared',
      parent_id: null,
      color: '#4e7fb0',
      icon: 'cable',
      sort_order: 20,
      created_at: '2026-11-18T00:00:00.000Z',
    };
    const cables: Category = {
      id: 'cat-cables',
      name: 'XLR Cables',
      parent_id: null,
      color: '#4e7fb0',
      icon: 'cable',
      sort_order: 30,
      created_at: '2026-11-18T00:00:00.000Z',
    };
    const snares: Category = {
      id: 'sub-snare',
      name: 'Snares',
      parent_id: 'cat-drums',
      color: '#d97740',
      icon: 'drum',
      sort_order: 10,
      created_at: '2026-11-18T00:00:00.000Z',
    };

    queryClient.setQueryData(queryKeys.categories, [drums, spares, cables, snares]);

    const { result } = renderHook(() => useCategoryMutations(), {
      wrapper: createWrapper(queryClient),
    });

    // 1. Promote subcategory 'sub-snare' -> top-level (parent_id: null)
    setResult('categories:update', {
      data: { ...snares, name: 'Snare Drums', parent_id: null },
      error: null,
    });
    setResult('inventory:update', { data: null, error: null });

    await result.current.updateCategory({
      id: 'sub-snare',
      name: 'Snare Drums',
      parent_id: null,
    });

    expect(updateCalls.find((c) => c.table === 'categories')?.payload).toMatchObject({
      name: 'Snare Drums',
      parent_id: null,
    });
    expect(updateCalls.find((c) => c.table === 'inventory')).toEqual({
      table: 'inventory',
      payload: {
        category_id: 'sub-snare',
        category: 'Snare Drums',
        subcategory_id: null,
      },
      col: 'subcategory_id',
      id: 'sub-snare',
    });

    // 2. Demote leaf top-level 'cat-cables' -> subcategory under 'cat-spares'
    updateCalls.length = 0;
    queryClient.setQueryData(queryKeys.categories, [drums, spares, cables, snares]);
    setResult('categories:update', {
      data: { ...cables, parent_id: 'cat-spares' },
      error: null,
    });

    await result.current.updateCategory({
      id: 'cat-cables',
      name: 'XLR Cables',
      parent_id: 'cat-spares',
    });

    expect(updateCalls.find((c) => c.table === 'categories')?.payload).toMatchObject({
      name: 'XLR Cables',
      parent_id: 'cat-spares',
    });
    expect(updateCalls.find((c) => c.table === 'inventory')).toEqual({
      table: 'inventory',
      payload: {
        category_id: 'cat-spares',
        category: 'Spares & Shared',
        subcategory_id: 'cat-cables',
      },
      col: 'category_id',
      id: 'cat-cables',
    });
  });

  it('populates cold cache via fetchCategories for 2-level guards and omits parent_id when undefined', async () => {
    const queryClient = createTestQueryClient();
    const drums: Category = {
      id: 'cat-drums',
      name: 'Drums',
      parent_id: null,
      color: '#d97740',
      icon: 'drum',
      sort_order: 10,
      created_at: '2026-11-18T00:00:00.000Z',
    };
    const snares: Category = {
      id: 'sub-snare',
      name: 'Snares',
      parent_id: 'cat-drums',
      color: '#d97740',
      icon: 'drum',
      sort_order: 10,
      created_at: '2026-11-18T00:00:00.000Z',
    };
    const spares: Category = {
      id: 'cat-spares',
      name: 'Spares & Shared',
      parent_id: null,
      color: '#4e7fb0',
      icon: 'cable',
      sort_order: 20,
      created_at: '2026-11-18T00:00:00.000Z',
    };

    // Cold cache: nothing set via setQueryData, only categories:select configured
    setResult('categories:select', { data: [drums, snares, spares], error: null });

    const { result } = renderHook(() => useCategoryMutations(), {
      wrapper: createWrapper(queryClient),
    });

    // Cold-cache 2-level hierarchy guard must reject nesting under a subcategory
    await expect(
      result.current.createCategory({ name: 'Piccolo', parent_id: 'sub-snare' })
    ).rejects.toThrow(/top-level/i);
    expect(insertCalls).toHaveLength(0);

    // Cold-cache 2-level hierarchy guard must reject nesting a parent that has subcategories
    await expect(
      result.current.updateCategory({
        id: 'cat-drums',
        name: 'Drums',
        parent_id: 'cat-spares',
      })
    ).rejects.toThrow(/already has subcategories/i);

    // Cold-cache updateCategory omitting parent_id on a subcategory must omit parent_id
    // from payload and preserve subcategory identity (no inventory overwrite)
    setResult('categories:update', {
      data: { ...snares, name: 'Concert Snares' },
      error: null,
    });

    await result.current.updateCategory({
      id: 'sub-snare',
      name: 'Concert Snares',
    });

    const catUpdate = updateCalls.find((c) => c.table === 'categories');
    expect(catUpdate).toBeDefined();
    expect('parent_id' in (catUpdate?.payload ?? {})).toBe(false);
    expect(catUpdate?.payload).toEqual({ name: 'Concert Snares' });
    expect(updateCalls.some((c) => c.table === 'inventory')).toBe(false);

    // Cold-cache updateCategory omitting parent_id on a top-level category must omit
    // parent_id from payload AND sync inventory.category when name changes
    updateCalls.length = 0;
    setResult('categories:update', {
      data: { ...drums, name: 'Percussion' },
      error: null,
    });
    setResult('inventory:update', { data: null, error: null });

    await result.current.updateCategory({
      id: 'cat-drums',
      name: 'Percussion',
    });

    const topUpdate = updateCalls.find((c) => c.table === 'categories');
    expect('parent_id' in (topUpdate?.payload ?? {})).toBe(false);
    expect(updateCalls.find((c) => c.table === 'inventory')).toEqual({
      table: 'inventory',
      payload: { category: 'Percussion' },
      col: 'category_id',
      id: 'cat-drums',
    });
  });
});
