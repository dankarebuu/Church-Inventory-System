import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';
import type { ItemComment, UserRole } from '@/types/database';
import {
  COMMENT_MAX_LENGTH,
  sortItemComments,
  useCommentCounts,
  useCommentMutations,
  useItemComments,
} from './useItemComments';

const {
  mockIsConfigured,
  mockAuthState,
  mockFrom,
  selectCalls,
  insertCalls,
  updateCalls,
  deleteCalls,
  eqCalls,
  orderCalls,
  setResult,
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

  type QueryResult = {
    data: unknown;
    error: { code?: string; message: string } | null;
  };

  const resultsByOp = new Map<string, QueryResult>();
  const selects: Array<{ table: string; columns: string }> = [];
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    col: string;
    id: unknown;
  }> = [];
  const deletes: Array<{ table: string; col: string; id: unknown }> = [];
  const eqs: Array<{ table: string; col: string; val: unknown }> = [];
  const orders: Array<{ table: string; column: string; ascending: boolean }> = [];

  const getResult = (key: string): QueryResult =>
    resultsByOp.get(key) ?? { data: null, error: null };

  const from = vi.fn((table: string) => ({
    select: vi.fn((columns = '*') => {
      selects.push({ table, columns });
      const res = resultsByOp.get(`${table}:select`) ?? { data: [], error: null };
      const chain = {
        eq: vi.fn((col: string, val: unknown) => {
          eqs.push({ table, col, val });
          return chain;
        }),
        order: vi.fn((column: string, opts?: { ascending?: boolean }) => {
          orders.push({ table, column, ascending: opts?.ascending ?? true });
          return chain;
        }),
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
    selectCalls: selects,
    insertCalls: inserts,
    updateCalls: updates,
    deleteCalls: deletes,
    eqCalls: eqs,
    orderCalls: orders,
    setResult: (key: string, result: QueryResult) => {
      resultsByOp.set(key, result);
    },
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
      resultsByOp.clear();
      selects.length = 0;
      inserts.length = 0;
      updates.length = 0;
      deletes.length = 0;
      eqs.length = 0;
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

function makeComment(overrides: Partial<ItemComment> = {}): ItemComment {
  return {
    id: 'c-1',
    item_id: 'item_1',
    user_id: 'user-1',
    author_name: 'Dan Caleb',
    author_email: 'dan@wingmacc.org',
    tag: 'note',
    body: 'Replaced batter head before Sunday rehearsal.',
    pinned: false,
    created_at: '2026-11-20T10:00:00.000Z',
    updated_at: '2026-11-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('sortItemComments', () => {
  it('orders pinned comments first and sorts each group by created_at descending', () => {
    const comments: ItemComment[] = [
      makeComment({ id: 'c-old', pinned: false, created_at: '2026-11-18T09:00:00.000Z' }),
      makeComment({ id: 'c-pin-old', pinned: true, created_at: '2026-11-17T08:00:00.000Z' }),
      makeComment({ id: 'c-new', pinned: false, created_at: '2026-11-20T12:00:00.000Z' }),
      makeComment({ id: 'c-pin-new', pinned: true, created_at: '2026-11-19T12:00:00.000Z' }),
    ];

    const sorted = sortItemComments(comments);
    expect(sorted.map((c) => c.id)).toEqual(['c-pin-new', 'c-pin-old', 'c-new', 'c-old']);
  });
});

describe('useItemComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('fires zero Supabase queries when role is guest, disabled, itemId is empty/null, or unconfigured', () => {
    const queryClient = createTestQueryClient();

    mockAuthState.role = 'guest';
    const guestHook = renderHook(() => useItemComments('item_1', true), {
      wrapper: createWrapper(queryClient),
    });
    expect(guestHook.result.current.isLoading).toBe(false);
    expect(guestHook.result.current.data).toEqual([]);

    mockAuthState.role = 'member';
    const disabledHook = renderHook(() => useItemComments('item_1', false), {
      wrapper: createWrapper(queryClient),
    });
    expect(disabledHook.result.current.isLoading).toBe(false);

    renderHook(() => useItemComments(null, true), {
      wrapper: createWrapper(queryClient),
    });
    renderHook(() => useItemComments('   ', true), {
      wrapper: createWrapper(queryClient),
    });

    mockIsConfigured.value = false;
    renderHook(() => useItemComments('item_1', true), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('fetches item_comments for item_id ordered pinned DESC, created_at DESC for members/admins', async () => {
    const older = makeComment({
      id: 'c-1',
      pinned: false,
      created_at: '2026-11-19T08:00:00.000Z',
    });
    const pinnedOlder = makeComment({
      id: 'c-2',
      pinned: true,
      created_at: '2026-11-18T08:00:00.000Z',
    });
    const newer = makeComment({
      id: 'c-3',
      pinned: false,
      created_at: '2026-11-20T09:00:00.000Z',
    });

    setResult('item_comments:select', { data: [older, pinnedOlder, newer], error: null });
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useItemComments('item_1', true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFrom).toHaveBeenCalledWith('item_comments');
    expect(eqCalls).toEqual([{ table: 'item_comments', col: 'item_id', val: 'item_1' }]);
    expect(orderCalls).toEqual([
      { table: 'item_comments', column: 'pinned', ascending: false },
      { table: 'item_comments', column: 'created_at', ascending: false },
    ]);
    expect(result.current.data.map((c) => c.id)).toEqual(['c-2', 'c-3', 'c-1']);
  });

  it('surfaces Supabase query errors cleanly', async () => {
    mockAuthState.role = 'admin';
    setResult('item_comments:select', {
      data: null,
      error: { message: 'permission denied for table item_comments' },
    });
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useItemComments('item_1', true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain('permission denied');
  });
});

describe('useCommentCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('fires zero Supabase requests for guest, disabled, or unconfigured state', () => {
    const queryClient = createTestQueryClient();

    mockAuthState.role = 'guest';
    const guestHook = renderHook(() => useCommentCounts(true), {
      wrapper: createWrapper(queryClient),
    });
    expect(guestHook.result.current.data).toEqual({});
    expect(guestHook.result.current.isLoading).toBe(false);

    mockAuthState.role = 'member';
    renderHook(() => useCommentCounts(false), {
      wrapper: createWrapper(queryClient),
    });

    mockIsConfigured.value = false;
    renderHook(() => useCommentCounts(true), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('queries item_id column only and aggregates Record<string, number> per item', async () => {
    setResult('item_comments:select', {
      data: [
        { item_id: 'item_1' },
        { item_id: 'item_2' },
        { item_id: 'item_1' },
        { item_id: 'item_1' },
      ],
      error: null,
    });
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useCommentCounts(true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(selectCalls).toEqual([{ table: 'item_comments', columns: 'item_id' }]);
    expect(result.current.data).toEqual({
      item_1: 3,
      item_2: 1,
    });
  });

  it('surfaces Supabase query errors when comment count fetch fails', async () => {
    setResult('item_comments:select', {
      data: null,
      error: { message: 'failed to fetch counts' },
    });
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useCommentCounts(true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain('failed to fetch counts');
  });
});

describe('useCommentMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('blocks Guests on all comment mutations before touching Supabase', async () => {
    mockAuthState.role = 'guest';
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useCommentMutations('item_1'), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      result.current.addComment({ body: 'Guest note', tag: 'note' })
    ).rejects.toThrow(/member|admin/i);
    await expect(
      result.current.updateComment({ id: 'c-1', body: 'Updated', tag: 'issue' })
    ).rejects.toThrow(/member|admin/i);
    await expect(result.current.deleteComment('c-1')).rejects.toThrow(/member|admin/i);
    await expect(
      result.current.togglePinComment({ id: 'c-1', pinned: true })
    ).rejects.toThrow(/admin/i);

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('validates body trimming and 2000-char limit, inserts comment, and invalidates itemComments + commentCounts', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const created = makeComment({
      id: 'c-new',
      item_id: 'item_1',
      tag: 'setup',
      body: 'Keep phantom power off before plugging in.',
    });
    setResult('item_comments:insert', { data: created, error: null });

    const { result } = renderHook(() => useCommentMutations('item_1'), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      result.current.addComment({ body: '   ', tag: 'note' })
    ).rejects.toThrow(/empty/i);

    await expect(
      result.current.addComment({ body: 'a'.repeat(COMMENT_MAX_LENGTH + 1), tag: 'note' })
    ).rejects.toThrow(/2000/);

    expect(insertCalls).toHaveLength(0);

    const row = await result.current.addComment({
      body: '  Keep phantom power off before plugging in.  ',
      tag: 'setup',
    });

    expect(row).toEqual(created);
    expect(insertCalls).toEqual([
      {
        table: 'item_comments',
        payload: [
          {
            item_id: 'item_1',
            tag: 'setup',
            body: 'Keep phantom power off before plugging in.',
          },
        ],
      },
    ]);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.itemComments('item_1'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.commentCounts,
    });
  });

  it('validates and executes updateComment and deleteComment for member/admin and invalidates caches', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const updated = makeComment({
      id: 'c-1',
      tag: 'repair',
      body: 'Sent to tech for jack replacement.',
    });
    setResult('item_comments:update', { data: updated, error: null });
    setResult('item_comments:delete', { data: null, error: null });

    const { result } = renderHook(() => useCommentMutations('item_1'), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      result.current.updateComment({ id: 'c-1', body: '  ', tag: 'repair' })
    ).rejects.toThrow(/empty/i);
    await expect(
      result.current.updateComment({
        id: 'c-1',
        body: 'x'.repeat(COMMENT_MAX_LENGTH + 1),
        tag: 'repair',
      })
    ).rejects.toThrow(/2000/);

    const saved = await result.current.updateComment({
      id: 'c-1',
      body: '  Sent to tech for jack replacement.  ',
      tag: 'repair',
    });

    expect(saved).toEqual(updated);
    expect(updateCalls).toEqual([
      {
        table: 'item_comments',
        payload: {
          body: 'Sent to tech for jack replacement.',
          tag: 'repair',
        },
        col: 'id',
        id: 'c-1',
      },
    ]);

    invalidateSpy.mockClear();

    await result.current.deleteComment('c-1');
    expect(deleteCalls).toEqual([{ table: 'item_comments', col: 'id', id: 'c-1' }]);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.itemComments('item_1'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.commentCounts,
    });
  });

  it('enforces Admin-only guard on togglePinComment and updates pinned state cleanly', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    mockAuthState.role = 'member';
    const { result, rerender } = renderHook(() => useCommentMutations('item_1'), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      result.current.togglePinComment({ id: 'c-1', pinned: true })
    ).rejects.toThrow(/admin/i);
    expect(updateCalls).toHaveLength(0);

    mockAuthState.role = 'admin';
    rerender();

    const pinnedComment = makeComment({ id: 'c-1', pinned: true });
    setResult('item_comments:update', { data: pinnedComment, error: null });

    const returned = await result.current.togglePinComment({ id: 'c-1', pinned: true });
    expect(returned).toEqual(pinnedComment);
    expect(updateCalls).toEqual([
      {
        table: 'item_comments',
        payload: { pinned: true },
        col: 'id',
        id: 'c-1',
      },
    ]);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.itemComments('item_1'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.commentCounts,
    });
  });

  it('hides cached comments and counts immediately when role transitions from member to guest', async () => {
    setResult('item_comments:select', {
      data: [makeComment({ id: 'c-1', item_id: 'item_1' })],
      error: null,
    });
    const queryClient = createTestQueryClient();

    const commentsHook = renderHook(() => useItemComments('item_1', true), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(commentsHook.result.current.isSuccess).toBe(true);
    });
    expect(commentsHook.result.current.data).toHaveLength(1);

    const countsHook = renderHook(() => useCommentCounts(true), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(countsHook.result.current.isSuccess).toBe(true);
    });
    expect(countsHook.result.current.data).toEqual({ item_1: 1 });

    mockAuthState.role = 'guest';
    commentsHook.rerender();
    countsHook.rerender();

    expect(commentsHook.result.current.data).toEqual([]);
    expect(countsHook.result.current.data).toEqual({});
  });

  it('rejects unconfigured Supabase, blank itemId on addComment, and surfaces Supabase mutation errors', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useCommentMutations('item_1'), {
      wrapper: createWrapper(queryClient),
    });

    mockIsConfigured.value = false;
    await expect(result.current.addComment({ body: 'Hello' })).rejects.toThrow(/not configured/i);
    mockIsConfigured.value = true;

    const { result: noItemResult } = renderHook(() => useCommentMutations(null), {
      wrapper: createWrapper(queryClient),
    });
    await expect(noItemResult.current.addComment({ body: 'Hello' })).rejects.toThrow(
      /item id/i
    );

    setResult('item_comments:insert', { data: null, error: { message: 'insert failed' } });
    await expect(result.current.addComment({ body: 'Hello' })).rejects.toThrow('insert failed');

    setResult('item_comments:update', { data: null, error: { message: 'update failed' } });
    await expect(
      result.current.updateComment({ id: 'c-1', body: 'Edit', tag: 'note' })
    ).rejects.toThrow('update failed');

    setResult('item_comments:delete', { data: null, error: { message: 'delete failed' } });
    await expect(result.current.deleteComment('c-1')).rejects.toThrow('delete failed');
  });
});
