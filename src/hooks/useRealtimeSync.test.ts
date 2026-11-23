import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';
import type { UserRole } from '@/types/database';
import { useRealtimeSync } from './useRealtimeSync';

type SubscribeStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';
type SubscribeCallback = (status: SubscribeStatus, err?: Error) => void;
type PostgresFilter = { event: string; schema: string; table?: string };
type ChangeCallback = () => void;

interface MockChannelRecord {
  topic: string;
  tables: string[];
  handlers: Map<string, ChangeCallback[]>;
  subscribeCallback: SubscribeCallback | null;
  channelObject: {
    on: (type: string, filter: PostgresFilter, cb: ChangeCallback) => unknown;
    subscribe: (cb?: SubscribeCallback) => unknown;
  };
}

const { mockIsConfigured, mockChannelFn, mockRemoveChannelFn, createdChannels, resetChannels } =
  vi.hoisted(() => {
    const channels: MockChannelRecord[] = [];
    const configured = { value: true };
    const removeChannel = vi.fn(async () => 'ok');
    const channelFn = vi.fn((topic: string) => {
      const record: MockChannelRecord = {
        topic,
        tables: [],
        handlers: new Map(),
        subscribeCallback: null,
        channelObject: {
          on: vi.fn(),
          subscribe: vi.fn(),
        },
      };

      record.channelObject.on = vi.fn(
        (type: string, filter: PostgresFilter, cb: ChangeCallback) => {
          if (type === 'postgres_changes' && filter.table) {
            record.tables.push(filter.table);
            const existing = record.handlers.get(filter.table) ?? [];
            existing.push(cb);
            record.handlers.set(filter.table, existing);
          }
          return record.channelObject;
        }
      );

      record.channelObject.subscribe = vi.fn((cb?: SubscribeCallback) => {
        record.subscribeCallback = cb ?? null;
        return record.channelObject;
      });

      channels.push(record);
      return record.channelObject;
    });

    return {
      mockIsConfigured: configured,
      mockChannelFn: channelFn,
      mockRemoveChannelFn: removeChannel,
      createdChannels: channels,
      resetChannels: () => {
        channels.length = 0;
      },
    };
  });

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() {
    return mockIsConfigured.value;
  },
  supabase: {
    channel: mockChannelFn,
    removeChannel: mockRemoveChannelFn,
  },
}));

