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

  it('subscribes guests ONLY to inventory, categories, and locations (never loans, history_log, or profiles)', () => {
    const queryClient = new QueryClient();

    renderHook(() => useRealtimeSync('guest'), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockChannelFn).toHaveBeenCalledTimes(1);
    const guestChannel = createdChannels[0];
    expect(guestChannel.tables).toEqual(['inventory', 'categories', 'locations']);
    expect(guestChannel.tables).not.toContain('loans');
    expect(guestChannel.tables).not.toContain('history_log');
    expect(guestChannel.tables).not.toContain('profiles');
  });

  it('subscribes members to loans and history_log without profiles, and admins to profiles too', () => {
    const queryClient = new QueryClient();

    const { rerender } = renderHook(({ role }: { role: UserRole }) => useRealtimeSync(role), {
      initialProps: { role: 'member' as UserRole },
      wrapper: createWrapper(queryClient),
    });

    expect(createdChannels[0].tables).toEqual([
      'inventory',
      'categories',
      'locations',
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
      'loans',
      'history_log',
      'profiles',
    ]);
  });

  it('coalesces multiple rapid inventory events within 250ms into a single invalidateQueries call', () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    renderHook(() => useRealtimeSync('guest'), {
      wrapper: createWrapper(queryClient),
    });

    const channel = createdChannels[0];

    emitTableEvent(channel, 'inventory');
    vi.advanceTimersByTime(50);
    emitTableEvent(channel, 'inventory');
    vi.advanceTimersByTime(50);
    emitTableEvent(channel, 'inventory');
    vi.advanceTimersByTime(50);
    emitTableEvent(channel, 'inventory');

    expect(invalidateSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(249);
    expect(invalidateSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.inventory('guest'),
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
    emitTableEvent(guestChannel, 'inventory');

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
});
