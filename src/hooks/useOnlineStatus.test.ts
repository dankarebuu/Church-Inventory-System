import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnlineStatus } from './useOnlineStatus';

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useOnlineStatus', () => {
  let onLineGetter: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    onLineGetter = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes from navigator.onLine (online and offline)', () => {
    const queryClient = new QueryClient();
    const { result, unmount } = renderHook(() => useOnlineStatus(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current).toEqual({ isOnline: true, isOffline: false });
    unmount();

    onLineGetter.mockReturnValue(false);
    const { result: offlineResult } = renderHook(() => useOnlineStatus(), {
      wrapper: createWrapper(queryClient),
    });

    expect(offlineResult.current).toEqual({ isOnline: false, isOffline: true });
  });

  it('reacts to window offline/online events and invalidates TanStack Query on offline -> online transition', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue();

    const { result, unmount } = renderHook(() => useOnlineStatus(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.isOnline).toBe(true);

    // Firing online while already online should not spuriously refetch.
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Transition to offline.
    act(() => {
      onLineGetter.mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toEqual({ isOnline: false, isOffline: true });
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Transition offline -> online triggers background refetch.
    act(() => {
      onLineGetter.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toEqual({ isOnline: true, isOffline: false });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    // Listeners are removed cleanly on unmount.
    unmount();
    act(() => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('triggers invalidateQueries when mounted offline and transitioning to online', () => {
    onLineGetter.mockReturnValue(false);
    const queryClient = new QueryClient();
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue();

    const { result } = renderHook(() => useOnlineStatus(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.isOffline).toBe(true);

    act(() => {
      onLineGetter.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current).toEqual({ isOnline: true, isOffline: false });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});