function emitTableEvent(channel: MockChannelRecord, table: string) {
  const listeners = channel.handlers.get(table) ?? [];
  for (const listener of listeners) {
    listener();
  }
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useRealtimeSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChannels();
    mockIsConfigured.value = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns offline status and creates no channels when Supabase is not configured', () => {
    mockIsConfigured.value = false;
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useRealtimeSync('guest'), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.status).toBe('offline');
    expect(result.current.isConfigured).toBe(false);
    expect(mockChannelFn).not.toHaveBeenCalled();
  });

  it('subscribes guests ONLY to categories, locations, and equipment_types (never inventory, item_comments, loans, history_log, or profiles) and reports Catalog Sync', () => {
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useRealtimeSync('guest'), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockChannelFn).toHaveBeenCalledTimes(1);
    const guestChannel = createdChannels[0];
    expect(guestChannel.tables).toEqual(['categories', 'locations', 'equipment_types']);
    expect(guestChannel.tables).not.toContain('inventory');
    expect(guestChannel.tables).not.toContain('item_comments');
    expect(guestChannel.tables).not.toContain('loans');
    expect(guestChannel.tables).not.toContain('history_log');
    expect(guestChannel.tables).not.toContain('profiles');

    act(() => {
      guestChannel.subscribeCallback?.('SUBSCRIBED');
    });
    expect(result.current.status).toBe('connected');
    expect(result.current.label).toBe('Catalog Sync');
  });

  it('subscribes members to equipment_types, item_comments, loans, and history_log without profiles, and admins to profiles too', () => {
    const queryClient = new QueryClient();

    const { rerender } = renderHook(({ role }: { role: UserRole }) => useRealtimeSync(role), {
      initialProps: { role: 'member' as UserRole },
      wrapper: createWrapper(queryClient),
    });

    expect(createdChannels[0].tables).toEqual([
      'inventory',
      'categories',
      'locations',
      'equipment_types',
      'item_comments',
      'loans',
      'history_log',
    ]);
    expect(createdChannels[0].tables).not.toContain('profiles');

    rerender({ role: 'admin' });

    expect(mockRemoveChannelFn).toHaveBeenCalledWith(createdChannels[0].channelObject);
    expect(createdChannels[1].tables).toEqual([
      'inventory',
      'categories',
      'locations',
      'equipment_types',
      'item_comments',
      'loans',
      'history_log',
      'profiles',
    ]);
  });

  it('invalidates equipmentTypes for all roles and invalidates item-comments prefix + commentCounts strictly for member/admin', () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { rerender } = renderHook(({ role }: { role: UserRole }) => useRealtimeSync(role), {
      initialProps: { role: 'guest' as UserRole },
      wrapper: createWrapper(queryClient),
    });

    const guestChannel = createdChannels[0];
    expect(guestChannel.handlers.has('item_comments')).toBe(false);
    emitTableEvent(guestChannel, 'equipment_types');
    vi.advanceTimersByTime(250);

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.equipmentTypes,
    });

    invalidateSpy.mockClear();
    rerender({ role: 'member' });

    const memberChannel = createdChannels[1];
    emitTableEvent(memberChannel, 'equipment_types');
    emitTableEvent(memberChannel, 'item_comments');
    vi.advanceTimersByTime(250);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.equipmentTypes,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['item-comments'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.commentCounts,
    });

    invalidateSpy.mockClear();
    rerender({ role: 'admin' });

    const adminChannel = createdChannels[2];
    emitTableEvent(adminChannel, 'item_comments');
    vi.advanceTimersByTime(250);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['item-comments'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.commentCounts,
    });
  });

  it('coalesces multiple rapid inventory events within 250ms for members and rapid categories events for guests', () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { unmount } = renderHook(() => useRealtimeSync('member'), {
      wrapper: createWrapper(queryClient),
    });

    const memberChannel = createdChannels[0];

    emitTableEvent(memberChannel, 'inventory');
    vi.advanceTimersByTime(50);
    emitTableEvent(memberChannel, 'inventory');
    vi.advanceTimersByTime(50);
    emitTableEvent(memberChannel, 'inventory');
    vi.advanceTimersByTime(50);
    emitTableEvent(memberChannel, 'inventory');

    expect(invalidateSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(249);
    expect(invalidateSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.inventory('member'),
    });

    unmount();
    invalidateSpy.mockClear();

    renderHook(() => useRealtimeSync('guest'), {
      wrapper: createWrapper(queryClient),
    });

    const guestChannel = createdChannels[1];
    emitTableEvent(guestChannel, 'categories');
    vi.advanceTimersByTime(50);
    emitTableEvent(guestChannel, 'categories');
    vi.advanceTimersByTime(250);

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.categories,
    });
  });

  it('debounces independently per query key batch and coalesces loans + inventory invalidations', () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    renderHook(() => useRealtimeSync('member'), {
      wrapper: createWrapper(queryClient),
    });

    const channel = createdChannels[0];

    emitTableEvent(channel, 'inventory');
    emitTableEvent(channel, 'loans');
    emitTableEvent(channel, 'categories');

    expect(invalidateSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);

    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.inventory('member'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.loans,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.categories,
    });
  });

  it('clears pending timers and removes channel on role change and unmount', () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { rerender, unmount } = renderHook(
      ({ role }: { role: UserRole }) => useRealtimeSync(role),
      {
        initialProps: { role: 'guest' as UserRole },
        wrapper: createWrapper(queryClient),
      }
    );

    const guestChannel = createdChannels[0];
    emitTableEvent(guestChannel, 'categories');

    rerender({ role: 'member' });
    expect(mockRemoveChannelFn).toHaveBeenCalledTimes(1);
    expect(mockRemoveChannelFn).toHaveBeenCalledWith(guestChannel.channelObject);

    vi.advanceTimersByTime(300);
    expect(invalidateSpy).not.toHaveBeenCalled();

    const memberChannel = createdChannels[1];
    emitTableEvent(memberChannel, 'loans');

    unmount();
    expect(mockRemoveChannelFn).toHaveBeenCalledTimes(2);
    expect(mockRemoveChannelFn).toHaveBeenCalledWith(memberChannel.channelObject);

    vi.advanceTimersByTime(300);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('updates Realtime connection status from channel subscribe callbacks', () => {
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useRealtimeSync('admin'), {
      wrapper: createWrapper(queryClient),
    });

    const channel = createdChannels[0];
    expect(result.current.status).toBe('connecting');

    act(() => {
      channel.subscribeCallback?.('SUBSCRIBED');
    });
    expect(result.current.status).toBe('connected');

    act(() => {
      channel.subscribeCallback?.('CHANNEL_ERROR');
    });
    expect(result.current.status).toBe('error');

    act(() => {
      channel.subscribeCallback?.('CLOSED');
    });
    expect(result.current.status).toBe('offline');
  });

  it('retries channel subscription after CHANNEL_ERROR and catches up queries upon reconnect', () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => useRealtimeSync('member'), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      createdChannels[0].subscribeCallback?.('SUBSCRIBED');
    });
    expect(result.current.status).toBe('connected');
    expect(invalidateSpy).not.toHaveBeenCalled();

    act(() => {
      createdChannels[0].subscribeCallback?.('CHANNEL_ERROR');
    });
    expect(result.current.status).toBe('error');

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockRemoveChannelFn).toHaveBeenCalledWith(createdChannels[0].channelObject);
    expect(createdChannels).toHaveLength(2);
    expect(result.current.status).toBe('connecting');

    act(() => {
      createdChannels[1].subscribeCallback?.('SUBSCRIBED');
    });

    expect(result.current.status).toBe('connected');
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.inventory('member'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.loans,
    });
  });
});
